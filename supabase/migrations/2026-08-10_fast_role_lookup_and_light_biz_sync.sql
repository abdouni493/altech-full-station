-- ============================================================================
-- Connexion rapide & synchronisation légère du blob des parties
-- ----------------------------------------------------------------------------
-- CE QUE CETTE MIGRATION CORRIGE (incident du 2026-08-10) :
--
--   La base « ne répondait plus » au moment de la connexion. En réalité elle
--   était saturée par la synchronisation du blob `biz_store` (~560 Ko) :
--   sur 23 h, 2 277 lectures du blob complet (608 ms de moyenne) et 802
--   écritures (1,5 s de moyenne) — presque 45 minutes de temps de base par
--   jour, plus le décodage WAL du temps réel qui rediffusait le blob entier
--   à chaque poste après chaque enregistrement. Les requêtes de connexion
--   (get_my_role) passaient derrière et expiraient.
--
--   1) get_my_role ne fabrique plus JAMAIS « admin » : l'ancienne version
--      rendait 'admin' pour un appelant anonyme ou inconnu (ELSE 'admin').
--      Vérifié le 2026-08-10 : chacun des 8 comptes auth possède bien sa
--      ligne de rôle — personne ne dépend de ce repli.
--   2) Index partiels sur auth_user_id : la résolution du rôle ne dépend
--      plus de parcours séquentiels.
--   3) `biz_store_meta` : une ligne minuscule (id, rev) tenue à jour par
--      trigger à chaque écriture du blob. C'est ELLE qui est publiée en
--      temps réel — le blob complet sort de la publication. Un poste notifié
--      compare la révision reçue à la sienne et ne télécharge le blob que
--      s'il a vraiment changé (voir src/store/BizContext.tsx).
--
-- Pré-requis : 2026-08-06_biz_store_revision_merge.sql (colonne `rev`).
-- ============================================================================

-- ── 1) Résolution du rôle : une passe, jamais de rôle inventé ───────────────
create or replace function public.get_my_role()
returns text
language plpgsql stable security definer set search_path = public
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then return null; end if;
  if exists (select 1 from admin_profiles   where id = v_uid)           then return 'admin'; end if;
  if exists (select 1 from pompistes        where auth_user_id = v_uid) then return 'pompiste'; end if;
  if exists (select 1 from brigade_chefs    where auth_user_id = v_uid) then return 'chef_brigade'; end if;
  if exists (select 1 from gerants          where auth_user_id = v_uid) then return 'gerant'; end if;
  if exists (select 1 from magasin_workers  where auth_user_id = v_uid) then return 'magasin'; end if;
  if exists (select 1 from module_workers   where auth_user_id = v_uid) then return 'module_worker'; end if;
  return null;  -- compte sans rôle : l'accès est REFUSÉ, pas promu admin
end;
$$;

-- anon reçoit null (écran de connexion) au lieu d'une erreur de permission.
grant execute on function public.get_my_role() to anon, authenticated;

-- ── 2) Index de résolution du rôle ──────────────────────────────────────────
create index if not exists pompistes_auth_user_id_idx
  on public.pompistes (auth_user_id) where auth_user_id is not null;
create index if not exists brigade_chefs_auth_user_id_idx
  on public.brigade_chefs (auth_user_id) where auth_user_id is not null;
create index if not exists gerants_auth_user_id_idx
  on public.gerants (auth_user_id) where auth_user_id is not null;
create index if not exists magasin_workers_auth_user_id_idx
  on public.magasin_workers (auth_user_id) where auth_user_id is not null;

-- ── 3) Notification temps réel légère du blob des parties ───────────────────
create table if not exists public.biz_store_meta (
  id         text primary key,
  rev        bigint not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.biz_store_meta enable row level security;
drop policy if exists biz_store_meta_read on public.biz_store_meta;
create policy biz_store_meta_read on public.biz_store_meta
  for select to anon, authenticated using (true);
grant select on public.biz_store_meta to anon, authenticated;

-- Le trigger écrit en SECURITY DEFINER : aucun poste n'écrit cette table
-- directement, elle suit `biz_store` quel que soit le chemin d'écriture
-- (RPC biz_store_save, upsert direct de repli, restauration de sauvegarde).
create or replace function public.biz_store_touch_meta()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.biz_store_meta (id, rev, updated_at)
  values (new.id, coalesce(new.rev, 0), now())
  on conflict (id) do update set rev = excluded.rev, updated_at = now();
  return new;
end;
$$;

drop trigger if exists biz_store_meta_sync on public.biz_store;
create trigger biz_store_meta_sync
  after insert or update on public.biz_store
  for each row execute function public.biz_store_touch_meta();

-- Reprise de l'existant.
insert into public.biz_store_meta (id, rev, updated_at)
select id, coalesce(rev, 0), coalesce(updated_at, now()) from public.biz_store
on conflict (id) do nothing;

-- La méta entre dans la publication temps réel, le blob complet en sort :
-- une notification pèse quelques octets au lieu de ~560 Ko par poste.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'biz_store_meta'
  ) then
    alter publication supabase_realtime add table public.biz_store_meta;
  end if;
  if exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'biz_store'
  ) then
    alter publication supabase_realtime drop table public.biz_store;
  end if;
end $$;
