-- ergo_records テーブルの修正
-- 1. ergo_type カラム追加
ALTER TABLE ergo_records ADD COLUMN IF NOT EXISTS ergo_type TEXT;
COMMENT ON COLUMN ergo_records.ergo_type IS 'エルゴ種別（ダイナミック/固定）';

-- 2. id カラムを UUID → TEXT に変更（Concept2のIDが c2_xxxxx 形式のため）
ALTER TABLE ergo_records ALTER COLUMN id TYPE TEXT USING id::TEXT;
ALTER TABLE ergo_records ALTER COLUMN id SET DEFAULT '';