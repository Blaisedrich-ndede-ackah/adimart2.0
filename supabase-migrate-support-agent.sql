-- ============================================================
-- ADIMAT POS - Migration: customer support agent portal
-- Run after supabase-init.sql in the Supabase SQL editor.
--
-- This migration creates the persistent ticket inbox, ticket messages,
-- assignments, and internal notes used by the Administrator support portal.
-- The current UI prototype can be wired to these tables in a later step.
--
-- Authorization is restricted to trusted platform admins identified by
-- auth.jwt() app_metadata. Do not use raw_user_meta_data for authorization.
-- PIN-only admin API routes should use the service_role key server-side and
-- must never expose that key to browser code.
-- ============================================================

CREATE OR REPLACE FUNCTION public.is_adimat_support_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT COALESCE(
    ((auth.jwt() -> 'app_metadata' ->> 'is_platform_admin') = 'true'),
    FALSE
  );
$$;

REVOKE ALL ON FUNCTION public.is_adimat_support_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_adimat_support_admin() TO authenticated;

CREATE TABLE IF NOT EXISTS public.support_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_number BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
  requester_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  requester_name TEXT NOT NULL DEFAULT '',
  requester_email TEXT NOT NULL DEFAULT '',
  requester_phone TEXT NOT NULL DEFAULT '',
  store_id TEXT,
  store_name TEXT NOT NULL DEFAULT '',
  subject VARCHAR(240) NOT NULL CHECK (char_length(btrim(subject)) BETWEEN 1 AND 240),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'pending', 'resolved', 'closed')),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  assigned_to UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  last_message_preview TEXT NOT NULL DEFAULT '',
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.support_ticket_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  author_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  author_name TEXT NOT NULL DEFAULT '',
  author_role TEXT NOT NULL DEFAULT 'store_owner' CHECK (author_role IN ('store_owner', 'support_agent', 'system')),
  body TEXT NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 10000),
  is_internal BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.support_ticket_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  agent_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  assigned_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  unassigned_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.support_ticket_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  author_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  body TEXT NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 10000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_ticket_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_ticket_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_ticket_notes ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.support_tickets FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.support_ticket_messages FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.support_ticket_assignments FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.support_ticket_notes FROM PUBLIC, anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.support_tickets TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.support_ticket_messages TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.support_ticket_assignments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.support_ticket_notes TO authenticated;
GRANT ALL ON TABLE public.support_tickets TO service_role;
GRANT ALL ON TABLE public.support_ticket_messages TO service_role;
GRANT ALL ON TABLE public.support_ticket_assignments TO service_role;
GRANT ALL ON TABLE public.support_ticket_notes TO service_role;

DROP POLICY IF EXISTS support_tickets_admin_all ON public.support_tickets;
CREATE POLICY support_tickets_admin_all
  ON public.support_tickets
  FOR ALL
  TO authenticated
  USING ((SELECT public.is_adimat_support_admin()))
  WITH CHECK ((SELECT public.is_adimat_support_admin()));

DROP POLICY IF EXISTS support_ticket_messages_admin_all ON public.support_ticket_messages;
CREATE POLICY support_ticket_messages_admin_all
  ON public.support_ticket_messages
  FOR ALL
  TO authenticated
  USING ((SELECT public.is_adimat_support_admin()))
  WITH CHECK ((SELECT public.is_adimat_support_admin()));

DROP POLICY IF EXISTS support_ticket_assignments_admin_all ON public.support_ticket_assignments;
CREATE POLICY support_ticket_assignments_admin_all
  ON public.support_ticket_assignments
  FOR ALL
  TO authenticated
  USING ((SELECT public.is_adimat_support_admin()))
  WITH CHECK ((SELECT public.is_adimat_support_admin()));

DROP POLICY IF EXISTS support_ticket_notes_admin_all ON public.support_ticket_notes;
CREATE POLICY support_ticket_notes_admin_all
  ON public.support_ticket_notes
  FOR ALL
  TO authenticated
  USING ((SELECT public.is_adimat_support_admin()))
  WITH CHECK ((SELECT public.is_adimat_support_admin()));

CREATE INDEX IF NOT EXISTS idx_support_tickets_inbox
  ON public.support_tickets (status, priority, last_message_at DESC);

CREATE INDEX IF NOT EXISTS idx_support_tickets_store
  ON public.support_tickets (store_id, created_at DESC)
  WHERE store_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_support_tickets_assignee
  ON public.support_tickets (assigned_to, status, updated_at DESC)
  WHERE assigned_to IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_support_ticket_messages_ticket
  ON public.support_ticket_messages (ticket_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_support_ticket_assignments_active
  ON public.support_ticket_assignments (ticket_id, assigned_at DESC)
  WHERE unassigned_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_support_ticket_notes_ticket
  ON public.support_ticket_notes (ticket_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.touch_support_ticket_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.touch_support_ticket_updated_at() FROM PUBLIC;

DROP TRIGGER IF EXISTS touch_support_ticket_updated_at
  ON public.support_tickets;
CREATE TRIGGER touch_support_ticket_updated_at
  BEFORE UPDATE ON public.support_tickets
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_support_ticket_updated_at();

CREATE OR REPLACE FUNCTION public.sync_support_ticket_message_summary()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  UPDATE public.support_tickets
  SET
    last_message_preview = LEFT(NEW.body, 280),
    last_message_at = NEW.created_at,
    updated_at = NOW()
  WHERE id = NEW.ticket_id;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_support_ticket_message_summary() FROM PUBLIC;

DROP TRIGGER IF EXISTS sync_support_ticket_message_summary
  ON public.support_ticket_messages;
CREATE TRIGGER sync_support_ticket_message_summary
  AFTER INSERT ON public.support_ticket_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_support_ticket_message_summary();

COMMENT ON TABLE public.support_tickets IS 'Customer support inbox tickets managed by trusted platform support agents.';
COMMENT ON TABLE public.support_ticket_messages IS 'Public replies and private internal messages attached to support tickets.';
COMMENT ON TABLE public.support_ticket_assignments IS 'Assignment history for support agents handling tickets.';
COMMENT ON TABLE public.support_ticket_notes IS 'Private internal notes for support agents.';
