-- =========================================
-- 5. 認証方式変更 (Google OAuth -> Email/Password)
-- =========================================

-- usersテーブルのカラム変更
ALTER TABLE users RENAME COLUMN google_id TO auth_id;

-- インデックスの再作成（名前変更に伴い）
DROP INDEX IF EXISTS idx_users_google_id;
CREATE INDEX idx_users_auth_id ON users(auth_id);

-- RLSポリシーの更新
-- usersテーブル
DROP POLICY IF EXISTS "自分の情報は編集可" ON users;
CREATE POLICY "自分の情報は編集可" ON users
    FOR UPDATE USING (auth.uid()::text = auth_id);

-- attendancesテーブル
DROP POLICY IF EXISTS "自分の出欠は閲覧可" ON attendances;
CREATE POLICY "自分の出欠は閲覧可" ON attendances
    FOR SELECT USING (user_id IN (SELECT id FROM users WHERE auth_id = auth.uid()::text));

DROP POLICY IF EXISTS "自分の出欠は編集可" ON attendances;
CREATE POLICY "自分の出欠は編集可" ON attendances
    FOR ALL USING (user_id IN (SELECT id FROM users WHERE auth_id = auth.uid()::text));

-- practicesテーブル (管理者・幹部・コーチ判定)
DROP POLICY IF EXISTS "幹部コーチ管理者は編集可" ON practices;
CREATE POLICY "幹部コーチ管理者は編集可" ON practices
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM users 
            WHERE auth_id = auth.uid()::text 
            AND role IN ('幹部', 'コーチ', '管理者')
        )
    );

-- boatsテーブル
DROP POLICY IF EXISTS "幹部以上編集可" ON boats;
CREATE POLICY "幹部以上編集可" ON boats FOR ALL USING (
    EXISTS (SELECT 1 FROM users WHERE auth_id = auth.uid()::text AND role IN ('幹部', 'コーチ', '管理者'))
);

-- oarsテーブル
DROP POLICY IF EXISTS "幹部以上編集可" ON oars;
CREATE POLICY "幹部以上編集可" ON oars FOR ALL USING (
    EXISTS (SELECT 1 FROM users WHERE auth_id = auth.uid()::text AND role IN ('幹部', 'コーチ', '管理者'))
);
