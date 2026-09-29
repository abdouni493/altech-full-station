-- =====================================================================================
--  altech station — Migration « RETOURS CLIENTS » (formulaire public /client)
--
--  HOW TO RUN
--    Supabase → SQL Editor → New query → coller CE fichier entier → Run.
--    Le script est IDEMPOTENT : il peut être relancé sans risque.
--    PUIS enchaîner sur 2026-08-14_client_feedbacks_optional_contact.sql, qui
--    rend le nom et le téléphone facultatifs (seul le message est exigé).
--
--  CE QUE FAIT CE SCRIPT
--    1.  public.client_feedbacks — un avis déposé par un client depuis la page
--        publique `/client`, rattaché à UNE partie de la station :
--        carburant, cafétéria ou lavage.
--    2.  RLS « boîte aux lettres » : le visiteur NON CONNECTÉ (rôle `anon`) peut
--        DÉPOSER un avis et rien d'autre — il ne peut ni lire, ni modifier, ni
--        supprimer quoi que ce soit. Le personnel connecté lit, marque « lu » et
--        supprime.
--    3.  Un avis arrive TOUJOURS non lu : le visiteur ne peut pas se déclarer
--        lui-même « déjà traité » (c'est ce qui ferait disparaître l'alerte de la
--        barre latérale sans que personne n'ait rien vu).
--    4.  Publication temps réel : un avis déposé s'affiche sur les postes ouverts
--        et fait apparaître la pastille rouge du menu sans rechargement.
--    5.  public_station_identity() — nom et logo de la station, lisibles SANS
--        compte, pour que la page publique porte l'identité de l'établissement
--        (le reste de `station_settings` reste inaccessible au visiteur).
--
--  SÉCURITÉ — ce qui est volontairement exposé
--    La page `/client` est publique par nature : n'importe qui peut donc écrire
--    dans cette table, exactement comme n'importe qui peut glisser un mot dans
--    une boîte à idées. Les garde-fous sont les contraintes de longueur
--    ci-dessous (un avis ne peut pas servir à remplir la base) et le fait que la
--    table ne contient AUCUNE donnée de la station : la lire n'apprendrait rien.
-- =====================================================================================

create extension if not exists pgcrypto;

-- =====================================================================================
--  1. LA TABLE
-- =====================================================================================

create table if not exists public.client_feedbacks (
  id          text        primary key default gen_random_uuid()::text,
  -- Partie concernée par l'avis. 'fuel' = station-service (carburant).
  part        text        not null check (part in ('fuel', 'cafeteria', 'lavage')),
  full_name   text        not null check (length(btrim(full_name)) between 2 and 120),
  phone       text        not null check (length(btrim(phone))     between 4 and  40),
  -- Facultatif : le client donne son e-mail seulement s'il le souhaite.
  email       text                 check (email is null or length(btrim(email)) <= 160),
  message     text        not null check (length(btrim(message))   between 3 and 4000),
  status      text        not null default 'unread' check (status in ('unread', 'read')),
  read_at     timestamptz,
  read_by     text,
  created_at  timestamptz not null default now()
);

comment on table public.client_feedbacks is
  'Avis déposés par les clients depuis la page publique /client. Une ligne par avis, rattachée à une partie (carburant / cafétéria / lavage).';
comment on column public.client_feedbacks.part is
  'Partie visée par l''avis : fuel (carburant), cafeteria ou lavage.';
comment on column public.client_feedbacks.status is
  'unread tant que personne ne l''a ouvert : c''est ce qui allume la pastille rouge du menu.';
comment on column public.client_feedbacks.read_by is
  'Qui a marqué l''avis comme lu (nom affiché de l''utilisateur connecté).';

create index if not exists client_feedbacks_part_idx
  on public.client_feedbacks (part, created_at desc);
create index if not exists client_feedbacks_unread_idx
  on public.client_feedbacks (part) where status = 'unread';

-- =====================================================================================
--  2. UN AVIS ARRIVE TOUJOURS NON LU
--
--     Le visiteur écrit dans la table sans compte : sans ce déclencheur, un envoi
--     forgé à la main pourrait se présenter comme « déjà lu » et n'apparaîtrait
--     jamais dans l'alerte du menu. L'insertion est donc normalisée côté serveur,
--     quoi qu'envoie le client.
-- =====================================================================================

create or replace function public.client_feedbacks_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.status     := 'unread';
  new.read_at    := null;
  new.read_by    := null;
  new.created_at := now();
  new.full_name  := btrim(new.full_name);
  new.phone      := btrim(new.phone);
  new.email      := nullif(btrim(coalesce(new.email, '')), '');
  new.message    := btrim(new.message);
  return new;
end;
$$;

drop trigger if exists client_feedbacks_before_insert_trg on public.client_feedbacks;
create trigger client_feedbacks_before_insert_trg
  before insert on public.client_feedbacks
  for each row execute function public.client_feedbacks_before_insert();

-- Marquer « lu » horodate tout seul : l'application n'a pas à y penser, et la
-- date affichée sur la carte est toujours celle du serveur.
create or replace function public.client_feedbacks_before_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'read' and old.status is distinct from 'read' then
    new.read_at := coalesce(new.read_at, now());
  elsif new.status = 'unread' then
    new.read_at := null;
    new.read_by := null;
  end if;
  return new;
end;
$$;

drop trigger if exists client_feedbacks_before_update_trg on public.client_feedbacks;
create trigger client_feedbacks_before_update_trg
  before update on public.client_feedbacks
  for each row execute function public.client_feedbacks_before_update();

-- =====================================================================================
--  3. RLS — « boîte aux lettres »
--
--     ÉCRITURE (dépôt) : tout le monde, y compris un visiteur sans compte.
--     LECTURE          : uniquement le personnel connecté.
--     MARQUER LU / SUPPRIMER : uniquement le personnel connecté.
-- =====================================================================================

alter table public.client_feedbacks enable row level security;

drop policy if exists client_feedbacks_public_insert on public.client_feedbacks;
drop policy if exists client_feedbacks_read          on public.client_feedbacks;
drop policy if exists client_feedbacks_update        on public.client_feedbacks;
drop policy if exists client_feedbacks_delete        on public.client_feedbacks;

-- Le visiteur dépose son avis — et ne peut pas le déposer « déjà lu ».
create policy client_feedbacks_public_insert on public.client_feedbacks
  for insert to anon, authenticated
  with check (status = 'unread' and read_at is null and read_by is null);

create policy client_feedbacks_read on public.client_feedbacks
  for select to authenticated
  using (true);

create policy client_feedbacks_update on public.client_feedbacks
  for update to authenticated
  using (true) with check (true);

create policy client_feedbacks_delete on public.client_feedbacks
  for delete to authenticated
  using (true);

-- `anon` n'a QUE le droit d'insérer : aucune lecture n'est accordée, donc les
-- coordonnées des clients ne sortent jamais de la station.
grant insert on public.client_feedbacks to anon;
grant select, insert, update, delete on public.client_feedbacks to authenticated;

-- =====================================================================================
--  4. TEMPS RÉEL — l'avis apparaît sans rechargement
-- =====================================================================================

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'client_feedbacks'
  ) then
    alter publication supabase_realtime add table public.client_feedbacks;
  end if;
exception when others then
  raise notice 'Publication temps réel non modifiée : %', sqlerrm;
end $$;

-- =====================================================================================
--  5. IDENTITÉ PUBLIQUE DE LA STATION
--
--     La page `/client` s'ouvre SANS compte : elle ne peut donc pas lire
--     `station_settings` (réservée aux utilisateurs connectés). Cette fonction
--     n'en expose que le nom et le logo — ce qui est déjà écrit sur la façade.
-- =====================================================================================

create or replace function public.public_station_identity()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(
    (select jsonb_build_object('name', s.name, 'logo_url', s.logo_url)
       from public.station_settings s limit 1),
    '{}'::jsonb);
$$;

grant execute on function public.public_station_identity() to anon, authenticated;

-- =====================================================================================
--  VÉRIFICATIONS (facultatif — à exécuter à la main)
-- =====================================================================================
--   select part, status, count(*) from public.client_feedbacks group by 1,2 order by 1,2;
--   select * from public.client_feedbacks order by created_at desc limit 20;
--   select public.public_station_identity();
--
--  Terminé.
-- =====================================================================================
