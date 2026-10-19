-- Cloud sync reminder tracking for store owners.
-- Apply after the base stores/users tables exist. No seed or demo rows are inserted.
ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS last_cloud_sync_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS public.cloud_sync_reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  owner_phone TEXT NOT NULL,
  sync_threshold_days INTEGER NOT NULL DEFAULT 7 CHECK (sync_threshold_days > 0),
  last_sync_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  provider TEXT NOT NULL DEFAULT 'mnotify',
  provider_message_id TEXT,
  status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'failed', 'skipped')),
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cloud_sync_reminders_store_sent
  ON public.cloud_sync_reminders(store_id, sent_at DESC);

ALTER TABLE public.cloud_sync_reminders ENABLE ROW LEVEL SECURITY;

-- PostgreSQL rejects a direct timestamptz::date index because its result depends
-- on the session timezone. Store the UTC calendar day explicitly instead.
ALTER TABLE public.cloud_sync_reminders
  ADD COLUMN IF NOT EXISTS sent_day_utc DATE
  GENERATED ALWAYS AS ((sent_at AT TIME ZONE 'UTC')::date) STORED;

CREATE UNIQUE INDEX IF NOT EXISTS idx_cloud_sync_reminders_daily
  ON public.cloud_sync_reminders(store_id, sent_day_utc);

COMMENT ON COLUMN public.stores.last_cloud_sync_at IS
  'Timestamp of the most recent completed full cloud sync from a store device.';
COMMENT ON TABLE public.cloud_sync_reminders IS
  'Audit trail and daily deduplication for automatic owner SMS reminders.';
