-- ============================================================
-- ADIMAT POS - Migration: Checkout other charges
-- Extra fees (delivery, packing, service, other) applied at checkout.
-- Run in the Supabase SQL Editor if you already applied an older schema.
-- ============================================================

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS other_charges_json TEXT DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS other_charges_total DECIMAL(12,2) DEFAULT 0;
