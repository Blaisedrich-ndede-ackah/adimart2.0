CREATE TABLE IF NOT EXISTS public.campaign_admin_auth_challenges (
  id UUID PRIMARY KEY,
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  source_ip TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.campaign_admin_auth_challenges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.campaign_admin_auth_challenges FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.campaign_admin_auth_challenges TO service_role;

CREATE INDEX IF NOT EXISTS idx_campaign_admin_challenges_ip_created
  ON public.campaign_admin_auth_challenges (source_ip, created_at DESC);