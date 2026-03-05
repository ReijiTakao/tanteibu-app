// ==========================================
// 天気情報モジュール (Open-Meteo + Windy埋込み)
// 戸田公園固定 / APIキー不要
// ==========================================

const Weather = (function () {
    'use strict';

    // 戸田公園の座標
    var LAT = 35.8156;
    var LON = 139.6731;

    // キャッシュキー・有効期間(30分)
    var CACHE_KEY = 'weather_cache';
    var CACHE_TTL = 30 * 60 * 1000;

    // 折りたたみ状態キー
    var CK_COMBINED = 'wc_combined';
    var CK_WINDY = 'wc_windy';
    var CK_WEEKLY = 'wc_weekly';

    // WMO Weather Code → 天気情報
    function wmo(code) {
        if (code === 0) return { icon: '☀️', label: '快晴' };
        if (code === 1) return { icon: '🌤️', label: '晴れ' };
        if (code === 2) return { icon: '⛅', label: 'くもり時々晴れ' };
        if (code === 3) return { icon: '☁️', label: 'くもり' };
        if (code === 45 || code === 48) return { icon: '🌫️', label: '霧' };
        if (code >= 51 && code <= 57) return { icon: '🌦️', label: '霧雨' };
        if (code >= 61 && code <= 67) return { icon: '🌧️', label: '雨' };
        if (code >= 71 && code <= 77) return { icon: '❄️', label: '雪' };
        if (code >= 80 && code <= 82) return { icon: '🌧️', label: 'にわか雨' };
        if (code >= 85 && code <= 86) return { icon: '❄️', label: 'にわか雪' };
        if (code >= 95) return { icon: '⛈️', label: '雷雨' };
        return { icon: '🌤️', label: '晴れ' };
    }

    // 折りたたみ（デフォルト閉じ）
    function isClosed(key) { return localStorage.getItem(key) !== '0'; }
    function toggle(key, bodyId, iconId) {
        var b = document.getElementById(bodyId);
        var i = document.getElementById(iconId);
        if (!b) return;
        var closed = b.classList.toggle('hidden');
        localStorage.setItem(key, closed ? '1' : '0');
        if (i) i.textContent = closed ? '▼' : '▲';
    }

    // --- API取得 ---
    async function fetchData() {
        try {
            var c = localStorage.getItem(CACHE_KEY);
            if (c) {
                var p = JSON.parse(c);
                if (p.timestamp && Date.now() - p.timestamp < CACHE_TTL) return p.data;
            }
        } catch (e) { /* ignore */ }

        var params = new URLSearchParams({
            latitude: LAT, longitude: LON,
            hourly: 'temperature_2m,weathercode',
            daily: 'weathercode,temperature_2m_max,temperature_2m_min',
            timezone: 'Asia/Tokyo', forecast_days: '7'
        });
        var res = await fetch('https://api.open-meteo.com/v1/forecast?' + params);
        if (!res.ok) throw new Error('Weather API ' + res.status);
        var data = await res.json();
        try { localStorage.setItem(CACHE_KEY, JSON.stringify({ timestamp: Date.now(), data: data })); } catch (e) { /* ignore */ }
        return data;
    }

    // hourlyからデータ抽出
    function hourly(d, dateStr, h) {
        if (!d || !d.hourly || !d.hourly.time) return null;
        var t = dateStr + 'T' + String(h).padStart(2, '0') + ':00';
        var i = d.hourly.time.indexOf(t);
        if (i === -1) return null;
        return { temp: d.hourly.temperature_2m[i], code: d.hourly.weathercode[i] };
    }

    // 今日の日付文字列
    function todayStr() {
        var t = new Date();
        return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0');
    }

    // ==========================================
    // 全体タブ: 天気+Windy 統合カード
    // ==========================================
    function renderCombined(data) {
        var el = document.getElementById('weather-combined-widget');
        if (!el) return;

        var today = new Date();
        var ds = todayStr();
        var am = hourly(data, ds, 6);
        var pm = hourly(data, ds, 15);

        // ヘッダーサマリー（常時表示）
        var summaryParts = [];
        if (am) { var w = wmo(am.code); summaryParts.push(w.icon + Math.round(am.temp) + '°'); }
        if (pm) { var w2 = wmo(pm.code); summaryParts.push(w2.icon + Math.round(pm.temp) + '°'); }
        var summary = summaryParts.join(' / ');

        var closed = isClosed(CK_COMBINED);

        // 天気スロット
        function slot(label, time, d) {
            if (!d) return '<div class="wc-slot"><span class="wc-slot-label">' + label + '</span><span class="wc-slot-na">—</span></div>';
            var w = wmo(d.code);
            return '<div class="wc-slot">' +
                '<div class="wc-slot-label">' + label + ' <small>' + time + '</small></div>' +
                '<div class="wc-slot-icon">' + w.icon + '</div>' +
                '<div class="wc-slot-temp">' + Math.round(d.temp) + '°</div>' +
                '<div class="wc-slot-desc">' + w.label + '</div>' +
                '</div>';
        }

        // Windy iframe
        var windyClosed = isClosed(CK_WINDY);
        var windySrc = 'https://embed.windy.com/embed2.html' +
            '?lat=' + LAT + '&lon=' + LON +
            '&detailLat=' + LAT + '&detailLon=' + LON +
            '&zoom=11&level=surface&overlay=wind&product=ecmwf' +
            '&marker=true&calendar=now&type=map&location=coordinates' +
            '&metricWind=m%2Fs&metricTemp=%C2%B0C';

        el.innerHTML =
            '<div class="wc-header" onclick="Weather.toggleCombined()">' +
            '<span class="wc-title">🌤️ 戸田の天気</span>' +
            '<span class="wc-summary">' + summary + '</span>' +
            '<span class="wc-date">' + (today.getMonth() + 1) + '/' + today.getDate() + '</span>' +
            '<span class="wc-arrow" id="wc-arrow">' + (closed ? '▼' : '▲') + '</span>' +
            '</div>' +
            '<div class="wc-body' + (closed ? ' hidden' : '') + '" id="wc-body">' +
            '<div class="wc-slots">' +
            slot('朝練', '6:00', am) +
            slot('午後練', '15:00', pm) +
            '</div>' +
            '<div class="wc-windy-section">' +
            '<div class="wc-windy-toggle" onclick="event.stopPropagation();Weather.toggleWindy()">' +
            '<span class="wc-windy-label">💨 風マップ (Windy)</span>' +
            '<span class="wc-windy-arrow" id="wc-windy-arrow">' + (windyClosed ? '▼' : '▲') + '</span>' +
            '</div>' +
            '<div class="wc-windy-body' + (windyClosed ? ' hidden' : '') + '" id="wc-windy-body">' +
            '<iframe class="wc-windy-iframe" src="' + windySrc + '" frameborder="0" loading="lazy"></iframe>' +
            '</div>' +
            '</div>' +
            '</div>';
    }

    // ==========================================
    // 練習登録タブ: コンパクト週間天気
    // ==========================================
    function renderWeekly(data) {
        var el = document.getElementById('weekly-weather-widget');
        if (!el) return;
        if (!data || !data.daily || !data.daily.time) { el.innerHTML = ''; return; }

        var daily = data.daily;
        var dn = ['日', '月', '火', '水', '木', '金', '土'];
        var ts = todayStr();

        // ヘッダーサマリー
        var si = daily.time.indexOf(ts);
        var hSum = '';
        if (si !== -1) {
            var tw = wmo(daily.weathercode[si]);
            hSum = tw.icon + ' ' + Math.round(daily.temperature_2m_max[si]) + '°/' + Math.round(daily.temperature_2m_min[si]) + '°';
        }

        var closed = isClosed(CK_WEEKLY);
        var days = '';

        for (var i = 0; i < daily.time.length; i++) {
            var ds = daily.time[i];
            var dt = new Date(ds + 'T00:00:00+09:00');
            var dw = dt.getDay();
            var w = wmo(daily.weathercode[i]);
            var isT = ds === ts;
            var cls = (dw === 0 ? ' wfw-sun' : dw === 6 ? ' wfw-sat' : '') + (isT ? ' wfw-today' : '');

            days +=
                '<div class="wfw-day' + cls + '">' +
                '<div class="wfw-day-name">' + (isT ? '今日' : dn[dw]) + '</div>' +
                '<div class="wfw-day-date">' + (dt.getMonth() + 1) + '/' + dt.getDate() + '</div>' +
                '<div class="wfw-day-icon">' + w.icon + '</div>' +
                '<div class="wfw-day-temps">' +
                '<span class="wfw-temp-max">' + Math.round(daily.temperature_2m_max[i]) + '°</span>' +
                '<span class="wfw-temp-min">' + Math.round(daily.temperature_2m_min[i]) + '°</span>' +
                '</div>' +
                '</div>';
        }

        el.innerHTML =
            '<div class="wfw-header" onclick="Weather.toggleWeekly()">' +
            '<span class="wfw-title">🌤️ 週間天気</span>' +
            '<span class="wfw-header-summary">' + hSum + '</span>' +
            '<span class="wfw-expand" id="wfw-expand-icon">' + (closed ? '▼' : '▲') + '</span>' +
            '</div>' +
            '<div class="wfw-scroll' + (closed ? ' hidden' : '') + '" id="wfw-scroll-body">' + days + '</div>';
    }

    // --- 公開トグル ---
    function toggleCombined() { toggle(CK_COMBINED, 'wc-body', 'wc-arrow'); }
    function toggleWindy() { toggle(CK_WINDY, 'wc-windy-body', 'wc-windy-arrow'); }
    function toggleWeekly() { toggle(CK_WEEKLY, 'wfw-scroll-body', 'wfw-expand-icon'); }

    // --- 初期化 ---
    async function init() {
        try {
            var data = await fetchData();
            renderCombined(data);
            renderWeekly(data);
        } catch (e) {
            console.warn('天気情報の取得に失敗:', e);
            var c = document.getElementById('weather-combined-widget');
            var w = document.getElementById('weekly-weather-widget');
            if (c) c.innerHTML = '';
            if (w) w.innerHTML = '';
        }
    }

    return {
        init: init,
        toggleCombined: toggleCombined,
        toggleWindy: toggleWindy,
        toggleWeekly: toggleWeekly
    };
})();
