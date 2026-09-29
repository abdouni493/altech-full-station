-- ============================================================
-- StationPro – Mise à jour atomique des cuves par les livraisons
--
-- Problème corrigé : lors de la création / modification / suppression
-- d'un Bon de Livraison, le niveau de cuve était écrit en VALEUR ABSOLUE
-- calculée côté client (lecture-modification-écriture). Deux écritures
-- proches (modification d'un BL, deux sessions, clôture de brigade…)
-- s'écrasaient mutuellement et le niveau affiché devenait faux.
--
-- Solution : le client envoie désormais un DELTA relatif via la RPC
-- adjust_tank_level(cuve, delta). La mise à jour est atomique
-- (verrou de ligne, SET current = current + delta) et recalcule aussi
-- `degrees` (jauge) à partir de la table de conversion (ou du % GPL)
-- pour que l'affichage suive immédiatement.
--
-- Run once in the Supabase SQL editor (Database → SQL Editor).
-- ============================================================

-- 1) Litres → degrés : interpolation linéaire sur la table de conversion
--    stockée dans station_settings.conversion_tables (jsonb, clé = tank id,
--    valeur = [{degree, liters}, …]). Retourne NULL si la cuve n'a pas de
--    table de conversion (dans ce cas `degrees` est laissé inchangé).
CREATE OR REPLACE FUNCTION public.tank_degrees_from_liters(p_tank_id uuid, p_liters numeric)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_curve jsonb;
  v_lower record;
  v_upper record;
BEGIN
  SELECT conversion_tables -> p_tank_id::text
    INTO v_curve
    FROM public.station_settings
   LIMIT 1;

  IF v_curve IS NULL OR jsonb_typeof(v_curve) <> 'array' OR jsonb_array_length(v_curve) = 0 THEN
    RETURN NULL;
  END IF;

  -- Point de courbe juste en dessous / au dessus du volume demandé
  SELECT (e->>'degree')::numeric AS degree, (e->>'liters')::numeric AS liters
    INTO v_lower
    FROM jsonb_array_elements(v_curve) e
   WHERE (e->>'liters')::numeric <= p_liters
   ORDER BY (e->>'liters')::numeric DESC
   LIMIT 1;

  SELECT (e->>'degree')::numeric AS degree, (e->>'liters')::numeric AS liters
    INTO v_upper
    FROM jsonb_array_elements(v_curve) e
   WHERE (e->>'liters')::numeric >= p_liters
   ORDER BY (e->>'liters')::numeric ASC
   LIMIT 1;

  IF v_lower.liters IS NULL THEN RETURN v_upper.degree; END IF; -- sous la courbe → borne basse
  IF v_upper.liters IS NULL THEN RETURN v_lower.degree; END IF; -- au-delà de la courbe → borne haute
  IF v_upper.liters = v_lower.liters THEN RETURN v_lower.degree; END IF;

  RETURN v_lower.degree
       + (p_liters - v_lower.liters) / (v_upper.liters - v_lower.liters)
       * (v_upper.degree - v_lower.degree);
END;
$$;

-- 2) Ajustement atomique du niveau d'une cuve (delta en litres, positif ou
--    négatif). Verrouille la ligne pour empêcher toute écriture concurrente
--    de perdre la mise à jour, borne le résultat à ≥ 0, et resynchronise
--    `degrees` (GPL → pourcentage de la capacité ; sinon table de conversion).
CREATE OR REPLACE FUNCTION public.adjust_tank_level(p_tank_id uuid, p_delta numeric)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tank public.tanks%ROWTYPE;
  v_new_liters numeric;
  v_new_degrees numeric;
BEGIN
  IF p_tank_id IS NULL OR COALESCE(p_delta, 0) = 0 THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_tank FROM public.tanks WHERE id = p_tank_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'adjust_tank_level: cuve % introuvable', p_tank_id;
  END IF;

  v_new_liters := GREATEST(0, COALESCE(v_tank."current", 0) + p_delta);

  IF v_tank.type = 'GPL' THEN
    v_new_degrees := CASE
      WHEN COALESCE(v_tank.capacity, 0) > 0
        THEN LEAST(100, GREATEST(0, v_new_liters / v_tank.capacity * 100))
      ELSE v_tank.degrees
    END;
  ELSE
    v_new_degrees := COALESCE(public.tank_degrees_from_liters(p_tank_id, v_new_liters), v_tank.degrees);
  END IF;

  UPDATE public.tanks
     SET "current" = v_new_liters,
         degrees   = v_new_degrees
   WHERE id = p_tank_id;

  RETURN v_new_liters;
END;
$$;

GRANT EXECUTE ON FUNCTION public.tank_degrees_from_liters(uuid, numeric) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.adjust_tank_level(uuid, numeric)        TO authenticated, anon;

-- 3) Realtime : s'assurer que les mises à jour de `tanks` et
--    `delivery_notes` sont diffusées aux autres sessions ouvertes
--    (le front re-hydrate ces tables à chaque événement realtime).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'tanks'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.tanks';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'delivery_notes'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.delivery_notes';
  END IF;
EXCEPTION WHEN others THEN NULL; -- publication absente en local → ignorer
END $$;

-- 4) DIAGNOSTIC (lecture seule) — test rapide de la RPC : delta nul → NULL,
--    et vérification que les fonctions existent bien.
SELECT
  proname, prosecdef AS security_definer
FROM pg_proc
WHERE proname IN ('adjust_tank_level', 'tank_degrees_from_liters');
