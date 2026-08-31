-- Language default and per-store display currency (local POS amounts; not Adimat plan prices).
ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS currency_code TEXT DEFAULT 'GHS';

ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS preferred_language TEXT DEFAULT 'en';
