-- =====================================================================================
--  STATION — FULL SUPABASE SCHEMA (single file, run once on a NEW project)
--
--  HOW TO RUN
--    1. Supabase Dashboard → SQL Editor → New query.
--    2. Paste this ENTIRE file → Run. It is idempotent: running it again is safe.
--    3. Authentication → Sign In / Providers → Email:
--         • keep "Email" enabled,
--         • turn OFF "Confirm email" (accounts are created already confirmed),
--         • turn OFF "Allow new users to sign up" — every account is created by the
--           app (first admin from the login page, workers by the admin).
--
--  WHAT IT CREATES
--    §1  Extensions
--    §2  Tables — Carburant part (station, tanks, pumps, brigades, fuel purchases…)
--    §3  Tables — Workers, payroll, permissions
--    §4  Tables — Clients, suppliers, sales, purchases, expenses
--    §5  Tables — Treasury (cash boxes, bank accounts, ledger)
--    §6  Tables — Business parts (Restaurant / Cafétéria / Magasin)
--    §7  Relations (foreign keys) + indexes
--    §8  Auth & permission helpers  (is_admin, get_my_role, has_permission…)
--    §9  Account RPCs  (create_admin_account, provision_worker_account,
--                       provision_module_worker_account, …)  — they write straight
--                       into auth.users / auth.identities, so every account can sign
--                       in immediately with its email OR username.
--    §10 Business RPCs + triggers (tank level, biz_store revisions, cascades…)
--    §11 Row Level Security — permission-aware
--    §12 Storage buckets + policies (every image of the app)
--    §13 Realtime publication
--    §14 Reporting views
--    §15 Seed rows (settings, cash boxes)
--    §16 Armoires de la piste, transferts Magasin → Armoire, bouteilles de gaz
--        (vide / plein) et second magasin
--
--  CONVENTIONS
--    • Primary keys are TEXT: the app generates ids client-side (UUID strings, plus a
--      few fixed ids such as 'settings-1', 'CAISSE', 'biz-v1').
--    • Ids that point at auth.users are real uuid.
--    • Date-like business fields are TEXT (the app writes 'YYYY-MM-DD' / ISO strings and
--      sometimes ''), audit columns are timestamptz.
--    • Internal module key 'lavage' = the « Magasin » part in the UI (kept as the key so
--      stored data never needs rewriting). 'magasin2' = the SECOND magasin, created from
--      Paramètres → Magasins (same interfaces, independent data).
-- =====================================================================================


-- =====================================================================================
--  §1  EXTENSIONS
-- =====================================================================================
create extension if not exists pgcrypto with schema extensions;
do $$ begin
  create extension if not exists pg_trgm with schema extensions;
exception when others then null; end $$;


-- =====================================================================================
--  §2  TABLES — CARBURANT PART
-- =====================================================================================

-- Station settings (single row, id = 'settings-1') ------------------------------------
create table if not exists public.station_settings (
  id                      text primary key default gen_random_uuid()::text,
  name                    text,
  logo_url                text,
  address                 text,
  phone                   text,
  email                   text,
  fiscal_id               text,
  rc                      text,
  fuel_prices             jsonb   default '{}'::jsonb,
  fuel_buy_prices         jsonb   default '{"GPL":0,"SUPER":0,"DIESEL":0,"GASOIL":0,"ESSENCE":0}'::jsonb,
  conversion_tables       jsonb   default '{}'::jsonb,   -- { tankId: [{degree, liters}] }
  product_categories      jsonb   default '[]'::jsonb,
  expense_categories      jsonb   default '[]'::jsonb,
  product_units           jsonb   default '[]'::jsonb,
  decalage_positif_actif  boolean default true,
  decalage_negatif_actif  boolean default true,
  decalage_positif_seuil  numeric default 0,
  decalage_negatif_seuil  numeric default 0,
  magasin1_name           text,               -- nom du premier magasin (partie 'lavage')
  magasin2_name           text,               -- nom du second magasin (partie 'magasin2')
  magasin2_enabled        boolean not null default false,
  created_at              timestamptz default now()
);

-- Tracks (pistes) -----------------------------------------------------------------------
create table if not exists public.tracks (
  id          text primary key default gen_random_uuid()::text,
  name        text,
  created_at  timestamptz default now()
);

-- Tanks (cuves) -------------------------------------------------------------------------
create table if not exists public.tanks (
  id               text primary key default gen_random_uuid()::text,
  name             text,
  type             text,                 -- SUPER | DIESEL | ESSENCE | GASOIL | GPL
  capacity         numeric default 0,
  current          numeric default 0,    -- liters
  degrees          numeric default 0,
  alert_threshold  numeric default 0,
  notes            text,
  is_favorite      boolean not null default false,
  created_at       timestamptz default now()
);

-- Pumps + nozzles -----------------------------------------------------------------------
create table if not exists public.pumps (
  id                           text primary key default gen_random_uuid()::text,
  number                       text,
  name                         text,
  tank_id                      text,     -- main tank (copied from first nozzle)
  track_id                     text,
  type                         text,     -- obsolete: fuel type comes from the nozzle's tank
  last_index                   numeric default 0,
  status                       text,
  current_brigade_start_index  numeric,
  created_at                   timestamptz default now()
);

create table if not exists public.pump_nozzles (
  id           text primary key default gen_random_uuid()::text,
  pump_id      text,
  tank_id      text,                     -- tank feeding this nozzle
  name         text,
  last_index   numeric default 0,
  start_index  numeric default 0,
  status       text,
  created_at   timestamptz default now()
);

-- Drivers (fuel delivery) ---------------------------------------------------------------
create table if not exists public.drivers (
  id          text primary key default gen_random_uuid()::text,
  name        text,
  status      text,
  phone       text,
  email       text,
  address     text,
  created_at  timestamptz default now()
);

-- Brigades (shifts) ---------------------------------------------------------------------
create table if not exists public.brigades (
  id                         text primary key default gen_random_uuid()::text,
  date                       text,
  shift                      text,
  chef_id                    text,
  status                     text,   -- Planifiée | Ouverte | En attente | Clôturée | Fermée
  start_timestamp            text,
  end_timestamp              text,
  start_time                 text,
  end_time                   text,
  start_datetime             text,
  end_datetime               text,
  is_active                  boolean default false,
  notes                      text,
  printed_at                 text,
  start_indices              jsonb default '{}'::jsonb,
  end_indices                jsonb default '{}'::jsonb,
  start_tank_levels          jsonb default '{}'::jsonb,
  end_tank_levels            jsonb default '{}'::jsonb,
  pompiste_data              jsonb default '{}'::jsonb,
  pompiste_assignments       jsonb default '[]'::jsonb,
  pompiste_pump_assignments  jsonb default '[]'::jsonb,
  start_nozzle_indices       jsonb default '{}'::jsonb,
  end_nozzle_indices         jsonb default '{}'::jsonb,
  active_nozzle_ids          jsonb default '[]'::jsonb,
  versements                 jsonb default '[]'::jsonb,
  can_reactivate             boolean default false,
  created_at                 timestamptz default now()
);

create table if not exists public.brigade_pompiste_assignments (
  id           text primary key default gen_random_uuid()::text,
  brigade_id   text,
  pompiste_id  text,
  unique (brigade_id, pompiste_id)
);

create table if not exists public.brigade_versements (
  id           text primary key default gen_random_uuid()::text,
  brigade_id   text not null,
  pompiste_id  text not null,
  amount       numeric not null default 0,
  versed_at    timestamptz not null default now(),
  notes        text,
  created_by   text,
  created_at   timestamptz default now()
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
  brigade_alerts             jsonb default '[]'::jsonb,
  rest_assigned_worker_type  text,
  rest_assigned_worker_id    text,
  rest_assigned_amount       numeric default 0,
  status                     text,
  created_by                 text,
  created_at                 timestamptz default now(),
  updated_at                 timestamptz default now()
);

-- One line per justification of a brigade's cash: CLIENT (credit) | TPE | TAG | EXPENSE …
create table if not exists public.brigade_accounting_justifications (
  id                  text primary key default gen_random_uuid()::text,
  accounting_id       text,
  client_id           text,
  amount              numeric default 0,
  client_type         text,
  payment_mode        text,
  notes               text,
  justification_type  text not null default 'CLIENT',
  client_name         text,
  fuel_type           text,
  liters              numeric default 0,
  price_per_liter     numeric default 0,
  track_id            text,
  pompiste_id         text,
  bank_account_id     text,             -- TPE/TAG: credited bank account
  expense_category    text              -- EXPENSE: category from settings
);

create table if not exists public.tpe_transactions (
  id               text primary key default gen_random_uuid()::text,
  brigade_id       text,
  accounting_id    text,
  date             text,
  mode             text,                -- TAG | TPE
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
  bank_account_id  text,
  notes            text,
  created_at       timestamptz default now()
);

