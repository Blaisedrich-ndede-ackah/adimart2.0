-- ============================================================
-- ADIMAT POS - Migration: debt reminders, live dashboard, multi-store
-- Run in the Supabase SQL Editor for existing projects.
--
-- 1. Automated debt reminders
--    - stores.debt_reminders_enabled / _interval_days / _min_balance / _message
--    - customers.debt_reminder_opt_out
--    - debt_reminders audit table
-- 2. Live owner dashboard
--    - stores.sales_target_daily / sales_target_monthly
--    - transactions added to the realtime publication
-- 3. Multi-store consolidated view
--    - reads the stores the owner already links on the device; no new table
-- ============================================================

-- ------------------------------------------------------------
-- 1. Store settings: debt reminders + sales targets
-- ------------------------------------------------------------

ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS debt_reminders_enabled BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS debt_reminder_interval_days INTEGER NOT NULL DEFAULT 7
    CHECK (debt_reminder_interval_days >= 1 AND debt_reminder_interval_days <= 90);

ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS debt_reminder_min_balance NUMERIC NOT NULL DEFAULT 0
    CHECK (debt_reminder_min_balance >= 0);

ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS debt_reminder_message TEXT NOT NULL DEFAULT
    'Hi {name}, this is {store}. Your outstanding balance is {balance}. Please pay at the store. Thank you!';

ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS sales_target_daily NUMERIC NOT NULL DEFAULT 0
    CHECK (sales_target_daily >= 0);

ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS sales_target_monthly NUMERIC NOT NULL DEFAULT 0
    CHECK (sales_target_monthly >= 0);

-- ------------------------------------------------------------
-- 2. Per-customer opt-out
-- ------------------------------------------------------------

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS debt_reminder_opt_out BOOLEAN NOT NULL DEFAULT FALSE;

-- ------------------------------------------------------------
-- 3. Debt reminder audit trail
-- ------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS public.debt_reminders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  customer_name TEXT NOT NULL DEFAULT '',
  customer_phone TEXT NOT NULL DEFAULT '',
  balance NUMERIC NOT NULL DEFAULT 0 CHECK (balance >= 0),
  message TEXT NOT NULL DEFAULT '',
  provider TEXT NOT NULL DEFAULT 'mnotify',
  provider_message_id TEXT,
  status TEXT NOT NULL DEFAULT 'sent'
    CHECK (status IN ('sent', 'failed', 'skipped')),
  error_message TEXT,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_debt_reminders_store_sent
  ON public.debt_reminders(store_id, sent_at DESC);

CREATE INDEX IF NOT EXISTS idx_debt_reminders_customer
  ON public.debt_reminders(customer_id, sent_at DESC);

ALTER TABLE public.debt_reminders ENABLE ROW LEVEL SECURITY;

-- The store app reads its own reminder history with the anon key and
-- filters by store_id locally, so SELECT is permissive. Rows are written
-- by the device that sent the SMS; the anon key may insert its own rows
-- so the audit trail reaches the cloud.
REVOKE ALL ON TABLE public.debt_reminders FROM PUBLIC;

DROP POLICY IF EXISTS debt_reminders_select ON public.debt_reminders;
CREATE POLICY debt_reminders_select
  ON public.debt_reminders
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS debt_reminders_insert ON public.debt_reminders;
CREATE POLICY debt_reminders_insert
  ON public.debt_reminders
  FOR INSERT
  WITH CHECK (true);

-- Reminders are an append-only audit trail: once sent they are not edited.
DROP POLICY IF EXISTS debt_reminders_update ON public.debt_reminders;
CREATE POLICY debt_reminders_update
  ON public.debt_reminders
  FOR UPDATE
  USING (false)
  WITH CHECK (false);

DROP POLICY IF EXISTS debt_reminders_delete ON public.debt_reminders;
CREATE POLICY debt_reminders_delete
  ON public.debt_reminders
  FOR DELETE
  USING (false);

GRANT SELECT, INSERT ON TABLE public.debt_reminders TO anon, authenticated;
GRANT ALL ON TABLE public.debt_reminders TO service_role;

COMMENT ON TABLE public.debt_reminders IS
  'Audit trail of automated debt reminder SMS sent to customers with an outstanding balance.';

COMMENT ON COLUMN public.debt_reminders.status IS
  'sent = the customer was texted; failed = the provider rejected it; skipped = no phone number on file.';

-- ------------------------------------------------------------
-- 4. Live dashboard — publish sales for realtime subscribers
-- ------------------------------------------------------------

DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE transactions;
  EXCEPTION
    WHEN duplicate_object THEN NULL;
    WHEN undefined_object THEN NULL;
  END;
END $$;

NOTIFY pgrst, 'reload schema';
