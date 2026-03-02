-- 週間練習メニューテーブル
CREATE TABLE IF NOT EXISTS weekly_menus (
    id TEXT PRIMARY KEY,
    week_start DATE NOT NULL,
    slots JSONB DEFAULT '{}'::jsonb,
    notes TEXT DEFAULT '',
    updated_by TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- week_startでのインデックス（週の検索に使用）
CREATE INDEX IF NOT EXISTS idx_weekly_menus_week_start ON weekly_menus(week_start);

-- RLSポリシー
ALTER TABLE weekly_menus ENABLE ROW LEVEL SECURITY;

-- 全員が閲覧可能
CREATE POLICY "weekly_menus_read" ON weekly_menus
    FOR SELECT USING (true);

-- 認証ユーザーが作成・更新可能
CREATE POLICY "weekly_menus_insert" ON weekly_menus
    FOR INSERT WITH CHECK (true);

CREATE POLICY "weekly_menus_update" ON weekly_menus
    FOR UPDATE USING (true);

CREATE POLICY "weekly_menus_delete" ON weekly_menus
    FOR DELETE USING (true);
