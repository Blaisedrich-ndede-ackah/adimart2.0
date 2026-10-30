-- ============================================================
-- ADIMAT POS - Stock visibility, receipt approval, activity log,
-- support ticket access for the PIN admin portal, and today's-sales refunds.
-- Run after supabase-init.sql and supabase-migrate-support-agent.sql.
--
-- The shop app and the PIN administrator portal both use the anon key.
-- Store operational tables stay readable by that key, matching stores/users.
-- activity_logs is the exception: devices may insert and update rows, but
-- SELECT is revoked from anon and authenticated. Only the service-role
-- admin API (after a valid administrator session) can read the log.
-- ============================================================

ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS cashiers_can_view_stock BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN public.stores.cashiers_can_view_stock IS
  'When false, cashier sessions must not display on-hand quantities. Owners always can.';

-- Sales returns can record a cash refund taken from the same day's cash sales.
ALTER TABLE public.sales_returns DROP CONSTRAINT IF EXISTS sales_returns_refund_method_check;
ALTER TABLE public.sales_returns
  ADD CONSTRAINT sales_returns_refund_method_check
  CHECK (refund_method IN ('none', 'cash', 'wallet', 'account', 'today_sales'));

CREATE TABLE IF NOT EXISTS public.stock_receipt_requests (
  id UUID PRIMARY KEY,
  store_id UUID NOT NULL,
  product_id UUID NOT NULL,
  product_name TEXT NOT NULL DEFAULT '',
  location_id UUID,
  location_name TEXT NOT NULL DEFAULT '',
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  kind TEXT NOT NULL CHECK (kind IN ('receive', 'adjust_in', 'purchase', 'opening', 'count')),
  note TEXT NOT NULL DEFAULT '',
  batch_code TEXT NOT NULL DEFAULT '',
  expiry_date DATE,
  cost_price NUMERIC,
  source_id UUID,
  source_line TEXT,
  requested_by TEXT,
  requested_by_name TEXT NOT NULL DEFAULT '',
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  decided_by TEXT,
  decided_by_name TEXT,
  decided_at TIMESTAMPTZ,
  decision_note TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS public.stock_approval_logs (
  id UUID PRIMARY KEY,
  store_id UUID NOT NULL,
  request_id UUID NOT NULL,
  product_id UUID,
  product_name TEXT NOT NULL DEFAULT '',
  quantity INTEGER NOT NULL,
  kind TEXT NOT NULL DEFAULT '',
  decision TEXT NOT NULL CHECK (decision IN ('approved', 'rejected')),
  note TEXT NOT NULL DEFAULT '',
  approved_by TEXT,
  approved_by_name TEXT NOT NULL DEFAULT '',
  approved_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stock_receipt_requests_store
  ON public.stock_receipt_requests (store_id, status, requested_at DESC);

CREATE INDEX IF NOT EXISTS idx_stock_approval_logs_store
  ON public.stock_approval_logs (store_id, approved_at DESC);

ALTER TABLE public.stock_receipt_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_approval_logs ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON public.stock_receipt_requests TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.stock_approval_logs TO anon, authenticated;
GRANT ALL ON public.stock_receipt_requests TO service_role;
GRANT ALL ON public.stock_approval_logs TO service_role;

DROP POLICY IF EXISTS stock_receipt_requests_all ON public.stock_receipt_requests;
CREATE POLICY stock_receipt_requests_all
  ON public.stock_receipt_requests
  FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS stock_approval_logs_all ON public.stock_approval_logs;
CREATE POLICY stock_approval_logs_all
  ON public.stock_approval_logs
  FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

-- Platform activity log. No SELECT grant for the shop anon key.
CREATE TABLE IF NOT EXISTS public.activity_logs (
  id UUID PRIMARY KEY,
  store_id TEXT,
  store_name TEXT NOT NULL DEFAULT '',
  user_id TEXT,
  username TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT '',
  activity_type TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  details TEXT NOT NULL DEFAULT '',
  logged_in_at TIMESTAMPTZ,
  logged_out_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_activity_logs_created
  ON public.activity_logs (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_activity_logs_user
  ON public.activity_logs (username, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_activity_logs_type
  ON public.activity_logs (activity_type, created_at DESC);

ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.activity_logs FROM PUBLIC, anon, authenticated;
GRANT INSERT, UPDATE ON public.activity_logs TO anon, authenticated;
GRANT ALL ON TABLE public.activity_logs TO service_role;

DROP POLICY IF EXISTS activity_logs_insert ON public.activity_logs;
CREATE POLICY activity_logs_insert
  ON public.activity_logs
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS activity_logs_update ON public.activity_logs;
CREATE POLICY activity_logs_update
  ON public.activity_logs
  FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

-- The PIN admin portal queries with the anon key, not a Supabase user JWT.
-- "permission denied for table support_tickets" is a missing GRANT (42501).
-- RLS policies for authenticated platform admins stay in place.
GRANT SELECT, INSERT, UPDATE ON public.support_tickets TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.support_ticket_messages TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.support_ticket_assignments TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.support_ticket_notes TO anon, authenticated;

DO $$
BEGIN
  EXECUTE 'GRANT USAGE, SELECT ON SEQUENCE public.support_tickets_ticket_number_seq TO anon, authenticated';
EXCEPTION
  WHEN undefined_object THEN NULL;
END $$;

DROP POLICY IF EXISTS support_tickets_portal_read ON public.support_tickets;
CREATE POLICY support_tickets_portal_read
  ON public.support_tickets
  FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS support_tickets_portal_write ON public.support_tickets;
CREATE POLICY support_tickets_portal_write
  ON public.support_tickets
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS support_tickets_portal_update ON public.support_tickets;
CREATE POLICY support_tickets_portal_update
  ON public.support_tickets
  FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS support_ticket_messages_portal_read ON public.support_ticket_messages;
CREATE POLICY support_ticket_messages_portal_read
  ON public.support_ticket_messages
  FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS support_ticket_messages_portal_write ON public.support_ticket_messages;
CREATE POLICY support_ticket_messages_portal_write
  ON public.support_ticket_messages
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS support_ticket_messages_portal_update ON public.support_ticket_messages;
CREATE POLICY support_ticket_messages_portal_update
  ON public.support_ticket_messages
  FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS support_ticket_assignments_portal_read ON public.support_ticket_assignments;
CREATE POLICY support_ticket_assignments_portal_read
  ON public.support_ticket_assignments
  FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS support_ticket_notes_portal_read ON public.support_ticket_notes;
CREATE POLICY support_ticket_notes_portal_read
  ON public.support_ticket_notes
  FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS support_ticket_notes_portal_write ON public.support_ticket_notes;
CREATE POLICY support_ticket_notes_portal_write
  ON public.support_ticket_notes
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

COMMENT ON TABLE public.activity_logs IS
  'Platform activity and sign-in log. Shop devices can write rows. Only the service-role admin API can read them.';
