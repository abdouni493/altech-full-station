-- =====================================================================================
--  altech station — Migration « L'ÉTAT PARTAGÉ NE S'ÉCRASE PLUS »
--
--  HOW TO RUN
--    Supabase → SQL Editor → New query → coller CE fichier entier → Run.
--    Le script est IDEMPOTENT : il peut être relancé sans risque.
--
--  PRÉ-REQUIS (migration déjà passée)
--      • module_workers_auth.sql   → public.biz_store (l'état partagé des parties)
--
--  LE PROBLÈME CORRIGÉ
--    Les parties Cafétéria / Lavage tiennent dans UNE ligne JSON (`biz_store`).
--    Chaque poste en gardait une copie complète en mémoire et la RÉÉCRIVAIT en
--    entier. Deux pertes de données silencieuses en découlaient — celles qui
--    faisaient disparaître un produit tout juste créé :
--
--      1. ENTRE DEUX POSTES : le dernier qui écrivait gagnait. Le poste B
--         enregistrait sa copie, vieille de dix minutes, et le produit créé
--         entre-temps par le poste A n'existait plus.
--      2. APRÈS UN RAFRAÎCHISSEMENT : au démarrage, la copie du serveur écrasait
--         la copie locale. Un produit créé puis suivi d'un rechargement dans la
--         seconde (avant que l'envoi différé ne parte) était perdu des deux côtés.
--
--  CE QUE FAIT CE SCRIPT
--    1.  biz_store.rev — un NUMÉRO DE VERSION sur la ligne partagée.
--    2.  biz_store_save() — écriture avec CONTRÔLE DE VERSION : le serveur
--        refuse une écriture bâtie sur un état périmé et rend la version
--        courante. L'application refusionne puis rejoue — plus personne ne peut
--        effacer le travail d'un autre poste.
--    3.  Un déclencheur incrémente `rev` même sur une écriture directe, pour
--        qu'aucun chemin ne contourne le contrôle.
--    4.  `deletedIds` garanti sur chaque partie : le registre des suppressions,
--        sans lequel la fusion ferait revenir ce qui vient d'être supprimé.
--    5.  Publication temps réel réduite aux colonnes utiles : chaque poste est
--        prévenu d'un changement sans recevoir tout le JSON.
-- =====================================================================================

-- =====================================================================================
--  1. LE NUMÉRO DE VERSION DE LA LIGNE PARTAGÉE
-- =====================================================================================

alter table public.biz_store
  add column if not exists rev bigint not null default 1;

comment on column public.biz_store.rev is
  'Numéro de version de l''état partagé. Une écriture doit annoncer la version sur laquelle elle a été bâtie : si la ligne a bougé entre-temps, le serveur la refuse (voir biz_store_save).';

-- Filet : même une écriture directe (application non à jour, correction à la
-- main) fait avancer la version, sinon le contrôle serait contournable.
create or replace function public.biz_store_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  -- biz_store_save() a déjà posé la nouvelle version : on ne la double pas.
  if new.rev is not distinct from old.rev then
    new.rev := old.rev + 1;
  end if;
  return new;
end;
$$;

drop trigger if exists biz_store_touch_trg on public.biz_store;
create trigger biz_store_touch_trg
  before update on public.biz_store
  for each row execute function public.biz_store_touch();

-- =====================================================================================
--  2. L'ÉCRITURE CONTRÔLÉE
--
--     p_base_rev = version lue par le poste avant de préparer son écriture.
--       • elle correspond toujours  → l'écriture passe, la version avance ;
--       • elle a changé             → REFUS, et l'état courant est renvoyé pour
--                                     que le poste le fusionne et rejoue ;
--       • elle vaut NULL            → première écriture (la ligne n'existe pas
--                                     encore) ou application antérieure à cette
--                                     migration : on accepte, l'application
--                                     ayant de toute façon relu et fusionné.
--
--     Retour :
--       { "ok": true,  "rev": 42 }
--       { "ok": false, "conflict": true, "rev": 43, "state": { … } }
-- =====================================================================================

create or replace function public.biz_store_save(
  p_id       text,
  p_state    jsonb,
  p_base_rev bigint default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_new_rev bigint;
  v_cur_rev bigint;
  v_cur     jsonb;
begin
  if p_state is null or jsonb_typeof(p_state) <> 'object' then
    return jsonb_build_object('ok', false, 'error', 'État invalide : un objet JSON est attendu');
  end if;

  insert into public.biz_store (id, state, rev, updated_at)
       values (p_id, p_state, 1, now())
  on conflict (id) do update
       set state      = excluded.state,
           rev        = public.biz_store.rev + 1,
           updated_at = now()
     where p_base_rev is null
        or public.biz_store.rev = p_base_rev
  returning rev into v_new_rev;

  if v_new_rev is not null then
    return jsonb_build_object('ok', true, 'rev', v_new_rev);
  end if;

  -- Refusé : un autre poste a écrit entre-temps. On rend sa version, l'appelant
  -- fusionne et revient — rien n'est perdu d'aucun des deux côtés.
  select rev, state into v_cur_rev, v_cur from public.biz_store where id = p_id;
  return jsonb_build_object('ok', false, 'conflict', true, 'rev', v_cur_rev, 'state', v_cur);
end;
$$;

comment on function public.biz_store_save(text, jsonb, bigint) is
  'Écrit l''état partagé des parties SANS écraser en aveugle : l''écriture n''est acceptée que si la ligne est toujours à la version annoncée. Sinon elle est refusée et l''état courant est renvoyé pour fusion.';

grant execute on function public.biz_store_save(text, jsonb, bigint) to authenticated;

-- =====================================================================================
--  3. LE REGISTRE DES SUPPRESSIONS
--
--     La fusion réunit les deux copies ligne par ligne. Sans trace des
--     suppressions, chaque fusion ferait REVENIR ce qui vient d'être supprimé :
--     `deletedIds` (identifiant → date de suppression) est cette trace.
-- =====================================================================================

do $$
declare
  s jsonb;
  part text;
begin
  if to_regclass('public.biz_store') is null then
    raise notice 'public.biz_store absente — passez d''abord module_workers_auth.sql.';
    return;
  end if;

  select state into s from public.biz_store where id = 'biz-v1';
  if s is null then
    raise notice 'biz_store vide — rien à normaliser.';
    return;
  end if;

  foreach part in array array['cafeteria', 'lavage'] loop
    if (s ? part) and not ((s -> part) ? 'deletedIds') then
      s := jsonb_set(s, array[part, 'deletedIds'], '{}'::jsonb, true);
    end if;
  end loop;

  update public.biz_store set state = s where id = 'biz-v1';
  raise notice 'biz_store : registre des suppressions en place.';
end $$;

-- =====================================================================================
--  4. TEMPS RÉEL — prévenir sans tout renvoyer
--
--     Le JSON complet peut peser plusieurs mégaoctets : le diffuser à chaque
--     écriture saturerait la liaison (et Supabase le rejetterait). Seules les
--     colonnes de signalement partent ; l'application relit alors la ligne et
--     fusionne. Si la liste de colonnes n'est pas supportée, on publie la table
--     entière : mieux vaut un message lourd que pas de message du tout.
-- =====================================================================================

do $$
begin
  if exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'biz_store'
  ) then
    alter publication supabase_realtime drop table public.biz_store;
  end if;

  begin
    alter publication supabase_realtime add table public.biz_store (id, rev, updated_at);
  exception when others then
    alter publication supabase_realtime add table public.biz_store;
    raise notice 'Publication temps réel : table entière (liste de colonnes non supportée).';
  end;
exception when others then
  raise notice 'Publication temps réel non modifiée : %', sqlerrm;
end $$;

-- =====================================================================================
--  VÉRIFICATIONS (facultatif — à exécuter à la main)
-- =====================================================================================
--   -- Version courante et taille de l'état partagé :
--   select id, rev, updated_at, pg_size_pretty(pg_column_size(state)::bigint) as poids
--     from public.biz_store;
--
--   -- Combien de produits par partie :
--   select 'cafeteria' as partie, jsonb_array_length(state -> 'cafeteria' -> 'products') as produits
--     from public.biz_store where id = 'biz-v1'
--   union all
--   select 'lavage', jsonb_array_length(state -> 'lavage' -> 'products')
--     from public.biz_store where id = 'biz-v1';
--
--   -- Une écriture périmée doit être REFUSÉE (rev = 1 alors que la ligne a avancé) :
--   select public.biz_store_save('biz-v1', (select state from public.biz_store where id = 'biz-v1'), 1);
--
--  Terminé.
-- =====================================================================================
