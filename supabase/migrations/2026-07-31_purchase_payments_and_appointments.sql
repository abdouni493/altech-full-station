-- =====================================================================================
--  altech station — Migration « Achats carburant : paiements multiples
--                     + rendez-vous de paiement »
--
--  HOW TO RUN
--    Supabase → SQL Editor → New query → coller CE fichier entier → Run.
--    Le script est IDEMPOTENT : il peut être relancé sans risque.
--
--  CE QUE FAIT CE SCRIPT
--    1. purchases → colonnes du rendez-vous de paiement (rappel sur le tableau
--       de bord tant que la dette n'est pas réglée)
--    2. purchase_payments → notes + garanties pour les règlements multiples
--       (plusieurs modes de paiement sur un même achat, chacun avec sa date,
--       son compte, son n° de chèque / bordereau)
--    3. Suppression en cascade des lignes et paiements quand un achat est
--       supprimé — l'application réécrit désormais ces lignes à chaque
--       modification, la base doit donc rester cohérente
--    4. Vue de suivi des rendez-vous de paiement
--    5. RLS / Realtime inchangés (tables déjà couvertes)
-- =====================================================================================

create extension if not exists pgcrypto;

-- =====================================================================================
--  1. ACHATS — RENDEZ-VOUS DE PAIEMENT
--     Activé à la création de l'achat : la station doit régler le reste dû à
--     `appointment_date`. Un bandeau d'alerte s'affiche en haut du tableau de
--     bord jusqu'au règlement (retard en rouge, aujourd'hui en orange).
-- =====================================================================================

alter table public.purchases add column if not exists appointment_active  boolean     default false;
alter table public.purchases add column if not exists appointment_date    date;
alter table public.purchases add column if not exists appointment_amount  numeric;
alter table public.purchases add column if not exists appointment_notes   text;
alter table public.purchases add column if not exists appointment_paid    boolean     default false;
alter table public.purchases add column if not exists appointment_paid_at timestamptz;

comment on column public.purchases.appointment_active is
  'Rendez-vous de paiement activé : un rappel s''affiche sur le tableau de bord.';
comment on column public.purchases.appointment_date is
  'Date à laquelle le reste dû doit être payé au fournisseur.';
comment on column public.purchases.appointment_amount is
  'Montant attendu ce jour-là ; NULL ⇒ la totalité du reste dû.';
comment on column public.purchases.appointment_paid is
  'true dès que la dette est soldée : le rappel disparaît du tableau de bord.';

-- Index de l'écran « rappels » : seules les échéances encore dues sont lues.
create index if not exists idx_purchases_appointment
  on public.purchases (appointment_date)
  where appointment_active and not coalesce(appointment_paid, false);

-- Cohérence : un achat déjà soldé n'a aucun rendez-vous à rappeler.
update public.purchases
   set appointment_active = false,
       appointment_paid   = true
 where coalesce(rest, 0) <= 0
   and coalesce(appointment_active, false);

-- =====================================================================================
--  2. PAIEMENTS D'ACHAT — PLUSIEURS MODES SUR UN MÊME ACHAT
--     Un achat peut être réglé par autant de lignes que nécessaire : espèces,
--     virement, plusieurs chèques… Chaque ligne porte son compte débité, sa
--     date, son mode et ses références.
-- =====================================================================================

alter table public.purchase_payments add column if not exists notes            text;
alter table public.purchase_payments add column if not exists bordereau_number text;
alter table public.purchase_payments add column if not exists account_id       text;

-- Un paiement sans compte est un paiement en espèces (caisse générale).
update public.purchase_payments
   set account_id = 'CAISSE'
 where account_id is null;

-- Modes acceptés par l'application.
do $$
begin
  begin
    alter table public.purchase_payments drop constraint if exists purchase_payments_mode_check;
    alter table public.purchase_payments
      add constraint purchase_payments_mode_check
      check (mode in ('ESPECES', 'CHEQUE', 'VIREMENT'));
  exception when others then null;
  end;
end $$;

create index if not exists idx_purchase_payments_purchase on public.purchase_payments (purchase_id);
create index if not exists idx_purchase_payments_account  on public.purchase_payments (account_id);
create index if not exists idx_purchase_payments_date     on public.purchase_payments (date desc);

