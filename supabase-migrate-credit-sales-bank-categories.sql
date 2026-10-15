-- Enable owner-managed product categories, credit sales, and bank cash-book entries.

CREATE TABLE IF NOT EXISTS product_categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (store_id, name)
);

ALTER TABLE product_categories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "product_categories_select" ON product_categories;
DROP POLICY IF EXISTS "product_categories_insert" ON product_categories;
DROP POLICY IF EXISTS "product_categories_update" ON product_categories;
DROP POLICY IF EXISTS "product_categories_delete" ON product_categories;
CREATE POLICY "product_categories_select" ON product_categories FOR SELECT USING (true);
CREATE POLICY "product_categories_insert" ON product_categories FOR INSERT WITH CHECK (true);
CREATE POLICY "product_categories_update" ON product_categories FOR UPDATE USING (true);
CREATE POLICY "product_categories_delete" ON product_categories FOR DELETE USING (true);
CREATE INDEX IF NOT EXISTS idx_product_categories_store ON product_categories(store_id, is_active);

CREATE TABLE IF NOT EXISTS credit_payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  amount DECIMAL(12,2) NOT NULL CHECK (amount > 0),
  payment_method VARCHAR(20) NOT NULL DEFAULT 'cash' CHECK (payment_method = 'cash'),
  created_by VARCHAR(255) DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE credit_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "credit_payments_select" ON credit_payments;
DROP POLICY IF EXISTS "credit_payments_insert" ON credit_payments;
DROP POLICY IF EXISTS "credit_payments_update" ON credit_payments;
DROP POLICY IF EXISTS "credit_payments_delete" ON credit_payments;
CREATE POLICY "credit_payments_select" ON credit_payments FOR SELECT USING (true);
CREATE POLICY "credit_payments_insert" ON credit_payments FOR INSERT WITH CHECK (true);
CREATE POLICY "credit_payments_update" ON credit_payments FOR UPDATE USING (true);
CREATE POLICY "credit_payments_delete" ON credit_payments FOR DELETE USING (true);
CREATE INDEX IF NOT EXISTS idx_credit_payments_store ON credit_payments(store_id, created_at);
CREATE INDEX IF NOT EXISTS idx_credit_payments_transaction ON credit_payments(transaction_id, created_at);

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS customer_name VARCHAR(255) DEFAULT '',
  ADD COLUMN IF NOT EXISTS customer_phone VARCHAR(30) DEFAULT '',
  ADD COLUMN IF NOT EXISTS credit_paid_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS credit_balance DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_payment_method_check;
ALTER TABLE transactions ADD CONSTRAINT transactions_payment_method_check
  CHECK (payment_method IN (
    'cash', 'split', 'paystack', 'momo_mtn', 'momo_telecel',
    'momo_airteltigo', 'bank_transfer', 'card_terminal', 'credit'
  ));

ALTER TABLE cash_book_entries
  ADD COLUMN IF NOT EXISTS account_type VARCHAR(10) NOT NULL DEFAULT 'cash';
ALTER TABLE cash_book_entries DROP CONSTRAINT IF EXISTS cash_book_entries_account_type_check;
ALTER TABLE cash_book_entries ADD CONSTRAINT cash_book_entries_account_type_check
  CHECK (account_type IN ('cash', 'bank'));

NOTIFY pgrst, 'reload schema';
