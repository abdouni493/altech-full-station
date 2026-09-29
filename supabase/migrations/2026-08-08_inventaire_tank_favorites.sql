-- =====================================================================================
--  altech station — Migration « INVENTAIRE & CUVES FAVORITES »
--
--  HOW TO RUN
--    Supabase → SQL Editor → New query → coller CE fichier entier → Run.
--    Le script est IDEMPOTENT : il peut être relancé sans risque.
--
--  PRÉ-REQUIS (migrations déjà passées)
--      • setup.sql                 → public.tanks (les cuves de la station)
--      • module_workers_auth.sql   → public.biz_store (l'état partagé des parties)
--      • 2026-08-06_biz_store_revision_merge.sql
--
--  CE QUE FAIT CE SCRIPT
--
--    1.  CUVES FAVORITES — public.tanks reçoit `is_favorite boolean not null
--        default false`. Une cuve épinglée remonte en TÊTE de l'écran Cuves et
--        du tableau de bord. C'est la SEULE vraie colonne créée par cette mise à
--        jour : tout le reste des nouveautés vit dans le blob JSON des parties.
--
--    2.  INVENTAIRES — chaque partie (Cafétéria / Lavage) reçoit sa collection
--        `inventaires`, vide. Les inventaires, leurs comptages, leurs écarts,
--        leur sauvegarde de correction et leur imputation aux employés vivent
--        tous DANS le blob `biz_store.state` : aucune table à créer, aucune RLS
--        à écrire. La collection est créée ici pour qu'elle existe TOUJOURS, y
--        compris sur un poste qui n'a pas encore ouvert l'écran Inventaire —
--        sans quoi la fusion entre deux postes repartirait d'un tableau absent.
--
--    3.  EMPLOYÉS CONCERNÉS PAR L'INVENTAIRE — chaque employé des parties reçoit
--        `inventoryLiable: false`. L'écran de paie n'oppose les manquants qu'aux
--        employés dont ce drapeau est activé, produit par produit ; le mettre à
--        false partout garantit que personne ne se voit imputer quoi que ce soit
--        tant que le gérant ne l'a pas décidé explicitement.
--
--    4.  Contrôle final : ce que la base contient après la migration.
--
--  LE RESTE SE PARAMÈTRE DANS L'APPLICATION
--      • Cuves → l'étoile sur une carte de cuve l'épingle en tête.
--      • Cafétéria / Lavage → Inventaire → « Nouvel inventaire ».
--      • Cafétéria / Lavage → Employés → « Concerné par les inventaires ».
--
--  ANNULATION : voir le bloc commenté en fin de fichier.
-- =====================================================================================

-- =====================================================================================
--  1. CUVES FAVORITES — public.tanks.is_favorite
-- =====================================================================================

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'tanks'
  ) then
    alter table public.tanks
      add column if not exists is_favorite boolean not null default false;

    comment on column public.tanks.is_favorite is
      'Cuve épinglée : affichée en premier sur l''écran Cuves et sur le tableau de bord.';
  else
    raise notice 'public.tanks absente — colonne is_favorite non créée. Passez d''abord setup.sql.';
  end if;
end $$;

-- =====================================================================================
--  2. LES INVENTAIRES — collection `inventaires` de chaque partie
--
--     `biz_store.state` a cette forme :
--        { "cafeteria": { "products": [...], "workers": [...], ... },
--          "lavage":    { "products": [...], "workers": [...], ... } }
--
--     On y ajoute `"inventaires": []` quand la clé n'existe pas encore. Une
--     partie qui en possède déjà garde les siens : relancer le script n'efface
--     donc AUCUN comptage.
-- =====================================================================================

do $$
declare
  store_id   text;
  cur_state  jsonb;
  part       text;
  parts_hit  int := 0;
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
    continue when cur_state is null;

    foreach part in array array['cafeteria', 'lavage'] loop
      continue when jsonb_typeof(cur_state -> part) <> 'object';
      continue when jsonb_typeof(cur_state -> part -> 'inventaires') = 'array';

      cur_state := jsonb_set(cur_state, array[part, 'inventaires'], '[]'::jsonb, true);
      parts_hit := parts_hit + 1;
    end loop;

    update public.biz_store
    set state = cur_state, updated_at = now()
    where id = store_id and state is distinct from cur_state;
  end loop;

  raise notice 'biz_store : collection « inventaires » créée sur % partie(s).', parts_hit;
end $$;

-- =====================================================================================
--  3. EMPLOYÉS — drapeau `inventoryLiable`
--
--     Un employé « concerné par les inventaires » répond des manquants constatés
--     au comptage : son écran de paie les lui oppose, et le gérant décide ensuite
--     s'il en retient une part (pourcentage) ou une somme fixe sur son salaire.
--     Tous les employés existants partent à `false` — personne ne devient
--     redevable de quoi que ce soit à cause de cette migration.
-- =====================================================================================

