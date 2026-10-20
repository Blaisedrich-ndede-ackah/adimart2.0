-- ============================================================
-- ADIMAT POS - Migration: allow the device to write bulk SMS campaigns
-- Run in the Supabase SQL Editor.
--
-- The store app sends the promotional SMS straight from the browser
-- (mNotify quick SMS) and then records the campaign in its local
-- database, which is pushed to the cloud during the next sync using
-- the anon key. The original bulk-SMS migration denied anon inserts
-- because it assumed a server route would write the row, but no such
-- route exists. Without this fix every sync fails with:
--
--   Bulk SMS campaigns: new row violates row-level security policy
--   for table "bulk_sms_campaigns" - 42501
--
-- Campaigns stay append-only: UPDATE and DELETE remain denied.
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'bulk_sms_campaigns'
  ) THEN
    RAISE NOTICE 'bulk_sms_campaigns is missing - run supabase-migrate-bulk-sms.sql first.';
    RETURN;
  END IF;
END $$;

ALTER TABLE public.bulk_sms_campaigns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bulk_sms_campaigns_insert ON public.bulk_sms_campaigns;
CREATE POLICY bulk_sms_campaigns_insert
  ON public.bulk_sms_campaigns
  FOR INSERT
  WITH CHECK (true);

DROP POLICY IF EXISTS bulk_sms_campaigns_select ON public.bulk_sms_campaigns;
CREATE POLICY bulk_sms_campaigns_select
  ON public.bulk_sms_campaigns
  FOR SELECT
  USING (true);

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

NOTIFY pgrst, 'reload schema';
