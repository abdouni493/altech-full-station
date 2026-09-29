-- =====================================================================================
--  altech station — Migration « Dépenses payées par compte bancaire
--                     + Remise au point de vente + Accès rapide du comptoir »
--
--  HOW TO RUN
--    Supabase → SQL Editor → New query → coller CE fichier entier → Run.
--    Le script est IDEMPOTENT : il peut être relancé sans risque.
--
--  PRÉ-REQUIS
--    Les migrations précédentes doivent déjà être passées (elles créent
--    `bank_accounts`, `treasury_transactions` et `biz_store`) :
--      • module_workers_auth.sql
--      • 2026-07-29_treasury_pumps_purchases_brigades.sql
--      • 2026-07-31_purchase_payments_and_appointments.sql
--
--  CE QUE FAIT CE SCRIPT
--    1. expenses → `account_id` (caisse générale ou compte bancaire) et
--       `bordereau_number` : la dépense est débitée du compte choisi et
--       apparaît dans l'HISTORIQUE de ce compte
--    2. Suppression en cascade du mouvement de trésorerie d'une dépense
--       supprimée (sinon le solde du compte resterait amputé)
--    3. Vues de contrôle : dépenses par compte + historique consolidé d'un compte
--    4. biz_store (JSON des parties Cafétéria / Lavage) :
--         • `posPinned` → produits épinglés en accès rapide sur le point de vente
--         • ventes → `discountType` / `discountValue` (remise en % ou en montant)
--    5. (OPTIONNEL, à la fin) reprise des dépenses déjà saisies dans le journal
--       de trésorerie — À NE LANCER QUE SI VOUS LE VOULEZ (change les soldes)
-- =====================================================================================

create extension if not exists pgcrypto;

-- =====================================================================================
--  1. DÉPENSES — MODE DE PAIEMENT = CAISSE OU COMPTE BANCAIRE
--
--     `account_id` vaut :
--       • 'CAISSE'            → paiement en espèces sur la caisse générale
--       • <bank_accounts.id>  → l'argent sort de ce compte bancaire
--     L'application écrit en même temps une ligne dans `treasury_transactions`
--     (kind = 'EXPENSE', account_from = account_id, ref_type = 'expense'),
--     c'est elle qui fait apparaître la dépense dans l'historique du compte et
--     qui en diminue le solde.
-- =====================================================================================

alter table public.expenses add column if not exists account_id       text;
alter table public.expenses add column if not exists bordereau_number text;

-- Toute dépense enregistrée avant les comptes bancaires a été payée en espèces.
update public.expenses
   set account_id = 'CAISSE'
 where account_id is null;

create index if not exists idx_expenses_account on public.expenses (account_id);
create index if not exists idx_expenses_date    on public.expenses (date desc);

