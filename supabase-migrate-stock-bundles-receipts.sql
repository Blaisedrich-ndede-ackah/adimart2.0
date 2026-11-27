-- One-time schema for stock write-offs, product bundles, and digital receipt links.
ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS writeoff_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS bundles_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS digital_receipt_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS receipt_token_ttl_hours INTEGER NOT NULL DEFAULT 720
    CHECK (receipt_token_ttl_hours BETWEEN 1 AND 8760);

ALTER TABLE public.transaction_items
  ADD COLUMN IF NOT EXISTS bundle_id UUID;

CREATE TABLE IF NOT EXISTS public.stock_write_offs (
  id UUID PRIMARY KEY,
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  product_id UUID NOT NULL,
  product_name TEXT NOT NULL DEFAULT '',
  quantity NUMERIC NOT NULL CHECK (quantity > 0),
  base_quantity NUMERIC NOT NULL CHECK (base_quantity > 0),
  cost_price_at_writeoff NUMERIC NOT NULL DEFAULT 0,
  reason TEXT NOT NULL CHECK (reason IN ('expired', 'damaged', 'other')),
  photo_data_url TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created_by UUID,
  created_by_name TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_stock_write_offs_store_date
  ON public.stock_write_offs(store_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.product_bundles (
  id UUID PRIMARY KEY,
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  combo_price NUMERIC NOT NULL CHECK (combo_price >= 0),
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE INDEX IF NOT EXISTS idx_product_bundles_store_active
  ON public.product_bundles(store_id, is_active);

CREATE TABLE IF NOT EXISTS public.bundle_components (
  id UUID PRIMARY KEY,
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  bundle_id UUID NOT NULL REFERENCES public.product_bundles(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  quantity NUMERIC NOT NULL CHECK (quantity > 0),
  UNIQUE(bundle_id, product_id)
);
CREATE INDEX IF NOT EXISTS idx_bundle_components_bundle
  ON public.bundle_components(store_id, bundle_id);

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

ALTER TABLE public.stock_write_offs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_bundles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bundle_components ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.receipt_tokens ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON public.stock_write_offs TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_bundles, public.bundle_components TO anon, authenticated;
GRANT INSERT ON public.receipt_tokens TO anon, authenticated;
GRANT ALL ON public.stock_write_offs, public.product_bundles, public.bundle_components, public.receipt_tokens TO service_role;

DROP POLICY IF EXISTS stock_write_offs_access ON public.stock_write_offs;
CREATE POLICY stock_write_offs_access ON public.stock_write_offs FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS product_bundles_access ON public.product_bundles;
CREATE POLICY product_bundles_access ON public.product_bundles FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS bundle_components_access ON public.bundle_components;
CREATE POLICY bundle_components_access ON public.bundle_components FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS receipt_tokens_insert ON public.receipt_tokens;
CREATE POLICY receipt_tokens_insert ON public.receipt_tokens FOR INSERT TO anon, authenticated WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.transactions t
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
  JOIN public.transactions t ON t.id = rt.transaction_id AND t.store_id = rt.store_id
  JOIN public.stores s ON s.id = rt.store_id
  WHERE rt.token = $1
    AND rt.expires_at > NOW()
    AND t.status = 'completed'
    AND COALESCE(t.void_status, 'none') <> 'voided'
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.get_public_receipt(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_receipt(TEXT) TO anon, authenticated;
