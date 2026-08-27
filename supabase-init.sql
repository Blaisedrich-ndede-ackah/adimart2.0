-- ============================================================
-- ADIMAT POS - Supabase PostgreSQL Initialization Script
-- Multi-tenant schema with Row Level Security (RLS) policies
-- ============================================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- STORES TABLE (Multi-tenant: each store is a business)
-- ============================================================
CREATE TABLE IF NOT EXISTS stores (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  address TEXT DEFAULT '',
  support_number VARCHAR(50) DEFAULT '',
  discount_cap_percentage INTEGER DEFAULT 10 CHECK (discount_cap_percentage >= 0 AND discount_cap_percentage <= 100),
  pin_on_discount_enabled BOOLEAN DEFAULT TRUE,
  discount_allow_percentage BOOLEAN DEFAULT TRUE,
  discount_allow_fixed BOOLEAN DEFAULT TRUE,
  cashier_can_discount BOOLEAN DEFAULT TRUE,
  momo_account_name VARCHAR(255) DEFAULT '',
  momo_number VARCHAR(50) DEFAULT '',
  momo_network VARCHAR(50) DEFAULT '',
  subscription_started_at TIMESTAMPTZ,
  subscription_expires_at TIMESTAMPTZ,
  subscription_months_granted INTEGER DEFAULT 0,
  /** Admin can lock a store that refuses to pay until they buy a package */
  access_blocked BOOLEAN DEFAULT FALSE,
  logo_url TEXT DEFAULT '',
  warehouse_enabled BOOLEAN DEFAULT FALSE,
  max_shops INTEGER DEFAULT 1,
  max_warehouses INTEGER DEFAULT 0,
  /** How many business stores this owner may create (admin-managed) */
  max_stores INTEGER DEFAULT 1,
  ecommerce_enabled BOOLEAN DEFAULT FALSE,
  ecommerce_slug VARCHAR(80) DEFAULT '',
  ecommerce_tagline TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE stores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "stores_select" ON stores FOR SELECT USING (true);
CREATE POLICY "stores_insert" ON stores FOR INSERT WITH CHECK (true);
CREATE POLICY "stores_update" ON stores FOR UPDATE USING (true);

-- ============================================================
-- USERS TABLE (linked to stores)
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  role VARCHAR(20) NOT NULL CHECK (role IN ('owner', 'cashier')),
  pin_hash VARCHAR(255) NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  phone VARCHAR(50) DEFAULT '',
  assigned_location_id UUID,
  can_wholesale BOOLEAN DEFAULT FALSE,
  can_sell_from_warehouse BOOLEAN DEFAULT FALSE,
  can_manage_ecommerce BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_select" ON users FOR SELECT USING (true);
CREATE POLICY "users_insert" ON users FOR INSERT WITH CHECK (true);
CREATE POLICY "users_update" ON users FOR UPDATE USING (true);
CREATE POLICY "users_delete" ON users FOR DELETE USING (true);

CREATE INDEX IF NOT EXISTS idx_users_store ON users(store_id);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);

-- ============================================================
-- PRODUCTS TABLE (linked to stores)
-- ============================================================
CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  category VARCHAR(100) DEFAULT 'Other',
  sku_type VARCHAR(50) DEFAULT 'unit',
  barcode VARCHAR(100) DEFAULT '',
  cost_price DECIMAL(12,2) NOT NULL DEFAULT 0 CHECK (cost_price >= 0),
  selling_price DECIMAL(12,2) NOT NULL DEFAULT 0 CHECK (selling_price >= 0),
  stock_level INTEGER NOT NULL DEFAULT 0 CHECK (stock_level >= 0),
  is_active BOOLEAN DEFAULT TRUE,
  image_url TEXT DEFAULT '',
  pack_size INTEGER DEFAULT 1,
  track_expiry BOOLEAN DEFAULT FALSE,
  wholesale_mode VARCHAR(20) DEFAULT 'none',
  wholesale_pack_price DECIMAL(12,2) DEFAULT 0,
  wholesale_unit_price DECIMAL(12,2) DEFAULT 0,
  wholesale_tiers_json TEXT DEFAULT '[]',
  sell_online BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "products_select" ON products FOR SELECT USING (true);
CREATE POLICY "products_insert" ON products FOR INSERT WITH CHECK (true);
CREATE POLICY "products_update" ON products FOR UPDATE USING (true);
CREATE POLICY "products_delete" ON products FOR DELETE USING (true);

