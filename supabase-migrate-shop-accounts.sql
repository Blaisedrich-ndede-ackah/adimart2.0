-- Shopper accounts, Paystack wallet ledger, and strict RLS.
-- Run in the Supabase SQL editor after supabase-migrate-ecommerce.sql
-- and supabase-migrate-customers-book.sql.
--
-- Shoppers authenticate with Supabase Auth. The POS till still uses its
-- anon key, so these new tables do not grant anon access. Wallet credits
-- are posted by the service role (Vercel functions) after Paystack verifies
-- the payment. Owners read balances through /api/shop-owner, which checks
-- the staff user belongs to that store.

CREATE TABLE IF NOT EXISTS shop_accounts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  auth_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  name VARCHAR(120) NOT NULL,
  phone VARCHAR(20) NOT NULL,
  email VARCHAR(255) NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (store_id, auth_user_id),
  UNIQUE (store_id, phone)
);

CREATE TABLE IF NOT EXISTS shop_wallet_entries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  entry_type VARCHAR(20) NOT NULL CHECK (entry_type IN ('topup', 'purchase', 'refund', 'adjustment')),
  direction VARCHAR(10) NOT NULL CHECK (direction IN ('credit', 'debit')),
  amount DECIMAL(12,2) NOT NULL CHECK (amount > 0),
  balance_after DECIMAL(12,2) NOT NULL CHECK (balance_after >= 0),
  payment_reference VARCHAR(80) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  order_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (payment_reference)
);

CREATE TABLE IF NOT EXISTS shop_payment_intents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  shop_account_id UUID REFERENCES shop_accounts(id) ON DELETE SET NULL,
  reference VARCHAR(80) NOT NULL UNIQUE,
  purpose VARCHAR(20) NOT NULL CHECK (purpose IN ('topup', 'checkout')),
  amount_pesewas INTEGER NOT NULL CHECK (amount_pesewas >= 0),
  wallet_pesewas INTEGER NOT NULL DEFAULT 0 CHECK (wallet_pesewas >= 0),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'failed')),
  order_id UUID,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS shop_auth_attempts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ip VARCHAR(80) NOT NULL DEFAULT '',
  action VARCHAR(40) NOT NULL,
  subject VARCHAR(120) NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE online_orders
  ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customers(id) ON DELETE SET NULL;
ALTER TABLE online_orders
  ADD COLUMN IF NOT EXISTS shop_account_id UUID REFERENCES shop_accounts(id) ON DELETE SET NULL;
ALTER TABLE online_orders
  ADD COLUMN IF NOT EXISTS wallet_amount DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE online_orders
  ADD COLUMN IF NOT EXISTS paystack_amount DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE online_orders
  ADD COLUMN IF NOT EXISTS paystack_reference VARCHAR(80) NOT NULL DEFAULT '';

ALTER TABLE customer_wallet_transactions
  ADD COLUMN IF NOT EXISTS payment_reference VARCHAR(80);

DO $$
DECLARE
  constraint_row record;
BEGIN
  FOR constraint_row IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'customer_wallet_transactions'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%type%'
  LOOP
    EXECUTE format('ALTER TABLE customer_wallet_transactions DROP CONSTRAINT %I', constraint_row.conname);
  END LOOP;
END $$;

ALTER TABLE customer_wallet_transactions
  DROP CONSTRAINT IF EXISTS customer_wallet_transactions_type_check;
ALTER TABLE customer_wallet_transactions
  ADD CONSTRAINT customer_wallet_transactions_type_check
  CHECK (type IN ('return_credit', 'sale_debit', 'topup', 'purchase', 'refund', 'adjustment'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_cwt_payment_reference
  ON customer_wallet_transactions (payment_reference)
  WHERE payment_reference IS NOT NULL AND payment_reference <> '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_online_orders_paystack_reference
  ON online_orders (paystack_reference)
  WHERE paystack_reference IS NOT NULL AND paystack_reference <> '';

CREATE INDEX IF NOT EXISTS idx_shop_accounts_customer ON shop_accounts (customer_id);
CREATE INDEX IF NOT EXISTS idx_shop_wallet_customer ON shop_wallet_entries (customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_shop_wallet_store ON shop_wallet_entries (store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_shop_payment_store ON shop_payment_intents (store_id, status);
CREATE INDEX IF NOT EXISTS idx_shop_auth_attempts_lookup ON shop_auth_attempts (action, ip, created_at DESC);

ALTER TABLE shop_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE shop_wallet_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE shop_payment_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE shop_auth_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS shop_accounts_select_own ON shop_accounts;
DROP POLICY IF EXISTS shop_wallet_select_own ON shop_wallet_entries;
DROP POLICY IF EXISTS shop_payment_select_own ON shop_payment_intents;

CREATE POLICY shop_accounts_select_own ON shop_accounts
  FOR SELECT TO authenticated
  USING (auth_user_id = auth.uid());

CREATE POLICY shop_wallet_select_own ON shop_wallet_entries
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM shop_accounts account
      WHERE account.auth_user_id = auth.uid()
        AND account.customer_id = shop_wallet_entries.customer_id
        AND account.store_id = shop_wallet_entries.store_id
    )
  );

CREATE POLICY shop_payment_select_own ON shop_payment_intents
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM shop_accounts account
      WHERE account.auth_user_id = auth.uid()
        AND account.id = shop_payment_intents.shop_account_id
        AND account.store_id = shop_payment_intents.store_id
    )
  );

