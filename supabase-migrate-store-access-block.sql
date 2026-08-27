-- ============================================================
-- ADIMAT POS - Migration: Admin store access block
-- Run in the Supabase SQL Editor if you already applied an
-- older supabase-init.sql without access_blocked.
-- When blocked, store staff must pay a subscription package
-- before they can use the POS.
-- ============================================================

ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS access_blocked BOOLEAN DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_stores_access_blocked ON stores(access_blocked);
