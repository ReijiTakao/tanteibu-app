-- =========================================
-- 8. リギング履歴テーブル作成
-- =========================================

-- rigging_history テーブル: リギング設定の変更履歴を保存
CREATE TABLE IF NOT EXISTS rigging_history (
    id TEXT PRIMARY KEY,
    boat_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    pin_to_heel TEXT DEFAULT '',
    depth TEXT DEFAULT '',
    span TEXT DEFAULT '',
    pitch TEXT DEFAULT '',
    height TEXT DEFAULT '',
    memo TEXT DEFAULT '',
    saved_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_rigging_history_boat_user 
    ON rigging_history(boat_id, user_id);
CREATE INDEX IF NOT EXISTS idx_rigging_history_saved_at 
    ON rigging_history(saved_at DESC);

-- RLSを有効化
ALTER TABLE rigging_history ENABLE ROW LEVEL SECURITY;

-- 全ユーザーが閲覧・操作可能（チーム内共有データ）
CREATE POLICY "rigging_history_select" ON rigging_history
    FOR SELECT USING (true);

CREATE POLICY "rigging_history_insert" ON rigging_history
    FOR INSERT WITH CHECK (true);

CREATE POLICY "rigging_history_update" ON rigging_history
    FOR UPDATE USING (true);

CREATE POLICY "rigging_history_delete" ON rigging_history
    FOR DELETE USING (true);

-- riggingsテーブルのboat_idも TEXT に変更（既存のUUID制約を外す）
-- ※ 既存のFKがある場合のみ
ALTER TABLE riggings DROP CONSTRAINT IF EXISTS riggings_boat_id_fkey;
ALTER TABLE riggings ALTER COLUMN boat_id TYPE TEXT USING boat_id::TEXT;
ALTER TABLE riggings ALTER COLUMN user_id TYPE TEXT USING user_id::TEXT;
