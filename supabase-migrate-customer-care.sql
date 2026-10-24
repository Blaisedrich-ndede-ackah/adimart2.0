-- Customer care tickets and idempotent stock deltas.
-- Run this once in the Supabase SQL editor after supabase-init.sql.
-- Do not use "allow all" policies. The anon key sees a row only when the
-- request carries a support token issued by /api/customer-care.

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS support_access_grants (
  token_hash text PRIMARY KEY,
  store_id uuid,
  role text NOT NULL CHECK (role IN ('owner', 'admin')),
  expires_at timestamptz NOT NULL
);

ALTER TABLE support_access_grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON support_access_grants FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS support_tickets (
  id uuid PRIMARY KEY,
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  reference text NOT NULL,
  source text NOT NULL CHECK (source IN ('admin', 'owner', 'customer')),
  customer_name text NOT NULL DEFAULT '',
  customer_phone text NOT NULL DEFAULT '',
  customer_email text NOT NULL DEFAULT '',
  category text NOT NULL CHECK (category IN ('billing', 'technical', 'stock', 'sales', 'account', 'other')),
  priority text NOT NULL CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  status text NOT NULL CHECK (status IN ('open', 'in_progress', 'waiting', 'resolved', 'closed')),
  assignee_name text NOT NULL DEFAULT '',
  subject text NOT NULL,
  opened_by_name text NOT NULL DEFAULT '',
  sla_first_response_due timestamptz,
  sla_resolution_due timestamptz,
  first_response_at timestamptz,
  resolved_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS support_messages (
  id uuid PRIMARY KEY,
  ticket_id uuid NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  author_role text NOT NULL CHECK (author_role IN ('admin', 'owner', 'cashier', 'customer')),
  author_name text NOT NULL DEFAULT '',
  body text NOT NULL DEFAULT '',
  visibility text NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'internal')),
  attachment_name text NOT NULL DEFAULT '',
  attachment_data_url text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS support_canned_replies (
  id uuid PRIMARY KEY,
  title text NOT NULL,
  body text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_support_tickets_store ON support_tickets(store_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON support_tickets(status, priority);
CREATE INDEX IF NOT EXISTS idx_support_messages_ticket ON support_messages(ticket_id, created_at);

CREATE TABLE IF NOT EXISTS sync_applied_keys (
  idempotency_key text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE sync_applied_keys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sync_applied_keys FROM anon, authenticated;

ALTER TABLE stock_batches ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE products ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;

CREATE OR REPLACE FUNCTION public.adimat_support_actor()
RETURNS TABLE(role text, store_id uuid)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  headers jsonb;
  token text;
BEGIN
  BEGIN
    headers := current_setting('request.headers', true)::jsonb;
  EXCEPTION WHEN OTHERS THEN
    headers := '{}'::jsonb;
  END;
  token := nullif(headers->>'x-adimat-support-token', '');
  IF token IS NULL THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT g.role, g.store_id
    FROM support_access_grants g
    WHERE g.token_hash = encode(extensions.digest(convert_to(token, 'utf8'), 'sha256'), 'hex')
      AND g.expires_at > now();
END;
$$;

REVOKE ALL ON FUNCTION public.adimat_support_actor() FROM public, anon, authenticated;

ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_canned_replies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS support_tickets_select ON support_tickets;
DROP POLICY IF EXISTS support_tickets_write ON support_tickets;
DROP POLICY IF EXISTS support_messages_select ON support_messages;
DROP POLICY IF EXISTS support_messages_insert ON support_messages;
DROP POLICY IF EXISTS support_canned_select ON support_canned_replies;
DROP POLICY IF EXISTS support_canned_write ON support_canned_replies;

CREATE POLICY support_tickets_select ON support_tickets
FOR SELECT TO anon, authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.adimat_support_actor() a
    WHERE a.role = 'admin'
       OR (a.role = 'owner' AND a.store_id = support_tickets.store_id)
  )
);

CREATE POLICY support_tickets_write ON support_tickets
FOR INSERT TO anon, authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.adimat_support_actor() a
    WHERE a.role = 'admin'
       OR (a.role = 'owner' AND a.store_id = support_tickets.store_id)
  )
);

