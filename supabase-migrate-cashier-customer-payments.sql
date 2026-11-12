-- Let an owner allow a cashier to record a customer account payment.
-- Safe to run more than once. Existing cashiers stay off until the owner turns it on.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS can_record_customer_payments BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE public.users
SET can_record_customer_payments = TRUE
WHERE role = 'owner';

NOTIFY pgrst, 'reload schema';
