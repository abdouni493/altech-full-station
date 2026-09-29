-- ============================================================
-- StationPro – Brigade décalage alerts + datetime columns + seuils
-- Supports the unified 7-step brigade creation wizard:
--   • brigades.start_datetime / end_datetime  (ISO timestamps)
--   • station_settings.decalage_positif_seuil / decalage_negatif_seuil
--   • brigade_decalage_alerts table (admin dashboard alerts)
-- Run once in the Supabase SQL editor (Database → SQL Editor).
-- ============================================================

-- 1) Brigade start/end datetime columns ----------------------
ALTER TABLE public.brigades
  ADD COLUMN IF NOT EXISTS start_datetime timestamptz,
  ADD COLUMN IF NOT EXISTS end_datetime   timestamptz;

-- 2) Décalage alert thresholds on settings -------------------
ALTER TABLE public.station_settings
  ADD COLUMN IF NOT EXISTS decalage_positif_seuil numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS decalage_negatif_seuil numeric NOT NULL DEFAULT 0;

-- 3) Brigade décalage alerts table ---------------------------
CREATE TABLE IF NOT EXISTS public.brigade_decalage_alerts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- brigades.id is TEXT (uuid_generate_v4()::text), so this FK MUST be text.
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

CREATE INDEX IF NOT EXISTS idx_brigade_decalage_alerts_brigade   ON public.brigade_decalage_alerts(brigade_id);
CREATE INDEX IF NOT EXISTS idx_brigade_decalage_alerts_dismissed ON public.brigade_decalage_alerts(is_dismissed);
CREATE INDEX IF NOT EXISTS idx_brigade_decalage_alerts_created   ON public.brigade_decalage_alerts(created_at);

-- Row Level Security: mirror the open policy used by the rest of the app
ALTER TABLE public.brigade_decalage_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "brigade_decalage_alerts_all" ON public.brigade_decalage_alerts;
CREATE POLICY "brigade_decalage_alerts_all" ON public.brigade_decalage_alerts
  FOR ALL USING (true) WITH CHECK (true);

-- Realtime (optional — matches the app's subscribeTable usage)
ALTER PUBLICATION supabase_realtime ADD TABLE public.brigade_decalage_alerts;
