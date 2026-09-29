-- ============================================================
-- StationPro – Caisse TPE / Tag transactions
-- Stores TAG (bon) and TPE justifications recorded during the
-- brigade accounting (comptabilité) reconciliation step.
-- Run once in the Supabase SQL editor (Database → SQL Editor).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.tpe_transactions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- brigades.id is TEXT (uuid_generate_v4()::text), so this FK MUST be text.
  brigade_id      text REFERENCES public.brigades(id) ON DELETE CASCADE,
  -- The table is brigade_accounting (singular), not brigade_accountings.
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

CREATE INDEX IF NOT EXISTS idx_tpe_transactions_brigade    ON public.tpe_transactions(brigade_id);
CREATE INDEX IF NOT EXISTS idx_tpe_transactions_accounting ON public.tpe_transactions(accounting_id);
CREATE INDEX IF NOT EXISTS idx_tpe_transactions_date       ON public.tpe_transactions(date);

-- Row Level Security: mirror the open policy used by the rest of the app
ALTER TABLE public.tpe_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tpe_transactions_all" ON public.tpe_transactions;
CREATE POLICY "tpe_transactions_all" ON public.tpe_transactions
  FOR ALL USING (true) WITH CHECK (true);

-- Realtime (optional — matches the app's subscribeTable usage)
ALTER PUBLICATION supabase_realtime ADD TABLE public.tpe_transactions;
