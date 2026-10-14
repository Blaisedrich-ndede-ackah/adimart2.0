-- Add registered customers, opening balances, and the customer account book.

CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  phone VARCHAR(30) NOT NULL DEFAULT '',
  opening_balance DECIMAL(12,2) NOT NULL DEFAULT 0 CHECK (opening_balance >= 0),
  opening_balance_remaining DECIMAL(12,2) NOT NULL DEFAULT 0 CHECK (opening_balance_remaining >= 0),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "customers_select" ON customers;
DROP POLICY IF EXISTS "customers_insert" ON customers;
DROP POLICY IF EXISTS "customers_update" ON customers;
DROP POLICY IF EXISTS "customers_delete" ON customers;
CREATE POLICY "customers_select" ON customers FOR SELECT USING (true);
CREATE POLICY "customers_insert" ON customers FOR INSERT WITH CHECK (true);
CREATE POLICY "customers_update" ON customers FOR UPDATE USING (true);
CREATE POLICY "customers_delete" ON customers FOR DELETE USING (true);
CREATE INDEX IF NOT EXISTS idx_customers_store ON customers(store_id, is_active, name);

CREATE TABLE IF NOT EXISTS customer_opening_payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  entry_type VARCHAR(20) NOT NULL DEFAULT 'payment' CHECK (entry_type IN ('opening_balance', 'payment')),
  amount DECIMAL(12,2) NOT NULL CHECK (amount > 0),
  created_by VARCHAR(255) DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE customer_opening_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "customer_opening_payments_select" ON customer_opening_payments;
DROP POLICY IF EXISTS "customer_opening_payments_insert" ON customer_opening_payments;
DROP POLICY IF EXISTS "customer_opening_payments_update" ON customer_opening_payments;
DROP POLICY IF EXISTS "customer_opening_payments_delete" ON customer_opening_payments;
CREATE POLICY "customer_opening_payments_select" ON customer_opening_payments FOR SELECT USING (true);
CREATE POLICY "customer_opening_payments_insert" ON customer_opening_payments FOR INSERT WITH CHECK (true);
CREATE POLICY "customer_opening_payments_update" ON customer_opening_payments FOR UPDATE USING (true);
CREATE POLICY "customer_opening_payments_delete" ON customer_opening_payments FOR DELETE USING (true);
CREATE INDEX IF NOT EXISTS idx_customer_opening_payments_store ON customer_opening_payments(store_id, created_at);
CREATE INDEX IF NOT EXISTS idx_customer_opening_payments_customer ON customer_opening_payments(customer_id, created_at);

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customers(id) ON DELETE SET NULL;

-- Preserve the existing credit ledger by registering customers already present on credit sales.
INSERT INTO customers (store_id, name, phone)
SELECT DISTINCT ON (t.store_id, lower(trim(t.customer_name)), coalesce(t.customer_phone, ''))
  t.store_id,
  trim(t.customer_name),
  coalesce(t.customer_phone, '')
FROM transactions t
WHERE t.payment_method = 'credit'
  AND nullif(trim(t.customer_name), '') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM customers c
    WHERE c.store_id = t.store_id
      AND lower(trim(c.name)) = lower(trim(t.customer_name))
      AND coalesce(c.phone, '') = coalesce(t.customer_phone, '')
  )
ORDER BY t.store_id, lower(trim(t.customer_name)), coalesce(t.customer_phone, ''), t.created_at;

UPDATE transactions t
SET customer_id = c.id
FROM customers c
WHERE t.payment_method = 'credit'
  AND t.customer_id IS NULL
  AND c.store_id = t.store_id
  AND lower(trim(c.name)) = lower(trim(t.customer_name))
  AND coalesce(c.phone, '') = coalesce(t.customer_phone, '');

NOTIFY pgrst, 'reload schema';
