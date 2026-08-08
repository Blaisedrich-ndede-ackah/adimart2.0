-- ============================================================
-- ADIMAT POS - Migration: optional store logo
-- Run in Supabase SQL Editor if stores table already exists.
-- ============================================================

ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS logo_url TEXT DEFAULT '';
