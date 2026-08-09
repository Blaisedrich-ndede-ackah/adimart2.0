-- ============================================================
-- ADIMAT POS - Migration: warehouse, locations, batches, bulk pricing
-- Run in Supabase SQL Editor if an older schema is already applied.
-- ============================================================

ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS warehouse_enabled BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS max_shops INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS max_warehouses INTEGER DEFAULT 0;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS assigned_location_id UUID,
  ADD COLUMN IF NOT EXISTS can_wholesale BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS can_sell_from_warehouse BOOLEAN DEFAULT FALSE;

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS pack_size INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS track_expiry BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS wholesale_mode VARCHAR(20) DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS wholesale_pack_price DECIMAL(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS wholesale_unit_price DECIMAL(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS wholesale_tiers_json TEXT DEFAULT '[]';

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS location_id UUID,
  ADD COLUMN IF NOT EXISTS sale_mode VARCHAR(20) DEFAULT 'retail';

ALTER TABLE transaction_items
  ADD COLUMN IF NOT EXISTS unit_type VARCHAR(20) DEFAULT 'base',
  ADD COLUMN IF NOT EXISTS pack_size INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS base_quantity INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS batch_id UUID;

CREATE TABLE IF NOT EXISTS locations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  location_type VARCHAR(20) NOT NULL CHECK (location_type IN ('shop', 'warehouse')),
  is_default BOOLEAN DEFAULT FALSE,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE locations ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'locations' AND policyname = 'locations_select') THEN
    CREATE POLICY "locations_select" ON locations FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'locations' AND policyname = 'locations_insert') THEN
    CREATE POLICY "locations_insert" ON locations FOR INSERT WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'locations' AND policyname = 'locations_update') THEN
    CREATE POLICY "locations_update" ON locations FOR UPDATE USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'locations' AND policyname = 'locations_delete') THEN
    CREATE POLICY "locations_delete" ON locations FOR DELETE USING (true);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_locations_store ON locations(store_id);

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

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'stock_batches' AND policyname = 'stock_batches_select') THEN
    CREATE POLICY "stock_batches_select" ON stock_batches FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'stock_batches' AND policyname = 'stock_batches_insert') THEN
    CREATE POLICY "stock_batches_insert" ON stock_batches FOR INSERT WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'stock_batches' AND policyname = 'stock_batches_update') THEN
    CREATE POLICY "stock_batches_update" ON stock_batches FOR UPDATE USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'stock_batches' AND policyname = 'stock_batches_delete') THEN
    CREATE POLICY "stock_batches_delete" ON stock_batches FOR DELETE USING (true);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_stock_batches_store ON stock_batches(store_id);
CREATE INDEX IF NOT EXISTS idx_stock_batches_product ON stock_batches(product_id);
CREATE INDEX IF NOT EXISTS idx_stock_batches_location ON stock_batches(location_id);
CREATE INDEX IF NOT EXISTS idx_stock_batches_expiry ON stock_batches(expiry_date);

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

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'stock_movements' AND policyname = 'stock_movements_select') THEN
    CREATE POLICY "stock_movements_select" ON stock_movements FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'stock_movements' AND policyname = 'stock_movements_insert') THEN
    CREATE POLICY "stock_movements_insert" ON stock_movements FOR INSERT WITH CHECK (true);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_stock_movements_store ON stock_movements(store_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_product ON stock_movements(product_id);
