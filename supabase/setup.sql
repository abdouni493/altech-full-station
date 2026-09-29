-- =====================================================================================
--  StationPro — Supabase full setup
--  Project: <your-project-ref>
--
--  HOW TO RUN
--  1. Open your project → SQL Editor → New query.
--  2. Paste this ENTIRE file and press "Run".
--  3. (Auth) Dashboard → Authentication → Providers → Email: turn OFF
--     "Confirm email" (the app already creates confirmed users, but turning it
--     off avoids any friction when signing up from the UI).
--
--  WHAT THIS CREATES
--   • All application tables (fuel station data model)
--   • Row Level Security so only logged-in users touch data
--   • RPC functions the app calls:
--       admin_exists, create_admin_account, email_for_username,
--       get_my_role, get_my_worker, provision_worker_account, adjust_tank_level
--   • 8 public storage buckets for every image upload in the app
--   • Realtime enabled for live updates
--
--  Primary keys are TEXT (the app generates UUID strings client-side, but a few
--  ids such as the settings row are not UUIDs). Auth-linked ids are real uuid.
-- =====================================================================================

-- ── Extensions ───────────────────────────────────────────────────────────────────
create extension if not exists pgcrypto with schema extensions;

-- =====================================================================================
--  TABLES
-- =====================================================================================

-- Station settings (single row) --------------------------------------------------------
create table if not exists public.station_settings (
  id                      text primary key default gen_random_uuid()::text,
  name                    text,
  logo_url                text,
  address                 text,
  phone                   text,
  email                   text,
  fiscal_id               text,
  rc                      text,
  fuel_prices             jsonb  default '{}'::jsonb,
  fuel_buy_prices         jsonb  default '{}'::jsonb,
  conversion_tables       jsonb  default '{}'::jsonb,
  product_categories      jsonb  default '[]'::jsonb,
  expense_categories      jsonb  default '[]'::jsonb,
  product_units           jsonb  default '[]'::jsonb,
  decalage_positif_actif  boolean default true,
  decalage_negatif_actif  boolean default true,
  decalage_positif_seuil  numeric default 0,
  decalage_negatif_seuil  numeric default 0,
  created_at              timestamptz default now()
);

-- Admin profiles (linked to auth.users) ------------------------------------------------
create table if not exists public.admin_profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  name        text,
  username    text unique,
  email       text,
  role        text default 'admin',
  avatar_url  text,
  created_at  timestamptz default now()
);

-- Tracks (pistes) ----------------------------------------------------------------------
create table if not exists public.tracks (
  id          text primary key default gen_random_uuid()::text,
  name        text,
  created_at  timestamptz default now()
);

-- Tanks (cuves) ------------------------------------------------------------------------
create table if not exists public.tanks (
  id               text primary key default gen_random_uuid()::text,
  name             text,
  type             text,
  capacity         numeric default 0,
  current          numeric default 0,
  degrees          numeric default 0,
  alert_threshold  numeric default 0,
  notes            text,
  created_at       timestamptz default now()
);

-- Pumps + nozzles ----------------------------------------------------------------------
create table if not exists public.pumps (
  id                           text primary key default gen_random_uuid()::text,
  number                       text,
  name                         text,
  tank_id                      text,
  track_id                     text,
  type                         text,
  last_index                   numeric default 0,
  status                       text,
  current_brigade_start_index  numeric,
  created_at                   timestamptz default now()
);

create table if not exists public.pump_nozzles (
  id           text primary key default gen_random_uuid()::text,
  pump_id      text,
  name         text,
  last_index   numeric default 0,
  start_index  numeric default 0,
  status       text,
  created_at   timestamptz default now()
);

-- Drivers ------------------------------------------------------------------------------
create table if not exists public.drivers (
  id          text primary key default gen_random_uuid()::text,
  name        text,
  status      text,
  phone       text,
  email       text,
  address     text,
  created_at  timestamptz default now()
);

-- Product brands + products ------------------------------------------------------------
create table if not exists public.product_brands (
  id    text primary key default gen_random_uuid()::text,
  name  text
);

create table if not exists public.products (
  id                  text primary key default gen_random_uuid()::text,
  ref                 text,
  name                text,
  category            text,
  buy_price           numeric default 0,
  selling_price       numeric default 0,
  stock               numeric default 0,
  min_stock           numeric default 0,
  barcode             text,
  image_url           text,
  unit                text,
  brand               text,
  brand_id            text,
  last_selling_price  numeric,
  tva_rate            numeric default 0,
  sell_by_details     boolean default false,
  detail_capacity     numeric,
  detail_unit         text,
  created_at          timestamptz default now()
);

