#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CACHE_DIR = path.join(ROOT, '.local', 'strategy-cache');
const REPORT_DIR = path.join(ROOT, '.local', 'strategy-reports');
const UNIVERSE_PATH = path.join(ROOT, 'strategy-validation-universe.json');

const PHASES = new Set(['seed', 'phase1']);
const INDEX_IDS = ['sh', 'hs300', 'zz500', 'zz1000', 'sz', 'cy', 'kc50'];
const CORE_INDEX_IDS = ['hs300', 'zz500', 'zz1000'];
const STRONG_EXITS = new Set(['L3', 'L4', 'L9', 'L10']);
const STRATEGIES = {
    '稳健趋势型': { buySignals: ['B1','B2','B3','B4','B10','B12','B13','B14','B15'], exitSignals: ['L1','L2','L3','L4','L9','L10'], warningSignals: ['W1'], scoreGroups: [['B1','B10','B13','B15'],['B2','B12'],['B4','B14']], windowDays: 12, buyThreshold: 5, watchPosition: 0 },
    '波段抄底型': { buySignals: ['B5','B6','B7','B8','B9','B11','B16','B17'], exitSignals: ['L3','L5','L10'], warningSignals: ['W1','L9'], scoreGroups: [['B5','B6','B11','B16'],['B7','B8'],['B17']], windowSignalGuards: { B8: { recentDays: 3, companionSignals: ['B5','B6','B9','B11','B16','B17'] } }, windowDays: 10, buyThreshold: 4, holdThreshold: 3, watchPosition: 30, softInvalidationGraceDays: 1, monotonicSignalLifecycle: true },
    '突破追涨型': { buySignals: ['B3','B4','B14'], exitSignals: ['L4','L5','L6','L9'], warningSignals: ['W1','L10'], signalWeights: { B3: 1, B4: 3, B14: 4 }, scoreGroups: [['B4','B14']], windowDays: 8, buyThreshold: 4, watchPosition: 0 },
    '综合全能型': { buySignals: ['B1','B2','B3','B4','B5','B6','B7','B9','B10','B11','B12','B14','B15','B16','B17'], exitSignals: ['L1','L2','L3','L4','L5','L6','L9','L10'], warningSignals: ['W1'], scoreGroups: [['B1','B10','B15'],['B2','B12'],['B4','B14'],['B5','B6','B11','B16'],['B7'],['B17']], windowDays: 12, buyThreshold: 6, watchPosition: 30, watchPositionSignals: ['B5','B6','B7','B9','B11','B16','B17'] }
};
const STRATEGY_NAMES = Object.keys(STRATEGIES);
const SIGNAL_SCORES = { B1:3, B2:3, B3:2, B4:2, B5:2, B6:2, B7:1, B8:1, B9:4, B10:2, B11:2, B12:3, B13:3, B14:2, B15:2, B16:3, B17:3, B18:2 };
const VARIANTS = {
    l12_strong_regular: { mode: 'regular', action: 'strongExit', desc: 'L12 regular: 强离场并进入3日冷静期' },
    l12_reduce_regular: { mode: 'regular', action: 'reduce', cap: 30, desc: 'L12 regular: 当日普通减仓观察，上限30' },
    l12_cap50_regular: { mode: 'regular', action: 'cap', cap: 50, threshold: 80, desc: 'L12 regular: 已有持仓且目标仓位>=80时上限50' },
    l12_cap30_regular: { mode: 'regular', action: 'cap', cap: 30, threshold: 80, desc: 'L12 regular: 已有持仓且目标仓位>=80时上限30' },
    l12_reduce_strict: { mode: 'strict', action: 'reduce', cap: 30, desc: 'L12 strict: 跌破ATR移动止损且破近10日低收，普通减仓观察' }
};

function readJson(file) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function round(value, digits = 4) {
    return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function avg(values) {
    const list = values.filter(Number.isFinite);
    return list.length ? list.reduce((sum, value) => sum + value, 0) / list.length : NaN;
}

function ma(data, n, accessor = item => item.close) {
    const result = Array(data.length).fill(null);
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
        sum += accessor(data[i]) || 0;
        if (i >= n) sum -= accessor(data[i - n]) || 0;
        if (i >= n - 1) result[i] = sum / n;
    }
    return result;
}

function macd(data) {
    const diff = [], dea = [], bar = [];
    let e12 = 0, e26 = 0;
    for (let i = 0; i < data.length; i++) {
        const close = data[i]?.close || 0;
        if (i === 0) e12 = e26 = close;
        else {
            e12 = close * 2 / 13 + e12 * 11 / 13;
            e26 = close * 2 / 27 + e26 * 25 / 27;
        }
        diff[i] = e12 - e26;
        dea[i] = i === 0 ? diff[i] : diff[i] * 2 / 11 + dea[i - 1] * 9 / 11;
        bar[i] = diff[i] - dea[i];
    }
    return { diff, dea, bar };
}

