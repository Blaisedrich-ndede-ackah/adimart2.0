-- ============================================================
-- ADIMAT POS - VAT rate folded into selling prices
-- The rate is stored on the store. Product selling prices stay a single
-- amount. The app rounds VAT into that amount and does not print VAT
-- as its own receipt line. Safe to run more than once.
-- ============================================================

ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS vat_rate DECIMAL(6,2) NOT NULL DEFAULT 0;

ALTER TABLE stores DROP CONSTRAINT IF EXISTS stores_vat_rate_check;
ALTER TABLE stores
  ADD CONSTRAINT stores_vat_rate_check
  CHECK (vat_rate >= 0 AND vat_rate <= 100);

NOTIFY pgrst, 'reload schema';