create table if not exists public.brigade_decalage_alerts (
  id               text primary key default gen_random_uuid()::text,
  brigade_id       text,
  brigade_date     text,
  start_datetime   text,
  end_datetime     text,
  chef_id          text,
  chef_name        text,
  alert_type       text,                -- CORRECT | RETOUR_CUVE | VENTE_DIRECTE
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

-- Fuel sales ----------------------------------------------------------------------------
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

-- Fuel deliveries (bons de livraison) ---------------------------------------------------
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

-- Fuel invoices / receipts (facturation & paiements) ------------------------------------
create table if not exists public.fuel_invoices (
  id                  text primary key default gen_random_uuid()::text,
  invoice_number      text,
  invoice_date        text,
  creation_date       text,
  reception_date      text,
  tva_active          boolean default false,
  tva_rate            numeric default 0,
  subtotal            numeric default 0,
  tva_amount          numeric default 0,
  total               numeric default 0,
  amount_paid         numeric default 0,
  rest                numeric default 0,
  status              text,
  appointment_date    text,
  appointment_amount  numeric,
  appointment_notes   text,
  invoice_image_url   text,
  notes               text,
  created_at          timestamptz default now()
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

-- Inventories + daily reports -----------------------------------------------------------
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

create table if not exists public.daily_reports (
  id               text primary key default gen_random_uuid()::text,
  date             text,
  fuel_revenue     numeric default 0,
  shop_revenue     numeric default 0,
  total_expenses   numeric default 0,
  cash_to_deposit  numeric default 0,
  tank_variations  jsonb default '[]'::jsonb,
  brigade_ids      jsonb default '[]'::jsonb,
  created_at       timestamptz default now()
);


-- =====================================================================================
--  §3  TABLES — WORKERS, PAYROLL, PERMISSIONS
-- =====================================================================================

-- Administrators (linked 1-1 to auth.users) ---------------------------------------------
create table if not exists public.admin_profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  name        text,
  username    text unique,
  email       text,
  phone       text,
  role        text default 'admin',
  avatar_url  text,
  created_at  timestamptz default now()
);

-- Station workers. `permissions` = { "<Module>": { voir, creer, modifier, supprimer,
-- imprimer, exporter, scanner, generer } } — set by the admin, read at login. ------------
do $$
declare t text;
begin
  foreach t in array array['pompistes','brigade_chefs','gerants','magasin_workers'] loop
    execute format($f$
      create table if not exists public.%I (
        id            text primary key default gen_random_uuid()::text,
        name          text,
        phone         text,
        email         text,
        cin           text,
        address       text,
        photo_url     text,
        status        text,
        base_salary   numeric default 0,
        salary_type   text default 'mois',          -- mois | jour | pourcentage
        work_days     jsonb,
        cnas_date     text,
        has_access    boolean default false,
        username      text,
        auth_user_id  uuid unique references auth.users(id) on delete set null,
        permissions   jsonb default '{}'::jsonb,
        hire_date     text,
        created_at    timestamptz default now()
      )$f$, t);
  end loop;
end $$;
alter table public.pompistes add column if not exists track_id text;
alter table public.pompistes add column if not exists chef_id  text;

create table if not exists public.chef_pompiste_assignments (
  id           text primary key default gen_random_uuid()::text,
  chef_id      text,
  pompiste_id  text,
  unique (chef_id, pompiste_id)
);

-- Payroll sub-records (worker_type = pompiste | chef_brigade | gerant | magasin) -------
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
  is_paid           boolean default false,
  paid_days         jsonb,
  paid_months       jsonb,
  decalage_ids      jsonb,
  prime_type        text,
  prime_value       numeric,
  prime_amount      numeric
);

create table if not exists public.pompiste_decalage_history (
  id           text primary key default gen_random_uuid()::text,
  pompiste_id  text,
  brigade_id   text,
  date         text,
  amount       numeric default 0,
  type         text
);

-- Reusable permission sets ---------------------------------------------------------------
create table if not exists public.permission_templates (
  id           text primary key default gen_random_uuid()::text,
  name         text,
  role         text,
  permissions  jsonb default '{}'::jsonb,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

-- Activity log --------------------------------------------------------------------------
create table if not exists public.activity_log (
  id         text primary key default gen_random_uuid()::text,
  timestamp  timestamptz default now(),
  user_id    text,
  action     text,
  details    text
);


-- =====================================================================================
--  §4  TABLES — CLIENTS, SUPPLIERS, PRODUCTS, SALES, PURCHASES, EXPENSES
-- =====================================================================================

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
  detail_sale_price   numeric,
  is_raw_material     boolean not null default false,
  created_at          timestamptz default now()
);

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

create table if not exists public.purchases (
  id                        text primary key default gen_random_uuid()::text,
  date                      text,
  supplier_id               text,
  invoice_number            text,
  bl_number                 text,
  due_date                  text,
  driver_id                 text,
  subtotal                  numeric default 0,
  discount_type             text,       -- percent | amount
  discount_value            numeric default 0,
  discount_amount           numeric default 0,
  tva_amount                numeric default 0,
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
  appointment_active        boolean default false,
  appointment_date          text,
  appointment_amount        numeric,
  appointment_notes         text,
  appointment_paid          boolean default false,
  appointment_paid_at       timestamptz,
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
  id                text primary key default gen_random_uuid()::text,
  purchase_id       text,
  date              text,
  amount            numeric default 0,
  mode              text,               -- ESPECES | CHEQUE | VIREMENT
  cheque_number     text,
  bordereau_number  text,
  account_id        text default 'CAISSE',
  notes             text
);

-- Expenses: `part` = which activity pays it; `account_id` = cash box or bank debited ---
create table if not exists public.expenses (
  id                        text primary key default gen_random_uuid()::text,
  date                      text,
  category                  text,
  amount                    numeric default 0,
  description               text,
  payment_mode              text,
  cheque_number             text,
  account_id                text default 'CAISSE',
  bordereau_number          text,
  part                      text,
  paid_by                   text,
  recipient                 text,
  status                    text,
  receipt_url               text,
  created_by                text,
  brigade_id                text,       -- set ⇒ paid from the brigade's cash
  brigade_justification_id  text,
  pompiste_id               text,
  created_at                timestamptz default now()
);
alter table public.expenses drop constraint if exists expenses_part_check;
alter table public.expenses add constraint expenses_part_check
  check (part is null or part in ('carburant','restaurant','cafeteria','lavage','magasin2','systeme'));


-- =====================================================================================
--  §5  TABLES — TREASURY
-- =====================================================================================

-- Cash boxes (fixed ids, referenced by treasury_transactions.account_from/to) ----------
create table if not exists public.cash_accounts (
  id          text primary key,
  name        text not null,
  part        text not null default 'systeme',
  sort_order  int  not null default 0
);

create table if not exists public.bank_accounts (
  id               text primary key default gen_random_uuid()::text,
  name             text not null,
  account_number   text,
  initial_balance  numeric default 0,
  balance          numeric default 0,
  notes            text,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);

-- The ledger: every movement between cash boxes / bank accounts / outside (NULL) -------
create table if not exists public.treasury_transactions (
  id                text primary key default gen_random_uuid()::text,
  date              text not null,
  kind              text not null default 'DEPOSIT',  -- DEPOSIT | WITHDRAW | TRANSFER | TPE …
  amount            numeric not null default 0,
  description       text,
  account_from      text,
  account_to        text,
  part              text not null default 'systeme',
  ref_type          text,                             -- expense | purchase | brigade | sale …
  ref_id            text,
  cheque_number     text,
  bordereau_number  text,
  created_by        text,
  created_at        timestamptz default now()
);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'treasury_transfer_distinct_accounts') then
    alter table public.treasury_transactions
      add constraint treasury_transfer_distinct_accounts
      check (account_from is null or account_to is null or account_from <> account_to);
  end if;
end $$;


-- =====================================================================================
--  §6  TABLES — BUSINESS PARTS (Restaurant / Cafétéria / Magasin)
--      module_key: 'restaurant' | 'cafeteria' | 'lavage' (= Magasin)
-- =====================================================================================

