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
  momo_account_name VARCHAR(255) DEFAULT '',
  momo_number VARCHAR(50) DEFAULT '',
  momo_network VARCHAR(50) DEFAULT '',
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
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE transaction_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "transaction_items_select" ON transaction_items FOR SELECT USING (true);
CREATE POLICY "transaction_items_insert" ON transaction_items FOR INSERT WITH CHECK (true);

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

CREATE TRIGGER update_payouts_updated_at
  BEFORE UPDATE ON payouts
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- STOCK DEDUCTION FUNCTION (called after transaction item insert)
-- ============================================================
CREATE OR REPLACE FUNCTION deduct_stock_after_sale()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE products
  SET stock_level = GREATEST(0, stock_level - NEW.quantity),
      updated_at = NOW()
  WHERE id = NEW.product_id;
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER auto_deduct_stock
  AFTER INSERT ON transaction_items
  FOR EACH ROW
  EXECUTE FUNCTION deduct_stock_after_sale();
