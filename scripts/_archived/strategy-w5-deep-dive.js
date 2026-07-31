#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CACHE_DIR = path.join(ROOT, '.local', 'strategy-cache');
const REPORT_DIR = path.join(ROOT, '.local', 'strategy-reports');
const UNIVERSE_PATH = path.join(ROOT, 'strategy-validation-universe.json');

const PHASES = new Set(['seed', 'phase1']);
const STRATEGIES = ['稳健趋势型', '波段抄底型', '突破追涨型', '综合全能型'];
const VARIANTS = {
    w5_50_80: { mode: 'regular', cap: 50, threshold: 80, desc: 'W5 regular: 已有持仓且目标仓位>=80时上限50' },
    w5_30_80: { mode: 'regular', cap: 30, threshold: 80, desc: 'W5 regular: 已有持仓且目标仓位>=80时上限30' },
    w5_50_50: { mode: 'regular', cap: 50, threshold: 50, desc: 'W5 regular: 已有持仓且目标仓位>=50时上限50' },
    w5_strict_50_80: { mode: 'strict', cap: 50, threshold: 80, desc: 'W5 strict: 已有持仓且目标仓位>=80时上限50' }
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
    const diff = [], dea = [];
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
    }
    return { diff, dea };
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
    const k = Array(data.length).fill(null);
    const d = Array(data.length).fill(null);
    const j = Array(data.length).fill(null);
    let prevK = 50;
    let prevD = 50;
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

function convertDailyToWeekly(dailyData) {
    const weekly = [];
    let currentWeekKey = null;
    let currentWeek = null;
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
        const cur = weeks[weeks.length - 1];
        const prev = weeks[weeks.length - 2];
        const ma5w = weeks.slice(-5).reduce((sum, row) => sum + (row.close || 0), 0) / 5;
        const prevMa5w = weeks.slice(-6, -1).reduce((sum, row) => sum + (row.close || 0), 0) / 5;
        const avgPrevVol = weeks.slice(-5, -1).reduce((sum, row) => sum + (row.vol || 0), 0) / 4;
        out[i] = cur.close > ma5w && prev.close <= prevMa5w && avgPrevVol > 0 && cur.vol > avgPrevVol * 1.2;
    }
    return out;
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

function signalFlags(data, ind) {
    const flags = {};
    for (const id of ['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8', 'B9', 'B10', 'B11', 'B12', 'B13', 'B14', 'B15', 'B16', 'B17', 'L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L9', 'L10', 'W1']) {
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
        flags.B14[i] = item.close > high20 && volRatio > 1.5;
        flags.B15[i] = pma5 <= pma20 && ma5 > ma20 && ind.ma5.slice(Math.max(0, i - 5), i).some((value, idx) => value < ind.ma20[Math.max(0, i - 5) + idx]);
        flags.B16[i] = item.low <= ma60 * 1.03 && item.close > item.open && item.close > ma60;
        const window5 = data.slice(i - 4, i + 1);
        const fiveDayDrop = window5[0]?.close ? (item.close - window5[0].close) / window5[0].close : 0;
        flags.B17[i] = fiveDayDrop <= -0.08 && window5.filter(row => row.close < row.open).length >= 3 && ((item.close - ma20) / ma20 <= -0.08 || ind.rsi[i] <= 30) && item.close >= item.open;

        flags.L1[i] = prev.close >= pma10 && item.close < ma10 && ma5 < pma5;
        flags.L2[i] = pma5 >= pma20 && ma5 < ma20;
        flags.L3[i] = pdif >= pdea && dif < dea;
        flags.L4[i] = prev.close >= pma20 && item.close < ma20 && volRatio > 1.5;
        flags.L5[i] = prev.close > prev.open && item.close < item.open && item.open > prev.close && item.close < prev.open;
        flags.L6[i] = prev.close > prev.open && prev2.close > prev2.open && prev3.close > prev3.open && item.close < item.open && volRatio > 1.2;
        flags.L9[i] = high20 > 0 && (high20 - item.close) / high20 >= 0.08 && item.close < ma20;
        flags.L10[i] = item.high >= high30 && dif < Math.max(...ind.macd.diff.slice(Math.max(0, i - 30), i)) && dif < pdif;
        flags.W1[i] = ma60 > 0 && (item.close - ma60) / ma60 > 0.25;
    }
    return flags;
}

