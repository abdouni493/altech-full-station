-- =====================================================================================
--  altech station — Migration « Caisse générale, comptes bancaires, pompes,
--  achats carburant, brigades, parties commerciales »
--
--  HOW TO RUN
--    Supabase → SQL Editor → New query → coller CE fichier entier → Run.
--    Le script est IDEMPOTENT : il peut être relancé sans risque.
--
--  CE QUE FAIT CE SCRIPT
--    1.  Nouvelles tables : bank_accounts, treasury_transactions, brigade_versements
--    2.  pump_nozzles.tank_id  → la cuve est portée par le PISTOLET (plus par la pompe)
--    3.  pumps.type / track_id → rendus optionnels (le type de pompe a été supprimé)
--    4.  purchases / purchase_payments → n° BL, remise, TVA détaillée, compte payeur
--    5.  products → prix de vente au détail
--    6.  TPE par compte bancaire (justifications de brigade + tpe_transactions)
--    7.  brigades → affectation pompiste ⇄ pompes, statut « En attente »
--    8.  module_workers → migration des parties supprimées (restaurant → cafeteria,
--        magasin → lavage) + contrainte sur les deux parties restantes
--    9.  biz_store → même migration côté données JSON des parties commerciales
--   10.  RLS + Realtime sur les nouvelles tables
--   11.  (OPTIONNEL, à la fin) suppression des tables des interfaces retirées
-- =====================================================================================

-- ── Extensions ───────────────────────────────────────────────────────────────────
create extension if not exists pgcrypto;

-- =====================================================================================
--  1. TRÉSORERIE : comptes bancaires + journal des mouvements
-- =====================================================================================

-- Un compte bancaire de la station. `initial_balance` est le solde saisi à la
-- création ; le solde courant est TOUJOURS recalculé par l'application comme
-- `initial_balance + somme des mouvements` (voir la vue plus bas).
create table if not exists public.bank_accounts (
  id               text primary key default gen_random_uuid()::text,
  name             text not null,
  account_number   text,
  initial_balance  numeric default 0,
  balance          numeric default 0,          -- cache, recalculé par l'app
  notes            text,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);

-- Journal unique de l'argent de la station.
--   account_from / account_to :
--     • 'CAISSE'          → la caisse générale (espèces)
--     • <bank_accounts.id> → un compte bancaire
--     • NULL               → l'extérieur (client, fournisseur, apport…)
--   kind : DEPOSIT | WITHDRAW | TRANSFER | PURCHASE | SALE | EXPENSE
--          | BRIGADE | TPE | SALARY | ADJUST
--   part : carburant | cafeteria | lavage | systeme
create table if not exists public.treasury_transactions (
  id                text primary key default gen_random_uuid()::text,
  date              text not null,
  kind              text not null default 'DEPOSIT',
  amount            numeric not null default 0,
  description       text,
  account_from      text,
  account_to        text,
  part              text not null default 'systeme',
  ref_type          text,                       -- 'purchase' | 'brigade' | 'sale'…
  ref_id            text,
  cheque_number     text,
  bordereau_number  text,
  created_by        text,
  created_at        timestamptz default now()
);

create index if not exists idx_treasury_date        on public.treasury_transactions (date desc);
create index if not exists idx_treasury_account_from on public.treasury_transactions (account_from);
create index if not exists idx_treasury_account_to   on public.treasury_transactions (account_to);
create index if not exists idx_treasury_ref          on public.treasury_transactions (ref_type, ref_id);

-- Supprimer un compte bancaire supprime ses mouvements (l'app fait déjà le ménage
-- localement ; ce trigger garantit la cohérence côté base).
create or replace function public.cascade_delete_bank_account()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.treasury_transactions
   where account_from = old.id or account_to = old.id;
  return old;
end $$;

drop trigger if exists trg_cascade_delete_bank_account on public.bank_accounts;
create trigger trg_cascade_delete_bank_account
  before delete on public.bank_accounts
  for each row execute function public.cascade_delete_bank_account();