CREATE POLICY support_tickets_update ON support_tickets
FOR UPDATE TO anon, authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.adimat_support_actor() a
    WHERE a.role = 'admin'
       OR (a.role = 'owner' AND a.store_id = support_tickets.store_id)
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.adimat_support_actor() a
    WHERE a.role = 'admin'
       OR (a.role = 'owner' AND a.store_id = support_tickets.store_id)
  )
);

CREATE POLICY support_messages_select ON support_messages
FOR SELECT TO anon, authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.adimat_support_actor() a
    JOIN support_tickets t ON t.id = support_messages.ticket_id
    WHERE a.role = 'admin'
       OR (
         a.role = 'owner'
         AND a.store_id = t.store_id
         AND support_messages.visibility <> 'internal'
       )
  )
);

CREATE POLICY support_messages_insert ON support_messages
FOR INSERT TO anon, authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.adimat_support_actor() a
    JOIN support_tickets t ON t.id = support_messages.ticket_id
    WHERE a.role = 'admin'
       OR (
         a.role = 'owner'
         AND a.store_id = t.store_id
         AND support_messages.visibility <> 'internal'
       )
  )
);

CREATE POLICY support_canned_select ON support_canned_replies
FOR SELECT TO anon, authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.adimat_support_actor() a
    WHERE a.role IN ('owner', 'admin')
  )
);

CREATE POLICY support_canned_insert ON support_canned_replies
FOR INSERT TO anon, authenticated
WITH CHECK (
  EXISTS (SELECT 1 FROM public.adimat_support_actor() a WHERE a.role = 'admin')
);

CREATE POLICY support_canned_update ON support_canned_replies
FOR UPDATE TO anon, authenticated
USING (
  EXISTS (SELECT 1 FROM public.adimat_support_actor() a WHERE a.role = 'admin')
)
WITH CHECK (
  EXISTS (SELECT 1 FROM public.adimat_support_actor() a WHERE a.role = 'admin')
);

GRANT SELECT, INSERT, UPDATE ON support_tickets TO anon, authenticated;
GRANT SELECT, INSERT ON support_messages TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON support_canned_replies TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.apply_stock_delta(
  p_batch_id uuid,
  p_delta numeric,
  p_idempotency_key text,
  p_updated_at timestamptz
) RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_qty numeric;
BEGIN
  IF p_idempotency_key IS NULL OR length(p_idempotency_key) < 8 THEN
    RAISE EXCEPTION 'idempotency key required';
  END IF;
  INSERT INTO sync_applied_keys(idempotency_key)
  VALUES (p_idempotency_key)
  ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN
    SELECT quantity INTO new_qty FROM stock_batches WHERE id = p_batch_id;
    RETURN COALESCE(new_qty, 0);
  END IF;
  UPDATE stock_batches
    SET quantity = quantity + p_delta,
        updated_at = GREATEST(updated_at, COALESCE(p_updated_at, now())),
        version = COALESCE(version, 1) + 1
    WHERE id = p_batch_id
    RETURNING quantity INTO new_qty;
  RETURN COALESCE(new_qty, 0);
END;
$$;

GRANT EXECUTE ON FUNCTION public.apply_stock_delta(uuid, numeric, text, timestamptz) TO anon, authenticated;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'products', 'stock_batches', 'stock_movements', 'transactions', 'transaction_items',
    'customers', 'expenses', 'sales_returns', 'customer_wallet_transactions', 'credit_payments',
    'purchase_orders', 'suppliers', 'online_orders', 'online_order_items', 'locations',
    'cash_book_entries', 'support_tickets', 'support_messages', 'customer_account_receipts'
  ]
  LOOP
    BEGIN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE %I', t);
    EXCEPTION
      WHEN duplicate_object THEN NULL;
      WHEN undefined_object THEN NULL;
      WHEN insufficient_privilege THEN NULL;
    END;
  END LOOP;
END $$;
