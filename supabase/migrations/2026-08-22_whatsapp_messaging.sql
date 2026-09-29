-- =====================================================================================
--  altech station — Migration « MESSAGES WHATSAPP AUX CLIENTS »
--
--  COMMENT L'EXÉCUTER
--    Supabase → SQL Editor → New query → coller CE FICHIER ENTIER → Run.
--    Le script est IDEMPOTENT : il peut être relancé sans risque.
--
--  PRÉ-REQUIS (migrations déjà passées)
--      • module_workers_auth.sql   → biz_store, is_station_admin()
--    Aucun autre. Ce script ne touche à aucune table existante.
--
--  CE QU'IL CRÉE, ET POURQUOI DEUX TABLES ET NON UNE
--
--    1. public.whatsapp_messages — LE JOURNAL
--       Ce qui a été confié à la passerelle : à qui, quel texte, et où en est la
--       remise (`sent → delivered → read`). C'est lui que l'écran « Messages
--       clients » affiche, et c'est le webhook de la passerelle qui fait avancer
--       le statut.
--
--    2. public.whatsapp_outbox — LA FILE D'ATTENTE
--       Ce qui n'a PAS PU partir, avec son texte, en attendant que la passerelle
--       revienne.
--
--       Cette seconde table n'est pas un raffinement. La passerelle WhatsApp vit
--       sur un POSTE de la station : il sera éteint, en veille ou hors ligne un
--       jour ou l'autre — c'est le prix assumé d'un montage sans serveur loué.
--       Sans file, chaque message émis pendant ce temps serait PUREMENT PERDU,
--       et un rappel automatique ne laisse rien derrière lui : personne ne
--       revient l'envoyer à la main.
--
--  CE QUI N'EST **PAS** DANS CES TABLES
--    Les modèles de messages, les délais de rappel et les alertes déjà traitées
--    vivent dans le blob `biz_store` avec le reste des parties commerciales
--    (collections `messageTemplates` et `rappels`). Ils sont petits, propres à
--    une partie, et fusionnent entre postes comme le reste. Aucune table à créer
--    pour eux : la migration ne les concerne pas.
--
--  QUI ÉCRIT DANS CES TABLES
--    Le SERVEUR, avec la clé de service (`SUPABASE_SERVICE_ROLE_KEY`), parce que
--    le webhook de la passerelle n'a aucune session utilisateur et ne peut donc
--    pas écrire sous RLS. L'application, elle, ne fait que LIRE le journal.
-- =====================================================================================

create extension if not exists pgcrypto;

-- =====================================================================================
--  1. LE JOURNAL D'ENVOI
--
--     `id` est une chaîne produite par le serveur (et non un uuid) pour que la
--     ligne de la file et celle du journal portent LE MÊME identifiant : un
--     message rattrapé depuis la file se retrouve dans le journal au même
--     endroit, jamais en double.
-- =====================================================================================

create table if not exists public.whatsapp_messages (
  id              text primary key,
  -- Partie d'origine : 'cafeteria' | 'lavage'. NULL pour un envoi hors partie.
  module_key      text,
  -- Client de la partie (identifiant du blob) — volontairement SANS clé
  -- étrangère : les clients des parties commerciales ne sont pas une table.
  client_id       text,
  -- Numéro NORMALISÉ (MSISDN, indicatif compris, sans « + » ni espaces).
  recipient_phone text        not null,
  recipient_name  text,
  -- Le TEXTE réellement envoyé. Le garder permet de relire ce qu'a reçu un
  -- client six mois plus tard — la première question posée quand il rappelle.
  body            text        not null default '',
  -- 'libre' (message écrit à la main) | 'rappel' (relance automatique).
  kind            text        not null default 'libre',
  -- Pour un rappel : 'lavage' | 'reparation'.
  rappel_kind     text,
  car_label       text,
  status          text        not null default 'queued'
                    check (status in ('queued', 'sent', 'delivered', 'read', 'failed')),
  -- Identifiant du message CHEZ WHATSAPP : c'est par lui que le webhook
  -- retrouve la ligne pour faire avancer l'accusé de remise.
  gateway_id      text,
  error           text,
  created_by      text,
  created_at      timestamptz not null default now(),
  sent_at         timestamptz,
  delivered_at    timestamptz,
  read_at         timestamptz
);

comment on table public.whatsapp_messages is
  'Journal des messages WhatsApp envoyés aux clients : destinataire, texte et accusé de remise. Écrit par le serveur ; l''application ne fait que lire.';
comment on column public.whatsapp_messages.gateway_id is
  'Identifiant du message chez WhatsApp. Le webhook s''en sert pour faire avancer le statut (sent → delivered → read).';
comment on column public.whatsapp_messages.recipient_phone is
  'MSISDN normalisé (ex. 213550123456) — jamais la forme saisie dans la fiche client.';

create index if not exists whatsapp_messages_module_idx  on public.whatsapp_messages (module_key, created_at desc);
create index if not exists whatsapp_messages_client_idx  on public.whatsapp_messages (client_id) where client_id is not null;
create index if not exists whatsapp_messages_gateway_idx on public.whatsapp_messages (gateway_id) where gateway_id is not null;
create index if not exists whatsapp_messages_status_idx  on public.whatsapp_messages (status, created_at desc);

