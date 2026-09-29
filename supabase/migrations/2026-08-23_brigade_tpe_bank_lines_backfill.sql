-- =====================================================================================
--  RATTRAPAGE — les encaissements TPE / TAG des brigades absents des comptes bancaires
--
--  ── Ce qui s'est passé ──────────────────────────────────────────────────────────────
--  Une justification de brigade TPE (ou TAG) est de l'argent arrivé EN BANQUE : le
--  rapport Carburant la compte dans « encaissé ». Le grand livre, lui, ne portait
--  pas toujours la ligne correspondante.
--
--  Réenregistrer une brigade RÉÉCRIT ses justifications : l'application supprime les
--  lignes de `brigade_accounting_justifications` puis les réinsère. Tant que
--  l'assistant ne rechargeait pas le compte du terminal dans son formulaire, une
--  simple correction de brigade remettait donc `bank_account_id` à **NULL en base** —
--  et effaçait au passage les lignes `treasury_transactions` de la brigade sans en
--  réécrire aucune.
--
--  Résultat observé sur la station Mosta : plus aucune ligne TPE après le
--  2026-08-20 sur « Naftal card », « Bea » et « TAC/MDN », alors que les brigades
--  des 21 et 22 août portent bien leurs justifications.
--
--  ── Ce qui a survécu ────────────────────────────────────────────────────────────────
--  Le LIBELLÉ. Le bouton « + TPE <compte> » de l'assistant écrit le nom du compte
--  dans `client_name` et dans `notes` (« TPE Naftal card », « TPE Bea »,
--  « TPE TAC/MDN »). C'est de là qu'on relit le compte.
--
--  ── Ce que fait ce script ───────────────────────────────────────────────────────────
--    1. rend son `bank_account_id` à chaque justification TPE / TAG qui l'a perdu,
--       en relisant le nom du compte dans son libellé ;
--    2. écrit au grand livre les lignes `TPE` manquantes, brigade par brigade et
--       compte par compte, en ne créant QUE la différence.
--
--  Il est REJOUABLE : le lancer deux fois n'ajoute rien la seconde fois.
--  Il est aussi PRUDENT : un libellé qui ne nomme aucun compte connu, ou qui en
--  nomme deux, n'est pas deviné — il est listé à la fin, à corriger à la main.
--
--  L'application fait exactement la même chose depuis l'écran « Comptes Bancaires »
--  (bandeau « Rattacher aux comptes ») — ce script n'est utile que pour agir
--  directement en base, ou pour vérifier ce que le bouton va faire.
-- =====================================================================================

begin;

-- ── 0. Le nom d'un compte, mis à plat pour la comparaison ───────────────────────────
--    Minuscules, tout ce qui n'est ni lettre ni chiffre ramené à un espace, et le
--    tout bordé d'espaces. « TPE TAC/MDN » devient ' tpe tac mdn '.
--    Les bornes sont ce qui empêche « Bea » de se reconnaître dans « Beaulieu ».
--    (Pas d'`unaccent` : l'extension n'est pas garantie, et aucun nom de compte de
--    la station ne porte d'accent. L'application, elle, les retire.)
create or replace function pg_temp.word_key(txt text)
returns text language sql immutable as $$
  select ' ' || btrim(regexp_replace(
           lower(coalesce(txt, '')), '[^a-z0-9]+', ' ', 'g')) || ' '
$$;

-- ── 1. Rendre son compte à chaque justification qui l'a perdu ───────────────────────
--     Le compte au nom le PLUS LONG l'emporte (entre « Bea » et « Bea Pro », c'est
--     le second) ; deux comptes reconnus à égalité ne désignent personne.
with candidate as (
  select j.id            as justif_id,
         b.id            as bank_id,
         length(btrim(pg_temp.word_key(b.name))) as name_len,
         count(*) over (partition by j.id,
                        length(btrim(pg_temp.word_key(b.name)))) as ties
    from public.brigade_accounting_justifications j
    join public.bank_accounts b
      on pg_temp.word_key(coalesce(j.client_name, j.notes))
         like '%' || pg_temp.word_key(b.name) || '%'
   where j.justification_type in ('TPE', 'TAG')
     and j.bank_account_id is null
     and coalesce(j.amount, 0) > 0
     and btrim(pg_temp.word_key(b.name)) <> ''
),
best as (
  select distinct on (justif_id) justif_id, bank_id, ties
    from candidate
   order by justif_id, name_len desc
)
update public.brigade_accounting_justifications j
   set bank_account_id = best.bank_id
  from best
 where j.id = best.justif_id
   and best.ties = 1;          -- une égalité parfaite n'est jamais devinée