function rsi(data, n = 14) {
    const result = Array(data.length).fill(null);
    let avgGain = 0, avgLoss = 0;
    for (let i = 1; i < data.length; i++) {
        const change = data[i].close - data[i - 1].close;
        const gain = Math.max(change, 0);
        const loss = Math.max(-change, 0);
        if (i <= n) {
            avgGain += gain;
            avgLoss += loss;
            if (i === n) {
                avgGain /= n;
                avgLoss /= n;
                result[i] = 100 - 100 / (1 + avgGain / (avgLoss || 0.0001));
            }
        } else {
            avgGain = (avgGain * (n - 1) + gain) / n;
            avgLoss = (avgLoss * (n - 1) + loss) / n;
            result[i] = 100 - 100 / (1 + avgGain / (avgLoss || 0.0001));
        }
    }
    return result;
}

function kdj(data, n = 9) {
    const k = Array(data.length).fill(null), d = Array(data.length).fill(null), j = Array(data.length).fill(null);
    let prevK = 50, prevD = 50;
    for (let i = 0; i < data.length; i++) {
        if (i < n - 1) continue;
        const slice = data.slice(i - n + 1, i + 1);
        const high = Math.max(...slice.map(row => row.high || 0));
        const low = Math.min(...slice.map(row => row.low || 0));
        const rsv = high === low ? 50 : ((data[i].close - low) / (high - low)) * 100;
        const curK = (2 / 3) * prevK + (1 / 3) * rsv;
        const curD = (2 / 3) * prevD + (1 / 3) * curK;
        k[i] = curK;
        d[i] = curD;
        j[i] = 3 * curK - 2 * curD;
        prevK = curK;
        prevD = curD;
    }
    return { k, d, j };
}

function atr(data, n = 14) {
    const tr = data.map(() => ({ close: 0 }));
    for (let i = 1; i < data.length; i++) {
        const prevClose = data[i - 1]?.close || data[i].close;
        tr[i].close = Math.max(
            data[i].high - data[i].low,
            Math.abs(data[i].high - prevClose),
            Math.abs(data[i].low - prevClose)
        );
    }
    return ma(tr, n);
}

function highest(data, idx, n, accessor = item => item.high) {
    let value = -Infinity;
    for (let i = Math.max(0, idx - n + 1); i <= idx; i++) value = Math.max(value, accessor(data[i]) || -Infinity);
    return value;
}

function lowest(data, idx, n, accessor = item => item.low) {
    let value = Infinity;
    for (let i = Math.max(0, idx - n + 1); i <= idx; i++) value = Math.min(value, accessor(data[i]) || Infinity);
    return value;
}

function convertDailyToWeekly(dailyData) {
    const weekly = [];
    let currentWeekKey = null, currentWeek = null;
    for (const row of dailyData || []) {
        const dateObj = new Date(`${row.date}T00:00:00Z`);
        const day = dateObj.getUTCDay() || 7;
        dateObj.setUTCDate(dateObj.getUTCDate() - day + 1);
        const weekKey = `${dateObj.getUTCFullYear()}-${String(dateObj.getUTCMonth() + 1).padStart(2, '0')}-${String(dateObj.getUTCDate()).padStart(2, '0')}`;
        if (weekKey !== currentWeekKey) {
            if (currentWeek) weekly.push(currentWeek);
            currentWeekKey = weekKey;
            currentWeek = { date: row.date, open: row.open, high: row.high, low: row.low, close: row.close, vol: row.vol || 0, amt: row.amt || 0 };
        } else {
            currentWeek.date = row.date;
            currentWeek.high = Math.max(currentWeek.high, row.high);
            currentWeek.low = Math.min(currentWeek.low, row.low);
            currentWeek.close = row.close;
            currentWeek.vol += row.vol || 0;
            currentWeek.amt += row.amt || 0;
        }
    }
    if (currentWeek) weekly.push(currentWeek);
    return weekly;
}

function weeklySignalByDate(data) {
    const out = Array(data.length).fill(false);
    for (let i = 0; i < data.length; i++) {
        const weeks = convertDailyToWeekly(data.slice(0, i + 1));
        if (weeks.length < 6) continue;
        const cur = weeks[weeks.length - 1], prev = weeks[weeks.length - 2];
        const ma5w = weeks.slice(-5).reduce((sum, row) => sum + (row.close || 0), 0) / 5;
        const prevMa5w = weeks.slice(-6, -1).reduce((sum, row) => sum + (row.close || 0), 0) / 5;
        const avgPrevVol = weeks.slice(-5, -1).reduce((sum, row) => sum + (row.vol || 0), 0) / 4;
        out[i] = cur.close > ma5w && prev.close <= prevMa5w && avgPrevVol > 0 && cur.vol > avgPrevVol * 1.2;
    }
    return out;
}

function bollinger(data, idx) {
    if (idx < 19) return null;
    const slice = data.slice(idx - 19, idx + 1);
    const middle = slice.reduce((sum, row) => sum + (row.close || 0), 0) / 20;
    const std = Math.sqrt(slice.reduce((sum, row) => sum + Math.pow((row.close || 0) - middle, 2), 0) / 20);
    return { middle, upper: middle + 2 * std, lower: middle - 2 * std };
}