CREATE INDEX IF NOT EXISTS idx_products_store ON products(store_id);
CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(store_id, barcode);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(store_id, category);
CREATE INDEX IF NOT EXISTS idx_products_is_active ON products(store_id, is_active);

-- ============================================================
-- TRANSACTIONS TABLE (linked to stores)
-- ============================================================
CREATE TABLE IF NOT EXISTS transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  receipt_number VARCHAR(50) NOT NULL,
  cashier_id UUID REFERENCES users(id) ON DELETE SET NULL,
  cashier_name VARCHAR(255) DEFAULT '',
  total_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  discount_applied DECIMAL(12,2) DEFAULT 0,
  payment_method VARCHAR(20) NOT NULL CHECK (payment_method IN ('cash', 'split', 'paystack')),
  cash_amount DECIMAL(12,2) DEFAULT 0,
  paystack_amount DECIMAL(12,2) DEFAULT 0,
  paystack_reference VARCHAR(100) DEFAULT '',
  status VARCHAR(20) NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'pending')),
  location_id UUID,
  sale_mode VARCHAR(20) DEFAULT 'retail',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "transactions_select" ON transactions FOR SELECT USING (true);
CREATE POLICY "transactions_insert" ON transactions FOR INSERT WITH CHECK (true);
CREATE POLICY "transactions_update" ON transactions FOR UPDATE USING (true);

CREATE INDEX IF NOT EXISTS idx_transactions_store ON transactions(store_id);
CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions(store_id, created_at);
CREATE INDEX IF NOT EXISTS idx_transactions_cashier ON transactions(store_id, cashier_id);
CREATE INDEX IF NOT EXISTS idx_transactions_receipt ON transactions(store_id, receipt_number);

-- Unique receipt number per store
CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_receipt_unique ON transactions(store_id, receipt_number);

-- ============================================================
-- TRANSACTION ITEMS TABLE (linked to stores)
-- ============================================================
CREATE TABLE IF NOT EXISTS transaction_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  product_name VARCHAR(255) DEFAULT '',
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price DECIMAL(12,2) NOT NULL DEFAULT 0,
  subtotal DECIMAL(12,2) NOT NULL DEFAULT 0,
  unit_type VARCHAR(20) DEFAULT 'base',
  pack_size INTEGER DEFAULT 1,
  base_quantity INTEGER DEFAULT 0,
  batch_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE transaction_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "transaction_items_select" ON transaction_items FOR SELECT USING (true);
CREATE POLICY "transaction_items_insert" ON transaction_items FOR INSERT WITH CHECK (true);
CREATE POLICY "transaction_items_update" ON transaction_items FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "transaction_items_delete" ON transaction_items FOR DELETE USING (true);

CREATE INDEX IF NOT EXISTS idx_transaction_items_store ON transaction_items(store_id);
CREATE INDEX IF NOT EXISTS idx_transaction_items_txn ON transaction_items(transaction_id);

