-- =========================================
-- 006: スキーマ修正 — アプリとの不整合解消
-- =========================================

-- schedulesテーブルに不足カラムを追加
ALTER TABLE schedules ADD COLUMN IF NOT EXISTS "absenceDetail" TEXT;
ALTER TABLE schedules ADD COLUMN IF NOT EXISTS "boatType" TEXT;
ALTER TABLE schedules ADD COLUMN IF NOT EXISTS "mealTypes" JSONB DEFAULT '[]';
ALTER TABLE schedules ADD COLUMN IF NOT EXISTS "videoDuration" TEXT;
ALTER TABLE schedules ADD COLUMN IF NOT EXISTS "crewIds" JSONB DEFAULT '[]';
ALTER TABLE schedules ADD COLUMN IF NOT EXISTS "crewDetailsMap" JSONB DEFAULT '{}';

-- time_slotのCHECK制約を緩和（アプリから他の値が来る可能性に備える）
ALTER TABLE schedules DROP CONSTRAINT IF EXISTS schedules_time_slot_check;