function platformBreak(data, idx) {
    if (idx < 20) return false;
    const prev = data.slice(idx - 20, idx);
    const high = Math.max(...prev.map(row => row.high || 0));
    const low = Math.min(...prev.map(row => row.low || 0));
    return low > 0 && (high - low) / low < 0.08 && data[idx].close > high;
}

function recentDeadCross(ma5, ma20, idx) {
    if (idx < 6) return false;
    for (let i = idx - 5; i < idx; i++) if (ma5[i] && ma20[i] && ma5[i] < ma20[i]) return true;
    return false;
}

function buildIndicators(data) {
    return {
        ma5: ma(data, 5),
        ma10: ma(data, 10),
        ma20: ma(data, 20),
        ma60: ma(data, 60),
        macd: macd(data),
        rsi: rsi(data, 14),
        kdj: kdj(data, 9),
        atr14: atr(data, 14),
        b13: weeklySignalByDate(data)
    };
}

function signalFlags(data, ind) {
    const flags = {};
    for (const id of ['B1','B2','B3','B4','B5','B6','B7','B8','B9','B10','B11','B12','B13','B14','B15','B16','B17','B18','L1','L2','L3','L4','L5','L6','L7','L8','L9','L10','W1','W2','W3','W4']) {
        flags[id] = Array(data.length).fill(false);
    }
    for (let i = 60; i < data.length; i++) {
        const item = data[i], prev = data[i - 1], prev2 = data[i - 2], prev3 = data[i - 3];
        const ma5 = ind.ma5[i], ma10 = ind.ma10[i], ma20 = ind.ma20[i], ma60 = ind.ma60[i];
        const pma5 = ind.ma5[i - 1], pma10 = ind.ma10[i - 1], pma20 = ind.ma20[i - 1], pma60 = ind.ma60[i - 1];
        const vol5 = avg(data.slice(Math.max(0, i - 4), i + 1).map(row => row.vol || 0));
        const volRatio = vol5 ? (item.vol || 0) / vol5 : 0;
        const high20 = highest(data, i - 1, 20);
        const low30 = lowest(data, i - 1, 30);
        const high30 = highest(data, i - 1, 30);
        const dif = ind.macd.diff[i], dea = ind.macd.dea[i], pdif = ind.macd.diff[i - 1], pdea = ind.macd.dea[i - 1];
        const k = ind.kdj.k[i], d = ind.kdj.d[i], prevK = ind.kdj.k[i - 1] ?? 50, prevD = ind.kdj.d[i - 1] ?? 50;

        flags.B1[i] = ma5 > ma10 && ma10 > ma20 && ma20 > ma60 && !(pma5 > pma10 && pma10 > pma20 && pma20 > pma60);
        flags.B2[i] = pdif <= pdea && dif > dea;
        flags.B3[i] = (prev.close <= pma20 && item.close > ma20) || (pma5 <= pma20 && ma5 > ma20);
        flags.B4[i] = item.close > high20 && volRatio > 1.5;
        flags.B5[i] = prev.close < prev.open && item.close > item.open && item.open < prev.close && item.close > prev.open;
        flags.B6[i] = item.low <= ma20 && item.close >= ma20 && Math.max(0, Math.min(item.open, item.close) - item.low) >= Math.abs(item.close - item.open) * 1.5 && volRatio < 0.9;
        flags.B7[i] = ind.rsi[i - 1] <= 30 && ind.rsi[i] > 30;
        flags.B8[i] = prevK <= prevD && k > d;
        flags.B9[i] = item.low <= low30 && dif > Math.min(...ind.macd.diff.slice(Math.max(0, i - 30), i)) && dif > pdif;
        flags.B10[i] = ma20 > ma60 && pma20 <= pma60;
        flags.B11[i] = item.low <= ma20 && item.close > ma20 && item.close > item.open && ma20 > pma20;
        flags.B12[i] = dif > 0 && dea > 0 && pdif <= pdea && dif > dea;
        flags.B13[i] = ind.b13[i];
        flags.B14[i] = platformBreak(data, i) && volRatio > 1.5;
        flags.B15[i] = pma5 <= pma20 && ma5 > ma20 && recentDeadCross(ind.ma5, ind.ma20, i);
        flags.B16[i] = item.low <= ma60 * 1.03 && item.close > item.open && item.close > ma60;
        const window5 = data.slice(i - 4, i + 1);
        const fiveDayDrop = window5[0]?.close ? (item.close - window5[0].close) / window5[0].close : 0;
        const bearCount5 = window5.filter(row => row.close < row.open).length;
        const lowerShadow = Math.max(0, Math.min(item.open, item.close) - item.low);
        const range = Math.max(item.high - item.low, 0.0001);
        flags.B17[i] = fiveDayDrop <= -0.08 && bearCount5 >= 3 && (((item.close - ma20) / ma20 <= -0.08) || ind.rsi[i] <= 30) && ((lowerShadow / range >= 0.35 && item.close >= item.open) || (item.low < prev.low && item.close > prev.low && item.close > item.open));
        const boll = bollinger(data, i), prevBoll = bollinger(data, i - 1);
        flags.B18[i] = fiveDayDrop <= -0.06 && bearCount5 >= 2 && boll && ((prevBoll && prev.low <= prevBoll.lower) || item.low <= boll.lower) && item.close > boll.lower && (ind.rsi[i] <= 35 || (lowerShadow / range >= 0.3 && item.close >= item.open));

        flags.L1[i] = prev.close >= pma10 && item.close < ma10 && ma5 < pma5;
        flags.L2[i] = pma5 >= pma20 && ma5 < ma20;
        flags.L3[i] = pdif >= pdea && dif < dea;
        flags.L4[i] = prev.close >= pma20 && item.close < ma20 && volRatio > 1.5;
        flags.L5[i] = prev.close > prev.open && item.close < item.open && item.open > prev.close && item.close < prev.open;
        flags.L6[i] = prev.close > prev.open && prev2.close > prev2.open && prev3.close > prev3.open && item.close < item.open && volRatio > 1.2;
        flags.L7[i] = ind.rsi[i - 1] >= 70 && ind.rsi[i] < 70;
        flags.L8[i] = boll && item.high >= boll.upper && item.close < boll.upper && item.close < item.open;
        flags.L9[i] = high20 > 0 && (high20 - item.close) / high20 >= Math.max(0.08, ((ind.atr14[i] || 0) / item.close) * 2.5) && item.close < ma20;
        flags.L10[i] = item.high >= high30 && dif < Math.max(...ind.macd.diff.slice(Math.max(0, i - 30), i)) && dif < pdif;

        flags.W1[i] = ma60 > 0 && (item.close - ma60) / ma60 > 0.25;
        flags.W2[i] = prev.close > prev.open && prev2.close > prev2.open && item.close > item.open && prev.vol > prev2.vol && item.vol < prev.vol;
        const prevVolWindow = data.slice(Math.max(0, i - 5), i);
        const avgPrevVol = avg(prevVolWindow.map(row => row.vol || 0));
        const dayChange = prev.close ? (item.close - prev.close) / prev.close : 0;
        const bodyRatio = Math.abs(item.close - item.open) / range;
        const upperShadowRatio = (item.high - Math.max(item.open, item.close)) / range;
        const closePosition = (item.close - item.low) / range;
        flags.W3[i] = avgPrevVol > 0 && item.vol >= avgPrevVol * 1.8 && (item.high >= high20 * 0.98 || item.close >= high20 * 0.97) && dayChange <= 0.015 && dayChange >= -0.02 && (upperShadowRatio >= 0.35 || bodyRatio <= 0.25 || closePosition <= 0.55);
        flags.W4[i] = checkW4(data, ind, i, high20);
    }
    return flags;
}

