-- Let the admin Paystack screen cancel a waiting payment, and add the
-- support ticket number when an older support_tickets table is missing it.
-- Safe to run more than once.

DO $$
BEGIN
  IF to_regclass('public.support_tickets') IS NULL THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'support_tickets'
      AND column_name = 'ticket_number'
  ) THEN
    ALTER TABLE public.support_tickets
      ADD COLUMN ticket_number BIGINT GENERATED ALWAYS AS IDENTITY;
  END IF;

  EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS support_tickets_ticket_number_key ON public.support_tickets (ticket_number)';

  BEGIN
    EXECUTE 'GRANT USAGE, SELECT ON SEQUENCE public.support_tickets_ticket_number_seq TO anon, authenticated';
  EXCEPTION
    WHEN undefined_table OR undefined_object THEN NULL;
  END;
END $$;

DO $$
BEGIN
  IF to_regclass('public.sms_topup_intents') IS NULL THEN
    RETURN;
  END IF;
  EXECUTE 'DROP POLICY IF EXISTS sms_topup_intents_update ON public.sms_topup_intents';
  EXECUTE 'CREATE POLICY sms_topup_intents_update ON public.sms_topup_intents FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true)';
  EXECUTE 'GRANT UPDATE ON public.sms_topup_intents TO anon, authenticated';
END $$;

DO $$
BEGIN
  IF to_regclass('public.shop_payment_intents') IS NULL THEN
    RETURN;
  END IF;
  EXECUTE 'DROP POLICY IF EXISTS shop_payment_intents_admin_update ON public.shop_payment_intents';
  EXECUTE 'CREATE POLICY shop_payment_intents_admin_update ON public.shop_payment_intents FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true)';
  EXECUTE 'GRANT UPDATE ON public.shop_payment_intents TO anon, authenticated';
END $$;

NOTIFY pgrst, 'reload schema';
