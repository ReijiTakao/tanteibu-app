-- =========================================
-- エルゴ記録の重複問題修正
-- concept2_id カラムを追加し、UNIQUE制約で重複を防止
-- 既存の重複データもクリーンアップ
-- =========================================

-- 1. concept2_id カラムを追加
ALTER TABLE ergo_records ADD COLUMN IF NOT EXISTS concept2_id TEXT;

-- 2. 既存データの concept2_id を raw_data から復元
UPDATE ergo_records
SET concept2_id = raw_data->>'concept2Id'
WHERE concept2_id IS NULL
  AND raw_data IS NOT NULL
  AND raw_data->>'concept2Id' IS NOT NULL;

-- 3. 重複レコードを削除（同じ concept2_id を持つレコードのうち最も古いものだけを残す）
DELETE FROM ergo_records
WHERE id IN (
    SELECT id FROM (
        SELECT id,
               ROW_NUMBER() OVER (
                   PARTITION BY concept2_id, user_id
                   ORDER BY created_at ASC
               ) as rn
        FROM ergo_records
        WHERE concept2_id IS NOT NULL
    ) sub
    WHERE rn > 1
);

-- 4. UNIQUE制約を追加（user_id + concept2_id の組み合わせ）
-- concept2_id が NULL のレコード（手入力など）は制約の対象外
CREATE UNIQUE INDEX IF NOT EXISTS idx_ergo_records_concept2_unique
    ON ergo_records(user_id, concept2_id)
    WHERE concept2_id IS NOT NULL;

-- 5. concept2_id 単体のインデックス（検索用）
CREATE INDEX IF NOT EXISTS idx_ergo_records_concept2_id
    ON ergo_records(concept2_id)
    WHERE concept2_id IS NOT NULL;
