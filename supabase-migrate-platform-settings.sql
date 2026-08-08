-- ============================================================
-- ADIMAT POS - Migration: global platform / admin contact settings
-- Run in the Supabase SQL Editor if you already applied an
-- older supabase-init.sql without this table.
-- ============================================================

CREATE TABLE IF NOT EXISTS platform_settings (
  id TEXT PRIMARY KEY DEFAULT 'main',
  contact_whatsapp VARCHAR(50) DEFAULT '',
  contact_email VARCHAR(255) DEFAULT '',
  mnotify_api_key TEXT DEFAULT '',
  mnotify_sender_id VARCHAR(11) DEFAULT 'Adimat',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE platform_settings ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'platform_settings' AND policyname = 'platform_settings_select'
  ) THEN
    CREATE POLICY "platform_settings_select" ON platform_settings FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'platform_settings' AND policyname = 'platform_settings_insert'
  ) THEN
    CREATE POLICY "platform_settings_insert" ON platform_settings FOR INSERT WITH CHECK (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'platform_settings' AND policyname = 'platform_settings_update'
  ) THEN
    CREATE POLICY "platform_settings_update" ON platform_settings FOR UPDATE USING (true);
  END IF;
END $$;

INSERT INTO platform_settings (id, contact_whatsapp, contact_email, mnotify_api_key, mnotify_sender_id)
VALUES ('main', '', '', '', 'Adimat')
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'update_platform_settings_updated_at'
  ) THEN
    CREATE TRIGGER update_platform_settings_updated_at
      BEFORE UPDATE ON platform_settings
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;
