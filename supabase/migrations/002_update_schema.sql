-- =========================================
-- 2. データベース更新 (Rigging & Attendance)
-- =========================================

-- -----------------------------------------
-- Attendances テーブル更新
-- -----------------------------------------

-- 1. reasonカラムの制約を削除して新しい制約を追加
ALTER TABLE attendances DROP CONSTRAINT IF EXISTS attendances_reason_check;
ALTER TABLE attendances ADD CONSTRAINT attendances_reason_check 
    CHECK (reason IS NULL OR reason IN ('怪我', '体調不良', '就活', '学校', 'その他'));

-- 2. reflectionカラムの追加
ALTER TABLE attendances ADD COLUMN IF NOT EXISTS reflection TEXT;

-- -----------------------------------------
-- Riggings テーブル作成
-- -----------------------------------------

CREATE TABLE IF NOT EXISTS riggings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    boat_id UUID REFERENCES boats(id) ON DELETE SET NULL, -- 削除されたらNULL
    pin_to_heel NUMERIC(5, 1), -- cm (例: 123.4)
    depth NUMERIC(5, 1),       -- cm
    span NUMERIC(5, 1),        -- cm
    pitch NUMERIC(4, 1),       -- 度
    height NUMERIC(5, 1),      -- cm
    memo TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_riggings_user_id ON riggings(user_id);
CREATE INDEX IF NOT EXISTS idx_riggings_boat_id ON riggings(boat_id);

-- RLSポリシー
ALTER TABLE riggings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "自分のリギングは閲覧可" ON riggings
    FOR SELECT USING (user_id IN (SELECT id FROM users WHERE google_id = auth.uid()::text));

CREATE POLICY "自分のリギングは編集可" ON riggings
    FOR ALL USING (user_id IN (SELECT id FROM users WHERE google_id = auth.uid()::text));

-- 更新日時トリガー
CREATE TRIGGER riggings_updated_at BEFORE UPDATE ON riggings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