-- Workers: pompistes / chefs / gerants / magasin ---------------------------------------
create table if not exists public.pompistes (
  id            text primary key default gen_random_uuid()::text,
  name          text,
  phone         text,
  email         text,
  cin           text,
  address       text,
  photo_url     text,
  status        text,
  track_id      text,
  chef_id       text,
  base_salary   numeric default 0,
  has_access    boolean default false,
  username      text,
  auth_user_id  uuid references auth.users(id) on delete set null,
  permissions   jsonb default '{}'::jsonb,
  hire_date     text,
  created_at    timestamptz default now()
);

create table if not exists public.brigade_chefs (
  id            text primary key default gen_random_uuid()::text,
  name          text,
  phone         text,
  email         text,
  cin           text,
  address       text,
  photo_url     text,
  status        text,
  base_salary   numeric default 0,
  has_access    boolean default false,
  username      text,
  auth_user_id  uuid references auth.users(id) on delete set null,
  permissions   jsonb default '{}'::jsonb,
  hire_date     text,
  created_at    timestamptz default now()
);

create table if not exists public.gerants (
  id            text primary key default gen_random_uuid()::text,
  name          text,
  phone         text,
  email         text,
  cin           text,
  address       text,
  photo_url     text,
  status        text,
  base_salary   numeric default 0,
  has_access    boolean default false,
  username      text,
  auth_user_id  uuid references auth.users(id) on delete set null,
  permissions   jsonb default '{}'::jsonb,
  hire_date     text,
  created_at    timestamptz default now()
);

create table if not exists public.magasin_workers (
  id            text primary key default gen_random_uuid()::text,
  name          text,
  phone         text,
  email         text,
  cin           text,
  address       text,
  photo_url     text,
  status        text,
  base_salary   numeric default 0,
  has_access    boolean default false,
  username      text,
  auth_user_id  uuid references auth.users(id) on delete set null,
  permissions   jsonb default '{}'::jsonb,
  hire_date     text,
  created_at    timestamptz default now()
);

create table if not exists public.chef_pompiste_assignments (
  id           text primary key default gen_random_uuid()::text,
  chef_id      text,
  pompiste_id  text,
  unique (chef_id, pompiste_id)
);

-- Clients ------------------------------------------------------------------------------
create table if not exists public.clients (
  id               text primary key default gen_random_uuid()::text,
  name             text,
  phone            text,
  cin              text,
  email            text,
  address          text,
  contact_person   text,
  balance          numeric default 0,
  debt             numeric default 0,
  credit_limit     numeric default 0,
  payment_delay    numeric default 0,
  type             text,
  payment_mode     text,
  nif              text,
  nis              text,
  article          text,
  rc               text,
  advance_balance  numeric default 0,
  -- Ouverture du compte : ce que le client devait (ou avait versé) le jour où sa
  -- fiche a été créée. C'est une LIGNE de son journal, pas un simple compteur.
  opening_debt     numeric default 0,
  opening_advance  numeric default 0,
  opening_date     text,
  opening_notes    text,
  created_at       timestamptz default now()
);

create table if not exists public.client_transactions (
  id                 text primary key default gen_random_uuid()::text,
  client_id          text,
  date               text,
  type               text,
  amount             numeric default 0,
  mode               text,
  receipt_number     text,
  receipt_photo_url  text,
  notes              text,
  created_at         timestamptz default now()
);

create table if not exists public.client_appointments (
  id         text primary key default gen_random_uuid()::text,
  client_id  text,
  sale_id    text,
  date       text,
  amount     numeric default 0,
  notes      text,
  is_paid    boolean default false
);

-- Suppliers ----------------------------------------------------------------------------
create table if not exists public.suppliers (
  id               text primary key default gen_random_uuid()::text,
  ref              text,
  name             text,
  contact          text,
  phone            text,
  email            text,
  address          text,
  balance          numeric default 0,
  total_purchases  numeric default 0,
  nif              text,
  nis              text,
  article          text,
  rc               text,
  type             text,
  created_at       timestamptz default now()
);

create table if not exists public.supplier_appointments (
  id           text primary key default gen_random_uuid()::text,
  supplier_id  text,
  purchase_id  text,
  date         text,
  amount       numeric default 0,
  notes        text,
  is_paid      boolean default false
);

create table if not exists public.supplier_debt_payments (
  id                text primary key default gen_random_uuid()::text,
  supplier_id       text,
  purchase_id       text,
  delivery_note_id  text,
  date              text,
  amount            numeric default 0,
  total_due         numeric default 0,
  rest              numeric default 0,
  payment_mode      text,
  cheque_number     text,
  notes             text
);

