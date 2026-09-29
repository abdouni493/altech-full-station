-- ==============================================================================
--  altech station — Comptes de connexion pour les employés des PARTIES
--  (Restaurant / Cafétéria / Lavage & Réparation / Magasin)
--
--  Jusqu'ici seuls les employés « Carburant » (pompistes, chefs de brigade,
--  gérants, employés magasin station) pouvaient avoir un compte. Les employés
--  créés depuis Restaurant / Cafétéria / Lavage / Magasin étaient stockés
--  uniquement dans le navigateur : aucun compte n'était créé dans
--  auth.users, donc aucune connexion n'était possible.
--
--  Ce script :
--    1. crée la table public.module_workers (miroir serveur des employés des
--       parties, avec leurs permissions),
--    2. crée provision_module_worker_account() qui crée / met à jour /
--       supprime le compte auth.users correspondant,
--    3. étend get_my_role() / get_my_worker() pour que ces employés soient
--       reconnus à la connexion,
--    4. crée public.biz_store, l'état partagé des 4 parties, pour que
--       l'employé qui se connecte voie les mêmes données que l'administrateur.
--
--  À exécuter UNE FOIS dans Supabase → SQL Editor → New query → Run.
-- ==============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ──────────────────────────────────────────────────────────────────────────────
-- 1) Table des employés de partie
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.module_workers (
  id            uuid PRIMARY KEY,                 -- même id que le worker côté app
  module_key    text NOT NULL,                    -- restaurant | cafeteria | lavage | magasin
  name          text NOT NULL,
  role_name     text,
  phone         text,
  email         text,
  username      text,
  auth_user_id  uuid UNIQUE,
  has_account   boolean NOT NULL DEFAULT false,
  permissions   jsonb   NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS module_workers_username_key
  ON public.module_workers (lower(username)) WHERE username IS NOT NULL;
CREATE INDEX IF NOT EXISTS module_workers_module_key_idx
  ON public.module_workers (module_key);

ALTER TABLE public.module_workers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS module_workers_read  ON public.module_workers;
DROP POLICY IF EXISTS module_workers_write ON public.module_workers;

-- Lecture pour tout utilisateur connecté (l'app filtre par partie),
-- écriture pour tout utilisateur connecté (l'UI n'expose l'édition qu'à l'admin).
CREATE POLICY module_workers_read  ON public.module_workers
  FOR SELECT TO authenticated USING (true);
CREATE POLICY module_workers_write ON public.module_workers
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ──────────────────────────────────────────────────────────────────────────────
-- 2) Provisioning du compte auth pour un employé de partie
--    p_action : 'create' | 'update_password' | 'delete'
-- ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.provision_module_worker_account(
  p_action      text,
  p_module_key  text,
  p_worker_id   uuid,
  p_username    text  DEFAULT NULL,
  p_password    text  DEFAULT NULL,
  p_name        text  DEFAULT NULL,
  p_email       text  DEFAULT NULL,
  p_role_name   text  DEFAULT NULL,
  p_phone       text  DEFAULT NULL,
  p_permissions jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_email          text;
  v_user_id        uuid;
  v_encrypted_pass text;
BEGIN
  IF p_module_key NOT IN ('restaurant', 'cafeteria', 'lavage', 'magasin') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Partie inconnue: ' || coalesce(p_module_key, '?'));
  END IF;

  -- ── SUPPRESSION ────────────────────────────────────────────────────────────
  IF p_action = 'delete' THEN
    SELECT auth_user_id INTO v_user_id FROM module_workers WHERE id = p_worker_id;
    IF v_user_id IS NOT NULL THEN
      DELETE FROM auth.users WHERE id = v_user_id;   -- identities en cascade
    END IF;
    DELETE FROM module_workers WHERE id = p_worker_id;
    RETURN jsonb_build_object('ok', true);
  END IF;

  IF p_username IS NULL OR trim(p_username) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Nom d''utilisateur requis');
  END IF;

  -- Email réel si fourni, sinon identifiant généré (login par nom d'utilisateur)
  v_email := lower(COALESCE(NULLIF(trim(p_email), ''), lower(trim(p_username)) || '@workers.station.local'));

  -- Ligne miroir de l'employé (upsert)
  INSERT INTO module_workers (id, module_key, name, role_name, phone, email, username,
                              has_account, permissions, updated_at)
  VALUES (p_worker_id, p_module_key, COALESCE(p_name, 'Employé'), p_role_name, p_phone,
          NULLIF(trim(p_email), ''), lower(trim(p_username)), true,
          COALESCE(p_permissions, '{}'::jsonb), now())
  ON CONFLICT (id) DO UPDATE SET
    module_key  = EXCLUDED.module_key,
    name        = EXCLUDED.name,
    role_name   = EXCLUDED.role_name,
    phone       = EXCLUDED.phone,
    email       = EXCLUDED.email,
    username    = EXCLUDED.username,
    has_account = true,
    permissions = EXCLUDED.permissions,
    updated_at  = now();

  -- Un compte existe-t-il déjà pour cet email ?
  SELECT id INTO v_user_id FROM auth.users WHERE email = v_email LIMIT 1;

  -- ── MISE À JOUR DU MOT DE PASSE ────────────────────────────────────────────
  IF p_action = 'update_password' OR v_user_id IS NOT NULL THEN
    IF v_user_id IS NULL THEN
      SELECT auth_user_id INTO v_user_id FROM module_workers WHERE id = p_worker_id;
    END IF;
    IF v_user_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Aucun compte à mettre à jour');
    END IF;

    IF p_password IS NOT NULL AND length(p_password) > 0 THEN
      UPDATE auth.users
         SET encrypted_password = crypt(p_password, gen_salt('bf', 10)),
             updated_at         = now()
       WHERE id = v_user_id;
    END IF;

    UPDATE module_workers SET auth_user_id = v_user_id, updated_at = now() WHERE id = p_worker_id;
    RETURN jsonb_build_object('ok', true, 'auth_user_id', v_user_id);
  END IF;

  -- ── CRÉATION ───────────────────────────────────────────────────────────────
  IF p_password IS NULL OR length(p_password) < 6 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Mot de passe requis (6 caractères minimum)');
  END IF;

  v_encrypted_pass := crypt(p_password, gen_salt('bf', 10));
  v_user_id        := gen_random_uuid();

  -- instance_id DOIT valoir '00000000-…' : GoTrue filtre là-dessus, sinon
  -- l'utilisateur est invisible (login 400) et absent du dashboard.
  -- Tous les champs « token » doivent être '' et non NULL, sinon le login
  -- renvoie HTTP 500 (« converting NULL to string is unsupported »).
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, confirmation_sent_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data, is_super_admin, is_sso_user,
    confirmation_token, recovery_token, email_change,
    email_change_token_new, email_change_token_current,
    phone_change, phone_change_token, reauthentication_token
  ) VALUES (
    '00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated',
    v_email, v_encrypted_pass,
    now(), now(), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('name', p_name, 'username', lower(trim(p_username)),
                       'role', 'module_worker', 'module_key', p_module_key),
    false, false,
    '', '', '', '', '', '', '', ''
  );

  INSERT INTO auth.identities (
    id, user_id, provider_id, identity_data, provider,
    last_sign_in_at, created_at, updated_at
  ) VALUES (
    gen_random_uuid(), v_user_id, v_email,
    jsonb_build_object('sub', v_user_id::text, 'email', v_email,
                       'name', p_name, 'email_verified', true),
    'email', now(), now(), now()
  );

  UPDATE module_workers SET auth_user_id = v_user_id, updated_at = now() WHERE id = p_worker_id;

  RETURN jsonb_build_object('ok', true, 'auth_user_id', v_user_id);

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.provision_module_worker_account(
  text, text, uuid, text, text, text, text, text, text, jsonb) TO anon, authenticated;

-- ──────────────────────────────────────────────────────────────────────────────
-- 2b) Enregistrement des permissions sans toucher au mot de passe
-- ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.save_module_worker_permissions(
  p_worker_id   uuid,
  p_permissions jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE module_workers
     SET permissions = COALESCE(p_permissions, '{}'::jsonb), updated_at = now()
   WHERE id = p_worker_id;
  RETURN jsonb_build_object('ok', true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.save_module_worker_permissions(uuid, jsonb) TO anon, authenticated;

-- ──────────────────────────────────────────────────────────────────────────────
-- 3) Résolution du rôle à la connexion
-- ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM admin_profiles  WHERE id = auth.uid())           THEN 'admin'
    WHEN EXISTS (SELECT 1 FROM pompistes       WHERE auth_user_id = auth.uid()) THEN 'pompiste'
    WHEN EXISTS (SELECT 1 FROM brigade_chefs   WHERE auth_user_id = auth.uid()) THEN 'chef_brigade'
    WHEN EXISTS (SELECT 1 FROM gerants         WHERE auth_user_id = auth.uid()) THEN 'gerant'
    WHEN EXISTS (SELECT 1 FROM magasin_workers WHERE auth_user_id = auth.uid()) THEN 'magasin'
    WHEN EXISTS (SELECT 1 FROM module_workers  WHERE auth_user_id = auth.uid()) THEN 'module_worker'
    ELSE 'admin'
  END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_worker()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE r jsonb;
BEGIN
  SELECT to_jsonb(p) INTO r FROM pompistes p       WHERE p.auth_user_id = auth.uid();
  IF r IS NOT NULL THEN RETURN r; END IF;
  SELECT to_jsonb(c) INTO r FROM brigade_chefs c   WHERE c.auth_user_id = auth.uid();
  IF r IS NOT NULL THEN RETURN r; END IF;
  SELECT to_jsonb(g) INTO r FROM gerants g         WHERE g.auth_user_id = auth.uid();
  IF r IS NOT NULL THEN RETURN r; END IF;
  SELECT to_jsonb(m) INTO r FROM magasin_workers m WHERE m.auth_user_id = auth.uid();
  IF r IS NOT NULL THEN RETURN r; END IF;
  SELECT to_jsonb(w) INTO r FROM module_workers w  WHERE w.auth_user_id = auth.uid();
  RETURN r;
END;
$$;

-- Employé de partie courant (rôle 'module_worker') — inclut module_key + permissions
CREATE OR REPLACE FUNCTION public.get_my_module_worker()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT to_jsonb(w) FROM module_workers w WHERE w.auth_user_id = auth.uid() LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_role()          TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_worker()        TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_module_worker() TO anon, authenticated;

-- NB : la connexion par nom d'utilisateur passe par email_for_username(), qui
-- lit auth.users.raw_user_meta_data->>'username'. Les comptes créés ci-dessus
-- renseignent ce champ, ils sont donc déjà pris en charge sans modification.

-- ──────────────────────────────────────────────────────────────────────────────
-- 4) État partagé des 4 parties (Restaurant / Cafétéria / Lavage / Magasin)
--    Une seule ligne JSON : l'employé connecté voit les données de la station,
--    plus les données de démonstration locales de son navigateur.
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.biz_store (
  id         text PRIMARY KEY,
  state      jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.biz_store ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS biz_store_read  ON public.biz_store;
DROP POLICY IF EXISTS biz_store_write ON public.biz_store;

CREATE POLICY biz_store_read  ON public.biz_store
  FOR SELECT TO authenticated USING (true);
CREATE POLICY biz_store_write ON public.biz_store
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ── Réparation des comptes déjà créés en SQL (tokens NULL → login HTTP 500) ────
UPDATE auth.users SET
  confirmation_token         = coalesce(confirmation_token, ''),
  recovery_token             = coalesce(recovery_token, ''),
  email_change               = coalesce(email_change, ''),
  email_change_token_new     = coalesce(email_change_token_new, ''),
  email_change_token_current = coalesce(email_change_token_current, ''),
  phone_change               = coalesce(phone_change, ''),
  phone_change_token         = coalesce(phone_change_token, ''),
  reauthentication_token     = coalesce(reauthentication_token, ''),
  email_confirmed_at         = coalesce(email_confirmed_at, now())
WHERE confirmation_token IS NULL OR recovery_token IS NULL OR email_change IS NULL
   OR email_change_token_new IS NULL OR email_change_token_current IS NULL
   OR phone_change IS NULL OR phone_change_token IS NULL OR reauthentication_token IS NULL;

-- Terminé.
