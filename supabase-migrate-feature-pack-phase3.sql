-- Adimat Phase 3 notification storage only.
-- API-key and webhook integrations have been removed from the application.

CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  data_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  event_key TEXT NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(store_id, user_id, event_key)
);
CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON public.notifications(store_id, user_id, created_at DESC);
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notifications FROM anon, authenticated;
GRANT ALL ON public.notifications TO service_role;

CREATE TABLE IF NOT EXISTS public.device_push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh_key TEXT NOT NULL,
  auth_key TEXT NOT NULL,
  device_label TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_store_user ON public.device_push_subscriptions(store_id, user_id);
ALTER TABLE public.device_push_subscriptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.device_push_subscriptions FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.device_push_subscriptions TO service_role;

NOTIFY pgrst, 'reload schema';
