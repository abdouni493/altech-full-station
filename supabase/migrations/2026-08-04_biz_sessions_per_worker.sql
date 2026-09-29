-- =====================================================================================
--  altech station — Migration « SESSIONS DE TRAVAIL INDÉPENDANTES PAR EMPLOYÉ »
--
--  HOW TO RUN
--    Supabase → SQL Editor → New query → coller CE fichier entier → Run.
--    Le script est IDEMPOTENT : il peut être relancé sans risque.
--
--  PRÉ-REQUIS (migrations déjà passées)
--      • module_workers_auth.sql   → module_workers, biz_store, get_my_module_worker()
--
--  LE PROBLÈME CORRIGÉ
--    Le point de vente prenait « la » session ouverte de la partie, sans regarder
--    à qui elle appartenait. Si l'employé 1 partait sans clôturer, l'employé 2
--    arrivait sur SA caisse : il vendait dans la session de l'employé 1 et
--    pouvait la clôturer à sa place. Les sessions vivaient en plus dans le blob
--    JSON partagé `biz_store`, que deux postes connectés en même temps
--    s'écrasaient mutuellement : l'ouverture de l'un effaçait celle de l'autre.
--
--  CE QUE FAIT CE SCRIPT
--    1.  public.biz_sessions — UNE LIGNE PAR SESSION, avec son propriétaire.
--        Deux caissiers peuvent tenir une session ouverte en même temps.
--    2.  Un seul « ouverte » à la fois par employé et par partie (index unique).
--    3.  RLS : un employé n'écrit QUE sur sa propre session. Le serveur refuse
--        qu'il touche celle d'un collègue, même si l'interface était contournée.
--        L'administrateur garde la supervision (clôture d'un oubli).
--    4.  Reprise des sessions déjà enregistrées dans le blob `biz_store`
--        (aucune session ni aucun décalage n'est perdu).
--    5.  Publication temps réel : chaque poste voit les ouvertures / clôtures.
--    6.  v_biz_sessions_open → qui tient une caisse en ce moment.
-- =====================================================================================

create extension if not exists pgcrypto;

-- =====================================================================================
--  1. QUI EST CONNECTÉ ? (helpers utilisés par les règles RLS et le déclencheur)
-- =====================================================================================

-- Administrateur de la station.
create or replace function public.is_station_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from admin_profiles where id = auth.uid());
$$;

-- Identifiant de l'employé de partie connecté (module_workers.id), sinon NULL.
create or replace function public.my_module_worker_id()
returns text language sql stable security definer set search_path = public as $$
  select id::text from module_workers where auth_user_id = auth.uid() limit 1;
$$;

grant execute on function public.is_station_admin()     to authenticated;
grant execute on function public.my_module_worker_id()  to authenticated;

-- =====================================================================================
--  2. LA TABLE DES SESSIONS
--
--     `id` / `worker_id` sont en TEXT : ce sont les identifiants générés par
--     l'application (uuid v4, mais d'anciennes lignes peuvent porter un id
--     horodaté). `auth_user_id` est le compte qui a réellement ouvert la ligne —
--     c'est lui que contrôlent les règles RLS.
-- =====================================================================================

