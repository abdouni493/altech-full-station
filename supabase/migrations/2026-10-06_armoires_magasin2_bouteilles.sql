-- =====================================================================================
--  MIGRATION 2026-10-06 — Armoires, transferts, bouteilles de gaz & second magasin
--
--  À exécuter UNE FOIS sur une base EXISTANTE : Supabase → SQL Editor → New query →
--  coller tout ce fichier → Run. Le script est IDEMPOTENT : le relancer ne casse rien.
--  (Une NOUVELLE base n'en a pas besoin : supabase/full_schema.sql contient déjà tout.)
--
--  CE QU'IL AJOUTE
--    1. Second magasin (Paramètres → Magasins)
--         • station_settings : noms des deux magasins + second magasin actif ;
--         • la clé de partie 'magasin2' autorisée partout (employés, sessions de
--           caisse, catalogue, dépenses, retours clients) ;
--         • sa caisse « CAISSE_MAGASIN2 » (Caisse Générale) ;
--         • comptes des employés du second magasin (provision_module_worker_account).
--    2. Armoires de la piste + transferts Magasin → Armoire
--         armoires, armoire_stock, stock_transfers, stock_transfer_items,
--         armoire_sales, armoire_purchases + RPC adjust_armoire_stock().
--    3. Brigades : ventes / achats de produits en armoire et photo du stock
--         (brigades.armoire_sales / armoire_product_purchases / armoire_stock_snapshot)
--         + justificatif « ACHAT_PRODUIT » (brigade_accounting_justifications).
--    4. Bouteilles de gaz (vide / plein) : armoire_stock.empty_quantity,
--         stock_transfer_items.consigne_state, armoire_sales.consigne,
--         armoire_purchases.consigne_mode, justificatif consigne_mode.
--         (Côté magasin, l'option et les compteurs vivent dans la fiche produit
--         — biz_products.data — et ne demandent aucune colonne.)
--    5. RLS (mêmes règles que le reste de l'application), droits, temps réel.
-- =====================================================================================

begin;

-- =====================================================================================
--  1. SECOND MAGASIN
-- =====================================================================================

-- 1a. Noms des magasins + second magasin actif --------------------------------------
alter table public.station_settings add column if not exists magasin1_name    text;
alter table public.station_settings add column if not exists magasin2_name    text;
alter table public.station_settings add column if not exists magasin2_enabled boolean not null default false;

-- 1b. La clé 'magasin2' autorisée partout où une partie est nommée ------------------
--     Les anciennes contraintes CHECK (nommées automatiquement) sont retirées, quel
--     que soit leur nom, puis recréées avec la nouvelle liste.
do $$
declare
  r record;
begin
  for r in
    select c.conrelid::regclass::text as tbl, c.conname
      from pg_constraint c
     where c.contype = 'c'
       and c.conrelid in ('public.module_workers'::regclass, 'public.biz_sessions'::regclass,
                          'public.biz_products'::regclass)
       and pg_get_constraintdef(c.oid) ilike '%module_key%'
  loop
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
  end loop;

  for r in
    select c.conrelid::regclass::text as tbl, c.conname
      from pg_constraint c
     where c.contype = 'c'
       and c.conrelid in ('public.client_feedbacks'::regclass, 'public.expenses'::regclass)
       and pg_get_constraintdef(c.oid) ilike '%part%'
       and pg_get_constraintdef(c.oid) ilike '%lavage%'
  loop
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
  end loop;
end $$;

alter table public.module_workers add constraint module_workers_module_key_check
  check (module_key in ('restaurant','cafeteria','lavage','magasin2'));
alter table public.biz_sessions add constraint biz_sessions_module_key_check
  check (module_key in ('restaurant','cafeteria','lavage','magasin2'));
alter table public.biz_products add constraint biz_products_module_key_check
  check (module_key in ('restaurant','cafeteria','lavage','magasin2'));
alter table public.client_feedbacks add constraint client_feedbacks_part_check
  check (part in ('fuel','restaurant','cafeteria','lavage','magasin2'));
alter table public.expenses add constraint expenses_part_check
  check (part is null or part in ('carburant','restaurant','cafeteria','lavage','magasin2','systeme'));

-- 1c. Caisse du second magasin -------------------------------------------------------
insert into public.cash_accounts (id, name, part, sort_order) values
  ('CAISSE_MAGASIN2', 'Caisse Magasin 2', 'magasin2', 6)
on conflict (id) do update set name = excluded.name, part = excluded.part, sort_order = excluded.sort_order;

-- 1d. Comptes des employés : le second magasin est une partie comme les autres -------
create or replace function public.provision_module_worker_account(
  p_action      text,
  p_module_key  text,
  p_worker_id   text,
  p_username    text  default null,
  p_password    text  default null,
  p_name        text  default null,
  p_email       text  default null,
  p_role_name   text  default null,
  p_phone       text  default null,
  p_permissions jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql security definer set search_path = public, auth, extensions as $$
declare
  v_uid      uuid;
  v_email    text;
  v_username text := lower(btrim(coalesce(p_username, '')));
begin
  if p_module_key not in ('restaurant', 'cafeteria', 'lavage', 'magasin2') then
    return jsonb_build_object('ok', false, 'error', 'Partie inconnue : ' || coalesce(p_module_key, '?'));
  end if;
  if not public.can_manage_module(p_module_key) then
    return jsonb_build_object('ok', false, 'error', 'Permission refusée.');
  end if;

  select auth_user_id into v_uid from public.module_workers where id = p_worker_id;

  if p_action = 'delete' then
    delete from public.module_workers where id = p_worker_id;
    if v_uid is not null then perform public._delete_auth_user(v_uid); end if;
    return jsonb_build_object('ok', true);
  end if;

  if p_action not in ('create', 'update_password') then
    return jsonb_build_object('ok', false, 'error', 'Action inconnue : ' || coalesce(p_action, '?'));
  end if;
  if v_username = '' then
    return jsonb_build_object('ok', false, 'error', 'Nom d''utilisateur requis.');
  end if;

  insert into public.module_workers (id, module_key, name, role_name, phone, email, username,
                                     has_account, permissions, updated_at)
  values (p_worker_id, p_module_key, coalesce(p_name, 'Employé'), p_role_name, p_phone,
          nullif(btrim(p_email), ''), v_username, true, coalesce(p_permissions, '{}'::jsonb), now())
  on conflict (id) do update set
    module_key  = excluded.module_key,
    name        = excluded.name,
    role_name   = excluded.role_name,
    phone       = excluded.phone,
    email       = excluded.email,
    username    = excluded.username,
    has_account = true,
    permissions = case when excluded.permissions = '{}'::jsonb
                       then public.module_workers.permissions else excluded.permissions end,
    updated_at  = now();

  if v_uid is not null and exists (select 1 from auth.users where id = v_uid) then
    perform public._update_auth_user(v_uid, p_password, v_username);
    return jsonb_build_object('ok', true, 'auth_user_id', v_uid::text);
  end if;

  v_email := lower(coalesce(nullif(btrim(p_email), ''), v_username || '@station.local'));
  v_uid := public._create_auth_user(
    v_email, p_password,
    jsonb_build_object('name', p_name, 'username', v_username,
                       'role', 'module_worker', 'module_key', p_module_key, 'worker_id', p_worker_id));
  update public.module_workers set auth_user_id = v_uid, updated_at = now() where id = p_worker_id;
  return jsonb_build_object('ok', true, 'auth_user_id', v_uid::text);
exception when others then
  return jsonb_build_object('ok', false, 'error', sqlerrm);
end;
$$;

-- 1e. Page publique /client : elle propose aussi le second magasin ------------------
create or replace function public.public_station_identity()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(
    (select jsonb_build_object(
              'name', s.name, 'logo_url', s.logo_url, 'address', s.address,
              'magasin1_name', s.magasin1_name, 'magasin2_name', s.magasin2_name,
              'magasin2_enabled', coalesce(s.magasin2_enabled, false))
       from public.station_settings s order by s.created_at limit 1),
    '{}'::jsonb);
$$;


-- =====================================================================================
--  2. ARMOIRES DE LA PISTE + TRANSFERTS MAGASIN → ARMOIRE
-- =====================================================================================

-- 2a. Armoires : rattachées aux pompes qu'elles desservent (et à une piste, au besoin)
create table if not exists public.armoires (
  id          text primary key default gen_random_uuid()::text,
  name        text not null,
  track_id    text references public.tracks(id) on delete set null,
  pump_ids    jsonb not null default '[]'::jsonb,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- 2b. Stock courant d'une armoire : une ligne par (armoire, produit) ------------------
--     product_id = id de la fiche dans biz_products (premier OU second magasin).
--     quantity       = nombre TOTAL d'unités (pleines + vides) — peut être NÉGATIF
--                      (vente autorisée en stock négatif) ;
--     empty_quantity = bouteilles VIDES parmi elles (produit consigné).
create table if not exists public.armoire_stock (
  id              text primary key default gen_random_uuid()::text,
  armoire_id      text not null references public.armoires(id) on delete cascade,
  product_id      text not null,
  module_key      text,
  quantity        numeric not null default 0,
  empty_quantity  numeric not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (armoire_id, product_id)
);
alter table public.armoire_stock add column if not exists empty_quantity numeric not null default 0;
alter table public.armoire_stock add column if not exists module_key text;

-- 2c. Transferts : en-tête (depuis quel magasin, vers quelle armoire) ----------------
create table if not exists public.stock_transfers (
  id          text primary key default gen_random_uuid()::text,
  armoire_id  text references public.armoires(id) on delete cascade,
  module_key  text not null default 'lavage',
  date        timestamptz not null default now(),
  source      text not null default 'transferts',
  notes       text,
  created_by  text,
  total_qty   numeric not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table public.stock_transfers drop constraint if exists stock_transfers_module_key_check;
alter table public.stock_transfers add constraint stock_transfers_module_key_check
  check (module_key in ('lavage','magasin2'));
alter table public.stock_transfers drop constraint if exists stock_transfers_source_check;
alter table public.stock_transfers add constraint stock_transfers_source_check
  check (source in ('produits','transferts'));

-- 2d. Transferts : lignes produits (pleines ou vides pour une bouteille) -------------
create table if not exists public.stock_transfer_items (
  id              text primary key default gen_random_uuid()::text,
  transfer_id     text not null references public.stock_transfers(id) on delete cascade,
  product_id      text,
  product_name    text,
  barcode         text,
  quantity        numeric not null default 0,
  consigne_state  text,
  created_at      timestamptz not null default now()
);
alter table public.stock_transfer_items drop constraint if exists stock_transfer_items_consigne_state_check;
alter table public.stock_transfer_items add constraint stock_transfer_items_consigne_state_check
  check (consigne_state is null or consigne_state in ('VIDE','PLEIN'));

-- 2e. Ventes de produits depuis une armoire (pendant une brigade) -------------------
--     consigne = true : la bouteille vendue RESTE dans l'armoire et devient VIDE.
create table if not exists public.armoire_sales (
  id            text primary key default gen_random_uuid()::text,
  armoire_id    text references public.armoires(id)  on delete set null,
  brigade_id    text references public.brigades(id)  on delete cascade,
  pompiste_id   text references public.pompistes(id) on delete set null,
  product_id    text,
  product_name  text,
  module_key    text,
  quantity      numeric not null default 0,
  price         numeric not null default 0,
  total         numeric not null default 0,
  consigne      boolean not null default false,
  date          timestamptz not null default now(),
  created_at    timestamptz not null default now()
);

-- 2f. Achats de produits réglés sur la caisse de la brigade et rangés en armoire ----
--     consigne_mode : 'REMPLISSAGE' (vides → pleines) | 'VIDE' (bouteilles vides en plus).
create table if not exists public.armoire_purchases (
  id             text primary key default gen_random_uuid()::text,
  armoire_id     text references public.armoires(id)  on delete set null,
  brigade_id     text references public.brigades(id)  on delete cascade,
  pompiste_id    text references public.pompistes(id) on delete set null,
  product_id     text,
  product_name   text,
  module_key     text,
  quantity       numeric not null default 0,
  unit_price     numeric not null default 0,
  total          numeric not null default 0,
  supplier_name  text,
  consigne_mode  text,
  date           timestamptz not null default now(),
  created_at     timestamptz not null default now()
);
alter table public.armoire_purchases drop constraint if exists armoire_purchases_consigne_mode_check;
alter table public.armoire_purchases add constraint armoire_purchases_consigne_mode_check
  check (consigne_mode is null or consigne_mode in ('VIDE','REMPLISSAGE'));

-- 2g. Index ----------------------------------------------------------------------------
create index if not exists idx_armoire_stock_armoire      on public.armoire_stock (armoire_id);
create index if not exists idx_armoire_stock_product      on public.armoire_stock (product_id);
create index if not exists idx_stock_transfers_armoire    on public.stock_transfers (armoire_id);
create index if not exists idx_stock_transfers_date       on public.stock_transfers (date desc);
create index if not exists idx_stock_transfer_items_tr    on public.stock_transfer_items (transfer_id);
create index if not exists idx_armoire_sales_brigade      on public.armoire_sales (brigade_id);
create index if not exists idx_armoire_sales_armoire      on public.armoire_sales (armoire_id);
create index if not exists idx_armoire_purchases_brigade  on public.armoire_purchases (brigade_id);
create index if not exists idx_armoire_purchases_armoire  on public.armoire_purchases (armoire_id);

-- 2h. Horodatage de mise à jour --------------------------------------------------------
create or replace function public.armoires_touch_updated()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
do $$
declare t text;
begin
  foreach t in array array['armoires','armoire_stock','stock_transfers'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_touch_updated', t);
    execute format('create trigger %I before update on public.%I
                    for each row execute function public.armoires_touch_updated()', t || '_touch_updated', t);
  end loop;
end $$;

-- 2i. RPC : ajustement ATOMIQUE du stock d'une armoire ---------------------------------
--     p_delta       = variation du nombre TOTAL d'unités ;
--     p_empty_delta = variation des bouteilles VIDES.
--     Vente d'une bouteille : (0, +n). Remplissage : (0, −n). Bouteilles vides : (+n, +n).
--     Aucun écrêtage : la vente en stock négatif est autorisée.
drop function if exists public.adjust_armoire_stock(uuid, uuid, numeric);
drop function if exists public.adjust_armoire_stock(uuid, uuid, numeric, numeric);
drop function if exists public.adjust_armoire_stock(text, text, numeric);
drop function if exists public.adjust_armoire_stock(text, text, numeric, numeric);
drop function if exists public.adjust_armoire_stock(text, text, numeric, numeric, text);
create function public.adjust_armoire_stock(
  p_armoire_id text, p_product_id text, p_delta numeric,
  p_empty_delta numeric default 0, p_module_key text default null
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'Non autorisé'; end if;
  if p_armoire_id is null or p_product_id is null then return; end if;
  insert into public.armoire_stock (armoire_id, product_id, module_key, quantity, empty_quantity)
  values (p_armoire_id, p_product_id, p_module_key, coalesce(p_delta, 0), coalesce(p_empty_delta, 0))
  on conflict (armoire_id, product_id)
  do update set quantity       = public.armoire_stock.quantity       + excluded.quantity,
                empty_quantity = public.armoire_stock.empty_quantity + excluded.empty_quantity,
                module_key     = coalesce(public.armoire_stock.module_key, excluded.module_key),
                updated_at     = now();
end;
$$;


-- =====================================================================================
--  3. BRIGADES : produits vendus / achetés en armoire + justificatif ACHAT_PRODUIT
-- =====================================================================================
alter table public.brigades add column if not exists armoire_sales             jsonb not null default '[]'::jsonb;
alter table public.brigades add column if not exists armoire_product_purchases jsonb not null default '[]'::jsonb;
alter table public.brigades add column if not exists armoire_stock_snapshot    jsonb not null default '[]'::jsonb;

-- Justificatif « ACHAT_PRODUIT » : produit, magasin d'origine, armoire, quantité,
-- prix d'achat, fournisseur et — pour une bouteille — remplissage / bouteilles vides.
alter table public.brigade_accounting_justifications add column if not exists product_id    text;
alter table public.brigade_accounting_justifications add column if not exists product_name  text;
alter table public.brigade_accounting_justifications add column if not exists module_key    text;
alter table public.brigade_accounting_justifications add column if not exists armoire_id    text;
alter table public.brigade_accounting_justifications add column if not exists quantity      numeric not null default 0;
alter table public.brigade_accounting_justifications add column if not exists unit_price    numeric not null default 0;
alter table public.brigade_accounting_justifications add column if not exists supplier_name text;
alter table public.brigade_accounting_justifications add column if not exists consigne_mode text;
alter table public.brigade_accounting_justifications drop constraint if exists brigade_accounting_justifications_consigne_mode_check;
alter table public.brigade_accounting_justifications add constraint brigade_accounting_justifications_consigne_mode_check
  check (consigne_mode is null or consigne_mode in ('VIDE','REMPLISSAGE'));
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'fk_justif_armoire') then
    alter table public.brigade_accounting_justifications
      add constraint fk_justif_armoire foreign key (armoire_id)
      references public.armoires(id) on delete set null not valid;
  end if;
end $$;
create index if not exists idx_justif_product on public.brigade_accounting_justifications (product_id);


-- =====================================================================================
--  4. SÉCURITÉ (RLS) — mêmes règles que les autres tables métier
--     Lecture / écriture : tout compte de la station. Suppression d'une armoire ou
--     d'un transfert : permission « supprimer » sur l'écran correspondant.
-- =====================================================================================
insert into public.permission_table_map (table_name, module_id) values
  ('armoires',        'Armoires'),
  ('stock_transfers', 'Transferts')
on conflict (table_name) do update set module_id = excluded.module_id;

do $$
declare
  t text;
  p record;
begin
  foreach t in array array['armoires','armoire_stock','stock_transfers','stock_transfer_items',
                           'armoire_sales','armoire_purchases'] loop
    execute format('alter table public.%I enable row level security', t);
    for p in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy if exists %I on public.%I', p.policyname, t);
    end loop;
    execute format('create policy staff_select on public.%I for select to authenticated using ((select public.is_staff()))', t);
    execute format('create policy staff_insert on public.%I for insert to authenticated with check ((select public.is_staff()))', t);
    execute format('create policy staff_update on public.%I for update to authenticated using ((select public.is_staff())) with check ((select public.is_staff()))', t);
    execute format('create policy perm_delete  on public.%I for delete to authenticated using ((select public.can_delete_from(%L)))', t, t);
  end loop;
end $$;

grant select, insert, update, delete on all tables in schema public to authenticated;
revoke execute on function public.adjust_armoire_stock(text, text, numeric, numeric, text) from public, anon;
grant  execute on function public.adjust_armoire_stock(text, text, numeric, numeric, text) to authenticated;
grant  execute on function public.provision_module_worker_account(text, text, text, text, text, text, text, text, text, jsonb) to authenticated;
grant  execute on function public.public_station_identity() to anon, authenticated;


-- =====================================================================================
--  5. TEMPS RÉEL — les autres postes voient les armoires bouger en direct
-- =====================================================================================
do $$
declare t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  foreach t in array array['armoires','armoire_stock','stock_transfers','stock_transfer_items',
                           'armoire_sales','armoire_purchases'] loop
    if not exists (select 1 from pg_publication_tables
                    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      begin
        execute format('alter publication supabase_realtime add table public.%I', t);
      exception when others then null;
      end;
    end if;
  end loop;
end $$;

commit;

-- PostgREST relit le schéma : l'API voit immédiatement les nouvelles tables et colonnes.
notify pgrst, 'reload schema';
