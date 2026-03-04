-- =========================================
-- 16. ergo_recordsにワット/カロリー/ドラッグファクタカラムを追加
-- =========================================

ALTER TABLE ergo_records ADD COLUMN IF NOT EXISTS watts NUMERIC(6,1);
ALTER TABLE ergo_records ADD COLUMN IF NOT EXISTS calories NUMERIC(8,1);
ALTER TABLE ergo_records ADD COLUMN IF NOT EXISTS drag_factor NUMERIC(5,1);