create table if not exists public.biz_sessions (
  id              text primary key,
  module_key      text        not null check (module_key in ('cafeteria', 'lavage', 'restaurant', 'magasin')),
  ref             text,
  worker_id       text,                       -- module_workers.id / employé de la partie
  worker_name     text        not null,
  opening_cash    numeric(14,2) not null default 0,
  opened_at       timestamptz not null default now(),
  closed_at       timestamptz,
  closing_cash    numeric(14,2),
  status          text        not null default 'open' check (status in ('open', 'closed')),
  notes           text,
  theoretical     numeric(14,2),
  credit          numeric(14,2),
  decalage        numeric(14,2),
  auth_user_id    uuid        default auth.uid(),
  opened_by_id    text,
  opened_by_name  text,
  closed_by_id    text,
  closed_by_name  text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.biz_sessions is
  'Sessions de travail du point de vente (Cafétéria / Lavage). Une ligne par session, propriété de UN employé : lui seul peut vendre dedans et la clôturer.';
comment on column public.biz_sessions.worker_id is
  'Employé propriétaire (module_workers.id). C''est lui qui ouvre, vend et clôture.';
comment on column public.biz_sessions.auth_user_id is
  'Compte de connexion qui a ouvert la ligne — base du contrôle RLS.';
comment on column public.biz_sessions.opening_cash is
  'Fond de caisse déjà en main : JAMAIS compté dans le théorique ni dans le décalage.';

create index if not exists biz_sessions_module_idx  on public.biz_sessions (module_key, opened_at desc);
create index if not exists biz_sessions_worker_idx  on public.biz_sessions (worker_id);
create index if not exists biz_sessions_auth_idx    on public.biz_sessions (auth_user_id);
create index if not exists biz_sessions_status_idx  on public.biz_sessions (status) where status = 'open';

-- NB : les index UNIQUES « une seule session ouverte par employé » sont créés
-- à l'étape 4, APRÈS la reprise de l'existant — sinon les doublons hérités de
-- l'ancien fonctionnement feraient échouer la migration.

-- `updated_at` tenu à jour, et surtout : le PROPRIÉTAIRE d'une session ne change
-- jamais. Un employé ne peut donc pas s'attribuer la session d'un collègue (ni
-- lui refiler la sienne) — seul l'administrateur en a le droit.
create or replace function public.biz_sessions_touch()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();

  if not public.is_station_admin()
     and (new.worker_id   is distinct from old.worker_id
       or new.auth_user_id is distinct from old.auth_user_id) then
    raise exception 'Le propriétaire d''une session de travail ne peut pas être modifié';
  end if;

  return new;
end;
$$;

drop trigger if exists biz_sessions_touch_trg on public.biz_sessions;
create trigger biz_sessions_touch_trg
  before update on public.biz_sessions
  for each row execute function public.biz_sessions_touch();

-- =====================================================================================
--  3. RLS — « chacun sa caisse »
--
--     LECTURE  : tout utilisateur connecté (l'application n'affiche à l'employé
--                que ses propres sessions ; l'admin a besoin de tout pour ses
--                rapports et le récapitulatif par employé).
--     ÉCRITURE : la session doit être la sienne — soit ouverte par son compte
--                (`auth_user_id`), soit à son nom d'employé (`worker_id`).
--                L'administrateur passe partout (clôture d'un oubli).
--     SUPPRESSION : administrateur uniquement — l'historique des décalages ne
--                doit pas pouvoir être effacé par un employé.
-- =====================================================================================

alter table public.biz_sessions enable row level security;

drop policy if exists biz_sessions_read   on public.biz_sessions;
drop policy if exists biz_sessions_insert on public.biz_sessions;
drop policy if exists biz_sessions_update on public.biz_sessions;
drop policy if exists biz_sessions_delete on public.biz_sessions;

create policy biz_sessions_read on public.biz_sessions
  for select to authenticated
  using (true);

-- Un employé n'ouvre une session QU'À SON NOM : il ne peut pas créer une caisse
-- au nom d'un collègue. Seul l'administrateur le peut (il remet le fond de
-- caisse au poste).
create policy biz_sessions_insert on public.biz_sessions
  for insert to authenticated
  with check (
    public.is_station_admin()
    or worker_id is null
    or worker_id = public.my_module_worker_id()
  );

create policy biz_sessions_update on public.biz_sessions
  for update to authenticated
  using (
    public.is_station_admin()
    or auth_user_id = auth.uid()
    or worker_id = public.my_module_worker_id()
  )
  with check (
    public.is_station_admin()
    or auth_user_id = auth.uid()
    or worker_id = public.my_module_worker_id()
  );

create policy biz_sessions_delete on public.biz_sessions
  for delete to authenticated
  using (public.is_station_admin());

grant select, insert, update on public.biz_sessions to authenticated;
grant delete on public.biz_sessions to authenticated;

-- =====================================================================================
--  4. REPRISE DE L'EXISTANT — les sessions déjà dans le blob `biz_store`
--
--     Elles gardent leur id, donc l'application retrouve les ventes qui y sont
--     rattachées (`sales.sessionId`) et l'historique des décalages reste intact.
--     Une session ouverte sans employé identifiable reste ouverte : son employé
--     la retrouvera, l'administrateur pourra la clôturer.
-- =====================================================================================

do $$
declare
  v_state jsonb;
  v_part  text;
  v_row   jsonb;
