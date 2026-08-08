-- ============================================================
-- ADIMAT POS - Migration: discount modes + cashier discount permission
-- Run in Supabase SQL Editor for existing projects.
-- ============================================================

ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS discount_allow_percentage BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS discount_allow_fixed BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS cashier_can_discount BOOLEAN DEFAULT TRUE;
