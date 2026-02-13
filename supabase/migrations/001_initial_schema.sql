-- =========================================
-- 端艇部管理アプリ データベーススキーマ
-- Supabase (PostgreSQL) 用
-- =========================================

-- 拡張機能
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =========================================
-- 1. ユーザーテーブル
-- =========================================
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,                           -- 氏名（日本語）
    grade INTEGER,                                -- 学年
    role TEXT NOT NULL DEFAULT '部員'              -- 権限（部員/幹部/コーチ/Cox/管理者）
        CHECK (role IN ('部員', '幹部', 'コーチ', 'Cox', '管理者')),
    status TEXT NOT NULL DEFAULT '在籍'            -- 在籍状態
        CHECK (status IN ('在籍', '非在籍')),
    google_id TEXT UNIQUE,                        -- Googleアカウント識別子
    approval_status TEXT NOT NULL DEFAULT '未承認' -- 承認状態
        CHECK (approval_status IN ('承認済み', '未承認')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- インデックス
CREATE INDEX idx_users_google_id ON users(google_id);
CREATE INDEX idx_users_approval_status ON users(approval_status);

-- =========================================
-- 2. 監査ログテーブル
-- =========================================
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id),            -- 実行者ユーザーid
    target_type TEXT NOT NULL,                    -- 対象種別（出欠/練習回/クルー/艇/オール/ユーザー等）
    target_id UUID,                               -- 対象id
    operation TEXT NOT NULL                       -- 操作
        CHECK (operation IN ('作成', '更新', '削除')),
    changes JSONB,                                -- 変更差分（変更前/変更後）
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- インデックス
CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_target_type ON audit_logs(target_type);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at);

-- =========================================
-- 3. 艇マスタテーブル
-- =========================================
CREATE TABLE boats (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,                           -- 艇名（日本語）
    availability TEXT NOT NULL DEFAULT '使用可能'   -- 使用可否
        CHECK (availability IN ('使用可能', '使用不可')),
    memo TEXT,                                    -- メモ
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =========================================
-- 4. オールマスタテーブル
-- =========================================
CREATE TABLE oars (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,                           -- オール名（日本語）
    type TEXT,                                    -- 種別（スイープ/スカルなど）
    availability TEXT NOT NULL DEFAULT '使用可能'   -- 使用可否
        CHECK (availability IN ('使用可能', '使用不可')),
    memo TEXT,                                    -- メモ
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =========================================
-- 5. 練習回テーブル (Prompt 02 追加)
-- =========================================
CREATE TABLE practices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    date DATE NOT NULL,                           -- 日付
    time_slot TEXT NOT NULL                       -- 時間帯
        CHECK (time_slot IN ('午前', '午後')),
    practice_type TEXT                            -- 練習内容（エルゴ/ウェイト/乗艇）
        CHECK (practice_type IS NULL OR practice_type IN ('エルゴ', 'ウェイト', '乗艇')),
    start_time TIME,                              -- 開始予定時刻
    memo TEXT,                                    -- メモ
    created_by UUID REFERENCES users(id),         -- 作成者ユーザーid
    updated_by UUID REFERENCES users(id),         -- 更新者ユーザーid
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- 制約：日付×時間帯はユニーク
    UNIQUE(date, time_slot)
);

-- インデックス
CREATE INDEX idx_practices_date ON practices(date);

-- =========================================
-- 6. 出欠テーブル (Prompt 02 追加)
-- =========================================
CREATE TABLE attendances (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    practice_id UUID NOT NULL REFERENCES practices(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    attendance_status TEXT NOT NULL               -- 出欠状態
        CHECK (attendance_status IN ('参加', '不参加', '保留')),
    boathouse_status TEXT NOT NULL                -- 艇庫状態
        CHECK (boathouse_status IN ('艇庫にいる', '艇庫にいない')),
    can_participate TEXT,                         -- 参加可否（運用上必要なら）
    reason TEXT                                   -- 理由（不参加/保留のとき必須）
        CHECK (reason IS NULL OR reason IN ('怪我', '体調不良', '就活・用事', 'その他')),
    memo TEXT,                                    -- メモ
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- 制約：練習回id×ユーザーidはユニーク（1人1コマ1件）
    UNIQUE(practice_id, user_id)
);

-- インデックス
CREATE INDEX idx_attendances_practice_id ON attendances(practice_id);
CREATE INDEX idx_attendances_user_id ON attendances(user_id);

-- =========================================
-- Row Level Security (RLS) ポリシー
-- =========================================

-- RLS有効化
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE boats ENABLE ROW LEVEL SECURITY;
ALTER TABLE oars ENABLE ROW LEVEL SECURITY;
ALTER TABLE practices ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendances ENABLE ROW LEVEL SECURITY;

-- ユーザーテーブルポリシー
CREATE POLICY "承認済みユーザーは全員閲覧可" ON users
    FOR SELECT USING (approval_status = '承認済み');

CREATE POLICY "自分の情報は編集可" ON users
    FOR UPDATE USING (auth.uid()::text = google_id);

-- 出欠テーブルポリシー
CREATE POLICY "自分の出欠は閲覧可" ON attendances
    FOR SELECT USING (user_id IN (SELECT id FROM users WHERE google_id = auth.uid()::text));

CREATE POLICY "自分の出欠は編集可" ON attendances
    FOR ALL USING (user_id IN (SELECT id FROM users WHERE google_id = auth.uid()::text));

-- 練習回テーブルポリシー
CREATE POLICY "全員閲覧可" ON practices
    FOR SELECT USING (true);

CREATE POLICY "幹部コーチ管理者は編集可" ON practices
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM users 
            WHERE google_id = auth.uid()::text 
            AND role IN ('幹部', 'コーチ', '管理者')
        )
    );

-- 艇・オールは幹部以上が編集可
CREATE POLICY "全員閲覧可" ON boats FOR SELECT USING (true);
CREATE POLICY "幹部以上編集可" ON boats FOR ALL USING (
    EXISTS (SELECT 1 FROM users WHERE google_id = auth.uid()::text AND role IN ('幹部', 'コーチ', '管理者'))
);

CREATE POLICY "全員閲覧可" ON oars FOR SELECT USING (true);
CREATE POLICY "幹部以上編集可" ON oars FOR ALL USING (
    EXISTS (SELECT 1 FROM users WHERE google_id = auth.uid()::text AND role IN ('幹部', 'コーチ', '管理者'))
);

-- =========================================
-- 更新日時自動更新トリガー
-- =========================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER boats_updated_at BEFORE UPDATE ON boats
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER oars_updated_at BEFORE UPDATE ON oars
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER practices_updated_at BEFORE UPDATE ON practices
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER attendances_updated_at BEFORE UPDATE ON attendances
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
