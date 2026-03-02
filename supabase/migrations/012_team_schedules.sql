-- 全体スケジュール告知テーブル
CREATE TABLE IF NOT EXISTS team_schedules (
    id TEXT PRIMARY KEY,
    date DATE NOT NULL,
    time_slot TEXT DEFAULT '',
    content TEXT NOT NULL DEFAULT '',
    created_by TEXT REFERENCES profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- dateでのインデックス
CREATE INDEX IF NOT EXISTS idx_team_schedules_date ON team_schedules(date);

-- RLSポリシー
ALTER TABLE team_schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team_schedules_read" ON team_schedules
    FOR SELECT USING (true);

CREATE POLICY "team_schedules_insert" ON team_schedules
    FOR INSERT WITH CHECK (true);

CREATE POLICY "team_schedules_update" ON team_schedules
    FOR UPDATE USING (true);

CREATE POLICY "team_schedules_delete" ON team_schedules
    FOR DELETE USING (true);
