-- =========================================
-- 9. 体重履歴テーブル & アプリ設定テーブル
-- =========================================

-- weight_history テーブル: ユーザーの体重記録を保存
CREATE TABLE IF NOT EXISTS weight_history (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    weight NUMERIC(5,1) NOT NULL,
    date DATE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_weight_history_user_date 
    ON weight_history(user_id, date);

ALTER TABLE weight_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "weight_history_all" ON weight_history 
    FOR ALL USING (true);

-- app_settings テーブル: 管理者パスコードなどのアプリ全体設定
CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "app_settings_all" ON app_settings 
    FOR ALL USING (true);
