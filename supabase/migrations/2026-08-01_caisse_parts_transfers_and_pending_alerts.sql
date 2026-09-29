-- =====================================================================================
--  altech station — Migration « Virement depuis N'IMPORTE QUELLE caisse
--                     + alertes des demandes / interventions en attente »
--
--  HOW TO RUN
--    Supabase → SQL Editor → New query → coller CE fichier entier → Run.
--    Le script est IDEMPOTENT : il peut être relancé sans risque.
--
--  PRÉ-REQUIS (migrations déjà passées)
--      • module_workers_auth.sql                              → biz_store
--      • 2026-07-29_treasury_pumps_purchases_brigades.sql     → bank_accounts,
--                                                               treasury_transactions
--      • 2026-08-01_expenses_bank_accounts_pos_remise_quick_access.sql
--
--  CE QUE FAIT CE SCRIPT
--    1.  Nouveaux « comptes » de trésorerie : la caisse de CHAQUE partie
--        ('CAISSE_CARBURANT', 'CAISSE_CAFETERIA', 'CAISSE_LAVAGE') à côté de la
--        caisse générale ('CAISSE'). L'utilisateur choisit désormais la caisse
--        SOURCE du virement et sa DESTINATION (compte bancaire ou autre caisse).
--    2.  v_account_balances → le solde de chaque caisse ET de chaque compte.
--    3.  v_account_history  → l'historique d'un compte contient le virement reçu
--        d'une caisse, avec le libellé de la contrepartie et le solde progressif.
--    4.  v_caisse_transfers → tous les virements, source et destination lisibles.
--    5.  biz_store : `payRequests` garanti sur chaque partie (les demandes
--        d'encaissement) + `status` normalisé sur les interventions, pour que le
--        compteur d'alertes de la barre latérale soit toujours juste.
--    6.  v_pending_alerts → ce que la barre latérale affiche en rouge :
--        demandes d'encaissement en attente + lavages / réparations en attente.
--    7.  biz_store : DESTRUCTIONS de produits — nouveau champ `source`
--        ('stock' | 'comptoir'). La Gestion de stock peut désormais détruire un
--        produit du catalogue (périmé, cassé, volé) exactement comme le comptoir.
--    8.  v_destructions / v_destructions_par_partie → le coût des pertes, avec
--        son détail, tel qu'il est déduit du résultat de chaque partie.
-- =====================================================================================

create extension if not exists pgcrypto;

-- =====================================================================================
--  1. LES CAISSES DE LA STATION SONT DES COMPTES DU JOURNAL
--
--     `treasury_transactions.account_from` / `account_to` acceptent maintenant :
--       • 'CAISSE'            → la caisse générale (espèces)
--       • 'CAISSE_CARBURANT'  → la caisse de la partie Carburant
--       • 'CAISSE_CAFETERIA'  → la caisse de la partie Cafétéria
--       • 'CAISSE_LAVAGE'     → la caisse de la partie Lavage & Réparation
--       • <bank_accounts.id>  → un compte bancaire
--       • NULL                → l'extérieur (client, fournisseur, apport…)
--
--     Un virement reste UNE SEULE ligne (kind = 'TRANSFER') : l'argent quitte
--     `account_from` et arrive sur `account_to`, donc les deux soldes ne peuvent
--     jamais diverger, et le mouvement apparaît dans l'historique des DEUX côtés.
--     `part` porte l'activité dont la caisse paie (carburant | cafeteria |
--     lavage | systeme).
--
--     Aucune colonne n'est ajoutée : ce sont des identifiants réservés. Le bloc
--     ci-dessous ne fait que documenter et indexer.
-- =====================================================================================

comment on column public.treasury_transactions.account_from is
  'Compte débité : ''CAISSE'', ''CAISSE_CARBURANT'', ''CAISSE_CAFETERIA'', ''CAISSE_LAVAGE'', un bank_accounts.id, ou NULL (extérieur).';
comment on column public.treasury_transactions.account_to is
  'Compte crédité : ''CAISSE'', ''CAISSE_CARBURANT'', ''CAISSE_CAFETERIA'', ''CAISSE_LAVAGE'', un bank_accounts.id, ou NULL (extérieur).';

-- Un virement ne doit jamais partir et arriver sur le même compte.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'treasury_transfer_distinct_accounts'
  ) then
    alter table public.treasury_transactions
      add constraint treasury_transfer_distinct_accounts
      check (account_from is null or account_to is null or account_from <> account_to)
      not valid;   -- `not valid` : les lignes déjà présentes ne sont pas re-contrôlées
  end if;
end $$;

