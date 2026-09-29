-- ─────────────────────────────────────────────────────────────────────────────
-- Worker payroll upgrade
--   • Every worker (pompiste / gérant / employé magasin, + legacy chef) can now
--     be paid per day (`salary_type = 'jour'`) or per month (`'mois'`, default),
--     carries the weekdays worked (`work_days`) and a CNAS declaration date.
--   • Payment records keep the exact days / months they settled (so those are
--     never billed twice), the décalage lines they applied (pompistes), and an
--     optional prime added on top of the net.
-- Safe to run more than once.
-- ─────────────────────────────────────────────────────────────────────────────

-- Worker tables ---------------------------------------------------------------
alter table if exists pompistes       add column if not exists salary_type text default 'mois';
alter table if exists pompistes       add column if not exists work_days   jsonb;
alter table if exists pompistes       add column if not exists cnas_date   date;

alter table if exists gerants          add column if not exists salary_type text default 'mois';
alter table if exists gerants          add column if not exists work_days   jsonb;
alter table if exists gerants          add column if not exists cnas_date   date;

alter table if exists magasin_workers  add column if not exists salary_type text default 'mois';
alter table if exists magasin_workers  add column if not exists work_days   jsonb;
alter table if exists magasin_workers  add column if not exists cnas_date   date;

-- Legacy chef table (kept in sync so the shared persistence path never errors).
alter table if exists brigade_chefs    add column if not exists salary_type text default 'mois';
alter table if exists brigade_chefs    add column if not exists work_days   jsonb;
alter table if exists brigade_chefs    add column if not exists cnas_date   date;

-- Payment records -------------------------------------------------------------
alter table if exists worker_payment_records add column if not exists paid_days    jsonb;
alter table if exists worker_payment_records add column if not exists paid_months  jsonb;
alter table if exists worker_payment_records add column if not exists decalage_ids jsonb;
alter table if exists worker_payment_records add column if not exists prime_type   text;
alter table if exists worker_payment_records add column if not exists prime_value  numeric;
alter table if exists worker_payment_records add column if not exists prime_amount numeric;
