-- ============================================================
-- ADIMAT POS - Migration: Monthly store subscriptions
-- Run in the Supabase SQL Editor if you already applied an
-- older supabase-init.sql without subscription fields.
-- ============================================================

ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS subscription_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS subscription_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS subscription_months_granted INTEGER DEFAULT 0;

CREATE TABLE IF NOT EXISTS subscription_grants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  months INTEGER NOT NULL CHECK (months > 0),
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  notes TEXT DEFAULT '',
  granted_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE subscription_grants ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'subscription_grants' AND policyname = 'subscription_grants_select'
  ) THEN
    CREATE POLICY "subscription_grants_select" ON subscription_grants FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'subscription_grants' AND policyname = 'subscription_grants_insert'
  ) THEN
    CREATE POLICY "subscription_grants_insert" ON subscription_grants FOR INSERT WITH CHECK (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'subscription_grants' AND policyname = 'subscription_grants_update'
  ) THEN
    CREATE POLICY "subscription_grants_update" ON subscription_grants FOR UPDATE USING (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'subscription_grants' AND policyname = 'subscription_grants_delete'
  ) THEN
    CREATE POLICY "subscription_grants_delete" ON subscription_grants FOR DELETE USING (true);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_subscription_grants_store ON subscription_grants(store_id);
CREATE INDEX IF NOT EXISTS idx_subscription_grants_granted_at ON subscription_grants(granted_at);
CREATE INDEX IF NOT EXISTS idx_stores_subscription_expires ON stores(subscription_expires_at);
