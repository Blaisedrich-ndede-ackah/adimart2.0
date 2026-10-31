-- Apply after the customer-book and warehouse migrations, before syncing these fields.
-- Customer addresses inherit the existing customer table's RLS policies; review those policies before storing real street addresses.

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS location_id UUID REFERENCES public.locations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS address TEXT NOT NULL DEFAULT '';

ALTER TABLE public.transaction_items
  ADD COLUMN IF NOT EXISTS sale_mode VARCHAR(20);

UPDATE public.transaction_items AS item
SET sale_mode = txn.sale_mode
FROM public.transactions AS txn
WHERE item.transaction_id = txn.id
  AND txn.sale_mode IN ('retail', 'wholesale')
  AND item.sale_mode IS DISTINCT FROM txn.sale_mode;

ALTER TABLE public.transaction_items
  DROP CONSTRAINT IF EXISTS transaction_items_sale_mode_check;

ALTER TABLE public.transaction_items
  ADD CONSTRAINT transaction_items_sale_mode_check
  CHECK (sale_mode IS NULL OR sale_mode IN ('retail', 'wholesale'));

NOTIFY pgrst, 'reload schema';
