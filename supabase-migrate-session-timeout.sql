-- ============================================================
-- ADIMAT POS - Migration: automatic session timeout
-- Run in Supabase SQL Editor for existing projects.
-- Idle minutes before store staff are returned to the PIN screen.
-- 0 = never lock. Default 5 minutes.
-- ============================================================

ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS session_timeout_minutes INTEGER DEFAULT 5
    CHECK (session_timeout_minutes >= 0 AND session_timeout_minutes <= 180);

UPDATE stores
  SET session_timeout_minutes = 5
  WHERE session_timeout_minutes IS NULL;
