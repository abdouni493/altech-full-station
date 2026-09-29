-- =====================================================================================
--  altech station — Migration « MATIÈRE PREMIÈRE »
--
--  HOW TO RUN
--    Supabase → SQL Editor → New query → coller CE fichier entier → Run.
--    Le script est IDEMPOTENT : il peut être relancé sans risque.
--
--  PRÉ-REQUIS (migrations déjà passées)
--      • module_workers_auth.sql   → public.biz_store (l'état partagé des parties)
--      • setup.sql                 → public.products  (catalogue station-service)
--
--  CE QUE FAIT CE SCRIPT
--    Un produit du catalogue peut désormais être déclaré MATIÈRE PREMIÈRE :
--    farine, café en grains, huile moteur… Il se suit en stock et s'achète comme
--    n'importe quel produit, mais il ne se vend JAMAIS tel quel : le point de
--    vente ne l'affiche plus.
--
--    1.  public.biz_store — le catalogue des parties (Cafétéria / Lavage) vit
--        dans un blob JSON, pas dans des colonnes : il n'y a donc rien à créer,
--        seulement les produits déjà enregistrés à normaliser. Chacun reçoit
--        « isRawMaterial: false » pour que le filtre du point de vente travaille
--        sur un champ toujours présent, sans dépendre de l'ordre des
--        enregistrements.
--    2.  public.products — colonne `is_raw_material boolean not null default
--        false`, pour que le catalogue relationnel de la station-service porte
--        la même information.
--    3.  Contrôle final : combien de produits sont marqués, de chaque côté.
--
--  LE MARQUAGE LUI-MÊME SE FAIT DANS L'APPLICATION
--    Gestion de stock → Nouveau produit (ou Modifier) → interrupteur
--    « Matière première ». Ce script prépare seulement le terrain.
--
--  ANNULATION : voir le bloc commenté en fin de fichier.
-- =====================================================================================

-- =====================================================================================
--  1. LE BLOB DES PARTIES — normalisation des produits existants
--
--     `biz_store.state` a cette forme :
--        { "cafeteria": { "products": [ {...}, {...} ], ... },
--          "lavage":    { "products": [ {...}, {...} ], ... } }
--
--     On réécrit UNIQUEMENT le tableau `products` de chaque partie. Les produits
--     qui portent déjà le champ gardent leur valeur : relancer le script ne
--     remet donc aucune matière première en vente.
-- =====================================================================================

do $$
declare
  store_id   text;
  cur_state  jsonb;
  part       text;
  new_prods  jsonb;
  rows_hit   int := 0;
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'biz_store'
  ) then
    raise notice 'public.biz_store absente — passez d''abord module_workers_auth.sql.';
    return;
  end if;

  for store_id in select id from public.biz_store loop
    -- L'état est repris en mémoire puis réécrit partie par partie : sans cela,
    -- la deuxième écriture repartirait de l'ancien état et effacerait la première.
    select state into cur_state from public.biz_store where id = store_id;

    foreach part in array array['cafeteria', 'lavage'] loop

      -- Rien à faire si la partie n'a pas (encore) de catalogue.
      continue when jsonb_typeof(cur_state -> part -> 'products') <> 'array';

      select coalesce(
        jsonb_agg(
          case
            when prod ? 'isRawMaterial' then prod
            else prod || jsonb_build_object('isRawMaterial', false)
          end
          order by ord
        ),
        '[]'::jsonb
      )
      into new_prods
      from jsonb_array_elements(cur_state -> part -> 'products')
           with ordinality as t(prod, ord);

      continue when new_prods is not distinct from (cur_state -> part -> 'products');

      cur_state := jsonb_set(cur_state, array[part, 'products'], new_prods);
      rows_hit  := rows_hit + 1;
    end loop;

    update public.biz_store
    set state = cur_state, updated_at = now()
    where id = store_id and state is distinct from cur_state;
  end loop;

  raise notice 'biz_store : % catalogue(s) de partie normalisé(s).', rows_hit;
end $$;

-- =====================================================================================
--  2. LE CATALOGUE RELATIONNEL — public.products
--
--     La station-service garde ses produits dans une vraie table : elle reçoit
--     la même information, pour que les deux catalogues parlent le même langage.
-- =====================================================================================

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'products'
  ) then
    alter table public.products
      add column if not exists is_raw_material boolean not null default false;

    comment on column public.products.is_raw_material is
      'Matière première : produit d''entrée de production, jamais proposé au point de vente.';
  else
    raise notice 'public.products absente — colonne non créée.';
  end if;
end $$;

-- =====================================================================================
--  3. CONTRÔLE — ce que la base contient après la migration
-- =====================================================================================

do $$
declare
  n_caf_total int := 0; n_caf_raw int := 0;
  n_lav_total int := 0; n_lav_raw int := 0;
  n_sql_raw   int := 0;
begin
  if exists (select 1 from information_schema.tables
             where table_schema = 'public' and table_name = 'biz_store') then

    select count(*), coalesce(count(*) filter (where (prod ->> 'isRawMaterial')::boolean), 0)
    into n_caf_total, n_caf_raw
    from public.biz_store b,
         jsonb_array_elements(
           case when jsonb_typeof(b.state -> 'cafeteria' -> 'products') = 'array'
                then b.state -> 'cafeteria' -> 'products' else '[]'::jsonb end) prod;

    select count(*), coalesce(count(*) filter (where (prod ->> 'isRawMaterial')::boolean), 0)
    into n_lav_total, n_lav_raw
    from public.biz_store b,
         jsonb_array_elements(
           case when jsonb_typeof(b.state -> 'lavage' -> 'products') = 'array'
                then b.state -> 'lavage' -> 'products' else '[]'::jsonb end) prod;
  end if;

  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'products'
               and column_name = 'is_raw_material') then
    select count(*) into n_sql_raw from public.products where is_raw_material;
  end if;

  raise notice '--------------------------------------------------------------';
  raise notice ' MATIÈRE PREMIÈRE — état après migration';
  raise notice '   Cafétéria       : % / % produit(s) marqué(s)', n_caf_raw, n_caf_total;
  raise notice '   Lavage          : % / % produit(s) marqué(s)', n_lav_raw, n_lav_total;
  raise notice '   public.products : % produit(s) marqué(s)',     n_sql_raw;
  raise notice '--------------------------------------------------------------';
  raise notice ' Marquage dans l''application :';
  raise notice '   Gestion de stock → Nouveau produit / Modifier → « Matière première »';
  raise notice '   Un produit marqué disparaît aussitôt du Point de vente.';
  raise notice '--------------------------------------------------------------';
end $$;

-- =====================================================================================
--  ANNULATION — à exécuter UNIQUEMENT pour revenir en arrière
--
--    alter table public.products drop column if exists is_raw_material;
--
--    do $$
--    declare store_id text; cur_state jsonb; part text; new_prods jsonb;
--    begin
--      for store_id in select id from public.biz_store loop
--        select state into cur_state from public.biz_store where id = store_id;
--        foreach part in array array['cafeteria','lavage'] loop
--          continue when jsonb_typeof(cur_state -> part -> 'products') <> 'array';
--          select coalesce(jsonb_agg(prod - 'isRawMaterial' order by ord), '[]'::jsonb)
--          into new_prods
--          from jsonb_array_elements(cur_state -> part -> 'products')
--               with ordinality as t(prod, ord);
--          cur_state := jsonb_set(cur_state, array[part,'products'], new_prods);
--        end loop;
--        update public.biz_store set state = cur_state, updated_at = now() where id = store_id;
--      end loop;
--    end $$;
-- =====================================================================================
