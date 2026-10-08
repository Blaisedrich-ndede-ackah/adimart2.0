-- ============================================================
-- ADIMAT POS - Migration: promotional campaign media
-- Run after supabase-init.sql in the Supabase SQL editor.
-- This migration creates campaign metadata and a public media bucket
-- for flyers/videos shown in FlyerShowcase.
--
-- Direct table/storage writes require a trusted Supabase Auth JWT whose
-- app_metadata contains { "is_platform_admin": true }. The portal signs in
-- with Supabase Auth; row-level security protects all campaign writes.
-- ============================================================

CREATE OR REPLACE FUNCTION public.is_adimat_campaign_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT COALESCE(
    ((auth.jwt() -> 'app_metadata' ->> 'is_platform_admin') = 'true'),
    FALSE
  );
$$;

REVOKE ALL ON FUNCTION public.is_adimat_campaign_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_adimat_campaign_admin() TO authenticated;

CREATE TABLE IF NOT EXISTS public.promotional_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(160) NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 160),
  description TEXT NOT NULL DEFAULT '',
  media_type TEXT NOT NULL CHECK (media_type IN ('image', 'video')),
  media_path TEXT NOT NULL CHECK (char_length(btrim(media_path)) > 0),
  poster_path TEXT,
  alt_text TEXT NOT NULL DEFAULT '',
  cta_label VARCHAR(80) NOT NULL DEFAULT '',
  cta_url TEXT NOT NULL DEFAULT '',
  is_published BOOLEAN NOT NULL DEFAULT FALSE,
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT promotional_campaigns_valid_window
    CHECK (starts_at IS NULL OR ends_at IS NULL OR ends_at > starts_at),
  CONSTRAINT promotional_campaigns_valid_poster
    CHECK (poster_path IS NULL OR char_length(btrim(poster_path)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_promotional_campaigns_published_order
  ON public.promotional_campaigns (sort_order ASC, created_at DESC)
  WHERE is_published = TRUE;

ALTER TABLE public.promotional_campaigns ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.promotional_campaigns FROM PUBLIC;
GRANT SELECT ON TABLE public.promotional_campaigns TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON TABLE public.promotional_campaigns TO authenticated;

DROP POLICY IF EXISTS promotional_campaigns_public_read_active
  ON public.promotional_campaigns;
CREATE POLICY promotional_campaigns_public_read_active
  ON public.promotional_campaigns
  FOR SELECT
  TO anon, authenticated
  USING (
    is_published = TRUE
    AND (starts_at IS NULL OR starts_at <= NOW())
    AND (ends_at IS NULL OR ends_at > NOW())
  );

DROP POLICY IF EXISTS promotional_campaigns_admin_read_all
  ON public.promotional_campaigns;
CREATE POLICY promotional_campaigns_admin_read_all
  ON public.promotional_campaigns
  FOR SELECT
  TO authenticated
  USING ((SELECT public.is_adimat_campaign_admin()));

DROP POLICY IF EXISTS promotional_campaigns_admin_insert
  ON public.promotional_campaigns;
CREATE POLICY promotional_campaigns_admin_insert
  ON public.promotional_campaigns
  FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT public.is_adimat_campaign_admin()));

DROP POLICY IF EXISTS promotional_campaigns_admin_update
  ON public.promotional_campaigns;
CREATE POLICY promotional_campaigns_admin_update
  ON public.promotional_campaigns
  FOR UPDATE
  TO authenticated
  USING ((SELECT public.is_adimat_campaign_admin()))
  WITH CHECK ((SELECT public.is_adimat_campaign_admin()));

DROP POLICY IF EXISTS promotional_campaigns_admin_delete
  ON public.promotional_campaigns;
CREATE POLICY promotional_campaigns_admin_delete
  ON public.promotional_campaigns
  FOR DELETE
  TO authenticated
  USING ((SELECT public.is_adimat_campaign_admin()));

CREATE OR REPLACE FUNCTION public.touch_adimat_campaign_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.touch_adimat_campaign_updated_at() FROM PUBLIC;

DROP TRIGGER IF EXISTS touch_adimat_campaign_updated_at
  ON public.promotional_campaigns;
CREATE TRIGGER touch_adimat_campaign_updated_at
  BEFORE UPDATE ON public.promotional_campaigns
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_adimat_campaign_updated_at();

INSERT INTO storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
VALUES (
  'promotional-campaigns',
  'promotional-campaigns',
  TRUE,
  52428800,
  ARRAY[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'video/mp4',
    'video/webm',
    'video/quicktime'
  ]::TEXT[]
)
ON CONFLICT (id) DO UPDATE
SET
  name = EXCLUDED.name,
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Public buckets allow public downloads; listing and every write remain
-- limited to authenticated platform admins. SELECT is included for admin
-- listing and Storage upserts, which require SELECT + INSERT + UPDATE.
DROP POLICY IF EXISTS promotional_campaign_files_admin_select
  ON storage.objects;
CREATE POLICY promotional_campaign_files_admin_select
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'promotional-campaigns'
    AND (SELECT public.is_adimat_campaign_admin())
  );

DROP POLICY IF EXISTS promotional_campaign_files_admin_insert
  ON storage.objects;
CREATE POLICY promotional_campaign_files_admin_insert
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'promotional-campaigns'
    AND (SELECT public.is_adimat_campaign_admin())
  );

DROP POLICY IF EXISTS promotional_campaign_files_admin_update
  ON storage.objects;
CREATE POLICY promotional_campaign_files_admin_update
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'promotional-campaigns'
    AND (SELECT public.is_adimat_campaign_admin())
  )
  WITH CHECK (
    bucket_id = 'promotional-campaigns'
    AND (SELECT public.is_adimat_campaign_admin())
  );

DROP POLICY IF EXISTS promotional_campaign_files_admin_delete
  ON storage.objects;
CREATE POLICY promotional_campaign_files_admin_delete
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'promotional-campaigns'
    AND (SELECT public.is_adimat_campaign_admin())
  );

-- Explicit Data API grants are required on projects where new public tables
-- are not exposed automatically. RLS still limits rows and write operations.
-- If public is not an exposed schema for the Data API, expose it in the
-- project's API settings before querying this table with supabase-js.
COMMENT ON TABLE public.promotional_campaigns IS
  'Admin-managed promotional flyers and videos displayed in the application campaign showcase.';
COMMENT ON COLUMN public.promotional_campaigns.media_path IS
  'Object path inside the promotional-campaigns Storage bucket.';
COMMENT ON COLUMN public.promotional_campaigns.poster_path IS
  'Optional image object path used as a video poster.';
COMMENT ON COLUMN public.promotional_campaigns.is_published IS
  'Only published campaigns within their optional date window are visible to public clients.';

-- Assign is_platform_admin in Supabase Auth app_metadata through the
-- Supabase Dashboard or SQL Editor. Never authorize with user_metadata,
-- which users can edit themselves.

NOTIFY pgrst, 'reload schema';
NOTIFY pgrst, 'reload config';
NOTIFY storage, 'reload config';

-- Read-only verification after running:
-- SELECT id, title, media_type, is_published, starts_at, ends_at, sort_order
-- FROM public.promotional_campaigns
-- ORDER BY sort_order, created_at DESC;
-- SELECT id, name, public, file_size_limit, allowed_mime_types
-- FROM storage.buckets WHERE id = 'promotional-campaigns';

-- Portal campaign CRUD uses the signed-in administrator's JWT. Keep direct
-- anonymous writes prohibited; authenticated writes remain protected by RLS.
