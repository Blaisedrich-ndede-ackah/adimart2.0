# Phase 3 setup: notifications

1. Run `supabase-migrate-feature-pack-phase3.sql` in the Supabase SQL editor. This migration creates the notification and device push subscription tables.
2. Keep `SUPABASE_SERVICE_ROLE_KEY` configured as a Vercel server-only environment variable. Never add it to a `VITE_` variable.
3. Generate VAPID keys with `node scripts/generate-vapid-keys.mjs`. Set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT` as Vercel server environment variables. `VAPID_SUBJECT` should be a contact such as `mailto:support@example.com`.
4. Set the matching `VITE_VAPID_PUBLIC_KEY` in Vercel's build environment, then redeploy. The public key is safe for the browser; keep the private key server-only.
5. Open **More → Notifications** on each device to enable or disable device push notifications.

The API keys and webhook management screen and public API actions have been removed from the Adimat application. The Phase 3 SQL file remains backward-compatible for existing databases; its unused API and webhook tables are not accessed by the app.
