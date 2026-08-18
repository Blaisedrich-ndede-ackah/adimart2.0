-- ============================================================
-- Disable server-side auto stock deduction.
-- The app already deducts warehouse batches + product.stock_level
-- locally and syncs them. The trigger double-deducted cloud stock
-- and caused Inventory/POS/device mismatches.
-- Run this once in the Supabase SQL editor (or via migration).
-- ============================================================

DROP TRIGGER IF EXISTS auto_deduct_stock ON transaction_items;
DROP FUNCTION IF EXISTS deduct_stock_after_sale();
