-- Restore the public digital receipt lookup RPC and refresh PostgREST's schema cache.
-- Run this in the Supabase SQL editor if scans still report that a receipt is missing.

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS void_status VARCHAR(20) NOT NULL DEFAULT 'none';

CREATE TABLE IF NOT EXISTS public.receipt_tokens (
  id UUID PRIMARY KEY,
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  transaction_id UUID NOT NULL REFERENCES public.transactions(id) ON DELETE CASCADE,
  receipt_number TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  qr_payload TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_receipt_tokens_transaction
  ON public.receipt_tokens(transaction_id);

ALTER TABLE public.receipt_tokens ENABLE ROW LEVEL SECURITY;
GRANT INSERT ON public.receipt_tokens TO anon, authenticated;
GRANT ALL ON public.receipt_tokens TO service_role;
DROP POLICY IF EXISTS receipt_tokens_insert ON public.receipt_tokens;
CREATE POLICY receipt_tokens_insert ON public.receipt_tokens
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.transactions t
      WHERE t.id = receipt_tokens.transaction_id
        AND t.store_id = receipt_tokens.store_id
        AND t.receipt_number = receipt_tokens.receipt_number
        AND t.status = 'completed'
    )
  );

CREATE OR REPLACE FUNCTION public.get_public_receipt(receipt_token TEXT)
RETURNS JSONB
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'store_name', s.name,
    'store_logo_url', COALESCE(s.logo_url, ''),
    'currency_code', COALESCE(s.currency_code, 'GHS'),
    'expires_at', rt.expires_at,
    'receipt_number', t.receipt_number,
    'cashier_name', COALESCE(t.cashier_name, ''),
    'created_at', t.created_at,
    'total_amount', t.total_amount,
    'discount_applied', COALESCE(t.discount_applied, 0),
    'payment_method', t.payment_method,
    'items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'product_name', ti.product_name,
        'quantity', ti.quantity,
        'unit_price', ti.unit_price,
        'subtotal', ti.subtotal
      ) ORDER BY ti.id)
      FROM public.transaction_items ti
      WHERE ti.transaction_id = t.id
    ), '[]'::jsonb)
  )
  FROM public.receipt_tokens rt
  JOIN public.transactions t
    ON t.id = rt.transaction_id
   AND t.store_id = rt.store_id
  JOIN public.stores s ON s.id = rt.store_id
  WHERE upper(rt.token) = upper(receipt_token)
    AND rt.expires_at > NOW()
    AND t.status = 'completed'
    AND COALESCE(t.void_status, 'none') <> 'voided'
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_public_receipt(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_receipt(TEXT) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
