-- One-time, time-limited Scan & Pay exit tokens and audit history.
ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS pickup_verification_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS pickup_token_ttl_minutes INTEGER NOT NULL DEFAULT 30
    CHECK (pickup_token_ttl_minutes BETWEEN 5 AND 240);

CREATE TABLE IF NOT EXISTS public.pickup_tokens (
  id UUID PRIMARY KEY,
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES public.online_orders(id) ON DELETE CASCADE,
  order_number TEXT NOT NULL,
  token_code VARCHAR(8) NOT NULL,
  qr_payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'issued' CHECK (status IN ('issued', 'redeemed', 'expired')),
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  redeemed_at TIMESTAMPTZ,
  redeemed_by UUID,
  redeemed_by_name TEXT,
  redeemed_method TEXT CHECK (redeemed_method IS NULL OR redeemed_method IN ('scan', 'override')),
  UNIQUE (order_id),
  UNIQUE (store_id, token_code)
);

CREATE INDEX IF NOT EXISTS idx_pickup_tokens_store_issued
  ON public.pickup_tokens(store_id, issued_at DESC);
CREATE INDEX IF NOT EXISTS idx_pickup_tokens_store_status_expiry
  ON public.pickup_tokens(store_id, status, expires_at);

CREATE TABLE IF NOT EXISTS public.pickup_verification_logs (
  id UUID PRIMARY KEY,
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  token_id UUID REFERENCES public.pickup_tokens(id) ON DELETE SET NULL,
  order_id UUID,
  order_number TEXT NOT NULL DEFAULT '',
  scanned_code TEXT NOT NULL DEFAULT '',
  event_type TEXT NOT NULL CHECK (event_type IN ('redeemed', 'override')),
  verified_by UUID,
  verified_by_name TEXT NOT NULL DEFAULT '',
  details TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pickup_verification_logs_store_time
  ON public.pickup_verification_logs(store_id, created_at DESC);

ALTER TABLE public.pickup_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pickup_verification_logs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.pickup_tokens FROM anon, authenticated;
GRANT SELECT, INSERT ON public.pickup_tokens TO anon, authenticated;
GRANT UPDATE (status, redeemed_at, redeemed_by, redeemed_by_name, redeemed_method)
  ON public.pickup_tokens TO anon, authenticated;
GRANT ALL ON public.pickup_tokens TO service_role;

DROP POLICY IF EXISTS pickup_tokens_read ON public.pickup_tokens;
CREATE POLICY pickup_tokens_read ON public.pickup_tokens
  FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS pickup_tokens_issue ON public.pickup_tokens;
CREATE POLICY pickup_tokens_issue ON public.pickup_tokens
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.online_orders AS orders
      WHERE orders.id = pickup_tokens.order_id
        AND orders.store_id = pickup_tokens.store_id
        AND orders.order_number = pickup_tokens.order_number
        AND orders.order_number LIKE 'PS-%'
        AND orders.payment_method = 'paystack'
        AND orders.notes ~ '^price-scan-paystack:[A-Za-z0-9_-]{4,80}$'
    )
    AND EXISTS (
      SELECT 1 FROM public.stores AS stores
      WHERE stores.id = pickup_tokens.store_id
        AND stores.pickup_verification_enabled = TRUE
    )
  );
DROP POLICY IF EXISTS pickup_tokens_redeem ON public.pickup_tokens;
CREATE POLICY pickup_tokens_redeem ON public.pickup_tokens
  FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

GRANT SELECT, INSERT ON public.pickup_verification_logs TO anon, authenticated;
GRANT ALL ON public.pickup_verification_logs TO service_role;
DROP POLICY IF EXISTS pickup_verification_logs_read ON public.pickup_verification_logs;
CREATE POLICY pickup_verification_logs_read ON public.pickup_verification_logs
  FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS pickup_verification_logs_insert ON public.pickup_verification_logs;
CREATE POLICY pickup_verification_logs_insert ON public.pickup_verification_logs
  FOR INSERT TO anon, authenticated WITH CHECK (true);
