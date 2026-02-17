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

const SupabaseDB = {
    // --- スケジュール ---
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
        return data || [];
    },

    async saveSchedule(schedule) {
        if (!isSupabaseReady()) return null;

        const { data, error } = await _supabaseClient
            .from('schedules')
            .upsert(schedule, { onConflict: 'id' })
            .select()
            .single();

        if (error) {
            console.error('Save schedule error:', error);
            return null;
        }
        return data;
    },

    async deleteSchedule(id) {
        if (!isSupabaseReady()) return false;

        const { error } = await _supabaseClient
            .from('schedules')
            .delete()
            .eq('id', id);

        if (error) {
            console.error('Delete schedule error:', error);
            return false;
        }
        return true;
    },

    // --- エルゴ記録 ---
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
        return data || [];
    },

    async saveErgoRecord(record) {
        if (!isSupabaseReady()) return null;

        const { data, error } = await _supabaseClient
            .from('ergo_records')
            .upsert(record, { onConflict: 'id' })
            .select()
            .single();

        if (error) {
            console.error('Save ergo record error:', error);
            return null;
        }
        return data;
    },

    async deleteErgoRecord(id) {
        if (!isSupabaseReady()) return false;

        const { error } = await _supabaseClient
            .from('ergo_records')
            .delete()
            .eq('id', id);

        if (error) {
            console.error('Delete ergo record error:', error);
            return false;
        }
        return true;
    },

    async deleteErgoRecordsByScheduleId(scheduleId) {
        if (!isSupabaseReady()) return false;

        const { error } = await _supabaseClient
            .from('ergo_records')
            .delete()
            .eq('schedule_id', scheduleId);

        if (error) {
            console.error('Delete ergo records by schedule error:', error);
            return false;
        }
        return true;
    },

    // --- クルーノート ---
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
        return data || [];
    },

    async saveCrewNote(note) {
        if (!isSupabaseReady()) return null;

        const { data, error } = await _supabaseClient
            .from('crew_notes')
            .upsert(note, { onConflict: 'id' })
            .select()
            .single();

        if (error) {
            console.error('Save crew note error:', error);
            return null;
        }
        return data;
    },

    async deleteCrewNote(id) {
        if (!isSupabaseReady()) return false;

        const { error } = await _supabaseClient
            .from('crew_notes')
            .delete()
            .eq('id', id);

        if (error) {
            console.error('Delete crew note error:', error);
            return false;
        }
        return true;
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

        const { data, error } = await _supabaseClient
            .from('profiles')
            .update(updates)
            .eq('id', profileId)
            .select()
            .single();

        if (error) {
            console.error('Update profile error:', error);
            return null;
        }
        return data;
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

        const { data, error } = await _supabaseClient
            .from(table)
            .upsert(item, { onConflict: 'id' })
            .select()
            .single();

        if (error) {
            console.error(`Save ${table} error:`, error);
            return null;
        }
        return data;
    },

    async deleteMasterItem(table, id) {
        if (!isSupabaseReady()) return false;

        const { error } = await _supabaseClient
            .from(table)
            .delete()
            .eq('id', id);

        if (error) {
            console.error(`Delete ${table} error:`, error);
            return false;
        }
        return true;
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

        const { data, error } = await _supabaseClient
            .from('practice_notes')
            .upsert(note, { onConflict: 'id' })
            .select()
            .single();

        if (error) { console.error('Save practice_note error:', error); return null; }
        return data;
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

        const { data, error } = await _supabaseClient
            .from('audit_logs')
            .upsert(log, { onConflict: 'id' })
            .select()
            .single();

        if (error) { console.error('Save audit_log error:', error); return null; }
        return data;
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

        const { data, error } = await _supabaseClient
            .from('crew_presets')
            .upsert(preset, { onConflict: 'id' })
            .select()
            .single();

        if (error) { console.error('Save crew_preset error:', error); return null; }
        return data;
    },

    async deleteCrewPreset(id) {
        if (!isSupabaseReady()) return false;

        const { error } = await _supabaseClient
            .from('crew_presets')
            .delete()
            .eq('id', id);

        if (error) { console.error('Delete crew_preset error:', error); return false; }
        return true;
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
    supabaseUrl: SUPABASE_URL
};
