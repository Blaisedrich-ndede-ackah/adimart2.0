-- ============================================================
-- ADIMAT POS - Migration: Admin portal + store MoMo payout fields
-- Run this in the Supabase SQL Editor if you already applied
-- an older supabase-init.sql without these columns/tables.
-- ============================================================

ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS momo_account_name VARCHAR(255) DEFAULT '',
  ADD COLUMN IF NOT EXISTS momo_number VARCHAR(50) DEFAULT '',
  ADD COLUMN IF NOT EXISTS momo_network VARCHAR(50) DEFAULT '';

CREATE TABLE IF NOT EXISTS payouts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  week_start DATE NOT NULL,
  week_end DATE NOT NULL,
  paystack_total DECIMAL(12,2) NOT NULL DEFAULT 0 CHECK (paystack_total >= 0),
  momo_account_name VARCHAR(255) DEFAULT '',
  momo_number VARCHAR(50) DEFAULT '',
  momo_network VARCHAR(50) DEFAULT '',
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent')),
  notes TEXT DEFAULT '',
  marked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (store_id, week_start)
);

ALTER TABLE payouts ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'payouts' AND policyname = 'payouts_select') THEN
    CREATE POLICY "payouts_select" ON payouts FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'payouts' AND policyname = 'payouts_insert') THEN
    CREATE POLICY "payouts_insert" ON payouts FOR INSERT WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'payouts' AND policyname = 'payouts_update') THEN
    CREATE POLICY "payouts_update" ON payouts FOR UPDATE USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'payouts' AND policyname = 'payouts_delete') THEN
    CREATE POLICY "payouts_delete" ON payouts FOR DELETE USING (true);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_payouts_store ON payouts(store_id);
CREATE INDEX IF NOT EXISTS idx_payouts_week ON payouts(week_start);
CREATE INDEX IF NOT EXISTS idx_payouts_status ON payouts(status);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'update_payouts_updated_at'
  ) THEN
    CREATE TRIGGER update_payouts_updated_at
      BEFORE UPDATE ON payouts
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;