do $$
declare
  store_id     text;
  cur_state    jsonb;
  part         text;
  new_workers  jsonb;
  parts_hit    int := 0;
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'biz_store'
  ) then
    return;
  end if;

  for store_id in select id from public.biz_store loop
    select state into cur_state from public.biz_store where id = store_id;
    continue when cur_state is null;

    foreach part in array array['cafeteria', 'lavage'] loop
      continue when jsonb_typeof(cur_state -> part -> 'workers') <> 'array';

      select coalesce(
        jsonb_agg(
          case
            when wrk ? 'inventoryLiable' then wrk
            else wrk || jsonb_build_object('inventoryLiable', false)
          end
          order by ord
        ),
        '[]'::jsonb
      )
      into new_workers
      from jsonb_array_elements(cur_state -> part -> 'workers')
           with ordinality as t(wrk, ord);

      continue when new_workers is not distinct from (cur_state -> part -> 'workers');

      cur_state := jsonb_set(cur_state, array[part, 'workers'], new_workers);
      parts_hit := parts_hit + 1;
    end loop;

    update public.biz_store
    set state = cur_state, updated_at = now()
    where id = store_id and state is distinct from cur_state;
  end loop;

  raise notice 'biz_store : employés normalisés sur % partie(s).', parts_hit;
end $$;

-- =====================================================================================
--  4. CONTRÔLE — ce que la base contient après la migration
-- =====================================================================================

do $$
declare
  n_tanks      int := 0;
  n_fav        int := 0;
  n_caf_inv    int := 0;
  n_lav_inv    int := 0;
  n_caf_wrk    int := 0;
  n_lav_wrk    int := 0;
  n_liable     int := 0;
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'tanks'
               and column_name = 'is_favorite') then
    select count(*), count(*) filter (where is_favorite) into n_tanks, n_fav from public.tanks;
  end if;

  if exists (select 1 from information_schema.tables
             where table_schema = 'public' and table_name = 'biz_store') then

    select count(*) into n_caf_inv
    from public.biz_store b,
         jsonb_array_elements(
           case when jsonb_typeof(b.state -> 'cafeteria' -> 'inventaires') = 'array'
                then b.state -> 'cafeteria' -> 'inventaires' else '[]'::jsonb end) inv;

    select count(*) into n_lav_inv
    from public.biz_store b,
         jsonb_array_elements(
           case when jsonb_typeof(b.state -> 'lavage' -> 'inventaires') = 'array'
                then b.state -> 'lavage' -> 'inventaires' else '[]'::jsonb end) inv;

    select count(*), coalesce(count(*) filter (where (wrk ->> 'inventoryLiable')::boolean), 0)
    into n_caf_wrk, n_liable
    from public.biz_store b,
         jsonb_array_elements(
           case when jsonb_typeof(b.state -> 'cafeteria' -> 'workers') = 'array'
                then b.state -> 'cafeteria' -> 'workers' else '[]'::jsonb end) wrk;

    select count(*) into n_lav_wrk
    from public.biz_store b,
         jsonb_array_elements(
           case when jsonb_typeof(b.state -> 'lavage' -> 'workers') = 'array'
                then b.state -> 'lavage' -> 'workers' else '[]'::jsonb end) wrk;
  end if;

  raise notice '--------------------------------------------------------------';
  raise notice ' INVENTAIRE & CUVES FAVORITES — état après migration';
  raise notice '   Cuves           : % au total, % en favori', n_tanks, n_fav;
  raise notice '   Inventaires     : % (cafétéria) · % (lavage)', n_caf_inv, n_lav_inv;
  raise notice '   Employés        : % (cafétéria) · % (lavage)', n_caf_wrk, n_lav_wrk;
  raise notice '   Concernés par l''inventaire : %', n_liable;
  raise notice '--------------------------------------------------------------';
  raise notice ' Dans l''application :';
  raise notice '   Cuves → l''étoile épingle une cuve, elle passe en premier.';
  raise notice '   Cafétéria / Lavage → Inventaire → « Nouvel inventaire ».';
  raise notice '   Cafétéria / Lavage → Employés → « Concerné par les inventaires ».';
  raise notice '   Rapports Généraux → Inventaires (écarts) et carte « Pertes d''inventaire ».';
  raise notice '--------------------------------------------------------------';
end $$;

-- =====================================================================================
--  ANNULATION — à exécuter UNIQUEMENT pour revenir en arrière
--
--    -- 1. Cuves favorites
--    alter table public.tanks drop column if exists is_favorite;
--
--    -- 2. Inventaires + drapeau employé (ATTENTION : supprime les comptages)
--    do $$
--    declare store_id text; cur_state jsonb; part text; new_workers jsonb;
--    begin
--      for store_id in select id from public.biz_store loop
--        select state into cur_state from public.biz_store where id = store_id;
--        foreach part in array array['cafeteria','lavage'] loop
--          continue when jsonb_typeof(cur_state -> part) <> 'object';
--          cur_state := jsonb_set(cur_state, array[part],
--                                 (cur_state -> part) - 'inventaires');
--          continue when jsonb_typeof(cur_state -> part -> 'workers') <> 'array';
--          select coalesce(jsonb_agg(
--                   (wrk - 'inventoryLiable' - 'dismissedInventaireIds' - 'savedInventaireIds')
--                   order by ord), '[]'::jsonb)
--          into new_workers
--          from jsonb_array_elements(cur_state -> part -> 'workers')
--               with ordinality as t(wrk, ord);
--          cur_state := jsonb_set(cur_state, array[part,'workers'], new_workers);
--        end loop;
--        update public.biz_store set state = cur_state, updated_at = now() where id = store_id;
--      end loop;
--    end $$;
-- =====================================================================================
