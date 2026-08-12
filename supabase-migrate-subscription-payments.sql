-- ADIMAT POS - Self-serve subscription Paystack payments
-- Run in Supabase SQL editor. Safe to re-run.

CREATE TABLE IF NOT EXISTS subscription_payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  package_id VARCHAR(40) NOT NULL,
  months INTEGER NOT NULL CHECK (months >= 1 AND months <= 48),
  units INTEGER NOT NULL DEFAULT 1 CHECK (units >= 1),
  amount_ghs NUMERIC(12, 2) NOT NULL DEFAULT 0,
  paystack_reference VARCHAR(120) NOT NULL UNIQUE,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'success', 'failed')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

ALTER TABLE subscription_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "subscription_payments_select" ON subscription_payments;
DROP POLICY IF EXISTS "subscription_payments_insert" ON subscription_payments;
DROP POLICY IF EXISTS "subscription_payments_update" ON subscription_payments;

CREATE POLICY "subscription_payments_select" ON subscription_payments FOR SELECT USING (true);
CREATE POLICY "subscription_payments_insert" ON subscription_payments FOR INSERT WITH CHECK (true);
CREATE POLICY "subscription_payments_update" ON subscription_payments FOR UPDATE USING (true);

CREATE INDEX IF NOT EXISTS idx_subscription_payments_store ON subscription_payments(store_id);
CREATE INDEX IF NOT EXISTS idx_subscription_payments_status ON subscription_payments(status);
