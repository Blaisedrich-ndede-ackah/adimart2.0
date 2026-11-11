-- Profile photo for each owner and cashier.
-- Safe to run more than once. The POS still saves the photo on the device
-- if this column is not on the server yet.

ALTER TABLE users ADD COLUMN IF NOT EXISTS photo_url TEXT DEFAULT '';

NOTIFY pgrst, 'reload schema';
