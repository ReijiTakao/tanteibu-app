-- 017: practice_notes テーブルに crewSnapshot, windSpeed カラムを追加
-- crewSnapshot: 練習ノート作成時のクルー情報スナップショット（配艇変更後も残る）
-- windSpeed: 風速記録

ALTER TABLE practice_notes ADD COLUMN IF NOT EXISTS "crewSnapshot" JSONB DEFAULT NULL;
ALTER TABLE practice_notes ADD COLUMN IF NOT EXISTS "windSpeed" NUMERIC(4,1) DEFAULT NULL;

COMMENT ON COLUMN practice_notes."crewSnapshot" IS 'クルー情報スナップショット {memberIds, memberNames, boatType, boatName, crewDetailsMap}';
COMMENT ON COLUMN practice_notes."windSpeed" IS '風速 (m/s)';