-- ============================================================
-- EXPENSES TABLE (linked to stores)
-- ============================================================
CREATE TABLE IF NOT EXISTS expenses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  description VARCHAR(255) NOT NULL,
  category VARCHAR(100) DEFAULT 'Other',
  amount DECIMAL(12,2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "expenses_select" ON expenses FOR SELECT USING (true);
CREATE POLICY "expenses_insert" ON expenses FOR INSERT WITH CHECK (true);
CREATE POLICY "expenses_update" ON expenses FOR UPDATE USING (true);
CREATE POLICY "expenses_delete" ON expenses FOR DELETE USING (true);

CREATE INDEX IF NOT EXISTS idx_expenses_store ON expenses(store_id);
CREATE INDEX IF NOT EXISTS idx_expenses_category ON expenses(store_id, category);
CREATE INDEX IF NOT EXISTS idx_expenses_created_at ON expenses(store_id, created_at);

-- ============================================================
-- CASH BOOK (owner cash flow ledger)
-- ============================================================
CREATE TABLE IF NOT EXISTS cash_book_entries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  entry_type VARCHAR(20) NOT NULL CHECK (entry_type IN ('income', 'expense')),
  description VARCHAR(255) NOT NULL,
  category VARCHAR(100) DEFAULT 'Other',
  amount DECIMAL(12,2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  notes TEXT DEFAULT '',
  entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_by VARCHAR(255) DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE cash_book_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cash_book_entries_select" ON cash_book_entries FOR SELECT USING (true);
CREATE POLICY "cash_book_entries_insert" ON cash_book_entries FOR INSERT WITH CHECK (true);
CREATE POLICY "cash_book_entries_update" ON cash_book_entries FOR UPDATE USING (true);
CREATE POLICY "cash_book_entries_delete" ON cash_book_entries FOR DELETE USING (true);

CREATE INDEX IF NOT EXISTS idx_cash_book_store ON cash_book_entries(store_id);
CREATE INDEX IF NOT EXISTS idx_cash_book_date ON cash_book_entries(store_id, entry_date);
CREATE INDEX IF NOT EXISTS idx_cash_book_type ON cash_book_entries(store_id, entry_type);

-- ============================================================
-- LOCATIONS (shops / warehouses per store)
-- ============================================================
CREATE TABLE IF NOT EXISTS locations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  location_type VARCHAR(20) NOT NULL CHECK (location_type IN ('shop', 'warehouse')),
  is_default BOOLEAN DEFAULT FALSE,
  is_active BOOLEAN DEFAULT TRUE,
  /** Optional PIN hash to open/manage this warehouse from Settings */
  access_pin_hash TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE locations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "locations_select" ON locations FOR SELECT USING (true);
CREATE POLICY "locations_insert" ON locations FOR INSERT WITH CHECK (true);
CREATE POLICY "locations_update" ON locations FOR UPDATE USING (true);
CREATE POLICY "locations_delete" ON locations FOR DELETE USING (true);

CREATE INDEX IF NOT EXISTS idx_locations_store ON locations(store_id);

-- ============================================================
-- STORE QUOTAS (admin-managed caps — source of truth for limits)
-- ============================================================
CREATE TABLE IF NOT EXISTS store_quotas (
  store_id UUID PRIMARY KEY REFERENCES stores(id) ON DELETE CASCADE,
  warehouse_enabled BOOLEAN DEFAULT FALSE,
  max_shops INTEGER NOT NULL DEFAULT 1,
  max_warehouses INTEGER NOT NULL DEFAULT 0,
  max_stores INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE store_quotas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "store_quotas_select" ON store_quotas FOR SELECT USING (true);
CREATE POLICY "store_quotas_insert" ON store_quotas FOR INSERT WITH CHECK (true);
CREATE POLICY "store_quotas_update" ON store_quotas FOR UPDATE USING (true);
CREATE POLICY "store_quotas_delete" ON store_quotas FOR DELETE USING (true);

-- ============================================================
-- STOCK BATCHES (expiry-tracked inventory per location)
-- ============================================================
CREATE TABLE IF NOT EXISTS stock_batches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  location_id UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  batch_code VARCHAR(100) DEFAULT '',
  expiry_date DATE,
  quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  cost_price DECIMAL(12,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE stock_batches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "stock_batches_select" ON stock_batches FOR SELECT USING (true);
CREATE POLICY "stock_batches_insert" ON stock_batches FOR INSERT WITH CHECK (true);
CREATE POLICY "stock_batches_update" ON stock_batches FOR UPDATE USING (true);
CREATE POLICY "stock_batches_delete" ON stock_batches FOR DELETE USING (true);

CREATE INDEX IF NOT EXISTS idx_stock_batches_store ON stock_batches(store_id);
CREATE INDEX IF NOT EXISTS idx_stock_batches_product ON stock_batches(product_id);
CREATE INDEX IF NOT EXISTS idx_stock_batches_location ON stock_batches(location_id);
CREATE INDEX IF NOT EXISTS idx_stock_batches_expiry ON stock_batches(expiry_date);

-- ============================================================
-- STOCK MOVEMENTS (receive / transfer / sale / adjust)
-- ============================================================
CREATE TABLE IF NOT EXISTS stock_movements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  batch_id UUID REFERENCES stock_batches(id) ON DELETE SET NULL,
  from_location_id UUID REFERENCES locations(id) ON DELETE SET NULL,
  to_location_id UUID REFERENCES locations(id) ON DELETE SET NULL,
  movement_type VARCHAR(20) NOT NULL CHECK (movement_type IN ('receive', 'transfer', 'sale', 'adjust')),
  quantity INTEGER NOT NULL,
  note TEXT DEFAULT '',
  user_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "stock_movements_select" ON stock_movements FOR SELECT USING (true);
CREATE POLICY "stock_movements_insert" ON stock_movements FOR INSERT WITH CHECK (true);
CREATE POLICY "stock_movements_update" ON stock_movements FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "stock_movements_delete" ON stock_movements FOR DELETE USING (true);

CREATE INDEX IF NOT EXISTS idx_stock_movements_store ON stock_movements(store_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_product ON stock_movements(product_id);

-- ============================================================
-- WEEKLY PAYOUTS (admin marks Paystack remittances to stores)
-- ============================================================
CREATE TABLE IF NOT EXISTS payouts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  week_start DATE NOT NULL,
  week_end DATE NOT NULL,
  paystack_total DECIMAL(12,2) NOT NULL DEFAULT 0 CHECK (paystack_total >= 0),
  momo_account_name VARCHAR(255) DEFAULT '',
  momo_number VARCHAR(50) DEFAULT '',
  momo_network VARCHAR(50) DEFAULT '',
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent')),
  notes TEXT DEFAULT '',
  marked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (store_id, week_start)
);

ALTER TABLE payouts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "payouts_select" ON payouts FOR SELECT USING (true);
CREATE POLICY "payouts_insert" ON payouts FOR INSERT WITH CHECK (true);
CREATE POLICY "payouts_update" ON payouts FOR UPDATE USING (true);
CREATE POLICY "payouts_delete" ON payouts FOR DELETE USING (true);

CREATE INDEX IF NOT EXISTS idx_payouts_store ON payouts(store_id);
CREATE INDEX IF NOT EXISTS idx_payouts_week ON payouts(week_start);
CREATE INDEX IF NOT EXISTS idx_payouts_status ON payouts(status);

-- ============================================================
-- SUBSCRIPTION GRANTS (admin grants monthly store access)
-- ============================================================
CREATE TABLE IF NOT EXISTS subscription_grants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  months INTEGER NOT NULL CHECK (months > 0),
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  notes TEXT DEFAULT '',
  granted_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE subscription_grants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "subscription_grants_select" ON subscription_grants FOR SELECT USING (true);
CREATE POLICY "subscription_grants_insert" ON subscription_grants FOR INSERT WITH CHECK (true);
CREATE POLICY "subscription_grants_update" ON subscription_grants FOR UPDATE USING (true);
CREATE POLICY "subscription_grants_delete" ON subscription_grants FOR DELETE USING (true);

CREATE INDEX IF NOT EXISTS idx_subscription_grants_store ON subscription_grants(store_id);
CREATE INDEX IF NOT EXISTS idx_subscription_grants_granted_at ON subscription_grants(granted_at);

-- ============================================================
-- SUBSCRIPTION PAYMENTS (self-serve Paystack renewals)
-- ============================================================
CREATE TABLE IF NOT EXISTS subscription_payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  package_id VARCHAR(40) NOT NULL,
  months INTEGER NOT NULL CHECK (months >= 1 AND months <= 48),
  units INTEGER NOT NULL DEFAULT 1 CHECK (units >= 1),
  amount_ghs NUMERIC(12, 2) NOT NULL DEFAULT 0,
  paystack_reference VARCHAR(120) NOT NULL UNIQUE,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'success', 'failed')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

ALTER TABLE subscription_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "subscription_payments_select" ON subscription_payments FOR SELECT USING (true);
CREATE POLICY "subscription_payments_insert" ON subscription_payments FOR INSERT WITH CHECK (true);
CREATE POLICY "subscription_payments_update" ON subscription_payments FOR UPDATE USING (true);

CREATE INDEX IF NOT EXISTS idx_subscription_payments_store ON subscription_payments(store_id);
CREATE INDEX IF NOT EXISTS idx_stores_subscription_expires ON stores(subscription_expires_at);
CREATE INDEX IF NOT EXISTS idx_stores_access_blocked ON stores(access_blocked);

-- ============================================================
-- PLATFORM SETTINGS (global admin contact + SMS config)
-- ============================================================
CREATE TABLE IF NOT EXISTS platform_settings (
  id TEXT PRIMARY KEY DEFAULT 'main',
  contact_whatsapp VARCHAR(50) DEFAULT '',
  contact_email VARCHAR(255) DEFAULT '',
  mnotify_api_key TEXT DEFAULT '',
  mnotify_sender_id VARCHAR(11) DEFAULT 'Adimat',
  admin_phone VARCHAR(50) DEFAULT '',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE platform_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "platform_settings_select" ON platform_settings FOR SELECT USING (true);
CREATE POLICY "platform_settings_insert" ON platform_settings FOR INSERT WITH CHECK (true);
CREATE POLICY "platform_settings_update" ON platform_settings FOR UPDATE USING (true);

INSERT INTO platform_settings (id, contact_whatsapp, contact_email, mnotify_api_key, mnotify_sender_id)
VALUES ('main', '', '', '', 'Adimat')
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- HELPER FUNCTIONS
-- ============================================================

-- Function to auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply triggers
CREATE TRIGGER update_stores_updated_at
  BEFORE UPDATE ON stores
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_products_updated_at
  BEFORE UPDATE ON products
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_expenses_updated_at
  BEFORE UPDATE ON expenses
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_cash_book_entries_updated_at
  BEFORE UPDATE ON cash_book_entries
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_locations_updated_at
  BEFORE UPDATE ON locations
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_stock_batches_updated_at
  BEFORE UPDATE ON stock_batches
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_payouts_updated_at
  BEFORE UPDATE ON payouts
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_platform_settings_updated_at
  BEFORE UPDATE ON platform_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- ONLINE ORDERS (public e-commerce storefront)
-- ============================================================
CREATE UNIQUE INDEX IF NOT EXISTS idx_stores_ecommerce_slug
  ON stores (ecommerce_slug)
  WHERE ecommerce_slug IS NOT NULL AND ecommerce_slug <> '';

CREATE TABLE IF NOT EXISTS online_orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  order_number VARCHAR(40) NOT NULL,
  customer_name VARCHAR(255) NOT NULL,
  customer_phone VARCHAR(50) NOT NULL DEFAULT '',
  customer_address TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  status VARCHAR(20) NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'confirmed', 'fulfilled', 'cancelled')),
  payment_method VARCHAR(40) NOT NULL DEFAULT 'pay_on_delivery',
  total_amount DECIMAL(12,2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS online_order_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES online_orders(id) ON DELETE CASCADE,
  product_id UUID,
  product_name VARCHAR(255) NOT NULL,
  unit_price DECIMAL(12,2) NOT NULL DEFAULT 0,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  subtotal DECIMAL(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE online_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE online_order_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "online_orders_select" ON online_orders FOR SELECT USING (true);
CREATE POLICY "online_orders_insert" ON online_orders FOR INSERT WITH CHECK (true);
CREATE POLICY "online_orders_update" ON online_orders FOR UPDATE USING (true);
CREATE POLICY "online_order_items_select" ON online_order_items FOR SELECT USING (true);
CREATE POLICY "online_order_items_insert" ON online_order_items FOR INSERT WITH CHECK (true);
CREATE POLICY "online_order_items_update" ON online_order_items FOR UPDATE USING (true);

CREATE INDEX IF NOT EXISTS idx_online_orders_store ON online_orders(store_id);
CREATE INDEX IF NOT EXISTS idx_online_orders_status ON online_orders(store_id, status);
CREATE INDEX IF NOT EXISTS idx_online_order_items_order ON online_order_items(order_id);

CREATE TRIGGER update_online_orders_updated_at
  BEFORE UPDATE ON online_orders
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- STOCK DEDUCTION FUNCTION (called after transaction item insert)
-- ============================================================
CREATE OR REPLACE FUNCTION deduct_stock_after_sale()
RETURNS TRIGGER AS $$
BEGIN
  -- NO-OP: client + stock_batches are the quantity authority.
  -- Keeping the function avoids errors if an old trigger still references it.
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Prefer dropping the trigger entirely (also see supabase-migrate-disable-auto-deduct.sql)
DROP TRIGGER IF EXISTS auto_deduct_stock ON transaction_items;

-- Live stock sync: phones and computers receive cloud batch/product changes.
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE stock_batches;
  EXCEPTION
    WHEN duplicate_object THEN NULL;
    WHEN undefined_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE products;
  EXCEPTION
    WHEN duplicate_object THEN NULL;
    WHEN undefined_object THEN NULL;
  END;
END $$;
