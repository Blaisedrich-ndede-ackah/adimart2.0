-- ============================================================
-- ADIMAT POS - Cashier Cash Book access
-- Run in Supabase SQL Editor if your project predates this feature
-- ============================================================

-- Existing cashiers keep Cash Book (DEFAULT TRUE). New cashiers are inserted with FALSE;
-- store owners toggle access in Settings → Staff → Perms.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS can_access_cashbook BOOLEAN DEFAULT TRUE;

UPDATE users
SET can_access_cashbook = TRUE
WHERE role = 'owner' AND (can_access_cashbook IS NULL OR can_access_cashbook = FALSE);
