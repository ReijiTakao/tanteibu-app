-- practice_notesテーブルに乗艇メニュー詳細を保存するカラムを追加
ALTER TABLE practice_notes ADD COLUMN IF NOT EXISTS "rowingMenus" jsonb DEFAULT NULL;
ALTER TABLE practice_notes ADD COLUMN IF NOT EXISTS "rowingMenusSharedFrom" text DEFAULT NULL;

-- コメント
COMMENT ON COLUMN practice_notes."rowingMenus" IS '乗艇メニュー詳細 [{mode, rate, distance, avgTime, onDist, offDist}]';
COMMENT ON COLUMN practice_notes."rowingMenusSharedFrom" IS 'メニュー共有元のuserId';
