-- ADIMAT POS - Branch inventory transfers
-- Apply after supabase-migrate-warehouse.sql.
-- This migration is schema-only: it creates no demo, seed, or mock data.

CREATE TABLE IF NOT EXISTS transfer_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  source_branch_id UUID NOT NULL REFERENCES locations(id) ON DELETE RESTRICT,
  destination_branch_id UUID NOT NULL REFERENCES locations(id) ON DELETE RESTRICT,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  item_name TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  transferred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  performed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  stock_movement_id UUID REFERENCES stock_movements(id) ON DELETE SET NULL,
  CONSTRAINT transfer_logs_different_branches
    CHECK (source_branch_id <> destination_branch_id)
);

ALTER TABLE transfer_logs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'transfer_logs' AND policyname = 'transfer_logs_select'
  ) THEN
    CREATE POLICY "transfer_logs_select" ON transfer_logs FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'transfer_logs' AND policyname = 'transfer_logs_insert'
  ) THEN
    CREATE POLICY "transfer_logs_insert" ON transfer_logs FOR INSERT WITH CHECK (true);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_transfer_logs_store_time
  ON transfer_logs(store_id, transferred_at DESC);
CREATE INDEX IF NOT EXISTS idx_transfer_logs_source_branch
  ON transfer_logs(source_branch_id, transferred_at DESC);
CREATE INDEX IF NOT EXISTS idx_transfer_logs_destination_branch
  ON transfer_logs(destination_branch_id, transferred_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_transfer_logs_movement
  ON transfer_logs(stock_movement_id)
  WHERE stock_movement_id IS NOT NULL;

CREATE OR REPLACE FUNCTION log_completed_inventory_transfer()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  transferred_item_name TEXT;
BEGIN
  IF NEW.movement_type <> 'transfer'
     OR NEW.from_location_id IS NULL
     OR NEW.to_location_id IS NULL
     OR NEW.quantity <= 0 THEN
    RETURN NEW;
  END IF;

  SELECT name INTO transferred_item_name
  FROM products
  WHERE id = NEW.product_id;

  INSERT INTO transfer_logs (
    store_id,
    source_branch_id,
    destination_branch_id,
    product_id,
    item_name,
    quantity,
    transferred_at,
    performed_by,
    stock_movement_id
  )
  VALUES (
    NEW.store_id,
    NEW.from_location_id,
    NEW.to_location_id,
    NEW.product_id,
    COALESCE(transferred_item_name, 'Unknown item'),
    NEW.quantity,
    NEW.created_at,
    NEW.user_id,
    NEW.id
  )
  ON CONFLICT (stock_movement_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS stock_movement_transfer_log ON stock_movements;
CREATE TRIGGER stock_movement_transfer_log
AFTER INSERT ON stock_movements
FOR EACH ROW
EXECUTE FUNCTION log_completed_inventory_transfer();

-- Atomic server-side transfer primitive for integrations and future clients.
-- The existing POS also writes stock_movements locally; the trigger above logs
-- those completed transfers when they are synchronized to Supabase.
CREATE OR REPLACE FUNCTION transfer_inventory_between_branches(
  p_store_id UUID,
  p_source_branch_id UUID,
  p_destination_branch_id UUID,
  p_item_name TEXT,
  p_quantity INTEGER,
  p_performed_by UUID DEFAULT NULL
)
RETURNS transfer_logs
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  source_product products%ROWTYPE;
  source_batch stock_batches%ROWTYPE;
  destination_batch stock_batches%ROWTYPE;
  movement stock_movements%ROWTYPE;
  result_log transfer_logs%ROWTYPE;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Transfer quantity must be greater than zero';
  END IF;
  IF p_source_branch_id = p_destination_branch_id THEN
    RAISE EXCEPTION 'Source and destination branches must differ';
  END IF;
  IF NULLIF(BTRIM(p_item_name), '') IS NULL THEN
    RAISE EXCEPTION 'Item name is required';
  END IF;

  SELECT * INTO source_product
  FROM products
  WHERE store_id = p_store_id
    AND LOWER(BTRIM(name)) = LOWER(BTRIM(p_item_name))
    AND is_active = TRUE
  ORDER BY updated_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item not found in source branch';
  END IF;

  SELECT * INTO source_batch
  FROM stock_batches
  WHERE store_id = p_store_id
    AND product_id = source_product.id
    AND location_id = p_source_branch_id
    AND quantity > 0
  ORDER BY expiry_date NULLS LAST, created_at
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND OR source_batch.quantity < p_quantity THEN
    RAISE EXCEPTION 'Insufficient stock in source branch';
  END IF;

  UPDATE stock_batches
  SET quantity = quantity - p_quantity, updated_at = NOW()
  WHERE id = source_batch.id;

  SELECT * INTO destination_batch
  FROM stock_batches
  WHERE store_id = p_store_id
    AND product_id = source_product.id
    AND location_id = p_destination_branch_id
  ORDER BY updated_at DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    UPDATE stock_batches
    SET quantity = quantity + p_quantity, updated_at = NOW()
    WHERE id = destination_batch.id;
  ELSE
    INSERT INTO stock_batches (
      store_id, product_id, location_id, batch_code, expiry_date,
      quantity, cost_price, created_at, updated_at
    )
    VALUES (
      p_store_id, source_product.id, p_destination_branch_id,
      source_batch.batch_code, source_batch.expiry_date, p_quantity,
      source_batch.cost_price, NOW(), NOW()
    )
    RETURNING * INTO destination_batch;
  END IF;

  INSERT INTO stock_movements (
    store_id, product_id, batch_id, from_location_id, to_location_id,
    movement_type, quantity, note, user_id
  )
  VALUES (
    p_store_id, source_product.id, source_batch.id, p_source_branch_id,
    p_destination_branch_id, 'transfer', p_quantity,
    'Branch inventory transfer', p_performed_by
  )
  RETURNING * INTO movement;

  SELECT * INTO result_log
  FROM transfer_logs
  WHERE stock_movement_id = movement.id;

  RETURN result_log;
END;
$$;

REVOKE ALL ON FUNCTION transfer_inventory_between_branches(UUID, UUID, UUID, TEXT, INTEGER, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION transfer_inventory_between_branches(UUID, UUID, UUID, TEXT, INTEGER, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION transfer_inventory_between_branches(UUID, UUID, UUID, TEXT, INTEGER, UUID) TO anon;

GRANT SELECT, INSERT ON transfer_logs TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON stock_batches TO anon, authenticated;
GRANT SELECT, INSERT ON stock_movements TO anon, authenticated;

COMMENT ON TABLE transfer_logs IS 'Completed inventory transfers between branches.';
COMMENT ON FUNCTION transfer_inventory_between_branches(UUID, UUID, UUID, TEXT, INTEGER, UUID)
  IS 'Atomically deducts source stock, merges or creates destination stock, and records a transfer log.';

-- Optional verification after applying:
-- SELECT column_name, data_type FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'transfer_logs'
-- ORDER BY ordinal_position;
-- SELECT routine_name FROM information_schema.routines
-- WHERE routine_schema = 'public' AND routine_name = 'transfer_inventory_between_branches';
