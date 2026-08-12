-- User phone (PIN reset / multi-store linking) + admin SMS OTP phone
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(50) DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);

ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS admin_phone VARCHAR(50) DEFAULT '';
