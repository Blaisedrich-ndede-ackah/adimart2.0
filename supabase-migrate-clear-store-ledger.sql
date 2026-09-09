-- ============================================================
-- ADIMAT POS - Migration: Admin clear of a store's trial ledger
-- Run in the Supabase SQL Editor if you already applied an
-- older supabase-init.sql without transactions_cleared_at
-- or a DELETE policy on transactions.
--
-- Super-admin can wipe a store's sales, expenses, cash book, and
-- payouts after testing so reports start empty for live trading.
-- Devices pick up the wipe on the next sync.
-- ============================================================

ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS transactions_cleared_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_stores_transactions_cleared_at
  ON stores(transactions_cleared_at);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'transactions' AND policyname = 'transactions_delete'
  ) THEN
    CREATE POLICY "transactions_delete" ON transactions FOR DELETE USING (true);
  END IF;
END $$;
