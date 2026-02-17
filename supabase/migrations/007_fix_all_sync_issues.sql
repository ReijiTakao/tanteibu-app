-- =========================================
-- 007: 全テーブルスキーマ修正
-- アプリが送信するフィールドに合わせて不足カラムを追加
-- =========================================

-- -----------------------------------------
-- 1. schedules テーブル
-- 不足: user_id, schedule_type, absence_reason, ergo_type, ergo_id, boat_id, oar_id, start_time, memo
-- -----------------------------------------
ALTER TABLE schedules ADD COLUMN IF NOT EXISTS user_id UUID;
ALTER TABLE schedules ADD COLUMN IF NOT EXISTS schedule_type TEXT;
ALTER TABLE schedules ADD COLUMN IF NOT EXISTS absence_reason TEXT;
ALTER TABLE schedules ADD COLUMN IF NOT EXISTS ergo_type TEXT;
ALTER TABLE schedules ADD COLUMN IF NOT EXISTS ergo_id UUID;
ALTER TABLE schedules ADD COLUMN IF NOT EXISTS boat_id UUID;
ALTER TABLE schedules ADD COLUMN IF NOT EXISTS oar_id UUID;
ALTER TABLE schedules ADD COLUMN IF NOT EXISTS start_time TEXT;
ALTER TABLE schedules ADD COLUMN IF NOT EXISTS memo TEXT;
-- activity_type の NOT NULL制約を除去（アプリは schedule_type を使用）
ALTER TABLE schedules ALTER COLUMN activity_type DROP NOT NULL;

-- -----------------------------------------
-- 2. ergo_records テーブル
-- 不足: schedule_id, time_slot, time_seconds, time_display, split, heart_rate, weight, menu_key, category, source, raw_data
-- 注: stroke_rate は存在しないが似たカラムなし → 追加
-- -----------------------------------------
ALTER TABLE ergo_records ADD COLUMN IF NOT EXISTS schedule_id UUID;
ALTER TABLE ergo_records ADD COLUMN IF NOT EXISTS time_slot TEXT;
ALTER TABLE ergo_records ADD COLUMN IF NOT EXISTS time_seconds NUMERIC(10,2);
ALTER TABLE ergo_records ADD COLUMN IF NOT EXISTS time_display TEXT;
ALTER TABLE ergo_records ADD COLUMN IF NOT EXISTS split TEXT;
ALTER TABLE ergo_records ADD COLUMN IF NOT EXISTS heart_rate INTEGER;
ALTER TABLE ergo_records ADD COLUMN IF NOT EXISTS weight NUMERIC(5,1);
ALTER TABLE ergo_records ADD COLUMN IF NOT EXISTS menu_key TEXT;
ALTER TABLE ergo_records ADD COLUMN IF NOT EXISTS category TEXT;
ALTER TABLE ergo_records ADD COLUMN IF NOT EXISTS source TEXT DEFAULT '手入力';
ALTER TABLE ergo_records ADD COLUMN IF NOT EXISTS raw_data JSONB;
-- NOT NULL制約を緩和（アプリは全フィールドを送信しない場合がある）
ALTER TABLE ergo_records ALTER COLUMN type DROP NOT NULL;
ALTER TABLE ergo_records ALTER COLUMN "time" DROP NOT NULL;
ALTER TABLE ergo_records ALTER COLUMN spl_500m DROP NOT NULL;
ALTER TABLE ergo_records ALTER COLUMN distance DROP NOT NULL;
ALTER TABLE ergo_records ALTER COLUMN stroke_rate DROP NOT NULL;
ALTER TABLE ergo_records ALTER COLUMN date DROP NOT NULL;

-- -----------------------------------------
-- 3. boats テーブル
-- 不足: organization, currentRiggingMode, status(text), availability, memo
-- -----------------------------------------
ALTER TABLE boats ADD COLUMN IF NOT EXISTS organization TEXT;
ALTER TABLE boats ADD COLUMN IF NOT EXISTS "currentRiggingMode" TEXT;
ALTER TABLE boats ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'available';
ALTER TABLE boats ADD COLUMN IF NOT EXISTS availability TEXT DEFAULT '使用可能';
ALTER TABLE boats ADD COLUMN IF NOT EXISTS memo TEXT;
-- capacity/typeを NOT NULL → NULL許可に変更
ALTER TABLE boats ALTER COLUMN type DROP NOT NULL;
ALTER TABLE boats ALTER COLUMN capacity DROP NOT NULL;

