-- Adimat feature pack Phase 4: private marketplace connections and order imports.
-- Secrets are AES-256-GCM encrypted by the integrations API. Never grant client roles.

CREATE TABLE IF NOT EXISTS public.marketplace_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  platform TEXT NOT NULL DEFAULT 'generic_rest',
  name TEXT NOT NULL,
  shop_id TEXT NOT NULL DEFAULT '',
  endpoint TEXT NOT NULL,
  credentials_ciphertext TEXT NOT NULL,
  sync_frequency INTEGER NOT NULL DEFAULT 60 CHECK (sync_frequency BETWEEN 5 AND 1440),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  last_sync TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_marketplace_connections_store ON public.marketplace_connections(store_id, created_at DESC);
ALTER TABLE public.marketplace_connections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.marketplace_connections FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.marketplace_connections TO service_role;

CREATE TABLE IF NOT EXISTS public.product_marketplace_mapping (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  connection_id UUID NOT NULL REFERENCES public.marketplace_connections(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  external_sku TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(connection_id, product_id),
  UNIQUE(connection_id, external_sku)
);
CREATE INDEX IF NOT EXISTS idx_marketplace_mapping_store ON public.product_marketplace_mapping(store_id, connection_id);
ALTER TABLE public.product_marketplace_mapping ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.product_marketplace_mapping FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_marketplace_mapping TO service_role;

CREATE TABLE IF NOT EXISTS public.marketplace_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  connection_id UUID NOT NULL REFERENCES public.marketplace_connections(id) ON DELETE CASCADE,
  external_order_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(connection_id, external_order_id)
);
CREATE INDEX IF NOT EXISTS idx_marketplace_orders_store ON public.marketplace_orders(store_id, updated_at DESC);
ALTER TABLE public.marketplace_orders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.marketplace_orders FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.marketplace_orders TO service_role;

CREATE TABLE IF NOT EXISTS public.marketplace_sync_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  connection_id UUID NOT NULL REFERENCES public.marketplace_connections(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('stock', 'orders')),
  status TEXT NOT NULL CHECK (status IN ('success', 'failed')),
  summary TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_marketplace_sync_logs_store ON public.marketplace_sync_logs(store_id, created_at DESC);
ALTER TABLE public.marketplace_sync_logs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.marketplace_sync_logs FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.marketplace_sync_logs TO service_role;

NOTIFY pgrst, 'reload schema';
