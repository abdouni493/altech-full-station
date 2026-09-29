-- Migration: Support 'En attente' (Pending) status for Brigades
-- Execute this SQL in your Supabase SQL Editor if needed.

-- 1. Ensure brigades status column exists and accepts text values
ALTER TABLE public.brigades 
  ALTER COLUMN status SET DATA TYPE text;

-- 2. Drop legacy constraint if any exists
ALTER TABLE public.brigades 
  DROP CONSTRAINT IF EXISTS check_brigade_status;

-- 3. Add check constraint for valid brigade statuses
ALTER TABLE public.brigades 
  ADD CONSTRAINT check_brigade_status 
  CHECK (status IN ('Planifiée', 'Ouverte', 'Clôturée', 'Fermée', 'En attente'));

-- 4. Ensure brigade_accounting status column accepts draft & completed
ALTER TABLE public.brigade_accounting 
  ALTER COLUMN status SET DATA TYPE text;

COMMENT ON COLUMN public.brigades.status IS 'Status of brigade: Planifiée, Ouverte, Clôturée, Fermée, En attente';