const strategyDefs = {
    '稳健趋势型': { buy: ['B1','B2','B3','B4','B10','B12','B13','B14','B15'], exit: ['L1','L2','L3','L4','L9','L10'], warning: ['W1'], groups: [['B1','B10','B13','B15'],['B2','B12'],['B4','B14']], threshold: 5, window: 12, watchPosition: 0 },
    '波段抄底型': { buy: ['B5','B6','B7','B8','B9','B11','B16','B17'], exit: ['L3','L5','L10'], warning: ['W1','L9'], groups: [['B5','B6','B11','B16'],['B7','B8'],['B17']], windowSignalGuards: { B8: { recentDays: 3, companionSignals: ['B5','B6','B9','B11','B16','B17'] } }, threshold: 4, window: 10, holdThreshold: 3, watchPosition: 30, softInvalidationGraceDays: 1, monotonicSignalLifecycle: true },
    '突破追涨型': { buy: ['B3','B4','B14'], exit: ['L4','L5','L6','L9'], warning: ['W1','L10'], groups: [['B4','B14']], threshold: 4, window: 8, watchPosition: 0, weights: { B3: 1, B4: 3, B14: 4 } },
    '综合全能型': { buy: ['B1','B2','B3','B4','B5','B6','B7','B9','B10','B11','B12','B14','B15','B16','B17'], exit: ['L1','L2','L3','L4','L5','L6','L9','L10'], warning: ['W1'], groups: [['B1','B10','B15'],['B2','B12'],['B4','B14'],['B5','B6','B11','B16'],['B7'],['B17']], threshold: 6, window: 12, watchPosition: 30, watchPositionSignals: ['B5','B6','B7','B9','B11','B16','B17'] }
};

const scores = { B1:3, B2:3, B3:2, B4:2, B5:2, B6:2, B7:1, B8:1, B9:4, B10:2, B11:2, B12:3, B13:3, B14:2, B15:2, B16:3, B17:3, B18:2 };