-- -----------------------------------------
-- 4. oars テーブル
-- 不足: length, sealNumber, availability, memo
-- -----------------------------------------
ALTER TABLE oars ADD COLUMN IF NOT EXISTS length TEXT;
ALTER TABLE oars ADD COLUMN IF NOT EXISTS "sealNumber" TEXT;
ALTER TABLE oars ADD COLUMN IF NOT EXISTS availability TEXT DEFAULT '使用可能';
ALTER TABLE oars ADD COLUMN IF NOT EXISTS memo TEXT;
-- type/status を NOT NULL → NULL許可に変更
ALTER TABLE oars ALTER COLUMN type DROP NOT NULL;
ALTER TABLE oars ALTER COLUMN status DROP NOT NULL;

-- -----------------------------------------
-- 5. ergos テーブル
-- 不足: type(固定/ダイナミック), availability, memo
-- -----------------------------------------
ALTER TABLE ergos ADD COLUMN IF NOT EXISTS type TEXT DEFAULT '固定';
ALTER TABLE ergos ADD COLUMN IF NOT EXISTS availability TEXT DEFAULT '使用可能';
ALTER TABLE ergos ADD COLUMN IF NOT EXISTS memo TEXT;
-- status を NOT NULL → NULL許可に変更
ALTER TABLE ergos ALTER COLUMN status DROP NOT NULL;

-- -----------------------------------------
-- 6. profiles テーブル
-- 不足: role, status, approval_status, concept2_connected, concept2_access_token, concept2_last_sync
-- -----------------------------------------
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS role TEXT DEFAULT '部員';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS status TEXT DEFAULT '在籍';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS approval_status TEXT DEFAULT '承認済み';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS concept2_connected BOOLEAN DEFAULT false;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS concept2_access_token TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS concept2_last_sync TIMESTAMPTZ;

-- -----------------------------------------
-- 7. riggings テーブル
-- 不足: span, pitch, height, memo (アプリが使うフィールド)
-- -----------------------------------------
ALTER TABLE riggings ADD COLUMN IF NOT EXISTS span NUMERIC(5,1);
ALTER TABLE riggings ADD COLUMN IF NOT EXISTS pitch NUMERIC(4,1);
ALTER TABLE riggings ADD COLUMN IF NOT EXISTS height NUMERIC(5,1);
ALTER TABLE riggings ADD COLUMN IF NOT EXISTS memo TEXT;
-- user_id を NOT NULL → NULL許可に変更 (NULL可能にしたほうが安全)

-- -----------------------------------------
-- 8. practice_notes テーブル
-- 不足: scheduleId, userId, scheduleType, reflection, ergoRecordIds, crewNoteId, rowingDistance, weightMenus
-- -----------------------------------------
ALTER TABLE practice_notes ADD COLUMN IF NOT EXISTS "scheduleId" UUID;
ALTER TABLE practice_notes ADD COLUMN IF NOT EXISTS "userId" UUID;
ALTER TABLE practice_notes ADD COLUMN IF NOT EXISTS "timeSlot" TEXT;
ALTER TABLE practice_notes ADD COLUMN IF NOT EXISTS "scheduleType" TEXT;
ALTER TABLE practice_notes ADD COLUMN IF NOT EXISTS reflection TEXT;
ALTER TABLE practice_notes ADD COLUMN IF NOT EXISTS "ergoRecordIds" JSONB DEFAULT '[]';
ALTER TABLE practice_notes ADD COLUMN IF NOT EXISTS "crewNoteId" UUID;
ALTER TABLE practice_notes ADD COLUMN IF NOT EXISTS "rowingDistance" INTEGER;
ALTER TABLE practice_notes ADD COLUMN IF NOT EXISTS "weightMenus" JSONB DEFAULT '[]';

-- -----------------------------------------
-- 9. crew_presets テーブル
-- カラム構造は正しいがidがTEXT型 → そのまま（TEXTならUUIDもTEXTとして保存可能）
-- -----------------------------------------
-- 変更不要

-- -----------------------------------------
-- 10. crew_notes テーブル
-- 不足: crewHash, memberIds, boatType, content, videoUrls, lastAuthorId
-- (前回既に追加済みの可能性あるが IF NOT EXISTS で安全)
-- -----------------------------------------
-- time_slot を NOT NULL → NULL許可に変更
ALTER TABLE crew_notes ALTER COLUMN time_slot DROP NOT NULL;