-- Solde vivant de chaque compte + de la caisse générale.
create or replace view public.v_account_balances as
  select
    a.id                                        as account_id,
    a.name                                      as account_name,
    a.initial_balance,
    a.initial_balance
      + coalesce((select sum(t.amount) from public.treasury_transactions t where t.account_to   = a.id), 0)
      - coalesce((select sum(t.amount) from public.treasury_transactions t where t.account_from = a.id), 0)
                                                as balance
  from public.bank_accounts a
  union all
  select
    'CAISSE', 'Caisse générale', 0,
      coalesce((select sum(t.amount) from public.treasury_transactions t where t.account_to   = 'CAISSE'), 0)
    - coalesce((select sum(t.amount) from public.treasury_transactions t where t.account_from = 'CAISSE'), 0);

-- =====================================================================================
--  2. POMPES & PISTOLETS
--     La cuve est désormais choisie sur CHAQUE PISTOLET ; la pompe n'a plus de type.
-- =====================================================================================

alter table public.pump_nozzles add column if not exists tank_id text;

-- Reprise des données existantes : chaque pistolet hérite de la cuve de sa pompe.
update public.pump_nozzles n
   set tank_id = p.tank_id
  from public.pumps p
 where n.pump_id = p.id
   and n.tank_id is null
   and p.tank_id is not null;

create index if not exists idx_pump_nozzles_tank on public.pump_nozzles (tank_id);

-- `pumps.type` et `pumps.track_id` ne sont plus saisis : ils restent en base
-- (compatibilité des anciens rapports) mais ne doivent plus être obligatoires.
do $$
begin
  begin alter table public.pumps alter column type    drop not null; exception when others then null; end;
  begin alter table public.pumps alter column tank_id drop not null; exception when others then null; end;
  begin alter table public.pumps alter column track_id drop not null; exception when others then null; end;
end $$;

comment on column public.pump_nozzles.tank_id is
  'Cuve alimentant ce pistolet — choisie à la création du pistolet.';
comment on column public.pumps.tank_id is
  'Cuve principale, recopiée depuis le premier pistolet de la pompe (compatibilité).';
comment on column public.pumps.type is
  'Obsolète : le type de carburant vient de la cuve du pistolet.';

-- =====================================================================================
--  3. ACHATS CARBURANT — saisie unique (facture + BL + cuves + remise + paiements)
-- =====================================================================================

alter table public.purchases add column if not exists bl_number       text;
alter table public.purchases add column if not exists discount_type   text;   -- 'percent' | 'amount'
alter table public.purchases add column if not exists discount_value  numeric default 0;
alter table public.purchases add column if not exists discount_amount numeric default 0;
alter table public.purchases add column if not exists subtotal        numeric default 0;
alter table public.purchases add column if not exists tva_amount      numeric default 0;

-- Un paiement peut venir de la caisse ('CAISSE') ou d'un compte bancaire.
alter table public.purchase_payments add column if not exists bordereau_number text;
alter table public.purchase_payments add column if not exists account_id       text;

update public.purchase_payments
   set account_id = 'CAISSE'
 where account_id is null;

create index if not exists idx_purchase_payments_account on public.purchase_payments (account_id);

-- Reprise : sous-total des achats déjà enregistrés (aucune remise, aucune TVA).
update public.purchases
   set subtotal = coalesce(subtotal, 0)
 where subtotal is null or subtotal = 0;

