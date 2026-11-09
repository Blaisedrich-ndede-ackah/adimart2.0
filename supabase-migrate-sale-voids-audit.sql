-- ============================================================
-- ADIMAT POS - Voided sales
-- Additive. Does not change the existing completed/pending status check.
-- A voided sale stays status = completed and is marked void_status = voided
-- so older reports that only know those two statuses keep their rows, while
-- the app excludes void_status = voided from totals.
-- Run in the Supabase SQL editor.
-- ============================================================

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS void_status VARCHAR(20) NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS void_reason TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS void_requested_by UUID,
  ADD COLUMN IF NOT EXISTS void_requested_by_name VARCHAR(255) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS void_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS voided_by UUID,
  ADD COLUMN IF NOT EXISTS voided_by_name VARCHAR(255) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ;

ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_void_status_check;
ALTER TABLE transactions
  ADD CONSTRAINT transactions_void_status_check
  CHECK (void_status IN ('none', 'requested', 'voided'));

CREATE INDEX IF NOT EXISTS idx_transactions_void_status ON transactions(store_id, void_status);

NOTIFY pgrst, 'reload schema';
