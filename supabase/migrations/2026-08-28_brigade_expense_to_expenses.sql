-- =====================================================================================
--  LA DÉPENSE D'UNE BRIGADE DEVIENT UNE VRAIE DÉPENSE
--  2026-08-28
--
--  CE QUI N'ALLAIT PAS
--  Une brigade pouvait justifier son reste « par dépense » : le pompiste avait payé
--  quelque chose (eau, réparation, pourboire) avec les espèces de la brigade et
--  remettait d'autant moins. La justification ÉQUILIBRAIT la brigade — et s'arrêtait
--  là. La charge n'apparaissait nulle part : ni dans l'écran Dépenses, ni dans le
--  résultat du Carburant. De l'argent sortait de la station sans laisser de pièce.
--
--  CE QUE FAIT CETTE MIGRATION
--    0. Le RATTRAPAGE des colonnes que les migrations précédentes auraient dû poser
--       sur `expenses` — `account_id`, `bordereau_number` et surtout `part`. Sans
--       `part`, la reprise de l'étape 3 échouait sur
--       « column "part" of relation "expenses" does not exist ».
--    1. `brigade_accounting_justifications.expense_category` — la catégorie
--       (facultative) de la dépense, celle de l'écran Dépenses.
--    2. `expenses.brigade_id` / `.brigade_justification_id` / `.pompiste_id` — la
--       provenance d'une dépense née d'une brigade. C'est ce qui permet à l'écran
--       Dépenses d'afficher la brigade sur la carte, et à l'application de REPRENDRE
--       la dépense (au lieu d'en créer une seconde) quand la brigade est corrigée.
--    3. La reprise de l'existant : chaque justification « EXPENSE » déjà enregistrée
--       reçoit sa dépense, avec l'identifiant de la justification pour identifiant.
--
--  CE QU'ELLE NE FAIT PAS — ET POURQUOI
--  Aucune ligne de trésorerie n'est écrite pour ces dépenses : leur montant MANQUE
--  déjà aux espèces remises par la brigade (`brigade_accounting.cash_received`).
--  Les retirer d'une caisse ferait sortir le même argent deux fois. L'application
--  les écarte de toutes ses lectures de caisse (`isBrigadeExpense`).
--
--  Script IDEMPOTENT : sans risque à réexécuter.
--  À lancer EN UNE FOIS dans Supabase → Database → SQL Editor.
-- =====================================================================================

-- =====================================================================================
--  0. RATTRAPAGE — LES COLONNES QUE `expenses` DOIT AVOIR
--
--     Ce bloc reprend, sans rien casser, ce que les migrations 2026-08-01 et
--     2026-08-16 posaient. Si elles ont déjà été appliquées, il ne fait RIEN :
--     `add column if not exists` ne touche pas une colonne existante, et les
--     `update` ci-dessous ne visent que les lignes restées vides.
--
--     `part` est l'activité qui SUPPORTE la dépense (carburant, cafeteria, lavage,
--     systeme). C'est ce choix qui décide de quelle caisse sortent les espèces —
--     sans lui, une dépense de Cafétéria vidait le tiroir du Carburant.
-- =====================================================================================

alter table public.expenses add column if not exists account_id       text;
alter table public.expenses add column if not exists bordereau_number text;
alter table public.expenses add column if not exists part             text;

-- Toute dépense enregistrée avant les comptes bancaires a été payée en espèces.
update public.expenses set account_id = 'CAISSE' where account_id is null;

-- Les dépenses d'avant l'imputation étaient toutes comptées au Carburant :
-- c'est là qu'elles restent.
update public.expenses set part = 'carburant' where part is null;

alter table public.expenses drop constraint if exists expenses_part_check;
alter table public.expenses
  add constraint expenses_part_check
  check (part is null or part in ('carburant', 'cafeteria', 'lavage', 'systeme'));

create index if not exists idx_expenses_account on public.expenses (account_id);
create index if not exists idx_expenses_date    on public.expenses (date desc);
create index if not exists idx_expenses_part    on public.expenses (part);

comment on column public.expenses.part is
  'Activité qui supporte la dépense : carburant | cafeteria | lavage | systeme (Finance). '
  'Payée en espèces, la dépense sort de la caisse de CETTE activité — '
  'account_id = CAISSE_CARBURANT / CAISSE_CAFETERIA / CAISSE_LAVAGE, ou CAISSE pour la Finance.';

-- Le coffre de l'activité, et non plus la caisse générale, pour les dépenses réglées
-- EN ESPÈCES. Une dépense réglée par chèque ou virement garde son compte bancaire.
update public.expenses e
   set account_id = case e.part
                      when 'carburant' then 'CAISSE_CARBURANT'
                      when 'cafeteria' then 'CAISSE_CAFETERIA'
                      when 'lavage'    then 'CAISSE_LAVAGE'
                      else 'CAISSE'
                    end
 where coalesce(e.account_id, 'CAISSE') in
       ('CAISSE', 'CAISSE_CARBURANT', 'CAISSE_CAFETERIA', 'CAISSE_LAVAGE');

-- La ligne du grand livre suit la dépense : même compte débité, même activité.
update public.treasury_transactions t
   set account_from = e.account_id,
       part         = e.part
  from public.expenses e
 where t.ref_type = 'expense'
   and t.ref_id   = e.id
   and coalesce(t.account_from, 'CAISSE') in
       ('CAISSE', 'CAISSE_CARBURANT', 'CAISSE_CAFETERIA', 'CAISSE_LAVAGE');

