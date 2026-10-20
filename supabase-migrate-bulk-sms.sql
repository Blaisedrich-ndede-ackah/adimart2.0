-- ============================================================
-- ADIMAT POS - Migration: store-owner bulk SMS campaigns
-- Run in the Supabase SQL Editor after supabase-init.sql.
-- Store owners send a promotional message to every registered
-- customer of their store via the configured mNotify API key.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.bulk_sms_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  message TEXT NOT NULL CHECK (char_length(btrim(message)) BETWEEN 1 AND 460),
  recipient_count INTEGER NOT NULL DEFAULT 0 CHECK (recipient_count >= 0),
  sent_count INTEGER NOT NULL DEFAULT 0 CHECK (sent_count >= 0),
  failed_count INTEGER NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
  provider TEXT NOT NULL DEFAULT 'mnotify',
  provider_message_id TEXT,
  status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'failed', 'partial')),
  error_message TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bulk_sms_campaigns_store_created
  ON public.bulk_sms_campaigns(store_id, created_at DESC);

ALTER TABLE public.bulk_sms_campaigns ENABLE ROW LEVEL SECURITY;

-- Consistent with the existing customers / subscription_grants pattern:
-- the store app reads with the anon key and filters rows by store_id
-- locally, so SELECT is permissive. The campaign row is written by the
-- device that sent the SMS (the mNotify call happens in the browser, so
-- there is no server route to write it for us), so the device key needs
-- INSERT. Rows stay append-only: UPDATE and DELETE are denied.
REVOKE ALL ON TABLE public.bulk_sms_campaigns FROM PUBLIC;

DROP POLICY IF EXISTS bulk_sms_campaigns_select ON public.bulk_sms_campaigns;
CREATE POLICY bulk_sms_campaigns_select
  ON public.bulk_sms_campaigns
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS bulk_sms_campaigns_insert ON public.bulk_sms_campaigns;
CREATE POLICY bulk_sms_campaigns_insert
  ON public.bulk_sms_campaigns
  FOR INSERT
  WITH CHECK (true);

DROP POLICY IF EXISTS bulk_sms_campaigns_update ON public.bulk_sms_campaigns;
CREATE POLICY bulk_sms_campaigns_update
  ON public.bulk_sms_campaigns
  FOR UPDATE
  USING (false)
  WITH CHECK (false);

DROP POLICY IF EXISTS bulk_sms_campaigns_delete ON public.bulk_sms_campaigns;
CREATE POLICY bulk_sms_campaigns_delete
  ON public.bulk_sms_campaigns
  FOR DELETE
  USING (false);

GRANT SELECT, INSERT ON TABLE public.bulk_sms_campaigns TO anon, authenticated;
GRANT ALL ON TABLE public.bulk_sms_campaigns TO service_role;

COMMENT ON TABLE public.bulk_sms_campaigns IS
  'Audit trail of store-owner bulk SMS campaigns sent to registered customers via mNotify.';

COMMENT ON COLUMN public.bulk_sms_campaigns.message IS
  'The promotional text sent to every registered customer of the store (max 460 chars).';

COMMENT ON COLUMN public.bulk_sms_campaigns.status IS
  'sent = every recipient accepted; failed = every recipient rejected; partial = mixed.';

NOTIFY pgrst, 'reload schema';