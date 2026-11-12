-- Keep a serial or IMEI on a sale line. Safe to run more than once.

ALTER TABLE public.transaction_items
  ADD COLUMN IF NOT EXISTS serial_number TEXT NOT NULL DEFAULT '';

NOTIFY pgrst, 'reload schema';
