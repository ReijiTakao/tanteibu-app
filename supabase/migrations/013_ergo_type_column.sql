-- ergo_records テーブルにエルゴ種別カラムを追加
ALTER TABLE ergo_records ADD COLUMN IF NOT EXISTS ergo_type TEXT;

COMMENT ON COLUMN ergo_records.ergo_type IS 'エルゴ種別（ダイナミック/固定）';
