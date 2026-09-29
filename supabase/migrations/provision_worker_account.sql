-- ============================================================
-- StationPro – provision_worker_account RPC
-- Replaces the create-worker Edge Function (was failing with CORS).
-- Run once in the Supabase SQL editor (Database → SQL Editor).
-- ============================================================

-- Requires pgcrypto for password hashing (already enabled in all Supabase projects)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── Clean up ghost rows from previous attempts ────────────────────────────────
-- Previous versions omitted instance_id, making those users invisible to GoTrue
-- and the Supabase dashboard. Delete them so workers can be re-provisioned cleanly.
DELETE FROM auth.users
WHERE email LIKE '%@workers.station.local'
  AND instance_id IS NULL;

CREATE OR REPLACE FUNCTION public.provision_worker_account(
  p_action      text,          -- 'create' | 'update_password' | 'delete'
  p_worker_type text,          -- 'pompiste' | 'chef_brigade' | 'gerant' | 'magasin'
  p_worker_id   uuid,
  p_username    text DEFAULT NULL,
  p_password    text DEFAULT NULL,
  p_name        text DEFAULT NULL,
  p_email       text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER                -- runs as postgres (superuser) → has auth.users access
SET search_path = public, extensions  -- extensions schema needed for pgcrypto (gen_salt, crypt)
AS $$
DECLARE
  v_email          text;
  v_user_id        uuid;
  v_table          text;
  v_encrypted_pass text;
  v_check_id       uuid;
BEGIN
  -- ── Resolve table name ────────────────────────────────────────────────────
  CASE p_worker_type
    WHEN 'pompiste'     THEN v_table := 'pompistes';
    WHEN 'chef_brigade' THEN v_table := 'brigade_chefs';
    WHEN 'gerant'       THEN v_table := 'gerants';
    WHEN 'magasin'      THEN v_table := 'magasin_workers';
    ELSE
      RETURN jsonb_build_object('ok', false, 'error',
        'Type de travailleur invalide: ' || p_worker_type);
  END CASE;

  -- Use the worker's real email if provided; fall back to generated username@workers.station.local
  v_email := COALESCE(NULLIF(trim(p_email), ''), lower(p_username) || '@workers.station.local');

  -- ── CREATE ───────────────────────────────────────────────────────────────
  IF p_action = 'create' THEN

    -- If an auth user with this email already exists, just link it
    SELECT id INTO v_user_id FROM auth.users WHERE email = v_email LIMIT 1;

    IF v_user_id IS NOT NULL THEN
      EXECUTE format(
        'UPDATE %I SET auth_user_id = $1, username = $2 WHERE id = $3',
        v_table
      ) USING v_user_id, p_username, p_worker_id;

      RETURN jsonb_build_object('ok', true, 'auth_user_id', v_user_id);
    END IF;

    -- Hash the password with bcrypt (10 rounds — Supabase default)
    v_encrypted_pass := crypt(p_password, gen_salt('bf', 10));
    v_user_id        := gen_random_uuid();

    -- Insert the auth.users row.
    -- instance_id MUST be '00000000-0000-0000-0000-000000000000' — GoTrue scopes
    -- all queries by instance_id, so rows with NULL are invisible to both GoTrue
    -- (login returns 400) and the Supabase dashboard (user does not appear).
    INSERT INTO auth.users (
      id,
      instance_id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      confirmation_sent_at,
      raw_app_meta_data,
      raw_user_meta_data,
      is_super_admin,
      created_at,
      updated_at,
      last_sign_in_at,
      is_sso_user,
      confirmation_token,
      recovery_token,
      email_change_token_new,
      email_change
    ) VALUES (
      v_user_id,
      '00000000-0000-0000-0000-000000000000',
      'authenticated',
      'authenticated',
      v_email,
      v_encrypted_pass,
      now(),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('name', p_name, 'username', p_username, 'role', p_worker_type),
      false,
      now(),
      now(),
      NULL,
      false,
      '',
      '',
      '',
      ''
    );

    -- Verify the INSERT actually landed (catches silent rejections)
    SELECT id INTO v_check_id FROM auth.users WHERE id = v_user_id;
    IF v_check_id IS NULL THEN
      RETURN jsonb_build_object('ok', false,
        'error', 'Insertion dans auth.users échouée silencieusement');
    END IF;

    -- Insert the auth.identities row (needed for GoTrue sign-in to work)
    -- provider_id = email for the email provider (required NOT NULL in newer Supabase)
    INSERT INTO auth.identities (
      id, user_id,
      provider_id,
      identity_data, provider,
      last_sign_in_at, created_at, updated_at
    ) VALUES (
      gen_random_uuid(),
      v_user_id,
      v_email,
      jsonb_build_object(
        'sub',            v_user_id::text,
        'email',          v_email,
        'name',           p_name,
        'email_verified', true
      ),
      'email',
      now(), now(), now()
    );

    -- Link the worker row to the new auth user
    EXECUTE format(
      'UPDATE %I SET auth_user_id = $1, username = $2 WHERE id = $3',
      v_table
    ) USING v_user_id, p_username, p_worker_id;

    RETURN jsonb_build_object('ok', true, 'auth_user_id', v_user_id);

  -- ── UPDATE PASSWORD ──────────────────────────────────────────────────────
  ELSIF p_action = 'update_password' THEN

    EXECUTE format('SELECT auth_user_id FROM %I WHERE id = $1', v_table)
      INTO v_user_id USING p_worker_id;

    IF v_user_id IS NULL THEN
      RETURN jsonb_build_object('ok', false,
        'error', 'Aucun compte auth pour ce travailleur');
    END IF;

    v_encrypted_pass := crypt(p_password, gen_salt('bf', 10));

    UPDATE auth.users
       SET encrypted_password = v_encrypted_pass,
           updated_at         = now()
     WHERE id = v_user_id;

    RETURN jsonb_build_object('ok', true);

  -- ── DELETE ───────────────────────────────────────────────────────────────
  ELSIF p_action = 'delete' THEN

    EXECUTE format('SELECT auth_user_id FROM %I WHERE id = $1', v_table)
      INTO v_user_id USING p_worker_id;

    IF v_user_id IS NOT NULL THEN
      -- Identities are cascade-deleted when the user is deleted
      DELETE FROM auth.users WHERE id = v_user_id;

      EXECUTE format(
        'UPDATE %I SET auth_user_id = NULL WHERE id = $1',
        v_table
      ) USING p_worker_id;
    END IF;

    RETURN jsonb_build_object('ok', true);

  ELSE
    RETURN jsonb_build_object('ok', false, 'error', 'Action inconnue: ' || p_action);
  END IF;

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$$;

-- Allow both anonymous and authenticated callers (admin pages use authenticated session)
GRANT EXECUTE ON FUNCTION public.provision_worker_account(text, text, uuid, text, text, text, text)
  TO anon, authenticated;
