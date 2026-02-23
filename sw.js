// Service Worker for 端艇部管理 PWA
// バージョンを更新するとキャッシュが自動リフレッシュされます
const CACHE_VERSION = 'tanteibu-v20';
const CACHE_NAME = CACHE_VERSION;

// クライアントからの更新要求を受信
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});

// キャッシュするファイル
const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/styles.css',
    '/app.js',
    '/supabase-config.js',
    '/manifest.json',
    '/icons/icon-192.png',
    '/icons/icon-512.png'
];

// インストール時: 静的アセットをキャッシュ
self.addEventListener('install', (event) => {
    console.log('[SW] Installing version:', CACHE_VERSION);
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(STATIC_ASSETS))
            .then(() => self.skipWaiting()) // 即座にアクティベート
    );
});

// アクティベート時: 古いキャッシュを削除
self.addEventListener('activate', (event) => {
    console.log('[SW] Activating version:', CACHE_VERSION);
    event.waitUntil(
        caches.keys().then(keys => {
            return Promise.all(
                keys.filter(key => key !== CACHE_NAME)
                    .map(key => {
                        console.log('[SW] Deleting old cache:', key);
                        return caches.delete(key);
                    })
            );
        }).then(() => self.clients.claim()) // 全タブを即座に制御
    );

    // 全クライアントに更新完了を通知
    self.clients.matchAll().then(clients => {
        clients.forEach(client => {
            client.postMessage({ type: 'SW_UPDATED', version: CACHE_VERSION });
        });
    });
});

// フェッチ時: Network First戦略（APIはネットワーク優先、静的ファイルはキャッシュ優先）
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // Supabase API / 外部APIはキャッシュしない
    if (url.origin !== location.origin ||
        url.pathname.startsWith('/api/') ||
        url.hostname.includes('supabase')) {
        return; // デフォルトのネットワークリクエスト
    }

    // Google Fontsはキャッシュ
    if (url.hostname.includes('fonts.googleapis.com') ||
        url.hostname.includes('fonts.gstatic.com')) {
        event.respondWith(
            caches.match(event.request).then(cached => {
                return cached || fetch(event.request).then(response => {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                    return response;
                });
            })
        );
        return;
    }

    // 静的アセット: Network First（新しいバージョンを優先取得、失敗時キャッシュ）
    event.respondWith(
        fetch(event.request)
            .then(response => {
                // 成功時はキャッシュを更新
                if (response.ok) {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                }
                return response;
            })
            .catch(() => {
                // オフライン時はキャッシュから返す
                return caches.match(event.request).then(cached => {
                    return cached || new Response('オフラインです', {
                        status: 503,
                        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
                    });
                });
            })
    );
});