create index if not exists idx_treasury_kind on public.treasury_transactions (kind);
create index if not exists idx_treasury_part on public.treasury_transactions (part);

-- Table de référence des caisses : elle donne leur libellé aux vues ci-dessous.
create table if not exists public.cash_accounts (
  id         text primary key,
  name       text not null,
  part       text not null default 'systeme',
  sort_order int  not null default 0
);

insert into public.cash_accounts (id, name, part, sort_order) values
  ('CAISSE',           'Caisse générale',             'systeme',   1),
  ('CAISSE_CARBURANT', 'Caisse Carburant',            'carburant', 2),
  ('CAISSE_CAFETERIA', 'Caisse Cafétéria',            'cafeteria', 3),
  ('CAISSE_LAVAGE',    'Caisse Lavage & Réparation',  'lavage',    4)
on conflict (id) do update
  set name = excluded.name,
      part = excluded.part,
      sort_order = excluded.sort_order;

alter table public.cash_accounts enable row level security;
drop policy if exists cash_accounts_read on public.cash_accounts;
create policy cash_accounts_read on public.cash_accounts
  for select to authenticated using (true);
grant select on public.cash_accounts to authenticated;

-- =====================================================================================
--  2. SOLDES — chaque compte bancaire ET chaque caisse
--
--     ⚠️  Le solde d'une caisse de partie donné ici est le solde DU JOURNAL
--     (virements, dépôts, retraits). L'application y ajoute ce que produisent les
--     documents de la partie (ventes encaissées, achats payés, dépenses,
--     salaires…) qui vivent dans `biz_store` / les tables carburant.
-- =====================================================================================

drop view if exists public.v_account_balances;
create view public.v_account_balances as
  select
    a.id                                        as account_id,
    a.name                                      as account_name,
    'banque'::text                              as account_type,
    'systeme'::text                             as part,
    a.initial_balance,
    a.initial_balance
      + coalesce((select sum(t.amount) from public.treasury_transactions t where t.account_to   = a.id), 0)
      - coalesce((select sum(t.amount) from public.treasury_transactions t where t.account_from = a.id), 0)
                                                as balance
  from public.bank_accounts a
  union all
  select
    c.id,
    c.name,
    'caisse'::text,
    c.part,
    0::numeric,
      coalesce((select sum(t.amount) from public.treasury_transactions t where t.account_to   = c.id), 0)
    - coalesce((select sum(t.amount) from public.treasury_transactions t where t.account_from = c.id), 0)
  from public.cash_accounts c;

grant select on public.v_account_balances to authenticated;

-- =====================================================================================
--  3. HISTORIQUE D'UN COMPTE — le virement reçu d'une caisse y figure
--
--     C'est la vue de contrôle de l'écran « Comptes Bancaires → Historique » :
--     chaque ligne porte la contrepartie (d'où vient / où va l'argent) et le
--     solde progressif du compte.
-- =====================================================================================

drop view if exists public.v_account_history;
create view public.v_account_history as
  with accounts as (
    select id, name, 'banque'::text as account_type from public.bank_accounts
    union all
    select id, name, 'caisse'::text                 from public.cash_accounts
  ),
  labels as (
    select id, name from accounts
  ),
  lines as (
    select
      a.id                                                            as account_id,
      a.name                                                          as account_name,
      a.account_type,
      t.id                                                            as tx_id,
      t.date,
      t.kind,
      t.part,
      t.description,
      t.ref_type,
      t.ref_id,
      t.cheque_number,
      t.bordereau_number,
      (t.account_to = a.id)                                           as is_credit,
      case when t.account_to = a.id then t.amount else -t.amount end   as signed_amount,
      coalesce(
        (select l.name from labels l
          where l.id = case when t.account_to = a.id then t.account_from else t.account_to end),
        'Externe')                                                    as contrepartie
    from accounts a
    join public.treasury_transactions t
      on t.account_to = a.id or t.account_from = a.id
  )
  select
    l.*,
    sum(l.signed_amount) over (
      partition by l.account_id order by l.date, l.tx_id
      rows between unbounded preceding and current row
    ) as solde_progressif
  from lines l;

grant select on public.v_account_history to authenticated;

-- Tous les virements, source et destination en clair.
drop view if exists public.v_caisse_transfers;
create view public.v_caisse_transfers as
  select
    t.id,
    t.date,
    t.amount,
    t.part,
    t.description,
    t.account_from,
    coalesce(cf.name, bf.name, 'Externe') as source,
    t.account_to,
    coalesce(ct.name, bt.name, 'Externe') as destination,
    (cf.id is not null)                   as depuis_une_caisse,
    (bt.id is not null)                   as vers_une_banque,
    t.created_by,
    t.created_at
  from public.treasury_transactions t
  left join public.cash_accounts  cf on cf.id = t.account_from
  left join public.bank_accounts  bf on bf.id = t.account_from
  left join public.cash_accounts  ct on ct.id = t.account_to
  left join public.bank_accounts  bt on bt.id = t.account_to
  where t.kind = 'TRANSFER';

