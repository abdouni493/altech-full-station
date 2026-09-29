-- =====================================================================================
--  altech station — Migration « RÉFÉRENCES & VÉHICULES COMPATIBLES D'UNE PIÈCE »
--
--  HOW TO RUN
--    Supabase → SQL Editor → New query → coller CE fichier entier → Run.
--    Le script est IDEMPOTENT : il peut être relancé sans risque, autant de fois
--    que nécessaire, sur une base déjà à jour comme sur une base en retard.
--
--  PRÉ-REQUIS (migration déjà passée)
--      • 2026-08-15_biz_products_table.sql  → public.biz_products, biz_products_derive()
--
--  CE QUE CETTE MISE À JOUR APPORTE
--    La partie Lavage & Réparation vend des PIÈCES DÉTACHÉES. Une pièce ne se
--    cherche jamais par son nom de rayon :
--
--      • le client lit un NUMÉRO sur son ancienne pièce — et ce numéro n'est
--        presque jamais celui de votre catalogue. Une même pièce en porte
--        plusieurs : l'origine constructeur, l'équipementier, le fournisseur ;
--      • ou bien il annonce sa VOITURE — « Clio 4 de 2015, boîte automatique » —
--        et c'est au magasin de savoir quelles pièces lui vont.
--
--    La fiche produit accepte donc désormais AUTANT DE RÉFÉRENCES et AUTANT DE
--    VÉHICULES COMPATIBLES qu'il en faut, et les trois écrans (Gestion de stock,
--    création d'un achat, point de vente) cherchent dessus.
--
--  POURQUOI CE SCRIPT EST COURT
--    Une fiche produit voyage ENTIÈRE dans la colonne `data` (jsonb) : les deux
--    nouvelles listes (`refs`, `cars`) s'y écrivent sans qu'aucune colonne soit
--    à créer, et l'application fonctionne dès le déploiement, même sans ce
--    script. Ce qu'il ajoute, c'est la LISIBILITÉ et la RECHERCHE CÔTÉ BASE :
--
--      1. deux colonnes déduites — `refs_text`, `cars_text` — qui mettent à plat
--         ce que porte le JSON, pour qu'un inventaire se relise dans l'éditeur
--         SQL sans déplier du jsonb à la main ;
--      2. deux compteurs (`refs_count`, `cars_count`), de quoi repérer d'un coup
--         d'œil les pièces encore non renseignées ;
--      3. des index trigrammes, pour qu'une recherche « 7701478261 » ou
--         « clio 4 » reste instantanée quand le rayon comptera des milliers de
--         références.
--
--  CE QUI NE CHANGE PAS
--    Le client n'envoie toujours que `id`, `module_key` et `data` : toutes les
--    colonnes qui les entourent sont recalculées par le déclencheur et ne
--    peuvent donc pas mentir sur le contenu de la fiche. Les produits existants
--    restent valides tels quels — une pièce sans référence ni véhicule continue
--    de se chercher par son nom et son code-barres, exactement comme avant.
-- =====================================================================================

-- Recherche floue sur les références et les modèles de voiture. Selon la base,
-- l'extension vit dans `public` ou dans `extensions` : les index de la section 4
-- s'adaptent, et le script reste valable si elle ne peut pas être installée.
do $$
begin
  create extension if not exists pg_trgm;
exception when others then
  raise notice 'pg_trgm non installée (%) — les index de recherche seront ignorés.', sqlerrm;
end $$;

-- =====================================================================================
--  1. LES COLONNES LISIBLES
--
--     `refs_text` / `cars_text` sont une MISE À PLAT de ce que porte `data` —
--     jamais une seconde source. Elles ne servent qu'à lire et à chercher.
-- =====================================================================================

alter table public.biz_products
  add column if not exists refs_text  text,
  add column if not exists cars_text  text,
  add column if not exists refs_count integer not null default 0,
  add column if not exists cars_count integer not null default 0;

comment on column public.biz_products.refs_text is
  'Toutes les références de la pièce mises bout à bout (numéro, marque, note), telles quelles ET sans séparateurs. Déduite de data->''refs'' — ne jamais l''écrire à la main.';
comment on column public.biz_products.cars_text is
  'Tous les véhicules que la pièce équipe, mis bout à bout (marque, modèle, année, boîte, description). Déduite de data->''cars''.';
