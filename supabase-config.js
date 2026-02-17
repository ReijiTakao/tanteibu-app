/**
 * Supabase 設定・認証・データベース接続
 * 端艇部 総合管理アプリ
 */

// ========================================
// Supabase 設定
// ========================================
const SUPABASE_URL = 'https://zjhzysysclynlagidjmj.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpqaHp5c3lzY2x5bmxhZ2lkam1qIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAzMTIwNzIsImV4cCI6MjA4NTg4ODA3Mn0.FHU6z2ffdIhFvcyRU6DGpFV-p4xz6xW5jefxMyk5g4A';

// 内部変数（グローバル汚染を避ける）
let _supabaseClient = null;

/**
 * Supabaseクライアントを初期化
 */
function initSupabaseClient() {

    if (_supabaseClient) {
        return true;
    }

    if (typeof window.supabase !== 'undefined' && window.supabase.createClient) {
        _supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        window.supabaseClient = _supabaseClient;
        return true;
    } else if (typeof window.supabase_js !== 'undefined') {
        _supabaseClient = window.supabase_js.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        window.supabaseClient = _supabaseClient;
        return true;
    } else {
        console.error('❌ Supabase SDK not loaded. Checked window.supabase and window.supabase_js');
        return false;
    }
}

/**
 * Supabaseが利用可能かチェック
 */
function isSupabaseReady() {
    return _supabaseClient !== null && SUPABASE_ANON_KEY.length > 20;
}

// ========================================
// Google認証
// ========================================

/**
 * メールアドレスでサインアップ
 */
async function signUpWithEmail(email, password, userData) {
    if (!isSupabaseReady()) return { error: { message: 'Supabase not ready' } };

    const { data, error } = await _supabaseClient.auth.signUp({
        email: email,
        password: password,
        options: {
            data: userData // { full_name: '山田太郎' } など
        }
    });

    return { data, error };
}

/**
 * メールアドレスでログイン
 */
async function signInWithEmail(email, password) {
    if (!isSupabaseReady()) return { error: { message: 'Supabase not ready' } };

    const { data, error } = await _supabaseClient.auth.signInWithPassword({
        email: email,
        password: password
    });

    return { data, error };
}

/**
 * ログアウト
 */
async function signOutUser() {
    if (!isSupabaseReady()) return;

    const { error } = await _supabaseClient.auth.signOut();
    if (error) {
        console.error('Sign out error:', error);
        showToast('ログアウトに失敗しました', 'error');
    }
}

/**
 * 現在の認証セッションを取得
 */
async function getSession() {
    if (!isSupabaseReady()) return null;

    const { data: { session }, error } = await _supabaseClient.auth.getSession();
    if (error) {
        console.error('Get session error:', error);
        return null;
    }
    return session;
}

/**
 * 認証状態の変更を監視
 */
function onAuthStateChange(callback) {
    if (!isSupabaseReady()) return;

    _supabaseClient.auth.onAuthStateChange((event, session) => {
        callback(event, session);
    });
}

// ========================================
// プロフィール管理
// ========================================

/**
 * ユーザープロフィールを取得（なければ作成）
 */
async function getOrCreateProfile(session) {
    if (!session?.user) return null;

    const authUser = session.user;
    const email = authUser.email;
    const displayName = authUser.user_metadata?.full_name || authUser.user_metadata?.name || email;

    // まずプロフィールを検索
    const { data: existing, error: fetchError } = await _supabaseClient
        .from('profiles')
        .select('*')
        .eq('auth_id', authUser.id)
        .single();

    if (existing) {
        return existing;
    }

    // なければ新規作成
    const newProfile = {
        auth_id: authUser.id,
        email: email,
        name: displayName,
        role: '部員',
        grade: 1,
        gender: 'man',
        status: '在籍',
        approval_status: '承認済み' // 最初のリリースでは自動承認
    };

    const { data: created, error: insertError } = await _supabaseClient
        .from('profiles')
        .insert(newProfile)
        .select()
        .single();

    if (insertError) {
        console.error('Profile creation error:', insertError);
        return null;
    }

    return created;
}