function checkW4(data, ind, idx, high20) {
    const item = data[idx], prev = data[idx - 1], ma20 = ind.ma20[idx];
    if (idx < 80 || !item || !prev || !ma20 || item.close <= prev.close) return false;
    const close3 = data[idx - 3]?.close || 0;
    const close5 = data[idx - 5]?.close || 0;
    if (!close3 || !close5) return false;
    const rise3 = (item.close - close3) / close3;
    const rise5 = (item.close - close5) / close5;
    const volRecent5 = avg(data.slice(idx - 4, idx + 1).map(row => row.vol || 0));
    const volPrev5 = avg(data.slice(idx - 9, idx - 4).map(row => row.vol || 0));
    const upDays = data.slice(idx - 4, idx + 1).filter((row, offset) => offset > 0 && row.close > data[idx - 4 + offset - 1].close).length;
    return (rise5 >= 0.035 || rise3 >= 0.025)
        && upDays >= 3
        && volRecent5 > 0
        && volPrev5 > 0
        && volRecent5 <= volPrev5 * 0.9
        && (item.close >= high20 * 0.95 || (item.close - ma20) / ma20 >= 0.05 || ind.rsi[idx] >= 60);
}

function l12Flags(data, ind, mode) {
    const flags = Array(data.length).fill(false);
    for (let i = 80; i < data.length; i++) {
        const item = data[i], prev = data[i - 1];
        if (!item?.close || !prev?.close || !ind.ma20[i] || !ind.atr14[i]) continue;
        const high20 = highest(data, i, 20, row => row.close);
        const prevHigh20 = highest(data, i - 1, 20, row => row.close);
        const atrStop = high20 - ind.atr14[i] * 2.5;
        const prevAtrStop = prevHigh20 - (ind.atr14[i - 1] || ind.atr14[i]) * 2.5;
        const regular = item.close < atrStop && prev.close >= prevAtrStop && item.close < ind.ma20[i];
        if (!regular) continue;
        if (mode === 'strict') {
            const prevLow10Close = lowest(data, i - 1, 10, row => row.close);
            flags[i] = item.close < prevLow10Close && (ind.ma20[i] - item.close) / ind.ma20[i] >= 0.02;
        } else {
            flags[i] = true;
        }
    }
    return flags;
}

function scoreGroup(strategy, sig) {
    const group = (strategy.scoreGroups || []).find(list => list.includes(sig));
    return group ? group.join('|') : sig;
}

