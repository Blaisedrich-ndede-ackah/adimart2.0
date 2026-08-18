-- Allow stock movement (and sale line) upserts from the POS.
-- Upsert is INSERT ... ON CONFLICT DO UPDATE, which needs an UPDATE policy.
-- Without this, Inventory shows:
--   Stock movements: new row violates row-level security policy (USING expression) — 42501
-- Run once in the Supabase SQL editor.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'stock_movements' AND policyname = 'stock_movements_update'
  ) THEN
    CREATE POLICY "stock_movements_update" ON stock_movements
      FOR UPDATE USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'stock_movements' AND policyname = 'stock_movements_delete'
  ) THEN
    CREATE POLICY "stock_movements_delete" ON stock_movements
      FOR DELETE USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'transaction_items' AND policyname = 'transaction_items_update'
  ) THEN
    CREATE POLICY "transaction_items_update" ON transaction_items
      FOR UPDATE USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'transaction_items' AND policyname = 'transaction_items_delete'
  ) THEN
    CREATE POLICY "transaction_items_delete" ON transaction_items
      FOR DELETE USING (true);
  END IF;
END $$;
