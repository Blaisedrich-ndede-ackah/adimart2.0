-- ============================================================
-- ADIMAT POS - Store deals (sale prices, multi-buy, discounts, coupons)
-- This is separate from promotional_campaigns, which are ADIMAT admin flyers.
-- Do not drop or rename that table.
-- ============================================================

CREATE TABLE IF NOT EXISTS store_promotions (
  id UUID PRIMARY KEY,
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  name VARCHAR(120) NOT NULL,
  promo_type VARCHAR(20) NOT NULL CHECK (promo_type IN ('sale_price', 'percent', 'fixed', 'multibuy', 'coupon')),
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  category VARCHAR(100) NOT NULL DEFAULT '',
  sale_price DECIMAL(12,2) NOT NULL DEFAULT 0,
  percent_off DECIMAL(6,2) NOT NULL DEFAULT 0,
  amount_off DECIMAL(12,2) NOT NULL DEFAULT 0,
  buy_quantity INTEGER NOT NULL DEFAULT 0,
  free_quantity INTEGER NOT NULL DEFAULT 0,
  coupon_code VARCHAR(40) NOT NULL DEFAULT '',
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE store_promotions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'store_promotions' AND policyname = 'store_promotions_select') THEN
    CREATE POLICY "store_promotions_select" ON store_promotions FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'store_promotions' AND policyname = 'store_promotions_insert') THEN
    CREATE POLICY "store_promotions_insert" ON store_promotions FOR INSERT WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'store_promotions' AND policyname = 'store_promotions_update') THEN
    CREATE POLICY "store_promotions_update" ON store_promotions FOR UPDATE USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'store_promotions' AND policyname = 'store_promotions_delete') THEN
    CREATE POLICY "store_promotions_delete" ON store_promotions FOR DELETE USING (true);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_store_promotions_store ON store_promotions(store_id, is_active);
CREATE INDEX IF NOT EXISTS idx_store_promotions_coupon ON store_promotions(store_id, coupon_code);

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS promotion_discount DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS promotion_summary TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS coupon_code VARCHAR(40) NOT NULL DEFAULT '';

ALTER TABLE transaction_items
  ADD COLUMN IF NOT EXISTS list_unit_price DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS promotion_label TEXT NOT NULL DEFAULT '';

NOTIFY pgrst, 'reload schema';
