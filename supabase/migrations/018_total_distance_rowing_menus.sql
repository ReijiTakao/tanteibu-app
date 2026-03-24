-- practice_notes テーブルに totalDistance カラムを追加
ALTER TABLE practice_notes ADD COLUMN IF NOT EXISTS "totalDistance" INTEGER DEFAULT NULL;

COMMENT ON COLUMN practice_notes."totalDistance" IS '練習の総距離（メートル）';

-- crew_notes テーブルに rowingMenus, totalDistance カラムを追加
ALTER TABLE crew_notes ADD COLUMN IF NOT EXISTS "rowingMenus" JSONB DEFAULT NULL;
ALTER TABLE crew_notes ADD COLUMN IF NOT EXISTS "totalDistance" INTEGER DEFAULT NULL;

COMMENT ON COLUMN crew_notes."rowingMenus" IS '乗艇メニュー詳細 [{mode, rate, distance, avgTime, setAvgTimes, intensity, sets, wind}]';
COMMENT ON COLUMN crew_notes."totalDistance" IS '練習の総距離（メートル）';
