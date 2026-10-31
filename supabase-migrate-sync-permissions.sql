-- Shop sync grants for stores that already ran the earlier activity-log
-- and Help & Support SQL. Safe to run more than once.
--
-- Activity log: Postgres requires SELECT on the table for INSERT ... ON
-- CONFLICT (the shop upsert). There is still no SELECT policy, so a direct
-- read from the shop returns no rows. The admin API reads with the service role.
--
-- Help & Support: row policies call adimat_support_actor(). SECURITY DEFINER
-- does not grant EXECUTE. Without this grant the pull reports
-- "permission denied for function adimat_support_actor".

REVOKE ALL ON TABLE public.activity_logs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.activity_logs TO anon, authenticated;
GRANT ALL ON TABLE public.activity_logs TO service_role;

DROP POLICY IF EXISTS activity_logs_select ON public.activity_logs;

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

-- RETURNS TABLE functions are stored with OUT arguments. Grant by the
-- installed signature so a name-only grant cannot abort this script.
DO $$
DECLARE
  fn regprocedure;
BEGIN
  SELECT p.oid::regprocedure INTO fn
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'adimat_support_actor'
  LIMIT 1;
  IF fn IS NULL THEN
    RAISE EXCEPTION 'adimat_support_actor is not installed. Run supabase-migrate-customer-care.sql first.';
  END IF;
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon, authenticated, service_role', fn);
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticator') THEN
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticator', fn);
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
