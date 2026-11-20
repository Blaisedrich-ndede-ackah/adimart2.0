-- ============================================================
-- ADIMAT POS - Loyalty redeem value and sale points
-- Run AFTER supabase-migrate-loyalty-points.sql, which adds
-- customers.loyalty_points_balance, stores.loyalty_earn_rate,
-- and customer_loyalty_transactions.
-- earn rate = points per 1 currency unit. redeem value = currency per point.
-- ============================================================

ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS loyalty_redeem_value DECIMAL(12,4) NOT NULL DEFAULT 0;

ALTER TABLE stores DROP CONSTRAINT IF EXISTS stores_loyalty_redeem_value_check;
ALTER TABLE stores
  ADD CONSTRAINT stores_loyalty_redeem_value_check
  CHECK (loyalty_redeem_value >= 0);

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS loyalty_points_earned INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS loyalty_points_redeemed INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS loyalty_redeem_amount DECIMAL(12,2) NOT NULL DEFAULT 0;

NOTIFY pgrst, 'reload schema';
