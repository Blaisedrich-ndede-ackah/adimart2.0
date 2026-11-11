-- Record each goods payment sent from Paystack to a store MoMo number.
-- Safe to run more than once.

CREATE TABLE IF NOT EXISTS store_momo_payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL,
  reference TEXT NOT NULL UNIQUE,
  amount_pesewas INTEGER NOT NULL,
  momo_number TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  paystack_transfer_code TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE store_momo_payouts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "store_momo_payouts_select" ON store_momo_payouts;
CREATE POLICY "store_momo_payouts_select" ON store_momo_payouts FOR SELECT USING (true);
GRANT SELECT ON store_momo_payouts TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