function signalScore(strategy, sig) {
    return strategy.signalWeights?.[sig] ?? SIGNAL_SCORES[sig] ?? 0;
}

function marketContext(date, indexContexts) {
    const trends = CORE_INDEX_IDS.map(id => {
        const ctx = indexContexts[id];
        if (!ctx) return null;
        const idx = findDateIndex(ctx.data, date);
        if (idx < 60) return null;
        const close = ctx.data[idx].close;
        const ma20Now = ctx.ma20[idx], ma60Now = ctx.ma60[idx], ma20Prev = ctx.ma20[Math.max(0, idx - 5)] || ma20Now;
        if (close > ma20Now && ma20Now > ma60Now && ma20Now >= ma20Prev) return { id, score: 1 };
        if (close < ma20Now && ma20Now < ma60Now) return { id, score: -1 };
        return { id, score: 0 };
    }).filter(Boolean);
    if (trends.length < CORE_INDEX_IDS.length) return { newPositionCap: 0, allowAdd: false };
    const bull = trends.filter(item => item.score > 0);
    const bear = trends.filter(item => item.score < 0);
    if (bull.length >= 2) return { newPositionCap: null, allowAdd: true };
    if (bear.length >= 2) return { newPositionCap: null, allowAdd: false };
    return { newPositionCap: null, allowAdd: true };
}

function findDateIndex(data, date) {
    let idx = -1, left = 0, right = data.length - 1;
    while (left <= right) {
        const mid = (left + right) >> 1;
        if (data[mid].date <= date) {
            idx = mid;
            left = mid + 1;
        } else {
            right = mid - 1;
        }
    }
    return idx;
}

function riskContext(data, ind, idx) {
    const close = data[idx]?.close || 0;
    if (!close) return { score: 100, coef: 1 };
    const atrPct = close ? (ind.atr14[idx] || 0) / close : 0;
    const ma20 = ind.ma20[idx], recent = data.slice(Math.max(0, idx - 19), idx + 1);
    const high20 = recent.length ? Math.max(...recent.map(row => row.high || 0)) : close;
    const drawdown = high20 ? (high20 - close) / high20 : 0;
    const distMA20 = ma20 ? (close - ma20) / ma20 : 0;
    let score = 100;
    if (atrPct > 0.06) score -= 25;
    else if (atrPct > 0.04) score -= 15;
    else if (atrPct > 0.025) score -= 8;
    if (distMA20 > 0.12) score -= 20;
    else if (distMA20 > 0.08) score -= 10;
    if (distMA20 < -0.05) score -= 18;
    if (drawdown > 0.12) score -= 20;
    else if (drawdown > 0.07) score -= 10;
    const clipped = Math.max(0, Math.round(score));
    const coef = clipped >= 80 ? 1 : clipped >= 60 ? 0.75 : clipped >= 40 ? 0.5 : 0.25;
    return { score: clipped, coef, atrPct, distMA20, drawdown };
}

function isWindowBuySignalEligible(signal, signalDay, flags, strategy) {
    const guard = strategy.windowSignalGuards?.[signal];
    if (!guard) return true;
    const companionSignals = new Set(guard.companionSignals || []);
    const recentDays = Math.max(1, Number(guard.recentDays) || 1);
    for (let day = Math.max(0, signalDay - recentDays + 1); day <= signalDay; day++) {
        if ([...companionSignals].some(companion => flags[companion]?.[day])) return true;
    }
    return false;
}

function getWindowSignalInvalidation(signal, signalDay, currentDay, data, ind, strategy) {
    if (signalDay >= currentDay) return null;
    const signalLow = Number(data[signalDay]?.low);
    const firstCheckDay = strategy.monotonicSignalLifecycle ? signalDay + 1 : currentDay;
    for (let day = firstCheckDay; day <= currentDay; day++) {
        if (Number.isFinite(signalLow) && Number(data[day]?.close) < signalLow) {
            return { signal, reason: 'price-break', invalidationDay: day };
        }
        if (signal === 'B8') {
            const k = Number(ind.kdj?.k?.[day]);
            const d = Number(ind.kdj?.d?.[day]);
            if (Number.isFinite(k) && Number.isFinite(d) && k <= d) {
                return { signal, reason: 'kdj-dead-cross', invalidationDay: day };
            }
        }
    }
    return null;
}