-- Brigades -----------------------------------------------------------------------------
create table if not exists public.brigades (
  id                     text primary key default gen_random_uuid()::text,
  date                   text,
  shift                  text,
  chef_id                text,
  status                 text,
  start_timestamp        text,
  end_timestamp          text,
  start_time             text,
  end_time               text,
  start_datetime         text,
  end_datetime           text,
  is_active              boolean default false,
  notes                  text,
  printed_at             text,
  start_indices          jsonb default '{}'::jsonb,
  end_indices            jsonb default '{}'::jsonb,
  start_tank_levels      jsonb default '{}'::jsonb,
  end_tank_levels        jsonb default '{}'::jsonb,
  pompiste_data          jsonb default '{}'::jsonb,
  pompiste_assignments   jsonb default '[]'::jsonb,
  start_nozzle_indices   jsonb default '{}'::jsonb,
  end_nozzle_indices     jsonb default '{}'::jsonb,
  active_nozzle_ids      jsonb default '[]'::jsonb,
  can_reactivate         boolean default false,
  created_at             timestamptz default now()
);

create table if not exists public.brigade_pompiste_assignments (
  id           text primary key default gen_random_uuid()::text,
  brigade_id   text,
  pompiste_id  text,
  unique (brigade_id, pompiste_id)
);

create table if not exists public.brigade_accounting (
  id                         text primary key default gen_random_uuid()::text,
  brigade_id                 text,
  total_due                  numeric default 0,
  cash_received              numeric default 0,
  rest                       numeric default 0,
  tank_summary               jsonb default '[]'::jsonb,
  nozzle_summary             jsonb default '[]'::jsonb,
  decalage_summary           jsonb default '{}'::jsonb,
  pompiste_summary           jsonb default '{}'::jsonb,
  cuve_verifications         jsonb default '{}'::jsonb,
  nozzle_verifications       jsonb default '{}'::jsonb,
  rest_assigned_worker_type  text,
  rest_assigned_worker_id    text,
  rest_assigned_amount       numeric default 0,
  status                     text,
  created_by                 text,
  created_at                 timestamptz default now()
);

create table if not exists public.brigade_accounting_justifications (
  id                  text primary key default gen_random_uuid()::text,
  accounting_id       text,
  client_id           text,
  amount              numeric default 0,
  client_type         text,
  payment_mode        text,
  notes               text,
  justification_type  text,
  client_name         text,
  fuel_type           text,
  liters              numeric,
  price_per_liter     numeric,
  track_id            text,
  pompiste_id         text
);

-- Worker payroll sub-records -----------------------------------------------------------
create table if not exists public.worker_acomptes (
  id           text primary key default gen_random_uuid()::text,
  worker_type  text,
  worker_id    text,
  date         text,
  amount       numeric default 0,
  description  text,
  is_paid      boolean default false,
  month_paid   text
);

create table if not exists public.worker_absences (
  id           text primary key default gen_random_uuid()::text,
  worker_type  text,
  worker_id    text,
  date         text,
  cost         numeric default 0,
  description  text,
  is_paid      boolean default false,
  month_paid   text
);

create table if not exists public.worker_payment_records (
  id                text primary key default gen_random_uuid()::text,
  worker_type       text,
  worker_id         text,
  month             text,
  base_salary       numeric default 0,
  total_acomptes    numeric default 0,
  total_absences    numeric default 0,
  bonus_decalage    numeric default 0,
  retenue_decalage  numeric default 0,
  net_salary        numeric default 0,
  payment_date      text,
  payment_mode      text,
  cheque_number     text,
  notes             text,
  is_paid           boolean default false
);

create table if not exists public.pompiste_decalage_history (
  id           text primary key default gen_random_uuid()::text,
  pompiste_id  text,
  brigade_id   text,
  date         text,
  amount       numeric default 0,
  type         text
);

-- Fuel sales ---------------------------------------------------------------------------
create table if not exists public.fuel_sales (
  id               text primary key default gen_random_uuid()::text,
  date             text,
  pump_id          text,
  liters           numeric default 0,
  price_per_liter  numeric default 0,
  total            numeric default 0,
  payment_mode     text,
  client_id        text,
  bon_number       text,
  bon_photo_url    text,
  pompiste_id      text,
  brigade_id       text,
  created_at       timestamptz default now()
);

-- Shop sales ---------------------------------------------------------------------------
create table if not exists public.shop_sales (
  id                 text primary key default gen_random_uuid()::text,
  date               text,
  client_id          text,
  seller_id          text,
  subtotal           numeric default 0,
  tva_amount         numeric default 0,
  total              numeric default 0,
  payment_mode       text,
  cheque_number      text,
  bon_number         text,
  bon_photo_url      text,
  amount_paid        numeric default 0,
  rest               numeric default 0,
  status             text,
  notes              text,
  printed_at         text,
  invoice_image_url  text,
  created_at         timestamptz default now()
);

