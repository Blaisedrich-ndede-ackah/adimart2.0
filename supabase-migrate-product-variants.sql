-- ============================================================
-- ADIMAT POS - Migration: Product variants (size, color, flavor)
-- Run in Supabase SQL Editor if an older schema is already applied.
-- ============================================================

CREATE TABLE IF NOT EXISTS product_variants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  variant_name VARCHAR(50) NOT NULL DEFAULT '',   -- e.g. 'Size', 'Color', 'Flavor'
  variant_value VARCHAR(100) NOT NULL DEFAULT '', -- e.g. 'Large', 'Red', 'Vanilla'
  sku VARCHAR(100) DEFAULT '',
  barcode VARCHAR(100) DEFAULT '',
  price_adjustment DECIMAL(12,2) NOT NULL DEFAULT 0, -- added to base selling price
  stock_level INTEGER NOT NULL DEFAULT 0 CHECK (stock_level >= 0),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (store_id, product_id, variant_name, variant_value)
);

ALTER TABLE product_variants ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'product_variants' AND policyname = 'product_variants_select') THEN
    CREATE POLICY "product_variants_select" ON product_variants FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'product_variants' AND policyname = 'product_variants_insert') THEN
    CREATE POLICY "product_variants_insert" ON product_variants FOR INSERT WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'product_variants' AND policyname = 'product_variants_update') THEN
    CREATE POLICY "product_variants_update" ON product_variants FOR UPDATE USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'product_variants' AND policyname = 'product_variants_delete') THEN
    CREATE POLICY "product_variants_delete" ON product_variants FOR DELETE USING (true);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_product_variants_store ON product_variants(store_id, is_active);
CREATE INDEX IF NOT EXISTS idx_product_variants_product ON product_variants(product_id);
CREATE INDEX IF NOT EXISTS idx_product_variants_sku ON product_variants(store_id, sku);
CREATE INDEX IF NOT EXISTS idx_product_variants_barcode ON product_variants(store_id, barcode);

-- Link transaction items to a specific variant.
ALTER TABLE transaction_items
  ADD COLUMN IF NOT EXISTS variant_id UUID REFERENCES product_variants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_transaction_items_variant ON transaction_items(variant_id);

-- Link stock batches to a specific variant (optional, for variant-level batch tracking).
ALTER TABLE stock_batches
  ADD COLUMN IF NOT EXISTS variant_id UUID REFERENCES product_variants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_stock_batches_variant ON stock_batches(variant_id);

NOTIFY pgrst, 'reload schema';