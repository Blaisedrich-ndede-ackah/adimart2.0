# Phase 4 status

SEO fields and storefront metadata are provided by `supabase-migrate-feature-pack-tax.sql`. The app generates `/sitemap.xml`, publishes `robots.txt`, supports crawlable `/shop/{slug}` paths, and adds canonical, Open Graph, and Product JSON-LD metadata to public shops.

Marketplace API connections were removed from the application along with API keys and webhooks. `supabase-migrate-feature-pack-phase4.sql` is now a retired no-op migration; existing marketplace rows in a database are left untouched but are no longer accessed by the app.
