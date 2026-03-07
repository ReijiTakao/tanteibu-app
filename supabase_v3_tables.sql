-- =========================================
-- 端艇部管理アプリ 追加テーブル v3
-- =========================================
-- 既存のスキーマに不足しているテーブルを追加します。
-- Supabase SQLエディタで実行してください。

-- 拡張機能（既に有効な場合でもエラーにならない）
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =========================================
-- 1. 全体スケジュール告知
-- =========================================
CREATE TABLE IF NOT EXISTS team_schedules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    date DATE NOT NULL,
    time_slot TEXT DEFAULT '',
    content TEXT DEFAULT '',
    created_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE team_schedules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "team_schedules_all" ON team_schedules;
CREATE POLICY "team_schedules_all" ON team_schedules FOR ALL USING (auth.uid() IS NOT NULL);

-- =========================================
-- 2. 配艇表
-- =========================================
CREATE TABLE IF NOT EXISTS boat_allocations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    boat_id UUID,
    boat_type TEXT,
    crew_ids JSONB DEFAULT '[]',
    crew_details_map JSONB DEFAULT '{}',
    oar_ids JSONB DEFAULT '[]',
    created_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE boat_allocations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "boat_allocations_all" ON boat_allocations;
CREATE POLICY "boat_allocations_all" ON boat_allocations FOR ALL USING (auth.uid() IS NOT NULL);

-- =========================================
-- 3. 週間メニュー
-- =========================================
CREATE TABLE IF NOT EXISTS weekly_menus (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    week_start DATE NOT NULL,
    slots JSONB DEFAULT '{}',
    notes TEXT DEFAULT '',
    updated_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE weekly_menus ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "weekly_menus_all" ON weekly_menus;
CREATE POLICY "weekly_menus_all" ON weekly_menus FOR ALL USING (auth.uid() IS NOT NULL);

-- =========================================
-- 4. 体重履歴
-- =========================================
CREATE TABLE IF NOT EXISTS weight_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID,
    weight NUMERIC(5, 1) NOT NULL,
    date DATE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE weight_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "weight_history_all" ON weight_history;
CREATE POLICY "weight_history_all" ON weight_history FOR ALL USING (auth.uid() IS NOT NULL);

-- =========================================
-- 5. アプリ設定
-- =========================================
CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "app_settings_all" ON app_settings;
CREATE POLICY "app_settings_all" ON app_settings FOR ALL USING (auth.uid() IS NOT NULL);

-- =========================================
-- 6. リギング履歴
-- =========================================
CREATE TABLE IF NOT EXISTS rigging_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    boat_id TEXT,
    user_id UUID,
    pin_to_heel TEXT DEFAULT '',
    depth TEXT DEFAULT '',
    span TEXT DEFAULT '',
    pitch TEXT DEFAULT '',
    height TEXT DEFAULT '',
    memo TEXT DEFAULT '',
    saved_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE rigging_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "rigging_history_all" ON rigging_history;
CREATE POLICY "rigging_history_all" ON rigging_history FOR ALL USING (auth.uid() IS NOT NULL);

-- =========================================
-- 7. 年間イベント
-- =========================================
CREATE TABLE IF NOT EXISTS annual_events (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    date DATE NOT NULL,
    end_date DATE,
    start_time TEXT,
    end_time TEXT,
    category TEXT DEFAULT '',
    memo TEXT DEFAULT '',
    created_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE annual_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "annual_events_all" ON annual_events;
CREATE POLICY "annual_events_all" ON annual_events FOR ALL USING (auth.uid() IS NOT NULL);

-- =========================================
-- 既存テーブルに不足カラムを追加（安全）
-- =========================================

-- ergo_records に不足カラムを追加（存在しない場合のみ）
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ergo_records' AND column_name = 'concept2_id') THEN
        ALTER TABLE ergo_records ADD COLUMN concept2_id TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ergo_records' AND column_name = 'raw_id') THEN
        ALTER TABLE ergo_records ADD COLUMN raw_id TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ergo_records' AND column_name = 'ergo_type') THEN
        ALTER TABLE ergo_records ADD COLUMN ergo_type TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ergo_records' AND column_name = 'watts') THEN
        ALTER TABLE ergo_records ADD COLUMN watts INTEGER;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ergo_records' AND column_name = 'calories') THEN
        ALTER TABLE ergo_records ADD COLUMN calories INTEGER;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ergo_records' AND column_name = 'drag_factor') THEN
        ALTER TABLE ergo_records ADD COLUMN drag_factor INTEGER;
    END IF;

    -- profiles テーブルに不足カラムを追加
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'side') THEN
        ALTER TABLE profiles ADD COLUMN side TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'weight') THEN
        ALTER TABLE profiles ADD COLUMN weight NUMERIC(5,1);
    END IF;

    -- schedules テーブルにflag_countカラムを追加（使用中なら）
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'schedules' AND column_name = 'flag_count') THEN
        ALTER TABLE schedules ADD COLUMN flag_count INTEGER DEFAULT 0;
    END IF;

    -- boats テーブルにgenderカラムを追加
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'boats' AND column_name = 'gender') THEN
        ALTER TABLE boats ADD COLUMN gender TEXT DEFAULT 'all';
    END IF;
END $$;

-- 完了メッセージ
SELECT 'v3テーブル追加完了 ✅' AS status;
