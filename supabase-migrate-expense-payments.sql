-- ============================================================
-- ADIMAT POS - Expense date and payment method
-- Existing expense rows stay valid. Date falls back to created_at
-- in the app when this column is empty. Payment method is optional
-- so older expenses are not reclassified.
-- ============================================================

ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS expense_date DATE,
  ADD COLUMN IF NOT EXISTS payment_method VARCHAR(20) NOT NULL DEFAULT '';

ALTER TABLE expenses DROP CONSTRAINT IF EXISTS expenses_payment_method_check;
ALTER TABLE expenses
  ADD CONSTRAINT expenses_payment_method_check
  CHECK (payment_method IN ('', 'cash', 'momo', 'bank'));

NOTIFY pgrst, 'reload schema';
