-- Adimat feature pack Phase 3: external API/webhooks and notifications.
-- Private integration tables are server-role only. Do not add public/anon RLS policies.

CREATE TABLE IF NOT EXISTS public.api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  scopes_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_api_keys_store_created ON public.api_keys(store_id, created_at DESC);
ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.api_keys FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.api_keys TO service_role;

CREATE TABLE IF NOT EXISTS public.api_rate_limit_windows (
  key_id UUID NOT NULL REFERENCES public.api_keys(id) ON DELETE CASCADE,
  window_start TIMESTAMPTZ NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(key_id, window_start)
);
ALTER TABLE public.api_rate_limit_windows ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.api_rate_limit_windows FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.api_rate_limit_windows TO service_role;

CREATE OR REPLACE FUNCTION public.consume_adimat_api_rate_limit(p_key_id UUID, p_window_start TIMESTAMPTZ)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE current_count INTEGER;
BEGIN
  INSERT INTO public.api_rate_limit_windows(key_id, window_start, request_count)
  VALUES (p_key_id, p_window_start, 1)
  ON CONFLICT (key_id, window_start)
  DO UPDATE SET request_count = api_rate_limit_windows.request_count + 1
  RETURNING request_count INTO current_count;
  IF current_count = 1 THEN
    DELETE FROM public.api_rate_limit_windows WHERE window_start < NOW() - INTERVAL '48 hours';
  END IF;
  RETURN current_count;
END;
$$;
REVOKE ALL ON FUNCTION public.consume_adimat_api_rate_limit(UUID, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_adimat_api_rate_limit(UUID, TIMESTAMPTZ) TO service_role;

CREATE TABLE IF NOT EXISTS public.api_management_pin_attempts (
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  lock_until TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(store_id, user_id)
);
ALTER TABLE public.api_management_pin_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.api_management_pin_attempts FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.api_management_pin_attempts TO service_role;

CREATE OR REPLACE FUNCTION public.record_adimat_api_pin_failure(p_store_id UUID, p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.api_management_pin_attempts(store_id, user_id, failed_attempts, lock_until, updated_at)
  VALUES (p_store_id, p_user_id, 1, NULL, NOW())
  ON CONFLICT (store_id, user_id) DO UPDATE SET
    failed_attempts = CASE
      WHEN api_management_pin_attempts.updated_at < NOW() - INTERVAL '15 minutes' THEN 1
      ELSE api_management_pin_attempts.failed_attempts + 1
    END,
    lock_until = CASE
      WHEN api_management_pin_attempts.updated_at < NOW() - INTERVAL '15 minutes' THEN NULL
      WHEN api_management_pin_attempts.failed_attempts + 1 >= 5 THEN NOW() + INTERVAL '15 minutes'
      ELSE api_management_pin_attempts.lock_until
    END,
    updated_at = NOW();
END;
$$;
REVOKE ALL ON FUNCTION public.record_adimat_api_pin_failure(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_adimat_api_pin_failure(UUID, UUID) TO service_role;

CREATE TABLE IF NOT EXISTS public.webhooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  secret_ciphertext TEXT NOT NULL,
  events_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_webhooks_store_active ON public.webhooks(store_id, is_active);
ALTER TABLE public.webhooks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.webhooks FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.webhooks TO service_role;

CREATE TABLE IF NOT EXISTS public.webhook_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id UUID NOT NULL REFERENCES public.webhooks(id) ON DELETE CASCADE,
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  event TEXT NOT NULL,
  event_key TEXT NOT NULL,
  payload_json JSONB NOT NULL,
  response_status INTEGER,
  response_body TEXT NOT NULL DEFAULT '',
  last_error TEXT NOT NULL DEFAULT '',
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(webhook_id, event_key)
);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_retry ON public.webhook_deliveries(next_attempt_at) WHERE delivered_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_store_created ON public.webhook_deliveries(store_id, created_at DESC);
ALTER TABLE public.webhook_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.webhook_deliveries FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.webhook_deliveries TO service_role;

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
