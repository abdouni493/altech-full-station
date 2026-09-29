-- =====================================================================================
--  altech station — Migration « LES PRODUITS ONT LEUR PROPRE TABLE »
--
--  HOW TO RUN
--    Supabase → SQL Editor → New query → coller CE fichier entier → Run.
--    Le script est IDEMPOTENT : il peut être relancé sans risque.
--
--  PRÉ-REQUIS (migrations déjà passées)
--      • module_workers_auth.sql          → biz_store, is_station_admin()
--      • 2026-08-04_biz_sessions_per_worker.sql (pour les helpers RLS)
--
--  LE PROBLÈME CORRIGÉ
--    Toutes les données des parties commerciales tiennent dans UNE ligne JSON
--    (`biz_store`). Cette ligne pèse aujourd'hui 665 Ko — dont 567 Ko rien que
--    pour l'historique des ventes de la Cafétéria. Or elle est réécrite EN
--    ENTIER à la moindre modification : créer un produit de 800 octets envoyait
--    donc 665 Ko sur le lien de la station. Au-delà de huit secondes, la requête
--    est abandonnée, et l'écran affichait :
--
--        « Le serveur refuse les enregistrements »
--        « TimeoutError: Le serveur n'a pas répondu en 8 s »
--
--    Le produit restait alors dans les brouillons alors que la base était en
--    parfait état : c'est le POIDS de l'envoi qui échouait, pas l'écriture.
--
--  CE QUE FAIT CE SCRIPT
--    1.  public.biz_products — UNE LIGNE PAR PRODUIT (~800 octets), écrite
--        directement par l'application. Créer un produit ne dépend plus du tout
--        de la grosse ligne JSON.
--    2.  Les colonnes lisibles (nom, code-barres, stock, prix) sont DÉDUITES du
--        JSON par un déclencheur : impossible qu'elles divergent de la fiche.
--    3.  RLS alignée sur `biz_store` : tout compte connecté lit et écrit (les
--        permissions par partie restent gérées par l'application, comme avant).
--    4.  Reprise de l'existant : chaque produit déjà dans le blob est copié ici,
--        avec son identifiant — rien n'est perdu, rien n'est dupliqué.
--    5.  Publication temps réel : un produit créé sur un poste apparaît sur les
--        autres sans rechargement.
--
--  CE QUI NE CHANGE PAS
--    Le blob `biz_store` continue de porter une copie des produits. Cette table
--    fait AUTORITÉ (l'application applique ses lignes par-dessus au chargement),
--    mais la copie du blob reste le filet : sauvegarde, restauration et postes
--    dont la migration n'est pas encore passée continuent de fonctionner.
-- =====================================================================================

create extension if not exists pgcrypto;

-- =====================================================================================
--  1. LA TABLE
--
--     `data` porte la fiche COMPLÈTE telle que l'application la lit et l'écrit
--     (mêmes noms de champs qu'en JavaScript, `_upd` compris). Les colonnes qui
--     l'entourent n'existent que pour la lisibilité et les recherches : elles
--     sont recalculées à chaque écriture, jamais envoyées par le client.
-- =====================================================================================

create table if not exists public.biz_products (
  id              text primary key,
  module_key      text        not null check (module_key in ('cafeteria', 'lavage')),
  data            jsonb       not null,
  -- ── Colonnes déduites de `data` (voir le déclencheur) ──────────────────────
  name            text        not null default '',
  barcode         text,
  category_name   text,
  current_qty     numeric(16,3) not null default 0,
  purchase_price  numeric(14,2) not null default 0,
  sale_price      numeric(14,2) not null default 0,
  is_raw_material boolean     not null default false,
  -- Horodatage d'écriture de la fiche (`_upd`) : c'est lui qui départage deux
  -- versions d'un même produit entre deux postes.
  upd             timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.biz_products is
  'Catalogue des parties commerciales (Cafétéria / Lavage) — une ligne par produit. Remplace l''écriture intégrale du blob biz_store à chaque création : c''est ce qui faisait expirer les enregistrements au-delà de 8 s.';
comment on column public.biz_products.data is
  'La fiche produit complète, telle que l''application la lit (currentQty, purchasePrice, _upd…). Source de vérité de la ligne.';
comment on column public.biz_products.upd is
  'Copie de data->>''_upd'' : horodatage d''écriture, utilisé par la fusion entre postes.';

create index if not exists biz_products_module_idx  on public.biz_products (module_key, name);
create index if not exists biz_products_barcode_idx on public.biz_products (barcode) where barcode is not null;
create index if not exists biz_products_upd_idx     on public.biz_products (upd desc);

-- =====================================================================================
--  2. LES COLONNES LISIBLES SONT DÉDUITES — jamais saisies deux fois
--
--     Le client n'envoie que `id`, `module_key` et `data`. Tout le reste est
--     recalculé ici : la table reste consultable dans l'éditeur SQL sans qu'une
--     colonne puisse mentir sur le contenu de la fiche.
-- =====================================================================================

-- Conversion tolérante : une valeur absente ou mal formée vaut NULL au lieu de
-- faire échouer toute l'écriture du produit.
create or replace function public.biz_safe_num(v text)
returns numeric language sql immutable as $$
  select case when v ~ '^[-+]?[0-9]+(\.[0-9]+)?([eE][-+]?[0-9]+)?$' then v::numeric else null end;
$$;

-- `stable` et non `immutable` : la conversion en timestamptz dépend du fuseau
-- de la session.
create or replace function public.biz_safe_ts(v text)
returns timestamptz language plpgsql stable as $$
begin
  return v::timestamptz;
exception when others then
  return null;
end;
$$;

create or replace function public.biz_products_derive()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.name            := coalesce(nullif(new.data ->> 'name', ''), 'Sans nom');
  new.barcode         := nullif(new.data ->> 'barcode', '');
  new.category_name   := nullif(new.data ->> 'categoryName', '');
  new.current_qty     := coalesce(public.biz_safe_num(new.data ->> 'currentQty'), 0);
  new.purchase_price  := coalesce(public.biz_safe_num(new.data ->> 'purchasePrice'), 0);
  new.sale_price      := coalesce(public.biz_safe_num(new.data ->> 'salePrice'), 0);
  new.is_raw_material := coalesce((new.data ->> 'isRawMaterial')::boolean, false);
  new.upd             := coalesce(public.biz_safe_ts(new.data ->> '_upd'), now());
  new.updated_at      := now();
  return new;
end;
$$;

drop trigger if exists biz_products_derive_trg on public.biz_products;
create trigger biz_products_derive_trg
  before insert or update on public.biz_products
  for each row execute function public.biz_products_derive();

-- =====================================================================================
--  3. RLS — exactement la même portée que le blob qu'elle remplace
--
--     `biz_store` est lisible et écrivable par tout compte connecté ; les droits
--     par partie (créer / modifier / supprimer) sont appliqués par l'application.
--     Cette table ne restreint pas davantage : le faire ici couperait des postes
--     employés qui enregistrent aujourd'hui sans difficulté.
-- =====================================================================================

alter table public.biz_products enable row level security;

drop policy if exists biz_products_read  on public.biz_products;
drop policy if exists biz_products_write on public.biz_products;

create policy biz_products_read  on public.biz_products
  for select to authenticated using (true);
create policy biz_products_write on public.biz_products
  for all to authenticated using (true) with check (true);

grant select, insert, update, delete on public.biz_products to authenticated;

-- =====================================================================================
--  4. REPRISE DE L'EXISTANT — le catalogue déjà enregistré dans le blob
--
--     Les identifiants sont conservés : ventes, achats, fiches techniques et
--     inventaires continuent de désigner les mêmes produits.
--
--     Deux exclusions :
--       • les lignes du jeu de démonstration retiré (`cafeteria-prd-1`…), que
--         l'application efface déjà au chargement — les réintroduire ici les
--         ferait revenir ;
--       • les produits supprimés (pierres tombales `deletedIds` du blob).
-- =====================================================================================

do $$
declare
  v_state jsonb;
  v_part  text;
  v_row   jsonb;
  v_id    text;
  v_seed  text := '^(cafeteria|lavage|restaurant|magasin)-(acp|cat|cli|cmp|csh|dst|exp|fic|mrq|prod|prd|pur|rep|role|sale|srv|sup|wrk)-[0-9]';
  v_count int := 0;
begin
  select state into v_state from public.biz_store where id = 'biz-v1';
  if v_state is null then
    raise notice 'biz_store vide — aucun produit à reprendre.';
    return;
  end if;

  foreach v_part in array array['cafeteria', 'lavage'] loop
    if coalesce(jsonb_typeof(v_state -> v_part -> 'products'), '') <> 'array' then
      continue;
    end if;

    for v_row in select * from jsonb_array_elements(v_state -> v_part -> 'products') loop
      v_id := nullif(v_row ->> 'id', '');
      continue when v_id is null;
      continue when v_id ~ v_seed;                                   -- jeu de démonstration
      -- `jsonb_exists(...)` plutôt que l'opérateur `?` : ce dernier est pris
      -- pour un paramètre lié par plusieurs pilotes SQL.
      continue when jsonb_exists(v_state -> v_part -> 'deletedIds', v_id);

      begin
        insert into public.biz_products (id, module_key, data)
        values (v_id, v_part, v_row)
        on conflict (id) do nothing;                                 -- la base fait foi
        v_count := v_count + 1;
      exception when others then
        raise notice 'Produit ignoré (%): %', v_id, sqlerrm;
      end;
    end loop;
  end loop;

  raise notice 'Reprise terminée : % produit(s) examiné(s).', v_count;
end $$;

-- =====================================================================================
--  5. TEMPS RÉEL — un produit créé sur un poste apparaît sur les autres
-- =====================================================================================

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'biz_products'
  ) then
    alter publication supabase_realtime add table public.biz_products;
  end if;
exception when others then
  raise notice 'Publication temps réel non modifiée : %', sqlerrm;
end $$;

-- =====================================================================================
--  VÉRIFICATIONS (facultatif — à exécuter à la main)
-- =====================================================================================
--   select module_key, count(*), sum(current_qty * purchase_price) as valeur
--     from public.biz_products group by 1;
--   select module_key, name, current_qty, sale_price, upd
--     from public.biz_products order by upd desc limit 20;
--
--  Terminé.
-- =====================================================================================