-- Employees of a part who have a login --------------------------------------------------
-- permissions = { "<interface>.<action>": true }, e.g. "pos.voir", "stock.creer".
create table if not exists public.module_workers (
  id            text primary key,
  module_key    text not null,
  name          text not null,
  role_name     text,
  phone         text,
  email         text,
  username      text,
  auth_user_id  uuid unique references auth.users(id) on delete set null,
  has_account   boolean not null default false,
  permissions   jsonb   not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
alter table public.module_workers drop constraint if exists module_workers_module_key_check;
alter table public.module_workers add constraint module_workers_module_key_check
  check (module_key in ('restaurant','cafeteria','lavage','magasin2'));

-- Shared state of the parts (one JSON row 'biz-v1'), guarded by a revision number ------
create table if not exists public.biz_store (
  id          text primary key,
  state       jsonb  not null default '{}'::jsonb,
  rev         bigint not null default 1,
  updated_at  timestamptz not null default now()
);

-- Light row the app polls/subscribes to know when biz_store changed --------------------
create table if not exists public.biz_store_meta (
  id          text primary key,
  rev         bigint not null default 0,
  updated_at  timestamptz not null default now()
);

-- Point-of-sale work sessions (one open session per employee) --------------------------
create table if not exists public.biz_sessions (
  id              text primary key,
  module_key      text not null check (module_key in ('restaurant','cafeteria','lavage','magasin2')),
  ref             text,
  worker_id       text,
  worker_name     text not null,
  opening_cash    numeric(14,2) not null default 0,
  opened_at       timestamptz not null default now(),
  closed_at       timestamptz,
  closing_cash    numeric(14,2),
  status          text not null default 'open' check (status in ('open','closed')),
  notes           text,
  theoretical     numeric(14,2),
  credit          numeric(14,2),
  decalage        numeric(14,2),
  auth_user_id    uuid default auth.uid(),
  opened_by_id    text,
  opened_by_name  text,
  closed_by_id    text,
  closed_by_name  text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Product catalogue of the parts (one row per product; `data` = full app record) -------
create table if not exists public.biz_products (
  id               text primary key,
  module_key       text not null check (module_key in ('restaurant','cafeteria','lavage','magasin2')),
  data             jsonb not null,
  name             text not null default '',
  barcode          text,
  category_name    text,
  current_qty      numeric(16,3) not null default 0,
  purchase_price   numeric(14,2) not null default 0,
  sale_price       numeric(14,2) not null default 0,
  is_raw_material  boolean not null default false,
  refs_text        text,
  cars_text        text,
  refs_count       integer not null default 0,
  cars_count       integer not null default 0,
  upd              timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- Customer feedback from the public /client page ---------------------------------------
create table if not exists public.client_feedbacks (
  id          text primary key default gen_random_uuid()::text,
  part        text not null check (part in ('fuel','restaurant','cafeteria','lavage','magasin2')),
  full_name   text check (full_name is null or length(btrim(full_name)) between 1 and 120),
  phone       text check (phone is null or length(btrim(phone)) between 1 and 40),
  email       text check (email is null or length(btrim(email)) <= 160),
  message     text not null check (length(btrim(message)) between 3 and 4000),
  status      text not null default 'unread' check (status in ('unread','read')),
  read_at     timestamptz,
  read_by     text,
  created_at  timestamptz not null default now()
);


-- created_at on every table (the app sorts and paginates on it) -------------------------
do $$
declare t text;
begin
  foreach t in array array['worker_acomptes','worker_absences','worker_payment_records',
    'pompiste_decalage_history','purchase_payments','delivery_note_payments',
    'supplier_appointments','supplier_debt_payments','product_brands','biz_store'] loop
    execute format('alter table public.%I add column if not exists created_at timestamptz default now()', t);
  end loop;
end $$;
alter table public.activity_log add column if not exists module    text;
alter table public.activity_log add column if not exists user_name text;

-- =====================================================================================
--  §7  RELATIONS (foreign keys) + INDEXES
--      Child rows are removed with their parent (on delete cascade); optional links
--      are cleared (on delete set null). Added only if missing → re-runnable.
-- =====================================================================================
do $$
declare
  r record;
begin
  for r in
    select * from (values
      -- name                              child table                          column              parent            on delete
      ('fk_pumps_tank',                    'pumps',                             'tank_id',          'tanks',          'set null'),
      ('fk_pumps_track',                   'pumps',                             'track_id',         'tracks',         'set null'),
      ('fk_nozzles_pump',                  'pump_nozzles',                      'pump_id',          'pumps',          'cascade'),
      ('fk_nozzles_tank',                  'pump_nozzles',                      'tank_id',          'tanks',          'set null'),
      ('fk_pompistes_track',               'pompistes',                         'track_id',         'tracks',         'set null'),
      ('fk_pompistes_chef',                'pompistes',                         'chef_id',          'brigade_chefs',  'set null'),
      ('fk_cpa_chef',                      'chef_pompiste_assignments',         'chef_id',          'brigade_chefs',  'cascade'),
      ('fk_cpa_pompiste',                  'chef_pompiste_assignments',         'pompiste_id',      'pompistes',      'cascade'),
      ('fk_bpa_brigade',                   'brigade_pompiste_assignments',      'brigade_id',       'brigades',       'cascade'),
      ('fk_bpa_pompiste',                  'brigade_pompiste_assignments',      'pompiste_id',      'pompistes',      'cascade'),
      ('fk_versements_brigade',            'brigade_versements',                'brigade_id',       'brigades',       'cascade'),
      ('fk_accounting_brigade',            'brigade_accounting',                'brigade_id',       'brigades',       'cascade'),
      ('fk_justif_accounting',             'brigade_accounting_justifications', 'accounting_id',    'brigade_accounting', 'cascade'),
      ('fk_justif_client',                 'brigade_accounting_justifications', 'client_id',        'clients',        'set null'),
      ('fk_justif_track',                  'brigade_accounting_justifications', 'track_id',         'tracks',         'set null'),
      ('fk_justif_pompiste',               'brigade_accounting_justifications', 'pompiste_id',      'pompistes',      'set null'),
      ('fk_justif_bank',                   'brigade_accounting_justifications', 'bank_account_id',  'bank_accounts',  'set null'),
      ('fk_tpe_brigade',                   'tpe_transactions',                  'brigade_id',       'brigades',       'cascade'),
      ('fk_tpe_accounting',                'tpe_transactions',                  'accounting_id',    'brigade_accounting', 'cascade'),
      ('fk_tpe_client',                    'tpe_transactions',                  'client_id',        'clients',        'set null'),
      ('fk_tpe_track',                     'tpe_transactions',                  'track_id',         'tracks',         'set null'),
      ('fk_tpe_pompiste',                  'tpe_transactions',                  'pompiste_id',      'pompistes',      'set null'),
      ('fk_tpe_bank',                      'tpe_transactions',                  'bank_account_id',  'bank_accounts',  'set null'),
      ('fk_alerts_brigade',                'brigade_decalage_alerts',           'brigade_id',       'brigades',       'cascade'),
      ('fk_decalage_hist_pompiste',        'pompiste_decalage_history',         'pompiste_id',      'pompistes',      'cascade'),
      ('fk_decalage_hist_brigade',         'pompiste_decalage_history',         'brigade_id',       'brigades',       'cascade'),
      ('fk_fuel_sales_pump',               'fuel_sales',                        'pump_id',          'pumps',          'set null'),
      ('fk_fuel_sales_client',             'fuel_sales',                        'client_id',        'clients',        'set null'),
      ('fk_fuel_sales_pompiste',           'fuel_sales',                        'pompiste_id',      'pompistes',      'set null'),
      ('fk_fuel_sales_brigade',            'fuel_sales',                        'brigade_id',       'brigades',       'set null'),
      ('fk_dn_supplier',                   'delivery_notes',                    'supplier_id',      'suppliers',      'set null'),
      ('fk_dn_tank',                       'delivery_notes',                    'tank_id',          'tanks',          'set null'),
      ('fk_dn_driver',                     'delivery_notes',                    'driver_id',        'drivers',        'set null'),
      ('fk_dn_items_note',                 'delivery_note_items',               'delivery_note_id', 'delivery_notes', 'cascade'),
      ('fk_dn_items_tank',                 'delivery_note_items',               'tank_id',          'tanks',          'set null'),
      ('fk_dn_photos_note',                'delivery_note_photos',              'delivery_note_id', 'delivery_notes', 'cascade'),
      ('fk_dn_payments_note',              'delivery_note_payments',            'delivery_note_id', 'delivery_notes', 'cascade'),
      ('fk_invoice_bls_invoice',           'fuel_invoice_bls',                  'invoice_id',       'fuel_invoices',  'cascade'),
      ('fk_invoice_bls_note',              'fuel_invoice_bls',                  'delivery_note_id', 'delivery_notes', 'cascade'),
      ('fk_receipt_inv_receipt',           'fuel_receipt_invoices',             'receipt_id',       'fuel_receipts',  'cascade'),
      ('fk_receipt_inv_invoice',           'fuel_receipt_invoices',             'invoice_id',       'fuel_invoices',  'cascade'),
      ('fk_client_tx_client',              'client_transactions',               'client_id',        'clients',        'cascade'),
      ('fk_client_appt_client',            'client_appointments',               'client_id',        'clients',        'cascade'),
      ('fk_supplier_appt_supplier',        'supplier_appointments',             'supplier_id',      'suppliers',      'cascade'),
      ('fk_supplier_pay_supplier',         'supplier_debt_payments',            'supplier_id',      'suppliers',      'cascade'),
      ('fk_products_brand',                'products',                          'brand_id',         'product_brands', 'set null'),
      ('fk_shop_sales_client',             'shop_sales',                        'client_id',        'clients',        'set null'),
      ('fk_shop_items_sale',               'shop_sale_items',                   'sale_id',          'shop_sales',     'cascade'),
      ('fk_purchases_supplier',            'purchases',                         'supplier_id',      'suppliers',      'set null'),
      ('fk_purchases_driver',              'purchases',                         'driver_id',        'drivers',        'set null'),
      ('fk_purchases_tank',                'purchases',                         'tank_id',          'tanks',          'set null'),
      ('fk_purchase_items_purchase',       'purchase_items',                    'purchase_id',      'purchases',      'cascade'),
      ('fk_purchase_items_tank',           'purchase_items',                    'tank_id',          'tanks',          'set null'),
      ('fk_purchase_payments_purchase',    'purchase_payments',                 'purchase_id',      'purchases',      'cascade'),
      ('fk_expenses_brigade',              'expenses',                          'brigade_id',       'brigades',       'set null'),
      ('fk_expenses_pompiste',             'expenses',                          'pompiste_id',      'pompistes',      'set null')
    ) as v(conname, child, col, parent, ondel)
  loop
    if not exists (select 1 from pg_constraint where conname = r.conname) then
      begin
        -- NOT VALID: never fails on legacy rows whose parent is already gone.
        execute format(
          'alter table public.%I add constraint %I foreign key (%I) references public.%I(id) on delete %s not valid',
          r.child, r.conname, r.col, r.parent, r.ondel);
      exception when others then
        raise notice 'FK % skipped: %', r.conname, sqlerrm;
      end;
    end if;
  end loop;
end $$;

-- Indexes (lookups the app does on every screen) ---------------------------------------
create index if not exists idx_nozzles_pump            on public.pump_nozzles (pump_id);
create index if not exists idx_nozzles_tank            on public.pump_nozzles (tank_id);
create index if not exists idx_brigades_date           on public.brigades (date);
create index if not exists idx_brigades_chef           on public.brigades (chef_id);
create index if not exists idx_accounting_brigade      on public.brigade_accounting (brigade_id);
create index if not exists idx_justif_accounting       on public.brigade_accounting_justifications (accounting_id);
create index if not exists idx_justif_client           on public.brigade_accounting_justifications (client_id);
create index if not exists idx_justif_type             on public.brigade_accounting_justifications (justification_type);
create index if not exists idx_tpe_brigade             on public.tpe_transactions (brigade_id);
create index if not exists idx_tpe_date                on public.tpe_transactions (date);
create index if not exists idx_alerts_brigade          on public.brigade_decalage_alerts (brigade_id);
create index if not exists idx_versements_brigade      on public.brigade_versements (brigade_id);
create index if not exists idx_fuel_sales_brigade      on public.fuel_sales (brigade_id);
create index if not exists idx_client_tx_client        on public.client_transactions (client_id);
create index if not exists idx_client_appt_client      on public.client_appointments (client_id);
create index if not exists idx_shop_items_sale         on public.shop_sale_items (sale_id);
create index if not exists idx_purchase_items_purchase on public.purchase_items (purchase_id);
create index if not exists idx_purchase_pay_purchase   on public.purchase_payments (purchase_id);
create index if not exists idx_dn_items_note           on public.delivery_note_items (delivery_note_id);
create index if not exists idx_expenses_date           on public.expenses (date desc);
create index if not exists idx_expenses_part           on public.expenses (part);
create index if not exists idx_expenses_account        on public.expenses (account_id);
create index if not exists idx_expenses_brigade        on public.expenses (brigade_id);
create index if not exists idx_treasury_date           on public.treasury_transactions (date desc);
create index if not exists idx_treasury_from           on public.treasury_transactions (account_from);
create index if not exists idx_treasury_to             on public.treasury_transactions (account_to);
create index if not exists idx_treasury_ref            on public.treasury_transactions (ref_type, ref_id);
create index if not exists idx_acomptes_worker         on public.worker_acomptes (worker_id);
create index if not exists idx_absences_worker         on public.worker_absences (worker_id);
create index if not exists idx_payments_worker         on public.worker_payment_records (worker_id);
create index if not exists idx_module_workers_module   on public.module_workers (module_key);
create unique index if not exists module_workers_username_key
  on public.module_workers (lower(username)) where username is not null;
create index if not exists biz_sessions_module_idx     on public.biz_sessions (module_key, opened_at desc);
create index if not exists biz_sessions_worker_idx     on public.biz_sessions (worker_id);
create unique index if not exists biz_sessions_one_open_per_worker
  on public.biz_sessions (module_key, worker_id) where status = 'open' and worker_id is not null;
create unique index if not exists biz_sessions_one_open_per_name
  on public.biz_sessions (module_key, lower(worker_name)) where status = 'open' and worker_id is null;
create index if not exists biz_products_module_idx     on public.biz_products (module_key, name);
create index if not exists biz_products_barcode_idx    on public.biz_products (barcode) where barcode is not null;
create index if not exists client_feedbacks_part_idx   on public.client_feedbacks (part, created_at desc);
do $$
declare t text;
begin
  foreach t in array array['pompistes','brigade_chefs','gerants','magasin_workers'] loop
    execute format('create index if not exists %I on public.%I (auth_user_id) where auth_user_id is not null',
                   t || '_auth_user_idx', t);
  end loop;
end $$;


-- =====================================================================================
--  §8  AUTH & PERMISSION HELPERS
-- =====================================================================================

-- Is the caller an administrator? -------------------------------------------------------
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admin_profiles where id = auth.uid());
$$;

-- Kept for older code paths.
create or replace function public.is_station_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin();
$$;

-- Does ANY admin exist yet? (hides the login page's « Créer un compte administrateur ») -
create or replace function public.admin_exists()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admin_profiles);
$$;

-- Role of the caller: admin | pompiste | chef_brigade | gerant | magasin | module_worker,
-- or NULL for an authenticated user who is linked to nothing (the app refuses access).
create or replace function public.get_my_role()
returns text language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then return null; end if;
  if exists (select 1 from public.admin_profiles  where id = v_uid)           then return 'admin';         end if;
  if exists (select 1 from public.pompistes       where auth_user_id = v_uid) then return 'pompiste';      end if;
  if exists (select 1 from public.brigade_chefs   where auth_user_id = v_uid) then return 'chef_brigade';  end if;
  if exists (select 1 from public.gerants         where auth_user_id = v_uid) then return 'gerant';        end if;
  if exists (select 1 from public.magasin_workers where auth_user_id = v_uid) then return 'magasin';       end if;
  if exists (select 1 from public.module_workers  where auth_user_id = v_uid) then return 'module_worker'; end if;
  return null;
end;
$$;

-- Any account that belongs to the station (admin or any worker with a login) ----------
create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select public.get_my_role() is not null;
$$;

-- The caller's worker row (pompiste / chef / gérant / magasin / part employee) ---------
create or replace function public.get_my_worker()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); r jsonb;
begin
  if v_uid is null then return null; end if;
  select to_jsonb(p) into r from public.pompistes       p where p.auth_user_id = v_uid limit 1; if r is not null then return r; end if;
  select to_jsonb(c) into r from public.brigade_chefs   c where c.auth_user_id = v_uid limit 1; if r is not null then return r; end if;
  select to_jsonb(g) into r from public.gerants         g where g.auth_user_id = v_uid limit 1; if r is not null then return r; end if;
  select to_jsonb(m) into r from public.magasin_workers m where m.auth_user_id = v_uid limit 1; if r is not null then return r; end if;
  select to_jsonb(w) into r from public.module_workers  w where w.auth_user_id = v_uid limit 1;
  return r;
end;
$$;

create or replace function public.get_my_module_worker()
returns jsonb language sql stable security definer set search_path = public as $$
  select to_jsonb(w) from public.module_workers w where w.auth_user_id = auth.uid() limit 1;
$$;

create or replace function public.my_module_worker_id()
returns text language sql stable security definer set search_path = public as $$
  select id from public.module_workers where auth_user_id = auth.uid() limit 1;
$$;

-- Permissions JSON of the caller (station worker) --------------------------------------
create or replace function public.my_permissions()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); p jsonb;
begin
  if v_uid is null then return '{}'::jsonb; end if;
  select permissions into p from public.pompistes       where auth_user_id = v_uid limit 1; if p is not null then return p; end if;
  select permissions into p from public.brigade_chefs   where auth_user_id = v_uid limit 1; if p is not null then return p; end if;
  select permissions into p from public.gerants         where auth_user_id = v_uid limit 1; if p is not null then return p; end if;
  select permissions into p from public.magasin_workers where auth_user_id = v_uid limit 1; if p is not null then return p; end if;
  select permissions into p from public.module_workers  where auth_user_id = v_uid limit 1;
  return coalesce(p, '{}'::jsonb);