// ========================================
// データベース操作（Supabase CRUD）
// ========================================

/**
 * Supabase操作に同期ステータスインジケーターを付与するラッパー
 * 複数の同時操作をカウンターで管理し、全完了後に最終結果を表示
 */
let _syncPending = 0;
let _syncHadError = false;
let _syncSuppressed = false; // 初期同期中はインジケーター非表示

function suppressSyncIndicator(flag) { _syncSuppressed = flag; }

async function withSyncIndicator(asyncFn) {
    if (_syncSuppressed) return asyncFn();

    _syncPending++;
    if (_syncPending === 1) {
        _syncHadError = false;
        if (typeof showSyncStatus === 'function') showSyncStatus('syncing');
    }
    try {
        const result = await asyncFn();
        return result;
    } catch (e) {
        _syncHadError = true;
        throw e;
    } finally {
        _syncPending--;
        if (_syncPending === 0) {
            if (typeof showSyncStatus === 'function') {
                showSyncStatus(_syncHadError ? 'error' : 'success');
            }
        }
    }
}

const SupabaseDB = {
    // --- スケジュール ---
    // camelCase(アプリ) → DB(snake_case + quoted)に変換
    _toScheduleRow(s) {
        return {
            id: s.id,
            user_id: s.userId,
            date: s.date,
            time_slot: s.timeSlot,
            schedule_type: s.scheduleType || null,
            absence_reason: s.absenceReason || null,
            "absenceDetail": s.absenceDetail || null,
            ergo_type: s.ergoType || null,
            ergo_id: s.ergoId || null,
            boat_id: s.boatId || null,
            oar_id: s.oarId || null,
            "boatType": s.boatType || null,
            "crewIds": s.crewIds || [],
            "crewDetailsMap": s.crewDetailsMap || {},
            "mealTypes": s.mealTypes || [],
            "videoDuration": s.videoDuration || null,
            start_time: s.startTime || null,
            memo: s.memo || null,
            updated_at: s.updatedAt || new Date().toISOString()
        };
    },
    // DB(snake_case + quoted) → camelCase(アプリ)に変換
    _fromScheduleRow(r) {
        return {
            id: r.id,
            userId: r.user_id,
            date: r.date,
            timeSlot: r.time_slot,
            scheduleType: r.schedule_type,
            absenceReason: r.absence_reason,
            absenceDetail: r.absenceDetail,
            ergoType: r.ergo_type,
            ergoId: r.ergo_id,
            boatId: r.boat_id,
            oarId: r.oar_id,
            boatType: r.boatType,
            crewIds: r.crewIds || [],
            crewDetailsMap: r.crewDetailsMap || {},
            mealTypes: r.mealTypes || [],
            videoDuration: r.videoDuration,
            startTime: r.start_time,
            memo: r.memo,
            updatedAt: r.updated_at,
            createdAt: r.created_at
        };
    },

    async loadSchedules(startDate, endDate) {
        if (!isSupabaseReady()) return [];

        const { data, error } = await _supabaseClient
            .from('schedules')
            .select('*')
            .gte('date', startDate)
            .lte('date', endDate);

        if (error) {
            console.error('Load schedules error:', error);
            return [];
        }
        return (data || []).map(r => SupabaseDB._fromScheduleRow(r));
    },

    async saveSchedule(schedule) {
        if (!isSupabaseReady()) return null;
        const row = this._toScheduleRow(schedule);
        return withSyncIndicator(async () => {
            const { data, error } = await _supabaseClient
                .from('schedules')
                .upsert(row, { onConflict: 'id' })
                .select()
                .single();
            if (error) { console.error('Save schedule error:', error); throw error; }
            return data;
        }).catch(() => null);
    },

    async deleteSchedule(id) {
        if (!isSupabaseReady()) return false;
        return withSyncIndicator(async () => {
            const { error } = await _supabaseClient
                .from('schedules')
                .delete()
                .eq('id', id);
            if (error) { console.error('Delete schedule error:', error); throw error; }
            return true;
        }).catch(() => false);
    },

    // --- エルゴ記録 ---
    _toErgoRow(r) {
        return {
            id: r.id,
            user_id: r.userId,
            schedule_id: r.scheduleId || null,
            date: r.date,
            time_slot: r.timeSlot || null,
            distance: r.distance || null,
            time_seconds: r.timeSeconds || null,
            time_display: r.timeDisplay || null,
            split: r.split || null,
            stroke_rate: r.strokeRate || null,
            heart_rate: r.heartRate || null,
            weight: r.weight || null,
            menu_key: r.menuKey || null,
            category: r.category || null,
            source: r.source || '手入力',
            raw_data: r.rawData || null
        };
    },
    _fromErgoRow(r) {
        return {
            id: r.id,
            userId: r.user_id,
            scheduleId: r.schedule_id,
            date: r.date,
            timeSlot: r.time_slot,
            distance: r.distance,
            timeSeconds: r.time_seconds,
            timeDisplay: r.time_display,
            split: r.split,
            strokeRate: r.stroke_rate,
            heartRate: r.heart_rate,
            weight: r.weight,
            menuKey: r.menu_key,
            category: r.category,
            source: r.source,
            rawData: r.raw_data,
            createdAt: r.created_at,
            updatedAt: r.updated_at
        };
    },

    async loadErgoRecords(userId) {
        if (!isSupabaseReady()) return [];

        let query = _supabaseClient
            .from('ergo_records')
            .select('*')
            .order('date', { ascending: false });

        if (userId) {
            query = query.eq('user_id', userId);
        }

        const { data, error } = await query;

        if (error) {
            console.error('Load ergo records error:', error);
            return [];
        }
        return (data || []).map(r => SupabaseDB._fromErgoRow(r));
    },

    async saveErgoRecord(record) {
        if (!isSupabaseReady()) return null;
        const row = this._toErgoRow(record);
        return withSyncIndicator(async () => {
            const { data, error } = await _supabaseClient
                .from('ergo_records')
                .upsert(row, { onConflict: 'id' })
                .select()
                .single();
            if (error) { console.error('Save ergo record error:', error); throw error; }
            return data;
        }).catch(() => null);
    },

    async deleteErgoRecord(id) {
        if (!isSupabaseReady()) return false;
        return withSyncIndicator(async () => {
            const { error } = await _supabaseClient
                .from('ergo_records')
                .delete()
                .eq('id', id);
            if (error) { console.error('Delete ergo record error:', error); throw error; }
            return true;
        }).catch(() => false);
    },

    async deleteErgoRecordsByScheduleId(scheduleId) {
        if (!isSupabaseReady()) return false;
        return withSyncIndicator(async () => {
            const { error } = await _supabaseClient
                .from('ergo_records')
                .delete()
                .eq('schedule_id', scheduleId);
            if (error) { console.error('Delete ergo records by schedule error:', error); throw error; }
            return true;
        }).catch(() => false);
    },

    // --- クルーノート ---
    _toCrewNoteRow(n) {
        return {
            id: n.id,
            date: n.date,
            time_slot: n.timeSlot || null,
            boat_id: n.boatId || null,
            crew_data: {
                crewHash: n.crewHash,
                memberIds: n.memberIds,
                boatType: n.boatType,
                videoUrls: n.videoUrls,
                lastAuthorId: n.lastAuthorId
            },
            note: n.content || n.note || null,
            created_by: n.lastAuthorId || n.createdBy || null,
            updated_at: n.updatedAt || new Date().toISOString()
        };
    },
    _fromCrewNoteRow(r) {
        const cd = r.crew_data || {};
        return {
            id: r.id,
            date: r.date,
            timeSlot: r.time_slot,
            boatId: r.boat_id,
            crewHash: cd.crewHash,
            memberIds: cd.memberIds || [],
            boatType: cd.boatType,
            content: r.note,
            videoUrls: cd.videoUrls || [],
            lastAuthorId: cd.lastAuthorId || r.created_by,
            createdAt: r.created_at,
            updatedAt: r.updated_at
        };
    },

    async loadCrewNotes(startDate, endDate) {
        if (!isSupabaseReady()) return [];

        let query = _supabaseClient
            .from('crew_notes')
            .select('*')
            .order('date', { ascending: false });

        if (startDate) query = query.gte('date', startDate);
        if (endDate) query = query.lte('date', endDate);

        const { data, error } = await query;

        if (error) {
            console.error('Load crew notes error:', error);
            return [];
        }
        return (data || []).map(r => SupabaseDB._fromCrewNoteRow(r));
    },

    async saveCrewNote(note) {
        if (!isSupabaseReady()) return null;
        const row = this._toCrewNoteRow(note);
        return withSyncIndicator(async () => {
            const { data, error } = await _supabaseClient
                .from('crew_notes')
                .upsert(row, { onConflict: 'id' })
                .select()
                .single();
            if (error) { console.error('Save crew note error:', error); throw error; }
            return data;
        }).catch(() => null);
    },

    async deleteCrewNote(id) {
        if (!isSupabaseReady()) return false;
        return withSyncIndicator(async () => {
            const { error } = await _supabaseClient
                .from('crew_notes')
                .delete()
                .eq('id', id);
            if (error) { console.error('Delete crew note error:', error); throw error; }
            return true;
        }).catch(() => false);
    },

    // --- プロフィール（ユーザー一覧） ---
    async loadProfiles() {
        if (!isSupabaseReady()) return [];

        const { data, error } = await _supabaseClient
            .from('profiles')
            .select('*')
            .eq('approval_status', '承認済み')
            .order('grade', { ascending: false });

        if (error) {
            console.error('Load profiles error:', error);
            return [];
        }
        return data || [];
    },

    async updateProfile(profileId, updates) {
        if (!isSupabaseReady()) return null;
        return withSyncIndicator(async () => {
            const { data, error } = await _supabaseClient
                .from('profiles')
                .update(updates)
                .eq('id', profileId)
                .select()
                .single();
            if (error) { console.error('Update profile error:', error); throw error; }
            return data;
        }).catch(() => null);
    },

    // --- マスタデータ ---
    async loadMasterData(table) {
        if (!isSupabaseReady()) return [];

        const { data, error } = await _supabaseClient
            .from(table)
            .select('*');

        if (error) {
            console.error(`Load ${table} error:`, error);
            return [];
        }
        return data || [];
    },

    async saveMasterItem(table, item) {
        if (!isSupabaseReady()) return null;

        // DBのNOT NULL制約に対応するデフォルト値を補完
        const now = new Date().toISOString();
        const row = {
            ...item,
            updated_at: item.updated_at || now,
            created_at: item.created_at || now
        };

        // テーブル別の必須カラム補完
        if (table === 'boats') {
            row.capacity = row.capacity || 0;
            row.status = row.status || 'available';
        } else if (table === 'oars') {
            row.type = row.type || 'スカル';
            row.status = row.status || 'available';
        } else if (table === 'ergos') {
            row.status = row.status || 'available';
        }

        // DBに存在するカラムのみを送信（PostgRESTは未知カラムでエラーを返す）
        const allowedColumns = {
            boats: ['id', 'name', 'type', 'capacity', 'status', 'notes', 'created_at', 'updated_at',
                'registration_number', 'storage_location', 'maintenance_status', 'memo',
                'organization', 'currentRiggingMode', 'availability'],
            oars: ['id', 'name', 'type', 'side', 'status', 'notes', 'created_at', 'updated_at',
                'length', 'sealNumber', 'availability', 'memo'],
            ergos: ['id', 'name', 'serial_number', 'status', 'notes', 'created_at', 'updated_at',
                'model', 'purchase_date', 'last_maintenance_date', 'storage_location', 'memo',
                'type', 'sealNumber', 'availability']
        };

        const allowed = allowedColumns[table];
        const filteredRow = {};
        if (allowed) {
            for (const key of Object.keys(row)) {
                if (allowed.includes(key)) {
                    filteredRow[key] = row[key];
                }
            }
        } else {
            Object.assign(filteredRow, row);
        }

        return withSyncIndicator(async () => {
            const { data, error } = await _supabaseClient
                .from(table)
                .upsert(filteredRow, { onConflict: 'id' })
                .select()
                .single();
            if (error) {
                console.error(`Save ${table} error:`, error.message, error.details, error.hint, 'Row:', JSON.stringify(filteredRow));
                throw error;
            }
            return data;
        }).catch(e => {
            console.error(`saveMasterItem(${table}) failed:`, e?.message || e);
            return null;
        });
    },

    async deleteMasterItem(table, id) {
        if (!isSupabaseReady()) return false;
        return withSyncIndicator(async () => {
            const { error } = await _supabaseClient
                .from(table)
                .delete()
                .eq('id', id);
            if (error) { console.error(`Delete ${table} error:`, error); throw error; }
            return true;
        }).catch(() => false);
    },

    // --- 練習ノート ---
    async loadPracticeNotes(userId) {
        if (!isSupabaseReady()) return [];

        let query = _supabaseClient
            .from('practice_notes')
            .select('*')
            .order('date', { ascending: false });

        if (userId) query = query.eq('userId', userId);

        const { data, error } = await query;
        if (error) { console.error('Load practice_notes error:', error); return []; }
        return data || [];
    },

    async savePracticeNote(note) {
        if (!isSupabaseReady()) return null;
        return withSyncIndicator(async () => {
            const { data, error } = await _supabaseClient
                .from('practice_notes')
                .upsert(note, { onConflict: 'id' })
                .select()
                .single();
            if (error) { console.error('Save practice_note error:', error); throw error; }
            return data;
        }).catch(() => null);
    },

    // --- 監査ログ ---
    async loadAuditLogs() {
        if (!isSupabaseReady()) return [];

        const { data, error } = await _supabaseClient
            .from('audit_logs')
            .select('*')
            .order('createdAt', { ascending: false })
            .limit(500);

        if (error) { console.error('Load audit_logs error:', error); return []; }
        return data || [];
    },

    async saveAuditLog(log) {
        if (!isSupabaseReady()) return null;
        return withSyncIndicator(async () => {
            const { data, error } = await _supabaseClient
                .from('audit_logs')
                .upsert(log, { onConflict: 'id' })
                .select()
                .single();
            if (error) { console.error('Save audit_log error:', error); throw error; }
            return data;
        }).catch(() => null);
    },

    // --- クループリセット ---
    async loadCrewPresets() {
        if (!isSupabaseReady()) return [];

        const { data, error } = await _supabaseClient
            .from('crew_presets')
            .select('*');

        if (error) { console.error('Load crew_presets error:', error); return []; }
        return data || [];
    },

    async saveCrewPreset(preset) {
        if (!isSupabaseReady()) return null;
        return withSyncIndicator(async () => {
            const { data, error } = await _supabaseClient
                .from('crew_presets')
                .upsert(preset, { onConflict: 'id' })
                .select()
                .single();
            if (error) { console.error('Save crew_preset error:', error); throw error; }
            return data;
        }).catch(() => null);
    },

    async deleteCrewPreset(id) {
        if (!isSupabaseReady()) return false;
        return withSyncIndicator(async () => {
            const { error } = await _supabaseClient
                .from('crew_presets')
                .delete()
                .eq('id', id);
            if (error) { console.error('Delete crew_preset error:', error); throw error; }
            return true;
        }).catch(() => false);
    },

    // --- リギング ---
    async loadRiggings() {
        if (!isSupabaseReady()) return [];

        const { data, error } = await _supabaseClient
            .from('riggings')
            .select('*');

        if (error) { console.error('Load riggings error:', error); return []; }
        return data || [];
    }
};

// グローバルに公開
window.SupabaseConfig = {
    init: initSupabaseClient,
    isReady: isSupabaseReady,
    signUp: signUpWithEmail,
    signIn: signInWithEmail,
    signOut: signOutUser,
    getSession,
    onAuthStateChange,
    getOrCreateProfile,
    db: SupabaseDB,
    supabaseUrl: SUPABASE_URL,
    suppressSyncIndicator
};
