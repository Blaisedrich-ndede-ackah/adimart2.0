-- ============================================================
-- ADIMAT POS - Sell by weight or measure
-- Widens integer quantity columns to NUMERIC(14,3). Existing whole
-- numbers stay the same value (5 stays 5.000). No columns are dropped.
-- Run AFTER supabase-migrate-product-variants.sql so variant stock
-- can be widened too. Safe to run more than once.
-- ============================================================

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS unit VARCHAR(30) NOT NULL DEFAULT 'pcs',
  ADD COLUMN IF NOT EXISTS allow_decimal BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE transaction_items
  ADD COLUMN IF NOT EXISTS measure_unit VARCHAR(30) NOT NULL DEFAULT '';

DO $$
DECLARE
  rec record;
BEGIN
  FOR rec IN
    SELECT * FROM (VALUES
      ('products', 'stock_level'),
      ('transaction_items', 'quantity'),
      ('transaction_items', 'base_quantity'),
      ('stock_batches', 'quantity'),
      ('stock_movements', 'quantity'),
      ('sales_returns', 'quantity'),
      ('sales_returns', 'stock_quantity'),
      ('stock_receipt_requests', 'quantity'),
      ('stock_approval_logs', 'quantity'),
      ('transfer_logs', 'quantity'),
      ('product_variants', 'stock_level')
    ) AS cols(table_name, column_name)
  LOOP
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = rec.table_name
        AND column_name = rec.column_name
        AND data_type IN ('integer', 'bigint', 'smallint')
    ) THEN
      EXECUTE format(
        'ALTER TABLE %I ALTER COLUMN %I TYPE NUMERIC(14,3) USING %I::numeric',
        rec.table_name,
        rec.column_name,
        rec.column_name
      );
    END IF;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