-- =====================================================================================
--  2. LA FILE D'ATTENTE
--
--     L'index porte sur (status, created_at) : le vidage lit TOUJOURS « les plus
--     anciens en attente d'abord ».
-- =====================================================================================

create table if not exists public.whatsapp_outbox (
  id                text primary key,
  -- La ligne du journal correspondante — même identifiant, pas de doublon.
  message_id        text,
  recipient_phone   text        not null,
  -- Le numéro TEL QU'IL A ÉTÉ SAISI, pour l'afficher à l'utilisateur.
  recipient_display text,
  recipient_name    text,
  -- Le TEXTE à envoyer. C'est ce que le journal seul ne suffirait pas à porter :
  -- sans lui, rien à réémettre au retour de la passerelle.
  body              text        not null,
  status            text        not null default 'pending'
                      check (status in ('pending', 'sent', 'abandoned')),
  -- Une passerelle INJOIGNABLE ne consomme jamais de tentative : ce n'est pas la
  -- faute du message. Sans cette règle, un week-end hors ligne épuiserait le
  -- compteur de toute la file et ferait abandonner des messages valides.
  attempts          integer     not null default 0,
  last_error        text,
  last_attempt_at   timestamptz,
  created_at        timestamptz not null default now(),
  sent_at           timestamptz,
  abandoned_at      timestamptz,
  abandoned_reason  text
);

comment on table public.whatsapp_outbox is
  'Messages WhatsApp en attente parce que la passerelle était injoignable. Ils repartent seuls dès qu''elle revient. Sans cette table, tout message émis poste éteint serait perdu.';
comment on column public.whatsapp_outbox.attempts is
  'Tentatives consommées par un échec PROPRE AU DESTINATAIRE (numéro sans compte WhatsApp, refus). Une passerelle injoignable n''en consomme jamais.';

create index if not exists whatsapp_outbox_queue_idx on public.whatsapp_outbox (status, created_at);

-- =====================================================================================
--  3. RLS — même portée que le blob des parties commerciales
--
--     `biz_store` est lisible et écrivable par tout compte connecté ; les droits
--     par partie sont appliqués par l'application. Ces tables ne restreignent
--     pas davantage. La clé de service, elle, contourne la RLS : c'est ainsi que
--     le webhook — qui n'a aucune session — peut écrire.
-- =====================================================================================

alter table public.whatsapp_messages enable row level security;
alter table public.whatsapp_outbox   enable row level security;

drop policy if exists whatsapp_messages_read  on public.whatsapp_messages;
drop policy if exists whatsapp_messages_write on public.whatsapp_messages;
drop policy if exists whatsapp_outbox_read    on public.whatsapp_outbox;
drop policy if exists whatsapp_outbox_write   on public.whatsapp_outbox;

create policy whatsapp_messages_read  on public.whatsapp_messages
  for select to authenticated using (true);
create policy whatsapp_messages_write on public.whatsapp_messages
  for all to authenticated using (true) with check (true);

create policy whatsapp_outbox_read  on public.whatsapp_outbox
  for select to authenticated using (true);
create policy whatsapp_outbox_write on public.whatsapp_outbox
  for all to authenticated using (true) with check (true);

grant select, insert, update, delete on public.whatsapp_messages to authenticated;
grant select, insert, update, delete on public.whatsapp_outbox   to authenticated;

-- =====================================================================================
--  4. TEMPS RÉEL — l'accusé de remise arrive pendant que l'écran est ouvert
--
--     Un message envoyé depuis un poste passe de « Envoyé » à « Remis » puis
--     « Lu » sans que personne ait à recharger la page.
-- =====================================================================================

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'whatsapp_messages'
  ) then
    alter publication supabase_realtime add table public.whatsapp_messages;
  end if;
exception when others then
  raise notice 'Publication temps réel non modifiée : %', sqlerrm;
end $$;

-- =====================================================================================
--  5. LES VOITURES DES CLIENTS — RIEN À FAIRE ICI
--
--     Le parc d'un client de la partie Lavage (marque, modèle, plaque, couleur,
--     année, kilométrage) vit dans le blob `biz_store`, sur la fiche du client,
--     comme le reste des parties commerciales. Aucune table n'est nécessaire, et
--     aucune reprise n'est à faire : les clients existants arrivent simplement
--     sans véhicule, et on les ajoute au fil des passages.
-- =====================================================================================

-- =====================================================================================
--  VÉRIFICATIONS (facultatif — à exécuter à la main après la migration)
-- =====================================================================================
--   -- Les deux tables existent et sont vides :
--   select 'messages' as t, count(*) from public.whatsapp_messages
--   union all
--   select 'outbox',        count(*) from public.whatsapp_outbox;
--
--   -- Les derniers envois, avec leur accusé de remise :
--   select created_at, recipient_name, recipient_phone, status, left(body, 60)
--     from public.whatsapp_messages order by created_at desc limit 20;
--
--   -- Ce qui attend encore, et depuis quand :
--   select created_at, recipient_phone, attempts, last_error
--     from public.whatsapp_outbox where status = 'pending' order by created_at;
--
--  Terminé.
-- =====================================================================================