grant select on public.v_caisse_transfers to authenticated;

-- =====================================================================================
--  4. PARTIES COMMERCIALES (JSON) — DEMANDES D'ENCAISSEMENT & INTERVENTIONS
--
--     La barre latérale affiche une pastille rouge sur les boutons
--     « Demandes d'encaissement » et « Réparations & Lavage » dès qu'il reste du
--     travail en attente. Les deux compteurs se lisent dans `biz_store` :
--
--       • payRequests[].status = 'pending'    → demande non encore encaissée
--       • reparations[].status = 'pending'    → lavage / réparation à finaliser
--
--     Ce bloc garantit que les deux tableaux existent et que chaque élément
--     porte un `status` — sans quoi le compteur afficherait 0 à tort.
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

    -- Demandes d'encaissement : tableau créé vide s'il n'existe pas encore.
    if (s->part->'payRequests') is null or jsonb_typeof(s->part->'payRequests') <> 'array' then
      s := jsonb_set(s, array[part, 'payRequests'], '[]'::jsonb, true);
    end if;

    -- Une demande sans statut est une demande en attente.
    s := jsonb_set(s, array[part, 'payRequests'], coalesce((
      select jsonb_agg(
        case when (req ? 'status') and coalesce(req->>'status', '') <> ''
          then req
          else req || jsonb_build_object('status', 'pending')
        end
        order by ord)
        from jsonb_array_elements(coalesce(s->part->'payRequests', '[]'::jsonb))
             with ordinality as t(req, ord)
    ), '[]'::jsonb), true);

    -- Une intervention sans statut a été réalisée : elle est finalisée.
    s := jsonb_set(s, array[part, 'reparations'], coalesce((
      select jsonb_agg(
        case when (rep ? 'status') and coalesce(rep->>'status', '') <> ''
          then rep
          else rep || jsonb_build_object('status', 'finalized')
        end
        order by ord)
        from jsonb_array_elements(coalesce(s->part->'reparations', '[]'::jsonb))
             with ordinality as t(rep, ord)
    ), '[]'::jsonb), true);

    -- ── DESTRUCTIONS ──────────────────────────────────────────────────────────
    --   Le tableau existe sur chaque partie et chaque ligne porte sa `source` :
    --     'stock'    → produit détruit depuis la Gestion de stock (nouveau),
    --                  valorisé au PRIX D'ACHAT du produit
    --     'comptoir' → produit détruit au comptoir (comportement historique)
    --   Toutes les lignes déjà présentes viennent du comptoir.
    if (s->part->'destructions') is null or jsonb_typeof(s->part->'destructions') <> 'array' then
      s := jsonb_set(s, array[part, 'destructions'], '[]'::jsonb, true);
    end if;

    s := jsonb_set(s, array[part, 'destructions'], coalesce((
      select jsonb_agg(
        case when (d ? 'source') and coalesce(d->>'source', '') <> ''
          then d
          else d || jsonb_build_object('source', 'comptoir')
        end
        -- `value` doit toujours valoir qty × unitPrice, c'est ce montant qui est
        -- déduit du bénéfice net de la partie.
        || jsonb_build_object('value', coalesce(
             nullif((d->>'value')::numeric, 0),
             coalesce((d->>'qty')::numeric, 0) * coalesce((d->>'unitPrice')::numeric, 0)))
        order by ord)
        from jsonb_array_elements(coalesce(s->part->'destructions', '[]'::jsonb))
             with ordinality as t(d, ord)
    ), '[]'::jsonb), true);
  end loop;

  update public.biz_store set state = s, updated_at = now() where id = 'biz-v1';
end $$;

-- =====================================================================================
--  4 bis. DESTRUCTIONS — vues de contrôle
--
--     Le coût d'une destruction NE SORT PAS d'espèces de la caisse : il détruit
--     de la marchandise. Il est donc retranché du RÉSULTAT de la partie
--     (bénéfice net = marge brute − dépenses − salaires − destructions − pertes)
--     et la valeur du stock a déjà baissé d'autant.
--
--     Une destruction « récupérée » (recovered = true) est une erreur de saisie
--     annulée : la quantité est revenue en stock, elle ne coûte plus rien.
-- =====================================================================================

