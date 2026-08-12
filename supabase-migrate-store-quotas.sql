-- ADIMAT POS - Reliable admin store/warehouse quotas
-- Run in Supabase SQL editor. Safe to re-run.

-- Keep column on stores for backwards compatibility
ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS max_stores INTEGER DEFAULT 1;

ALTER TABLE locations
  ADD COLUMN IF NOT EXISTS access_pin_hash TEXT;

-- Canonical quota table (admin writes here; owners read here)
CREATE TABLE IF NOT EXISTS store_quotas (
  store_id UUID PRIMARY KEY REFERENCES stores(id) ON DELETE CASCADE,
  warehouse_enabled BOOLEAN DEFAULT FALSE,
  max_shops INTEGER NOT NULL DEFAULT 1,
  max_warehouses INTEGER NOT NULL DEFAULT 0,
  max_stores INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE store_quotas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "store_quotas_select" ON store_quotas;
DROP POLICY IF EXISTS "store_quotas_insert" ON store_quotas;
DROP POLICY IF EXISTS "store_quotas_update" ON store_quotas;
DROP POLICY IF EXISTS "store_quotas_delete" ON store_quotas;

CREATE POLICY "store_quotas_select" ON store_quotas FOR SELECT USING (true);
CREATE POLICY "store_quotas_insert" ON store_quotas FOR INSERT WITH CHECK (true);
CREATE POLICY "store_quotas_update" ON store_quotas FOR UPDATE USING (true);
CREATE POLICY "store_quotas_delete" ON store_quotas FOR DELETE USING (true);

CREATE INDEX IF NOT EXISTS idx_store_quotas_updated ON store_quotas(updated_at);
