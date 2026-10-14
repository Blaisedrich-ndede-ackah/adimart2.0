-- Add mixed-tender account receipts, return refunds, and customer wallet support.

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS wallet_balance DECIMAL(12,2) NOT NULL DEFAULT 0
  CHECK (wallet_balance >= 0);

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS wallet_amount DECIMAL(12,2) NOT NULL DEFAULT 0
  CHECK (wallet_amount >= 0);
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_payment_method_check;
ALTER TABLE transactions
  ADD CONSTRAINT transactions_payment_method_check
  CHECK (payment_method IN (
    'cash', 'split', 'paystack', 'momo_mtn', 'momo_telecel',
    'momo_airteltigo', 'bank_transfer', 'card_terminal', 'credit', 'wallet'
  ));

CREATE TABLE IF NOT EXISTS customer_account_receipts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  receipt_number VARCHAR(50) NOT NULL,
  amount DECIMAL(12,2) NOT NULL CHECK (amount > 0),
  cash_amount DECIMAL(12,2) NOT NULL DEFAULT 0 CHECK (cash_amount >= 0),
  momo_amount DECIMAL(12,2) NOT NULL DEFAULT 0 CHECK (momo_amount >= 0),
  cheque_amount DECIMAL(12,2) NOT NULL DEFAULT 0 CHECK (cheque_amount >= 0),
  balance_before DECIMAL(12,2) NOT NULL DEFAULT 0 CHECK (balance_before >= 0),
  balance_after DECIMAL(12,2) NOT NULL DEFAULT 0 CHECK (balance_after >= 0),
  created_by VARCHAR(255) DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(store_id, receipt_number)
);
ALTER TABLE customer_account_receipts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "customer_account_receipts_select" ON customer_account_receipts;
DROP POLICY IF EXISTS "customer_account_receipts_insert" ON customer_account_receipts;
DROP POLICY IF EXISTS "customer_account_receipts_update" ON customer_account_receipts;
DROP POLICY IF EXISTS "customer_account_receipts_delete" ON customer_account_receipts;
CREATE POLICY "customer_account_receipts_select" ON customer_account_receipts FOR SELECT USING (true);
CREATE POLICY "customer_account_receipts_insert" ON customer_account_receipts FOR INSERT WITH CHECK (true);
CREATE POLICY "customer_account_receipts_update" ON customer_account_receipts FOR UPDATE USING (true);
CREATE POLICY "customer_account_receipts_delete" ON customer_account_receipts FOR DELETE USING (true);
CREATE INDEX IF NOT EXISTS idx_customer_account_receipts_store ON customer_account_receipts(store_id, created_at);
CREATE INDEX IF NOT EXISTS idx_customer_account_receipts_customer ON customer_account_receipts(customer_id, created_at);

ALTER TABLE customer_opening_payments
  ADD COLUMN IF NOT EXISTS payment_method VARCHAR(20) NOT NULL DEFAULT 'cash',
  ADD COLUMN IF NOT EXISTS cash_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS momo_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cheque_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS account_receipt_id UUID;
UPDATE customer_opening_payments
SET cash_amount = amount
WHERE entry_type = 'payment'
  AND payment_method = 'cash'
  AND cash_amount = 0;
ALTER TABLE customer_opening_payments DROP CONSTRAINT IF EXISTS customer_opening_payments_payment_method_check;
ALTER TABLE customer_opening_payments
  ADD CONSTRAINT customer_opening_payments_payment_method_check
  CHECK (payment_method IN ('cash', 'momo', 'cheque', 'split'));
ALTER TABLE customer_opening_payments DROP CONSTRAINT IF EXISTS customer_opening_payments_account_receipt_fk;
ALTER TABLE customer_opening_payments
  ADD CONSTRAINT customer_opening_payments_account_receipt_fk
  FOREIGN KEY (account_receipt_id) REFERENCES customer_account_receipts(id) ON DELETE SET NULL;

ALTER TABLE credit_payments
  ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS account_receipt_id UUID REFERENCES customer_account_receipts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cash_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS momo_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cheque_amount DECIMAL(12,2) NOT NULL DEFAULT 0;
UPDATE credit_payments
SET cash_amount = amount
WHERE payment_method = 'cash' AND cash_amount = 0;
ALTER TABLE credit_payments DROP CONSTRAINT IF EXISTS credit_payments_payment_method_check;
ALTER TABLE credit_payments
  ADD CONSTRAINT credit_payments_payment_method_check
  CHECK (payment_method IN ('cash', 'momo', 'cheque', 'split'));
