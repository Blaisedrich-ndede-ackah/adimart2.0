-- ============================================================
-- ADIMAT POS - E-commerce storefront migration
-- Run in Supabase SQL Editor if your project predates this feature
-- ============================================================

ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS ecommerce_enabled BOOLEAN DEFAULT FALSE;

ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS ecommerce_slug VARCHAR(80) DEFAULT '';

ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS ecommerce_tagline TEXT DEFAULT '';

ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS ecommerce_links TEXT DEFAULT '[]';

CREATE UNIQUE INDEX IF NOT EXISTS idx_stores_ecommerce_slug
  ON stores (ecommerce_slug)
  WHERE ecommerce_slug IS NOT NULL AND ecommerce_slug <> '';

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS sell_online BOOLEAN DEFAULT FALSE;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS can_manage_ecommerce BOOLEAN DEFAULT FALSE;

-- Online orders (public can insert; stores sync/manage)
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

DROP POLICY IF EXISTS "online_orders_select" ON online_orders;
DROP POLICY IF EXISTS "online_orders_insert" ON online_orders;
DROP POLICY IF EXISTS "online_orders_update" ON online_orders;
DROP POLICY IF EXISTS "online_order_items_select" ON online_order_items;
DROP POLICY IF EXISTS "online_order_items_insert" ON online_order_items;
DROP POLICY IF EXISTS "online_order_items_update" ON online_order_items;

CREATE POLICY "online_orders_select" ON online_orders FOR SELECT USING (true);
CREATE POLICY "online_orders_insert" ON online_orders FOR INSERT WITH CHECK (true);
CREATE POLICY "online_orders_update" ON online_orders FOR UPDATE USING (true);
CREATE POLICY "online_order_items_select" ON online_order_items FOR SELECT USING (true);
CREATE POLICY "online_order_items_insert" ON online_order_items FOR INSERT WITH CHECK (true);
CREATE POLICY "online_order_items_update" ON online_order_items FOR UPDATE USING (true);

CREATE INDEX IF NOT EXISTS idx_online_orders_store ON online_orders(store_id);
CREATE INDEX IF NOT EXISTS idx_online_orders_status ON online_orders(store_id, status);
CREATE INDEX IF NOT EXISTS idx_online_order_items_order ON online_order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_products_sell_online ON products(store_id, sell_online);