function calculateMeta(idx, data, flags, ind, strategy) {
    const raw = Object.keys(flags).filter(sig => flags[sig]?.[idx]);
    const allSignals = Object.fromEntries(raw.map(sig => [sig, true]));
    const activeExitSignals = raw.filter(sig => strategy.exitSignals.includes(sig));
    let lastExitIdx = -1;
    for (let i = idx; i >= Math.max(0, idx - 60); i--) {
        const hasStrong = Object.keys(flags).some(sig => STRONG_EXITS.has(sig) && strategy.exitSignals.includes(sig) && flags[sig]?.[i]);
        if (hasStrong) {
            lastExitIdx = i;
            break;
        }
    }
    const daysSinceExit = lastExitIdx >= 0 && lastExitIdx < idx ? idx - lastExitIdx : Infinity;
    const inCooldown = Number.isFinite(daysSinceExit) && daysSinceExit <= 3;
    const windowSignals = [];
    const invalidatedWindowSignals = [];
    const usedSignals = new Set();
    const groupBest = new Map();
    for (let i = Math.max(0, idx - strategy.windowDays + 1); i <= idx; i++) {
        for (const sig of Object.keys(flags)) {
            if (usedSignals.has(sig) || !flags[sig]?.[i]) continue;
            if (sig.startsWith('L') && strategy.exitSignals.includes(sig)) {
                windowSignals.push({ day: i, signal: sig });
                usedSignals.add(sig);
            } else if (sig.startsWith('B') && strategy.buySignals.includes(sig) && i > lastExitIdx && isWindowBuySignalEligible(sig, i, flags, strategy)) {
                const invalidation = getWindowSignalInvalidation(sig, i, idx, data, ind, strategy);
                if (invalidation) {
                    invalidatedWindowSignals.push(invalidation);
                    continue;
                }
                const score = signalScore(strategy, sig);
                const key = scoreGroup(strategy, sig);
                const existing = groupBest.get(key);
                if (!existing || score > existing.score) groupBest.set(key, { score, signal: sig });
                windowSignals.push({ day: i, signal: sig });
                usedSignals.add(sig);
            }
        }
    }
    const windowScore = [...groupBest.values()].reduce((sum, item) => sum + item.score, 0);
    const warningSignals = raw.filter(sig => strategy.warningSignals.includes(sig));
    const strongExits = activeExitSignals.filter(sig => STRONG_EXITS.has(sig));
    const hasUnconditionalExit = raw.includes('L3') && (() => {
        for (let i = idx - 1; i >= Math.max(0, idx - 4); i--) if (flags.L10?.[i]) return true;
        return false;
    })();
    let type = 'weak';
    if (hasUnconditionalExit) type = 'critical';
    else if (strongExits.length) type = 'strongExit';
    else if (inCooldown) type = 'cooldown';
    else if (windowScore >= strategy.buyThreshold && warningSignals.length) type = 'cautiousBuy';
    else if (windowScore >= strategy.buyThreshold) type = 'buy';
    else if (windowScore >= Math.max(3, strategy.buyThreshold - 2)) type = 'watch';
    else if (data[idx].close > (ind.ma20[idx] || Infinity)) type = 'holdTrend';
    return { currentDay: idx, raw, allSignals, activeExitSignals, warningSignals, windowSignals, invalidatedWindowSignals, windowScore, inCooldown, daysSinceExit, type };
}

function getWatchPosition(strategy, meta) {
    const watchPosition = Number(strategy.watchPosition || 0);
    if (watchPosition <= 0) return 0;
    const allowedSignals = strategy.watchPositionSignals;
    if (!Array.isArray(allowedSignals) || allowedSignals.length === 0) return watchPosition;
    return meta.windowSignals.some(item => allowedSignals.includes(item.signal)) ? watchPosition : 0;
}

function basePosition(meta, data, ind, idx, strategy) {
    if (meta.type === 'buy') return 80;
    if (meta.type === 'cautiousBuy') return 50;
    if (meta.type === 'watch') return getWatchPosition(strategy, meta);
    if (meta.type === 'holdTrend') return ind.ma20[idx] && ind.ma60[idx] && ind.ma20[idx] > ind.ma60[idx] ? 60 : 40;
    return 0;
}

function quantizePosition(value) {
    const steps = [0, 10, 20, 30, 50, 80, 100];
    return steps.reduce((prev, curr) => Math.abs(curr - value) < Math.abs(prev - value) ? curr : prev);
}

function basePositions(data, flags, ind, strategy, indexContexts) {
    const positions = Array(data.length).fill(0);
    const risks = Array(data.length).fill(null);
    for (let i = 60; i < data.length; i++) {
        const meta = calculateMeta(i, data, flags, ind, strategy);
        const market = marketContext(data[i].date, indexContexts);
        const risk = riskContext(data, ind, i);
        risks[i] = risk;
        const prevPos = positions[i - 1] || 0;
        let base = basePosition(meta, data, ind, i, strategy);
        const invalidatedToday = meta.invalidatedWindowSignals.filter(item => item.invalidationDay === i);
        const softInvalidatedToday = invalidatedToday.some(item => item.reason === 'kdj-dead-cross');
        const hardInvalidatedToday = invalidatedToday.some(item => item.reason === 'price-break');
        if (strategy.softInvalidationGraceDays > 0
            && prevPos > 0
            && prevPos <= strategy.watchPosition
            && base <= 0
            && meta.windowScore < strategy.holdThreshold
            && softInvalidatedToday
            && !hardInvalidatedToday
            && meta.activeExitSignals.length === 0
            && !meta.inCooldown) base = prevPos;
        let position = quantizePosition(base * risk.coef);
        const isCriticalExit = ['critical', 'strongExit'].includes(meta.type);
        if (isCriticalExit || meta.inCooldown) position = 0;
        else if (meta.activeExitSignals.some(sig => ['L1','L2','L5','L6','L7','L8'].includes(sig)) || meta.warningSignals.length) position = quantizePosition(Math.min(position, 30));
        else if (meta.windowSignals.some(item => item.signal.startsWith('L') && i - item.day >= 1 && i - item.day <= 2) && data[i].close < ind.ma5[i]) position = quantizePosition(Math.min(position, 30));
        if (meta.warningSignals.length) position = quantizePosition(Math.min(position, 40));
        if (risk.score < 40) position = quantizePosition(Math.min(position, 20));
        if (flags.W4[i] && prevPos > 0 && position >= 80) position = quantizePosition(Math.min(position, 50));
        if (Math.abs(position - prevPos) <= 10 && position !== 0) position = prevPos;
        if (prevPos === 0 && position > 0 && meta.type === 'holdTrend') position = 0;
        if (prevPos === 0 && Number.isFinite(market.newPositionCap)) position = quantizePosition(Math.min(position, market.newPositionCap));
        else if (prevPos > 0 && position > prevPos && !market.allowAdd) position = prevPos;
        positions[i] = position;
    }
    return { positions, risks };
}

