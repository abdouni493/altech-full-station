-- ============================================================
-- StationPro — Cuves : ajustement atomique CORRIGÉ
--
-- Ce que cette migration répare (constaté en production) :
--
--   1. La base portait une version ANCIENNE de `adjust_tank_level` :
--        update tanks set current = greatest(0, current + delta) where id = ...
--      Elle mettait bien `current` à jour mais laissait `degrees` figé. La jauge
--      affichée ne suivait donc jamais les livraisons.
--
--   2. `tank_degrees_from_liters` — appelée par la version « propre » du fichier
--      `tank_level_delta_rpc.sql` — n'existait PAS dans la base. Cette migration
--      la crée enfin.
--
--   3. `tanks.id` est de type TEXT dans ce schéma (et non uuid). La signature
--      doit donc rester `(text, numeric)` : une variante `uuid` ferait échouer
--      la comparaison `WHERE id = p_tank_id`. On garde UNE SEULE signature pour
--      que PostgREST n'ait jamais à arbitrer entre deux surcharges.
--
-- Idempotent : peut être rejoué sans risque.
-- ============================================================

-- 1) Litres → degrés, par interpolation linéaire sur la table de conversion
--    rangée dans station_settings.conversion_tables (jsonb, clé = id de cuve,
--    valeur = [{degree, liters}, …]). NULL si la cuve n'a pas de table : dans ce
--    cas `degrees` est laissé tel quel plutôt que remis à zéro.
CREATE OR REPLACE FUNCTION public.tank_degrees_from_liters(p_tank_id text, p_liters numeric)
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
  SELECT conversion_tables -> p_tank_id
    INTO v_curve
    FROM public.station_settings
   LIMIT 1;

  IF v_curve IS NULL OR jsonb_typeof(v_curve) <> 'array' OR jsonb_array_length(v_curve) = 0 THEN
    RETURN NULL;
  END IF;

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

  IF v_lower.liters IS NULL THEN RETURN v_upper.degree; END IF;
  IF v_upper.liters IS NULL THEN RETURN v_lower.degree; END IF;
  IF v_upper.liters = v_lower.liters THEN RETURN v_lower.degree; END IF;

  RETURN v_lower.degree
       + (p_liters - v_lower.liters) / (v_upper.liters - v_lower.liters)
       * (v_upper.degree - v_lower.degree);
END;
$$;

-- 2) Ajustement atomique du niveau d'une cuve. Le client n'envoie QUE des deltas
--    (livraison reçue, achat annulé, brigade qui consomme) : la ligne est
--    verrouillée, le résultat borné à ≥ 0, et `degrees` resynchronisé —
--    pourcentage de la capacité pour le GPL, table de conversion sinon.
--    L'ancienne signature retournait `void` ; on la remplace pour pouvoir rendre
--    le nouveau niveau (diagnostic + accusé de réception côté client).
DROP FUNCTION IF EXISTS public.adjust_tank_level(text, numeric);
DROP FUNCTION IF EXISTS public.adjust_tank_level(uuid, numeric);

CREATE FUNCTION public.adjust_tank_level(p_tank_id text, p_delta numeric)
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

GRANT EXECUTE ON FUNCTION public.tank_degrees_from_liters(text, numeric) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.adjust_tank_level(text, numeric)        TO authenticated, anon;

-- 3) Realtime : les autres sessions ouvertes doivent voir bouger les cuves.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'tanks'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.tanks';
  END IF;
EXCEPTION WHEN others THEN NULL;
END $$;
