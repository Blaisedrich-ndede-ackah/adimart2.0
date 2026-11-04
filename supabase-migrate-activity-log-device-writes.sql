-- ============================================================
-- ADIMAT POS - Repair device writes for the platform activity log.
-- Run in the Supabase SQL Editor after
-- supabase-migrate-stock-approvals-activity.sql.
--
-- Replaces stale activity_logs policies with the intended device-write
-- rules. The anon/authenticated roles can insert and update logs, but
-- cannot read them; the service-role admin API remains the only reader.
-- ============================================================

DO $$
DECLARE
  existing_policy RECORD;
BEGIN
  IF to_regclass('public.activity_logs') IS NULL THEN
    RAISE EXCEPTION
      'public.activity_logs is missing. Run supabase-migrate-stock-approvals-activity.sql first.';
  END IF;

  FOR existing_policy IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'activity_logs'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.activity_logs', existing_policy.policyname);
  END LOOP;
END $$;

ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.activity_logs FROM PUBLIC, anon, authenticated;
GRANT INSERT, UPDATE ON TABLE public.activity_logs TO anon, authenticated;
GRANT ALL ON TABLE public.activity_logs TO service_role;

CREATE POLICY activity_logs_insert
  ON public.activity_logs
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY activity_logs_update
  ON public.activity_logs
  FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