function applyVariant(base, flags, variant) {
    const out = Array(base.length).fill(0);
    let cooldownUntil = -1;
    for (let i = 0; i < base.length; i++) {
        const desired = base[i] || 0;
        if (variant.action === 'strongExit') {
            if (flags[i]) cooldownUntil = i + 3;
            out[i] = i <= cooldownUntil ? 0 : desired;
        } else if (variant.action === 'reduce') {
            out[i] = flags[i] ? Math.min(desired, variant.cap) : desired;
        } else if (variant.action === 'cap') {
            const prev = i ? out[i - 1] || 0 : 0;
            out[i] = flags[i] && prev > 0 && desired >= variant.threshold && desired > variant.cap ? variant.cap : desired;
        } else {
            out[i] = desired;
        }
    }
    return out;
}

function summarize(data, pos) {
    let capital = 10000, peak = 10000, maxDrawdown = 0;
    let prev = pos[59] || 0, entry = 0, wins = 0, trades = 0, adjustments = 0;
    for (let i = 60; i < data.length; i++) {
        if (prev > 0) capital *= 1 + ((data[i].close - data[i - 1].close) / data[i - 1].close) * (prev / 100);
        if (capital > peak) peak = capital;
        maxDrawdown = Math.max(maxDrawdown, (peak - capital) / peak);
        if (pos[i] !== prev) {
            capital -= capital * Math.abs(pos[i] - prev) / 100 * 0.001;
            adjustments++;
            if (prev === 0 && pos[i] > 0) entry = capital;
            else if (pos[i] === 0 && prev > 0) {
                trades++;
                if (entry && capital > entry) wins++;
                entry = 0;
            }
            if (capital > peak) peak = capital;
            maxDrawdown = Math.max(maxDrawdown, (peak - capital) / peak);
        }
        prev = pos[i];
    }
    return {
        ret: (capital - 10000) / 10000,
        maxDrawdown,
        winRate: trades ? wins / trades : 0,
        trades,
        adjustments,
        b: pos.filter((p, i) => i && p > 0 && (pos[i - 1] || 0) === 0).length,
        s: pos.filter((p, i) => i && (pos[i - 1] || 0) > 0 && p === 0).length
    };
}

function overlapStats(flags, rawFlags, risks) {
    const indices = flags.map((flag, idx) => flag ? idx : -1).filter(idx => idx >= 0);
    const hasStrongNear = idx => {
        for (let i = Math.max(0, idx - 2); i <= Math.min(flags.length - 1, idx + 2); i++) {
            if ([...STRONG_EXITS].some(sig => rawFlags[sig]?.[i])) return true;
        }
        return false;
    };
    return {
        triggers: indices.length,
        sameDayStrongExit: indices.filter(idx => [...STRONG_EXITS].some(sig => rawFlags[sig]?.[idx])).length,
        nearStrongExit: indices.filter(hasStrongNear).length,
        sameDayAnyExit: indices.filter(idx => Object.keys(rawFlags).some(sig => sig.startsWith('L') && rawFlags[sig]?.[idx])).length,
        riskCoefReduced: indices.filter(idx => (risks[idx]?.coef ?? 1) < 1).length,
        riskHighOrWorse: indices.filter(idx => (risks[idx]?.score ?? 100) < 60).length,
        riskCritical: indices.filter(idx => (risks[idx]?.score ?? 100) < 40).length
    };
}

function aggregateRows(rows) {
    const result = {};
    for (const variant of Object.keys(VARIANTS)) {
        result[variant] = {};
        for (const strategy of STRATEGY_NAMES) {
            const list = rows.filter(row => row.variant === variant && row.strategy === strategy);
            result[variant][strategy] = {
                count: list.length,
                l12Triggers: list.reduce((sum, row) => sum + row.l12Triggers, 0),
                avgDeltaRet: round(avg(list.map(row => row.deltaRet))),
                avgDeltaMaxDrawdown: round(avg(list.map(row => row.deltaMaxDrawdown))),
                avgDeltaWinRate: round(avg(list.map(row => row.deltaWinRate))),
                avgDeltaAdjustments: round(avg(list.map(row => row.deltaAdjustments))),
                deltaB: list.reduce((sum, row) => sum + row.deltaB, 0),
                deltaS: list.reduce((sum, row) => sum + row.deltaS, 0)
            };
        }
    }
    return result;
}

