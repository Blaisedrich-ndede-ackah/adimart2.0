-- Active browser/device presence and indexed incremental sync support.

CREATE TABLE IF NOT EXISTS active_device_sessions (
  session_id UUID PRIMARY KEY,
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  browser VARCHAR(32) NOT NULL,
  operating_system VARCHAR(32) NOT NULL,
  device_type VARCHAR(16) NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_active_device_sessions_last_seen
  ON active_device_sessions(last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_active_device_sessions_store_last_seen
  ON active_device_sessions(store_id, last_seen_at DESC);

ALTER TABLE active_device_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE active_device_sessions FROM anon, authenticated;
GRANT ALL ON TABLE active_device_sessions TO service_role;

ALTER TABLE transactions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE customers ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_users_store_updated_at
  ON users(store_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_product_categories_store_updated_at
  ON product_categories(store_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_transactions_store_updated_at
  ON transactions(store_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_transaction_items_store_created_at
  ON transaction_items(store_id, created_at);
CREATE INDEX IF NOT EXISTS idx_products_store_updated_at
  ON products(store_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_locations_store_updated_at
  ON locations(store_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_customers_store_updated_at
  ON customers(store_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_expenses_store_updated_at
  ON expenses(store_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_recurring_expenses_store_updated_at
  ON recurring_expenses(store_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_expense_budgets_store_updated_at
  ON expense_budgets(store_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_cash_book_entries_store_updated_at
  ON cash_book_entries(store_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_stock_movements_store_created_at
  ON stock_movements(store_id, created_at);
CREATE INDEX IF NOT EXISTS idx_online_orders_store_updated_at
  ON online_orders(store_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_online_order_items_store_created_at
  ON online_order_items(store_id, created_at);
CREATE INDEX IF NOT EXISTS idx_suppliers_store_updated_at
  ON suppliers(store_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_store_updated_at
  ON purchase_orders(store_id, updated_at);

DO $$
BEGIN
  IF to_regclass('public.debt_reminders') IS NOT NULL THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_debt_reminders_store_created_at ON public.debt_reminders(store_id, created_at)';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_transactions_updated_at ON transactions;
CREATE TRIGGER update_transactions_updated_at
  BEFORE UPDATE ON transactions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_customers_updated_at ON customers;
CREATE TRIGGER update_customers_updated_at
  BEFORE UPDATE ON customers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'stock_batches',
    'locations',
    'customers',
    'users',
    'product_categories',
    'products',
    'transactions',
    'transaction_items',
    'customer_account_receipts',
    'credit_payments',
    'customer_opening_payments',
    'sales_returns',
    'customer_wallet_transactions',
    'expenses',
    'recurring_expenses',
    'expense_budgets',
    'cash_book_entries',
    'stock_movements',
    'online_orders',
    'online_order_items',
    'suppliers',
    'purchase_orders',
    'bulk_sms_campaigns'
  ] LOOP
    IF to_regclass(format('public.%I', table_name)) IS NULL THEN
      CONTINUE;
    END IF;
    BEGIN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', table_name);
    EXCEPTION
      WHEN duplicate_object THEN NULL;
      WHEN undefined_object THEN NULL;
    END;
  END LOOP;
END $$;
