-- User phone (PIN reset / multi-store linking)
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(50) DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