create table if not exists public.shop_sale_items (
  id            text primary key default gen_random_uuid()::text,
  sale_id       text,
  product_id    text,
  product_name  text,
  quantity      numeric default 0,
  price         numeric default 0,
  tva           numeric default 0
);

-- Expenses -----------------------------------------------------------------------------
create table if not exists public.expenses (
  id             text primary key default gen_random_uuid()::text,
  date           text,
  category       text,
  amount         numeric default 0,
  description    text,
  payment_mode   text,
  cheque_number  text,
  -- Compte débité : 'CAISSE' (espèces) ou bank_accounts.id.
  account_id       text default 'CAISSE',
  bordereau_number text,
  paid_by        text,
  recipient      text,
  status         text,
  receipt_url    text,
  created_by     text,
  created_at     timestamptz default now()
);

-- Purchases ----------------------------------------------------------------------------
create table if not exists public.purchases (
  id                        text primary key default gen_random_uuid()::text,
  date                      text,
  supplier_id               text,
  invoice_number            text,
  due_date                  text,
  driver_id                 text,
  total                     numeric default 0,
  amount_paid               numeric default 0,
  rest                      numeric default 0,
  status                    text,
  payment_mode              text,
  cheque_number             text,
  linked_delivery_note_id   text,
  notes                     text,
  type                      text,
  tva_rate                  numeric default 0,
  tva_active                boolean default false,
  tank_id                   text,
  receipt_photo_url         text,
  created_at                timestamptz default now()
);

create table if not exists public.purchase_items (
  id             text primary key default gen_random_uuid()::text,
  purchase_id    text,
  product_id     text,
  product_name   text,
  quantity       numeric default 0,
  buy_price      numeric default 0,
  selling_price  numeric default 0,
  min_stock      numeric default 0,
  unit           text,
  total          numeric default 0,
  tank_id        text,
  tva_active     boolean default false,
  tva_rate       numeric default 0
);

create table if not exists public.purchase_payments (
  id             text primary key default gen_random_uuid()::text,
  purchase_id    text,
  date           text,
  amount         numeric default 0,
  mode           text,
  cheque_number  text,
  notes          text
);

-- Delivery notes -----------------------------------------------------------------------
create table if not exists public.delivery_notes (
  id               text primary key default gen_random_uuid()::text,
  date             text,
  supplier_id      text,
  tank_id          text,
  liters           numeric default 0,
  price_per_liter  numeric default 0,
  status           text,
  total            numeric default 0,
  expiry_date      text,
  bl_number        text,
  bl_date          text,
  creation_date    text,
  immatriculation  text,
  driver_id        text,
  created_at       timestamptz default now()
);

create table if not exists public.delivery_note_items (
  id                text primary key default gen_random_uuid()::text,
  delivery_note_id  text,
  tank_id           text,
  liters            numeric default 0,
  price_per_liter   numeric default 0,
  total             numeric default 0
);

create table if not exists public.delivery_note_photos (
  id                text primary key default gen_random_uuid()::text,
  delivery_note_id  text,
  photo_url         text
);

create table if not exists public.delivery_note_payments (
  id                 text primary key default gen_random_uuid()::text,
  delivery_note_id   text,
  date               text,
  amount             numeric default 0,
  mode               text,
  receipt_number     text,
  receipt_photo_url  text
);

-- Inventories --------------------------------------------------------------------------
create table if not exists public.inventories (
  id                 text primary key default gen_random_uuid()::text,
  name               text,
  description        text,
  date               text,
  user_name          text,
  type               text,
  status             text,
  fuel_gaps          jsonb default '[]'::jsonb,
  pump_index_gaps    jsonb default '[]'::jsonb,
  product_gaps       jsonb default '[]'::jsonb,
  adjustment_reason  text,
  adjusted_at        text,
  created_at         timestamptz default now()
);

-- Daily reports ------------------------------------------------------------------------
create table if not exists public.daily_reports (
  id               text primary key default gen_random_uuid()::text,
  date             text,
  fuel_revenue     numeric default 0,
  shop_revenue     numeric default 0,
  total_expenses   numeric default 0,
  cash_to_deposit  numeric default 0,
  tank_variations  jsonb default '[]'::jsonb,
  brigade_ids      jsonb default '[]'::jsonb
);