end;
$$;

-- Has the caller been granted <action> on <module>?
--   station worker : permissions -> 'Clients' ->> 'supprimer'
--   part employee  : permissions ->> 'stock.supprimer'
--   admin          : always true
create or replace function public.has_permission(p_module text, p_action text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare p jsonb;
begin
  if public.is_admin() then return true; end if;
  p := public.my_permissions();
  return coalesce((p -> p_module ->> p_action)::boolean, false)
      or coalesce((p ->> (p_module || '.' || p_action))::boolean, false);
exception when others then
  return false;
end;
$$;

-- May the caller manage login accounts of station workers? (admin, or gérant / worker
-- granted « creer » or « modifier » on the matching screen) ----------------------------
create or replace function public.can_manage_worker_type(p_worker_type text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin()
      or public.has_permission(
           case p_worker_type
             when 'pompiste'     then 'Pompistes'
             when 'chef_brigade' then 'Pompistes'
             when 'gerant'       then 'Gérants'
             when 'magasin'      then 'Employés Magasin'
             else '__none__' end,
           'modifier')
      or public.has_permission(
           case p_worker_type
             when 'pompiste'     then 'Pompistes'
             when 'chef_brigade' then 'Pompistes'
             when 'gerant'       then 'Gérants'
             when 'magasin'      then 'Employés Magasin'
             else '__none__' end,
           'creer');
$$;

-- May the caller manage employees of a part? (admin, gérant, or an employee of that same
-- part granted « workers.modifier » / « workers.creer ») ------------------------------
create or replace function public.can_manage_module(p_module_key text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare w record;
begin
  if public.is_admin() then return true; end if;
  if exists (select 1 from public.gerants where auth_user_id = auth.uid()) then return true; end if;
  select module_key, permissions into w from public.module_workers where auth_user_id = auth.uid() limit 1;
  if w is null or w.module_key is distinct from p_module_key then return false; end if;
  return coalesce((w.permissions ->> 'workers.modifier')::boolean, false)
      or coalesce((w.permissions ->> 'workers.creer')::boolean, false);
end;
$$;

-- Resolve a username to its login email (sign in with username OR email) --------------
create or replace function public.email_for_username(p_username text)
returns text language sql stable security definer set search_path = auth, public as $$
  select u.email
    from auth.users u
   where lower(u.raw_user_meta_data ->> 'username') = lower(btrim(p_username))
   order by u.created_at
   limit 1;
$$;

-- Public identity of the station (name + logo) for the login and /client pages --------
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
--  §9  ACCOUNT RPCs — they write directly into auth.users + auth.identities
-- =====================================================================================

-- Low-level: create a CONFIRMED auth user that can sign in immediately ----------------
-- (the token columns MUST be '' and not NULL, otherwise GoTrue answers HTTP 500 on login)
create or replace function public._create_auth_user(p_email text, p_password text, p_meta jsonb default '{}'::jsonb)
returns uuid
language plpgsql security definer set search_path = auth, public, extensions as $$
declare
  v_uid   uuid;
  v_email text := lower(btrim(p_email));
  v_user  text := lower(btrim(coalesce(p_meta ->> 'username', '')));
begin
  if v_email = '' or v_email !~ '^[^@\s]+@[^@\s]+$' then
    raise exception 'Adresse email invalide : %', p_email;
  end if;
  if coalesce(length(p_password), 0) < 6 then
    raise exception 'Le mot de passe doit contenir au moins 6 caractères.';
  end if;
  if exists (select 1 from auth.users where lower(email) = v_email) then
    raise exception 'Cet email est déjà utilisé par un autre compte : %', v_email;
  end if;
  if v_user <> '' and exists (
       select 1 from auth.users where lower(raw_user_meta_data ->> 'username') = v_user) then
    raise exception 'Ce nom d''utilisateur est déjà pris : %', v_user;
  end if;

  v_uid := gen_random_uuid();

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, confirmation_sent_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data, is_super_admin, is_sso_user,
    confirmation_token, recovery_token, email_change,
    email_change_token_new, email_change_token_current,
    phone_change, phone_change_token, reauthentication_token
  ) values (
    '00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated',
    v_email, extensions.crypt(p_password, extensions.gen_salt('bf', 10)),
    now(), now(), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    coalesce(p_meta, '{}'::jsonb) || jsonb_build_object('username', nullif(v_user, '')),
    false, false,
    '', '', '', '', '', '', '', ''
  );

  insert into auth.identities (
    id, provider_id, user_id, identity_data, provider,
    last_sign_in_at, created_at, updated_at
  ) values (
    gen_random_uuid(), v_uid::text, v_uid,
    jsonb_build_object('sub', v_uid::text, 'email', v_email,
                       'email_verified', true, 'phone_verified', false),
    'email', now(), now(), now()
  );

  return v_uid;
end;
$$;

-- Change the password (and optionally the username) of an existing auth user ---------
create or replace function public._update_auth_user(p_uid uuid, p_password text, p_username text default null)
returns void
language plpgsql security definer set search_path = auth, public, extensions as $$
begin
  if p_password is not null and length(p_password) > 0 then
    if length(p_password) < 6 then
      raise exception 'Le mot de passe doit contenir au moins 6 caractères.';
    end if;
    update auth.users
       set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf', 10)),
           updated_at = now()
     where id = p_uid;
  end if;
  if p_username is not null and btrim(p_username) <> '' then
    if exists (select 1 from auth.users
                where id <> p_uid and lower(raw_user_meta_data ->> 'username') = lower(btrim(p_username))) then
      raise exception 'Ce nom d''utilisateur est déjà pris : %', p_username;
    end if;
    update auth.users
       set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb)
                                || jsonb_build_object('username', lower(btrim(p_username))),
           updated_at = now()
     where id = p_uid;
  end if;
end;
$$;

-- Delete an auth user (identities and sessions cascade) --------------------------------
create or replace function public._delete_auth_user(p_uid uuid)
returns void
language sql security definer set search_path = auth, public as $$
  delete from auth.users where id = p_uid;
$$;

-- FIRST administrator, from the login page. Refuses once an admin exists. -------------
create or replace function public.create_admin_account(
  p_name text, p_username text, p_email text, p_password text
)
returns jsonb
language plpgsql security definer set search_path = public, auth, extensions as $$
declare v_uid uuid;
begin
  -- Serialise concurrent first-run attempts.
  perform pg_advisory_xact_lock(hashtext('create_admin_account'));
  if exists (select 1 from public.admin_profiles) then
    return jsonb_build_object('ok', false, 'error', 'Un administrateur existe déjà.');
  end if;
  if coalesce(btrim(p_username), '') = '' then
    return jsonb_build_object('ok', false, 'error', 'Nom d''utilisateur requis.');
  end if;

  v_uid := public._create_auth_user(
    p_email, p_password,
    jsonb_build_object('name', p_name, 'username', lower(btrim(p_username)), 'role', 'admin'));

  insert into public.admin_profiles (id, name, username, email, role)
  values (v_uid, p_name, lower(btrim(p_username)), lower(btrim(p_email)), 'admin');

  return jsonb_build_object('ok', true, 'auth_user_id', v_uid::text);
exception when others then
  return jsonb_build_object('ok', false, 'error', sqlerrm);
end;
$$;

-- Station workers: create | update_password | delete their login ---------------------
-- p_worker_type: pompiste | chef_brigade | gerant | magasin
-- Without an email the login email is <username>@station.local (user signs in with the
-- username anyway).
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
language plpgsql security definer set search_path = public, auth, extensions as $$
declare
  v_tbl      text;
  v_uid      uuid;
  v_existing uuid;
  v_email    text;
  v_username text := lower(btrim(coalesce(p_username, '')));
begin
  if not public.can_manage_worker_type(p_worker_type) then
    return jsonb_build_object('ok', false, 'error', 'Permission refusée : gestion des comptes réservée à l''administrateur.');
  end if;

  v_tbl := case p_worker_type
    when 'pompiste'     then 'pompistes'
    when 'chef_brigade' then 'brigade_chefs'
    when 'gerant'       then 'gerants'
    when 'magasin'      then 'magasin_workers'
    else null end;
  if v_tbl is null then
    return jsonb_build_object('ok', false, 'error', 'Type de travailleur invalide : ' || coalesce(p_worker_type, '?'));
  end if;

  execute format('select auth_user_id from public.%I where id = $1', v_tbl) into v_existing using p_worker_id;

  if p_action in ('create', 'update_password') then
    if v_existing is not null and exists (select 1 from auth.users where id = v_existing) then
      -- Account already there: update password / username.
      perform public._update_auth_user(v_existing, p_password, nullif(v_username, ''));
      execute format('update public.%I set username = coalesce(nullif($1, ''''), username), has_access = true where id = $2', v_tbl)
        using v_username, p_worker_id;
      return jsonb_build_object('ok', true, 'auth_user_id', v_existing::text);
    end if;

    if v_username = '' then
      return jsonb_build_object('ok', false, 'error', 'Nom d''utilisateur requis.');
    end if;
    v_email := lower(coalesce(nullif(btrim(p_email), ''), v_username || '@station.local'));
    v_uid := public._create_auth_user(
      v_email, p_password,
      jsonb_build_object('name', p_name, 'username', v_username, 'role', p_worker_type, 'worker_id', p_worker_id));
    execute format('update public.%I set auth_user_id = $1, username = $2, has_access = true where id = $3', v_tbl)
      using v_uid, v_username, p_worker_id;
    return jsonb_build_object('ok', true, 'auth_user_id', v_uid::text);

  elsif p_action = 'delete' then
    execute format('update public.%I set auth_user_id = null, has_access = false where id = $1', v_tbl) using p_worker_id;
    if v_existing is not null then
      perform public._delete_auth_user(v_existing);
    end if;
    return jsonb_build_object('ok', true);
  end if;

  return jsonb_build_object('ok', false, 'error', 'Action inconnue : ' || coalesce(p_action, '?'));
exception when others then
  return jsonb_build_object('ok', false, 'error', sqlerrm);
end;
$$;

-- Part employees (Restaurant / Cafétéria / Magasin): create | update_password | delete --
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

-- Save a part employee's permissions (applied at their next login / refresh) ----------
create or replace function public.save_module_worker_permissions(p_worker_id text, p_permissions jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_module text;
begin
  select module_key into v_module from public.module_workers where id = p_worker_id;
  if v_module is null then
    return jsonb_build_object('ok', false, 'error', 'Employé sans compte : créez d''abord son accès.');
  end if;
  if not public.can_manage_module(v_module) then
    return jsonb_build_object('ok', false, 'error', 'Permission refusée.');
  end if;
  update public.module_workers
     set permissions = coalesce(p_permissions, '{}'::jsonb), updated_at = now()
   where id = p_worker_id;
  return jsonb_build_object('ok', true);
exception when others then
  return jsonb_build_object('ok', false, 'error', sqlerrm);
end;
$$;

-- When a worker row is deleted, its login disappears with it -------------------------
create or replace function public.trg_delete_worker_auth()
returns trigger language plpgsql security definer set search_path = public, auth as $$
begin
  if old.auth_user_id is not null then
    delete from auth.users where id = old.auth_user_id;
  end if;
  return old;
end;
$$;

-- A worker may edit his own profile, but never his own permissions / login link -------
create or replace function public.trg_guard_worker_columns()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_module text;
begin
  v_module := case tg_table_name
    when 'pompistes'       then 'Pompistes'
    when 'brigade_chefs'   then 'Pompistes'
    when 'gerants'         then 'Gérants'
    when 'magasin_workers' then 'Employés Magasin'
    else '__none__' end;
  if auth.uid() is null or public.is_admin()
     or public.has_permission(v_module, 'modifier') or public.has_permission(v_module, 'creer') then
    return new;   -- service role / SQL editor, admin, or a manager of that screen
  end if;
  if new.permissions  is distinct from old.permissions
     or new.auth_user_id is distinct from old.auth_user_id
     or new.has_access   is distinct from old.has_access
     or new.username     is distinct from old.username
     or new.base_salary  is distinct from old.base_salary then
    raise exception 'Permission refusée : seul l''administrateur peut modifier ces informations.';
  end if;
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['pompistes','brigade_chefs','gerants','magasin_workers','module_workers'] loop
    execute format('drop trigger if exists trg_delete_worker_auth on public.%I', t);
    execute format('create trigger trg_delete_worker_auth after delete on public.%I
                    for each row execute function public.trg_delete_worker_auth()', t);
  end loop;
  foreach t in array array['pompistes','brigade_chefs','gerants','magasin_workers'] loop
    execute format('drop trigger if exists trg_guard_worker_columns on public.%I', t);
    execute format('create trigger trg_guard_worker_columns before update on public.%I
                    for each row execute function public.trg_guard_worker_columns()', t);
  end loop;
end $$;


-- =====================================================================================
--  §10 BUSINESS RPCs + TRIGGERS
-- =====================================================================================

-- Tank: liters → degrees using the station's conversion table -------------------------
create or replace function public.tank_degrees_from_liters(p_tank_id text, p_liters numeric)
returns numeric language plpgsql stable set search_path = public as $$
declare v_curve jsonb; v_lower record; v_upper record;
begin
  select conversion_tables -> p_tank_id into v_curve from public.station_settings limit 1;
  if v_curve is null or jsonb_typeof(v_curve) <> 'array' or jsonb_array_length(v_curve) = 0 then
    return null;
  end if;
  select (e->>'degree')::numeric as degree, (e->>'liters')::numeric as liters into v_lower
    from jsonb_array_elements(v_curve) e
   where (e->>'liters')::numeric <= p_liters order by (e->>'liters')::numeric desc limit 1;
  select (e->>'degree')::numeric as degree, (e->>'liters')::numeric as liters into v_upper
    from jsonb_array_elements(v_curve) e
   where (e->>'liters')::numeric >= p_liters order by (e->>'liters')::numeric asc limit 1;
  if v_lower.liters is null then return v_upper.degree; end if;
  if v_upper.liters is null then return v_lower.degree; end if;
  if v_upper.liters = v_lower.liters then return v_lower.degree; end if;
  return v_lower.degree + (p_liters - v_lower.liters) / (v_upper.liters - v_lower.liters)
                        * (v_upper.degree - v_lower.degree);
end;
$$;

-- Tank: atomic level change (fuel sale = negative delta, delivery = positive) ---------
drop function if exists public.adjust_tank_level(uuid, numeric);
drop function if exists public.adjust_tank_level(text, numeric);
create function public.adjust_tank_level(p_tank_id text, p_delta numeric)
returns numeric language plpgsql security definer set search_path = public as $$
declare v_tank public.tanks%rowtype; v_new_liters numeric; v_new_degrees numeric;
begin
  if not public.is_staff() then raise exception 'Non autorisé'; end if;
  if p_tank_id is null or coalesce(p_delta, 0) = 0 then return null; end if;
  select * into v_tank from public.tanks where id = p_tank_id for update;
  if not found then raise exception 'adjust_tank_level: cuve % introuvable', p_tank_id; end if;
  v_new_liters := greatest(0, coalesce(v_tank.current, 0) + p_delta);
  if v_tank.type = 'GPL' then
    v_new_degrees := case when coalesce(v_tank.capacity, 0) > 0
                          then least(100, greatest(0, v_new_liters / v_tank.capacity * 100))
                          else v_tank.degrees end;
  else
    v_new_degrees := coalesce(public.tank_degrees_from_liters(p_tank_id, v_new_liters), v_tank.degrees);
  end if;
  update public.tanks set current = v_new_liters, degrees = v_new_degrees where id = p_tank_id;
  return v_new_liters;
end;
$$;

-- Treasury: credit a bank account (TPE of a brigade, etc.) ----------------------------
create or replace function public.credit_bank_account(
  p_account_id text, p_amount numeric, p_description text default null,
  p_ref_type text default null, p_ref_id text default null, p_part text default 'carburant'
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id text;
begin
  if not public.is_staff() then return jsonb_build_object('ok', false, 'error', 'Non autorisé'); end if;
  if p_account_id is null or p_amount is null or p_amount = 0 then
    return jsonb_build_object('ok', false, 'error', 'compte ou montant manquant');
  end if;
  v_id := gen_random_uuid()::text;
  insert into public.treasury_transactions (id, date, kind, amount, description, account_to, part, ref_type, ref_id)
  values (v_id, now()::text, 'TPE', p_amount, p_description, p_account_id, p_part, p_ref_type, p_ref_id);
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

-- Cascades the app relies on --------------------------------------------------------------
create or replace function public.cascade_delete_bank_account()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.treasury_transactions where account_from = old.id or account_to = old.id;
  return old;
end $$;
drop trigger if exists trg_cascade_delete_bank_account on public.bank_accounts;
create trigger trg_cascade_delete_bank_account before delete on public.bank_accounts
  for each row execute function public.cascade_delete_bank_account();

create or replace function public.cascade_delete_purchase()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.purchase_items    where purchase_id = old.id;
  delete from public.purchase_payments where purchase_id = old.id;
  delete from public.treasury_transactions where ref_type = 'purchase' and ref_id = old.id;
  return old;
end $$;
drop trigger if exists trg_cascade_delete_purchase on public.purchases;
create trigger trg_cascade_delete_purchase before delete on public.purchases
  for each row execute function public.cascade_delete_purchase();

create or replace function public.cascade_delete_expense()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.treasury_transactions where ref_type = 'expense' and ref_id = old.id;
  return old;
end $$;
drop trigger if exists trg_cascade_delete_expense on public.expenses;
create trigger trg_cascade_delete_expense before delete on public.expenses
  for each row execute function public.cascade_delete_expense();

-- biz_store: every write bumps `rev`, mirrored into biz_store_meta ----------------------
create or replace function public.biz_store_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  if new.rev is not distinct from old.rev then new.rev := old.rev + 1; end if;
  return new;
end;
$$;
drop trigger if exists biz_store_touch_trg on public.biz_store;
create trigger biz_store_touch_trg before update on public.biz_store
  for each row execute function public.biz_store_touch();

create or replace function public.biz_store_touch_meta()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.biz_store_meta (id, rev, updated_at)
  values (new.id, coalesce(new.rev, 0), now())
  on conflict (id) do update set rev = excluded.rev, updated_at = now();
  return new;
end;
$$;
drop trigger if exists biz_store_meta_sync on public.biz_store;
create trigger biz_store_meta_sync after insert or update on public.biz_store
  for each row execute function public.biz_store_touch_meta();

-- biz_store: optimistic-concurrency save (refuses to overwrite a newer state) ----------
create or replace function public.biz_store_save(p_id text, p_state jsonb, p_base_rev bigint default null)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare v_new_rev bigint; v_cur_rev bigint; v_cur jsonb;
begin
  if p_state is null or jsonb_typeof(p_state) <> 'object' then
    return jsonb_build_object('ok', false, 'error', 'État invalide : un objet JSON est attendu');
  end if;
  insert into public.biz_store (id, state, rev, updated_at)
       values (p_id, p_state, 1, now())
  on conflict (id) do update
       set state = excluded.state, rev = public.biz_store.rev + 1, updated_at = now()
     where p_base_rev is null or public.biz_store.rev = p_base_rev
  returning rev into v_new_rev;
  if v_new_rev is not null then
    return jsonb_build_object('ok', true, 'rev', v_new_rev);
  end if;
  select rev, state into v_cur_rev, v_cur from public.biz_store where id = p_id;
  return jsonb_build_object('ok', false, 'conflict', true, 'rev', v_cur_rev, 'state', v_cur);
end;
$$;

-- biz_sessions: owner can never be changed by a non-admin -----------------------------
create or replace function public.biz_sessions_touch()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  if not public.is_admin()
     and (new.worker_id is distinct from old.worker_id or new.auth_user_id is distinct from old.auth_user_id) then
    raise exception 'Le propriétaire d''une session de travail ne peut pas être modifié';
  end if;
  return new;
end;
$$;
drop trigger if exists biz_sessions_touch_trg on public.biz_sessions;
create trigger biz_sessions_touch_trg before update on public.biz_sessions
  for each row execute function public.biz_sessions_touch();

-- biz_products: searchable columns derived from `data` --------------------------------
create or replace function public.biz_safe_num(v text)
returns numeric language sql immutable as $$
  select case when v ~ '^[-+]?[0-9]+(\.[0-9]+)?([eE][-+]?[0-9]+)?$' then v::numeric else null end;
$$;

create or replace function public.biz_safe_ts(v text)
returns timestamptz language plpgsql stable as $$
begin return v::timestamptz; exception when others then return null; end;
$$;

create or replace function public.biz_jsonb_len(v_data jsonb, v_key text)
returns integer language sql immutable as $$
  select case when jsonb_typeof(v_data -> v_key) = 'array' then jsonb_array_length(v_data -> v_key) else 0 end;
$$;

create or replace function public.biz_product_refs_text(v_data jsonb)
returns text language sql immutable as $$
  select nullif(trim(coalesce(string_agg(concat_ws(' ',
      nullif(item ->> 'ref', ''),
      nullif(regexp_replace(coalesce(item ->> 'ref', ''), '[^a-zA-Z0-9]', '', 'g'), ''),
      nullif(item ->> 'brand', ''),
      nullif(item ->> 'note', '')), ' '), '')), '')
  from jsonb_array_elements(case when jsonb_typeof(v_data -> 'refs') = 'array' then v_data -> 'refs' else '[]'::jsonb end) t(item);
$$;

create or replace function public.biz_product_cars_text(v_data jsonb)
returns text language sql immutable as $$
  select nullif(trim(coalesce(string_agg(concat_ws(' ',
      nullif(item ->> 'marque', ''),
      nullif(item ->> 'name', ''),
      nullif(item ->> 'year', ''),
      case item ->> 'gearbox' when 'auto' then 'auto automatique' when 'manuelle' then 'manuel manuelle' else null end,
      nullif(item ->> 'description', '')), ' '), '')), '')
  from jsonb_array_elements(case when jsonb_typeof(v_data -> 'cars') = 'array' then v_data -> 'cars' else '[]'::jsonb end) t(item);
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
create trigger biz_products_derive_trg before insert or update on public.biz_products
  for each row execute function public.biz_products_derive();

do $$
declare v_schema text;
begin
  select n.nspname into v_schema from pg_opclass o join pg_namespace n on n.oid = o.opcnamespace
   where o.opcname = 'gin_trgm_ops' limit 1;
  if v_schema is null then return; end if;
  execute format('create index if not exists biz_products_refs_trgm_idx on public.biz_products
                  using gin (refs_text %I.gin_trgm_ops) where refs_text is not null', v_schema);
  execute format('create index if not exists biz_products_cars_trgm_idx on public.biz_products
                  using gin (cars_text %I.gin_trgm_ops) where cars_text is not null', v_schema);
exception when others then null;
end $$;

-- client_feedbacks: a public visitor can only create an unread, clean row --------------
create or replace function public.client_feedbacks_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.status     := 'unread';
  new.read_at    := null;
  new.read_by    := null;
  new.created_at := now();
  new.full_name  := nullif(btrim(coalesce(new.full_name, '')), '');
  new.phone      := nullif(btrim(coalesce(new.phone, '')), '');
  new.email      := nullif(btrim(coalesce(new.email, '')), '');
  new.message    := btrim(new.message);
  return new;
end;
$$;
drop trigger if exists client_feedbacks_before_insert_trg on public.client_feedbacks;
create trigger client_feedbacks_before_insert_trg before insert on public.client_feedbacks
  for each row execute function public.client_feedbacks_before_insert();

create or replace function public.client_feedbacks_before_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'read' and old.status is distinct from 'read' then
    new.read_at := coalesce(new.read_at, now());
  elsif new.status = 'unread' then
    new.read_at := null; new.read_by := null;
  end if;
  return new;
end;
$$;
drop trigger if exists client_feedbacks_before_update_trg on public.client_feedbacks;
create trigger client_feedbacks_before_update_trg before update on public.client_feedbacks
  for each row execute function public.client_feedbacks_before_update();


-- =====================================================================================
--  §11 ROW LEVEL SECURITY
--
--  Model
--    • Nobody without a station account (admin / worker) can read or write anything.
--    • Interfaces & buttons a worker sees come from the permissions the admin gave
--      him (enforced by the app's routes, sidebar and buttons).
--    • The DATABASE additionally enforces the destructive / sensitive actions:
--        – DELETE on a screen's main table requires « supprimer » on that screen;
--        – creating / editing workers and their logins requires the matching
--          permission, and nobody can grant himself permissions (trigger above);
--        – permission templates, admin profiles: administrators only.
-- =====================================================================================

-- Table → permission module used for the DELETE rule. Tables not listed here are
-- sub-records written together with their parent: any station account may delete them.
create table if not exists public.permission_table_map (
  table_name  text primary key,
  module_id   text not null
);
insert into public.permission_table_map (table_name, module_id) values
  ('brigades',               'Brigades'),
  ('brigade_accounting',     'Brigades'),
  ('tanks',                  'Cuves'),
  ('pumps',                  'Pompes'),
  ('pump_nozzles',           'Pompes'),
  ('tracks',                 'Pompes'),
  ('delivery_notes',         'Achats Carburant'),
  ('fuel_invoices',          'Achats Carburant'),
  ('fuel_receipts',          'Achats Carburant'),
  ('purchases',              'Achats Carburant'),
  ('inventories',            'Inventaires'),
  ('clients',                'Clients'),
  ('suppliers',              'Fournisseurs'),
  ('expenses',               'Dépenses'),
  ('bank_accounts',          'Comptes Bancaires'),
  ('treasury_transactions',  'Caisse Générale'),
  ('client_feedbacks',       'Retours Clients'),
  ('pompistes',              'Pompistes'),
  ('brigade_chefs',          'Pompistes'),
  ('gerants',                'Gérants'),
  ('magasin_workers',        'Employés Magasin')
on conflict (table_name) do update set module_id = excluded.module_id;
alter table public.permission_table_map enable row level security;
drop policy if exists ptm_read on public.permission_table_map;
create policy ptm_read on public.permission_table_map for select to authenticated using (true);

create or replace function public.can_delete_from(p_table text)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when public.is_admin() then true
    when not public.is_staff() then false
    else coalesce(
      (select public.has_permission(m.module_id, 'supprimer')
         from public.permission_table_map m where m.table_name = p_table),
      true)
  end;
$$;

-- Business tables -------------------------------------------------------------------------
do $$
declare
  t text;
  business_tables text[] := array[
    'station_settings','tracks','tanks','pumps','pump_nozzles','drivers',
    'brigades','brigade_pompiste_assignments','brigade_versements','brigade_accounting',
    'brigade_accounting_justifications','tpe_transactions','brigade_decalage_alerts',
    'fuel_sales','delivery_notes','delivery_note_items','delivery_note_photos',
    'delivery_note_payments','fuel_invoices','fuel_invoice_bls','fuel_receipts',
    'fuel_receipt_invoices','inventories','daily_reports',
    'chef_pompiste_assignments','worker_acomptes','worker_absences',
    'worker_payment_records','pompiste_decalage_history','activity_log',
    'clients','client_transactions','client_appointments','suppliers',
    'supplier_appointments','supplier_debt_payments','product_brands','products',
    'shop_sales','shop_sale_items','purchases','purchase_items','purchase_payments',
    'expenses','bank_accounts','treasury_transactions',
    'biz_store','biz_products'
  ];
  p record;
begin
  foreach t in array business_tables loop
    execute format('alter table public.%I enable row level security', t);
    -- drop every existing policy so re-runs never stack old permissive rules
    for p in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy if exists %I on public.%I', p.policyname, t);
    end loop;
    execute format('create policy staff_select on public.%I for select to authenticated using ((select public.is_staff()))', t);
    execute format('create policy staff_insert on public.%I for insert to authenticated with check ((select public.is_staff()))', t);
    execute format('create policy staff_update on public.%I for update to authenticated using ((select public.is_staff())) with check ((select public.is_staff()))', t);
    execute format('create policy perm_delete  on public.%I for delete to authenticated using ((select public.can_delete_from(%L)))', t, t);
  end loop;
end $$;

-- Worker tables: read by staff; create needs « creer », delete needs « supprimer »;
-- update open to staff (own profile, brigade bookkeeping) but sensitive columns are
-- guarded by trg_guard_worker_columns.
do $$
declare t text; m text; p record;
begin
  for t, m in select * from (values
      ('pompistes','Pompistes'), ('brigade_chefs','Pompistes'),
      ('gerants','Gérants'), ('magasin_workers','Employés Magasin')) v(tbl, modname)
  loop
    execute format('alter table public.%I enable row level security', t);
    for p in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy if exists %I on public.%I', p.policyname, t);
    end loop;
    execute format('create policy w_select on public.%I for select to authenticated using ((select public.is_staff()))', t);
    execute format('create policy w_insert on public.%I for insert to authenticated with check ((select public.has_permission(%L, ''creer'')))', t, m);
    execute format('create policy w_update on public.%I for update to authenticated using ((select public.is_staff())) with check ((select public.is_staff()))', t);
    execute format('create policy w_delete on public.%I for delete to authenticated using ((select public.has_permission(%L, ''supprimer'')))', t, m);
  end loop;
end $$;

-- module_workers: read by staff; written only through the RPCs above (or by admin) ----
alter table public.module_workers enable row level security;
drop policy if exists module_workers_read  on public.module_workers;
drop policy if exists module_workers_write on public.module_workers;
drop policy if exists mw_select on public.module_workers;
drop policy if exists mw_admin  on public.module_workers;
create policy mw_select on public.module_workers for select to authenticated
  using ((select public.is_staff()));
create policy mw_admin on public.module_workers for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- admin_profiles: own row, or every row for an admin -----------------------------------
alter table public.admin_profiles enable row level security;
drop policy if exists admin_self_select on public.admin_profiles;
drop policy if exists admin_self_update on public.admin_profiles;
drop policy if exists admin_manage      on public.admin_profiles;
create policy admin_self_select on public.admin_profiles for select to authenticated
  using (id = auth.uid() or (select public.is_staff()));
create policy admin_self_update on public.admin_profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
create policy admin_manage on public.admin_profiles for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- permission_templates: read by staff, written by admin (or « Paramètres › modifier ») --
alter table public.permission_templates enable row level security;
do $$ declare p record; begin
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'permission_templates' loop
    execute format('drop policy if exists %I on public.permission_templates', p.policyname);
  end loop;
end $$;
create policy pt_select on public.permission_templates for select to authenticated
  using ((select public.is_staff()));
create policy pt_write on public.permission_templates for all to authenticated
  using ((select public.has_permission('Paramètres', 'modifier')))
  with check ((select public.has_permission('Paramètres', 'modifier')));

-- cash_accounts: read-only reference data -----------------------------------------------
alter table public.cash_accounts enable row level security;
drop policy if exists cash_accounts_read on public.cash_accounts;
create policy cash_accounts_read on public.cash_accounts for select to authenticated using (true);

-- biz_store_meta: readable by everyone signed in (just a revision number) ------------
alter table public.biz_store_meta enable row level security;
drop policy if exists biz_store_meta_read on public.biz_store_meta;
create policy biz_store_meta_read on public.biz_store_meta for select to authenticated using (true);

-- biz_sessions: an employee owns his session; admin manages all --------------------------
alter table public.biz_sessions enable row level security;
drop policy if exists biz_sessions_read   on public.biz_sessions;
drop policy if exists biz_sessions_insert on public.biz_sessions;
drop policy if exists biz_sessions_update on public.biz_sessions;
drop policy if exists biz_sessions_delete on public.biz_sessions;
create policy biz_sessions_read on public.biz_sessions for select to authenticated
  using ((select public.is_staff()));
create policy biz_sessions_insert on public.biz_sessions for insert to authenticated
  with check ((select public.is_staff()) and (
    (select public.is_admin()) or worker_id is null or worker_id = (select public.my_module_worker_id())));
create policy biz_sessions_update on public.biz_sessions for update to authenticated
  using ((select public.is_admin()) or auth_user_id = auth.uid() or worker_id = (select public.my_module_worker_id()))
  with check ((select public.is_admin()) or auth_user_id = auth.uid() or worker_id = (select public.my_module_worker_id()));
create policy biz_sessions_delete on public.biz_sessions for delete to authenticated
  using ((select public.is_admin()));

-- client_feedbacks: anyone (public page) may post; staff reads; delete per permission --
alter table public.client_feedbacks enable row level security;
do $$ declare p record; begin
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'client_feedbacks' loop
    execute format('drop policy if exists %I on public.client_feedbacks', p.policyname);
  end loop;
end $$;
create policy cf_public_insert on public.client_feedbacks for insert to anon, authenticated
  with check (status = 'unread' and read_at is null and read_by is null);
create policy cf_select on public.client_feedbacks for select to authenticated
  using ((select public.is_staff()));
create policy cf_update on public.client_feedbacks for update to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));
create policy cf_delete on public.client_feedbacks for delete to authenticated
  using ((select public.can_delete_from('client_feedbacks')));

-- Table grants (RLS above decides which rows) -------------------------------------------
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant insert on public.client_feedbacks to anon;

-- Function grants -------------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
-- the login page (not signed in yet) needs these three:
grant execute on function public.admin_exists()                                   to anon;
grant execute on function public.create_admin_account(text, text, text, text)     to anon;
grant execute on function public.email_for_username(text)                         to anon;
grant execute on function public.public_station_identity()                        to anon;
-- internal helpers are never callable from the API:
revoke execute on function public._create_auth_user(text, text, jsonb) from authenticated;
revoke execute on function public._update_auth_user(uuid, text, text)  from authenticated;
revoke execute on function public._delete_auth_user(uuid)              from authenticated;


-- =====================================================================================
--  §12 STORAGE BUCKETS — every image of the app (public read, staff write)
--      station-logos    : station logo (Paramètres)
--      product-images   : carburant-part product photos
--      products         : Restaurant / Cafétéria / Magasin product & recipe photos
--      worker-photos    : worker / admin avatars
--      bon-photos       : fuel bons, sale bons
--      delivery-photos  : delivery notes (BL) photos
--      invoices         : supplier / fuel invoices & receipts
--      expense-receipts : expense receipts
--      client-receipts  : client payment receipts
-- =====================================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('station-logos',    'station-logos',    true, 5242880,  array['image/png','image/jpeg','image/webp','image/gif','image/svg+xml']),
  ('product-images',   'product-images',   true, 5242880,  array['image/png','image/jpeg','image/webp','image/gif']),
  ('products',         'products',         true, 5242880,  array['image/png','image/jpeg','image/webp','image/gif']),
  ('worker-photos',    'worker-photos',    true, 5242880,  array['image/png','image/jpeg','image/webp','image/gif']),
  ('bon-photos',       'bon-photos',       true, 10485760, array['image/png','image/jpeg','image/webp','image/gif','application/pdf']),
  ('delivery-photos',  'delivery-photos',  true, 10485760, array['image/png','image/jpeg','image/webp','image/gif','application/pdf']),
  ('invoices',         'invoices',         true, 10485760, array['image/png','image/jpeg','image/webp','image/gif','application/pdf']),
  ('expense-receipts', 'expense-receipts', true, 10485760, array['image/png','image/jpeg','image/webp','image/gif','application/pdf']),
  ('client-receipts',  'client-receipts',  true, 10485760, array['image/png','image/jpeg','image/webp','image/gif','application/pdf'])
on conflict (id) do update
  set public = true,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists sp_public_read  on storage.objects;
drop policy if exists sp_auth_insert  on storage.objects;
drop policy if exists sp_auth_update  on storage.objects;
drop policy if exists sp_auth_delete  on storage.objects;
drop policy if exists "Public Access for products bucket"        on storage.objects;
drop policy if exists "Public Upload for products bucket"        on storage.objects;
drop policy if exists "Public Update/Delete for products bucket" on storage.objects;

create policy sp_public_read on storage.objects for select to public
  using (bucket_id in ('station-logos','product-images','products','worker-photos','bon-photos',
                       'delivery-photos','invoices','expense-receipts','client-receipts'));
create policy sp_auth_insert on storage.objects for insert to authenticated
  with check (bucket_id in ('station-logos','product-images','products','worker-photos','bon-photos',
                            'delivery-photos','invoices','expense-receipts','client-receipts')
              and (select public.is_staff()));
create policy sp_auth_update on storage.objects for update to authenticated
  using (bucket_id in ('station-logos','product-images','products','worker-photos','bon-photos',
                       'delivery-photos','invoices','expense-receipts','client-receipts')
         and (select public.is_staff()));
create policy sp_auth_delete on storage.objects for delete to authenticated
  using (bucket_id in ('station-logos','product-images','products','worker-photos','bon-photos',
                       'delivery-photos','invoices','expense-receipts','client-receipts')
         and (select public.is_staff()));


-- =====================================================================================
--  §13 REALTIME — live updates (subscribeTable). biz_store itself is NOT published
--      (too big); the app listens to biz_store_meta and refetches.
-- =====================================================================================
do $$
declare t record;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  for t in
    select tablename from pg_tables
     where schemaname = 'public'
       and tablename not in ('biz_store', 'permission_table_map', 'cash_accounts')
  loop
    if not exists (select 1 from pg_publication_tables
                    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t.tablename) then
      begin
        execute format('alter publication supabase_realtime add table public.%I', t.tablename);
      exception when others then null;
      end;
    end if;
  end loop;
end $$;


-- =====================================================================================
--  §14 REPORTING VIEWS (security_invoker → they obey the RLS of their tables)
-- =====================================================================================
create or replace view public.v_account_balances with (security_invoker = true) as
  select a.id as account_id, a.name as account_name, 'banque'::text as account_type, 'systeme'::text as part,
         a.initial_balance,
         coalesce(a.initial_balance, 0)
           + coalesce((select sum(t.amount) from public.treasury_transactions t where t.account_to   = a.id), 0)
           - coalesce((select sum(t.amount) from public.treasury_transactions t where t.account_from = a.id), 0) as balance
    from public.bank_accounts a
  union all
  select c.id, c.name, 'caisse'::text, c.part, 0::numeric,
           coalesce((select sum(t.amount) from public.treasury_transactions t where t.account_to   = c.id), 0)
         - coalesce((select sum(t.amount) from public.treasury_transactions t where t.account_from = c.id), 0)
    from public.cash_accounts c;

create or replace view public.v_expenses_by_part with (security_invoker = true) as
  select coalesce(e.part, 'carburant') as part, coalesce(e.account_id, 'CAISSE') as account_id,
         count(*) as nb, sum(e.amount) as total
    from public.expenses e group by 1, 2 order by 1, 2;

create or replace view public.v_brigade_versement_totals with (security_invoker = true) as
  select brigade_id, pompiste_id, sum(amount) as total_verse, count(*) as nb_versements
    from public.brigade_versements group by brigade_id, pompiste_id;

create or replace view public.v_purchase_payment_appointments with (security_invoker = true) as
  select p.id as purchase_id, p.invoice_number, p.bl_number, p.supplier_id, s.name as supplier_name,
         p.appointment_date,
         coalesce(nullif(p.appointment_amount, 0), p.rest) as amount_due,
         p.rest, p.appointment_notes
    from public.purchases p
    left join public.suppliers s on s.id = p.supplier_id
   where coalesce(p.appointment_active, false) and not coalesce(p.appointment_paid, false)
     and coalesce(p.appointment_date, '') <> '' and coalesce(p.rest, 0) > 0
   order by p.appointment_date;

create or replace view public.v_biz_sessions_open with (security_invoker = true) as
  select s.module_key, s.id as session_id, s.ref, s.worker_id, s.worker_name, s.opening_cash,
         s.opened_at, now() - s.opened_at as duree, s.opened_by_name, w.username as compte
    from public.biz_sessions s
    left join public.module_workers w on w.id = s.worker_id
   where s.status = 'open'
   order by s.opened_at desc;

grant select on public.v_account_balances, public.v_expenses_by_part, public.v_brigade_versement_totals,
                public.v_purchase_payment_appointments, public.v_biz_sessions_open to authenticated;


-- =====================================================================================
--  §15 SEED ROWS
-- =====================================================================================
insert into public.cash_accounts (id, name, part, sort_order) values
  ('CAISSE',            'Caisse générale',    'systeme',    1),
  ('CAISSE_CARBURANT',  'Caisse Carburant',   'carburant',  2),
  ('CAISSE_RESTAURANT', 'Caisse Restaurant',  'restaurant', 3),
  ('CAISSE_CAFETERIA',  'Caisse Cafétéria',   'cafeteria',  4),
  ('CAISSE_LAVAGE',     'Caisse Magasin',     'lavage',     5),
  ('CAISSE_MAGASIN2',   'Caisse Magasin 2',   'magasin2',   6)
on conflict (id) do update set name = excluded.name, part = excluded.part, sort_order = excluded.sort_order;

insert into public.station_settings (id, name, fuel_prices, fuel_buy_prices,
  product_categories, expense_categories, product_units)
values (
  'settings-1', 'Station',
  '{"SUPER":14.80,"DIESEL":12.50,"ESSENCE":14.80,"GASOIL":12.50,"GPL":8.50}'::jsonb,
  '{"SUPER":0,"DIESEL":0,"ESSENCE":0,"GASOIL":0,"GPL":0}'::jsonb,
  '["Lubrifiants","Accessoires","Magasin","Boissons"]'::jsonb,
  '["Salaires","Entretien","Électricité","Eau","Loyer","Impôts","Divers"]'::jsonb,
  '["Pièce","Litre","Kg","Carton","Pack","Bidon"]'::jsonb
)
on conflict (id) do nothing;


-- =====================================================================================
--  §16 ARMOIRES, TRANSFERTS, BOUTEILLES DE GAZ & SECOND MAGASIN
--      Même contenu que supabase/migrations/2026-10-06_armoires_magasin2_bouteilles.sql
--      (idempotent : il met aussi à niveau une base créée avant cette version).
-- =====================================================================================


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

-- Ask PostgREST to reload its schema cache so the API sees everything immediately.
notify pgrst, 'reload schema';

-- Done. Next: open the app → « Créer un compte administrateur » on the login page.
