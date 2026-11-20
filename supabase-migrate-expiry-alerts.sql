-- ============================================================
-- ADIMAT POS - Migration: Expiry / batch tracking enhancements
-- Adds near-expiry alert configuration and ensures batch expiry
-- is fully wired through receive, FEFO allocation, and alerts.
-- Run in Supabase SQL Editor if an older schema is already applied.
-- ============================================================

-- Near-expiry alert window (days) per store. Default 7 days.
ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS near_expiry_alert_days INTEGER NOT NULL DEFAULT 7 CHECK (near_expiry_alert_days >= 0 AND near_expiry_alert_days <= 90);

-- Ensure stock_batches has expiry_date (idempotent; already present in current schema).
ALTER TABLE stock_batches
  ADD COLUMN IF NOT EXISTS expiry_date DATE;

CREATE INDEX IF NOT EXISTS idx_stock_batches_expiry_notnull ON stock_batches(expiry_date) WHERE expiry_date IS NOT NULL;

-- Ensure products has track_expiry flag (idempotent; already present in current schema).
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS track_expiry BOOLEAN DEFAULT FALSE;

NOTIFY pgrst, 'reload schema';