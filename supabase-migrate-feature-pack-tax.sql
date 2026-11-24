-- Adimat feature pack: configurable tax snapshots and storefront metadata.
-- Apply in the Supabase SQL editor before deploying the matching app build.

ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS nhil_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS nhil_rate NUMERIC(6,3) NOT NULL DEFAULT 2.5,
  ADD COLUMN IF NOT EXISTS getfund_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS getfund_rate NUMERIC(6,3) NOT NULL DEFAULT 2.5,
  ADD COLUMN IF NOT EXISTS covid_levy_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS covid_levy_rate NUMERIC(6,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_inclusive_pricing BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS seo_meta_title TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS seo_meta_description TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS og_image_url TEXT NOT NULL DEFAULT '';

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS tax_category TEXT NOT NULL DEFAULT 'taxable'
    CHECK (tax_category IN ('taxable', 'exempt', 'zero_rated', 'reduced')),
  ADD COLUMN IF NOT EXISTS tax_rate_override NUMERIC(6,3),
  ADD COLUMN IF NOT EXISTS seo_slug TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS seo_meta_title TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS seo_meta_description TEXT NOT NULL DEFAULT '';

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS tax_exempt BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS tax_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_breakdown_json JSONB NOT NULL DEFAULT '[]'::JSONB;

ALTER TABLE public.transaction_items
  ADD COLUMN IF NOT EXISTS tax_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_rate NUMERIC(6,3) NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_products_store_seo_slug
  ON public.products(store_id, seo_slug) WHERE seo_slug <> '';

NOTIFY pgrst, 'reload schema';