function aggregateOverlap(rows) {
    const totals = rows.reduce((acc, row) => {
        for (const key of Object.keys(acc)) acc[key] += row[key] || 0;
        return acc;
    }, { triggers: 0, sameDayStrongExit: 0, nearStrongExit: 0, sameDayAnyExit: 0, riskCoefReduced: 0, riskHighOrWorse: 0, riskCritical: 0 });
    const ratio = key => totals.triggers ? round(totals[key] / totals.triggers) : null;
    return {
        ...totals,
        sameDayStrongExitRatio: ratio('sameDayStrongExit'),
        nearStrongExitRatio: ratio('nearStrongExit'),
        sameDayAnyExitRatio: ratio('sameDayAnyExit'),
        riskCoefReducedRatio: ratio('riskCoefReduced'),
        riskHighOrWorseRatio: ratio('riskHighOrWorse'),
        riskCriticalRatio: ratio('riskCritical')
    };
}

function loadStocks(cacheFiles) {
    const universe = readJson(UNIVERSE_PATH);
    return (universe.stocks || [])
        .filter(stock => PHASES.has(stock.phase))
        .map(stock => ({ ...stock, cacheFile: cacheFiles.find(file => file.startsWith(`stock_${stock.code}_`) && file.endsWith('.json')) }))
        .filter(stock => stock.cacheFile);
}

function loadIndexContexts(cacheFiles) {
    const contexts = {};
    for (const id of INDEX_IDS) {
        const file = cacheFiles.find(name => name.startsWith(`index_${id}_`) && name.endsWith('.json'));
        const data = file ? readJson(path.join(CACHE_DIR, file)) : [];
        contexts[id] = { data, ma20: ma(data, 20), ma60: ma(data, 60) };
    }
    return contexts;
}

function main() {
    if (!fs.existsSync(CACHE_DIR)) throw new Error(`missing cache dir: ${CACHE_DIR}`);
    const cacheFiles = fs.readdirSync(CACHE_DIR);
    const stocks = loadStocks(cacheFiles);
    const indexContexts = loadIndexContexts(cacheFiles);
    const rows = [];
    const overlapRows = [];

    for (const stock of stocks) {
        const data = readJson(path.join(CACHE_DIR, stock.cacheFile));
        if (!Array.isArray(data) || data.length < 140) continue;
        const ind = buildIndicators(data);
        const flags = signalFlags(data, ind);
        const l12Regular = l12Flags(data, ind, 'regular');
        const l12Strict = l12Flags(data, ind, 'strict');
        let firstBaseline = null;
        for (const [strategyName, strategy] of Object.entries(STRATEGIES)) {
            const baseline = basePositions(data, flags, ind, strategy, indexContexts);
            const baseSummary = summarize(data, baseline.positions);
            if (!firstBaseline) {
                firstBaseline = baseline;
                overlapRows.push({ code: stock.code, name: stock.name, industry: stock.industry, phase: stock.phase, ...overlapStats(l12Regular, flags, baseline.risks) });
            }
            for (const [variantName, variant] of Object.entries(VARIANTS)) {
                const variantFlags = variant.mode === 'strict' ? l12Strict : l12Regular;
                const next = applyVariant(baseline.positions, variantFlags, variant);
                const nextSummary = summarize(data, next);
                rows.push({
                    code: stock.code,
                    name: stock.name,
                    industry: stock.industry,
                    phase: stock.phase,
                    strategy: strategyName,
                    variant: variantName,
                    l12Triggers: variantFlags.filter(Boolean).length,
                    deltaRet: nextSummary.ret - baseSummary.ret,
                    deltaMaxDrawdown: nextSummary.maxDrawdown - baseSummary.maxDrawdown,
                    deltaWinRate: nextSummary.winRate - baseSummary.winRate,
                    deltaAdjustments: nextSummary.adjustments - baseSummary.adjustments,
                    deltaB: nextSummary.b - baseSummary.b,
                    deltaS: nextSummary.s - baseSummary.s
                });
            }
        }
    }

    fs.mkdirSync(REPORT_DIR, { recursive: true });
    const outPath = path.join(REPORT_DIR, `l12-deep-dive-${Date.now()}.json`);
    const report = {
        generatedAt: new Date().toISOString(),
        scope: { phases: [...PHASES], stocks: stocks.length, strategies: STRATEGY_NAMES },
        variants: VARIANTS,
        method: 'local-cache-lightweight-position-overlay',
        overlap: aggregateOverlap(overlapRows),
        aggregate: aggregateRows(rows),
        rows,
        overlapRows
    };
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({
        outPath: path.relative(ROOT, outPath),
        scope: report.scope,
        overlap: report.overlap,
        aggregate: report.aggregate
    }, null, 2));
}

main();
