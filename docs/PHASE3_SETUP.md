# Phase 3 setup: API, webhooks, and push notifications

1. Run `supabase-migrate-feature-pack-phase3.sql` in the Supabase SQL editor.
2. Keep `SUPABASE_SERVICE_ROLE_KEY` configured as a Vercel server-only environment variable. Never add it to a `VITE_` variable.
3. Set `CRON_SECRET` in Vercel so the scheduled webhook retry route can authenticate.
4. Generate VAPID and webhook-encryption keys locally with `node scripts/generate-vapid-keys.mjs`. Set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `WEBHOOK_ENCRYPTION_KEY`, and `VAPID_SUBJECT` as Vercel server environment variables. `VAPID_SUBJECT` should be a contact such as `mailto:support@example.com`.
5. Set the matching `VITE_VAPID_PUBLIC_KEY` in Vercel's build environment, then redeploy. The public key is safe for the browser; keep the private key server-only.
6. In Adimat, open **More → API & webhooks**, enter the owner PIN, and create a key or webhook. Copy the key/webhook secret when shown; Adimat only displays it once.
7. Open **More → Notifications** on each device and enable push notifications.

The Hobby deployment remains at 12 serverless functions. Webhook retries are recorded with exponential backoff and attempted by the once-daily Hobby cron; this schedule can be made more frequent on a plan that supports more frequent Vercel Cron Jobs.

The public API reference is available at `/public-api.md`.