drop view if exists public.v_destructions;
create view public.v_destructions as
  select
    p.part,
    case p.part when 'lavage' then 'Lavage & Réparation' else 'Cafétéria' end as part_label,
    d->>'id'                                            as id,
    coalesce(d->>'source', 'comptoir')                  as source,
    d->>'productId'                                     as product_id,
    d->>'productName'                                   as produit,
    d->>'categoryName'                                  as categorie,
    coalesce((d->>'qty')::numeric, 0)                   as quantite,
    d->>'unit'                                          as unite,
    coalesce((d->>'unitPrice')::numeric, 0)             as cout_unitaire,
    coalesce((d->>'value')::numeric, 0)                 as cout,
    d->>'reason'                                        as motif,
    d->>'notes'                                         as observations,
    d->>'createdBy'                                     as agent,
    (d->>'date')                                        as date,
    coalesce((d->>'recovered')::boolean, false)         as recuperee
  from public.biz_store b
  cross join (values ('cafeteria'), ('lavage')) as p(part)
  cross join lateral jsonb_array_elements(coalesce(b.state->p.part->'destructions', '[]'::jsonb)) as d
 where b.id = 'biz-v1';

grant select on public.v_destructions to authenticated;

-- Récapitulatif par partie et par provenance — ce que les Rapports affichent.
drop view if exists public.v_destructions_par_partie;
create view public.v_destructions_par_partie as
  select
    part,
    part_label,
    source,
    count(*)                                              as lignes,
    sum(quantite)                                         as quantite_totale,
    sum(case when recuperee then 0 else cout end)         as cout_total,
    sum(case when recuperee then cout else 0 end)         as cout_recupere
  from public.v_destructions
  group by part, part_label, source;

grant select on public.v_destructions_par_partie to authenticated;

-- =====================================================================================
--  5. ALERTES — ce que la barre latérale affiche en rouge
-- =====================================================================================

drop view if exists public.v_pending_alerts;
create view public.v_pending_alerts as
  select
    p.part,
    case p.part when 'lavage' then 'Lavage & Réparation' else 'Cafétéria' end as part_label,
    '/' || p.part || '/encaissements'                                          as route_encaissements,
    '/' || p.part || '/reparations'                                            as route_reparations,
    coalesce((
      select count(*) from jsonb_array_elements(coalesce(b.state->p.part->'payRequests', '[]'::jsonb)) r
       where r->>'status' = 'pending'), 0)                                     as demandes_en_attente,
    coalesce((
      select sum((r->>'amount')::numeric)
        from jsonb_array_elements(coalesce(b.state->p.part->'payRequests', '[]'::jsonb)) r
       where r->>'status' = 'pending'), 0)                                     as montant_en_attente,
    coalesce((
      select count(*) from jsonb_array_elements(coalesce(b.state->p.part->'reparations', '[]'::jsonb)) r
       where r->>'status' = 'pending'), 0)                                     as interventions_en_attente
  from public.biz_store b
  cross join (values ('cafeteria'), ('lavage')) as p(part)
 where b.id = 'biz-v1';

grant select on public.v_pending_alerts to authenticated;

-- =====================================================================================
--  FIN — vérification rapide
-- =====================================================================================
select
  (select count(*) from public.cash_accounts)                                   as caisses_declarees,
  (select count(*) from public.v_caisse_transfers where depuis_une_caisse)       as virements_depuis_une_caisse,
  (select count(*) from public.v_caisse_transfers
    where depuis_une_caisse and vers_une_banque)                                as virements_caisse_vers_banque,
  (select coalesce(sum(demandes_en_attente), 0)      from public.v_pending_alerts) as demandes_en_attente,
  (select coalesce(sum(interventions_en_attente), 0) from public.v_pending_alerts) as interventions_en_attente,
  (select count(*) from public.v_destructions where source = 'stock')            as destructions_depuis_le_stock,
  (select count(*) from public.v_destructions where source = 'comptoir')         as destructions_depuis_le_comptoir,
  (select coalesce(sum(cout), 0) from public.v_destructions where not recuperee) as cout_total_des_destructions;

-- Soldes de contrôle (à comparer avec l'écran « Caisse Générale ») :
--   select * from public.v_account_balances order by account_type, account_name;
-- Historique d'un compte :
--   select date, kind, description, contrepartie, signed_amount, solde_progressif
--     from public.v_account_history
--    where account_id = '<bank_accounts.id ou CAISSE_LAVAGE>'
--    order by date desc;
-- Détail des destructions (à comparer avec « Gestion de stock → Historique ») :
--   select part_label, source, produit, quantite, unite, cout_unitaire, cout, motif, agent, date
--     from public.v_destructions where not recuperee order by date desc;
--   select * from public.v_destructions_par_partie;
