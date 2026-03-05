// ==========================================
// 天気情報モジュール (Open-Meteo API + Windy埋込み)
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
    const COLLAPSE_KEY_WINDY = 'weather_windy_collapsed';

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

    // 折りたたみ状態の取得（デフォルトは閉じた状態）
    function isCollapsed(key) {
        return localStorage.getItem(key) !== '0';
    }

    // 折りたたみトグル
    function toggleCollapse(key, bodyId, iconId) {
        var body = document.getElementById(bodyId);
        var icon = document.getElementById(iconId);
        if (!body) return;
        var collapsed = body.classList.toggle('hidden');
        localStorage.setItem(key, collapsed ? '1' : '0');
        if (icon) icon.textContent = collapsed ? '▼' : '▲';
    }

    // Open-Meteo APIからデータ取得
    async function fetchWeatherData() {
        try {
            var cached = localStorage.getItem(CACHE_KEY);
            if (cached) {
                var parsed = JSON.parse(cached);
                if (parsed.timestamp && Date.now() - parsed.timestamp < CACHE_TTL) {
                    return parsed.data;
                }
            }
        } catch (e) {
            // キャッシュ破損は無視
        }

        var params = new URLSearchParams({
            latitude: LAT,
            longitude: LON,
            hourly: 'temperature_2m,weathercode',
            daily: 'weathercode,temperature_2m_max,temperature_2m_min',
            timezone: 'Asia/Tokyo',
            forecast_days: '7'
        });

        var url = 'https://api.open-meteo.com/v1/forecast?' + params.toString();
        var response = await fetch(url);
        if (!response.ok) {
            throw new Error('Weather API error: ' + response.status);
        }

        var data = await response.json();

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

        var targetTime = dateStr + 'T' + String(hour).padStart(2, '0') + ':00';
        var idx = weatherData.hourly.time.indexOf(targetTime);
        if (idx === -1) return null;

        return {
            temp: weatherData.hourly.temperature_2m[idx],
            weatherCode: weatherData.hourly.weathercode[idx]
        };
    }

    // ===== 全体タブ: 今日の天気ウィジェット =====
    function renderTodayWeather(weatherData) {
        var container = document.getElementById('today-weather-widget');
        if (!container) return;

        var today = new Date();
        var dateStr = today.getFullYear() + '-' +
            String(today.getMonth() + 1).padStart(2, '0') + '-' +
            String(today.getDate()).padStart(2, '0');

        var morningData = getHourlyData(weatherData, dateStr, 6);
        var afternoonData = getHourlyData(weatherData, dateStr, 15);

        if (!morningData && !afternoonData) {
            container.innerHTML = '';
            return;
        }

        // ヘッダー用サマリー
        var mIcon = morningData ? interpretWeatherCode(morningData.weatherCode).icon : '';
        var aIcon = afternoonData ? interpretWeatherCode(afternoonData.weatherCode).icon : '';
        var mTemp = morningData ? Math.round(morningData.temp) + '°' : '';
        var aTemp = afternoonData ? Math.round(afternoonData.temp) + '°' : '';
        var summary = mIcon + mTemp + ' / ' + aIcon + aTemp;

        var collapsed = isCollapsed(COLLAPSE_KEY_TODAY);

        var renderSlot = function (label, time, data) {
            if (!data) return '<div class="wtw-slot wtw-slot-empty"><span class="wtw-slot-label">' + label + '</span><span class="wtw-slot-na">データなし</span></div>';

            var weather = interpretWeatherCode(data.weatherCode);

            return '<div class="wtw-slot">' +
                '<div class="wtw-slot-label">' + label + ' <span class="wtw-slot-time">' + time + '</span></div>' +
                '<div class="wtw-slot-main">' +
                '<span class="wtw-icon">' + weather.icon + '</span>' +
                '<span class="wtw-temp">' + Math.round(data.temp) + '<small>°C</small></span>' +
                '</div>' +
                '<div class="wtw-slot-sub">' + weather.label + '</div>' +
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

    // ===== 練習登録タブ: 週間天気予報 =====
    function renderWeeklyWeather(weatherData) {
        var container = document.getElementById('weekly-weather-widget');
        if (!container) return;

        if (!weatherData || !weatherData.daily || !weatherData.daily.time) {
            container.innerHTML = '';
            return;
        }

        var daily = weatherData.daily;
        var dayNames = ['日', '月', '火', '水', '木', '金', '土'];
        var today = new Date();
        var todayStr = today.getFullYear() + '-' +
            String(today.getMonth() + 1).padStart(2, '0') + '-' +
            String(today.getDate()).padStart(2, '0');

        // ヘッダーサマリー
        var todaySummary = '';
        var todayIdx = daily.time.indexOf(todayStr);
        if (todayIdx !== -1) {
            var tw = interpretWeatherCode(daily.weathercode[todayIdx]);
            todaySummary = tw.icon + ' ' + Math.round(daily.temperature_2m_max[todayIdx]) + '°/' + Math.round(daily.temperature_2m_min[todayIdx]) + '°';
        }

        var collapsed = isCollapsed(COLLAPSE_KEY_WEEKLY);

        var daysHtml = '';
        for (var i = 0; i < daily.time.length; i++) {
            var dateStr = daily.time[i];
            var d = new Date(dateStr + 'T00:00:00+09:00');
            var dayName = dayNames[d.getDay()];
            var month = d.getMonth() + 1;
            var date = d.getDate();
            var weather = interpretWeatherCode(daily.weathercode[i]);
            var tMax = Math.round(daily.temperature_2m_max[i]);
            var tMin = Math.round(daily.temperature_2m_min[i]);
            var isTodayFlag = dateStr === todayStr;
            var dayClass = d.getDay() === 0 ? ' wfw-sun' : d.getDay() === 6 ? ' wfw-sat' : '';
            var todayClass = isTodayFlag ? ' wfw-today' : '';

            daysHtml +=
                '<div class="wfw-day' + dayClass + todayClass + '">' +
                '<div class="wfw-day-name">' + (isTodayFlag ? '今日' : dayName) + '</div>' +
                '<div class="wfw-day-date">' + month + '/' + date + '</div>' +
                '<div class="wfw-day-icon">' + weather.icon + '</div>' +
                '<div class="wfw-day-temps">' +
                '<span class="wfw-temp-max">' + tMax + '°</span>' +
                '<span class="wfw-temp-min">' + tMin + '°</span>' +
                '</div>' +
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

    // ===== Windy風マップウィジェット =====
    function renderWindyWidget() {
        var container = document.getElementById('windy-weather-widget');
        if (!container) return;

        var collapsed = isCollapsed(COLLAPSE_KEY_WINDY);

        var windySrc = 'https://embed.windy.com/embed2.html' +
            '?lat=' + LAT +
            '&lon=' + LON +
            '&detailLat=' + LAT +
            '&detailLon=' + LON +
            '&zoom=11' +
            '&level=surface' +
            '&overlay=wind' +
            '&product=ecmwf' +
            '&marker=true' +
            '&calendar=now' +
            '&type=map' +
            '&location=coordinates' +
            '&metricWind=m%2Fs' +
            '&metricTemp=%C2%B0C';

        container.innerHTML =
            '<div class="windy-header" onclick="Weather.toggleWindy()">' +
            '<span class="windy-title">💨 戸田の風 (Windy)</span>' +
            '<span class="windy-expand" id="windy-expand-icon">' + (collapsed ? '▼' : '▲') + '</span>' +
            '</div>' +
            '<div class="windy-body' + (collapsed ? ' hidden' : '') + '" id="windy-body">' +
            '<iframe class="windy-iframe" src="' + windySrc + '" frameborder="0" loading="lazy"></iframe>' +
            '</div>';
    }

    // 折りたたみ公開関数
    function toggleToday() {
        toggleCollapse(COLLAPSE_KEY_TODAY, 'wtw-body', 'wtw-expand-icon');
    }

    function toggleWeekly() {
        toggleCollapse(COLLAPSE_KEY_WEEKLY, 'wfw-scroll-body', 'wfw-expand-icon');
    }

    function toggleWindy() {
        toggleCollapse(COLLAPSE_KEY_WINDY, 'windy-body', 'windy-expand-icon');
    }

    // ===== 初期化 =====
    async function init() {
        try {
            var data = await fetchWeatherData();
            renderTodayWeather(data);
            renderWeeklyWeather(data);
        } catch (e) {
            console.warn('天気情報の取得に失敗:', e);
            var todayEl = document.getElementById('today-weather-widget');
            var weeklyEl = document.getElementById('weekly-weather-widget');
            if (todayEl) todayEl.innerHTML = '';
            if (weeklyEl) weeklyEl.innerHTML = '';
        }
        // Windy埋込みは常に表示（API不要）
        renderWindyWidget();
    }

    return {
        init: init,
        toggleToday: toggleToday,
        toggleWeekly: toggleWeekly,
        toggleWindy: toggleWindy
    };
})();
