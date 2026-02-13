-- =========================================
-- 追加スキーマ: エルゴ・日記テーブル
-- Supabase (PostgreSQL) 用
-- =========================================

-- =========================================
-- 1. エルゴマスタテーブル
-- =========================================
CREATE TABLE ergos (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,                           -- エルゴ名
    type TEXT NOT NULL DEFAULT '固定'              -- 種別
        CHECK (type IN ('ダイナミック', '固定')),
    availability TEXT NOT NULL DEFAULT '使用可能'   -- 使用可否
        CHECK (availability IN ('使用可能', '使用不可')),
    memo TEXT,                                    -- メモ
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =========================================
-- 2. Concept2生データテーブル
-- =========================================
CREATE TABLE ergo_raw (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    concept2_id TEXT,                             -- Concept2のワークアウトID
    workout_date TIMESTAMPTZ NOT NULL,            -- ワークアウト日時
    distance INTEGER,                             -- 距離（メートル）
    time_seconds INTEGER,                         -- 時間（秒）
    stroke_rate INTEGER,                          -- ストロークレート
    heart_rate INTEGER,                           -- 心拍数
    raw_data JSONB,                               -- 生JSONデータ
    synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), -- 同期日時
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- インデックス
CREATE INDEX idx_ergo_raw_user_id ON ergo_raw(user_id);
CREATE INDEX idx_ergo_raw_workout_date ON ergo_raw(workout_date);

-- =========================================
-- 3. エルゴセッション（分類済み）テーブル
-- =========================================
CREATE TABLE ergo_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    raw_id UUID REFERENCES ergo_raw(id) ON DELETE SET NULL,
    session_date DATE NOT NULL,                   -- セッション日付
    menu TEXT NOT NULL,                           -- メニュー種別
        -- 例: '2000m', '5000m', '6000m', '3750m', '20分', '30分', 'その他'
    distance INTEGER,                             -- 距離（メートル）
    time_seconds INTEGER,                         -- 時間（秒）
    split_avg TEXT,                               -- 平均スプリット
    stroke_rate_avg INTEGER,                      -- 平均ストロークレート
    heart_rate_avg INTEGER,                       -- 平均心拍数
    ergo_id UUID REFERENCES ergos(id),            -- 使用エルゴ
    memo TEXT,                                    -- メモ
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- インデックス
CREATE INDEX idx_ergo_sessions_user_id ON ergo_sessions(user_id);
CREATE INDEX idx_ergo_sessions_session_date ON ergo_sessions(session_date);
CREATE INDEX idx_ergo_sessions_menu ON ergo_sessions(menu);

-- =========================================
-- 4. 日記テーブル
-- =========================================
CREATE TABLE diaries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    diary_date DATE NOT NULL,                     -- 日記日付
    content TEXT,                                 -- 本文
    condition INTEGER CHECK (condition >= 1 AND condition <= 5), -- 体調（1-5）
    is_public BOOLEAN NOT NULL DEFAULT false,    -- 公開設定
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- 制約：ユーザー×日付はユニーク
    UNIQUE(user_id, diary_date)
);

-- インデックス
CREATE INDEX idx_diaries_user_id ON diaries(user_id);
CREATE INDEX idx_diaries_diary_date ON diaries(diary_date);

-- =========================================
-- 5. Concept2連携設定テーブル
-- =========================================
CREATE TABLE concept2_connections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    access_token TEXT,                            -- OAuthアクセストークン
    refresh_token TEXT,                           -- OAuthリフレッシュトークン
    token_expires_at TIMESTAMPTZ,                 -- トークン有効期限
    last_sync_at TIMESTAMPTZ,                     -- 最終同期日時
    is_connected BOOLEAN NOT NULL DEFAULT false,  -- 連携状態
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- インデックス
CREATE INDEX idx_concept2_connections_user_id ON concept2_connections(user_id);

-- =========================================
-- RLS有効化
-- =========================================
ALTER TABLE ergos ENABLE ROW LEVEL SECURITY;
ALTER TABLE ergo_raw ENABLE ROW LEVEL SECURITY;
ALTER TABLE ergo_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE diaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE concept2_connections ENABLE ROW LEVEL SECURITY;

-- =========================================
-- RLSポリシー
-- =========================================

-- エルゴマスタ: 全員閲覧可、Cox/管理者のみ編集可
CREATE POLICY "ergos_select" ON ergos FOR SELECT USING (true);
CREATE POLICY "ergos_modify" ON ergos FOR ALL USING (
    EXISTS (SELECT 1 FROM users WHERE google_id = auth.uid()::text AND role IN ('Cox', '管理者'))
);

-- Concept2生データ: 自分のデータのみ
CREATE POLICY "ergo_raw_own" ON ergo_raw FOR ALL USING (
    user_id IN (SELECT id FROM users WHERE google_id = auth.uid()::text)
);

-- エルゴセッション: 全員閲覧可、自分のみ編集可
CREATE POLICY "ergo_sessions_select" ON ergo_sessions FOR SELECT USING (true);
CREATE POLICY "ergo_sessions_modify" ON ergo_sessions FOR ALL USING (
    user_id IN (SELECT id FROM users WHERE google_id = auth.uid()::text)
);

-- 日記: 公開日記は全員閲覧可、自分の日記は全操作可
CREATE POLICY "diaries_public_select" ON diaries FOR SELECT USING (
    is_public = true OR user_id IN (SELECT id FROM users WHERE google_id = auth.uid()::text)
);
CREATE POLICY "diaries_own_modify" ON diaries FOR ALL USING (
    user_id IN (SELECT id FROM users WHERE google_id = auth.uid()::text)
);

-- Concept2連携: 自分のデータのみ
CREATE POLICY "concept2_own" ON concept2_connections FOR ALL USING (
    user_id IN (SELECT id FROM users WHERE google_id = auth.uid()::text)
);

-- =========================================
-- 更新日時自動更新トリガー
-- =========================================
CREATE TRIGGER ergos_updated_at BEFORE UPDATE ON ergos
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER ergo_sessions_updated_at BEFORE UPDATE ON ergo_sessions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER diaries_updated_at BEFORE UPDATE ON diaries
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER concept2_connections_updated_at BEFORE UPDATE ON concept2_connections
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