comment on column public.biz_products.refs_count is
  'Nombre de références portées par la fiche — 0 = pièce non référencée.';
comment on column public.biz_products.cars_count is
  'Nombre de véhicules compatibles déclarés — 0 = compatibilité non renseignée.';

-- =====================================================================================
--  2. LA MISE À PLAT
--
--     Un numéro s'écrit « 7701 478 261 » dans le catalogue et se tape d'un bloc :
--     les DEUX formes entrent dans le texte cherché, sans quoi la référence
--     enregistrée avec ses espaces resterait introuvable. Même règle côté
--     application (`productSearchFields`, src/lib/bizConfig.ts) : les deux
--     recherches doivent rendre la même chose.
-- =====================================================================================

create or replace function public.biz_product_refs_text(v_data jsonb)
returns text language sql immutable as $$
  select nullif(trim(coalesce(string_agg(
    concat_ws(' ',
      nullif(item ->> 'ref', ''),
      -- La même référence sans ses séparateurs : « 7701 478 261 » → « 7701478261 ».
      nullif(regexp_replace(coalesce(item ->> 'ref', ''), '[^a-zA-Z0-9]', '', 'g'), ''),
      nullif(item ->> 'brand', ''),
      nullif(item ->> 'note', '')
    ), ' '), '')), '')
  from jsonb_array_elements(
    case when jsonb_typeof(v_data -> 'refs') = 'array' then v_data -> 'refs' else '[]'::jsonb end
  ) as t(item);
$$;

create or replace function public.biz_product_cars_text(v_data jsonb)
returns text language sql immutable as $$
  select nullif(trim(coalesce(string_agg(
    concat_ws(' ',
      nullif(item ->> 'marque', ''),
      nullif(item ->> 'name', ''),
      nullif(item ->> 'year', ''),
      -- Les deux orthographes de la boîte : on cherche « auto » comme
      -- « automatique », « manuel » comme « manuelle ».
      case item ->> 'gearbox'
        when 'auto'     then 'auto automatique'
        when 'manuelle' then 'manuel manuelle'
        else null
      end,
      nullif(item ->> 'description', '')
    ), ' '), '')), '')
  from jsonb_array_elements(
    case when jsonb_typeof(v_data -> 'cars') = 'array' then v_data -> 'cars' else '[]'::jsonb end
  ) as t(item);
$$;

/**
 *  Combien d'éléments dans une liste du JSON — 0 si la clé est absente ou si ce
 *  n'est pas un tableau (une fiche d'avant cette migration, par exemple).
 */
create or replace function public.biz_jsonb_len(v_data jsonb, v_key text)
returns integer language sql immutable as $$
  select case
    when jsonb_typeof(v_data -> v_key) = 'array' then jsonb_array_length(v_data -> v_key)
    else 0
  end;
$$;

-- =====================================================================================
--  3. LE DÉCLENCHEUR — repris À L'IDENTIQUE, avec les quatre nouvelles colonnes
--
--     Tout ce que faisait la version précédente est conservé mot pour mot : la
--     réécrire en entier est le seul moyen d'être sûr qu'aucune dérivation
--     existante ne disparaît au passage.
-- =====================================================================================

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
  -- ── Nouveau : références & véhicules compatibles ───────────────────────────
  new.refs_text       := public.biz_product_refs_text(new.data);
  new.cars_text       := public.biz_product_cars_text(new.data);
  new.refs_count      := public.biz_jsonb_len(new.data, 'refs');
  new.cars_count      := public.biz_jsonb_len(new.data, 'cars');
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
--  4. LES INDEX DE RECHERCHE
--
--     Trigrammes : « 7701478 » retrouve « 7701 478 261 », « clio » retrouve
--     « Renault Clio 4 » — sans balayer toute la table.
-- =====================================================================================

--     Ces index sont une OPTIMISATION, jamais une condition de bon
--     fonctionnement : l'écran cherche dans le navigateur, sur le catalogue
--     déjà chargé. Si `pg_trgm` n'est pas disponible, le script le dit et
--     continue — rien de ce qui précède n'est perdu.

do $$
declare
  v_schema text;
