-- ============================================================
-- ADIMAT POS - Customer credit limits, terms, and due dates
-- Existing debt reminders keep using the outstanding balance.
-- A null credit limit means no limit. Null terms means no due date.
-- ============================================================

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS credit_limit DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS credit_terms_days INTEGER;

ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_credit_limit_check;
ALTER TABLE customers
  ADD CONSTRAINT customers_credit_limit_check
  CHECK (credit_limit IS NULL OR credit_limit >= 0);

ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_credit_terms_days_check;
ALTER TABLE customers
  ADD CONSTRAINT customers_credit_terms_days_check
  CHECK (credit_terms_days IS NULL OR credit_terms_days >= 0);

ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS credit_limit_action VARCHAR(10) NOT NULL DEFAULT 'warn';

ALTER TABLE stores DROP CONSTRAINT IF EXISTS stores_credit_limit_action_check;
ALTER TABLE stores
  ADD CONSTRAINT stores_credit_limit_action_check
  CHECK (credit_limit_action IN ('warn', 'block'));

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS credit_due_date DATE;

NOTIFY pgrst, 'reload schema';
