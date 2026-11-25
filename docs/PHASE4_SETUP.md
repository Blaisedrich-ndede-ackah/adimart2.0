# Adimat feature pack Phase 4

Phase 4 adds a dynamic public shop sitemap and a provider-neutral marketplace REST adapter. It extends the existing `/api/integrations` function, so it does not add a Vercel serverless function.

## Database migration

Run `supabase-migrate-feature-pack-phase4.sql` in the Supabase SQL editor. Marketplace tables are private to the service role; credentials are never returned to the browser.

## Server configuration

Keep `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `WEBHOOK_ENCRYPTION_KEY` configured for the existing integrations API. Marketplace credentials use the same 32-byte base64url encryption key as webhook secrets. Rotating the key makes saved marketplace credentials unreadable, so migrate or reconnect those credentials before rotating it.

## Marketplace REST contract

The current connector is a generic adapter, not a vendor-certified Jumia/social commerce connector. Save an HTTPS endpoint that implements these requests:

- Adimat pushes stock with `POST {endpoint}` and JSON `{ event: "inventory.sync", shop_id, products }`. Each product contains its Adimat ID, name, barcode, price, stock level, and active state. Authentication is sent as `Authorization: Bearer <api_key>` plus `X-Adimat-Secret` when configured.
- Adimat pulls orders with `GET {endpoint}?action=orders&shop_id=...`. Return either a JSON array or `{ "orders": [...] }`; each order needs a stable `id` and may include `status`. Imports are idempotent by provider order ID and raw order payloads are retained for review.
- Owner PIN verification is required for connection changes and manual sync. Sync attempts and results appear in the Integrations page.

Automatic background sync, marketplace-specific SKU/status mapping, and writing order status back to a provider require a provider API contract and are not enabled by this generic adapter.

## SEO routes

`/sitemap.xml` is generated from enabled online shops. `public/robots.txt` references that sitemap. Public shops support both the existing `#/shop/{slug}` links and crawlable `/shop/{slug}` URLs; the shop page emits canonical, Open Graph, and Product JSON-LD metadata.

SEO data fields are provided by the existing Phase 2/SEO migration. Apply that earlier migration if store or product SEO columns are missing.
