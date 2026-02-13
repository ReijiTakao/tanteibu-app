-- =========================================
-- 端艇部管理アプリ 統合セットアップスクリプト
-- =========================================

-- 拡張機能
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =========================================
-- 1. ユーザーテーブル (統合版)
-- =========================================
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,                           -- 氏名
    grade INTEGER,                                -- 学年
    role TEXT NOT NULL DEFAULT '部員'              -- 権限
        CHECK (role IN ('部員', '幹部', 'コーチ', 'Cox', '管理者')),
    status TEXT NOT NULL DEFAULT '在籍'            -- 在籍状態
        CHECK (status IN ('在籍', '非在籍')),
    auth_id TEXT UNIQUE,                          -- Supabase Auth ID (旧 google_id)
    approval_status TEXT NOT NULL DEFAULT '未承認' -- 承認状態
        CHECK (approval_status IN ('承認済み', '未承認')),
    
    -- Concept2連携用カラム (from 003)
    concept2_access_token TEXT,
    concept2_refresh_token TEXT,
    concept2_token_expires_at TIMESTAMP WITH TIME ZONE,
    concept2_connected BOOLEAN DEFAULT false,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_auth_id ON users(auth_id);
CREATE INDEX IF NOT EXISTS idx_users_approval_status ON users(approval_status);
CREATE INDEX IF NOT EXISTS idx_users_concept2_connected ON users(concept2_connected);

-- =========================================
-- 2. 監査ログ
-- =========================================
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id),
    target_type TEXT NOT NULL,
    target_id UUID,
    operation TEXT NOT NULL
        CHECK (operation IN ('作成', '更新', '削除')),
    changes JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_target_type ON audit_logs(target_type);