begin
  select state into v_state from public.biz_store where id = 'biz-v1';
  if v_state is null then
    raise notice 'biz_store vide — aucune session à reprendre.';
    return;
  end if;

  foreach v_part in array array['cafeteria', 'lavage', 'restaurant', 'magasin'] loop
    if v_state ? v_part and jsonb_typeof(v_state -> v_part -> 'sessions') = 'array' then
      for v_row in select * from jsonb_array_elements(v_state -> v_part -> 'sessions') loop
        begin
          insert into public.biz_sessions (
            id, module_key, ref, worker_id, worker_name, opening_cash,
            opened_at, closed_at, closing_cash, status, notes,
            theoretical, credit, decalage, opened_by_id, opened_by_name
          ) values (
            coalesce(nullif(v_row ->> 'id', ''), gen_random_uuid()::text),
            -- Les anciennes parties fusionnées gardent leur historique là où
            -- l'application les affiche aujourd'hui.
            case v_part when 'restaurant' then 'cafeteria'
                        when 'magasin'    then 'lavage'
                        else v_part end,
            v_row ->> 'ref',
            nullif(v_row ->> 'workerId', ''),
            coalesce(nullif(v_row ->> 'workerName', ''), 'Employé'),
            coalesce(nullif(v_row ->> 'openingCash', '')::numeric, 0),
            coalesce(nullif(v_row ->> 'openedAt', '')::timestamptz, now()),
            nullif(v_row ->> 'closedAt', '')::timestamptz,
            nullif(v_row ->> 'closingCash', '')::numeric,
            case when coalesce(v_row ->> 'status', 'open') = 'closed' then 'closed' else 'open' end,
            nullif(v_row ->> 'notes', ''),
            nullif(v_row ->> 'theoretical', '')::numeric,
            nullif(v_row ->> 'credit', '')::numeric,
            nullif(v_row ->> 'decalage', '')::numeric,
            nullif(v_row ->> 'workerId', ''),
            nullif(v_row ->> 'workerName', '')
          )
          on conflict (id) do nothing;
        exception
          -- Relance du script, ou doublon hérité : la ligne déjà en base fait foi.
          when unique_violation then null;
          when others then raise notice 'Session ignorée (%): %', v_row ->> 'ref', sqlerrm;
        end;
      end loop;
    end if;
  end loop;
end $$;

-- Filet de sécurité pour la reprise : si l'historique contenait DEUX sessions
-- ouvertes pour le même employé (l'ancien bug), on ne garde ouverte que la plus
-- récente — les autres sont clôturées telles quelles, avec la mention.
with doublons as (
  select id,
         row_number() over (
           partition by module_key, coalesce(worker_id, lower(worker_name))
           order by opened_at desc
         ) as rang
  from public.biz_sessions
  where status = 'open'
)
update public.biz_sessions s
   set status      = 'closed',
       closed_at   = coalesce(s.closed_at, now()),
       notes       = coalesce(s.notes || ' — ', '') ||
                     'Clôturée automatiquement : session en double (ancien fonctionnement).',
       updated_at  = now()
  from doublons d
 where d.id = s.id and d.rang > 1;

-- Les doublons sont réglés : on peut poser la règle définitive — UNE seule
-- session ouverte à la fois par employé et par partie. L'employé clôture la
-- sienne avant d'en ouvrir une nouvelle ; celle d'un collègue ne le gêne pas.
create unique index if not exists biz_sessions_one_open_per_worker
  on public.biz_sessions (module_key, worker_id)
  where status = 'open' and worker_id is not null;

-- Même règle pour les sessions ouvertes à un nom libre (employé non enregistré).
create unique index if not exists biz_sessions_one_open_per_name
  on public.biz_sessions (module_key, lower(worker_name))
  where status = 'open' and worker_id is null;

-- =====================================================================================
--  5. TEMPS RÉEL — chaque poste voit les ouvertures / clôtures des autres
-- =====================================================================================

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'biz_sessions'
  ) then
    alter publication supabase_realtime add table public.biz_sessions;
  end if;
exception when others then
  raise notice 'Publication temps réel non modifiée : %', sqlerrm;
end $$;

-- =====================================================================================
--  6. VUE DE CONTRÔLE — qui tient une caisse en ce moment
-- =====================================================================================

drop view if exists public.v_biz_sessions_open;
create view public.v_biz_sessions_open as
  select s.module_key,
         s.id           as session_id,
         s.ref,
         s.worker_id,
         s.worker_name,
         s.opening_cash,
         s.opened_at,
         now() - s.opened_at as duree,
         s.opened_by_name,
         w.username     as compte,
         (s.auth_user_id is not null) as ouverte_depuis_un_compte
    from public.biz_sessions s
    left join public.module_workers w on w.id::text = s.worker_id
   where s.status = 'open'
   order by s.opened_at desc;

grant select on public.v_biz_sessions_open to authenticated;

-- =====================================================================================
--  VÉRIFICATIONS (facultatif — à exécuter à la main)
-- =====================================================================================
--   select * from public.v_biz_sessions_open;
--   select module_key, worker_name, status, count(*)
--     from public.biz_sessions group by 1,2,3 order by 1,2;
--
--  Terminé.
-- =====================================================================================
