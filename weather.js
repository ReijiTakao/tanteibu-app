// ==========================================
// 天気情報モジュール (Open-Meteo JMAモデル)
// 戸田公園固定 / APIキー不要
// ==========================================

const Weather = (function () {
    'use strict';

    var LAT = 35.8156;
    var LON = 139.6731;
    var CACHE_KEY = 'weather_cache_v2';
    var CACHE_TTL = 30 * 60 * 1000;
    var CK_COMBINED = 'wc_combined';
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

    // 風向き → 方角
    function dir(deg) {
        if (deg == null) return '';
        var d = ['北', '北北東', '北東', '東北東', '東', '東南東', '南東', '南南東',
            '南', '南南西', '南西', '西南西', '西', '西北西', '北西', '北北西'];
        return d[Math.round(deg / 22.5) % 16];
    }

    // 風向き → 矢印
    function arrow(deg) {
        if (deg == null) return '';
        var a = ['↓', '↙', '←', '↖', '↑', '↗', '→', '↘'];
        return a[Math.round(deg / 45) % 8];
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

    // --- API取得 (JMAモデル) ---
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
            hourly: 'temperature_2m,weathercode,windspeed_10m,winddirection_10m',
            daily: 'weathercode,temperature_2m_max,temperature_2m_min,windspeed_10m_max,winddirection_10m_dominant',
            timezone: 'Asia/Tokyo', forecast_days: '7'
        });
        // JMAモデル（気象庁MSM/GSM）を使用
        var res = await fetch('https://api.open-meteo.com/v1/jma?' + params);
        if (!res.ok) throw new Error('Weather API ' + res.status);
        var data = await res.json();
        try { localStorage.setItem(CACHE_KEY, JSON.stringify({ timestamp: Date.now(), data: data })); } catch (e) { /* ignore */ }
        return data;
    }

    function hourlyAt(d, dateStr, h) {
        if (!d || !d.hourly || !d.hourly.time) return null;
        var t = dateStr + 'T' + String(h).padStart(2, '0') + ':00';
        var i = d.hourly.time.indexOf(t);
        if (i === -1) return null;
        return {
            temp: d.hourly.temperature_2m[i],
            code: d.hourly.weathercode[i],
            wind: d.hourly.windspeed_10m[i],
            windDir: d.hourly.winddirection_10m[i]
        };
    }

    function todayStr() {
        var t = new Date();
        return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0');
    }

    // ==========================================
    // 全体タブ: 天気+風 統合カード
    // ==========================================
    function renderCombined(data) {
        var el = document.getElementById('weather-combined-widget');
        if (!el) return;

        var today = new Date();
        var ds = todayStr();
        var am = hourlyAt(data, ds, 6);
        var pm = hourlyAt(data, ds, 15);

        var summaryParts = [];
        if (am) { var w = wmo(am.code); summaryParts.push(w.icon + Math.round(am.temp) + '°'); }
        if (pm) { var w2 = wmo(pm.code); summaryParts.push(w2.icon + Math.round(pm.temp) + '°'); }
        var summary = summaryParts.join(' / ');

        var closed = isClosed(CK_COMBINED);

        function slot(label, time, d) {
            if (!d) return '<div class="wc-slot"><span class="wc-slot-label">' + label + '</span><span class="wc-slot-na">—</span></div>';
            var w = wmo(d.code);
            var windStr = d.wind != null ? (arrow(d.windDir) + ' ' + dir(d.windDir) + ' ' + d.wind.toFixed(1) + 'm/s') : '';
            return '<div class="wc-slot">' +
                '<div class="wc-slot-label">' + label + ' <small>' + time + '</small></div>' +
                '<div class="wc-slot-icon">' + w.icon + '</div>' +
                '<div class="wc-slot-temp">' + Math.round(d.temp) + '°</div>' +
                '<div class="wc-slot-desc">' + w.label + '</div>' +
                (windStr ? '<div class="wc-slot-wind">' + windStr + '</div>' : '') +
                '</div>';
        }

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
            '<div class="wc-source">※ 気象庁 JMAモデル</div>' +
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

        var si = daily.time.indexOf(ts);
        var hSum = '';
        if (si !== -1) {
            var tw = wmo(daily.weathercode[si]);
            hSum = tw.icon + ' ' + Math.round(daily.temperature_2m_max[si]) + '°/' + Math.round(daily.temperature_2m_min[si]) + '°';
        }

        var closed = isClosed(CK_WEEKLY);
        var days = '';

        for (var i = 0; i < daily.time.length; i++) {
            var dateStr = daily.time[i];
            var dt = new Date(dateStr + 'T00:00:00+09:00');
            var dw = dt.getDay();
            var w = wmo(daily.weathercode[i]);
            var isT = dateStr === ts;
            var cls = (dw === 0 ? ' wfw-sun' : dw === 6 ? ' wfw-sat' : '') + (isT ? ' wfw-today' : '');
            var windMax = daily.windspeed_10m_max ? daily.windspeed_10m_max[i] : null;
            var windDom = daily.winddirection_10m_dominant ? daily.winddirection_10m_dominant[i] : null;
            var windLine = '';
            if (windMax != null) {
                windLine = '<div class="wfw-day-wind">' + arrow(windDom) + windMax.toFixed(0) + '<small>m/s</small></div>';
            }

            days +=
                '<div class="wfw-day' + cls + '">' +
                '<div class="wfw-day-name">' + (isT ? '今日' : dn[dw]) + '</div>' +
                '<div class="wfw-day-date">' + (dt.getMonth() + 1) + '/' + dt.getDate() + '</div>' +
                '<div class="wfw-day-icon">' + w.icon + '</div>' +
                '<div class="wfw-day-temps">' +
                '<span class="wfw-temp-max">' + Math.round(daily.temperature_2m_max[i]) + '°</span>' +
                '<span class="wfw-temp-min">' + Math.round(daily.temperature_2m_min[i]) + '°</span>' +
                '</div>' +
                windLine +
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

    function toggleCombined() { toggle(CK_COMBINED, 'wc-body', 'wc-arrow'); }
    function toggleWeekly() { toggle(CK_WEEKLY, 'wfw-scroll-body', 'wfw-expand-icon'); }

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
        toggleWeekly: toggleWeekly
    };
})();
