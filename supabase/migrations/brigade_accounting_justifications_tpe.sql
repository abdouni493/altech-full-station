-- ============================================================
-- StationPro – Brigade accounting justifications: TAG/TPE support
-- Extends public.brigade_accounting_justifications so TAG (bon)
-- and TPE justifications recorded during the comptabilité step
-- can be persisted (and reloaded) with their full detail.
-- Run once in the Supabase SQL editor (Database → SQL Editor).
-- ============================================================

-- TAG/TPE justifications have no client → client_id must be nullable.
ALTER TABLE public.brigade_accounting_justifications
  ALTER COLUMN client_id DROP NOT NULL;

-- New detail columns (idempotent).
ALTER TABLE public.brigade_accounting_justifications
  ADD COLUMN IF NOT EXISTS justification_type text NOT NULL DEFAULT 'CLIENT',
  ADD COLUMN IF NOT EXISTS client_name        text,
  ADD COLUMN IF NOT EXISTS fuel_type          text,
  ADD COLUMN IF NOT EXISTS liters             numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS price_per_liter    numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS track_id           uuid,
  ADD COLUMN IF NOT EXISTS pompiste_id        uuid;

-- Optional FKs (only added if the referenced tables exist and the
-- constraints are not already present). Safe to skip if undesired.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'baj_track_id_fkey'
      AND table_name = 'brigade_accounting_justifications'
  ) THEN
    ALTER TABLE public.brigade_accounting_justifications
      ADD CONSTRAINT baj_track_id_fkey
      FOREIGN KEY (track_id) REFERENCES public.tracks(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'baj_pompiste_id_fkey'
      AND table_name = 'brigade_accounting_justifications'
  ) THEN
    ALTER TABLE public.brigade_accounting_justifications
      ADD CONSTRAINT baj_pompiste_id_fkey
      FOREIGN KEY (pompiste_id) REFERENCES public.pompistes(id) ON DELETE SET NULL;
  END IF;
END $$;
