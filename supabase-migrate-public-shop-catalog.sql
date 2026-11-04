-- Speeds up the public storefront's active, online product listing and sort.
CREATE INDEX IF NOT EXISTS idx_products_public_shop_catalog
  ON products(store_id, name, id)
  WHERE is_active IS TRUE AND sell_online IS TRUE;
