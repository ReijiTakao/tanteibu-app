-- =========================================
-- 15. riggingsテーブルのRLSポリシー修正
-- email認証方式に対応（google_id → auth_id）
-- =========================================

-- 旧ポリシーを削除（google_id参照で動作しない）
DROP POLICY IF EXISTS "自分のリギングは閲覧可" ON riggings;
DROP POLICY IF EXISTS "自分のリギングは編集可" ON riggings;

-- 全ユーザーアクセス可能に変更（rigging_historyと同様のチーム共有データ）
CREATE POLICY "riggings_select" ON riggings
    FOR SELECT USING (true);

CREATE POLICY "riggings_insert" ON riggings
    FOR INSERT WITH CHECK (true);

CREATE POLICY "riggings_update" ON riggings
    FOR UPDATE USING (true);

CREATE POLICY "riggings_delete" ON riggings
    FOR DELETE USING (true);
