-- Store owner control for whether cashiers see on-hand quantities.
-- Run once in the Supabase SQL editor. Default is hidden.
ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS cashier_can_see_stock BOOLEAN DEFAULT FALSE;
