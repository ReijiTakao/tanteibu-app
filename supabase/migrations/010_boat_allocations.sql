-- ========================================
-- 配艇表（boat_allocations）テーブル
-- ========================================

CREATE TABLE IF NOT EXISTS boat_allocations (
    id TEXT PRIMARY KEY,
    boat_id TEXT REFERENCES boats(id) ON DELETE CASCADE,
    boat_type TEXT,
    crew_ids JSONB DEFAULT '[]'::jsonb,
    crew_details_map JSONB DEFAULT '{}'::jsonb,
    oar_ids JSONB DEFAULT '[]'::jsonb,
    created_by TEXT,
    updated_at TIMESTAMPTZ DEFAULT now(),
    created_at TIMESTAMPTZ DEFAULT now()
);

-- RLS
ALTER TABLE boat_allocations ENABLE ROW LEVEL SECURITY;

-- 全ユーザー読み取り可能
CREATE POLICY "boat_allocations_select" ON boat_allocations
    FOR SELECT USING (true);

-- 認証ユーザーは挿入・更新・削除可能
CREATE POLICY "boat_allocations_insert" ON boat_allocations
    FOR INSERT WITH CHECK (true);

CREATE POLICY "boat_allocations_update" ON boat_allocations
    FOR UPDATE USING (true);

CREATE POLICY "boat_allocations_delete" ON boat_allocations
    FOR DELETE USING (true);