-- Permission templates -----------------------------------------------------------------
create table if not exists public.permission_templates (
  id           text primary key default gen_random_uuid()::text,
  name         text,
  role         text,
  permissions  jsonb default '{}'::jsonb,
  created_at   timestamptz default now()
);

-- Activity log -------------------------------------------------------------------------
create table if not exists public.activity_log (
  id         text primary key default gen_random_uuid()::text,
  timestamp  timestamptz default now(),
  user_id    text,
  action     text,
  details    text
);

-- TPE transactions ---------------------------------------------------------------------
create table if not exists public.tpe_transactions (
  id               text primary key default gen_random_uuid()::text,
  brigade_id       text,
  accounting_id    text,
  date             text,
  mode             text,
  client_name      text,
  client_id        text,
  fuel_type        text,
  liters           numeric default 0,
  price_per_liter  numeric default 0,
  amount           numeric default 0,
  track_id         text,
  track_name       text,
  pompiste_id      text,
  pompiste_name    text,
  notes            text,
  created_at       timestamptz default now()
);

-- Brigade décalage alerts --------------------------------------------------------------
create table if not exists public.brigade_decalage_alerts (
  id               text primary key default gen_random_uuid()::text,
  brigade_id       text,
  brigade_date     text,
  start_datetime   text,
  end_datetime     text,
  chef_id          text,
  chef_name        text,
  alert_type       text,
  tank_id          text,
  tank_name        text,
  pompiste_id      text,
  pompiste_name    text,
  decalage_liters  numeric default 0,
  decalage_amount  numeric default 0,
  workers_info     jsonb default '[]'::jsonb,
  is_dismissed     boolean default false,
  created_at       timestamptz default now()
);

-- Fuel invoices / receipts (facturation & paiements) -----------------------------------
create table if not exists public.fuel_invoices (
  id                 text primary key default gen_random_uuid()::text,
  invoice_number     text,
  invoice_date       text,
  creation_date      text,
  reception_date     text,
  tva_active         boolean default false,
  tva_rate           numeric default 0,
  subtotal           numeric default 0,
  tva_amount         numeric default 0,
  total              numeric default 0,
  amount_paid        numeric default 0,
  rest               numeric default 0,
  status             text,
  appointment_date   text,
  appointment_amount numeric,
  appointment_notes  text,
  invoice_image_url  text,
  notes              text,
  created_at         timestamptz default now()
);

create table if not exists public.fuel_invoice_bls (
  id                text primary key default gen_random_uuid()::text,
  invoice_id        text,
  delivery_note_id  text
);

create table if not exists public.fuel_receipts (
  id                 text primary key default gen_random_uuid()::text,
  receipt_number     text,
  receipt_date       text,
  creation_date      text,
  total_invoiced     numeric default 0,
  amount_paid        numeric default 0,
  rest               numeric default 0,
  is_debt_payment    boolean default false,
  receipt_image_url  text,
  notes              text,
  created_at         timestamptz default now()
);

create table if not exists public.fuel_receipt_invoices (
  id          text primary key default gen_random_uuid()::text,
  receipt_id  text,
  invoice_id  text
);

-- =====================================================================================
--  HELPER + RPC FUNCTIONS
-- =====================================================================================

-- Is the current caller an admin? ------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.admin_profiles where id = auth.uid());
$$;

-- Does ANY admin exist yet? (drives the "Create admin" button on the login page) --------
create or replace function public.admin_exists()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.admin_profiles);
$$;

-- Resolve a username to its login email (lets users sign in with username OR email) -----
create or replace function public.email_for_username(p_username text)
returns text
language sql stable security definer set search_path = auth, public
as $$
  select u.email
  from auth.users u
  where lower(u.raw_user_meta_data->>'username') = lower(p_username)
  limit 1;
$$;

-- Low-level: create a CONFIRMED auth user (so they can log in immediately) --------------
create or replace function public._create_auth_user(p_email text, p_password text, p_meta jsonb default '{}'::jsonb)
returns uuid
language plpgsql security definer set search_path = auth, public, extensions
as $$
declare
  v_uid       uuid;
  v_existing  uuid;