comment on column public.purchases.bl_number is 'Numéro du bon de livraison saisi sur l''achat.';
comment on column public.purchase_payments.account_id is
  '''CAISSE'' pour un paiement en espèces, sinon bank_accounts.id.';

-- =====================================================================================
--  4. PRODUITS — vente au détail (fraction d'une unité conditionnée)
-- =====================================================================================

alter table public.products add column if not exists sell_by_details   boolean default false;
alter table public.products add column if not exists detail_capacity   numeric;
alter table public.products add column if not exists detail_unit       text;
alter table public.products add column if not exists detail_sale_price numeric;

comment on column public.products.detail_capacity is
  'Contenance d''une unité (ex: 50 pour un bidon de 50 L).';
comment on column public.products.detail_sale_price is
  'Prix d''une unité de détail ; vide ⇒ selling_price / detail_capacity.';

-- =====================================================================================
--  5. TPE PAR COMPTE BANCAIRE
--     Chaque compte bancaire possède son propre TPE : la justification de brigade
--     désigne le compte crédité, et l'argent y est ajouté.
-- =====================================================================================

alter table public.brigade_accounting_justifications
  add column if not exists bank_account_id text;

alter table public.tpe_transactions
  add column if not exists bank_account_id text;

create index if not exists idx_justifs_bank_account on public.brigade_accounting_justifications (bank_account_id);
create index if not exists idx_tpe_bank_account     on public.tpe_transactions (bank_account_id);

comment on column public.brigade_accounting_justifications.bank_account_id is
  'Compte bancaire du TPE crédité par cette justification.';

-- =====================================================================================
--  6. BRIGADES — affectation pompiste ⇄ pompes, versements espèce, statut en attente
-- =====================================================================================

-- Un pompiste peut tenir PLUSIEURS pompes sur la même brigade.
-- Forme : [{ "pompisteId": "...", "pumpIds": ["...", "..."] }, …]
alter table public.brigades
  add column if not exists pompiste_pump_assignments jsonb default '[]'::jsonb;

-- Versements espèce portés par la brigade (miroir JSON de brigade_versements,
-- écrit par l'application en même temps que le reste de la brigade).
-- Forme : [{ "id":"…", "pompisteId":"…", "amount":0, "at":"2026-07-29T14:35", "notes":"…" }, …]
alter table public.brigades
  add column if not exists versements jsonb default '[]'::jsonb;

-- La brigade reste « En attente » tant qu'aucun versement espèce n'a été saisi ;
-- elle passe « Clôturée » dès qu'un montant est enregistré.
comment on column public.brigades.status is
  'Planifiée | Ouverte | En attente | Clôturée | Fermée';

-- Plusieurs versements en espèces par pompiste et par brigade, horodatés à la
-- minute. Ils justifient l'écart entre le théorique et l'argent réellement remis.
create table if not exists public.brigade_versements (
  id           text primary key default gen_random_uuid()::text,
  brigade_id   text not null,
  pompiste_id  text not null,
  amount       numeric not null default 0,
  -- Horodatage du versement (avec l'heure et la minute).
  versed_at    timestamptz not null default now(),
  notes        text,
  created_by   text,
  created_at   timestamptz default now()
);

create index if not exists idx_versements_brigade  on public.brigade_versements (brigade_id);
create index if not exists idx_versements_pompiste on public.brigade_versements (pompiste_id);

-- Total remis par pompiste et par brigade — utilisé par la fiche de brigade.
create or replace view public.v_brigade_versement_totals as
  select brigade_id, pompiste_id, sum(amount) as total_verse, count(*) as nb_versements
    from public.brigade_versements
   group by brigade_id, pompiste_id;

-- Le chef de brigade n'est plus saisi à la création : la colonne reste pour
-- l'historique mais ne doit plus être obligatoire.
do $$
begin
  begin alter table public.brigades alter column chef_id drop not null; exception when others then null; end;
end $$;

-- Les niveaux de cuve ne sont plus saisis pendant la création de brigade : seuls
-- les index de pistolets le sont. Les colonnes restent pour l'historique.
comment on column public.brigades.start_tank_levels is
  'Historique — les niveaux de cuve ne sont plus saisis à la création de brigade.';
comment on column public.brigades.end_tank_levels is
  'Historique — les niveaux de cuve ne sont plus saisis à la création de brigade.';

-- =====================================================================================
--  7. PARTIES COMMERCIALES — Restaurant et Magasin supprimés
--     Restaurant → Cafétéria ; Magasin → Lavage & Réparation (qui reprend le
--     point de vente et les ventes).
-- =====================================================================================

update public.module_workers set module_key = 'cafeteria' where module_key = 'restaurant';
update public.module_workers set module_key = 'lavage'    where module_key = 'magasin';

-- Seules deux parties existent désormais.
do $$
begin
  begin
    alter table public.module_workers drop constraint if exists module_workers_module_key_check;
    alter table public.module_workers
      add constraint module_workers_module_key_check
      check (module_key in ('cafeteria', 'lavage'));
  exception when others then null;
  end;
end $$;

-- Les permissions des employés référencent des interfaces par leur id : celles
-- qui ont disparu sont retirées, et « services » devient « reparations ».
update public.module_workers
   set permissions = (
     select coalesce(jsonb_object_agg(key, value), '{}'::jsonb)
       from jsonb_each(permissions)
      where split_part(key, '.', 1) not in ('services')
   )
 where permissions is not null and permissions <> '{}'::jsonb;

-- Le magasin (partie) disparaît du stockage JSON partagé des parties commerciales :
-- ses produits, ventes, achats, clients… sont fusionnés dans « lavage », et le
-- restaurant dans « cafeteria ». L'application effectue la même fusion au
-- chargement ; ce bloc met la ligne partagée en cohérence immédiatement.
do $$
declare
  s jsonb;
  merged jsonb;
  coll text;
  colls text[] := array[
    'categories','marques','roles','products','purchases','sales','clients','suppliers',
    'workers','expenses','caisse','reparations','productions','fiches','comptoir',
    'destructions','sessions','payRequests'
  ];
begin
  select state into s from public.biz_store where id = 'biz-v1';
  if s is null then return; end if;

  -- restaurant → cafeteria
  if s ? 'restaurant' and s ? 'cafeteria' then
    foreach coll in array colls loop
      merged := coalesce(s->'cafeteria'->coll, '[]'::jsonb) || coalesce(s->'restaurant'->coll, '[]'::jsonb);
      s := jsonb_set(s, array['cafeteria', coll], merged, true);
    end loop;
    s := s - 'restaurant';
  else
    s := s - 'restaurant';
  end if;

  -- magasin → lavage
  if s ? 'magasin' and s ? 'lavage' then
    foreach coll in array colls loop
      merged := coalesce(s->'lavage'->coll, '[]'::jsonb) || coalesce(s->'magasin'->coll, '[]'::jsonb);
      s := jsonb_set(s, array['lavage', coll], merged, true);
    end loop;
    s := s - 'magasin';
  else
    s := s - 'magasin';
  end if;

  -- Le catalogue de services a été supprimé des deux parties restantes.
  s := jsonb_set(s, '{cafeteria}', (s->'cafeteria') - 'services', true);
  s := jsonb_set(s, '{lavage}',    (s->'lavage')    - 'services', true);

  update public.biz_store set state = s, updated_at = now() where id = 'biz-v1';
end $$;

-- =====================================================================================
--  8. PERMISSIONS — interfaces retirées / ajoutées côté carburant
-- =====================================================================================

-- Retire des permissions enregistrées les modules qui n'existent plus, pour que
-- personne ne conserve un accès à une interface supprimée.
do $$
declare
  removed text[] := array[
    'Ventes Carburant', 'Livraisons', 'Chefs de Brigade', 'Pistes', 'Magasin',
    'Produits', 'Achats',
    'Achats Carburant:Bons de Livraison', 'Achats Carburant:Facturation', 'Achats Carburant:Paiements'
  ];
  tbl text;
begin
  foreach tbl in array array['pompistes','brigade_chefs','gerants','magasin_workers'] loop
    execute format($f$
      update public.%I
         set permissions = (
           select coalesce(jsonb_object_agg(key, value), '{}'::jsonb)
             from jsonb_each(permissions)
            where key <> all ($1)
         )
       where permissions is not null and permissions <> '{}'::jsonb
    $f$, tbl) using removed;
  end loop;

  update public.permission_templates
     set permissions = (
       select coalesce(jsonb_object_agg(key, value), '{}'::jsonb)
         from jsonb_each(permissions)
        where key <> all (removed)
     )
   where permissions is not null and permissions <> '{}'::jsonb;
end $$;

-- =====================================================================================
--  9. RLS + REALTIME sur les nouvelles tables
-- =====================================================================================

alter table public.bank_accounts          enable row level security;
alter table public.treasury_transactions  enable row level security;
alter table public.brigade_versements     enable row level security;

do $$
declare t text;
begin
  foreach t in array array['bank_accounts','treasury_transactions','brigade_versements'] loop
    execute format('drop policy if exists %I on public.%I', t || '_all', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (true) with check (true)',
      t || '_all', t);
  end loop;
end $$;

do $$
begin
  begin execute 'alter publication supabase_realtime add table public.bank_accounts';         exception when others then null; end;
  begin execute 'alter publication supabase_realtime add table public.treasury_transactions'; exception when others then null; end;
  begin execute 'alter publication supabase_realtime add table public.brigade_versements';    exception when others then null; end;
end $$;

grant select on public.v_account_balances        to authenticated;
grant select on public.v_brigade_versement_totals to authenticated;

-- =====================================================================================
-- 10. RPC : créditer un compte bancaire (TPE de brigade)
--     Utilisé quand une justification TPE d'une brigade envoie l'argent vers le
--     compte bancaire du TPE choisi.
-- =====================================================================================

create or replace function public.credit_bank_account(
  p_account_id text,
  p_amount     numeric,
  p_description text default null,
  p_ref_type   text default null,
  p_ref_id     text default null,
  p_part       text default 'carburant'
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id text;
begin
  if p_account_id is null or p_amount is null or p_amount = 0 then
    return jsonb_build_object('ok', false, 'error', 'compte ou montant manquant');
  end if;

  v_id := gen_random_uuid()::text;
  insert into public.treasury_transactions
    (id, date, kind, amount, description, account_to, part, ref_type, ref_id)
  values
    (v_id, now()::text, 'TPE', p_amount, p_description, p_account_id, p_part, p_ref_type, p_ref_id);

  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

grant execute on function public.credit_bank_account(text, numeric, text, text, text, text) to authenticated;

-- =====================================================================================
-- 11. (OPTIONNEL) NETTOYAGE DES INTERFACES SUPPRIMÉES
--
--     Les écrans « Ventes Carburant », « Livraisons », « Chef de brigade »,
--     « Pistes », « Restaurant » et « Magasin » n'existent plus dans l'application.
--     Leurs tables sont CONSERVÉES par défaut pour ne perdre aucun historique.
--
--     Décommentez le bloc ci-dessous UNIQUEMENT si vous voulez supprimer
--     définitivement ces données. Cette opération est IRRÉVERSIBLE.
-- =====================================================================================

-- drop table if exists public.fuel_receipt_invoices cascade;
-- drop table if exists public.fuel_receipts         cascade;
-- drop table if exists public.fuel_invoice_bls      cascade;
-- drop table if exists public.fuel_invoices         cascade;
-- drop table if exists public.delivery_note_payments cascade;
-- drop table if exists public.delivery_note_photos   cascade;
-- drop table if exists public.delivery_note_items    cascade;
-- drop table if exists public.delivery_notes         cascade;
-- drop table if exists public.fuel_sales             cascade;
-- drop table if exists public.shop_sale_items        cascade;
-- drop table if exists public.shop_sales             cascade;
-- drop table if exists public.tracks                 cascade;
-- alter table public.pumps      drop column if exists track_id;
-- alter table public.pompistes  drop column if exists track_id;
-- drop table if exists public.chef_pompiste_assignments cascade;
-- drop table if exists public.brigade_chefs             cascade;

-- =====================================================================================
--  FIN — vérification rapide
-- =====================================================================================
select
  (select count(*) from public.bank_accounts)         as comptes_bancaires,
  (select count(*) from public.treasury_transactions) as mouvements_tresorerie,
  (select count(*) from public.brigade_versements)    as versements_brigade,
  (select count(*) from public.pump_nozzles where tank_id is not null) as pistolets_avec_cuve;
