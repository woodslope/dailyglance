/* DailyGlance [3] - split from dailyglance.html. Keep classic script order. */
// ==========================================
// [3] 核心算法层 (Core Algorithms)
// ==========================================

const Calcs = {
    ma: (data, n) => {
        let r = [];
        for (let i = 0; i < data.length; i++) {
            if (i < n - 1) { r.push(null); continue; }
            let s = 0; for (let j = 0; j < n; j++) s += data[i - j]?.close || 0;
            r.push(s / n);
        }
        return r;
    },
    maIncremental: (data, n, prev = [], startIdx = 0) => {
        if (!Array.isArray(prev) || !prev.length || startIdx <= 0) return Calcs.ma(data, n);
        const r = prev.slice(0, data.length);
        const begin = Math.max(0, startIdx);
        for (let i = begin; i < Math.min(data.length, n - 1); i++) r[i] = null;
        for (let i = Math.max(n - 1, begin); i < data.length; i++) {
            let s = 0;
            for (let j = 0; j < n; j++) s += data[i - j]?.close || 0;
            r[i] = s / n;
        }
        return r;
    },
    macdDeaAlpha: 2 / (9 + 1),
    macdDeaPrevAlpha: 1 - (2 / (9 + 1)),
    macd: (data) => {
        let e12 = [], e26 = [], diff = [], dea = [], bar = [];
        for (let i = 0; i < data.length; i++) {
            let c = data[i]?.close || 0;
            if (i === 0) e12[i] = e26[i] = c;
            else { e12[i] = c * 2 / 13 + e12[i - 1] * 11 / 13; e26[i] = c * 2 / 27 + e26[i - 1] * 25 / 27; }
            diff[i] = e12[i] - e26[i];
            dea[i] = (i === 0) ? diff[i] : (diff[i] * Calcs.macdDeaAlpha + dea[i - 1] * Calcs.macdDeaPrevAlpha);
            bar[i] = (diff[i] - dea[i]) * 2;
        }
        return { _e12: e12, _e26: e26, diff, dea, bar };
    },
    macdIncremental: (data, prev, startIdx = 0) => {
        if (!prev?._e12?.length || !prev?._e26?.length || !prev?.diff?.length || !prev?.dea?.length || startIdx <= 0) return Calcs.macd(data);
        const e12 = prev._e12.slice(0, data.length);
        const e26 = prev._e26.slice(0, data.length);
        const diff = prev.diff.slice(0, data.length);
        const dea = prev.dea.slice(0, data.length);
        const bar = prev.bar.slice(0, data.length);
        const begin = Math.max(1, startIdx);
        for (let i = begin; i < data.length; i++) {
            const c = data[i]?.close || 0;
            e12[i] = c * 2 / 13 + (e12[i - 1] || 0) * 11 / 13;
            e26[i] = c * 2 / 27 + (e26[i - 1] || 0) * 25 / 27;
            diff[i] = e12[i] - e26[i];
            dea[i] = diff[i] * Calcs.macdDeaAlpha + (dea[i - 1] || 0) * Calcs.macdDeaPrevAlpha;
            bar[i] = (diff[i] - dea[i]) * 2;
        }
        return { _e12: e12, _e26: e26, diff, dea, bar };
    },
    rsi: (data, n = 14) => {
        let r = [], g = [0], l = [0], ag = [0], al = [0];
        for (let i = 1; i < data.length; i++) {
            let d = (data[i]?.close || 0) - (data[i - 1]?.close || 0);
            g.push(d > 0 ? d : 0); l.push(d < 0 ? -d : 0);
        }
        for (let i = 0; i < data.length; i++) {
            if (i < n) { ag[i] = ag[i - 1] || 0; al[i] = al[i - 1] || 0; r.push(null); } 
            else if (i === n) { ag[i] = g.slice(1, n + 1).reduce((a, b) => a + b) / n; al[i] = l.slice(1, n + 1).reduce((a, b) => a + b) / n; r.push(100 - 100 / (1 + (ag[i] / (al[i] || 0.0001)))); } 
            else { ag[i] = (ag[i - 1] * (n - 1) + g[i]) / n; al[i] = (al[i - 1] * (n - 1) + l[i]) / n; r.push(100 - 100 / (1 + (ag[i] / (al[i] || 0.0001)))); }
        }
        return { val: r, _g: g, _l: l, _ag: ag, _al: al };
    },
    rsiIncremental: (data, prev, n = 14, startIdx = 0) => {
        if (!prev?.val?.length || !prev?._g?.length || !prev?._l?.length || !prev?._ag?.length || !prev?._al?.length || startIdx <= 1) return Calcs.rsi(data, n);
        const r = prev.val.slice(0, data.length);
        const g = prev._g.slice(0, data.length);
        const l = prev._l.slice(0, data.length);
        const ag = prev._ag.slice(0, data.length);
        const al = prev._al.slice(0, data.length);
        const begin = Math.max(1, startIdx);
        for (let i = begin; i < data.length; i++) {
            const d = (data[i]?.close || 0) - (data[i - 1]?.close || 0);
            g[i] = d > 0 ? d : 0;
            l[i] = d < 0 ? -d : 0;
        }
        for (let i = begin; i < data.length; i++) {
            if (i < n) {
                ag[i] = ag[i - 1] || 0;
                al[i] = al[i - 1] || 0;
                r[i] = null;
            } else if (i === n) {
                ag[i] = g.slice(1, n + 1).reduce((a, b) => a + b, 0) / n;
                al[i] = l.slice(1, n + 1).reduce((a, b) => a + b, 0) / n;
                r[i] = 100 - 100 / (1 + (ag[i] / (al[i] || 0.0001)));
            } else {
                ag[i] = (ag[i - 1] * (n - 1) + g[i]) / n;
                al[i] = (al[i - 1] * (n - 1) + l[i]) / n;
                r[i] = 100 - 100 / (1 + (ag[i] / (al[i] || 0.0001)));
            }
        }
        return { val: r, _g: g, _l: l, _ag: ag, _al: al };
    },
    kdj: (data, n = 9) => {
        let k = [], d = [], j = []; let prevK = 50, prevD = 50;
        for (let i = 0; i < data.length; i++) {
            if (i < n - 1) { k.push(null); d.push(null); j.push(null); continue; }
            let slice = data.slice(i - n + 1, i + 1);
            let hn = Math.max(...slice.map(v => v?.high || 0)), ln = Math.min(...slice.map(v => v?.low || 0));
            let rsv = hn === ln ? 50 : (data[i]?.close - ln) / (hn - ln) * 100;
            let curK = (2 / 3) * prevK + (1 / 3) * rsv, curD = (2 / 3) * prevD + (1 / 3) * curK, curJ = 3 * curK - 2 * curD;
            k.push(curK); d.push(curD); j.push(curJ); prevK = curK; prevD = curD;
        }
        return { k, d, j };
    },
    kdjIncremental: (data, prev, n = 9, startIdx = 0) => {
        if (!prev?.k?.length || !prev?.d?.length || !prev?.j?.length || startIdx <= 0) return Calcs.kdj(data, n);
        const k = prev.k.slice(0, data.length);
        const d = prev.d.slice(0, data.length);
        const j = prev.j.slice(0, data.length);
        const begin = Math.max(0, startIdx - n + 1);
        for (let i = begin; i < Math.min(data.length, n - 1); i++) k[i] = d[i] = j[i] = null;
        let prevK = begin > 0 ? (k[begin - 1] ?? 50) : 50;
        let prevD = begin > 0 ? (d[begin - 1] ?? 50) : 50;
        for (let i = Math.max(n - 1, begin); i < data.length; i++) {
            let hn = -Infinity, ln = Infinity;
            for (let jdx = i - n + 1; jdx <= i; jdx++) {
                const bar = data[jdx];
                const high = bar?.high || 0;
                const low = bar?.low || 0;
                if (high > hn) hn = high;
                if (low < ln) ln = low;
            }
            const rsv = hn === ln ? 50 : (((data[i]?.close || 0) - ln) / (hn - ln) * 100);
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
};

const DECISION_REBUILD_LOOKBACK = 80;

function calculateBollinger(data, idx) { 
    if(idx < 19 || !data[idx]) return null; 
    const slice = data.slice(idx - 19, idx + 1);
    const avg = slice.reduce((s, d) => s + (d?.close || 0), 0) / 20; 
    const std = Math.sqrt(slice.reduce((s, d) => s + Math.pow((d?.close || 0) - avg, 2), 0) / 20); 
    return { middle: avg, upper: avg + 2 * std, lower: avg - 2 * std }; 
}

function getCalendarWeeksUntil(full, idx) {
    if (!full || idx < 0) return [];
    if (state.period === 'weekly') return full.slice(0, idx + 1);
    const targetDate = full[idx]?.date || '';
    const cachedWeeks = state.weeklyData?.[state.id];
    if (targetDate && cachedWeeks?.length && cachedWeeks[cachedWeeks.length - 1]?.date === targetDate) return cachedWeeks;
    return convertDailyToWeekly(full.slice(0, idx + 1));
}

function getWeeklyData(full, idx, weeksOverride = null) { 
    const weeks = weeksOverride || getCalendarWeeksUntil(full, idx); if(weeks.length < 6) return null; 
    const cur = weeks[weeks.length - 1], prev = weeks[weeks.length - 2]; 
    const ma5w = weeks.slice(-5).reduce((s, w) => s + (w?.close || 0), 0) / 5, prevMa5w = weeks.slice(-6, -1).reduce((s, w) => s + (w?.close || 0), 0) / 5, avgPrevVol = weeks.slice(-5, -1).reduce((s, w) => s + (w?.vol || 0), 0) / 4; 
    return { aboveMA5W: cur.close > ma5w && prev.close <= prevMa5w, volUp: avgPrevVol > 0 && cur.vol > avgPrevVol * 1.2 }; 
}

function getWeeklySupportFromSeries(weeks) {
    const recentWeeks = weeks.slice(Math.max(0, weeks.length - 21), -1);
    return recentWeeks.length ? Math.min(...recentWeeks.map(d => d?.low || 0)) : 0;
}

function buildWeeklySignalContexts(full) {
    if (!Array.isArray(full) || !full.length) return [];
    const weeks = [];
    return full.map((item, idx) => {
        appendDailyBarToWeeklySeries(weeks, item);
        return {
            wd: getWeeklyData(full, idx, weeks),
            weeklySupport: getWeeklySupportFromSeries(weeks),
            weeklyDoubleBottom: getWeeklyDoubleBottomContext(full, idx, weeks)
        };
    });
}

function checkPlatformBreak(full, idx) { 
    if(idx < 20 || !full[idx]) return false; 
    const pd = full.slice(idx - 20, idx), ph = Math.max(...pd.map(d => d?.high || 0)), pl = Math.min(...pd.map(d => d?.low || 0)); 
    return pl > 0 && (ph - pl) / pl < 0.08 && full[idx].close > ph; 
}

function checkRecentDeadCross(full, ma5, ma20, idx) { 
    if(idx < 6) return false; 
    for(let i = idx - 5; i < idx; i++) if(ma5[i] && ma20[i] && ma5[i] < ma20[i]) return true; 
    return false; 
}

function checkOversoldStopFallRebound(ctx) {
    if (ctx.idx < 64 || !ctx.item || !ctx.prev || !ctx.ma20) return false;
    const window5 = ctx.lookback5WithToday;
    if (window5.length < 5) return false;

    const startClose = window5[0]?.close || 0;
    const endClose = ctx.item.close || 0;
    if (!startClose || !endClose) return false;

    const fiveDayDrop = (endClose - startClose) / startClose;
    const bearCount = window5.filter(d => d && d.close < d.open).length;
    const belowMA20 = (endClose - ctx.ma20) / ctx.ma20;
    const isOversold = belowMA20 <= -0.08 || ctx.rsiVal <= 30;
    const lowerShadow = Math.max(0, Math.min(ctx.item.open || 0, ctx.item.close || 0) - (ctx.item.low || 0));
    const range = Math.max((ctx.item.high || 0) - (ctx.item.low || 0), 0.0001);
    const recoveredPrevLow = ctx.prev?.low && endClose > ctx.prev.low;
    const bullishPin = lowerShadow / range >= 0.35 && endClose >= ctx.item.open;
    const panicReversal = ctx.item.low < ctx.prev.low && recoveredPrevLow && endClose > ctx.item.open;

    return fiveDayDrop <= -0.08 && bearCount >= 3 && isOversold && (bullishPin || panicReversal);
}

function checkBollLowerBandReclaim(ctx) {
    if (ctx.idx < 64 || !ctx.item || !ctx.prev || !ctx.boll) return false;
    const window5 = ctx.lookback5WithToday;
    if (window5.length < 5) return false;

    const startClose = window5[0]?.close || 0;
    const endClose = ctx.item.close || 0;
    if (!startClose || !endClose) return false;

    const fiveDayDrop = (endClose - startClose) / startClose;
    const bearCount = window5.filter(d => d && d.close < d.open).length;
    const prevBoll = calculateBollinger(ctx.full, ctx.idx - 1);
    const piercedLowerBand = (prevBoll && ctx.prev.low <= prevBoll.lower) || ctx.item.low <= ctx.boll.lower;
    const reclaimedLowerBand = ctx.item.close > ctx.boll.lower;
    const lowerShadow = Math.max(0, Math.min(ctx.item.open || 0, ctx.item.close || 0) - (ctx.item.low || 0));
    const range = Math.max((ctx.item.high || 0) - (ctx.item.low || 0), 0.0001);
    const hasStopFallShape = ctx.rsiVal <= 35 || (lowerShadow / range >= 0.3 && endClose >= ctx.item.open);

    return fiveDayDrop <= -0.06 && bearCount >= 2 && piercedLowerBand && reclaimedLowerBand && hasStopFallShape;
}

// 双底仅在第二底确认后的右侧突破日触发，避免把未完成筑底过程当成买点。
function checkDoubleBottomBreakout(ctx) {
    if (ctx.idx < 70 || !ctx.item || !ctx.prev || ctx.item.close <= ctx.item.open) return false;
    const secondDay = ctx.idx - 1;
    const second = ctx.full[secondDay];
    if (!second) return false;
    const secondLow = Number(second.low);
    if (!Number.isFinite(secondLow) || secondLow > Number(ctx.full[secondDay - 1]?.low) || secondLow > Number(ctx.item.low)) return false;
    for (let firstDay = Math.max(2, secondDay - 30); firstDay <= secondDay - 4; firstDay++) {
        const firstLow = Number(ctx.full[firstDay]?.low);
        if (!Number.isFinite(firstLow) || Math.abs(secondLow - firstLow) / firstLow > 0.03) continue;
        let confirmed = true;
        for (let offset = 1; offset <= 2; offset++) {
            const left = Number(ctx.full[firstDay - offset]?.low);
            const right = Number(ctx.full[firstDay + offset]?.low);
            if (!Number.isFinite(left) || !Number.isFinite(right) || firstLow >= left || firstLow >= right) { confirmed = false; break; }
        }
        if (!confirmed) continue;
        const between = ctx.full.slice(firstDay + 1, secondDay);
        const neckline = between.length ? Math.max(...between.map(row => Number(row?.high) || 0)) : 0;
        const baseLow = Math.max(firstLow, secondLow);
        if (neckline >= baseLow * 1.02 && ctx.ma20 && ctx.item.close > ctx.ma20 && ctx.item.close > neckline * 1.005) return true;
    }
    return false;
}

function findConfirmedPivotLow(full, endDay, lookbackDays = 120, pivotDays = 2) {
    const start = Math.max(pivotDays, endDay - Math.max(1, lookbackDays));
    for (let day = endDay - pivotDays; day >= start; day--) {
        const value = Number(full?.[day]?.low);
        if (!Number.isFinite(value) || value <= 0) continue;
        let confirmed = true;
        for (let offset = 1; offset <= pivotDays; offset++) {
            if (Number(full?.[day - offset]?.low) <= value || Number(full?.[day + offset]?.low) <= value) {
                confirmed = false;
                break;
            }
        }
        if (confirmed) return { day, value };
    }
    return null;
}

// 第二底当天只作为低吸修复候选，不宣称双底已经突破确认。
function findDoubleBottomRepairCandidate(ctx, options = {}) {
    if (!ctx?.item || !ctx?.prev || ctx.item.close < ctx.item.open) return null;
    const pivotDays = Math.max(1, Number(options.pivotDays) || 2);
    const lookbackDays = Math.max(10, Number(options.lookbackDays) || 120);
    const minimumGap = Math.max(1, Number(options.minimumGap) || 4);
    const maximumGap = Math.max(minimumGap, Number(options.maximumGap) || 90);
    const tolerance = Math.max(0.01, Number(options.tolerance) || 0.03);
    const currentLow = Number(ctx.item.low);
    if (!Number.isFinite(currentLow)) return null;
    const recentLows = ctx.full.slice(Math.max(0, ctx.idx - 3), ctx.idx).map(row => Number(row?.low)).filter(Number.isFinite);
    if (recentLows.length < 3) return null;
    const recentLowFloor = Math.min(...recentLows);
    const recentLowTolerance = Math.max(0, Number(options.recentLowTolerance) || 0);
    const recentLowBreak = currentLow <= recentLowFloor;
    const nearbyRecentLow = options.allowNearbyRecentLow === true
        && recentLowTolerance > 0
        && currentLow <= recentLowFloor * (1 + recentLowTolerance);
    if (!recentLowBreak && !nearbyRecentLow) return null;
    const close = Number(ctx.item.close), previousClose = Number(ctx.prev.close);
    if (![close, previousClose].every(Number.isFinite) || close < previousClose) return null;
    const range = Number(ctx.item.high) - currentLow;
    const body = Math.abs(close - Number(ctx.item.open));
    const lowerShadow = Math.min(close, Number(ctx.item.open)) - currentLow;
    if (!(range > 0 && (lowerShadow >= body * 0.5 || close >= currentLow * 1.01))) return null;
    const start = Math.max(pivotDays, ctx.idx - lookbackDays);
    for (let day = ctx.idx - pivotDays; day >= start; day--) {
        const value = Number(ctx.full?.[day]?.low);
        if (!Number.isFinite(value) || value <= 0) continue;
        let confirmed = true;
        for (let offset = 1; offset <= pivotDays; offset++) {
            if (Number(ctx.full?.[day - offset]?.low) <= value || Number(ctx.full?.[day + offset]?.low) <= value) {
                confirmed = false;
                break;
            }
        }
        const gap = ctx.idx - day;
        if (confirmed && gap >= minimumGap && gap <= maximumGap && Math.abs(currentLow - value) / value <= tolerance) {
            return {
                secondBottomDay: ctx.idx,
                secondBottomValue: currentLow,
                firstBottomDay: day,
                firstBottomValue: value,
                gap,
                lowGapRatio: Math.abs(currentLow - value) / value
            };
        }
    }
    return null;
}

function checkDoubleBottomRepair(ctx, options = {}) {
    return !!findDoubleBottomRepairCandidate(ctx, options);
}

function getWeeklyDoubleBottomContext(full, idx, weeksOverride = null, options = {}) {
    const weeks = weeksOverride || (state.period === 'weekly'
        ? full?.slice(0, idx + 1)
        : getCalendarWeeksUntil(full, idx));
    const weekIdx = weeks?.length ? weeks.length - 1 : -1;
    if (weekIdx < 0 || !weeks[weekIdx] || !weeks[weekIdx - 1]) {
        return { candidate: false, provisional: state.period !== 'weekly', details: null, seriesLength: weeks?.length || 0 };
    }
    const details = findDoubleBottomRepairCandidate({
        idx: weekIdx,
        full: weeks,
        item: weeks[weekIdx],
        prev: weeks[weekIdx - 1]
    }, {
        lookbackDays: 52,
        minimumGap: 4,
        maximumGap: 26,
        tolerance: 0.07,
        pivotDays: 1,
        ...options
    });
    return {
        candidate: !!details,
        provisional: state.period !== 'weekly',
        details,
        seriesLength: weeks.length,
        date: weeks[weekIdx]?.date || ''
    };
}

// 回踩已确认支撑收复：四个来源共用同一套ATR容差，只认已确认结构，并要求支撑明确低于均线以避开B6/B11覆盖区。
function findSupportReclaimCandidate(ctx, strategy) {
    const options = strategy?.waveSupportReclaim;
    if (!options) return null;
    if (options.stocksOnly !== false && !(state.mode === 'stock' && state.period === 'daily')) return null;
    const item = ctx?.item;
    if (!item) return null;
    const close = Number(item.close), open = Number(item.open);
    const low = Number(item.low), high = Number(item.high);
    if (![close, open, low, high].every(Number.isFinite) || !(close > open)) return null;
    const range = high - low;
    const body = Math.abs(close - open);
    const lowerShadow = Math.min(close, open) - low;
    if (!(range > 0 && (lowerShadow >= body * 0.5 || close >= low * 1.01))) return null;
    const atr14 = Number(getWaveAtr14At(ctx.idx, ctx.full));
    if (!(atr14 > 0)) return null;
    const policy = strategy?.waveRegimePolicy || {};
    const maPeriod = Math.max(1, Number(options.movingAveragePeriod) || 20);
    const movingAverage = Number(ctx.ind?.ma?.[maPeriod]?.[ctx.idx]);
    if (!Number.isFinite(movingAverage)) return null;
    const clearance = atr14 * Math.max(0, Number(options.movingAverageClearanceAtr) || 0.5);
    const touch = atr14 * Math.max(0, Number(options.touchToleranceAtr) || 0.5);
    const breakRoom = atr14 * Math.max(0, Number(options.breakToleranceAtr) || 1);
    const box = getWaveBoxContext(ctx.idx, ctx.full, policy);
    const pivot = findConfirmedPivotLow(ctx.full, ctx.idx,
        Math.max(10, Number(options.pivotLookbackDays) || 120),
        Math.max(1, Number(options.pivotDays) || 2));
    const weeks = ctx.weeklySeries;
    const weeklyPivot = weeks?.length
        ? findConfirmedPivotLow(weeks, weeks.length - 1,
            Math.max(4, Number(options.weeklyLookbackWeeks) || 52),
            Math.max(1, Number(options.weeklyPivotDays) || 1))
        : null;
    const weeklyBottom = getWeeklyDoubleBottomContext(ctx.full, ctx.idx, weeks,
        policy?.multiTimeframeBottomProbe?.weeklyRepair || {});
    const matched = [
        { key: 'box', value: Number(box?.support) },
        { key: 'pivot', value: Number(pivot?.value) },
        { key: 'weekly', value: Number(weeklyPivot?.value) },
        { key: 'weeklyBottom', value: Number(weeklyBottom?.details?.secondBottomValue) }
    ].filter(source => Number.isFinite(source.value) && source.value > 0
        && source.value <= movingAverage - clearance
        && low <= source.value + touch
        && low >= source.value - breakRoom
        && close >= source.value);
    if (!matched.length) return null;
    return { sources: matched.map(source => source.key), level: Math.max(...matched.map(source => source.value)) };
}

function checkSupportReclaim(ctx, strategy) {
    return !!findSupportReclaimCandidate(ctx, strategy);
}

function getWavePeakContext(idx, full, ind, meta = null) {
    const empty = {
        status: 'none', candidate: false, confirmed: false, sources: [], level: null,
        triggerDay: idx, triggerDate: full?.[idx]?.date || '', reason: ''
    };
    if (!full?.[idx] || state.strategy !== '波段抄底型') return empty;
    const item = full[idx];
    const high = Number(item.high), low = Number(item.low), close = Number(item.close), open = Number(item.open);
    const range = high - low;
    if (![high, low, close, open].every(Number.isFinite) || range <= 0) return empty;
    const sources = [];
    const dailyPivot = getRecentConfirmedPressureHigh(idx, full, state.period === 'weekly' ? 26 : 60, state.period === 'weekly' ? 1 : 2);
    if (dailyPivot && high >= dailyPivot.value * 0.98) sources.push({ type: 'daily-pivot', level: dailyPivot.value, day: dailyPivot.day, date: full?.[dailyPivot.day]?.date || '' });
    const weeks = state.period === 'weekly'
        ? full.slice(0, idx + 1)
        : (typeof convertDailyToWeekly === 'function' ? getCalendarWeeksUntil(full, idx) : []);
    const weeklyPivot = getRecentConfirmedPressureHigh(weeks, weeks.length - 1, 26, 1);
    if (weeklyPivot && high >= weeklyPivot.value * 0.98) sources.push({ type: 'weekly-pivot', level: weeklyPivot.value, day: weeklyPivot.day, date: weeks?.[weeklyPivot.day]?.date || '' });
    const weeklyHigh = weeks?.length ? Math.max(...weeks.slice(Math.max(0, weeks.length - 26), -1).map(row => Number(row?.high) || 0)) : 0;
    if (weeklyHigh > 0 && high >= weeklyHigh * 0.98) sources.push({ type: 'weekly-range', level: weeklyHigh, day: null, date: '' });
    if (!sources.length) return empty;
    const upperShadow = high - Math.max(open, close);
    const lowerShadow = Math.min(open, close) - low;
    const closeLocation = (close - low) / range;
    const reversalEvidence = upperShadow / range >= 0.35
        && closeLocation <= 0.5
        && upperShadow > lowerShadow
        && (close <= open || (meta?.exitSignals || []).some(signal => ['L6', 'L7', 'L8', 'L9', 'L10'].includes(signal)));
    return {
        status: reversalEvidence ? 'confirmed' : 'candidate',
        candidate: true,
        confirmed: reversalEvidence,
        sources,
        level: Math.max(...sources.map(source => Number(source.level)).filter(Number.isFinite)),
        triggerDay: idx,
        triggerDate: item.date || '',
        upperShadowRangeRatio: upperShadow / range,
        closeLocation,
        reason: reversalEvidence
            ? `触及${sources.some(source => source.type === 'weekly-pivot' || source.type === 'weekly-range') ? '周线' : '日线'}压力后出现长上影弱收盘，按波峰确认防守`
            : `已接近日线或周线压力区，暂作波峰候选观察`
    };
}

function checkVolumePriceStalling(ctx) {
    if (ctx.idx < 60 || !ctx.item || !ctx.prev) return false;
    const prevHigh20 = ctx.high20;
    if (!prevHigh20 || prevHigh20 === Infinity) return false;

    const currentVol = ctx.item.vol || 0;
    const prevVolWindow = ctx.full.slice(Math.max(0, ctx.idx - 5), ctx.idx).filter(Boolean);
    const avgPrevVol = prevVolWindow.length
        ? prevVolWindow.reduce((sum, item) => sum + (item.vol || 0), 0) / prevVolWindow.length
        : 0;
    if (!avgPrevVol || currentVol < avgPrevVol * 1.8) return false;

    const prevClose = ctx.prev.close || 0;
    const close = ctx.item.close || 0;
    if (!prevClose || !close) return false;

    const nearPressure = ctx.item.high >= prevHigh20 * 0.98 || close >= prevHigh20 * 0.97;
    const dayChange = (close - prevClose) / prevClose;
    const range = Math.max((ctx.item.high || 0) - (ctx.item.low || 0), 0.0001);
    const bodyRatio = Math.abs(close - (ctx.item.open || close)) / range;
    const upperShadowRatio = ((ctx.item.high || close) - Math.max(ctx.item.open || close, close)) / range;
    const closePosition = (close - (ctx.item.low || close)) / range;
    const priceStalled = dayChange <= 0.015 && dayChange >= -0.02;
    const weakClose = upperShadowRatio >= 0.35 || bodyRatio <= 0.25 || closePosition <= 0.55;

    return nearPressure && priceStalled && weakClose;
}

function checkVolumeRiseDivergence(ctx) {
    if (ctx.idx < 80 || !ctx.item || !ctx.prev || !ctx.ma20) return false;

    const close = ctx.item.close || 0;
    const prevClose = ctx.prev.close || 0;
    if (!close || !prevClose || close <= prevClose) return false;

    const avgVol = (start, end) => {
        let sum = 0, count = 0;
        for (let i = start; i <= end; i++) {
            const vol = ctx.full[i]?.vol || 0;
            if (vol > 0) { sum += vol; count++; }
        }
        return count ? sum / count : 0;
    };
    const upDays = (start, end) => {
        let count = 0;
        for (let i = Math.max(1, start); i <= end; i++) {
            if ((ctx.full[i]?.close || 0) > (ctx.full[i - 1]?.close || 0)) count++;
        }
        return count;
    };

    const close3 = ctx.full[ctx.idx - 3]?.close || 0;
    const close5 = ctx.full[ctx.idx - 5]?.close || 0;
    if (!close3 || !close5) return false;

    const rise3 = (close - close3) / close3;
    const rise5 = (close - close5) / close5;
    const volRecent5 = avgVol(ctx.idx - 4, ctx.idx);
    const volPrev5 = avgVol(ctx.idx - 9, ctx.idx - 5);
    if (!volRecent5 || !volPrev5) return false;

    const nearPressure = ctx.high20 && ctx.high20 !== Infinity && close >= ctx.high20 * 0.95;
    const distMA20 = (close - ctx.ma20) / ctx.ma20;
    const priceStillRising = rise5 >= 0.035 || rise3 >= 0.025;
    const volumeShrinking = volRecent5 <= volPrev5 * 0.9;
    const extendedOrHot = nearPressure || distMA20 >= 0.05 || ctx.rsiVal >= 60;

    return priceStillRising && upDays(ctx.idx - 4, ctx.idx) >= 3 && volumeShrinking && extendedOrHot;
}

function checkConfirmedHighPullback(full, ind, idx, high20, prev) {
    if(high20 === Infinity || idx < 20 || !full[idx]) return false;
    const item = full[idx], atr = getATR(full, idx), atrPct = item.close ? atr / item.close : 0;
    const threshold = state.mode === 'stock' ? Math.max(0.08, atrPct * 2.5) : 0.05, pullback = (high20 - item.close) / high20, prevPullback = prev ? (high20 - prev.close) / high20 : 0;
    const recentLow = Math.min(...full.slice(Math.max(0, idx - 10), idx).map(d => d?.low || 0)), ma20 = ind.ma?.[20]?.[idx];
    return pullback >= threshold && prevPullback < threshold && ((ma20 && item.close < ma20) || (recentLow && item.close < recentLow));
}

class SignalContext {
    constructor(idx, full, ind, state, weeklyContext = null) {
        this.idx = idx; this.full = full; this.ind = ind; this.state = state;
        this.weeklyContext = weeklyContext;
        this.item = full[idx] || {}; this.prev = full[idx-1] || {}; this.prev2 = full[idx-2] || {}; this.prev3 = full[idx-3] || {};
        this.ma5 = ind.ma?.[5]?.[idx]; this.ma10 = ind.ma?.[10]?.[idx]; this.ma20 = ind.ma?.[20]?.[idx]; this.ma60 = ind.ma?.[60]?.[idx];
        this.prevMa5 = ind.ma?.[5]?.[idx-1]; this.prevMa10 = ind.ma?.[10]?.[idx-1]; this.prevMa20 = ind.ma?.[20]?.[idx-1]; this.prevMa60 = ind.ma?.[60]?.[idx-1];
        this.dif = ind.macd?.diff?.[idx]; this.dea = ind.macd?.dea?.[idx];
        this.prevDif = ind.macd?.diff?.[idx-1]; this.prevDea = ind.macd?.dea?.[idx-1];
        this.rsiVal = ind.rsi?.val?.[idx] || 50; this.prevRsi = ind.rsi?.val?.[idx-1] || 50;
    }
    get volRatio() { if(this._volRatio !== undefined) return this._volRatio; const volSum = this.full.slice(Math.max(0, this.idx - 4), this.idx + 1).reduce((s, d) => s + (d?.vol || 0), 0); return (this._volRatio = (this.item.vol || 0) / (volSum / 5)); }
    get isLongToday() { return this.ma5 && this.ma10 && this.ma20 && this.ma60 && this.ma5 > this.ma10 && this.ma10 > this.ma20 && this.ma20 > this.ma60; }
    get isLongPrev() { return this.prevMa5 && this.prevMa10 && this.prevMa20 && this.prevMa60 && this.prevMa5 > this.prevMa10 && this.prevMa10 > this.prevMa20 && this.prevMa20 > this.prevMa60; }
    get lookback20() { return this._lb20 || (this._lb20 = this.full.slice(Math.max(0, this.idx - 20), this.idx)); }
    get high20() { return this.lookback20.length ? Math.max(...this.lookback20.map(d => d?.high || 0)) : Infinity; }
    get shadowBelow() { return this.ma20 ? Math.max(0, Math.min(this.item.open || 0, this.item.close || 0) - (this.item.low || 0)) : 0; }
    get body() { return Math.abs((this.item.close || 0) - (this.item.open || 0)); }
    get kdj() { return {K: this.ind.kdj?.k?.[this.idx], D: this.ind.kdj?.d?.[this.idx], J: this.ind.kdj?.j?.[this.idx], prevK: this.ind.kdj?.k?.[this.idx-1] || 50, prevD: this.ind.kdj?.d?.[this.idx-1] || 50}; }
    get lookback30() { return this._lb30 || (this._lb30 = this.full.slice(Math.max(0, this.idx - 30), this.idx)); }
    get lookback5WithToday() { return this._lb5t || (this._lb5t = this.full.slice(Math.max(0, this.idx - 4), this.idx + 1)); }
    get weeklySeries() { return this._weeks || (this._weeks = getCalendarWeeksUntil(this.full, this.idx)); }
    get wd() { if(this.weeklyContext) return this.weeklyContext.wd; return this._wd || (this._wd = getWeeklyData(this.full, this.idx, this.weeklySeries)); }
    get weeklySupport() { if(this.weeklyContext) return this.weeklyContext.weeklySupport; if(this._weeklySupport !== undefined) return this._weeklySupport; return (this._weeklySupport = getWeeklySupportFromSeries(this.weeklySeries)); }
    get weeklyDoubleBottom() {
        if (this.weeklyContext?.weeklyDoubleBottom) return this.weeklyContext.weeklyDoubleBottom;
        return this._weeklyDoubleBottom || (this._weeklyDoubleBottom = getWeeklyDoubleBottomContext(this.full, this.idx));
    }
    get boll() { return this._boll || (this._boll = calculateBollinger(this.full, this.idx)); }
    get consecutiveBullish() { if(this._cb !== undefined) return this._cb; let c = 0; for(let i = this.idx - 1; i >= Math.max(0, this.idx - 5); i--) { if(this.full[i]?.close > this.full[i]?.open) c++; else break; } return (this._cb = c); }
}

const SIGNAL_RULES = [
    { id: 'B1', check: ctx => ctx.isLongToday && !ctx.isLongPrev },
    { id: 'B2', check: ctx => ctx.prevDif <= ctx.prevDea && ctx.dif > ctx.dea },
    { id: 'B3', check: ctx => (ctx.prev && ctx.prev.close <= ctx.prevMa20 && ctx.item.close > ctx.ma20) || (ctx.prevMa5 <= ctx.prevMa20 && ctx.ma5 > ctx.ma20) },
    { id: 'B4', check: ctx => ctx.item.close > ctx.high20 && ctx.volRatio > SYS_CONFIG.VOL_SURGE_RATIO },
    { id: 'B5', check: ctx => ctx.prev && ctx.prev.close < ctx.prev.open && ctx.item.close > ctx.item.open && ctx.item.open < ctx.prev.close && ctx.item.close > ctx.prev.open },
    { id: 'B6', check: ctx => ctx.item.low <= ctx.ma20 && ctx.item.close >= ctx.ma20 && ctx.shadowBelow >= ctx.body * 1.5 && ctx.volRatio < SYS_CONFIG.VOL_SHRINK_RATIO },
    { id: 'B7', check: ctx => ctx.prevRsi <= 30 && ctx.rsiVal > 30 },
    { id: 'B8', check: ctx => ctx.kdj && ctx.kdj.prevK <= ctx.kdj.prevD && ctx.kdj.K > ctx.kdj.D },
    { id: 'B9', check: ctx => ctx.lookback30.length > 0 && ctx.item.low <= Math.min(...ctx.lookback30.map(d=>d?.low||0)) && ctx.dif > Math.min(...(ctx.ind.macd?.diff?.slice(Math.max(0,ctx.idx-30),ctx.idx)||[])) && ctx.dif > ctx.prevDif },
    { id: 'B10', check: ctx => ctx.ma20 && ctx.ma60 && ctx.ma20 > ctx.ma60 && ctx.prevMa20 <= ctx.prevMa60 },
    { id: 'B11', check: ctx => ctx.item.low <= ctx.ma20 && ctx.item.close > ctx.ma20 && ctx.item.close > ctx.item.open && ctx.ma20 > ctx.prevMa20 },
    { id: 'B12', check: ctx => ctx.dif > 0 && ctx.dea > 0 && ctx.prevDif <= ctx.prevDea && ctx.dif > ctx.dea },
    { id: 'B13', check: ctx => ctx.wd && ctx.wd.aboveMA5W && ctx.wd.volUp },
    { id: 'B14', check: ctx => checkPlatformBreak(ctx.full, ctx.idx) && ctx.volRatio > SYS_CONFIG.VOL_SURGE_RATIO },
    { id: 'B15', check: ctx => ctx.prevMa5 <= ctx.prevMa20 && ctx.ma5 > ctx.ma20 && checkRecentDeadCross(ctx.full, ctx.ind.ma?.[5], ctx.ind.ma?.[20], ctx.idx) },
    { id: 'B16', check: ctx => ctx.weeklySupport > 0 && ctx.item.low <= ctx.weeklySupport * 1.03 && ctx.item.close > ctx.item.open && ctx.item.close > ctx.weeklySupport },
    { id: 'B17', check: ctx => checkOversoldStopFallRebound(ctx) },
    { id: 'B18', check: ctx => checkBollLowerBandReclaim(ctx) },
    { id: 'B19', check: ctx => state.mode === 'stock' && state.period === 'daily' && checkDoubleBottomBreakout(ctx) },
    { id: 'B20', check: ctx => state.mode === 'stock' && state.period === 'daily' && checkDoubleBottomRepair(ctx, { lookbackDays: 120, minimumGap: 15, maximumGap: 90, tolerance: 0.05 }) },
    { id: 'B21', check: ctx => state.mode === 'stock' && state.period === 'weekly' && checkDoubleBottomRepair(ctx, { lookbackDays: 52, maximumGap: 26, tolerance: 0.07, pivotDays: 1 }) },
    { id: 'B22', check: ctx => checkSupportReclaim(ctx, STRATEGY) },
    { id: 'L1', check: ctx => ctx.prev && ctx.prev.close >= ctx.prevMa10 && ctx.item.close < ctx.ma10 && ctx.ma5 < ctx.prevMa5 },
    { id: 'L2', check: ctx => ctx.prevMa5 >= ctx.prevMa20 && ctx.ma5 < ctx.ma20 },
    { id: 'L3', check: ctx => ctx.prevDif >= ctx.prevDea && ctx.dif < ctx.dea },
    { id: 'L4', check: ctx => ctx.prev && ctx.prev.close >= ctx.prevMa20 && ctx.item.close < ctx.ma20 && ctx.volRatio > SYS_CONFIG.VOL_SURGE_RATIO },
    { id: 'L5', check: ctx => ctx.prev && ctx.prev.close > ctx.prev.open && ctx.item.close < ctx.item.open && ctx.item.open > ctx.prev.close && ctx.item.close < ctx.prev.open },
    { id: 'L6', check: ctx => ctx.consecutiveBullish >= 3 && ctx.item.close < ctx.item.open && ctx.volRatio > 1.2 },
    { id: 'L7', check: ctx => ctx.prevRsi >= 70 && ctx.rsiVal < 70 },
    { id: 'L8', check: ctx => ctx.boll && ctx.item.high >= ctx.boll.upper && ctx.item.close < ctx.boll.upper && ctx.item.close < ctx.item.open },
    { id: 'L9', check: ctx => ctx.state.period !== 'weekly' && checkConfirmedHighPullback(ctx.full, ctx.ind, ctx.idx, ctx.high20, ctx.prev) },
    { id: 'L10', check: ctx => ctx.lookback30.length > 0 && ctx.item.high >= Math.max(...ctx.lookback30.map(d=>d?.high||0)) && ctx.dif < Math.max(...(ctx.ind.macd?.diff?.slice(Math.max(0,ctx.idx-30),ctx.idx)||[])) && ctx.dif < ctx.prevDif },
    { id: 'W1', check: ctx => ctx.ma60 > 0 && (ctx.item.close - ctx.ma60) / ctx.ma60 > 0.25 },
    { id: 'W2', check: ctx => ctx.prev && ctx.prev2 && ctx.prev3 && ctx.prev.close > ctx.prev.open && ctx.prev2.close > ctx.prev2.open && ctx.item.close > ctx.item.open && ctx.prev.vol > ctx.prev2.vol && ctx.item.vol < ctx.prev.vol },
    { id: 'W3', check: ctx => checkVolumePriceStalling(ctx) },
    { id: 'W4', check: ctx => checkVolumeRiseDivergence(ctx) }
];

function calculateDailySignals(idx, full, ind, perfStats = null, weeklyContext = null) {
    if(idx < 60 || !full[idx]) return [];
    const contextStarted = perfStats ? performance.now() : 0;
    const ctx = new SignalContext(idx, full, ind, state, weeklyContext), result = [];
    if (perfStats) perfStats.contextMs += performance.now() - contextStarted;
    for (let i = 0; i < SIGNAL_RULES.length; i++) {
        const rule = SIGNAL_RULES[i];
        const ruleStarted = perfStats ? performance.now() : 0;
        const matched = rule.check(ctx);
        if (perfStats) {
            perfStats.ruleMs[rule.id] = (perfStats.ruleMs[rule.id] || 0) + performance.now() - ruleStarted;
            perfStats.ruleChecks[rule.id] = (perfStats.ruleChecks[rule.id] || 0) + 1;
            if (matched) perfStats.ruleHits[rule.id] = (perfStats.ruleHits[rule.id] || 0) + 1;
        }
        if (matched) result.push(rule.id);
    }
    return result;
}

function getStrongExitSignals(strategy = STRATEGY) {
    const list = Array.isArray(strategy?.strongExitSignals) ? strategy.strongExitSignals : ['L3', 'L4', 'L9', 'L10'];
    return new Set(list);
}

function isWaveStandaloneL3Observation(meta, strategy = STRATEGY) {
    const exits = meta?.exitSignals || [];
    if (exits.length !== 1 || exits[0] !== 'L3') return false;
    if ((meta?.type || '').includes('清仓') || (meta?.type || '').includes('规避')) return false;
    const rawSignals = Object.keys(meta?.allSignals || {});
    const blockingSignals = new Set(['L4', 'L9', 'L10']);
    const structureBreak = getTodaySignalInvalidations(meta, 'price-break')
        .some(item => item?.defenseType === 'structure');
    return !rawSignals.some(signal => blockingSignals.has(signal)) && !structureBreak;
}

function isWaveL10TrendHandoffSignal(full, index, signal, strategy = STRATEGY) {
    return signal === 'L10'
        && !!strategy?.l10TrendHandoff
        && full?.[index]?._decision?.waveL10TrendHandoff?.applied === true;
}

function isWaveMA20TrendDefenseSignal(full, index, signal, strategy = STRATEGY) {
    return signal === strategy?.waveMA20PullbackObservation?.trendDefense?.standaloneExitSignal
        && (full?.[index]?._decision?.waveMA20PullbackObservation?.defenseType === 'standalone_l3'
            || full?.[index]?._decision?.waveStandaloneL3Observation === true);
}

function isWindowBuySignalEligible(signal, signalDay, full, strategy = STRATEGY, earliestEligibleDay = 0) {
    const guard = strategy?.windowSignalGuards?.[signal];
    if (!guard) return true;
    const companionSignals = new Set(guard.companionSignals || []);
    const recentDays = Math.max(1, Number(guard.recentDays) || 1);
    for (let day = Math.max(0, earliestEligibleDay, signalDay - recentDays + 1); day <= signalDay; day++) {
        if ((full[day]?._signals || []).some(item => companionSignals.has(item))) return true;
    }
    return false;
}

function getPostEventBuyScoreContext(idx, full, ind, triggerDay, strategy = STRATEGY, options = {}) {
    const firstDay = Math.max(Number(triggerDay) + 1, idx - Math.max(1, Number(strategy?.windowDays) || 1) + 1);
    const excludedSignals = new Set(options.excludedSignals || []);
    const usedSignals = new Set();
    const groupBest = new Map();
    for (let day = firstDay; day <= idx; day++) {
        for (const signal of full?.[day]?._signals || []) {
            if (usedSignals.has(signal) || !signal.startsWith('B') || !strategy?.buySignals?.includes(signal)) continue;
            if (excludedSignals.has(signal)) continue;
            // 双底第二底是当天的低吸修复候选，不能像持续性趋势信号一样长期充当事件后恢复积分。
            if (signal === 'B20' && idx - day > 1) continue;
            if (!isWindowBuySignalEligible(signal, day, full, strategy, firstDay)) continue;
            const invalidation = getWindowSignalInvalidation(signal, day, idx, full, ind, strategy);
            if (invalidation && invalidation.reason !== 'local-price-break') continue;
            const score = getSignalScore(signal, strategy);
            const groupKey = getScoreGroupKey(strategy, signal);
            const existing = groupBest.get(groupKey);
            if (!existing || score > existing.score) groupBest.set(groupKey, {
                signal,
                score,
                groupKey,
                day,
                signalDate: full?.[day]?.date || '',
                dayOffset: idx - day
            });
            usedSignals.add(signal);
        }
    }
    const signals = Array.from(groupBest.values());
    return {
        score: signals.reduce((sum, item) => sum + item.score, 0),
        signals
    };
}

function getB11StructureDefense(signalDay, full, strategy = STRATEGY) {
    const config = strategy?.b11StructureDefense;
    const signalLow = Number(full?.[signalDay]?.low);
    if (state.mode !== 'stock' || !config || !Number.isFinite(signalLow)) return null;

    const lookbackDays = Math.max(1, Number(config.lookbackDays) || 20);
    const pivotDays = Math.max(1, Number(config.pivotDays) || 2);
    const cacheKey = `${signalDay}|${signalLow}|${lookbackDays}|${pivotDays}`;
    let cachedDefenses = b11StructureDefenseCache.get(full);
    if (!cachedDefenses) {
        cachedDefenses = new Map();
        b11StructureDefenseCache.set(full, cachedDefenses);
    }
    if (cachedDefenses.has(cacheKey)) return cachedDefenses.get(cacheKey);

    const firstCandidate = Math.max(pivotDays, signalDay - lookbackDays);
    const lastCandidate = signalDay - pivotDays;
    let defense = null;
    for (let day = lastCandidate; day >= firstCandidate; day--) {
        const low = Number(full?.[day]?.low);
        if (!Number.isFinite(low) || low >= signalLow) continue;
        let confirmed = true;
        for (let offset = 1; offset <= pivotDays; offset++) {
            const leftLow = Number(full?.[day - offset]?.low);
            const rightLow = Number(full?.[day + offset]?.low);
            if (!Number.isFinite(leftLow) || !Number.isFinite(rightLow) || low >= leftLow || low >= rightLow) {
                confirmed = false;
                break;
            }
        }
        if (confirmed) {
            defense = {
                localLevel: signalLow,
                structureLevel: low,
                structureDay: day,
                structureDate: full?.[day]?.date || ''
            };
            break;
        }
    }
    cachedDefenses.set(cacheKey, defense);
    return defense;
}

function getWindowSignalInvalidation(signal, signalDay, currentDay, full, ind, strategy = STRATEGY) {
    if (!signal?.startsWith('B') || signalDay >= currentDay) return null;
    const signalLow = Number(full?.[signalDay]?.low);
    const b11Defense = signal === 'B11' ? getB11StructureDefense(signalDay, full, strategy) : null;
    const kValues = ind?.kdj?.k || [];
    const dValues = ind?.kdj?.d || [];
    const firstCheckDay = strategy?.monotonicSignalLifecycle ? signalDay + 1 : currentDay;
    let localBreak = null;
    for (let day = firstCheckDay; day <= currentDay; day++) {
        const close = Number(full?.[day]?.close);
        if (b11Defense) {
            if (Number.isFinite(close) && close < b11Defense.structureLevel) {
                return {
                    signal,
                    day: signalDay,
                    signalDate: full?.[signalDay]?.date || '',
                    score: getSignalScore(signal, strategy),
                    reason: 'price-break',
                    defenseType: 'structure',
                    invalidationDay: day,
                    invalidationDate: full?.[day]?.date || '',
                    invalidationLevel: b11Defense.structureLevel,
                    localLevel: b11Defense.localLevel,
                    structureDay: b11Defense.structureDay,
                    structureDate: b11Defense.structureDate
                };
            }
            if (!localBreak && Number.isFinite(close) && close < b11Defense.localLevel) {
                localBreak = {
                    signal,
                    day: signalDay,
                    signalDate: full?.[signalDay]?.date || '',
                    score: getSignalScore(signal, strategy),
                    reason: 'local-price-break',
                    defenseType: 'local',
                    invalidationDay: day,
                    invalidationDate: full?.[day]?.date || '',
                    invalidationLevel: b11Defense.localLevel,
                    structureLevel: b11Defense.structureLevel,
                    structureDay: b11Defense.structureDay,
                    structureDate: b11Defense.structureDate
                };
            }
            continue;
        }
        if (Number.isFinite(signalLow) && Number.isFinite(close) && close < signalLow) {
            return {
                signal,
                day: signalDay,
                signalDate: full?.[signalDay]?.date || '',
                score: getSignalScore(signal, strategy),
                reason: 'price-break',
                invalidationDay: day,
                invalidationDate: full?.[day]?.date || '',
                invalidationLevel: signalLow
            };
        }
        if (signal === 'B8') {
            const k = Number(kValues[day]);
            const d = Number(dValues[day]);
            if (Number.isFinite(k) && Number.isFinite(d) && k <= d) {
                return {
                    signal,
                    day: signalDay,
                    signalDate: full?.[signalDay]?.date || '',
                    score: getSignalScore(signal, strategy),
                    reason: 'kdj-dead-cross',
                    invalidationDay: day,
                    invalidationDate: full?.[day]?.date || '',
                    invalidationLevel: null
                };
            }
        }
    }
    return localBreak;
}

function calculateAllSignals(idx, full, ind) {
    if(idx < 60 || !full[idx]) return { currentDay: idx, currentDate: full?.[idx]?.date || '', currentClose: full?.[idx]?.close ?? null, buySignals: [], exitSignals: [], allSignals: {}, windowScore: 0, windowSignals: [], windowScoreSignals: [], invalidatedWindowSignals: [], localBreakWindowSignals: [], inCooldown: false, cooldownDays: 3, daysSinceExit: Infinity, lastStrongExitDate: '', previousStrongExitDate: '', repeatedStrongExit: false };
    
    const rawSigs = full[idx]?._signals || calculateDailySignals(idx, full, ind), signals = {}, S = STRATEGY; 
    rawSigs.forEach(s => { signals[s] = { status: true, score: SIGNAL_SCORES[s] || 0 }; });
    
    const activeBuySignals = rawSigs.filter(s => S.buySignals?.includes(s)), activeExitSignals = rawSigs.filter(s => S.exitSignals?.includes(s));
    
    let lastExitIdx = -1, previousStrongExitIdx = -1;
    for(let i = idx; i >= Math.max(0, idx - 60); i--) { 
        const daySignals = full[i]?._signals || [];
        const dayStrongExitSet = getStrongExitSignals(S);
        if(daySignals.some(s => s.startsWith('L') && S.exitSignals?.includes(s)
            && dayStrongExitSet.has(s)
            && !isWaveL10TrendHandoffSignal(full, i, s, S)
            && !isWaveMA20TrendDefenseSignal(full, i, s, S))) {
            if(lastExitIdx < 0) lastExitIdx = i;
            else { previousStrongExitIdx = i; break; }
        }
    }
    
    const cooldownDays = 3;
    let inCooldown = false, daysSinceExit = Infinity;
    if(lastExitIdx >= 0 && lastExitIdx < idx) { daysSinceExit = idx - lastExitIdx; if(daysSinceExit <= cooldownDays) inCooldown = true; }
    const repeatedStrongExit = lastExitIdx === idx && previousStrongExitIdx >= 0 && idx - previousStrongExitIdx <= cooldownDays;

    // 波段个股的真实 S 会结束上一段生命周期。旧买入信号不能跨过真实离场继续充当新仓依据，
    // 否则结构失效后会出现“刚卖又买”，而强离场原有的三日冷静期仍保持不变。
    const waveStockDaily = state.strategy === '波段抄底型' && state.mode === 'stock' && state.period === 'daily';
    let lastPositionExitIdx = -1;
    if (waveStockDaily) {
        for (let i = idx - 1; i >= Math.max(0, idx - 60); i--) {
            if (full[i]?._decision?.bsMark === 'S') {
                lastPositionExitIdx = i;
                break;
            }
        }
    }
    const buySignalResetIdx = Math.max(lastExitIdx, lastPositionExitIdx);
    
    let windowSignals = [], invalidatedWindowSignals = [], localBreakWindowSignals = []; const usedSignals = new Set(), groupBest = new Map();
    for(let i = Math.max(0, idx - S.windowDays + 1); i <= idx; i++) {
        (full[i]?._signals || []).forEach(sig => {
            if(!usedSignals.has(sig)) {
                if(sig.startsWith('L') && S.exitSignals?.includes(sig)
                    && !isWaveL10TrendHandoffSignal(full, i, sig, S)
                    && !isWaveMA20TrendDefenseSignal(full, i, sig, S)) { windowSignals.push({day: i, signal: sig}); usedSignals.add(sig); }
                else if(sig.startsWith('B') && S.buySignals?.includes(sig) && i > buySignalResetIdx && isWindowBuySignalEligible(sig, i, full, S)) {
                    const invalidation = getWindowSignalInvalidation(sig, i, idx, full, ind, S);
                    if (invalidation?.reason === 'local-price-break') localBreakWindowSignals.push(invalidation);
                    else if (invalidation) { invalidatedWindowSignals.push(invalidation); return; }
                    const score = getSignalScore(sig, S), groupKey = getScoreGroupKey(S, sig), existing = groupBest.get(groupKey);
                    if(!existing || score > existing.score) groupBest.set(groupKey, { score, signal: sig, day: i, groupKey });
                    windowSignals.push({day: i, signal: sig}); usedSignals.add(sig);
                }
            }
        });
    }
    
    const windowScoreSignals = Array.from(groupBest.values()).map(item => ({
        ...item,
        dayOffset: idx - item.day,
        signalDate: full?.[item.day]?.date || ''
    }));
    return {
        currentDay: idx,
        currentDate: full[idx]?.date || '',
        currentClose: full[idx]?.close ?? null,
        buySignals: activeBuySignals,
        exitSignals: activeExitSignals,
        allSignals: signals,
        windowScore: windowScoreSignals.reduce((sum, item) => sum + item.score, 0),
        windowSignals,
        windowScoreSignals,
        invalidatedWindowSignals,
        localBreakWindowSignals,
        inCooldown,
        cooldownDays,
        daysSinceExit,
        lastStrongExitDate: lastExitIdx >= 0 ? full[lastExitIdx]?.date || '' : '',
        previousStrongExitDate: previousStrongExitIdx >= 0 ? full[previousStrongExitIdx]?.date || '' : '',
        repeatedStrongExit,
        lastPositionExitDate: lastPositionExitIdx >= 0 ? full[lastPositionExitIdx]?.date || '' : '',
        daysSincePositionExit: lastPositionExitIdx >= 0 ? idx - lastPositionExitIdx : Infinity
    };
}

function getCooldownProgress(meta) {
    const total = Math.max(1, Number(meta?.cooldownDays) || 3);
    const day = Math.min(total, Math.max(1, Number(meta?.daysSinceExit) || 1));
    const remaining = Math.max(0, total - day);
    const label = remaining > 0
        ? `离场冷静期第 ${day}/${total} 个交易日，还剩 ${remaining} 个交易日`
        : `离场冷静期第 ${day}/${total} 个交易日，今天结束`;
    return { total, day, remaining, label };
}

function getStrongExitCooldownText(meta) {
    const total = Math.max(1, Number(meta?.cooldownDays) || 3);
    return meta?.repeatedStrongExit
        ? `${total}个交易日冷静期从下一交易日起重新计时`
        : `从下一交易日起进入${total}个交易日冷静期`;
}

function getB11StructureDefenseContext(meta, full, strategy = STRATEGY) {
    const hardBreak = (meta?.invalidatedWindowSignals || []).find(item =>
        item?.signal === 'B11' && item?.defenseType === 'structure'
    );
    const windowSignal = (meta?.windowSignals || []).find(item => item?.signal === 'B11');
    const scoreSignal = (meta?.windowScoreSignals || []).find(item => item?.signal === 'B11');
    const signalDay = Number.isFinite(Number(windowSignal?.day))
        ? Number(windowSignal.day)
        : Number.isFinite(Number(scoreSignal?.day))
        ? Number(scoreSignal.day)
        : Number(hardBreak?.day);
    if (!Number.isFinite(signalDay)) return null;

    const calculated = getB11StructureDefense(signalDay, full, strategy);
    const structureLevel = Number(hardBreak?.invalidationLevel ?? calculated?.structureLevel);
    const localLevel = Number(hardBreak?.localLevel ?? calculated?.localLevel);
    if (!Number.isFinite(structureLevel) || !Number.isFinite(localLevel)) return null;

    const localBreak = (meta?.localBreakWindowSignals || []).find(item =>
        item?.signal === 'B11' && Number(item?.day) === signalDay
    );
    return {
        signal: 'B11',
        signalDay,
        signalDate: hardBreak?.signalDate || full?.[signalDay]?.date || '',
        localLevel,
        structureLevel,
        structureDay: Number(hardBreak?.structureDay ?? calculated?.structureDay),
        structureDate: hardBreak?.structureDate || calculated?.structureDate || '',
        localBreak: !!localBreak,
        localBreakDay: Number(localBreak?.invalidationDay),
        localBreakDate: localBreak?.invalidationDate || '',
        hardInvalidated: !!hardBreak
    };
}

function strategyUsesUnconditionalExitCombo(strategy = STRATEGY) {
    return !!(strategy?.exitSignals?.includes('L3') && strategy?.exitSignals?.includes('L10'));
}

function checkUnconditionalExit(idx, full, ind) {
    if(idx < 5 || !full[idx] || !strategyUsesUnconditionalExitCombo(STRATEGY) || !(full[idx]._signals || []).includes('L3')) return false;
    for(let i = idx; i >= Math.max(0, idx - 4); i--) if((full[i]?._signals || []).includes('L10')) return true;
    return false;
}

function getSignalMeta(idx, full, ind) {
    const sigs = calculateAllSignals(idx, full, ind), S = STRATEGY, windowSignals = sigs.windowSignals || [], hasUncond = checkUnconditionalExit(idx, full, ind);
    const strongExitSet = getStrongExitSignals(S);
    const warns = Object.keys(sigs.allSignals).filter(s => S.warningSignals?.includes(s)), strongExits = sigs.exitSignals.filter(s => strongExitSet.has(s));
    
    let type, cls, detail, logic;
    if (hasUncond) { type = '🛑 清仓规避'; cls = 'core'; detail = '顶背离后MACD死叉'; logic = '触发高危清仓信号'; } 
    else if (strongExits.length > 0) { type = '🚪 趋势破位'; cls = 'core'; detail = '触发核心破位防守'; logic = '防守: ' + strongExits.join(','); } 
    else if (sigs.inCooldown) { type = '⏸️ 离场观望'; cls = 'regular'; detail = getCooldownProgress(sigs).label; logic = `动能清零，需重新积攒`; }
    else if (sigs.windowScore >= S.buyThreshold && warns.length) { type = '⚠️ 谨慎看多'; cls = 'core'; detail = '买入积分达标但伴随过热风险'; logic = warns.join(','); } 
    else if (sigs.windowScore >= S.buyThreshold) { type = '✅ 明确转强'; cls = 'core'; detail = `积分:${sigs.windowScore} 达到买入条件`; logic = '做多信号: ' + (sigs.buySignals.join(',') || '历史积分'); } 
    else if (sigs.windowScore >= Math.max(3, S.buyThreshold - 2)) { type = '👀 关注异动'; cls = 'regular'; detail = `当前积分:${sigs.windowScore}，即将达标`; logic = '接近转强，可列入观察'; } 
    else if (full[idx]?.close > (ind.ma?.[20]?.[idx] || Infinity)) { type = '📈 趋势抱单'; cls = 'regular'; detail = '依托均线多头结构持仓'; logic = '虽无新买点，但大趋势完好'; } 
    else { type = '👀 弱势震荡'; cls = 'regular'; detail = '积分不足，缺乏上行动能'; logic = '耐心等待放量或信号确认'; }
    
    return { ...sigs, windowSignals, type, cls, detail, logic, warningSignals: warns, windowBuyCount: windowSignals.filter(w => w.signal.startsWith('B')).length, windowExitCount: windowSignals.filter(w => w.signal.startsWith('L')).length, triggeredSignals: [...sigs.buySignals, ...sigs.exitSignals] };
}