// ==========================================
// 天気情報モジュール (Open-Meteo API)
// 戸田公園固定 / APIキー不要
// ==========================================

const Weather = (function () {
    'use strict';

    // 戸田公園の座標
    const LAT = 35.8156;
    const LON = 139.6731;

    // キャッシュキー・有効期間(30分)
    const CACHE_KEY = 'weather_cache';
    const CACHE_TTL = 30 * 60 * 1000;

    // 折りたたみ状態キー
    const COLLAPSE_KEY_TODAY = 'weather_today_collapsed';
    const COLLAPSE_KEY_WEEKLY = 'weather_weekly_collapsed';

    // WMO Weather Code → 天気情報マッピング
    function interpretWeatherCode(code) {
        if (code === 0) return { icon: '☀️', label: '快晴' };
        if (code === 1) return { icon: '🌤️', label: '晴れ' };
        if (code === 2) return { icon: '⛅', label: '曇り時々晴れ' };
        if (code === 3) return { icon: '☁️', label: '曇り' };
        if (code === 45 || code === 48) return { icon: '🌫️', label: '霧' };
        if (code >= 51 && code <= 55) return { icon: '🌦️', label: '霧雨' };
        if (code >= 56 && code <= 57) return { icon: '🌧️', label: '着氷性霧雨' };
        if (code >= 61 && code <= 65) return { icon: '🌧️', label: '雨' };
        if (code >= 66 && code <= 67) return { icon: '🌧️', label: '着氷性の雨' };
        if (code >= 71 && code <= 75) return { icon: '❄️', label: '雪' };
        if (code === 77) return { icon: '❄️', label: '霧雪' };
        if (code >= 80 && code <= 82) return { icon: '🌧️', label: 'にわか雨' };
        if (code >= 85 && code <= 86) return { icon: '❄️', label: 'にわか雪' };
        if (code >= 95 && code <= 99) return { icon: '⛈️', label: '雷雨' };
        return { icon: '🌤️', label: '晴れ' };
    }

    // 風向き（度）→ 方角テキスト
    function degreeToDirection(deg) {
        if (deg == null) return '';
        const dirs = ['北', '北北東', '北東', '東北東', '東', '東南東', '南東', '南南東',
            '南', '南南西', '南西', '西南西', '西', '西北西', '北西', '北北西'];
        const idx = Math.round(deg / 22.5) % 16;
        return dirs[idx];
    }

    // 風向き → 矢印アイコン
    function degreeToArrow(deg) {
        if (deg == null) return '';
        const arrows = ['↓', '↙', '←', '↖', '↑', '↗', '→', '↘'];
        const idx = Math.round(deg / 45) % 8;
        return arrows[idx];
    }

    // 折りたたみ状態の取得
    function isCollapsed(key) {
        return localStorage.getItem(key) === '1';
    }

    // 折りたたみトグル
    function toggleCollapse(key, bodyId, iconId) {
        const body = document.getElementById(bodyId);
        const icon = document.getElementById(iconId);
        if (!body) return;
        const collapsed = body.classList.toggle('hidden');
        localStorage.setItem(key, collapsed ? '1' : '0');
        if (icon) icon.textContent = collapsed ? '▼' : '▲';
    }

    // Open-Meteo APIからデータ取得
    async function fetchWeatherData() {
        try {
            const cached = localStorage.getItem(CACHE_KEY);
            if (cached) {
                const parsed = JSON.parse(cached);
                if (parsed.timestamp && Date.now() - parsed.timestamp < CACHE_TTL) {
                    return parsed.data;
                }
            }
        } catch (e) {
            // キャッシュ破損は無視
        }

        const params = new URLSearchParams({
            latitude: LAT,
            longitude: LON,
            hourly: 'temperature_2m,weathercode,windspeed_10m,winddirection_10m',
            daily: 'weathercode,temperature_2m_max,temperature_2m_min,windspeed_10m_max',
            timezone: 'Asia/Tokyo',
            forecast_days: '7'
        });

        const url = 'https://api.open-meteo.com/v1/forecast?' + params.toString();
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error('Weather API error: ' + response.status);
        }

        const data = await response.json();

        try {
            localStorage.setItem(CACHE_KEY, JSON.stringify({
                timestamp: Date.now(),
                data: data
            }));
        } catch (e) {
            // localStorage容量超過は無視
        }

        return data;
    }

    // hourlyデータから特定時刻のデータを抽出
    function getHourlyData(weatherData, dateStr, hour) {
        if (!weatherData || !weatherData.hourly || !weatherData.hourly.time) return null;

        const targetTime = dateStr + 'T' + String(hour).padStart(2, '0') + ':00';
        const idx = weatherData.hourly.time.indexOf(targetTime);
        if (idx === -1) return null;

        return {
            temp: weatherData.hourly.temperature_2m[idx],
            weatherCode: weatherData.hourly.weathercode[idx],
            windSpeed: weatherData.hourly.windspeed_10m[idx],
            windDir: weatherData.hourly.winddirection_10m[idx]
        };
    }

    // ===== 全体タブ: 今日の天気ウィジェット（折りたたみ対応） =====
    function renderTodayWeather(weatherData) {
        const container = document.getElementById('today-weather-widget');
        if (!container) return;

        const today = new Date();
        const dateStr = today.getFullYear() + '-' +
            String(today.getMonth() + 1).padStart(2, '0') + '-' +
            String(today.getDate()).padStart(2, '0');

        const morningData = getHourlyData(weatherData, dateStr, 6);
        const afternoonData = getHourlyData(weatherData, dateStr, 15);

        if (!morningData && !afternoonData) {
            container.innerHTML = '';
            return;
        }

        // ヘッダー用のサマリー（折りたたみ時に表示）
        const mIcon = morningData ? interpretWeatherCode(morningData.weatherCode).icon : '';
        const aIcon = afternoonData ? interpretWeatherCode(afternoonData.weatherCode).icon : '';
        const mTemp = morningData ? Math.round(morningData.temp) + '°' : '';
        const aTemp = afternoonData ? Math.round(afternoonData.temp) + '°' : '';
        const summary = mIcon + mTemp + ' / ' + aIcon + aTemp;

        const collapsed = isCollapsed(COLLAPSE_KEY_TODAY);

        const renderSlot = (label, time, data) => {
            if (!data) return '<div class="wtw-slot wtw-slot-empty"><span class="wtw-slot-label">' + label + '</span><span class="wtw-slot-na">データなし</span></div>';

            const weather = interpretWeatherCode(data.weatherCode);
            const arrow = degreeToArrow(data.windDir);
            const dir = degreeToDirection(data.windDir);

            return '<div class="wtw-slot">' +
                '<div class="wtw-slot-label">' + label + ' <span class="wtw-slot-time">' + time + '</span></div>' +
                '<div class="wtw-slot-main">' +
                '<span class="wtw-icon">' + weather.icon + '</span>' +
                '<span class="wtw-temp">' + Math.round(data.temp) + '<small>°C</small></span>' +
                '</div>' +
                '<div class="wtw-slot-sub">' + weather.label + '</div>' +
                '<div class="wtw-slot-wind">' +
                '<span class="wtw-wind-arrow">' + arrow + '</span> ' +
                dir + ' ' + data.windSpeed.toFixed(1) + '<small>m/s</small>' +
                '</div>' +
                '</div>';
        };

        container.innerHTML =
            '<div class="wtw-header" onclick="Weather.toggleToday()">' +
            '<span class="wtw-title">🌤️ 戸田の天気</span>' +
            '<span class="wtw-header-summary">' + summary + '</span>' +
            '<span class="wtw-expand" id="wtw-expand-icon">' + (collapsed ? '▼' : '▲') + '</span>' +
            '</div>' +
            '<div class="wtw-body' + (collapsed ? ' hidden' : '') + '" id="wtw-body">' +
            renderSlot('朝練', '6:00', morningData) +
            '<div class="wtw-divider"></div>' +
            renderSlot('午後練', '15:00', afternoonData) +
            '</div>';
    }

    // ===== 練習登録タブ: 週間天気予報（折りたたみ対応） =====
    function renderWeeklyWeather(weatherData) {
        const container = document.getElementById('weekly-weather-widget');
        if (!container) return;

        if (!weatherData || !weatherData.daily || !weatherData.daily.time) {
            container.innerHTML = '';
            return;
        }

        const daily = weatherData.daily;
        const dayNames = ['日', '月', '火', '水', '木', '金', '土'];
        const today = new Date();
        const todayStr = today.getFullYear() + '-' +
            String(today.getMonth() + 1).padStart(2, '0') + '-' +
            String(today.getDate()).padStart(2, '0');

        // ヘッダーサマリー：今日のアイコン＋気温
        let todaySummary = '';
        const todayIdx = daily.time.indexOf(todayStr);
        if (todayIdx !== -1) {
            const tw = interpretWeatherCode(daily.weathercode[todayIdx]);
            todaySummary = tw.icon + ' ' + Math.round(daily.temperature_2m_max[todayIdx]) + '°/' + Math.round(daily.temperature_2m_min[todayIdx]) + '°';
        }

        const collapsed = isCollapsed(COLLAPSE_KEY_WEEKLY);

        let daysHtml = '';
        for (let i = 0; i < daily.time.length; i++) {
            const dateStr = daily.time[i];
            const d = new Date(dateStr + 'T00:00:00+09:00');
            const dayName = dayNames[d.getDay()];
            const month = d.getMonth() + 1;
            const date = d.getDate();
            const weather = interpretWeatherCode(daily.weathercode[i]);
            const tMax = Math.round(daily.temperature_2m_max[i]);
            const tMin = Math.round(daily.temperature_2m_min[i]);
            const wind = daily.windspeed_10m_max[i];
            const isTodayFlag = dateStr === todayStr;
            const dayClass = d.getDay() === 0 ? ' wfw-sun' : d.getDay() === 6 ? ' wfw-sat' : '';
            const todayClass = isTodayFlag ? ' wfw-today' : '';

            const morningH = getHourlyData(weatherData, dateStr, 6);
            const afternoonH = getHourlyData(weatherData, dateStr, 15);

            let windDetail = '';
            if (morningH) {
                windDetail += '<div class="wfw-wind-row"><span class="wfw-wind-label">朝</span>' +
                    degreeToArrow(morningH.windDir) + ' ' + morningH.windSpeed.toFixed(1) + '<small>m/s</small></div>';
            }
            if (afternoonH) {
                windDetail += '<div class="wfw-wind-row"><span class="wfw-wind-label">午後</span>' +
                    degreeToArrow(afternoonH.windDir) + ' ' + afternoonH.windSpeed.toFixed(1) + '<small>m/s</small></div>';
            }
            if (!windDetail) {
                windDetail = '<div class="wfw-wind-row">最大 ' + wind.toFixed(1) + '<small>m/s</small></div>';
            }

            daysHtml +=
                '<div class="wfw-day' + dayClass + todayClass + '">' +
                '<div class="wfw-day-name">' + (isTodayFlag ? '今日' : dayName) + '</div>' +
                '<div class="wfw-day-date">' + month + '/' + date + '</div>' +
                '<div class="wfw-day-icon">' + weather.icon + '</div>' +
                '<div class="wfw-day-temps">' +
                '<span class="wfw-temp-max">' + tMax + '°</span>' +
                '<span class="wfw-temp-min">' + tMin + '°</span>' +
                '</div>' +
                '<div class="wfw-day-wind">' + windDetail + '</div>' +
                '</div>';
        }

        container.innerHTML =
            '<div class="wfw-header" onclick="Weather.toggleWeekly()">' +
            '<span class="wfw-title">🌤️ 戸田 週間天気</span>' +
            '<span class="wfw-header-summary">' + todaySummary + '</span>' +
            '<span class="wfw-expand" id="wfw-expand-icon">' + (collapsed ? '▼' : '▲') + '</span>' +
            '</div>' +
            '<div class="wfw-scroll' + (collapsed ? ' hidden' : '') + '" id="wfw-scroll-body">' + daysHtml + '</div>';
    }

    // 折りたたみトグル公開関数
    function toggleToday() {
        toggleCollapse(COLLAPSE_KEY_TODAY, 'wtw-body', 'wtw-expand-icon');
    }

    function toggleWeekly() {
        toggleCollapse(COLLAPSE_KEY_WEEKLY, 'wfw-scroll-body', 'wfw-expand-icon');
    }

    // ===== 初期化 =====
    async function init() {
        try {
            const data = await fetchWeatherData();
            renderTodayWeather(data);
            renderWeeklyWeather(data);
        } catch (e) {
            console.warn('天気情報の取得に失敗:', e);
            const todayEl = document.getElementById('today-weather-widget');
            const weeklyEl = document.getElementById('weekly-weather-widget');
            if (todayEl) todayEl.innerHTML = '';
            if (weeklyEl) weeklyEl.innerHTML = '';
        }
    }

    return {
        init: init,
        toggleToday: toggleToday,
        toggleWeekly: toggleWeekly
    };
})();
