-- =====================================================================================
--  altech station — Migration « Dette initiale / avance initiale des clients »
--
--  COMMENT L'EXÉCUTER
--    Supabase → SQL Editor → New query → coller CE fichier entier → Run.
--    Le script est IDEMPOTENT : il peut être relancé sans risque.
--
--  LE PROBLÈME QU'IL RÈGLE
--    À la création d'une fiche client, l'écran demande un « encours initial »
--    (mode Crédit) ou un « versement initial d'avance » (mode Avance). Le montant
--    n'était écrit QUE dans les colonnes `clients.debt` / `clients.balance`.
--
--    Or tous les écrans lisent désormais le compte du client sur ses PIÈCES
--    (bons de brigade, factures magasin, règlements — voir `src/lib/clientLedger.ts`).
--    Aucune pièce ne portait la reprise : la dette initiale n'apparaissait donc
--    ni dans l'historique du client, ni sur sa carte, ni dans les rapports, et
--    l'écran signalait un « écart » entre la fiche et les documents.
--
--    L'ouverture devient une LIGNE du compte : datée, affichée, imprimée et
--    modifiable. Ce script crée les colonnes qui la portent.
--
--  CE QUE FAIT CE SCRIPT
--    1. Colonnes `opening_debt` / `opening_advance` / `opening_date` / `opening_notes`
--    2. REPRISE prudente des fiches déjà saisies (voir la condition, § 2)
--    3. Vérification finale : chaque ligne doit afficher « OK »
--
--    Les parties Cafétéria et Lavage n'ont RIEN à exécuter : leurs clients vivent
--    dans le blob JSON `biz_store`, les nouveaux champs y sont écrits tels quels.
-- =====================================================================================

-- =====================================================================================
--  1. Les colonnes de l'ouverture
-- =====================================================================================
alter table public.clients add column if not exists opening_debt    numeric default 0;
alter table public.clients add column if not exists opening_advance numeric default 0;
alter table public.clients add column if not exists opening_date    text;
alter table public.clients add column if not exists opening_notes   text;

update public.clients set opening_debt    = 0 where opening_debt    is null;
update public.clients set opening_advance = 0 where opening_advance is null;

-- =====================================================================================
--  2. REPRISE des fiches déjà saisies
--
--  On ne recopie `debt` dans `opening_debt` que pour les clients dont le compte
--  n'a AUCUNE pièce : ni règlement, ni recharge, ni bon de brigade. Pour ceux-là,
--  et seulement ceux-là, le compteur `debt` ne peut venir que de la saisie
--  d'ouverture — le recopier ne double donc rien.
--
--  Un client qui a déjà consommé garde `opening_debt = 0` : son compteur mêle la
--  reprise et les bons, et personne ne peut deviner la part de chacun. L'écran
--  Clients affiche l'écart et propose de le reprendre en un clic (bouton
--  « Reprendre l'écart en dette initiale », dossier du client) — c'est une
--  décision de gestion, pas un calcul.
-- =====================================================================================
update public.clients c
   set opening_debt = c.debt,
       opening_date = coalesce(c.opening_date, to_char(c.created_at, 'YYYY-MM-DD'))
 where coalesce(c.opening_debt, 0) = 0
   and coalesce(c.debt, 0) > 0
   and not exists (select 1 from public.client_transactions t where t.client_id = c.id)
   and not exists (select 1 from public.brigade_accounting_justifications j where j.client_id = c.id);

-- Même règle pour l'avance : un compte prépayé sans aucun mouvement porte, dans
-- `advance_balance`, exactement le versement d'ouverture.
update public.clients c
   set opening_advance = greatest(coalesce(c.advance_balance, c.balance, 0), 0),
       opening_date = coalesce(c.opening_date, to_char(c.created_at, 'YYYY-MM-DD'))
 where coalesce(c.opening_advance, 0) = 0
   and greatest(coalesce(c.advance_balance, c.balance, 0), 0) > 0
   and not exists (select 1 from public.client_transactions t where t.client_id = c.id)
   and not exists (select 1 from public.brigade_accounting_justifications j where j.client_id = c.id);

-- La date d'ouverture manquante retombe sur la création de la fiche : sans elle,
-- la ligne d'ouverture se placerait au milieu du journal au lieu de l'ouvrir.
update public.clients
   set opening_date = to_char(created_at, 'YYYY-MM-DD')
 where opening_date is null
   and (coalesce(opening_debt, 0) > 0 or coalesce(opening_advance, 0) > 0);

-- =====================================================================================
--  3. VÉRIFICATION — chaque ligne doit afficher « OK »
-- =====================================================================================
select 'clients.' || c.col as objet,
       case when exists (
         select 1 from information_schema.columns
         where table_schema = 'public' and table_name = 'clients'
           and column_name = c.col
       ) then 'OK' else 'MANQUANT' end as etat
from (values ('opening_debt'), ('opening_advance'), ('opening_date'), ('opening_notes')) as c(col)
union all
select 'fiches reprises (dette initiale)',
       count(*)::text
  from public.clients where coalesce(opening_debt, 0) > 0
union all
select 'fiches reprises (avance initiale)',
       count(*)::text
  from public.clients where coalesce(opening_advance, 0) > 0
order by 1;
