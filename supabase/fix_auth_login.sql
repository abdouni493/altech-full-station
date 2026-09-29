-- =====================================================================================
--  FIX: password login returns HTTP 500 for accounts created via SQL
--
--  Cause: the Auth server (GoTrue) reads several auth.users token columns into
--  non-nullable strings. When a row is inserted manually and those columns are
--  NULL, login crashes with 500 ("converting NULL to string is unsupported").
--
--  Run this ENTIRE file once in: Supabase → SQL Editor → New query → Run.
--  It (1) repairs every existing account and (2) patches the creator function so
--  new admins/workers are created correctly.
-- =====================================================================================

-- 1) Repair any already-created users (admin + workers) --------------------------------
update auth.users
set
  confirmation_token         = coalesce(confirmation_token, ''),
  recovery_token             = coalesce(recovery_token, ''),
  email_change               = coalesce(email_change, ''),
  email_change_token_new     = coalesce(email_change_token_new, ''),
  email_change_token_current = coalesce(email_change_token_current, ''),
  phone_change               = coalesce(phone_change, ''),
  phone_change_token         = coalesce(phone_change_token, ''),
  reauthentication_token     = coalesce(reauthentication_token, ''),
  email_confirmed_at         = coalesce(email_confirmed_at, now())
where
  confirmation_token is null
  or recovery_token is null
  or email_change is null
  or email_change_token_new is null
  or email_change_token_current is null
  or phone_change is null
  or phone_change_token is null
  or reauthentication_token is null;

-- 2) Patch the creator function so future accounts set '' (not NULL) -------------------
create or replace function public._create_auth_user(p_email text, p_password text, p_meta jsonb default '{}'::jsonb)
returns uuid
language plpgsql security definer set search_path = auth, public, extensions
as $$
declare
  v_uid       uuid;
  v_existing  uuid;
begin
  select id into v_existing from auth.users where email = lower(p_email) limit 1;
  if v_existing is not null then
    return v_existing;
  end if;

  v_uid := gen_random_uuid();

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data, is_super_admin,
    confirmation_token, recovery_token, email_change,
    email_change_token_new, email_change_token_current,
    phone_change, phone_change_token, reauthentication_token
  ) values (
    '00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated',
    lower(p_email), extensions.crypt(p_password, extensions.gen_salt('bf')),
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    coalesce(p_meta, '{}'::jsonb), false,
    '', '', '', '', '', '', '', ''
  );

  insert into auth.identities (
    id, provider_id, user_id, identity_data, provider,
    last_sign_in_at, created_at, updated_at
  ) values (
    gen_random_uuid(), lower(p_email), v_uid,
    jsonb_build_object('sub', v_uid::text, 'email', lower(p_email), 'email_verified', true),
    'email', now(), now(), now()
  );

  return v_uid;
end;
$$;

-- Done — try logging in again.