CREATE INDEX IF NOT EXISTS idx_credit_payments_customer_receipt ON credit_payments(customer_id, account_receipt_id);

ALTER TABLE stock_movements DROP CONSTRAINT IF EXISTS stock_movements_movement_type_check;
ALTER TABLE stock_movements
  ADD CONSTRAINT stock_movements_movement_type_check
  CHECK (movement_type IN ('receive', 'transfer', 'sale', 'adjust', 'return'));

CREATE TABLE IF NOT EXISTS sales_returns (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  transaction_item_id UUID NOT NULL REFERENCES transaction_items(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  product_name VARCHAR(255) NOT NULL DEFAULT '',
  quantity DECIMAL(12,3) NOT NULL CHECK (quantity > 0),
  stock_quantity INTEGER NOT NULL CHECK (stock_quantity > 0),
  reason VARCHAR(500) NOT NULL,
  photo_data_url TEXT NOT NULL DEFAULT '',
  receipt_number VARCHAR(50) NOT NULL DEFAULT '',
  location_id UUID REFERENCES locations(id) ON DELETE SET NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE sales_returns ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sales_returns_select" ON sales_returns;
DROP POLICY IF EXISTS "sales_returns_insert" ON sales_returns;
DROP POLICY IF EXISTS "sales_returns_update" ON sales_returns;
DROP POLICY IF EXISTS "sales_returns_delete" ON sales_returns;
CREATE POLICY "sales_returns_select" ON sales_returns FOR SELECT USING (true);
CREATE POLICY "sales_returns_insert" ON sales_returns FOR INSERT WITH CHECK (true);
CREATE POLICY "sales_returns_update" ON sales_returns FOR UPDATE USING (true);
CREATE POLICY "sales_returns_delete" ON sales_returns FOR DELETE USING (true);
CREATE INDEX IF NOT EXISTS idx_sales_returns_store ON sales_returns(store_id, created_at);
CREATE INDEX IF NOT EXISTS idx_sales_returns_item ON sales_returns(transaction_item_id);

ALTER TABLE sales_returns
  ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS refund_method VARCHAR(20) NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS refund_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS debt_applied DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS wallet_credit DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE sales_returns DROP CONSTRAINT IF EXISTS sales_returns_refund_method_check;
ALTER TABLE sales_returns
  ADD CONSTRAINT sales_returns_refund_method_check
  CHECK (refund_method IN ('none', 'cash', 'wallet', 'account'));
ALTER TABLE sales_returns DROP CONSTRAINT IF EXISTS sales_returns_refund_amount_check;
ALTER TABLE sales_returns
  ADD CONSTRAINT sales_returns_refund_amount_check
  CHECK (refund_amount >= 0 AND debt_applied >= 0 AND wallet_credit >= 0);

CREATE TABLE IF NOT EXISTS customer_wallet_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  type VARCHAR(20) NOT NULL CHECK (type IN ('return_credit', 'sale_debit')),
  amount DECIMAL(12,2) NOT NULL CHECK (amount > 0),
  balance_after DECIMAL(12,2) NOT NULL CHECK (balance_after >= 0),
  return_id UUID,
  transaction_id UUID,
  description TEXT NOT NULL DEFAULT '',
  created_by VARCHAR(255) NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE customer_wallet_transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "customer_wallet_transactions_select" ON customer_wallet_transactions;
DROP POLICY IF EXISTS "customer_wallet_transactions_insert" ON customer_wallet_transactions;
DROP POLICY IF EXISTS "customer_wallet_transactions_update" ON customer_wallet_transactions;
DROP POLICY IF EXISTS "customer_wallet_transactions_delete" ON customer_wallet_transactions;
CREATE POLICY "customer_wallet_transactions_select" ON customer_wallet_transactions FOR SELECT USING (true);
CREATE POLICY "customer_wallet_transactions_insert" ON customer_wallet_transactions FOR INSERT WITH CHECK (true);
CREATE POLICY "customer_wallet_transactions_update" ON customer_wallet_transactions FOR UPDATE USING (true);
CREATE POLICY "customer_wallet_transactions_delete" ON customer_wallet_transactions FOR DELETE USING (true);
CREATE INDEX IF NOT EXISTS idx_customer_wallet_transactions_customer ON customer_wallet_transactions(customer_id, created_at);
CREATE INDEX IF NOT EXISTS idx_customer_wallet_transactions_store ON customer_wallet_transactions(store_id, created_at);

NOTIFY pgrst, 'reload schema';
