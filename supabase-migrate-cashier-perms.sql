-- Per-cashier stock visibility and discount permission.
-- Run in the Supabase SQL editor. Missing values keep the older store-wide default.

ALTER TABLE users ADD COLUMN IF NOT EXISTS can_view_stock BOOLEAN;
ALTER TABLE users ADD COLUMN IF NOT EXISTS can_discount BOOLEAN;