comment on column public.purchase_payments.notes is
  'Note libre du règlement (ex: « acompte remis en main propre »).';

-- =====================================================================================
--  3. CASCADE — un achat supprimé emporte ses lignes et ses règlements
--     L'application réécrit désormais items + paiements à CHAQUE modification
--     (delete puis insert) : sans cascade, des lignes orphelines subsisteraient.
-- =====================================================================================

create or replace function public.cascade_delete_purchase()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.purchase_items    where purchase_id = old.id;
  delete from public.purchase_payments where purchase_id = old.id;
  -- Les mouvements de trésorerie de cet achat disparaissent aussi, sinon les
  -- soldes de la caisse et des comptes bancaires resteraient amputés.
  delete from public.treasury_transactions
   where ref_type = 'purchase' and ref_id = old.id;
  return old;
end $$;

drop trigger if exists trg_cascade_delete_purchase on public.purchases;
create trigger trg_cascade_delete_purchase
  before delete on public.purchases
  for each row execute function public.cascade_delete_purchase();

-- Ménage : lignes orphelines laissées par les modifications d'achats faites
-- AVANT ce correctif (les paiements ajoutés en modification n'étaient pas
-- enregistrés, et d'anciennes lignes pouvaient rester sans achat).
delete from public.purchase_items    pi
 where not exists (select 1 from public.purchases p where p.id = pi.purchase_id);
delete from public.purchase_payments pp
 where not exists (select 1 from public.purchases p where p.id = pp.purchase_id);

-- =====================================================================================
--  4. VUES DE SUIVI
-- =====================================================================================

-- Rendez-vous de paiement encore dus, les plus urgents d'abord.
-- `days_left` < 0 ⇒ en retard, 0 ⇒ aujourd'hui.
create or replace view public.v_purchase_payment_appointments as
  select
    p.id                                              as purchase_id,
    p.invoice_number,
    p.bl_number,
    p.supplier_id,
    s.name                                            as supplier_name,
    p.appointment_date,
    coalesce(nullif(p.appointment_amount, 0), p.rest) as amount_due,
    p.rest,
    p.appointment_notes,
    (p.appointment_date - current_date)               as days_left,
    case
      when p.appointment_date <  current_date then 'overdue'
      when p.appointment_date =  current_date then 'today'
      when p.appointment_date <= current_date + 7 then 'soon'
      else 'later'
    end                                               as urgency
  from public.purchases p
  left join public.suppliers s on s.id = p.supplier_id
 where coalesce(p.appointment_active, false)
   and not coalesce(p.appointment_paid, false)
   and p.appointment_date is not null
   and coalesce(p.rest, 0) > 0
 order by p.appointment_date asc;

-- Récapitulatif des règlements d'un achat (contrôle des paiements multiples).
create or replace view public.v_purchase_payment_summary as
  select
    p.id                                   as purchase_id,
    p.invoice_number,
    p.total,
    count(pp.id)                           as nb_reglements,
    coalesce(sum(pp.amount), 0)            as total_regle,
    p.total - coalesce(sum(pp.amount), 0)  as reste_calcule,
    p.rest                                 as reste_enregistre,
    count(*) filter (where pp.mode = 'ESPECES')  as nb_especes,
    count(*) filter (where pp.mode = 'CHEQUE')   as nb_cheques,
    count(*) filter (where pp.mode = 'VIREMENT') as nb_virements
  from public.purchases p
  left join public.purchase_payments pp on pp.purchase_id = p.id
 group by p.id, p.invoice_number, p.total, p.rest;

grant select on public.v_purchase_payment_appointments to authenticated;
grant select on public.v_purchase_payment_summary      to authenticated;

-- =====================================================================================
--  FIN — vérification rapide
-- =====================================================================================
select
  (select count(*) from public.purchases where coalesce(appointment_active, false)) as achats_avec_rdv,
  (select count(*) from public.v_purchase_payment_appointments)                     as rdv_en_attente,
  (select count(*) from public.v_purchase_payment_appointments where urgency = 'overdue') as rdv_en_retard,
  (select count(*) from public.purchase_payments)                                   as reglements_total,
  (select count(*) from public.purchase_payments where account_id <> 'CAISSE')       as reglements_bancaires;
