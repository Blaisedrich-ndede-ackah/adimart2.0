-- ============================================================
-- Disable server-side auto stock deduction.
-- The app already deducts warehouse batches + product.stock_level
-- locally and syncs them. The old trigger double-deducted cloud stock.
-- Run once in the Supabase SQL editor for existing projects.
-- Matches supabase-init.sql behavior.
-- ============================================================

CREATE OR REPLACE FUNCTION deduct_stock_after_sale()
RETURNS TRIGGER AS $$
BEGIN
  -- NO-OP: client + stock_batches are the quantity authority.
  RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS auto_deduct_stock ON transaction_items;
