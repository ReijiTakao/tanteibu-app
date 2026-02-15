document.title = 'APP STARTED';
console.log('APP JS START');

// APIプロキシURL（ローカルfile://では絶対URL、Vercelでは相対パス）
const API_BASE = window.location.protocol === 'file:'
    ? 'https://tanteibu-app.vercel.app'
    : '';

/**
 * 端艇部 総合管理アプリ - メインロジック v2
 */

// =========================================
// 定数・設定
// =========================================
const ROLES = {
    ADMIN: '管理者',
    EXECUTIVE: '幹部',
    COACH: 'コーチ',
    COX: 'Cox',
    MEMBER: '部員',
    MANAGER: 'マネージャー'
};

const SCHEDULE_TYPES = {
    ERGO: 'エルゴ',
    BOAT: '乗艇',
    WEIGHT: 'ウェイト',
    ABSENT: '参加不可',
    MEAL: '炊事',
    VIDEO: 'ビデオ',
    BANCHA: '伴チャ'
};

const ABSENCE_REASONS = ['体調不良', '怪我', '就活', '学校'];
const ERGO_TYPES = ['ダイナミック', '固定'];
const MEAL_TYPES = ['朝', '昼', '晩'];
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

// Concept2 API設定
// （メイン定義は後述）

// =========================================
// Google認証 ハンドラー
// =========================================
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
        if (statusEl) statusEl.textContent = '登録完了！確認メールをチェックしてください (設定によっては自動ログイン)';
        showToast('登録完了！', 'success');
        // 自動ログインできている場合と、メール確認待ちの場合がある
        if (data.session) {
            // セッションあり -> 自動的にログイン扱いになる
        } else {
            // セッションなし -> メール確認待ち
            alert('確認メールを送信しました。メール内のリンクをクリックして登録を完了してください。');
        }
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
            role: profile.role || '部員',
            status: profile.status || '在籍',
            approvalStatus: profile.approval_status || '承認済み',
            concept2Connected: profile.concept2_connected || false,
            concept2LastSync: profile.concept2_last_sync
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
    auditLogs: []
};