begin
  select id into v_existing from auth.users where email = lower(p_email) limit 1;
  if v_existing is not null then
    return v_existing;
  end if;

  v_uid := gen_random_uuid();

  -- The token/*_change columns MUST be '' (not NULL): the Auth server scans them
  -- into non-nullable Go strings, and a NULL makes password login return HTTP 500.
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data, is_super_admin,
    confirmation_token, recovery_token, email_change,
    email_change_token_new, email_change_token_current,
    phone_change, phone_change_token, reauthentication_token
  ) values (
    '00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated',
    lower(p_email), extensions.crypt(p_password, extensions.gen_salt('bf')),
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    coalesce(p_meta, '{}'::jsonb), false,
    '', '', '', '', '', '', '', ''
  );

  insert into auth.identities (
    id, provider_id, user_id, identity_data, provider,
    last_sign_in_at, created_at, updated_at
  ) values (
    gen_random_uuid(), lower(p_email), v_uid,
    jsonb_build_object('sub', v_uid::text, 'email', lower(p_email), 'email_verified', true),
    'email', now(), now(), now()
  );

  return v_uid;
end;
$$;

-- Bootstrap the FIRST admin account (called from the login page's "Create admin" form) --
create or replace function public.create_admin_account(
  p_name text, p_username text, p_email text, p_password text
)
returns jsonb
language plpgsql security definer set search_path = public, auth, extensions
as $$
declare
  v_uid uuid;
begin
  if exists (select 1 from public.admin_profiles) then
    return jsonb_build_object('ok', false, 'error', 'Un administrateur existe déjà.');
  end if;
  if coalesce(p_email, '') = '' or coalesce(p_password, '') = '' then
    return jsonb_build_object('ok', false, 'error', 'Email et mot de passe requis.');
  end if;

  v_uid := public._create_auth_user(
    p_email, p_password,
    jsonb_build_object('name', p_name, 'username', lower(p_username), 'role', 'admin')
  );

  insert into public.admin_profiles (id, name, username, email, role)
  values (v_uid, p_name, lower(p_username), lower(p_email), 'admin')
  on conflict (id) do update set name = excluded.name, username = excluded.username, email = excluded.email;

  return jsonb_build_object('ok', true, 'auth_user_id', v_uid::text);
exception when others then
  return jsonb_build_object('ok', false, 'error', sqlerrm);
end;
$$;

-- Role of the current caller -----------------------------------------------------------
create or replace function public.get_my_role()
returns text
language plpgsql stable security definer set search_path = public
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then return null; end if;
  if exists (select 1 from public.admin_profiles   where id = v_uid)           then return 'admin'; end if;
  if exists (select 1 from public.pompistes        where auth_user_id = v_uid) then return 'pompiste'; end if;
  if exists (select 1 from public.brigade_chefs    where auth_user_id = v_uid) then return 'chef_brigade'; end if;
  if exists (select 1 from public.gerants          where auth_user_id = v_uid) then return 'gerant'; end if;
  if exists (select 1 from public.magasin_workers  where auth_user_id = v_uid) then return 'magasin'; end if;
  return null;
end;
$$;

-- Worker row (with permissions JSON) for the current caller ----------------------------
create or replace function public.get_my_worker()
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row jsonb;
begin
  if v_uid is null then return null; end if;
  select to_jsonb(p) into v_row from public.pompistes       p where p.auth_user_id = v_uid limit 1; if v_row is not null then return v_row; end if;
  select to_jsonb(c) into v_row from public.brigade_chefs   c where c.auth_user_id = v_uid limit 1; if v_row is not null then return v_row; end if;
  select to_jsonb(g) into v_row from public.gerants         g where g.auth_user_id = v_uid limit 1; if v_row is not null then return v_row; end if;
  select to_jsonb(m) into v_row from public.magasin_workers m where m.auth_user_id = v_uid limit 1; if v_row is not null then return v_row; end if;
  return null;
end;
$$;

-- Adjust a tank's current level by a delta (used after fuel sales / deliveries) ---------
create or replace function public.adjust_tank_level(p_tank_id text, p_delta numeric)
returns void
language sql security definer set search_path = public
as $$
  update public.tanks
     set current = greatest(0, coalesce(current, 0) + coalesce(p_delta, 0))
   where id = p_tank_id;
$$;

-- Create / update-password / delete a worker's login account ---------------------------
create or replace function public.provision_worker_account(
  p_action      text,
  p_worker_type text,
  p_worker_id   text,
  p_username    text default null,
  p_password    text default null,
  p_name        text default null,
  p_email       text default null
)
returns jsonb
language plpgsql security definer set search_path = public, auth, extensions
as $$
declare
  v_tbl      text;
  v_uid      uuid;
  v_existing uuid;
  v_email    text;
begin
  -- Only administrators may manage worker accounts.
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'Réservé aux administrateurs.');
  end if;

  v_tbl := case p_worker_type
    when 'pompiste'     then 'pompistes'
    when 'chef_brigade' then 'brigade_chefs'
    when 'gerant'       then 'gerants'
    when 'magasin'      then 'magasin_workers'
    else null end;
  if v_tbl is null then
    return jsonb_build_object('ok', false, 'error', 'Type de travailleur invalide.');
  end if;

  if p_action = 'create' then
    v_email := lower(coalesce(nullif(trim(p_email), ''), lower(p_username) || '@station.local'));
    v_uid := public._create_auth_user(
      v_email, p_password,
      jsonb_build_object('name', p_name, 'username', lower(p_username), 'role', p_worker_type)
    );
    execute format('update public.%I set auth_user_id = $1, username = $2, has_access = true where id = $3', v_tbl)
      using v_uid, lower(p_username), p_worker_id;
    return jsonb_build_object('ok', true, 'auth_user_id', v_uid::text);

  elsif p_action = 'update_password' then
    execute format('select auth_user_id from public.%I where id = $1', v_tbl) into v_existing using p_worker_id;
    if v_existing is null then
      v_email := lower(coalesce(nullif(trim(p_email), ''), lower(p_username) || '@station.local'));
      v_uid := public._create_auth_user(
        v_email, p_password,
        jsonb_build_object('name', p_name, 'username', lower(p_username), 'role', p_worker_type)
      );
      execute format('update public.%I set auth_user_id = $1, username = $2, has_access = true where id = $3', v_tbl)
        using v_uid, lower(p_username), p_worker_id;
      return jsonb_build_object('ok', true, 'auth_user_id', v_uid::text);
    end if;
    update auth.users
       set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')),
           updated_at = now()
     where id = v_existing;
    return jsonb_build_object('ok', true, 'auth_user_id', v_existing::text);

  elsif p_action = 'delete' then
    execute format('select auth_user_id from public.%I where id = $1', v_tbl) into v_existing using p_worker_id;
    execute format('update public.%I set auth_user_id = null, has_access = false where id = $1', v_tbl) using p_worker_id;
    if v_existing is not null then
      delete from auth.identities where user_id = v_existing;
      delete from auth.users where id = v_existing;
    end if;
    return jsonb_build_object('ok', true);
  end if;

  return jsonb_build_object('ok', false, 'error', 'Action inconnue.');
exception when others then
  return jsonb_build_object('ok', false, 'error', sqlerrm);
end;
$$;

-- Grants: anon needs the bootstrap/lookup functions; the rest require a login -----------
grant execute on function public.admin_exists()                to anon, authenticated;
grant execute on function public.create_admin_account(text, text, text, text) to anon, authenticated;
grant execute on function public.email_for_username(text)      to anon, authenticated;
grant execute on function public.is_admin()                    to authenticated;
grant execute on function public.get_my_role()                 to authenticated;
grant execute on function public.get_my_worker()               to authenticated;
grant execute on function public.adjust_tank_level(text, numeric) to authenticated;
grant execute on function public.provision_worker_account(text, text, text, text, text, text, text) to authenticated;
-- _create_auth_user is internal only (no anon/authenticated grant).

-- =====================================================================================
--  ROW LEVEL SECURITY
-- =====================================================================================

-- Business/data tables: any logged-in user may read & write. Which pages and buttons a
-- worker actually sees is enforced in the app from their saved permissions JSON.
do $$
declare
  t text;
  business_tables text[] := array[
    'station_settings','tracks','tanks','pumps','pump_nozzles','drivers',
    'product_brands','products','chef_pompiste_assignments','clients',
    'client_transactions','client_appointments','suppliers','supplier_appointments',
    'supplier_debt_payments','brigades','brigade_pompiste_assignments','brigade_accounting',
    'brigade_accounting_justifications','worker_acomptes','worker_absences',
    'worker_payment_records','pompiste_decalage_history','fuel_sales','shop_sales',
    'shop_sale_items','expenses','purchases','purchase_items','purchase_payments',
    'delivery_notes','delivery_note_items','delivery_note_photos','delivery_note_payments',
    'inventories','daily_reports','activity_log','tpe_transactions','brigade_decalage_alerts',
    'fuel_invoices','fuel_invoice_bls','fuel_receipts','fuel_receipt_invoices'
  ];
begin
  foreach t in array business_tables loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists app_rw on public.%I;', t);
    execute format(
      'create policy app_rw on public.%I for all to authenticated using (true) with check (true);', t
    );
  end loop;
end $$;

-- Identity tables need tighter rules ---------------------------------------------------

-- admin_profiles: read own row or (if admin) all; update own row; admins manage all.
alter table public.admin_profiles enable row level security;
drop policy if exists admin_self_select on public.admin_profiles;
drop policy if exists admin_all_select  on public.admin_profiles;
drop policy if exists admin_self_update on public.admin_profiles;
drop policy if exists admin_manage      on public.admin_profiles;
create policy admin_self_select on public.admin_profiles for select to authenticated
  using (id = auth.uid() or public.is_admin());
create policy admin_self_update on public.admin_profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
create policy admin_manage on public.admin_profiles for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Worker tables: everyone logged-in may read the roster (needed by permitted pages);
-- an admin may write anything; a worker may update only their OWN row (profile / photo).
do $$
declare
  t text;
  worker_tables text[] := array['pompistes','brigade_chefs','gerants','magasin_workers'];
begin
  foreach t in array worker_tables loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists w_select on public.%I;', t);
    execute format('drop policy if exists w_admin  on public.%I;', t);
    execute format('drop policy if exists w_self   on public.%I;', t);
    execute format('create policy w_select on public.%I for select to authenticated using (true);', t);
    execute format('create policy w_admin  on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin());', t);
    execute format('create policy w_self   on public.%I for update to authenticated using (auth_user_id = auth.uid()) with check (auth_user_id = auth.uid());', t);
  end loop;
end $$;

-- permission_templates: administrators only.
alter table public.permission_templates enable row level security;
drop policy if exists pt_admin on public.permission_templates;
create policy pt_admin on public.permission_templates for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- =====================================================================================
--  STORAGE BUCKETS (all image uploads in the app)
-- =====================================================================================
insert into storage.buckets (id, name, public) values
  ('station-logos',    'station-logos',    true),
  ('product-images',   'product-images',   true),
  ('worker-photos',    'worker-photos',    true),
  ('bon-photos',       'bon-photos',       true),
  ('delivery-photos',  'delivery-photos',  true),
  ('invoices',         'invoices',         true),
  ('expense-receipts', 'expense-receipts', true),
  ('client-receipts',  'client-receipts',  true)
on conflict (id) do update set public = true;

-- Anyone can read (public buckets → public URLs); logged-in users manage objects.
drop policy if exists sp_public_read on storage.objects;
drop policy if exists sp_auth_insert on storage.objects;
drop policy if exists sp_auth_update on storage.objects;
drop policy if exists sp_auth_delete on storage.objects;

create policy sp_public_read on storage.objects for select to public
  using (bucket_id in ('station-logos','product-images','worker-photos','bon-photos',
                       'delivery-photos','invoices','expense-receipts','client-receipts'));
create policy sp_auth_insert on storage.objects for insert to authenticated
  with check (bucket_id in ('station-logos','product-images','worker-photos','bon-photos',
                            'delivery-photos','invoices','expense-receipts','client-receipts'));
create policy sp_auth_update on storage.objects for update to authenticated
  using (bucket_id in ('station-logos','product-images','worker-photos','bon-photos',
                       'delivery-photos','invoices','expense-receipts','client-receipts'));
create policy sp_auth_delete on storage.objects for delete to authenticated
  using (bucket_id in ('station-logos','product-images','worker-photos','bon-photos',
                       'delivery-photos','invoices','expense-receipts','client-receipts'));

-- =====================================================================================
--  REALTIME (live updates via subscribeTable) — best effort, ignores duplicates
-- =====================================================================================
do $$
declare t record;
begin
  for t in
    select tablename from pg_tables where schemaname = 'public'
  loop
    begin
      execute format('alter publication supabase_realtime add table public.%I;', t.tablename);
    exception when others then
      -- already in publication, or publication missing — ignore
      null;
    end;
  end loop;
end $$;

-- =====================================================================================
--  OPTIONAL SEED — a starter settings row so the app has fuel prices on first run.
-- =====================================================================================
insert into public.station_settings (id, name, fuel_prices, fuel_buy_prices,
  product_categories, expense_categories, product_units)
values (
  'settings-1', 'Station Naftal',
  '{"SUPER":14.80,"DIESEL":12.50,"ESSENCE":14.80,"GASOIL":12.50,"GPL":8.50}'::jsonb,
  '{"SUPER":0,"DIESEL":0,"ESSENCE":0,"GASOIL":0,"GPL":0}'::jsonb,
  '["Lubrifiants","Accessoires","Lavage","Magasin","Boissons"]'::jsonb,
  '["Salaires","Entretien","Électricité","Eau","Loyer","Impôts","Divers"]'::jsonb,
  '["Pièce","Litre","Kg","Carton","Pack","Bidon"]'::jsonb
)
on conflict (id) do nothing;

-- =====================================================================================
--  OPTIONAL: uncomment to create a ready-to-use demo admin (email + password below).
--  NOTE: doing this makes admin_exists() return true, so the login page's
--  "Create admin" button will be hidden from the start.
-- =====================================================================================
-- select public.create_admin_account('Administrateur', 'admin', 'admin@stationpro.dz', 'stationpro');

-- Done.
