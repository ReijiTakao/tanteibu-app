/**
 * 端艇部 総合管理アプリ - メインロジック v2
 */

// APIプロキシURL（ローカルfile://では絶対URL、Vercelでは相対パス）
const API_BASE = window.location.protocol === 'file:'
    ? 'https://tanteibu-app.vercel.app'
    : '';

// =========================================
// 定数・設定
// =========================================
const ROLES = {
    ADMIN: '管理者',
    COACH: 'コーチ',
    COX: 'Cox',
    ROWER: '漕手',
    DATA_ANALYST: 'データ班'
};

// 旧ロールからのマイグレーションマップ
const ROLE_MIGRATION = {
    '部員': '漕手',
    '幹部': '漕手',
    'マネージャー': '漕手'
};

function migrateRole(role) {
    return ROLE_MIGRATION[role] || role;
}

const SCHEDULE_TYPES = {
    ERGO: 'エルゴ',
    BOAT: '乗艇',
    WEIGHT: 'ウェイト',
    RUN: 'ラン',
    ABSENT: '参加不可',
    MEAL: '炊事',
    VIDEO: 'ビデオ',
    BANCHA: '伴チャ',
    OFF: 'OFF'
};

const ABSENCE_REASONS = ['体調不良', '怪我', '就活', '学校'];
const ERGO_TYPES = ['ダイナミック', '固定'];
const MEAL_TYPES = ['朝', '昼', '晩'];
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

// =========================================
// 認証 ハンドラー (Email/Password)
// =========================================

function toggleAuthMode(mode) {
    const loginForm = document.getElementById('login-form');
    const signupForm = document.getElementById('signup-form');
    const statusEl = document.getElementById('login-status');
    if (statusEl) statusEl.textContent = '';

    if (mode === 'signup') {
        loginForm.classList.add('hidden');
        signupForm.classList.remove('hidden');
    } else {
        loginForm.classList.remove('hidden');
        signupForm.classList.add('hidden');
    }
}

async function handleEmailLogin() {
    const emailInput = document.getElementById('login-email');
    const passwordInput = document.getElementById('login-password');
    const statusEl = document.getElementById('login-status');
    const btn = document.getElementById('email-login-btn');

    const email = emailInput.value.trim();
    const password = passwordInput.value.trim();

    if (!email || !password) {
        showToast('メールアドレスとパスワードを入力してください', 'error');
        return;
    }

    if (!window.SupabaseConfig || !window.SupabaseConfig.isReady()) {
        if (statusEl) statusEl.textContent = 'サーバーに接続できません。ネット接続を確認してください。';
        showToast('サーバー未接続', 'error');
        return;
    }

    btn.disabled = true;
    if (statusEl) statusEl.textContent = 'ログイン中...';

    const { data, error } = await window.SupabaseConfig.signIn(email, password);

    if (error) {
        console.error('Login failed:', error);
        if (statusEl) statusEl.textContent = 'ログイン失敗: ' + error.message;
        showToast('ログインに失敗しました', 'error');
        btn.disabled = false;
    } else {
        if (statusEl) statusEl.textContent = 'ログイン成功！';
        showToast('ログイン成功', 'success');
        btn.disabled = false;
        // onAuthStateChange の SIGNED_IN イベントで自動的にメイン画面へ遷移
    }
}

async function handleEmailSignup() {
    const emailInput = document.getElementById('signup-email');
    const passwordInput = document.getElementById('signup-password');
    const nameInput = document.getElementById('signup-name');
    const statusEl = document.getElementById('login-status');
    const btn = document.getElementById('email-signup-btn');

    const email = emailInput.value.trim();
    const password = passwordInput.value.trim();
    const name = nameInput.value.trim();

    if (!email || !password || !name) {
        showToast('すべての項目を入力してください', 'error');
        return;
    }
    if (password.length < 6) {
        showToast('パスワードは6文字以上で設定してください', 'error');
        return;
    }

    if (!window.SupabaseConfig || !window.SupabaseConfig.isReady()) {
        if (statusEl) statusEl.textContent = 'Supabase未接続';
        return;
    }

    btn.disabled = true;
    if (statusEl) statusEl.textContent = 'アカウント作成中...';

    const { data, error } = await window.SupabaseConfig.signUp(email, password, { full_name: name });

    if (error) {
        console.error('Signup failed:', error);
        if (statusEl) statusEl.textContent = '登録失敗: ' + error.message;
        btn.disabled = false;
    } else {
        if (statusEl) statusEl.textContent = '登録完了！ログインしてください。';
        showToast('登録完了！', 'success');
        btn.disabled = false;
    }
}

/**
 * Supabase認証セッションからユーザーをロード
 */
async function handleAuthSession(session) {
    if (!session) return false;

    try {
        const profile = await window.SupabaseConfig.getOrCreateProfile(session);
        if (!profile) {
            console.warn('Profile not found/created');
            return false;
        }

        // アプリのstate.currentUserにマッピング
        state.currentUser = {
            id: profile.id,
            authId: profile.auth_id,
            name: profile.name,
            email: profile.email,
            grade: profile.grade,
            gender: profile.gender || 'man',
            role: migrateRole(profile.role || '漕手'),
            status: profile.status || '在籍',
            approvalStatus: profile.approval_status || '承認済み',
            concept2Connected: profile.concept2_connected || false,
            concept2Token: profile.concept2_access_token || null,
            concept2LastSync: profile.concept2_last_sync,
            side: profile.side || null,
            weight: profile.weight || null
        };
        DB.save('current_user', state.currentUser);
        return true;
    } catch (e) {
        console.error('Auth session handling error:', e);
        return false;
    }
}

// =========================================
// 状態管理
// =========================================
let state = {
    currentUser: null,
    currentWeekStart: null,
    currentDiaryDate: null,
    schedules: [],
    ergoRecords: [],
    diaries: [],
    users: [],
    boats: [],
    oars: [],
    ergos: [],
    crews: [],
    practiceNotes: [],
    teamSchedules: [],
    auditLogs: []
};

// =========================================
// データベース（ハイブリッド: Supabase / ローカルストレージ）
// =========================================
const DB = {
    // Supabaseが利用可能かどうか
    useSupabase: false,
    // ストレージプレフィックス（デモモードで切替）
    storagePrefix: 'tanteibu_v2_',

    setDemoMode(isDemoMode) {
        this.storagePrefix = isDemoMode ? 'tanteibu_demo_' : 'tanteibu_v2_';
        // デモモードではSupabase書き込みを無効化（本番データを汚染しない）
        if (isDemoMode) this.useSupabase = false;
    },

    // ローカルストレージ操作
    saveLocal(key, data) {
        localStorage.setItem(`${this.storagePrefix}${key}`, JSON.stringify(data));
    },

    loadLocal(key) {
        const data = localStorage.getItem(`${this.storagePrefix}${key}`);
        return data ? JSON.parse(data) : null;
    },

    // 汎用保存（ローカル + Supabase同時保存）
    async save(key, data) {
        // ローカルには常に保存（オフライン対応）
        this.saveLocal(key, data);

        // Supabaseが利用可能なら同期
        if (this.useSupabase && window.SupabaseConfig?.isReady()) {
            try {
                const masterTables = ['boats', 'oars', 'ergos'];
                if (masterTables.includes(key) && Array.isArray(data)) {
                    for (const item of data) {
                        await window.SupabaseConfig.db.saveMasterItem(key, item).catch(e => console.warn(`Supabase save ${key} failed:`, e));
                    }
                }
                // practice_notes: 個別保存は各関数側で行う
                // audit_logs: addAuditLog内で個別保存
                // crew_presets: 個別保存は各関数側で行う
            } catch (e) {
                console.warn('Supabase sync failed:', e);
            }
        }
    },

    // 全データリセット（現在のプレフィックスのみ）
    resetAllData() {
        const prefix = this.storagePrefix;
        const keysToRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith(prefix)) {
                keysToRemove.push(key);
            }
        }
        keysToRemove.forEach(key => localStorage.removeItem(key));
    },

    // 汎用読込（ローカル優先、Supabaseからの同期は別途）
    load(key) {
        return this.loadLocal(key);
    },

    // 初期化
    async init() {
        // Supabaseクライアントを初期化
        if (window.SupabaseConfig) {
            this.useSupabase = window.SupabaseConfig.init();
        }

        // ローカルストレージからロード
        state.users = this.load('users') || [];
        state.schedules = this.load('schedules') || [];
        state.ergoRecords = this.load('ergo_records') || [];

        state.boats = this.load('boats') || [];
        state.oars = this.load('oars') || [];
        state.ergos = this.load('ergos') || [];
        state.crewNotes = this.load('crew_notes') || [];
        state.practiceNotes = this.load('practice_notes') || [];

        // 過去の練習記録からクルー情報を抽出
        extractCrewsFromSchedules();
        state.auditLogs = this.load('audit_logs') || [];
        state.ergoRaw = this.load('ergoRaw') || [];
        state.ergoSessions = this.load('ergoSessions') || [];
        state.teamSchedules = this.load('team_schedules') || [];
        state.currentUser = this.load('current_user');

        // 承認済みユーザーがいない場合もデモデータを再作成（デモモード用）
        const approvedUsers = state.users.filter(u => u.approvalStatus === '承認済み');
        if (state.users.length === 0 || approvedUsers.length === 0) {
            this.createDemoData();
        }

        // Supabaseと同期（オンライン時）
        if (this.useSupabase && window.SupabaseConfig.isReady()) {
            await this.syncFromSupabase();

            // Supabase同期後にデモデータ判定を再実行
            // (ローカルが空でもSupabaseからデータ取得済みならデモデータ不要)
            const approvedAfterSync = state.users.filter(u => u.approvalStatus === '承認済み');
            if (approvedAfterSync.length > 0) {
                // デモユーザーを削除（Supabaseから実ユーザーが取得できた場合）
                state.users = state.users.filter(u => !u.isDemo);
                this.saveLocal('users', state.users);
            }
        }
    },

    // Supabaseから同期（初期同期中はインジケーター非表示）
    async syncFromSupabase() {
        if (!this.useSupabase || !window.SupabaseConfig.isReady()) return;
        window.SupabaseConfig.suppressSyncIndicator(true);

        try {
            // プロフィール（全ユーザー一覧）をSupabaseから取得
            const profiles = await window.SupabaseConfig.db.loadProfiles();
            if (profiles.length) {
                // Supabaseのプロフィールをstate.users形式に変換
                const supaUsers = profiles.map(p => ({
                    id: p.id,
                    authId: p.auth_id,
                    name: p.name,
                    email: p.email,
                    grade: p.grade,
                    gender: p.gender,
                    role: p.role,
                    side: p.side || null,
                    weight: p.weight || null,
                    status: p.status,
                    approvalStatus: p.approval_status,
                    concept2Connected: p.concept2_connected,
                    concept2Token: p.concept2_access_token || null,
                    concept2LastSync: p.concept2_last_sync
                }));
                // ローカルのユーザーとマージ
                supaUsers.forEach(u => {
                    const idx = state.users.findIndex(local => local.id === u.id);
                    if (idx !== -1) {
                        // ローカルの追加フィールドを保持しつつSupabaseのデータで更新
                        state.users[idx] = { ...state.users[idx], ...u };
                    } else {
                        state.users.push(u);
                    }
                });
                this.saveLocal('users', state.users);

                // currentUserにConcept2トークンを復元
                if (state.currentUser) {
                    const me = state.users.find(u => u.id === state.currentUser.id);
                    if (me && me.concept2Token) {
                        state.currentUser.concept2Token = me.concept2Token;
                        state.currentUser.concept2Connected = me.concept2Connected;
                        state.currentUser.concept2LastSync = me.concept2LastSync;
                        this.saveLocal('current_user', state.currentUser);
                    }
                }
            }

            // マスタデータ
            const boats = await window.SupabaseConfig.db.loadMasterData('boats');
            if (boats.length) { state.boats = boats; this.saveLocal('boats', boats); }

            const oars = await window.SupabaseConfig.db.loadMasterData('oars');
            if (oars.length) { state.oars = oars; this.saveLocal('oars', oars); }

            const ergos = await window.SupabaseConfig.db.loadMasterData('ergos');
            if (ergos.length) { state.ergos = ergos; this.saveLocal('ergos', ergos); }

            // トランザクションデータ
            const today = new Date();
            const startStr = new Date(today.getFullYear(), today.getMonth() - 1, 1).toISOString().split('T')[0];
            const endStr = new Date(today.getFullYear(), today.getMonth() + 2, 0).toISOString().split('T')[0];

            const schedules = await window.SupabaseConfig.db.loadSchedules(startStr, endStr);
            if (schedules.length) {
                schedules.forEach(s => {
                    const idx = state.schedules.findIndex(local => local.id === s.id);
                    if (idx !== -1) state.schedules[idx] = s;
                    else state.schedules.push(s);
                });
                this.saveLocal('schedules', state.schedules);
            }

            const allRecords = await window.SupabaseConfig.db.loadErgoRecords();
            if (allRecords.length) {
                allRecords.forEach(r => {
                    // rawDataからconcept2Idを復元
                    if (r.rawData?.concept2Id && !r.concept2Id) {
                        r.concept2Id = r.rawData.concept2Id;
                    }
                    // concept2Idでの重複チェック（ローカルのc2_xxx形式IDとの照合）
                    const existing = r.concept2Id
                        ? state.ergoRecords.findIndex(local => local.concept2Id === r.concept2Id)
                        : state.ergoRecords.findIndex(local => local.id === r.id);
                    if (existing !== -1) {
                        // 既存データを更新（ローカルIDを保持）
                        const localId = state.ergoRecords[existing].id;
                        state.ergoRecords[existing] = { ...r, id: localId };
                    } else {
                        // 新規データ: concept2Idがあればc2_形式IDを復元
                        if (r.concept2Id) {
                            r.id = 'c2_' + r.concept2Id;
                        }
                        state.ergoRecords.push(r);
                    }
                });
                this.saveLocal('ergo_records', state.ergoRecords);
            }

            // クルーノート
            const notes = await window.SupabaseConfig.db.loadCrewNotes(startStr, endStr);
            if (notes.length) {
                notes.forEach(n => {
                    const idx = state.crewNotes.findIndex(local => local.id === n.id);
                    if (idx !== -1) state.crewNotes[idx] = n;
                    else state.crewNotes.push(n);
                });
                this.saveLocal('crew_notes', state.crewNotes);
            }

            // 練習ノート
            const practiceNotes = await window.SupabaseConfig.db.loadPracticeNotes();
            if (practiceNotes.length) {
                practiceNotes.forEach(pn => {
                    const idx = state.practiceNotes.findIndex(local => local.id === pn.id);
                    if (idx !== -1) state.practiceNotes[idx] = pn;
                    else state.practiceNotes.push(pn);
                });
                this.saveLocal('practice_notes', state.practiceNotes);
            }

            // 監査ログ
            const auditLogs = await window.SupabaseConfig.db.loadAuditLogs();
            if (auditLogs.length) {
                auditLogs.forEach(log => {
                    const idx = state.auditLogs.findIndex(local => local.id === log.id);
                    if (idx !== -1) state.auditLogs[idx] = log;
                    else state.auditLogs.push(log);
                });
                this.saveLocal('audit_logs', state.auditLogs);
            }

            // クループリセット
            const presets = await window.SupabaseConfig.db.loadCrewPresets();
            if (presets.length) {
                state.crewPresets = presets;
                this.saveLocal('crew_presets', presets);
            }

            // リギング
            const riggings = await window.SupabaseConfig.db.loadRiggings();
            if (riggings.length) {
                this.saveLocal('riggings', riggings);
            }

            // 体重履歴
            try {
                const weightHistory = await window.SupabaseConfig.db.loadWeightHistory();
                if (weightHistory.length) {
                    // Supabaseのデータでローカルを更新（マージ）
                    let localHistory = this.loadLocal('weight_history') || [];
                    weightHistory.forEach(wh => {
                        const idx = localHistory.findIndex(l => l.id === wh.id);
                        if (idx !== -1) localHistory[idx] = wh;
                        else localHistory.push(wh);
                    });
                    this.saveLocal('weight_history', localHistory);
                }
            } catch (e) { console.warn('Weight history sync failed:', e); }

            // 管理者パスコード
            try {
                const passcode = await window.SupabaseConfig.db.loadSetting('admin_passcode');
                if (passcode) {
                    this.saveLocal('admin_passcode', passcode);
                }
            } catch (e) { console.warn('Admin passcode sync failed:', e); }

        } catch (e) {
            console.error('syncFromSupabase failed:', e);
            showToast('同期エラー: ' + (e?.message || JSON.stringify(e)), 'error');
        } finally {
            window.SupabaseConfig.suppressSyncIndicator(false);
        }
    },

    // 個別保存メソッド（Supabaseへのプロキシ）
    async saveSchedule(schedule) {
        if (this.useSupabase && window.SupabaseConfig.db) {
            return await window.SupabaseConfig.db.saveSchedule(schedule);
        }
    },
    async deleteSchedule(id) {
        if (this.useSupabase && window.SupabaseConfig.db) {
            return await window.SupabaseConfig.db.deleteSchedule(id);
        }
    },
    async saveErgoRecord(record) {
        if (this.useSupabase && window.SupabaseConfig.db) {
            return await window.SupabaseConfig.db.saveErgoRecord(record);
        }
    },
    async deleteErgoRecordsByScheduleId(scheduleId) {
        if (this.useSupabase && window.SupabaseConfig.db) {
            return await window.SupabaseConfig.db.deleteErgoRecordsByScheduleId(scheduleId);
        }
    },
    async saveCrewNote(note) {
        if (this.useSupabase && window.SupabaseConfig.db) {
            return await window.SupabaseConfig.db.saveCrewNote(note);
        }
    },

    initInputEvents() {
        // 既存のトグルボタン用リスナー
        document.querySelectorAll('.toggle-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                // 同じグループのボタンのactiveを外す
                const group = btn.parentElement;
                group.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                // 予定タイプ変更時の処理
                if (btn.classList.contains('schedule-type-btn')) {
                    handleScheduleTypeChange(btn.dataset.value);
                }

                // 艇種変更時の処理
                if (btn.classList.contains('boat-type-btn')) {
                    // 艇種が選択されたら、その種別に合致する艇のみを表示するようにフィルタリングも可能だが
                    // 現状は簡易的に「艇 (任意)」のラベル表示切替程度にしておく
                    // または、艇選択プルダウンをフィルタリングする
                    filterBoatSelect(btn.dataset.value);
                    // オール選択もスイープ/スカルでフィルタし直す
                    if (typeof populateBoatOarSelects === 'function') populateBoatOarSelects();
                }

                // 記録統計の性別切り替え
                if (btn.classList.contains('gender-btn')) {
                    renderWeeklyRanking();
                    // renderTeamRecords(); // チーム記録も分けるならここも呼ぶ
                }
            });
        });
    },

    createDemoData() {
        state.users = [
            { id: 'u1', name: '山田太郎', gender: 'man', grade: 4, role: ROLES.ADMIN, status: '在籍', googleId: 'admin@keio.jp', approvalStatus: '承認済み', concept2Connected: false },
            { id: 'u2', name: '鈴木花子', gender: 'woman', grade: 3, role: ROLES.COACH, status: '在籍', googleId: 'coach@keio.jp', approvalStatus: '承認済み', concept2Connected: true },
            { id: 'u3', name: '佐藤次郎', gender: 'man', grade: 2, role: ROLES.ROWER, status: '在籍', googleId: 'rower@keio.jp', approvalStatus: '承認済み', concept2Connected: false },
            { id: 'u4', name: '田中三郎', gender: 'man', grade: 2, role: ROLES.COX, status: '在籍', googleId: 'cox@keio.jp', approvalStatus: '承認済み', concept2Connected: false },
            { id: 'u5', name: '高橋四郎', gender: 'man', grade: 1, role: ROLES.ROWER, status: '在籍', googleId: 'rower2@keio.jp', approvalStatus: '承認済み', concept2Connected: false }
        ];

        state.boats = [
            { id: 'b1', name: '慶應丸', type: '8+', gender: 'man', availability: '使用可能', memo: '' },
            { id: 'b2', name: '福澤号', type: '4+', gender: 'man', availability: '使用可能', memo: '' },
            { id: 'b3', name: '三田丸', type: '4x', gender: 'woman', availability: '使用不可', memo: '修理中' },
            { id: 'b4', name: '日吉丸', type: '1x', gender: 'all', availability: '使用可能', memo: '' }
        ];

        state.oars = [
            { id: 'o1', name: 'スカル1号', type: 'スカル', sealNumber: 'S001', availability: '使用可能' },
            { id: 'o2', name: 'スイープ1号', type: 'スイープ', sealNumber: 'W001', availability: '使用可能' }
        ];

        state.ergos = [
            { id: 'e1', name: 'ダイナミック1', type: 'ダイナミック', sealNumber: 'D001', availability: '使用可能' },
            { id: 'e2', name: 'ダイナミック2', type: 'ダイナミック', sealNumber: 'D002', availability: '使用可能' },
            { id: 'e3', name: '固定1', type: '固定', sealNumber: 'F001', availability: '使用可能' },
            { id: 'e4', name: '固定2', type: '固定', sealNumber: 'F002', availability: '使用可能' }
        ];

        this.saveLocal('users', state.users);
        this.saveLocal('boats', state.boats);
        this.saveLocal('oars', state.oars);
        this.saveLocal('ergos', state.ergos);

        // デモ用エルゴ記録データ
        this.createDemoErgoData();
    },

    createDemoErgoData() {
        const now = new Date();
        const demoRecords = [];
        const demoRaw = [];

        // 各ユーザーにデモデータを追加
        const users = ['u1', 'u2', 'u3'];

        users.forEach((userId, userIdx) => {
            // 2000m TT（距離カテゴリ）
            for (let i = 0; i < 3; i++) {
                const date = new Date(now);
                date.setDate(date.getDate() - (i * 7 + userIdx * 2));
                const timeSeconds = 420 + Math.random() * 30; // 7:00-7:30
                const splits = [];
                for (let s = 0; s < 4; s++) {
                    splits.push({ time: (1000 + Math.random() * 50) * 10, stroke_rate: 28 + Math.floor(Math.random() * 4) });
                }
                const rawId = `demo_raw_2000_${userId}_${i}`;
                demoRaw.push({
                    id: rawId,
                    concept2Id: `demo_2000_${userId}_${i}`,
                    date: formatDate(date),
                    type: 'rower',
                    distance: 2000,
                    time: timeSeconds,
                    workoutType: 'FixedDistanceSplits',
                    averageSPM: 28 + Math.floor(Math.random() * 4),
                    splits: splits,
                    intervals: [],
                    userId: userId
                });
                demoRecords.push({
                    id: `demo_rec_2000_${userId}_${i}`,
                    rawId: rawId,
                    userId: userId,
                    date: formatDate(date),
                    distance: 2000,
                    timeSeconds: Math.round(timeSeconds),
                    timeDisplay: formatTime(timeSeconds),
                    split: formatSplit(timeSeconds, 2000),
                    strokeRate: 28 + Math.floor(Math.random() * 4),
                    menuKey: '2000m TT',
                    category: 'distance',
                    source: 'Concept2'
                });
            }

            // 5000m（距離カテゴリ）
            for (let i = 0; i < 2; i++) {
                const date = new Date(now);
                date.setDate(date.getDate() - (i * 5 + userIdx * 3));
                const timeSeconds = 1080 + Math.random() * 60; // 18:00-19:00
                const rawId = `demo_raw_5000_${userId}_${i}`;
                demoRaw.push({
                    id: rawId,
                    concept2Id: `demo_5000_${userId}_${i}`,
                    date: formatDate(date),
                    distance: 5000,
                    time: timeSeconds,
                    workoutType: 'FixedDistanceSplits',
                    averageSPM: 24 + Math.floor(Math.random() * 4),
                    splits: [],
                    intervals: [],
                    userId: userId
                });
                demoRecords.push({
                    id: `demo_rec_5000_${userId}_${i}`,
                    rawId: rawId,
                    userId: userId,
                    date: formatDate(date),
                    distance: 5000,
                    timeSeconds: Math.round(timeSeconds),
                    timeDisplay: formatTime(timeSeconds),
                    split: formatSplit(timeSeconds, 5000),
                    strokeRate: 24 + Math.floor(Math.random() * 4),
                    menuKey: '5000m',
                    category: 'distance',
                    source: 'Concept2'
                });
            }

            // 10000m（距離カテゴリ）
            const date10k = new Date(now);
            date10k.setDate(date10k.getDate() - (10 + userIdx * 4));
            const time10k = 2280 + Math.random() * 120; // 38:00-40:00
            const rawId10k = `demo_raw_10000_${userId}`;
            demoRaw.push({
                id: rawId10k,
                concept2Id: `demo_10000_${userId}`,
                date: formatDate(date10k),
                distance: 10000,
                time: time10k,
                workoutType: 'FixedDistanceSplits',
                averageSPM: 22 + Math.floor(Math.random() * 4),
                splits: [],
                intervals: [],
                userId: userId
            });
            demoRecords.push({
                id: `demo_rec_10000_${userId}`,
                rawId: rawId10k,
                userId: userId,
                date: formatDate(date10k),
                distance: 10000,
                timeSeconds: Math.round(time10k),
                timeDisplay: formatTime(time10k),
                split: formatSplit(time10k, 10000),
                strokeRate: 22 + Math.floor(Math.random() * 4),
                menuKey: '10000m',
                category: 'distance',
                source: 'Concept2'
            });

            // 20分（時間カテゴリ）
            for (let i = 0; i < 2; i++) {
                const date = new Date(now);
                date.setDate(date.getDate() - (i * 7 + userIdx * 2));
                const distance = 4800 + Math.floor(Math.random() * 400);
                const rawId = `demo_raw_20min_${userId}_${i}`;
                demoRaw.push({
                    id: rawId,
                    concept2Id: `demo_20min_${userId}_${i}`,
                    date: formatDate(date),
                    distance: distance,
                    time: 1200, // 20分
                    workoutType: 'FixedTimeSplits',
                    averageSPM: 24 + Math.floor(Math.random() * 4),
                    splits: [],
                    intervals: [],
                    userId: userId
                });
                demoRecords.push({
                    id: `demo_rec_20min_${userId}_${i}`,
                    rawId: rawId,
                    userId: userId,
                    date: formatDate(date),
                    distance: distance,
                    timeSeconds: 1200,
                    timeDisplay: '20:00.0',
                    split: formatSplit(1200, distance),
                    strokeRate: 24 + Math.floor(Math.random() * 4),
                    menuKey: '20分',
                    category: 'time',
                    source: 'Concept2'
                });
            }

            // 30分（時間カテゴリ）
            const date30 = new Date(now);
            date30.setDate(date30.getDate() - (5 + userIdx * 3));
            const dist30 = 7200 + Math.floor(Math.random() * 600);
            const rawId30 = `demo_raw_30min_${userId}`;
            demoRaw.push({
                id: rawId30,
                concept2Id: `demo_30min_${userId}`,
                date: formatDate(date30),
                distance: dist30,
                time: 1800, // 30分
                workoutType: 'FixedTimeSplits',
                averageSPM: 22 + Math.floor(Math.random() * 4),
                splits: [],
                intervals: [],
                userId: userId
            });
            demoRecords.push({
                id: `demo_rec_30min_${userId}`,
                rawId: rawId30,
                userId: userId,
                date: formatDate(date30),
                distance: dist30,
                timeSeconds: 1800,
                timeDisplay: '30:00.0',
                split: formatSplit(1800, dist30),
                strokeRate: 22 + Math.floor(Math.random() * 4),
                menuKey: '30分',
                category: 'time',
                source: 'Concept2'
            });

            // インターバル（500m×8）
            for (let i = 0; i < 2; i++) {
                const date = new Date(now);
                date.setDate(date.getDate() - (i * 10 + userIdx * 2));
                const intervals = [];
                for (let int = 0; int < 8; int++) {
                    intervals.push({
                        distance: 500,
                        time: (1000 + Math.random() * 100) * 10,
                        stroke_rate: 30 + Math.floor(Math.random() * 4)
                    });
                }
                const rawId = `demo_raw_500x8_${userId}_${i}`;
                demoRaw.push({
                    id: rawId,
                    concept2Id: `demo_500x8_${userId}_${i}`,
                    date: formatDate(date),
                    distance: 4000,
                    time: 840 + Math.random() * 40,
                    workoutType: 'FixedDistanceInterval',
                    intervalDisplay: '500m×8',
                    averageSPM: 30 + Math.floor(Math.random() * 4),
                    splits: [],
                    intervals: intervals,
                    userId: userId
                });
                demoRecords.push({
                    id: `demo_rec_500x8_${userId}_${i}`,
                    rawId: rawId,
                    userId: userId,
                    date: formatDate(date),
                    distance: 4000,
                    timeSeconds: Math.round(840 + Math.random() * 40),
                    timeDisplay: formatTime(840 + Math.random() * 40),
                    split: formatSplit(840, 4000),
                    strokeRate: 30 + Math.floor(Math.random() * 4),
                    menuKey: '500m×8',
                    category: 'interval',
                    source: 'Concept2'
                });
            }

            // インターバル（1分×10）
            const dateInt = new Date(now);
            dateInt.setDate(dateInt.getDate() - (8 + userIdx * 3));
            const intervals1min = [];
            for (let int = 0; int < 10; int++) {
                intervals1min.push({
                    time: 600, // 1分
                    distance: 280 + Math.floor(Math.random() * 40),
                    stroke_rate: 32 + Math.floor(Math.random() * 4)
                });
            }
            const rawIdInt = `demo_raw_1minx10_${userId}`;
            demoRaw.push({
                id: rawIdInt,
                concept2Id: `demo_1minx10_${userId}`,
                date: formatDate(dateInt),
                distance: 2800 + Math.floor(Math.random() * 200),
                time: 600,
                workoutType: 'FixedTimeInterval',
                intervalDisplay: '1分×10',
                averageSPM: 32 + Math.floor(Math.random() * 4),
                splits: [],
                intervals: intervals1min,
                userId: userId
            });
            demoRecords.push({
                id: `demo_rec_1minx10_${userId}`,
                rawId: rawIdInt,
                userId: userId,
                date: formatDate(dateInt),
                distance: 2800 + Math.floor(Math.random() * 200),
                timeSeconds: 600,
                timeDisplay: '10:00.0',
                split: '-',
                strokeRate: 32 + Math.floor(Math.random() * 4),
                menuKey: '1分×10',
                category: 'interval',
                source: 'Concept2'
            });
        });

        // 既存データとマージ
        state.ergoRaw = [...(state.ergoRaw || []).filter(r => !r.id.startsWith('demo_')), ...demoRaw];
        state.ergoRecords = [...(state.ergoRecords || []).filter(r => !r.id.startsWith('demo_')), ...demoRecords];
        state.ergoSessions = [...(state.ergoSessions || []).filter(s => !s.rawId?.startsWith('demo_'))];

        this.saveLocal('ergoRaw', state.ergoRaw);
        this.saveLocal('ergo_records', state.ergoRecords);
        this.saveLocal('ergoSessions', state.ergoSessions);

    },

    addAuditLog(targetType, targetId, operation, changes) {
        const log = {
            id: `log-${Date.now()}`,
            userId: state.currentUser?.id,
            targetType,
            targetId,
            operation,
            changes,
            createdAt: new Date().toISOString()
        };
        state.auditLogs.push(log);
        this.save('audit_logs', state.auditLogs);

        // Supabaseにも個別保存
        if (this.useSupabase && window.SupabaseConfig?.db) {
            window.SupabaseConfig.db.saveAuditLog(log).catch(e => console.warn('Audit log sync failed:', e));
        }
    }
};

// =========================================
// ユーティリティ関数
// =========================================
function formatDate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function formatDisplayDate(dateStr) {
    const date = new Date(dateStr);
    const y = date.getFullYear();
    const m = date.getMonth() + 1;
    const d = date.getDate();
    const w = WEEKDAYS[date.getDay()];
    return { year: y, month: m, day: d, weekday: w, dayOfWeek: date.getDay() };
}

function getWeekStart(date) {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    d.setDate(diff);
    d.setHours(0, 0, 0, 0);
    return d;
}

function generateId() {
    // UUID v4形式を生成（Supabase UUID型互換）
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    // フォールバック: UUID v4形式を手動生成
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
}

function showToast(message, type = 'default') {
    let toast = document.querySelector('.toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.className = 'toast';
        document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.className = `toast ${type}`;
    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => toast.classList.remove('show'), 2500);
}

// 同期ステータスインジケーター
let _syncStatusTimer = null;
let _syncFadeTimer = null;
function showSyncStatus(status, message) {
    const el = document.getElementById('sync-status-indicator');
    if (!el) return;

    // タイマーをリセット
    if (_syncStatusTimer) { clearTimeout(_syncStatusTimer); _syncStatusTimer = null; }
    if (_syncFadeTimer) { clearTimeout(_syncFadeTimer); _syncFadeTimer = null; }

    // クラスとテキストを設定
    el.className = 'sync-indicator ' + status;
    el.textContent = status === 'syncing' ? '同期中' : status === 'success' ? '同期完了' : '同期失敗';

    if (status === 'success') {
        // 成功時は2.5秒後にフェードアウトして非表示
        _syncStatusTimer = setTimeout(() => {
            el.classList.add('fade-out');
            _syncFadeTimer = setTimeout(() => {
                el.className = 'sync-indicator hidden';
            }, 350);
        }, 2500);
    } else if (status === 'error') {
        // エラー時は5秒後にフェードアウト
        _syncStatusTimer = setTimeout(() => {
            el.classList.add('fade-out');
            _syncFadeTimer = setTimeout(() => {
                el.className = 'sync-indicator hidden';
            }, 350);
        }, 5000);
    }
    // syncing は明示的に success/error が来るまで表示し続ける
}

function canEditMaster(user) {
    return [ROLES.ADMIN, ROLES.COX].includes(user?.role);
}

function canViewOverview(user) {
    return [ROLES.ADMIN, ROLES.COACH].includes(user?.role);
}

// スケジュール管理（全体タブでの編集）権限
function canEditSchedule(user) {
    return [ROLES.ADMIN].includes(user?.role);
}

// =========================================
// 画面制御
// =========================================
function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
    const target = document.getElementById(screenId);
    if (target) {
        target.classList.remove('hidden');
    }
    // 安定性のため: メイン画面表示時は必ずログイン画面を隠す
    if (screenId === 'main-screen') {
        const login = document.getElementById('login-screen');
        if (login) login.style.display = 'none';
        const onboarding = document.getElementById('onboarding-screen');
        if (onboarding) onboarding.style.display = 'none';
        // ロール別タブ表示制御
        applyRoleBasedTabs();
    }
}

// ロール別タブ表示/非表示
function applyRoleBasedTabs() {
    const role = state.currentUser?.role || '';
    const roleKey = {
        [ROLES.ADMIN]: 'admin',
        [ROLES.COACH]: 'coach',
        [ROLES.COX]: 'cox',
        [ROLES.ROWER]: 'rower',
        [ROLES.DATA_ANALYST]: 'data'
    }[role] || 'rower';

    let firstVisibleTab = null;
    document.querySelectorAll('#bottom-nav .nav-item').forEach(item => {
        const roles = item.dataset.roles || 'all';
        let visible = roles === 'all' || roles.split(',').includes(roleKey);
        item.style.display = visible ? '' : 'none';
        if (visible && !firstVisibleTab) firstVisibleTab = item.dataset.tab;
    });

    // 現在のactiveタブが非表示なら最初の表示可能タブへ切替
    const activeItem = document.querySelector('#bottom-nav .nav-item.active');
    if (activeItem && activeItem.style.display === 'none' && firstVisibleTab) {
        switchTab(firstVisibleTab);
    }
}

// 時間入力のデフォルト時間を取得（曜日・時間帯に基づく）
function getDefaultStartTime(dateStr, timeSlot) {
    if (!dateStr) return '';
    const date = new Date(dateStr + 'T00:00:00');
    const dayOfWeek = date.getDay(); // 0=日, 1=月, 2=火 ...

    if (timeSlot === '午後') return '15:10';
    // 午前のデフォルト: 火曜日は08:30、それ以外は05:40
    if (dayOfWeek === 2) return '08:30'; // 火曜
    return '05:40';
}


function switchTab(tabId) {
    // 安定性のため: タブ切り替え時はログイン画面を強制非表示
    const loginScreen = document.getElementById('login-screen');
    if (loginScreen) loginScreen.style.display = 'none';
    const onboardingScreen = document.getElementById('onboarding-screen');
    if (onboardingScreen) onboardingScreen.style.display = 'none';

    // まずUI切り替えを確実に実行
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.toggle('active', item.dataset.tab === tabId);
    });
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.toggle('hidden', content.id !== `tab-${tabId}`);
        content.classList.toggle('active', content.id === `tab-${tabId}`);
    });

    // 各タブの初期化（エラーがタブ遷移をブロックしないようtry-catch）
    try {
        if (tabId === 'overview') { renderOverview(); }
        if (tabId === 'ergo-data') {
            initCoachErgoView();
            renderErgoRecords();
            renderWeeklyRanking();
            renderTeamRecords();
        }
        if (tabId === 'rigging') initRigging();
        if (tabId === 'crew-note') {
            initCrewNoteFeatures();
            renderPracticeNotesList();
            renderMileageRanking();
            updateMileageWeekSummary();
            renderWeeklyPracticeSummary();
        }
        if (tabId === 'settings') renderSettings();
        if (tabId === 'data-export') populateExportMemberSelect();
    } catch (error) {
        console.error(`Tab init error (${tabId}):`, error);
    }
}

// =========================================
// 認証
// =========================================
function renderUserSelectList() {
    const container = document.getElementById('user-select-list');
    if (!container) return;

    // ユーザーがいない場合のハンドリング（デモデータ作成またはリロード）
    if (!state.users || state.users.length === 0) {
        // ローカルストレージを確認
        const storedUsers = DB.loadLocal('users');
        if (storedUsers && storedUsers.length > 0) {
            state.users = storedUsers;
        } else {
            console.warn('User list is empty. Creating default users...');
            // デモユーザー作成
            state.users = [
                { id: 'u1', name: '山田太郎', role: '管理者', grade: 4, approvalStatus: '承認済み', concept2Connected: false },
                { id: 'u2', name: '佐藤次郎', role: 'コーチ', grade: 0, approvalStatus: '承認済み', concept2Connected: false },
                { id: 'u3', name: '鈴木花子', role: 'Cox', grade: 3, approvalStatus: '承認済み', concept2Connected: false },
                { id: 'u4', name: '田中一郎', role: '漕手', grade: 2, approvalStatus: '承認済み', concept2Connected: false },
                { id: 'u5', name: 'takaoreiji', role: '管理者', grade: 4, approvalStatus: '承認済み', concept2Connected: false }
            ];
            DB.saveLocal('users', state.users);
            // 本番DB（Supabase）への保存は非同期で行う or ここではローカルのみ
        }
    }
    sessionStorage.removeItem('retry_init'); // 成功したらクリア

    const userList = state.users.filter(u => u.approvalStatus === '承認済み');

    container.innerHTML = userList.map(user => `
        <button class="user-select-item" data-user-id="${user.id}">
            <div class="avatar">${user.name.charAt(0)}</div>
            <div class="info">
                <div class="name">${user.name}</div>
                <div class="role">${user.role} / ${user.grade}年</div>
            </div>
        </button>
    `).join('');

    container.querySelectorAll('.user-select-item').forEach(btn => {
        btn.addEventListener('click', () => {
            const userId = btn.dataset.userId;
            const user = state.users.find(u => u.id === userId);
            if (user) {
                loginAsUser(user);
            }
        });
    });
}

function loginAsUser(user) {
    state.currentUser = user;
    DB.save('current_user', state.currentUser);

    if (!user.concept2Connected) {
        showScreen('onboarding-screen');
    } else {
        initMainScreen();
        showScreen('main-screen');
    }
}

async function handleLogout() {
    // Supabaseからもサインアウト（可能な場合）
    if (window.SupabaseConfig && window.SupabaseConfig.isReady()) {
        try {
            await window.SupabaseConfig.signOut();
        } catch (e) {
            console.warn('Supabase signout failed:', e);
        }
    }

    // アプリの状態をクリア
    state.currentUser = null;
    DB.save('current_user', null);

    // 強制的にリロードして状態を初期化（キャッシュ対策含む）
    window.location.reload();
}

function skipConcept2() {
    initMainScreen();
    showScreen('main-screen');
}

// =========================================
// Concept2 API連携
// =========================================
const CONCEPT2_API = {
    baseUrl: 'https://log.concept2.com',
    authUrl: 'https://log.concept2.com/oauth/authorize',
    tokenUrl: 'https://log.concept2.com/oauth/access_token',
    apiUrl: 'https://log.concept2.com/api',

    // リダイレクトURI（OAuth認証後に戻ってくるURL）
    get redirectUri() {
        // file://プロトコルの場合はlocalhostを使用
        if (window.location.protocol === 'file:') {
            return 'http://localhost:8080/callback.html';
        }
        return window.location.origin + '/callback.html';
    },

    // Supabase Edge Function URL（プロジェクトURLに応じて変更）
    get edgeFunctionUrl() {
        const supabaseUrl = window.SupabaseConfig?.supabaseUrl;
        if (supabaseUrl) {
            return supabaseUrl.replace('.supabase.co', '.supabase.co/functions/v1');
        }
        // ローカル開発用フォールバック
        return 'http://localhost:54321/functions/v1';
    },

    // 分類ルール（距離とタイムベース）- 厳密な範囲で判定
    classificationRules: [
        // 距離ベースのメニュー（誤差0）
        { key: '100m', type: 'distance', min: 100, max: 100 },
        { key: '250m', type: 'distance', min: 250, max: 250 },
        { key: '500m', type: 'distance', min: 500, max: 500 },
        { key: '750m', type: 'distance', min: 750, max: 750 },
        { key: '1000m', type: 'distance', min: 1000, max: 1000 },
        { key: '1250m', type: 'distance', min: 1250, max: 1250 },
        { key: '1300m', type: 'distance', min: 1300, max: 1300 },
        { key: '1500m', type: 'distance', min: 1500, max: 1500 },
        { key: '2000m TT', type: 'distance', min: 2000, max: 2000 },
        { key: '3750m', type: 'distance', min: 3750, max: 3750 },
        { key: '5000m', type: 'distance', min: 5000, max: 5000 },
        { key: '6000m', type: 'distance', min: 6000, max: 6000 },
        { key: '10000m', type: 'distance', min: 10000, max: 10000 },
        // タイムベースのメニュー（秒で指定、誤差0）
        { key: '20秒', type: 'time', min: 20, max: 20 },
        { key: '30秒', type: 'time', min: 30, max: 30 },
        { key: '1分', type: 'time', min: 60, max: 60 },
        { key: '2分', type: 'time', min: 120, max: 120 },
        { key: '3分', type: 'time', min: 180, max: 180 },
        { key: '4分', type: 'time', min: 240, max: 240 },
        { key: '5分', type: 'time', min: 300, max: 300 },
        { key: '6分', type: 'time', min: 360, max: 360 },
        { key: '7分', type: 'time', min: 420, max: 420 },
        { key: '8分', type: 'time', min: 480, max: 480 },
        { key: '9分', type: 'time', min: 540, max: 540 },
        { key: '10分', type: 'time', min: 600, max: 600 },
        { key: '12分', type: 'time', min: 720, max: 720 },
        { key: '15分', type: 'time', min: 900, max: 900 },
        { key: '20分', type: 'time', min: 1200, max: 1200 },
        { key: '30分', type: 'time', min: 1800, max: 1800 },
        { key: '40分', type: 'time', min: 2400, max: 2400 },
        { key: '60分', type: 'time', min: 3600, max: 3600 },
    ]
};

function connectConcept2() {
    // 設定画面またはオンボーディング画面のどちらかから入力を取得
    const accessToken = document.getElementById('concept2-access-token')?.value?.trim()
        || document.getElementById('onboarding-access-token')?.value?.trim();

    if (accessToken) {
        // トークンが入力されている場合は手動連携（検証）
        showToast('トークンを検証中...', 'success');
        validateAndConnectConcept2(accessToken);
    } else {
        // トークン未入力の場合はエラーメッセージを表示
        showToast('Personal Access Tokenを入力してください。Concept2プロフィールページから取得できます。', 'error');
    }
}

// Concept2認証を開始 (OAuth)
function initiateConcept2OAuth() {
    // クライアントIDを取得 (設定済み or 入力)
    let clientId = localStorage.getItem('concept2_client_id');
    if (!clientId) {
        clientId = prompt('Concept2 Client IDを入力してください:');
        if (!clientId) return;
        localStorage.setItem('concept2_client_id', clientId);
    }

    localStorage.setItem('concept2_pending_client_id', clientId);
    // Client Secretはバックエンドで管理するため、ここでは不要
    localStorage.setItem('concept2_pending_user_id', state.currentUser.id);

    // ランダムなstateを生成
    const stateStr = Math.random().toString(36).substring(7);
    localStorage.setItem('concept2_oauth_state', stateStr);

    // リダイレクトURI (callback.html)
    const redirectUri = window.location.origin + '/callback.html';

    // 認証ページへリダイレクト
    const authUrl = `https://log.concept2.com/oauth/authorize?client_id=${clientId}&scope=user:read,results:read&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&state=${stateStr}`;

    window.location.href = authUrl;
}

// アクセストークンを検証して連携（Vercel APIプロキシ経由）
async function validateAndConnectConcept2(accessToken) {
    try {
        // Vercel APIプロキシ経由でConcept2 APIを呼び出し（CORS回避）
        const response = await fetch(API_BASE + '/api/concept2-proxy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'verify',
                access_token: accessToken
            })
        });

        const result = await response.json();

        if (!response.ok || !result.success) {
            if (response.status === 401) {
                showToast('アクセストークンが無効です', 'error');
            } else {
                showToast('接続エラー: ' + (result.error || response.status), 'error');
            }
            return;
        }

        const userData = result.user;

        // 成功 - ユーザー情報を更新
        state.currentUser.concept2Connected = true;
        state.currentUser.concept2Token = accessToken;
        state.currentUser.concept2UserId = userData?.id;
        state.currentUser.concept2Username = userData?.username;
        state.currentUser.concept2LastSync = new Date().toISOString();

        const idx = state.users.findIndex(u => u.id === state.currentUser.id);
        if (idx !== -1) state.users[idx] = state.currentUser;
        DB.save('users', state.users);
        DB.save('current_user', state.currentUser);

        // Supabaseにも保存（トークン含む）
        syncProfileToSupabase({
            concept2_connected: true,
            concept2_access_token: accessToken,
            concept2_last_sync: new Date().toISOString()
        });

        showToast('Concept2と連携しました！(' + (userData?.username || 'User') + ')', 'success');

        // UI更新
        updateConcept2UI();

        // データを取得
        await fetchConcept2Data();

        // オンボーディング画面からの場合はメイン画面へ
        if (!document.getElementById('main-screen').classList.contains('hidden') === false) {
            initMainScreen();
            showScreen('main-screen');
        }

    } catch (error) {
        console.error('Connection error:', error);
        showToast('接続エラー: ' + error.message, 'error');
    }
}

// Edge Function経由でトークンを検証（CORSエラー対策）
async function validateAndConnectConcept2ViaEdgeFunction(accessToken) {
    try {
        if (!window.supabaseClient) {
            throw new Error('Supabase client not initialized');
        }

        const { data, error } = await window.supabaseClient.functions.invoke('concept2-auth', {
            body: {
                action: 'verify_token',
                access_token: accessToken
            }
        });

        if (error) throw error;

        if (!data.success) {
            throw new Error(data.error || 'Verification failed');
        }

        const userData = data.user;

        // 成功 - ユーザー情報を更新
        state.currentUser.concept2Connected = true;
        state.currentUser.concept2UserId = userData.id;
        state.currentUser.concept2Username = userData.username;
        state.currentUser.concept2LastSync = new Date().toISOString();

        const idx = state.users.findIndex(u => u.id === state.currentUser.id);
        if (idx !== -1) state.users[idx] = state.currentUser;
        DB.save('users', state.users);
        DB.save('current_user', state.currentUser);

        // Supabaseにも保存
        syncProfileToSupabase({
            concept2_connected: true,
            concept2_last_sync: new Date().toISOString()
        });

        showToast('Concept2と連携しました！', 'success');
        updateConcept2UI();

        // オンボーディング画面からの場合はメイン画面へ
        if (!document.getElementById('main-screen').classList.contains('hidden') === false) {
            initMainScreen();
            showScreen('main-screen');
        }

    } catch (error) {
        console.error('Edge function connection error:', error);
        showToast('接続エラー: ' + error.message, 'error');
    }
}

// Concept2データを処理
function processConceptData(results) {
    results.forEach(raw => {
        const existing = state.ergoRaw.find(r => r.concept2Id === raw.concept2Id);
        if (!existing) {
            state.ergoRaw.push({
                ...raw,
                userId: state.currentUser.id,
                createdAt: new Date().toISOString()
            });
        }
    });

    DB.save('ergoRaw', state.ergoRaw);
    classifyErgoSessions();
    renderErgoRecords();
}


function updateConcept2UI() {
    const user = state.currentUser;
    if (!user) return;

    const isConnected = user.concept2Connected;

    // === 設定画面のUI更新 ===
    const statusEl = document.getElementById('concept2-status');
    if (statusEl) statusEl.textContent = isConnected ? '連携済み' : '未連携';

    const toggleBtn = document.getElementById('toggle-concept2-btn');
    if (toggleBtn) toggleBtn.textContent = isConnected ? '連携解除' : '連携する';

    const setupEl = document.getElementById('concept2-setup');
    if (setupEl) {
        setupEl.classList.toggle('hidden', isConnected);
    }

    const settingSyncBtn = document.getElementById('sync-concept2-btn');
    if (settingSyncBtn) {
        settingSyncBtn.classList.toggle('hidden', !isConnected);
    }

    const lastSyncEl = document.getElementById('concept2-last-sync');
    const lastSyncTimeEl = document.getElementById('concept2-last-sync-time');
    if (lastSyncEl && lastSyncTimeEl) {
        if (isConnected && user.concept2LastSync) {
            lastSyncEl.classList.remove('hidden');
            const syncDate = new Date(user.concept2LastSync);
            lastSyncTimeEl.textContent = `${syncDate.getMonth() + 1}/${syncDate.getDate()} ${syncDate.getHours()}:${String(syncDate.getMinutes()).padStart(2, '0')}`;
        } else {
            lastSyncEl.classList.add('hidden');
        }
    }

    // === データタブのUI更新 ===
    const banner = document.getElementById('concept2-banner');
    const syncArea = document.getElementById('concept2-sync-area');

    if (isConnected) {
        if (banner) banner.classList.add('hidden');
        if (syncArea) syncArea.classList.remove('hidden');
    } else {
        if (banner) banner.classList.remove('hidden');
        if (syncArea) syncArea.classList.add('hidden');
    }
}

function toggleConcept2() {
    if (state.currentUser.concept2Connected) {
        disconnectConcept2();
    } else {
        connectConcept2();
    }
}

// Concept2からデータを取得（全ページ対応）
async function fetchConcept2Data() {
    if (!state.currentUser?.concept2Connected) {
        return;
    }

    const accessToken = state.currentUser.concept2Token;

    if (!accessToken) {
        return;
    }

    showToast('データを同期中...', 'success');

    try {
        // 直接Concept2 APIを呼び出す（全ページ取得）

        let allResults = [];
        let page = 1;
        let hasMore = true;

        while (hasMore) {
            const url = `https://log.concept2.com/api/users/me/results?type=rower&number=250&page=${page}`;

            const response = await fetch(url, {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Accept': 'application/vnd.c2logbook.v1+json',
                },
            });

            if (!response.ok) {
                if (response.status === 401) {
                    showToast('アクセストークンが期限切れです。再連携してください。', 'error');
                    return;
                }
                throw new Error('API error: ' + response.status);
            }

            const data = await response.json();
            const pageResults = data.data || [];

            allResults = allResults.concat(pageResults);

            // 250件未満なら最後のページ
            if (pageResults.length < 250) {
                hasMore = false;
            } else {
                page++;
                // 安全のために最大20ページまで（5000件）
                if (page > 20) {
                    console.warn('Reached max page limit (20)');
                    hasMore = false;
                }
            }
        }


        if (allResults.length > 0) {
            let newCount = 0;
            // 結果を整形して保存
            allResults.forEach(result => {
                const existing = state.ergoRaw.find(r => r.concept2Id === result.id.toString());
                if (!existing) {
                    newCount++;
                    // ワークアウト情報からインターバル詳細を取得
                    const workout = result.workout || {};
                    let intervalDisplay = '';

                    // インターバル表記＆タイプ判定
                    const intervalInfo = calculateIntervalDetails(workout, result.workout_type);
                    intervalDisplay = intervalInfo.display;
                    const calculatedWorkoutType = intervalInfo.type;

                    state.ergoRaw.push({
                        id: `c2_${result.id}`,
                        concept2Id: result.id.toString(),
                        date: result.date?.split(' ')[0] || result.date,
                        type: result.type,
                        distance: result.distance,
                        time: result.time / 10, // Concept2は1/10秒単位
                        timeFormatted: result.time_formatted,
                        averageSPM: result.stroke_rate || null,
                        workoutType: calculatedWorkoutType,
                        intervalDisplay: intervalDisplay, // "20min×2" 形式
                        splits: workout.splits || [],     // 500mスプリットデータ
                        intervals: workout.intervals || [], // インターバルデータ
                        restTime: result.rest_time || 0,
                        restDistance: result.rest_distance || 0,
                        source: result.source,
                        verified: result.verified,
                        userId: state.currentUser.id,
                        createdAt: new Date().toISOString()
                    });
                }
            });

            DB.save('ergoRaw', state.ergoRaw);

            // 最終同期時刻を更新
            state.currentUser.concept2LastSync = new Date().toISOString();
            const idx = state.users.findIndex(u => u.id === state.currentUser.id);
            if (idx !== -1) state.users[idx] = state.currentUser;
            DB.save('users', state.users);
            DB.save('current_user', state.currentUser);

            // セッションに分類（全データ再分類）
            classifyErgoSessions(true);
            renderErgoRecords();
            updateConcept2UI();

            showToast(`${allResults.length}件取得（新規 ${newCount}件）`, 'success');
        } else {
            showToast('新しいデータはありません', 'success');
        }

    } catch (error) {
        console.error('API fetch error:', error);

        // CORSエラーの場合はEdge Functionを使用
        if (error.message.includes('Failed to fetch') || error.name === 'TypeError') {
            await fetchConcept2DataViaEdgeFunction(accessToken);
        } else {
            showToast('データ取得エラー: ' + error.message, 'error');
        }
    }
}

// Edge Function経由でConcept2データを取得（CORSエラー対策）
async function fetchConcept2DataViaEdgeFunction(accessToken) {
    try {
        const response = await fetch(CONCEPT2_API.edgeFunctionUrl + '/concept2-sync', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                access_token: accessToken,
                user_id: state.currentUser.id,
            }),
        });

        const result = await response.json();

        if (!response.ok) {
            // トークン期限切れの場合、リフレッシュを試みる
            if (response.status === 401 && result.need_refresh) {
                const refreshed = await refreshConcept2Token();
                if (refreshed) {
                    // リフレッシュ成功したら再試行
                    return fetchConcept2DataViaEdgeFunction(state.currentUser.concept2Token);
                } else {
                    showToast('アクセストークンが期限切れです。再連携してください。', 'error');
                    return;
                }
            }
            throw new Error(result.error || 'Failed to fetch data');
        }

        if (result.results && result.results.length > 0) {
            processConceptData(result.results);

            // 最終同期時刻を更新
            state.currentUser.concept2LastSync = new Date().toISOString();
            const idx = state.users.findIndex(u => u.id === state.currentUser.id);
            if (idx !== -1) state.users[idx] = state.currentUser;
            DB.save('users', state.users);
            DB.save('current_user', state.currentUser);

            updateConcept2UI();
            showToast(`${result.results.length}件のデータを同期しました`, 'success');
        } else {
            showToast('新しいデータはありません', 'success');
        }

    } catch (error) {
        console.error('Edge Function fetch error:', error);
        showToast('データ取得エラー: ' + error.message, 'error');
    }
}

// トークンをリフレッシュ
async function refreshConcept2Token() {
    try {
        const refreshToken = state.currentUser.concept2RefreshToken;
        if (!refreshToken) {
            console.warn('No refresh token available');
            return false;
        }

        showToast('トークンを更新中...', 'info');

        const response = await fetch(CONCEPT2_API.edgeFunctionUrl + '/concept2-auth', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                grant_type: 'refresh_token',
                refresh_token: refreshToken
            })
        });

        if (!response.ok) {
            const err = await response.json();
            console.error('RefreshToken Error:', err);
            return false;
        }

        const data = await response.json();
        // 新しいトークンを保存
        state.currentUser.concept2Token = data.access_token;
        state.currentUser.concept2RefreshToken = data.refresh_token;
        state.currentUser.concept2TokenExpiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();

        DB.save('current_user', state.currentUser);
        const idx = state.users.findIndex(u => u.id === state.currentUser.id);
        if (idx !== -1) {
            state.users[idx] = state.currentUser;
            DB.save('users', state.users);
        }

        // Supabaseに新しいトークンを保存
        syncProfileToSupabase({
            concept2_access_token: data.access_token,
            concept2_last_sync: new Date().toISOString()
        });

        return true;

    } catch (e) {
        console.error('Refresh token exception:', e);
        return false;
    }
}

// エルゴセッションを分類（拡張メニュー対応）
function classifyErgoSessions(reclassify = false) {
    const newlyAddedRecordIds = []; // 新規追加されたレコードIDを追跡
    try {
        // CONCEPT2_API.classificationRulesを使用
        const rules = CONCEPT2_API.classificationRules;

        const userRaw = state.ergoRaw.filter(r => r.userId === state.currentUser.id);

        // 再分類の場合は既存データをクリア
        if (reclassify) {
            state.ergoSessions = state.ergoSessions.filter(s => s.userId !== state.currentUser.id);
            state.ergoRecords = state.ergoRecords.filter(r => r.userId !== state.currentUser.id);
        }

        userRaw.forEach(raw => {
            // データ補正（インターバル詳細）- 常に再計算して分類を修正
            // raw.type: Concept2のresult.type（"rower"等）であり、workout_typeではない
            // raw.workoutType: Concept2のworkout_type（FixedDistanceInterval等）
            if (raw.intervals && raw.intervals.length > 0) {
                const originalType = raw.workoutType || 'unknown'; // raw.typeは"rower"等なので使わない
                const intervalInfo = calculateIntervalDetails({ intervals: raw.intervals }, originalType);
                raw.intervalDisplay = intervalInfo.display;
                raw.workoutType = intervalInfo.type;
            }

            // JustRow: 5分(300秒)以上 or 500m以上のみ保存、それ未満は除外
            if (raw.workoutType === 'JustRow') {
                const timeSec = raw.time || 0;
                const dist = raw.distance || 0;
                if (timeSec < 300 && dist < 500) return; // 基準未満は除外
            }

            // 既に分類済みかチェック（再分類でない場合）
            if (!reclassify) {
                const existingSession = state.ergoSessions.find(s => s.rawId === raw.id);
                const existingByConcept2 = state.ergoRecords.find(r => r.concept2Id && r.concept2Id === String(raw.concept2Id || ''));
                if (existingSession || existingByConcept2) return;
            }

            // ルール適用
            let menuKey = 'その他';
            let category = 'other';

            // インターバルを先に判定
            const intervalTypes = ['FixedDistanceInterval', 'FixedTimeInterval', 'VariableInterval'];
            if (intervalTypes.includes(raw.workoutType)) {
                // インターバルも距離/時間ルールで分類
                if (raw.intervals && raw.intervals.length > 0) {
                    const firstInterval = raw.intervals[0];
                    const intDist = firstInterval.distance || 0;
                    const intTime = firstInterval.time ? Math.round(firstInterval.time / 10) : 0; // 1/10秒→秒
                    let intMenuKey = null;
                    // 距離ルールでマッチ
                    for (const rule of rules) {
                        if (rule.type === 'distance' && intDist >= rule.min && intDist <= rule.max) {
                            intMenuKey = rule.key;
                            break;
                        } else if (rule.type === 'time' && intTime >= rule.min && intTime <= rule.max) {
                            intMenuKey = rule.key;
                            break;
                        }
                    }
                    // レストタイムを取得
                    const restTime = firstInterval.rest_time ? Math.round(firstInterval.rest_time / 10) : 0;
                    const restStr = restTime > 0 ? (restTime >= 60 ? `r${Math.floor(restTime / 60)}分${restTime % 60 > 0 ? (restTime % 60 + '秒') : ''}` : `r${restTime}秒`) : '';
                    if (intMenuKey) {
                        menuKey = `${intMenuKey}×${raw.intervals.length}${restStr ? ' ' + restStr : ''}`;
                    } else {
                        menuKey = raw.intervalDisplay || 'インターバル';
                        if (restStr) menuKey += ' ' + restStr;
                    }
                } else {
                    menuKey = raw.intervalDisplay || 'インターバル';
                }
                category = 'interval';
            } else if (raw.workoutType === 'JustRow') {
                // JustRow分類（基準クリア済みのみここに到達）
                menuKey = 'JustRow';
                category = 'other';
            } else {
                // workoutTypeに基づいて距離/時間を判別
                const isDistanceWkt = raw.workoutType === 'FixedDistanceSplits';
                const isTimeWkt = raw.workoutType === 'FixedTimeSplits';

                for (const rule of rules) {
                    if (rule.type === 'distance' && raw.distance >= rule.min && raw.distance <= rule.max) {
                        if (isTimeWkt) continue;
                        menuKey = rule.key;
                        category = 'distance';
                        break;
                    } else if (rule.type === 'time' && raw.time >= rule.min && raw.time <= rule.max) {
                        if (isDistanceWkt) continue;
                        menuKey = rule.key;
                        category = 'time';
                        break;
                    }
                }
            }

            // セッションを作成
            const session = {
                id: generateId(),
                rawId: raw.id,
                userId: state.currentUser.id,
                date: raw.date,
                menuKey: menuKey,
                category: category,
                distance: raw.distance,
                time: raw.time,
                split: formatSplit(raw.time, raw.distance),
                strokeRate: raw.averageSPM,
                workoutType: raw.workoutType,
                source: 'Concept2',
                createdAt: new Date().toISOString()
            };

            state.ergoSessions.push(session);

            // ergoRecordsにも追加（データタブで表示）
            // 当日の体重を自動付与
            const dayWeight = getWeightForDate(state.currentUser.id, raw.date);
            const newRecordId = generateId();
            state.ergoRecords.push({
                id: newRecordId,
                rawId: raw.id, // rawDataへの参照を保持
                concept2Id: String(raw.concept2Id || ''),
                userId: state.currentUser.id,
                date: raw.date,
                distance: raw.distance,
                time: raw.time,
                timeSeconds: Math.round(raw.time),
                timeDisplay: formatTime(raw.time),
                split: session.split,
                strokeRate: raw.averageSPM,
                weight: dayWeight,
                menuKey: menuKey,
                category: category,
                source: 'Concept2'
            });
            newlyAddedRecordIds.push(newRecordId);
        });

        DB.save('ergoSessions', state.ergoSessions);
        DB.save('ergo_records', state.ergoRecords);

        // Supabaseにもergo_recordsを同期（バックグラウンド・新規追加分のみ）
        // 大量同期時はsync-indicatorの頻繁更新を抑制
        if (DB.useSupabase && window.SupabaseConfig?.db && newlyAddedRecordIds.length > 0) {
            const newRecords = state.ergoRecords.filter(r => newlyAddedRecordIds.includes(r.id));
            if (window.SupabaseConfig.suppressSyncIndicator) window.SupabaseConfig.suppressSyncIndicator(true);
            showSyncStatus('syncing');
            Promise.all(newRecords.map(record => {
                const supaRecord = {
                    ...record,
                    rawData: { concept2Id: record.concept2Id || '' }
                };
                return window.SupabaseConfig.db.saveErgoRecord(supaRecord).catch(e => {
                    console.warn('Ergo record sync failed:', record.id, e);
                });
            })).then(() => {
                if (window.SupabaseConfig.suppressSyncIndicator) window.SupabaseConfig.suppressSyncIndicator(false);
                showSyncStatus('success');
            }).catch(() => {
                if (window.SupabaseConfig.suppressSyncIndicator) window.SupabaseConfig.suppressSyncIndicator(false);
                showSyncStatus('error');
            });
        }
    } catch (error) {
        console.error('Error in classifyErgoSessions:', error);
    }
}

// スプリットをフォーマット
function formatSplit(timeSeconds, distance) {
    if (!distance || !timeSeconds) return '-';
    const splitSeconds = (timeSeconds / distance) * 500;
    const min = Math.floor(splitSeconds / 60);
    const sec = (splitSeconds % 60).toFixed(1);
    return `${min}:${sec.padStart(4, '0')}`;
}

// 記録からスプリットを取得（なければ計算）
function getSplit(record) {
    if (record.split && record.split !== '-') return record.split;

    // スプリットがない場合、timeとdistanceから計算
    const distance = record.distance;
    let time = record.time || record.timeSeconds; // ergoSessionsはtime, ergoRecordsはtimeSeconds

    if (!time && record.timeDisplay) {
        time = parseTimeString(record.timeDisplay);
    }

    if (distance && time) {
        return formatSplit(time, distance);
    }
    return '-';
}

// 時間をフォーマット
function formatTime(seconds) {
    const min = Math.floor(seconds / 60);
    const sec = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 10);
    return `${min}:${sec.toString().padStart(2, '0')}.${ms}`;
}

// 時間文字列を秒に変換（mm:ss.s -> seconds）
function parseTimeString(timeStr) {
    if (!timeStr) return 0;
    const parts = timeStr.split(':');
    if (parts.length === 2) {
        const min = parseInt(parts[0], 10);
        const sec = parseFloat(parts[1]);
        return (min * 60) + sec;
    }
    return parseFloat(timeStr) || 0;
}

// Concept2データからmenuKeyとcategoryを分類
function classifyConcept2Result(result) {
    const distance = result.distance || 0;
    const timeSec = result.time ? result.time / 10 : 0; // Concept2は1/10秒単位
    const workoutType = result.workout_type || '';
    const rules = CONCEPT2_API.classificationRules;

    // インターバルを先に判定
    const intervalTypes = ['FixedDistanceInterval', 'FixedTimeInterval', 'VariableInterval'];
    if (intervalTypes.includes(workoutType)) {
        const intervals = result.workout?.intervals || [];
        let intervalDisplay = 'インターバル';
        if (intervals.length > 0) {
            const first = intervals[0];
            const intDist = first.distance || 0;
            const intTimeSec = first.time ? Math.round(first.time / 10) : 0;
            let intMenuKey = null;
            // 距離/時間ルールでマッチ
            for (const rule of rules) {
                if (rule.type === 'distance' && intDist >= rule.min && intDist <= rule.max) {
                    intMenuKey = rule.key;
                    break;
                } else if (rule.type === 'time' && intTimeSec >= rule.min && intTimeSec <= rule.max) {
                    intMenuKey = rule.key;
                    break;
                }
            }
            // レストタイム
            const restTime = first.rest_time ? Math.round(first.rest_time / 10) : 0;
            const restStr = restTime > 0 ? (restTime >= 60 ? `r${Math.floor(restTime / 60)}分${restTime % 60 > 0 ? (restTime % 60 + '秒') : ''}` : `r${restTime}秒`) : '';
            if (intMenuKey) {
                intervalDisplay = `${intMenuKey}×${intervals.length}${restStr ? ' ' + restStr : ''}`;
            } else {
                if (intDist > 0) {
                    intervalDisplay = `${intDist}m×${intervals.length}${restStr ? ' ' + restStr : ''}`;
                } else if (intTimeSec > 0) {
                    if (intTimeSec >= 60) {
                        intervalDisplay = `${Math.round(intTimeSec / 60)}分×${intervals.length}${restStr ? ' ' + restStr : ''}`;
                    } else {
                        intervalDisplay = `${intTimeSec}秒×${intervals.length}${restStr ? ' ' + restStr : ''}`;
                    }
                }
            }
        }
        return { menuKey: intervalDisplay, category: 'interval' };
    }

    // JustRow判定: 5分以上 or 500m以上のみ保存
    if (workoutType === 'JustRow') {
        if (timeSec < 300 && distance < 500) {
            return { menuKey: 'JustRow_skip', category: 'skip' }; // 基準未満
        }
        return { menuKey: 'JustRow', category: 'other' };
    }

    // workoutTypeに基づいて距離/時間を判別
    const isDistanceWorkout = workoutType === 'FixedDistanceSplits';
    const isTimeWorkout = workoutType === 'FixedTimeSplits';

    for (const rule of rules) {
        if (rule.type === 'distance' && distance >= rule.min && distance <= rule.max) {
            if (isTimeWorkout) continue;
            return { menuKey: rule.key, category: 'distance' };
        } else if (rule.type === 'time' && timeSec >= rule.min && timeSec <= rule.max) {
            if (isDistanceWorkout) continue;
            return { menuKey: rule.key, category: 'time' };
        }
    }

    return { menuKey: 'その他', category: 'other' };
}

// Concept2データを同期（Vercel APIプロキシ経由・全ページ取得）
async function syncConcept2() {
    if (!state.currentUser?.concept2Connected || !state.currentUser?.concept2Token) {
        showToast('Concept2と連携してください', 'error');
        return;
    }

    showToast('Concept2データを同期中...', 'info');
    const syncBtn = document.getElementById('manual-sync-btn');
    const settingSyncBtn = document.getElementById('sync-concept2-btn');

    if (syncBtn) syncBtn.disabled = true;
    if (settingSyncBtn) settingSyncBtn.disabled = true;

    try {
        // Vercel APIプロキシ経由でデータ取得（ページごとにループ）
        let allResults = [];
        let currentPage = 1;
        let hasMore = true;

        while (hasMore && currentPage <= 50) {
            showToast(`Concept2データ取得中... ページ${currentPage}`, 'info');

            const response = await fetch(API_BASE + '/api/concept2-proxy', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'sync',
                    access_token: state.currentUser.concept2Token,
                    page: currentPage
                })
            });

            const data = await response.json();

            if (!response.ok || !data.success) {
                if (response.status === 401) {
                    showToast('トークンが期限切れです。再連携してください', 'error');
                    state.currentUser.concept2Connected = false;
                    DB.save('current_user', state.currentUser);
                    updateConcept2UI();
                    return;
                }
                // 最初のページでエラーならabort、2ページ目以降ならここまでのデータで進む
                if (currentPage === 1) {
                    throw new Error(data.error || '同期に失敗しました');
                }
                break;
            }

            const pageResults = data.results || [];
            allResults = allResults.concat(pageResults);
            hasMore = data.hasMore || false;
            currentPage++;

        }

        const results = allResults;

        // ローカルのエルゴ記録・セッションに統合
        let existingRecords = DB.load('ergo_records') || [];
        let existingSessions = DB.load('ergoSessions') || [];
        let insertedCount = 0;

        for (const result of results) {
            const concept2Id = String(result.id);
            // 既存データにあるか確認
            const exists = existingRecords.some(r => r.concept2Id === concept2Id);
            if (exists) continue;

            // menuKey/categoryを分類
            const { menuKey, category } = classifyConcept2Result(result);

            // 基準未満のJustRow（5分未満かつ500m未満）はスキップ
            if (category === 'skip') continue;

            const timeSec = result.time ? result.time / 10 : 0;
            const distance = result.distance || 0;
            const recordDate = result.date?.split('T')[0] || new Date().toISOString().split('T')[0];
            const splitStr = (distance > 0 && timeSec > 0) ? formatSplit(timeSec, distance) : '-';
            const recordId = 'c2_' + concept2Id;
            const workout = result.workout || {};

            // インターバル情報の計算
            const intervalInfo = calculateIntervalDetails(workout, result.workout_type);

            // ergoRawに保存（スプリット/インターバルデータ含む）
            const existingRaw = state.ergoRaw?.find(r => r.concept2Id === concept2Id);
            if (!existingRaw) {
                const rawRecord = {
                    id: recordId,
                    concept2Id: concept2Id,
                    date: recordDate,
                    type: result.workout_type,
                    distance: distance,
                    time: timeSec,
                    timeFormatted: result.time_formatted,
                    averageSPM: result.stroke_rate || null,
                    workoutType: intervalInfo.type || result.workout_type || 'FixedDistanceSplits',
                    intervalDisplay: intervalInfo.display,
                    splits: workout.splits || [],
                    intervals: workout.intervals || [],
                    restTime: result.rest_time || 0,
                    restDistance: result.rest_distance || 0,
                    source: result.source,
                    verified: result.verified,
                    userId: state.currentUser.id,
                    createdAt: new Date().toISOString()
                };
                if (!state.ergoRaw) state.ergoRaw = [];
                state.ergoRaw.push(rawRecord);
            }

            // ergoRecordsに追加
            const newRecord = {
                id: recordId,
                rawId: recordId,
                concept2Id: concept2Id,
                userId: state.currentUser.id,
                userName: state.currentUser.name,
                date: recordDate,
                distance: distance,
                time: timeSec,
                timeSeconds: Math.round(timeSec),
                timeDisplay: formatTime(timeSec),
                split: splitStr,
                strokeRate: result.stroke_rate || 0,
                heartRate: result.heart_rate?.average || null,
                workoutType: intervalInfo.type || result.workout_type || 'FixedDistanceSplits',
                menuKey: menuKey,
                category: category,
                intervals: workout.intervals || [],
                splits: workout.splits || [],
                rawData: result,
                source: 'Concept2',
                createdAt: new Date().toISOString()
            };
            existingRecords.push(newRecord);

            // ergoSessionsにも追加（ランキング用）
            existingSessions.push({
                id: generateId(),
                rawId: recordId,
                userId: state.currentUser.id,
                date: recordDate,
                menuKey: menuKey,
                category: category,
                distance: distance,
                time: timeSec,
                timeDisplay: formatTime(timeSec),
                split: splitStr,
                strokeRate: result.stroke_rate || 0,
                workoutType: intervalInfo.type || result.workout_type || 'FixedDistanceSplits',
                source: 'Concept2',
                createdAt: new Date().toISOString()
            });

            insertedCount++;
        }

        // ローカル保存
        DB.save('ergo_records', existingRecords);
        DB.save('ergoSessions', existingSessions);
        DB.save('ergoRaw', state.ergoRaw);

        // stateも更新
        state.ergoRecords = existingRecords;
        state.ergoSessions = existingSessions;

        // Supabaseにもエルゴ記録を保存
        if (insertedCount > 0 && DB.useSupabase && window.SupabaseConfig?.isReady()) {
            try {
                // Supabaseに既に保存されているレコードのconcept2Idリストを取得
                const supabaseRecords = await window.SupabaseConfig.db.loadErgoRecords(state.currentUser.id);
                const savedConcept2Ids = new Set();
                supabaseRecords.forEach(r => {
                    if (r.rawData?.concept2Id) savedConcept2Ids.add(r.rawData.concept2Id);
                    // sourceフィールドからも検出（旧形式対応）
                    if (r.concept2Id) savedConcept2Ids.add(r.concept2Id);
                });

                // Supabaseにまだ保存されていないConcept2レコードだけ抽出
                // source は 'concept2' または 'Concept2' の両方を対象
                const unsavedRecords = existingRecords.filter(r =>
                    (r.source === 'concept2' || r.source === 'Concept2') &&
                    r.concept2Id && !savedConcept2Ids.has(r.concept2Id)
                );

                // sync-indicator抑制+バッチ処理
                if (window.SupabaseConfig.suppressSyncIndicator) window.SupabaseConfig.suppressSyncIndicator(true);
                showSyncStatus('syncing');
                let supabaseSaved = 0;
                for (let i = 0; i < unsavedRecords.length; i += 5) {
                    const batch = unsavedRecords.slice(i, i + 5);
                    const results = await Promise.allSettled(batch.map(record =>
                        DB.saveErgoRecord({
                            id: generateId(),
                            userId: record.userId,
                            date: record.date,
                            distance: record.distance,
                            timeSeconds: record.time || record.timeSeconds,
                            timeDisplay: record.timeDisplay,
                            split: record.split,
                            strokeRate: record.strokeRate,
                            heartRate: record.heartRate,
                            menuKey: record.menuKey,
                            category: record.category,
                            source: 'Concept2',
                            rawData: { concept2Id: record.concept2Id }
                        })
                    ));
                    supabaseSaved += results.filter(r => r.status === 'fulfilled').length;
                }
                if (window.SupabaseConfig.suppressSyncIndicator) window.SupabaseConfig.suppressSyncIndicator(false);
                showSyncStatus('success');
                // sync completed
            } catch (e) {
                if (window.SupabaseConfig.suppressSyncIndicator) window.SupabaseConfig.suppressSyncIndicator(false);
                showSyncStatus('error');
                console.warn('Supabase ergo sync error:', e);
            }
        }

        // 最終同期日時を更新
        state.currentUser.concept2LastSync = new Date().toISOString();
        DB.save('current_user', state.currentUser);

        // Supabaseのプロフィールにも最終同期日を反映
        syncProfileToSupabase({
            concept2_last_sync: state.currentUser.concept2LastSync
        });

        showToast(`同期完了: ${insertedCount}件の新しいデータを取得（全${results.length}件中）`, 'success');

        // UI更新
        updateConcept2UI();
        if (typeof renderSettings === 'function') renderSettings();
        if (typeof renderErgoRecords === 'function') renderErgoRecords();

    } catch (err) {
        console.error('Sync error:', err);
        showToast('同期エラー: ' + err.message, 'error');
    } finally {
        if (syncBtn) syncBtn.disabled = false;
        if (settingSyncBtn) settingSyncBtn.disabled = false;
    }
}

// =========================================
// メイン画面初期化
// =========================================
function initMainScreen() {
    const user = state.currentUser;

    document.getElementById('user-name').textContent = user.name;
    document.getElementById('user-role').textContent = user.role;
    document.getElementById('settings-name').textContent = user.name;

    // Concept2 UI更新
    updateConcept2UI();

    // 権限に応じたタブ表示
    if (!canViewOverview(user)) {
        document.getElementById('nav-overview').style.display = 'none';

    }

    // マスタ管理表示
    if (canEditMaster(user)) {
        document.getElementById('master-settings').classList.remove('hidden');
    }

    // Concept2バナー
    if (!user.concept2Connected) {
        document.getElementById('concept2-banner').classList.remove('hidden');
    } else {
        document.getElementById('concept2-banner').classList.add('hidden');
    }

    state.currentWeekStart = getWeekStart(new Date());
    state.currentDiaryDate = new Date();

    // 分類ロジック更新時のワンタイム再分類マイグレーション
    const CLASSIFICATION_VERSION = 3; // インターバル分類バグ修正（raw.type優先順位）
    const savedVersion = parseInt(localStorage.getItem('ergo_classification_version') || '0');
    if (savedVersion < CLASSIFICATION_VERSION) {
        classifyErgoSessions(true);
        localStorage.setItem('ergo_classification_version', String(CLASSIFICATION_VERSION));
    }

    renderWeekCalendar();
    initOverviewDate();
    populateBoatOarSelects();
    initDataViewToggle();
}

// 手動で全エルゴデータを再分類
function reclassifyAllErgoData() {
    showConfirmModal('全エルゴデータの分類をやり直します。よろしいですか？', async () => {
        classifyErgoSessions(true);
        DB.save('ergo_records', state.ergoRecords);
        DB.save('ergoSessions', state.ergoSessions);

        // Supabaseに全ergoRecordsを再同期（大量同期時はsync-indicator抑制）
        if (DB.useSupabase && window.SupabaseConfig?.db) {
            const allRecords = state.ergoRecords.filter(r =>
                r.userId === state.currentUser.id
            );
            if (window.SupabaseConfig.suppressSyncIndicator) window.SupabaseConfig.suppressSyncIndicator(true);
            showSyncStatus('syncing');
            let synced = 0;
            let failed = 0;
            for (let i = 0; i < allRecords.length; i += 5) {
                const batch = allRecords.slice(i, i + 5);
                const results = await Promise.allSettled(batch.map(record => {
                    const supaRecord = {
                        ...record,
                        rawData: record.rawData || (record.concept2Id ? { concept2Id: record.concept2Id } : null)
                    };
                    return window.SupabaseConfig.db.saveErgoRecord(supaRecord);
                }));
                results.forEach(r => r.status === 'fulfilled' ? synced++ : failed++);
            }
            if (window.SupabaseConfig.suppressSyncIndicator) window.SupabaseConfig.suppressSyncIndicator(false);
            showSyncStatus(failed > 0 ? 'error' : 'success');
            if (synced > 0) showToast(synced + ' records synced', 'success');
        }

        renderErgoRecords();
        showToast('エルゴデータを再分類しました', 'success');
    }, null, '再分類する');
}

// =========================================
// 入力タブ - 週カレンダー
// =========================================
function renderWeekCalendar() {
    const container = document.getElementById('week-calendar');
    const weekRange = document.getElementById('week-range');


    const weekEnd = new Date(state.currentWeekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);

    const fmt = (d) => `${d.getMonth() + 1}/${d.getDate()}`;
    weekRange.textContent = `${fmt(state.currentWeekStart)}〜${fmt(weekEnd)}`;

    container.innerHTML = '';
    const today = formatDate(new Date());
    const dayLabels = ['月', '火', '水', '木', '金', '土', '日'];

    // --- カレンダーストリップ（クイック入力） ---
    const typeIconMap = {
        [SCHEDULE_TYPES.ERGO]: '🏋️',
        [SCHEDULE_TYPES.BOAT]: '🚣',
        [SCHEDULE_TYPES.WEIGHT]: '💪',
        [SCHEDULE_TYPES.RUN]: '🏃',
        [SCHEDULE_TYPES.BANCHA]: '🚴',
        [SCHEDULE_TYPES.MEAL]: '🍳',
        [SCHEDULE_TYPES.VIDEO]: '🎥',
        [SCHEDULE_TYPES.OFF]: '🏖️',
        [SCHEDULE_TYPES.ABSENT]: '❌'
    };

    let stripHtml = '';
    for (let i = 0; i < 7; i++) {
        const d = new Date(state.currentWeekStart);
        d.setDate(d.getDate() + i);
        const dateStr = formatDate(d);
        const dayNum = d.getDate();
        const isToday = dateStr === today;
        const isPast = dateStr < today;
        const isFuture = dateStr > today;
        const dow = d.getDay();
        const dayIdx = dow === 0 ? 6 : dow - 1;
        const dayLabelCls = dow === 0 ? 'sunday' : (dow === 6 ? 'saturday' : '');

        // ユーザーのその日のスケジュール
        const daySchedules = state.schedules.filter(s =>
            s.userId === state.currentUser?.id && s.date === dateStr
        );
        let iconsHtml = '';
        if (daySchedules.length > 0) {
            iconsHtml = daySchedules.map(s => {
                const icon = typeIconMap[s.scheduleType] || '📋';
                return `<span class="iws-icon">${icon}</span>`;
            }).join('');
        } else if (isPast) {
            iconsHtml = '<span class="iws-icon empty">—</span>';
        } else {
            iconsHtml = '<span class="iws-icon empty">+</span>';
        }

        stripHtml += `
            <div class="iws-day ${isToday ? 'today' : ''} ${isPast ? 'past' : ''} ${isFuture ? 'future' : ''}" data-date="${dateStr}">
                <span class="iws-day-label ${dayLabelCls}">${dayLabels[dayIdx]}</span>
                <span class="iws-day-num">${dayNum}</span>
                <div class="iws-day-icons">${iconsHtml}</div>
            </div>`;
    }

    const stripEl = document.createElement('div');
    stripEl.className = 'input-week-strip';
    stripEl.innerHTML = stripHtml;
    container.appendChild(stripEl);

    // ストリップクリックイベント
    stripEl.querySelectorAll('.iws-day').forEach(dayEl => {
        dayEl.addEventListener('click', () => {
            const dateStr = dayEl.dataset.date;
            const amSchedule = state.schedules.find(s =>
                s.userId === state.currentUser?.id && s.date === dateStr && s.timeSlot === '午前'
            );
            openInputModal(dateStr, amSchedule ? '午後' : '午前', amSchedule ? (state.schedules.find(s => s.userId === state.currentUser?.id && s.date === dateStr && s.timeSlot === '午後')?.id || null) : (amSchedule?.id || null));
        });
    });

    for (let i = 0; i < 7; i++) {
        const date = new Date(state.currentWeekStart);
        date.setDate(date.getDate() + i);
        const dateStr = formatDate(date);
        const display = formatDisplayDate(dateStr);
        const isToday = dateStr === today;

        const dayCard = document.createElement('div');
        dayCard.className = `day-card ${isToday ? 'today expanded' : ''}`;

        let weekdayClass = '';
        if (display.dayOfWeek === 0) weekdayClass = 'sunday';
        if (display.dayOfWeek === 6) weekdayClass = 'saturday';

        dayCard.innerHTML = `
                <div class="day-header">
                    <span class="day-date">${display.month}/${display.day}<span class="weekday ${weekdayClass}">(${display.weekday})</span></span>
                    <span class="expand-icon">▼</span>
                </div>
                <div class="day-slots">
                    ${createTimeSlotHTML(dateStr, '午前')}
                    ${createTimeSlotHTML(dateStr, '午後')}
                </div>
            `;

        dayCard.querySelector('.day-header').addEventListener('click', () => {
            dayCard.classList.toggle('expanded');
        });

        container.appendChild(dayCard);
    }

    // スロットクリックイベント
    container.querySelectorAll('.time-slot').forEach(slot => {
        const scheduleId = slot.dataset.scheduleId || null;
        slot.addEventListener('click', () => {
            openInputModal(slot.dataset.date, slot.dataset.slot, scheduleId);
        });
    });

}

function createTimeSlotHTML(dateStr, timeSlot) {
    const schedule = state.schedules.find(s =>
        s.userId === state.currentUser?.id && s.date === dateStr && s.timeSlot === timeSlot
    );

    let badgeClass = 'empty';
    let badgeText = '入力する';
    let details = '';

    if (schedule) {
        switch (schedule.scheduleType) {
            case SCHEDULE_TYPES.ERGO:
                badgeClass = 'ergo';
                badgeText = `🏋️ ${schedule.scheduleType}`;
                details = schedule.ergoType || '';
                break;
            case SCHEDULE_TYPES.BOAT:
                badgeClass = 'boat';
                badgeText = `🚣 ${schedule.scheduleType}`;
                const boat = state.boats.find(b => b.id === schedule.boatId);
                details = boat ? boat.name : '';
                break;
            case SCHEDULE_TYPES.WEIGHT:
                badgeClass = 'weight';
                badgeText = `💪 ${schedule.scheduleType}`;
                break;
            case SCHEDULE_TYPES.ABSENT:
                badgeClass = 'absent';
                badgeText = `❌ ${schedule.scheduleType}`;
                details = schedule.absenceReason || '';
                break;
            case SCHEDULE_TYPES.MEAL:
                badgeClass = 'meal';
                badgeText = `🍳 ${schedule.scheduleType}`;
                details = schedule.mealTypes ? schedule.mealTypes.join('/') : '';
                break;
            case SCHEDULE_TYPES.VIDEO:
                badgeClass = 'video';
                badgeText = `🎥 ${schedule.scheduleType}`;
                details = schedule.videoDuration ? `${schedule.videoDuration}分` : '';
                break;
            case SCHEDULE_TYPES.BANCHA:
                badgeClass = 'bancha';
                badgeText = `🚴 ${schedule.scheduleType}`;
                break;
            case SCHEDULE_TYPES.RUN:
                badgeClass = 'run';
                badgeText = `🏃 ${schedule.scheduleType}`;
                break;
            case SCHEDULE_TYPES.OFF:
                badgeClass = 'off';
                badgeText = `🏖️ OFF`;
                break;
        }
        if (schedule.startTime) {
            details = (details ? details + ' ' : '') + schedule.startTime + '〜';
        }
        if (schedule.autoCreatedByName) {
            details = (details ? details + ' ' : '') + `👤${schedule.autoCreatedByName}が登録`;
        }
    }

    return `
        <div class="time-slot" data-date="${dateStr}" data-slot="${timeSlot}"${schedule ? ` data-schedule-id="${schedule.id}"` : ''}>
            <span class="slot-time">${timeSlot}</span>
            <div class="slot-content">
                <span class="slot-type-badge ${badgeClass}">${badgeText}</span>
                ${details ? `<div class="slot-details">${details}</div>` : ''}
            </div>
        </div>
    `;
}



// =========================================
// 入力モーダル
// =========================================
let currentInputData = null;

function openInputModal(dateStr, timeSlot, scheduleId = null) {

    const modal = document.getElementById('input-modal');
    const title = document.getElementById('input-modal-title');
    const display = formatDisplayDate(dateStr);
    const isManager = false; // マネージャーロール廃止済み

    title.textContent = isManager
        ? `予定入力 ${display.month}/${display.day}（${display.weekday}）`
        : `予定入力 ${display.month}/${display.day}（${display.weekday}）${timeSlot}`;

    // スケジュール検索：マネージャーはIDで、それ以外はdate+timeSlotで
    let schedule;
    if (scheduleId) {
        schedule = state.schedules.find(s => s.id === scheduleId);
    } else if (isManager) {
        schedule = null; // マネージャーは新規追加
    } else {
        schedule = state.schedules.find(s =>
            s.userId === state.currentUser?.id && s.date === dateStr && s.timeSlot === timeSlot
        );
    }

    currentInputData = { dateStr, timeSlot, schedule };

    // Select inputの初期化
    if (typeof populateBoatOarSelects === 'function') {
        populateBoatOarSelects();
    }

    // ロール別ボタン表示制御
    const userRole = state.currentUser?.role || '';
    const roleKey = userRole === ROLES.COX ? 'cox'
        : userRole === ROLES.ADMIN ? 'admin'
            : userRole === ROLES.COACH ? 'coach'
                : userRole === ROLES.DATA_ANALYST ? 'data'
                    : 'rower';

    document.querySelectorAll('.schedule-type-btn').forEach(btn => {
        const allowedRoles = (btn.dataset.roles || 'all').split(',');
        const visible = allowedRoles.includes('all') || allowedRoles.includes(roleKey);
        btn.style.display = visible ? '' : 'none';
    });

    // フォームリセット
    document.querySelectorAll('#input-modal .toggle-btn').forEach(btn => btn.classList.remove('active'));
    // デフォルト時間を設定（新規のみ、既存スケジュールがない場合）
    if (!schedule) {
        document.getElementById('input-start-time').value = getDefaultStartTime(dateStr, timeSlot);
    } else {
        document.getElementById('input-start-time').value = '';
    }
    document.getElementById('input-memo').value = '';
    document.getElementById('absence-reason-group').classList.add('hidden');
    document.getElementById('ergo-type-group').classList.add('hidden');
    document.getElementById('boat-group').classList.add('hidden');
    document.getElementById('oar-group').classList.add('hidden');
    document.getElementById('crew-group').classList.add('hidden');
    document.getElementById('meal-type-group').classList.add('hidden');
    document.getElementById('video-duration-group').classList.add('hidden');

    document.getElementById('delete-schedule-btn').classList.add('hidden');
    document.getElementById('seat-assignment-container').innerHTML = '';

    if (schedule) {
        document.getElementById('delete-schedule-btn').classList.remove('hidden');

        const typeBtn = document.querySelector(`.schedule-type-btn[data-value="${schedule.scheduleType}"]`);
        if (typeBtn) {
            typeBtn.classList.add('active');
            handleScheduleTypeChange(schedule.scheduleType);
        }

        document.getElementById('input-start-time').value = schedule.startTime || '';
        document.getElementById('input-memo').value = schedule.memo || '';

        if (schedule.absenceReason) {
            const reasonBtn = document.querySelector(`.reason-btn[data-value="${schedule.absenceReason}"]`);
            if (reasonBtn) reasonBtn.classList.add('active');
        }
        if (schedule.absenceDetail) {
            document.getElementById('input-absence-detail').value = schedule.absenceDetail;
        }

        if (schedule.ergoType) {
            const ergoBtn = document.querySelector(`.ergo-type-btn[data-value="${schedule.ergoType}"]`);
            if (ergoBtn) ergoBtn.classList.add('active');
        }

        if (schedule.boatType) {
            const boatTypeBtn = document.querySelector(`.boat-type-btn[data-value="${schedule.boatType}"]`);
            if (boatTypeBtn) boatTypeBtn.classList.add('active');
        }

        if (schedule.boatId) document.getElementById('input-boat').value = schedule.boatId;
        // oarIds復元（複数オール）
        if (schedule.oarIds || schedule.oarId) {
            setTimeout(() => {
                const oarIds = schedule.oarIds || (schedule.oarId ? [schedule.oarId] : []);
                const selects = document.querySelectorAll('.input-oar-select');
                oarIds.forEach((id, i) => { if (selects[i]) selects[i].value = id; });
            }, 50);
        }

        // 炊事の復元
        if (schedule.mealTypes && schedule.mealTypes.length > 0) {
            schedule.mealTypes.forEach(mt => {
                const mealBtn = document.querySelector(`.meal-type-btn[data-value="${mt}"]`);
                if (mealBtn) mealBtn.classList.add('active');
            });
        }

        // ビデオ撮影時間の復元
        if (schedule.videoDuration) {
            const vidBtn = document.querySelector(`.video-duration-btn[data-value="${schedule.videoDuration}"]`);
            if (vidBtn) vidBtn.classList.add('active');
        }

        // シート情報を復元
        const crewMap = schedule.crewDetailsMap || {};
        if (Object.keys(crewMap).length === 0 && schedule.crewIds) {
            const seats = getSeatDefinitions(schedule.boatType);
            schedule.crewIds.forEach((uid, idx) => {
                if (seats[idx]) crewMap[seats[idx].id] = uid;
            });
        }
        renderSeatInputs(schedule.boatType, crewMap);

        // エルゴ記録を読み込み
        const records = state.ergoRecords.filter(r => r.scheduleId === schedule.id);
        records.forEach(r => addErgoRecordInput(r));
    }

    modal.classList.remove('hidden');

}

function closeInputModal() {
    document.getElementById('input-modal').classList.add('hidden');
    currentInputData = null;
}

function handleScheduleTypeChange(type) {
    const isOff = type === SCHEDULE_TYPES.OFF;
    const isAbsent = type === SCHEDULE_TYPES.ABSENT;
    document.getElementById('start-time-group').classList.toggle('hidden', isAbsent || isOff);
    document.getElementById('absence-reason-group').classList.toggle('hidden', !isAbsent);
    document.getElementById('ergo-type-group').classList.toggle('hidden', type !== SCHEDULE_TYPES.ERGO);
    document.getElementById('boat-group').classList.toggle('hidden', type !== SCHEDULE_TYPES.BOAT);
    document.getElementById('oar-group').classList.toggle('hidden', type !== SCHEDULE_TYPES.BOAT);
    document.getElementById('crew-group').classList.toggle('hidden', type !== SCHEDULE_TYPES.BOAT);
    document.getElementById('meal-type-group').classList.toggle('hidden', type !== SCHEDULE_TYPES.MEAL);
    document.getElementById('video-duration-group').classList.toggle('hidden', type !== SCHEDULE_TYPES.VIDEO);

    // 乗艇選択時はシートUI表示
    if (type === SCHEDULE_TYPES.BOAT) {
        const activeBoatTypeBtn = document.querySelector('.boat-type-btn.active');
        const boatType = activeBoatTypeBtn ? activeBoatTypeBtn.dataset.value : '8+';
        renderSeatInputs(boatType);
    }
}

function addErgoRecordInput(existingRecord = null) {
    const container = document.getElementById('ergo-records-container');
    const count = container.children.length + 1;

    const recordDiv = document.createElement('div');
    recordDiv.className = 'ergo-record-input';
    recordDiv.dataset.recordId = existingRecord?.id || '';

    recordDiv.innerHTML = `
        <div class="record-header">
            <span class="record-number">記録 ${count}</span>
            <button type="button" class="remove-record">×</button>
        </div>
        <div class="record-fields">
            <div class="field">
                <label>距離(m)</label>
                <input type="number" class="ergo-distance" value="${existingRecord?.distance || ''}" placeholder="2000">
            </div>
            <div class="field">
                <label>時間</label>
                <input type="text" class="ergo-time" value="${existingRecord?.timeDisplay || ''}" placeholder="7:00.0">
            </div>
            <div class="field">
                <label>スプリット</label>
                <input type="text" class="ergo-split" value="${existingRecord?.split || ''}" placeholder="1:45.0">
            </div>
            <div class="field">
                <label>レート</label>
                <input type="number" class="ergo-rate" value="${existingRecord?.strokeRate || ''}" placeholder="28">
            </div>
        </div>
    `;

    recordDiv.querySelector('.remove-record').addEventListener('click', () => {
        recordDiv.remove();
    });

    container.appendChild(recordDiv);

    // 自動計算のためのイベントリスナー
    const distInput = recordDiv.querySelector('.ergo-distance');
    const timeInput = recordDiv.querySelector('.ergo-time');
    const splitInput = recordDiv.querySelector('.ergo-split');

    const updateSplit = () => {
        const dist = parseInt(distInput.value);
        const timeStr = timeInput.value;

        if (dist > 0 && timeStr) {
            const seconds = parseTimeString(timeStr);
            if (seconds > 0) {
                splitInput.value = formatSplit(seconds, dist);
            }
        }
    };

    distInput.addEventListener('input', updateSplit);
    timeInput.addEventListener('input', updateSplit);
    timeInput.addEventListener('blur', updateSplit); // フォーカス外れた時も念のため
}

// =========================================
// シート割り当てロジック
// =========================================
let activeSeatId = null;

// シート定義を取得
function getSeatDefinitions(boatType) {
    if (!boatType) return [];
    // 定義: { id: 's', label: '整調' } など
    // idは保存時のキーになる
    switch (boatType) {
        case '1x':
            return [{ id: 's', label: 'S' }];
        case '2x':
        case '2-':
            return [{ id: 's', label: 'S' }, { id: 'b', label: 'B' }];
        case '4x':
        case '4-': // 4- はUIにないかもしれないが念のため
            return [
                { id: 's', label: 'S' }, { id: '3', label: '3' },
                { id: '2', label: '2' }, { id: 'b', label: 'B' }
            ];
        case '4+':
            return [
                { id: 'c', label: 'Cox' },
                { id: 's', label: 'S' }, { id: '3', label: '3' },
                { id: '2', label: '2' }, { id: 'b', label: 'B' }
            ];
        case '8+':
            return [
                { id: 'c', label: 'Cox' },
                { id: 's', label: 'S' }, { id: '7', label: '7' },
                { id: '6', label: '6' }, { id: '5', label: '5' },
                { id: '4', label: '4' }, { id: '3', label: '3' },
                { id: '2', label: '2' }, { id: 'b', label: 'B' }
            ];
        default:
            return [];
    }
}

// シート入力欄を描画
function renderSeatInputs(boatType, currentAssignment = {}) {
    const container = document.getElementById('seat-assignment-container');
    if (!container) return;
    container.innerHTML = '';

    // ボート種別が無効な場合は何もしない
    if (!boatType) return;

    const seats = getSeatDefinitions(boatType);
    if (!seats.length) return;

    // グリッドレイアウト用のクラス
    container.className = `seat-assignment-container seat-grid-${boatType.replace('+', 'plus')}`;

    seats.forEach(seat => {
        const seatDiv = document.createElement('div');
        seatDiv.className = 'seat-input-group';

        const assignedUserId = currentAssignment[seat.id];
        const assignedUser = assignedUserId ? state.users.find(u => u.id === assignedUserId) : null;

        const userLabel = assignedUser ? assignedUser.name : '未選択';
        const activeClass = assignedUser ? 'filled' : '';

        seatDiv.innerHTML = `
            <label class="seat-label">${seat.label}</label>
            <div class="seat-selector ${activeClass}" data-seat="${seat.id}" onclick="openMemberSelectForSeat('${seat.id}')">
                <span class="selected-name">${userLabel}</span>
                <input type="hidden" class="seat-user-id" data-seat-id="${seat.id}" value="${assignedUserId || ''}">
            </div>
        `;
        container.appendChild(seatDiv);
    });
}

function openMemberSelectForSeat(seatId) {
    activeSeatId = seatId;

    // UI上の選択状態を視覚化
    document.querySelectorAll('.seat-selector').forEach(el => el.classList.remove('active-selection'));
    const target = document.querySelector(`.seat-selector[data-seat="${seatId}"]`);
    if (target) target.classList.add('active-selection');

    // 検索ボックスにフォーカス
    const searchInput = document.getElementById('crew-search');
    searchInput.focus();
    searchInput.placeholder = `シート[${seatId.toUpperCase()}] のメンバーを検索...`;

    // 検索結果を表示（空なら候補を表示）
    filterCrew(searchInput.value);
}

function assignUserToSeat(user) {
    if (!activeSeatId) {
        showToast('シートを選択してください', 'error');
        return;
    }

    const seatInput = document.querySelector(`.seat-selector[data-seat="${activeSeatId}"]`);
    if (seatInput) {
        seatInput.querySelector('.selected-name').textContent = user.name;
        seatInput.querySelector('.seat-user-id').value = user.id;
        seatInput.classList.add('filled');
        seatInput.classList.remove('active-selection');

        activeSeatId = null;
        document.getElementById('crew-search').value = '';
        document.getElementById('crew-search-results').classList.add('hidden');
    }
}

// ボート艇種切り替え時のイベントリスナー追加
document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.boat-type-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const type = e.currentTarget.dataset.value;
            // 既存の入力を保持するようにするならここが変わるが、今はクリアして再描画
            renderSeatInputs(type);
        });
    });
});


function saveSchedule() {
    if (!currentInputData) return;

    const { dateStr, timeSlot, schedule } = currentInputData;
    const typeBtn = document.querySelector('.schedule-type-btn.active');
    const scheduleType = typeBtn?.dataset.value;

    if (!scheduleType) {
        showToast('予定種別を選択してください', 'error');
        return;
    }

    if (scheduleType === SCHEDULE_TYPES.ABSENT) {
        const reasonBtn = document.querySelector('.reason-btn.active');
        if (!reasonBtn) {
            showToast('理由を選択してください', 'error');
            return;
        }
    }

    const newSchedule = {
        id: schedule?.id || generateId(),
        userId: state.currentUser.id,
        date: dateStr,
        timeSlot: timeSlot,
        scheduleType: scheduleType,
        startTime: document.getElementById('input-start-time').value || null,
        absenceReason: document.querySelector('.reason-btn.active')?.dataset.value || null,
        absenceDetail: document.getElementById('input-absence-detail')?.value || null,

        ergoType: document.querySelector('.ergo-type-btn.active')?.dataset.value || null,
        boatType: document.querySelector('.boat-type-btn.active')?.dataset.value || null,
        boatId: document.getElementById('input-boat').value || null,
        oarIds: Array.from(document.querySelectorAll('.input-oar-select')).map(s => s.value).filter(v => v),
        oarId: document.querySelector('.input-oar-select')?.value || null, // 後方互換
        crewIds: [],
        crewDetailsMap: {},
        mealTypes: Array.from(document.querySelectorAll('.meal-type-btn.active')).map(b => b.dataset.value),
        videoDuration: document.querySelector('.video-duration-btn.active')?.dataset.value || null,
        memo: document.getElementById('input-memo').value || null,
        updatedAt: new Date().toISOString()
    };

    // クルー情報（シート割り当て）を取得
    if (scheduleType === SCHEDULE_TYPES.BOAT) {
        const seatInputs = document.querySelectorAll('.seat-user-id');
        seatInputs.forEach(input => {
            const userId = input.value;
            const seatId = input.dataset.seatId;
            if (userId) {
                newSchedule.crewDetailsMap[seatId] = userId;
                newSchedule.crewIds.push(userId);
            }
        });
    }

    if (schedule) {
        const idx = state.schedules.findIndex(s => s.id === schedule.id);
        state.schedules[idx] = newSchedule;
    } else {
        newSchedule.createdAt = new Date().toISOString();
        state.schedules.push(newSchedule);
    }

    // エルゴ記録を保存
    if (scheduleType === SCHEDULE_TYPES.ERGO) {
        // 既存記録を削除
        state.ergoRecords = state.ergoRecords.filter(r => r.scheduleId !== newSchedule.id);

        document.querySelectorAll('.ergo-record-input').forEach(div => {
            const distance = div.querySelector('.ergo-distance').value;
            const timeVal = div.querySelector('.ergo-time').value;
            let split = (div.querySelector('.ergo-split').value || '').trim();
            const rate = div.querySelector('.ergo-rate').value;

            if (distance || timeVal) {
                // スプリット未入力の場合、自動計算を試みる
                if (!split && distance && timeVal) {
                    const seconds = parseTimeString(timeVal);
                    if (seconds > 0) {
                        split = formatSplit(seconds, parseInt(distance));
                    }
                }

                state.ergoRecords.push({
                    id: div.dataset.recordId || generateId(),
                    userId: state.currentUser.id,
                    scheduleId: newSchedule.id,
                    date: dateStr,
                    timeSlot: timeSlot,
                    distance: distance ? parseInt(distance) : null,
                    timeDisplay: timeVal || null,
                    split: split || null,
                    strokeRate: rate ? parseInt(rate) : null,
                    weight: document.getElementById('input-weight').value ? parseFloat(document.getElementById('input-weight').value) : null,
                    source: '手入力',
                    createdAt: new Date().toISOString()
                });
            }
        });
    }


    DB.save('ergo_records', state.ergoRecords); // ローカル保存

    // Supabase同期: 一旦そのスケジュールの記録を全削除して再登録
    DB.deleteErgoRecordsByScheduleId(newSchedule.id).then(() => {
        const recordsToSave = state.ergoRecords.filter(r => r.scheduleId === newSchedule.id);
        recordsToSave.forEach(r => DB.saveErgoRecord(r));
    });


    DB.save('schedules', state.schedules); // ローカル保存
    DB.addAuditLog('予定', newSchedule.id, schedule ? '更新' : '作成', { after: newSchedule });

    // Supabase同期（非同期）
    DB.saveSchedule(newSchedule).catch(e => {
        console.error('Schedule sync failed:', e);
        showToast('スケジュール同期エラー: ' + (e?.message || JSON.stringify(e)), 'error');
    });

    // 自動でクルーノートを作成（乗艇練習の場合）
    if (newSchedule.scheduleType === SCHEDULE_TYPES.BOAT) {
        autoCreateCrewNotesFromSchedule(newSchedule);
    }

    // 練習ノート自動作成（参加不可・OFF以外）
    if (newSchedule.scheduleType !== SCHEDULE_TYPES.ABSENT && newSchedule.scheduleType !== SCHEDULE_TYPES.OFF) {
        autoCreatePracticeNote(newSchedule);
    }

    // クルー自動登録（乗艇練習でクルーメンバーがいる場合）
    if (newSchedule.scheduleType === SCHEDULE_TYPES.BOAT && newSchedule.crewIds && newSchedule.crewIds.length > 0) {
        autoRegisterCrewSchedules(newSchedule);
    }

    closeInputModal();
    renderWeekCalendar();
    showToast('保存しました', 'success');
}

/**
 * クルー自動登録: 登録者のスケジュールを他クルーメンバーにも自動反映
 */
function autoRegisterCrewSchedules(sourceSchedule) {
    const currentUserId = state.currentUser?.id;
    // 自分以外のクルーメンバーを取得
    const otherMembers = (sourceSchedule.crewIds || []).filter(id => id !== currentUserId);
    if (otherMembers.length === 0) return;

    // 既存スケジュールの確認
    const conflicting = [];
    const noConflict = [];
    otherMembers.forEach(memberId => {
        const existing = state.schedules.find(s =>
            s.userId === memberId && s.date === sourceSchedule.date && s.timeSlot === sourceSchedule.timeSlot
        );
        if (existing) {
            const profile = (state.profiles || []).find(p => p.id === memberId);
            conflicting.push({ memberId, name: profile?.name || memberId, existingSchedule: existing });
        } else {
            noConflict.push(memberId);
        }
    });

    // 競合がなければ即座に全員登録
    if (conflicting.length === 0) {
        otherMembers.forEach(memberId => {
            createCrewMemberSchedule(memberId, sourceSchedule);
        });
        DB.save('schedules', state.schedules);
        showToast(`クルー ${otherMembers.length}名にも自動登録しました`, 'success');
        return;
    }

    // 競合ありの場合は確認ダイアログ
    const conflictNames = conflicting.map(c => c.name).join('、');
    showConfirmModal(
        `${conflictNames} は既に予定が登録されています。上書きしますか？`,
        () => {
            // 上書き: 既存を削除して新規登録
            conflicting.forEach(c => {
                state.schedules = state.schedules.filter(s => s.id !== c.existingSchedule.id);
                // 旧スケジュールのSupabase削除
                DB.deleteSchedule(c.existingSchedule.id).catch(e => console.warn('Delete old schedule failed:', e));
            });
            // 全員登録
            otherMembers.forEach(memberId => {
                createCrewMemberSchedule(memberId, sourceSchedule);
            });
            DB.save('schedules', state.schedules);
            renderWeekCalendar();
            showToast(`クルー ${otherMembers.length}名にも自動登録しました`, 'success');
        },
        () => {
            // キャンセル: 競合なしのメンバーのみ登録
            noConflict.forEach(memberId => {
                createCrewMemberSchedule(memberId, sourceSchedule);
            });
            if (noConflict.length > 0) {
                DB.save('schedules', state.schedules);
                renderWeekCalendar();
                showToast(`${noConflict.length}名に自動登録しました（既存予定は維持）`, 'info');
            }
        },
        '上書きする'
    );
}

/**
 * クルーメンバーのスケジュールを作成
 */
function createCrewMemberSchedule(memberId, sourceSchedule) {
    const memberSchedule = {
        ...sourceSchedule,
        id: generateId(),
        userId: memberId,
        autoCreatedBy: state.currentUser?.id || null,
        autoCreatedByName: state.currentUser?.name || null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };
    state.schedules.push(memberSchedule);

    // Supabase同期
    DB.saveSchedule(memberSchedule).catch(e => {
        console.warn('Crew member schedule sync failed:', e);
    });

    // 自動で練習ノートも作成
    autoCreatePracticeNote(memberSchedule);
}

/**
 * 前回の乗艇スケジュールを読み込んで、船種・船・オール・クルーをフォームにセット
 */
function loadLastBoatSchedule() {
    const userId = state.currentUser?.id;
    if (!userId) return;

    // 自分の乗艇スケジュールを日付降順で検索
    const boatSchedules = (state.schedules || [])
        .filter(s => s.userId === userId && s.scheduleType === SCHEDULE_TYPES.BOAT)
        .sort((a, b) => {
            const da = a.date + (a.timeSlot || '');
            const db = b.date + (b.timeSlot || '');
            return db.localeCompare(da);
        });

    if (boatSchedules.length === 0) {
        showToast('過去の乗艇記録がありません', 'info');
        return;
    }

    const last = boatSchedules[0];
    const boatName = last.boatId ? (state.boats.find(b => b.id === last.boatId)?.name || '') : '';
    const dateDisplay = last.date || '';

    showConfirmModal(
        `前回の乗艇を読み込みますか？\n\n📅 ${dateDisplay} ${last.timeSlot || ''}\n🚣 ${last.boatType || ''}${boatName ? ' ' + boatName : ''}\n👥 クルー ${(last.crewIds || []).length}名`,
        () => {
            applyLastBoatSchedule(last);
        },
        null,
        '読み込む'
    );
}

function applyLastBoatSchedule(schedule) {
    // 1. 艇種ボタンをセット
    if (schedule.boatType) {
        document.querySelectorAll('.boat-type-btn').forEach(btn => btn.classList.remove('active'));
        const typeBtn = document.querySelector(`.boat-type-btn[data-value="${schedule.boatType}"]`);
        if (typeBtn) {
            typeBtn.classList.add('active');
            handleScheduleTypeChange(SCHEDULE_TYPES.BOAT);
        }
    }

    // 2. 少し待ってからUI要素を復元（handleScheduleTypeChangeが非同期でUI生成するため）
    setTimeout(() => {
        // 船をセット
        populateBoatOarSelects();

        setTimeout(() => {
            if (schedule.boatId) {
                document.getElementById('input-boat').value = schedule.boatId;
            }

            // オールをセット
            const oarIds = schedule.oarIds || (schedule.oarId ? [schedule.oarId] : []);
            if (oarIds.length > 0) {
                const selects = document.querySelectorAll('.input-oar-select');
                oarIds.forEach((id, i) => { if (selects[i]) selects[i].value = id; });
            }

            // クルーをセット（シート割り当て）
            if (schedule.crewDetailsMap && Object.keys(schedule.crewDetailsMap).length > 0) {
                const seatInputs = document.querySelectorAll('.seat-user-id');
                Object.entries(schedule.crewDetailsMap).forEach(([seatId, userId]) => {
                    const input = document.querySelector(`.seat-user-id[data-seat-id="${seatId}"]`);
                    if (input) {
                        input.value = userId;
                        // input変更をトリガー
                        input.dispatchEvent(new Event('change'));
                    }
                });
            }

            showToast('前回の乗艇データを読み込みました', 'success');
        }, 150);
    }, 100);
}

function deleteSchedule() {
    if (!currentInputData?.schedule) return;

    showConfirmModal('この予定を削除しますか？', () => {
        state.schedules = state.schedules.filter(s => s.id !== currentInputData.schedule.id);
        state.ergoRecords = state.ergoRecords.filter(r => r.scheduleId !== currentInputData.schedule.id);

        DB.save('schedules', state.schedules);
        DB.save('ergo_records', state.ergoRecords);

        // Supabase同期
        const deleteId = currentInputData.schedule.id;
        DB.deleteSchedule(deleteId).catch(e => console.warn('Schedule delete sync failed:', e));
        DB.deleteErgoRecordsByScheduleId(deleteId);

        closeInputModal();
        renderWeekCalendar();
        showToast('削除しました', 'success');
    }, null, '削除する');
}


// =========================================
// 艇・オール・クルー選択
// =========================================

function filterBoatSelect(type) {
    const boatSelect = document.getElementById('input-boat');
    // 性別でフィルタ: 艇の性別が 'all' または 現在のユーザーの性別と一致するもの
    // 加えて、availabilityが'使用可能'なもの
    const userGender = state.currentUser?.gender || 'man';
    const allBoats = state.boats.filter(b =>
        b.availability === '使用可能' &&
        (b.gender === 'all' || !b.gender || b.gender === userGender)
    );

    // 艇種でフィルタリング (簡易実装: 名前やメモに艇種が含まれているか、または未設定か)
    // 厳密な艇種データがない場合は名前マッチング

    let filtered = allBoats;
    if (type) {
        filtered = allBoats.filter(b => {
            // 艇データにtypeがある場合はそれを優先
            if (b.type) return b.type === type;

            // 名前に艇種が含まれているかチェック
            if (b.name.includes(type)) return true;
            // 4+と4xの区別など
            if (type === '4+' && b.name.includes('付きフォア')) return true;
            if (type === '4x' && b.name.includes('クォドルプル')) return true;
            if (type === '2x' && b.name.includes('ダブル')) return true;
            if (type === '2-' && b.name.includes('ペア')) return true;
            if (type === '1x' && b.name.includes('シングル')) return true;
            if (type === '8+' && b.name.includes('エイト')) return true;

            return false;
        });

        // 該当なしの場合は全件表示に戻すか、空にするか -> 全件表示に戻す（使い勝手優先）
        if (filtered.length === 0) filtered = allBoats;
    }

    boatSelect.innerHTML = '<option value="">選択してください</option>';
    filtered.forEach(b => {
        boatSelect.innerHTML += `<option value="${b.id}">${b.name}</option>`;
    });
}

function filterCrew(query) {
    const list = document.getElementById('crew-search-results');
    if (!list) return;

    // シートに割り当て済みのIDを取得
    const selectedIds = [];
    document.querySelectorAll('.seat-user-id').forEach(i => { if (i.value) selectedIds.push(i.value); });

    // 既存のタグロジック用（念のため） - 廃止
    // Array.from(document.querySelectorAll('.selected-crew-tag')).forEach(t => selectedIds.push(t.dataset.userId));

    let filtered = state.users.filter(u =>
        u.approvalStatus === '承認済み' &&
        !selectedIds.includes(u.id)
    );

    if (query) {
        filtered = filtered.filter(u => u.name.includes(query));
    }

    list.innerHTML = filtered.slice(0, 10).map(u => `
        <div class="crew-option" data-user-id="${u.id}">${u.name}（${u.grade}年）</div>
    `).join('');

    list.querySelectorAll('.crew-option').forEach(opt => {
        opt.addEventListener('click', () => {
            const user = state.users.find(u => u.id === opt.dataset.userId);
            if (user) {
                // シート選択モードならシートに割り当て、そうでなければ何もしない（旧addCrewTagは廃止）
                if (activeSeatId) {
                    assignUserToSeat(user);
                } else {
                    showToast('割り当てるシートを選択してください', 'info');
                }
            }
        });
    });

    if (filtered.length > 0) {
        list.classList.remove('hidden');
    } else {
        list.classList.add('hidden');
    }
}

// =========================================
// クルー編成プリセット管理
// =========================================
const CREW_PRESETS_KEY = 'crew_presets';

// プリセットモーダルを開く
document.getElementById('manage-crew-presets-btn').addEventListener('click', () => {
    openCrewPresetModal();
});

document.getElementById('crew-preset-close').addEventListener('click', () => {
    document.getElementById('crew-preset-modal').classList.add('hidden');
});

document.querySelectorAll('#crew-preset-modal .tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('#crew-preset-modal .tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        const tab = btn.dataset.tab;
        document.getElementById('preset-load-tab').classList.toggle('hidden', tab !== 'load');
        document.getElementById('preset-save-tab').classList.toggle('hidden', tab !== 'save');

        if (tab === 'load') renderPresetList();
        if (tab === 'save') renderPresetSavePreview();
    });
});

document.getElementById('save-new-preset-btn').addEventListener('click', () => {
    saveCrewPreset();
});

function openCrewPresetModal() {
    // データ初期化（なければ空配列）
    if (!state.crewPresets) state.crewPresets = DB.load(CREW_PRESETS_KEY) || [];

    document.getElementById('crew-preset-modal').classList.remove('hidden');
    // デフォルトは読込タブ
    document.querySelector('.tab-btn[data-tab="load"]').click();
}

function renderPresetList() {
    const list = document.getElementById('preset-list');
    const presets = state.crewPresets || [];

    if (presets.length === 0) {
        document.getElementById('preset-empty-state').classList.remove('hidden');
        list.innerHTML = '';
        return;
    }
    document.getElementById('preset-empty-state').classList.add('hidden');

    list.innerHTML = presets.map(p => {
        const memberCount = Object.keys(p.members).length;
        const date = new Date(p.updatedAt).toLocaleDateString();
        return `
            <div class="preset-item">
                <div class="preset-info">
                    <div class="preset-name">${p.name}</div>
                    <div class="preset-meta">${p.boatType} | ${memberCount}名 | ${date}</div>
                </div>
                <div class="preset-actions">
                    <button class="primary-btn small-btn" onclick="loadPresetToForm('${p.id}')">読込</button>
                    <button class="danger-btn small-btn" onclick="deletePreset('${p.id}')">削除</button>
                </div>
            </div>
        `;
    }).join('');
}

function renderPresetSavePreview() {
    const container = document.getElementById('preset-save-preview');
    const boatType = document.querySelector('.boat-type-btn.active')?.dataset.value || '8+';

    // 現在のシート割り当てを取得
    const currentMembers = {};
    document.querySelectorAll('.seat-user-id').forEach(input => {
        if (input.value) {
            const user = state.users.find(u => u.id === input.value);
            if (user) currentMembers[input.dataset.seatId] = user.name;
        }
    });

    if (Object.keys(currentMembers).length === 0) {
        container.innerHTML = '<p class="text-muted">メンバーが選択されていません</p>';
        return;
    }

    const seats = getSeatDefinitions(boatType);
    container.innerHTML = seats.map(s => {
        const name = currentMembers[s.id] || '-';
        return `<div class="preview-row"><span class="seat-label">${s.label}</span>: <span>${name}</span></div>`;
    }).join('');
}

function saveCrewPreset() {
    const nameInput = document.getElementById('preset-name-input');
    const name = nameInput.value.trim();
    if (!name) {
        showToast('プリセット名を入力してください', 'error');
        return;
    }

    const boatType = document.querySelector('.boat-type-btn.active')?.dataset.value || '8+';
    const members = {};
    let hasMember = false;

    document.querySelectorAll('.seat-user-id').forEach(input => {
        if (input.value) {
            members[input.dataset.seatId] = input.value;
            hasMember = true;
        }
    });

    if (!hasMember) {
        showToast('メンバーが一人も選択されていません', 'error');
        return;
    }

    const newPreset = {
        id: generateId(),
        name: name,
        boatType: boatType,
        members: members,
        updatedAt: new Date().toISOString()
    };

    state.crewPresets.push(newPreset);
    DB.save(CREW_PRESETS_KEY, state.crewPresets);

    // Supabaseにも保存
    if (DB.useSupabase && window.SupabaseConfig?.db) {
        window.SupabaseConfig.db.saveCrewPreset(newPreset).catch(e => console.warn('Crew preset sync failed:', e));
    }

    showToast(`プリセット「${name}」を保存しました`, 'success');
    nameInput.value = '';

    // 読込タブに切り替え
    document.querySelector('.tab-btn[data-tab="load"]').click();
}

function deletePreset(id) {
    showConfirmModal('このプリセットを削除しますか？', () => {
        state.crewPresets = state.crewPresets.filter(p => p.id !== id);
        DB.save(CREW_PRESETS_KEY, state.crewPresets);

        // Supabaseからも削除
        if (DB.useSupabase && window.SupabaseConfig?.db) {
            window.SupabaseConfig.db.deleteCrewPreset(id).catch(e => console.warn('Crew preset delete sync failed:', e));
        }

        renderPresetList();
        showToast('削除しました', 'success');
    }, null, '削除する');
}

window.loadPresetToForm = function (id) { // onclickから呼ぶためglobalに
    const preset = state.crewPresets.find(p => p.id === id);
    if (!preset) return;

    // 1. ボート種別を合わせる
    const boatTypeBtn = document.querySelector(`.boat-type-btn[data-value="${preset.boatType}"]`);
    if (boatTypeBtn) {
        document.querySelectorAll('.boat-type-btn').forEach(b => b.classList.remove('active'));
        boatTypeBtn.click(); // clickイベントで renderSeatInputs が発火するはず
    } else {
        // ボタンがない場合（通常ありえないが）手動でレンダリング
        renderSeatInputs(preset.boatType);
    }

    // 少し待たないとDOMが更新されない可能性がある（同期処理ならOKだが念のため）
    setTimeout(() => {
        // 2. メンバーを割り当て
        Object.entries(preset.members).forEach(([seatId, userId]) => {
            const user = state.users.find(u => u.id === userId);
            if (user) {
                // assignUserToSeat は activeSeatId に依存するので、直接DOM操作するか、一時的に activeSeatId をセットして呼ぶ
                // ここでは直接DOM操作する方が安全
                const seatInput = document.querySelector(`.seat-selector[data-seat="${seatId}"]`);
                if (seatInput) {
                    seatInput.querySelector('.selected-name').textContent = user.name;
                    seatInput.querySelector('.seat-user-id').value = user.id;
                    seatInput.classList.add('filled');
                }
            }
        });

        document.getElementById('crew-preset-modal').classList.add('hidden');
        showToast(`プリセット「${preset.name}」を読み込みました`, 'success');
    }, 50);
};

window.deletePreset = deletePreset; // global exposure

// 検索入力イベントのリスナー再登録（動的要素対応のため、または既存のリスナーを確認）
document.getElementById('crew-search').addEventListener('input', (e) => {
    filterCrew(e.target.value);
});


// =========================================
// 全体（閲覧・調整）タブ
// =========================================
// 全体（閲覧・調整）タブ - 概要描画
// =========================================
function initOverviewDate() {
    const dateInput = document.getElementById('overview-date');
    dateInput.value = formatDate(new Date());

    // 前後日ボタン
    document.getElementById('overview-prev-day')?.addEventListener('click', () => {
        const d = new Date(dateInput.value);
        d.setDate(d.getDate() - 1);
        dateInput.value = formatDate(d);
        renderOverview();
    });
    document.getElementById('overview-next-day')?.addEventListener('click', () => {
        const d = new Date(dateInput.value);
        d.setDate(d.getDate() + 1);
        dateInput.value = formatDate(d);
        renderOverview();
    });
    document.getElementById('overview-today-btn')?.addEventListener('click', () => {
        dateInput.value = formatDate(new Date());
        renderOverview();
    });
}

// =========================================
// 全体スケジュール告知機能
// =========================================

// 告知カード描画
function renderTeamScheduleCards(dateStr) {
    const entries = (state.teamSchedules || []).filter(t => t.date === dateStr);
    const isAdmin = canEditSchedule(state.currentUser);
    let html = '';

    if (entries.length > 0) {
        html += '<div class="team-schedule-section">';
        entries.forEach(entry => {
            const slotLabel = entry.timeSlot === '午前' ? '🌅 午前' : entry.timeSlot === '午後' ? '🌇 午後' : '📋 全体';
            html += `<div class="team-schedule-card">
                <div class="team-schedule-header">
                    <span class="team-schedule-slot">${slotLabel}</span>
                    ${isAdmin ? `<button class="team-schedule-edit-btn" onclick="openTeamScheduleModal('${dateStr}', '${entry.id}')">✏️</button>` : ''}
                </div>
                <div class="team-schedule-content">${(entry.content || '').replace(/\n/g, '<br>')}</div>
            </div>`;
        });
        html += '</div>';
    }

    // 管理者用追加ボタン
    if (isAdmin) {
        html += `<button class="team-schedule-add-btn" onclick="openTeamScheduleModal('${dateStr}')">📢 全体スケジュールを追加</button>`;
    }

    return html;
}

// 告知モーダルを開く
function openTeamScheduleModal(dateStr, editId) {
    const existing = editId ? (state.teamSchedules || []).find(t => t.id === editId) : null;

    const modal = document.getElementById('team-schedule-modal');
    if (!modal) return;

    document.getElementById('team-schedule-date').value = dateStr;
    document.getElementById('team-schedule-slot').value = existing?.timeSlot || '';
    document.getElementById('team-schedule-content').value = existing?.content || '';
    document.getElementById('team-schedule-edit-id').value = editId || '';

    const deleteBtn = document.getElementById('delete-team-schedule-btn');
    if (deleteBtn) deleteBtn.classList.toggle('hidden', !editId);

    modal.classList.remove('hidden');
}
window.openTeamScheduleModal = openTeamScheduleModal;

// 告知を保存
function saveTeamSchedule() {
    const dateStr = document.getElementById('team-schedule-date').value;
    const timeSlot = document.getElementById('team-schedule-slot').value;
    const content = document.getElementById('team-schedule-content').value.trim();
    const editId = document.getElementById('team-schedule-edit-id').value;

    if (!content) {
        showToast('内容を入力してください', 'error');
        return;
    }

    if (!state.teamSchedules) state.teamSchedules = [];

    if (editId) {
        const idx = state.teamSchedules.findIndex(t => t.id === editId);
        if (idx !== -1) {
            state.teamSchedules[idx].timeSlot = timeSlot;
            state.teamSchedules[idx].content = content;
            state.teamSchedules[idx].updatedAt = new Date().toISOString();
        }
    } else {
        state.teamSchedules.push({
            id: generateId(),
            date: dateStr,
            timeSlot: timeSlot,
            content: content,
            createdBy: state.currentUser?.id || '',
            createdAt: new Date().toISOString()
        });
    }

    DB.save('team_schedules', state.teamSchedules);
    document.getElementById('team-schedule-modal').classList.add('hidden');
    renderOverview();
    showToast('全体スケジュールを保存しました', 'success');
}
window.saveTeamSchedule = saveTeamSchedule;

// 告知を削除
function deleteTeamSchedule() {
    const editId = document.getElementById('team-schedule-edit-id').value;
    if (!editId) return;

    showConfirmModal('この全体スケジュールを削除しますか？', () => {
        state.teamSchedules = (state.teamSchedules || []).filter(t => t.id !== editId);
        DB.save('team_schedules', state.teamSchedules);
        document.getElementById('team-schedule-modal').classList.add('hidden');
        renderOverview();
        showToast('削除しました', 'success');
    }, null, '削除する');
}
window.deleteTeamSchedule = deleteTeamSchedule;

// 午前/午後セクション描画ヘルパー
function renderSlotSection(sectionLabel, schedules) {
    if (schedules.length === 0) {
        return `<div class="slot-section">
            <div class="slot-section-header">${sectionLabel} <span class="slot-count-badge">0人</span></div>
            <div class="empty-state" style="padding:8px;"><p style="font-size:13px;color:#888;">予定なし</p></div>
        </div>`;
    }

    // startTimeでグルーピング
    const timeGroups = {};
    const noTimeSchedules = [];

    schedules.forEach(s => {
        if (s.startTime) {
            if (!timeGroups[s.startTime]) timeGroups[s.startTime] = [];
            timeGroups[s.startTime].push(s);
        } else {
            noTimeSchedules.push(s);
        }
    });

    const sortedTimes = Object.keys(timeGroups).sort();
    let blocksHtml = '';

    sortedTimes.forEach(time => {
        blocksHtml += renderTimeBlock(time, timeGroups[time]);
    });

    if (noTimeSchedules.length > 0) {
        blocksHtml += renderTimeBlock('未定', noTimeSchedules);
    }

    return `<div class="slot-section">
        <div class="slot-section-header">${sectionLabel} <span class="slot-count-badge">${schedules.length}人</span></div>
        ${blocksHtml}
    </div>`;
}

function renderOverview() {
    const dateStr = document.getElementById('overview-date').value;
    const container = document.getElementById('schedule-timeline');
    const boatSection = document.getElementById('available-boats-section');

    // その日の全スケジュール（全ユーザー）
    const schedules = state.schedules.filter(s => s.date === dateStr);

    // 在籍中のアクティブユーザー一覧
    const activeUsers = state.users.filter(u => u.approvalStatus === '承認済み' && u.status !== '退部' && !u.isDemo);
    const registeredUserIds = new Set(schedules.map(s => s.userId));

    // 午前/午後でグルーピング
    const morningSchedules = [];
    const afternoonSchedules = [];
    const absentSchedules = [];
    const offSchedules = [];

    schedules.forEach(s => {
        if (s.scheduleType === SCHEDULE_TYPES.ABSENT) {
            absentSchedules.push(s);
        } else if (s.scheduleType === SCHEDULE_TYPES.OFF) {
            offSchedules.push(s);
        } else {
            // timeSlotベースで午前/午後分離（startTimeから推定も可）
            const slot = s.timeSlot || '';
            if (slot === '午後' || slot === 'afternoon') {
                afternoonSchedules.push(s);
            } else if (slot === '午前' || slot === 'morning') {
                morningSchedules.push(s);
            } else if (s.startTime) {
                // startTime から推定: 12:00 以降は午後
                const hour = parseInt(s.startTime.split(':')[0]) || 0;
                if (hour >= 12) {
                    afternoonSchedules.push(s);
                } else {
                    morningSchedules.push(s);
                }
            } else {
                morningSchedules.push(s); // デフォルトは午前
            }
        }
    });

    // 非登録者（予定未入力の部員）
    const unregisteredUsers = activeUsers.filter(u => !registeredUserIds.has(u.id));

    let html = '';

    // 日付ヘッダー
    const display = formatDisplayDate(dateStr);
    const totalActive = morningSchedules.length + afternoonSchedules.length;
    html += `<div class="timeline-date-header">
        ${display.month}/${display.day}（${display.weekday}）のスケジュール
    </div>`;

    if (schedules.length === 0 && unregisteredUsers.length === 0 && !(state.teamSchedules || []).some(t => t.date === dateStr)) {
        html += '<div class="empty-state"><p>予定なし</p></div>';
    }

    // === 全体告知カード ===
    html += renderTeamScheduleCards(dateStr);

    // === 午前セクション ===
    html += renderSlotSection('🌅 午前', morningSchedules);

    // === 午後セクション ===
    html += renderSlotSection('🌇 午後', afternoonSchedules);

    // === OFF（折りたたみ） ===
    if (offSchedules.length > 0) {
        const offChips = offSchedules.map(s => {
            const u = state.users.find(u => u.id === s.userId);
            return `<span class="ov-chip off-chip">🏖️ ${u?.name || '?'}</span>`;
        }).join('');
        html += `<div class="timeline-block absent-block">
            <div class="ov-card-header" onclick="this.parentElement.classList.toggle('expanded')">
                <span class="timeline-time-label">🏖️ OFF</span>
                <div class="ov-summary-badges">
                    <span class="ov-badge off-badge">${offSchedules.length}人</span>
                    <span class="ov-expand-icon">▶</span>
                </div>
            </div>
            <div class="ov-card-body"><div class="ov-chip-row">${offChips}</div></div>
        </div>`;
    }

    // === 参加不可（折りたたみ） ===
    if (absentSchedules.length > 0) {
        const absentByReason = {};
        absentSchedules.forEach(s => {
            const reason = s.absenceReason || 'その他';
            if (!absentByReason[reason]) absentByReason[reason] = [];
            absentByReason[reason].push(s);
        });

        const absentChips = Object.entries(absentByReason).map(([reason, list]) => {
            const names = list.map(s => {
                const u = state.users.find(u => u.id === s.userId);
                const detail = s.absenceDetail ? `<span class="absent-detail-hint" title="${s.absenceDetail}">ⓘ</span>` : '';
                return `<span class="ov-chip absent-chip">${u?.name || '?'}${detail}</span>`;
            }).join('');
            return `<div class="absent-reason-group">
                <span class="absent-reason-label">${reason}</span>
                <div class="ov-chip-row">${names}</div>
            </div>`;
        }).join('');

        html += `<div class="timeline-block absent-block">
            <div class="ov-card-header" onclick="this.parentElement.classList.toggle('expanded')">
                <span class="timeline-time-label">❌ 参加不可</span>
                <div class="ov-summary-badges">
                    <span class="ov-badge absent-badge">${absentSchedules.length}人</span>
                    <span class="ov-expand-icon">▶</span>
                </div>
            </div>
            <div class="ov-card-body">${absentChips}</div>
        </div>`;
    }

    // === 非登録者（折りたたみ） ===
    if (unregisteredUsers.length > 0) {
        const unregChips = unregisteredUsers.map(u =>
            `<span class="ov-chip unregistered-chip">⚠️ ${u.name}</span>`
        ).join('');
        html += `<div class="timeline-block absent-block">
            <div class="ov-card-header" onclick="this.parentElement.classList.toggle('expanded')">
                <span class="timeline-time-label">📝 未登録</span>
                <div class="ov-summary-badges">
                    <span class="ov-badge" style="background:#f59e0b;">${unregisteredUsers.length}人</span>
                    <span class="ov-expand-icon">▶</span>
                </div>
            </div>
            <div class="ov-card-body"><div class="ov-chip-row">${unregChips}</div></div>
        </div>`;
    }

    container.innerHTML = html;

    // 空き艇セクション
    renderAvailableBoats(dateStr, boatSection);
}

function renderTimeBlock(timeLabel, entries) {
    const displayTime = timeLabel === '未定' ? '🕐 時間未定' : `⏰ ${timeLabel}`;

    // タイプ別にグループ分け
    const typeGroups = {};
    entries.forEach(s => {
        const t = s.scheduleType;
        if (!typeGroups[t]) typeGroups[t] = [];
        typeGroups[t].push(s);
    });

    // タイプ設定
    const typeConfig = {
        [SCHEDULE_TYPES.BOAT]: { icon: '🚣', label: '乗艇', cls: 'boat' },
        [SCHEDULE_TYPES.ERGO]: { icon: '🏋️', label: 'エルゴ', cls: 'ergo' },
        [SCHEDULE_TYPES.WEIGHT]: { icon: '💪', label: 'ウエイト', cls: 'weight' },
        [SCHEDULE_TYPES.RUN]: { icon: '🏃', label: 'ラン', cls: 'run' },
        [SCHEDULE_TYPES.MEAL]: { icon: '🍳', label: '炊事', cls: 'meal' },
        [SCHEDULE_TYPES.VIDEO]: { icon: '🎥', label: 'ビデオ', cls: 'video' },
        [SCHEDULE_TYPES.BANCHA]: { icon: '🚴', label: '伴チャ', cls: 'bancha' }
    };

    // サマリーバッジ
    const badgesHtml = Object.entries(typeGroups).map(([type, list]) => {
        const cfg = typeConfig[type] || { icon: '📋', label: type, cls: '' };
        return `<span class="ov-badge ${cfg.cls}-badge">${cfg.icon}${list.length}</span>`;
    }).join('');

    // タイプ別詳細コンテンツ
    let detailHtml = '';

    // --- 乗艇: クルー単位でまとめ ---
    if (typeGroups[SCHEDULE_TYPES.BOAT]) {
        const boatEntries = typeGroups[SCHEDULE_TYPES.BOAT];
        const crewGroups = {};
        const soloEntries = [];

        boatEntries.forEach(s => {
            if (s.boatId && s.crewDetailsMap && Object.keys(s.crewDetailsMap).length > 0) {
                const key = s.boatId;
                if (!crewGroups[key]) crewGroups[key] = { boat: s, members: new Map() };
                Object.entries(s.crewDetailsMap).forEach(([seat, uid]) => {
                    const u = state.users.find(u => u.id === uid);
                    if (u) crewGroups[key].members.set(uid, { seat, name: u.name });
                });
                const registrant = state.users.find(u => u.id === s.userId);
                if (registrant && !crewGroups[key].members.has(s.userId)) {
                    crewGroups[key].members.set(s.userId, { seat: 'Cox', name: registrant.name });
                }
            } else {
                soloEntries.push(s);
            }
        });

        let boatHtml = '';
        Object.values(crewGroups).forEach(group => {
            const boat = state.boats.find(b => b.id === group.boat.boatId);
            const boatType = group.boat.boatType || '';
            const boatName = boat?.name || '未選択';
            const memberChips = Array.from(group.members.values())
                .sort((a, b) => a.seat.localeCompare(b.seat))
                .map(m => `<span class="ov-chip boat-chip">${m.name}</span>`).join('');
            boatHtml += `<div class="ov-crew-card">
                <div class="ov-crew-label">${boatType ? `[${boatType}]` : ''} ${boatName}</div>
                <div class="ov-chip-row">${memberChips}</div>
            </div>`;
        });

        if (soloEntries.length > 0) {
            const soloChips = soloEntries.map(s => {
                const u = state.users.find(u => u.id === s.userId);
                const boatType = s.boatType || '';
                const boat = state.boats.find(b => b.id === s.boatId);
                const label = [boatType, boat?.name].filter(Boolean).join(' ');
                return `<span class="ov-chip boat-chip" title="${label}">${u?.name || '?'}${label ? ` (${label})` : ''}</span>`;
            }).join('');
            boatHtml += `<div class="ov-crew-card"><div class="ov-chip-row">${soloChips}</div></div>`;
        }

        detailHtml += `<div class="ov-type-section boat-section">
            <div class="ov-type-header">🚣 乗艇 (${boatEntries.length}人)</div>
            ${boatHtml}
        </div>`;
    }

    // --- エルゴ/ウエイト/その他: チップ一覧 ---
    const chipTypes = [SCHEDULE_TYPES.ERGO, SCHEDULE_TYPES.WEIGHT, SCHEDULE_TYPES.RUN, SCHEDULE_TYPES.MEAL, SCHEDULE_TYPES.VIDEO, SCHEDULE_TYPES.BANCHA];
    chipTypes.forEach(type => {
        if (!typeGroups[type]) return;
        const list = typeGroups[type];
        const cfg = typeConfig[type];

        const chips = list.map(s => {
            const u = state.users.find(u => u.id === s.userId);
            let extra = '';
            if (type === SCHEDULE_TYPES.ERGO) {
                extra = [s.ergoType, s.distance ? `${s.distance}m` : ''].filter(Boolean).join(' ');
            } else if (type === SCHEDULE_TYPES.MEAL) {
                extra = s.mealTypes ? s.mealTypes.join('/') : '';
            }
            return `<span class="ov-chip ${cfg.cls}-chip" ${extra ? `title="${extra}"` : ''}>${u?.name || '?'}${extra ? ` <small>${extra}</small>` : ''}</span>`;
        }).join('');

        detailHtml += `<div class="ov-type-section ${cfg.cls}-section">
            <div class="ov-type-header">${cfg.icon} ${cfg.label} (${list.length}人)</div>
            <div class="ov-chip-row">${chips}</div>
        </div>`;
    });

    return `<div class="timeline-block expanded">
        <div class="ov-card-header" onclick="this.parentElement.classList.toggle('expanded')">
            <span class="timeline-time-label">${displayTime}</span>
            <div class="ov-summary-badges">
                ${badgesHtml}
                <span class="ov-total-count">${entries.length}人</span>
                <span class="ov-expand-icon">▼</span>
            </div>
        </div>
        <div class="ov-card-body">${detailHtml}</div>
    </div>`;
}

// ======= マイレージランキング =======
function renderMileageRanking(period) {
    period = period || document.querySelector('.period-btn.active')?.dataset.period || 'week';
    const container = document.getElementById('mileage-ranking');
    if (!container) return;

    // 期間フィルタの日付範囲を計算
    const today = new Date();
    let startDate;
    if (period === 'week') {
        const dayOfWeek = today.getDay();
        const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
        startDate = new Date(today);
        startDate.setDate(today.getDate() - mondayOffset);
    } else if (period === 'month') {
        startDate = new Date(today.getFullYear(), today.getMonth(), 1);
    } else {
        startDate = new Date(2020, 0, 1); // 累計：全期間
    }
    const startDateStr = startDate.toISOString().slice(0, 10);
    const todayStr = today.toISOString().slice(0, 10);

    // 全ユーザーの距離を集計
    const userDistances = {};
    state.users.forEach(u => {
        userDistances[u.id] = { name: u.name, total: 0, sessions: 0 };
    });

    state.practiceNotes.forEach(note => {
        if (!note.rowingDistance || note.rowingDistance <= 0) return;
        if (note.date < startDateStr || note.date > todayStr) return;
        if (!userDistances[note.userId]) return;
        userDistances[note.userId].total += note.rowingDistance;
        userDistances[note.userId].sessions += 1;
    });

    // ソート（距離の大きい順）
    const sorted = Object.entries(userDistances)
        .filter(([_, d]) => d.total > 0)
        .sort((a, b) => b[1].total - a[1].total);

    if (sorted.length === 0) {
        container.innerHTML = `<div class="mileage-empty">
            <p>まだ練習距離の記録がありません</p>
            <p class="text-muted">練習ノート → 漕いだ距離を入力するとランキングに反映されます</p>
        </div>`;
        return;
    }

    const medals = ['🥇', '🥈', '🥉'];
    const maxDistance = sorted[0][1].total;

    let html = '';
    sorted.forEach(([userId, data], index) => {
        const rank = index + 1;
        const medal = medals[index] || `${rank}`;
        const isMe = state.currentUser && userId === state.currentUser.id;
        const barWidth = maxDistance > 0 ? (data.total / maxDistance * 100) : 0;
        const km = (data.total / 1000).toFixed(1);

        html += `<div class="mileage-row ${isMe ? 'mileage-me' : ''}">
            <span class="mileage-rank">${medal}</span>
            <span class="mileage-name">${data.name}</span>
            <div class="mileage-bar-container">
                <div class="mileage-bar" style="width: ${barWidth}%"></div>
            </div>
            <span class="mileage-distance">${km}km</span>
            <span class="mileage-sessions">${data.sessions}回</span>
        </div>`;
    });

    // 自分がランキング外の場合にも表示
    if (state.currentUser && !sorted.find(([uid]) => uid === state.currentUser.id)) {
        html += `<div class="mileage-row mileage-me mileage-unranked">
            <span class="mileage-rank">—</span>
            <span class="mileage-name">${state.currentUser.name}</span>
            <div class="mileage-bar-container">
                <div class="mileage-bar" style="width: 0%"></div>
            </div>
            <span class="mileage-distance">0km</span>
            <span class="mileage-sessions">0回</span>
        </div>`;
    }

    container.innerHTML = html;
}

// マイレージウィジェットの展開/折りたたみ
function toggleMileageExpand() {
    const body = document.getElementById('mileage-widget-body');
    const icon = document.getElementById('mileage-expand-icon');
    if (body) {
        body.classList.toggle('hidden');
        if (icon) icon.textContent = body.classList.contains('hidden') ? '▼' : '▲';
    }
}

// 週間距離サマリーを更新
function updateMileageWeekSummary() {
    const summary = document.getElementById('mileage-week-summary');
    if (!summary || !state.currentUser) return;

    const today = new Date();
    const dayOfWeek = today.getDay();
    const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const startDate = new Date(today);
    startDate.setDate(today.getDate() - mondayOffset);
    const startDateStr = startDate.toISOString().slice(0, 10);
    const todayStr = today.toISOString().slice(0, 10);

    let myTotal = 0;
    (state.practiceNotes || []).forEach(note => {
        if (note.userId !== state.currentUser.id) return;
        if (!note.rowingDistance || note.rowingDistance <= 0) return;
        if (note.date < startDateStr || note.date > todayStr) return;
        myTotal += note.rowingDistance;
    });

    const km = (myTotal / 1000).toFixed(1);
    summary.textContent = `今週 ${km}km`;
}

// 週間練習サマリーウィジェット
function renderWeeklyPracticeSummary() {
    const container = document.getElementById('weekly-practice-summary');
    if (!container || !state.currentUser) return;

    const today = new Date();
    const dayOfWeek = today.getDay();
    const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const monday = new Date(today);
    monday.setDate(today.getDate() - mondayOffset);
    monday.setHours(0, 0, 0, 0);

    const weekDays = [];
    for (let i = 0; i < 7; i++) {
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        weekDays.push(d.toISOString().slice(0, 10));
    }

    // タイプ別集計
    const typeCounts = {};
    const typeConfig = {
        [SCHEDULE_TYPES.BOAT]: { icon: '🚣', label: '乗艇', cls: 'boat' },
        [SCHEDULE_TYPES.ERGO]: { icon: '🏋️', label: 'エルゴ', cls: 'ergo' },
        [SCHEDULE_TYPES.WEIGHT]: { icon: '💪', label: 'ウェイト', cls: 'weight' },
        [SCHEDULE_TYPES.RUN]: { icon: '🏃', label: 'ラン', cls: 'run' },
        [SCHEDULE_TYPES.BANCHA]: { icon: '🚴', label: '伴チャ', cls: 'bancha' },
        [SCHEDULE_TYPES.OFF]: { icon: '🏖️', label: 'OFF', cls: 'off' },
        [SCHEDULE_TYPES.ABSENT]: { icon: '❌', label: '不可', cls: 'absent' }
    };

    state.schedules
        .filter(s => s.userId === state.currentUser.id && weekDays.includes(s.date))
        .forEach(s => {
            typeCounts[s.scheduleType] = (typeCounts[s.scheduleType] || 0) + 1;
        });

    // バッジ生成（参加不可は除外）
    let badgesHtml = '';
    Object.entries(typeCounts).forEach(([type, count]) => {
        if (type === SCHEDULE_TYPES.ABSENT) return;
        const cfg = typeConfig[type] || { icon: '📋', label: type, cls: '' };
        badgesHtml += `<span class="wps-badge ${cfg.cls}">${cfg.icon} ${cfg.label} ${count}</span>`;
    });

    if (!badgesHtml) {
        container.innerHTML = '';
        return;
    }

    container.innerHTML = `
        <div class="wps-title">📊 今週の練習</div>
        <div class="wps-badges">${badgesHtml}</div>
    `;
}


function renderAvailableBoats(dateStr, container) {
    if (!container) return;

    const usedBoatIds = state.schedules
        .filter(s => s.date === dateStr && s.scheduleType === SCHEDULE_TYPES.BOAT && s.boatId)
        .map(s => s.boatId);

    const availableBoats = state.boats.filter(b => !usedBoatIds.includes(b.id) && b.availability === '使用可能');

    // 艇種ごとにグループ化
    const groupedBoats = {};
    availableBoats.forEach(b => {
        let type = 'その他';
        if (b.name.includes('8+')) type = '8+';
        else if (b.name.includes('4+')) type = '4+';
        else if (b.name.includes('4x')) type = '4x';
        else if (b.name.includes('2-')) type = '2-';
        else if (b.name.includes('2x')) type = '2x';
        else if (b.name.includes('1x')) type = '1x';
        if (!groupedBoats[type]) groupedBoats[type] = [];
        groupedBoats[type].push(b);
    });

    let bodyHtml;
    if (availableBoats.length > 0) {
        const groupsHtml = Object.keys(groupedBoats).sort().map(type => {
            const boats = groupedBoats[type].map(b => `<span class="boat-tag available">${b.name}</span>`).join('');
            return `<div class="boat-group"><span class="boat-type-label">${type}:</span> ${boats}</div>`;
        }).join('');
        bodyHtml = `<div class="available-boats-list">${groupsHtml}</div>`;
    } else {
        bodyHtml = `<div class="empty-state sub-empty"><p>空き艇なし</p></div>`;
    }

    container.innerHTML = `
        <div class="accordion-header boats-accordion-header" onclick="this.parentElement.classList.toggle('open')">
            <span>🚣 空き艇状況 (${availableBoats.length}艇)</span>
            <span class="accordion-icon">▶</span>
        </div>
        <div class="accordion-body">${bodyHtml}</div>
    `;
}

// =========================================
// 練習ノート機能
// =========================================

// 練習ノートを自動作成（saveScheduleから呼ばれる）
function autoCreatePracticeNote(schedule) {
    const existing = state.practiceNotes.find(n => n.scheduleId === schedule.id);
    if (existing) return;

    let crewNoteId = null;
    if (schedule.scheduleType === SCHEDULE_TYPES.BOAT) {
        const crewNote = state.crews.find(c =>
            c.date === schedule.date &&
            c.memberIds?.includes(schedule.userId)
        );
        if (crewNote) crewNoteId = crewNote.id;
    }

    const note = {
        id: generateId(),
        scheduleId: schedule.id,
        userId: schedule.userId,
        date: schedule.date,
        timeSlot: schedule.timeSlot,
        scheduleType: schedule.scheduleType,
        reflection: '',
        ergoRecordIds: [],
        crewNoteId: crewNoteId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };

    state.practiceNotes.push(note);
    DB.save('practice_notes', state.practiceNotes);

    // Supabaseにも保存
    if (DB.useSupabase && window.SupabaseConfig?.db) {
        window.SupabaseConfig.db.savePracticeNote(note).catch(e => console.warn('Practice note sync failed:', e));
    }
}

// 練習ノート一覧を表示
function renderPracticeNotesList() {
    const container = document.getElementById('practice-notes-list');
    if (!container) return;

    let myNotes = state.practiceNotes
        .filter(n => n.userId === state.currentUser.id)
        .sort((a, b) => b.date.localeCompare(a.date) || (b.timeSlot || '').localeCompare(a.timeSlot || ''));

    // フィルター適用
    if (practiceNoteFilter && practiceNoteFilter !== 'all') {
        myNotes = myNotes.filter(n => {
            const schedule = state.schedules.find(s => s.id === n.scheduleId);
            const type = schedule?.scheduleType || n.scheduleType || '';
            return type === practiceNoteFilter;
        });
    }

    if (myNotes.length === 0) {
        const filterMsg = practiceNoteFilter !== 'all' ? `（${practiceNoteFilter}）` : '';
        container.innerHTML = `
            <div class="empty-state">
                <p>📝 ${filterMsg}の練習記録はありません</p>
            </div>
        `;
        return;
    }

    const byDate = {};
    myNotes.forEach(note => {
        if (!byDate[note.date]) byDate[note.date] = [];
        byDate[note.date].push(note);
    });

    let html = '';
    Object.keys(byDate).sort((a, b) => b.localeCompare(a)).forEach(date => {
        const display = formatDisplayDate(date);
        let weekdayClass = '';
        if (display.dayOfWeek === 0) weekdayClass = 'sunday';
        if (display.dayOfWeek === 6) weekdayClass = 'saturday';

        html += `<div class="pn-date-group">`;
        html += `<div class="pn-date-header">${display.month}/${display.day} <span class="weekday ${weekdayClass}">(${display.weekday})</span></div>`;

        byDate[date].forEach(note => {
            const schedule = state.schedules.find(s => s.id === note.scheduleId);
            const typeLabel = schedule?.scheduleType || note.scheduleType || '不明';
            const hasReflection = note.reflection && note.reflection.trim().length > 0;
            const hasErgo = note.ergoRecordIds && note.ergoRecordIds.length > 0;
            const hasWeight = note.weightMenus && note.weightMenus.length > 0;
            const timeLabel = schedule?.startTime || note.timeSlot || '';

            let badgeClass = 'default';
            if (typeLabel === SCHEDULE_TYPES.ERGO) badgeClass = 'ergo';
            else if (typeLabel === SCHEDULE_TYPES.BOAT) badgeClass = 'boat';
            else if (typeLabel === SCHEDULE_TYPES.WEIGHT) badgeClass = 'weight';
            else if (typeLabel === SCHEDULE_TYPES.RUN) badgeClass = 'run';

            // 練習メニュー情報を組み立て
            let menuInfoParts = [];
            if (typeLabel === SCHEDULE_TYPES.BOAT && note.rowingDistance) {
                menuInfoParts.push(`${(note.rowingDistance / 1000).toFixed(1)}km`);
            }
            if (typeLabel === SCHEDULE_TYPES.BOAT && note.rowingMenus && note.rowingMenus.length > 0) {
                const winds = [...new Set(note.rowingMenus.map(m => m.wind).filter(Boolean))];
                if (winds.length > 0) {
                    const windEmoji = { '順風': '↗️', '逆風': '↙️', '横風': '↔️', '無風': '🔵', '順逆両方': '⇅' };
                    const windText = winds.map(w => (windEmoji[w] || '') + w).join('/');
                    menuInfoParts.push(windText);
                }
            }
            if (typeLabel === SCHEDULE_TYPES.RUN && note.runDistance) {
                menuInfoParts.push(`${note.runDistance}km`);
            }
            if (typeLabel === SCHEDULE_TYPES.WEIGHT && note.weightBodyPart) {
                menuInfoParts.push(note.weightBodyPart);
            }
            if (hasWeight) {
                menuInfoParts.push(`${note.weightMenus.length}種目`);
            }
            const hasRowingMenu = note.rowingMenus && note.rowingMenus.length > 0;
            if (hasRowingMenu) {
                const menuSummary = note.rowingMenus.map(m => {
                    if (m.mode === 'onoff') return `${m.onDist}on${m.offDist}off`;
                    return `rt${m.rate}`;
                }).join(', ');
                menuInfoParts.push(menuSummary);
            }
            if (hasErgo) {
                menuInfoParts.push('エルゴデータ');
            }
            if (schedule?.memo) {
                menuInfoParts.push(schedule.memo);
            }
            const menuInfoText = menuInfoParts.length > 0 ? menuInfoParts.join(' / ') : '';

            html += `
                <div class="pn-card" data-note-id="${note.id}">
                    <div class="pn-card-header">
                        <span class="slot-type-badge ${badgeClass}">${typeLabel}</span>
                        <span class="pn-time">${timeLabel}</span>
                    </div>
                    <div class="pn-card-body">
                        ${menuInfoText ? `<p class="pn-menu-info">${menuInfoText}</p>` : ''}
                        <div class="pn-tags">
                            ${hasReflection ? '<span class="pn-tag">📝 振り返りあり</span>' : '<span class="pn-tag pn-tag-empty">振り返りを書く</span>'}
                            ${note.crewNoteId ? '<span class="pn-tag">🚣 クルー</span>' : ''}
                        </div>
                    </div>
                </div>
            `;
        });

        html += `</div>`;
    });

    container.innerHTML = html;

    container.querySelectorAll('.pn-card').forEach(card => {
        card.addEventListener('click', () => {
            openPracticeNoteModal(card.dataset.noteId);
        });
    });
}

// 練習ノートモーダルを開く
function openPracticeNoteModal(noteId) {
    const note = state.practiceNotes.find(n => n.id === noteId);
    if (!note) return;

    const schedule = state.schedules.find(s => s.id === note.scheduleId);
    const modal = document.getElementById('practice-note-modal');

    const summaryEl = document.getElementById('practice-note-summary');
    const display = formatDisplayDate(note.date);
    const typeLabel = schedule?.scheduleType || '不明';
    const timeLabel = schedule?.startTime || note.timeSlot || '';
    const memoText = schedule?.memo ? `<div class="pn-memo">📋 ${schedule.memo}</div>` : '';

    summaryEl.innerHTML = `
        <div class="pn-summary-header">
            <span class="pn-summary-date">${display.month}/${display.day} (${display.weekday})</span>
            <span class="slot-type-badge">${typeLabel}</span>
            ${timeLabel ? `<span class="pn-summary-time">${timeLabel}</span>` : ''}
        </div>
        ${memoText}
    `;

    document.getElementById('practice-note-reflection').value = note.reflection || '';
    renderLinkedErgoRecords(note);

    const crewLinkGroup = document.getElementById('crew-note-link-group');
    if (note.crewNoteId || (schedule && schedule.scheduleType === SCHEDULE_TYPES.BOAT)) {
        crewLinkGroup.classList.remove('hidden');
        const crewNote = state.crews.find(c => c.id === note.crewNoteId);
        const linkInfo = document.getElementById('crew-note-link-info');
        if (crewNote) {
            const members = (crewNote.memberIds || []).map(id => {
                const u = state.users.find(u => u.id === id);
                return u ? u.name : '?';
            }).join(', ');
            linkInfo.innerHTML = `
                <div class="crew-note-link-card" data-crew-note-id="${crewNote.id}">
                    <span>${crewNote.boatType || ''} — ${members}</span>
                    <button class="secondary-btn small-btn" onclick="openCrewNoteFromLink('${crewNote.id}')">開く →</button>
                </div>
            `;
        } else {
            linkInfo.innerHTML = `<p class="text-muted">クルーノートはまだ作成されていません</p>`;
        }
    } else {
        crewLinkGroup.classList.add('hidden');
    }

    // 漕いだ距離入力（乗艇時のみ表示）
    const distanceGroup = document.getElementById('rowing-distance-group');
    if (schedule && schedule.scheduleType === SCHEDULE_TYPES.BOAT) {
        distanceGroup.classList.remove('hidden');
        document.getElementById('practice-note-distance').value = note.rowingDistance || '';
    } else {
        distanceGroup.classList.add('hidden');
        document.getElementById('practice-note-distance').value = '';

        // 乗艇メニュー（乗艇時のみ表示）
        const rowingMenuGroup = document.getElementById('rowing-menu-group');
        if (schedule && schedule.scheduleType === SCHEDULE_TYPES.BOAT) {
            rowingMenuGroup.classList.remove('hidden');
            renderRowingMenuItems(note.rowingMenus || []);
        } else {
            rowingMenuGroup.classList.add('hidden');
            const rmList = document.getElementById('rowing-menu-list');
            if (rmList) rmList.innerHTML = '';
        }

        // ラン距離入力（ラン時のみ表示）
        const runDistanceGroup = document.getElementById('running-distance-group');
        if (schedule && schedule.scheduleType === SCHEDULE_TYPES.RUN) {
            runDistanceGroup.classList.remove('hidden');
            document.getElementById('practice-note-run-distance').value = note.runDistance || '';
        } else {
            runDistanceGroup.classList.add('hidden');
            document.getElementById('practice-note-run-distance').value = '';
        }

        // ウェイト部位選択（ウェイト時のみ表示）
        const weightPartGroup = document.getElementById('weight-body-part-group');
        const schedType = schedule?.scheduleType || note.scheduleType || '';
        if (schedType === SCHEDULE_TYPES.WEIGHT) {
            weightPartGroup.classList.remove('hidden');
            // トグルボタンの選択状態を復元
            document.querySelectorAll('.weight-part-btn').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.value === (note.weightBodyPart || ''));
                btn.addEventListener('click', () => {
                    document.querySelectorAll('.weight-part-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                });
            });
        } else {
            weightPartGroup.classList.add('hidden');
        }

        // ウェイトメニュー（ウェイト時のみ表示）
        const weightGroup = document.getElementById('weight-menu-group');
        if (schedType === SCHEDULE_TYPES.WEIGHT) {
            weightGroup.classList.remove('hidden');
            renderWeightMenuItems(note.weightMenus || []);
        } else {
            weightGroup.classList.add('hidden');
        }

        modal.dataset.noteId = noteId;
        modal.classList.remove('hidden');
    }

    // エルゴデータタブに遷移して指定レコードを表示
    function navigateToErgoRecord(recId) {
        // 練習ノートモーダルを閉じる
        const noteModal = document.getElementById('practice-note-modal');
        if (noteModal) noteModal.classList.add('hidden');

        // エルゴデータタブに切り替え
        switchTab('ergo-data');

        // 遷移後に該当レコードのスプリットモーダルを開く
        setTimeout(() => {
            const rec = state.ergoRecords.find(r => r.id === recId);
            if (rec && typeof showSplits === 'function') {
                showSplits(rec);
            } else {
                showToast('エルゴデータタブに移動しました', 'info');
            }
        }, 300);
    }

    function renderLinkedErgoRecords(note) {
        const container = document.getElementById('linked-ergo-records');
        if (!note.ergoRecordIds || note.ergoRecordIds.length === 0) {
            container.innerHTML = '<p class="text-muted">紐づけなし</p>';
            return;
        }

        let html = '';
        note.ergoRecordIds.forEach(recId => {
            const rec = state.ergoRecords.find(r => r.id === recId);
            if (rec) {
                const distLabel = rec.distance ? `${rec.distance}m` : '?m';
                const timeLabel = rec.timeDisplay || '?';
                const splitLabel = rec.split ? `${rec.split}/500m` : '';
                const rateLabel = rec.strokeRate ? `${rec.strokeRate} spm` : '';
                const sourceLabel = rec.source === 'concept2' ? 'Concept2同期' : '手入力';
                const weightLabel = rec.weight ? `${rec.weight}kg` : '';

                html += `
                <div class="linked-ergo-item-wrapper">
                    <div class="linked-ergo-item" onclick="this.parentElement.classList.toggle('expanded')">
                        <span>📊 ${distLabel} — ${timeLabel} ${splitLabel ? `(${splitLabel})` : ''}</span>
                        <div class="linked-ergo-actions">
                            <button class="btn-icon-sm ergo-nav-btn" title="エルゴデータで表示" onclick="event.stopPropagation(); navigateToErgoRecord('${recId}')">📈</button>
                            <span class="ergo-expand-icon">▶</span>
                            <button class="btn-icon-sm" onclick="event.stopPropagation(); unlinkErgoRecord('${recId}')">✕</button>
                        </div>
                    </div>
                    <div class="linked-ergo-detail">
                        <div class="ergo-detail-grid">
                            <div class="ergo-detail-cell">
                                <span class="ergo-detail-label">距離</span>
                                <span class="ergo-detail-value">${distLabel}</span>
                            </div>
                            <div class="ergo-detail-cell">
                                <span class="ergo-detail-label">タイム</span>
                                <span class="ergo-detail-value">${timeLabel}</span>
                            </div>
                            ${splitLabel ? `<div class="ergo-detail-cell">
                                <span class="ergo-detail-label">スプリット</span>
                                <span class="ergo-detail-value">${splitLabel}</span>
                            </div>` : ''}
                            ${rateLabel ? `<div class="ergo-detail-cell">
                                <span class="ergo-detail-label">レート</span>
                                <span class="ergo-detail-value">${rateLabel}</span>
                            </div>` : ''}
                            ${weightLabel ? `<div class="ergo-detail-cell">
                                <span class="ergo-detail-label">体重</span>
                                <span class="ergo-detail-value">${weightLabel}</span>
                            </div>` : ''}
                            <div class="ergo-detail-cell">
                                <span class="ergo-detail-label">ソース</span>
                                <span class="ergo-detail-value">${sourceLabel}</span>
                            </div>
                        </div>
                        <button class="secondary-btn small-btn" style="margin-top: 8px; width: 100%;" onclick="navigateToErgoRecord('${recId}')">📈 エルゴデータで詳しく見る</button>
                    </div>
                </div>
            `;
            }
        });
        container.innerHTML = html || '<p class="text-muted">紐づけなし</p>';
    }

    function showErgoSelectList(noteId) {
        const note = state.practiceNotes.find(n => n.id === noteId);
        if (!note) return;

        const selectList = document.getElementById('ergo-select-list');
        // 全データから選択可能に（同日限定を解除）
        const availableRecords = state.ergoRecords.filter(r =>
            r.userId === note.userId &&
            !(note.ergoRecordIds || []).includes(r.id)
        ).sort((a, b) => new Date(b.date) - new Date(a.date)); // 新しい順

        if (availableRecords.length === 0) {
            selectList.innerHTML = '<p class="text-muted">紐付け可能なエルゴデータがありません</p>';
        } else {
            selectList.innerHTML = availableRecords.map(rec => `
            <div class="ergo-select-item" data-record-id="${rec.id}">
                <span>📊 ${rec.date || '日付不明'} | ${rec.distance || '?'}m — ${rec.timeDisplay || '?'} ${rec.menuKey ? `(${rec.menuKey})` : ''} ${rec.source === 'concept2' || rec.source === 'Concept2' ? '(C2)' : '(手入力)'}</span>
                <button class="secondary-btn small-btn">追加</button>
            </div>
        `).join('');

            selectList.querySelectorAll('.ergo-select-item button').forEach(btn => {
                btn.addEventListener('click', () => {
                    const recId = btn.closest('.ergo-select-item').dataset.recordId;
                    linkErgoRecord(noteId, recId);
                });
            });
        }

        selectList.classList.remove('hidden');
    }

    function linkErgoRecord(noteId, recordId) {
        const note = state.practiceNotes.find(n => n.id === noteId);
        if (!note) return;
        if (!note.ergoRecordIds) note.ergoRecordIds = [];
        if (!note.ergoRecordIds.includes(recordId)) {
            note.ergoRecordIds.push(recordId);
            note.updatedAt = new Date().toISOString();
            DB.save('practice_notes', state.practiceNotes);
            if (DB.useSupabase && window.SupabaseConfig?.db) {
                window.SupabaseConfig.db.savePracticeNote(note).catch(e => console.warn('Practice note sync failed:', e));
            }
            renderLinkedErgoRecords(note);
            showErgoSelectList(noteId);
        }
    }

    function unlinkErgoRecord(recordId) {
        const modal = document.getElementById('practice-note-modal');
        const noteId = modal.dataset.noteId;
        const note = state.practiceNotes.find(n => n.id === noteId);
        if (!note) return;
        note.ergoRecordIds = (note.ergoRecordIds || []).filter(id => id !== recordId);
        note.updatedAt = new Date().toISOString();
        DB.save('practice_notes', state.practiceNotes);
        if (DB.useSupabase && window.SupabaseConfig?.db) {
            window.SupabaseConfig.db.savePracticeNote(note).catch(e => console.warn('Practice note sync failed:', e));
        }
        renderLinkedErgoRecords(note);
    }

    function savePracticeNote() {
        const modal = document.getElementById('practice-note-modal');
        const noteId = modal.dataset.noteId;
        const note = state.practiceNotes.find(n => n.id === noteId);
        if (!note) return;

        note.reflection = document.getElementById('practice-note-reflection').value || '';

        // 漕いだ距離を保存
        const distanceInput = document.getElementById('practice-note-distance');
        if (distanceInput && distanceInput.value) {
            note.rowingDistance = parseInt(distanceInput.value);
        } else {
            note.rowingDistance = null;
        }

        // ラン距離を保存
        const runDistanceInput = document.getElementById('practice-note-run-distance');
        if (runDistanceInput && runDistanceInput.value) {
            note.runDistance = parseFloat(runDistanceInput.value);
        } else {
            note.runDistance = null;
        }

        // ウェイト部位を保存
        const activePartBtn = document.querySelector('.weight-part-btn.active');
        if (activePartBtn) {
            note.weightBodyPart = activePartBtn.dataset.value;
        }

        // ウェイトメニューを保存
        const weightGroup = document.getElementById('weight-menu-group');
        if (weightGroup && !weightGroup.classList.contains('hidden')) {
            note.weightMenus = getWeightMenuData();
        }

        // 乗艇メニューを保存
        const rowingMenuGroup = document.getElementById('rowing-menu-group');
        if (rowingMenuGroup && !rowingMenuGroup.classList.contains('hidden')) {
            note.rowingMenus = getRowingMenuData();
        }

        note.updatedAt = new Date().toISOString();

        DB.save('practice_notes', state.practiceNotes);

        // Supabaseにも保存
        if (DB.useSupabase && window.SupabaseConfig?.db) {
            window.SupabaseConfig.db.savePracticeNote(note).catch(e => console.warn('Practice note sync failed:', e));
        }

        // クルー共有: 乗艇メニューを同クルーのメンバーに自動コピー
        if (note.rowingMenus && note.rowingMenus.length > 0 && note.scheduleType === SCHEDULE_TYPES.BOAT) {
            shareRowingMenuToCrew(note);
        }

        modal.classList.add('hidden');
        renderPracticeNotesList();
        showToast('保存しました', 'success');
    }

    /**
     * 練習ノートを削除
     */
    function deletePracticeNote() {
        const modal = document.getElementById('practice-note-modal');
        const noteId = modal.dataset.noteId;
        if (!noteId) return;

        if (!confirm('この練習ノートを削除しますか？')) return;

        const idx = state.practiceNotes.findIndex(n => n.id === noteId);
        if (idx === -1) return;

        state.practiceNotes.splice(idx, 1);
        DB.save('practice_notes', state.practiceNotes);

        // Supabaseからも削除
        if (DB.useSupabase && window.SupabaseConfig?.db) {
            window.SupabaseConfig.db.deletePracticeNote(noteId).catch(e => console.warn('Practice note delete sync failed:', e));
        }

        modal.classList.add('hidden');
        renderPracticeNotesList();
        showToast('練習ノートを削除しました', 'info');
    }

    // =========================================
    // ウェイトメニュー管理
    // =========================================

    function addWeightMenuItem(exercise, weight, reps, sets) {
        const list = document.getElementById('weight-menu-list');
        if (!list) return;

        const idx = list.querySelectorAll('.weight-menu-item').length;
        const item = document.createElement('div');
        item.className = 'weight-menu-item';
        item.innerHTML = `
        <div class="wm-row">
            <input type="text" class="wm-exercise" placeholder="種目名 (例: ベンチプレス)" value="${exercise || ''}">
            <button type="button" class="wm-remove-btn" onclick="this.closest('.weight-menu-item').remove()">✕</button>
        </div>
        <div class="wm-detail-row">
            <div class="wm-field">
                <label>重さ(kg)</label>
                <input type="number" class="wm-weight" placeholder="0" min="0" step="0.5" value="${weight || ''}">
            </div>
            <div class="wm-field">
                <label>回数</label>
                <input type="number" class="wm-reps" placeholder="0" min="0" value="${reps || ''}">
            </div>
            <div class="wm-field">
                <label>セット</label>
                <input type="number" class="wm-sets" placeholder="0" min="0" value="${sets || ''}">
            </div>
        </div>
    `;
        list.appendChild(item);
    }

    function renderWeightMenuItems(items) {
        const list = document.getElementById('weight-menu-list');
        if (!list) return;
        list.innerHTML = '';
        if (items && items.length > 0) {
            items.forEach(m => addWeightMenuItem(m.exercise, m.weight, m.reps, m.sets));
        } else {
            // 空なら1行追加
            addWeightMenuItem();
        }
    }

    function getWeightMenuData() {
        const items = document.querySelectorAll('#weight-menu-list .weight-menu-item');
        const data = [];
        items.forEach(item => {
            const exercise = item.querySelector('.wm-exercise')?.value?.trim();
            const weight = parseFloat(item.querySelector('.wm-weight')?.value) || 0;
            const reps = parseInt(item.querySelector('.wm-reps')?.value) || 0;
            const sets = parseInt(item.querySelector('.wm-sets')?.value) || 0;
            if (exercise) {
                data.push({ exercise, weight, reps, sets });
            }
        });
        return data;
    }

    // =========================================
    // 乗艇メニュー入力
    // =========================================

    function addRowingMenuItem(mode, rate, distance, avgTime, onDist, offDist, wind) {
        const list = document.getElementById('rowing-menu-list');
        if (!list) return;

        const isOnOff = mode === 'onoff';
        const windVal = wind || '';
        const item = document.createElement('div');
        item.className = 'rowing-menu-item';
        item.dataset.mode = isOnOff ? 'onoff' : 'normal';

        item.innerHTML = `
        <div class="rm-header">
            <div class="rm-mode-toggle">
                <button type="button" class="rm-mode-btn ${!isOnOff ? 'active' : ''}" data-mode="normal" onclick="switchRowingMenuMode(this)">通常</button>
                <button type="button" class="rm-mode-btn ${isOnOff ? 'active' : ''}" data-mode="onoff" onclick="switchRowingMenuMode(this)">On/Off</button>
            </div>
            <select class="rm-wind" style="font-size:12px;padding:3px 6px;border-radius:6px;border:1px solid #d1d5db;background:var(--bg-white);color:var(--text-primary);">
                <option value="" ${!windVal ? 'selected' : ''}>🌬️ 風</option>
                <option value="無風" ${windVal === '無風' ? 'selected' : ''}>🔵 無風</option>
                <option value="横風" ${windVal === '横風' ? 'selected' : ''}>↔️ 横風</option>
                <option value="順風" ${windVal === '順風' ? 'selected' : ''}>↗️ 順風</option>
                <option value="逆風" ${windVal === '逆風' ? 'selected' : ''}>↙️ 逆風</option>
                <option value="順逆両方" ${windVal === '順逆両方' ? 'selected' : ''}>⇅ 順逆両方</option>
            </select>
            <button type="button" class="rm-remove-btn" onclick="this.closest('.rowing-menu-item').remove()">✕</button>
        </div>
        <div class="rm-fields rm-normal-fields" ${isOnOff ? 'style="display:none"' : ''}>
            <div class="rm-field">
                <label>レート</label>
                <input type="number" class="rm-rate" placeholder="20" min="10" max="50" value="${rate || ''}">
            </div>
            <div class="rm-field">
                <label>距離(m)</label>
                <input type="number" class="rm-distance" placeholder="6000" min="0" step="100" value="${(!isOnOff && distance) || ''}">
            </div>
            <div class="rm-field">
                <label>Ave(/500m)</label>
                <input type="text" class="rm-avgtime" placeholder="2:05" value="${avgTime || ''}">
            </div>
        </div>
        <div class="rm-fields rm-onoff-fields" ${!isOnOff ? 'style="display:none"' : ''}>
            <div class="rm-field">
                <label>On(m)</label>
                <input type="number" class="rm-on" placeholder="300" min="0" step="50" value="${onDist || ''}">
            </div>
            <div class="rm-field">
                <label>Off(m)</label>
                <input type="number" class="rm-off" placeholder="200" min="0" step="50" value="${offDist || ''}">
            </div>
            <div class="rm-field">
                <label>レート</label>
                <input type="number" class="rm-rate-onoff" placeholder="28" min="10" max="50" value="${(isOnOff && rate) || ''}">
            </div>
            <div class="rm-field">
                <label>合計(m)</label>
                <input type="number" class="rm-distance-onoff" placeholder="3000" min="0" step="100" value="${(isOnOff && distance) || ''}">
            </div>
            <div class="rm-field">
                <label>Ave</label>
                <input type="text" class="rm-avgtime-onoff" placeholder="1:50" value="${(isOnOff && avgTime) || ''}">
            </div>
        </div>
    `;
        list.appendChild(item);
    }

    function switchRowingMenuMode(btn) {
        const item = btn.closest('.rowing-menu-item');
        const mode = btn.dataset.mode;
        item.dataset.mode = mode;
        item.querySelectorAll('.rm-mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
        item.querySelector('.rm-normal-fields').style.display = mode === 'normal' ? '' : 'none';
        item.querySelector('.rm-onoff-fields').style.display = mode === 'onoff' ? '' : 'none';
    }

    function renderRowingMenuItems(items) {
        const list = document.getElementById('rowing-menu-list');
        if (!list) return;
        list.innerHTML = '';
        if (items && items.length > 0) {
            items.forEach(m => addRowingMenuItem(m.mode, m.rate, m.distance, m.avgTime, m.onDist, m.offDist, m.wind));
        }
    }

    function getRowingMenuData() {
        const items = document.querySelectorAll('#rowing-menu-list .rowing-menu-item');
        const data = [];
        items.forEach(item => {
            const mode = item.dataset.mode || 'normal';
            const wind = item.querySelector('.rm-wind')?.value || '';
            if (mode === 'onoff') {
                const onDist = parseInt(item.querySelector('.rm-on')?.value) || 0;
                const offDist = parseInt(item.querySelector('.rm-off')?.value) || 0;
                const rate = parseInt(item.querySelector('.rm-rate-onoff')?.value) || 0;
                const distance = parseInt(item.querySelector('.rm-distance-onoff')?.value) || 0;
                const avgTime = item.querySelector('.rm-avgtime-onoff')?.value?.trim() || '';
                if (onDist || offDist || rate || distance) {
                    data.push({ mode: 'onoff', onDist, offDist, rate, distance, avgTime, wind });
                }
            } else {
                const rate = parseInt(item.querySelector('.rm-rate')?.value) || 0;
                const distance = parseInt(item.querySelector('.rm-distance')?.value) || 0;
                const avgTime = item.querySelector('.rm-avgtime')?.value?.trim() || '';
                if (rate || distance) {
                    data.push({ mode: 'normal', rate, distance, avgTime, wind });
                }
            }
        });
        return data;
    }

    // クルー共有: 乗艇メニューを同クルーメンバーに自動コピー
    function shareRowingMenuToCrew(note) {
        if (!note.rowingMenus || note.rowingMenus.length === 0) return;

        // 同日・同艇のスケジュールを検索してクルーメンバーを特定
        const mySchedule = state.schedules.find(s => s.id === note.scheduleId);
        if (!mySchedule || !mySchedule.crewIds || mySchedule.crewIds.length === 0) return;

        let sharedCount = 0;
        mySchedule.crewIds.forEach(memberId => {
            if (memberId === note.userId) return; // 自分はスキップ

            // そのメンバーの同日の乗艇練習ノートを探す
            const memberNote = state.practiceNotes.find(n =>
                n.userId === memberId &&
                n.date === note.date &&
                (n.scheduleType === SCHEDULE_TYPES.BOAT || n.scheduleType === '乗艇')
            );

            if (memberNote) {
                // 既にメニューがある場合は上書きしない
                if (memberNote.rowingMenus && memberNote.rowingMenus.length > 0) return;

                memberNote.rowingMenus = JSON.parse(JSON.stringify(note.rowingMenus));
                memberNote.rowingMenusSharedFrom = note.userId;
                memberNote.updatedAt = new Date().toISOString();
                sharedCount++;

                if (DB.useSupabase && window.SupabaseConfig?.db) {
                    window.SupabaseConfig.db.savePracticeNote(memberNote).catch(e => console.warn('Crew share sync failed:', e));
                }
            }
        });

        if (sharedCount > 0) {
            DB.save('practice_notes', state.practiceNotes);
            showToast(`メニューをクルー${sharedCount}人に共有しました`, 'success');
        }
    }

    // =========================================
    // 練習記録フィルター
    // =========================================

    let practiceNoteFilter = 'all';

    function filterPracticeNotes(filter) {
        practiceNoteFilter = filter;
        document.querySelectorAll('.pn-filter-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.filter === filter);
        });
        renderPracticeNotesList();
    }

    function openCrewNoteFromLink(crewNoteId) {
        document.getElementById('practice-note-modal').classList.add('hidden');
        const crewNote = state.crews.find(c => c.id === crewNoteId);
        if (crewNote) {
            openCrewNoteModal(crewNote);
        }
    }

    function switchNoteSubtab(subtab) {
        document.querySelectorAll('.note-subtab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.subtab === subtab);
        });
        document.querySelectorAll('.note-subtab-content').forEach(content => {
            content.classList.toggle('hidden', content.id !== `subtab-${subtab}`);
        });

        if (subtab === 'practice') {
            renderPracticeNotesList();
            renderWeeklyPracticeSummary();
        } else if (subtab === 'crew') {
            renderCrewList();
        }
    }

    // =========================================
    // データ（記録）タブ
    // =========================================

    // ナビゲーション状態
    let ergoNavState = {
        level: 'all',        // 'all' | 'category' | 'menu' | 'records'
        category: null,      // 'distance' | 'time' | 'interval'
        menuKey: null,       // '2000m TT' | '10000m' など
        period: 'all'
    };

    // コーチ用エルゴビュー：閲覧対象ユーザーID取得
    function getErgoViewUserId() {
        const select = document.getElementById('coach-player-select');
        if (select && select.value && !select.closest('.hidden')) {
            return select.value;
        }
        return state.currentUser?.id;
    }

    // =========================================
    // 全員データビュー
    // =========================================

    /**
     * 全員データビュー初期化: ユーザー一覧をプルダウンに投入しイベント設定
     */
    function initAllMembersErgoView() {
        const userSelect = document.getElementById('all-members-user-select');
        const menuSelect = document.getElementById('all-members-menu-select');
        if (!userSelect || !menuSelect) return;

        // ユーザー一覧を構築（承認済みのみ）
        const currentVal = userSelect.value;
        userSelect.innerHTML = '<option value="">選手を選択…</option>';
        state.users
            .filter(u => u.approvalStatus === '承認済み' && !u.isDemo)
            .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
            .forEach(u => {
                const opt = document.createElement('option');
                opt.value = u.id;
                opt.textContent = u.name || u.id;
                userSelect.appendChild(opt);
            });
        if (currentVal) userSelect.value = currentVal;

        // イベントリスナー（onchangeで重複防止）
        userSelect.onchange = () => renderAllMembersErgo();
        menuSelect.onchange = () => renderAllMembersErgo();

        // 初期表示
        renderAllMembersErgo();
    }

    /**
     * 選択された選手のエルゴ記録を表示
     */
    function renderAllMembersErgo() {
        const listEl = document.getElementById('all-members-ergo-list');
        const userSelect = document.getElementById('all-members-user-select');
        const menuSelect = document.getElementById('all-members-menu-select');
        if (!listEl || !userSelect) return;

        const selectedUserId = userSelect.value;
        const selectedMenu = menuSelect?.value || '';

        if (!selectedUserId) {
            listEl.innerHTML = '<div class="empty-state"><p>👆 上のプルダウンから選手を選択してください</p></div>';
            return;
        }

        // 選択ユーザーの記録をフィルタ（JustRowとその他を除外）
        let records = state.ergoRecords.filter(r => {
            if (r.userId !== selectedUserId) return false;
            if (r.menuKey === 'JustRow' || r.menuKey === 'その他') return false;
            return true;
        });

        // メニューフィルタ
        if (selectedMenu) {
            records = records.filter(r => r.menuKey === selectedMenu);
        }

        // 日付で降順ソート
        records.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

        if (records.length === 0) {
            const userName = state.users.find(u => u.id === selectedUserId)?.name || '選手';
            listEl.innerHTML = `<div class="empty-state"><p>${userName}のエルゴデータがありません</p></div>`;
            return;
        }

        // 既存のrenderRecordCardを使って詳細付きカードを描画（クリックで詳細モーダルも開く）
        listEl.innerHTML = records.slice(0, 50).map(r => renderRecordCard(r, true)).join('');
    }

    /**
     * エルゴタイムのフォーマット補助
     */
    function formatErgoTime(seconds) {
        if (!seconds || isNaN(seconds)) return '--:--';
        const totalSec = parseFloat(seconds);
        const min = Math.floor(totalSec / 60);
        const sec = (totalSec % 60).toFixed(1);
        return `${min}:${sec.padStart(4, '0')}`;
    }

    // コーチ用エルゴビュー初期化
    function initCoachErgoView() {
        const selector = document.getElementById('coach-player-selector');
        const select = document.getElementById('coach-player-select');
        if (!selector || !select) return;

        const role = state.currentUser?.role;
        const isCoachOrAdmin = role === ROLES.ADMIN || role === ROLES.COACH;

        if (!isCoachOrAdmin) {
            selector.classList.add('hidden');
            return;
        }

        // 選手リスト作成
        selector.classList.remove('hidden');
        const currentVal = select.value;
        select.innerHTML = '<option value="">自分のデータ</option>';
        state.users
            .filter(u => u.id !== state.currentUser.id)
            .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
            .forEach(u => {
                const opt = document.createElement('option');
                opt.value = u.id;
                opt.textContent = u.name || u.id;
                select.appendChild(opt);
            });
        // 前回の選択を復元
        if (currentVal) select.value = currentVal;

        // 変更イベント
        select.onchange = () => {
            renderErgoRecords();
        };
    }

    function renderErgoRecords() {
        const list = document.getElementById('ergo-records-list');
        if (!list) return;

        updateBreadcrumb();

        // レベルに応じて表示を切り替え
        if (ergoNavState.level === 'all') {
            renderAllRecords();
        } else if (ergoNavState.level === 'category') {
            renderMenuSelection();
        } else if (ergoNavState.level === 'menu') {
            renderMenuRecords();
        }
    }

    // パン屑ナビゲーションを更新
    function updateBreadcrumb() {
        const breadcrumb = document.getElementById('ergo-breadcrumb');
        if (!breadcrumb) return;

        let html = '<span class="breadcrumb-item" data-level="all" onclick="navigateErgo(\'all\')">すべて</span>';

        if (ergoNavState.level !== 'all' && ergoNavState.category) {
            const categoryNames = { distance: '距離', time: '時間', interval: 'インターバル' };
            const isActive = ergoNavState.level === 'category';
            html += `<span class="breadcrumb-item ${isActive ? 'active' : ''}" data-level="category" onclick="navigateErgo('category')">${categoryNames[ergoNavState.category]}</span>`;
        }

        if (ergoNavState.level === 'menu' && ergoNavState.menuKey) {
            html += `<span class="breadcrumb-item active" data-level="menu">${ergoNavState.menuKey}</span>`;
        }

        breadcrumb.innerHTML = html;
    }

    // ナビゲーション
    function navigateErgo(level, options = {}) {
        if (level === 'all') {
            ergoNavState = { level: 'all', category: null, menuKey: null, period: ergoNavState.period };
            document.getElementById('category-tabs-container').classList.remove('hidden');
            document.getElementById('menu-selection').classList.add('hidden');
            // カテゴリタブをリセット
            document.querySelectorAll('.category-tab').forEach(t => t.classList.remove('active'));
            document.querySelector('.category-tab[data-category="all"]')?.classList.add('active');
        } else if (level === 'category') {
            ergoNavState.level = 'category';
            ergoNavState.menuKey = null;
            if (options.category) ergoNavState.category = options.category;
            document.getElementById('category-tabs-container').classList.add('hidden');
            document.getElementById('menu-selection').classList.remove('hidden');
        } else if (level === 'menu') {
            ergoNavState.level = 'menu';
            if (options.menuKey) ergoNavState.menuKey = options.menuKey;
            document.getElementById('menu-selection').classList.add('hidden');
        }

        renderErgoRecords();
    }

    // すべての記録を新しい順に表示
    function renderAllRecords() {
        const list = document.getElementById('ergo-records-list');

        let records = state.ergoRecords.filter(r => {
            if (r.userId !== getErgoViewUserId()) return false;
            if (r.menuKey === 'JustRow' || r.menuKey === 'その他') return false;
            return applyPeriodFilter(r);
        }).sort((a, b) => new Date(b.date) - new Date(a.date));

        if (records.length === 0) {
            list.innerHTML = '<div class="empty-state"><div class="icon">📊</div><p>記録がありません</p></div>';
            return;
        }

        list.innerHTML = records.slice(0, 30).map(r => renderRecordCard(r, true)).join('');
    }

    // メニュー選択グリッド
    function renderMenuSelection() {
        const grid = document.getElementById('menu-grid');
        const list = document.getElementById('ergo-records-list');
        if (!grid) return;

        // 選択されたカテゴリのメニューを集計
        const records = state.ergoRecords.filter(r => {
            if (r.userId !== getErgoViewUserId()) return false;
            if (r.menuKey === 'JustRow' || r.menuKey === 'その他') return false;
            if (r.category !== ergoNavState.category) return false;
            return true;
        });

        // メニューごとに集計（サブタイプ情報も保持）
        const menuData = {};
        records.forEach(r => {
            const key = r.menuKey || 'その他';
            if (!menuData[key]) {
                menuData[key] = {
                    count: 0,
                    subtype: ergoNavState.category === 'interval' ? getIntervalSubtypeFromMenuKey(key, r) : null
                };
            }
            menuData[key].count++;
        });

        if (Object.keys(menuData).length === 0) {
            grid.innerHTML = '<div class="empty-state"><p>このカテゴリの記録がありません</p></div>';
            list.innerHTML = '';
            return;
        }

        // メニューカードを生成
        grid.innerHTML = Object.entries(menuData)
            .sort((a, b) => b[1].count - a[1].count)
            .map(([menuKey, data]) => {
                const subtypeLabel = data.subtype ? `<span class="menu-subtype ${data.subtype.class}">${data.subtype.label}</span>` : '';
                return `
            <div class="menu-card ${ergoNavState.category}" onclick="navigateErgo('menu', {menuKey: '${menuKey}'})">
                <div class="menu-name">${menuKey}</div>
                ${subtypeLabel}
                <div class="menu-count">${data.count}件の記録</div>
            </div>
        `;
            }).join('');

        list.innerHTML = '';
    }

    // メニューキーからインターバルサブタイプを判定
    function getIntervalSubtypeFromMenuKey(menuKey, sampleRecord) {
        // まずメニューキーのパターンで判定
        if (/\d+m×\d+/.test(menuKey)) {
            return { label: '距離', class: 'distance-based' };
        }
        if (/\d+(分|min)×\d+/.test(menuKey) || /\d+sec×\d+/.test(menuKey)) {
            return { label: '時間', class: 'time-based' };
        }

        // サンプルレコードのworkoutTypeから判定
        if (sampleRecord) {
            const raw = state.ergoRaw.find(r => r.id === sampleRecord.rawId);
            if (raw) {
                if (raw.workoutType === 'FixedDistanceInterval') {
                    return { label: '距離', class: 'distance-based' };
                }
                if (raw.workoutType === 'FixedTimeInterval') {
                    return { label: '時間', class: 'time-based' };
                }
                if (raw.workoutType === 'VariableInterval') {
                    return { label: '可変', class: 'variable' };
                }
            }
        }

        return null;
    }

    // 特定メニューの記録一覧
    function renderMenuRecords() {
        const list = document.getElementById('ergo-records-list');

        let records = state.ergoRecords.filter(r => {
            if (r.userId !== getErgoViewUserId()) return false;
            if (r.menuKey !== ergoNavState.menuKey) return false;
            return applyPeriodFilter(r);
        }).sort((a, b) => new Date(b.date) - new Date(a.date));

        if (records.length === 0) {
            list.innerHTML = '<div class="empty-state"><p>記録がありません</p></div>';
            return;
        }

        list.innerHTML = records.map(r => renderRecordCard(r, true)).join('');
    }

    // 期間フィルタを適用
    function applyPeriodFilter(record) {
        if (ergoNavState.period === 'all') return true;

        const recordDate = new Date(record.date);
        const now = new Date();

        if (ergoNavState.period === 'week') {
            const weekAgo = new Date(now);
            weekAgo.setDate(now.getDate() - 7);
            return recordDate >= weekAgo;
        } else if (ergoNavState.period === 'month') {
            const monthAgo = new Date(now);
            monthAgo.setMonth(now.getMonth() - 1);
            return recordDate >= monthAgo;
        }
        return true;
    }

    // 記録カードのレンダリング
    function renderRecordCard(r, clickable = false) {
        const display = formatDisplayDate(r.date);
        const categoryClass = r.category || 'other';
        const clickableClass = clickable ? 'clickable' : '';
        const onclick = clickable ? `onclick="openErgoDetail('${r.id}')"` : '';

        // インターバルのサブタイプを取得（距離ベース/タイムベース）
        const intervalSubtype = getIntervalSubtype(r);

        return `<div class="ergo-record-item ${categoryClass} ${clickableClass}" ${onclick}>
        <div class="header">
            <div class="menu-info">
                <span class="menu-key">${r.menuKey || r.distance + 'm'}</span>
                ${intervalSubtype ? `<span class="interval-type ${intervalSubtype.class}">${intervalSubtype.label}</span>` : ''}
            </div>
            <div class="date-info">
                <span class="date-year">${display.year}</span>
                <span class="date-main">${display.month}/${display.day}</span>
                <span class="date-weekday">（${display.weekday}）</span>
            </div>
        </div>
        <div class="stats">
            ${r.distance ? `<div class="stat"><span class="stat-label">距離</span><span class="stat-value">${r.distance}m</span></div>` : ''}
            ${r.timeDisplay ? `<div class="stat"><span class="stat-label">時間</span><span class="stat-value">${r.timeDisplay}</span></div>` : ''}
            <div class="stat"><span class="stat-label">Split</span><span class="stat-value">${getSplit(r)}</span></div>
            ${r.strokeRate ? `<div class="stat"><span class="stat-label">Rate</span><span class="stat-value">${r.strokeRate}</span></div>` : ''}
            ${r.weight ? `<div class="stat"><span class="stat-label">Weight</span><span class="stat-value">${r.weight}kg</span></div>` : ''}
        </div>
        <div class="source">${r.source || ''}</div>
    </div>`;
    }

    // インターバルのサブタイプを判定（距離ベース/タイムベース）
    function getIntervalSubtype(record) {
        if (record.category !== 'interval') return null;

        const menuKey = record.menuKey || '';

        // 距離ベース: 「500m×8」などのパターン
        if (/\d+m×\d+/.test(menuKey)) {
            return { label: '距離', class: 'distance-based' };
        }

        // タイムベース: 「1分×10」「1min×10」などのパターン
        if (/\d+(分|min)×\d+/.test(menuKey) || /\d+sec×\d+/.test(menuKey)) {
            return { label: '時間', class: 'time-based' };
        }

        // rawDataからworkoutTypeを確認
        const raw = state.ergoRaw.find(r => r.id === record.rawId);
        if (raw) {
            if (raw.workoutType === 'FixedDistanceInterval') {
                return { label: '距離', class: 'distance-based' };
            }
            if (raw.workoutType === 'FixedTimeInterval') {
                return { label: '時間', class: 'time-based' };
            }
            if (raw.workoutType === 'VariableInterval') {
                return { label: '可変', class: 'variable' };
            }
        }

        return null;
    }

    // エルゴ詳細モーダルを開く
    function openErgoDetail(recordId) {
        let record = state.ergoRecords.find(r => r.id === recordId);
        // ergoSessionsにもフォールバック
        if (!record) record = state.ergoSessions.find(s => s.id === recordId);
        if (!record) return;

        // rawIdから直接rawデータを取得（フォールバック付き）
        let raw = state.ergoRaw.find(r => r.id === record.rawId);
        // rawIdで見つからない場合、concept2Idで検索
        if (!raw && record.concept2Id) {
            raw = state.ergoRaw.find(r => r.concept2Id === record.concept2Id);
        }

        const modal = document.getElementById('ergo-detail-modal');
        const display = formatDisplayDate(record.date);

        // 基本情報を設定
        document.getElementById('ergo-detail-title').textContent = record.menuKey || '記録詳細';
        document.getElementById('ergo-detail-date').textContent = `${display.year}/${display.month}/${display.day}`;
        document.getElementById('ergo-detail-distance').textContent = record.distance ? `${record.distance}m` : '-';
        document.getElementById('ergo-detail-time').textContent = record.timeDisplay || '-';
        document.getElementById('ergo-detail-split').textContent = record.split || '-';
        document.getElementById('ergo-detail-rate').textContent = record.strokeRate || '-';

        // ワット / カロリー / ドラッグファクタ表示
        const rawData = record.rawData || raw || {};
        const workout = rawData.workout || rawData;
        const avgWatts = record.watts || workout.avg_watts || workout.watts || null;
        const calories = record.calories || workout.calories || workout.cal_hr || null;
        const dragFactor = record.dragFactor || workout.drag_factor || workout.dragFactor || null;

        const wattsRow = document.getElementById('ergo-detail-watts-row');
        const calRow = document.getElementById('ergo-detail-cal-row');
        const dfRow = document.getElementById('ergo-detail-df-row');

        if (wattsRow) {
            if (avgWatts) {
                document.getElementById('ergo-detail-watts').textContent = `${avgWatts} W`;
                wattsRow.style.display = '';
            } else { wattsRow.style.display = 'none'; }
        }
        if (calRow) {
            if (calories) {
                document.getElementById('ergo-detail-cal').textContent = `${calories} kcal`;
                calRow.style.display = '';
            } else { calRow.style.display = 'none'; }
        }
        if (dfRow) {
            if (dragFactor) {
                document.getElementById('ergo-detail-df').textContent = dragFactor;
                dfRow.style.display = '';
            } else { dfRow.style.display = 'none'; }
        }

        // IDT表示（2000m TTの場合）
        const idtDiv = document.getElementById('ergo-detail-idt');
        if (idtDiv) {
            if (record.menuKey === '2000m TT') {
                const weight = record.weight || getWeightForDate(record.userId, record.date);
                const user = state.users.find(u => u.id === record.userId);
                const gender = user?.gender || 'man';
                const actualTime = record.time || parseTimeStr(record.timeDisplay);

                if (weight && actualTime) {
                    const idtSeconds = calculateIDTSeconds(weight, gender);
                    const idtValue = calculateIDTPercent(actualTime, idtSeconds);

                    let idtClass = 'idt-low';
                    if (idtValue >= 100) idtClass = 'idt-high';
                    else if (idtValue >= 95) idtClass = 'idt-mid';

                    idtDiv.innerHTML = `
                    <div class="idt-detail-label">⚖️ IDT（体重 ${weight}kg）</div>
                    <div style="display:flex;align-items:baseline;gap:12px;">
                        <span class="idt-detail-value ${idtClass}">${idtValue.toFixed(1)}</span>
                    </div>
                `;
                    idtDiv.classList.remove('hidden');
                } else {
                    idtDiv.innerHTML = '';
                    idtDiv.classList.add('hidden');
                }
            } else {
                idtDiv.innerHTML = '';
                idtDiv.classList.add('hidden');
            }
        }

        // スプリット/インターバルを表示
        // rawデータがない場合、record内のデータからフォールバック構築
        let effectiveRaw = raw;
        if (!effectiveRaw) {
            const fallbackSplits = record.splits || record.rawData?.workout?.splits || [];
            const fallbackIntervals = record.intervals || record.rawData?.workout?.intervals || [];
            if (fallbackSplits.length > 0 || fallbackIntervals.length > 0) {
                effectiveRaw = { splits: fallbackSplits, intervals: fallbackIntervals };
            }
        }
        renderSplits(record, effectiveRaw);

        modal.classList.remove('hidden');
    }

    // 500mスプリットまたはインターバル表示
    function renderSplits(record, raw) {
        const container = document.getElementById('ergo-splits-list');
        const section = container.closest('.splits-section');
        const title = section?.querySelector('h4');

        // テーブルヘッダー生成
        const renderHeader = () => `
        <div class="c2-table-row header">
            <span class="c2-col">時間</span>
            <span class="c2-col">距離</span>
            <span class="c2-col">ペース</span>
            <span class="c2-col">ワット</span>
            <span class="c2-col">Cal</span>
            <span class="c2-col">SR</span>
        </div>`;

        // 行生成
        const renderRow = (time, dist, pace, watts, cal, sr, className = '') => `
        <div class="c2-table-row ${className}">
            <span class="c2-col">${formatTime(time)}</span>
            <span class="c2-col">${dist}m</span>
            <span class="c2-col">${formatTime(pace)}</span>
            <span class="c2-col">${watts || '-'}</span>
            <span class="c2-col">${cal || '-'}</span>
            <span class="c2-col">${sr}</span>
        </div>`;

        let html = '<div class="c2-table">' + renderHeader();

        // インターバルデータがあればそれを表示
        if (raw?.intervals && raw.intervals.length > 0) {
            if (title) title.textContent = 'インターバル詳細';

            // 全体平均行 (Summary) - raw.intervals自体にはSummaryがない場合が多いが、
            // record自体に全体のSummaryがあるはず。ここでは各インターバルを表示。

            html += raw.intervals.map((interval, idx) => {
                const time = interval.time ? interval.time / 10 : 0;
                const dist = interval.distance || 0;
                const sr = interval.stroke_rate || interval.spm || '-';
                const watts = interval.watts || interval.avg_watts || '-';
                const cal = interval.cal_hr || interval.calories || '-';
                // ペース計算 (time / (dist/500))
                let pace = 0;
                if (dist > 0) pace = time / (dist / 500);

                return renderRow(time, dist, pace, watts, cal, sr);
            }).join('');

        } else if (raw?.splits && raw.splits.length > 0) {
            // スプリット表示
            if (title) title.textContent = '500mスプリット';

            html += raw.splits.map((split, idx) => {
                const time = (split.time || split.split || 0) / 10;
                const dist = split.distance || 500; // 通常スプリット記録は500m区切りだが、最後は端数かも
                const sr = split.stroke_rate || split.spm || '-';
                const watts = split.watts || split.avg_watts || '-';
                const cal = split.cal_hr || split.calories || '-';
                // ペースはその区間のタイムそのもの(500mなら)
                let pace = time / (dist / 500);
                if (dist === 0) pace = 0;

                return renderRow(time, dist, pace, watts, cal, sr);
            }).join('');
        } else {
            html += '<div class="c2-table-row"><span class="c2-col" style="flex:1; text-align:center;">データなし</span></div>';
        }

        html += '</div>';
        container.innerHTML = html;
    }

    // 詳細モーダルを閉じる
    function closeErgoDetailModal() {
        document.getElementById('ergo-detail-modal').classList.add('hidden');
    }

    // 週間ランキング
    let weeklyRankingSortMode = 'time'; // 'time' or 'idt'

    function renderWeeklyRanking() {
        const container = document.getElementById('weekly-ranking');
        if (!container) return;

        const menuSelect = document.getElementById('ranking-menu');
        const selectedMenu = menuSelect?.value || '2000m TT';
        const genderBtn = document.querySelector('#weekly-ranking-section .gender-btn.active');
        const selectedGender = genderBtn?.dataset.gender || (state.currentUser?.gender || 'man');
        const includeInactive = document.getElementById('ranking-include-inactive')?.checked || false;

        // UIのトグル状態を初期化時に合わせる
        if (!genderBtn && state.currentUser) {
            const btn = document.querySelector(`#weekly-ranking-section .gender-btn[data-gender="${selectedGender}"]`);
            if (btn) {
                document.querySelectorAll('#weekly-ranking-section .gender-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            }
        }

        // 今週の開始日を計算（月曜日）
        const now = new Date();
        const dayOfWeek = now.getDay();
        const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
        const monday = new Date(now);
        monday.setDate(now.getDate() + mondayOffset);
        monday.setHours(0, 0, 0, 0);

        const isTimeMenu = selectedMenu.includes('分');
        const is2000m = selectedMenu === '2000m TT';

        // ergoRecords + ergoSessions を統合・重複排除してユーザーごとのベストを取得
        const userBestMap = {}; // userId -> bestRecord
        const seenRawIds = new Set();

        // ergoSessionsから今週のデータ収集
        state.ergoSessions.forEach(session => {
            const user = state.users.find(u => u.id === session.userId);
            if (!user || user.gender !== selectedGender) return;
            if (!includeInactive && user.status === '非在籍') return;
            const sessionDate = new Date(session.date);
            if (sessionDate < monday || session.menuKey !== selectedMenu) return;
            if (session.rawId) seenRawIds.add(session.rawId);
            // 体重フォールバック
            if (!session.weight) session.weight = getWeightForDate(session.userId, session.date);

            const existing = userBestMap[session.userId];
            if (!existing || _isBetterRecord(session, existing, isTimeMenu)) {
                userBestMap[session.userId] = session;
            }
        });

        // ergoRecordsから今週のデータ収集（重複排除）
        state.ergoRecords.forEach(record => {
            const user = state.users.find(u => u.id === record.userId);
            if (!user || user.gender !== selectedGender) return;
            if (!includeInactive && user.status === '非在籍') return;
            const recordDate = new Date(record.date);
            if (recordDate < monday || record.menuKey !== selectedMenu) return;
            if (record.rawId && seenRawIds.has(record.rawId)) return; // 重複スキップ
            if (!record.weight) record.weight = getWeightForDate(record.userId, record.date);
            // timeDisplayしかない場合はtime(秒)をパース
            if (!record.time && record.timeDisplay) record.time = parseTimeStr(record.timeDisplay);

            const existing = userBestMap[record.userId];
            if (!existing || _isBetterRecord(record, existing, isTimeMenu)) {
                userBestMap[record.userId] = record;
            }
        });

        const weeklyBests = Object.values(userBestMap);

        // ソート
        if (is2000m && weeklyRankingSortMode === 'idt') {
            // IDT順：IDT%が高い順（体重なしは末尾）
            weeklyBests.sort((a, b) => {
                const userA = state.users.find(u => u.id === a.userId);
                const userB = state.users.find(u => u.id === b.userId);
                const idtA = _getIDTPercent(a, userA);
                const idtB = _getIDTPercent(b, userB);
                if (idtA === null && idtB === null) return (a.time || Infinity) - (b.time || Infinity);
                if (idtA === null) return 1;
                if (idtB === null) return -1;
                return idtB - idtA;
            });
        } else {
            weeklyBests.sort((a, b) => {
                if (isTimeMenu) return (b.distance || 0) - (a.distance || 0);
                return (a.time || Infinity) - (b.time || Infinity);
            });
        }

        if (weeklyBests.length === 0) {
            let toggleHtml = '';
            if (is2000m) toggleHtml = _renderSortToggle('weekly');
            container.innerHTML = toggleHtml + '<div class="empty-state"><p>今週のデータがありません</p></div>';
            return;
        }

        const rankMedals = ['🥇', '🥈', '🥉'];

        // 自分のベスト
        const myBest = userBestMap[state.currentUser?.id] || null;

        let html = '';

        // 2000m用ソートトグル
        if (is2000m) {
            html += _renderSortToggle('weekly');
        }

        // 自己ベスト表示エリア
        if (state.currentUser && state.currentUser.gender === selectedGender) {
            if (myBest) {
                const display = formatDisplayDate(myBest.date);
                const idtHtml = is2000m ? renderIDTBadge(myBest.weight, selectedGender, myBest.time) : '';
                html += `<div class="my-best-section">
    <div class="ranking-item my-best">
        <div class="rank">YOU</div>
        <div class="user-info">
            <div class="name">今週の自己ベスト</div>
            <div class="date">${display.month}/${display.day}</div>
        </div>
        <div>
            <div class="time">${formatTime(myBest.time)}</div>
            <div class="split">Split ${getSplit(myBest)}</div>
            ${idtHtml}
        </div>
    </div>
            </div>`;
            } else {
                html += `<div class="my-best-section">
    <div class="ranking-item my-best empty">
        <div class="rank">YOU</div>
        <div class="user-info"><div class="name">今週の記録なし</div></div>
    </div>
            </div>`;
            }
        }

        html += weeklyBests.slice(0, 20).map((record, idx) => {
            const user = state.users.find(u => u.id === record.userId);
            const display = formatDisplayDate(record.date);
            const rankSymbol = idx < 3 ? rankMedals[idx] : `${idx + 1}`;
            const isMe = user && user.id === state.currentUser?.id;
            const idtHtml = is2000m ? renderIDTBadge(record.weight, selectedGender, record.time) : '';

            return `<div class="ranking-item ${isMe ? 'highlight' : ''}">
            <div class="rank">${rankSymbol}</div>
            <div class="user-info">
                <div class="name">${user?.name || '不明'}</div>
                <div class="date">${display.month}/${display.day}</div>
            </div>
            <div>
                <div class="time">${formatTime(record.time)}</div>
                <div class="split">Split ${getSplit(record)}</div>
                ${idtHtml}
            </div>
        </div>`;
        }).join('');

        container.innerHTML = html;
    }

    // 内部ヘルパー：記録比較
    function _isBetterRecord(newRec, existingRec, isTimeMenu) {
        if (isTimeMenu) {
            return (newRec.distance || 0) > (existingRec.distance || 0);
        }
        const newTime = newRec.time || parseTimeStr(newRec.timeDisplay) || Infinity;
        const existTime = existingRec.time || parseTimeStr(existingRec.timeDisplay) || Infinity;
        return newTime < existTime;
    }

    // 内部ヘルパー：IDT%取得
    function _getIDTPercent(record, user) {
        if (!record.weight || !record.time) return null;
        const gender = user?.gender || 'man';
        const idt = calculateIDTSeconds(record.weight, gender);
        if (!idt) return null;
        return calculateIDTPercent(record.time, idt);
    }

    // ソートトグルHTML
    function _renderSortToggle(rankingType) {
        const mode = rankingType === 'weekly' ? weeklyRankingSortMode : allTimeRankingSortMode;
        return `<div style="display:flex;align-items:center;margin-bottom:8px;">
        <span style="font-size:12px;color:#888;">並び替え:</span>
        <div class="sort-toggle">
            <button class="sort-toggle-btn ${mode === 'time' ? 'active' : ''}" onclick="set${rankingType === 'weekly' ? 'Weekly' : 'AllTime'}RankingSort('time')">⏱ タイム順</button>
            <button class="sort-toggle-btn ${mode === 'idt' ? 'active' : ''}" onclick="set${rankingType === 'weekly' ? 'Weekly' : 'AllTime'}RankingSort('idt')">📊 IDT順</button>
        </div>
    </div>`;
    }

    function setWeeklyRankingSort(mode) {
        weeklyRankingSortMode = mode;
        renderWeeklyRanking();
    }

    function setAllTimeRankingSort(mode) {
        allTimeRankingSortMode = mode;
        renderAllTimeRanking();
    }

    // チーム練習記録
    function renderTeamRecords() {
        const container = document.getElementById('team-records-list');
        if (!container) return;

        // 直近7日間の全員の記録を取得
        const now = new Date();
        const weekAgo = new Date(now);
        weekAgo.setDate(now.getDate() - 7);

        const recentRecords = state.ergoSessions
            .filter(s => {
                const sessionDate = new Date(s.date);
                return sessionDate >= weekAgo && s.menuKey !== 'JustRow' && s.menuKey !== 'その他';
            })
            .sort((a, b) => new Date(b.date) - new Date(a.date))
            .slice(0, 20);

        if (recentRecords.length === 0) {
            container.innerHTML = '<div class="empty-state"><p>最近の記録がありません</p></div>';
            return;
        }

        container.innerHTML = recentRecords.map(record => {
            const user = state.users.find(u => u.id === record.userId);
            const display = formatDisplayDate(record.date);
            const initials = user?.name?.slice(0, 2) || '??';

            return `< div class="team-record-item" >
            <div class="avatar">${initials}</div>
            <div class="user-info">
                <div class="name">${user?.name || '不明'}</div>
                <div class="menu">${record.menuKey}</div>
            </div>
            <div class="result">
                <div class="time-display">${formatTime(record.time)}</div>
                <div class="split-display">Split ${getSplit(record)}</div>
                <div class="date-display">${display.month}/${display.day}</div>
            </div>
        </div > `;
        }).join('');
    }

    // データビュー切り替え
    function initDataViewToggle() {
        document.querySelectorAll('.view-toggle-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const view = btn.dataset.view;

                // ボタンのアクティブ状態を切り替え
                document.querySelectorAll('.view-toggle-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                // ビューを切り替え
                document.getElementById('personal-data-view').classList.toggle('hidden', view !== 'personal');
                document.getElementById('team-data-view').classList.toggle('hidden', view !== 'team');
                document.getElementById('all-time-data-view').classList.toggle('hidden', view !== 'all-time');
                const allMembersView = document.getElementById('all-members-data-view');
                if (allMembersView) allMembersView.classList.toggle('hidden', view !== 'all-members');

                if (view === 'team') {
                    renderWeeklyRanking();
                    renderTeamRecords();
                } else if (view === 'all-time') {
                    renderAllTimeRanking();
                } else if (view === 'all-members') {
                    initAllMembersErgoView();
                } else {
                    // マイデータに戻る時はナビをリセット
                    navigateErgo('all');
                }
            });
        });

        // カテゴリタブ
        document.querySelectorAll('.category-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.category-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');

                const category = tab.dataset.category;

                if (category === 'all') {
                    // すべて：全記録を新しい順に表示
                    navigateErgo('all');
                } else {
                    // カテゴリ選択：メニュー選択グリッドを表示
                    navigateErgo('category', { category: category });
                }
            });
        });

        // 期間フィルタ
        const periodSelect = document.getElementById('data-period');
        if (periodSelect) {
            periodSelect.addEventListener('change', () => {
                ergoNavState.period = periodSelect.value;
                renderErgoRecords();
            });
        }

        // ランキングメニュー選択
        const rankingMenu = document.getElementById('ranking-menu');
        if (rankingMenu) {
            rankingMenu.addEventListener('change', () => {
                renderWeeklyRanking();
            });
        }

        // 歴代ランキングメニュー選択
        const allTimeRankingMenu = document.getElementById('all-time-ranking-menu');
        if (allTimeRankingMenu) {
            allTimeRankingMenu.addEventListener('change', () => {
                renderAllTimeRanking();
            });
        }
    }

    // 歴代ランキング (Personal Best)
    let allTimeRankingSortMode = 'time'; // 'time' or 'idt'

    function renderAllTimeRanking() {
        const container = document.getElementById('all-time-ranking-list');
        if (!container) return;

        const menuSelect = document.getElementById('all-time-ranking-menu');
        const selectedMenu = menuSelect?.value || '2000m TT';
        const isTimeMenu = selectedMenu.includes('分');
        const is2000m = selectedMenu === '2000m TT';

        // 性別トグルをDOMから取得
        const genderBtn = document.querySelector('#all-time-data-view .gender-btn.active');
        const selectedGender = genderBtn?.dataset.gender || (state.currentUser?.gender || 'man');

        // 初回にアクティブ設定
        if (!genderBtn && state.currentUser) {
            const btn = document.querySelector(`#all-time-data-view .gender-btn[data-gender="${selectedGender}"]`);
            if (btn) {
                document.querySelectorAll('#all-time-data-view .gender-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            }
        }

        // ユーザーごとにベストを収集
        const allTimeBests = [];
        const includeInactive = document.getElementById('alltime-ranking-include-inactive')?.checked || false;
        state.users.forEach(user => {
            if (user.gender !== selectedGender) return; // 性別フィルタ
            if (!includeInactive && user.status === '非在籍') return; // 非在籍フィルタ

            const seenRawIds = new Set();
            const allRecords = [];

            // ergoSessions優先
            state.ergoSessions.filter(s => s.userId === user.id && s.menuKey === selectedMenu).forEach(r => {
                if (r.rawId) seenRawIds.add(r.rawId);
                if (!r.weight) r.weight = getWeightForDate(r.userId, r.date);
                allRecords.push(r);
            });

            // ergoRecords（重複排除）
            state.ergoRecords.filter(r => r.userId === user.id && r.menuKey === selectedMenu).forEach(r => {
                if (r.rawId && seenRawIds.has(r.rawId)) return;
                if (!r.weight) r.weight = getWeightForDate(r.userId, r.date);
                if (!r.time && r.timeDisplay) r.time = parseTimeStr(r.timeDisplay);
                allRecords.push(r);
            });

            if (allRecords.length === 0) return;

            // ベスト記録を特定
            let bestRecord = allRecords[0];
            for (let i = 1; i < allRecords.length; i++) {
                if (_isBetterRecord(allRecords[i], bestRecord, isTimeMenu)) {
                    bestRecord = allRecords[i];
                }
            }
            allTimeBests.push(bestRecord);
        });

        // ソート
        if (is2000m && allTimeRankingSortMode === 'idt') {
            allTimeBests.sort((a, b) => {
                const userA = state.users.find(u => u.id === a.userId);
                const userB = state.users.find(u => u.id === b.userId);
                const idtA = _getIDTPercent(a, userA);
                const idtB = _getIDTPercent(b, userB);
                if (idtA === null && idtB === null) return (a.time || Infinity) - (b.time || Infinity);
                if (idtA === null) return 1;
                if (idtB === null) return -1;
                return idtB - idtA;
            });
        } else {
            allTimeBests.sort((a, b) => {
                if (isTimeMenu) return (b.distance || 0) - (a.distance || 0);
                const timeA = a.time || parseTimeStr(a.timeDisplay) || Infinity;
                const timeB = b.time || parseTimeStr(b.timeDisplay) || Infinity;
                return timeA - timeB;
            });
        }

        if (allTimeBests.length === 0) {
            let toggleHtml = is2000m ? _renderSortToggle('allTime') : '';
            container.innerHTML = toggleHtml + '<div class="empty-state"><p>データがありません</p></div>';
            return;
        }

        const rankMedals = ['🥇', '🥈', '🥉'];

        // 自己ベスト
        const myRecord = allTimeBests.find(r => r.userId === state.currentUser?.id);

        let html = '';

        // 2000m用ソートトグル
        if (is2000m) {
            html += _renderSortToggle('allTime');
        }

        // 自己ベスト表示
        if (state.currentUser && state.currentUser.gender === selectedGender) {
            if (myRecord) {
                const display = formatDisplayDate(myRecord.date);
                const idtHtml = is2000m ? renderIDTBadge(myRecord.weight, selectedGender, myRecord.time) : '';
                html += `<div class="my-best-section">
    <div class="ranking-item my-best">
        <div class="rank">YOU</div>
        <div class="user-info">
            <div class="name">自己ベスト (All Time)</div>
            <div class="date">${display.year}/${display.month}/${display.day}</div>
        </div>
        <div>
            <div class="time">${myRecord.timeDisplay || formatTime(myRecord.time)}</div>
            <div class="split">Split ${myRecord.split || getSplit(myRecord)}</div>
            ${idtHtml}
        </div>
    </div>
            </div>`;
            } else {
                html += `<div class="my-best-section">
    <div class="ranking-item my-best empty">
        <div class="rank">YOU</div>
        <div class="user-info"><div class="name">記録なし</div></div>
    </div>
            </div>`;
            }
        }

        html += allTimeBests.map((record, idx) => {
            const user = state.users.find(u => u.id === record.userId);
            const display = formatDisplayDate(record.date);
            const rankSymbol = idx < 3 ? rankMedals[idx] : `${idx + 1}`;
            const isMe = user && user.id === state.currentUser?.id;
            const idtHtml = is2000m ? renderIDTBadge(record.weight, selectedGender, record.time) : '';

            // 体重表示（女子プライバシー対応）
            let weightInfo = '';
            if (record.weight) {
                if (user?.gender === 'woman') {
                    if (state.currentUser?.id === user.id || state.currentUser?.role === ROLES.ADMIN) {
                        weightInfo = `<span class="weight-info"> (${record.weight}kg)</span>`;
                    } else {
                        weightInfo = `<span class="weight-info private"> (記録済)</span>`;
                    }
                } else {
                    weightInfo = `<span class="weight-info"> (${record.weight}kg)</span>`;
                }
            }

            return `<div class="ranking-item ${isMe ? 'highlight' : ''}">
            <div class="rank">${rankSymbol}</div>
            <div class="user-info">
                <div class="name">${user?.name || '不明'} ${weightInfo}</div>
                <div class="date">${display.year}/${display.month}/${display.day}</div>
            </div>
            <div>
                <div class="time">${record.timeDisplay || formatTime(record.time)}</div>
                <div class="split">Split ${record.split || getSplit(record)}</div>
                ${idtHtml}
            </div>
        </div>`;
        }).join('');

        container.innerHTML = html;
    }

    function parseTimeStr(timeStr) {
        if (!timeStr) return Infinity;
        const parts = timeStr.split(':');
        if (parts.length === 2) {
            return parseInt(parts[0]) * 60 + parseFloat(parts[1]);
        }
        return parseFloat(timeStr);
    }


    // =========================================
    // マスタ管理
    // =========================================
    let currentMasterType = null;
    let currentMasterItem = null;

    // コンバーチブル艇の定義（リギングで使い分ける艇種ペア）
    const CONVERTIBLE_PAIRS = {
        '2x': '2-',   // ダブル ⇔ ペア
        '2-': '2x',
        '4x': '4-',   // クォード ⇔ なしフォア
        '4-': '4x'
    };

    const CONVERTIBLE_LABELS = {
        '2x': 'ダブル',
        '2-': 'ペア',
        '4x': 'クォード',
        '4-': 'なしフォア'
    };

    // オール長さ基準値テーブル
    const OAR_SPEC_TABLE = [
        { type: 'ペア (2-)', length: 372, inboard: 116, span: 86, category: 'sweep' },
        { type: '付きフォア (4+)', length: 375, inboard: 115, span: 85, category: 'sweep' },
        { type: 'エイト (8+) / なしフォア (4-)', length: 375, inboard: 114, span: 84, category: 'sweep' },
        { type: 'スカルオール', length: 287, inboard: 88, span: 159, category: 'scull' },
        { type: 'スカルオール (Fat)', length: 282, inboard: 88, span: 159, category: 'scull' }
    ];

    function isConvertibleBoat(type) {
        return type in CONVERTIBLE_PAIRS;
    }

    function getBoatRiggingMode(boat) {
        if (!isConvertibleBoat(boat.type)) return null;
        return boat.currentRiggingMode || boat.type;
    }

    function getLastUsedBoatForOar(oarId) {
        // スケジュールから最後にこのオールを使った練習を探す
        const schedules = state.schedules || [];
        let lastSchedule = null;
        for (let i = schedules.length - 1; i >= 0; i--) {
            const s = schedules[i];
            // oarIds配列またはoarId単体で検索
            const matchesOarIds = s.oarIds && Array.isArray(s.oarIds) && s.oarIds.includes(oarId);
            const matchesOarId = s.oarId === oarId || s.oar === oarId;
            if (matchesOarIds || matchesOarId) {
                lastSchedule = s;
                break;
            }
        }
        if (!lastSchedule) return null;

        const boatId = lastSchedule.boatId || lastSchedule.boat;
        if (!boatId) return null;

        const boat = (state.boats || []).find(b => b.id === boatId);
        if (!boat) return null;

        return { name: boat.name, type: boat.type, date: lastSchedule.date };
    }

    function openMasterModal(type) {
        currentMasterType = type;
        const modal = document.getElementById('master-modal');
        const title = document.getElementById('master-modal-title');

        const titles = {
            boats: '🚣 艇マスタ',
            oars: '🏋️ オールマスタ',
            ergos: '💪 エルゴマスタ'
        };
        title.textContent = titles[type];

        renderMasterList();
        modal.classList.remove('hidden');
    }

    function closeMasterModal() {
        document.getElementById('master-modal').classList.add('hidden');
        currentMasterType = null;
    }


    function translateStatus(status) {
        if (status === 'available' || status === '使用可能') return '使用可能';
        if (status === 'broken' || status === '使用不可') return '故障';
        if (status === 'repair') return '修理中';
        return status;
    }

    function getStatusClass(status) {
        if (status === 'available' || status === '使用可能') return 'available';
        if (status === 'repair') return 'repair';
        return 'unavailable';
    }

    function toggleBoatRiggingMode(boatId, e) {
        e.stopPropagation();
        const boat = state.boats.find(b => b.id === boatId);
        if (!boat || !isConvertibleBoat(boat.type)) return;

        const currentMode = getBoatRiggingMode(boat);
        const newMode = CONVERTIBLE_PAIRS[currentMode];
        boat.currentRiggingMode = newMode;

        DB.save('boats', state.boats);
        DB.addAuditLog('boats', boat.id, 'リギング切替', { from: currentMode, to: newMode });

        // Supabaseにも同期（変更した艇のみ）
        if (DB.useSupabase && window.SupabaseConfig?.db) {
            window.SupabaseConfig.db.saveMasterItem('boats', boat).catch(err => {
                console.warn('Boat rigging mode sync failed:', err);
            });
        }

        renderMasterList();
        renderEquipmentStatus();
        showToast(`${boat.name}: ${CONVERTIBLE_LABELS[newMode]}モードに切替`, 'success');
    }

    function confirmDeleteMaster(id, e) {
        e.stopPropagation();
        const item = state[currentMasterType].find(d => d.id === id);
        if (!item) return;

        showConfirmModal(`「${item.name}」を削除しますか？`, () => {
            state[currentMasterType] = state[currentMasterType].filter(d => d.id !== id);
            DB.save(currentMasterType, state[currentMasterType]);
            DB.addAuditLog(currentMasterType, id, '削除', {});

            // Supabaseからも削除
            if (DB.useSupabase && window.SupabaseConfig?.db) {
                window.SupabaseConfig.db.deleteMasterItem(currentMasterType, id).catch(err => {
                    console.error('Master item Supabase delete failed:', err);
                });
            }

            renderMasterList();
            populateBoatOarSelects();
            showToast('削除しました', 'success');
        }, null, '削除する');
    }

    function renderMasterList() {
        const list = document.getElementById('master-list');
        const data = state[currentMasterType] || [];

        if (currentMasterType === 'boats') {
            list.innerHTML = data.map(item => {
                const status = item.status || (item.availability === '使用不可' ? 'broken' : 'available');
                const isConvertible = isConvertibleBoat(item.type);
                const riggingMode = getBoatRiggingMode(item);

                let riggingBadgeHtml = '';
                if (isConvertible) {
                    const label = CONVERTIBLE_LABELS[riggingMode] || riggingMode;
                    riggingBadgeHtml = `
                    <div class="rigging-mode-row">
                        <span class="rigging-mode-badge">${label}モード</span>
                        <button class="rigging-toggle-btn" onclick="toggleBoatRiggingMode('${item.id}', event)" title="切替">🔄</button>
                    </div>`;
                }

                // 使用団体バッジ
                const orgColors = { '男子部': '#3b82f6', '女子部': '#ec4899', '医学部': '#10b981', 'OB': '#f59e0b' };
                const orgLabel = item.organization || '';
                const orgBadge = orgLabel ? `<span class="org-badge" style="background:${orgColors[orgLabel] || '#6b7280'};color:#fff;padding:2px 6px;border-radius:4px;font-size:0.7em;margin-left:4px;">${orgLabel}</span>` : '';

                // 艇種別バッジ色
                const boatTypeColors = { '1x': '#6366f1', '2x': '#8b5cf6', '2-': '#a855f7', '4x': '#0ea5e9', '4+': '#0284c7', '4-': '#0369a1', '8+': '#dc2626' };
                const btColor = boatTypeColors[item.type] || '#6b7280';

                return `
            <div class="master-item" data-id="${item.id}">
                <div class="info">
                    <div class="name">${item.name} <span class="badge" style="font-size:0.8em;background:${btColor};color:#fff;padding:2px 6px;border-radius:4px;">${item.type}</span>${orgBadge}</div>
                    ${riggingBadgeHtml}
                    <div class="sub">${item.memo || ''}</div>
                </div>
                <div class="master-item-right">
                    <span class="status ${getStatusClass(status)}">${translateStatus(status)}</span>
                    <div class="master-item-actions">
                        <button class="master-action-btn edit-btn" onclick="event.stopPropagation(); const d = state.boats.find(b=>b.id==='${item.id}'); if(d) openMasterEditModal(d);" title="編集">✏️</button>
                        <button class="master-action-btn delete-btn" onclick="confirmDeleteMaster('${item.id}', event)" title="削除">🗑️</button>
                    </div>
                </div>
            </div>`;
            }).join('') || '<div class="empty-state"><p>登録がありません</p></div>';
        } else if (currentMasterType === 'oars') {
            // オール基準値テーブルを先頭に追加
            let specTableHtml = `
            <div class="oar-spec-section">
                <div class="oar-spec-header" onclick="this.parentElement.classList.toggle('open')">
                    📏 オール長さ基準値 <span class="oar-spec-toggle">▼</span>
                </div>
                <div class="oar-spec-body">
                    <table class="oar-spec-table">
                        <thead>
                            <tr><th>艇種</th><th>全長</th><th>インボード</th><th>スパン</th></tr>
                        </thead>
                        <tbody>
                            <tr class="spec-category-header"><td colspan="4">スイープオール</td></tr>
                            ${OAR_SPEC_TABLE.filter(s => s.category === 'sweep').map(s => `
                            <tr><td>${s.type}</td><td>${s.length}</td><td>${s.inboard}</td><td>${s.span}</td></tr>`).join('')}
                            <tr class="spec-category-header"><td colspan="4">スカルオール</td></tr>
                            ${OAR_SPEC_TABLE.filter(s => s.category === 'scull').map(s => `
                            <tr><td>${s.type}</td><td>${s.length}</td><td>${s.inboard}</td><td>${s.span}</td></tr>`).join('')}
                        </tbody>
                    </table>
                    <p class="oar-spec-note">※ 単位はすべてcm</p>
                </div>
            </div>`;

            const oarListHtml = data.map(item => {
                const status = item.status || (item.availability === '使用不可' ? 'broken' : 'available');
                const lastBoat = getLastUsedBoatForOar(item.id);
                let lastBoatHtml = '';
                if (lastBoat) {
                    lastBoatHtml = `<div class="last-boat-info">🚣 最終: ${lastBoat.name} (${lastBoat.type})</div>`;
                }

                return `
            <div class="master-item" data-id="${item.id}">
                <div class="info">
                    <div class="name">${item.name} <span class="badge" style="font-size:0.8em">${item.type}</span></div>
                    <div class="sub">長さ: ${item.length || '-'}, シール: ${item.sealNumber || '-'}</div>
                    ${lastBoatHtml}
                    <div class="sub">${item.memo || ''}</div>
                </div>
                <div class="master-item-right">
                    <span class="status ${getStatusClass(status)}">${translateStatus(status)}</span>
                    <div class="master-item-actions">
                        <button class="master-action-btn edit-btn" onclick="event.stopPropagation(); const d = state.oars.find(o=>o.id==='${item.id}'); if(d) openMasterEditModal(d);" title="編集">✏️</button>
                        <button class="master-action-btn delete-btn" onclick="confirmDeleteMaster('${item.id}', event)" title="削除">🗑️</button>
                    </div>
                </div>
            </div>`;
            }).join('') || '<div class="empty-state"><p>登録がありません</p></div>';

            list.innerHTML = specTableHtml + oarListHtml;
        } else if (currentMasterType === 'ergos') {
            list.innerHTML = data.map(item => {
                const status = item.status || (item.availability === '使用不可' ? 'broken' : 'available');
                return `
            <div class="master-item" data-id="${item.id}">
                <div class="info">
                    <div class="name">${item.name} (${item.type})</div>
                    <div class="sub">シール: ${item.sealNumber || '-'}</div>
                </div>
                <div class="master-item-right">
                    <span class="status ${getStatusClass(status)}">${translateStatus(status)}</span>
                    <div class="master-item-actions">
                        <button class="master-action-btn edit-btn" onclick="event.stopPropagation(); const d = state.ergos.find(e=>e.id==='${item.id}'); if(d) openMasterEditModal(d);" title="編集">✏️</button>
                        <button class="master-action-btn delete-btn" onclick="confirmDeleteMaster('${item.id}', event)" title="削除">🗑️</button>
                    </div>
                </div>
            </div>`;
            }).join('') || '<div class="empty-state"><p>登録がありません</p></div>';
        }

        list.querySelectorAll('.master-item').forEach(item => {
            item.addEventListener('click', () => {
                const id = item.dataset.id;
                const data = state[currentMasterType].find(d => d.id === id);
                if (data) openMasterEditModal(data);
            });
        });
    }

    function openMasterEditModal(item = null) {
        currentMasterItem = item;
        const modal = document.getElementById('master-edit-modal');
        const title = document.getElementById('master-edit-title');
        const form = document.getElementById('master-edit-form');

        const deleteBtn = document.getElementById('delete-master-btn');

        title.textContent = item ? '編集' : '新規追加';
        if (deleteBtn) deleteBtn.classList.toggle('hidden', !item);

        if (currentMasterType === 'boats') {
            const status = item?.status || (item?.availability === '使用不可' ? 'broken' : 'available');
            const isConv = item ? isConvertibleBoat(item.type) : false;
            const riggingMode = item ? getBoatRiggingMode(item) : null;

            let riggingModeHtml = '';
            if (isConv && item) {
                const altType = CONVERTIBLE_PAIRS[item.type];
                riggingModeHtml = `
            <div class="form-group">
                <label>現在のリギング状態</label>
                <div class="toggle-group rigging-mode-group">
                    <button class="toggle-btn rigging-mode-btn ${riggingMode === item.type ? 'active' : ''}" data-value="${item.type}">${CONVERTIBLE_LABELS[item.type]}</button>
                    <button class="toggle-btn rigging-mode-btn ${riggingMode === altType ? 'active' : ''}" data-value="${altType}">${CONVERTIBLE_LABELS[altType]}</button>
                </div>
                <p class="help-text" style="font-size:11px; color:#888; margin-top:4px;">この艇は${CONVERTIBLE_LABELS[item.type]}と${CONVERTIBLE_LABELS[altType]}を兼用できます</p>
            </div>`;
            }

            form.innerHTML = `
            <div class="form-group">
                <label>艇名</label>
                <input type="text" id="master-name" value="${item?.name || ''}" placeholder="例: 慶應丸">
            </div>
            <div class="form-group">
                <label>艇種</label>
                <select id="master-boat-type">
                    <option value="1x" ${item?.type === '1x' ? 'selected' : ''}>1x (シングルスカル)</option>
                    <option value="2x" ${item?.type === '2x' ? 'selected' : ''}>2x (ダブルスカル)</option>
                    <option value="2-" ${item?.type === '2-' ? 'selected' : ''}>2- (ペア)</option>
                    <option value="4x" ${item?.type === '4x' ? 'selected' : ''}>4x (クォドルプル)</option>
                    <option value="4+" ${item?.type === '4+' ? 'selected' : ''}>4+ (付きフォア)</option>
                    <option value="4-" ${item?.type === '4-' ? 'selected' : ''}>4- (なしフォア)</option>
                    <option value="8+" ${item?.type === '8+' ? 'selected' : ''}>8+ (エイト)</option>
                </select>
            </div>
            <div class="form-group">
                <label>使用団体</label>
                <select id="master-boat-org">
                    <option value="" ${!item?.organization ? 'selected' : ''}>未設定</option>
                    <option value="男子部" ${item?.organization === '男子部' ? 'selected' : ''}>男子部</option>
                    <option value="女子部" ${item?.organization === '女子部' ? 'selected' : ''}>女子部</option>
                    <option value="医学部" ${item?.organization === '医学部' ? 'selected' : ''}>医学部</option>
                    <option value="OB" ${item?.organization === 'OB' ? 'selected' : ''}>OB</option>
                </select>
            </div>
            ${riggingModeHtml}
            <div class="form-group">
                <label>状態</label>
                <div class="toggle-group status-group">
                    <button class="toggle-btn status-btn ${status === 'available' ? 'active' : ''}" data-value="available">使用可能</button>
                    <button class="toggle-btn status-btn ${status === 'repair' ? 'active' : ''}" data-value="repair">修理中</button>
                    <button class="toggle-btn status-btn ${status === 'broken' ? 'active' : ''}" data-value="broken">故障</button>
                </div>
            </div>
            <div class="form-group">
                <label>メモ</label>
                <textarea id="master-memo" rows="2" placeholder="備考など">${item?.memo || ''}</textarea>
            </div>
`;
        } else if (currentMasterType === 'oars') {
            const status = item?.status || (item?.availability === '使用不可' ? 'broken' : 'available');
            form.innerHTML = `
    < div class="form-group" >
                <label>オール名</label>
                <input type="text" id="master-name" value="${item?.name || ''}" placeholder="例: スカル1号">
            </div>
            <div class="form-group">
                <label>種別</label>
                <div class="toggle-group">
                    <button class="toggle-btn oar-type-btn ${(!item || item.type === 'スカル') ? 'active' : ''}" data-value="スカル">スカル（2本1組）</button>
                    <button class="toggle-btn oar-type-btn ${item?.type === 'スイープ' ? 'active' : ''}" data-value="スイープ">スイープ（1本）</button>
                </div>
            </div>
            <div class="form-group">
                <label>長さ</label>
                <input type="text" id="master-length" value="${item?.length || ''}" placeholder="例: 374cm, 298cm">
            </div>
            <div class="form-group">
                <label>シール番号 / ID</label>
                <input type="text" id="master-seal" value="${item?.sealNumber || ''}" placeholder="例: S001">
            </div>
            <div class="form-group">
                <label>状態</label>
                <div class="toggle-group status-group">
                    <button class="toggle-btn status-btn ${status === 'available' ? 'active' : ''}" data-value="available">使用可能</button>
                    <button class="toggle-btn status-btn ${status === 'repair' ? 'active' : ''}" data-value="repair">修理中</button>
                    <button class="toggle-btn status-btn ${status === 'broken' ? 'active' : ''}" data-value="broken">故障</button>
                </div>
            </div>
            <div class="form-group">
                <label>メモ</label>
                <textarea id="master-memo" rows="2" placeholder="備考など">${item?.memo || ''}</textarea>
            </div>
`;
        } else if (currentMasterType === 'ergos') {
            form.innerHTML = `
    < div class="form-group" >
                <label>エルゴ名</label>
                <input type="text" id="master-name" value="${item?.name || ''}" placeholder="例: ダイナミック1">
            </div>
            <div class="form-group">
                <label>種別</label>
                <div class="toggle-group">
                    <button class="toggle-btn ergo-master-type-btn ${(!item || item.type === 'ダイナミック') ? 'active' : ''}" data-value="ダイナミック">ダイナミック</button>
                    <button class="toggle-btn ergo-master-type-btn ${item?.type === '固定' ? 'active' : ''}" data-value="固定">固定</button>
                </div>
            </div>
            <div class="form-group">
                <label>シール番号</label>
                <input type="text" id="master-seal" value="${item?.sealNumber || ''}" placeholder="例: D001">
            </div>
            <div class="form-group">
                <label>状態</label>
                <div class="toggle-group status-group">
                    <button class="toggle-btn status-btn ${status === 'available' ? 'active' : ''}" data-value="available">使用可能</button>
                    <button class="toggle-btn status-btn ${status === 'repair' ? 'active' : ''}" data-value="repair">修理中</button>
                    <button class="toggle-btn status-btn ${status === 'broken' ? 'active' : ''}" data-value="broken">故障</button>
                </div>
            </div>
`;
        }

        // トグルボタンイベント
        form.querySelectorAll('.status-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                // フォーム全体の status-btn を一度非アクティブにする (今回は toggle-group でラップされているので、兄弟要素のみにした方が安全だが、実装上 form.innerHTML 全書き換えなのでこれでOK)
                // ですが、ボート・オール・エルゴでボタン構造が違うため、安全に親の .status-group 内のみ制御します。
                const group = btn.closest('.status-group');
                if (group) {
                    group.querySelectorAll('.status-btn').forEach(b => b.classList.remove('active'));
                } else {
                    // フォールバック
                    form.querySelectorAll('.status-btn').forEach(b => b.classList.remove('active'));
                }
                btn.classList.add('active');
            });
        });

        form.querySelectorAll('.availability-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                form.querySelectorAll('.availability-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            });
        });
        form.querySelectorAll('.oar-type-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                form.querySelectorAll('.oar-type-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            });
        });
        form.querySelectorAll('.rigging-mode-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                form.querySelectorAll('.rigging-mode-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            });
        });
        form.querySelectorAll('.ergo-master-type-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                form.querySelectorAll('.ergo-master-type-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            });
        });

        modal.classList.remove('hidden');
    }

    function closeMasterEditModal() {
        document.getElementById('master-edit-modal').classList.add('hidden');
        currentMasterItem = null;
    }

    function saveMasterItem() {
        const name = document.getElementById('master-name')?.value?.trim();
        if (!name) {
            showToast('名前を入力してください', 'error');
            return;
        }

        const status = document.querySelector('.status-btn.active')?.dataset.value || 'available';
        // Backwards compatibility
        const availability = status === 'available' ? '使用可能' : '使用不可';

        let newItem;
        if (currentMasterType === 'boats') {
            const boatType = document.getElementById('master-boat-type').value;
            const riggingModeBtn = document.querySelector('.rigging-mode-btn.active');
            const riggingMode = riggingModeBtn ? riggingModeBtn.dataset.value : (currentMasterItem?.currentRiggingMode || null);
            newItem = {
                id: currentMasterItem?.id || generateId(),
                name: document.getElementById('master-name').value,
                type: boatType,
                organization: document.getElementById('master-boat-org')?.value || '',
                currentRiggingMode: isConvertibleBoat(boatType) ? (riggingMode || boatType) : null,
                status: status,
                availability: availability,
                memo: document.getElementById('master-memo').value
            };
        } else if (currentMasterType === 'oars') {
            const oarType = document.querySelector('.oar-type-btn.active')?.dataset.value || 'スカル';
            newItem = {
                id: currentMasterItem?.id || generateId(),
                name: name,
                type: oarType,
                length: document.getElementById('master-length')?.value || '',
                sealNumber: document.getElementById('master-seal')?.value || '',
                status: status,
                availability: availability,
                memo: document.getElementById('master-memo')?.value || ''
            };
        } else if (currentMasterType === 'ergos') {
            const ergoType = document.querySelector('.ergo-master-type-btn.active')?.dataset.value || 'ダイナミック';
            newItem = {
                id: currentMasterItem?.id || generateId(),
                name: name,
                type: ergoType,
                sealNumber: document.getElementById('master-seal')?.value || '',
                status: status,
                availability: availability
            };
        }

        if (currentMasterItem) {
            const idx = state[currentMasterType].findIndex(d => d.id === currentMasterItem.id);
            if (idx !== -1) state[currentMasterType][idx] = newItem;
        } else {
            state[currentMasterType].push(newItem);
        }

        DB.save(currentMasterType, state[currentMasterType]);

        // Supabaseにも個別保存
        if (DB.useSupabase && window.SupabaseConfig?.db) {
            window.SupabaseConfig.db.saveMasterItem(currentMasterType, newItem).then(result => {
                if (!result) {
                    showToast('⚠️ Supabase同期に失敗しました（ローカルには保存済み）', 'error');
                }
            }).catch(e => {
                console.error('Master item Supabase save failed:', e);
                showToast('⚠️ Supabase同期エラー: ' + (e?.message || e), 'error');
            });
        }

        DB.addAuditLog(currentMasterType, newItem.id, currentMasterItem ? '更新' : '作成', { after: newItem });

        closeMasterEditModal();
        renderMasterList();
        // populateBoatOarSelects exists? If not creating it or using renderBoatSelect
        if (typeof populateBoatOarSelects === 'function') {
            populateBoatOarSelects();
        } else {
            // Fallback to refresh active modals logic if cleaner
            // Re-render select inputs if they exist in DOM
            // Specifically for filters or input modal
        }
        showToast('保存しました', 'success');
    }

    // Function to populate/update boat and oar selects in input modal
    // 艇種ごとのオール必要本数
    const OAR_COUNT_BY_BOAT_TYPE = {
        '1x': 1,  // シングル: スカル1セット
        '2x': 2,  // ダブル: スカル2セット
        '2-': 2,  // ペア: スイープ2本
        '4x': 4,  // クォード: スカル4セット
        '4+': 4,  // 付きフォア: スイープ4本
        '4-': 4,  // なしフォア: スイープ4本
        '8+': 8,  // エイト: スイープ8本
    };

    function populateBoatOarSelects() {
        // Boats（艇種フィルタ適用）
        const boatSelect = document.getElementById('input-boat');
        if (boatSelect) {
            const currentVal = boatSelect.value;
            const activeBoatTypeBtn = document.querySelector('.boat-type-btn.active');
            const selectedBoatType = activeBoatTypeBtn ? activeBoatTypeBtn.dataset.value : '';

            let filteredBoats = (state.boats || []);
            if (selectedBoatType) {
                filteredBoats = filteredBoats.filter(b => {
                    if (b.type) return b.type === selectedBoatType;
                    if (b.name.includes(selectedBoatType)) return true;
                    if (selectedBoatType === '4+' && b.name.includes('付きフォア')) return true;
                    if (selectedBoatType === '4x' && b.name.includes('クォドルプル')) return true;
                    if (selectedBoatType === '2x' && b.name.includes('ダブル')) return true;
                    if (selectedBoatType === '2-' && b.name.includes('ペア')) return true;
                    if (selectedBoatType === '1x' && b.name.includes('シングル')) return true;
                    if (selectedBoatType === '8+' && b.name.includes('エイト')) return true;
                    return false;
                });
                if (filteredBoats.length === 0) filteredBoats = (state.boats || []);
            }

            boatSelect.innerHTML = '<option value="">選択してください</option>';
            filteredBoats.forEach(b => {
                const status = b.status || (b.availability === '使用不可' ? 'broken' : 'available');
                const isUnavailable = status !== 'available';
                const statusLabel = isUnavailable ? ` (${translateStatus(status)})` : '';
                const statusEmoji = isUnavailable ? '🔴 ' : '🟢 ';
                const option = document.createElement('option');
                option.value = b.id;
                option.textContent = `${statusEmoji}${b.name}${statusLabel}`;
                if (isUnavailable) {
                    option.disabled = true;
                    option.style.color = '#999';
                }
                boatSelect.appendChild(option);
            });
            boatSelect.value = currentVal;
        }

        // Oars - 艇種に応じた本数分のselect生成
        populateOarSelects();
    }

    function populateOarSelects() {
        const container = document.getElementById('oar-selects-container');
        if (!container) return;

        const activeBoatTypeBtn = document.querySelector('.boat-type-btn.active');
        const boatType = activeBoatTypeBtn ? activeBoatTypeBtn.dataset.value : '';
        const oarCount = OAR_COUNT_BY_BOAT_TYPE[boatType] || 1;
        const isSweep = ['2-', '4+', '4-', '8+'].includes(boatType);
        const isScull = ['1x', '2x', '4x'].includes(boatType);

        // ラベル更新
        const countLabel = document.getElementById('oar-count-label');
        if (countLabel) {
            const typeLabel = isScull ? 'スカル' : isSweep ? 'スイープ' : '';
            const unitLabel = isScull ? 'セット' : '本';
            countLabel.textContent = boatType ? `(${typeLabel} ${oarCount}${unitLabel})` : '';
        }

        // 既存の選択値を保持
        const existingSelects = container.querySelectorAll('.input-oar-select');
        const existingValues = Array.from(existingSelects).map(s => s.value);

        // フィルタ＆ソート済みオールリスト
        let filteredOars = (state.oars || []);
        if (boatType && (isSweep || isScull)) {
            filteredOars = filteredOars.filter(o => {
                const oarType = (o.type || '').toLowerCase();
                if (isSweep) return oarType.includes('sweep') || oarType.includes('スイープ');
                if (isScull) return oarType.includes('scull') || oarType.includes('スカル');
                return true;
            });
        }
        filteredOars = sortOars(filteredOars);

        // 本数分のselectを生成
        let html = '';
        for (let i = 0; i < oarCount; i++) {
            const savedVal = existingValues[i] || '';
            html += `<select class="input-oar-select" data-oar-index="${i}" style="margin-bottom:6px;">
            <option value="">オール ${i + 1} を選択</option>
            ${filteredOars.map(o => {
                const status = o.status || (o.availability === '使用不可' ? 'broken' : 'available');
                const isUnavailable = status !== 'available';
                const statusEmoji = isUnavailable ? '🔴 ' : '🟢 ';
                const statusLabel = isUnavailable ? ` (${translateStatus(status)})` : '';
                return `<option value="${o.id}" ${isUnavailable ? 'disabled style="color:#999"' : ''} ${savedVal === o.id ? 'selected' : ''}>${statusEmoji}${o.name}${statusLabel}</option>`;
            }).join('')}
        </select>`;
        }
        container.innerHTML = html;
    }

    function deleteMasterItem(e) {
        if (e) { e.stopPropagation(); e.preventDefault(); }
        if (!currentMasterItem) return;

        const itemName = currentMasterItem.name || currentMasterItem.id;
        showConfirmModal(`「${itemName}」を削除しますか？`, () => {
            state[currentMasterType] = state[currentMasterType].filter(d => d.id !== currentMasterItem.id);
            DB.save(currentMasterType, state[currentMasterType]);
            DB.addAuditLog(currentMasterType, currentMasterItem.id, '削除', {});

            // Supabaseからも削除
            if (DB.useSupabase && window.SupabaseConfig?.db) {
                window.SupabaseConfig.db.deleteMasterItem(currentMasterType, currentMasterItem.id).catch(err => {
                    console.error('Master item Supabase delete failed:', err);
                });
            }

            closeMasterEditModal();
            renderMasterList();
            populateBoatOarSelects();
            showToast('削除しました', 'success');
        }, null, '削除する');
    }

    // =========================================
    // イベントリスナー
    // =========================================
    const initializeApp = async () => {
        try {

            // デモモード判定 (?demo=true)
            const urlParams = new URLSearchParams(window.location.search);
            const isDemoMode = urlParams.get('demo') === 'true';
            state.isDemoMode = isDemoMode;

            if (isDemoMode) {
                DB.setDemoMode(true);
                // デモモード時のみリセットボタンを表示
                const resetBtn = document.getElementById('reset-data-btn');
                if (resetBtn) resetBtn.classList.remove('hidden');
            }

            // Supabaseクライアントの初期化
            let supabaseReady = false;
            if (window.SupabaseConfig) {
                supabaseReady = window.SupabaseConfig.init();
            }

            // デモモード時のみデモデータを作成
            if (isDemoMode && !DB.loadLocal('users')) {
                DB.createDemoData();
            }

            await DB.init();

            // Supabase認証セッションのチェック
            let loggedIn = false;
            if (supabaseReady) {
                const session = await window.SupabaseConfig.getSession();
                if (session) {
                    const authSuccess = await handleAuthSession(session);
                    if (authSuccess) {
                        loggedIn = true;
                        // Supabaseからプロフィール一覧をロード
                        try {
                            const profiles = await window.SupabaseConfig.db.loadProfiles();
                            if (profiles.length > 0) {
                                state.users = profiles.map(p => ({
                                    id: p.id,
                                    authId: p.auth_id,
                                    name: p.name,
                                    grade: p.grade,
                                    gender: p.gender || 'man',
                                    role: migrateRole(p.role || '漕手'),
                                    status: p.status || '在籍',
                                    approvalStatus: p.approval_status || '承認済み',
                                    concept2Connected: p.concept2_connected || false,
                                    concept2Token: p.concept2_access_token || null,
                                    concept2LastSync: p.concept2_last_sync || null,
                                    side: p.side || null,
                                    weight: p.weight || null
                                }));
                                DB.saveLocal('users', state.users);
                            }
                        } catch (e) {
                            console.warn('Failed to load profiles from Supabase:', e);
                        }
                    }
                }

                // 認証状態変更の監視（ログイン/ログアウト時に自動反映）
                window.SupabaseConfig.onAuthStateChange(async (event, session) => {
                    if (event === 'SIGNED_IN' && session) {
                        const authSuccess = await handleAuthSession(session);
                        if (authSuccess && state.currentUser?.approvalStatus === '承認済み') {
                            // Supabaseから最新データを同期してからUI初期化
                            try {
                                await DB.syncFromSupabase();
                            } catch (e) {
                                console.warn('Post-login sync failed:', e);
                            }
                            initMainScreen();
                            updateConcept2UI();
                            showScreen('main-screen');
                        }
                    } else if (event === 'SIGNED_OUT') {
                        state.currentUser = null;
                        DB.save('current_user', null);
                        showScreen('login-screen');
                    }
                });
            }

            // デモモードからの前回ログイン状態復帰
            if (!loggedIn && state.currentUser?.approvalStatus === '承認済み') {
                // Supabase認証なしのデモユーザーの場合
                if (isDemoMode || state.currentUser.id?.startsWith('u')) {
                    loggedIn = true;
                }
            }

            // Concept2認証コールバックからの戻り処理
            if (urlParams.get('concept2_auth') === 'success') {
                const authResultJson = localStorage.getItem('concept2_auth_result');
                if (authResultJson) {
                    try {
                        const authResult = JSON.parse(authResultJson);
                        if (authResult.success && authResult.user_id) {
                            const userIndex = state.users.findIndex(u => u.id === authResult.user_id);
                            if (userIndex !== -1) {
                                state.users[userIndex].concept2Connected = true;
                                DB.save('users', state.users);
                                if (state.currentUser && state.currentUser.id === authResult.user_id) {
                                    state.currentUser.concept2Connected = true;
                                    DB.save('current_user', state.currentUser);
                                }
                                showToast('Concept2と連携しました！', 'success');
                            }
                        }
                        localStorage.removeItem('concept2_auth_result');
                    } catch (e) {
                        console.error('Failed to parse auth result:', e);
                    }
                }
                window.history.replaceState({}, document.title, window.location.pathname);
            }

            // 画面表示
            if (loggedIn) {
                initMainScreen();
                updateConcept2UI();
                showScreen('main-screen');
            } else {
                // デモモードの場合のみデモユーザー選択を表示
                if (isDemoMode) {
                    const demoContainer = document.getElementById('user-select-container');
                    if (demoContainer) demoContainer.classList.remove('hidden');
                    renderUserSelectList();
                }
                showScreen('login-screen');
            }

            // ログイン関連
            document.getElementById('skip-concept2-btn').addEventListener('click', skipConcept2);
            document.getElementById('connect-concept2-btn').addEventListener('click', connectConcept2);
            document.getElementById('logout-btn').addEventListener('click', handleLogout);
            document.getElementById('reset-data-btn')?.addEventListener('click', () => {
                showConfirmModal('⚠️ 全てのローカルデータを削除します。この操作は取り消せません。よろしいですか？', () => {
                    showConfirmModal('本当に全データを削除しますか？（最終確認）', () => {
                        DB.resetAllData();
                        showToast('データをリセットしました', 'success');
                        setTimeout(() => location.reload(), 500);
                    }, null, '全削除する');
                }, null, '次へ');
            });
            document.getElementById('logout-pending-btn')?.addEventListener('click', handleLogout);

            // 設定画面のConcept2
            document.getElementById('toggle-concept2-btn')?.addEventListener('click', toggleConcept2);
            document.getElementById('sync-concept2-btn')?.addEventListener('click', syncConcept2);

            // タブ
            document.querySelectorAll('.nav-item').forEach(item => {
                item.addEventListener('click', () => switchTab(item.dataset.tab));
            });

            // 週ナビ
            document.getElementById('prev-week-btn').addEventListener('click', () => {
                state.currentWeekStart.setDate(state.currentWeekStart.getDate() - 7);
                renderWeekCalendar();
            });
            document.getElementById('next-week-btn').addEventListener('click', () => {
                state.currentWeekStart.setDate(state.currentWeekStart.getDate() + 7);
                renderWeekCalendar();
            });

            // 入力モーダル
            document.getElementById('input-modal-close').addEventListener('click', closeInputModal);
            document.querySelector('#input-modal .modal-overlay').addEventListener('click', closeInputModal);
            document.getElementById('save-schedule-btn').addEventListener('click', saveSchedule);
            document.getElementById('delete-schedule-btn').addEventListener('click', deleteSchedule);

            // 予定種別切替
            document.querySelectorAll('.schedule-type-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    document.querySelectorAll('.schedule-type-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    handleScheduleTypeChange(btn.dataset.value);
                });
            });

            // トグルボタン（単一選択）
            ['reason-btn', 'ergo-type-btn', 'video-duration-btn'].forEach(cls => {
                document.querySelectorAll(`.${cls} `).forEach(btn => {
                    btn.addEventListener('click', () => {
                        document.querySelectorAll(`.${cls} `).forEach(b => b.classList.remove('active'));
                        btn.classList.add('active');
                    });
                });
            });

            // 艇種ボタン（単一選択）
            document.querySelectorAll('.boat-type-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    document.querySelectorAll('.boat-type-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    filterBoatSelect(btn.dataset.value);
                    if (typeof populateBoatOarSelects === 'function') populateBoatOarSelects();
                    // シート入力UI更新
                    if (typeof renderSeatInputs === 'function') renderSeatInputs(btn.dataset.value);
                });
            });

            // 炊事ボタン（複数選択可―トグル）
            document.querySelectorAll('.meal-type-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    btn.classList.toggle('active');
                });
            });

            // クルー検索
            document.getElementById('crew-search').addEventListener('input', (e) => filterCrew(e.target.value));

            // サブタブ切替（ノートタブ内）
            document.querySelectorAll('.note-subtab-btn').forEach(btn => {
                btn.addEventListener('click', () => switchNoteSubtab(btn.dataset.subtab));
            });

            // 練習ノートモーダル
            document.getElementById('practice-note-close')?.addEventListener('click', () => {
                document.getElementById('practice-note-modal').classList.add('hidden');
            });
            document.querySelector('#practice-note-modal .modal-overlay')?.addEventListener('click', () => {
                document.getElementById('practice-note-modal').classList.add('hidden');
            });
            document.getElementById('save-practice-note-btn')?.addEventListener('click', savePracticeNote);
            document.getElementById('link-ergo-btn')?.addEventListener('click', () => {
                const modal = document.getElementById('practice-note-modal');
                showErgoSelectList(modal.dataset.noteId);
            });

            // 全体タブ
            document.getElementById('overview-date').addEventListener('change', renderOverview);

            // マイレージ期間切替
            document.querySelectorAll('.period-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    renderMileageRanking(btn.dataset.period);
                });
            });

            // Concept2バナー
            document.getElementById('connect-from-data-btn')?.addEventListener('click', connectConcept2);
            document.getElementById('manual-sync-btn')?.addEventListener('click', syncConcept2);

            // マスタ管理ボタン
            document.getElementById('manage-boats-btn')?.addEventListener('click', () => openMasterModal('boats'));
            document.getElementById('manage-oars-btn')?.addEventListener('click', () => openMasterModal('oars'));
            document.getElementById('manage-ergos-btn')?.addEventListener('click', () => openMasterModal('ergos'));

            // マスタ管理モーダル
            document.getElementById('master-modal-close')?.addEventListener('click', closeMasterModal);
            document.querySelector('#master-modal .modal-overlay')?.addEventListener('click', closeMasterModal);
            document.getElementById('add-master-btn')?.addEventListener('click', () => openMasterEditModal());

            // マスタ編集モーダル
            document.getElementById('master-edit-close')?.addEventListener('click', closeMasterEditModal);
            document.querySelector('#master-edit-modal .modal-overlay')?.addEventListener('click', (e) => {
                if (e.target === e.currentTarget) closeMasterEditModal();
            });
            document.getElementById('save-master-btn')?.addEventListener('click', saveMasterItem);
            document.getElementById('delete-master-btn')?.addEventListener('click', (e) => {
                e.stopPropagation();
                e.preventDefault();
                deleteMasterItem(e);
            });

        } catch (e) {
            console.error('App init error:', e);
            // showToast('アプリの初期化に失敗しました: ' + e.message, 'error');
            // fallback
            const container = document.getElementById('user-select-list');
            if (container) container.innerHTML = `< div style = "color:red" > Error: ${e.message}</div > `;
        }
    };

    window.initializeApp = initializeApp;

    // Initialize App with error catching
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            try {
                initializeApp();
            } catch (e) {
                console.error('Fatal init error:', e);
                alert('Initialization Failed: ' + e.message);
            }
        });
    } else {
        try {
            initializeApp();
        } catch (e) {
            console.error('Fatal init error:', e);
            alert('Initialization Failed: ' + e.message);
        }
    }
    // ワークアウト情報からインターバル詳細を計算
    function calculateIntervalDetails(workout, defaultType = 'unknown') {
        let display = '';
        let type = defaultType;

        if (workout && workout.intervals && workout.intervals.length > 0) {
            const count = workout.intervals.length;
            const firstDist = workout.intervals[0].distance;
            const firstTime = workout.intervals[0].time;

            // 全セットで距離が一定か確認
            const isFixedDistance = workout.intervals.every(i => i.distance === firstDist);
            // 全セットで時間が一定か確認
            const isFixedTime = workout.intervals.every(i => i.time === firstTime);

            // Concept2のworkout_typeを優先して判定
            const isC2TimeWorkout = defaultType === 'FixedTimeSplits' || defaultType === 'FixedTimeInterval';
            const isC2DistWorkout = defaultType === 'FixedDistanceSplits' || defaultType === 'FixedDistanceInterval';

            if (isC2TimeWorkout || (isFixedTime && !isC2DistWorkout && !isFixedDistance)) {
                // 時間ベースインターバル
                const timeVal = firstTime || 0;
                const mins = Math.round(timeVal / 600); // 1/10秒 -> 分
                if (timeVal % 600 === 0 && mins > 0) {
                    display = `${mins}min×${count}`;
                } else {
                    const secs = Math.round(timeVal / 10);
                    display = `${secs}sec×${count}`;
                }
                type = 'FixedTimeInterval';
            } else if (isFixedDistance && firstDist > 0) {
                // 距離ベースインターバル
                display = `${firstDist}m×${count}`;
                type = 'FixedDistanceInterval';
            } else if (isFixedTime && firstTime > 0) {
                // フォールバック: 時間が一定なら時間ベース
                const mins = Math.round(firstTime / 600);
                if (firstTime % 600 === 0 && mins > 0) {
                    display = `${mins}min×${count}`;
                } else {
                    const secs = Math.round(firstTime / 10);
                    display = `${secs}sec×${count}`;
                }
                type = 'FixedTimeInterval';
            } else {
                // 変則
                display = `Variable×${count}`;
                type = 'VariableInterval';
            }
        }

        return { display, type };
    }

    // =========================================
    // リギング管理
    // =========================================

    /**
     * リギング管理の初期化（ロール分岐あり）
     */
    async function initRigging() {
        const role = state.currentUser?.role;
        const isViewer = [ROLES.COX, ROLES.COACH].includes(role);

        // ビュー切替
        const rowerView = document.getElementById('rower-rigging-view');
        const crewView = document.getElementById('crew-rigging-view');

        if (isViewer) {
            if (rowerView) rowerView.classList.add('hidden');
            if (crewView) crewView.classList.remove('hidden');
            initCrewRiggingView();
            return;
        }

        // 漕手/管理者: 通常のリギングフォーム
        if (rowerView) rowerView.classList.remove('hidden');
        if (crewView) crewView.classList.add('hidden');

        const boatSelect = document.getElementById('rigging-boat-select');
        if (!boatSelect) return;

        // 艇リストの取得（マスタから）
        let boats = state.boats || [];

        // Supabaseが有効なら取得試行（state.boatsはすでにsyncされているはずだが念のため）
        if (DB.useSupabase && window.SupabaseConfig?.db) {
            // state.boatsが空なら取得
            if (boats.length === 0) {
                try {
                    const supaBoats = await window.SupabaseConfig.db.loadMasterData('boats');
                    if (supaBoats && supaBoats.length) {
                        boats = supaBoats;
                        state.boats = boats;
                        DB.saveLocal('boats', boats);
                    }
                } catch (e) {
                    console.error('Failed to fetch boats', e);
                }
            }
        }

        // デモデータ生成（もし空なら）
        if (boats.length === 0) {
            boats = [
                { id: 'b1', name: 'Empacher 8+ (2020)', availability: '使用可能' },
                { id: 'b2', name: 'Filippi 4- (2019)', availability: '使用可能' },
                { id: 'b3', name: 'WinTech 2x (2021)', availability: '使用可能' },
                { id: 'b4', name: 'Empacher 1x (2018)', availability: '使用可能' }
            ];
            state.boats = boats;
            saveLocal('boats', boats);
        }

        // セレクトボックス更新
        boatSelect.innerHTML = '<option value="">選択してください</option>';
        boats.forEach(boat => {
            const option = document.createElement('option');
            option.value = boat.id;
            option.textContent = boat.name;
            boatSelect.appendChild(option);
        });

        // 非表示/表示のリセット
        document.getElementById('rigging-form').classList.add('hidden');
        document.getElementById('rigging-empty-state').classList.remove('hidden');

        // イベントリスナー
        boatSelect.onchange = (e) => loadRigging(e.target.value);

        // 保存ボタンイベント (一度だけ登録)
        const saveBtn = document.getElementById('save-rigging-btn');
        if (saveBtn) {
            // 既存のリスナーを削除するためにクローンして置換
            const newBtn = saveBtn.cloneNode(true);
            saveBtn.parentNode.replaceChild(newBtn, saveBtn);
            newBtn.onclick = () => saveRigging(document.getElementById('rigging-boat-select').value);
        }

        // 設備状態一覧をレンダリング
        renderEquipmentStatus();
    }

    // =========================================
    // 設備状態一覧
    // =========================================

    function switchEquipView(view) {
        document.querySelectorAll('[data-equip-view]').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.equipView === view);
        });
        const boatsList = document.getElementById('equip-boats-list');
        const oarsList = document.getElementById('equip-oars-list');
        if (boatsList) boatsList.classList.toggle('hidden', view !== 'boats');
        if (oarsList) oarsList.classList.toggle('hidden', view !== 'oars');
    }

    function renderEquipmentStatus() {
        renderBoatsList();
        renderOarsList();
    }

    function renderBoatsList() {
        const container = document.getElementById('equip-boats-list');
        if (!container) return;
        const boats = state.boats || [];
        if (boats.length === 0) {
            container.innerHTML = '<div class="empty-state"><p>艇データがありません</p></div>';
            return;
        }

        const orgColors = { '男子部': '#3b82f6', '女子部': '#ec4899', '医学部': '#10b981', 'OB': '#f59e0b' };
        const boatTypeColors = { '1x': '#6366f1', '2x': '#8b5cf6', '2-': '#a855f7', '4x': '#0ea5e9', '4+': '#0284c7', '4-': '#0369a1', '8+': '#dc2626' };
        const boatTypeLabels = { '1x': 'シングル', '2x': 'ダブル', '2-': 'ペア', '4x': 'クォード', '4+': '付きフォア', '4-': 'なしフォア', '8+': 'エイト' };
        const typeOrder = ['8+', '4+', '4-/4x', '2-/2x', '1x'];
        const groupLabels = {
            '8+': 'エイト',
            '4+': '付きフォア',
            '4-/4x': 'なしフォア / クォード',
            '2-/2x': 'ペア / ダブル',
            '1x': 'シングル'
        };
        const groupColors = {
            '8+': '#dc2626',
            '4+': '#0284c7',
            '4-/4x': '#0ea5e9',
            '2-/2x': '#8b5cf6',
            '1x': '#6366f1'
        };
        // 艇種→グループキーのマッピング
        const typeToGroup = {
            '8+': '8+', '4+': '4+', '4-': '4-/4x', '4x': '4-/4x',
            '2-': '2-/2x', '2x': '2-/2x', '1x': '1x'
        };

        // グループ別にまとめる
        const grouped = {};
        boats.forEach(b => {
            const type = b.type || 'その他';
            const groupKey = typeToGroup[type] || 'その他';
            if (!grouped[groupKey]) grouped[groupKey] = [];
            grouped[groupKey].push(b);
        });

        // 順序通りにレンダリング
        const sortedTypes = typeOrder.filter(t => grouped[t]);
        // typeOrderにない種類も末尾に追加
        Object.keys(grouped).forEach(t => { if (!sortedTypes.includes(t)) sortedTypes.push(t); });

        const renderCard = (b) => {
            const status = b.status || (b.availability === '使用不可' ? 'broken' : 'available');
            const statusText = translateStatus(status);
            const statusIcon = statusText === '使用可能' ? '🟢' : statusText === '故障' ? '🔴' : statusText === '修理中' ? '🟠' : '🟡';
            const orgLabel = b.organization || '';
            const orgBadge = orgLabel ? `<span style="background:${orgColors[orgLabel] || '#6b7280'};color:#fff;padding:2px 8px;border-radius:6px;font-size:11px;font-weight:600;">${orgLabel}</span>` : '';

            // 個別の艇種バッジ（グループ内で区別するため）
            const btColor = boatTypeColors[b.type] || '#6b7280';
            const btLabel = boatTypeLabels[b.type] || b.type || '';
            const typeBadge = b.type ? `<span style="background:${btColor};color:#fff;padding:2px 8px;border-radius:6px;font-size:11px;font-weight:600;">${b.type}</span>` : '';

            const isConvertible = isConvertibleBoat(b.type);
            const riggingMode = getBoatRiggingMode(b);
            let convertBtnHtml = '';
            if (isConvertible) {
                const modeLabel = CONVERTIBLE_LABELS[riggingMode] || riggingMode;
                convertBtnHtml = `
                <div style="display:flex;align-items:center;gap:6px;margin-top:8px;padding-top:8px;border-top:1px solid var(--border-color);">
                    <span style="font-size:12px;color:var(--text-muted);">現在:</span>
                    <span style="background:#7c3aed;color:#fff;padding:2px 8px;border-radius:6px;font-size:12px;font-weight:600;">${modeLabel}モード</span>
                    <button onclick="toggleBoatRiggingMode('${b.id}', event)" style="background:var(--accent-color);color:#fff;border:none;padding:4px 10px;border-radius:6px;font-size:12px;cursor:pointer;font-weight:600;">🔄 切替</button>
                </div>`;
            }

            const memo = b.memo || b.notes || '';
            const details = b.details || '';

            return `
            <div style="padding:12px 14px;margin-bottom:6px;background:var(--bg-white);border-radius:10px;border:1px solid var(--border-color);">
                <div style="display:flex;justify-content:space-between;align-items:center;">
                    <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;flex:1;">
                        <span style="font-weight:700;font-size:14px;color:var(--text-primary);">${b.name}</span>
                        ${typeBadge}
                        ${orgBadge}
                    </div>
                    <div style="font-size:12px;font-weight:600;white-space:nowrap;">${statusIcon} ${statusText}</div>
                </div>
                ${memo ? `<div style="font-size:12px;color:var(--text-muted);margin-top:4px;">${memo}</div>` : ''}
                ${details ? `<div style="font-size:12px;color:var(--text-secondary);margin-top:4px;padding:5px 8px;background:var(--bg-light);border-radius:6px;">📋 ${details}</div>` : ''}
                ${convertBtnHtml}
            </div>`;
        };

        container.innerHTML = sortedTypes.map(groupKey => {
            const gColor = groupColors[groupKey] || '#6b7280';
            const gLabel = groupLabels[groupKey] || groupKey;
            const count = grouped[groupKey].length;
            return `
            <div style="margin-bottom:16px;">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;padding-bottom:6px;border-bottom:2px solid ${gColor};">
                    <span style="background:${gColor};color:#fff;padding:3px 10px;border-radius:8px;font-size:13px;font-weight:700;">${groupKey}</span>
                    <span style="font-weight:700;font-size:14px;color:var(--text-primary);">${gLabel}</span>
                    <span style="font-size:12px;color:var(--text-muted);">(${count}艇)</span>
                </div>
                ${grouped[groupKey].map(renderCard).join('')}
            </div>`;
        }).join('');
    }

    // オール名からプレフィックス(pe,co,ft,vo,so)を抽出
    function getOarPrefix(name) {
        const n = (name || '').toLowerCase();
        const prefixes = ['pe', 'co', 'ft', 'vo', 'sk'];
        for (const p of prefixes) {
            if (n.startsWith(p) || n.includes(' ' + p) || n.includes('-' + p) || n.includes('_' + p)) return p;
        }
        // 名前中に部分一致
        for (const p of prefixes) {
            if (n.includes(p)) return p;
        }
        return 'zz'; // 不明は末尾
    }

    // オール名から数字を抽出
    function getOarNumber(name) {
        const match = (name || '').match(/(\d+)/);
        return match ? parseInt(match[1]) : 99999;
    }

    // オールのソート: プレフィックス順 → 数字順
    function sortOars(oars) {
        const prefixOrder = { 'pe': 0, 'co': 1, 'ft': 2, 'vo': 3, 'sk': 4, 'zz': 5 };
        return [...oars].sort((a, b) => {
            const pa = prefixOrder[getOarPrefix(a.name)] ?? 5;
            const pb = prefixOrder[getOarPrefix(b.name)] ?? 5;
            if (pa !== pb) return pa - pb;
            const na = getOarNumber(a.name);
            const nb = getOarNumber(b.name);
            if (na !== nb) return na - nb;
            return (a.name || '').localeCompare(b.name || '');
        });
    }

    // オールがスイープかスカルか判定
    function isOarSweep(oar) {
        const t = (oar.type || '').toLowerCase();
        return t.includes('sweep') || t.includes('スイープ');
    }
    function isOarScull(oar) {
        const t = (oar.type || '').toLowerCase();
        return t.includes('scull') || t.includes('スカル');
    }

    function renderOarsList() {
        const container = document.getElementById('equip-oars-list');
        if (!container) return;
        const oars = state.oars || [];
        if (oars.length === 0) {
            container.innerHTML = '<div class="empty-state"><p>オールデータがありません</p></div>';
            return;
        }

        const orgColors = { '男子部': '#3b82f6', '女子部': '#ec4899', '医学部': '#10b981', 'OB': '#f59e0b' };
        const boatTypeLabels = { '1x': 'シングル', '2x': 'ダブル', '2-': 'ペア', '4x': 'クォード', '4+': '付きフォア', '4-': 'なしフォア', '8+': 'エイト' };
        const boatTypeColors = { '1x': '#6366f1', '2x': '#8b5cf6', '2-': '#a855f7', '4x': '#0ea5e9', '4+': '#0284c7', '4-': '#0369a1', '8+': '#dc2626' };

        // スイープ / スカル / その他 に分類
        const sweepOars = sortOars(oars.filter(o => isOarSweep(o)));
        const scullOars = sortOars(oars.filter(o => isOarScull(o)));
        const otherOars = sortOars(oars.filter(o => !isOarSweep(o) && !isOarScull(o)));

        const groups = [];
        if (scullOars.length > 0) groups.push({ label: 'スカル (Scull)', color: '#6366f1', icon: '🔵', oars: scullOars });
        if (sweepOars.length > 0) groups.push({ label: 'スイープ (Sweep)', color: '#dc2626', icon: '🔴', oars: sweepOars });
        if (otherOars.length > 0) groups.push({ label: 'その他', color: '#6b7280', icon: '⚪', oars: otherOars });

        const renderOarCard = (o) => {
            const status = o.status || (o.availability === '使用不可' ? 'broken' : 'available');
            const statusText = translateStatus(status);
            const statusIcon = statusText === '使用可能' ? '🟢' : statusText === '故障' ? '🔴' : statusText === '修理中' ? '🟠' : '🟡';
            const side = o.side || '';
            const orgLabel = o.organization || '';
            const orgBadge = orgLabel ? `<span style="background:${orgColors[orgLabel] || '#6b7280'};color:#fff;padding:2px 8px;border-radius:6px;font-size:11px;font-weight:600;">${orgLabel}</span>` : '';
            const memo = o.memo || o.notes || '';
            const details = o.details || '';

            // 最後に使った船の情報
            const lastBoat = getLastUsedBoatForOar(o.id);
            let lastBoatBadge = '';
            if (lastBoat) {
                const btLabel = boatTypeLabels[lastBoat.type] || lastBoat.type || '';
                const btColor = boatTypeColors[lastBoat.type] || '#6b7280';
                lastBoatBadge = `<span style="background:${btColor};color:#fff;padding:2px 8px;border-radius:6px;font-size:10px;font-weight:600;" title="最後に使用: ${lastBoat.name} (${lastBoat.date})">${btLabel}${lastBoat.type ? ' ' + lastBoat.type : ''}</span>`;
            }

            // オール長のモード表示（スイープならペア/フォア/エイト、スカルならシングル/ダブル/クォード）
            let lengthBadge = '';
            if (o.length) {
                lengthBadge = `<span style="background:#059669;color:#fff;padding:2px 6px;border-radius:6px;font-size:10px;font-weight:600;">${o.length}cm</span>`;
            }

            return `
            <div style="padding:10px 14px;margin-bottom:6px;background:var(--bg-white);border-radius:10px;border:1px solid var(--border-color);${status !== 'available' ? 'opacity:0.6;' : ''}">
                <div style="display:flex;justify-content:space-between;align-items:center;">
                    <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap;flex:1;">
                        <span style="font-weight:700;font-size:14px;color:var(--text-primary);">${o.name}</span>
                        ${side ? `<span style="font-size:11px;color:var(--text-muted);background:var(--bg-light);padding:1px 6px;border-radius:4px;">${side}</span>` : ''}
                        ${orgBadge}
                        ${lastBoatBadge}
                        ${lengthBadge}
                    </div>
                    <div style="font-size:12px;font-weight:600;white-space:nowrap;">${statusIcon} ${statusText}</div>
                </div>
                ${memo ? `<div style="font-size:11px;color:var(--text-muted);margin-top:4px;">${memo}</div>` : ''}
                ${details ? `<div style="font-size:11px;color:var(--text-secondary);margin-top:3px;padding:4px 8px;background:var(--bg-light);border-radius:6px;">📋 ${details}</div>` : ''}
            </div>`;
        };

        container.innerHTML = groups.map(g => {
            return `
            <div style="margin-bottom:16px;">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;padding-bottom:6px;border-bottom:2px solid ${g.color};">
                    <span style="font-size:16px;">${g.icon}</span>
                    <span style="font-weight:700;font-size:14px;color:var(--text-primary);">${g.label}</span>
                    <span style="font-size:12px;color:var(--text-muted);">(${g.oars.length}本)</span>
                </div>
                ${g.oars.map(renderOarCard).join('')}
            </div>`;
        }).join('');
    }
    // =========================================
    // クルーリギング閲覧（コックス/コーチ用）
    // =========================================

    /**
     * クルーリギング閲覧の初期化
     */
    function initCrewRiggingView() {
        // 日付を今日に設定
        const dateInput = document.getElementById('crew-rigging-date');
        if (dateInput) {
            dateInput.value = formatDate(new Date());
            dateInput.onchange = () => loadCrewRiggingByDate(dateInput.value);
            loadCrewRiggingByDate(dateInput.value);
        }

        // 選手セレクトにメンバーを追加
        const memberSelect = document.getElementById('crew-rigging-member-select');
        if (memberSelect) {
            memberSelect.innerHTML = '<option value="">選択してください</option>';
            const rowers = (state.users || []).filter(u => u.role === ROLES.ROWER || u.role === '漕手' || u.role === '部員');
            rowers.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
            rowers.forEach(u => {
                const opt = document.createElement('option');
                opt.value = u.id;
                opt.textContent = `${u.name}（${u.grade || '?'}年）`;
                memberSelect.appendChild(opt);
            });
            memberSelect.onchange = () => loadMemberRigging(memberSelect.value);
        }
    }

    /**
     * クルーリギング閲覧モード切替
     */
    function switchCrewRiggingView(mode) {
        const scheduleView = document.getElementById('crew-rigging-schedule-view');
        const memberView = document.getElementById('crew-rigging-member-view');

        if (mode === 'schedule') {
            scheduleView.classList.remove('hidden');
            memberView.classList.add('hidden');
        } else {
            scheduleView.classList.add('hidden');
            memberView.classList.remove('hidden');
        }

        // ボタンのactive状態切替
        document.querySelectorAll('[data-crew-view]').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.crewView === mode);
        });
    }

    /**
     * 日付ベースでクルーリギング情報を読み込み
     */
    function loadCrewRiggingByDate(dateStr) {
        const container = document.getElementById('crew-rigging-schedule-list');
        if (!container) return;

        // その日の乗艇スケジュールを検索
        const boatSchedules = (state.schedules || []).filter(s =>
            s.date === dateStr && (s.type === '乗艇' || s.type === SCHEDULE_TYPES.BOAT)
        );

        if (boatSchedules.length === 0) {
            container.innerHTML = '<div class="empty-state"><p>この日の乗艇スケジュールはありません</p></div>';
            return;
        }

        // 艇ごとにグループ化
        const boatGroups = {};
        boatSchedules.forEach(s => {
            const boatId = s.boatId || s.boat_id;
            if (!boatId) return;
            if (!boatGroups[boatId]) boatGroups[boatId] = [];
            boatGroups[boatId].push(s);
        });

        let html = '';
        const boats = state.boats || [];
        const allHistory = DB.loadLocal('rigging_history') || [];
        const allRiggings = DB.loadLocal('riggings') || [];

        // 艇が見つからない場合は全ユーザーのリギングをまとめて表示
        if (Object.keys(boatGroups).length === 0) {
            // スケジュールにboatIdが無い場合、ユーザーごとにまとめて表示
            const userIds = [...new Set(boatSchedules.map(s => s.userId))];
            html += renderCrewBoatRigging(null, userIds, allHistory, allRiggings);
        } else {
            Object.keys(boatGroups).forEach(boatId => {
                const userIds = boatGroups[boatId].map(s => s.userId);
                html += renderCrewBoatRigging(boatId, userIds, allHistory, allRiggings);
            });
        }

        container.innerHTML = html || '<div class="empty-state"><p>リギングデータがありません</p></div>';
    }

    /**
     * 特定の艇のクルーリギングテーブルをレンダリング
     */
    function renderCrewBoatRigging(boatId, userIds, allHistory, allRiggings) {
        const boat = boatId ? (state.boats || []).find(b => b.id === boatId) : null;
        const boatName = boat ? boat.name : '不明な艇';

        let rows = '';
        const uniqueUserIds = [...new Set(userIds)];

        uniqueUserIds.forEach(userId => {
            const user = (state.users || []).find(u => u.id === userId);
            if (!user) return;

            // まず履歴から最新を取得
            let rigging = null;
            if (boatId) {
                const userHistory = allHistory
                    .filter(r => r.boat_id === boatId && r.user_id === userId)
                    .sort((a, b) => new Date(b.saved_at) - new Date(a.saved_at));
                rigging = userHistory[0] || null;

                // 履歴にない場合は旧形式から取得
                if (!rigging) {
                    rigging = allRiggings.find(r => r.boat_id === boatId && r.user_id === userId);
                }
            }

            if (rigging) {
                rows += `<tr>
                <td class="crew-rig-name">${user.name}</td>
                <td>${rigging.pin_to_heel || '-'}</td>
                <td>${rigging.depth || '-'}</td>
                <td>${rigging.span || '-'}</td>
                <td>${rigging.pitch || '-'}</td>
                <td>${rigging.height || '-'}</td>
            </tr>`;
            } else {
                rows += `<tr>
                <td class="crew-rig-name">${user.name}</td>
                <td colspan="5" style="color: #888; text-align: center;">未設定</td>
            </tr>`;
            }
        });

        if (!rows) return '';

        return `
    <div class="crew-rigging-boat-card">
        <h3 class="crew-rigging-boat-title">🚣 ${boatName}</h3>
        <div class="crew-rigging-table-wrap">
            <table class="crew-rigging-table">
                <thead>
                    <tr>
                        <th>選手</th>
                        <th>P2H</th>
                        <th>デプス</th>
                        <th>スパン</th>
                        <th>足角</th>
                        <th>ハイト</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
    </div>`;
    }

    /**
     * 選手別リギング閲覧
     */
    function loadMemberRigging(userId) {
        const container = document.getElementById('crew-rigging-member-detail');
        if (!container || !userId) {
            if (container) container.innerHTML = '<div class="empty-state"><p>選手を選択してリギング情報を表示</p></div>';
            return;
        }

        const user = (state.users || []).find(u => u.id === userId);
        if (!user) return;

        const allHistory = DB.loadLocal('rigging_history') || [];
        const allRiggings = DB.loadLocal('riggings') || [];
        const boats = state.boats || [];

        // この選手の全艇のリギングデータを収集
        let html = `<h3 style="margin: 12px 0 8px; font-size: 16px;">🏋️ ${user.name} のリギング設定</h3>`;
        let hasData = false;

        boats.forEach(boat => {
            // 履歴から最新を取得
            const userHistory = allHistory
                .filter(r => r.boat_id === boat.id && r.user_id === userId)
                .sort((a, b) => new Date(b.saved_at) - new Date(a.saved_at));
            let latest = userHistory[0] || null;

            // 旧形式からも取得
            if (!latest) {
                latest = allRiggings.find(r => r.boat_id === boat.id && r.user_id === userId);
            }

            if (latest) {
                hasData = true;
                const updatedAt = latest.saved_at || latest.updated_at;
                const dateStr = updatedAt ? new Date(updatedAt).toLocaleDateString('ja-JP') : '不明';

                html += `
            <div class="crew-rigging-boat-card">
                <h3 class="crew-rigging-boat-title">${boat.name}</h3>
                <div style="font-size: 12px; color: #888; margin-bottom: 8px;">最終更新: ${dateStr}</div>
                <div class="crew-rigging-table-wrap">
                    <table class="crew-rigging-table">
                        <thead>
                            <tr><th>P2H</th><th>デプス</th><th>スパン</th><th>足角</th><th>ハイト</th></tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td>${latest.pin_to_heel || '-'}</td>
                                <td>${latest.depth || '-'}</td>
                                <td>${latest.span || '-'}</td>
                                <td>${latest.pitch || '-'}</td>
                                <td>${latest.height || '-'}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
                ${latest.memo ? `<div style="margin-top: 8px; font-size: 13px; color: #aaa;">💬 ${latest.memo}</div>` : ''}
                ${userHistory.length > 1 ? `<div style="margin-top: 4px; font-size: 12px; color: #666;">📋 ${userHistory.length}件の履歴あり</div>` : ''}
            </div>`;
            }
        });

        if (!hasData) {
            html += '<div class="empty-state"><p>この選手のリギングデータはまだありません</p></div>';
        }

        container.innerHTML = html;
    }

    /**
     * Supabaseプロフィールを更新するヘルパー
     */
    async function syncProfileToSupabase(updates) {
        if (DB.useSupabase && window.SupabaseConfig?.isReady() && state.currentUser?.id) {
            try {
                await window.SupabaseConfig.db.updateProfile(state.currentUser.id, updates);
            } catch (e) {
                console.warn('Profile sync to Supabase failed:', e);
            }
        }
    }

    /**
     * 設定画面の描画
     */
    function renderSettings() {
        const user = state.currentUser;
        if (!user) return;

        // アカウント情報
        setText('settings-name', user.name);

        // 権限設定
        const roleSelect = document.getElementById('settings-role-select');
        if (roleSelect) {
            roleSelect.value = user.role || '漕手';
            roleSelect.onchange = (e) => {
                const newRole = e.target.value;
                const previousRole = state.currentUser.role;

                // 管理者への変更はパスコード認証が必要
                if (newRole === ROLES.ADMIN && previousRole !== ROLES.ADMIN) {
                    const adminPasscode = DB.load('admin_passcode') || 'tanteibu';
                    const inputCode = prompt('管理者パスコードを入力してください：');

                    if (inputCode === null) {
                        // キャンセルの場合は元に戻す
                        roleSelect.value = previousRole;
                        return;
                    }

                    if (inputCode !== adminPasscode) {
                        showToast('パスコードが正しくありません', 'error');
                        roleSelect.value = previousRole;
                        return;
                    }
                }

                // 権限を変更
                state.currentUser.role = newRole;
                DB.save('current_user', state.currentUser);

                const idx = state.users.findIndex(u => u.id === state.currentUser.id);
                if (idx !== -1) {
                    state.users[idx] = state.currentUser;
                    DB.save('users', state.users);
                }
                // ヘッダーの権限バッジも更新
                document.getElementById('user-role').textContent = newRole;
                // マスタ管理の表示/非表示を更新
                const masterSection = document.getElementById('master-settings');
                if (canEditMaster(state.currentUser)) {
                    masterSection.classList.remove('hidden');
                } else {
                    masterSection.classList.add('hidden');
                }
                // パスコード設定セクションの表示/非表示
                const passcodeSection = document.getElementById('admin-passcode-settings');
                if (passcodeSection) {
                    if (newRole === ROLES.ADMIN) {
                        passcodeSection.classList.remove('hidden');
                    } else {
                        passcodeSection.classList.add('hidden');
                    }
                }
                syncProfileToSupabase({ role: newRole });
                // ロール変更に伴いタブの表示/非表示を再適用
                applyRoleBasedTabs();
                showToast('権限を変更しました', 'success');
            };
        }

        // 管理者パスコード設定（管理者のみ表示）
        const passcodeSection = document.getElementById('admin-passcode-settings');
        if (passcodeSection) {
            if (user.role === ROLES.ADMIN) {
                passcodeSection.classList.remove('hidden');
                const currentPasscode = DB.load('admin_passcode') || 'tanteibu';
                document.getElementById('current-admin-passcode').textContent = currentPasscode;

                // Supabaseからも読み込み（非同期）
                if (DB.useSupabase && window.SupabaseConfig?.db) {
                    window.SupabaseConfig.db.loadSetting('admin_passcode').then(val => {
                        if (val) {
                            DB.save('admin_passcode', val);
                            document.getElementById('current-admin-passcode').textContent = val;
                        }
                    }).catch(() => { });
                }

                document.getElementById('set-admin-passcode-btn').onclick = () => {
                    const newPasscode = document.getElementById('new-admin-passcode').value.trim();
                    if (!newPasscode) {
                        showToast('パスコードを入力してください', 'error');
                        return;
                    }
                    if (newPasscode.length < 4) {
                        showToast('4文字以上のパスコードを設定してください', 'error');
                        return;
                    }
                    DB.save('admin_passcode', newPasscode);
                    // Supabaseにも保存
                    if (DB.useSupabase && window.SupabaseConfig?.db) {
                        window.SupabaseConfig.db.saveSetting('admin_passcode', newPasscode).catch(e => console.warn('Passcode sync failed:', e));
                    }
                    document.getElementById('current-admin-passcode').textContent = newPasscode;
                    document.getElementById('new-admin-passcode').value = '';
                    showToast('管理者パスコードを更新しました', 'success');
                };
            } else {
                passcodeSection.classList.add('hidden');
            }
        }

        // 学年設定
        const gradeSelect = document.getElementById('settings-grade-select');
        if (gradeSelect) {
            gradeSelect.value = String(user.grade || 1);
            gradeSelect.onchange = (e) => {
                const newGrade = parseInt(e.target.value);
                state.currentUser.grade = newGrade;
                DB.save('current_user', state.currentUser);

                const idx = state.users.findIndex(u => u.id === state.currentUser.id);
                if (idx !== -1) {
                    state.users[idx] = state.currentUser;
                    DB.save('users', state.users);
                }
                syncProfileToSupabase({ grade: newGrade });
                showToast('学年を変更しました', 'success');
            };
        }

        // 性別設定
        const genderSelect = document.getElementById('settings-gender-select');
        if (genderSelect) {
            genderSelect.value = user.gender || 'man';
            genderSelect.onchange = (e) => {
                const newGender = e.target.value;
                state.currentUser.gender = newGender;
                DB.save('current_user', state.currentUser);

                const idx = state.users.findIndex(u => u.id === state.currentUser.id);
                if (idx !== -1) {
                    state.users[idx] = state.currentUser;
                    DB.save('users', state.users);
                }
                syncProfileToSupabase({ gender: newGender });
                showToast('性別を変更しました', 'success');
            };
        }

        // サイド (S/B) 設定
        const sideSelect = document.getElementById('settings-side-select');
        if (sideSelect) {
            sideSelect.value = user.side || '';
            sideSelect.onchange = (e) => {
                const newSide = e.target.value;
                state.currentUser.side = newSide;
                DB.save('current_user', state.currentUser);

                const idx = state.users.findIndex(u => u.id === state.currentUser.id);
                if (idx !== -1) {
                    state.users[idx] = state.currentUser;
                    DB.save('users', state.users);
                }
                syncProfileToSupabase({ side: newSide });
                showToast('サイドを変更しました', 'success');
            };
        }

        // 体重管理
        try {
            initWeightSection();
        } catch (e) {
            console.error('initWeightSection error:', e);
        }

        // Concept2連携
        const isConnected = user.concept2Connected;
        const statusEl = document.getElementById('concept2-status');
        const lastSyncEl = document.getElementById('concept2-last-sync');
        const setupDiv = document.getElementById('concept2-setup');
        const actionsDiv = document.querySelector('.concept2-actions');
        const toggleBtn = document.getElementById('toggle-concept2-btn');
        const syncBtn = document.getElementById('sync-concept2-btn');

        if (isConnected) {
            if (statusEl) {
                statusEl.textContent = '連携済み';
                statusEl.className = 'settings-value success';
            }
            if (lastSyncEl) {
                lastSyncEl.classList.remove('hidden');
                document.getElementById('concept2-last-sync-time').textContent = user.concept2LastSync ? new Date(user.concept2LastSync).toLocaleString() : '未同期';
            }
            if (setupDiv) setupDiv.classList.add('hidden');
            if (syncBtn) syncBtn.classList.remove('hidden');
            if (toggleBtn) {
                toggleBtn.textContent = '連携を解除';
                toggleBtn.className = 'danger-btn';
                // 既存のリスナーを削除するためクローンして差し替え
                const newToggleBtn = toggleBtn.cloneNode(true);
                toggleBtn.parentNode.replaceChild(newToggleBtn, toggleBtn);
                newToggleBtn.addEventListener('click', function (e) {
                    e.preventDefault();
                    e.stopPropagation();
                    e.stopImmediatePropagation();
                    disconnectConcept2();
                });
            }
        } else {
            if (statusEl) {
                statusEl.textContent = '未連携';
                statusEl.className = 'settings-value';
            }
            if (lastSyncEl) lastSyncEl.classList.add('hidden');
            if (setupDiv) setupDiv.classList.remove('hidden');
            if (syncBtn) syncBtn.classList.add('hidden');
            if (toggleBtn) {
                toggleBtn.textContent = '連携する';
                toggleBtn.className = 'secondary-btn';
                const newToggleBtn = toggleBtn.cloneNode(true);
                toggleBtn.parentNode.replaceChild(newToggleBtn, toggleBtn);
                newToggleBtn.addEventListener('click', function (e) {
                    e.preventDefault();
                    e.stopPropagation();
                    connectConcept2();
                });
            }
        }

        // マスタ管理 (管理者/Coxのみ)
        const masterSection = document.getElementById('master-settings');
        if (canEditMaster(user)) {
            masterSection.classList.remove('hidden');
            document.getElementById('manage-boats-btn').onclick = () => openMasterModal('boats');
            document.getElementById('manage-oars-btn').onclick = () => openMasterModal('oars');
            document.getElementById('manage-ergos-btn').onclick = () => openMasterModal('ergos');
        } else {
            masterSection.classList.add('hidden');
        }

        // ログアウト
        const logoutBtn = document.getElementById('logout-btn');
        if (logoutBtn) {
            logoutBtn.onclick = handleLogout;
        }

        // 登録者名簿
        renderMemberRoster();
    }

    // 登録者名簿をレンダリング
    function renderMemberRoster() {
        const container = document.getElementById('member-roster');
        if (!container) return;

        const isAdmin = state.currentUser?.role === '管理者';
        const members = (state.users || []).filter(u => u.approvalStatus === '承認済み' && u.status !== '非在籍');

        if (members.length === 0) {
            container.innerHTML = '<p style="color:#888;font-size:13px;">登録者がいません</p>';
            return;
        }

        // 学年でグループ化（降順: 4年→1年→コーチ/OB）
        const gradeGroups = {};
        members.forEach(m => {
            const grade = m.grade || 0;
            const label = grade === 0 ? 'コーチ / OB' : `${grade}年`;
            if (!gradeGroups[grade]) gradeGroups[grade] = { label, members: [] };
            gradeGroups[grade].members.push(m);
        });

        const sortedGrades = Object.keys(gradeGroups).map(Number).sort((a, b) => b - a);

        const roleEmoji = (role) => {
            switch (role) {
                case '管理者': return '👑';
                case 'コーチ': return '🎓';
                case 'Cox': return '📣';
                case '漕手': return '🚣';
                default: return '👤';
            }
        };
        const genderLabel = (g) => g === 'woman' ? '女' : '男';

        let html = `<div style="font-size:13px;color:#666;margin-bottom:8px;">合計 ${members.length}名</div>`;

        sortedGrades.forEach(grade => {
            const group = gradeGroups[grade];
            const sorted = group.members.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ja'));

            html += `<div style="margin-bottom:12px;">`;
            html += `<div style="font-weight:600;font-size:14px;margin-bottom:4px;color:#333;">${group.label}（${sorted.length}名）</div>`;
            html += `<table style="width:100%;border-collapse:collapse;font-size:13px;">`;
            html += `<thead><tr style="background:#f5f5f5;border-bottom:1px solid #ddd;">
            <th style="text-align:left;padding:6px 8px;">名前</th>
            <th style="text-align:center;padding:6px 4px;">権限</th>
            <th style="text-align:center;padding:6px 4px;">性別</th>
            ${isAdmin ? '<th style="text-align:center;padding:6px 4px;width:40px;"></th>' : ''}
        </tr></thead><tbody>`;

            sorted.forEach(m => {
                const isMe = state.currentUser && m.id === state.currentUser.id;
                const bgStyle = isMe ? 'background:#e8f4fd;' : '';
                const deleteBtn = (isAdmin && !isMe)
                    ? `<td style="text-align:center;padding:4px 2px;">
                    <button onclick="deleteMember('${m.id}')" style="background:none;border:none;cursor:pointer;color:#dc2626;font-size:16px;" title="削除">✕</button>
                   </td>`
                    : (isAdmin ? '<td></td>' : '');
                html += `<tr style="border-bottom:1px solid #eee;${bgStyle}">
                <td style="padding:6px 8px;">${m.name || '不明'}${isMe ? ' <span style="color:#2196f3;font-size:11px;">（自分）</span>' : ''}</td>
                <td style="text-align:center;padding:6px 4px;">${roleEmoji(m.role)} ${m.role || '-'}</td>
                <td style="text-align:center;padding:6px 4px;">${genderLabel(m.gender)}</td>
                ${deleteBtn}
            </tr>`;
            });

            html += `</tbody></table></div>`;
        });

        container.innerHTML = html;
    }

    // 管理者: メンバーを削除（非在籍に変更）
    async function deleteMember(userId) {
        if (!state.currentUser || state.currentUser.role !== '管理者') {
            showToast('管理者権限が必要です', 'error');
            return;
        }
        if (userId === state.currentUser.id) {
            showToast('自分自身は削除できません', 'error');
            return;
        }

        const member = state.users.find(u => u.id === userId);
        if (!member) return;

        // カスタム確認モーダルを使用（confirm()はモバイルで問題あり）
        showConfirmModal(`${member.name} を名簿から削除しますか？\n（アカウントは「非在籍」に変更されます）`, async () => {
            // ローカルで非在籍に変更
            member.status = '非在籍';
            DB.save('users', state.users);

            // Supabase プロフィールも更新
            if (DB.useSupabase && window.SupabaseConfig?.isReady()) {
                try {
                    await window.SupabaseConfig.db.updateProfile(userId, { status: '非在籍' });
                } catch (e) {
                    console.warn('Profile update failed:', e);
                }
            }

            showToast(`${member.name} を名簿から削除しました`, 'success');
            renderMemberRoster();
        }, null, '削除する');
    }


    function disconnectConcept2() {
        showConfirmModal('Concept2との連携を解除しますか？', () => {
            try {
                state.currentUser.concept2Connected = false;
                state.currentUser.concept2Token = null;
                state.currentUser.concept2LastSync = null;
                DB.save('current_user', state.currentUser);

                // ユーザー一覧も更新
                const idx = state.users.findIndex(u => u.id === state.currentUser.id);
                if (idx !== -1) {
                    state.users[idx] = state.currentUser;
                    DB.save('users', state.users);
                }

                // Supabaseのプロフィールも更新
                syncProfileToSupabase({
                    concept2_connected: false,
                    concept2_access_token: null,
                    concept2_last_sync: null
                });

                showToast('連携を解除しました', 'success');
                renderSettings();
            } catch (e) {
                console.error('disconnectConcept2 error:', e);
                showToast('連携解除中にエラーが発生しました', 'error');
            }
        });
    }

    /**
     * カスタム確認モーダル（window.confirmの代替）
     * タイムスタンプベースの二重ガードでモバイルゴーストクリックを確実に防止
     */
    function showConfirmModal(message, onConfirm, onCancel, confirmText = '実行する') {
        // 既存のモーダルがあれば削除
        const existing = document.getElementById('custom-confirm-modal');
        if (existing) existing.remove();

        const GUARD_MS = 600;
        const createdAt = Date.now();

        const modal = document.createElement('div');
        modal.id = 'custom-confirm-modal';
        modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;z-index:10000;opacity:0;transition:opacity 0.2s ease;';

        const box = document.createElement('div');
        box.style.cssText = 'background:#1e1e2e;border-radius:16px;padding:24px;margin:16px;max-width:320px;width:100%;box-shadow:0 8px 32px rgba(0,0,0,0.4);transform:scale(0.92);transition:transform 0.2s ease;';

        const msgEl = document.createElement('p');
        msgEl.textContent = message;
        msgEl.style.cssText = 'color:#eee;font-size:15px;margin:0 0 20px 0;text-align:center;line-height:1.5;';

        const btnRow = document.createElement('div');
        btnRow.style.cssText = 'display:flex;gap:10px;';

        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = 'キャンセル';
        cancelBtn.style.cssText = 'flex:1;padding:12px;border:none;border-radius:10px;font-size:14px;font-weight:600;background:#333;color:#aaa;cursor:pointer;';

        const confirmBtn = document.createElement('button');
        confirmBtn.textContent = confirmText;
        confirmBtn.style.cssText = 'flex:1;padding:12px;border:none;border-radius:10px;font-size:14px;font-weight:600;background:#e74c3c;color:#fff;cursor:pointer;';

        btnRow.appendChild(cancelBtn);
        btnRow.appendChild(confirmBtn);
        box.appendChild(msgEl);
        box.appendChild(btnRow);
        modal.appendChild(box);
        document.body.appendChild(modal);

        function isGuarded() { return (Date.now() - createdAt) < GUARD_MS; }

        function closeModal(cb) {
            modal.style.opacity = '0';
            box.style.transform = 'scale(0.92)';
            setTimeout(() => { modal.remove(); if (cb) cb(); }, 150);
        }

        cancelBtn.addEventListener('click', function (e) {
            e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
            if (isGuarded()) return;
            closeModal(onCancel);
        });
        confirmBtn.addEventListener('click', function (e) {
            e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
            if (isGuarded()) return;
            closeModal(onConfirm);
        });
        modal.addEventListener('click', function (e) {
            if (e.target !== modal) return;
            e.preventDefault(); e.stopPropagation();
            if (isGuarded()) return;
            closeModal(onCancel);
        });

        // タッチイベント遮断（ガード期間中、capture phaseで）
        modal.addEventListener('touchstart', function (e) {
            if (isGuarded()) { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); }
        }, { passive: false, capture: true });
        modal.addEventListener('touchend', function (e) {
            if (isGuarded()) { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); }
        }, { passive: false, capture: true });

        // フェードイン
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                modal.style.opacity = '1';
                box.style.transform = 'scale(1)';
            });
        });
    }

    // =========================================
    // 体重管理
    // =========================================

    function initWeightSection() {
        const weightHistory = getWeightHistory();
        const latestWeight = weightHistory.length > 0 ? weightHistory[weightHistory.length - 1] : null;

        // 大きな体重表示を更新
        const displayLarge = document.getElementById('current-weight-display-large');
        if (displayLarge) {
            if (latestWeight) {
                displayLarge.textContent = latestWeight.weight.toFixed(1);
            } else {
                displayLarge.textContent = '--.-';
            }
        }

        // 体重入力フィールドに最新値をプリセット
        const input = document.getElementById('weight-input');
        if (input && latestWeight) {
            input.value = latestWeight.weight.toFixed(1);
        }

        // ±ステッパーボタン
        document.querySelectorAll('.weight-step-btn').forEach(btn => {
            btn.onclick = () => {
                const step = parseFloat(btn.dataset.step);
                const input = document.getElementById('weight-input');
                if (!input) return;
                let current = parseFloat(input.value) || (latestWeight ? latestWeight.weight : 70);
                current = Math.round((current + step) * 10) / 10;
                current = Math.max(30, Math.min(150, current));
                input.value = current.toFixed(1);
                // 大きな表示も即時更新
                if (displayLarge) displayLarge.textContent = current.toFixed(1);
            };
        });

        // 入力フィールドの変更で大きな表示も更新
        if (input) {
            input.oninput = () => {
                const val = parseFloat(input.value);
                if (displayLarge && !isNaN(val) && val >= 30 && val <= 150) {
                    displayLarge.textContent = val.toFixed(1);
                }
            };
        }

        // 記録ボタン
        const saveBtn = document.getElementById('save-weight-btn');
        if (saveBtn) {
            saveBtn.onclick = saveWeight;
        }

        // グラフと履歴を描画
        renderWeightChart(weightHistory);
        renderWeightHistoryList(weightHistory);
    }

    function getWeightHistory() {
        const history = DB.load('weight_history') || [];
        // 日付順にソート
        return history
            .filter(w => w.userId === state.currentUser?.id)
            .sort((a, b) => new Date(a.date) - new Date(b.date));
    }

    // 指定ユーザーの指定日の体重を取得（当日中に記録されていればOK）
    function getWeightForDate(userId, dateStr) {
        const history = DB.load('weight_history') || [];
        const targetDate = dateStr?.split('T')[0] || dateStr; // YYYY-MM-DD形式に正規化
        const entry = history.find(w => w.userId === userId && w.date === targetDate);
        return entry ? entry.weight : null;
    }

    function saveWeight() {
        const input = document.getElementById('weight-input');
        if (!input) return;

        const weight = parseFloat(input.value);
        if (isNaN(weight) || weight < 30 || weight > 150) {
            showToast('30〜150kgの範囲で入力してください', 'error');
            return;
        }

        const today = new Date().toISOString().split('T')[0];
        let allHistory = DB.load('weight_history') || [];

        // 同じ日の記録があれば更新
        const existingIdx = allHistory.findIndex(w => w.userId === state.currentUser.id && w.date === today);
        if (existingIdx !== -1) {
            allHistory[existingIdx].weight = weight;
        } else {
            allHistory.push({
                id: generateId(),
                userId: state.currentUser.id,
                date: today,
                weight: weight,
                createdAt: new Date().toISOString()
            });
        }

        DB.save('weight_history', allHistory);

        // Supabaseにも保存
        const entry = existingIdx !== -1 ? allHistory[existingIdx] : allHistory[allHistory.length - 1];
        if (DB.useSupabase && window.SupabaseConfig?.db) {
            window.SupabaseConfig.db.saveWeightEntry(entry).catch(e => console.warn('Weight sync failed:', e));
        }

        // ユーザーの現在体重も更新
        state.currentUser.weight = weight;
        DB.save('current_user', state.currentUser);
        const idx = state.users.findIndex(u => u.id === state.currentUser.id);
        if (idx !== -1) {
            state.users[idx] = state.currentUser;
            DB.save('users', state.users);
        }

        // Supabaseのプロフィールにも体重を同期
        syncProfileToSupabase({ weight: weight });

        input.value = '';
        showToast(`体重 ${weight} kg を記録しました`, 'success');
        initWeightSection(); // UI更新
    }

    function renderWeightChart(history) {
        const canvas = document.getElementById('weight-chart');
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        const rect = canvas.parentElement.getBoundingClientRect();
        canvas.width = rect.width || 300;
        canvas.height = 150;

        // 背景クリア
        ctx.fillStyle = '#1a1a2e';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // 最近30日のデータ
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const recentData = history.filter(w => new Date(w.date) >= thirtyDaysAgo);

        if (recentData.length < 2) {
            ctx.fillStyle = '#888';
            ctx.font = '13px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('2件以上の記録でグラフが表示されます', canvas.width / 2, canvas.height / 2);
            return;
        }

        const weights = recentData.map(w => w.weight);
        const minW = Math.floor(Math.min(...weights) - 1);
        const maxW = Math.ceil(Math.max(...weights) + 1);
        const rangeW = maxW - minW || 1;

        const padding = { top: 20, right: 15, bottom: 30, left: 40 };
        const plotWidth = canvas.width - padding.left - padding.right;
        const plotHeight = canvas.height - padding.top - padding.bottom;

        // Y軸ラベル
        ctx.fillStyle = '#aaa';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'right';
        for (let i = 0; i <= 4; i++) {
            const val = minW + (rangeW * i / 4);
            const y = padding.top + plotHeight - (plotHeight * i / 4);
            ctx.fillText(val.toFixed(1), padding.left - 5, y + 3);
            // グリッド線
            ctx.strokeStyle = 'rgba(255,255,255,0.07)';
            ctx.beginPath();
            ctx.moveTo(padding.left, y);
            ctx.lineTo(canvas.width - padding.right, y);
            ctx.stroke();
        }

        // データポイントとライン
        const points = recentData.map((w, i) => ({
            x: padding.left + (plotWidth * i / (recentData.length - 1)),
            y: padding.top + plotHeight - (plotHeight * (w.weight - minW) / rangeW),
            weight: w.weight,
            date: w.date
        }));

        // グラデーション塗りつぶし
        const gradient = ctx.createLinearGradient(0, padding.top, 0, canvas.height - padding.bottom);
        gradient.addColorStop(0, 'rgba(74, 144, 226, 0.3)');
        gradient.addColorStop(1, 'rgba(74, 144, 226, 0.02)');

        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.moveTo(points[0].x, canvas.height - padding.bottom);
        points.forEach(p => ctx.lineTo(p.x, p.y));
        ctx.lineTo(points[points.length - 1].x, canvas.height - padding.bottom);
        ctx.closePath();
        ctx.fill();

        // ライン
        ctx.strokeStyle = '#4a90e2';
        ctx.lineWidth = 2;
        ctx.lineJoin = 'round';
        ctx.beginPath();
        points.forEach((p, i) => {
            if (i === 0) ctx.moveTo(p.x, p.y);
            else ctx.lineTo(p.x, p.y);
        });
        ctx.stroke();

        // データポイント（ドット）
        points.forEach(p => {
            ctx.fillStyle = '#4a90e2';
            ctx.beginPath();
            ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#fff';
            ctx.beginPath();
            ctx.arc(p.x, p.y, 1.5, 0, Math.PI * 2);
            ctx.fill();
        });

        // X軸ラベル（最初と最後の日付）
        ctx.fillStyle = '#aaa';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(recentData[0].date.slice(5), padding.left, canvas.height - 5);
        ctx.textAlign = 'right';
        ctx.fillText(recentData[recentData.length - 1].date.slice(5), canvas.width - padding.right, canvas.height - 5);

        // 最新値を強調
        const last = points[points.length - 1];
        ctx.fillStyle = '#4a90e2';
        ctx.font = 'bold 12px sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(`${last.weight} kg`, last.x - 5, last.y - 8);
    }

    function renderWeightHistoryList(history) {
        const list = document.getElementById('weight-history-list');
        if (!list) return;

        const recent = history.slice(-10).reverse(); // 最新10件

        if (recent.length === 0) {
            list.innerHTML = '<div style="text-align:center; color:#888; font-size:12px; padding:8px;">記録はまだありません</div>';
            return;
        }

        list.innerHTML = recent.map((w, i) => {
            const prev = i < recent.length - 1 ? recent[i + 1].weight : null;
            const diff = prev !== null ? (w.weight - prev).toFixed(1) : null;
            const diffStr = diff !== null
                ? (diff > 0 ? `<span style="color:#e74c3c">+${diff}</span>` : diff < 0 ? `<span style="color:#27ae60">${diff}</span>` : `<span style="color:#888">±0</span>`)
                : '';

            return `<div style="display:flex; justify-content:space-between; padding:4px 0; border-bottom:1px solid rgba(255,255,255,0.05); font-size:12px;">
            <span style="color:#aaa;">${w.date.slice(5).replace('-', '/')}</span>
            <span><strong>${w.weight}</strong> kg ${diffStr}</span>
        </div>`;
        }).join('');
    }

    function setText(id, text) {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    }

    /**
     * リギングデータの読み込み（履歴方式）
     */
    const RIGGING_MAX_HISTORY = 10;
    const RIGGING_FIELDS = ['pin_to_heel', 'depth', 'span', 'pitch', 'height'];
    const RIGGING_FIELD_LABELS = {
        pin_to_heel: 'ピン・トゥ・ヒール',
        depth: 'デプス',
        span: 'スパン',
        pitch: '足角',
        height: 'ハイト'
    };

    function getRiggingHistory(boatId, userId) {
        const all = DB.loadLocal('rigging_history') || [];
        return all
            .filter(r => r.boat_id === boatId && r.user_id === userId)
            .sort((a, b) => new Date(b.saved_at) - new Date(a.saved_at));
    }

    async function loadRigging(boatId) {
        if (!boatId) {
            document.getElementById('rigging-form').classList.add('hidden');
            document.getElementById('rigging-empty-state').classList.remove('hidden');
            document.getElementById('rigging-history-panel').classList.add('hidden');
            document.getElementById('rigging-comparison-panel').classList.add('hidden');
            return;
        }

        const currentUser = state.currentUser;
        if (!currentUser) return;

        document.getElementById('rigging-form').classList.remove('hidden');
        document.getElementById('rigging-empty-state').classList.add('hidden');
        document.getElementById('rigging-history-panel').classList.add('hidden');
        document.getElementById('rigging-comparison-panel').classList.add('hidden');

        const inputs = {
            pin_to_heel: document.getElementById('rigging-pin-to-heel'),
            depth: document.getElementById('rigging-depth'),
            span: document.getElementById('rigging-span'),
            pitch: document.getElementById('rigging-pitch'),
            height: document.getElementById('rigging-height'),
            memo: document.getElementById('rigging-memo')
        };

        // 入力値をリセット
        Object.values(inputs).forEach(input => { if (input) input.value = ''; });

        // 旧データからのマイグレーション
        let oldRiggings = DB.loadLocal('riggings') || [];
        let oldRigging = oldRiggings.find(r => r.boat_id === boatId && r.user_id === currentUser.id);

        // Supabaseから取得試行
        if (DB.useSupabase && window.SupabaseConfig?.db) {
            try {
                const riggings = await window.SupabaseConfig.db.loadRiggings();
                const supabaseRigging = riggings.find(r => r.boat_id === boatId && r.user_id === currentUser.id);
                if (supabaseRigging) {
                    oldRigging = supabaseRigging;
                }
            } catch (e) {
                // Not found is expected
            }
        }

        // 旧データがあれば履歴にマイグレーション
        if (oldRigging) {
            const history = getRiggingHistory(boatId, currentUser.id);
            const alreadyMigrated = history.some(h => h.migrated_from_old);
            if (!alreadyMigrated) {
                const migratedEntry = {
                    id: generateId(),
                    boat_id: boatId,
                    user_id: currentUser.id,
                    pin_to_heel: oldRigging.pin_to_heel || '',
                    depth: oldRigging.depth || '',
                    span: oldRigging.span || '',
                    pitch: oldRigging.pitch || '',
                    height: oldRigging.height || '',
                    memo: oldRigging.memo || '',
                    saved_at: oldRigging.updated_at || oldRigging.created_at || new Date().toISOString(),
                    migrated_from_old: true
                };
                let allHistory = DB.loadLocal('rigging_history') || [];
                allHistory.push(migratedEntry);
                DB.saveLocal('rigging_history', allHistory);
            }
        }

        // 履歴から最新を取得してフォームに反映
        const history = getRiggingHistory(boatId, currentUser.id);
        if (history.length > 0) {
            const latest = history[0];
            if (inputs.pin_to_heel) inputs.pin_to_heel.value = latest.pin_to_heel || '';
            if (inputs.depth) inputs.depth.value = latest.depth || '';
            if (inputs.span) inputs.span.value = latest.span || '';
            if (inputs.pitch) inputs.pitch.value = latest.pitch || '';
            if (inputs.height) inputs.height.value = latest.height || '';
            if (inputs.memo) inputs.memo.value = latest.memo || '';
        }

        // 履歴カウント更新
        updateRiggingHistoryCount(history.length);
    }

    function updateRiggingHistoryCount(count) {
        const badge = document.getElementById('rigging-history-count');
        if (badge) {
            badge.textContent = count;
            badge.classList.toggle('hidden', count <= 0);
        }
    }

    /**
     * リギングデータの保存（履歴方式）
     */
    async function saveRigging(boatId) {
        if (!boatId) return;

        const currentUser = state.currentUser;
        if (!currentUser) return;

        const newEntry = {
            id: generateId(),
            boat_id: boatId,
            user_id: currentUser.id,
            pin_to_heel: document.getElementById('rigging-pin-to-heel').value,
            depth: document.getElementById('rigging-depth').value,
            span: document.getElementById('rigging-span').value,
            pitch: document.getElementById('rigging-pitch').value,
            height: document.getElementById('rigging-height').value,
            memo: document.getElementById('rigging-memo').value,
            saved_at: new Date().toISOString()
        };

        // 履歴に追加
        let allHistory = DB.loadLocal('rigging_history') || [];
        allHistory.push(newEntry);

        // ボート×ユーザーごとに最大件数を制限
        const boatUserHistory = allHistory
            .filter(r => r.boat_id === boatId && r.user_id === currentUser.id)
            .sort((a, b) => new Date(b.saved_at) - new Date(a.saved_at));

        let removedIds = [];
        if (boatUserHistory.length > RIGGING_MAX_HISTORY) {
            const toRemove = boatUserHistory.slice(RIGGING_MAX_HISTORY);
            removedIds = toRemove.map(r => r.id);
            allHistory = allHistory.filter(r => !removedIds.includes(r.id));
        }

        DB.saveLocal('rigging_history', allHistory);

        // 旧形式（riggings）にも最新値を保存（後方互換性）
        let riggings = DB.loadLocal('riggings') || [];
        const oldData = {
            pin_to_heel: newEntry.pin_to_heel,
            depth: newEntry.depth,
            span: newEntry.span,
            pitch: newEntry.pitch,
            height: newEntry.height,
            memo: newEntry.memo,
            updated_at: newEntry.saved_at
        };

        const index = riggings.findIndex(r => r.boat_id === boatId && r.user_id === currentUser.id);
        if (index >= 0) {
            riggings[index] = { ...riggings[index], ...oldData };
        } else {
            riggings.push({
                id: generateId(),
                user_id: currentUser.id,
                boat_id: boatId,
                ...oldData,
                created_at: newEntry.saved_at
            });
        }
        DB.saveLocal('riggings', riggings);

        // Supabase保存
        if (DB.useSupabase && window.SupabaseConfig?.db) {
            try {
                // riggingsテーブル（最新値）を保存
                await window.SupabaseConfig.db.saveRigging({
                    user_id: currentUser.id,
                    boat_id: boatId,
                    ...oldData
                });

                // rigging_historyテーブルに新エントリ保存
                await window.SupabaseConfig.db.saveRiggingHistory({
                    id: newEntry.id,
                    boat_id: newEntry.boat_id,
                    user_id: newEntry.user_id,
                    pin_to_heel: newEntry.pin_to_heel,
                    depth: newEntry.depth,
                    span: newEntry.span,
                    pitch: newEntry.pitch,
                    height: newEntry.height,
                    memo: newEntry.memo,
                    saved_at: newEntry.saved_at
                });

                // 古い履歴をSupabaseからも削除
                if (removedIds.length > 0) {
                    await window.SupabaseConfig.db.deleteRiggingHistory(removedIds);
                }

                showToast('リギング設定を保存しました（クラウド同期）', 'success');
            } catch (e) {
                console.error('Failed to save rigging to Supabase', e);
                showToast('リギング設定を保存しました（オフライン）', 'success');
            }
        } else {
            showToast('リギング設定を保存しました', 'success');
        }

        // 履歴カウント更新
        const updatedHistory = getRiggingHistory(boatId, currentUser.id);
        updateRiggingHistoryCount(updatedHistory.length);
    }

    /**
     * リギング履歴パネルの表示/非表示
     */
    function toggleRiggingHistory() {
        const panel = document.getElementById('rigging-history-panel');
        const compPanel = document.getElementById('rigging-comparison-panel');

        if (panel.classList.contains('hidden')) {
            compPanel.classList.add('hidden');
            panel.classList.remove('hidden');
            renderRiggingHistory();
        } else {
            panel.classList.add('hidden');
        }
    }

    /**
     * リギング履歴の描画
     */
    function renderRiggingHistory() {
        const boatId = document.getElementById('rigging-boat-select').value;
        const currentUser = state.currentUser;
        if (!boatId || !currentUser) return;

        const history = getRiggingHistory(boatId, currentUser.id);
        const listEl = document.getElementById('rigging-history-list');

        if (history.length === 0) {
            listEl.innerHTML = '<div class="empty-state"><p>履歴がありません</p></div>';
            return;
        }

        const latest = history[0];

        listEl.innerHTML = history.map((entry, idx) => {
            const date = new Date(entry.saved_at);
            const dateStr = `${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;
            const isLatest = idx === 0;

            // 変更された項目数を計算（最新との比較）
            let diffCount = 0;
            if (!isLatest) {
                RIGGING_FIELDS.forEach(f => {
                    if (String(entry[f] || '') !== String(latest[f] || '')) diffCount++;
                });
            }
            const diffBadge = !isLatest && diffCount > 0 ? `<span class="rigging-diff-count">${diffCount}項目変更</span>` : '';

            // 主要値のプレビュー
            const previewParts = [];
            if (entry.pin_to_heel) previewParts.push(`P2H: ${entry.pin_to_heel}`);
            if (entry.span) previewParts.push(`スパン: ${entry.span}`);
            if (entry.height) previewParts.push(`ハイト: ${entry.height}`);
            const previewStr = previewParts.length > 0 ? previewParts.join(' / ') : '値なし';

            return `
        <div class="rigging-history-item ${isLatest ? 'latest' : ''}" onclick="${isLatest ? '' : `showRiggingComparison(${idx})`}">
            <div class="rigging-history-item-header">
                <span class="rigging-history-date">${dateStr}</span>
                ${isLatest ? '<span class="rigging-latest-badge">最新 ⭐</span>' : ''}
                ${diffBadge}
            </div>
            <div class="rigging-history-preview">${previewStr}</div>
            ${entry.memo ? `<div class="rigging-history-memo">💬 ${entry.memo}</div>` : ''}
            ${!isLatest ? '<div class="rigging-history-compare-hint">タップして最新と比較 →</div>' : ''}
        </div>`;
        }).join('');
    }

    /**
     * リギング比較表示
     */
    function showRiggingComparison(historyIdx) {
        const boatId = document.getElementById('rigging-boat-select').value;
        const currentUser = state.currentUser;
        if (!boatId || !currentUser) return;

        const history = getRiggingHistory(boatId, currentUser.id);
        if (historyIdx >= history.length) return;

        const latest = history[0];
        const older = history[historyIdx];

        const latestDate = new Date(latest.saved_at);
        const olderDate = new Date(older.saved_at);
        const fmtDate = (d) => `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;

        let rows = RIGGING_FIELDS.map(field => {
            const latestVal = latest[field] || '-';
            const olderVal = older[field] || '-';
            const isDiff = String(latestVal) !== String(olderVal);
            const diffClass = isDiff ? 'rigging-diff-highlight' : '';

            let diffArrow = '';
            if (isDiff && latestVal !== '-' && olderVal !== '-') {
                const diff = (parseFloat(latestVal) - parseFloat(olderVal)).toFixed(1);
                const sign = diff > 0 ? '+' : '';
                diffArrow = `<span class="rigging-diff-arrow ${diff > 0 ? 'up' : 'down'}">${sign}${diff}</span>`;
            }

            return `
        <tr class="${diffClass}">
            <td class="rigging-cmp-label">${RIGGING_FIELD_LABELS[field]}</td>
            <td class="rigging-cmp-old">${olderVal}</td>
            <td class="rigging-cmp-new">${latestVal} ${diffArrow}</td>
        </tr>`;
        }).join('');

        // メモ比較
        if (latest.memo || older.memo) {
            const memoChanged = (latest.memo || '') !== (older.memo || '');
            rows += `
        <tr class="${memoChanged ? 'rigging-diff-highlight' : ''}">
            <td class="rigging-cmp-label">メモ</td>
            <td class="rigging-cmp-old rigging-cmp-memo">${older.memo || '-'}</td>
            <td class="rigging-cmp-new rigging-cmp-memo">${latest.memo || '-'}</td>
        </tr>`;
        }

        const body = document.getElementById('rigging-comparison-body');
        body.innerHTML = `
        <table class="rigging-comparison-table">
            <thead>
                <tr>
                    <th>項目</th>
                    <th>${fmtDate(olderDate)}</th>
                    <th>最新 (${fmtDate(latestDate)}) ⭐</th>
                </tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>
        <button class="secondary-btn rigging-restore-btn" onclick="restoreRigging(${historyIdx})">🔄 この設定をフォームに戻す</button>`;

        document.getElementById('rigging-comparison-panel').classList.remove('hidden');
        document.getElementById('rigging-history-panel').classList.add('hidden');
    }

    /**
     * 過去のリギング値をフォームに復元
     */
    function restoreRigging(historyIdx) {
        const boatId = document.getElementById('rigging-boat-select').value;
        const currentUser = state.currentUser;
        if (!boatId || !currentUser) return;

        const history = getRiggingHistory(boatId, currentUser.id);
        if (historyIdx >= history.length) return;

        const entry = history[historyIdx];

        document.getElementById('rigging-pin-to-heel').value = entry.pin_to_heel || '';
        document.getElementById('rigging-depth').value = entry.depth || '';
        document.getElementById('rigging-span').value = entry.span || '';
        document.getElementById('rigging-pitch').value = entry.pitch || '';
        document.getElementById('rigging-height').value = entry.height || '';
        document.getElementById('rigging-memo').value = entry.memo || '';

        document.getElementById('rigging-comparison-panel').classList.add('hidden');
        showToast('過去の設定をフォームに反映しました。保存すると新バージョンとして記録されます。', 'info');
    }

    function closeRiggingComparison() {
        document.getElementById('rigging-comparison-panel').classList.add('hidden');
    }

    // =========================================
    // クルーノート機能
    // =========================================

    // スケジュールからクルー情報を抽出
    function extractCrewsFromSchedules() {
        const crewMap = new Map();

        // 既存のクルーノートからクルーをリスト化
        if (state.crewNotes) {
            state.crewNotes.forEach(note => {
                const hash = note.crewHash;
                if (!crewMap.has(hash)) {
                    crewMap.set(hash, {
                        hash: hash,
                        memberIds: note.memberIds,
                        boatType: note.boatType,
                        lastPractice: note.date
                    });
                } else {
                    // 最新の日付を更新
                    const existing = crewMap.get(hash);
                    if (new Date(note.date) > new Date(existing.lastPractice)) {
                        existing.lastPractice = note.date;
                    }
                }
            });
        }

        // スケジュールからもクルーを抽出 (ノート未作成のクルーも表示するため)
        if (state.schedules) {
            state.schedules.forEach(schedule => {
                if (schedule.scheduleType === SCHEDULE_TYPES.BOAT && schedule.crewIds && schedule.crewIds.length > 0) {
                    // ハッシュ生成 (メンバーIDをソートして結合)
                    const sortedIds = [...schedule.crewIds].sort();
                    const hash = sortedIds.join('-');

                    // 艇種推定 (人数から)
                    let boatType = '不明';
                    const count = sortedIds.length;
                    if (count === 1) boatType = '1x';
                    else if (count === 2) boatType = '2x/2-';
                    else if (count === 4) boatType = '4x/4+';
                    else if (count === 8) boatType = '8+';

                    // 明示的なboatTypeがあればそれを使う
                    if (schedule.boatType) boatType = schedule.boatType;


                    if (!crewMap.has(hash)) {
                        crewMap.set(hash, {
                            hash: hash,
                            memberIds: sortedIds,
                            boatType: boatType,
                            lastPractice: schedule.date
                        });
                    } else {
                        const existing = crewMap.get(hash);
                        if (new Date(schedule.date) > new Date(existing.lastPractice)) {
                            existing.lastPractice = schedule.date;
                            // boatTypeが不明で、こちらで判明しているなら更新
                            if ((existing.boatType === '不明' || !existing.boatType) && boatType !== '不明') {
                                existing.boatType = boatType;
                            }
                        }
                    }
                }
            });
        }

        state.crews = Array.from(crewMap.values()).sort((a, b) => new Date(b.lastPractice) - new Date(a.lastPractice));

        // playlistUrlをLocalStorageから復元
        const savedPlaylists = DB.load('crews_playlist') || [];
        savedPlaylists.forEach(p => {
            const crew = state.crews.find(c => c.hash === p.hash);
            if (crew && p.playlistUrl) crew.playlistUrl = p.playlistUrl;
        });
    }

    // スケジュールから自動でクルーノートを作成または更新
    function autoCreateCrewNotesFromSchedule(schedule) {
        if (!schedule || schedule.scheduleType !== SCHEDULE_TYPES.BOAT || !schedule.boatId) return;

        let memberIds = [];

        // 1. input-crewIds (タグ選択されたメンバー) があればそれを使用
        // schedule.crewIds は自分以外のIDリストなので、自分(userId)も追加
        if (schedule.crewIds && Array.isArray(schedule.crewIds)) {
            memberIds = [schedule.userId, ...schedule.crewIds];
        }

        // 2. crewIdsがない場合は、スケジュール全体から同じ艇・時間のメンバーを集める (フォールバック)
        if (memberIds.length <= 1) { // 自分しかいない、または空
            const sameCrewSchedules = state.schedules.filter(s =>
                s.date === schedule.date &&
                s.timeSlot === schedule.timeSlot &&
                s.boatId === schedule.boatId &&
                s.scheduleType === SCHEDULE_TYPES.BOAT
            );
            if (sameCrewSchedules.length > 0) {
                memberIds = sameCrewSchedules.map(s => s.userId);
            }
        }

        // 重複除去とソート
        memberIds = [...new Set(memberIds)].sort();

        if (memberIds.length === 0) return;

        // 3. 艇種を取得 (Master Data)
        let boatType = '1x'; // デフォルト
        if (schedule.boatId) {
            // 艇ID指定あり
            const boat = state.boats.find(b => b.id === schedule.boatId);
            // boat.typeプロパティが存在しない場合は名前から推測するか、schedule.boatTypeを使う
            if (boat && boat.type) {
                boatType = boat.type;
            } else if (boat && boat.name) {
                // 艇名から推測
                if (boat.name.includes('8+')) boatType = '8+';
                else if (boat.name.includes('4+')) boatType = '4+';
                else if (boat.name.includes('4x')) boatType = '4x';
                else if (boat.name.includes('2-')) boatType = '2-';
                else if (boat.name.includes('2x')) boatType = '2x';
                else if (boat.name.includes('1x')) boatType = '1x';
            } else if (schedule.boatType) {
                boatType = schedule.boatType;
            }
        } else if (schedule.boatType) {
            // 艇ID指定なし、艇種のみ指定あり
            boatType = schedule.boatType;
        }

        // 4. クルーハッシュ生成
        const hash = generateCrewHash(memberIds, boatType);

        // 5. 既存のノートがあるか確認
        // 同じハッシュ、同じ日付のノートがあるか
        const existingNote = state.crewNotes.find(n => n.crewHash === hash && n.date === schedule.date);

        if (!existingNote) {
            // ノートがない場合、新規作成
            const newNote = {
                id: generateId(),
                crewHash: hash,
                memberIds: memberIds,
                boatType: boatType,
                date: schedule.date,
                content: '', // 空で作成
                videoUrls: [],
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                lastAuthorId: 'system' // システム作成
            };
            state.crewNotes.push(newNote);
            DB.save('crew_notes', state.crewNotes);
            DB.saveCrewNote(newNote); // Supabase同期

            // クルーリストも更新
            extractCrewsFromSchedules();

            showToast('クルーノートを自動作成しました', 'success');
        }
    }


    // クルーハッシュ生成 (メンバーIDをソートして結合)
    function generateCrewHash(memberIds, boatType) {
        const sortedIds = [...memberIds].sort();
        return `${boatType}_${sortedIds.join('_')} `;
    }

    // クルーノート保存
    function saveCrewNote(noteData) {
        const hash = generateCrewHash(noteData.memberIds, noteData.boatType);

        let note = state.crewNotes.find(n => n.crewHash === hash && n.date === noteData.date);

        const now = new Date().toISOString();

        if (note) {
            note.content = noteData.content;
            note.videoUrls = noteData.videoUrls;
            note.updatedAt = now;
            note.lastAuthorId = noteData.authorId;
        } else {
            note = {
                id: generateId(),
                crewHash: hash,
                memberIds: noteData.memberIds,
                boatType: noteData.boatType,
                date: noteData.date,
                content: noteData.content,
                videoUrls: noteData.videoUrls,
                createdAt: now,
                updatedAt: now,
                lastAuthorId: noteData.authorId
            };
            state.crewNotes.push(note);
        }

        DB.save('crew_notes', state.crewNotes);
        DB.saveCrewNote(note); // Supabase同期
        extractCrewsFromSchedules();
        return note;
    }

    // UIロジック: クルーノート

    let isCrewNoteInitialized = false;

    function initCrewNoteFeatures() {
        if (isCrewNoteInitialized) return;

        // タブ切り替えリスナー (My / All)
        document.querySelectorAll('.crew-nav-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.crew-nav-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                const type = btn.dataset.type;
                const searchSection = document.getElementById('crew-search-section');
                if (type === 'all') {
                    searchSection.classList.remove('hidden');
                } else {
                    searchSection.classList.add('hidden');
                }
                renderCrewList();
            });
        });

        // 検索リスナー
        const searchInput = document.getElementById('crew-search-input');
        if (searchInput) searchInput.addEventListener('input', renderCrewList);

        const searchBoat = document.getElementById('crew-search-boat');
        if (searchBoat) searchBoat.addEventListener('change', renderCrewList);

        const searchDate = document.getElementById('crew-search-date');
        if (searchDate) searchDate.addEventListener('change', renderCrewList);

        // FAB (新規作成)
        const fab = document.getElementById('add-crew-note-btn');
        if (fab) {
            fab.addEventListener('click', () => {
                openCrewNoteEdit(null, formatDate(new Date()));
            });
        }

        // モーダル閉じる
        document.getElementById('crew-detail-close')?.addEventListener('click', () => {
            document.getElementById('crew-detail-modal').classList.add('hidden');
        });
        document.getElementById('crew-note-close')?.addEventListener('click', () => {
            document.getElementById('crew-note-modal').classList.add('hidden');
        });

        isCrewNoteInitialized = true;
    }

    // クルーリスト描画
    function renderCrewList() {
        const list = document.getElementById('crew-list');
        const activeBtn = document.querySelector('.crew-nav-btn.active');
        const filterType = activeBtn ? activeBtn.dataset.type : 'my';
        const searchInput = document.getElementById('crew-search-input');
        const searchName = searchInput ? searchInput.value.toLowerCase() : '';
        const searchBoatInput = document.getElementById('crew-search-boat');
        const searchBoat = searchBoatInput ? searchBoatInput.value : 'all';
        const searchDateInput = document.getElementById('crew-search-date');
        const searchDate = searchDateInput ? searchDateInput.value : '';

        let crews = state.crews || [];

        // My Crewsフィルタ (自分が含まれるクルー)
        if (filterType === 'my') {
            crews = crews.filter(c => c.memberIds.includes(state.currentUser.id));
        }

        // 日付フィルタ (その日にノートがあるクルーのみ)
        if (searchDate) {
            const dateHashes = state.crewNotes
                .filter(n => n.date === searchDate)
                .map(n => n.crewHash);

            crews = crews.filter(c => dateHashes.includes(c.hash));
        }

        // 検索フィルタ
        if (searchName) {
            crews = crews.filter(c => {
                const members = c.memberIds.map(id => state.users.find(u => u.id === id)?.name || '').join(' ');
                return members.toLowerCase().includes(searchName);
            });
        }

        // 艇種フィルタ
        if (searchBoat !== 'all') {
            crews = crews.filter(c => c.boatType === searchBoat);
        }

        // 空の状態
        if (crews.length === 0) {
            if (filterType === 'my') {
                list.innerHTML = '<div class="empty-state"><p>まだクルー記録がありません。<br>画面右下の「＋」ボタンから<br>新しいクルーノートを作成してください。</p></div>';
            } else {
                list.innerHTML = '<div class="empty-state"><p>該当するクルーがありません</p></div>';
            }
            return;
        }

        const boatTypeColors = { '1x': '#6366f1', '2x': '#8b5cf6', '2-': '#a855f7', '4x': '#0ea5e9', '4+': '#0284c7', '4-': '#0369a1', '8+': '#dc2626' };

        list.innerHTML = crews.map(crew => {
            const memberNames = crew.memberIds.map(id => {
                const user = state.users.find(u => u.id === id);
                return user ? user.name : '不明';
            });

            // 最終練習日
            const lastDate = new Date(crew.lastPractice);
            const displayDate = `${lastDate.getMonth() + 1}/${lastDate.getDate()}`;
            const dayNames = ['日', '月', '火', '水', '木', '金', '土'];
            const dayOfWeek = dayNames[lastDate.getDay()];

            // ノート件数
            const noteCount = (state.crewNotes || []).filter(n => n.crewHash === crew.hash).length;
            const btColor = boatTypeColors[crew.boatType] || '#6b7280';

            return `<div class="crew-card-enhanced" onclick="openCrewDetail('${crew.hash}')">
            <div class="crew-card-top">
                <span class="crew-boat-badge" style="background:${btColor};">${crew.boatType || '?'}</span>
                <span class="crew-card-date">📅 ${displayDate}（${dayOfWeek}）</span>
            </div>
            <div class="crew-card-members">${memberNames.map(n => `<span class="crew-member-chip">${n}</span>`).join('')}</div>
            <div class="crew-card-footer">
                <span class="crew-note-count">📝 ${noteCount}件</span>
                <span class="crew-card-arrow">→</span>
            </div>
        </div>`;
        }).join('');
    }

    // クルー詳細モーダル
    function openCrewDetail(hash) {
        const crew = state.crews.find(c => c.hash === hash);
        if (!crew) return;

        const modal = document.getElementById('crew-detail-modal');
        const infoCard = document.getElementById('crew-detail-info');
        const historyList = document.getElementById('crew-history-list');
        const addBtn = document.getElementById('add-new-note-btn');

        // クルー情報表示
        const boatTypeColors = { '1x': '#6366f1', '2x': '#8b5cf6', '2-': '#a855f7', '4x': '#0ea5e9', '4+': '#0284c7', '4-': '#0369a1', '8+': '#dc2626' };
        const btColor = boatTypeColors[crew.boatType] || '#6b7280';
        const memberNames = crew.memberIds.map(id => {
            const u = state.users.find(u => u.id === id);
            return u ? u.name : '未登録';
        });

        infoCard.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
            <span class="crew-boat-badge" style="background:${btColor};font-size:14px;padding:4px 12px;">${crew.boatType || '未設定'}</span>
            <span style="font-size:12px;color:var(--text-muted);">${crew.memberIds.length}人</span>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;">
            ${memberNames.map(n => `<span class="crew-member-chip">${n}</span>`).join('')}
        </div>
    `;

        // 履歴リスト生成
        const notes = state.crewNotes.filter(n => n.crewHash === hash);
        const historyItems = notes.sort((a, b) => new Date(b.date) - new Date(a.date));

        historyList.innerHTML = historyItems.length ? historyItems.map(n => {
            const d = formatDisplayDate(n.date);
            const contentPreview = n.content ? n.content.substring(0, 50) + (n.content.length > 50 ? '…' : '') : '';
            return `<div class="history-card" onclick="openCrewNoteEdit('${hash}', '${n.date}')">
            <div class="history-card-header">
                <span class="history-card-date">${d.month}/${d.day}（${d.weekday}）</span>
                <div class="history-card-badges">
                </div>
            </div>
            ${contentPreview ? `<div class="history-card-content">${contentPreview}</div>` : '<div class="history-card-empty">タップして記録を確認</div>'}
        </div>`;
        }).join('') : '<div class="empty-state"><p>ノート履歴がありません</p></div>';

        addBtn.onclick = () => {
            openCrewNoteEdit(hash, formatDate(new Date()));
        };

        // --- YouTube再生リスト管理 ---
        const playlistDisplay = document.getElementById('crew-playlist-display');
        const playlistInputGroup = document.getElementById('crew-playlist-input-group');
        const playlistUrlInput = document.getElementById('crew-playlist-url');
        const playlistLink = document.getElementById('crew-playlist-link');
        const playlistUrlDisplay = document.getElementById('crew-playlist-url-display');
        const savePlaylistBtn = document.getElementById('save-playlist-btn');
        const editPlaylistBtn = document.getElementById('crew-playlist-edit-btn');

        const showPlaylistState = (url) => {
            if (url) {
                playlistDisplay.style.display = 'block';
                playlistInputGroup.style.display = 'none';
                playlistLink.href = url;
                playlistUrlDisplay.textContent = url;
            } else {
                playlistDisplay.style.display = 'none';
                playlistInputGroup.style.display = 'block';
                playlistUrlInput.value = '';
            }
        };

        showPlaylistState(crew.playlistUrl || '');

        savePlaylistBtn.onclick = () => {
            const url = playlistUrlInput.value.trim();
            if (!url) {
                showToast('URLを入力してください', 'error');
                return;
            }
            // crewオブジェクトに保存
            crew.playlistUrl = url;
            // crewNotes内の該当crewHashのノートにもplaylistUrlを付与（同期用）
            DB.save('crews_playlist', state.crews.map(c => ({ hash: c.hash, playlistUrl: c.playlistUrl })).filter(c => c.playlistUrl));
            showPlaylistState(url);
            showToast('再生リストを保存しました', 'success');
        };

        editPlaylistBtn.onclick = () => {
            playlistDisplay.style.display = 'none';
            playlistInputGroup.style.display = 'block';
            playlistUrlInput.value = crew.playlistUrl || '';
            playlistUrlInput.focus();
        };

        modal.classList.remove('hidden');
    }

    /**
     * クルーメンバーの振り返り一覧を描画
     * クルーに属する全メンバーの練習ノート(乗艇)を日付ごとに表示
     */
    function renderCrewMemberReflections(crew) {
        const container = document.getElementById('crew-member-reflections');
        if (!container || !crew) return;

        // このクルーのメンバーIDリスト
        const memberIds = crew.memberIds || [];
        if (memberIds.length === 0) {
            container.innerHTML = '<p class="text-muted">メンバーがいません</p>';
            return;
        }

        // クルーノートの日付リスト（このクルーの練習日）
        const crewNoteDates = (state.crewNotes || [])
            .filter(n => n.crewHash === crew.hash)
            .map(n => n.date)
            .sort((a, b) => b.localeCompare(a));

        // 各日付のクルーノートに加え、メンバーの練習ノートも検索
        // 乗艇スケジュールでこのクルーメンバーが同日に乗っている練習を探す
        const allDates = new Set(crewNoteDates);

        // 乗艇スケジュールから関連日付を追加
        (state.schedules || []).forEach(s => {
            if (s.scheduleType === '乗艇' && memberIds.includes(s.userId)) {
                allDates.add(s.date);
            }
        });

        const sortedDates = [...allDates].sort((a, b) => b.localeCompare(a)).slice(0, 10); // 直近10日分

        if (sortedDates.length === 0) {
            container.innerHTML = '<p class="text-muted">まだ練習記録がありません</p>';
            return;
        }

        let html = '';
        sortedDates.forEach(date => {
            const display = formatDisplayDate(date);
            let weekdayClass = '';
            if (display.dayOfWeek === 0) weekdayClass = 'sunday';
            if (display.dayOfWeek === 6) weekdayClass = 'saturday';

            // この日の各メンバーの練習ノートを取得
            let memberNotesHtml = '';
            let hasAnyContent = false;

            memberIds.forEach(uid => {
                const user = state.users.find(u => u.id === uid);
                const userName = user ? user.name : '不明';

                // この日・このユーザーの練習ノート（乗艇）を検索
                const notes = (state.practiceNotes || []).filter(n =>
                    n.userId === uid && n.date === date &&
                    (n.scheduleType === '乗艇' || !n.scheduleType) // 乗艇または未設定
                );

                const reflection = notes.map(n => n.reflection).filter(r => r && r.trim()).join(' / ');
                const distance = notes.reduce((sum, n) => sum + (n.rowingDistance || 0), 0);
                const distanceText = distance > 0 ? `${(distance / 1000).toFixed(1)}km` : '';

                if (reflection || distance > 0) hasAnyContent = true;

                const reflectionDisplay = reflection
                    ? `<span class="member-reflection-text">${reflection.substring(0, 80)}${reflection.length > 80 ? '…' : ''}</span>`
                    : '<span class="member-reflection-empty">未記入</span>';

                memberNotesHtml += `
                <div class="member-reflection-row">
                    <span class="member-reflection-name">${userName}</span>
                    <div class="member-reflection-content">
                        ${reflectionDisplay}
                        ${distanceText ? `<span class="member-reflection-distance">${distanceText}</span>` : ''}
                    </div>
                </div>
            `;
            });

            html += `
            <div class="reflection-date-group">
                <div class="reflection-date-header">${display.month}/${display.day} <span class="weekday ${weekdayClass}">(${display.weekday})</span></div>
                ${memberNotesHtml}
            </div>
        `;
        });

        container.innerHTML = html;
    }

    // ノート編集モーダル (hashがnullの場合は新規作成)
    function openCrewNoteEdit(hash, date) {
        const modal = document.getElementById('crew-note-modal');
        const dateInput = document.getElementById('crew-note-date');
        const contentInput = document.getElementById('crew-note-content');
        const memberSelectGroup = document.getElementById('crew-member-select-group');
        const boatSelectGroup = document.getElementById('crew-boat-select-group');

        let note = null;
        let memberIds = [];
        let boatType = '1x';

        if (hash) {
            // 既存クルーのノート（編集または新規日付）
            memberSelectGroup.classList.add('hidden');
            if (boatSelectGroup) boatSelectGroup.classList.add('hidden');

            note = state.crewNotes.find(n => n.crewHash === hash && n.date === date);
            const crew = state.crews.find(c => c.hash === hash);
            memberIds = crew.memberIds;
            boatType = crew.boatType;
        } else {
            // 全く新しいクルーでの作成
            memberSelectGroup.classList.remove('hidden');
            if (boatSelectGroup) boatSelectGroup.classList.remove('hidden');

            // メンバー選択リスト生成
            renderMemberSelect();
            memberIds = []; // 選択されたものが入る
        }

        dateInput.value = date;
        contentInput.value = note?.content || '';

        // 保存処理
        document.getElementById('save-crew-note-btn').onclick = () => {
            const newDate = dateInput.value;
            const newContent = contentInput.value;

            if (!newDate) {
                showToast('日付を入力してください', 'error');
                return;
            }

            if (!hash) {
                // 新規クルー作成時はフォームからメンバーと艇種を取得
                const selectedMembers = Array.from(document.querySelectorAll('.crew-member-checkbox:checked')).map(cb => cb.value);
                const selectedBoat = document.getElementById('crew-note-boat-type').value;

                if (selectedMembers.length === 0) {
                    showToast('メンバーを選択してください', 'error');
                    return;
                }
                memberIds = selectedMembers;
                boatType = selectedBoat;
            }

            // 既存の場合は hash, memberIds, boatType は設定済み

            saveCrewNote({
                date: newDate,
                memberIds: memberIds,
                boatType: boatType,
                content: newContent,
                videoUrls: [], // 動画はクルー単位の再生リストに移行
                authorId: state.currentUser.id
            });

            // 自分の振り返りを練習ノートにも保存
            const myReflectionEl = document.getElementById('crew-my-reflection');
            if (myReflectionEl) {
                const myReflection = myReflectionEl.value || '';
                if (myPracticeNoteForCrew) {
                    // 既存の練習ノートを更新
                    myPracticeNoteForCrew.reflection = myReflection;
                    myPracticeNoteForCrew.updatedAt = new Date().toISOString();
                } else if (myReflection.trim()) {
                    // 練習ノートがなければ新規作成
                    const newNote = {
                        id: generateId(),
                        scheduleId: null,
                        userId: state.currentUser.id,
                        date: newDate,
                        timeSlot: '',
                        scheduleType: '乗艇',
                        reflection: myReflection,
                        ergoRecordIds: [],
                        crewNoteId: null,
                        createdAt: new Date().toISOString(),
                        updatedAt: new Date().toISOString()
                    };
                    state.practiceNotes.push(newNote);
                }
                DB.save('practice_notes', state.practiceNotes);
            }

            modal.classList.add('hidden');

            if (hash) {
                openCrewDetail(hash); // 詳細画面更新
            } else {
                renderCrewList(); // リスト更新
            }
            showToast('保存しました', 'success');
        };

        // メンバーの振り返りを描画（既存クルーの場合のみ）
        const reflectionsContainer = document.getElementById('crew-note-member-reflections');
        const reflectionsGroup = document.getElementById('crew-note-member-reflections-group');
        let myPracticeNoteForCrew = null; // 保存時に使う参照
        if (reflectionsContainer && memberIds.length > 0 && date) {
            reflectionsGroup.classList.remove('hidden');
            let refHtml = '';
            memberIds.forEach(uid => {
                const user = state.users.find(u => u.id === uid);
                const userName = user ? user.name : '不明';
                const isMe = uid === state.currentUser.id;

                // この日・このユーザーの練習ノート（乗艇）を検索
                const notes = (state.practiceNotes || []).filter(n =>
                    n.userId === uid && n.date === date &&
                    (n.scheduleType === '乗艇' || !n.scheduleType)
                );

                const reflection = notes.map(n => n.reflection).filter(r => r && r.trim()).join(' / ');
                const distance = notes.reduce((sum, n) => sum + (n.rowingDistance || 0), 0);
                const distanceText = distance > 0 ? `${(distance / 1000).toFixed(1)}km` : '';

                if (isMe) {
                    // 自分の振り返り: 編集可能なtextarea
                    myPracticeNoteForCrew = notes.length > 0 ? notes[0] : null;
                    refHtml += `
                    <div class="member-reflection-row member-reflection-me">
                        <span class="member-reflection-name" style="color:#10b981;">✏️ ${userName}</span>
                        <div class="member-reflection-content">
                            <textarea id="crew-my-reflection" rows="3" placeholder="自分の振り返りを書く..."
                                style="width:100%;font-size:13px;border:1px solid #d1d5db;border-radius:6px;padding:6px 8px;resize:vertical;">${reflection || ''}</textarea>
                            ${distanceText ? `<span class="member-reflection-distance">${distanceText}</span>` : ''}
                        </div>
                    </div>
                `;
                } else {
                    // 他メンバー: 読み取り専用
                    const reflectionDisplay = reflection
                        ? `<span class="member-reflection-text">${reflection}</span>`
                        : '<span class="member-reflection-empty">未記入</span>';

                    refHtml += `
                    <div class="member-reflection-row">
                        <span class="member-reflection-name">${userName}</span>
                        <div class="member-reflection-content">
                            ${reflectionDisplay}
                            ${distanceText ? `<span class="member-reflection-distance">${distanceText}</span>` : ''}
                        </div>
                    </div>
                `;
                }
            });
            reflectionsContainer.innerHTML = refHtml || '<p class="text-muted">メンバーの練習ノートがありません</p>';
        } else if (reflectionsGroup) {
            reflectionsGroup.classList.add('hidden');
        }

        modal.classList.remove('hidden');
    }

    function renderMemberSelect() {
        const list = document.getElementById('crew-member-select-list');
        if (!list) return;

        // 自分のIDを含めるかどうか？ -> 含めるべき。自分＋他
        const users = state.users.filter(u => u.approvalStatus === '承認済み');

        list.innerHTML = users.map(u => `
        <label class="checkbox-item" style="display:block; margin-bottom:4px;">
            <input type="checkbox" class="crew-member-checkbox" value="${u.id}" ${u.id === state.currentUser.id ? 'checked' : ''}>
            ${u.name}
        </label>
    `).join('');
    }

    function updateVideoPreview(url) {
        const preview = document.getElementById('video-preview');
        if (!url) {
            preview.classList.add('hidden');
            preview.innerHTML = '';
            return;
        }

        let videoId = null;
        if (url.includes('youtube.com/watch?v=')) {
            videoId = url.split('v=')[1]?.split('&')[0];
        } else if (url.includes('youtu.be/')) {
            videoId = url.split('youtu.be/')[1];
        }

        if (videoId) {
            preview.classList.remove('hidden');
            preview.innerHTML = `<iframe src="https://www.youtube.com/embed/${videoId}" allowfullscreen></iframe>`;
        } else {
            preview.classList.add('hidden');
        }
    }


    // =========================================
    // IDT計算機
    // =========================================
    function openIDTModal() {
        const modal = document.getElementById('idt-calculator-modal');
        modal.classList.remove('hidden');

        // 保存済み体重を自動入力
        const savedWeight = state.currentUser?.weight;
        const weightInput = document.getElementById('idt-weight');
        if (weightInput && savedWeight) {
            weightInput.value = savedWeight;
        }

        // 性別トグルの初期化
        const userGender = state.currentUser?.gender || 'man';
        const toggleGroup = document.getElementById('idt-gender-toggle');
        const btns = toggleGroup.querySelectorAll('.gender-btn');

        // UI初期状態設定
        btns.forEach(btn => {
            if (btn.dataset.gender === userGender) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });

        // イベントリスナー設定（重複防止のため、すでに設定済みかチェックするか、
        // 毎回置き換える。ここではシンプルに毎回設定するが、removeEventListenerしないと
        // 累積する可能性がある。initInputEventsでやるべきだが、後付けなのでここで簡易実装）
        // クリーンな方法はonclick属性を使うか、ここでonclicプロパティに代入すること
        btns.forEach(btn => {
            btn.onclick = (e) => {
                btns.forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                // 計算結果が出ていれば再計算
                if (document.getElementById('idt-result-box').style.display === 'block') {
                    calculateIDT();
                }
            };
        });
    }

    function closeIDTModal() {
        document.getElementById('idt-calculator-modal').classList.add('hidden');
        document.getElementById('idt-weight').value = '';
        document.getElementById('idt-result-box').style.display = 'none';
    }

    function calculateIDT() {
        const weightInput = document.getElementById('idt-weight').value;
        const weight = parseFloat(weightInput);

        if (!weight || weight <= 0) {
            return;
        }

        const genderBtn = document.querySelector('#idt-gender-toggle .gender-btn.active');
        const gender = genderBtn?.dataset.gender || 'man';

        // IDT100のタイム（秒）
        const idt100Seconds = calculateIDTSeconds(weight, gender);

        // IDT75~95のタイムを計算（IDT = idt100 / actual * 100 → actual = idt100 * 100 / idt）
        const idtLevels = [75, 80, 85, 90, 95, 100];
        let tableRows = '';
        idtLevels.forEach(idt => {
            const actualSeconds = idt100Seconds * 100 / idt;
            const formattedTime = formatTime(actualSeconds);
            const splitSeconds = actualSeconds / 4;
            const formattedSplit = formatTime(splitSeconds);
            const highlight = idt === 100 ? ' style="background:var(--accent-color);color:#fff;font-weight:700;"' : '';
            tableRows += `<tr${highlight}>
            <td style="padding:6px 10px;text-align:center;font-weight:600;">IDT ${idt}</td>
            <td style="padding:6px 10px;text-align:center;">${formattedTime}</td>
            <td style="padding:6px 10px;text-align:center;color:var(--text-muted);">${formattedSplit}</td>
        </tr>`;
        });

        const container = document.getElementById('idt-table-container');
        container.innerHTML = `
        <div style="font-size:13px;color:var(--text-muted);margin-bottom:8px;">体重 ${weight}kg（${gender === 'man' ? '男子' : '女子'}）</div>
        <table style="width:100%;border-collapse:collapse;border-radius:8px;overflow:hidden;font-size:14px;">
            <thead>
                <tr style="background:var(--bg-light);border-bottom:2px solid var(--border-color);">
                    <th style="padding:8px 10px;text-align:center;">IDT</th>
                    <th style="padding:8px 10px;text-align:center;">2000m タイム</th>
                    <th style="padding:8px 10px;text-align:center;">500m ペース</th>
                </tr>
            </thead>
            <tbody>${tableRows}</tbody>
        </table>
    `;

        const resultBox = document.getElementById('idt-result-box');
        resultBox.style.display = 'block';
    }

    // =========================================
    // IDT計算ヘルパー関数（共用）
    // =========================================
    // 体重と性別からIDT目標タイム（秒）を算出
    function calculateIDTSeconds(weight, gender) {
        if (!weight || weight <= 0) return null;
        if (gender === 'man') {
            return 335.8 * Math.pow(98.0 / weight, 2.0 / 9.0);
        } else {
            return 384.4 * Math.pow(81.0 / weight, 0.2455);
        }
    }

    // 実際のタイムとIDT目標タイムからIDT達成率(%)を算出
    function calculateIDTPercent(actualSeconds, idtSeconds) {
        if (!actualSeconds || !idtSeconds || actualSeconds <= 0 || idtSeconds <= 0) return null;
        return (idtSeconds / actualSeconds) * 100;
    }

    // IDTバッジHTML生成（ランキング用）
    function renderIDTBadge(weight, gender, actualSeconds) {
        if (!weight || !actualSeconds) return '';
        const idtSeconds = calculateIDTSeconds(weight, gender);
        if (!idtSeconds) return '';
        const idtValue = calculateIDTPercent(actualSeconds, idtSeconds);
        if (!idtValue) return '';
        let cls = 'idt-low';
        if (idtValue >= 100) cls = 'idt-high';
        else if (idtValue >= 95) cls = 'idt-mid';
        return `<span class="idt-badge ${cls}">IDT ${idtValue.toFixed(1)}</span>`;
    }

    // =========================================
    // データエクスポート（CSV）
    // =========================================

    function getExportDateRange() {
        const from = document.getElementById('export-date-from')?.value || '';
        const to = document.getElementById('export-date-to')?.value || '';
        return { from, to };
    }

    function filterByDateRange(items, dateField) {
        const { from, to } = getExportDateRange();
        return items.filter(item => {
            const d = item[dateField];
            if (!d) return true;
            if (from && d < from) return false;
            if (to && d > to) return false;
            return true;
        });
    }

    function getUserName(userId) {
        const u = (state.users || []).find(u => u.id === userId);
        return u ? u.name : userId || '不明';
    }

    function downloadCSV(filename, headers, rows) {
        const bom = '\uFEFF'; // UTF-8 BOM for Excel
        const escape = (v) => {
            const s = String(v == null ? '' : v);
            return s.includes(',') || s.includes('"') || s.includes('\n')
                ? '"' + s.replace(/"/g, '""') + '"'
                : s;
        };
        const csv = bom + headers.map(escape).join(',') + '\n'
            + rows.map(r => r.map(escape).join(',')).join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = filename;
        link.click();
        URL.revokeObjectURL(link.href);
    }

    // 1. スケジュール CSV
    function exportSchedulesCSV() {
        const all = state.schedules || [];
        const filtered = filterByDateRange(all, 'date');
        if (filtered.length === 0) {
            showToast('該当するスケジュールがありません', 'info');
            return;
        }

        const boatName = (id) => {
            const b = (state.boats || []).find(b => b.id === id);
            return b ? b.name : '';
        };

        const headers = ['日付', '時間帯', '氏名', '種目', '艇種', '船名', 'クルーメンバー', '欠席理由', 'メモ'];
        const rows = filtered
            .sort((a, b) => (a.date + a.timeSlot).localeCompare(b.date + b.timeSlot))
            .map(s => {
                const crewNames = (s.crewIds || []).map(getUserName).join(' / ');
                return [
                    s.date,
                    s.timeSlot || '',
                    getUserName(s.userId),
                    s.scheduleType || '',
                    s.boatType || '',
                    boatName(s.boatId),
                    crewNames,
                    s.absenceReason || '',
                    s.memo || ''
                ];
            });

        downloadCSV(`schedules_${formatDate(new Date())}.csv`, headers, rows);
        showToast(`${rows.length}件のスケジュールをCSV出力しました`, 'success');
        const countEl = document.getElementById('export-schedule-count');
        if (countEl) countEl.textContent = `✅ ${rows.length}件出力済み`;
    }

    // 2. エルゴ記録 CSV
    function exportErgoCSV() {
        const all = state.ergoRecords || [];
        const filtered = filterByDateRange(all, 'date');
        if (filtered.length === 0) {
            showToast('該当するエルゴ記録がありません', 'info');
            return;
        }

        const headers = ['日付', '氏名', 'カテゴリ', 'メニュー', 'タイム', '距離(m)', '平均ペース(/500m)', '平均心拍', 'メモ'];
        const rows = filtered
            .sort((a, b) => (a.date || '').localeCompare(b.date || ''))
            .map(r => {
                return [
                    r.date || '',
                    getUserName(r.userId),
                    r.category || r.workoutType || '',
                    r.menuKey || '',
                    r.time || r.formattedTime || '',
                    r.distance || '',
                    r.avgPace || '',
                    r.avgHeartRate || '',
                    r.memo || ''
                ];
            });

        downloadCSV(`ergo_${formatDate(new Date())}.csv`, headers, rows);
        showToast(`${rows.length}件のエルゴ記録をCSV出力しました`, 'success');
        const countEl = document.getElementById('export-ergo-count');
        if (countEl) countEl.textContent = `✅ ${rows.length}件出力済み`;
    }

    // 3. 体重記録 CSV
    function exportWeightCSV() {
        const allUsers = state.users || [];
        const rows = [];

        allUsers.forEach(u => {
            const history = u.weightHistory || [];
            history.forEach(w => {
                rows.push([
                    w.date || '',
                    u.name || '',
                    w.weight || '',
                    u.gender || '',
                    u.grade || ''
                ]);
            });
        });

        const filtered = filterByDateRange(
            rows.map(r => ({ date: r[0], row: r })),
            'date'
        ).map(item => item.row);

        if (filtered.length === 0) {
            showToast('該当する体重記録がありません', 'info');
            return;
        }

        const headers = ['日付', '氏名', '体重(kg)', '性別', '学年'];
        downloadCSV(`weight_${formatDate(new Date())}.csv`, headers, filtered);
        showToast(`${filtered.length}件の体重記録をCSV出力しました`, 'success');
        const countEl = document.getElementById('export-weight-count');
        if (countEl) countEl.textContent = `✅ ${filtered.length}件出力済み`;
    }

    // 4. 設備一覧 CSV
    function exportEquipmentCSV() {
        const boats = state.boats || [];
        const oars = state.oars || [];

        const headers = ['種別', '名前', '艇種/タイプ', '所属', '状態', 'メモ'];
        const rows = [];

        boats.forEach(b => {
            rows.push([
                '船',
                b.name || '',
                b.type || '',
                b.organization || '',
                translateStatus(b.status || (b.availability === '使用不可' ? 'broken' : 'available')),
                b.memo || b.notes || ''
            ]);
        });

        oars.forEach(o => {
            rows.push([
                'オール',
                o.name || '',
                o.type || '',
                o.organization || '',
                translateStatus(o.status || (o.availability === '使用不可' ? 'broken' : 'available')),
                o.memo || o.notes || ''
            ]);
        });

        if (rows.length === 0) {
            showToast('設備データがありません', 'info');
            return;
        }

        downloadCSV(`equipment_${formatDate(new Date())}.csv`, headers, rows);
        showToast(`${rows.length}件の設備データをCSV出力しました`, 'success');
    }

    // 5. メンバー一覧 CSV
    function exportMembersCSV() {
        const users = (state.users || []).filter(u => u.approvalStatus === '承認済み');
        if (users.length === 0) {
            showToast('メンバーデータがありません', 'info');
            return;
        }

        const headers = ['氏名', '学年', 'ロール', '性別', '体重(最新)', '所属'];
        const rows = users
            .sort((a, b) => (a.grade || 0) - (b.grade || 0) || (a.name || '').localeCompare(b.name || ''))
            .map(u => {
                const latestWeight = u.weightHistory && u.weightHistory.length > 0
                    ? u.weightHistory[u.weightHistory.length - 1].weight
                    : '';
                return [
                    u.name || '',
                    u.grade || '',
                    u.role || '',
                    u.gender || '',
                    latestWeight,
                    u.organization || ''
                ];
            });

        downloadCSV(`members_${formatDate(new Date())}.csv`, headers, rows);
        showToast(`${rows.length}名のメンバーをCSV出力しました`, 'success');
    }

    // =========================================
    // 個人レポート
    // =========================================

    function populateExportMemberSelect() {
        const sel = document.getElementById('export-member-select');
        if (!sel) return;
        const current = sel.value;
        sel.innerHTML = '<option value="">-- 選択してください --</option>';
        const users = (state.users || []).filter(u => u.approvalStatus === '承認済み');
        users.sort((a, b) => (a.grade || 0) - (b.grade || 0) || (a.name || '').localeCompare(b.name || ''));
        users.forEach(u => {
            const opt = document.createElement('option');
            opt.value = u.id;
            opt.textContent = `${u.name}（${u.grade || '?'}年・${u.role || ''}）`;
            sel.appendChild(opt);
        });
        if (current) sel.value = current;
    }

    function getSelectedExportUser() {
        const sel = document.getElementById('export-member-select');
        const uid = sel?.value;
        if (!uid) { showToast('メンバーを選択してください', 'info'); return null; }
        const user = (state.users || []).find(u => u.id === uid);
        if (!user) { showToast('メンバーが見つかりません', 'error'); return null; }
        return user;
    }

    function onExportMemberChange() {
        const sel = document.getElementById('export-member-select');
        const preview = document.getElementById('personal-report-preview');
        const summary = document.getElementById('personal-report-summary');
        const uid = sel?.value;

        if (!uid) {
            if (preview) preview.style.display = 'none';
            return;
        }

        const user = (state.users || []).find(u => u.id === uid);
        if (!user) return;

        // データ集計
        const ergoCount = (state.ergoRecords || []).filter(r => r.userId === uid).length;
        const scheduleCount = (state.schedules || []).filter(s => s.userId === uid).length;
        const weightCount = (user.weightHistory || []).length;
        const latestWeight = weightCount > 0 ? user.weightHistory[weightCount - 1] : null;

        // エルゴベスト（2000mがあれば表示）
        const ergo2k = (state.ergoRecords || []).filter(r =>
            r.userId === uid && (r.menuKey === '2000m' || r.distance == 2000)
        );
        let best2k = '';
        if (ergo2k.length > 0) {
            const sorted = ergo2k.sort((a, b) => {
                const ta = a.time || a.formattedTime || '99:99';
                const tb = b.time || b.formattedTime || '99:99';
                return ta.localeCompare(tb);
            });
            best2k = sorted[0].time || sorted[0].formattedTime || '';
        }

        summary.innerHTML = `
        <div style="font-weight:700;font-size:16px;margin-bottom:8px;">${user.name}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
            <div style="background:var(--bg-light);padding:8px 10px;border-radius:8px;text-align:center;">
                <div style="font-size:20px;font-weight:700;color:var(--accent-color);">${ergoCount}</div>
                <div style="font-size:11px;color:var(--text-muted);">エルゴ記録</div>
            </div>
            <div style="background:var(--bg-light);padding:8px 10px;border-radius:8px;text-align:center;">
                <div style="font-size:20px;font-weight:700;color:#f59e0b;">${scheduleCount}</div>
                <div style="font-size:11px;color:var(--text-muted);">練習予定</div>
            </div>
            <div style="background:var(--bg-light);padding:8px 10px;border-radius:8px;text-align:center;">
                <div style="font-size:20px;font-weight:700;color:#10b981;">${latestWeight ? latestWeight.weight + 'kg' : '-'}</div>
                <div style="font-size:11px;color:var(--text-muted);">最新体重${latestWeight ? ' (' + latestWeight.date + ')' : ''}</div>
            </div>
            <div style="background:var(--bg-light);padding:8px 10px;border-radius:8px;text-align:center;">
                <div style="font-size:20px;font-weight:700;color:#8b5cf6;">${best2k || '-'}</div>
                <div style="font-size:11px;color:var(--text-muted);">2000m ベスト</div>
            </div>
        </div>
    `;

        if (preview) preview.style.display = 'block';
    }

    // カテゴリの日本語表示
    function getCategoryLabel(cat) {
        const map = { 'distance': '距離', 'time': 'タイム', 'interval': 'インターバル' };
        return map[cat] || cat || '不明';
    }

    // エルゴ記録をメニュー別にグループ化するヘルパー
    function groupErgoByMenu(records) {
        const catOrder = ['distance', 'time', 'interval'];
        const groups = {};
        records.forEach(r => {
            const cat = r.category || r.workoutType || 'other';
            const menu = r.menuKey || '不明';
            const key = `${cat}|||${menu}`;
            if (!groups[key]) groups[key] = { cat, menu, records: [] };
            groups[key].records.push(r);
        });
        // カテゴリ順 → メニュー名順にソート
        return Object.values(groups).sort((a, b) => {
            const ai = catOrder.indexOf(a.cat); const bi = catOrder.indexOf(b.cat);
            if (ai !== bi) return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
            return (a.menu || '').localeCompare(b.menu || '');
        });
    }

    // 個人エルゴCSV（メニュー別セクション形式）
    function exportPersonalErgoCSV() {
        const user = getSelectedExportUser();
        if (!user) return;
        const all = (state.ergoRecords || []).filter(r => r.userId === user.id);
        const filtered = filterByDateRange(all, 'date');
        if (filtered.length === 0) {
            showToast(`${user.name}のエルゴ記録がありません`, 'info');
            return;
        }

        const bom = '\uFEFF';
        const escape = (v) => {
            const s = String(v == null ? '' : v);
            return s.includes(',') || s.includes('"') || s.includes('\n')
                ? '"' + s.replace(/"/g, '""') + '"' : s;
        };
        const toLine = (arr) => arr.map(escape).join(',');

        const lines = [];
        lines.push(`${user.name} エルゴ記録（${formatDate(new Date())}）`);
        lines.push(`学年: ${user.grade || '-'}年 / 性別: ${user.gender || '-'}`);
        lines.push('');

        const groups = groupErgoByMenu(filtered);
        let totalCount = 0;

        groups.forEach(g => {
            const sorted = g.records.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
            // ベストタイムを特定
            let bestTime = null;
            sorted.forEach(r => {
                const t = r.time || r.formattedTime || '';
                if (t && (!bestTime || t < bestTime)) bestTime = t;
            });

            lines.push(`【${getCategoryLabel(g.cat)}】${g.menu}（${sorted.length}件）`);
            lines.push(toLine(['日付', 'タイム', '距離(m)', '平均ペース(/500m)', '平均心拍', 'メモ', 'ベスト']));
            sorted.forEach(r => {
                const t = r.time || r.formattedTime || '';
                const isBest = t && t === bestTime ? '★' : '';
                lines.push(toLine([
                    r.date || '', t, r.distance || '',
                    r.avgPace || '', r.avgHeartRate || '',
                    r.memo || '', isBest
                ]));
            });
            if (bestTime) lines.push(`ベスト: ${bestTime}`);
            lines.push('');
            totalCount += sorted.length;
        });

        lines.push(`全${groups.length}メニュー / 合計${totalCount}件`);

        const csv = bom + lines.join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `${user.name}_エルゴ_${formatDate(new Date())}.csv`;
        link.click();
        URL.revokeObjectURL(link.href);
        showToast(`${user.name}のエルゴ記録${totalCount}件を${groups.length}メニュー別に出力しました`, 'success');
    }

    // 個人体重CSV
    function exportPersonalWeightCSV() {
        const user = getSelectedExportUser();
        if (!user) return;
        const history = user.weightHistory || [];
        if (history.length === 0) {
            showToast(`${user.name}の体重記録がありません`, 'info');
            return;
        }

        const items = history.map(w => ({ date: w.date, row: [w.date || '', w.weight || ''] }));
        const filtered = filterByDateRange(items, 'date').map(i => i.row);
        if (filtered.length === 0) {
            showToast(`該当期間の体重記録がありません`, 'info');
            return;
        }

        const headers = ['日付', '体重(kg)'];
        downloadCSV(`${user.name}_体重_${formatDate(new Date())}.csv`, headers, filtered);
        showToast(`${user.name}の体重記録${filtered.length}件を出力しました`, 'success');
    }

    // 個人スケジュールCSV
    function exportPersonalScheduleCSV() {
        const user = getSelectedExportUser();
        if (!user) return;
        const all = (state.schedules || []).filter(s => s.userId === user.id);
        const filtered = filterByDateRange(all, 'date');
        if (filtered.length === 0) {
            showToast(`${user.name}の練習履歴がありません`, 'info');
            return;
        }

        const boatName = (id) => {
            const b = (state.boats || []).find(b => b.id === id);
            return b ? b.name : '';
        };

        const headers = ['日付', '時間帯', '種目', '艇種', '船名', 'クルーメンバー', 'メモ'];
        const rows = filtered
            .sort((a, b) => (a.date || '').localeCompare(b.date || ''))
            .map(s => [
                s.date,
                s.timeSlot || '',
                s.scheduleType || '',
                s.boatType || '',
                boatName(s.boatId),
                (s.crewIds || []).map(getUserName).join(' / '),
                s.memo || ''
            ]);

        downloadCSV(`${user.name}_練習_${formatDate(new Date())}.csv`, headers, rows);
        showToast(`${user.name}の練習履歴${rows.length}件を出力しました`, 'success');
    }

    // 個人全データCSV（1ファイルに複数セクション）
    function exportPersonalAllCSV() {
        const user = getSelectedExportUser();
        if (!user) return;

        const bom = '\uFEFF';
        const escape = (v) => {
            const s = String(v == null ? '' : v);
            return s.includes(',') || s.includes('"') || s.includes('\n')
                ? '"' + s.replace(/"/g, '""') + '"'
                : s;
        };
        const toLine = (arr) => arr.map(escape).join(',');

        let lines = [];
        lines.push(`${user.name} 個人レポート（${formatDate(new Date())}）`);
        lines.push(`学年: ${user.grade || '-'}年 / 性別: ${user.gender || '-'} / ロール: ${user.role || '-'}`);
        lines.push('');

        // エルゴ（メニュー別）
        const ergo = filterByDateRange(
            (state.ergoRecords || []).filter(r => r.userId === user.id), 'date'
        );
        const ergoGroups = groupErgoByMenu(ergo);
        lines.push('=== エルゴ記録（メニュー別） ===');
        ergoGroups.forEach(g => {
            const sorted = g.records.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
            let bestTime = null;
            sorted.forEach(r => {
                const t = r.time || r.formattedTime || '';
                if (t && (!bestTime || t < bestTime)) bestTime = t;
            });
            lines.push(`--- ${getCategoryLabel(g.cat)} / ${g.menu}（${sorted.length}件）---`);
            lines.push(toLine(['日付', 'タイム', '距離(m)', '平均ペース', '平均心拍', 'ベスト']));
            sorted.forEach(r => {
                const t = r.time || r.formattedTime || '';
                lines.push(toLine([
                    r.date || '', t, r.distance || '',
                    r.avgPace || '', r.avgHeartRate || '',
                    t && t === bestTime ? '★' : ''
                ]));
            });
            if (bestTime) lines.push(`ベスト: ${bestTime}`);
            lines.push('');
        });
        lines.push(`エルゴ合計: ${ergo.length}件 / ${ergoGroups.length}メニュー`);
        lines.push('');

        // 体重
        const weight = user.weightHistory || [];
        const wFiltered = filterByDateRange(
            weight.map(w => ({ date: w.date, w })), 'date'
        ).map(i => i.w);
        lines.push('=== 体重記録 ===');
        lines.push(toLine(['日付', '体重(kg)']));
        wFiltered.forEach(w => { lines.push(toLine([w.date || '', w.weight || ''])); });
        lines.push(`合計: ${wFiltered.length}件`);
        lines.push('');

        // スケジュール
        const sched = filterByDateRange(
            (state.schedules || []).filter(s => s.userId === user.id), 'date'
        ).sort((a, b) => (a.date || '').localeCompare(b.date || ''));
        const boatName = (id) => { const b = (state.boats || []).find(b => b.id === id); return b ? b.name : ''; };
        lines.push('=== 練習履歴 ===');
        lines.push(toLine(['日付', '時間帯', '種目', '艇種', '船名', 'メモ']));
        sched.forEach(s => {
            lines.push(toLine([
                s.date, s.timeSlot || '', s.scheduleType || '',
                s.boatType || '', boatName(s.boatId), s.memo || ''
            ]));
        });
        lines.push(`合計: ${sched.length}件`);

        const csv = bom + lines.join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `${user.name}_全データ_${formatDate(new Date())}.csv`;
        link.click();
        URL.revokeObjectURL(link.href);
        showToast(`${user.name}の全データを出力しました`, 'success');
    }

    // 全員エルゴ一括CSV（メンバー名で列を分けて推移比較しやすく）
    function exportAllMembersErgoCSV() {
        const records = state.ergoRecords || [];
        const filtered = filterByDateRange(records, 'date');
        if (filtered.length === 0) {
            showToast('エルゴ記録がありません', 'info');
            return;
        }

        const headers = ['日付', '氏名', '学年', 'カテゴリ', 'メニュー', 'タイム', '距離(m)', '平均ペース(/500m)', '平均心拍'];
        // メンバー別にソート
        const rows = filtered
            .sort((a, b) => {
                const nameA = getUserName(a.userId);
                const nameB = getUserName(b.userId);
                if (nameA !== nameB) return nameA.localeCompare(nameB);
                return (a.date || '').localeCompare(b.date || '');
            })
            .map(r => {
                const u = (state.users || []).find(u => u.id === r.userId);
                return [
                    r.date || '',
                    getUserName(r.userId),
                    u?.grade || '',
                    r.category || r.workoutType || '',
                    r.menuKey || '',
                    r.time || r.formattedTime || '',
                    r.distance || '',
                    r.avgPace || '',
                    r.avgHeartRate || ''
                ];
            });

        downloadCSV(`全員エルゴ_${formatDate(new Date())}.csv`, headers, rows);
        showToast(`${rows.length}件のエルゴ記録を出力しました（メンバー別ソート）`, 'success');
    }
