-- Concept2連携用のカラムを追加
ALTER TABLE users ADD COLUMN IF NOT EXISTS concept2_access_token TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS concept2_refresh_token TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS concept2_token_expires_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS concept2_connected BOOLEAN DEFAULT false;

-- インデックス追加
CREATE INDEX IF NOT EXISTS idx_users_concept2_connected ON users(concept2_connected);