// =========================================
// データベース（ハイブリッド: Supabase / ローカルストレージ）
// =========================================
const DB = {
    // Supabaseが利用可能かどうか
    useSupabase: false,

    // ローカルストレージ操作
    saveLocal(key, data) {
        localStorage.setItem(`tanteibu_v2_${key}`, JSON.stringify(data));
    },

    loadLocal(key) {
        const data = localStorage.getItem(`tanteibu_v2_${key}`);
        return data ? JSON.parse(data) : null;
    },

    // 汎用保存（ローカル + Supabase同時保存）
    async save(key, data) {
        // ローカルには常に保存（オフライン対応）
        this.saveLocal(key, data);

        // Supabaseが利用可能なら同期
        if (this.useSupabase && window.SupabaseConfig?.isReady()) {
            try {
                // 個別レコードの保存は専用メソッドで行うため、
                // ここでは配列データの一括同期のみ行う
                const syncTable = {
                    'schedules': 'schedules',
                    'crew_notes': 'crew_notes'
                };
                const tableName = syncTable[key];
                if (tableName && Array.isArray(data) && data.length > 0) {
                    console.log(`📤 Syncing ${key} to Supabase (${data.length} items)...`);
                    // 個別のupsertは各操作関数で行うため、ここではログのみ
                }
            } catch (e) {
                console.warn('Supabase sync failed:', e);
            }
        }
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
            console.log('Supabase mode:', this.useSupabase ? 'enabled' : 'disabled (demo mode)');
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
        state.currentUser = this.load('current_user');

        // 承認済みユーザーがいない場合もデモデータを再作成（デモモード用）
        const approvedUsers = state.users.filter(u => u.approvalStatus === '承認済み');
        if (state.users.length === 0 || approvedUsers.length === 0) {
            this.createDemoData();
        }

        // Supabaseと同期（オンライン時）
        if (this.useSupabase && window.SupabaseConfig.isReady()) {
            await this.syncFromSupabase();
        }
    },

    // Supabaseから同期
    async syncFromSupabase() {
        if (!this.useSupabase || !window.SupabaseConfig.isReady()) return;

        console.log('Syncing from Supabase...');
        try {
            // マスタデータ
            // usersは別途handleAuthSessionでロード済みだが、ここでも念のため
            // boats, oars, ergos
            const boats = await window.SupabaseConfig.db.loadMasterData('boats');
            if (boats.length) { state.boats = boats; this.saveLocal('boats', boats); }

            const oars = await window.SupabaseConfig.db.loadMasterData('oars');
            if (oars.length) { state.oars = oars; this.saveLocal('oars', oars); }

            const ergos = await window.SupabaseConfig.db.loadMasterData('ergos');
            if (ergos.length) { state.ergos = ergos; this.saveLocal('ergos', ergos); }

            // トランザクションデータ
            // 直近3ヶ月分などをロードするのが理想だが、一旦全件または範囲指定
            const today = new Date();
            const startStr = new Date(today.getFullYear(), today.getMonth() - 1, 1).toISOString().split('T')[0]; // 先月から
            const endStr = new Date(today.getFullYear(), today.getMonth() + 2, 0).toISOString().split('T')[0]; // 来月末まで

            const schedules = await window.SupabaseConfig.db.loadSchedules(startStr, endStr);
            if (schedules.length) {
                // ローカルとマージまたは置換。簡易的に置換（期間外が消えないように注意が必要だが、今回はロードした分をstateに反映）
                // state.schedulesにある既存データを期間でフィルタして、ロードしたデータとマージするロジックが必要
                // ここでは簡易的に「ロードしたデータをIDベースでstateに上書き・追加」する
                schedules.forEach(s => {
                    const idx = state.schedules.findIndex(local => local.id === s.id);
                    if (idx !== -1) state.schedules[idx] = s;
                    else state.schedules.push(s);
                });
                this.saveLocal('schedules', state.schedules);
            }

            // エルゴ記録は件数が多いので、currentUserのものだけロードするか、表示時にロードする方針が良い
            // ここではcurrentUserの記録をロード
            if (state.currentUser) {
                const myRecords = await window.SupabaseConfig.db.loadErgoRecords(state.currentUser.id);
                if (myRecords.length) {
                    // 同様にマージ
                    myRecords.forEach(r => {
                        const idx = state.ergoRecords.findIndex(local => local.id === r.id);
                        if (idx !== -1) state.ergoRecords[idx] = r;
                        else state.ergoRecords.push(r);
                    });
                    this.saveLocal('ergo_records', state.ergoRecords);
                }
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

            console.log('Sync complete');
        } catch (e) {
            console.warn('Sync failed:', e);
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
            { id: 'u2', name: '鈴木花子', gender: 'woman', grade: 3, role: ROLES.EXECUTIVE, status: '在籍', googleId: 'executive@keio.jp', approvalStatus: '承認済み', concept2Connected: true },
            { id: 'u3', name: '佐藤次郎', gender: 'man', grade: 2, role: ROLES.MEMBER, status: '在籍', googleId: 'member@keio.jp', approvalStatus: '承認済み', concept2Connected: false },
            { id: 'u4', name: '田中三郎', gender: 'man', grade: 2, role: ROLES.COX, status: '在籍', googleId: 'cox@keio.jp', approvalStatus: '承認済み', concept2Connected: false },
            { id: 'u5', name: '高橋四郎', gender: 'man', grade: 1, role: ROLES.MEMBER, status: '在籍', googleId: 'member2@keio.jp', approvalStatus: '承認済み', concept2Connected: false }
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
    return `id-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
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

function canEditMaster(user) {
    return [ROLES.ADMIN, ROLES.COX].includes(user?.role);
}

function canViewOverview(user) {
    return [ROLES.ADMIN, ROLES.EXECUTIVE, ROLES.COACH].includes(user?.role);
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
        // 5分刻み時間セレクター初期化
        initTimeSelect();
    }
}

// ロール別タブ表示/非表示
function applyRoleBasedTabs() {
    const role = state.currentUser?.role || '';
    const roleKey = {
        [ROLES.ADMIN]: 'admin',
        [ROLES.EXECUTIVE]: 'executive',
        [ROLES.COACH]: 'coach',
        [ROLES.COX]: 'cox',
        [ROLES.MEMBER]: 'member',
        [ROLES.MANAGER]: 'manager'
    }[role] || 'member';

    let firstVisibleTab = null;
    document.querySelectorAll('#bottom-nav .nav-item').forEach(item => {
        const roles = item.dataset.roles || 'all';
        const visible = roles === 'all' || roles.split(',').includes(roleKey);
        item.style.display = visible ? '' : 'none';
        if (visible && !firstVisibleTab) firstVisibleTab = item.dataset.tab;
    });

    // 現在のactiveタブが非表示なら最初の表示可能タブへ切替
    const activeItem = document.querySelector('#bottom-nav .nav-item.active');
    if (activeItem && activeItem.style.display === 'none' && firstVisibleTab) {
        switchTab(firstVisibleTab);
    }
}

// 5分刻み時間セレクター初期化
function initTimeSelect() {
    const sel = document.getElementById('input-start-time');
    if (!sel || sel.options.length > 1) return; // 既に生成済みなら不要
    for (let h = 5; h <= 21; h++) {
        for (let m = 0; m < 60; m += 5) {
            const val = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
            const opt = document.createElement('option');
            opt.value = val;
            opt.textContent = val;
            sel.appendChild(opt);
        }
    }
}

function switchTab(tabId) {
    // 安定性のため: タブ切り替え時はログイン画面を強制非表示
    const loginScreen = document.getElementById('login-screen');
    if (loginScreen) loginScreen.style.display = 'none';
    const onboardingScreen = document.getElementById('onboarding-screen');
    if (onboardingScreen) onboardingScreen.style.display = 'none';

    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.toggle('active', item.dataset.tab === tabId);
    });
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.toggle('hidden', content.id !== `tab-${tabId}`);
        content.classList.toggle('active', content.id === `tab-${tabId}`);
    });

    if (tabId === 'overview') renderOverview();
    if (tabId === 'ergo-data') {
        renderErgoRecords();
        renderWeeklyRanking();
        renderTeamRecords();
    }
    if (tabId === 'rigging') initRigging();
    if (tabId === 'crew-note') {
        initCrewNoteFeatures();
        renderPracticeNotesList();
    }
    if (tabId === 'settings') renderSettings();
}

// =========================================
// 認証
// =========================================
function renderUserSelectList() {
    const container = document.getElementById('user-select-list');
    if (!container) return;

    // ユーザーがいない場合のハンドリング（デモデータ作成またはリロード）
    console.log('renderUserSelectList: state.users=', state.users);
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
                { id: 'u4', name: '田中一郎', role: '部員', grade: 2, approvalStatus: '承認済み', concept2Connected: false },
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

    // 分類ルール（距離とタイムベース）
    classificationRules: [
        // 距離ベースのメニュー
        { key: '2000m TT', type: 'distance', min: 1900, max: 2100, excludeJustRow: true },
        { key: '5000m', type: 'distance', min: 4800, max: 5200, excludeJustRow: true },
        { key: '6000m', type: 'distance', min: 5800, max: 6200, excludeJustRow: true },
        { key: '3750m', type: 'distance', min: 3650, max: 3850, excludeJustRow: true },
        { key: '10000m', type: 'distance', min: 9800, max: 10200, excludeJustRow: true },
        { key: '500m', type: 'distance', min: 450, max: 550, excludeJustRow: true },
        { key: '1000m', type: 'distance', min: 950, max: 1050, excludeJustRow: true },
        // タイムベースのメニュー（秒で指定）
        { key: '20分', type: 'time', min: 1150, max: 1250, excludeJustRow: true },
        { key: '30分', type: 'time', min: 1750, max: 1850, excludeJustRow: true },
        { key: '60分', type: 'time', min: 3500, max: 3700, excludeJustRow: true },
        // インターバル
        { key: 'インターバル', type: 'workout', patterns: ['FixedDistanceInterval', 'FixedTimeInterval', 'VariableInterval'] },
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
        console.log('Concept2 user verified:', userData?.username);

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

        // Supabaseにも保存
        syncProfileToSupabase({
            concept2_connected: true,
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
        console.log('Concept2 user verified (Edge):', userData.username);

        // 成功 - ユーザー情報を更新
        state.currentUser.concept2Connected = true;
        state.currentUser.concept2UserId = userData.id;
        state.currentUser.concept2Username = userData.username;
        state.currentUser.concept2LastSync = new Date().toISOString();

        const idx = state.users.findIndex(u => u.id === state.currentUser.id);
        if (idx !== -1) state.users[idx] = state.currentUser;
        DB.save('users', state.users);
        DB.save('current_user', state.currentUser);

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

// function disconnectConcept2 removed (duplicate)

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
    console.log('fetchConcept2Data called', state.currentUser?.concept2Connected);
    if (!state.currentUser?.concept2Connected) {
        console.log('User not connected to Concept2');
        return;
    }

    const accessToken = state.currentUser.concept2Token;

    if (!accessToken) {
        console.log('No access token found');
        return;
    }

    showToast('データを同期中...', 'success');

    try {
        // 直接Concept2 APIを呼び出す（全ページ取得）
        console.log('Fetching data from Concept2 API...');

        let allResults = [];
        let page = 1;
        let hasMore = true;

        while (hasMore) {
            const url = `https://log.concept2.com/api/users/me/results?type=rower&number=250&page=${page}`;
            console.log(`Fetching page ${page}...`);

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
            console.log(`Page ${page}: ${pageResults.length} results`);

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

        console.log(`Total fetched: ${allResults.length} results from Concept2 API`);

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
            console.log('ergoRaw saved, count:', state.ergoRaw.length, 'new:', newCount);

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
            console.log('Direct API failed (CORS), trying Edge Function...');
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
                console.log('Access token expired, attempting refresh...');
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
            console.log(`Fetched ${result.results.length} results via Edge Function`);
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

        // Supabaseにも保存（Edge Function経由などで、あるいはDB.saveが勝手にやるのを期待）
        // ただしDB.save('users'...)で同期されるならOK。
        // もしcreateClientが使えない環境ならEdge Functionに保存させる必要があるが、
        // 現状はDB.saveで同期されると仮定。
        // もし厳密にやるなら、refresh成功時にEdge Function側でusersテーブル更新してもらうのがベストだが、
        // concept2-authはresponse返すだけなので、クライアント側で保存が必要。

        console.log('Token refreshed successfully');
        return true;

    } catch (e) {
        console.error('Refresh token exception:', e);
        return false;
    }
}

// エルゴセッションを分類（拡張メニュー対応）
function classifyErgoSessions(reclassify = false) {
    try {
        console.log('classifyErgoSessions started, reclassify:', reclassify);
        // CONCEPT2_API.classificationRulesを使用
        const rules = CONCEPT2_API.classificationRules;
        console.log('Rules loaded:', rules?.length || 0);

        const userRaw = state.ergoRaw.filter(r => r.userId === state.currentUser.id);
        console.log('User raw data count:', userRaw.length);

        // 再分類の場合は既存データをクリア
        if (reclassify) {
            state.ergoSessions = state.ergoSessions.filter(s => s.userId !== state.currentUser.id);
            state.ergoRecords = state.ergoRecords.filter(r => r.userId !== state.currentUser.id);
            console.log('Cleared existing data for reclassification');
        }

        userRaw.forEach(raw => {
            // データ補正（インターバル詳細）
            if (raw.intervals && raw.intervals.length > 0 && (!raw.intervalDisplay || raw.workoutType === 'unknown')) {
                const intervalInfo = calculateIntervalDetails({ intervals: raw.intervals }, raw.workoutType);
                raw.intervalDisplay = intervalInfo.display;
                raw.workoutType = intervalInfo.type;
            }

            // JustRowは除外
            if (raw.workoutType === 'JustRow') return;

            // 既に分類済みかチェック（再分類でない場合）
            if (!reclassify) {
                const existingSession = state.ergoSessions.find(s => s.rawId === raw.id);
                if (existingSession) return;
            }

            // ルール適用
            let menuKey = 'その他';
            let category = 'other';

            // インターバルを先に判定（距離/時間ルールで誤分類されるのを防止）
            const intervalTypes = ['FixedDistanceInterval', 'FixedTimeInterval', 'VariableInterval'];
            if (intervalTypes.includes(raw.workoutType)) {
                menuKey = raw.intervalDisplay || 'インターバル';
                category = 'interval';
            } else {
                for (const rule of rules) {
                    if (rule.type === 'distance' && raw.distance >= rule.min && raw.distance <= rule.max) {
                        menuKey = rule.key;
                        category = 'distance';
                        break;
                    } else if (rule.type === 'time' && raw.time >= rule.min && raw.time <= rule.max) {
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
            console.log('Session created:', session.menuKey, session.category, session.distance);

            // ergoRecordsにも追加（データタブで表示）
            state.ergoRecords.push({
                id: generateId(),
                rawId: raw.id, // rawDataへの参照を保持
                userId: state.currentUser.id,
                date: raw.date,
                distance: raw.distance,
                timeSeconds: Math.round(raw.time),
                timeDisplay: formatTime(raw.time),
                split: session.split,
                strokeRate: raw.averageSPM,
                menuKey: menuKey,
                category: category,
                source: 'Concept2'
            });
        });

        DB.save('ergoSessions', state.ergoSessions);
        DB.save('ergo_records', state.ergoRecords);
        console.log('classifyErgoSessions finished. Sessions:', state.ergoSessions.length, 'Records:', state.ergoRecords.length);
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

    // インターバルを先に判定（距離/時間ルールで誤分類されるのを防止）
    const intervalTypes = ['FixedDistanceInterval', 'FixedTimeInterval', 'VariableInterval'];
    if (intervalTypes.includes(workoutType)) {
        const intervals = result.workout?.intervals || [];
        let intervalDisplay = 'インターバル';
        if (intervals.length > 0) {
            const first = intervals[0];
            if (first.distance && first.distance > 0) {
                intervalDisplay = `${first.distance}m×${intervals.length}`;
            } else if (first.time && first.time > 0) {
                const sec = Math.round(first.time / 10);
                if (sec >= 60) {
                    intervalDisplay = `${Math.round(sec / 60)}分×${intervals.length}`;
                } else {
                    intervalDisplay = `${sec}sec×${intervals.length}`;
                }
            }
        }
        return { menuKey: intervalDisplay, category: 'interval' };
    }

    // JustRow判定
    if (workoutType === 'JustRow') {
        return { menuKey: 'JustRow', category: 'other' };
    }

    // 距離/時間ルールで分類（TT等）
    for (const rule of rules) {
        if (rule.type === 'distance' && distance >= rule.min && distance <= rule.max) {
            return { menuKey: rule.key, category: 'distance' };
        } else if (rule.type === 'time' && timeSec >= rule.min && timeSec <= rule.max) {
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

            console.log(`Page ${data.page}: ${pageResults.length} results (total: ${allResults.length})`);
        }

        const results = allResults;
        console.log(`Fetched ${results.length} results from Concept2 (${currentPage - 1} pages)`);

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

            // JustRowはスキップ
            if (menuKey === 'JustRow') continue;

            const timeSec = result.time ? result.time / 10 : 0;
            const distance = result.distance || 0;
            const recordDate = result.date?.split('T')[0] || new Date().toISOString().split('T')[0];
            const splitStr = (distance > 0 && timeSec > 0) ? formatSplit(timeSec, distance) : '-';
            const recordId = 'c2_' + concept2Id;

            // ergoRecordsに追加
            const newRecord = {
                id: recordId,
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
                workoutType: result.workout_type || 'FixedDistanceSplits',
                menuKey: menuKey,
                category: category,
                intervals: result.workout?.intervals || [],
                rawData: result,
                source: 'concept2',
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
                workoutType: result.workout_type || 'FixedDistanceSplits',
                source: 'Concept2',
                createdAt: new Date().toISOString()
            });

            insertedCount++;
        }

        // 保存
        DB.save('ergo_records', existingRecords);
        DB.save('ergoSessions', existingSessions);

        // stateも更新
        state.ergoRecords = existingRecords;
        state.ergoSessions = existingSessions;

        // 最終同期日時を更新
        state.currentUser.concept2LastSync = new Date().toISOString();
        DB.save('current_user', state.currentUser);

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

    renderWeekCalendar();
    initOverviewDate();
    populateBoatOarSelects();
    initDataViewToggle();
}

// =========================================
// 入力タブ - 週カレンダー
// =========================================
function renderWeekCalendar() {
    const container = document.getElementById('week-calendar');
    const weekRange = document.getElementById('week-range');
    const isManager = state.currentUser?.role === ROLES.MANAGER;

    const weekEnd = new Date(state.currentWeekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);

    const fmt = (d) => `${d.getMonth() + 1}/${d.getDate()}`;
    weekRange.textContent = `${fmt(state.currentWeekStart)}〜${fmt(weekEnd)}`;

    container.innerHTML = '';
    const today = formatDate(new Date());

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

        if (isManager) {
            // マネージャー：午前/午後なし、その日の全スケジュールを表示
            dayCard.innerHTML = `
                <div class="day-header">
                    <span class="day-date">${display.month}/${display.day}<span class="weekday ${weekdayClass}">(${display.weekday})</span></span>
                    <span class="expand-icon">▼</span>
                </div>
                <div class="day-slots">
                    ${createManagerDayHTML(dateStr)}
                </div>
            `;
        } else {
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
        }

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

    // マネージャー追加ボタン
    container.querySelectorAll('.manager-add-slot').forEach(slot => {
        slot.addEventListener('click', () => {
            openInputModal(slot.dataset.date, '終日');
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
        }
        if (schedule.startTime) {
            details = (details ? details + ' ' : '') + schedule.startTime + '〜';
        }
    }

    return `
        <div class="time-slot" data-date="${dateStr}" data-slot="${timeSlot}">
            <span class="slot-time">${timeSlot}</span>
            <div class="slot-content">
                <span class="slot-type-badge ${badgeClass}">${badgeText}</span>
                ${details ? `<div class="slot-details">${details}</div>` : ''}
            </div>
        </div>
    `;
}

// マネージャー用：その日の全スケジュールを表示（午前/午後なし）
function createManagerDayHTML(dateStr) {
    const schedules = state.schedules.filter(s =>
        s.userId === state.currentUser?.id && s.date === dateStr
    );

    if (schedules.length === 0) {
        return `<div class="time-slot manager-slot" data-date="${dateStr}" data-slot="終日">
            <div class="slot-content">
                <span class="slot-type-badge empty">入力する</span>
            </div>
        </div>`;
    }

    return schedules.map((s, idx) => {
        let badgeClass = '', badgeText = '', details = '';
        switch (s.scheduleType) {
            case SCHEDULE_TYPES.MEAL:
                badgeClass = 'meal';
                badgeText = `🍳 炊事`;
                details = s.mealTypes ? s.mealTypes.join('/') : '';
                break;
            case SCHEDULE_TYPES.VIDEO:
                badgeClass = 'video';
                badgeText = `🎥 ビデオ`;
                details = [s.startTime ? s.startTime + '〜' : '', s.videoDuration ? `${s.videoDuration}分` : ''].filter(d => d).join(' ');
                break;
            case SCHEDULE_TYPES.ABSENT:
                badgeClass = 'absent';
                badgeText = `❌ 参加不可`;
                details = s.absenceReason || '';
                break;
            default:
                badgeClass = 'other';
                badgeText = s.scheduleType;
        }
        return `<div class="time-slot manager-slot" data-date="${dateStr}" data-slot="終日" data-schedule-id="${s.id}">
            <div class="slot-content">
                <span class="slot-type-badge ${badgeClass}">${badgeText}</span>
                ${details ? `<div class="slot-details">${details}</div>` : ''}
            </div>
        </div>`;
    }).join('') + `<div class="time-slot manager-add-slot" data-date="${dateStr}" data-slot="終日">
        <div class="slot-content">
            <span class="slot-type-badge empty">+ 追加</span>
        </div>
    </div>`;
}

// =========================================
// 入力モーダル
// =========================================
let currentInputData = null;

function openInputModal(dateStr, timeSlot, scheduleId = null) {

    const modal = document.getElementById('input-modal');
    const title = document.getElementById('input-modal-title');
    const display = formatDisplayDate(dateStr);
    const isManager = state.currentUser?.role === ROLES.MANAGER;

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
    const roleKey = userRole === ROLES.MANAGER ? 'manager'
        : userRole === ROLES.COX ? 'cox'
            : userRole === ROLES.ADMIN ? 'admin'
                : userRole === ROLES.EXECUTIVE ? 'executive'
                    : 'member';

    document.querySelectorAll('.schedule-type-btn').forEach(btn => {
        const allowedRoles = (btn.dataset.roles || 'all').split(',');
        const visible = allowedRoles.includes('all') || allowedRoles.includes(roleKey);
        btn.style.display = visible ? '' : 'none';
    });

    // フォームリセット
    document.querySelectorAll('#input-modal .toggle-btn').forEach(btn => btn.classList.remove('active'));
    document.getElementById('input-start-time').value = '';
    document.getElementById('input-memo').value = '';
    document.getElementById('input-distance').value = '';
    document.getElementById('absence-reason-group').classList.add('hidden');
    document.getElementById('ergo-type-group').classList.add('hidden');
    document.getElementById('ergo-record-group').classList.add('hidden');
    document.getElementById('boat-group').classList.add('hidden');
    document.getElementById('oar-group').classList.add('hidden');
    document.getElementById('crew-group').classList.add('hidden');
    document.getElementById('meal-type-group').classList.add('hidden');
    document.getElementById('video-duration-group').classList.add('hidden');
    document.getElementById('ergo-records-container').innerHTML = '';

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
        document.getElementById('input-distance').value = schedule.distance || '';

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
        if (schedule.oarId) document.getElementById('input-oar').value = schedule.oarId;

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
    document.getElementById('start-time-group').classList.toggle('hidden', type === SCHEDULE_TYPES.ABSENT);
    document.getElementById('absence-reason-group').classList.toggle('hidden', type !== SCHEDULE_TYPES.ABSENT);
    document.getElementById('ergo-type-group').classList.toggle('hidden', type !== SCHEDULE_TYPES.ERGO);
    document.getElementById('ergo-record-group').classList.toggle('hidden', type !== SCHEDULE_TYPES.ERGO);
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
        distance: document.getElementById('input-distance').value ? parseInt(document.getElementById('input-distance').value) : null,
        absenceReason: document.querySelector('.reason-btn.active')?.dataset.value || null,
        absenceDetail: document.getElementById('input-absence-detail')?.value || null,

        ergoType: document.querySelector('.ergo-type-btn.active')?.dataset.value || null,
        boatType: document.querySelector('.boat-type-btn.active')?.dataset.value || null,
        boatId: document.getElementById('input-boat').value || null,
        oarId: document.getElementById('input-oar').value || null,
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
    DB.saveSchedule(newSchedule).then(() => console.log('Schedule synced to Supabase'));

    // 自動でクルーノートを作成（乗艇練習の場合）
    if (newSchedule.scheduleType === SCHEDULE_TYPES.BOAT) {
        autoCreateCrewNotesFromSchedule(newSchedule);
    }

    // 練習ノート自動作成（参加不可以外）
    if (newSchedule.scheduleType !== SCHEDULE_TYPES.ABSENT) {
        autoCreatePracticeNote(newSchedule);
    }

    closeInputModal();
    renderWeekCalendar();
    showToast('保存しました', 'success');
}

function deleteSchedule() {
    if (!currentInputData?.schedule) return;

    if (!confirm('この予定を削除しますか？')) return;

    state.schedules = state.schedules.filter(s => s.id !== currentInputData.schedule.id);
    state.ergoRecords = state.ergoRecords.filter(r => r.scheduleId !== currentInputData.schedule.id);

    DB.save('schedules', state.schedules);
    DB.save('ergo_records', state.ergoRecords);

    // Supabase同期
    const deleteId = currentInputData.schedule.id;
    DB.deleteSchedule(deleteId).then(() => console.log('Schedule deleted from Supabase'));
    DB.deleteErgoRecordsByScheduleId(deleteId);

    closeInputModal();
    renderWeekCalendar();
    showToast('削除しました', 'success');
}



// =========================================
// 艇・オール・クルー選択
// =========================================
// function populateBoatOarSelects removed (duplicate)

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
        u.id !== state.currentUser?.id &&
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

    showToast(`プリセット「${name}」を保存しました`, 'success');
    nameInput.value = '';

    // 読込タブに切り替え
    document.querySelector('.tab-btn[data-tab="load"]').click();
}

function deletePreset(id) {
    if (!confirm('このプリセットを削除しますか？')) return;

    state.crewPresets = state.crewPresets.filter(p => p.id !== id);
    DB.save(CREW_PRESETS_KEY, state.crewPresets);
    renderPresetList();
    showToast('削除しました', 'success');
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

function renderOverview() {
    const dateStr = document.getElementById('overview-date').value;
    const container = document.getElementById('schedule-timeline');
    const boatSection = document.getElementById('available-boats-section');

    // その日の全スケジュール（全ユーザー）
    const schedules = state.schedules.filter(s => s.date === dateStr);

    // startTimeでグルーピング
    const timeGroups = {};
    const noTimeSchedules = [];
    const absentSchedules = [];

    schedules.forEach(s => {
        if (s.scheduleType === SCHEDULE_TYPES.ABSENT) {
            absentSchedules.push(s);
        } else if (s.startTime) {
            if (!timeGroups[s.startTime]) timeGroups[s.startTime] = [];
            timeGroups[s.startTime].push(s);
        } else {
            noTimeSchedules.push(s);
        }
    });

    const sortedTimes = Object.keys(timeGroups).sort();

    let html = '';

    // 日付ヘッダー + 全体サマリー
    const display = formatDisplayDate(dateStr);
    const totalActive = schedules.length - absentSchedules.length;
    html += `<div class="timeline-date-header">
        ${display.month}/${display.day}（${display.weekday}）のスケジュール
        <span class="overview-total-badge">${totalActive}人参加 / ${absentSchedules.length}人不参加</span>
    </div>`;

    if (sortedTimes.length === 0 && noTimeSchedules.length === 0 && absentSchedules.length === 0) {
        html += '<div class="empty-state"><p>予定なし</p></div>';
    }

    // 時間帯ごとにサマリーカード表示
    sortedTimes.forEach(time => {
        html += renderTimeBlock(time, timeGroups[time]);
    });

    if (noTimeSchedules.length > 0) {
        html += renderTimeBlock('未定', noTimeSchedules);
    }

    // 参加不可（折りたたみ）
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
    const chipTypes = [SCHEDULE_TYPES.ERGO, SCHEDULE_TYPES.WEIGHT, SCHEDULE_TYPES.MEAL, SCHEDULE_TYPES.VIDEO, SCHEDULE_TYPES.BANCHA];
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
}

// 練習ノート一覧を表示
function renderPracticeNotesList() {
    const container = document.getElementById('practice-notes-list');
    if (!container) return;

    const myNotes = state.practiceNotes
        .filter(n => n.userId === state.currentUser.id)
        .sort((a, b) => b.date.localeCompare(a.date) || (b.timeSlot || '').localeCompare(a.timeSlot || ''));

    if (myNotes.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <p>📝 練習を登録すると、ここに練習ノートが自動で作成されます</p>
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
            const typeLabel = schedule?.scheduleType || '不明';
            const hasReflection = note.reflection && note.reflection.trim().length > 0;
            const hasErgo = note.ergoRecordIds && note.ergoRecordIds.length > 0;
            const timeLabel = schedule?.startTime || note.timeSlot || '';

            let badgeClass = 'default';
            if (typeLabel === SCHEDULE_TYPES.ERGO) badgeClass = 'ergo';
            else if (typeLabel === SCHEDULE_TYPES.BOAT) badgeClass = 'boat';
            else if (typeLabel === SCHEDULE_TYPES.WEIGHT) badgeClass = 'weight';

            html += `
                <div class="pn-card" data-note-id="${note.id}">
                    <div class="pn-card-header">
                        <span class="slot-type-badge ${badgeClass}">${typeLabel}</span>
                        <span class="pn-time">${timeLabel}</span>
                    </div>
                    <div class="pn-card-body">
                        ${hasReflection ? `<p class="pn-preview">${note.reflection.substring(0, 60)}${note.reflection.length > 60 ? '…' : ''}</p>` : '<p class="pn-empty-hint">振り返りを書く</p>'}
                        <div class="pn-tags">
                            ${hasErgo ? '<span class="pn-tag">📊 エルゴ</span>' : ''}
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

    modal.dataset.noteId = noteId;
    modal.classList.remove('hidden');
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
    const dayRecords = state.ergoRecords.filter(r =>
        r.date === note.date &&
        r.userId === note.userId &&
        !(note.ergoRecordIds || []).includes(r.id)
    );

    if (dayRecords.length === 0) {
        selectList.innerHTML = '<p class="text-muted">この日のエルゴデータが見つかりません</p>';
    } else {
        selectList.innerHTML = dayRecords.map(rec => `
            <div class="ergo-select-item" data-record-id="${rec.id}">
                <span>📊 ${rec.distance || '?'}m — ${rec.timeDisplay || '?'} ${rec.source === 'concept2' ? '(C2同期)' : '(手入力)'}</span>
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
    renderLinkedErgoRecords(note);
}

function savePracticeNote() {
    const modal = document.getElementById('practice-note-modal');
    const noteId = modal.dataset.noteId;
    const note = state.practiceNotes.find(n => n.id === noteId);
    if (!note) return;

    note.reflection = document.getElementById('practice-note-reflection').value || '';
    note.updatedAt = new Date().toISOString();

    DB.save('practice_notes', state.practiceNotes);
    modal.classList.add('hidden');
    renderPracticeNotesList();
    showToast('保存しました', 'success');
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
        if (r.userId !== state.currentUser?.id) return false;
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
        if (r.userId !== state.currentUser?.id) return false;
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
        if (r.userId !== state.currentUser?.id) return false;
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
    const record = state.ergoRecords.find(r => r.id === recordId);
    if (!record) return;

    // rawIdから直接rawデータを取得
    const raw = state.ergoRaw.find(r => r.id === record.rawId);

    const modal = document.getElementById('ergo-detail-modal');
    const display = formatDisplayDate(record.date);

    // 基本情報を設定
    document.getElementById('ergo-detail-title').textContent = record.menuKey || '記録詳細';
    document.getElementById('ergo-detail-date').textContent = `${display.year}/${display.month}/${display.day}`;
    document.getElementById('ergo-detail-distance').textContent = record.distance ? `${record.distance}m` : '-';
    document.getElementById('ergo-detail-time').textContent = record.timeDisplay || '-';
    document.getElementById('ergo-detail-split').textContent = record.split || '-';
    document.getElementById('ergo-detail-rate').textContent = record.strokeRate || '-';

    // スプリット/インターバルを表示
    renderSplits(record, raw);

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
function renderWeeklyRanking() {
    const container = document.getElementById('weekly-ranking');
    if (!container) return;

    const menuSelect = document.getElementById('ranking-menu');
    const selectedMenu = menuSelect?.value || '2000m TT';
    const genderBtn = document.querySelector('.gender-btn.active');
    const selectedGender = genderBtn?.dataset.gender || (state.currentUser?.gender || 'man');

    // UIのトグル状態を初期化時に合わせる（初回レンダリング時など）
    if (!genderBtn && state.currentUser) {
        const btn = document.querySelector(`.gender - btn[data - gender="${selectedGender}"]`);
        if (btn) {
            document.querySelectorAll('.gender-btn').forEach(b => b.classList.remove('active'));
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

    // 全ユーザーの今週のベスト記録を取得
    const weeklyBests = [];

    // ergoSessionsから今週のデータを抽出
    state.ergoSessions.forEach(session => {
        const user = state.users.find(u => u.id === session.userId);
        if (!user || user.gender !== selectedGender) return; // 性別フィルタ

        const sessionDate = new Date(session.date);
        if (sessionDate >= monday && session.menuKey === selectedMenu) {
            // このユーザーの既存の記録よりも良いか確認
            const existingIdx = weeklyBests.findIndex(b => b.userId === session.userId);

            // 距離メニューはタイムで比較、時間メニューは距離で比較
            const isBetter = (existing, newSession) => {
                if (session.category === 'time') {
                    return (newSession.distance || 0) > (existing.distance || 0);
                }
                return (newSession.time || Infinity) < (existing.time || Infinity);
            };

            if (existingIdx === -1) {
                weeklyBests.push(session);
            } else if (isBetter(weeklyBests[existingIdx], session)) {
                weeklyBests[existingIdx] = session;
            }
        }
    });

    // ランキングソート
    const isTimeMenu = selectedMenu.includes('分');
    weeklyBests.sort((a, b) => {
        if (isTimeMenu) {
            return (b.distance || 0) - (a.distance || 0);
        }
        return (a.time || Infinity) - (b.time || Infinity);
    });

    if (weeklyBests.length === 0) {
        container.innerHTML = '<div class="empty-state"><p>今週のデータがありません</p></div>';
        return;
    }

    const rankMedals = ['🥇', '🥈', '🥉'];

    // 自分のベストを計算
    let myBestRecord = null;
    const myRecords = state.ergoRecords.filter(r =>
        r.userId === state.currentUser?.id &&
        r.menuKey === selectedMenu &&
        applyPeriodFilter(r) // 期間フィルタも適用するか？ -> 週間ランキングなら「今週の自分のベスト」を表示すべき
    );

    // 今週の自分のデータを抽出 (weeklyBestsにはすでに入っているはずだが、ランク外の可能性もあるので再検索)
    // いや、renderWeeklyRankingは「今週」固定なので、period filterは不要、日付でフィルタ
    const myWeeklyRecords = state.ergoRecords.filter(r => {
        if (r.userId !== state.currentUser?.id) return false;
        if (r.menuKey !== selectedMenu) return false;
        const d = new Date(r.date);
        return d >= monday;
    });

    if (myWeeklyRecords.length > 0) {
        myWeeklyRecords.sort((a, b) => {
            if (isTimeMenu) return (b.distance || 0) - (a.distance || 0);
            return (a.time || Infinity) - (b.time || Infinity);
        });
        myBestRecord = myWeeklyRecords[0];
    }

    let html = '';

    // 自己ベスト表示エリア
    if (state.currentUser && state.currentUser.gender === selectedGender) {
        if (myBestRecord) {
            const display = formatDisplayDate(myBestRecord.date);
            html += `< div class="my-best-section" >
    <div class="ranking-item my-best">
        <div class="rank">YOU</div>
        <div class="user-info">
            <div class="name">今週の自己ベスト</div>
            <div class="date">${display.month}/${display.day}</div>
        </div>
        <div>
            <div class="time">${formatTime(myBestRecord.time)}</div>
            <div class="split">Split ${getSplit(myBestRecord)}</div>
        </div>
    </div>
            </div > `;
        } else {
            html += `< div class="my-best-section" >
    <div class="ranking-item my-best empty">
        <div class="rank">YOU</div>
        <div class="user-info"><div class="name">今週の記録なし</div></div>
    </div>
            </div > `;
        }
    }

    html += weeklyBests.slice(0, 10).map((record, idx) => {
        const user = state.users.find(u => u.id === record.userId);
        const display = formatDisplayDate(record.date);
        const rankSymbol = idx < 3 ? rankMedals[idx] : `${idx + 1} `;
        const isMe = user && user.id === state.currentUser?.id;

        return `< div class="ranking-item ${isMe ? 'highlight' : ''}" >
            <div class="rank">${rankSymbol}</div>
            <div class="user-info">
                <div class="name">${user?.name || '不明'}</div>
                <div class="date">${display.month}/${display.day}</div>
            </div>
            <div>
                <div class="time">${formatTime(record.time)}</div>
                <div class="split">Split ${getSplit(record)}</div>
            </div>
        </div > `;
    }).join('');

    container.innerHTML = html;
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
            // ビューを切り替え
            document.getElementById('personal-data-view').classList.toggle('hidden', view !== 'personal');
            document.getElementById('team-data-view').classList.toggle('hidden', view !== 'team');
            document.getElementById('all-time-data-view').classList.toggle('hidden', view !== 'all-time');

            if (view === 'team') {
                renderWeeklyRanking();
                renderTeamRecords();
            } else if (view === 'all-time') {
                renderAllTimeRanking();
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
function renderAllTimeRanking() {
    const container = document.getElementById('all-time-ranking-list');
    if (!container) return;

    const menuSelect = document.getElementById('all-time-ranking-menu');
    const selectedMenu = menuSelect?.value || '2000m TT';

    // 全ユーザーの自己ベストを取得
    const allTimeBests = [];

    // ユーザーごとにベストを探す
    state.users.forEach(user => {
        const userRecords = state.ergoRecords.filter(r => r.userId === user.id && r.menuKey === selectedMenu);
        const importedRecords = state.ergoSessions.filter(s => s.userId === user.id && s.menuKey === selectedMenu);

        // 手入力とインポートの記録を統合
        const allRecords = [...userRecords, ...importedRecords];

        if (allRecords.length > 0) {
            console.log(`DEBUG: User ${user.name} has ${allRecords.length} records for ${selectedMenu}`);
        } else {
            // console.log(`DEBUG: User ${ user.name } has NO records`);
        }

        if (allRecords.length === 0) return;

        // ベスト記録を特定
        // 距離メニューはタイムで比較、時間メニューは距離で比較
        const isTimeMenu = selectedMenu.includes('分');

        let bestRecord = allRecords[0];
        for (let i = 1; i < allRecords.length; i++) {
            const current = allRecords[i];

            if (isTimeMenu) {
                // 時間制: 距離が長い方が良い
                if ((current.distance || 0) > (bestRecord.distance || 0)) {
                    bestRecord = current;
                }
            } else {
                // 距離制: タイムが短い方が良い
                // timeDisplay "mm:ss.f" をパースして比較する必要があるが、
                // インポートデータ(ergoSessions)は time (秒) を持っている。
                // 手入力データ(ergoRecords)は timeDisplay しかないかも？
                // 統一的に time (秒) を使うのが安全。
                // 手入力時に timeDisplay から秒換算していない場合はここで簡易パース必要だが
                // 今回は saveSchedule で timeDisplay しか保存していないため注意。
                // 一旦、インポートデータの time を優先し、なければ timeDisplay 文字列比較(簡易)

                const timeA = bestRecord.time || parseTimeStr(bestRecord.timeDisplay) || Infinity;
                const timeB = current.time || parseTimeStr(current.timeDisplay) || Infinity;

                if (timeB < timeA) {
                    bestRecord = current;
                }
            }
        }

        allTimeBests.push(bestRecord);
    });

    // ランキングソート
    const isTimeMenu = selectedMenu.includes('分');
    allTimeBests.sort((a, b) => {
        if (isTimeMenu) {
            return (b.distance || 0) - (a.distance || 0); // 距離降順
        }
        // タイム昇順
        const timeA = a.time || parseTimeStr(a.timeDisplay) || Infinity;
        const timeB = b.time || parseTimeStr(b.timeDisplay) || Infinity;
        return timeA - timeB;
    });

    if (allTimeBests.length === 0) {
        container.innerHTML = '<div class="empty-state"><p>データがありません</p></div>';
        return;
    }

    // ----------------------------------------------------
    // 自己ベスト表示 (My Best)
    // ----------------------------------------------------
    let myBestHtml = '';
    // 現在のユーザーがランキングに含まれているか、または別途自己ベストを持っているか確認
    // allTimeBestsには全ユーザーのベストが含まれているので、そこから探すのが早い
    const myRecordInRanking = allTimeBests.find(r => r.userId === state.currentUser?.id);

    // もしランキングに入っていなくても、自分のベストを表示したい場合は別途計算が必要だが
    // allTimeBestsは全ユーザーのベストを集めているので、ここに無ければ記録なしか、フィルタされているか。
    // ここでは allTimeBests から抽出する。

    // 性別フィルタが適用されていない？ renderAllTimeRankingには性別フィルタの実装がまだだった！
    // ここで性別フィルタも追加する。

    const rankMedals = ['🥇', '🥈', '🥉'];
    let listHtml = '';

    // 表示するリスト（性別フィルタ適用）
    // フィルタ用の性別を取得 (UIにトグルがない場合はユーザーの性別)
    // 週次ランキングと同じクラスを使っているので、DOMから取得できるかも？
    // ただしAllTimeRanking用のトグルがあるか確認が必要。
    // 実装計画では「ランキングビューにトグルを追加」としたので、共通のクラス '.gender-toggle' があるはずだが
    // IDが被らないように注意が必要。週次と歴代で別の場所にトグルがあるならOK。
    // index.htmlの構造上、タブ切り替えなので、それぞれのセクションにトグルが必要か、共通のフィルタエリアがあるか。
    // 現状 index.html には weekly-ranking-section にしかトグルを追加していない。
    // all-time-data-view にもトグルを追加する必要がある。
    // いったん、現在のユーザーの性別でフィルタするロジックを入れる。

    const currentGender = state.currentUser?.gender || 'man';
    // ※ トグル対応は後ほどHTML側で行うとして、ここではロジックのみ先行させるか、
    // 週次ランキングのトグル状態を共有するか。
    // 簡易的に「自分と同じ性別のランキング」を表示するデフォルト挙動にする。

    const filteredBests = allTimeBests.filter(r => {
        const u = state.users.find(user => user.id === r.userId);
        const uGender = u?.gender || 'man';
        return u && uGender === currentGender;
    });

    // 自分と同じ性別の記録から自分のベストを探す
    if (myRecordInRanking && state.currentUser.gender === currentGender) {
        const display = formatDisplayDate(myRecordInRanking.date);
        myBestHtml = `< div class="my-best-section" >
    <div class="ranking-item my-best">
        <div class="rank">YOU</div>
        <div class="user-info">
            <div class="name">自己ベスト (All Time)</div>
            <div class="date">${display.year}/${display.month}/${display.day}</div>
        </div>
        <div>
            <div class="time">${myRecordInRanking.timeDisplay || formatTime(myRecordInRanking.time)}</div>
            <div class="split">Split ${myRecordInRanking.split || '-'}</div>
        </div>
    </div>
        </div > `;
    } else if (state.currentUser.gender === currentGender) {
        myBestHtml = `< div class="my-best-section" >
    <div class="ranking-item my-best empty">
        <div class="rank">YOU</div>
        <div class="user-info"><div class="name">記録なし</div></div>
    </div>
        </div > `;
    }

    listHtml = filteredBests.map((record, idx) => {
        const user = state.users.find(u => u.id === record.userId);
        const display = formatDisplayDate(record.date);
        const rankSymbol = idx < 3 ? rankMedals[idx] : `${idx + 1} `;
        // 女子体重プライバシー
        let weightInfo = '';
        if (record.weight) {
            if (user.gender === 'woman') {
                // 自分か管理者なら表示
                if (state.currentUser?.id === user.id || state.currentUser?.role === ROLES.ADMIN) {
                    weightInfo = `< span class="weight-info" > (${record.weight}kg)</span > `;
                } else {
                    weightInfo = `< span class="weight-info private" > (記録済)</span > `;
                }
            } else {
                weightInfo = `< span class="weight-info" > (${record.weight}kg)</span > `;
            }
        }

        const isMe = user && user.id === state.currentUser?.id;

        return `< div class="ranking-item ${isMe ? 'highlight' : ''}" >
            <div class="rank">${rankSymbol}</div>
            <div class="user-info">
                <div class="name">${user?.name || '不明'} ${weightInfo}</div>
                <div class="date">${display.year}/${display.month}/${display.day}</div>
            </div>
            <div>
                <div class="time">${record.timeDisplay || formatTime(record.time)}</div>
                <div class="split">Split ${record.split || '-'}</div>
            </div>
        </div > `;
    }).join('');

    container.innerHTML = myBestHtml + listHtml;
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

function openMasterModal(type) {
    currentMasterType = type;
    const modal = document.getElementById('master-modal');
    const title = document.getElementById('master-modal-title');

    const titles = {
        boats: '艇マスタ',
        oars: 'オールマスタ',
        ergos: 'エルゴマスタ'
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
    if (status === 'repair') return 'repair'; // CSS class needed
    return 'unavailable';
}

function renderMasterList() {
    const list = document.getElementById('master-list');
    const data = state[currentMasterType] || [];

    if (currentMasterType === 'boats') {
        list.innerHTML = data.map(item => {
            const status = item.status || (item.availability === '使用不可' ? 'broken' : 'available');
            return `
    < div class="master-item" data - id="${item.id}" >
                <div class="info">
                    <div class="name">${item.name} <span class="badge" style="font-size:0.8em">${item.type}</span></div>
                    <div class="sub">${item.memo || ''}</div>
                </div>
                <span class="status ${getStatusClass(status)}">${translateStatus(status)}</span>
            </div >
    `}).join('') || '<div class="empty-state"><p>登録がありません</p></div>';
    } else if (currentMasterType === 'oars') {
        list.innerHTML = data.map(item => {
            const status = item.status || (item.availability === '使用不可' ? 'broken' : 'available');
            return `
    < div class="master-item" data - id="${item.id}" >
                <div class="info">
                    <div class="name">${item.name} (${item.type})</div>
                    <div class="sub">長さ: ${item.length || '-'}, シール: ${item.sealNumber || '-'}</div>
                    <div class="sub">${item.memo || ''}</div>
                </div>
                <span class="status ${getStatusClass(status)}">${translateStatus(status)}</span>
            </div >
    `}).join('') || '<div class="empty-state"><p>登録がありません</p></div>';
    } else if (currentMasterType === 'ergos') {
        list.innerHTML = data.map(item => {
            const status = item.status || (item.availability === '使用不可' ? 'broken' : 'available');
            return `
    < div class="master-item" data - id="${item.id}" >
                <div class="info">
                    <div class="name">${item.name} (${item.type})</div>
                    <div class="sub">シール: ${item.sealNumber || '-'}</div>
                </div>
                <span class="status ${getStatusClass(status)}">${translateStatus(status)}</span>
            </div >
    `}).join('') || '<div class="empty-state"><p>登録がありません</p></div>';
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
    deleteBtn.classList.toggle('hidden', !item);

    if (currentMasterType === 'boats') {
        const status = item?.status || (item?.availability === '使用不可' ? 'broken' : 'available');
        form.innerHTML = `
    < div class="form-group" >
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
        newItem = {
            id: currentMasterItem?.id || generateId(),
            name: document.getElementById('master-name').value,
            type: document.getElementById('master-boat-type').value,
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
function populateBoatOarSelects() {
    // Boats
    const boatSelect = document.getElementById('input-boat');
    if (boatSelect) {
        // Keep current selection
        const currentVal = boatSelect.value;
        boatSelect.innerHTML = '<option value="">選択してください</option>';
        (state.boats || []).forEach(b => {
            const status = b.status || (b.availability === '使用不可' ? 'broken' : 'available');
            const isUnavailable = status !== 'available';
            const statusLabel = isUnavailable ? ` (${translateStatus(status)})` : '';
            const option = document.createElement('option');
            option.value = b.id;
            option.textContent = `${b.name}${statusLabel} `;
            if (isUnavailable) {
                option.disabled = true; // Use disabled attribute to prevent selection but keep visible
                option.style.color = '#999';
            }
            boatSelect.appendChild(option);
        });
        boatSelect.value = currentVal;
    }

    // Oars
    const oarSelect = document.getElementById('input-oar');
    if (oarSelect) {
        const currentVal = oarSelect.value;
        oarSelect.innerHTML = '<option value="">選択してください</option>';
        (state.oars || []).forEach(o => {
            const status = o.status || (o.availability === '使用不可' ? 'broken' : 'available');
            const isUnavailable = status !== 'available';
            const statusLabel = isUnavailable ? ` (${translateStatus(status)})` : '';
            const option = document.createElement('option');
            option.value = o.id;
            option.textContent = `${o.name} (${o.type})${statusLabel} `;
            if (isUnavailable) {
                option.disabled = true;
                option.style.color = '#999';
            }
            oarSelect.appendChild(option);
        });
        oarSelect.value = currentVal;
    }
}

function deleteMasterItem() {
    if (!currentMasterItem) return;
    if (!confirm('削除しますか？')) return;

    state[currentMasterType] = state[currentMasterType].filter(d => d.id !== currentMasterItem.id);
    DB.save(currentMasterType, state[currentMasterType]);
    DB.addAuditLog(currentMasterType, currentMasterItem.id, '削除', {});

    closeMasterEditModal();
    renderMasterList();
    populateBoatOarSelects();
    showToast('削除しました', 'success');
}

// =========================================
// イベントリスナー
// =========================================
const initializeApp = async () => {
    try {
        console.log('App starting...');

        // デモモード判定 (?demo=true)
        const urlParams = new URLSearchParams(window.location.search);
        const isDemoMode = urlParams.get('demo') === 'true';
        state.isDemoMode = isDemoMode;

        if (isDemoMode) {
            console.log('🧪 Demo mode enabled');
        }

        // Supabaseクライアントの初期化
        let supabaseReady = false;
        if (window.SupabaseConfig) {
            supabaseReady = window.SupabaseConfig.init();
        }

        // デモモード時のみデモデータを作成
        if (isDemoMode && !DB.loadLocal('users')) {
            console.log('Demo mode: Creating demo data...');
            DB.createDemoData();
        }

        await DB.init();

        // Supabase認証セッションのチェック
        let loggedIn = false;
        if (supabaseReady) {
            const session = await window.SupabaseConfig.getSession();
            if (session) {
                console.log('✅ Supabase session found:', session.user.email);
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
                                role: p.role || '部員',
                                status: p.status || '在籍',
                                approvalStatus: p.approval_status || '承認済み',
                                concept2Connected: p.concept2_connected || false
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
                console.log('Auth state changed:', event);
                if (event === 'SIGNED_IN' && session) {
                    const authSuccess = await handleAuthSession(session);
                    if (authSuccess && state.currentUser?.approvalStatus === '承認済み') {
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
        document.getElementById('add-ergo-record-btn').addEventListener('click', () => addErgoRecordInput());

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
        document.querySelector('#master-edit-modal .modal-overlay')?.addEventListener('click', closeMasterEditModal);
        document.getElementById('save-master-btn')?.addEventListener('click', saveMasterItem);
        document.getElementById('delete-master-btn')?.addEventListener('click', deleteMasterItem);

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

        if (isFixedDistance && (!isFixedTime || firstDist % 100 === 0)) {
            // 距離ベース（時間が一定でない、または距離がキリの良い数字）
            display = `${firstDist} m×${count} `;
            type = 'FixedDistanceInterval';
        } else if (isFixedTime) {
            // 時間ベース
            const mins = Math.round(firstTime / 600); // 1/10秒 -> 分
            if (firstTime % 600 === 0 && mins > 0) {
                display = `${mins} min×${count} `;
            } else {
                const secs = Math.round(firstTime / 10);
                display = `${secs} sec×${count} `;
            }
            type = 'FixedTimeInterval';
        } else {
            // 変則
            display = `Variable×${count} `;
            type = 'VariableInterval';
        }
    }

    return { display, type };
}

// =========================================
// リギング管理
// =========================================

/**
 * リギング管理の初期化
 */
async function initRigging() {
    const boatSelect = document.getElementById('rigging-boat-select');
    if (!boatSelect) return;

    // 艇リストの取得（マスタから）
    let boats = state.boats || [];

    // Supabaseが有効なら取得試行（state.boatsはすでにsyncされているはずだが念のため）
    if (window.supabaseClient) {
        // state.boatsが空なら取得
        if (boats.length === 0) {
            try {
                const { data, error } = await window.supabaseClient.from('boats').select('*');
                if (data && !error) {
                    boats = data;
                    state.boats = boats;
                    saveLocal('boats', boats);
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
}

/**
 * Supabaseプロフィールを更新するヘルパー
 */
async function syncProfileToSupabase(updates) {
    if (DB.useSupabase && window.SupabaseConfig?.isReady() && state.currentUser?.id) {
        try {
            await window.SupabaseConfig.db.updateProfile(state.currentUser.id, updates);
            console.log('📤 Profile synced to Supabase:', updates);
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
        roleSelect.value = user.role || '部員';
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
}

function disconnectConcept2() {
    console.log('disconnectConcept2 called');
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

            console.log('Concept2 disconnected successfully');
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
 * モバイルブラウザ/PWAでタッチイベントのゴーストクリックを防止
 */
function showConfirmModal(message, onConfirm, onCancel) {
    // 既存のモーダルがあれば削除
    const existing = document.getElementById('custom-confirm-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'custom-confirm-modal';
    modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;z-index:10000;pointer-events:none;';

    const box = document.createElement('div');
    box.style.cssText = 'background:#1e1e2e;border-radius:16px;padding:24px;margin:16px;max-width:320px;width:100%;box-shadow:0 8px 32px rgba(0,0,0,0.4);pointer-events:none;';

    const msgEl = document.createElement('p');
    msgEl.textContent = message;
    msgEl.style.cssText = 'color:#eee;font-size:15px;margin:0 0 20px 0;text-align:center;line-height:1.5;';

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:10px;';

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'キャンセル';
    cancelBtn.style.cssText = 'flex:1;padding:12px;border:none;border-radius:10px;font-size:14px;font-weight:600;background:#333;color:#aaa;cursor:pointer;pointer-events:none;';

    const confirmBtn = document.createElement('button');
    confirmBtn.textContent = '解除する';
    confirmBtn.style.cssText = 'flex:1;padding:12px;border:none;border-radius:10px;font-size:14px;font-weight:600;background:#e74c3c;color:#fff;cursor:pointer;pointer-events:none;';

    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(confirmBtn);
    box.appendChild(msgEl);
    box.appendChild(btnRow);
    modal.appendChild(box);
    document.body.appendChild(modal);

    // ゴーストクリック防止：400ms後にpointer-eventsを有効化
    setTimeout(() => {
        modal.style.pointerEvents = 'auto';
        box.style.pointerEvents = 'auto';
        cancelBtn.style.pointerEvents = 'auto';
        confirmBtn.style.pointerEvents = 'auto';

        cancelBtn.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            modal.remove();
            if (onCancel) onCancel();
        });

        confirmBtn.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            modal.remove();
            if (onConfirm) onConfirm();
        });

        // オーバーレイクリックでキャンセル
        modal.addEventListener('click', function (e) {
            if (e.target === modal) {
                e.preventDefault();
                e.stopPropagation();
                modal.remove();
                if (onCancel) onCancel();
            }
        });
    }, 400);

    // タッチイベントも防止（400ms以内の誤タップ防止）
    modal.addEventListener('touchstart', function (e) {
        if (modal.style.pointerEvents === 'none') {
            e.preventDefault();
            e.stopPropagation();
        }
    }, { passive: false });
    modal.addEventListener('touchend', function (e) {
        if (modal.style.pointerEvents === 'none') {
            e.preventDefault();
            e.stopPropagation();
        }
    }, { passive: false });
}

// =========================================
// 体重管理
// =========================================

function initWeightSection() {
    const weightHistory = getWeightHistory();
    const latestWeight = weightHistory.length > 0 ? weightHistory[weightHistory.length - 1] : null;

    // 現在の体重を表示
    const display = document.getElementById('current-weight-display');
    if (display) {
        if (latestWeight) {
            display.textContent = `${latestWeight.weight} kg`;
            display.className = 'settings-value success';
        } else {
            display.textContent = '未登録';
            display.className = 'settings-value';
        }
    }

    // 体重入力フィールドに最新値をプリセット
    const input = document.getElementById('weight-input');
    if (input && latestWeight) {
        input.placeholder = `前回: ${latestWeight.weight} kg`;
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

    // ユーザーの現在体重も更新
    state.currentUser.weight = weight;
    DB.save('current_user', state.currentUser);
    const idx = state.users.findIndex(u => u.id === state.currentUser.id);
    if (idx !== -1) {
        state.users[idx] = state.currentUser;
        DB.save('users', state.users);
    }

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
 * リギングデータの読み込み
 */
async function loadRigging(boatId) {
    if (!boatId) {
        document.getElementById('rigging-form').classList.add('hidden');
        document.getElementById('rigging-empty-state').classList.remove('hidden');
        return;
    }

    const currentUser = state.currentUser;
    if (!currentUser) return;

    document.getElementById('rigging-form').classList.remove('hidden');
    document.getElementById('rigging-empty-state').classList.add('hidden');

    // Mocks for inputs
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

    // データ取得
    let riggings = DB.loadLocal('riggings') || [];
    let rigging = riggings.find(r => r.boat_id === boatId && r.user_id === currentUser.id);

    if (window.supabaseClient) {
        try {
            const { data, error } = await window.supabaseClient
                .from('riggings')
                .select('*')
                .eq('boat_id', boatId)
                .eq('user_id', currentUser.id)
                .single();

            if (data && !error) {
                rigging = data;
                // ローカルも更新
                const idx = riggings.findIndex(r => r.boat_id === boatId && r.user_id === currentUser.id);
                if (idx >= 0) riggings[idx] = rigging;
                else riggings.push(rigging);
                saveLocal('riggings', riggings);
            }
        } catch (e) {
            // console.error('Failed to fetch rigging', e); // Not found is expected
        }
    }

    if (rigging) {
        if (inputs.pin_to_heel) inputs.pin_to_heel.value = rigging.pin_to_heel || '';
        if (inputs.depth) inputs.depth.value = rigging.depth || '';
        if (inputs.span) inputs.span.value = rigging.span || '';
        if (inputs.pitch) inputs.pitch.value = rigging.pitch || '';
        if (inputs.height) inputs.height.value = rigging.height || '';
        if (inputs.memo) inputs.memo.value = rigging.memo || '';
    }
}

/**
 * リギングデータの保存
 */
async function saveRigging(boatId) {
    if (!boatId) return;

    const currentUser = state.currentUser;
    if (!currentUser) return;

    const data = {
        pin_to_heel: document.getElementById('rigging-pin-to-heel').value,
        depth: document.getElementById('rigging-depth').value,
        span: document.getElementById('rigging-span').value,
        pitch: document.getElementById('rigging-pitch').value,
        height: document.getElementById('rigging-height').value,
        memo: document.getElementById('rigging-memo').value,
        updated_at: new Date().toISOString()
    };

    // ローカル保存
    let riggings = DB.loadLocal('riggings') || [];
    const index = riggings.findIndex(r => r.boat_id === boatId && r.user_id === currentUser.id);

    let savedData;
    if (index >= 0) {
        riggings[index] = { ...riggings[index], ...data };
        savedData = riggings[index];
    } else {
        savedData = {
            id: generateId(),
            user_id: currentUser.id,
            boat_id: boatId,
            ...data,
            created_at: new Date().toISOString()
        };
        riggings.push(savedData);
    }
    saveLocal('riggings', riggings);

    // Supabase保存
    if (window.supabaseClient) {
        try {
            // upsertのためにidが必要な場合があるが、ここではuser_idとboat_idで特定したい
            // 一旦既存があるかチェック
            const { data: existing } = await window.supabaseClient
                .from('riggings')
                .select('id')
                .eq('boat_id', boatId)
                .eq('user_id', currentUser.id)
                .single();

            const upsertData = {
                user_id: currentUser.id,
                boat_id: boatId,
                ...data
            };

            if (existing) {
                upsertData.id = existing.id;
            }

            const { error } = await window.supabaseClient
                .from('riggings')
                .upsert(upsertData);

            if (error) throw error;

            showToast('リギング設定を保存しました（クラウド同期）', 'success');
        } catch (e) {
            console.error('Failed to save rigging to Supabase', e);
            showToast('リギング設定を保存しました（オフライン）', 'success');
        }
    } else {
        showToast('リギング設定を保存しました', 'success');
    }
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

        console.log('Auto-created crew note:', newNote);
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

    list.innerHTML = crews.map(crew => {
        const memberNames = crew.memberIds.map(id => {
            const user = state.users.find(u => u.id === id);
            return user ? user.name : '不明';
        }).join('・');

        // 最終練習日
        const lastDate = new Date(crew.lastPractice);
        const displayDate = `${lastDate.getMonth() + 1}/${lastDate.getDate()}`;

        return `<div class="crew-item" onclick="openCrewDetail('${crew.hash}')">
            <div class="crew-header">
                <span class="crew-boat-type">${crew.boatType || '不明'}</span>
                <span class="crew-last-date">最終: ${displayDate}</span>
            </div>
            <div class="crew-members">${memberNames}</div>
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
    const memberNames = crew.memberIds.map(id => {
        const u = state.users.find(u => u.id === id);
        return u ? u.name : '未登録';
    }).join('・');

    infoCard.innerHTML = `
        <div class="crew-members" style="font-size: 16px; margin-bottom: 8px;">${memberNames}</div>
        <div class="crew-boat-type" style="display:inline-block; margin:0;">${crew.boatType || '未設定'}</div>
    `;

    // 履歴リスト生成
    const notes = state.crewNotes.filter(n => n.crewHash === hash);
    const historyItems = notes.sort((a, b) => new Date(b.date) - new Date(a.date));

    historyList.innerHTML = historyItems.length ? historyItems.map(n => {
        const d = formatDisplayDate(n.date);
        const hasVideo = n.videoUrls && n.videoUrls.length > 0;
        return `<div class="history-item has-note" onclick="openCrewNoteEdit('${hash}', '${n.date}')">
            <div class="history-date">${d.year}/${d.month}/${d.day}（${d.weekday}）</div>
            <div class="history-preview">${n.content || '（内容なし）'}</div>
            ${n.videoUrls && n.videoUrls.length > 0 ? `<div class="video-icon">📹 動画 ${n.videoUrls.length}本</div>` : ''}
        </div>`;
    }).join('') : '<div class="empty-state"><p>ノート履歴がありません</p></div>';

    addBtn.onclick = () => {
        openCrewNoteEdit(hash, formatDate(new Date()));
    };

    modal.classList.remove('hidden');
}

// ノート編集モーダル (hashがnullの場合は新規作成)
function openCrewNoteEdit(hash, date) {
    const modal = document.getElementById('crew-note-modal');
    const dateInput = document.getElementById('crew-note-date');
    const videoBulkInput = document.getElementById('crew-note-video-bulk');
    const videoList = document.getElementById('video-list');
    const contentInput = document.getElementById('crew-note-content');
    const memberSelectGroup = document.getElementById('crew-member-select-group');
    const boatSelectGroup = document.getElementById('crew-boat-select-group');
    const previewContainer = document.getElementById('video-preview-container');

    let note = null;
    let memberIds = [];
    let boatType = '1x';
    let currentVideoUrls = []; // 編集中の一時保存

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

    // データ移行用: videoUrl(旧)があれば videoUrls(新)へ
    if (note?.videoUrl && (!note.videoUrls || note.videoUrls.length === 0)) {
        currentVideoUrls = [note.videoUrl];
    } else {
        currentVideoUrls = note?.videoUrls ? [...note.videoUrls] : [];
    }

    if (videoBulkInput) videoBulkInput.value = '';

    // 動画リスト描画関数
    const renderVideos = () => {
        if (!videoList) return;
        videoList.innerHTML = currentVideoUrls.map((url, index) => `
            <div class="video-list-item">
                <span class="video-url-text">${url}</span>
                <button class="delete-video-btn" data-index="${index}">×</button>
            </div>
        `).join('');

        // プレビューも更新
        if (previewContainer) {
            previewContainer.innerHTML = currentVideoUrls.map(url => {
                let videoId = null;
                if (url.includes('youtube.com/watch?v=')) {
                    videoId = url.split('v=')[1]?.split('&')[0];
                } else if (url.includes('youtu.be/')) {
                    videoId = url.split('youtu.be/')[1];
                }

                if (videoId) {
                    return `<div class="video-preview-item">
                        <iframe src="https://www.youtube.com/embed/${videoId}" allowfullscreen></iframe>
                    </div>`;
                } else {
                    return `<div class="video-preview-item no-embed">
                        <a href="${url}" target="_blank">🔗 動画を開く</a>
                    </div>`;
                }
            }).join('');
        }

        // 削除ボタンイベント
        if (videoList) {
            videoList.querySelectorAll('.delete-video-btn').forEach(btn => {
                btn.onclick = (e) => { // onclickに変更 (removeEventListener回避)
                    const idx = parseInt(e.target.dataset.index);
                    currentVideoUrls.splice(idx, 1);
                    renderVideos();
                };
            });
        }
    };

    renderVideos();

    // URL抽出ボタン
    const extractBtn = document.getElementById('extract-videos-btn');
    if (extractBtn) {
        extractBtn.onclick = () => {
            const text = videoBulkInput.value;
            const urls = text.match(/https?:\/\/[^\s]+/g);
            if (urls) {
                let addedCount = 0;
                urls.forEach(url => {
                    if (!currentVideoUrls.includes(url)) {
                        currentVideoUrls.push(url);
                        addedCount++;
                    }
                });
                videoBulkInput.value = ''; // クリア
                renderVideos();
                showToast(`${addedCount}件のURLを追加しました`, 'success');
            } else {
                showToast('URLが見つかりませんでした', 'info');
            }
        };
    }

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
            videoUrls: currentVideoUrls, // 配列で保存
            authorId: state.currentUser.id
        });

        modal.classList.add('hidden');

        if (hash) {
            openCrewDetail(hash); // 詳細画面更新
        } else {
            renderCrewList(); // リスト更新
        }
        showToast('保存しました', 'success');
    };

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
        // showToast('体重を入力してください', 'error');
        return;
    }

    const genderBtn = document.querySelector('#idt-gender-toggle .gender-btn.active');
    const gender = genderBtn?.dataset.gender || 'man';

    // 新計算式 (2026/02/12 User提供)
    // Men: 335.8 * (98 / W)^(2/9)
    // Women: 384.4 * (81 / W)^0.2455

    let targetSeconds;

    if (gender === 'man') {
        const base = 98.0 / weight;
        const exponent = 2.0 / 9.0;
        targetSeconds = 335.8 * Math.pow(base, exponent);
    } else {
        const base = 81.0 / weight;
        const exponent = 0.2455;
        targetSeconds = 384.4 * Math.pow(base, exponent);
    }

    // フォーマット (MM:SS.s)
    const formattedTime = formatTime(targetSeconds);

    // 500m平均ペース (targetSeconds / 4)
    const splitSeconds = targetSeconds / 4;
    const formattedSplit = formatTime(splitSeconds);

    const resultBox = document.getElementById('idt-result-box');
    resultBox.style.display = 'block';

    document.getElementById('idt-target-time').textContent = formattedTime;
    document.getElementById('idt-target-split').textContent = formattedSplit;
}

