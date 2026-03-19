-- Migration 018: crew_metadata テーブル（クルー名・再生リストURL同期用）
CREATE TABLE IF NOT EXISTS crew_metadata (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    crew_hash TEXT NOT NULL UNIQUE,
    name TEXT DEFAULT NULL,
    playlist_url TEXT DEFAULT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLSポリシー
ALTER TABLE crew_metadata ENABLE ROW LEVEL SECURITY;

CREATE POLICY "crew_metadata_select" ON crew_metadata
    FOR SELECT USING (true);

CREATE POLICY "crew_metadata_insert" ON crew_metadata
    FOR INSERT WITH CHECK (true);

CREATE POLICY "crew_metadata_update" ON crew_metadata
    FOR UPDATE USING (true);

CREATE POLICY "crew_metadata_delete" ON crew_metadata
    FOR DELETE USING (true);
