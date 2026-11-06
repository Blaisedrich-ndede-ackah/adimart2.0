-- Store owner control for cashier customer payments and receipts.
-- Run once in the Supabase SQL editor. Default is off until the owner allows it.
ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS cashier_can_record_payments BOOLEAN DEFAULT FALSE;