REVOKE ALL ON TABLE shop_accounts FROM PUBLIC, anon;
REVOKE ALL ON TABLE shop_wallet_entries FROM PUBLIC, anon;
REVOKE ALL ON TABLE shop_payment_intents FROM PUBLIC, anon;
REVOKE ALL ON TABLE shop_auth_attempts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE shop_accounts TO authenticated;
GRANT SELECT ON TABLE shop_wallet_entries TO authenticated;
GRANT SELECT ON TABLE shop_payment_intents TO authenticated;

-- Idempotent wallet posting. Service role only.
CREATE OR REPLACE FUNCTION post_shop_wallet_entry(
  p_store uuid,
  p_customer uuid,
  p_type text,
  p_direction text,
  p_amount numeric,
  p_reference text,
  p_description text,
  p_order uuid
) RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  existing uuid;
  bal numeric;
  delta numeric;
BEGIN
  IF p_reference IS NULL OR length(trim(p_reference)) < 4 THEN
    RAISE EXCEPTION 'Payment reference is required';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive';
  END IF;
  IF p_type NOT IN ('topup', 'purchase', 'refund', 'adjustment') THEN
    RAISE EXCEPTION 'Invalid wallet entry type';
  END IF;
  IF p_direction NOT IN ('credit', 'debit') THEN
    RAISE EXCEPTION 'Invalid direction';
  END IF;

  SELECT id INTO existing
  FROM shop_wallet_entries
  WHERE payment_reference = p_reference;
  IF existing IS NOT NULL THEN
    SELECT wallet_balance INTO bal FROM customers WHERE id = p_customer;
    RETURN COALESCE(bal, 0);
  END IF;

  IF p_type = 'purchase' OR (p_type = 'adjustment' AND p_direction = 'debit') THEN
    delta := -ROUND(p_amount, 2);
  ELSE
    delta := ROUND(p_amount, 2);
  END IF;

  SELECT wallet_balance INTO bal
  FROM customers
  WHERE id = p_customer AND store_id = p_store
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Customer not found';
  END IF;

  bal := ROUND(COALESCE(bal, 0) + delta, 2);
  IF bal < 0 THEN
    RAISE EXCEPTION 'Insufficient wallet balance';
  END IF;

  INSERT INTO shop_wallet_entries (
    store_id, customer_id, entry_type, direction, amount, balance_after,
    payment_reference, description, order_id
  ) VALUES (
    p_store, p_customer, p_type,
    CASE WHEN delta < 0 THEN 'debit' ELSE 'credit' END,
    ROUND(p_amount, 2), bal, p_reference, left(coalesce(p_description, ''), 400), p_order
  );

  UPDATE customers
  SET wallet_balance = bal, updated_at = NOW()
  WHERE id = p_customer;

  INSERT INTO customer_wallet_transactions (
    store_id, customer_id, type, amount, balance_after, description, created_by, payment_reference
  ) VALUES (
    p_store,
    p_customer,
    p_type,
    ROUND(p_amount, 2),
    bal,
    CASE
      WHEN delta < 0 AND p_type = 'adjustment' THEN left('Debit: ' || coalesce(p_description, ''), 400)
      ELSE left(coalesce(p_description, ''), 400)
    END,
    'shop',
    p_reference
  );

  RETURN bal;
END;
$$;

REVOKE ALL ON FUNCTION post_shop_wallet_entry(uuid, uuid, text, text, numeric, text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION post_shop_wallet_entry(uuid, uuid, text, text, numeric, text, text, uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
