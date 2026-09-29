-- ============================================================================
-- StationPro — Schema verification & reconciliation
-- ----------------------------------------------------------------------------
-- Idempotent. Safe to run on the LIVE database in the Supabase SQL editor.
-- Brings any database (fresh, partial, or drifted) into line with what the
-- application code (src/store/AppContext.tsx + src/lib/supabase.ts) writes.
--
-- Every statement uses IF NOT EXISTS / DROP-then-CREATE, so running it twice
-- changes nothing. It does NOT drop data.
-- ============================================================================

-- 1) brigades: unified 7-step wizard datetime columns -------------------------
ALTER TABLE public.brigades
  ADD COLUMN IF NOT EXISTS start_datetime timestamptz,
  ADD COLUMN IF NOT EXISTS end_datetime   timestamptz;

-- 2) station_settings: décalage thresholds (dashboard "seuils") ---------------
ALTER TABLE public.station_settings
  ADD COLUMN IF NOT EXISTS decalage_positif_seuil numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS decalage_negatif_seuil numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS decalage_positif_actif boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS decalage_negatif_actif boolean NOT NULL DEFAULT true;

-- 3) brigade_accounting: columns written by ADD/UPDATE_BRIGADE_ACCOUNTING -----
ALTER TABLE public.brigade_accounting
  ADD COLUMN IF NOT EXISTS cuve_verifications        jsonb   NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS nozzle_verifications      jsonb   NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS rest_assigned_worker_type text,
  ADD COLUMN IF NOT EXISTS rest_assigned_worker_id   uuid,
  ADD COLUMN IF NOT EXISTS rest_assigned_amount      numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS status                    text    NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS brigade_alerts            jsonb   NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS updated_at                timestamptz NOT NULL DEFAULT now();

-- 4) brigade_accounting_justifications: TAG/TPE detail columns ----------------
ALTER TABLE public.brigade_accounting_justifications
  ALTER COLUMN client_id DROP NOT NULL;
ALTER TABLE public.brigade_accounting_justifications
  ADD COLUMN IF NOT EXISTS justification_type text NOT NULL DEFAULT 'CLIENT',
  ADD COLUMN IF NOT EXISTS client_name        text,
  ADD COLUMN IF NOT EXISTS fuel_type          text,
  ADD COLUMN IF NOT EXISTS liters             numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS price_per_liter    numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS track_id           uuid,
  ADD COLUMN IF NOT EXISTS pompiste_id        uuid;

-- 5) tpe_transactions (Caisse TPE) — correct types (brigade_id = TEXT) --------
CREATE TABLE IF NOT EXISTS public.tpe_transactions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brigade_id      text REFERENCES public.brigades(id) ON DELETE CASCADE,
  accounting_id   uuid REFERENCES public.brigade_accounting(id) ON DELETE CASCADE,
  date            date NOT NULL DEFAULT CURRENT_DATE,
  mode            text NOT NULL CHECK (mode IN ('TAG', 'TPE')),
  client_name     text,
  client_id       uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  fuel_type       text,
  liters          numeric NOT NULL DEFAULT 0,
  price_per_liter numeric NOT NULL DEFAULT 0,
  amount          numeric NOT NULL DEFAULT 0,
  track_id        uuid REFERENCES public.tracks(id) ON DELETE SET NULL,
  track_name      text,
  pompiste_id     uuid REFERENCES public.pompistes(id) ON DELETE SET NULL,
  pompiste_name   text,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- 6) brigade_decalage_alerts — correct types (brigade_id = TEXT) --------------
CREATE TABLE IF NOT EXISTS public.brigade_decalage_alerts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brigade_id      text NOT NULL REFERENCES public.brigades(id) ON DELETE CASCADE,
  brigade_date    date NOT NULL DEFAULT CURRENT_DATE,
  start_datetime  timestamptz,
  end_datetime    timestamptz,
  chef_id         uuid REFERENCES public.brigade_chefs(id) ON DELETE SET NULL,
  chef_name       text,
  alert_type      text NOT NULL CHECK (alert_type IN ('CORRECT', 'RETOUR_CUVE', 'VENTE_DIRECTE')),
  tank_id         uuid REFERENCES public.tanks(id) ON DELETE SET NULL,
  tank_name       text,
  pompiste_id     uuid REFERENCES public.pompistes(id) ON DELETE SET NULL,
  pompiste_name   text,
  decalage_liters numeric NOT NULL DEFAULT 0,
  decalage_amount numeric NOT NULL DEFAULT 0,
  workers_info    jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_dismissed    boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Open RLS policies + realtime to match the rest of the app -------------------
DO $$
BEGIN
  EXECUTE 'ALTER TABLE public.tpe_transactions ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE public.brigade_decalage_alerts ENABLE ROW LEVEL SECURITY';
EXCEPTION WHEN others THEN NULL;
END $$;

DROP POLICY IF EXISTS "tpe_transactions_all" ON public.tpe_transactions;
CREATE POLICY "tpe_transactions_all" ON public.tpe_transactions FOR ALL USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "brigade_decalage_alerts_all" ON public.brigade_decalage_alerts;
CREATE POLICY "brigade_decalage_alerts_all" ON public.brigade_decalage_alerts FOR ALL USING (true) WITH CHECK (true);

-- ============================================================================
-- 7) DIAGNOSTIC (read-only) — surfaces the one remaining type inconsistency.
--    fuel_sales.brigade_id is `uuid` while brigades.id is `text`, so the two
--    cannot be joined or constrained by a FK. The app stores valid uuid
--    strings there, so it works today, but it is fragile. To harden it, run
--    the OPTIONAL block below (commented out — review before applying).
-- ============================================================================
SELECT
  (SELECT data_type FROM information_schema.columns
     WHERE table_name='brigades'   AND column_name='id')         AS brigades_id_type,
  (SELECT data_type FROM information_schema.columns
     WHERE table_name='fuel_sales' AND column_name='brigade_id') AS fuel_sales_brigade_id_type;

-- OPTIONAL hardening (uncomment to align fuel_sales.brigade_id with brigades.id):
-- ALTER TABLE public.fuel_sales ALTER COLUMN brigade_id TYPE text USING brigade_id::text;
-- ALTER TABLE public.fuel_sales
--   ADD CONSTRAINT fuel_sales_brigade_id_fkey
--   FOREIGN KEY (brigade_id) REFERENCES public.brigades(id) ON DELETE SET NULL;
