-- ============================================================================
-- StationPro Naftal — Fiche Journalière + Décalage settings update
-- ----------------------------------------------------------------------------
-- This migration is DEFENSIVE & IDEMPOTENT. The features shipped in this round
-- (Dashboard "Paramètres de Décalage", per-fuel comptabilité, GPL %, justifs
-- with description/total, brigade edit, the new Fiche Journalière template)
-- reuse columns that already exist in the current schema. This script only
-- guarantees those columns/indexes exist on older databases — it does NOT drop
-- or rewrite anything. Run once in Supabase → SQL Editor.
-- ============================================================================

-- 1) Décalage acceptance settings (used by the Dashboard button + the brigade
--    comparison step). All four columns must exist on station_settings.
ALTER TABLE public.station_settings
  ADD COLUMN IF NOT EXISTS decalage_positif_actif boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS decalage_negatif_actif boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS decalage_positif_seuil numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS decalage_negatif_seuil numeric NOT NULL DEFAULT 0;

-- 2) Carburant buy prices (used for "gains" = vente − achat in the fiche).
ALTER TABLE public.station_settings
  ADD COLUMN IF NOT EXISTS fuel_buy_prices jsonb NOT NULL
    DEFAULT '{"GPL": 0, "SUPER": 0, "DIESEL": 0, "GASOIL": 0, "ESSENCE": 0}'::jsonb;

-- 3) Justification fields used by the new justification UI
--    (description -> notes ; optional carburant/litres calc).
ALTER TABLE public.brigade_accounting_justifications
  ADD COLUMN IF NOT EXISTS notes           text,
  ADD COLUMN IF NOT EXISTS fuel_type       text,
  ADD COLUMN IF NOT EXISTS liters          numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS price_per_liter numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS client_name     text,
  ADD COLUMN IF NOT EXISTS track_id        uuid,
  ADD COLUMN IF NOT EXISTS pompiste_id     uuid;

-- 4) Brigade end datetime columns (used when reloading a brigade for edit).
ALTER TABLE public.brigades
  ADD COLUMN IF NOT EXISTS start_datetime timestamptz,
  ADD COLUMN IF NOT EXISTS end_datetime   timestamptz;

-- 5) Performance indexes for the Fiche Journalière period aggregations.
CREATE INDEX IF NOT EXISTS idx_baj_accounting           ON public.brigade_accounting_justifications(accounting_id);
CREATE INDEX IF NOT EXISTS idx_baj_type                 ON public.brigade_accounting_justifications(justification_type);
CREATE INDEX IF NOT EXISTS idx_tpe_transactions_date    ON public.tpe_transactions(date);
CREATE INDEX IF NOT EXISTS idx_brigade_decalage_bdate   ON public.brigade_decalage_alerts(brigade_date);
CREATE INDEX IF NOT EXISTS idx_brigades_date            ON public.brigades(date);
CREATE INDEX IF NOT EXISTS idx_expenses_date            ON public.expenses(date);
CREATE INDEX IF NOT EXISTS idx_worker_acomptes_date     ON public.worker_acomptes(date);

-- Note: editing a brigade re-deletes its décalage alerts via
--   DELETE FROM brigade_decalage_alerts WHERE brigade_id = <id>;
-- which is covered by idx_brigade_decalage_alerts_brigade (already created in
-- brigade_decalage_alerts.sql). No schema change needed for that.