comment on column public.expenses.account_id is
  '''CAISSE'' pour une dépense en espèces, sinon bank_accounts.id — le compte débité.';
comment on column public.expenses.bordereau_number is
  'N° de bordereau du virement / versement quand la dépense sort d''un compte bancaire.';

-- =====================================================================================
--  2. CASCADE — une dépense supprimée emporte son mouvement de trésorerie
-- =====================================================================================

create or replace function public.cascade_delete_expense()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.treasury_transactions
   where ref_type = 'expense' and ref_id = old.id;
  return old;
end $$;

drop trigger if exists trg_cascade_delete_expense on public.expenses;
create trigger trg_cascade_delete_expense
  before delete on public.expenses
  for each row execute function public.cascade_delete_expense();

-- Ménage : mouvements « dépense » dont la dépense n'existe plus.
delete from public.treasury_transactions t
 where t.ref_type = 'expense'
   and not exists (select 1 from public.expenses e where e.id = t.ref_id);

-- =====================================================================================
--  3. VUES DE CONTRÔLE
-- =====================================================================================

-- Dépenses par compte payeur, avec le libellé du compte.
create or replace view public.v_expenses_by_account as
  select
    e.id,
    e.date,
    e.category,
    e.description,
    e.amount,
    e.payment_mode,
    e.cheque_number,
    e.bordereau_number,
    e.recipient,
    coalesce(e.account_id, 'CAISSE')                       as account_id,
    case
      when coalesce(e.account_id, 'CAISSE') = 'CAISSE' then 'Caisse générale'
      else coalesce(b.name, 'Compte supprimé')
    end                                                    as account_name,
    exists (
      select 1 from public.treasury_transactions t
       where t.ref_type = 'expense' and t.ref_id = e.id
    )                                                      as dans_le_journal
  from public.expenses e
  left join public.bank_accounts b on b.id = e.account_id;

-- Historique complet d'un compte (comptes bancaires ET caisse générale) :
-- toutes les lignes du journal, dépenses incluses, avec le solde progressif.
create or replace view public.v_account_history as
  with lines as (
    select
      a.id                            as account_id,
      a.name                          as account_name,
      t.id                            as tx_id,
      t.date,
      t.kind,
      t.description,
      t.ref_type,
      t.ref_id,
      t.cheque_number,
      t.bordereau_number,
      case when t.account_to = a.id then t.amount else -t.amount end as signed_amount
    from public.bank_accounts a
    join public.treasury_transactions t
      on t.account_to = a.id or t.account_from = a.id
    union all
    select
      'CAISSE', 'Caisse générale',
      t.id, t.date, t.kind, t.description, t.ref_type, t.ref_id,
      t.cheque_number, t.bordereau_number,
      case when t.account_to = 'CAISSE' then t.amount else -t.amount end
    from public.treasury_transactions t
   where t.account_to = 'CAISSE' or t.account_from = 'CAISSE'
  )
  select
    l.*,
    sum(l.signed_amount) over (
      partition by l.account_id order by l.date, l.tx_id
      rows between unbounded preceding and current row
    ) as solde_progressif
  from lines l;

grant select on public.v_expenses_by_account to authenticated;
grant select on public.v_account_history     to authenticated;

-- =====================================================================================
--  4. PARTIES COMMERCIALES (JSON) — ACCÈS RAPIDE DU POINT DE VENTE + REMISE
--
--     Les parties Cafétéria et Lavage vivent dans une seule ligne JSON
--     (`biz_store.id = 'biz-v1'`). Deux nouveautés y sont stockées :
--
--       • `posPinned` : liste ORDONNÉE des produits épinglés en « accès rapide »
--         sur le comptoir (les plus vendus s'affichent en tête de la grille).
--         Chaque entrée est une clé stable :
--             "product:<id>"   un produit du stock
--             "fiche:<id>"     une fiche technique en vente directe
--             "comptoir:<nom>" une production envoyée au comptoir
--
--       • sur chaque vente : `discountType` ('percent' | 'amount') et
--         `discountValue` — la remise saisie à la caisse. `reduction` reste le
--         montant réellement déduit, en DA, pour tous les rapports existants.
--
--     L'application applique la même migration au chargement ; ce bloc met la
--     ligne partagée en cohérence tout de suite.
-- =====================================================================================

do $$
declare
  s      jsonb;
  part   text;
  parts  text[] := array['cafeteria', 'lavage'];
begin
  if to_regclass('public.biz_store') is null then return; end if;
  select state into s from public.biz_store where id = 'biz-v1';
  if s is null then return; end if;

  foreach part in array parts loop
    if not (s ? part) then continue; end if;

    -- Accès rapide : créé vide s'il n'existe pas encore.
    if (s->part->'posPinned') is null or jsonb_typeof(s->part->'posPinned') <> 'array' then
      s := jsonb_set(s, array[part, 'posPinned'], '[]'::jsonb, true);
    end if;

    -- Ventes déjà enregistrées : une réduction existante était un montant fixe.
    s := jsonb_set(s, array[part, 'sales'], coalesce((
      select jsonb_agg(
        case
          when coalesce((sale->>'reduction')::numeric, 0) > 0
               and not (sale ? 'discountType')
            then sale
                 || jsonb_build_object('discountType', 'amount')
                 || jsonb_build_object('discountValue', (sale->>'reduction')::numeric)
          else sale
        end
        order by ord)
        from jsonb_array_elements(coalesce(s->part->'sales', '[]'::jsonb))
             with ordinality as t(sale, ord)
    ), '[]'::jsonb), true);
  end loop;

  update public.biz_store set state = s, updated_at = now() where id = 'biz-v1';
end $$;

-- =====================================================================================
--  5. (OPTIONNEL) REPRISE DES DÉPENSES DÉJÀ SAISIES DANS LE JOURNAL
--
--     Les dépenses créées AVANT cette mise à jour n'ont pas de ligne dans
--     `treasury_transactions` : elles s'affichent dans la caisse générale mais
--     n'ont jamais diminué son solde. Décommentez le bloc ci-dessous pour les
--     reprendre dans le journal.
--
--     ⚠️  ATTENTION : cette opération DIMINUE le solde de la caisse générale du
--     total de ces dépenses. Ne la lancez que si vos soldes actuels ne les
--     déduisent pas déjà. Elle ne peut pas être annulée automatiquement.
-- =====================================================================================

-- insert into public.treasury_transactions
--   (id, date, kind, amount, description, account_from, part, ref_type, ref_id,
--    cheque_number, bordereau_number, created_by)
-- select
--   gen_random_uuid()::text,
--   e.date,
--   'EXPENSE',
--   e.amount,
--   'Dépense ' || coalesce(e.category, '') || ' — ' || coalesce(e.description, ''),
--   coalesce(e.account_id, 'CAISSE'),
--   'systeme',
--   'expense',
--   e.id,
--   e.cheque_number,
--   e.bordereau_number,
--   e.created_by
--   from public.expenses e
--  where coalesce(e.amount, 0) > 0
--    and not exists (
--      select 1 from public.treasury_transactions t
--       where t.ref_type = 'expense' and t.ref_id = e.id
--    );

-- =====================================================================================
--  FIN — vérification rapide
-- =====================================================================================
select
  (select count(*) from public.expenses)                                        as depenses_total,
  (select count(*) from public.expenses where coalesce(account_id, 'CAISSE') <> 'CAISSE') as depenses_par_banque,
  (select count(*) from public.treasury_transactions where ref_type = 'expense') as depenses_dans_le_journal,
  (select count(*) from public.v_expenses_by_account where not dans_le_journal)  as depenses_hors_journal,
  (select jsonb_array_length(coalesce(state->'cafeteria'->'posPinned', '[]'::jsonb))
     from public.biz_store where id = 'biz-v1')                                 as acces_rapide_cafeteria,
  (select jsonb_array_length(coalesce(state->'lavage'->'posPinned', '[]'::jsonb))
     from public.biz_store where id = 'biz-v1')                                 as acces_rapide_lavage;
