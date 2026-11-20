-- ============================================================
-- ADIMAT POS - Migration: Customer loyalty / rewards points
-- Run in Supabase SQL Editor if an older schema is already applied.
-- ============================================================

-- Loyalty points balance on the customer book.
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS loyalty_points_balance INTEGER NOT NULL DEFAULT 0 CHECK (loyalty_points_balance >= 0);

-- Loyalty earn rate (points per 1 currency unit spent) per store.
ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS loyalty_earn_rate INTEGER NOT NULL DEFAULT 0 CHECK (loyalty_earn_rate >= 0);

-- Loyalty points ledger: earn on sales, redeem on discounts.
CREATE TABLE IF NOT EXISTS customer_loyalty_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  transaction_id UUID REFERENCES transactions(id) ON DELETE SET NULL,
  type VARCHAR(10) NOT NULL CHECK (type IN ('earn', 'redeem')),
  points INTEGER NOT NULL CHECK (points > 0),
  balance_after INTEGER NOT NULL CHECK (balance_after >= 0),
  reason TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  synced BOOLEAN NOT NULL DEFAULT FALSE
);

ALTER TABLE customer_loyalty_transactions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'customer_loyalty_transactions' AND policyname = 'customer_loyalty_transactions_select') THEN
    CREATE POLICY "customer_loyalty_transactions_select" ON customer_loyalty_transactions FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'customer_loyalty_transactions' AND policyname = 'customer_loyalty_transactions_insert') THEN
    CREATE POLICY "customer_loyalty_transactions_insert" ON customer_loyalty_transactions FOR INSERT WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'customer_loyalty_transactions' AND policyname = 'customer_loyalty_transactions_update') THEN
    CREATE POLICY "customer_loyalty_transactions_update" ON customer_loyalty_transactions FOR UPDATE USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'customer_loyalty_transactions' AND policyname = 'customer_loyalty_transactions_delete') THEN
    CREATE POLICY "customer_loyalty_transactions_delete" ON customer_loyalty_transactions FOR DELETE USING (true);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_customer_loyalty_transactions_store ON customer_loyalty_transactions(store_id, created_at);
CREATE INDEX IF NOT EXISTS idx_customer_loyalty_transactions_customer ON customer_loyalty_transactions(customer_id, created_at);
CREATE INDEX IF NOT EXISTS idx_customer_loyalty_transactions_txn ON customer_loyalty_transactions(transaction_id);

NOTIFY pgrst, 'reload schema';