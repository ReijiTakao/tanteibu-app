-- =========================================
-- 端艇部管理アプリ 統合セットアップスクリプト (修正版)
-- =========================================

-- 拡張機能
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =========================================
-- 0. 事前チェック＆修正 (ここが重要！)
-- =========================================
DO $$
BEGIN
    -- usersテーブルがあり、google_idカラムがある場合はリネーム
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'google_id') THEN
        ALTER TABLE users RENAME COLUMN google_id TO auth_id;
    END IF;
    
    -- usersテーブルがあり、auth_idカラムが無い場合は追加 (念のため)
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'users') AND 
       NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'auth_id') THEN
        ALTER TABLE users ADD COLUMN auth_id TEXT UNIQUE;
    END IF;
END $$;

-- =========================================
-- 1. ユーザーテーブル (統合版)
-- =========================================
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    grade INTEGER,
    role TEXT NOT NULL DEFAULT '部員' CHECK (role IN ('部員', '幹部', 'コーチ', 'Cox', '管理者')),
    status TEXT NOT NULL DEFAULT '在籍' CHECK (status IN ('在籍', '非在籍')),
    auth_id TEXT UNIQUE,
    approval_status TEXT NOT NULL DEFAULT '承認済み' CHECK (approval_status IN ('承認済み', '未承認')),
    concept2_access_token TEXT,
    concept2_refresh_token TEXT,
    concept2_token_expires_at TIMESTAMP WITH TIME ZONE,
    concept2_connected BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. マスタテーブル
