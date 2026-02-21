-- =========================================
-- 008: practice_notes に runDistance, weightBodyPart カラム追加
-- =========================================

ALTER TABLE practice_notes ADD COLUMN IF NOT EXISTS "runDistance" NUMERIC(6,1);
ALTER TABLE practice_notes ADD COLUMN IF NOT EXISTS "weightBodyPart" TEXT;
