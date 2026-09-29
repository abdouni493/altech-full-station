-- ============================================================
-- StationPro – Auth RPCs for role resolution & worker lookup
-- Run once in the Supabase SQL editor.
-- ============================================================

-- get_my_role: resolve the role of the currently authenticated user
CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM admin_profiles    WHERE id = auth.uid())            THEN 'admin'
    WHEN EXISTS (SELECT 1 FROM pompistes         WHERE auth_user_id = auth.uid())  THEN 'pompiste'
    WHEN EXISTS (SELECT 1 FROM brigade_chefs     WHERE auth_user_id = auth.uid())  THEN 'chef_brigade'
    WHEN EXISTS (SELECT 1 FROM gerants           WHERE auth_user_id = auth.uid())  THEN 'gerant'
    WHEN EXISTS (SELECT 1 FROM magasin_workers   WHERE auth_user_id = auth.uid())  THEN 'magasin'
    ELSE 'admin'
  END;
$$;

-- get_my_worker: return the worker row (as jsonb) for the current user, or null for admins
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
  RETURN r;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_role()   TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_worker() TO anon, authenticated;
