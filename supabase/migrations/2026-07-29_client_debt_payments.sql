-- =====================================================================================
--  altech station — Migration « Règlements de dette client »
--
--  HOW TO RUN
--    Supabase → SQL Editor → New query → coller CE fichier entier → Run.
--    Le script est IDEMPOTENT : il peut être relancé sans risque.
--
--  À QUOI SERT CE SCRIPT
--    L'action « Payer la Dette » (page Clients, partie Carburant) :
--      1. insère le règlement dans `client_transactions`  → historique + reçu
--      2. reporte le montant sur `clients.debt`           → encours à jour
--    TOUT ceci existe déjà dans `supabase/setup.sql`. Ce fichier ne fait que
--    VÉRIFIER la base et remettre en place ce qui manquerait sur un projet créé
--    avant ces colonnes. Sur une base à jour il ne change strictement rien.
--
--  PRÉREQUIS
--    La table `clients` doit exister (elle vient de `supabase/setup.sql`).
--
--  CE QUE FAIT CE SCRIPT
--    1. Table `client_transactions` (+ colonnes manquantes)
--    2. Colonnes `debt` / `balance` / `advance_balance` sur `clients`
--    3. Index sur client_transactions(client_id) — l'historique est lu par client
--    4. RLS + policy `app_rw` sur les deux tables
--    5. Realtime (best effort)
--    6. Vérification finale : doit renvoyer « OK » sur chaque ligne
-- =====================================================================================

create extension if not exists pgcrypto;

-- =====================================================================================
--  1. client_transactions — une ligne par mouvement du compte client
--     type : 'PAYMENT'  → règlement de dette   (diminue clients.debt)
--            'RECHARGE' → versement d'avance   (augmente clients.balance)
--            'SALE'     → consommation à crédit (historique seul)
-- =====================================================================================
create table if not exists public.client_transactions (
  id                 text primary key default gen_random_uuid()::text,
  client_id          text,
  date               text,
  type               text,
  amount             numeric default 0,
  mode               text,          -- ESPECES | CHEQUE | VIREMENT
  receipt_number     text,          -- n° de chèque / référence du virement
  receipt_photo_url  text,
  notes              text,
  created_at         timestamptz default now()
);

-- Colonnes ajoutées une par une : une base créée avec une version plus ancienne
-- de la table garde ses données et récupère seulement ce qui manque.
alter table public.client_transactions add column if not exists client_id         text;
alter table public.client_transactions add column if not exists date              text;
alter table public.client_transactions add column if not exists type              text;
alter table public.client_transactions add column if not exists amount            numeric default 0;
alter table public.client_transactions add column if not exists mode              text;
alter table public.client_transactions add column if not exists receipt_number    text;
alter table public.client_transactions add column if not exists receipt_photo_url text;
alter table public.client_transactions add column if not exists notes             text;
alter table public.client_transactions add column if not exists created_at        timestamptz default now();

-- =====================================================================================
--  2. clients — le solde du compte, mis à jour par chaque règlement
-- =====================================================================================
alter table public.clients add column if not exists debt            numeric default 0;
alter table public.clients add column if not exists balance         numeric default 0;
alter table public.clients add column if not exists advance_balance numeric default 0;

-- Une dette NULL casserait le calcul « dette - montant réglé » : on repart de 0.
update public.clients set debt    = 0 where debt    is null;
update public.clients set balance = 0 where balance is null;

-- =====================================================================================
--  3. Index — l'historique des règlements est toujours lu client par client
-- =====================================================================================
create index if not exists client_transactions_client_id_idx
  on public.client_transactions (client_id);
create index if not exists client_transactions_created_at_idx
  on public.client_transactions (created_at desc);

-- =====================================================================================
--  4. RLS — l'application lit et écrit ces deux tables en tant qu'utilisateur
--     authentifié (même policy `app_rw` que le reste du schéma).
-- =====================================================================================
do $$
declare t text;
begin
  foreach t in array array['clients', 'client_transactions'] loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists app_rw on public.%I;', t);
    execute format(
      'create policy app_rw on public.%I for all to authenticated using (true) with check (true);', t
    );
  end loop;
end $$;

-- =====================================================================================
--  5. Realtime — best effort, ignore si déjà publié
-- =====================================================================================
do $$
declare t text;
begin
  foreach t in array array['clients', 'client_transactions'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I;', t);
    exception when others then
      null;   -- déjà dans la publication, ou publication absente
    end;
  end loop;
end $$;

-- =====================================================================================
--  6. VÉRIFICATION — chaque ligne doit afficher « OK »
-- =====================================================================================
select 'client_transactions.' || c.col as objet,
       case when exists (
         select 1 from information_schema.columns
         where table_schema = 'public' and table_name = 'client_transactions'
           and column_name = c.col
       ) then 'OK' else 'MANQUANT' end as etat
from (values ('client_id'),('date'),('type'),('amount'),('mode'),
             ('receipt_number'),('receipt_photo_url'),('notes'),('created_at')) as c(col)
union all
select 'clients.' || c.col,
       case when exists (
         select 1 from information_schema.columns
         where table_schema = 'public' and table_name = 'clients'
           and column_name = c.col
       ) then 'OK' else 'MANQUANT' end
from (values ('debt'),('balance'),('advance_balance')) as c(col)
union all
select 'policy app_rw sur ' || t.name,
       case when exists (
         select 1 from pg_policies
         where schemaname = 'public' and tablename = t.name and policyname = 'app_rw'
       ) then 'OK' else 'MANQUANT' end
from (values ('clients'),('client_transactions')) as t(name)
order by 1;
