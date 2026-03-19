-- Migration 017: Add location, allocation status, parent allocation
-- スケジュールに練習場所カラム追加
ALTER TABLE schedules ADD COLUMN IF NOT EXISTS location TEXT DEFAULT NULL;

-- 配艇にステータスと親クルー紐付けカラム追加
ALTER TABLE boat_allocations ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active';
ALTER TABLE boat_allocations ADD COLUMN IF NOT EXISTS parent_allocation_id UUID DEFAULT NULL;

-- クルーに名前カラム追加（ローカルのみで使用していたが同期のため追加）
-- crews テーブルが存在しない場合はスキップ
-- ※ crewsデータはlocalStorageのみで管理中のためSQLは不要