-- ── 2. Écrire les lignes manquantes du grand livre ──────────────────────────────────
--     Comparaison PAR BRIGADE ET PAR COMPTE : ce que les justifications valent,
--     moins ce que le grand livre porte déjà. Seule la différence est insérée, ce
--     qui rend le script rejouable sans jamais créditer deux fois.
with due as (
  select a.brigade_id,
         j.bank_account_id                      as account_id,
         sum(j.amount)                          as amount_due,
         max(coalesce(br.end_datetime, br.date)) as at,
         max(br.date)                           as day
    from public.brigade_accounting_justifications j
    join public.brigade_accounting a on a.id = j.accounting_id
    join public.brigades           br on br.id = a.brigade_id
   where j.justification_type in ('TPE', 'TAG')
     and j.bank_account_id is not null
     and coalesce(j.amount, 0) > 0
   group by a.brigade_id, j.bank_account_id
),
booked as (
  select t.ref_id as brigade_id, t.account_to as account_id, sum(t.amount) as amount_booked
    from public.treasury_transactions t
   where t.ref_type = 'brigade' and t.kind = 'TPE' and t.account_to is not null
   group by t.ref_id, t.account_to
)
-- `id` est omis : la colonne porte déjà `default gen_random_uuid()::text`.
insert into public.treasury_transactions
  (date, kind, amount, description, account_to, part, ref_type, ref_id, created_by)
select due.at,
       'TPE',
       due.amount_due - coalesce(booked.amount_booked, 0),
       'TPE brigade du ' || due.day || ' — rattrapage',
       due.account_id,
       'carburant',
       'brigade',
       due.brigade_id,
       'rattrapage'
  from due
  left join booked
    on booked.brigade_id = due.brigade_id
   and booked.account_id = due.account_id
 where due.amount_due - coalesce(booked.amount_booked, 0) > 0.001;

commit;

-- =====================================================================================
--  VÉRIFICATIONS — à lire après le commit
-- =====================================================================================

-- A. Ce qui reste IRRÉCUPÉRABLE : un libellé qui ne nomme aucun compte connu.
--    À corriger à la main (rouvrir la brigade et choisir le compte), sinon cet
--    argent ne sera jamais sur un solde bancaire.
select a.brigade_id,
       br.date            as journee,
       j.justification_type,
       coalesce(j.client_name, j.notes) as libelle,
       j.amount
  from public.brigade_accounting_justifications j
  join public.brigade_accounting a  on a.id  = j.accounting_id
  join public.brigades           br on br.id = a.brigade_id
 where j.justification_type in ('TPE', 'TAG')
   and j.bank_account_id is null
   and coalesce(j.amount, 0) > 0
 order by br.date desc;

-- B. Contrôle par brigade et par compte : « dû » doit égaler « au grand livre ».
--    Toute ligne où les deux diffèrent est un reste à expliquer.
with due as (
  select a.brigade_id, j.bank_account_id as account_id, sum(j.amount) as amount_due
    from public.brigade_accounting_justifications j
    join public.brigade_accounting a on a.id = j.accounting_id
   where j.justification_type in ('TPE', 'TAG') and j.bank_account_id is not null
   group by a.brigade_id, j.bank_account_id
),
booked as (
  select ref_id as brigade_id, account_to as account_id, sum(amount) as amount_booked
    from public.treasury_transactions
   where ref_type = 'brigade' and kind = 'TPE' and account_to is not null
   group by ref_id, account_to
)
select br.date as journee, b.name as compte,
       due.amount_due, coalesce(booked.amount_booked, 0) as amount_booked,
       due.amount_due - coalesce(booked.amount_booked, 0) as ecart
  from due
  join public.brigades     br on br.id = due.brigade_id
  join public.bank_accounts b on b.id  = due.account_id
  left join booked on booked.brigade_id = due.brigade_id
                  and booked.account_id = due.account_id
 where abs(due.amount_due - coalesce(booked.amount_booked, 0)) > 0.001
 order by br.date desc;

-- C. Le solde vivant de chaque compte, après rattrapage.
select b.name,
       b.initial_balance
       + coalesce((select sum(t.amount) from public.treasury_transactions t where t.account_to   = b.id), 0)
       - coalesce((select sum(t.amount) from public.treasury_transactions t where t.account_from = b.id), 0)
         as solde
  from public.bank_accounts b
 order by b.name;
