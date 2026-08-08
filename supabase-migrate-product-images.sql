-- ============================================================
-- ADIMAT POS - Migration: optional product images
-- Run in Supabase SQL Editor if products table already exists.
-- ============================================================

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS image_url TEXT DEFAULT '';