function scoreGroup(strategy, sig) {
    const group = (strategy.groups || []).find(list => list.includes(sig));
    return group ? group.join('|') : sig;
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

function getWatchPosition(strategy, windowSignals) {
    const watchPosition = Number(strategy.watchPosition || 0);
    if (watchPosition <= 0) return 0;
    const allowedSignals = strategy.watchPositionSignals;
    if (!Array.isArray(allowedSignals) || allowedSignals.length === 0) return watchPosition;
    return [...windowSignals].some(sig => allowedSignals.includes(sig)) ? watchPosition : 0;
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

function basePositions(data, flags, ind, strategy) {
    const result = Array(data.length).fill(0);
    let lastStrongExit = -1;
    for (let i = 60; i < data.length; i++) {
        const exits = strategy.exit.filter(sig => flags[sig]?.[i]);
        if (exits.some(sig => ['L3','L4','L9','L10'].includes(sig))) lastStrongExit = i;
        const inCooldown = lastStrongExit >= 0 && lastStrongExit < i && i - lastStrongExit <= 3;
        let pos = 0;
        if (exits.some(sig => ['L3','L4','L9','L10'].includes(sig)) || inCooldown) {
            pos = 0;
        } else {
            const best = new Map();
            const windowSignals = new Set();
            const invalidatedWindowSignals = [];
            for (let j = Math.max(0, i - strategy.window + 1); j <= i; j++) {
                for (const sig of strategy.buy) {
                    if (!flags[sig]?.[j]) continue;
                    if (!isWindowBuySignalEligible(sig, j, flags, strategy)) continue;
                    const invalidation = getWindowSignalInvalidation(sig, j, i, data, ind, strategy);
                    if (invalidation) {
                        invalidatedWindowSignals.push(invalidation);
                        continue;
                    }
                    windowSignals.add(sig);
                    const weight = strategy.weights?.[sig] ?? scores[sig] ?? 0;
                    const key = scoreGroup(strategy, sig);
                    if (!best.has(key) || best.get(key) < weight) best.set(key, weight);
                }
            }
            const score = [...best.values()].reduce((sum, value) => sum + value, 0);
            pos = score >= strategy.threshold ? 80 : score >= Math.max(3, strategy.threshold - 2) ? getWatchPosition(strategy, windowSignals) : 0;
            const prevPos = result[i - 1] || 0;
            const invalidatedToday = invalidatedWindowSignals.filter(item => item.invalidationDay === i);
            if (strategy.softInvalidationGraceDays > 0
                && prevPos > 0
                && prevPos <= strategy.watchPosition
                && pos <= 0
                && score < strategy.holdThreshold
                && invalidatedToday.some(item => item.reason === 'kdj-dead-cross')
                && !invalidatedToday.some(item => item.reason === 'price-break')
                && exits.length === 0) pos = prevPos;
            if (strategy.warning.some(sig => flags[sig]?.[i])) pos = Math.min(pos, 40);
            if (exits.some(sig => ['L1','L2','L5','L6'].includes(sig))) pos = Math.min(pos, 30);
        }
        result[i] = pos;
    }
    return result;
}

function w5Flags(data, ind, mode) {
    const flags = Array(data.length).fill(false);
    for (let i = 80; i < data.length; i++) {
        const atrPct = data[i].close ? (ind.atr14[i] || 0) / data[i].close : 0;
        const atrAvg = ind.atrPct20[i] || 0;
        const distMA20 = ind.ma20[i] ? Math.abs((data[i].close - ind.ma20[i]) / ind.ma20[i]) : 0;
        if (mode === 'strict') flags[i] = atrPct >= 0.065 || (atrAvg > 0 && atrPct >= atrAvg * 2.1 && distMA20 >= 0.04);
        else flags[i] = atrPct >= 0.055 || (atrAvg > 0 && atrPct >= atrAvg * 1.8);
    }
    return flags;
}

function overlay(base, flags, variant) {
    const out = [];
    for (let i = 0; i < base.length; i++) {
        const prev = i ? out[i - 1] || 0 : 0;
        const desired = base[i] || 0;
        out[i] = flags[i] && prev > 0 && desired >= variant.threshold && desired > variant.cap ? variant.cap : desired;
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

function buildIndicators(data) {
    const atr14 = atr(data, 14);
    return {
        ma5: ma(data, 5),
        ma10: ma(data, 10),
        ma20: ma(data, 20),
        ma60: ma(data, 60),
        macd: macd(data),
        rsi: rsi(data, 14),
        kdj: kdj(data, 9),
        atr14,
        atrPct20: ma(data.map((item, idx) => ({ close: item.close ? (atr14[idx] || 0) / item.close : 0 })), 20),
        b13: weeklySignalByDate(data)
    };
}

function loadStocks() {
    const universe = readJson(UNIVERSE_PATH);
    const cacheFiles = fs.readdirSync(CACHE_DIR);
    return (universe.stocks || [])
        .filter(stock => PHASES.has(stock.phase))
        .map(stock => ({
            ...stock,
            cacheFile: cacheFiles.find(file => file.startsWith(`stock_${stock.code}_`) && file.endsWith('.json'))
        }))
        .filter(stock => stock.cacheFile);
}

function aggregate(rows) {
    const byVariant = {};
    for (const variant of Object.keys(VARIANTS)) {
        byVariant[variant] = {};
        for (const strategy of STRATEGIES) {
            const list = rows.filter(row => row.variant === variant && row.strategy === strategy);
            byVariant[variant][strategy] = {
                count: list.length,
                w5Triggers: list.reduce((sum, row) => sum + row.w5Triggers, 0),
                avgDeltaRet: round(avg(list.map(row => row.deltaRet))),
                avgDeltaMaxDrawdown: round(avg(list.map(row => row.deltaMaxDrawdown))),
                avgDeltaWinRate: round(avg(list.map(row => row.deltaWinRate))),
                avgDeltaAdjustments: round(avg(list.map(row => row.deltaAdjustments))),
                deltaB: list.reduce((sum, row) => sum + row.deltaB, 0),
                deltaS: list.reduce((sum, row) => sum + row.deltaS, 0)
            };
        }
    }
    return byVariant;
}

function main() {
    const stocks = loadStocks();
    const rows = [];
    for (const stock of stocks) {
        const data = readJson(path.join(CACHE_DIR, stock.cacheFile));
        if (!Array.isArray(data) || data.length < 140) continue;
        const ind = buildIndicators(data);
        const flags = signalFlags(data, ind);
        const w5Regular = w5Flags(data, ind, 'regular');
        const w5Strict = w5Flags(data, ind, 'strict');
        for (const strategyName of STRATEGIES) {
            const base = basePositions(data, flags, ind, strategyDefs[strategyName]);
            const baseSummary = summarize(data, base);
            for (const [variantName, variant] of Object.entries(VARIANTS)) {
                const overlayFlags = variant.mode === 'strict' ? w5Strict : w5Regular;
                const next = overlay(base, overlayFlags, variant);
                const nextSummary = summarize(data, next);
                rows.push({
                    code: stock.code,
                    name: stock.name,
                    industry: stock.industry,
                    phase: stock.phase,
                    strategy: strategyName,
                    variant: variantName,
                    w5Triggers: overlayFlags.filter(Boolean).length,
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
    const outPath = path.join(REPORT_DIR, `w5-deep-dive-${Date.now()}.json`);
    const report = {
        generatedAt: new Date().toISOString(),
        scope: { phases: [...PHASES], stocks: stocks.length, strategies: STRATEGIES },
        variants: VARIANTS,
        aggregate: aggregate(rows),
        rows
    };
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({
        outPath: path.relative(ROOT, outPath),
        scope: report.scope,
        aggregate: report.aggregate
    }, null, 2));
}

main();
