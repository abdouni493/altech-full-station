-- =====================================================================================
--  DÉPENSES — CHAQUE ACTIVITÉ PAIE SES DÉPENSES AVEC SON PROPRE ARGENT
--  2026-08-16
--
--  CE QUI N'ALLAIT PAS
--  Une dépense n'appartenait à AUCUNE activité. Payée en espèces, elle sortait
--  toujours de la CAISSE GÉNÉRALE (`treasury_transactions.account_from = 'CAISSE'`,
--  `part = 'systeme'`), alors que le rapport Carburant, lui, la retranchait de la
--  caisse Carburant. Le même argent sortait donc DEUX fois : une fois de la
--  caisse générale à l'écran Finance, une fois de la caisse de l'activité dans
--  son rapport — et la caisse générale plongeait pour des dépenses qu'elle
--  n'avait jamais payées.
--
--  CE QUE FAIT CETTE MIGRATION
--    1. `expenses.part` — l'activité qui SUPPORTE la dépense (carburant,
--       cafeteria, lavage, systeme). Les dépenses déjà saisies passent au
--       Carburant : c'est là que l'application les comptait déjà.
--    2. Les lignes de trésorerie des dépenses en ESPÈCES sont ramenées sur le
--       coffre de leur activité (`CAISSE_CARBURANT`…) : la caisse générale
--       cesse d'être débitée d'un argent que l'activité a sorti de son tiroir.
--       Les dépenses réglées par BANQUE ne bougent pas — elles sont déjà sur le
--       bon compte.
-- =====================================================================================

-- =====================================================================================
--  1. L'ACTIVITÉ QUI SUPPORTE LA DÉPENSE
-- =====================================================================================

alter table public.expenses add column if not exists part text;

update public.expenses
   set part = 'carburant'
 where part is null;

alter table public.expenses
  drop constraint if exists expenses_part_check;
alter table public.expenses
  add constraint expenses_part_check
  check (part is null or part in ('carburant', 'cafeteria', 'lavage', 'systeme'));

create index if not exists idx_expenses_part on public.expenses (part);

comment on column public.expenses.part is
  'Activité qui supporte la dépense : carburant | cafeteria | lavage | systeme (Finance). '
  'Payée en espèces, la dépense sort de la caisse de CETTE activité — '
  'account_id = CAISSE_CARBURANT / CAISSE_CAFETERIA / CAISSE_LAVAGE, ou CAISSE pour la Finance.';

-- =====================================================================================
--  2. REPRISE — LES DÉPENSES EN ESPÈCES SORTENT DE LA CAISSE DE LEUR ACTIVITÉ
--
--     Sont concernées les seules dépenses réglées EN ESPÈCES (`account_id` vaut
--     une caisse, ou rien du tout sur les plus anciennes). Une dépense réglée
--     par chèque ou virement garde son compte bancaire.
-- =====================================================================================

-- 2a. Le compte débité de la dépense elle-même.
update public.expenses e
   set account_id = case e.part
                      when 'carburant' then 'CAISSE_CARBURANT'
                      when 'cafeteria' then 'CAISSE_CAFETERIA'
                      when 'lavage'    then 'CAISSE_LAVAGE'
                      else 'CAISSE'
                    end
 where coalesce(e.account_id, 'CAISSE') in
       ('CAISSE', 'CAISSE_CARBURANT', 'CAISSE_CAFETERIA', 'CAISSE_LAVAGE');

-- 2b. La ligne du grand livre qui porte le décaissement.
update public.treasury_transactions t
   set account_from = e.account_id,
       part         = e.part
  from public.expenses e
 where t.ref_type = 'expense'
   and t.ref_id   = e.id
   and coalesce(t.account_from, 'CAISSE') in
       ('CAISSE', 'CAISSE_CARBURANT', 'CAISSE_CAFETERIA', 'CAISSE_LAVAGE');

-- Contrôle : ce que chaque caisse a réellement payé en dépenses.
create or replace view public.v_expenses_by_part as
  select coalesce(e.part, 'carburant')            as part,
         coalesce(e.account_id, 'CAISSE')         as account_id,
         count(*)                                 as nb,
         sum(e.amount)                            as total
    from public.expenses e
   group by 1, 2
   order by 1, 2;

comment on view public.v_expenses_by_part is
  'Dépenses par activité et par compte débité — sert à vérifier qu''aucune '
  'dépense d''activité ne sort plus de la caisse générale.';