-- =====================================================================================
--  1. LA CATÉGORIE DE LA JUSTIFICATION « DÉPENSE »
-- =====================================================================================

alter table public.brigade_accounting_justifications
  add column if not exists expense_category text;

comment on column public.brigade_accounting_justifications.expense_category is
  'Catégorie (facultative) d''une justification justification_type = ''EXPENSE'', '
  'reprise de settings.expense_categories. Le NOM de la dépense reste dans '
  'client_name et sa précision dans notes.';

-- Une dépense n'a ni client ni compte bancaire : la colonne doit accepter NULL.
-- (Déjà fait par 2026-08-27, répété ici pour que ce script suffise à lui seul.)
alter table public.brigade_accounting_justifications
  alter column client_id drop not null;

alter table public.brigade_accounting_justifications
  add column if not exists justification_type text not null default 'CLIENT',
  add column if not exists client_name        text,
  add column if not exists notes              text;

-- =====================================================================================
--  2. LA PROVENANCE D'UNE DÉPENSE
-- =====================================================================================

alter table public.expenses
  add column if not exists brigade_id               text,
  add column if not exists brigade_justification_id text,
  add column if not exists pompiste_id              text;

comment on column public.expenses.brigade_id is
  'La brigade qui a produit cette dépense (justification justification_type = ''EXPENSE''). '
  'Renseignée, elle signifie : payée sur les espèces de la brigade, donc DÉJÀ retranchée '
  'de cash_received — cette dépense ne sort d''aucune caisse et n''a aucune ligne de '
  'treasury_transactions.';
comment on column public.expenses.brigade_justification_id is
  'La justification de brigade dont la dépense est née — égale à son propre id.';
comment on column public.expenses.pompiste_id is
  'Le pompiste sur le lot duquel la dépense a été justifiée.';

create index if not exists idx_expenses_brigade_id on public.expenses (brigade_id);

-- =====================================================================================
--  3. REPRISE — LES JUSTIFICATIONS « DÉPENSE » DÉJÀ ENREGISTRÉES
--
--     Une dépense par justification, avec l'identifiant de la justification pour
--     identifiant : c'est la règle que suit l'application, et c'est elle qui garantit
--     qu'une brigade rouverte met la dépense À JOUR au lieu d'en créer une seconde.
--     `on conflict do nothing` rend la reprise rejouable sans risque.
-- =====================================================================================

insert into public.expenses (
  id, date, category, amount, description, payment_mode, account_id, part,
  paid_by, recipient, status, created_by,
  brigade_id, brigade_justification_id, pompiste_id)
select
  j.id,
  coalesce(nullif(b.date, ''), to_char(now(), 'YYYY-MM-DD')),
  coalesce(nullif(btrim(j.expense_category), ''), 'Dépense brigade'),
  j.amount,
  concat_ws(' — ',
    coalesce(nullif(btrim(j.client_name), ''), 'Dépense brigade'),
    nullif(btrim(j.notes), '')),
  'Espèces',
  'CAISSE_CARBURANT',
  'carburant',
  'Brigade',
  concat_ws(' — ',
    nullif(btrim(p.name), ''),
    btrim('Brigade ' || coalesce(nullif(btrim(b.shift), ''), ''))),
  'Validé',
  a.created_by,
  a.brigade_id,
  j.id,
  j.pompiste_id
from public.brigade_accounting_justifications j
join public.brigade_accounting a on a.id = j.accounting_id
left join public.brigades  b on b.id = a.brigade_id
left join public.pompistes p on p.id = j.pompiste_id
where j.justification_type = 'EXPENSE'
  and coalesce(j.amount, 0) > 0
on conflict (id) do nothing;

-- =====================================================================================
--  4. MÉNAGE — AUCUNE LIGNE DE TRÉSORERIE POUR CES DÉPENSES
--
--     Si une dépense de brigade a reçu une ligne de grand livre (l'étape 0 ci-dessus
--     en réaffecte, une édition manuelle depuis l'écran Dépenses en créait), elle
--     sortait le même argent une seconde fois. On la retire.
-- =====================================================================================

delete from public.treasury_transactions t
 using public.expenses e
 where t.ref_type = 'expense'
   and t.ref_id   = e.id
   and e.brigade_id is not null;

-- =====================================================================================
--  5. CONTRÔLE — ce que les brigades ont justifié en dépenses, et ce qui est écrit
-- =====================================================================================

create or replace view public.v_brigade_expenses as
  select e.brigade_id,
         b.date            as brigade_date,
         b.shift           as brigade_shift,
         p.name            as pompiste,
         e.category,
         e.description,
         e.amount
    from public.expenses e
    left join public.brigades  b on b.id = e.brigade_id
    left join public.pompistes p on p.id = e.pompiste_id
   where e.brigade_id is not null
   order by b.date desc nulls last, e.amount desc;

comment on view public.v_brigade_expenses is
  'Les dépenses nées d''une justification de brigade. Leur total doit égaler la somme '
  'des justifications justification_type = ''EXPENSE''. Elles ne sortent d''aucune caisse : '
  'leur montant manque déjà aux espèces remises par la brigade.';

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
