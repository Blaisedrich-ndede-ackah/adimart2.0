-- ADIMAT POS - Migration: max business stores + warehouse access PIN
-- Run in Supabase SQL editor on existing projects.

ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS max_stores INTEGER DEFAULT 1;

ALTER TABLE locations
  ADD COLUMN IF NOT EXISTS access_pin_hash TEXT;
