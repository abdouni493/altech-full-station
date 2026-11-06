-- Taxes réutilisables, opérations TPE/TAG indépendantes, négociations bancaires,
-- factures Ventes Carburant. (Le mode démo n'en a pas besoin : schéma libre.)

create table if not exists tax_presets (
  id uuid primary key, name text not null, kind text not null default 'percent',
  value numeric not null default 0, created_at timestamptz default now()
);

alter table purchases add column if not exists extra_taxes jsonb default '[]'::jsonb;
alter table purchases add column if not exists extra_taxes_amount numeric default 0;

alter table brigade_accounting_justifications add column if not exists entry_mode text;
alter table brigade_accounting_justifications add column if not exists operations jsonb default '[]'::jsonb;
alter table brigade_accounting_justifications add column if not exists tag_type text;

create table if not exists tag_types (
  id uuid primary key, name text not null, created_at timestamptz default now()
);

create table if not exists bank_negotiations (
  id uuid primary key, bank_account_id uuid references bank_accounts(id) on delete cascade,
  date timestamptz not null, amount numeric not null default 0,
  item_keys jsonb default '[]'::jsonb, items jsonb default '[]'::jsonb,
  notes text, reference text, tx_id uuid, created_by text, created_at timestamptz default now()
);

alter table shop_sales add column if not exists invoice_meta jsonb;