CREATE TABLE IF NOT EXISTS boats (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    type TEXT,
    organization TEXT,
    status TEXT DEFAULT 'available',
    "currentRiggingMode" TEXT,
    availability TEXT NOT NULL DEFAULT '使用可能' CHECK (availability IN ('使用可能', '使用不可')),
    memo TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS oars (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    type TEXT,
    length TEXT,
    "sealNumber" TEXT,
    status TEXT DEFAULT 'available',
    availability TEXT NOT NULL DEFAULT '使用可能' CHECK (availability IN ('使用可能', '使用不可')),
    memo TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ergos (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT '固定' CHECK (type IN ('ダイナミック', '固定')),
    "sealNumber" TEXT,
    status TEXT DEFAULT 'available',
    availability TEXT NOT NULL DEFAULT '使用可能' CHECK (availability IN ('使用可能', '使用不可')),
    memo TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. 練習・出欠
CREATE TABLE IF NOT EXISTS practices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    date DATE NOT NULL,
    time_slot TEXT NOT NULL CHECK (time_slot IN ('午前', '午後')),
    practice_type TEXT CHECK (practice_type IS NULL OR practice_type IN ('エルゴ', 'ウェイト', '乗艇')),
    start_time TIME,
    memo TEXT,
    created_by UUID REFERENCES users(id),
    updated_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(date, time_slot)
);

CREATE TABLE IF NOT EXISTS attendances (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    practice_id UUID NOT NULL REFERENCES practices(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    attendance_status TEXT NOT NULL CHECK (attendance_status IN ('参加', '不参加', '保留')),
    boathouse_status TEXT NOT NULL CHECK (boathouse_status IN ('艇庫にいる', '艇庫にいない')),
    can_participate TEXT,
    reason TEXT CHECK (reason IS NULL OR reason IN ('怪我', '体調不良', '就活', '学校', 'その他', '就活・用事')),
    memo TEXT,
    reflection TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(practice_id, user_id)
);

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

-- 4. エルゴ記録・アプリ機能
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
    menu_key TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

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

-- 5. RLSポリシー (簡易版)
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE practices ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendances ENABLE ROW LEVEL SECURITY;
ALTER TABLE boats ENABLE ROW LEVEL SECURITY;
ALTER TABLE oars ENABLE ROW LEVEL SECURITY;
ALTER TABLE ergos ENABLE ROW LEVEL SECURITY;
ALTER TABLE riggings ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE ergo_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE crew_notes ENABLE ROW LEVEL SECURITY;

-- 既存ポリシー削除
DROP POLICY IF EXISTS "承認済みユーザーは全員閲覧可" ON users;
DROP POLICY IF EXISTS "自分の情報は編集可" ON users;
DROP POLICY IF EXISTS "全員閲覧可" ON practices;
DROP POLICY IF EXISTS "幹部コーチ管理者は編集可" ON practices;
DROP POLICY IF EXISTS "自分の出欠は閲覧可" ON attendances;
DROP POLICY IF EXISTS "自分の出欠は編集可" ON attendances;
DROP POLICY IF EXISTS "profiles_select" ON profiles;
DROP POLICY IF EXISTS "profiles_insert" ON profiles;
DROP POLICY IF EXISTS "profiles_update" ON profiles;

-- 新規ポリシー適用
CREATE POLICY "users_select" ON users FOR SELECT USING (true);
CREATE POLICY "users_update" ON users FOR UPDATE USING (auth.uid()::text = auth_id);

CREATE POLICY "practices_select" ON practices FOR SELECT USING (true);
CREATE POLICY "practices_edit" ON practices FOR ALL USING (EXISTS (SELECT 1 FROM users WHERE auth_id = auth.uid()::text AND role IN ('幹部', 'コーチ', '管理者')));

CREATE POLICY "attendances_select" ON attendances FOR SELECT USING (true);
CREATE POLICY "attendances_edit" ON attendances FOR ALL USING (user_id IN (SELECT id FROM users WHERE auth_id = auth.uid()::text));

CREATE POLICY "profiles_select" ON profiles FOR SELECT USING (true);
CREATE POLICY "profiles_insert" ON profiles FOR INSERT WITH CHECK (true);
CREATE POLICY "profiles_update" ON profiles FOR UPDATE USING (auth_id = auth.uid());

CREATE POLICY "public_read_all" ON boats FOR SELECT USING (true);
CREATE POLICY "public_read_all_oars" ON oars FOR SELECT USING (true);
CREATE POLICY "public_read_all_ergos" ON ergos FOR SELECT USING (true);
CREATE POLICY "staff_edit_boats" ON boats FOR ALL USING (EXISTS (SELECT 1 FROM users WHERE auth_id = auth.uid()::text AND role IN ('幹部', 'コーチ', '管理者')));

-- アプリ用テーブルは全権限付与 (MVP)
CREATE POLICY "schedules_all" ON schedules FOR ALL USING (auth.uid() IS NOT NULL);
CREATE POLICY "ergo_records_all" ON ergo_records FOR ALL USING (auth.uid() IS NOT NULL);
CREATE POLICY "crew_notes_all" ON crew_notes FOR ALL USING (auth.uid() IS NOT NULL);
CREATE POLICY "riggings_all" ON riggings FOR ALL USING (auth.uid() IS NOT NULL);

-- =========================================
-- 練習ノート
-- =========================================
CREATE TABLE IF NOT EXISTS practice_notes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    "scheduleId" UUID,
    "userId" UUID,
    date TEXT,
    "timeSlot" TEXT,
    "scheduleType" TEXT,
    reflection TEXT,
    "ergoRecordIds" JSONB DEFAULT '[]',
    "crewNoteId" UUID,
    "rowingDistance" INTEGER,
    "weightMenus" JSONB DEFAULT '[]',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE practice_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "practice_notes_all" ON practice_notes FOR ALL USING (auth.uid() IS NOT NULL);

-- =========================================
-- 監査ログ
-- =========================================
CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    "userId" UUID,
    "targetType" TEXT,
    "targetId" TEXT,
    operation TEXT,
    changes JSONB,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "audit_logs_all" ON audit_logs FOR ALL USING (auth.uid() IS NOT NULL);

-- =========================================
-- クループリセット
-- =========================================
CREATE TABLE IF NOT EXISTS crew_presets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    "boatType" TEXT,
    members JSONB DEFAULT '[]',
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE crew_presets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "crew_presets_all" ON crew_presets FOR ALL USING (auth.uid() IS NOT NULL);
