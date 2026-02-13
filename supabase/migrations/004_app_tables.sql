-- =========================================
-- アプリ用テーブル（簡易版）
-- profiles: ユーザープロフィール
-- schedules: 練習スケジュール（フラット構造）
-- ergo_records: エルゴ記録
-- =========================================

-- =========================================
-- 1. プロフィールテーブル（Supabase Auth連携）
-- =========================================
CREATE TABLE IF NOT EXISTS profiles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    auth_id UUID UNIQUE,                          -- Supabase Auth のユーザーID
    email TEXT,                                    -- メールアドレス
    name TEXT NOT NULL,                            -- 氏名
    grade INTEGER DEFAULT 1,                       -- 学年
    gender TEXT DEFAULT 'man'                       -- 性別
        CHECK (gender IN ('man', 'woman')),
    role TEXT NOT NULL DEFAULT '部員'               -- 権限
        CHECK (role IN ('部員', '幹部', 'コーチ', 'Cox', '管理者')),
    status TEXT NOT NULL DEFAULT '在籍'             -- 在籍状態
        CHECK (status IN ('在籍', '非在籍')),
    approval_status TEXT NOT NULL DEFAULT '承認済み' -- 承認状態
        CHECK (approval_status IN ('承認済み', '未承認')),
    concept2_connected BOOLEAN DEFAULT false,
    concept2_access_token TEXT,
    concept2_last_sync TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_profiles_auth_id ON profiles(auth_id);
CREATE INDEX IF NOT EXISTS idx_profiles_approval ON profiles(approval_status);

-- =========================================
-- 2. スケジュールテーブル（フラット構造）
-- =========================================
CREATE TABLE IF NOT EXISTS schedules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL,                         -- プロフィールID
    date DATE NOT NULL,                            -- 日付
    time_slot TEXT NOT NULL                         -- 時間帯
        CHECK (time_slot IN ('午前', '午後')),
    schedule_type TEXT                              -- 予定種別
        CHECK (schedule_type IS NULL OR schedule_type IN ('エルゴ', '乗艇', 'ウェイト', '参加不可')),
    absence_reason TEXT,                           -- 欠席理由
    ergo_type TEXT,                                -- エルゴ種別
    ergo_id UUID,                                  -- 使用エルゴID
    boat_id UUID,                                  -- 使用艇ID
    oar_id UUID,                                   -- 使用オールID
    start_time TEXT,                               -- 開始時刻
    memo TEXT,                                     -- メモ
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    UNIQUE(user_id, date, time_slot)
);

CREATE INDEX IF NOT EXISTS idx_schedules_date ON schedules(date);
CREATE INDEX IF NOT EXISTS idx_schedules_user_id ON schedules(user_id);

-- =========================================
-- 3. エルゴ記録テーブル（フラット構造）
-- =========================================
CREATE TABLE IF NOT EXISTS ergo_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL,                         -- プロフィールID
    schedule_id UUID,                              -- 関連スケジュールID
    date DATE NOT NULL,                            -- 日付
    time_slot TEXT,                                 -- 時間帯
    distance INTEGER,                              -- 距離（m）
    time_seconds NUMERIC(10,2),                    -- 時間（秒）
    time_display TEXT,                             -- 表示用タイム
    split TEXT,                                    -- 500mスプリット
    stroke_rate INTEGER,                           -- ストロークレート
    heart_rate INTEGER,                            -- 心拍数
    weight NUMERIC(5,1),                           -- 体重
    menu_key TEXT,                                 -- メニューキー（例: '2000m TT'）
    category TEXT,                                 -- カテゴリ（distance/time/interval）
    source TEXT DEFAULT '手入力',                   -- ソース
    raw_data JSONB,                                -- Concept2生データ
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ergo_records_user_id ON ergo_records(user_id);
CREATE INDEX IF NOT EXISTS idx_ergo_records_date ON ergo_records(date);
CREATE INDEX IF NOT EXISTS idx_ergo_records_menu ON ergo_records(menu_key);

-- =========================================
-- 4. クルーノートテーブル
-- =========================================
CREATE TABLE IF NOT EXISTS crew_notes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    date DATE NOT NULL,
    time_slot TEXT,
    boat_id UUID,
    crew_data JSONB,                               -- クルー情報JSON
    note TEXT,                                     -- ノート内容
    created_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crew_notes_date ON crew_notes(date);

-- =========================================
-- RLS: シンプルなポリシー（MVP用）
-- 全テーブル読み取り可、認証ユーザーは書き込み可
-- =========================================
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE ergo_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE crew_notes ENABLE ROW LEVEL SECURITY;

-- profiles: 全員閲覧可、自分のプロフィールのみ編集可
CREATE POLICY "profiles_select" ON profiles FOR SELECT USING (true);
CREATE POLICY "profiles_insert" ON profiles FOR INSERT WITH CHECK (true);
CREATE POLICY "profiles_update" ON profiles FOR UPDATE USING (auth_id = auth.uid());

-- schedules: 全員閲覧可、認証ユーザーは全操作可
CREATE POLICY "schedules_select" ON schedules FOR SELECT USING (true);
CREATE POLICY "schedules_insert" ON schedules FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "schedules_update" ON schedules FOR UPDATE USING (auth.uid() IS NOT NULL);
CREATE POLICY "schedules_delete" ON schedules FOR DELETE USING (auth.uid() IS NOT NULL);

-- ergo_records: 全員閲覧可、認証ユーザーは全操作可
CREATE POLICY "ergo_records_select" ON ergo_records FOR SELECT USING (true);
CREATE POLICY "ergo_records_insert" ON ergo_records FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "ergo_records_update" ON ergo_records FOR UPDATE USING (auth.uid() IS NOT NULL);
CREATE POLICY "ergo_records_delete" ON ergo_records FOR DELETE USING (auth.uid() IS NOT NULL);

-- crew_notes: 全員閲覧可、認証ユーザーは全操作可
CREATE POLICY "crew_notes_select" ON crew_notes FOR SELECT USING (true);
CREATE POLICY "crew_notes_insert" ON crew_notes FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "crew_notes_update" ON crew_notes FOR UPDATE USING (auth.uid() IS NOT NULL);
CREATE POLICY "crew_notes_delete" ON crew_notes FOR DELETE USING (auth.uid() IS NOT NULL);

-- =========================================
-- 更新日時自動更新トリガー
-- =========================================
CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER schedules_updated_at BEFORE UPDATE ON schedules
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER ergo_records_updated_at BEFORE UPDATE ON ergo_records
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER crew_notes_updated_at BEFORE UPDATE ON crew_notes
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