begin
  -- Selon la base, pg_trgm est installée dans `public` ou dans `extensions` —
  -- et le `search_path` de la session ne couvre pas toujours la seconde. Plutôt
  -- que de le deviner, on DEMANDE au catalogue où vit la classe d'opérateurs et
  -- on la nomme explicitement.
  select n.nspname into v_schema
    from pg_opclass o
    join pg_namespace n on n.oid = o.opcnamespace
   where o.opcname = 'gin_trgm_ops'
   limit 1;

  if v_schema is null then
    raise notice 'pg_trgm absente — index trigrammes ignorés (la recherche se fait dans le navigateur, elle fonctionne quand même).';
    return;
  end if;

  execute format(
    'create index if not exists biz_products_refs_trgm_idx
       on public.biz_products using gin (refs_text %I.gin_trgm_ops)
       where refs_text is not null', v_schema);
  execute format(
    'create index if not exists biz_products_cars_trgm_idx
       on public.biz_products using gin (cars_text %I.gin_trgm_ops)
       where cars_text is not null', v_schema);

  raise notice 'Index trigrammes en place (pg_trgm dans le schéma %).', v_schema;
exception when others then
  raise notice 'Index trigrammes ignorés (%) — la recherche fonctionne quand même, elle se fait dans le navigateur.', sqlerrm;
end $$;

-- Les pièces encore non renseignées : c'est la liste de travail du magasinier.
-- Index ordinaire, celui-là ne dépend d'aucune extension.
create index if not exists biz_products_fitment_todo_idx
  on public.biz_products (module_key)
  where refs_count = 0 and cars_count = 0;

-- =====================================================================================
--  5. REPRISE DE L'EXISTANT
--
--     Les fiches déjà en base n'ont jamais été passées dans le nouveau
--     déclencheur : leurs quatre colonnes sont vides. Une écriture neutre
--     (`data = data`) le déclenche et les remplit. Aucune fiche n'est modifiée —
--     seule sa mise à plat est (re)calculée.
--
--     Seules les lignes RÉELLEMENT en retard sont touchées : relancer le script
--     n'écrit alors plus rien. Ce n'est pas de la coquetterie — chaque écriture
--     est publiée en temps réel à tous les postes connectés, et réécrire le
--     catalogue entier pour rien leur enverrait une rafale de notifications.
--
--     Note : `updated_at` est rafraîchi par le déclencheur, mais PAS `upd`, qui
--     reste celui de la fiche (`data->>'_upd'`). C'est lui qui départage deux
--     versions d'un produit entre deux postes : le toucher ici ferait croire à
--     tous les postes que leur catalogue est périmé.
-- =====================================================================================

do $$
declare
  v_count integer;
begin
  update public.biz_products
     set data = data
   where refs_text  is distinct from public.biz_product_refs_text(data)
      or cars_text  is distinct from public.biz_product_cars_text(data)
      or refs_count is distinct from public.biz_jsonb_len(data, 'refs')
      or cars_count is distinct from public.biz_jsonb_len(data, 'cars');
  get diagnostics v_count = row_count;
  raise notice 'Mise à plat recalculée sur % fiche(s) en retard.', v_count;
end $$;

-- =====================================================================================
--  VÉRIFICATIONS (facultatif — à exécuter à la main)
-- =====================================================================================
--  Combien de pièces sont renseignées, partie par partie :
--
--    select module_key,
--           count(*)                                        as produits,
--           count(*) filter (where refs_count > 0)           as avec_reference,
--           count(*) filter (where cars_count > 0)           as avec_vehicule,
--           count(*) filter (where refs_count = 0
--                              and cars_count = 0)           as a_renseigner
--      from public.biz_products
--     group by 1;
--
--  Chercher une pièce par sa référence, comme le fait l'écran :
--
--    select name, refs_text, cars_text, current_qty, sale_price
--      from public.biz_products
--     where refs_text ilike '%7701478261%'
--        or refs_text ilike '%7701 478 261%';
--
--  Chercher une pièce par le véhicule :
--
--    select name, refs_text, cars_text, current_qty
--      from public.biz_products
--     where cars_text ilike '%clio%'
--       and cars_text ilike '%2015%';
--
--  Les pièces du Lavage qu'il reste à renseigner :
--
--    select name, barcode, current_qty
--      from public.biz_products
--     where module_key = 'lavage' and refs_count = 0 and cars_count = 0
--     order by current_qty desc;
--
--  Terminé.
-- =====================================================================================