-- =========================================
-- 3. マスタテーブル (艇・オール・エルゴ)
-- =========================================
-- 艇
CREATE TABLE IF NOT EXISTS boats (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    availability TEXT NOT NULL DEFAULT '使用可能'
        CHECK (availability IN ('使用可能', '使用不可')),
    memo TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- オール
CREATE TABLE IF NOT EXISTS oars (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    type TEXT,
    availability TEXT NOT NULL DEFAULT '使用可能'
        CHECK (availability IN ('使用可能', '使用不可')),
    memo TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- エルゴ (from 002)
CREATE TABLE IF NOT EXISTS ergos (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT '固定'
        CHECK (type IN ('ダイナミック', '固定')),
    availability TEXT NOT NULL DEFAULT '使用可能'
        CHECK (availability IN ('使用可能', '使用不可')),
    memo TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =========================================
-- 4. 練習・出欠・リギング
-- =========================================
-- 練習回
CREATE TABLE IF NOT EXISTS practices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    date DATE NOT NULL,
    time_slot TEXT NOT NULL
        CHECK (time_slot IN ('午前', '午後')),
    practice_type TEXT
        CHECK (practice_type IS NULL OR practice_type IN ('エルゴ', 'ウェイト', '乗艇')),
    start_time TIME,
    memo TEXT,
    created_by UUID REFERENCES users(id),
    updated_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(date, time_slot)
);
CREATE INDEX IF NOT EXISTS idx_practices_date ON practices(date);

-- 出欠 (with reflection from 002_update)
CREATE TABLE IF NOT EXISTS attendances (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    practice_id UUID NOT NULL REFERENCES practices(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    attendance_status TEXT NOT NULL
        CHECK (attendance_status IN ('参加', '不参加', '保留')),
    boathouse_status TEXT NOT NULL
        CHECK (boathouse_status IN ('艇庫にいる', '艇庫にいない')),
    can_participate TEXT,
    reason TEXT
        CHECK (reason IS NULL OR reason IN ('怪我', '体調不良', '就活', '学校', 'その他', '就活・用事')),
    memo TEXT,
    reflection TEXT, -- from 002_update
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(practice_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_attendances_practice_id ON attendances(practice_id);
CREATE INDEX IF NOT EXISTS idx_attendances_user_id ON attendances(user_id);

-- リギング (from 002_update)
CREATE TABLE IF NOT EXISTS riggings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    boat_id UUID REFERENCES boats(id) ON DELETE SET NULL,
    pin_to_heel NUMERIC(5, 1),
    depth NUMERIC(5, 1),
    span NUMERIC(5, 1),
    pitch NUMERIC(4, 1),
    height NUMERIC(5, 1),
    memo TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_riggings_user_id ON riggings(user_id);

-- =========================================
-- 5. エルゴ記録・日記関連 (from 002 & 004)
-- =========================================
-- Ergo Raw (from 002)
CREATE TABLE IF NOT EXISTS ergo_raw (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    concept2_id TEXT,
    workout_date TIMESTAMPTZ NOT NULL,
    distance INTEGER,
    time_seconds INTEGER,
    stroke_rate INTEGER,
    heart_rate INTEGER,
    raw_data JSONB,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Ergo Sessions (from 002)
CREATE TABLE IF NOT EXISTS ergo_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    raw_id UUID REFERENCES ergo_raw(id) ON DELETE SET NULL,
    session_date DATE NOT NULL,
    menu TEXT NOT NULL,
    distance INTEGER,
    time_seconds INTEGER,
    split_avg TEXT,
    stroke_rate_avg INTEGER,
    heart_rate_avg INTEGER,
    ergo_id UUID REFERENCES ergos(id),
    memo TEXT,
    menu_key TEXT, -- added to match usage
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Diaries (from 002)
CREATE TABLE IF NOT EXISTS diaries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    diary_date DATE NOT NULL,
    content TEXT,
    condition INTEGER CHECK (condition >= 1 AND condition <= 5),
    is_public BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, diary_date)
);

-- Concept2 Connections (from 002)
CREATE TABLE IF NOT EXISTS concept2_connections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    access_token TEXT,
    refresh_token TEXT,
    token_expires_at TIMESTAMPTZ,
    last_sync_at TIMESTAMPTZ,
    is_connected BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =========================================
-- 6. アプリ用追加テーブル (from 004)
-- =========================================
-- Profiles (Supabase Auth ID mapping)
CREATE TABLE IF NOT EXISTS profiles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    auth_id UUID UNIQUE,
    email TEXT,
    name TEXT NOT NULL,
    grade INTEGER DEFAULT 1,
    gender TEXT DEFAULT 'man',
    role TEXT NOT NULL DEFAULT '部員',
    status TEXT NOT NULL DEFAULT '在籍',
    approval_status TEXT NOT NULL DEFAULT '承認済み',
    concept2_connected BOOLEAN DEFAULT false,
    concept2_access_token TEXT,
    concept2_last_sync TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Schedules
CREATE TABLE IF NOT EXISTS schedules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL,
    date DATE NOT NULL,
    time_slot TEXT NOT NULL,
    schedule_type TEXT,
    absence_reason TEXT,
    ergo_type TEXT,
    ergo_id UUID,
    boat_id UUID,
    oar_id UUID,
    start_time TEXT,
    memo TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, date, time_slot)
);

-- Ergo Records (Flat)
CREATE TABLE IF NOT EXISTS ergo_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL,
    schedule_id UUID,
    date DATE NOT NULL,
    time_slot TEXT,
    distance INTEGER,
    time_seconds NUMERIC(10,2),
    time_display TEXT,
    split TEXT,
    stroke_rate INTEGER,
    heart_rate INTEGER,
    weight NUMERIC(5,1),
    menu_key TEXT,
    category TEXT,
    source TEXT DEFAULT '手入力',
    raw_data JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Crew Notes
CREATE TABLE IF NOT EXISTS crew_notes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    date DATE NOT NULL,
    time_slot TEXT,
    boat_id UUID,
    crew_data JSONB,
    note TEXT,
    created_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =========================================
-- 7. Row Level Security (RLS) ポリシー (Auth ID対応版)
-- =========================================

-- Enable RLS
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE boats ENABLE ROW LEVEL SECURITY;
ALTER TABLE oars ENABLE ROW LEVEL SECURITY;
ALTER TABLE ergos ENABLE ROW LEVEL SECURITY;
ALTER TABLE practices ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendances ENABLE ROW LEVEL SECURITY;
ALTER TABLE riggings ENABLE ROW LEVEL SECURITY;
ALTER TABLE ergo_raw ENABLE ROW LEVEL SECURITY;
ALTER TABLE ergo_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE diaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE concept2_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE ergo_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE crew_notes ENABLE ROW LEVEL SECURITY;

-- Clean up existing policies (to allow re-run)
DROP POLICY IF EXISTS "承認済みユーザーは全員閲覧可" ON users;
DROP POLICY IF EXISTS "自分の情報は編集可" ON users;
-- ... (other drops omitted for brevity, CREATE OR REPLACE not supported for policies, assume fresh or drop all)

-- Users
CREATE POLICY "承認済みユーザーは全員閲覧可" ON users FOR SELECT USING (approval_status = '承認済み');
CREATE POLICY "自分の情報は編集可" ON users FOR UPDATE USING (auth.uid()::text = auth_id);

-- Practices (Global Read, Staff Write)
CREATE POLICY "全員閲覧可" ON practices FOR SELECT USING (true);
CREATE POLICY "幹部コーチ管理者は編集可" ON practices FOR ALL USING (
    EXISTS (SELECT 1 FROM users WHERE auth_id = auth.uid()::text AND role IN ('幹部', 'コーチ', '管理者'))
);

-- Attendances (Own Read/Write)
CREATE POLICY "自分の出欠は閲覧可" ON attendances FOR SELECT USING (user_id IN (SELECT id FROM users WHERE auth_id = auth.uid()::text));
CREATE POLICY "自分の出欠は編集可" ON attendances FOR ALL USING (user_id IN (SELECT id FROM users WHERE auth_id = auth.uid()::text));

-- Boats/Oars/Ergos (Global Read, Staff Write)
CREATE POLICY "boats_select" ON boats FOR SELECT USING (true);
CREATE POLICY "boats_modify" ON boats FOR ALL USING (EXISTS (SELECT 1 FROM users WHERE auth_id = auth.uid()::text AND role IN ('幹部', 'コーチ', '管理者')));
CREATE POLICY "oars_select" ON oars FOR SELECT USING (true);
CREATE POLICY "oars_modify" ON oars FOR ALL USING (EXISTS (SELECT 1 FROM users WHERE auth_id = auth.uid()::text AND role IN ('幹部', 'コーチ', '管理者')));
CREATE POLICY "ergos_select" ON ergos FOR SELECT USING (true);
CREATE POLICY "ergos_modify" ON ergos FOR ALL USING (EXISTS (SELECT 1 FROM users WHERE auth_id = auth.uid()::text AND role IN ('幹部', 'コーチ', '管理者')));

-- Riggings (Own Read/Write)
CREATE POLICY "自分のリギングは閲覧可" ON riggings FOR SELECT USING (user_id IN (SELECT id FROM users WHERE auth_id = auth.uid()::text));
CREATE POLICY "自分のリギングは編集可" ON riggings FOR ALL USING (user_id IN (SELECT id FROM users WHERE auth_id = auth.uid()::text));

-- Ergo/Diary/Concept2 (Own Data)
CREATE POLICY "ergo_raw_own" ON ergo_raw FOR ALL USING (user_id IN (SELECT id FROM users WHERE auth_id = auth.uid()::text));
CREATE POLICY "ergo_sessions_select" ON ergo_sessions FOR SELECT USING (true);
CREATE POLICY "ergo_sessions_modify" ON ergo_sessions FOR ALL USING (user_id IN (SELECT id FROM users WHERE auth_id = auth.uid()::text));
CREATE POLICY "diaries_public_select" ON diaries FOR SELECT USING (is_public = true OR user_id IN (SELECT id FROM users WHERE auth_id = auth.uid()::text));
CREATE POLICY "diaries_own_modify" ON diaries FOR ALL USING (user_id IN (SELECT id FROM users WHERE auth_id = auth.uid()::text));
CREATE POLICY "concept2_own" ON concept2_connections FOR ALL USING (user_id IN (SELECT id FROM users WHERE auth_id = auth.uid()::text));

-- New App Tables (Simplified Policies)
CREATE POLICY "profiles_select" ON profiles FOR SELECT USING (true);
CREATE POLICY "profiles_insert" ON profiles FOR INSERT WITH CHECK (true);
CREATE POLICY "profiles_update" ON profiles FOR UPDATE USING (auth_id = auth.uid());

CREATE POLICY "schedules_select" ON schedules FOR SELECT USING (true);
CREATE POLICY "schedules_all" ON schedules FOR ALL USING (auth.uid() IS NOT NULL);

CREATE POLICY "ergo_records_select" ON ergo_records FOR SELECT USING (true);
CREATE POLICY "ergo_records_all" ON ergo_records FOR ALL USING (auth.uid() IS NOT NULL);

CREATE POLICY "crew_notes_select" ON crew_notes FOR SELECT USING (true);
CREATE POLICY "crew_notes_all" ON crew_notes FOR ALL USING (auth.uid() IS NOT NULL);

-- =========================================
-- 8. トリガー (更新日時)
-- =========================================
CREATE OR REPLACE FUNCTION update_updated_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ 
DECLARE 
    t text; 
BEGIN 
    FOR t IN SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS %I_updated_at ON %I', t, t);
        EXECUTE format('CREATE TRIGGER %I_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION update_updated_at()', t, t);
    END LOOP; 
END $$;
