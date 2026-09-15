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
    
    let windowSignals = [], invalidatedWindowSignals = [], localBreakWindowSignals = []; const usedSignals = new Set(), groupBest = new Map();
    for(let i = Math.max(0, idx - S.windowDays + 1); i <= idx; i++) {
        (full[i]?._signals || []).forEach(sig => {
            if(!usedSignals.has(sig)) {
                if(sig.startsWith('L') && S.exitSignals?.includes(sig)
                    && !isWaveL10TrendHandoffSignal(full, i, sig, S)
                    && !isWaveMA20TrendDefenseSignal(full, i, sig, S)) { windowSignals.push({day: i, signal: sig}); usedSignals.add(sig); }
                else if(sig.startsWith('B') && S.buySignals?.includes(sig) && i > lastExitIdx && isWindowBuySignalEligible(sig, i, full, S)) {
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
        repeatedStrongExit
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

function getWatchPositionForStrategy(strategy, meta) {
    const watchPosition = Number(strategy?.watchPosition || 0);
    if (watchPosition <= 0) return 0;
    const allowedSignals = strategy?.watchPositionSignals;
    if (!Array.isArray(allowedSignals) || allowedSignals.length === 0) return watchPosition;
    const hasAllowedSignal = (meta?.windowSignals || []).some(item => allowedSignals.includes(item.signal));
    return hasAllowedSignal ? watchPosition : 0;
}

function getReadyPositionForStrategy(strategy, meta, fallback) {
    const map = strategy?.signalPositions;
    if (map && typeof map === 'object') {
        let best = 0;
        for (const item of (meta?.windowSignals || [])) {
            if (strategy?.buySignals?.includes(item.signal) && Number.isFinite(Number(map[item.signal]))) best = Math.max(best, Number(map[item.signal]));
        }
        if (best > 0) return best;
    }
    const configured = Number(strategy?.readyPosition || 0);
    return configured > 0 ? configured : fallback;
}

function getBasePosition(idx, full, ind, meta) {
    if (meta.type === '✅ 明确转强') return quantizePosition(getReadyPositionForStrategy(STRATEGY, meta, 80));
    if (meta.type === '⚠️ 谨慎看多') return quantizePosition(Number(STRATEGY.cautiousPosition || 0) || 50);
    if (meta.type === '👀 关注异动') return quantizePosition(getWatchPositionForStrategy(STRATEGY, meta));
    if (meta.type === '📈 趋势抱单') {
        const holdPosition = Number(STRATEGY.holdPosition || 0);
        if (holdPosition > 0) return quantizePosition(holdPosition);
        return 50;
    }
    return 0;
}

function getATR(data, idx, n=14) {
    if(!data || idx < 1 || !data[idx]) return 0;
    const start = Math.max(1, idx - n + 1); let sum = 0, count = 0;
    for(let i = start; i <= idx; i++) {
        const prevClose = data[i-1]?.close || data[i].close;
        sum += Math.max(data[i].high - data[i].low, Math.abs(data[i].high - prevClose), Math.abs(data[i].low - prevClose)); count++;
    }
    return count ? sum / count : 0;
}

function ensureIndexIndicators(id) {
    const data = state.rawData[id]; 
    if (!data || data.length < 60) return null;
    const cacheKey = `daily_${data.length}_${data[data.length-1].date}`;
    if (!indexIndicators[id] || indexIndicators[id].key !== cacheKey) indexIndicators[id] = { key: cacheKey, ma20: Calcs.ma(data, 20), ma60: Calcs.ma(data, 60) };
    return indexIndicators[id];
}

function getIndexTrend(id, date) {
    const data = state.rawData[id];
    if(!data || data.length < 60) return null;
    const idx = findDateIndex(data, date, id); if(idx < 60 || !data[idx]) return null;
    const inds = ensureIndexIndicators(id); if (!inds) return null;
    const ma20Now = inds.ma20[idx], ma60Now = inds.ma60[idx], ma20Prev = inds.ma20[Math.max(0, idx - 5)] || ma20Now;
    const close = data[idx].close; let stateLabel = '震荡', score = 0;
    if(close > ma20Now && ma20Now > ma60Now && ma20Now >= ma20Prev) { stateLabel = '多头'; score = 1; } 
    else if (close < ma20Now && ma20Now < ma60Now) { stateLabel = '空头'; score = -1; }
    return { id, name: getIndexConfig(id)?.name || id, state: stateLabel, score };
}

function getMarketContext(date) {
    const trends = CORE_MARKET_INDEX_IDS.map(id => getIndexTrend(id, date)).filter(Boolean);
    if(!trends.length) return { label:'环境未知', cls:'neutral', increaseCaps:{ ordinary:0, independent:0 }, reason:'核心宽基数据不足，指数暂停增加风险', trends:[] };
    if(trends.length < CORE_MARKET_INDEX_IDS.length) return { label:'环境待确认', cls:'neutral', increaseCaps:{ ordinary:0, independent:0 }, reason:'三项核心宽基尚未补齐，指数暂停增加风险', trends };

    const bull = trends.filter(t => t.score > 0), bear = trends.filter(t => t.score < 0);

    // reason 只在大盘页的核心宽基环境卡片展示，因此统一按指数口径描述，不再提及个股。
    // 只写普通机会这一档：independent 档在全量回放里仅占偏弱 bar 的 0.09%，
    // 常驻展示会让读者以为它是常见分档。真正命中时由右侧结论面板按当天分档说明。
    let label, cls, increaseCaps = null, reason;
    if (bull.length >= 2) { label = '核心宽基偏强'; cls = 'bull'; reason = '三项核心宽基多数走强，指数新增风险不受限'; }
    else if (bear.length >= 2) {
        label = '核心宽基偏弱';
        cls = 'bear';
        increaseCaps = { ordinary:30, independent:50 };
        reason = `三项核心宽基多数空头；指数普通机会新增风险上限 ${increaseCaps.ordinary}%`;
    }
    else { label = '核心宽基分化'; cls = 'neutral'; reason = '三项核心宽基未形成多数空头，不额外限制指数新增风险'; }
    return { label, cls, increaseCaps, reason, trends };
}

function getRiskContext(idx, full, ind) {
    if (!full || !full[idx]) return { score: 100, level: '未知', coef: 1, flags: [], atrPct: 0, distMA20: 0, drawdown: 0, support: 0, pressure: 0, watch: 0, stop: 0, ma60: null };
    const item = full[idx], close = item.close, atr = getATR(full, idx), atrPct = close ? atr / close : 0;
    const ma20 = ind.ma?.[20]?.[idx], ma60 = ind.ma?.[60]?.[idx], recent = full.slice(Math.max(0, idx - 19), idx + 1);
    const high20 = recent.length ? Math.max(...recent.map(d => d.high)) : close, low20 = recent.length ? Math.min(...recent.map(d => d.low)) : close;
    const drawdown = high20 ? (high20 - close) / high20 : 0, distMA20 = ma20 ? (close - ma20) / ma20 : 0;
    
    let score = 100; const flags = [];
    if(atrPct > 0.06) { score -= 25; flags.push('波动过高'); } else if(atrPct > 0.04) { score -= 15; flags.push('波动偏高'); } else if(atrPct > 0.025) score -= 8;
    if(distMA20 > 0.12) { score -= 20; flags.push('偏离MA20过远'); } else if(distMA20 > 0.08) { score -= 10; flags.push('短线偏热'); }
    if(distMA20 < -0.05) { score -= 18; flags.push('跌破MA20较深'); }
    if(drawdown > 0.12) { score -= 20; flags.push('回撤较深'); } else if(drawdown > 0.07) score -= 10;
    
    const level = score >= 80 ? '低波动/偏离' : score >= 60 ? '中等波动/偏离' : score >= 40 ? '高偏离风险' : '极端波动风险';
    const coef = score >= 80 ? 1 : score >= 60 ? 0.75 : score >= 40 ? 0.5 : 0.25;
    return { score: Math.max(0, Math.round(score)), level, coef, flags, atrPct, distMA20, drawdown, support: low20, pressure: high20, watch: ma20 || close, stop: Math.min(Math.max(low20, close - atr * 2), close), ma60: ma60 || null };
}

function getRiskAdjustmentDetails(risk = {}) {
    const flags = Array.isArray(risk.flags) ? risk.flags : [];
    const details = [];
    const drawdown = Number(risk.drawdown);
    const atrPct = Number(risk.atrPct);
    const distMA20 = Number(risk.distMA20);
    const hasHeatFlag = flags.includes('短线偏热') || flags.includes('偏离MA20过远');
    if (hasHeatFlag && Number.isFinite(distMA20)) details.push(`收盘价高于MA20 ${(distMA20 * 100).toFixed(1)}%`);
    if (flags.includes('跌破MA20较深') && Number.isFinite(distMA20)) details.push(`收盘价低于MA20 ${(Math.abs(distMA20) * 100).toFixed(1)}%`);
    if ((flags.includes('回撤较深') || drawdown > 0.07) && Number.isFinite(drawdown)) details.push(`近20日高点回撤 ${(drawdown * 100).toFixed(1)}%`);
    if ((flags.includes('波动偏高') || flags.includes('波动过高') || atrPct > 0.025) && Number.isFinite(atrPct)) details.push(`14日波动 ${(atrPct * 100).toFixed(1)}%`);
    flags.forEach(flag => {
        if (!['短线偏热', '偏离MA20过远', '跌破MA20较深', '回撤较深', '波动偏高', '波动过高'].includes(flag)) details.push(flag);
    });
    if (hasHeatFlag && !Number.isFinite(distMA20)) details.push(flags.includes('偏离MA20过远') ? '偏离MA20过远' : '短线偏热');
    if (flags.includes('跌破MA20较深') && !Number.isFinite(distMA20)) details.push('跌破MA20较深');
    if (flags.includes('回撤较深') && !Number.isFinite(drawdown)) details.push('回撤较深');
    if ((flags.includes('波动偏高') || flags.includes('波动过高')) && !Number.isFinite(atrPct)) details.push(flags.includes('波动过高') ? '波动过高' : '波动偏高');
    return details;
}

function hasShortTermHeatRisk(meta, risk) {
    const flags = risk?.flags || [];
    return flags.includes('短线偏热')
        || flags.includes('偏离MA20过远')
        || (meta?.warningSignals || []).includes('W1');
}

function getExitSeverity(meta, idx, full, ind) {
    const exits = meta.exitSignals || [], raw = Object.keys(meta.allSignals || {});
    if (meta.type && meta.type.includes('清仓规避')) return { level: '清仓防守', detail: '触发高危清仓信号' };
    const strongExitSet = getStrongExitSignals(STRATEGY);
    const strongExitSignals = exits.filter(s => strongExitSet.has(s));
    if (strongExitSignals.length) return { level: '强离场', detail: `触发核心破位防守：${strongExitSignals.map(s => getUserSignalText(s)).join('+')}` };
    if (exits.some(s => ['L1', 'L2', 'L3', 'L5', 'L6', 'L7', 'L8'].includes(s)) || (meta.warningSignals || []).length) return { level: '减仓观察', detail: '短线动能转弱或过热，适合降低仓位等待结构确认' };
    if (meta.windowSignals) {
        const recentExits = meta.windowSignals.filter(w => w.signal.startsWith('L') && (idx - w.day) >= 1 && (idx - w.day) <= 2);
        if (recentExits.length > 0 && ind.ma?.[5] && full[idx] && full[idx].close < ind.ma[5][idx]) return { level: '延续防守', detail: '近期高位释放过防守信号，尚未重获短期均线支撑' };
    }
    return { level: '无明确离场', detail: '暂未看到需要立即防守的核心离场信号' };
}

function getExitSignalEvidence(meta, decision) {
    const direct = meta.exitSignals || [];
    const windowExits = (meta.windowSignals || []).filter(w => w.signal.startsWith('L')).slice(-4).map(w => w.signal);
    const logicMap = {
        L1: '跌破短期趋势线',
        L2: '短中期均线死叉',
        L3: 'MACD 死叉',
        L4: '跌破 20 日线',
        L5: '阴包阳',
        L6: '连阳后首阴',
        L7: 'RSI 超买回落',
        L8: '布林上轨受阻',
        L9: '高点回撤破位',
        L10: 'MACD 顶背离'
    };
    const directDesc = direct.length ? direct.map(s => `${s} ${logicMap[s] || getUserSignalText(s)}`).join(' / ') : '无直接离场信号';
    const windowDesc = windowExits.length ? windowExits.map(s => `${s} ${logicMap[s] || getUserSignalText(s)}`).join(' / ') : '近窗内无额外离场形态';
    const exitText = decision?.exit?.detail || '暂无明确离场依据';
    return { direct, window: windowExits, directDesc, windowDesc, exitText };
}

function getPositionDriverText(meta, market, risk, exit, base, position, prevPos, positionCap = null, marketGate = null, riskCapOverride = null) {
    if (exit.level === '清仓防守' || exit.level === '强离场') {
        return `触发${exit.level}，${meta.exitSignals?.length ? `技术离场 ${meta.exitSignals.join(' / ')}` : '按防守规则直接处理'}。`;
    }
    if (meta.inCooldown) {
        return `${getCooldownProgress(meta).label}，先观察再说。`;
    }
    if (base <= 0) {
        return '基础仓位为 0%，当前不满足开仓条件。';
    }

    const pieces = [`基础 ${base}%`];
    if (positionCap?.reason) pieces.push(positionCap.reason);
    if (marketGate?.detail) pieces.push(marketGate.detail);
    pieces.push(position === prevPos ? `维持 ${position}%` : `调整至 ${position}%`);
    if (position === 0 && prevPos > 0) pieces.push(`较前次收至 0%`);
    return pieces.join('，') + '。';
}

function formatPriceLevel(value) {
    return Number.isFinite(value) ? Number(value).toFixed(2) : '--';
}

function formatRatioPercent(value, digits = 1) {
    const number = Number(value);
    return Number.isFinite(number) ? `${(Math.abs(number) * 100).toFixed(digits)}%` : '--';
}

function getWavePressureSourceText(waveRejection) {
    const sources = Array.isArray(waveRejection?.pressureSources) ? waveRejection.pressureSources : [];
    const texts = [];
    const invalidationGroups = new Map();
    for (const source of sources) {
        const level = Number(source?.level);
        if (!Number.isFinite(level)) continue;
        if (source?.type === 'signal_invalidation') {
            const key = level.toFixed(4);
            if (!invalidationGroups.has(key)) invalidationGroups.set(key, { level, signals: [] });
            if (source.signal) invalidationGroups.get(key).signals.push(getUserSignalText(source.signal));
            continue;
        }
        if (source?.type === 'ma' && Number.isFinite(Number(source.period))) {
            texts.push(`MA${Number(source.period)} ${formatPriceLevel(level)}`);
        } else if (source?.type === 'pivot') {
            texts.push(`${source.date ? `${source.date}的` : '近期'}结构高点${formatPriceLevel(level)}`);
        } else if (source?.type === 'signal_low') {
            texts.push(`${source.date ? `${source.date}的` : ''}买入日低点${formatPriceLevel(level)}`);
        } else if (source?.type === 'recent_high') {
            texts.push(`近期高点${formatPriceLevel(level)}`);
        }
    }
    for (const group of invalidationGroups.values()) {
        const names = [...new Set(group.signals)].slice(0, 2);
        const nameText = names.length ? `${names.join('、')}${group.signals.length > names.length ? '等' : ''}` : '买入信号';
        texts.push(`${nameText}失效位${formatPriceLevel(group.level)}`);
    }
    return [...new Set(texts)].slice(0, 2).join('、') || '对应压力位';
}

function getWaveEventEvidenceText(waveRejection) {
    const eventDate = waveRejection?.triggerDate || '当日';
    const entryDate = waveRejection?.entryDate || '';
    const entryCloseLabel = entryDate ? `${entryDate}买入收盘` : '买入日收盘';
    const entryLowLabel = entryDate ? `${entryDate}买入日最低价` : '买入日最低价';
    const highText = formatPriceLevel(Number(waveRejection?.triggerHigh));
    const lowText = formatPriceLevel(Number(waveRejection?.triggerLow));
    const closeText = formatPriceLevel(Number(waveRejection?.triggerClose));
    const entryCloseText = formatPriceLevel(Number(waveRejection?.entryClose));
    const entryLowText = formatPriceLevel(Number(waveRejection?.entrySignalLow));
    const pressureText = getWavePressureSourceText(waveRejection);
    const upperShadowText = formatRatioPercent(waveRejection?.upperShadowRangeRatio);
    const entryChange = Number(waveRejection?.profitRatio);
    const entryChangeText = Number.isFinite(entryChange)
        ? `较${entryCloseLabel}${entryCloseText}${entryChange >= 0 ? '上涨' : '下跌'}${formatRatioPercent(entryChange)}`
        : '';
    if (waveRejection?.status === 'entry_blocked' || waveRejection?.eventType === 'entry_day_pressure_rejection') {
        return `${eventDate}高点${highText}触及${pressureText}，收盘${closeText}仍在压力位下方，上影占全天振幅${upperShadowText}`;
    }
    if (['fresh_entry_failure', 'fresh_entry_ma20_hold'].includes(waveRejection?.eventType)) {
        const closeAtLowText = Number(waveRejection?.triggerClose) <= Number(waveRejection?.triggerLow) ? '并收在全天最低' : `，全天最低${lowText}`;
        const secondDayAttackText = Number(waveRejection?.entryAge) === 2
            ? (waveRejection?.pressureAttackType === 'new_source'
                ? '，第二个交易日首次进入新的压力区'
                : `，第二个交易日高点较前一日继续提高${formatRatioPercent(waveRejection?.secondDayHighAdvanceRatio)}`)
            : '';
        return `${eventDate}高点${highText}触及${pressureText}${secondDayAttackText}，随后回落至${closeText}${closeAtLowText}；${entryChangeText}，上影占全天振幅${upperShadowText}`;
    }
    if (waveRejection?.eventType === 'fresh_entry_hard_break') {
        return `${eventDate}收盘跌破${entryLowLabel}${entryLowText}（收盘${closeText}）${entryChangeText ? `，${entryChangeText}` : ''}`;
    }
    if (waveRejection?.eventType === 'fresh_entry_downside_failure') {
        const defenseGapText = formatRatioPercent(waveRejection?.downsideCloseGapRatio);
        const bodyText = formatRatioPercent(waveRejection?.downsideBearBodyRangeRatio);
        return `${eventDate}盘中最低${lowText}跌破${entryLowLabel}${entryLowText}，收盘${closeText}距该防守位仅${defenseGapText}，阴线实体占全天振幅${bodyText}`;
    }
    if (waveRejection?.eventType === 'signal_hard_invalidation') {
        return `${eventDate}收盘${closeText}跌破${pressureText}`;
    }
    const highPullback = Number(waveRejection?.triggerHigh) > 0
        ? Number(waveRejection.triggerClose) / Number(waveRejection.triggerHigh) - 1
        : NaN;
    const volumeText = Number.isFinite(Number(waveRejection?.volumeRatio))
        ? `，成交量为近5日均量${Number(waveRejection.volumeRatio).toFixed(1)}倍`
        : '';
    return `${eventDate}高点${highText}触及${pressureText}后回落至${closeText}，从日内高点回撤${formatRatioPercent(highPullback)}，上影占全天振幅${upperShadowText}${volumeText}`;
}

function getEffectiveWindowBuySignals(meta, strategy = STRATEGY) {
    const explicit = Array.isArray(meta?.windowScoreSignals) ? meta.windowScoreSignals : [];
    if (explicit.length) {
        return explicit
            .filter(item => item?.signal?.startsWith('B'))
            .map(item => ({ ...item, score: Number(item.score) || getSignalScore(item.signal, strategy) }))
            .sort((a, b) => (b.score - a.score) || ((a.dayOffset ?? Infinity) - (b.dayOffset ?? Infinity)));
    }

    const groupBest = new Map();
    for (const item of (meta?.windowSignals || [])) {
        const signal = item?.signal;
        if (!signal?.startsWith('B') || !strategy?.buySignals?.includes(signal)) continue;
        const score = getSignalScore(signal, strategy);
        const groupKey = getScoreGroupKey(strategy, signal);
        const existing = groupBest.get(groupKey);
        if (!existing || score > existing.score) groupBest.set(groupKey, { ...item, score, groupKey, dayOffset: item.dayOffset });
    }
    if (!groupBest.size) {
        for (const signal of (meta?.buySignals || [])) {
            const score = getSignalScore(signal, strategy);
            const groupKey = getScoreGroupKey(strategy, signal);
            const existing = groupBest.get(groupKey);
            if (!existing || score > existing.score) groupBest.set(groupKey, { signal, score, groupKey, dayOffset: 0 });
        }
    }
    return Array.from(groupBest.values()).sort((a, b) => (b.score - a.score) || ((a.dayOffset ?? Infinity) - (b.dayOffset ?? Infinity)));
}

function getSignalCauseSummary(meta, maxSignals = 2) {
    const items = getEffectiveWindowBuySignals(meta);
    const selected = items.slice(0, Math.max(1, maxSignals));
    const names = selected.map(item => getUserSignalText(item.signal));
    if (!names.length) return { items, selected, names, timing: '', text: '' };
    const currentDay = Number(meta?.currentDay);
    const todayNames = [];
    const historical = new Map();
    selected.forEach((item, index) => {
        const isToday = Number(item?.dayOffset) === 0 || (Number.isFinite(currentDay) && Number(item?.day) === currentDay);
        if (isToday) {
            todayNames.push(names[index]);
            return;
        }
        const date = item?.signalDate || (item?.dayDate || '此前');
        if (!historical.has(date)) historical.set(date, []);
        historical.get(date).push(names[index]);
    });
    const parts = [];
    if (todayNames.length) parts.push(`今日出现${todayNames.join('、')}`);
    historical.forEach((signalNames, date) => {
        parts.push(`${date}出现${signalNames.join('、')}，目前仍有效`);
    });
    const timing = todayNames.length && historical.size ? '今日与历史窗口' : (todayNames.length ? '今日' : '历史窗口');
    const extraText = items.length > selected.length ? '；另有其他有效信号' : '';
    return { items, selected, names, timing, text: `${parts.join('；')}${extraText}` };
}

function getPlainPositionLimitText(reason = '') {
    return String(reason || '')
        .replace(/W4缩量上涨背离/g, '上涨动能减弱')
        .replace(/W\d+/g, '')
        .replace(/个股处于中期下降趋势/g, '个股中期趋势偏弱')
        .replace(/个股尚未形成完整多头结构/g, '个股多头结构还未确认')
        .replace(/个股趋势数据不足/g, '个股趋势数据不足')
        .replace(/高仓位上限/g, '仓位上限')
        .replace(/^[，、；\s]+|[，、；\s]+$/g, '')
        .replace(/[，、；]\s*[，、；]/g, '，')
        .replace(/；+/g, '；')
        .trim();
}

function getPlainDisplayText(text = '') {
    return String(text || '')
        .replace(/B11/g, '局部回踩信号')
        .replace(/\b[BLW]\d+\b/g, '')
        .replace(/近窗/g, '最近几个交易日')
        .replace(/核心宽基偏弱下/g, '核心宽基偏弱时')
        .replace(/增仓门禁/g, '市场新增风险限制')
        .replace(/风险系数/g, '风险评估')
        .replace(/风险评分进入极端风险档/g, '当前风险已进入极端风险档')
        .replace(/风险评分/g, '风险状况')
        .replace(/\s+([，。；：])/g, '$1')
        .replace(/([，。；：])\s+/g, '$1')
        .replace(/[，、；]\s*[，、；]/g, '，')
        .replace(/出现\s+/g, '出现')
        .replace(/；+/g, '；')
        .replace(/：\s*，/g, '：')
        .trim();
}

// 只在风险评估真正压低仓位时才输出一句解释；没有压低时返回空串，由调用方跳过，
// 避免在“为什么是 X%”里出现一条并未生效的风险限制描述。
function getPlainRiskAdjustmentText(risk = {}, basePosition, riskCoef, adjustedPosition, positionLabel = '基础仓位', riskCapOverride = null) {
    const base = Number(basePosition);
    const cap = Number.isFinite(riskCapOverride) ? riskCapOverride : getRiskPositionCap(risk);
    const details = getRiskAdjustmentDetails(risk);
    if (!Number.isFinite(base) || base <= cap) return '';
    const reasonText = details.length ? details.join('、') : '当前风险偏高';
    return cap > 0
        ? `因${reasonText}，${positionLabel}最高按${cap}%档执行`
        : `因${reasonText}，${positionLabel}归零防守`;
}

function getRiskCoefficientText(risk = {}) {
    const cap = getRiskPositionCap(risk);
    const score = Number(risk.score);
    const details = getRiskAdjustmentDetails(risk);
    const evidence = [...details];
    if (Number.isFinite(score)) evidence.push(`风险评分 ${score}/100`);
    if (!evidence.length && risk.level && risk.level !== '未知') evidence.push(risk.level);
    return `风险最高允许${cap}%${evidence.length ? `（${evidence.join('、')}）` : ''}`;
}

function getStockPositionChangeDetails(meta, decision, signalCause, previousPosition, position, mode = 'stock') {
    const isIndex = mode === 'index';
    const scoreName = isIndex ? '指数动能积分' : '买入积分';
    const signalName = isIndex ? '指数动能信号' : '买入信号';
    const basePositionLabel = isIndex ? '基础风险仓位' : '基础仓位';
    const currentPositionLabel = isIndex ? '风险仓位' : '仓位';
    const scoreText = `${meta?.windowScore ?? 0}/${STRATEGY?.buyThreshold ?? '-'}`;
    const causeText = signalCause?.text || `当前有效${signalName}`;
    const basePosition = Number(decision?.basePosition);
    const exitLevel = decision?.exit?.level || '无明确离场';
    const directExitSignals = meta?.exitSignals || [];
    const warningSignals = meta?.warningSignals || [];
    const exitNames = directExitSignals.map(getUserSignalText);
    const warningNames = warningSignals.map(getUserSignalText);
    const isEntry = previousPosition === 0 && position > 0;
    const isIncrease = position > previousPosition;
    const isReduce = previousPosition > 0 && position > 0 && position < previousPosition;
    const isExit = previousPosition > 0 && position === 0;
    const path = [];
    let hasLimiter = false;

    if (Number.isFinite(basePosition)) {
        if (basePosition <= 0) {
            path.push(isIndex ? '当前指数动能不足，基础风险仓位为0%' : '当前没有满足开仓条件，基础仓位为0%');
        } else {
            path.push(`${basePositionLabel}为${basePosition}%（信号计算结果）`);
        }
    } else if (signalCause?.text) {
        path.push(`${basePositionLabel}由${signalCause.text}计算`);
    } else if (position > 0) {
        path.push(`当前没有新增${signalName}，${basePositionLabel}沿用现有持仓判断`);
    } else {
        path.push(isIndex ? '当前指数动能不足，基础风险仓位按0%处理' : '当前没有有效买入信号，基础仓位按0%处理');
    }

    const marketGate = decision?.marketGate || {};
    const isCriticalExit = ['清仓防守', '强离场'].includes(exitLevel)
        || ['清仓离场', '规避风险'].includes(decision?.simpleAction);
    if (isCriticalExit) {
        hasLimiter = true;
        const triggerText = exitNames.length ? `出现${exitNames.join('、')}` : getPlainDisplayText(decision?.exit?.detail || exitLevel);
        path.push(`${triggerText}，强离场规则要求${currentPositionLabel}归零`);
    } else if (meta?.inCooldown) {
        hasLimiter = true;
        path.push(`${getCooldownProgress(meta).label}，冷静期要求${currentPositionLabel}保持0%`);
    } else {
        const b11Defense = decision?.b11StructureDefense;
        if (!isIndex && state.mode === 'stock' && state.strategy === '波段抄底型' && b11Defense?.localBreak) {
            hasLimiter = true;
            path.push('局部回踩失守但结构位未破，暂停加仓，保留当前试探仓');
        }
        if (decision?.softSignalGrace?.applied) {
            hasLimiter = true;
            path.push(`短线动能转弱但仍在观察期，先保留当前${currentPositionLabel}观察${decision.softSignalGrace.days}个交易日`);
        }
        const isDefensiveCap = ['减仓观察', '延续防守'].includes(exitLevel);
        if (isDefensiveCap) {
            hasLimiter = true;
            const triggerText = exitNames.length
                ? `出现${exitNames.join('、')}`
                : (warningNames.length ? `出现${warningNames.join('、')}预警` : getPlainDisplayText(decision?.exit?.detail || exitLevel));
            path.push(`${triggerText}，${currentPositionLabel}防守上限为30%`);
        } else if (warningNames.length) {
            hasLimiter = true;
            path.push(`出现${warningNames.join('、')}预警，仓位最高按30%档执行`);
        }
        if (!isIndex && decision?.positionCap?.reason) {
            hasLimiter = true;
            path.push(getPlainPositionLimitText(decision.positionCap.reason));
        }
    }

    // 核心宽基只对指数路径形成新增风险上限，个股不再受它约束。
    if (isIndex && marketGate.type === 'increase-capped') {
        hasLimiter = true;
        const tierText = marketGate.strengthTier === 'independent' ? '指数自身独立走强' : '普通机会';
        path.push(`核心宽基偏弱时，${tierText}新增风险上限为${marketGate.cap}%，已有${currentPositionLabel}不因市场偏弱被动降低`);
    }
    // 没有任何限制生效时，只说明这次提高由什么驱动；不再罗列并未发生的风险下调或市场截断，
    // 否则读者会以为存在一条正在作用的限制。
    if (isIncrease && !hasLimiter) {
        path.push(isIndex ? '本次提高风险仓位由指数自身动能与趋势决定' : '本次提高仓位由个股信号与趋势决定');
    }
    if (position === previousPosition && position > 0) {
        const sourceText = signalCause?.text || `此前形成的有效${signalName}`;
        const higherTierText = !hasLimiter ? `，但尚未满足进入更高${currentPositionLabel}档位的条件` : '';
        // 历史信号文案已自带“目前仍有效”，此处只接“支持当前仓位”，避免出现两个“仍”。
        const holdText = /目前仍有效$/.test(sourceText) ? sourceText.replace(/有效$/, '') : `${sourceText}仍`;
        path.push(`${holdText}支持当前${currentPositionLabel}${higherTierText}`);
    } else if (position === previousPosition && position === 0) {
        path.push(isIndex ? '当前没有提高市场风险的依据，继续保持低风险' : '当前没有有效开仓依据，继续保持空仓');
    }
    const finalChangeText = isIndex
        ? (previousPosition === 0
            ? (position === 0 ? '最终风险仓位保持0%' : `最终风险仓位由0%提高至${position}%`)
            : (position === previousPosition ? `最终风险仓位维持${position}%`
                : `最终风险仓位由${previousPosition}%${position > previousPosition ? '提高至' : '降至'}${position}%`))
        : (previousPosition === 0
            ? (position === 0 ? '最终保持0%空仓' : `最终由空仓转为${position}%`)
            : (position === previousPosition ? `最终维持${position}%`
                : `最终由${previousPosition}%${position > previousPosition ? '提高至' : '降至'}${position}%`));
    path.push(`因此${finalChangeText}`);

    let reason = '';
    if (isEntry) {
        reason = `${causeText}使${scoreName}达到 ${scoreText}，满足首次建仓条件`;
    } else if (isIncrease) {
        reason = `${causeText}使${scoreName}达到 ${scoreText}，满足继续增加仓位条件`;
    } else if (isReduce) {
        const drivers = [];
        if (exitNames.length) drivers.push(`出现${exitNames.join('、')}`);
        if (warningNames.length) drivers.push(`出现${warningNames.join('、')}预警`);
        if (!exitNames.length && !warningNames.length && ['减仓观察', '延续防守'].includes(exitLevel) && decision?.exit?.detail) drivers.push(decision.exit.detail);
        if (Number.isFinite(basePosition) && basePosition < previousPosition) drivers.push(`买入积分为${scoreText}，所以信号给出的基础仓位从${previousPosition}%降至${basePosition}%`);
        if (decision?.positionCap?.reason) drivers.push(getPlainPositionLimitText(decision.positionCap.reason));
        reason = `${drivers.length ? [...new Set(drivers)].slice(0, 3).join('；') : `当前信号对应基础仓位为${Number.isFinite(basePosition) ? `${basePosition}%` : `${position}%`}`}`;
    } else if (isExit) {
        const triggerText = exitNames.length
            ? `出现${exitNames.join('、')}`
            : (basePosition <= 0 ? `买入积分降至 ${scoreText}，原持仓依据失效` : getPlainDisplayText(decision?.exit?.detail || '离场条件成立'));
        reason = triggerText;
    }

    return {
        reason,
        positionExplanation: path.join('；')
    };
}

function getWaveBQualityMetadata(meta, decision, ruleset = WAVE_B_QUALITY_RULESET) {
    if (state.strategy !== '波段抄底型' || state.mode !== 'stock' || decision?.bsMark !== 'B') return null;
    const qualityStatus = ruleset?.status;
    if (!['trial', 'approved'].includes(qualityStatus)) return { bQuality: 'standard', bQualityReasons: [], bQualityRuleId: null };
    const signals = new Set((meta?.windowScoreSignals || []).map(item => item?.signal).filter(Boolean));
    const rule = (ruleset?.rules || []).find(item =>
        (item.requiredSignals || []).every(signal => signals.has(signal))
    );
    if (!rule) return { bQuality: 'standard', bQualityReasons: [], bQualityRuleId: null };
    return {
        bQuality: qualityStatus === 'trial' ? 'trial' : 'strong',
        bQualityReasons: (rule.reasons || []).slice(0, 2),
        bQualityRuleId: rule.id
    };
}

function getTodaySignalInvalidations(meta, reason = '') {
    const currentDay = Number(meta?.currentDay);
    const items = reason === 'local-price-break'
        ? meta?.localBreakWindowSignals || []
        : meta?.invalidatedWindowSignals || [];
    return items.filter(item => {
        if (Number(item?.invalidationDay) !== currentDay) return false;
        return !reason || item?.reason === reason;
    });
}

function getSignalLifecycleTransition(meta, decision, mode = 'stock') {
    const hard = getTodaySignalInvalidations(meta, 'price-break');
    const local = getTodaySignalInvalidations(meta, 'local-price-break');
    const soft = getTodaySignalInvalidations(meta, 'kdj-dead-cross');
    const threshold = Number(STRATEGY?.buyThreshold) || 0;
    const currentScore = Number(meta?.windowScore) || 0;
    const previousScore = Number(decision?.previousWindowScore);
    const fallbackPreviousScore = currentScore + [...hard, ...soft].reduce((sum, item) => sum + (Number(item?.score) || 0), 0);
    const fromScore = Number.isFinite(previousScore) ? previousScore : fallbackPreviousScore;
    const scoreName = mode === 'index' ? '指数动能积分' : '买入积分';
    const scoreDelta = fromScore > currentScore
        ? `${scoreName}由${fromScore}/${threshold}降至${currentScore}/${threshold}`
        : `${scoreName}当前为${currentScore}/${threshold}`;
    const position = Number(decision?.position) || 0;
    const previousPosition = Number(decision?.prevAdv) || 0;
    const currentClose = Number(meta?.currentClose);
    const frozenHardDefense = Number(decision?.waveContext?.frozenHardDefense);
    const frozenDefenseLabel = decision?.waveContext?.supportSource === 'signal-low'
        ? '底部防守位'
        : '底部结构支撑';
    const signalBreakKeepsStructure = mode === 'stock'
        && position > 0
        && Number.isFinite(currentClose)
        && Number.isFinite(frozenHardDefense)
        && currentClose >= frozenHardDefense;

    if (hard.length) {
        const levels = [...new Set(hard.map(item => {
            const level = Number(item?.invalidationLevel);
            if (!Number.isFinite(level)) return '';
            if (item?.defenseType === 'structure') {
                const dateText = item?.structureDate ? `（${item.structureDate}确认）` : '';
                return `结构防守位${level.toFixed(2)}${dateText}`;
            }
            return `信号防守位${level.toFixed(2)}`;
        }).filter(Boolean))];
        const levelText = levels.length === 1 ? levels[0] : `相关${levels.join('/')}`;
        const closeText = Number.isFinite(Number(meta?.currentClose)) ? Number(meta.currentClose).toFixed(2) : '--';
        const signalText = hard.map(item => `${getUserSignalText(item.signal)}(+${Number(item.score) || 0})`).join('、');
        if (signalBreakKeepsStructure) {
            return {
                kind: 'local',
                text: `今日收盘${closeText}跌破${levelText}，${signalText}失效，但${frozenDefenseLabel}${frozenHardDefense.toFixed(2)}未破；${scoreDelta}，保留${position}%试探仓观察，不生成S`
            };
        }
        let actionText;
        if (mode === 'index') {
            if (position === 0) actionText = previousPosition > 0 ? `风险仓位从${previousPosition}%降至0%` : '当前保持低风险暴露';
            else if (previousPosition === 0) actionText = `风险仓位由0%提高至${position}%`;
            else if (position < previousPosition) actionText = `风险仓位从${previousPosition}%降至${position}%`;
            else if (position > previousPosition) actionText = `风险仓位从${previousPosition}%提高至${position}%`;
            else actionText = `当前维持${position}%风险仓位`;
        } else {
            if (position === 0) {
                actionText = previousPosition > 0
                    ? (previousPosition <= 30 ? `退出${previousPosition}%试探仓，当前空仓观察` : `仓位从${previousPosition}%降至0%`)
                    : '当前保持空仓观察';
            } else if (previousPosition === 0) actionText = `本次由空仓转为${position}%轻仓试探`;
            else if (position < previousPosition) actionText = `当前从${previousPosition}%降至${position}%防守`;
            else if (position > previousPosition) actionText = `当前从${previousPosition}%提高至${position}%`;
            else actionText = `当前维持${position}%${position <= 30 ? '轻仓' : '仓位'}观察`;
        }
        return {
            kind: 'hard',
            text: `今日收盘${closeText}跌破${levelText}，${signalText}失效，${scoreDelta}；${actionText}`
        };
    }

    if (local.length) {
        const item = local[0];
        const localLevel = Number(item?.invalidationLevel);
        const structureLevel = Number(item?.structureLevel);
        const localText = Number.isFinite(localLevel) ? localLevel.toFixed(2) : '局部防守位';
        const structureText = Number.isFinite(structureLevel)
            ? `结构防守位${structureLevel.toFixed(2)}${item?.structureDate ? `（${item.structureDate}确认）` : ''}`
            : '结构防守位';
        const closeText = Number.isFinite(Number(meta?.currentClose)) ? Number(meta.currentClose).toFixed(2) : '--';
        const actionText = position > 0
            ? `暂停加仓，当前维持${position}%${position <= 30 ? '试探仓' : '仓位'}观察`
            : '当前不再按该局部信号新增仓位';
        return {
            kind: 'local',
            text: `今日收盘${closeText}跌破${getUserSignalText(item.signal)}局部防守位${localText}，但仍在${structureText}上方；${actionText}`
        };
    }

    if (soft.length) {
        const lostScore = soft.reduce((sum, item) => sum + (Number(item?.score) || 0), 0);
        let actionText = mode === 'index' ? `当前保持${position}%低风险暴露观察` : `当前保持${position}%试探仓观察`;
        if (decision?.softSignalGrace?.applied) {
            actionText = mode === 'index'
                ? `价格尚未跌破信号防守位，${position}%低风险暴露保留${decision.softSignalGrace.days}个交易日观察`
                : `价格尚未跌破信号防守位，${position}%试探仓保留${decision.softSignalGrace.days}个交易日观察`;
        }
        return {
            kind: 'soft',
            text: `KDJ金叉已转为死叉，${lostScore}分失效，${scoreDelta}；${actionText}`
        };
    }

    if (decision?.previousSoftSignalGrace && previousPosition > 0 && position === 0) {
        return {
            kind: 'soft-expired',
            text: `KDJ金叉失效后的1日观察期结束，${scoreName}仍为${currentScore}/${threshold}，${mode === 'index' ? `风险仓位从${previousPosition}%降至0%` : `退出${previousPosition}%试探仓，当前空仓观察`}`
        };
    }
    return { kind: '', text: '' };
}

function getStockInvalidCondition(meta, decision, position, hasWarning) {
    const threshold = STRATEGY?.buyThreshold ?? '-';
    const currentScore = meta?.windowScore ?? 0;
    const stopText = formatPriceLevel(decision?.risk?.stop);
    const canShowStop = stopText !== '--';
    const b11Defense = decision?.b11StructureDefense;
    const structureLevel = Number(b11Defense?.structureLevel);
    const structureDateText = b11Defense?.structureDate ? `（${b11Defense.structureDate}确认）` : '';
    const hasB11StructureDefense = Number.isFinite(structureLevel);
    const waveEntryBlocked = position === 0
        && Number(currentScore) >= Number(threshold)
        && decision?.waveContext?.inScope
        && decision.waveContext.mainEvent;

    if (position === 0 && hasB11StructureDefense && b11Defense?.hardInvalidated) {
        return `已收盘跌破结构防守位 ${structureLevel.toFixed(2)}${structureDateText}；待买入积分重新达到 ${threshold}/${threshold} 后，才重新考虑。`;
    }

    if (waveEntryBlocked) {
        const nextCondition = decision.waveContext.nextCondition || '等待当前环境完成确认';
        const stopGuard = canShowStop ? `若继续跌破防守位 ${stopText}，继续空仓观望。` : '若继续出现防守信号，继续空仓观望。';
        return `${nextCondition}后再考虑开仓；当前买入积分已达到 ${currentScore}/${threshold}。${stopGuard}`;
    }

    if (position > 0 && position <= 30 && hasB11StructureDefense) {
        const localHint = b11Defense?.localBreak ? 'B11局部回踩已失守，当前暂停加仓；' : '';
        return `${localHint}若收盘跌破结构防守位 ${structureLevel.toFixed(2)}${structureDateText}，或再出离场信号，降到 0%。`;
    }

    if (position === 0) {
        const scoreText = threshold === '-' ? '有效买入积分重新达标' : `买入积分重新达到 ${threshold}/${threshold}`;
        const stopGuard = canShowStop ? `若继续跌破防守位 ${stopText}，继续空仓观望。` : '若继续出现防守信号，继续空仓观望。';
        const isStrongExit = ['清仓防守', '强离场'].includes(decision?.exit?.level);
        if (isStrongExit) {
            const triggerText = meta?.repeatedStrongExit ? '今日再次触发强离场，' : '今日触发强离场，';
            return `${triggerText}${getStrongExitCooldownText(meta)}；冷静期结束且${scoreText}后，才重新考虑。当前积分 ${currentScore}/${threshold}。${stopGuard}`;
        }
        if (meta?.inCooldown) {
            return `${getCooldownProgress(meta).label}；冷静期结束且${scoreText}后，才重新考虑。当前积分 ${currentScore}/${threshold}。${stopGuard}`;
        }
        return `${scoreText}后，才重新考虑；当前积分 ${currentScore}/${threshold}。${stopGuard}`;
    }

    if (position <= 30) {
        const stopGuard = canShowStop ? `防守位 ${stopText}` : '短期趋势防守位';
        return `轻仓观察只在重新站回短期趋势且买入积分继续改善时成立；若跌破${stopGuard}，或再出离场信号，降到 0%。`;
    }

    const stopGuard = canShowStop ? `防守位 ${stopText}` : '防守位';
    if (hasWarning) {
        return `只要风险降温且不跌破${stopGuard}，可继续观察；若风险继续升高、跌破${stopGuard}，或出现强离场信号，先降仓或离场。`;
    }
    return `只要不跌破${stopGuard}，且不出现强离场信号，当前判断继续有效；若触发其一，先降仓或离场。`;
}

function getIndexInvalidCondition(meta, decision, position, hasWarning) {
    const threshold = STRATEGY?.buyThreshold ?? '-';
    const currentScore = meta?.windowScore ?? 0;
    const stopText = formatPriceLevel(decision?.risk?.stop);
    const canShowStop = stopText !== '--';
    const marketGate = decision?.marketGate || {};

    if (position === 0 && marketGate.type === 'entry-blocked') {
        return '待沪深300、中证500和中证1000数据补齐并重新允许增加风险后，再结合当前指数动能决定是否提高风险仓位。';
    }

    if (marketGate.type === 'increase-capped') {
        const stopGuard = canShowStop ? `若跌破指数防守位 ${stopText}，或再出离场信号，继续降低风险暴露。` : '若再出离场信号，继续降低风险暴露。';
        return `核心宽基偏弱期间新增风险上限为${marketGate.cap}%；待核心环境改善且指数动能仍有效时，才考虑继续增加。${stopGuard}`;
    }

    if (position === 0) {
        const scoreText = threshold === '-' ? '指数动能积分重新达标' : `指数动能积分重新达到 ${threshold}/${threshold}`;
        const stopGuard = canShowStop ? `若继续跌破指数防守位 ${stopText}，保持低风险暴露。` : '若继续出现防守信号，保持低风险暴露。';
        const isStrongExit = ['清仓防守', '强离场'].includes(decision?.exit?.level);
        if (isStrongExit) {
            const triggerText = meta?.repeatedStrongExit ? '今日指数再次触发强离场，' : '今日指数触发强离场，';
            return `${triggerText}${getStrongExitCooldownText(meta)}；冷静期结束且${scoreText}后，才重新考虑提高风险仓位。当前积分 ${currentScore}/${threshold}。${stopGuard}`;
        }
        if (meta?.inCooldown) {
            return `${getCooldownProgress(meta).label}；冷静期结束且${scoreText}后，才重新考虑提高风险仓位。当前积分 ${currentScore}/${threshold}。${stopGuard}`;
        }
        return `${scoreText}后，才重新考虑提高风险仓位；当前积分 ${currentScore}/${threshold}。${stopGuard}`;
    }

    if (position <= 30) {
        const stopGuard = canShowStop ? `指数防守位 ${stopText}` : '短期趋势防守位';
        return `低风险暴露只在指数重新站回短期趋势且动能继续改善时成立；若跌破${stopGuard}，或再出离场信号，将风险仓位降至 0%。`;
    }

    const stopGuard = canShowStop ? `指数防守位 ${stopText}` : '指数防守位';
    if (hasWarning) {
        return `只要市场风险降温且不跌破${stopGuard}，可维持当前风险仓位；若风险继续升高、跌破${stopGuard}，或出现强离场信号，先降低风险暴露。`;
    }
    return `只要不跌破${stopGuard}，且不出现强离场信号，当前市场判断继续有效；若触发其一，先降低风险暴露。`;
}

function getStockNextFocus(meta, decision, position, hasWarning) {
    const threshold = STRATEGY?.buyThreshold ?? '-';
    const currentScore = Number(meta?.windowScore);
    const numericThreshold = Number(threshold);
    const scoreText = threshold === '-' ? '买入积分重新达标' : `买入积分重新达到${threshold}/${threshold}`;
    const addCondition = Number.isFinite(currentScore) && Number.isFinite(numericThreshold) && currentScore < numericThreshold
        ? scoreText
        : '出现新的有效买入信号';
    const defense = decision?.b11StructureDefense;
    const waveRejection = decision?.waveRejectionProtection;
    const stop = formatPriceLevel(decision?.risk?.stop);
    const stopText = stop === '--' ? '防守位' : `防守位${stop}`;
    const waveEntryBlocked = position === 0
        && Number.isFinite(currentScore)
        && Number.isFinite(numericThreshold)
        && currentScore >= numericThreshold
        && decision?.waveContext?.inScope
        && decision.waveContext.mainEvent;
    if (decision?.exit?.level === '强离场' || decision?.exit?.level === '清仓防守') {
        const cooldownDays = Math.max(1, Number(meta?.cooldownDays) || 3);
        return `完成${cooldownDays}个交易日冷静期、且${scoreText}后，才重新考虑买入；若再次出现离场信号或跌破${stopText}，继续空仓。`;
    }
    if (meta?.inCooldown) {
        const progress = getCooldownProgress(meta);
        const cooldownText = progress.remaining > 0 ? `等剩余${progress.remaining}个冷静期交易日走完` : '等今天冷静期结束';
        return `${cooldownText}、且${scoreText}后，才重新考虑买入；若再次出现防守信号，继续空仓。`;
    }
    if (waveRejection?.active) {
        const recoveryCloseLevel = Number(waveRejection.recoveryCloseLevel ?? waveRejection.triggerClose);
        const hardInvalidationProtection = ['signal_hard_invalidation', 'fresh_entry_hard_break'].includes(waveRejection.eventType);
        const freshScoreRecoveryAllowed = ['fresh_entry_failure', 'fresh_entry_downside_failure'].includes(waveRejection.eventType)
            && waveRejection.ma20RejectionExit !== true;
        const recoveryLevelText = hardInvalidationProtection ? '信号失效位' : '风险日收盘';
        const lockRemaining = Math.max(0, Number(waveRejection.lockRemaining) || 0);
        if (lockRemaining > 0) {
            const lockAge = Math.max(1, Number(waveRejection.lockAge) || 1);
            return `当前是风险事件后的第${lockAge}个观察交易日，还需等待${lockRemaining}个交易日；最早下一个交易日重新评估30%试探仓。`;
        }
        if (freshScoreRecoveryAllowed) {
            const minimumScore = Number(waveRejection.minimumPostEventScore) || Number(STRATEGY?.buyThreshold) || 4;
            const minimumGroups = Number(waveRejection.minimumPostEventGroups) || 2;
            return `完整观察期已结束；事件后新买入积分达到${minimumScore}分且至少来自${minimumGroups}个独立计分组，风险稳定后可恢复最多30%试探仓；不要求先收复风险日收盘价。`;
        }
        if (hardInvalidationProtection) {
            const minimumScore = Number(waveRejection.minimumPostEventScore) || Number(STRATEGY?.buyThreshold) || 4;
            const minimumGroups = Number(waveRejection.minimumPostEventGroups) || 2;
            return `完整观察期已结束；事件后新买入积分重新达到${minimumScore}分且至少来自${minimumGroups}个独立计分组，或价格重新站回${recoveryLevelText}${recoveryCloseLevel.toFixed(2)}后，才恢复最多30%试探仓。`;
        }
        return `收复风险日高点${Number(waveRejection.triggerHigh).toFixed(2)}且事件后新的有效买入信号仍然有效，或至少两个交易日后站回${recoveryLevelText}${recoveryCloseLevel.toFixed(2)}，才考虑局部恢复；若再出现量价分歧，继续保持当前防守仓位。`;
    }
    if (waveRejection?.status === 'recovery_pending') {
        return `出现新的有效买入信号且风险稳定后，才考虑首次恢复，首次最多30%；若再出现量价分歧或离场信号，继续空仓。`;
    }
    if (['released', 'recovery_started', 'recovery_hold'].includes(waveRejection?.status)) {
        return `完成事件后的低仓观察且风险保持稳定后，才考虑继续提高仓位；若再出现量价分歧或离场信号，先降低仓位或离场。`;
    }
    if (waveEntryBlocked) {
        const nextCondition = decision.waveContext.nextCondition || '等待当前环境完成确认';
        return `${nextCondition}后再考虑开仓；当前买入积分已达标。若跌破${stopText}或出现离场信号，继续空仓。`;
    }
    if (defense?.hardInvalidated) {
        return `${scoreText}且重新站回结构防守位后，才考虑买入或加仓；若再次收盘跌破结构防守位或出现离场信号，继续离场观察。`;
    }
    if (defense?.localBreak) {
        return `价格回到局部防守位上方、且${addCondition}后，才考虑加仓；若收盘跌破结构防守位或出现离场信号，减仓或离场。`;
    }
    if (decision?.softSignalGrace?.applied) {
        return `观察期内价格不跌破防守位、且${addCondition}后，才考虑加仓；若观察期结束仍未改善或跌破防守位，减仓或离场。`;
    }
    if (position === 0) {
        return `${scoreText}后才考虑开仓；若继续出现防守信号或跌破${stopText}，继续空仓。`;
    }
    if (position <= 30) {
        const riskCondition = hasWarning ? '风险降温' : '风险保持稳定';
        return `${addCondition}、且${riskCondition}后，才考虑加仓；若跌破${stopText}或出现离场信号，降到0%。`;
    }
    if (hasWarning) {
        return `风险降温、且当前买入信号仍有效后，才考虑提高仓位；若风险继续升高、跌破${stopText}或出现离场信号，降低仓位或离场。`;
    }
    return `出现新的有效买入信号、且风险保持稳定后，才考虑提高仓位；若跌破${stopText}或出现离场信号，降低仓位或离场。`;
}

function getIndexNextFocus(meta, decision, position, hasWarning) {
    const threshold = STRATEGY?.buyThreshold ?? '-';
    const currentScore = Number(meta?.windowScore);
    const numericThreshold = Number(threshold);
    const scoreText = threshold === '-' ? '指数动能积分重新达标' : `指数动能积分重新达到${threshold}/${threshold}`;
    const addCondition = Number.isFinite(currentScore) && Number.isFinite(numericThreshold) && currentScore < numericThreshold
        ? scoreText
        : '指数出现新的有效动能信号';
    const marketGate = decision?.marketGate || {};
    const stop = formatPriceLevel(decision?.risk?.stop);
    const stopText = stop === '--' ? '指数防守位' : `指数防守位${stop}`;
    if (decision?.exit?.level === '强离场' || decision?.exit?.level === '清仓防守') {
        const cooldownDays = Math.max(1, Number(meta?.cooldownDays) || 3);
        return `完成${cooldownDays}个交易日冷静期、且${scoreText}后，才重新考虑提高风险；若再次出现离场信号或跌破${stopText}，继续保持低风险。`;
    }
    if (meta?.inCooldown) {
        const progress = getCooldownProgress(meta);
        const cooldownText = progress.remaining > 0 ? `等剩余${progress.remaining}个冷静期交易日走完` : '等今天冷静期结束';
        return `${cooldownText}、且${scoreText}后，才重新考虑提高风险；若再次出现防守信号，保持低风险。`;
    }
    if (marketGate.type === 'entry-blocked') {
        return `核心宽基数据补齐、市场允许新增风险且${scoreText}后，才考虑提高风险；若出现防守信号，保持低风险。`;
    }
    if (marketGate.type === 'increase-capped') {
        return `核心宽基环境改善、且${addCondition}后，才考虑超过当前新增风险上限；若跌破${stopText}或出现离场信号，降低风险。`;
    }
    if (position === 0) {
        return `${scoreText}后才考虑提高风险；若继续跌破${stopText}或出现防守信号，保持低风险。`;
    }
    if (position <= 30) {
        return `${addCondition}、且重新站回短期趋势后，才考虑提高风险；若跌破${stopText}或出现离场信号，降到0%。`;
    }
    if (hasWarning) {
        return `市场风险降温、且当前指数动能仍有效后，才考虑提高风险；若风险继续升高、跌破${stopText}或出现离场信号，降低风险。`;
    }
    return `指数出现新的有效动能信号、且风险保持稳定后，才考虑提高风险；若跌破${stopText}或出现离场信号，降低风险。`;
}

// 仓位变动措辞的唯一出口：结论文案统一用它描述“从多少变到多少”，避免每个事件分支各自拼装。
function formatPositionChangeClause(previousPosition, position, label = '策略参考仓位') {
    const prev = Number(previousPosition) || 0;
    const next = Number(position) || 0;
    if (prev === next) return `${label}维持${next}%`;
    if (prev === 0) return `${label}由空仓转为${next}%`;
    return `${label}从${prev}%${next > prev ? '提高至' : '降至'}${next}%`;
}

// 波段治理事件的仓位说明表：每项只描述规则本身，仓位数字交给 formatPositionChangeClause。
// 顺序等价于原有的 if/else 判定链，命中即返回；后续调整措辞只需改这张表。
function resolveWavePositionNote(ctx) {
    const {
        decision, position, previousPosition, isEntry,
        waveL10Handoff, waveRejection, isSignalHardInvalidation, signalBreakKeepsStructure,
        waveExpiryB11TakeoverAdd, waveB6TrendAdd, multiTimeframeProbe,
        wavePositionStage, wavePeak, waveMA20PullbackObservation, waveExpiryHandoff, waveEntryBlocked
    } = ctx;
    const chg = (label = '策略参考仓位') => formatPositionChangeClause(previousPosition, position, label);
    const rejectionEvent = waveRejection.eventType;
    const rules = [
        { code: 'l10-trend-handoff', when: () => waveL10Handoff.applied,
            text: () => `单独L10只触发趋势接管预警，风险链与完整多头资格共同将策略参考仓位限制在${position}%` },
        { code: 'rejection-entry-blocked', when: () => waveRejection.status === 'entry_blocked',
            text: () => '建仓日长上影受阻优先于试探信号，原计划30%试探仓保持0%，不生成B' },
        { code: 'rejection-ma20-hold', when: () => waveRejection.status === 'ma20_hold',
            text: () => `新仓冲击压力后收盘仍在MA20上方，不清仓但暂停加仓，策略参考仓位封顶${position}%` },
        { code: 'rejection-signal-local-hold', when: () => signalBreakKeepsStructure,
            text: () => `买入信号局部失效但冻结结构支撑未破，${chg()}，不生成S` },
        { code: 'rejection-signal-hard-invalidation', when: () => waveRejection.status === 'triggered' && isSignalHardInvalidation,
            text: () => `买入信号硬失效使${chg()}，并启动局部重入保护` },
        { code: 'rejection-fresh-entry-hard-break', when: () => waveRejection.status === 'triggered' && rejectionEvent === 'fresh_entry_hard_break',
            text: () => `收盘跌破买入日最低价时新仓直接归零，${chg()}` },
        { code: 'rejection-fresh-entry-downside', when: () => waveRejection.status === 'triggered' && rejectionEvent === 'fresh_entry_downside_failure',
            text: () => `新仓下跌失败在当日直接触发防守，${chg()}` },
        { code: 'rejection-fresh-entry-failure', when: () => waveRejection.status === 'triggered' && rejectionEvent === 'fresh_entry_failure',
            text: () => `新仓冲击压力失败在当日直接触发防守，${chg()}` },
        { code: 'rejection-triggered', when: () => waveRejection.status === 'triggered',
            text: () => `冲高回落风险在当日直接降一档，${chg()}` },
        { code: 'rejection-locked', when: () => waveRejection.status === 'locked',
            text: () => `风险事件至少锁定一个完整交易日，新信号不得在次日立即建仓或回补，策略参考仓位保持${position}%` },
        { code: 'rejection-recovering', when: () => ['released', 'recovery_started', 'recovery_hold'].includes(waveRejection.status),
            text: () => `风险解除后按分步恢复规则执行，当前策略参考仓位为${position}%` },
        // WAVE_POSITION_RULES_TAIL
        { code: 'expiry-b11-takeover-add', when: () => waveExpiryB11TakeoverAdd.applied || waveExpiryB11TakeoverAdd.active,
            text: () => `当前${position}%由30%基础仓与20%波段仓组成；波段个股日线的50%确认仓由个股事件决定，核心宽基只在申请80%趋势仓时形成硬限制；本事件不允许空仓直接提高到50%，也不触发80%` },
        { code: 'expiry-b11-takeover-released', when: () => waveExpiryB11TakeoverAdd.status === 'released',
            text: () => '本次只退出额外20%波段仓，仍满足原规则的30%基础仓继续保留；分层减仓不生成新的S' },
        { code: 'b6-trend-add', when: () => waveB6TrendAdd.applied,
            text: () => `缩量回踩不破将本次趋势修复加仓目标设为50%；风险与市场未进一步限制，最终${formatPositionChangeClause(previousPosition, position, '仓位')}，80%仍需完整多头中的当日放量突破确认` },
        { code: 'multi-timeframe-probe', when: () => multiTimeframeProbe.qualified && isEntry,
            text: () => `周线双底候选与日线B20共振，只开放${position}%底部试探仓；后续需新的B6/B11或颈线突破确认，才考虑提高到50%` },
        { code: 'stage-breakout-wait', when: () => wavePositionStage.stage === 'breakout-wait',
            text: () => wavePositionStage.reason || '突破确认后等待首次回踩，不追价建仓' },
        { code: 'peak-confirmed', when: () => wavePeak.confirmed,
            text: () => `波峰确认后按仓位阶梯防守，当前策略参考仓位为${position}%；若重新站回压力区上方，再结合新信号评估恢复` },
        { code: 'peak-candidate', when: () => wavePeak.candidate,
            text: () => '价格已接近日线或周线压力区，当前只作波峰候选观察，不因压力位本身直接清仓' },
        { code: 'stage-trend-increase', when: () => wavePositionStage.increaseApplied && position > previousPosition && wavePositionStage.stage === 'trend',
            text: () => `买入积分已达标、完整多头结构成立，并出现当日放量突破事件，${chg()}趋势仓` },
        { code: 'stage-entry-pullback', when: () => wavePositionStage.increaseApplied && position > previousPosition
                && wavePositionStage.stage === 'entry' && previousPosition === 0,
            text: () => `突破日不追价；新的${getUserSignalText(wavePositionStage.triggerSignal)}回踩确认后只建立${position}%试探仓，后续仍需新的确认事件才考虑提高到50%` },
        { code: 'stage-confirmation-increase', when: () => wavePositionStage.increaseApplied && position > previousPosition,
            text: () => `${wavePositionStage.triggerSignal === 'B19' ? '双底突破' : (wavePositionStage.triggerSignal === 'multi-reversal' ? '底背离多组共振' : '当日反转确认')}允许使用50%确认仓；均线只作资格和结构确认，不单独触发加仓，80%仍需新的趋势延续突破` },
        { code: 'ma20-pullback-standalone-l3', when: () => waveMA20PullbackObservation.applied
                && waveMA20PullbackObservation.defenseType === 'standalone_l3',
            text: () => `单独MACD死叉未与L4/L9/L10复合，完整多头结构未破；策略参考仓位维持${position}%一日，不生成S` },
        { code: 'ma20-pullback-limited-hard', when: () => waveMA20PullbackObservation.applied
                && waveMA20PullbackObservation.defenseType === 'limited_hard_invalidation',
            text: () => `买点失效位虽被收盘跌破，但MA20与风险防守位仍守住；策略参考仓位维持${position}%一日，不生成S` },
        { code: 'ma20-pullback-breakout', when: () => waveMA20PullbackObservation.applied
                && waveMA20PullbackObservation.defenseType === 'breakout_pullback',
            text: () => `突破MA20后的首次回踩仍守住均线附近；策略参考仓位维持${position}%一日，不生成S` },
        { code: 'ma20-pullback-observation', when: () => waveMA20PullbackObservation.applied,
            text: () => `本次未满足B6加仓条件，只触发MA20回踩防守观察；策略参考仓位维持${position}%一日，不生成S` },
        { code: 'ma20-pullback-expired', when: () => waveMA20PullbackObservation.status === 'expired',
            text: () => `MA20回踩防守观察只保留一日；次日未通过均线或新B6/B11接管，${chg()}` },
        { code: 'expiry-handoff-trend-washout', when: () => waveExpiryHandoff.applied && waveExpiryHandoff.trendWashout,
            text: () => `积分到期不等于上涨结构失效；完整多头均线仍在时最多保留${waveExpiryHandoff.maxTradingDays || 2}个交易日的${position}%洗盘观察，不机械生成S` },
        { code: 'expiry-handoff', when: () => waveExpiryHandoff.applied,
            text: () => `本次积分下降来自时间窗口自然到期，不是真实破位；一日${waveExpiryHandoff.observationMode === 'defensive' ? '防守观察' : '接管'}规则将策略参考仓位维持在${position}%，不生成S` },
        { code: 'expiry-handoff-expired', when: () => waveExpiryHandoff.status === 'expired',
            text: () => `到期防守观察只保留一日；次日未通过均线或新信号接管，${chg()}` },
        { code: 'wave-entry-blocked', when: () => waveEntryBlocked,
            text: () => `买入积分已达标，但${decision.waveContext.mainEvent}；三趋势治理将策略参考仓位保持为0%` },
    ];
    const hit = rules.find(rule => rule.when());
    return hit ? { code: hit.code, text: hit.text() } : null;
}

function getStockDecisionSummary(meta, decision) {
    const position = decision?.position ?? 0;
    const action = decision?.simpleAction || '持币观望';
    const exitLevel = decision?.exit?.level || '无明确离场';
    const scoreReady = !!decision?.signalReady || (meta?.windowScore ?? 0) >= (STRATEGY?.buyThreshold ?? Infinity);
    const hasWarning = (meta?.warningSignals || []).length > 0;
    const hasHeatRisk = hasShortTermHeatRisk(meta, null);
    const hasCriticalExit = ['清仓防守', '强离场'].includes(exitLevel) || ['清仓离场', '规避风险'].includes(action);
    const hasPositionExit = hasCriticalExit || action === '执行离场';
    const directExitSignals = meta?.exitSignals || [];
    const waveRejection = decision?.waveRejectionProtection || { status: 'none', active: false };
    const isFreshEntryFailure = ['fresh_entry_failure', 'fresh_entry_downside_failure', 'fresh_entry_hard_break'].includes(waveRejection.eventType);
    const isSignalHardInvalidation = waveRejection.eventType === 'signal_hard_invalidation';
    const isHardInvalidationProtection = isSignalHardInvalidation || waveRejection.eventType === 'fresh_entry_hard_break';
    const waveEvidence = getWaveEventEvidenceText(waveRejection);
    const waveB6TrendAdd = decision?.waveB6TrendAdd || { eligible: false, applied: false };
    const wavePositionStage = decision?.wavePositionStage || { inScope: false, increaseApplied: false, stage: 'not-applicable' };
    const multiTimeframeProbe = decision?.waveContext?.multiTimeframeBottomProbe || { qualified: false };
    const wavePeak = decision?.wavePeak || { status: 'none', candidate: false, confirmed: false, reason: '' };
    const waveExpiryB11TakeoverAdd = decision?.waveExpiryB11TakeoverAdd || { eligible: false, applied: false, active: false, status: 'none' };
    const waveMA20PullbackObservation = decision?.waveMA20PullbackObservation || { applied: false };
    const waveExpiryHandoff = decision?.waveExpiryHandoff || { applied: false };
    const waveL10Handoff = decision?.waveL10TrendHandoff || { applied: false };
    const previousPosition = Number(decision?.prevAdv) || 0;
    const threshold = Number(STRATEGY?.buyThreshold);
    const scoreBelowThreshold = Number.isFinite(threshold) && (meta?.windowScore ?? 0) < threshold;
    const basePosition = Number(decision?.basePosition);
    const basePositionIsEmpty = Number.isFinite(basePosition) ? basePosition <= 0 : scoreBelowThreshold;
    const isEntry = previousPosition === 0 && position > 0;
    const isIncrease = position > previousPosition;
    const isReduce = previousPosition > 0 && position < previousPosition;
    let stateLabel = '弱势观察';
    let userAction = '先不碰';
    if (hasCriticalExit) {
        stateLabel = '破位防守';
        userAction = position === 0 ? '离场观察' : '降低仓位';
    } else if (position === 0) {
        stateLabel = meta?.inCooldown ? '离场冷静期' : (hasPositionExit ? (basePositionIsEmpty && directExitSignals.length === 0 ? '信号失效' : '风险防守') : '弱势观察');
        userAction = hasPositionExit ? '离场观察' : '暂时不买';
    } else if (position <= 30) {
        stateLabel = action.includes('减仓') || hasWarning ? '风险观察' : '试探观察';
        userAction = action.includes('减仓') ? '降低仓位' : '轻仓观察';
    } else if (scoreReady && position >= 50) {
        stateLabel = hasHeatRisk ? '转强但偏热' : (hasWarning ? '转强但风险未消' : '趋势转强');
        userAction = isIncrease ? '提高仓位' : '继续持有';
    } else {
        stateLabel = '持仓观察';
        userAction = '继续持有';
    }

    const scoreText = `${meta?.windowScore ?? 0}/${STRATEGY?.buyThreshold ?? '-'}`;
    const strongExitSet = getStrongExitSignals(STRATEGY);
    const strongExitSignals = directExitSignals.filter(signal => strongExitSet.has(signal));
    const otherExitSignals = directExitSignals.filter(signal => !strongExitSet.has(signal));
    const formatExitSignal = signal => getUserSignalText(signal);
    const hasPreviousPosition = previousPosition > 0;
    const scoreIsEmpty = (meta?.windowScore ?? 0) <= 0;
    const positionToZeroText = hasPreviousPosition ? `当前从${previousPosition}%降至 0%` : '策略参考仓位降至 0%';
    const waveEntryBlocked = position === 0
        && scoreReady
        && decision?.waveContext?.inScope
        && decision.waveContext.mainEvent;
    const signalCause = getSignalCauseSummary(meta);
    const buyCauseText = signalCause.text || '当前有效买入信号';
    const lifecycleTransition = getSignalLifecycleTransition(meta, decision, 'stock');
    const signalBreakKeepsStructure = lifecycleTransition.kind === 'local';
    const positionChange = getStockPositionChangeDetails(meta, decision, signalCause, previousPosition, position);
    if (!hasCriticalExit && lifecycleTransition.kind === 'hard' && !isIncrease) {
        stateLabel = '信号硬失效';
        userAction = position === 0 ? '离场观察' : '降低仓位';
    } else if (!hasCriticalExit && lifecycleTransition.kind === 'local') {
        stateLabel = '结构未破';
        userAction = position > 0 ? '轻仓观察' : '暂时不买';
    } else if (!hasCriticalExit && lifecycleTransition.kind === 'soft') {
        stateLabel = '动能转弱';
        userAction = position > 0 ? '轻仓观察' : '暂时不买';
    } else if (!hasCriticalExit && lifecycleTransition.kind === 'soft-expired') {
        stateLabel = '信号失效';
        userAction = '离场观察';
    }
    if (!hasCriticalExit && waveL10Handoff.applied) {
        stateLabel = '趋势接管预警';
        userAction = position < previousPosition ? '降低仓位' : '轻仓观察';
    } else if (!hasCriticalExit && waveRejection.status === 'entry_blocked') {
        stateLabel = '压力受阻';
        userAction = '暂时不买';
    } else if (!hasCriticalExit && waveRejection.status === 'ma20_hold') {
        stateLabel = 'MA20上方观察';
        userAction = '轻仓观察';
    } else if (!hasCriticalExit && waveRejection.status === 'triggered' && !signalBreakKeepsStructure) {
        stateLabel = isSignalHardInvalidation ? '信号硬失效' : (isFreshEntryFailure ? '新仓失败离场' : '冲高回落止盈');
        userAction = position === 0 ? '离场观察' : '降低仓位';
    } else if (!hasCriticalExit && waveRejection.status === 'locked') {
        stateLabel = '风险恢复观察';
        userAction = position === 0 ? '暂时不买' : '持仓观察';
    } else if (!hasCriticalExit && ['released', 'recovery_pending'].includes(waveRejection.status)) {
        stateLabel = '风险解除';
        userAction = position > 0 ? (previousPosition === 0 ? '轻仓建仓' : '继续持有') : '继续观察';
    } else if (!hasCriticalExit && ['recovery_started', 'recovery_hold'].includes(waveRejection.status)) {
        stateLabel = '分步恢复';
        userAction = '轻仓观察';
    } else if (!hasCriticalExit && waveExpiryB11TakeoverAdd.applied) {
        stateLabel = '防守接管加仓';
        userAction = '提高仓位';
    } else if (!hasCriticalExit && waveExpiryB11TakeoverAdd.active) {
        stateLabel = '波段仓持有';
        userAction = '继续持有';
    } else if (!hasCriticalExit && waveExpiryB11TakeoverAdd.status === 'released') {
        stateLabel = '波段仓减仓';
        userAction = '降低仓位';
    } else if (!hasCriticalExit && waveB6TrendAdd.applied) {
        stateLabel = '趋势修复加仓';
        userAction = '提高仓位';
    } else if (!hasCriticalExit && multiTimeframeProbe.qualified && isEntry) {
        stateLabel = '多周期底部共振试探';
        userAction = '轻仓建仓';
    } else if (!hasCriticalExit && wavePositionStage.stage === 'breakout-wait') {
        stateLabel = '突破后等回踩';
        userAction = '暂不追价';
    } else if (!hasCriticalExit && wavePeak.confirmed && isReduce) {
        stateLabel = '波峰防守';
        userAction = '降低仓位';
    } else if (!hasCriticalExit && wavePeak.candidate && !isIncrease) {
        stateLabel = '压力区观察';
        userAction = position > 0 ? '谨慎持有' : '暂不追价';
    } else if (!hasCriticalExit && wavePositionStage.increaseApplied && position > previousPosition) {
        stateLabel = wavePositionStage.stage === 'trend'
            ? '趋势延续加仓'
            : (wavePositionStage.stage === 'entry' && previousPosition === 0
                ? '回踩试探建仓'
                : (previousPosition === 0 ? '底部确认建仓' : '反转确认加仓'));
        userAction = previousPosition === 0
            ? (wavePositionStage.stage === 'entry' ? '轻仓建仓' : '确认建仓')
            : '提高仓位';
    } else if (!hasCriticalExit && waveMA20PullbackObservation.applied) {
        stateLabel = waveMA20PullbackObservation.defenseType === 'standalone_l3'
            ? 'MA20趋势防守'
            : (waveMA20PullbackObservation.defenseType === 'limited_hard_invalidation'
                ? 'MA20回踩防守'
                : (waveMA20PullbackObservation.defenseType === 'breakout_pullback' ? '突破后回踩观察' : 'MA20回踩观察'));
        userAction = '轻仓观察';
    } else if (!hasCriticalExit && waveMA20PullbackObservation.status === 'expired') {
        stateLabel = 'MA20观察结束';
        userAction = '离场观察';
    } else if (!hasCriticalExit && waveExpiryHandoff.applied) {
        stateLabel = waveExpiryHandoff.trendWashout
            ? '趋势洗盘观察'
            : (waveExpiryHandoff.observationMode === 'defensive' ? '到期防守观察' : '反弹接管观察');
        userAction = '轻仓观察';
    } else if (!hasCriticalExit && waveExpiryHandoff.status === 'expired') {
        stateLabel = '到期观察结束';
        userAction = '离场观察';
    }

    let reason = '';
    if (!hasCriticalExit && waveL10Handoff.applied) {
        reason = `完整多头持仓中单独出现MACD顶背离，当前按趋势接管预警处理，不因单个L10清仓，仓位保持在${position}%以内观察`;
    } else if (!hasCriticalExit && waveRejection.status === 'entry_blocked') {
        const sourceText = (waveRejection.sourceSignals || []).includes('B16') ? '周线支撑企稳信号' : '当前买入信号';
        reason = `${waveEvidence}，形成长上影；${sourceText}原本准备轻仓建仓，本次取消建仓且不画B`;
    } else if (!hasCriticalExit && waveRejection.status === 'ma20_hold') {
        reason = `${waveEvidence}，虽出现压力长上影，但收盘仍站在MA20上方，本次只保留${position}%观察且不加仓`;
    } else if (!hasCriticalExit && signalBreakKeepsStructure) {
        reason = lifecycleTransition.text;
    } else if (!hasCriticalExit && waveRejection.status === 'triggered') {
        if (isSignalHardInvalidation) {
            reason = `${waveEvidence}，买入信号硬失效，当前从${previousPosition}%降至${position}%并进入局部重入保护`;
        } else if (waveRejection.eventType === 'fresh_entry_hard_break') {
            reason = `${waveEvidence}，新仓硬失效，风险日从${previousPosition}%降至${position}%`;
        } else if (waveRejection.eventType === 'fresh_entry_downside_failure') {
            reason = `${waveEvidence}，形成贴近防守位的大阴线，风险日从${previousPosition}%降至${position}%`;
        } else if (waveRejection.eventType === 'fresh_entry_failure') {
            reason = `${waveEvidence}，${waveRejection.ma20RejectionExit ? '形成长上影且收盘重新落回MA20下方' : '形成长上影且收盘不高于买入日收盘'}，判定新仓冲击压力失败，风险日从${previousPosition}%降至${position}%`;
        } else {
            reason = `${waveEvidence}，判定已有浮盈后的放量冲高回落，风险日实时分档止盈，当前从${previousPosition}%降至${position}%`;
        }
    } else if (!hasCriticalExit && waveRejection.status === 'locked') {
        const recoveryLevel = Number(waveRejection.recoveryCloseLevel ?? waveRejection.triggerClose);
        const currentClose = Number(meta?.currentClose);
        const levelName = isHardInvalidationProtection ? '信号失效位' : '风险日收盘';
        const recoveryState = Number.isFinite(currentClose) && Number.isFinite(recoveryLevel) && currentClose > recoveryLevel
            ? `当前收盘${formatPriceLevel(currentClose)}虽已站回${levelName}${formatPriceLevel(recoveryLevel)}，但完整观察期尚未结束`
            : `当前收盘${formatPriceLevel(currentClose)}尚未站回${levelName}${formatPriceLevel(recoveryLevel)}`;
        reason = `${waveRejection.triggerDate || '此前'}的风险事件仍在局部保护期；${recoveryState}，事件前旧积分不立即触发回补，当前保持${position}%防守仓位`;
    } else if (!hasCriticalExit && waveRejection.status === 'released') {
        let recoveryText = `当前已收复事件高点${formatPriceLevel(Number(waveRejection.triggerHigh))}且事件后的新信号仍有效`;
        if (waveRejection.pullbackRecovery) {
            recoveryText = `事件后新出现${(waveRejection.freshPullbackSignals || []).map(getUserSignalText).join('、') || '有效回踩企稳'}，并站上未下行的MA${Number(waveRejection.pullbackMovingAveragePeriod) || 20}`;
        } else if (waveRejection.strongFreshRecovery) {
            recoveryText = `事件后新积分已达到${Number(waveRejection.postEventScore) || 0}/${Number(waveRejection.minimumPostEventScore) || Number(STRATEGY?.buyThreshold) || 4}，且来自${(waveRejection.postEventScoreSignals || []).length}个独立计分组`;
        } else if (waveRejection.stableRecovery) {
            recoveryText = `当前收盘已站回${isHardInvalidationProtection ? '信号失效位' : '风险日收盘'}${formatPriceLevel(Number(waveRejection.recoveryCloseLevel ?? waveRejection.triggerClose))}`;
        }
        reason = `${recoveryText}，局部保护解除，当前先恢复至${position}%仓位观察`;
    } else if (!hasCriticalExit && waveRejection.status === 'recovery_pending') {
        reason = '冲高回落风险已局部解除，但当前尚无可执行的恢复仓位，继续空仓观察';
    } else if (!hasCriticalExit && waveRejection.status === 'recovery_started') {
        reason = `冲高回落事件后首次恢复，当前最多恢复至${position}%仓位`;
    } else if (!hasCriticalExit && waveRejection.status === 'recovery_hold') {
        reason = `冲高回落事件后仍在低仓确认期，当前保持${position}%仓位`;
    } else if (!hasCriticalExit && waveExpiryB11TakeoverAdd.applied) {
        reason = `前一日到期防守观察成功后，今日新出现均线回踩不破并重新站上MA5与MA20，MA20保持未下行，当前从${previousPosition}%提高至${position}%`;
    } else if (!hasCriticalExit && waveExpiryB11TakeoverAdd.active) {
        reason = `${waveExpiryB11TakeoverAdd.triggerDate || '此前'}的防守接管加仓仍有效，当前按30%基础仓加20%波段仓继续持有${position}%`;
    } else if (!hasCriticalExit && waveExpiryB11TakeoverAdd.status === 'released') {
        reason = `防守接管后的额外20%波段仓已先减，原30%基础仓仍满足既有观察条件，当前从${previousPosition}%降至${position}%且不生成S`;
    } else if (!hasCriticalExit && waveB6TrendAdd.applied) {
        reason = `今日缩量回踩${waveB6TrendAdd.movingAveragePeriod}日线后收回，且该均线未下行，触发趋势修复加仓，当前从${previousPosition}%提高至${position}%`;
    } else if (!hasCriticalExit && multiTimeframeProbe.qualified && isEntry) {
        reason = `周线双底第二底与日线B20共振，当前建立${position}%底部试探仓；该信号属于低位修复，不等同于颈线突破确认`;
    } else if (!hasCriticalExit && wavePositionStage.stage === 'breakout-wait') {
        reason = wavePositionStage.reason || '突破确认后等待首次回踩，不追价建仓';
    } else if (!hasCriticalExit && wavePeak.confirmed) {
        reason = wavePeak.reason || '触及日线或周线压力并出现转弱形态，按波峰防守处理';
    } else if (!hasCriticalExit && wavePeak.candidate) {
        reason = wavePeak.reason || '已接近日线或周线压力区，先观察波峰是否确认';
    } else if (!hasCriticalExit && wavePositionStage.increaseApplied && position > previousPosition) {
        const triggerText = wavePositionStage.triggerSignal === 'B19'
            ? '今日双底颈线突破完成底部结构确认'
            : (wavePositionStage.triggerSignal === 'multi-reversal'
                ? `今日底背离与${wavePositionStage.freshGroupCount || 2}组反转信号共振`
                : `今日新出现${getUserSignalText(wavePositionStage.triggerSignal)}`);
        reason = wavePositionStage.stage === 'trend'
            ? `${triggerText}，且个股保持完整多头结构，当前从${previousPosition}%提高至${position}%趋势仓`
            : (wavePositionStage.stage === 'entry' && previousPosition === 0
                ? `${wavePositionStage.breakoutDate || '此前'}突破后，今日${getUserSignalText(wavePositionStage.triggerSignal)}完成首次回踩确认，当前建立${position}%低吸试探仓`
                : `${triggerText}，当前${previousPosition === 0 ? '直接建立' : `从${previousPosition}%提高至`}${position}%确认仓`);
    } else if (!hasCriticalExit && waveMA20PullbackObservation.applied) {
        reason = waveMA20PullbackObservation.defenseType === 'standalone_l3'
            ? `单独MACD死叉，价格仍在完整多头结构中，本日保留${position}%观察`
            : (waveMA20PullbackObservation.defenseType === 'limited_hard_invalidation'
                ? `买点失效位虽被收盘跌破，但价格仍守住MA20，先保留${position}%观察`
                : (waveMA20PullbackObservation.defenseType === 'breakout_pullback'
                    ? waveMA20PullbackObservation.reason
                    : `今日收盘仅小幅低于抬升中的${waveMA20PullbackObservation.movingAveragePeriod}日线，但下影线明显收回、结构防守位未破，当前保留${position}%轻仓观察一日，不加仓也不清仓`));
    } else if (!hasCriticalExit && waveMA20PullbackObservation.status === 'expired') {
        reason = `MA20回踩观察只保留一日，但价格未重新站回20日线，也没有新的B6/B11信号接管，当前从${previousPosition}%降至${position}%`;
    } else if (!hasCriticalExit && waveExpiryHandoff.applied) {
        const momentumText = (waveExpiryHandoff.momentumSignals || []).join('、') || '短线动能继续改善';
        reason = waveExpiryHandoff.trendWashout
            ? `买入积分仅因窗口到期降为${scoreText}，但MA${waveExpiryHandoff.trendMAPeriod}仍高于MA${waveExpiryHandoff.longMAPeriod}且未下行，当前按上涨趋势洗盘保留${position}%防守仓位`
            : (waveExpiryHandoff.observationMode === 'defensive'
            ? `原买入积分仅因窗口到期由${waveExpiryHandoff.previousWindowScore}/${threshold}降至${scoreText}，但价格仍守住原买点防守位，且${momentumText}，当前保留${position}%轻仓防守观察一日`
            : `原买入积分仅因窗口到期由${waveExpiryHandoff.previousWindowScore}/${threshold}降至${scoreText}，但价格仍守住原买点防守位、重新站上${waveExpiryHandoff.shortMAPeriod}日线，且${momentumText}，当前保留${position}%轻仓等待接管`);
    } else if (!hasCriticalExit && waveExpiryHandoff.status === 'expired') {
        reason = `买入积分自然到期后已多观察一日，但价格未重新站上短期与中期均线，也没有新的有效买入信号，当前从${previousPosition}%降至${position}%`;
    } else if (!hasCriticalExit && position === 0 && meta?.inCooldown) {
        reason = `当前是${getCooldownProgress(meta).label}；买入积分为${scoreText}，仓位保持0%，继续空仓`;
    } else if (!hasCriticalExit && lifecycleTransition.text) {
        reason = lifecycleTransition.text;
    } else if (hasPositionExit && exitLevel === '无明确离场' && hasPreviousPosition && basePositionIsEmpty) {
        const scoreReason = scoreIsEmpty
            ? `${previousPosition <= 30 ? '此前试探仓' : '此前持仓'}依赖的买入信号已失效，买入积分降为 ${scoreText}`
            : `${previousPosition <= 30 ? '此前试探仓' : '此前持仓'}依赖的买入条件已不足，买入积分为 ${scoreText}，低于开仓门槛 ${threshold}/${threshold}`;
        const exitText = previousPosition <= 30 ? `退出${previousPosition}%试探仓，当前仓位为 0%` : positionToZeroText;
        reason = `${scoreReason}，${exitText}，先空仓观察`;
    } else if (hasPositionExit && exitLevel === '无明确离场' && hasPreviousPosition) {
        reason = positionChange.reason || `当前结构或生命周期防守使策略参考仓位归零，${positionToZeroText}，先空仓防守`;
    } else if (hasPositionExit && exitLevel === '无明确离场') {
        reason = '当前没有满足开仓条件，策略参考仓位保持0%，继续空仓观察';
    } else if (hasCriticalExit && strongExitSignals.length) {
        const exitText = [...strongExitSignals, ...otherExitSignals].map(formatExitSignal).join('、');
        const triggerText = meta?.repeatedStrongExit ? '今日再次触发强离场' : '今日触发强离场';
        const positionAction = position === 0 ? positionToZeroText : `仓位降至${position}%防守`;
        const resetScoreText = `0/${STRATEGY?.buyThreshold ?? '-'}`;
        reason = `${triggerText}：${exitText}；此前买入依据失效，积分清零至${resetScoreText}，${positionAction}；${getStrongExitCooldownText(meta)}`;
    } else if (hasCriticalExit) {
        const exitReason = directExitSignals.length
            ? `${directExitSignals.map(formatExitSignal).join('、')}，当前按${exitLevel}处理`
            : (decision?.exit?.detail || `当前按${exitLevel}处理`);
        const zeroPositionText = position === 0 ? `，${positionToZeroText}，先空仓防守` : '，当前先处理风险';
        reason = `${exitReason}${zeroPositionText}`;
    } else if (hasPositionExit && hasPreviousPosition) {
        const exitReason = directExitSignals.length
            ? `${directExitSignals.map(formatExitSignal).join('、')}，当前按${exitLevel}处理`
            : (decision?.exit?.detail || `当前按${exitLevel}处理`);
        const positionAction = position === 0
            ? `${positionToZeroText}，先空仓防守`
            : `当前从${previousPosition}%降至${position}%防守`;
        reason = `${exitReason}，${positionAction}`;
    } else if (isReduce) {
        reason = positionChange.reason;
    } else if (waveEntryBlocked) {
        reason = `买入积分已达到 ${scoreText}，但${decision.waveContext.mainEvent}，当前暂不建仓`;
    } else if (position === 0) {
        reason = `买入积分只有 ${scoreText}，当前还不满足开仓条件`;
    } else if (isEntry) {
        reason = positionChange.reason;
    } else if (isIncrease && meta.type === '📈 趋势抱单') {
        reason = `价格重新站回20日线，趋势抱单状态接管此前轻仓观察，当前从${previousPosition}%提高至${position}%`;
    } else if (isIncrease) {
        reason = positionChange.reason;
    } else if (position <= 30) {
        reason = scoreReady
            ? `${buyCauseText}使买入积分维持在 ${scoreText}，当前按${position}%轻仓继续观察`
            : `买入积分为 ${scoreText}，当前按${position}%轻仓继续观察`;
    } else {
        reason = scoreReady
            ? `${buyCauseText}使买入积分维持在 ${scoreText}，继续支持当前${position}%仓位`
            : `买入积分为 ${scoreText}，当前按${position}%仓位继续观察`;
    }
    const why = getPlainDisplayText(reason);
    const wavePositionNote = resolveWavePositionNote({
        decision, position, previousPosition, isEntry,
        waveL10Handoff, waveRejection, isSignalHardInvalidation, signalBreakKeepsStructure,
        waveExpiryB11TakeoverAdd, waveB6TrendAdd, multiTimeframeProbe,
        wavePositionStage, wavePeak, waveMA20PullbackObservation, waveExpiryHandoff, waveEntryBlocked
    });
    const positionWhy = wavePositionNote
        ? wavePositionNote.text
        : getPlainDisplayText(positionChange.positionExplanation);
    const positionWhyCode = wavePositionNote ? wavePositionNote.code : 'position-path';
    const lockRemaining = Math.max(0, Number(waveRejection.lockRemaining) || 0);
    const freshScoreRecoveryAllowed = ['fresh_entry_failure', 'fresh_entry_downside_failure'].includes(waveRejection.eventType)
        && waveRejection.ma20RejectionExit !== true;
    const lockedNextFocus = lockRemaining > 0
        ? `当前是风险事件后的第${Math.max(1, Number(waveRejection.lockAge) || 1)}个观察交易日，还需等待${lockRemaining}个交易日；最早下一个交易日重新评估30%试探仓。`
        : (isHardInvalidationProtection
            ? `完整观察期已结束；等事件后新积分达到${Number(waveRejection.minimumPostEventScore) || Number(STRATEGY?.buyThreshold) || 4}分且至少来自${Number(waveRejection.minimumPostEventGroups) || 2}个独立计分组，或价格站回失效位后，再恢复最多30%试探仓。`
            : (freshScoreRecoveryAllowed
                ? `完整观察期已结束；等事件后新积分达到${Number(waveRejection.minimumPostEventScore) || Number(STRATEGY?.buyThreshold) || 4}分且至少来自${Number(waveRejection.minimumPostEventGroups) || 2}个独立计分组，风险稳定后可恢复最多30%试探仓，不要求先收复风险日收盘价。`
                : '完整观察期已结束；若是已有浮盈减仓，新的缩量/均线回踩企稳并守住风险日低点时可先补回一档；否则待价格收复关键压力。'));
    const nextFocus = waveRejection.status === 'entry_blocked'
        ? '至少观察一个完整交易日；后续需站回风险日收盘，或收复风险日高点且事件后新的有效修复信号仍然有效，才重新考虑30%试探仓。'
        : (waveRejection.status === 'locked'
            ? lockedNextFocus
            : (waveExpiryB11TakeoverAdd.applied || waveExpiryB11TakeoverAdd.active
        ? `额外20%按波段仓管理；若出现压力回落、预警或风险上限收紧，先降回30%。若30%基础仓自身失效、跌破防守位${formatPriceLevel(decision?.risk?.stop)}或出现离场信号，再按原规则降至0%。`
        : (waveMA20PullbackObservation.applied
            ? `下一交易日需重新站回MA20，或新触发B6/B11；若未接管、收盘跌破观察日低点${formatPriceLevel(waveMA20PullbackObservation.triggerLow)}、跌破结构防守位${formatPriceLevel(waveMA20PullbackObservation.defenseLevel)}或出现离场信号，仓位降至0%。`
            : (waveExpiryHandoff.applied
                ? (waveExpiryHandoff.trendWashout
                    ? `洗盘观察最多保留${waveExpiryHandoff.maxTradingDays || 2}个交易日；期间需重新站回MA20或出现新的有效买入信号接管。若MA20转弱、收盘跌破原买点防守位或出现离场信号，仓位降至0%。`
                    : (waveExpiryHandoff.observationMode === 'defensive'
                    ? `下一交易日需重新站上MA5与MA20，或出现新的有效买入信号；若未接管、收盘跌破观察日低点${formatPriceLevel(waveExpiryHandoff.triggerLow)}、跌破原买点防守位${formatPriceLevel(waveExpiryHandoff.entryLow)}或出现离场信号，仓位降至0%。`
                    : `下一交易日需由趋势抱单或新的有效买入信号接管；若未接管、跌破原买点防守位${formatPriceLevel(waveExpiryHandoff.entryLow)}或出现离场信号，仓位降至0%。`))
                : getPlainDisplayText(getStockNextFocus(meta, decision, position, hasWarning))))));

    return {
        state: stateLabel,
        action: userAction,
        positionText: `${position}%`,
        why,
        positionWhy,
        positionWhyCode,
        nextFocus,
        reason: why,
        positionExplanation: positionWhy,
        invalidCondition: nextFocus
    };
}

function getIndexDecisionSummary(meta, decision) {
    const position = decision?.position ?? 0;
    const action = decision?.simpleAction || '持币观望';
    const exitLevel = decision?.exit?.level || '无明确离场';
    const scoreReady = !!decision?.signalReady || (meta?.windowScore ?? 0) >= (STRATEGY?.buyThreshold ?? Infinity);
    const hasWarning = (meta?.warningSignals || []).length > 0;
    const hasCriticalExit = ['清仓防守', '强离场'].includes(exitLevel) || ['清仓离场', '规避风险'].includes(action);
    const hasPositionExit = hasCriticalExit || action === '执行离场';
    const scoreText = `${meta?.windowScore ?? 0}/${STRATEGY?.buyThreshold ?? '-'}`;
    const previousPosition = Number(decision?.prevAdv) || 0;
    const threshold = Number(STRATEGY?.buyThreshold);
    const basePosition = Number(decision?.basePosition);
    const scoreIsEmpty = (meta?.windowScore ?? 0) <= 0;
    const scoreBelowThreshold = Number.isFinite(threshold) && (meta?.windowScore ?? 0) < threshold;
    const basePositionIsEmpty = Number.isFinite(basePosition) ? basePosition <= 0 : scoreBelowThreshold;
    const marketGate = decision?.marketGate || {};
    const directExitSignals = meta?.exitSignals || [];
    const strongExitSet = getStrongExitSignals(STRATEGY);
    const strongExitSignals = directExitSignals.filter(signal => strongExitSet.has(signal));
    const otherExitSignals = directExitSignals.filter(signal => !strongExitSet.has(signal));
    const formatExitSignal = signal => getUserSignalText(signal);
    const signalCause = getSignalCauseSummary(meta);
    const causeText = signalCause.text || '当前有效指数动能信号';
    const lifecycleTransition = getSignalLifecycleTransition(meta, decision, 'index');
    const waveRejection = decision?.waveRejectionProtection || { status: 'none', active: false };
    const isFreshEntryFailure = ['fresh_entry_failure', 'fresh_entry_downside_failure', 'fresh_entry_hard_break'].includes(waveRejection.eventType);
    const isFreshEntryRejectionFailure = waveRejection.eventType === 'fresh_entry_failure';
    const waveEvidence = getWaveEventEvidenceText(waveRejection);
    const waveExpiryHandoff = decision?.waveExpiryHandoff || { applied: false };
    const isEntry = previousPosition === 0 && position > 0;
    const isIncrease = position > previousPosition;
    const isReduce = previousPosition > 0 && position < previousPosition;
    const riskPositionToZero = previousPosition > 0 ? `风险仓位从${previousPosition}%降至 0%` : '风险仓位保持 0%';

    let stateLabel = '指数动能不足';
    let userAction = '暂不增加风险';
    if (hasCriticalExit) {
        stateLabel = '指数破位防守';
        userAction = position === 0 ? '保持低风险暴露' : '优先降低风险';
    } else if (position === 0) {
        stateLabel = meta?.inCooldown ? '指数冷静期' : (hasPositionExit ? (basePositionIsEmpty && directExitSignals.length === 0 ? '指数动能失效' : '指数风险防守') : '指数动能不足');
        userAction = '暂不增加风险';
    } else if (position <= 30) {
        stateLabel = action.includes('减仓') || hasWarning ? '弱势防守' : '低位观察';
        userAction = action.includes('减仓') ? '降低风险暴露' : '保持低风险暴露';
    } else if (scoreReady && position >= 50) {
        stateLabel = hasWarning ? '指数转强但偏热' : '指数动能转强';
        userAction = isIncrease ? '可适度增加风险' : '维持当前风险仓位';
    } else {
        stateLabel = '指数震荡观察';
        userAction = isReduce ? '降低风险暴露' : '维持当前风险仓位';
    }

    if (!hasCriticalExit && waveRejection.status === 'triggered' && isFreshEntryFailure) {
        stateLabel = position === 0 ? '指数新仓失败离场' : (isFreshEntryRejectionFailure ? '指数新仓冲高防守' : '指数新仓下跌防守');
        userAction = position === 0 ? '保持低风险暴露' : '降低风险暴露';
    } else if (!hasCriticalExit && waveExpiryHandoff.applied) {
        stateLabel = '反弹接管观察';
        userAction = '保持低风险暴露';
    } else if (!hasCriticalExit && lifecycleTransition.kind === 'hard' && !isIncrease) {
        stateLabel = '指数信号硬失效';
        userAction = position === 0 ? '保持低风险暴露' : '优先降低风险';
    } else if (!hasCriticalExit && lifecycleTransition.kind === 'soft') {
        stateLabel = '指数动能转弱';
        userAction = '保持低风险暴露';
    } else if (!hasCriticalExit && lifecycleTransition.kind === 'soft-expired') {
        stateLabel = '指数动能失效';
        userAction = '保持低风险暴露';
    }

    let reason = '';
    if (!hasCriticalExit && waveRejection.status === 'triggered' && isFreshEntryFailure) {
        reason = waveRejection.eventType === 'fresh_entry_hard_break'
            ? `${waveEvidence}，指数新仓硬失效，风险仓位从${previousPosition}%降至${position}%`
            : (isFreshEntryRejectionFailure
                ? `${waveEvidence}，形成长上影并弱势收盘，判定指数新仓冲击压力失败，风险仓位从${previousPosition}%降至${position}%`
                : `${waveEvidence}，收盘虽收回但仍是贴近防守位的弱势阴线，风险仓位从${previousPosition}%降至${position}%`);
    } else if (!hasCriticalExit && position === 0 && meta?.inCooldown) {
        reason = `当前是${getCooldownProgress(meta).label}；指数动能积分为${scoreText}，风险仓位保持0%`;
    } else if (!hasCriticalExit && waveExpiryHandoff.applied) {
        const momentumText = (waveExpiryHandoff.momentumSignals || []).join('、') || '短线动能继续改善';
        reason = `原指数动能积分仅因窗口到期由${waveExpiryHandoff.previousWindowScore}/${threshold}降至${scoreText}，但指数仍守住原买点防守位、重新站上${waveExpiryHandoff.shortMAPeriod}日线，且${momentumText}，当前保留${position}%低风险暴露等待接管`;
    } else if (!hasCriticalExit && lifecycleTransition.text) {
        reason = lifecycleTransition.text;
    } else if (hasPositionExit && exitLevel === '无明确离场' && previousPosition > 0 && basePositionIsEmpty) {
        const scoreReason = scoreIsEmpty
            ? `此前指数动能已失效，积分降为 ${scoreText}`
            : `此前指数动能已不足，积分为 ${scoreText}，低于门槛 ${threshold}/${threshold}`;
        reason = `${scoreReason}，${riskPositionToZero}，暂不增加市场风险`;
    } else if (hasPositionExit && exitLevel === '无明确离场' && previousPosition > 0) {
        // 风险评分已退出交易决策；若仍有无明确离场的归零，只能归因于结构/生命周期治理。
        const governanceText = decision?.waveContext?.mainEvent || decision?.positionDriver || '结构或生命周期防守';
        reason = `${getPlainDisplayText(governanceText)}，${riskPositionToZero}`;
    } else if (hasCriticalExit && strongExitSignals.length) {
        const exitText = [...strongExitSignals, ...otherExitSignals].map(formatExitSignal).join('、');
        const triggerText = meta?.repeatedStrongExit ? '今日指数再次触发强离场' : '今日指数触发强离场';
        const resetScoreText = `0/${STRATEGY?.buyThreshold ?? '-'}`;
        reason = `${triggerText}：${exitText}；此前动能依据失效，积分清零至${resetScoreText}，${riskPositionToZero}；${getStrongExitCooldownText(meta)}`;
    } else if (hasCriticalExit) {
        const exitReason = directExitSignals.length
            ? `指数${directExitSignals.map(formatExitSignal).join('、')}，当前按${exitLevel}处理`
            : (decision?.exit?.detail || `当前指数按${exitLevel}处理`);
        reason = `${exitReason}，${position === 0 ? riskPositionToZero : '当前优先处理市场风险'}`;
    } else if (marketGate.type === 'entry-blocked' && position === 0) {
        reason = `${causeText}使指数动能积分达到 ${scoreText}，但核心宽基数据未补齐，暂不增加市场风险暴露`;
    } else if (marketGate.type === 'increase-capped') {
        const tierText = marketGate.strengthTier === 'independent' ? '指数自身独立走强' : '普通机会';
        reason = `${causeText}使指数动能积分维持在 ${scoreText}，但核心宽基偏弱，${tierText}新增风险上限为${marketGate.cap}%，当前为${position}%`;
    } else if (isReduce) {
        const reduceCause = directExitSignals.length
            ? `指数${directExitSignals.map(formatExitSignal).join('、')}，当前按${exitLevel}处理`
            : (decision?.exit?.detail || '指数短线风险升高');
        const reduceAction = position === 0 ? `当前风险仓位从${previousPosition}%降至 0%，保持低风险暴露` : `当前风险仓位从${previousPosition}%降至${position}%`;
        reason = `${reduceCause}，${reduceAction}`;
    } else if (position === 0) {
        reason = `当前指数动能积分只有 ${scoreText}，暂不增加市场风险暴露`;
    } else if (isEntry) {
        reason = `${causeText}使指数动能积分达到 ${scoreText}，支持风险仓位由0%提高至${position}%`;
    } else if (isIncrease && meta.type === '📈 趋势抱单') {
        reason = `指数重新站回20日线，趋势抱单状态接管此前低风险观察，风险仓位由${previousPosition}%提高至${position}%`;
    } else if (isIncrease) {
        reason = `${causeText}使指数动能积分达到 ${scoreText}，支持风险仓位由${previousPosition}%提高至${position}%`;
    } else if (position <= 30) {
        reason = scoreReady
            ? `${causeText}使指数动能积分维持在 ${scoreText}，当前保持${position}%低风险暴露观察`
            : `指数动能积分为 ${scoreText}，当前保持${position}%低风险暴露观察`;
    } else {
        reason = scoreReady
            ? `${causeText}使指数动能积分维持在 ${scoreText}，继续支持当前${position}%风险仓位`
            : `指数动能积分为 ${scoreText}，当前维持${position}%风险仓位观察`;
    }

    const positionDetails = getStockPositionChangeDetails(meta, decision, signalCause, previousPosition, position, 'index');
    const why = getPlainDisplayText(reason)
        .replace(/买入积分/g, '指数动能积分')
        .replace(/买入信号/g, '指数动能信号');
    const indexPositionNote = waveExpiryHandoff.applied
        ? { code: 'index-expiry-handoff', text: `本次积分下降来自时间窗口自然到期，不是真实破位；一日接管规则将风险仓位维持在${position}%，不生成S` }
        : (waveRejection.status === 'triggered' && isFreshEntryFailure
            ? { code: 'index-fresh-entry-failure',
                text: `${isFreshEntryRejectionFailure ? '指数新仓冲高失败' : '指数新仓下跌失败'}在风险日直接触发防守，最终${formatPositionChangeClause(previousPosition, position, '风险仓位')}` }
            : null);
    const positionWhy = indexPositionNote
        ? indexPositionNote.text
        : getPlainDisplayText(positionDetails.positionExplanation)
            .replace(/买入积分/g, '指数动能积分')
            .replace(/买入信号/g, '指数动能信号')
            .replace(/试探仓/g, '低风险仓位');
    const positionWhyCode = indexPositionNote ? indexPositionNote.code : 'position-path';
    const nextFocus = waveExpiryHandoff.applied
        ? `下一交易日需由趋势抱单或新的有效指数动能信号接管；若未接管、跌破原买点防守位${Number(waveExpiryHandoff.entryLow).toFixed(2)}或出现离场信号，风险仓位降至0%。`
        : getPlainDisplayText(getIndexNextFocus(meta, decision, position, hasWarning));

    return {
        state: stateLabel,
        action: userAction,
        positionText: `${position}%`,
        why,
        positionWhy,
        positionWhyCode,
        nextFocus,
        reason: why,
        positionExplanation: positionWhy,
        invalidCondition: nextFocus
    };
}

function getNoviceDecisionSummary(meta, decision, mode = 'stock') {
    const summary = mode === 'index'
        ? getIndexDecisionSummary(meta, decision)
        : getStockDecisionSummary(meta, decision);
    if (decision?.bsMark !== 'B' || !['trial', 'strong'].includes(decision?.bQuality)) return summary;
    const reasons = (decision.bQualityReasons || []).filter(Boolean).slice(0, 2);
    return {
        ...summary,
        state: decision.bQuality === 'trial' ? '试用确认买点' : '强确认买点',
        why: reasons.length ? reasons.join('；') : summary.why,
        reason: reasons.length ? reasons.join('；') : summary.reason
    };
}

function quantizePosition(val) {
    const steps = Array.isArray(POSITION_STEPS) && POSITION_STEPS.length ? POSITION_STEPS : [0, 30, 50, 80];
    return steps.reduce((prev, curr) => Math.abs(curr - val) < Math.abs(prev - val) ? curr : prev);
}

function getRiskPositionCap(risk = {}) {
    const score = Number(risk?.score);
    if (!Number.isFinite(score)) return 50;
    if (score >= 80) return 80;
    if (score >= 60) return 50;
    if (score >= 40) return 30;
    return 0;
}

// 统一的趋势状态用于解释和审计，并为风险事件后的恢复路径提供环境分流。
function getTrendRegimeContext(idx, full, ind) {
    const close = Number(full?.[idx]?.close);
    const ma20 = Number(ind?.ma?.[20]?.[idx]);
    const ma60 = Number(ind?.ma?.[60]?.[idx]);
    const ma20Prev = Number(ind?.ma?.[20]?.[Math.max(0, idx - 5)]);
    const ma20Yesterday = Number(ind?.ma?.[20]?.[Math.max(0, idx - 1)]);
    const ma60Prev = Number(ind?.ma?.[60]?.[Math.max(0, idx - 5)]);
    const values = [close, ma20, ma60, ma20Prev, ma20Yesterday, ma60Prev];
    const empty = {
        key: 'unknown',
        label: '趋势未知',
        transition: 'unknown',
        reason: 'MA20/MA60 或斜率数据不足，暂不判断趋势状态',
        evidence: { close, ma20, ma60, ma20Prev, ma20Yesterday, ma60Prev },
        thresholds: { rangeSpreadRatio: 0.03, rangeSlopeRatio: 0.01 }
    };
    if (!values.every(Number.isFinite) || ma20 <= 0 || ma60 <= 0 || ma20Prev <= 0 || ma60Prev <= 0) return empty;

    const spreadRatio = (ma20 - ma60) / ma60;
    const slopeRatio = (ma20 - ma20Prev) / ma20Prev;
    const previousSlopeRatio = (ma20Yesterday - ma20Prev) / ma20Prev;
    const rangeLike = Math.abs(spreadRatio) <= 0.03 && Math.abs(slopeRatio) <= 0.01;
    const wasDown = ma20Prev < ma60Prev && previousSlopeRatio <= 0;
    const wasUp = ma20Prev > ma60Prev && previousSlopeRatio >= 0;
    const turningUp = ma20 >= ma20Yesterday && slopeRatio > 0;
    const turningDown = ma20 <= ma20Yesterday && slopeRatio < 0;
    let key = 'range';
    let label = '横盘震荡';
    let transition = 'none';
    let reason = `MA20/MA60间距${(Math.abs(spreadRatio) * 100).toFixed(1)}%，MA20五日斜率${(slopeRatio * 100).toFixed(1)}%，方向未形成共振`;

    if (wasDown && turningUp && close >= ma20) {
        key = 'reversal-up';
        label = '向上反转中';
        transition = 'up';
        reason = '此前偏下降，MA20开始止跌上拐且收盘重新站上MA20，等待趋势确认';
    } else if (wasUp && turningDown && close <= ma20) {
        key = 'reversal-down';
        label = '向下反转中';
        transition = 'down';
        reason = '此前偏上升，MA20开始转弱且收盘跌回MA20下方，等待防守确认';
    } else if (close > ma20 && ma20 > ma60 && slopeRatio >= 0) {
        key = 'up';
        label = '上升趋势';
        reason = '收盘价位于MA20上方，MA20位于MA60上方且未下行';
    } else if (close < ma20 && ma20 < ma60 && slopeRatio <= 0) {
        key = 'down';
        label = '下降趋势';
        reason = '收盘价位于MA20下方，MA20位于MA60下方且未上行';
    } else if (!rangeLike) {
        key = close >= ma20 ? 'reversal-up' : 'reversal-down';
        label = close >= ma20 ? '向上过渡' : '向下过渡';
        transition = close >= ma20 ? 'up' : 'down';
        reason = '均线方向和价格位置不一致，归入过渡状态，暂不视为完整趋势';
    }

    return {
        key,
        label,
        transition,
        reason,
        evidence: { close, ma20, ma60, ma20Prev, ma20Yesterday, ma60Prev, spreadRatio, slopeRatio },
        thresholds: { rangeSpreadRatio: 0.03, rangeSlopeRatio: 0.01 }
    };
}

function getWaveAtr14At(idx, full) {
    if (!Number.isInteger(idx) || idx < 1 || !full?.[idx]) return null;
    const start = Math.max(1, idx - 13);
    const ranges = [];
    for (let day = start; day <= idx; day++) {
        const high = Number(full?.[day]?.high);
        const low = Number(full?.[day]?.low);
        const previousClose = Number(full?.[day - 1]?.close);
        if (![high, low, previousClose].every(Number.isFinite)) continue;
        ranges.push(Math.max(high - low, Math.abs(high - previousClose), Math.abs(low - previousClose)));
    }
    return ranges.length ? ranges.reduce((sum, value) => sum + value, 0) / ranges.length : null;
}

function getConfirmedWavePivots(idx, full, options = {}) {
    const pivotDays = Math.max(1, Number(options.pivotDays) || 2);
    const windowDays = Math.max(pivotDays * 2 + 1, Number(options.windowDays) || 40);
    const start = Math.max(pivotDays, idx - windowDays + 1);
    const end = idx - pivotDays;
    const lows = [], highs = [];
    for (let day = start; day <= end; day++) {
        const low = Number(full?.[day]?.low);
        const high = Number(full?.[day]?.high);
        if (![low, high].every(Number.isFinite)) continue;
        let lowConfirmed = true, highConfirmed = true;
        for (let offset = 1; offset <= pivotDays; offset++) {
            if (Number(full?.[day - offset]?.low) <= low || Number(full?.[day + offset]?.low) <= low) lowConfirmed = false;
            if (Number(full?.[day - offset]?.high) >= high || Number(full?.[day + offset]?.high) >= high) highConfirmed = false;
        }
        if (lowConfirmed) lows.push({ day, date: full?.[day]?.date || '', value: low });
        if (highConfirmed) highs.push({ day, date: full?.[day]?.date || '', value: high });
    }
    return { lows, highs, lastConfirmedDay: end };
}

function clusterWavePivotLevels(pivots, tolerance) {
    const clusters = [];
    for (const pivot of [...(pivots || [])].sort((left, right) => left.value - right.value)) {
        let cluster = clusters.find(item => Math.abs(pivot.value - item.level) <= tolerance);
        if (!cluster) {
            cluster = { level: pivot.value, pivots: [] };
            clusters.push(cluster);
        }
        cluster.pivots.push(pivot);
        cluster.level = cluster.pivots.reduce((sum, item) => sum + item.value, 0) / cluster.pivots.length;
    }
    return clusters;
}

function getWaveBoxContext(idx, full, policy = {}) {
    const config = policy.box || {};
    const atr14 = getWaveAtr14At(idx, full);
    const pivots = getConfirmedWavePivots(idx, full, config);
    const tolerance = Number.isFinite(atr14) && atr14 > 0 ? atr14 * Math.max(0.1, Number(config.clusterToleranceAtr) || 0.75) : 0;
    if (!(tolerance > 0)) return { valid: false, support: null, pressure: null, midpoint: null, atr14, pivots, reason: 'ATR14数据不足，不能确认箱体' };
    const supportClusters = clusterWavePivotLevels(pivots.lows, tolerance)
        .filter(item => item.pivots.length >= Math.max(2, Number(config.minimumSupportTouches) || 2));
    const pressureClusters = clusterWavePivotLevels(pivots.highs, tolerance)
        .filter(item => item.pivots.length >= Math.max(2, Number(config.minimumPressureTouches) || 2));
    let best = null;
    for (const supportCluster of supportClusters) {
        for (const pressureCluster of pressureClusters) {
            const support = supportCluster.level, pressure = pressureCluster.level;
            const width = pressure - support, midpoint = (pressure + support) / 2;
            if (!(width >= atr14 * Math.max(1, Number(config.minimumWidthAtr) || 3))) continue;
            if (!(midpoint > 0) || width / midpoint > Math.max(0.01, Number(config.maximumWidthRatio) || 0.15)) continue;
            const score = supportCluster.pivots.length + pressureCluster.pivots.length;
            const latestDay = Math.max(...supportCluster.pivots.concat(pressureCluster.pivots).map(item => item.day));
            if (!best || score > best.score || (score === best.score && latestDay > best.latestDay)) {
                best = { support, pressure, midpoint, width, score, latestDay, supportPivots: supportCluster.pivots, pressurePivots: pressureCluster.pivots };
            }
        }
    }
    if (!best) return { valid: false, support: null, pressure: null, midpoint: null, atr14, pivots, reason: '已确认支撑/压力不足或箱体宽度不合格' };
    return { valid: true, ...best, atr14, pivots, reason: '40日内至少两组已确认支撑和压力，宽度满足ATR与比例约束' };
}

function getWaveRawRegimeAt(day, full, ind, policy = {}) {
    const lookback = Math.max(1, Number(policy.slopeLookbackDays) || 5);
    const ma20 = Number(ind?.ma?.[20]?.[day]);
    const previousMa20 = Number(ind?.ma?.[20]?.[day - lookback]);
    const ma60 = Number(ind?.ma?.[60]?.[day]);
    const close = Number(full?.[day]?.close);
    if (![ma20, previousMa20, ma60, close].every(Number.isFinite) || previousMa20 <= 0) return { key: 'unknown', slopeRatio: null };
    const slopeRatio = (ma20 - previousMa20) / previousMa20;
    const upThreshold = Number(policy?.slopeThresholds?.up) || 0.005;
    const downThreshold = Number(policy?.slopeThresholds?.down) || -0.005;
    if (slopeRatio >= upThreshold && ma20 >= ma60 && close >= ma20) return { key: 'up', slopeRatio };
    if (slopeRatio <= downThreshold && ma20 <= ma60 && close <= ma20) return { key: 'down', slopeRatio };
    if (Math.abs(slopeRatio) < Math.max(0, Number(policy?.slopeThresholds?.flat) || 0.005)) return { key: 'flat', slopeRatio };
    return { key: 'transition', slopeRatio };
}

function getWaveContext(idx, full, ind, strategy = STRATEGY) {
    const policy = strategy?.waveRegimePolicy;
    const empty = { inScope: false, regime: 'unknown', regimeLabel: '环境未知', regimeConfidence: 0, boxSupport: null, boxPressure: null, boxMidpoint: null, positionCap: 0, lifecycle: null };
    if (!policy || state.strategy !== '波段抄底型' || state.period !== 'daily' || (policy.stocksOnly !== false && state.mode !== 'stock')) return empty;
    const box = getWaveBoxContext(idx, full, policy);
    const today = getWaveRawRegimeAt(idx, full, ind, policy);
    const candidate = today.key === 'flat' ? (box.valid ? 'range' : 'transition') : today.key;
    const requiredDays = Math.max(1, Number(policy?.confirmationDays?.[candidate]) || 1);
    let consecutiveDays = 0;
    for (let day = idx; day >= 0 && consecutiveDays < requiredDays; day--) {
        const raw = getWaveRawRegimeAt(day, full, ind, policy);
        const normalized = raw.key === 'flat' ? (getWaveBoxContext(day, full, policy).valid ? 'range' : 'transition') : raw.key;
        if (normalized !== candidate) break;
        consecutiveDays += 1;
    }
    const confirmed = ['up','down','range'].includes(candidate) && consecutiveDays >= requiredDays;
    const regime = confirmed ? candidate : (candidate === 'unknown' ? 'unknown' : 'transition');
    const labels = { up: '上涨', down: '下跌', range: '横盘', transition: '过渡', unknown: '未知' };
    const cap = Number(policy?.positionCaps?.[regime]);
    return {
        inScope: true, regime, regimeLabel: labels[regime], regimeConfidence: confirmed ? 1 : Math.min(0.99, consecutiveDays / requiredDays),
        rawRegime: today.key, consecutiveDays, requiredDays, slopeRatio: today.slopeRatio,
        boxSupport: box.support, boxPressure: box.pressure, boxMidpoint: box.midpoint, box,
        positionCap: Number.isFinite(cap) ? cap : 0, lifecycle: null
    };
}

function getStockTrendPositionCap(idx, full, ind, position, wavePositionStage = null) {
    if (state.mode !== 'stock') return null;
    const ma20 = Number(ind?.ma?.[20]?.[idx]);
    const ma60 = Number(ind?.ma?.[60]?.[idx]);
    const ma20Prev = Number(ind?.ma?.[20]?.[Math.max(0, idx - 5)]);
    const close = Number(full?.[idx]?.close);
    const hasTrendData = [close, ma20, ma60, ma20Prev].every(Number.isFinite);
    let limit = 50;
    let reason = '个股趋势数据不足，高仓位上限50%';
    if (hasTrendData && ma20 < ma60 && ma20 < ma20Prev) {
        const strongBottomConfirmation = wavePositionStage?.stage === 'confirmation'
            && Number(wavePositionStage?.previousPosition) <= 0
            && ['B19', 'multi-reversal'].includes(wavePositionStage?.triggerSignal);
        limit = strongBottomConfirmation ? 50 : 30;
        reason = strongBottomConfirmation
            ? '当日强底部结构已经确认，允许建立50%确认仓，但不直接进入80%趋势仓'
            : '个股处于中期下降趋势，高仓位上限30%';
    } else if (hasTrendData && close > ma20 && ma20 > ma60 && ma20 >= ma20Prev) {
        return null;
    } else if (hasTrendData) {
        reason = '个股尚未形成完整多头结构，高仓位上限50%';
    }
    return position > limit ? { limit, reason } : null;
}

function getPositionCap(meta, prevPos, position, idx, full, ind, wavePositionStage = null) {
    const caps = [];
    const trendCap = getStockTrendPositionCap(idx, full, ind, position, wavePositionStage);
    if (trendCap) caps.push(trendCap);
    if (meta.allSignals?.W4 && prevPos > 0 && position >= 80) {
        caps.push({ limit: 50, reason: 'W4缩量上涨背离，高仓位上限50%' });
    }
    if (!caps.length) return null;
    const limit = Math.min(...caps.map(cap => cap.limit));
    const reasons = [...new Set(caps.map(cap => cap.reason).filter(Boolean))];
    return { limit, reason: reasons.join('；') };
}

function getTargetStrengthTier(meta, idx, full, ind, risk, exit) {
    const ma20 = Number(ind?.ma?.[20]?.[idx]);
    const ma60 = Number(ind?.ma?.[60]?.[idx]);
    const ma20Prev = Number(ind?.ma?.[20]?.[Math.max(0, idx - 5)]);
    const close = Number(full?.[idx]?.close);
    const hasTrendData = [close, ma20, ma60, ma20Prev].every(Number.isFinite);
    const independent = meta?.type === '✅ 明确转强'
        && hasTrendData
        && close > ma20
        && ma20 > ma60
        && ma20 >= ma20Prev
        && !(meta?.warningSignals || []).length
        && !(meta?.exitSignals || []).length
        && !meta?.inCooldown
        && exit?.level === '无明确离场';
    return {
        tier: independent ? 'independent' : 'ordinary',
        label: independent ? '标的独立走强' : '普通机会',
        reasons: independent ? ['买入积分达标', '收盘价与MA20/MA60保持多头结构', 'MA20未转弱', '离场检查通过'] : []
    };
}

// 核心宽基只对指数路径形成新增风险上限；个股仓位完全由个股信号、结构资格与波段治理决定。
function getMarketIncreaseCap(market, tier = 'ordinary') {
    if (state.mode === 'stock') return null;
    const caps = market?.increaseCaps;
    if (!caps) return null;
    const cap = Number(caps[tier === 'independent' ? 'independent' : 'ordinary']);
    return Number.isFinite(cap) ? cap : null;
}

function applyMarketRiskGate(market, prevPos, targetPosition, strength = { tier:'ordinary', label:'普通机会' }) {
    const previous = Math.max(0, Number(prevPos) || 0);
    const target = Math.max(0, Number(targetPosition) || 0);
    const label = market?.label || '环境未知';
    const strengthTier = strength?.tier === 'independent' ? 'independent' : 'ordinary';
    const cap = getMarketIncreaseCap(market, strengthTier);
    const reasons = Array.isArray(strength?.reasons) ? [...strength.reasons] : [];

    if (target <= previous || cap == null) {
        return { position:target, applied:false, type:'open', cap, strengthTier, strengthLabel:strength?.label || '普通机会', reasons, detail:'' };
    }
    if (previous === 0 && cap <= 0) {
        return { position:0, applied:true, type:'entry-blocked', cap, strengthTier, strengthLabel:strength?.label || '普通机会', reasons, detail:`${label}暂停指数新增风险` };
    }
    const cappedPosition = cap <= previous ? previous : Math.min(target, cap);
    if (cappedPosition < target) {
        return {
            position:cappedPosition,
            applied:true,
            type:'increase-capped',
            cap,
            strengthTier,
            strengthLabel:strength?.label || '普通机会',
            reasons,
            detail:`${label}下${strength?.label || '普通机会'}新增风险上限${cap}%`
        };
    }
    return { position:target, applied:false, type:'open', cap, strengthTier, strengthLabel:strength?.label || '普通机会', reasons, detail:'' };
}

function getSoftSignalGraceContext(meta, prevPos, basePosition, exit, idx, strategy = STRATEGY) {
    const graceDays = Math.max(0, Number(strategy?.softInvalidationGraceDays) || 0);
    const holdThreshold = Number(strategy?.holdThreshold);
    const watchPosition = Number(strategy?.watchPosition) || 0;
    const invalidatedToday = (meta?.invalidatedWindowSignals || []).filter(item => Number(item?.invalidationDay) === Number(idx));
    const softSignals = invalidatedToday.filter(item => item?.reason === 'kdj-dead-cross');
    const hardSignals = invalidatedToday.filter(item => item?.reason === 'price-break');
    const scoreBelowHold = Number.isFinite(holdThreshold) && (meta?.windowScore ?? 0) < holdThreshold;
    const exitIsClear = !exit || exit.level === '无明确离场';
    const applied = graceDays > 0
        && watchPosition > 0
        && prevPos > 0
        && prevPos <= watchPosition
        && Number(basePosition) <= 0
        && scoreBelowHold
        && softSignals.length > 0
        && hardSignals.length === 0
        && exitIsClear
        && !meta?.inCooldown;
    return {
        applied,
        days: applied ? graceDays : 0,
        holdThreshold: Number.isFinite(holdThreshold) ? holdThreshold : null,
        signals: softSignals.map(item => item.signal),
        invalidations: softSignals
    };
}

function getLocalStructureDefenseContext(meta, b11Defense, prevPos, exit, strategy = STRATEGY) {
    const localBreaks = b11Defense?.localBreak ? [b11Defense] : [];
    const watchPosition = Number(strategy?.watchPosition) || 0;
    const exitIsClear = !exit || exit.level === '无明确离场';
    const applied = localBreaks.length > 0
        && watchPosition > 0
        && prevPos > 0
        && prevPos <= watchPosition
        && exitIsClear
        && !meta?.inCooldown;
    return {
        applied,
        signals: localBreaks.map(item => item.signal),
        localBreaks
    };
}

function getWaveRejectionEntryClose(idx, full, prevPos) {
    if (prevPos <= 0) return null;
    for (let day = idx - 1; day >= 0; day--) {
        const decision = full?.[day]?._decision;
        if (!decision) continue;
        if (Number(decision.position) <= 0) break;
        if (Number(decision.prevAdv) === 0 || decision.bsMark === 'B') {
            const close = Number(full?.[day]?.close);
            return Number.isFinite(close) && close > 0 ? close : null;
        }
    }
    return null;
}

function getLowerWavePositionStep(position, steps = [0, 30, 50, 80]) {
    const current = Math.max(0, Number(position) || 0);
    const eligible = [...steps].map(Number).filter(step => Number.isFinite(step) && step < current).sort((left, right) => left - right);
    return eligible.length ? eligible[eligible.length - 1] : 0;
}

function getRecentConfirmedPressureHigh(idx, full, lookbackDays = 20, pivotDays = 2) {
    const start = Math.max(pivotDays, idx - Math.max(1, lookbackDays));
    for (let day = idx - pivotDays - 1; day >= start; day--) {
        const value = Number(full?.[day]?.high);
        if (!Number.isFinite(value)) continue;
        let confirmed = true;
        for (let offset = 1; offset <= pivotDays; offset++) {
            if (Number(full?.[day - offset]?.high) >= value || Number(full?.[day + offset]?.high) >= value) {
                confirmed = false;
                break;
            }
        }
        if (confirmed) return { day, value };
    }
    return null;
}

function getWaveFreshEntryPressureContext(idx, full, indicators, config = {}) {
    const item = full?.[idx] || {};
    const high = Number(item.high);
    const close = Number(item.close);
    const tolerance = Math.max(0, Number(config.pressureToleranceRatio) || 0);
    const closeTolerance = Math.max(0, Number(config.pressureCloseToleranceRatio) || 0);
    const sources = [];
    const pivot = getRecentConfirmedPressureHigh(
        idx,
        full,
        Math.max(1, Number(config.pressureLookbackDays) || 20),
        Math.max(1, Number(config.pivotConfirmationDays) || 2)
    );
    if (pivot && high >= pivot.value * (1 - tolerance) && close <= pivot.value * (1 + closeTolerance)) {
        sources.push({ type: 'pivot', period: null, level: pivot.value, day: pivot.day, date: full?.[pivot.day]?.date || '' });
    }
    const slopeDays = Math.max(1, Number(config.movingAverageSlopeLookbackDays) || 5);
    for (const period of config.movingAveragePeriods || []) {
        const series = indicators?.ma?.[period] || [];
        const level = Number(series[idx]);
        const previousLevel = Number(series[idx - slopeDays]);
        if (!Number.isFinite(level) || !Number.isFinite(previousLevel) || level > previousLevel) continue;
        if (high >= level * (1 - tolerance) && close <= level * (1 + closeTolerance)) {
            sources.push({ type: 'ma', period, level, day: idx, date: item.date || '' });
        }
    }
    return { matched: sources.length > 0, sources };
}

function wasWavePressureSourceReachedOnDay(source, day, full, indicators, config = {}) {
    if (!source || day < 0) return false;
    const high = Number(full?.[day]?.high);
    const tolerance = Math.max(0, Number(config.pressureToleranceRatio) || 0);
    const level = source.type === 'ma' && Number.isFinite(Number(source.period))
        ? Number(indicators?.ma?.[Number(source.period)]?.[day])
        : Number(source.level);
    return Number.isFinite(high) && Number.isFinite(level) && high >= level * (1 - tolerance);
}

function getWaveEntryDayPressureVetoContext(idx, full, meta, prevPos, targetPosition, strategy = STRATEGY) {
    const protection = strategy?.waveRejectionProtection;
    const config = protection?.entryDayPressureVeto;
    const empty = { active: false, status: 'none', targetPosition };
    if (!config || state.strategy !== '波段抄底型' || state.period !== 'daily'
        || (config.stocksOnly !== false && state.mode !== 'stock') || prevPos > 0 || targetPosition <= 0) return empty;

    const item = full?.[idx] || {};
    const open = Number(item.open);
    const high = Number(item.high);
    const low = Number(item.low);
    const close = Number(item.close);
    const range = high - low;
    if (![open, high, low, close].every(Number.isFinite) || range <= 0) return empty;
    if (open < low || open > high || close < low || close > high) return empty;

    const ma20 = Number(state.indicators?.ma?.[20]?.[idx]);
    const ma60 = Number(state.indicators?.ma?.[60]?.[idx]);
    const slopeDays = Math.max(1, Number(config.movingAverageSlopeLookbackDays) || 5);
    const previousMa20 = Number(state.indicators?.ma?.[20]?.[idx - slopeDays]);
    const hasMediumDowntrend = [ma20, ma60, previousMa20].every(Number.isFinite)
        && ma20 < ma60
        && ma20 < previousMa20;
    if (config.requireMediumDowntrend !== false && !hasMediumDowntrend) return empty;

    const upperShadow = high - Math.max(open, close);
    const lowerShadow = Math.min(open, close) - low;
    const upperShadowRangeRatio = upperShadow / range;
    const closeLocation = (close - low) / range;
    if (upperShadowRangeRatio < Number(config.minimumUpperShadowRangeRatio || 0)
        || closeLocation > Number(config.maximumCloseLocation ?? 1)
        || (config.requireUpperShadowDominance && upperShadow <= lowerShadow)) return empty;

    const pressure = getWaveFreshEntryPressureContext(idx, full, state.indicators, config);
    const pressureSources = pressure.sources.filter(source =>
        source?.type === 'ma'
        && Number.isFinite(Number(source.level))
        && close < Number(source.level)
    );
    if (!pressureSources.length) return empty;

    const sourceSignals = (meta?.windowScoreSignals || [])
        .filter(signal => Number(signal?.day) === Number(idx))
        .map(signal => signal.signal);
    return {
        active: true,
        status: 'entry_blocked',
        eventType: 'entry_day_pressure_rejection',
        triggerDay: idx,
        triggerDate: item.date || '',
        triggerHigh: high,
        triggerLow: low,
        triggerClose: close,
        entryClose: close,
        entryDay: idx,
        entryDate: item.date || '',
        entryAge: 0,
        entrySignalLow: low,
        sourceSignals,
        sourcePosition: 0,
        targetPosition: 0,
        upperShadowBodyRatio: Math.abs(close - open) > 0 ? upperShadow / Math.abs(close - open) : null,
        upperShadowRangeRatio,
        lowerShadow,
        closeLocation,
        pressureSources,
        mediumDowntrend: hasMediumDowntrend,
        recoveryPending: false,
        recoveryHoldRemaining: 0
    };
}

function getWaveRejectionProtectionContext(idx, full, meta, prevPos, targetPosition, strategy = STRATEGY, decisionContext = {}) {
    const config = strategy?.waveRejectionProtection;
    const empty = { active: false, status: 'none', targetPosition };
    const isStock = state.mode === 'stock';
    const isIndex = state.mode === 'index';
    const indexFreshEntryConfig = isIndex ? config?.indexFreshEntryFailure : null;
    const indexDownsideConfig = isIndex ? config?.indexFreshEntryDownsideFailure : null;
    if (state.strategy !== '波段抄底型' || state.period !== 'daily' || !config
        || (!isStock && !indexFreshEntryConfig && !indexDownsideConfig)) return empty;

    const item = full?.[idx] || {};
    const close = Number(item.close);
    const previous = full?.[idx - 1]?._decision?.waveRejectionProtection;
    const entryDayPressureVeto = getWaveEntryDayPressureVetoContext(idx, full, meta, prevPos, targetPosition, strategy);
    if (entryDayPressureVeto.status === 'entry_blocked') return entryDayPressureVeto;
    if (previous?.active) {
        const age = idx - Number(previous.triggerDay);
        const minimumLockTradingDays = Math.max(1, Number(config.minimumLockTradingDays) || 2);
        const rawSignals = item._signals || [];
        const blockedByRiskSignal = (config.blockingSignals || []).some(signal => rawSignals.includes(signal));
        const recoveredRiskHigh = Number.isFinite(close) && close > Number(previous.triggerHigh);
        const hasFreshPostEventSignal = (meta?.windowScoreSignals || []).some(signal => Number(signal.day) > Number(previous.triggerDay));
        const postEvent = getPostEventBuyScoreContext(idx, full, state.indicators, previous.triggerDay, strategy);
        const freshRecoveryConfig = config.strongFreshRecovery || {};
        const freshRecoveryEvents = new Set(freshRecoveryConfig.eventTypes || []);
        const minimumPostEventScore = Math.max(1, Number(strategy?.buyThreshold) || 4);
        const minimumPostEventGroups = Math.max(2, Number(freshRecoveryConfig.minimumScoreGroups) || 2);
        const recoveryCap = Math.max(0, Number(config.recoveryPositionCap) || 30);
        const marketRecoveryCap = getMarketIncreaseCap(decisionContext.market, decisionContext.targetStrength?.tier);
        const marketAllowsRecovery = marketRecoveryCap == null || marketRecoveryCap >= recoveryCap;
        const blockedByDecision = !!meta?.inCooldown
            || (meta?.exitSignals || []).length > 0
            || (meta?.warningSignals || []).length > 0
            || (!!decisionContext.exit?.level && decisionContext.exit.level !== '无明确离场');
        const ma20RejectionRecoveryBlocked = previous.eventType === 'fresh_entry_failure'
            && previous.ma20RejectionExit === true;
        const strongFreshRecovery = isStock
            && freshRecoveryEvents.has(previous.eventType)
            && !ma20RejectionRecoveryBlocked
            && postEvent.score >= minimumPostEventScore
            && postEvent.signals.length >= minimumPostEventGroups
            && marketAllowsRecovery
            && !blockedByDecision
            && targetPosition > 0;
        const pullbackConfig = config.pullbackRecovery || {};
        const pullbackEvents = new Set(pullbackConfig.eventTypes || ['mature_profit_rejection']);
        const recoveryRegime = decisionContext.trendRegime?.key || '';
        const supportRecoveryRegime = ['up', 'reversal-up', 'range'].includes(recoveryRegime);
        const signalHardInvalidationPullback = previous.eventType === 'signal_hard_invalidation' && supportRecoveryRegime;
        const pullbackSourcePositions = new Set(pullbackConfig.sourcePositions || [30, 50]);
        const pullbackSignals = new Set(pullbackConfig.signals || ['B6', 'B11']);
        const freshPullbackSignals = (item._signals || []).filter(signal => pullbackSignals.has(signal));
        const pullbackMaPeriod = Math.max(1, Number(pullbackConfig.movingAveragePeriod) || 20);
        const pullbackSlopeDays = Math.max(1, Number(pullbackConfig.slopeLookbackDays) || 1);
        const pullbackMa = Number(state.indicators?.ma?.[pullbackMaPeriod]?.[idx]);
        const previousPullbackMa = Number(state.indicators?.ma?.[pullbackMaPeriod]?.[Math.max(0, idx - pullbackSlopeDays)]);
        const heldEventLow = pullbackConfig.requireHoldEventLow === false
            || (Number.isFinite(close) && close > Number(previous.triggerLow));
        const pullbackRecoveryTarget = pullbackSourcePositions.has(Number(previous.sourcePosition))
            ? Number(previous.sourcePosition)
            : 0;
        const stockTrendCap = Number(decisionContext.positionCap?.limit);
        const stockTrendAllowsPullbackRecovery = pullbackRecoveryTarget <= recoveryCap
            || !Number.isFinite(stockTrendCap)
            || stockTrendCap >= pullbackRecoveryTarget;
        const marketAllowsPullbackRecovery = pullbackRecoveryTarget > 0
            && (marketRecoveryCap == null || marketRecoveryCap >= pullbackRecoveryTarget);
        const pullbackRecovery = isStock
            && pullbackConfig.stocksOnly !== false
            && (pullbackEvents.has(previous.eventType) || signalHardInvalidationPullback)
            && age >= Math.max(2, Number(pullbackConfig.minimumEventAgeTradingDays) || 2)
            && pullbackRecoveryTarget > prevPos
            && freshPullbackSignals.length > 0
            && [close, pullbackMa, previousPullbackMa].every(Number.isFinite)
            && close >= pullbackMa
            && pullbackMa >= previousPullbackMa
            && heldEventLow
            && marketAllowsPullbackRecovery
            && !blockedByRiskSignal
            && !blockedByDecision
            && stockTrendAllowsPullbackRecovery;
        const recoveryCloseLevel = Number.isFinite(Number(previous.recoveryCloseLevel))
            ? Number(previous.recoveryCloseLevel)
            : Number(previous.triggerClose);
        const stableRecovery = age >= Math.max(1, Number(config.minimumLockTradingDays) || 2)
            && Number.isFinite(close)
            && close > recoveryCloseLevel;
        const confirmedPostEventRecovery = isStock
            ? (recoveredRiskHigh && hasFreshPostEventSignal) || stableRecovery || strongFreshRecovery || pullbackRecovery
            : recoveredRiskHigh || hasFreshPostEventSignal || stableRecovery;
        const canRelease = age >= minimumLockTradingDays
            && !blockedByRiskSignal
            && confirmedPostEventRecovery;
        if (!canRelease) {
            return {
                ...previous,
                active: true,
                status: 'locked',
                lockAge: age,
                lockRemaining: Math.max(0, minimumLockTradingDays - age),
                blockedByRiskSignal,
                blockedByDecision,
                recoveredRiskHigh,
                hasFreshPostEventSignal,
                stableRecovery,
                strongFreshRecovery,
                pullbackRecovery,
                freshPullbackSignals,
                pullbackMovingAveragePeriod: pullbackMaPeriod,
                pullbackMovingAverage: pullbackMa,
                postEventScore: postEvent.score,
                postEventScoreSignals: postEvent.signals,
                minimumPostEventScore,
                minimumPostEventGroups,
                marketAllowsRecovery,
                marketAllowsPullbackRecovery,
                stockTrendAllowsPullbackRecovery,
                targetPosition: Math.min(targetPosition, prevPos)
            };
        }
        const holdDays = Math.max(0, Number(config.recoveryHoldTradingDays) || 0);
        if (targetPosition > 0) {
            return {
                ...previous,
                active: false,
                status: 'released',
                resolvedDay: idx,
                resolvedDate: item.date || '',
                recoveredRiskHigh,
                hasFreshPostEventSignal,
                stableRecovery,
                strongFreshRecovery,
                pullbackRecovery,
                freshPullbackSignals,
                pullbackMovingAveragePeriod: pullbackMaPeriod,
                pullbackMovingAverage: pullbackMa,
                postEventScore: postEvent.score,
                postEventScoreSignals: postEvent.signals,
                minimumPostEventScore,
                minimumPostEventGroups,
                marketAllowsRecovery,
                marketAllowsPullbackRecovery,
                stockTrendAllowsPullbackRecovery,
                recoveryPending: false,
                recoveryHoldRemaining: holdDays,
                // 建仓日压力否决在完整观察期后站回风险日收盘时，允许恢复30%试探仓。
                // 其他硬失效事件仍需新信号或专门的趋势接管条件，避免在下跌中继中盲目重入。
                allowRecoveryIncrease: strongFreshRecovery
                    || pullbackRecovery
                    || (stableRecovery && previous.eventType === 'entry_day_pressure_rejection'),
                targetPosition: pullbackRecovery
                    ? Math.max(prevPos, pullbackRecoveryTarget)
                    : Math.min(targetPosition, Math.max(prevPos, recoveryCap))
            };
        }
        if (pullbackRecovery) {
            return {
                ...previous,
                active: false,
                status: 'released',
                resolvedDay: idx,
                resolvedDate: item.date || '',
                recoveredRiskHigh,
                hasFreshPostEventSignal,
                stableRecovery,
                strongFreshRecovery,
                pullbackRecovery,
                freshPullbackSignals,
                pullbackMovingAveragePeriod: pullbackMaPeriod,
                pullbackMovingAverage: pullbackMa,
                postEventScore: postEvent.score,
                postEventScoreSignals: postEvent.signals,
                minimumPostEventScore,
                minimumPostEventGroups,
                marketAllowsRecovery,
                marketAllowsPullbackRecovery,
                stockTrendAllowsPullbackRecovery,
                recoveryPending: false,
                recoveryHoldRemaining: holdDays,
                allowRecoveryIncrease: true,
                targetPosition: pullbackRecoveryTarget
            };
        }
        return {
            ...previous,
            active: false,
            status: 'recovery_pending',
            resolvedDay: idx,
            resolvedDate: item.date || '',
            recoveredRiskHigh,
            hasFreshPostEventSignal,
            stableRecovery,
            recoveryPending: true,
            recoveryHoldRemaining: 0,
            targetPosition
        };
    }

    if (previous?.recoveryPending) {
        const recoveryCap = Math.max(0, Number(config.recoveryPositionCap) || 30);
        const rawSignals = item._signals || [];
        const freshTakeoverSignals = ['B6', 'B11'].filter(signal => rawSignals.includes(signal));
        const ma20 = Number(state.indicators?.ma?.[20]?.[idx]);
        const previousMa20 = Number(state.indicators?.ma?.[20]?.[Math.max(0, idx - 1)]);
        const trendTakeover = isStock
            && freshTakeoverSignals.length > 0
            && Number.isFinite(close)
            && Number.isFinite(ma20)
            && Number.isFinite(previousMa20)
            && close >= ma20
            && ma20 >= previousMa20
            && !meta?.inCooldown
            && !(meta?.exitSignals || []).length
            && !(meta?.warningSignals || []).length;
        const marketRecoveryCap = getMarketIncreaseCap(decisionContext.market, decisionContext.targetStrength?.tier);
        const marketAllowsRecovery = marketRecoveryCap == null || marketRecoveryCap >= recoveryCap;
        const permittedTrendTakeover = trendTakeover && marketAllowsRecovery;
        if (targetPosition <= 0 && !permittedTrendTakeover) return { ...previous, status: 'recovery_pending', targetPosition };
        return {
            ...previous,
            status: 'recovery_started',
            recoveryPending: false,
            recoveryHoldRemaining: Math.max(0, Number(config.recoveryHoldTradingDays) || 0),
            freshTakeoverSignals,
            trendRecovery: permittedTrendTakeover,
            marketAllowsRecovery,
            allowRecoveryIncrease: permittedTrendTakeover,
            targetPosition: Math.min(Math.max(targetPosition, permittedTrendTakeover ? recoveryCap : 0), recoveryCap)
        };
    }

    if (Number(previous?.recoveryHoldRemaining) > 0) {
        const recoveryCap = Math.max(0, Number(config.recoveryPositionCap) || 30);
        const hardInvalidation = getTodaySignalInvalidations(meta, 'price-break').length > 0;
        const canPreserveRecovery = previous.allowRecoveryIncrease
            && !decisionContext.isCriticalExit
            && !meta?.inCooldown
            && !hardInvalidation;
        const preservedPosition = canPreserveRecovery ? Math.min(Math.max(prevPos, recoveryCap), recoveryCap) : 0;
        return {
            ...previous,
            status: 'recovery_hold',
            recoveryHoldRemaining: Number(previous.recoveryHoldRemaining) - 1,
            allowRecoveryIncrease: canPreserveRecovery,
            targetPosition: canPreserveRecovery
                ? Math.max(Math.min(targetPosition, recoveryCap), preservedPosition)
                : Math.min(targetPosition, Math.max(prevPos, recoveryCap))
        };
    }

    if (prevPos <= 0) return empty;
    const entryClose = getWaveRejectionEntryClose(idx, full, prevPos);
    if (!Number.isFinite(entryClose) || entryClose <= 0) return empty;
    const lookbackDays = Math.max(1, Number(config.pressureLookbackDays) || 20);
    const pressureRows = full.slice(Math.max(0, idx - lookbackDays), idx);
    const volumeRows = full.slice(Math.max(0, idx - 5), idx);
    if (!pressureRows.length || !volumeRows.length) return empty;
    const previousHigh = Math.max(...pressureRows.map(row => Number(row?.high) || 0));
    const averageVolume = volumeRows.reduce((sum, row) => sum + (Number(row?.vol) || 0), 0) / volumeRows.length;
    const open = Number(item.open);
    const high = Number(item.high);
    const low = Number(item.low);
    const volume = Number(item.vol) || 0;
    const range = high - low;
    const body = Math.abs(close - open);
    const upperShadow = high - Math.max(open, close);
    const lowerShadow = Math.min(open, close) - low;
    const closeLocation = range > 0 ? (close - low) / range : 1;
    const profitRatio = close / entryClose - 1;
    const volumeRatio = averageVolume > 0 ? volume / averageVolume : 0;
    const nearPressure = previousHigh > 0 && high >= previousHigh * Number(config.pressureToleranceRatio);
    const freshEntryConfig = isStock ? config.freshEntryFailure : indexFreshEntryConfig;
    const downsideConfig = isIndex ? indexDownsideConfig : config.freshEntryDownsideFailure;
    let entryDay = null;
    for (let day = idx - 1; day >= 0; day--) {
        const priorDecision = full?.[day]?._decision;
        if (!priorDecision || Number(priorDecision.position) <= 0) break;
        if (Number(priorDecision.prevAdv) === 0 || priorDecision.bsMark === 'B') {
            entryDay = day;
            break;
        }
    }
    const entryAge = Number.isInteger(entryDay) ? idx - entryDay : null;
    const entrySignalLow = Number.isInteger(entryDay) ? Number(full?.[entryDay]?.low) : null;
    const frozenHardDefense = Number(full?.[idx - 1]?._decision?.waveContext?.lifecycle?.hardDefense);
    const holdsFrozenDefense = Number.isFinite(frozenHardDefense)
        && Number.isFinite(close)
        && close >= frozenHardDefense;
    const intradayProfitRatio = high / entryClose - 1;
    const givebackRatio = high > entryClose ? (high - close) / (high - entryClose) : 0;
    const upperShadowRangeRatio = range > 0 ? upperShadow / range : 0;
    const freshEntryPressure = freshEntryConfig
        ? getWaveFreshEntryPressureContext(idx, full, state.indicators, freshEntryConfig)
        : { matched: false, sources: [] };
    const secondDayMinimumHighAdvanceRatio = Number(freshEntryConfig?.secondDayMinimumHighAdvanceRatio);
    const previousDayHigh = Number(full?.[idx - 1]?.high);
    const secondDayHighAdvanceRatio = Number.isFinite(previousDayHigh) && previousDayHigh > 0
        ? high / previousDayHigh - 1
        : Infinity;
    const newlyReachedPressureSources = Number.isInteger(entryAge) && entryAge > 1
        ? freshEntryPressure.sources.filter(source =>
            !wasWavePressureSourceReachedOnDay(source, idx - 1, full, state.indicators, freshEntryConfig)
        )
        : freshEntryPressure.sources;
    const freshPressureAttack = !Number.isFinite(secondDayMinimumHighAdvanceRatio)
        || !Number.isInteger(entryAge)
        || entryAge <= 1
        || newlyReachedPressureSources.length > 0
        || secondDayHighAdvanceRatio >= secondDayMinimumHighAdvanceRatio;
    const pressureAttackType = !Number.isInteger(entryAge) || entryAge <= 1
        ? 'first_day'
        : (newlyReachedPressureSources.length > 0 ? 'new_source' : (freshPressureAttack ? 'higher_high' : 'repeat'));
    const requiredCloseBelowMaPeriod = Number(freshEntryConfig?.requireCloseBelowMovingAveragePeriod);
    const requiredCloseBelowMa = Number.isFinite(requiredCloseBelowMaPeriod)
        ? Number(state.indicators?.ma?.[requiredCloseBelowMaPeriod]?.[idx])
        : null;
    const stockFreshEntryCloseAllowed = !isStock
        || !Number.isFinite(requiredCloseBelowMaPeriod)
        || (Number.isFinite(requiredCloseBelowMa) && close < requiredCloseBelowMa);
    const ma20RejectionConfig = isStock ? freshEntryConfig?.ma20RejectionExit : null;
    const rejectionMaPeriod = Number(ma20RejectionConfig?.movingAveragePeriod) || 20;
    const rejectionLongMaPeriod = Number(ma20RejectionConfig?.longMovingAveragePeriod) || 60;
    const rejectionMa = Number(state.indicators?.ma?.[rejectionMaPeriod]?.[idx]);
    const rejectionLongMa = Number(state.indicators?.ma?.[rejectionLongMaPeriod]?.[idx]);
    const rejectionSlopeDays = Math.max(1, Number(ma20RejectionConfig?.slopeLookbackDays) || 5);
    const previousRejectionMa = Number(state.indicators?.ma?.[rejectionMaPeriod]?.[idx - rejectionSlopeDays]);
    const stockMa20RejectionTriggered = ma20RejectionConfig
        && Number.isInteger(entryAge)
        && entryAge >= 1
        && entryAge <= Math.max(1, Number(freshEntryConfig.maximumEntryAgeTradingDays) || 2)
        && [rejectionMa, rejectionLongMa, previousRejectionMa].every(Number.isFinite)
        && rejectionMa < rejectionLongMa
        && rejectionMa < previousRejectionMa
        && high >= rejectionMa
        && close < rejectionMa
        && upperShadowRangeRatio >= Number(ma20RejectionConfig.minimumUpperShadowRangeRatio || 0)
        && closeLocation <= Number(ma20RejectionConfig.maximumCloseLocation ?? 1)
        && (!ma20RejectionConfig.requireUpperShadowDominance || upperShadow > lowerShadow)
        && freshPressureAttack;
    const stockMa20HoldTriggered = ma20RejectionConfig
        && Number.isInteger(entryAge)
        && entryAge >= 1
        && entryAge <= Math.max(1, Number(freshEntryConfig.maximumEntryAgeTradingDays) || 2)
        && [rejectionMa, rejectionLongMa, previousRejectionMa].every(Number.isFinite)
        && rejectionMa < rejectionLongMa
        && close >= rejectionMa
        && upperShadowRangeRatio >= Number(ma20RejectionConfig.minimumUpperShadowRangeRatio || 0)
        && closeLocation <= Number(ma20RejectionConfig.maximumCloseLocation ?? 1)
        && (!ma20RejectionConfig.requireUpperShadowDominance || upperShadow > lowerShadow)
        && freshEntryPressure.matched
        && freshPressureAttack;
    const classicFreshEntryFailureTriggered = freshEntryConfig
        && (!isStock || decisionContext?.waveContext?.regime === 'down')
        && (!freshEntryConfig.requireBearishClose || close < open)
        && (!Number.isFinite(Number(freshEntryConfig.maximumCloseDefenseGapRatio))
            || (Number.isFinite(entrySignalLow)
                && entrySignalLow > 0
                && close / entrySignalLow - 1 <= Number(freshEntryConfig.maximumCloseDefenseGapRatio)))
        && Number.isInteger(entryAge)
        && entryAge >= 1
        && entryAge <= Math.max(1, Number(freshEntryConfig.maximumEntryAgeTradingDays) || 2)
        && intradayProfitRatio >= Number(freshEntryConfig.minimumIntradayProfitRatio)
        && profitRatio <= Number(freshEntryConfig.maximumCloseProfitRatio)
        && givebackRatio >= Number(freshEntryConfig.minimumGivebackRatio)
        && volumeRatio >= Number(freshEntryConfig.minimumVolumeRatio)
        && upperShadowRangeRatio >= Number(freshEntryConfig.minimumUpperShadowRangeRatio)
        && closeLocation <= Number(freshEntryConfig.maximumCloseLocation)
        && freshEntryPressure.matched
        && freshPressureAttack
        && stockFreshEntryCloseAllowed
        && (!freshEntryConfig.requireFrozenDefenseBreakForPressureFailure || !holdsFrozenDefense);
    const freshEntryFailureTriggered = stockMa20RejectionTriggered || classicFreshEntryFailureTriggered;
    const downsideCloseGapRatio = Number.isFinite(entrySignalLow) && entrySignalLow > 0 && Number.isFinite(close)
        ? close / entrySignalLow - 1
        : Infinity;
    const downsideBearBodyRangeRatio = range > 0 && close < open ? (open - close) / range : 0;
    const protectedB11LocalBreak = (meta?.localBreakWindowSignals || []).some(signal =>
        signal?.signal === 'B11'
        && Number.isFinite(Number(signal.structureLevel))
        && close >= Number(signal.structureLevel)
    );
    const hardSignalInvalidations = getTodaySignalInvalidations(meta, 'price-break');
    const signalInvalidationRecoveryLevels = hardSignalInvalidations
        .map(signal => Number(signal?.invalidationLevel))
        .filter(level => Number.isFinite(level));
    const signalInvalidationRecoveryLevel = signalInvalidationRecoveryLevels.length
        ? Math.max(...signalInvalidationRecoveryLevels)
        : close;
    const signalHardInvalidationExitTriggered = isStock
        && prevPos > 0
        && targetPosition <= 0
        && hardSignalInvalidations.length > 0
        && !holdsFrozenDefense;
    const freshEntryHardBreakTriggered = downsideConfig
        && downsideConfig.exitOnCloseBelowEntryLow !== false
        && Number.isInteger(entryAge)
        && entryAge >= 1
        && entryAge <= Math.max(1, Number(downsideConfig.maximumEntryAgeTradingDays) || 2)
        && Number.isFinite(entrySignalLow)
        && entrySignalLow > 0
        && close < entrySignalLow
        && !protectedB11LocalBreak;
    const freshEntryDownsideFailureTriggered = downsideConfig
        && Number.isInteger(entryAge)
        && entryAge >= 1
        && entryAge <= Math.max(1, Number(downsideConfig.maximumEntryAgeTradingDays) || 2)
        && Number.isFinite(entrySignalLow)
        && entrySignalLow > 0
        && low < entrySignalLow
        && close >= entrySignalLow
        && downsideCloseGapRatio <= Number(downsideConfig.maximumCloseDefenseGapRatio)
        && downsideBearBodyRangeRatio >= Number(downsideConfig.minimumBearBodyRangeRatio)
        && closeLocation <= Number(downsideConfig.maximumCloseLocation)
        && volumeRatio >= Number(downsideConfig.minimumVolumeRatio);
    const matureProfitRejectionTriggered = isStock && Number.isFinite(profitRatio)
        && profitRatio >= Number(config.minimumProfitRatio)
        && volumeRatio >= Number(config.minimumVolumeRatio)
        && nearPressure
        && upperShadow >= Math.max(body * Number(config.minimumUpperShadowBodyRatio), 0)
        && upperShadowRangeRatio >= Number(config.minimumUpperShadowRangeRatio || 0)
        && (!config.requireUpperShadowDominance || upperShadow > lowerShadow)
        && closeLocation <= Number(config.maximumCloseLocation);
    const triggered = freshEntryHardBreakTriggered || freshEntryDownsideFailureTriggered || freshEntryFailureTriggered
        || signalHardInvalidationExitTriggered || matureProfitRejectionTriggered;
    if (!triggered && !stockMa20HoldTriggered) return empty;
    if (!triggered) {
        const holdPositionCap = Math.max(0, Number(ma20RejectionConfig.holdPositionCap) || 30);
        return {
            active: false,
            status: 'ma20_hold',
            eventType: 'fresh_entry_ma20_hold',
            triggerDay: idx,
            triggerDate: item.date || '',
            triggerHigh: high,
            triggerLow: low,
            triggerClose: close,
            entryClose,
            entryDay,
            entryDate: Number.isInteger(entryDay) ? full?.[entryDay]?.date || '' : '',
            entryAge,
            profitRatio,
            volumeRatio,
            secondDayHighAdvanceRatio,
            pressureAttackType,
            ma20Level: rejectionMa,
            upperShadowRangeRatio,
            closeLocation,
            pressureSources: freshEntryPressure.sources,
            sourcePosition: prevPos,
            targetPosition: Math.min(targetPosition, holdPositionCap),
            holdPositionCap,
            recoveryPending: false,
            recoveryHoldRemaining: 0
        };
    }
    return {
        active: true,
        status: 'triggered',
        triggerDay: idx,
        triggerDate: item.date || '',
        triggerHigh: high,
        triggerLow: low,
        triggerClose: close,
        recoveryCloseLevel: signalHardInvalidationExitTriggered ? signalInvalidationRecoveryLevel : close,
        entryClose,
        entryDay,
        entryDate: Number.isInteger(entryDay) ? full?.[entryDay]?.date || '' : '',
        entryAge,
        entrySignalLow,
        downsideBearBodyRangeRatio,
        downsideCloseGapRatio,
        eventType: freshEntryHardBreakTriggered
            ? 'fresh_entry_hard_break'
            : (freshEntryDownsideFailureTriggered
                ? 'fresh_entry_downside_failure'
                : (freshEntryFailureTriggered
                    ? 'fresh_entry_failure'
                    : (signalHardInvalidationExitTriggered ? 'signal_hard_invalidation' : 'mature_profit_rejection'))),
        profitRatio,
        intradayProfitRatio,
        givebackRatio,
        volumeRatio,
        secondDayHighAdvanceRatio,
        pressureAttackType,
        ma20RejectionExit: !!stockMa20RejectionTriggered,
        ma20Level: Number.isFinite(rejectionMa) ? rejectionMa : null,
        upperShadowBodyRatio: body > 0 ? upperShadow / body : null,
        lowerShadow,
        upperShadowRangeRatio,
        closeLocation,
        pressureSources: signalHardInvalidationExitTriggered
            ? hardSignalInvalidations.map(signal => ({
                type: 'signal_invalidation',
                period: null,
                level: Number(signal?.invalidationLevel),
                day: Number(signal?.day),
                date: signal?.signalDate || '',
                signal: signal?.signal || ''
            }))
            : ((freshEntryHardBreakTriggered || freshEntryDownsideFailureTriggered)
            ? [{ type: 'signal_low', period: null, level: entrySignalLow, day: entryDay, date: Number.isInteger(entryDay) ? full?.[entryDay]?.date || '' : '' }]
            : (freshEntryFailureTriggered ? freshEntryPressure.sources : [{ type: 'recent_high', period: null, level: previousHigh, day: null }])),
        sourcePosition: prevPos,
        targetPosition: freshEntryHardBreakTriggered || signalHardInvalidationExitTriggered
            ? 0
            : Math.min(targetPosition, getLowerWavePositionStep(prevPos, config.positionSteps)),
        recoveryPending: false,
        recoveryHoldRemaining: 0
    };
}

function getWaveExpiryHandoffContext(idx, full, meta, prevPos, basePosition, exit, risk, strategy = STRATEGY) {
    const config = strategy?.waveExpiryHandoff;
    const empty = { applied: false, reason: '' };
    const requiredPosition = Math.max(0, Number(config?.position) || 30);
    if (!config || state.strategy !== '波段抄底型' || state.period !== 'daily') return empty;
    const previous = full?.[idx - 1]?._decision?.waveExpiryHandoff;
    if (previous?.applied && previous.observationMode === 'defensive') {
        const close = Number(full?.[idx]?.close);
        const invalidatedToday = [
            ...(meta?.invalidatedWindowSignals || []),
            ...(meta?.localBreakWindowSignals || [])
        ].some(item => Number(item?.invalidationDay) === Number(idx));
        const blocked = meta?.inCooldown
            || (meta?.exitSignals || []).length > 0
            || (meta?.warningSignals || []).length > 0
            || !exit
            || exit.level !== '无明确离场'
            || invalidatedToday;
        const nextPeriods = config.defensiveObservation?.nextDayMovingAveragePeriods || [5, 20];
        const recoveredMovingAverages = Number.isFinite(close) && nextPeriods.every(period => {
            const level = Number(state.indicators?.ma?.[Number(period)]?.[idx]);
            return Number.isFinite(level) && close > level;
        });
        const hasFreshSignal = (meta?.windowScoreSignals || []).some(signal => Number(signal.day) > Number(previous.triggerDay));
        const brokeObservationLow = Number.isFinite(close)
            && Number.isFinite(Number(previous.triggerLow))
            && close < Number(previous.triggerLow);
        const brokeEntryLow = Number.isFinite(close)
            && Number.isFinite(Number(previous.entryLow))
            && close < Number(previous.entryLow);
        const hardBreak = previous.establishedUptrend ? brokeEntryLow : brokeObservationLow;
        const takeoverPassed = !blocked && !hardBreak && (recoveredMovingAverages || hasFreshSignal);
        const defensiveConfig = config.defensiveObservation || {};
        const observationAge = idx - Number(previous.triggerDay);
        const maxTradingDays = Math.max(1, Number(defensiveConfig.establishedTrendMaxTradingDays) || 1);
        const trendPeriod = Math.max(1, Number(defensiveConfig.trendMovingAveragePeriod) || 20);
        const longPeriod = Math.max(1, Number(defensiveConfig.longMovingAveragePeriod) || 60);
        const trendSlopeDays = Math.max(1, Number(defensiveConfig.establishedTrendSlopeLookbackDays) || 5);
        const trendMA = Number(state.indicators?.ma?.[trendPeriod]?.[idx]);
        const longMA = Number(state.indicators?.ma?.[longPeriod]?.[idx]);
        const priorTrendMA = Number(state.indicators?.ma?.[trendPeriod]?.[idx - trendSlopeDays]);
        const currentEstablishedUptrend = [trendMA, longMA, priorTrendMA].every(Number.isFinite)
            && trendMA > longMA
            && trendMA >= priorTrendMA;
        const closeGapRatio = Number.isFinite(close) && trendMA > 0 ? Math.max(0, (trendMA - close) / trendMA) : Infinity;
        const atr = getATR(full, idx);
        const closeGapAtr = Number.isFinite(close) && Number.isFinite(trendMA) && atr > 0
            ? Math.max(0, trendMA - close) / atr
            : Infinity;
        const withinWashoutRange = closeGapRatio <= Math.max(0, Number(defensiveConfig.maximumCloseGapRatio) || 0.03)
            && closeGapAtr <= Math.max(0, Number(defensiveConfig.maximumCloseGapAtr) || 1);
        const continueEstablishedWashout = !takeoverPassed
            && !blocked
            && !hardBreak
            && previous.establishedUptrend
            && currentEstablishedUptrend
            && withinWashoutRange
            && observationAge < maxTradingDays;
        if (continueEstablishedWashout) {
            return {
                ...previous,
                applied: true,
                status: 'observing',
                trendWashout: true,
                observationAge,
                maxTradingDays,
                currentEstablishedUptrend,
                closeGapRatio,
                closeGapAtr,
                recoveredMovingAverages,
                hasFreshSignal,
                brokeObservationLow,
                brokeEntryLow,
                forceExit: false,
                forceHold: Number(basePosition) <= 0,
                targetPosition: requiredPosition,
                reason: `上涨结构未破，积分到期后的MA${trendPeriod}洗盘观察继续保留${requiredPosition}%`
            };
        }
        return {
            ...previous,
            applied: false,
            status: takeoverPassed ? 'taken_over' : 'expired',
            followUpDay: idx,
            followUpDate: full?.[idx]?.date || '',
            recoveredMovingAverages,
            hasFreshSignal,
            brokeObservationLow,
            brokeEntryLow,
            forceExit: !takeoverPassed,
            forceHold: takeoverPassed && Number(basePosition) <= 0,
            reason: takeoverPassed
                ? '到期防守观察后重新站上短期与中期均线，或出现新的有效买入信号'
                : '到期防守观察后未能重新站上短期与中期均线，也没有新的有效买入信号'
        };
    }
    if (prevPos !== requiredPosition || Number(basePosition) > 0 || idx <= 0) return empty;
    if (meta?.inCooldown || (meta?.exitSignals || []).length || (meta?.warningSignals || []).length) return empty;
    if (!exit || exit.level !== '无明确离场') return empty;
    if (previous?.applied) return empty;

    const invalidatedToday = [
        ...(meta?.invalidatedWindowSignals || []),
        ...(meta?.localBreakWindowSignals || [])
    ].some(item => Number(item?.invalidationDay) === Number(idx));
    if (invalidatedToday) return empty;

    const previousMeta = getSignalMeta(idx - 1, full, state.indicators);
    const holdThreshold = Math.max(1, Number(strategy?.holdThreshold) || Number(strategy?.buyThreshold) || 1);
    if (Number(previousMeta?.windowScore) < holdThreshold || Number(meta?.windowScore) >= holdThreshold) return empty;
    const currentScoreKeys = new Set((meta?.windowScoreSignals || []).map(item => `${item.signal}|${item.day}`));
    const missingPreviousSignals = (previousMeta?.windowScoreSignals || []).filter(item => !currentScoreKeys.has(`${item.signal}|${item.day}`));
    const windowDays = Math.max(1, Number(strategy?.windowDays) || 1);
    if (!missingPreviousSignals.length || !missingPreviousSignals.every(item => idx - Number(item.day) >= windowDays)) return empty;

    let entryDay = null;
    for (let day = idx - 1; day >= 0; day--) {
        const priorDecision = full?.[day]?._decision;
        if (!priorDecision || Number(priorDecision.position) <= 0) break;
        if (Number(priorDecision.prevAdv) === 0 || priorDecision.bsMark === 'B') {
            entryDay = day;
            break;
        }
    }
    const entryLow = Number.isInteger(entryDay) ? Number(full?.[entryDay]?.low) : null;
    const close = Number(full?.[idx]?.close);
    const previousClose = Number(full?.[idx - 1]?.close);
    const movingAveragePeriod = Math.max(1, Number(config.movingAveragePeriod) || 5);
    const shortMA = Number(state.indicators?.ma?.[movingAveragePeriod]?.[idx]);
    if (!Number.isFinite(entryLow) || !Number.isFinite(close) || !Number.isFinite(previousClose) || !Number.isFinite(shortMA)) return empty;
    if (close <= entryLow) return empty;

    const macdBar = Number(state.indicators?.macd?.bar?.[idx]);
    const previousMacdBar = Number(state.indicators?.macd?.bar?.[idx - 1]);
    const macdImproving = Number.isFinite(macdBar) && Number.isFinite(previousMacdBar) && macdBar > previousMacdBar;
    const k = Number(state.indicators?.kdj?.k?.[idx]);
    const d = Number(state.indicators?.kdj?.d?.[idx]);
    const previousK = Number(state.indicators?.kdj?.k?.[idx - 1]);
    const kdjImproving = Number.isFinite(k) && Number.isFinite(d) && Number.isFinite(previousK) && k > d && k > previousK;
    const strictRecovery = close > previousClose && close > shortMA && (macdImproving || kdjImproving);
    const defensiveConfig = config.defensiveObservation;
    const defensiveStocksOnly = defensiveConfig?.stocksOnly !== false;
    const trendPeriod = Math.max(1, Number(defensiveConfig?.trendMovingAveragePeriod) || 20);
    const trendSlopeDays = Math.max(1, Number(defensiveConfig?.trendSlopeLookbackDays) || 1);
    const trendMA = Number(state.indicators?.ma?.[trendPeriod]?.[idx]);
    const previousTrendMA = Number(state.indicators?.ma?.[trendPeriod]?.[idx - trendSlopeDays]);
    const trendMANotFalling = Number.isFinite(trendMA) && Number.isFinite(previousTrendMA) && trendMA >= previousTrendMA;
    const longPeriod = Math.max(1, Number(defensiveConfig?.longMovingAveragePeriod) || 60);
    const establishedSlopeDays = Math.max(1, Number(defensiveConfig?.establishedTrendSlopeLookbackDays) || 5);
    const longMA = Number(state.indicators?.ma?.[longPeriod]?.[idx]);
    const establishedPreviousTrendMA = Number(state.indicators?.ma?.[trendPeriod]?.[idx - establishedSlopeDays]);
    const establishedUptrend = [trendMA, longMA, establishedPreviousTrendMA].every(Number.isFinite)
        && trendMA > longMA
        && trendMA >= establishedPreviousTrendMA;
    const establishedCloseGapRatio = trendMA > 0 ? Math.max(0, (trendMA - close) / trendMA) : Infinity;
    const atr = getATR(full, idx);
    const establishedCloseGapAtr = atr > 0 ? Math.max(0, trendMA - close) / atr : Infinity;
    const establishedWashoutRange = establishedCloseGapRatio <= Math.max(0, Number(defensiveConfig?.maximumCloseGapRatio) || 0.03)
        && establishedCloseGapAtr <= Math.max(0, Number(defensiveConfig?.maximumCloseGapAtr) || 1);
    const positiveMacdBar = Number.isFinite(macdBar) && macdBar > 0;
    const defensiveObservation = !!defensiveConfig
        && (!defensiveStocksOnly || state.mode === 'stock')
        && trendMANotFalling
        && (!defensiveConfig.requirePositiveMacdBar || positiveMacdBar);
    if (!strictRecovery && !defensiveObservation) return empty;

    const observationMode = strictRecovery ? 'rebound' : 'defensive';
    const momentumSignals = strictRecovery
        ? [macdImproving ? 'MACD柱改善' : '', kdjImproving ? 'KDJ继续修复' : ''].filter(Boolean)
        : [`MA${trendPeriod}未下行`, 'MACD柱仍为正'];
    return {
        applied: true,
        observationMode,
        reason: strictRecovery
            ? '买入积分仅因窗口自然到期，价格与短线动能仍在修复，保留一日低风险仓位等待接管'
            : '买入积分仅因窗口自然到期，价格仍守住买入日防守位，且中期均线未下行、MACD柱仍为正，保留一日30%防守观察',
        holdTradingDays: Math.max(1, Number(config.holdTradingDays) || 1),
        triggerDay: idx,
        triggerDate: full?.[idx]?.date || '',
        triggerLow: Number(full?.[idx]?.low),
        sourcePosition: prevPos,
        entryDay,
        entryDate: full?.[entryDay]?.date || '',
        entryLow,
        shortMAPeriod: movingAveragePeriod,
        shortMA,
        trendMAPeriod: trendPeriod,
        trendMA,
        previousTrendMA,
        longMAPeriod: longPeriod,
        longMA,
        establishedUptrend,
        closeGapRatio: establishedCloseGapRatio,
        closeGapAtr: establishedCloseGapAtr,
        trendWashout: observationMode === 'defensive' && establishedUptrend && establishedWashoutRange,
        previousWindowScore: Number(previousMeta.windowScore) || 0,
        currentWindowScore: Number(meta?.windowScore) || 0,
        expiredSignals: missingPreviousSignals.map(item => ({ signal: item.signal, day: item.day, signalDate: item.signalDate || full?.[item.day]?.date || '' })),
        momentumSignals
    };
}

function getWaveMA20PullbackObservationContext(idx, full, meta, prevPos, basePosition, exit, risk, strategy = STRATEGY) {
    const config = strategy?.waveMA20PullbackObservation;
    const empty = { applied: false, reason: '' };
    const requiredPosition = Math.max(0, Number(config?.position) || 30);
    const trendDefense = config?.trendDefense;
    if (!config || state.strategy !== '波段抄底型' || state.period !== 'daily') return empty;
    if (config.stocksOnly !== false && state.mode !== 'stock') return empty;

    const period = Math.max(1, Number(config.movingAveragePeriod) || 20);
    const item = full?.[idx] || {};
    const close = Number(item.close);
    const movingAverage = Number(state.indicators?.ma?.[period]?.[idx]);
    const rawSignals = item._signals || [];
    const previous = full?.[idx - 1]?._decision?.waveMA20PullbackObservation;
    const trendPeriod = Math.max(1, Number(trendDefense?.movingAveragePeriod) || period);
    const trendMovingAverage = Number(state.indicators?.ma?.[trendPeriod]?.[idx]);
    const previousTrendMovingAverage = Number(state.indicators?.ma?.[trendPeriod]?.[Math.max(0, idx - 1)]);
    const breakoutLookbackDays = Math.max(1, Number(trendDefense?.breakoutLookbackDays) || 3);
    const breakoutPullbackGapRatio = Math.max(0, Number(trendDefense?.maximumBreakoutPullbackGapRatio) || 0.005);
    const breakoutLowGapRatio = Math.max(0, Number(trendDefense?.maximumBreakoutLowGapRatio) || breakoutPullbackGapRatio);
    let breakoutDay = -1;
    if (trendDefense && idx > 1) {
        for (let day = idx - 1; day >= Math.max(1, idx - breakoutLookbackDays); day--) {
            const dayClose = Number(full?.[day]?.close);
            const dayMa = Number(state.indicators?.ma?.[trendPeriod]?.[day]);
            const priorClose = Number(full?.[day - 1]?.close);
            const priorMa = Number(state.indicators?.ma?.[trendPeriod]?.[day - 1]);
            if ([dayClose, dayMa, priorClose, priorMa].every(Number.isFinite)
                && priorClose <= priorMa
                && dayClose > dayMa
                && dayMa >= priorMa) {
                breakoutDay = day;
                break;
            }
        }
    }
    const breakoutAge = breakoutDay >= 0 ? idx - breakoutDay : Infinity;
    const breakoutDefenseLevel = Number(risk?.stop);
    const breakoutPullback = trendDefense
        && prevPos === requiredPosition
        && Number(basePosition) <= 0
        && state.mode === 'stock'
        && breakoutAge >= 1
        && breakoutAge <= breakoutLookbackDays
        && [close, trendMovingAverage, previousTrendMovingAverage].every(Number.isFinite)
        && trendMovingAverage >= previousTrendMovingAverage
        && close >= trendMovingAverage * (1 - breakoutPullbackGapRatio)
        && Number(item.low) <= trendMovingAverage * (1 + breakoutLowGapRatio)
        && (!Number.isFinite(breakoutDefenseLevel) || close >= breakoutDefenseLevel)
        && !meta?.inCooldown
        && !(meta?.exitSignals || []).length
        && !(meta?.warningSignals || []).length;
    if (breakoutPullback) {
        return {
            applied: true,
            status: 'observing',
            defenseType: 'breakout_pullback',
            overrideCriticalExit: true,
            reason: `突破MA${trendPeriod}后的第${breakoutAge}个交易日回踩，收盘仍贴近均线，保留${requiredPosition}%观察`,
            triggerDay: idx,
            triggerDate: item.date || '',
            triggerLow: Number(item.low),
            triggerClose: close,
            sourcePosition: prevPos,
            targetPosition: requiredPosition,
            movingAveragePeriod: trendPeriod,
            movingAverage: trendMovingAverage,
            previousMovingAverage: previousTrendMovingAverage,
            breakoutDay,
            breakoutDate: full?.[breakoutDay]?.date || '',
            breakoutAge,
            defenseLevel: Number.isFinite(breakoutDefenseLevel) ? breakoutDefenseLevel : null
        };
    }
    const invalidatedToday = [
        ...(meta?.invalidatedWindowSignals || []),
        ...(meta?.localBreakWindowSignals || [])
    ].some(signal => Number(signal?.invalidationDay) === Number(idx));
    const blocked = meta?.inCooldown
        || (meta?.exitSignals || []).length > 0
        || (meta?.warningSignals || []).length > 0
        || !exit
        || exit.level !== '无明确离场'
        || invalidatedToday;

    if (previous?.applied) {
        const defenseLevel = Number(previous.defenseLevel);
        const recoveredMovingAverage = Number.isFinite(close) && Number.isFinite(movingAverage) && close >= movingAverage;
        const freshTakeoverSignals = (config.takeoverSignals || ['B6', 'B11']).filter(signal => rawSignals.includes(signal));
        const brokeObservationLow = Number.isFinite(close)
            && Number.isFinite(Number(previous.triggerLow))
            && close < Number(previous.triggerLow);
        const brokeDefenseLevel = Number.isFinite(close)
            && Number.isFinite(defenseLevel)
            && close < defenseLevel;
        const takeoverPassed = !blocked
            && !brokeObservationLow
            && !brokeDefenseLevel
            && (recoveredMovingAverage || freshTakeoverSignals.length > 0);
        return {
            ...previous,
            applied: false,
            status: takeoverPassed ? 'taken_over' : 'expired',
            followUpDay: idx,
            followUpDate: item.date || '',
            recoveredMovingAverage,
            freshTakeoverSignals,
            brokeObservationLow,
            brokeDefenseLevel,
            forceExit: !takeoverPassed,
            forceHold: takeoverPassed && (previous?.defenseType ? true : Number(basePosition) <= 0),
            overrideCriticalExit: false,
            targetPosition: requiredPosition,
            reason: takeoverPassed
                ? `MA${period}回踩观察后重新站回均线，或出现新的B6/B11信号`
                : `MA${period}回踩观察后未重新站回均线，也没有新的B6/B11信号`
        };
    }

    if (trendDefense && prevPos === requiredPosition && Number(basePosition) <= 0 && idx > 0) {
        const trendPeriod = Math.max(1, Number(trendDefense.movingAveragePeriod) || period);
        const longPeriod = Math.max(1, Number(trendDefense.longMovingAveragePeriod) || 60);
        const slopeDays = Math.max(1, Number(trendDefense.completeTrendSlopeLookbackDays) || 5);
        const trendMovingAverage = Number(state.indicators?.ma?.[trendPeriod]?.[idx]);
        const previousTrendMovingAverage = Number(state.indicators?.ma?.[trendPeriod]?.[idx - 1]);
        const longMovingAverage = Number(state.indicators?.ma?.[longPeriod]?.[idx]);
        const establishedTrendMovingAverage = Number(state.indicators?.ma?.[trendPeriod]?.[idx - slopeDays]);
        const atr = getATR(full, idx);
        const defenseLevel = Number(risk?.stop);
        const maGap = Number.isFinite(trendMovingAverage) && Number.isFinite(close)
            ? Math.max(0, trendMovingAverage - close)
            : Infinity;
        const maGapRatio = Number.isFinite(trendMovingAverage) && trendMovingAverage > 0
            ? maGap / trendMovingAverage
            : Infinity;
        const maGapAtr = atr > 0 ? maGap / atr : Infinity;
        const maSupport = [close, trendMovingAverage, previousTrendMovingAverage].every(Number.isFinite)
            && trendMovingAverage >= previousTrendMovingAverage
            && maGapRatio <= Math.max(0, Number(trendDefense.maximumCloseBelowMovingAverageRatio) || 0.005)
            && maGapAtr <= Math.max(0, Number(trendDefense.maximumCloseBelowMovingAverageAtr) || 0.5);
        const completeUptrend = [close, trendMovingAverage, longMovingAverage, establishedTrendMovingAverage].every(Number.isFinite)
            && close >= trendMovingAverage
            && trendMovingAverage > longMovingAverage
            && trendMovingAverage >= establishedTrendMovingAverage;
        const defenseIntact = !Number.isFinite(defenseLevel) || close >= defenseLevel;
        const currentExitSignals = meta?.exitSignals || [];
        const blockingSignals = rawSignals.filter(signal => (trendDefense.blockingSignals || []).includes(signal));
        const invalidationsToday = getTodaySignalInvalidations(meta, 'price-break');
        const invalidationGap = invalidationsToday.length
            ? Math.max(...invalidationsToday
                .map(signal => Math.max(0, Number(signal?.invalidationLevel) - close))
                .filter(Number.isFinite), 0)
            : Infinity;
        const limitedHardInvalidation = invalidationsToday.length > 0
            && atr > 0
            && invalidationGap / atr <= Math.max(0, Number(trendDefense.maximumInvalidationGapAtr) || 1);
        const standaloneExitSignal = trendDefense.standaloneExitSignal || 'L3';
        const standaloneL3 = currentExitSignals.length === 1
            && currentExitSignals[0] === standaloneExitSignal
            && blockingSignals.length === 0
            && !(meta?.type || '').includes('清仓')
            && completeUptrend;
        const hardInvalidationPullback = currentExitSignals.length === 0
            && !(meta?.warningSignals || []).length
            && limitedHardInvalidation
            && close >= trendMovingAverage;
        const eligible = trendDefense.stocksOnly !== false
            && state.mode === 'stock'
            && !meta?.inCooldown
            && maSupport
            && defenseIntact
            && (standaloneL3 || hardInvalidationPullback);
        if (eligible) {
            const defenseType = standaloneL3 ? 'standalone_l3' : 'limited_hard_invalidation';
            return {
                applied: true,
                status: 'observing',
                defenseType,
                overrideCriticalExit: standaloneL3,
                reason: standaloneL3
                    ? '单独MACD死叉，价格仍在完整多头结构中，本日保留30%观察'
                    : '买点失效位虽被收盘跌破，但价格仍守住MA20，先保留30%观察',
                triggerDay: idx,
                triggerDate: item.date || '',
                triggerLow: Number(item.low),
                triggerClose: close,
                sourcePosition: prevPos,
                targetPosition: requiredPosition,
                movingAveragePeriod: trendPeriod,
                movingAverage: trendMovingAverage,
                previousMovingAverage: previousTrendMovingAverage,
                defenseLevel: Number.isFinite(defenseLevel) ? defenseLevel : null,
                invalidationGapAtr: limitedHardInvalidation && atr > 0 ? invalidationGap / atr : null
            };
        }
    }

    if (prevPos !== requiredPosition || Number(basePosition) > 0 || idx <= 0 || blocked) return empty;
    const slopeDays = Math.max(1, Number(config.slopeLookbackDays) || 1);
    const previousMovingAverage = Number(state.indicators?.ma?.[period]?.[idx - slopeDays]);
    const previousClose = Number(full?.[idx - 1]?.close);
    const high = Number(item.high);
    const low = Number(item.low);
    const open = Number(item.open);
    if (![close, movingAverage, previousMovingAverage, previousClose, high, low, open].every(Number.isFinite)) return empty;

    const closeGapRatio = movingAverage > 0 ? (movingAverage - close) / movingAverage : Infinity;
    const body = Math.abs(close - open);
    const lowerShadow = Math.max(0, Math.min(open, close) - low);
    const range = Math.max(high - low, 0);
    const lowerShadowRangeRatio = range > 0 ? lowerShadow / range : 0;
    const maximumGap = Math.max(0, Number(config.maximumCloseGapRatio) || 0.005);
    const minimumShadowBodyRatio = Math.max(0, Number(config.minimumLowerShadowBodyRatio) || 1.5);
    const minimumShadowRangeRatio = Math.max(0, Number(config.minimumLowerShadowRangeRatio) || 0.35);
    const defenseLevel = Number(risk?.stop);
    const recoveredIntraday = low <= movingAverage
        && lowerShadow > 0
        && lowerShadow >= body * minimumShadowBodyRatio
        && lowerShadowRangeRatio >= minimumShadowRangeRatio;
    const freshPullback = previousClose >= previousMovingAverage
        && close < movingAverage
        && closeGapRatio <= maximumGap
        && movingAverage >= previousMovingAverage;
    const defenseIntact = !Number.isFinite(defenseLevel) || close >= defenseLevel;
    if (!freshPullback || !recoveredIntraday || !defenseIntact) return empty;

    return {
        applied: true,
        status: 'observing',
        reason: `收盘仅小幅低于抬升中的MA${period}，下影线收回且结构防守位未破，保留一日${requiredPosition}%观察`,
        triggerDay: idx,
        triggerDate: item.date || '',
        triggerLow: low,
        triggerClose: close,
        sourcePosition: prevPos,
        targetPosition: requiredPosition,
        movingAveragePeriod: period,
        movingAverage,
        previousMovingAverage,
        closeGapRatio,
        lowerShadow,
        lowerShadowRangeRatio,
        defenseLevel: Number.isFinite(defenseLevel) ? defenseLevel : null
    };
}

function getWaveL10TrendHandoffContext(idx, full, meta, prevPos, strategy = STRATEGY) {
    const config = strategy?.l10TrendHandoff;
    const empty = { eligible: false, applied: false, reason: '' };
    if (!config || (config.stocksOnly && state.mode !== 'stock') || prevPos <= 0) return empty;
    const rawSignals = full?.[idx]?._signals || [];
    const invalidatedToday = [
        ...(meta?.invalidatedWindowSignals || []),
        ...(meta?.localBreakWindowSignals || [])
    ].filter(item => Number(item?.invalidationDay) === Number(idx));
    const invalidatedTodaySignals = new Set(invalidatedToday.map(item => item?.signal).filter(Boolean));
    const strongExitSet = getStrongExitSignals(strategy);
    const strongExitSignals = (meta?.exitSignals || []).filter(signal => strongExitSet.has(signal));
    if (strongExitSignals.length !== 1 || strongExitSignals[0] !== 'L10') return empty;
    if ((config.blockingSignals || []).some(signal => rawSignals.includes(signal))) return empty;
    const lookbackDays = Math.max(1, Number(config.movingAverageSlopeLookbackDays) || 5);
    const close = Number(full?.[idx]?.close);
    const ma20 = Number(state.indicators?.ma?.[20]?.[idx]);
    const ma60 = Number(state.indicators?.ma?.[60]?.[idx]);
    const previousMa20 = Number(state.indicators?.ma?.[20]?.[idx - lookbackDays]);
    const completeUptrend = Number.isFinite(close) && Number.isFinite(ma20) && Number.isFinite(ma60)
        && Number.isFinite(previousMa20) && close > ma20 && ma20 > ma60 && ma20 >= previousMa20;
    if (!completeUptrend) return empty;
    return {
        eligible: true,
        applied: false,
        reason: '完整多头持仓中的单独L10按预警处理，趋势接管后续持仓',
        sourcePosition: prevPos,
        targetPositionCap: Math.max(0, Number(config.warningPositionCap) || 30),
        triggerDay: idx,
        triggerDate: full?.[idx]?.date || '',
        triggerHigh: Number(full?.[idx]?.high),
        triggerClose: close
    };
}

function getWaveB6TrendAddContext(idx, full, meta, prevPos, exit, strategy = STRATEGY) {
    const config = strategy?.waveB6TrendAdd;
    const empty = { eligible: false, applied: false, reason: '' };
    const sourcePosition = Math.max(0, Number(config?.sourcePosition) || 30);
    if (!config || state.strategy !== '波段抄底型' || state.period !== 'daily') return empty;
    if (config.stocksOnly !== false && state.mode !== 'stock') return empty;
    if (prevPos !== sourcePosition || meta?.type !== '📈 趋势抱单') return empty;
    if (meta?.inCooldown || (meta?.exitSignals || []).length || (meta?.warningSignals || []).length) return empty;
    if (!exit || exit.level !== '无明确离场' || !(full?.[idx]?._signals || []).includes('B6')) return empty;

    const period = Math.max(1, Number(config.movingAveragePeriod) || 20);
    const slopeDays = Math.max(1, Number(config.slopeLookbackDays) || 1);
    const close = Number(full?.[idx]?.close);
    const movingAverage = Number(state.indicators?.ma?.[period]?.[idx]);
    const previousMovingAverage = Number(state.indicators?.ma?.[period]?.[idx - slopeDays]);
    if (!Number.isFinite(close) || !Number.isFinite(movingAverage) || !Number.isFinite(previousMovingAverage)) return empty;
    if (close < movingAverage || movingAverage < previousMovingAverage) return empty;

    return {
        eligible: true,
        applied: false,
        reason: `当日缩量回踩MA${period}后收回，且MA${period}未下行，允许波段试探仓进入趋势修复加仓`,
        sourcePosition,
        targetPosition: Math.max(sourcePosition, Number(config.targetPosition) || 50),
        triggerDay: idx,
        triggerDate: full?.[idx]?.date || '',
        movingAveragePeriod: period,
        movingAverage,
        previousMovingAverage,
        triggerLow: Number(full?.[idx]?.low),
        triggerClose: close
    };
}

function getWavePositionStageContext(idx, full, meta, prevPos, requestedPosition, exit, strategy = STRATEGY) {
    const config = strategy?.wavePositionStages;
    const requested = quantizePosition(requestedPosition);
    const empty = {
        inScope: false, limited: false, increaseApplied: false, stage: 'not-applicable',
        triggerSignal: '', triggerSignals: [], requestedPosition: requested, allowedPosition: requested, reason: ''
    };
    if (!config || state.strategy !== '波段抄底型' || state.period !== 'daily') return empty;
    if (config.stocksOnly !== false && state.mode !== 'stock') return empty;

    const entryCap = Math.max(0, Number(config.entryCap) || 30);
    const strongEntryCap = Math.max(entryCap, Number(config.strongEntryCap) || 50);
    const confirmationCap = Math.max(strongEntryCap, Number(config.confirmationCap) || 50);
    const trendCap = Math.max(confirmationCap, Number(config.trendCap) || 80);
    const previous = Math.max(0, Number(prevPos) || 0);
    const rawSignals = full?.[idx]?._signals || [];
    const invalidatedToday = [
        ...(meta?.invalidatedWindowSignals || []),
        ...(meta?.localBreakWindowSignals || [])
    ].filter(item => Number(item?.invalidationDay) === Number(idx));
    const invalidatedTodaySignals = new Set(invalidatedToday.map(item => item?.signal).filter(Boolean));
    const blocked = meta?.inCooldown
        || (meta?.exitSignals || []).length > 0
        || (meta?.warningSignals || []).length > 0
        || !exit
        || exit.level !== '无明确离场';
    const close = Number(full?.[idx]?.close);
    const trendPeriod = Math.max(1, Number(config.trendMovingAveragePeriod) || 20);
    const longPeriod = Math.max(1, Number(config.longMovingAveragePeriod) || 60);
    const slopeDays = Math.max(1, Number(config.trendSlopeLookbackDays) || 5);
    const trendMA = Number(state.indicators?.ma?.[trendPeriod]?.[idx]);
    const previousTrendMA = Number(state.indicators?.ma?.[trendPeriod]?.[idx - 1]);
    const slopeTrendMA = Number(state.indicators?.ma?.[trendPeriod]?.[idx - slopeDays]);
    const longMA = Number(state.indicators?.ma?.[longPeriod]?.[idx]);
    const scoreGroups = strategy?.scoreGroups || [];
    const freshBuySignals = rawSignals.filter(signal => strategy?.buySignals?.includes(signal) && !invalidatedTodaySignals.has(signal));
    const pullbackWait = config.breakoutPullbackWait || {};
    const pullbackSignals = new Set(pullbackWait.takeoverSignals || ['B6', 'B11']);
    const triggerSignalSet = new Set(pullbackWait.triggerSignals || ['B19']);
    const maxPullbackWait = Math.max(1, Number(strategy?.windowDays) || 10);
    let recentBreakout = null;
    if (pullbackWait && triggerSignalSet.size) {
        for (let day = idx - 1; day >= Math.max(0, idx - maxPullbackWait); day--) {
            const daySignals = full?.[day]?._signals || [];
            const trigger = [...triggerSignalSet].find(signal => daySignals.includes(signal));
            if (trigger) {
                recentBreakout = { trigger, day, date: full?.[day]?.date || '', age: idx - day };
                break;
            }
        }
    }
    const freshPullbackSignal = freshBuySignals.find(signal => pullbackSignals.has(signal)) || '';
    const groupedSignals = new Set(scoreGroups.flat());
    const groupedFreshCount = scoreGroups.filter(group => group.some(signal => freshBuySignals.includes(signal))).length;
    const ungroupedFreshCount = freshBuySignals.filter(signal => !groupedSignals.has(signal)).length;
    const freshGroupCount = groupedFreshCount + ungroupedFreshCount;

    if (previous <= 0 && requested > 0) {
        const structureSignal = (config.structureEntrySignals || []).find(signal => rawSignals.includes(signal) && !invalidatedTodaySignals.has(signal)) || '';
        if (structureSignal && triggerSignalSet.has(structureSignal)) {
            return {
                inScope: true, limited: requested > 0, increaseApplied: false, stage: 'breakout-wait',
                triggerSignal: structureSignal, triggerSignals: [structureSignal], freshGroupCount,
                previousPosition: previous, requestedPosition: requested, allowedPosition: 0,
                waitingForPullback: true, breakoutDate: full?.[idx]?.date || '',
                reason: `今日${structureSignal}突破确认，但阳线追价不建仓；等待${[...pullbackSignals].join('/')}首次回踩确认后再试探`
            };
        }
        if (recentBreakout && !freshPullbackSignal) {
            return {
                inScope: true, limited: requested > 0, increaseApplied: false, stage: 'breakout-wait',
                triggerSignal: recentBreakout.trigger, triggerSignals: [], freshGroupCount,
                previousPosition: previous, requestedPosition: requested, allowedPosition: 0,
                waitingForPullback: true, breakoutDate: recentBreakout.date, breakoutAge: recentBreakout.age,
                reason: `${recentBreakout.date}已完成${recentBreakout.trigger}突破，当前等待首次${[...pullbackSignals].join('/')}回踩确认，不追价建仓`
            };
        }
        if (recentBreakout && freshPullbackSignal) {
            return {
                inScope: true, limited: requested > entryCap, increaseApplied: requested > 0, stage: 'entry',
                triggerSignal: freshPullbackSignal, triggerSignals: [freshPullbackSignal], freshGroupCount,
                previousPosition: previous, requestedPosition: requested, allowedPosition: Math.min(requested, entryCap),
                waitingForPullback: false, breakoutDate: recentBreakout.date, breakoutAge: recentBreakout.age,
                reason: `${recentBreakout.date}突破后当日新${freshPullbackSignal}回踩确认，允许${entryCap}%低吸试探`
            };
        }
        const hasStrongReversal = (config.strongReversalSignals || []).some(signal => rawSignals.includes(signal) && !invalidatedTodaySignals.has(signal));
        const strongReversalConfirmed = hasStrongReversal
            && freshGroupCount >= Math.max(2, Number(config.minimumStrongReversalGroups) || 2);
        const strongEntry = !blocked && (!!structureSignal || strongReversalConfirmed);
        const cap = strongEntry ? strongEntryCap : entryCap;
        const allowedPosition = strongEntry ? strongEntryCap : Math.min(requested, cap);
        const entryTriggerSignals = structureSignal ? [structureSignal] : (strongEntry ? freshBuySignals : []);
        return {
            inScope: true, limited: allowedPosition < requested, increaseApplied: allowedPosition > 0,
            stage: strongEntry ? 'confirmation' : 'entry', triggerSignal: structureSignal || (strongEntry ? 'multi-reversal' : ''),
            triggerSignals: entryTriggerSignals, freshGroupCount, previousPosition: previous, requestedPosition: requested, allowedPosition,
            reason: strongEntry
                ? `当日${structureSignal || '底背离与多组反转信号'}完成底部确认，首次建仓允许提高至${strongEntryCap}%确认仓`
                : `当前仅完成早期修复，首次建仓按${entryCap}%试探仓处理`
        };
    }

    if (previous === entryCap) {
        const freshSignal = (config.confirmationSignals || []).find(signal => rawSignals.includes(signal) && !invalidatedTodaySignals.has(signal)) || '';
        const b6Confirmed = freshSignal === 'B6'
            && [close, trendMA, previousTrendMA].every(Number.isFinite)
            && close >= trendMA && trendMA >= previousTrendMA;
        const b11Confirmed = freshSignal === 'B11'
            && [close, trendMA, previousTrendMA].every(Number.isFinite)
            && close > trendMA && trendMA >= previousTrendMA;
        const b19Confirmed = freshSignal === 'B19'
            && [close, trendMA].every(Number.isFinite) && close > trendMA;
        const confirmed = !blocked && (b6Confirmed || b11Confirmed || b19Confirmed);
        const allowedPosition = confirmed ? confirmationCap : Math.min(requested, entryCap);
        return {
            inScope: true, limited: allowedPosition < requested, increaseApplied: allowedPosition > previous,
            stage: confirmed ? 'confirmation' : 'entry', triggerSignal: confirmed ? freshSignal : '',
            triggerSignals: confirmed ? [freshSignal] : [], freshGroupCount, previousPosition: previous, requestedPosition: requested, allowedPosition,
            reason: confirmed
                ? `当日新${freshSignal}完成反转确认，允许${entryCap}%试探仓提高至${confirmationCap}%确认仓`
                : `尚无当日新B6/B11/B19确认事件，维持${entryCap}%试探仓`
        };
    }

    if (previous === confirmationCap) {
        const freshSignal = (config.trendContinuationSignals || []).find(signal => rawSignals.includes(signal) && !invalidatedTodaySignals.has(signal)) || '';
        const completeUptrend = [close, trendMA, longMA, slopeTrendMA].every(Number.isFinite)
            && close > trendMA && trendMA > longMA && trendMA >= slopeTrendMA;
        const scoreReady = Number(meta?.windowScore) >= Number(strategy?.buyThreshold);
        const confirmed = !blocked && !!freshSignal && completeUptrend && scoreReady;
        const allowedPosition = confirmed ? trendCap : Math.min(requested, confirmationCap);
        return {
            inScope: true, limited: allowedPosition < requested, increaseApplied: allowedPosition > previous,
            stage: confirmed ? 'trend' : 'confirmation', triggerSignal: confirmed ? freshSignal : '',
            triggerSignals: confirmed ? [freshSignal] : [], freshGroupCount, previousPosition: previous, requestedPosition: requested, allowedPosition,
            reason: confirmed
                ? `完整多头中当日新${freshSignal}确认趋势延续，允许${confirmationCap}%确认仓提高至${trendCap}%趋势仓`
                : `尚无完整多头中的当日放量突破事件，维持${confirmationCap}%确认仓`
        };
    }

    return {
        ...empty, inScope: true, stage: previous >= trendCap ? 'trend' : (previous >= confirmationCap ? 'confirmation' : 'entry')
    };
}

function computeBaseDecisionForIndex(idx, full, prevPos) {
    const rawMeta = getSignalMeta(idx, full, state.indicators), market = getMarketContext(full[idx].date);
    const wavePeak = getWavePeakContext(idx, full, state.indicators, rawMeta);
    const risk = getRiskContext(idx, full, state.indicators), rawExit = getExitSeverity(rawMeta, idx, full, state.indicators);
    const trendRegime = getTrendRegimeContext(idx, full, state.indicators);
    const waveContext = getWaveContext(idx, full, state.indicators, STRATEGY);
    let waveL10TrendHandoff = getWaveL10TrendHandoffContext(idx, full, rawMeta, prevPos, STRATEGY);
    let meta = rawMeta;
    if (waveL10TrendHandoff.eligible) {
        const originalSignals = full[idx]._signals || [];
        full[idx]._signals = originalSignals.filter(signal => signal !== 'L10');
        try {
            meta = getSignalMeta(idx, full, state.indicators);
        } finally {
            full[idx]._signals = originalSignals;
        }
    }
    const waveBottomL3Observation = state.strategy === '波段抄底型'
        && state.mode === 'stock'
        && state.period === 'daily'
        && prevPos > 0
        && waveContext?.inScope
        && ['down', 'range', 'transition'].includes(waveContext.regime)
        && isWaveStandaloneL3Observation(rawMeta, STRATEGY);
    const waveStandaloneL3Observation = state.strategy === '波段抄底型'
        && state.period === 'daily'
        && prevPos > 0
        && (isWaveStandaloneL3Observation(rawMeta, STRATEGY) && (!waveContext?.inScope || waveContext.regime === 'up' || waveBottomL3Observation));
    let exit = waveL10TrendHandoff.eligible
        ? { level: '减仓观察', detail: '完整多头结构中单独出现MACD顶背离，先降仓预警，不单信号归零' }
        : (waveStandaloneL3Observation
            ? { level: '减仓观察', detail: '单独MACD死叉只表示动能转弱，先降至或维持30%观察结构确认' }
            : rawExit);
    const b11StructureDefense = getB11StructureDefenseContext(meta, full, STRATEGY);
    let waveB6TrendAdd = getWaveB6TrendAddContext(idx, full, meta, prevPos, exit, STRATEGY);
    let base = getBasePosition(idx, full, state.indicators, meta);
    const isWaveStockTrendHold = state.strategy === '波段抄底型'
        && state.mode === 'stock'
        && state.period === 'daily'
        && meta?.type === '📈 趋势抱单'
        && prevPos > 0;
    if (isWaveStockTrendHold) base = prevPos;
    if (waveB6TrendAdd.eligible) base = Math.max(base, waveB6TrendAdd.targetPosition);
    const waveExpiryHandoff = getWaveExpiryHandoffContext(idx, full, meta, prevPos, base, exit, risk, STRATEGY);
    const waveMA20PullbackObservation = getWaveMA20PullbackObservationContext(idx, full, meta, prevPos, base, exit, risk, STRATEGY);
    if (waveStandaloneL3Observation) base = prevPos;
    if (waveMA20PullbackObservation.overrideCriticalExit) {
        exit = {
            level: '减仓观察',
            detail: '完整多头中的单独MACD死叉先作MA20防守观察'
        };
    }
    const softSignalGrace = getSoftSignalGraceContext(meta, prevPos, base, exit, idx, STRATEGY);
    const localStructureDefense = getLocalStructureDefenseContext(meta, b11StructureDefense, prevPos, exit, STRATEGY);
    if (waveExpiryHandoff.forceExit || waveMA20PullbackObservation.forceExit) base = 0;
    else if (waveExpiryHandoff.applied || waveExpiryHandoff.forceHold) base = prevPos;
    if (waveMA20PullbackObservation.applied || waveMA20PullbackObservation.forceHold) base = prevPos;
    if (softSignalGrace.applied) base = prevPos;
    if (localStructureDefense.applied) base = prevPos;
    if (waveMA20PullbackObservation.forceExit) base = 0;
    const wavePositionStage = getWavePositionStageContext(idx, full, meta, prevPos, base, exit, STRATEGY);
    if (wavePositionStage.inScope) base = wavePositionStage.allowedPosition;

    // 仓位只由信号、离场、预警和结构治理决定；风险指标不参与交易档位计算。
    let rawPosition = base, position = quantizePosition(rawPosition);
    let isCriticalExit = (exit.level === '清仓防守' || exit.level === '强离场'
        || (meta.type || '').includes('规避') || (meta.type || '').includes('破位'))
        && !waveL10TrendHandoff.eligible
        && !waveMA20PullbackObservation.overrideCriticalExit
        && !waveStandaloneL3Observation;

    if (isCriticalExit || meta.inCooldown) position = 0;
    else if (exit.level === '减仓观察' || exit.level === '延续防守') position = quantizePosition(Math.min(position, 30));

    if (meta.warningSignals?.length) position = quantizePosition(Math.min(position, 30));
    if (waveL10TrendHandoff.eligible) position = quantizePosition(Math.min(position, waveL10TrendHandoff.targetPositionCap));
    const positionCap = getPositionCap(meta, prevPos, position, idx, full, state.indicators, wavePositionStage);
    if (positionCap) position = quantizePosition(Math.min(position, positionCap.limit));

    if (position > prevPos && Math.abs(position - prevPos) <= 10) position = prevPos;
    if (prevPos === 0 && position > 0 && meta.type === '📈 趋势抱单') position = 0;
    const targetStrength = getTargetStrengthTier(meta, idx, full, state.indicators, risk, exit);
    const marketGate = applyMarketRiskGate(market, prevPos, position, targetStrength);
    position = marketGate.position;
    let waveRejectionProtection = isCriticalExit
        ? { active: false, status: 'superseded', targetPosition: position }
        : getWaveRejectionProtectionContext(idx, full, meta, prevPos, position, STRATEGY, {
            risk,
            exit,
            market,
            trendRegime,
            waveContext,
            targetStrength,
            positionCap,
            isCriticalExit,
        });
    if (Number.isFinite(Number(waveRejectionProtection.targetPosition))) {
        const protectedTarget = Number(waveRejectionProtection.targetPosition);
        position = waveRejectionProtection.allowRecoveryIncrease && protectedTarget > position
            ? protectedTarget
            : Math.min(position, protectedTarget);
    }
    if (waveB6TrendAdd.eligible) {
        waveB6TrendAdd = {
            ...waveB6TrendAdd,
            applied: position > prevPos,
            finalPosition: position,
            limited: position <= prevPos
        };
    }
    if (waveL10TrendHandoff.eligible && position > 0) {
        waveL10TrendHandoff = { ...waveL10TrendHandoff, applied: true, targetPosition: position };
    } else if (waveL10TrendHandoff.eligible) {
        waveL10TrendHandoff = { ...waveL10TrendHandoff, eligible: false, applied: false, targetPosition: 0 };
        meta = rawMeta;
        exit = rawExit;
        isCriticalExit = rawExit.level === '清仓防守' || rawExit.level === '强离场'
            || (rawMeta.type || '').includes('规避') || (rawMeta.type || '').includes('破位');
        waveRejectionProtection = { active: false, status: 'superseded', targetPosition: position };
    }
    const waveDriver = waveRejectionProtection.status === 'entry_blocked'
        ? '建仓日触及下降均线压力并长上影受阻，取消本次试探建仓'
        : (waveRejectionProtection.status === 'ma20_hold'
        ? '首次建仓后冲击压力回落，但收盘仍站在MA20上方，仅保留30%观察'
        : (waveRejectionProtection.status === 'triggered'
        ? (waveRejectionProtection.eventType === 'fresh_entry_hard_break'
            ? '首次建仓后两日内跌破买入日最低价，当日归零'
            : (waveRejectionProtection.eventType === 'fresh_entry_downside_failure'
                ? '首次建仓后两日内下跌失败，当日提前防守'
                : (waveRejectionProtection.eventType === 'fresh_entry_failure'
                    ? '首次建仓后冲击压力失败，当日提前防守'
                    : (waveRejectionProtection.eventType === 'signal_hard_invalidation'
                        ? '买入信号硬失效导致离场，进入局部重入保护'
                        : '已有浮盈遇放量冲高回落，当日分档保护利润'))))
        : (waveRejectionProtection.status === 'locked'
            ? '冲高回落风险尚未解除，局部阻止旧积分立即回补'
            : (['released', 'recovery_pending'].includes(waveRejectionProtection.status)
                ? '冲高回落风险已局部解除'
                : (['recovery_started', 'recovery_hold'].includes(waveRejectionProtection.status) ? '冲高回落风险解除后分步恢复' : '')))));
    const basePositionDriver = getPositionDriverText(meta, market, risk, exit, base, position, prevPos, positionCap, marketGate);
    const handoffDriver = waveL10TrendHandoff.applied ? waveL10TrendHandoff.reason : '';
    const expiryHandoffDriver = waveExpiryHandoff.applied ? waveExpiryHandoff.reason : '';
    const ma20PullbackDriver = waveMA20PullbackObservation.applied ? waveMA20PullbackObservation.reason : '';
    const b6TrendAddDriver = waveB6TrendAdd.applied ? waveB6TrendAdd.reason : '';
    const wavePositionStageDriver = wavePositionStage.limited ? wavePositionStage.reason : '';
    const wavePeakDriver = wavePeak.confirmed ? wavePeak.reason : '';
    const extraDrivers = [waveDriver, handoffDriver, expiryHandoffDriver, ma20PullbackDriver, b6TrendAddDriver, wavePositionStageDriver, wavePeakDriver].filter(Boolean).join('；');
    const positionDriver = extraDrivers ? `${basePositionDriver}${basePositionDriver ? '；' : ''}${extraDrivers}` : basePositionDriver;

    let simpleAction = '持币观望', simpleColorClass = 'text-dim', bsMark = null;
    if (position === 0) {
        if (prevPos > 0) { simpleAction = isCriticalExit ? '清仓离场' : '执行离场'; simpleColorClass = 'text-bear'; bsMark = 'S'; } 
        else { simpleAction = isCriticalExit ? '规避风险' : '持币观望'; simpleColorClass = isCriticalExit ? 'text-bear' : 'text-dim'; }
    } else if (position < prevPos) { simpleAction = '防守减仓'; simpleColorClass = 'text-warn'; } 
    else if (position > prevPos) { 
        if (prevPos === 0) { simpleAction = position <= 30 ? '轻仓建仓' : '积极建仓'; bsMark = 'B'; } 
        else { simpleAction = position <= 30 ? '缓慢加仓' : '顺势加仓'; }
        simpleColorClass = position <= 30 ? 'text-info' : 'text-bull';
    } else { 
        if (position <= 30) { simpleAction = (exit.level === '减仓观察' || exit.level === '延续防守' || meta.warningSignals?.length) ? '谨慎持有' : '轻仓持有'; simpleColorClass = simpleAction === '谨慎持有' ? 'text-warn' : 'text-info'; } 
        else { simpleAction = (meta.type === '📈 趋势抱单' && meta.buySignals.length === 0) ? '顺势抱单' : '积极持有'; simpleColorClass = 'text-bull'; }
    }
    const previousWindowScore = Number(full?.[idx - 1]?._decision?.windowScore);
    const invalidatedTodayScore = (meta.invalidatedWindowSignals || [])
        .filter(item => Number(item?.invalidationDay) === Number(idx))
        .reduce((sum, item) => sum + (Number(item?.score) || 0), 0);
    const decision = {
        basePosition: base,
        position,
        prevAdv: prevPos,
        trendRegime,
        waveContext,
        market,
        marketGate,
        targetStrength,
        risk,
        exit,
        positionCap,
        positionDriver,
        signalReady: meta.windowScore >= STRATEGY.buyThreshold,
        windowScore: meta.windowScore,
        previousWindowScore: Number.isFinite(previousWindowScore) ? previousWindowScore : meta.windowScore + invalidatedTodayScore,
        softSignalGrace,
        localStructureDefense,
        b11StructureDefense,
        wavePositionStage,
        wavePeak,
        waveB6TrendAdd,
        waveMA20PullbackObservation,
        waveExpiryHandoff,
        waveL10TrendHandoff,
        waveStandaloneL3Observation,
        waveRejectionProtection,
        previousSoftSignalGrace: !!full?.[idx - 1]?._decision?.softSignalGrace?.applied,
        simpleAction,
        simpleColorClass,
        bsMark
    };
    const bQuality = getWaveBQualityMetadata(meta, decision);
    return bQuality ? { ...decision, ...bQuality } : decision;
}

function getWaveExpiryB11TakeoverAddContext(idx, full, meta, prevPos, decision, strategy = STRATEGY) {
    const config = strategy?.waveExpiryB11TakeoverAdd;
    const empty = { eligible: false, applied: false, active: false, status: 'none', reason: '' };
    const sourcePosition = Math.max(0, Number(config?.sourcePosition) || 30);
    if (!config || state.strategy !== '波段抄底型' || state.period !== 'daily') return empty;
    if (config.stocksOnly !== false && state.mode !== 'stock') return empty;
    if (prevPos !== sourcePosition) return empty;

    const previousHandoff = full?.[idx - 1]?._decision?.waveExpiryHandoff;
    const invalidatedToday = [
        ...(meta?.invalidatedWindowSignals || []),
        ...(meta?.localBreakWindowSignals || [])
    ].some(item => Number(item?.invalidationDay) === Number(idx));
    const triggerSignal = config.triggerSignal || 'B11';
    const rawSignals = full?.[idx]?._signals || [];
    const shortPeriod = Math.max(1, Number(config.shortMovingAveragePeriod) || 5);
    const trendPeriod = Math.max(1, Number(config.trendMovingAveragePeriod) || 20);
    const slopeDays = Math.max(1, Number(config.trendSlopeLookbackDays) || 1);
    const close = Number(full?.[idx]?.close);
    const shortMA = Number(state.indicators?.ma?.[shortPeriod]?.[idx]);
    const trendMA = Number(state.indicators?.ma?.[trendPeriod]?.[idx]);
    const previousTrendMA = Number(state.indicators?.ma?.[trendPeriod]?.[idx - slopeDays]);
    const eligible = previousHandoff?.applied
        && previousHandoff.observationMode === 'defensive'
        && meta?.type === '📈 趋势抱单'
        && !meta?.inCooldown
        && !(meta?.exitSignals || []).length
        && !(meta?.warningSignals || []).length
        && decision?.exit?.level === '无明确离场'
        && !invalidatedToday
        && rawSignals.includes(triggerSignal)
        && [close, shortMA, trendMA, previousTrendMA].every(Number.isFinite)
        && close > shortMA
        && close > trendMA
        && trendMA >= previousTrendMA;
    if (!eligible) return empty;

    return {
        eligible: true,
        applied: false,
        active: false,
        status: 'eligible',
        reason: `到期防守观察后新触发${triggerSignal}，并重新站上MA${shortPeriod}/MA${trendPeriod}，允许30%基础仓增加20%波段仓`,
        sourcePosition,
        targetPosition: Math.max(sourcePosition, Number(config.targetPosition) || 50),
        basePosition: sourcePosition,
        extraPosition: Math.max(0, (Number(config.targetPosition) || 50) - sourcePosition),
        triggerSignal,
        triggerDay: idx,
        triggerDate: full?.[idx]?.date || '',
        shortMovingAveragePeriod: shortPeriod,
        trendMovingAveragePeriod: trendPeriod,
        shortMovingAverage: shortMA,
        trendMovingAverage: trendMA,
        previousTrendMovingAverage: previousTrendMA
    };
}

function computeWaveCandidateDecisionForIndex(idx, full, prevPos) {
    const actualDecision = computeBaseDecisionForIndex(idx, full, prevPos);
    const config = STRATEGY?.waveExpiryB11TakeoverAdd;
    const sourcePosition = Math.max(0, Number(config?.sourcePosition) || 30);
    const targetPosition = Math.max(sourcePosition, Number(config?.targetPosition) || 50);
    const previousLayer = full?.[idx - 1]?._decision?.waveExpiryB11TakeoverAdd;
    const inScope = !!config
        && state.strategy === '波段抄底型'
        && state.period === 'daily'
        && (config.stocksOnly === false || state.mode === 'stock');
    const layerActive = inScope && previousLayer?.active && prevPos > 0;

    if (layerActive) {
        const basePrevPosition = Number.isFinite(Number(previousLayer.basePosition))
            ? Number(previousLayer.basePosition)
            : sourcePosition;
        const baseDecision = computeBaseDecisionForIndex(idx, full, basePrevPosition);
        const baseLayerPosition = Number(baseDecision.position) || 0;
        const actualPosition = Number(actualDecision.position) || 0;
        const finalPosition = baseLayerPosition === sourcePosition
            ? Math.min(targetPosition, Math.max(baseLayerPosition, actualPosition))
            : baseLayerPosition;
        const fallbackToBase = finalPosition !== actualPosition
            || (baseLayerPosition !== sourcePosition && baseLayerPosition >= actualPosition);
        const overlayReleased = finalPosition <= baseLayerPosition || baseLayerPosition !== sourcePosition;
        const status = !overlayReleased
            ? 'holding'
            : (finalPosition <= 0 ? 'closed' : (baseLayerPosition > sourcePosition ? 'taken_over' : 'released'));
        const sourceDecision = fallbackToBase ? baseDecision : actualDecision;
        let simpleAction = sourceDecision.simpleAction;
        let simpleColorClass = sourceDecision.simpleColorClass;
        if (finalPosition < prevPos && finalPosition > 0) {
            simpleAction = '防守减仓';
            simpleColorClass = 'text-warn';
        } else if (finalPosition === prevPos && finalPosition > sourcePosition) {
            simpleAction = '积极持有';
            simpleColorClass = 'text-bull';
        }
        const layerReason = status === 'holding'
            ? `30%基础仓与${targetPosition - sourcePosition}%波段仓继续分层持有`
            : (status === 'released'
                ? `额外${targetPosition - sourcePosition}%波段仓先减，原30%基础仓继续按既有规则处理`
                : (status === 'taken_over' ? '原策略已形成更高基础仓位，结束波段分层' : '30%基础仓已失效，波段分层同步结束'));
        return {
            ...sourceDecision,
            position: finalPosition,
            prevAdv: prevPos,
            positionDriver: [sourceDecision.positionDriver, layerReason].filter(Boolean).join('；'),
            simpleAction,
            simpleColorClass,
            bsMark: baseDecision.bsMark,
            waveExpiryB11TakeoverAdd: {
                ...previousLayer,
                eligible: false,
                applied: false,
                active: status === 'holding',
                status,
                reason: layerReason,
                basePosition: baseLayerPosition,
                actualPosition,
                finalPosition,
                releaseDay: overlayReleased ? idx : null,
                releaseDate: overlayReleased ? (full?.[idx]?.date || '') : ''
            }
        };
    }

    const meta = getSignalMeta(idx, full, state.indicators);
    const addContext = getWaveExpiryB11TakeoverAddContext(idx, full, meta, prevPos, actualDecision, STRATEGY);
    if (!addContext.eligible) return { ...actualDecision, waveExpiryB11TakeoverAdd: addContext };

    let requestedPosition = addContext.targetPosition;
    const positionCap = getPositionCap(meta, prevPos, requestedPosition, idx, full, state.indicators);
    if (positionCap) requestedPosition = Math.min(requestedPosition, positionCap.limit);

    const productionMarketGate = applyMarketRiskGate(
        actualDecision.market,
        prevPos,
        requestedPosition,
        actualDecision.targetStrength
    );
    const marketException = false;
    const marketGate = productionMarketGate;
    requestedPosition = marketGate.position;

    const rejection = getWaveRejectionProtectionContext(idx, full, meta, prevPos, requestedPosition, STRATEGY, {
        trendRegime: actualDecision.trendRegime,
        waveContext: actualDecision.waveContext
    });
    if (Number.isFinite(Number(rejection.targetPosition))) {
        requestedPosition = Math.min(requestedPosition, Number(rejection.targetPosition));
    }
    const applied = requestedPosition > prevPos;
    const finalContext = {
        ...addContext,
        applied,
        active: applied,
        limited: !applied,
        status: applied ? 'holding' : 'limited',
        marketException,
        finalPosition: applied ? requestedPosition : actualDecision.position,
        productionMarketGateType: productionMarketGate.type,
        productionMarketGateCap: productionMarketGate.cap ?? null
    };
    if (!applied) return { ...actualDecision, waveExpiryB11TakeoverAdd: finalContext };

    return {
        ...actualDecision,
        position: requestedPosition,
        marketGate,
        positionCap,
        positionDriver: [actualDecision.positionDriver, addContext.reason].filter(Boolean).join('；'),
        simpleAction: '顺势加仓',
        simpleColorClass: 'text-bull',
        bsMark: actualDecision.bsMark,
        waveExpiryB11TakeoverAdd: finalContext
    };
}

function getWaveFreshGroupKeys(signals, strategy = STRATEGY) {
    return [...new Set((signals || [])
        .filter(signal => strategy?.buySignals?.includes(signal))
        .map(signal => getScoreGroupKey(strategy, signal)))];
}

function getWaveEntryDefenseContext(idx, full, waveContext, rawSignals, strategy = STRATEGY, options = {}) {
    const signalLow = Number(full?.[idx]?.low);
    const close = Number(full?.[idx]?.close);
    const pivot = findConfirmedPivotLow(full, idx, 120, 2);
    let localDefense = signalLow;
    const pivotValue = Number(pivot?.value);
    let hardDefense = Number.isFinite(pivotValue) && pivotValue < close ? pivotValue : signalLow;
    let supportSource = hardDefense === pivotValue ? 'confirmed-pivot' : 'signal-low';
    let recentB19Day = null;
    for (let day = idx; day >= Math.max(0, idx - Math.max(1, Number(strategy?.windowDays) || 10)); day--) {
        if ((full?.[day]?._signals || []).includes('B19')) { recentB19Day = day; break; }
    }
    if (rawSignals.includes('B11')) {
        const defense = getB11StructureDefense(idx, full, strategy);
        localDefense = Number(defense?.localLevel) || signalLow;
        hardDefense = Number(defense?.structureLevel) || signalLow;
        supportSource = defense?.structureLevel ? 'b11-structure' : 'b11-signal-low';
    } else if ((rawSignals.includes('B20') || Number.isInteger(recentB19Day)) && Number.isFinite(Number(waveContext?.boxSupport))) {
        hardDefense = Number(waveContext.boxSupport);
        supportSource = 'box-support';
    } else if (rawSignals.includes('B16')) {
        const weeks = typeof convertDailyToWeekly === 'function' ? getCalendarWeeksUntil(full, idx) : [];
        const weeklyPivot = weeks.length ? findConfirmedPivotLow(weeks, weeks.length - 1, 52, 1) : null;
        if (Number.isFinite(Number(weeklyPivot?.value)) && Number(weeklyPivot.value) > 0 && Number(weeklyPivot.value) < close) {
            hardDefense = Number(weeklyPivot.value);
            supportSource = 'weekly-support';
        }
    }
    if (options.freshEventRecovery && Number.isFinite(signalLow) && signalLow > 0) {
        localDefense = signalLow;
        hardDefense = signalLow;
        supportSource = 'event-recovery-signal-low';
    }
    const atr14 = Number(waveContext?.box?.atr14) || getWaveAtr14At(idx, full);
    // 首次低吸的距离检查使用当次信号局部失效位，避免把远处历史结构位误当作建仓日的唯一风险锚。
    // hardDefense 不变，仍由生命周期持有并负责后续结构硬失效；这里仅改变“能否建立30%试探仓”的检查。
    const useLocalDefenseForDistance = strategy?.waveRegimePolicy?.entry?.useLocalDefenseForDistance !== false;
    const hasUsableLocalDefense = Number.isFinite(localDefense) && Number.isFinite(close) && close > 0 && localDefense < close;
    const entryDefense = useLocalDefenseForDistance && hasUsableLocalDefense ? localDefense : hardDefense;
    const entryDefenseSource = useLocalDefenseForDistance && hasUsableLocalDefense ? 'local-signal' : supportSource;
    const distanceRatio = Number.isFinite(entryDefense) && close > 0 ? (close - entryDefense) / close : Infinity;
    const maxRatio = Math.min(
        Number(strategy?.waveRegimePolicy?.entry?.minimumDefenseDistanceRatio) || 0.06,
        Number.isFinite(atr14) && close > 0
            ? (Number(strategy?.waveRegimePolicy?.entry?.maximumDefenseAtr) || 2) * atr14 / close
            : 0.06
    );
    return {
        localDefense, hardDefense, entryDefense, supportSource, entryDefenseSource, distanceRatio, maximumDistanceRatio: maxRatio,
        acceptable: distanceRatio >= 0 && distanceRatio <= maxRatio
    };
}

function getWaveRegimeQualification(idx, full, meta, waveContext, rawSignals, strategy = STRATEGY) {
    const policy = strategy?.waveRegimePolicy || {};
    const item = full?.[idx] || {};
    const close = Number(item.close), low = Number(item.low), open = Number(item.open);
    const atr14 = Number(waveContext?.box?.atr14) || getWaveAtr14At(idx, full) || 0;
    const pivot = findConfirmedPivotLow(full, idx, 120, 2);
    const weeks = typeof convertDailyToWeekly === 'function' ? getCalendarWeeksUntil(full, idx) : [];
    const weeklyPivot = weeks.length ? findConfirmedPivotLow(weeks, weeks.length - 1, 52, 1) : null;
    const weeklySupport = Number(weeklyPivot?.value);
    const probeConfig = policy?.multiTimeframeBottomProbe || {};
    const weeklyDoubleBottom = getWeeklyDoubleBottomContext(full, idx, weeks, probeConfig.weeklyRepair || {});
    const weeklyBottom = Number(weeklyDoubleBottom?.details?.secondBottomValue);
    const supports = [Number(waveContext?.boxSupport), Number(pivot?.value), weeklySupport, weeklyBottom]
        .filter(value => Number.isFinite(value) && value > 0 && value <= close * 1.03);
    const support = supports.length ? Math.max(...supports) : null;
    const nearSupport = Number.isFinite(support)
        && low <= support + Math.max(atr14 * 0.75, support * 0.01)
        && close >= support;
    const scoreReady = Number(meta?.windowScore) >= Math.max(1, Number(policy?.entry?.minimumScore) || 4);
    const probeScoreReady = Number(meta?.windowScore) >= 3;
    const allowedProbeRegimes = Array.isArray(probeConfig.allowedRegimes) && probeConfig.allowedRegimes.length
        ? probeConfig.allowedRegimes
        : ['down', 'range', 'transition'];
    const multiTimeframeProbeQualified = probeConfig.stocksOnly !== false
        && state.mode === 'stock'
        && state.period === 'daily'
        && rawSignals.includes(probeConfig.dailySignal || 'B20')
        && weeklyDoubleBottom.candidate
        && allowedProbeRegimes.includes(waveContext?.regime)
        && nearSupport
        && probeScoreReady
        && !meta?.inCooldown
        && !(meta?.exitSignals || []).length
        && !(meta?.warningSignals || []).length;
    const freshGroups = getWaveFreshGroupKeys(rawSignals, strategy);
    const downSignal = rawSignals.some(signal => (policy?.down?.entrySignals || []).includes(signal));
    const scoredSignals = (meta?.windowScoreSignals || []).map(item => item?.signal).filter(Boolean);
    const downRepairSignals = new Set(policy?.down?.repairSignals || ['B7','B8','B9','B16','B17','B20']);
    const hasDownRepairSignal = rawSignals.some(signal => downRepairSignals.has(signal))
        || scoredSignals.some(signal => downRepairSignals.has(signal));
    const downRepairGroupsReady = freshGroups.length >= Math.max(2, Number(policy?.down?.minimumRepairGroups) || 2);
    // 下跌/过渡首次建仓资格必须由当日实证支撑：贴近支撑、当日新下跌入场信号、或当日新增≥2个计分组。
    // 仅凭窗口内历史记分信号（scoredDownSignal）不再单独放行——那批建仓当日无新证据，两日破位率最高。
    const downQualified = scoreReady
        && hasDownRepairSignal
        && (nearSupport || downSignal || downRepairGroupsReady);
    const boxSupport = Number(waveContext?.boxSupport);
    const edgeTolerance = atr14 * Math.max(0.1, Number(policy?.box?.edgeToleranceAtr) || 0.75);
    const rangeSignal = rawSignals.some(signal => (policy?.range?.entrySignals || []).includes(signal));
    const rangeQualified = waveContext?.box?.valid && Number.isFinite(boxSupport)
        && low <= boxSupport + edgeTolerance && close >= boxSupport && close >= open
        && scoreReady && rangeSignal;
    const ma20 = Number(state.indicators?.ma?.[20]?.[idx]);
    const previousMa20 = Number(state.indicators?.ma?.[20]?.[idx - 1]);
    const upSignal = rawSignals.some(signal => (policy?.up?.entrySignals || []).includes(signal));
    const upQualified = upSignal && [close, low, ma20, previousMa20].every(Number.isFinite)
        && ma20 >= previousMa20
        && low <= ma20 + Math.max(atr14 * 0.5, ma20 * 0.005)
        && close >= ma20;
    return {
        support,
        nearSupport,
        scoreReady,
        freshGroups,
        downQualified,
        downRepairQualified: downQualified && !nearSupport,
        rangeQualified,
        upQualified,
        weeklyDoubleBottom,
        multiTimeframeProbeQualified
    };
}

function getWaveGovernedAction(position, prevPos, candidate) {
    if (position <= 0) {
        if (prevPos > 0) return {
            simpleAction: ['清仓防守','强离场'].includes(candidate?.exit?.level) ? '清仓离场' : '执行离场',
            simpleColorClass: 'text-bear', bsMark: 'S'
        };
        return { simpleAction: candidate?.simpleAction === '规避风险' ? '规避风险' : '持币观望', simpleColorClass: candidate?.simpleAction === '规避风险' ? 'text-bear' : 'text-dim', bsMark: null };
    }
    if (position < prevPos) return { simpleAction: '防守减仓', simpleColorClass: 'text-warn', bsMark: null };
    if (position > prevPos) {
        if (prevPos <= 0) return { simpleAction: position <= 30 ? '轻仓建仓' : '积极建仓', simpleColorClass: position <= 30 ? 'text-info' : 'text-bull', bsMark: 'B' };
        return { simpleAction: position <= 30 ? '缓慢加仓' : '顺势加仓', simpleColorClass: position <= 30 ? 'text-info' : 'text-bull', bsMark: null };
    }
    return position <= 30
        ? { simpleAction: candidate?.simpleAction === '谨慎持有' ? '谨慎持有' : '轻仓持有', simpleColorClass: candidate?.simpleAction === '谨慎持有' ? 'text-warn' : 'text-info', bsMark: null }
        : { simpleAction: candidate?.simpleAction === '顺势抱单' ? '顺势抱单' : '积极持有', simpleColorClass: 'text-bull', bsMark: null };
}

function applyWaveRegimeGovernance(idx, full, prevPos, candidate, strategy = STRATEGY) {
    const waveContext = candidate?.waveContext;
    if (!waveContext?.inScope) return candidate;
    const policy = strategy.waveRegimePolicy;
    const meta = getSignalMeta(idx, full, state.indicators);
    const rawSignals = full?.[idx]?._signals || [];
    const previousLifecycle = full?.[idx - 1]?._decision?.waveContext?.lifecycle;
    const item = full?.[idx] || {};
    const close = Number(item.close), low = Number(item.low), high = Number(item.high), open = Number(item.open);
    const ma20 = Number(state.indicators?.ma?.[20]?.[idx]);
    const previousHigh = Number(full?.[idx - 1]?.high);
    const qualification = getWaveRegimeQualification(idx, full, meta, waveContext, rawSignals, strategy);
    const priceHardInvalidations = getTodaySignalInvalidations(meta, 'price-break');
    const barRange = high - low;
    const upperShadow = high - Math.max(open, close);
    const rangeUpperFailure = waveContext.regime === 'range'
        && Number.isFinite(Number(waveContext.boxPressure))
        && barRange > 0
        && high >= Number(waveContext.boxPressure) * 0.99
        && upperShadow / barRange >= 0.35
        && (close - low) / barRange <= 0.5
        && rawSignals.some(signal => ['L5','L10','W2','W3'].includes(signal));
    const directExitSignals = meta?.exitSignals || [];
    const standaloneRangeL10 = rangeUpperFailure
        && directExitSignals.length === 1
        && directExitSignals[0] === 'L10'
        && priceHardInvalidations.length === 0;
    const eventStatus = candidate?.waveRejectionProtection?.status;
    const eventType = candidate?.waveRejectionProtection?.eventType;
    // 兼容旧缓存时忽略已经废弃的 risk_cap_zero_exit；只有现行结构/离场事件才能触发治理清仓。
    const recognizedEventType = new Set([
        'entry_day_pressure_rejection',
        'fresh_entry_failure',
        'fresh_entry_ma20_hold',
        'fresh_entry_downside_failure',
        'fresh_entry_hard_break',
        'signal_hard_invalidation',
        'mature_profit_rejection'
    ]).has(eventType);
    let lifecycle = previousLifecycle && prevPos > 0 ? { ...previousLifecycle } : null;
    const structureSupportHolds = lifecycle
        && Number.isFinite(Number(lifecycle.hardDefense))
        && Number.isFinite(close)
        && close >= Number(lifecycle.hardDefense);
    // 信号硬失效只代表局部防守位失守；结构支撑仍在时保留30%观察，不升级为硬风险清仓。
    const eventHardRisk = recognizedEventType && ['triggered','locked','entry_blocked'].includes(eventStatus)
        && !(eventType === 'signal_hard_invalidation' && structureSupportHolds);
    const hardRisk = candidate?.exit?.level === '清仓防守'
        || candidate?.simpleAction === '规避风险'
        || meta?.inCooldown
        || eventHardRisk;
    const signalBreakOnly = priceHardInvalidations.length > 0
        && structureSupportHolds
        && !hardRisk;
    const hardInvalidation = (priceHardInvalidations.length > 0 && !signalBreakOnly)
        || hardRisk
        || (candidate?.exit?.level === '强离场' && !standaloneRangeL10);
    let position = Number(candidate?.position) || 0;
    let governanceReason = '';

    // 迁移期不为历史持仓倒推建仓事实；只有新治理创建的生命周期才接管后续加减仓。
    if (prevPos > 0 && !lifecycle) {
        if (hardInvalidation) {
            position = 0;
            governanceReason = '既有持仓触发数据/硬风险或结构硬失效，仓位归零';
        } else {
            const cap = Number(policy?.positionCaps?.[waveContext.regime]);
            const noIncreasePosition = Math.min(position, prevPos);
            position = waveContext.regime === 'unknown' || !Number.isFinite(cap)
                ? noIncreasePosition
                : Math.min(noIncreasePosition, cap);
            governanceReason = waveContext.regime === 'unknown'
                ? '环境未知不新增风险；既有持仓保留原决策与风险保护'
                : `既有持仓不倒推生命周期，按${waveContext.regimeLabel}环境上限降至${position}%以内`;
        }
        position = quantizePosition(position);
        const action = getWaveGovernedAction(position, prevPos, candidate);
        return {
            ...candidate, position, prevAdv: prevPos, ...action,
            waveGovernanceVersion: WAVE_GOVERNANCE_VERSION,
            positionDriver: [candidate.positionDriver, governanceReason].filter(Boolean).join('；'),
            waveContext: {
                ...waveContext,
                lifecycle: null,
                stage: position > 0 ? 'legacy-holding' : 'flat',
                positionLayer: position,
                frozenLocalDefense: null,
                frozenHardDefense: null,
                supportSource: '',
                mainEvent: governanceReason,
                nextCondition: '下一次重新建仓时按当前环境创建冻结防守位'
            }
        };
    }

    if (lifecycle && Number.isFinite(Number(lifecycle.hardDefense)) && close < Number(lifecycle.hardDefense)) {
        position = 0;
        governanceReason = '收盘跌破冻结硬防守位' + Number(lifecycle.hardDefense).toFixed(2) + '，结构失效归零';
    } else if (hardInvalidation) {
        position = 0;
        governanceReason = '数据/硬风险或结构硬失效优先，仓位归零';
    } else if (prevPos <= 0 && position > 0) {
        const eventRecovery = ['released','recovery_started','recovery_hold'].includes(candidate?.waveRejectionProtection?.status)
            && candidate?.waveRejectionProtection?.allowRecoveryIncrease !== false;
        const multiTimeframeProbe = qualification.multiTimeframeProbeQualified;
        const regimeQualified = multiTimeframeProbe
            || (waveContext.regime === 'down' ? qualification.downQualified
                : (waveContext.regime === 'range' ? qualification.rangeQualified
                    : (waveContext.regime === 'up' ? qualification.upQualified
                        : (waveContext.regime === 'transition' ? qualification.downQualified || qualification.rangeQualified : false))))
            || eventRecovery;
        const defense = getWaveEntryDefenseContext(idx, full, waveContext, rawSignals, strategy, {
            freshEventRecovery: eventRecovery
        });
        if (!regimeQualified || !defense.acceptable || waveContext.regime === 'unknown') {
            position = 0;
            governanceReason = !regimeQualified ? waveContext.regimeLabel + '环境未满足首次建仓资格' : '冻结硬防守位距离建仓价过远，否决交易';
        } else {
            position = 30;
            lifecycle = {
                active: true, entryRegime: waveContext.regime, entrySignals: [...rawSignals],
                entrySignalGroups: qualification.freshGroups, entryDay: idx, entryDate: item.date || '',
                entryClose: close, localDefense: defense.localDefense, hardDefense: defense.hardDefense,
                entryDefense: defense.entryDefense, entryDefenseSource: defense.entryDefenseSource,
                supportSource: defense.supportSource,
                entryMode: multiTimeframeProbe ? 'multi-timeframe-double-bottom-probe' : 'regime-qualified',
                stage: 'entry', positionLayer: 30, upperObservation: null,
                breakoutPressure: waveContext.regime === 'range' ? waveContext.boxPressure : null, breakoutRetested: false
            };
            const entryDefenseText = Number.isFinite(Number(defense.entryDefense))
                ? `${defense.entryDefenseSource === 'local-signal' ? '局部防守位' : '结构防守位'}${Number(defense.entryDefense).toFixed(2)}`
                : '局部防守位';
            const structuralDefenseText = Number.isFinite(Number(defense.hardDefense))
                && Number(defense.hardDefense) !== Number(defense.entryDefense)
                ? `，结构硬防守位${Number(defense.hardDefense).toFixed(2)}作为二级失效线`
                : '';
            governanceReason = multiTimeframeProbe
                ? '周线双底候选与日线B20共振，建立30%试探仓并冻结防守位'
                : eventRecovery
                ? '事件后新信号完成恢复资格，建立30%试探仓并重新冻结防守位'
                : (waveContext.regime === 'down' && qualification.downRepairQualified
                    ? `下跌环境修复信号达到试探资格，按${entryDefenseText}通过距离检查，建立30%试探仓并冻结防守位${structuralDefenseText}`
                    : `${waveContext.regimeLabel}环境资格成立，按${entryDefenseText}通过距离检查，建立30%试探仓并冻结防守位${structuralDefenseText}`);
        }
    } else if (prevPos > 0) {
        if (signalBreakOnly) {
            position = prevPos;
            const defenseLabel = lifecycle.supportSource === 'signal-low' ? '底部防守位' : '底部结构支撑';
            governanceReason = `买入信号防守位失效但${defenseLabel}${Number(lifecycle.hardDefense).toFixed(2)}未破，保留${position}%试探仓观察`;
        }
        const pivot = findConfirmedPivotLow(full, idx, 120, 2);
        // 棘轮上移必须给收盘价留出最小缓冲：缓冲不足说明新防守位已进入当日噪音带，本次不上移，等价格拉开距离后再抬。
        const ratchetAtr14 = Number(waveContext?.box?.atr14) || getWaveAtr14At(idx, full);
        const ratchetBuffer = Number.isFinite(ratchetAtr14) && ratchetAtr14 > 0
            ? ratchetAtr14 * Math.max(0, Number(policy?.ratchet?.minimumBufferAtr) || 0)
            : 0;
        if (lifecycle && Number.isFinite(Number(pivot?.value)) && Number(pivot.value) > Number(lifecycle.hardDefense)
            && Number(pivot.value) < close && Number(pivot.value) <= close - ratchetBuffer) {
            lifecycle.hardDefense = Number(pivot.value);
            lifecycle.supportSource = 'confirmed-pivot-ratchet';
        }
        if (lifecycle && Number.isFinite(Number(lifecycle.breakoutPressure)) && low <= Number(lifecycle.breakoutPressure) * 1.01 && close >= Number(lifecycle.breakoutPressure)) lifecycle.breakoutRetested = true;
        const entryAge = lifecycle ? idx - Number(lifecycle.entryDay) : 0;
        const differentFreshGroup = qualification.freshGroups.some(group => !(lifecycle?.entrySignalGroups || []).includes(group));
        const rangeConfirm = waveContext.regime === 'range' && prevPos === 30 && entryAge >= 2
            && differentFreshGroup && close >= Math.max(ma20 || -Infinity, previousHigh || -Infinity) && close >= Number(waveContext.boxSupport);
        const upConfirm = waveContext.regime === 'up' && prevPos === 30 && entryAge >= 2
            && rawSignals.some(signal => (policy?.up?.confirmationSignals || []).includes(signal)) && close >= ma20;
        const upTrend = waveContext.regime === 'up' && prevPos === 50
            && rawSignals.some(signal => (policy?.up?.trendSignals || []).includes(signal))
            && (lifecycle?.entryRegime === 'up' || lifecycle?.breakoutRetested);
        if (position > prevPos) {
            if (waveContext.regime === 'range') position = rangeConfirm ? 50 : prevPos;
            else if (waveContext.regime === 'up') position = upTrend ? 80 : (upConfirm ? 50 : prevPos);
            else position = prevPos;
            governanceReason = position > prevPos ? waveContext.regimeLabel + '环境出现新的分层确认，仓位提高至' + position + '%' : waveContext.regimeLabel + '环境尚无新的分层确认，不加仓';
        }
        if (waveContext.regime === 'range' && Number.isFinite(Number(waveContext.boxPressure))) {
            if (rangeUpperFailure) {
                position = prevPos > 30 ? getLowerWavePositionStep(prevPos) : 30;
                if (lifecycle) lifecycle.upperObservation = { triggerDay: idx, triggerDate: item.date || '', midpoint: waveContext.boxMidpoint };
                governanceReason = '箱体上沿长上影弱收盘并伴随转弱证据，先退出一层；30%进入一日观察';
            } else if (lifecycle?.upperObservation && idx === Number(lifecycle.upperObservation.triggerDay) + 1) {
                const reclaimLevel = Math.max(ma20 || -Infinity, Number(lifecycle.upperObservation.midpoint) || -Infinity);
                if (close < reclaimLevel) { position = 0; governanceReason = '箱体上沿失败观察后仍未站回MA20/箱体中轴，清仓'; }
                else lifecycle.upperObservation = null;
            }
        }
        const ordinaryUpWeakness = waveContext.regime === 'up'
            && position <= 0
            && !hardInvalidation
            && !meta?.inCooldown
            && !['triggered','locked','entry_blocked'].includes(candidate?.waveRejectionProtection?.status);
        if (ordinaryUpWeakness) {
            position = getLowerWavePositionStep(prevPos);
            governanceReason = '上涨环境普通转弱按层级退出，未出现结构硬破不直接归零';
        }
        // 波峰确认防守：触及日线/周线压力并出现长上影弱收盘时，已有仓位最多降一个档位；压力位本身不清仓，也不生成新的S。
        if (candidate?.wavePeak?.confirmed === true && position > 0) {
            const peakStep = Math.max(30, getLowerWavePositionStep(prevPos));
            if (position > peakStep) {
                position = peakStep;
                governanceReason = (candidate.wavePeak.reason || '触及日线或周线压力并出现长上影弱收盘，按波峰确认防守')
                    + (position < prevPos ? '，已有仓位降至' : '，本日不加仓并保持') + position + '%';
            }
        }
        const cap = Number(policy?.positionCaps?.[waveContext.regime]);
        if (waveContext.regime !== 'unknown' && Number.isFinite(cap)) position = Math.min(position, cap);
        if (lifecycle && position > 0) { lifecycle.stage = position === 80 ? 'trend' : (position === 50 ? 'confirmation' : 'entry'); lifecycle.positionLayer = position; }
    }

    position = quantizePosition(position);
    if (position <= 0) lifecycle = null;
    const action = getWaveGovernedAction(position, prevPos, candidate);
    const nextCondition = waveContext.regime === 'down' ? '等待环境转为横盘或上涨后再申请50%'
        : (waveContext.regime === 'range' ? '守住箱体支撑，并等待不同计分组的新信号站上MA20/前高'
            : (waveContext.regime === 'up' ? '等待新的B6/B11确认或B4/B14趋势延续事件' : '等待环境完成确认'));
    return {
        ...candidate, position, prevAdv: prevPos, ...action,
        waveGovernanceVersion: WAVE_GOVERNANCE_VERSION,
        positionDriver: [candidate.positionDriver, governanceReason].filter(Boolean).join('；'),
        waveContext: {
            ...waveContext,
            multiTimeframeBottomProbe: qualification.multiTimeframeProbeQualified
                ? {
                    qualified: true,
                    dailySignal: policy?.multiTimeframeBottomProbe?.dailySignal || 'B20',
                    weeklyDate: qualification.weeklyDoubleBottom?.date || '',
                    weeklyDetails: qualification.weeklyDoubleBottom?.details || null,
                    provisional: qualification.weeklyDoubleBottom?.provisional === true
                }
                : null,
            lifecycle, stage: lifecycle?.stage || (position > 0 ? 'holding' : 'flat'), positionLayer: position,
            frozenLocalDefense: lifecycle?.localDefense ?? null, frozenHardDefense: lifecycle?.hardDefense ?? null,
            entryDefense: lifecycle?.entryDefense ?? null, entryDefenseSource: lifecycle?.entryDefenseSource || '',
            supportSource: lifecycle?.supportSource || '', mainEvent: governanceReason, nextCondition
        }
    };
}

function computeDecisionForIndex(idx, full, prevPos) {
    const candidate = computeWaveCandidateDecisionForIndex(idx, full, prevPos);
    const decision = applyWaveRegimeGovernance(idx, full, prevPos, candidate, STRATEGY);
    return decision?.waveContext?.inScope
        ? { ...decision, waveGovernanceVersion: WAVE_GOVERNANCE_VERSION }
        : decision;
}

function isCurrentDecisionGovernanceVersion(decision, options = {}) {
    const inScope = options.waveStockDaily === true
        || (state.strategy === '波段抄底型' && state.mode === 'stock' && state.period === 'daily');
    return !inScope || decision?.waveGovernanceVersion === WAVE_GOVERNANCE_VERSION;
}

function isCurrentDerivedDecisionCache(cached, options = {}) {
    if (!cached) return false;
    const inScope = options.waveStockDaily === true
        || (state.strategy === '波段抄底型' && state.mode === 'stock' && state.period === 'daily');
    return !inScope || (
        cached.decisionGovernanceVersion === WAVE_GOVERNANCE_VERSION
        && isCurrentDecisionGovernanceVersion(cached.rows?.[cached.rows.length - 1]?._decision, { waveStockDaily: true })
    );
}

function getWeeklyDirectionContext(idx, full, ind) {
    const item = full[idx] || {}, close = item?.close || 0, ma20 = ind.ma?.[20]?.[idx], ma60 = ind.ma?.[60]?.[idx], prevMa20 = ind.ma?.[20]?.[Math.max(0, idx - 2)] || ma20;
    const recent = full.slice(Math.max(0, idx - 19), idx + 1), high20 = recent.length ? Math.max(...recent.map(d => d.high)) : close, low20 = recent.length ? Math.min(...recent.map(d => d.low)) : close;
    const distMA20 = ma20 ? (close - ma20) / ma20 : 0;
    
    let direction = '方向不明', directionReason = '周线样本不足，暂不判断大方向';
    if (ma20 && ma60) {
        if (close > ma20 && ma20 > ma60 && ma20 >= prevMa20) { direction = '周线多头'; directionReason = '价格站上20周与60周均线，20周均线保持上行'; } 
        else if (close < ma20 && ma20 < ma60 && ma20 <= prevMa20) { direction = '周线空头'; directionReason = '价格位于20周与60周均线下方，趋势仍偏防守'; } 
        else { direction = '周线震荡'; directionReason = '均线结构尚未形成清晰共振'; }
    }
    
    let position = '位置中性';
    if (distMA20 > 0.12 || close >= high20 * 0.96) position = '偏高，追涨性价比下降';
    else if (distMA20 < -0.08 || close <= low20 * 1.06) position = '靠近防守区，等待修复';
    else if (Math.abs(distMA20) <= 0.03) position = '贴近20周均线，方向选择临近';
    
    let repair = '未修复'; if (ma20) { if (close > ma20 && ma20 >= prevMa20) repair = '已修复'; else if (close > ma20) repair = '修复中'; }
    return { direction, directionReason, position, repair, dailyImpact: direction === '周线多头' ? '日线买点可信度提高，可关注回踩后的确认' : direction === '周线空头' ? '日线买点降权，优先等待周线重新站回' : '只适合轻仓观察，避免把震荡当趋势', ma20, ma60, support: low20, pressure: high20, distMA20 };
}

function buildIndicatorKeyForData(id, period, strategy, data) {
    if(!data || !data.length) return ''; const last = data[data.length - 1];
    const dataSig = data.map((item, idx) => {
        item = item || {};
        return [idx, item.date || '', item.open, item.high, item.low, item.close, item.vol, item.amt].join(':');
    }).join('|');
    return `${id}_${period}_${strategy}_${data.length}_${last.date}_${last.close}_${hashString32(dataSig)}`;
}

function getIndicatorKey(data = getActiveData()) {
    return buildIndicatorKeyForData(state.id, state.period, state.strategy, data);
}

function storeDerivedIndicatorCache(id, period, strategy, data, indicators) {
    if (!id || !period || !strategy || !data?.length || !indicators?.macd || !indicators?.rsi || !indicators?.kdj) return;
    const cacheKey = buildIndicatorKeyForData(id, period, strategy, data);
    if (!cacheKey) return;
    derivedIndicatorCache.set(cacheKey, {
        decisionGovernanceVersion: WAVE_GOVERNANCE_VERSION,
        indicators: {
            ma: { ...(indicators.ma || {}) },
            macd: indicators.macd,
            rsi: indicators.rsi,
            kdj: indicators.kdj
        },
        rows: data.map(item => item ? ({
            _signals: item._signals,
            _signalVersion: item._signalVersion,
            _strategy: item._strategy,
            _decision: item._decision
        }) : null)
    });
    if (derivedIndicatorCache.size > SYS_CONFIG.RENDER_CACHE_SIZE) {
        derivedIndicatorCache.delete(derivedIndicatorCache.keys().next().value);
    }
}

function markIndicatorsDirty() { state.indicatorKey = ''; }

function resetIndicatorState() {
    state.indicators = { ma: {}, macd: null, rsi: null, kdj: null };
    state.pendingIndicatorMutation = { mode: 'full', startIdx: 0 };
    markIndicatorsDirty();
}

function updateAllIndicators(incrementalIdx = -1) {
    const perfTrace = PERF.start('updateAllIndicators', { id: state.id, period: state.period, strategy: state.strategy, incrementalIdx });
    const full = getActiveData();
    if(!full || !full.length) {
        PERF.end(perfTrace, { status: 'empty' });
        return;
    }
    const nextKey = getIndicatorKey(full);
    const pendingMutation = state.pendingIndicatorMutation;
    if (incrementalIdx === -1 && pendingMutation?.mode !== 'market-only' && state.indicatorKey === nextKey && state.indicators.macd && state.indicators.rsi && state.indicators.kdj
        && isCurrentDecisionGovernanceVersion(full[full.length - 1]?._decision)) {
        PERF.end(perfTrace, { status: 'unchanged-key', points: full.length });
        return;
    }
    const cacheKey = nextKey;

    const mutation = incrementalIdx >= 0
        ? { mode: 'incremental', startIdx: incrementalIdx }
        : (state.pendingIndicatorMutation || { mode: 'full', startIdx: 0 });
    const isStrategyOnlyMutation = mutation.mode === 'strategy-only' &&
        state.indicators.macd &&
        state.indicators.rsi &&
        state.indicators.kdj &&
        state.indicators.ma;
    const isMarketOnlyMutation = mutation.mode === 'market-only' &&
        state.indicators.macd &&
        state.indicators.rsi &&
        state.indicators.kdj &&
        state.indicators.ma;
    const shouldFullRebuild = !isStrategyOnlyMutation && !isMarketOnlyMutation &&
        (!state.indicators.macd || full.length < 60 || mutation.mode === 'full');

    if (mutation.mode === 'unchanged' && state.indicators.macd && isCurrentDecisionGovernanceVersion(full[full.length - 1]?._decision)) {
        state.indicatorKey = nextKey;
        state.pendingIndicatorMutation = null;
        PERF.end(perfTrace, { status: 'unchanged-mutation', points: full.length });
        return;
    }

    if (incrementalIdx === -1 && !isMarketOnlyMutation && (mutation.mode === 'full' || mutation.mode === 'strategy-only')
        && isCurrentDerivedDecisionCache(derivedIndicatorCache.get(cacheKey))) {
        const cached = derivedIndicatorCache.get(cacheKey);
        state.indicators.ma = cached.indicators.ma;
        state.indicators.macd = cached.indicators.macd;
        state.indicators.rsi = cached.indicators.rsi;
        state.indicators.kdj = cached.indicators.kdj;
        for (let i = 0; i < full.length; i++) {
            if (!full[i] || !cached.rows[i]) continue;
            full[i]._signals = cached.rows[i]._signals;
            full[i]._signalVersion = cached.rows[i]._signalVersion;
            full[i]._strategy = cached.rows[i]._strategy;
            full[i]._decision = cached.rows[i]._decision;
        }
        state.indicatorKey = nextKey;
        state.pendingIndicatorMutation = null;
        PERF.end(perfTrace, { status: 'derived-cache', points: full.length });
        return;
    }

    const calcStart = shouldFullRebuild ? 0 : Math.max(0, mutation.startIdx || 0);
    if (!isStrategyOnlyMutation && !isMarketOnlyMutation) {
        MA_OPTIONS.forEach(n => {
            state.indicators.ma[n] = shouldFullRebuild
                ? Calcs.ma(full, n)
                : Calcs.maIncremental(full, n, state.indicators.ma?.[n], calcStart);
        });
        state.indicators.macd = shouldFullRebuild
            ? Calcs.macd(full)
            : Calcs.macdIncremental(full, state.indicators.macd, calcStart);
        state.indicators.rsi = shouldFullRebuild
            ? Calcs.rsi(full)
            : Calcs.rsiIncremental(full, state.indicators.rsi, 14, calcStart);
        state.indicators.kdj = shouldFullRebuild
            ? Calcs.kdj(full)
            : Calcs.kdjIncremental(full, state.indicators.kdj, 9, calcStart);
    }
    PERF.mark(perfTrace, 'base-indicators', { skipped: !!(isStrategyOnlyMutation || isMarketOnlyMutation), fullRebuild: !!shouldFullRebuild, calcStart });
    const weeklySignalContexts = shouldFullRebuild ? buildWeeklySignalContexts(full) : null;
    PERF.mark(perfTrace, 'weekly-signal-context', { precomputed: !!weeklySignalContexts, points: weeklySignalContexts?.length || 0 });

    const isLatestOnlyMutation = !shouldFullRebuild &&
        mutation.mode === 'incremental' &&
        (mutation.startIdx || 0) >= full.length - 1 &&
        full.length > 1 &&
        full[full.length - 2]?._decision &&
        full[full.length - 2]?._strategy === state.strategy &&
        full[full.length - 2]?._signalVersion === SIGNAL_VERSION &&
        isCurrentDecisionGovernanceVersion(full[full.length - 2]?._decision);
    const rebuildStart = isStrategyOnlyMutation || isMarketOnlyMutation
        ? 0
        : shouldFullRebuild
        ? 0
        : (isLatestOnlyMutation ? full.length - 1 : Math.max(0, Math.min(full.length - 1, mutation.startIdx || 0) - DECISION_REBUILD_LOOKBACK));

    let prevPos = 0;
    if (!shouldFullRebuild && rebuildStart > 0) {
        prevPos = full[rebuildStart - 1]?._decision?.position || 0;
    }

    let signalMs = 0;
    let decisionMs = 0;
    let reusedRows = 0;
    let signalRows = 0;
    let decisionRows = 0;
    const signalBreakdown = { contextMs: 0, ruleMs: {}, ruleChecks: {}, ruleHits: {} };
    for(let i = shouldFullRebuild ? 0 : rebuildStart; i < full.length; i++) {
        if (!isMarketOnlyMutation && full[i]?._signals && full[i]._signalVersion === SIGNAL_VERSION && full[i]._strategy === state.strategy
            && full[i]._decision && isCurrentDecisionGovernanceVersion(full[i]._decision)) {
            prevPos = full[i]._decision.position;
            reusedRows += 1;
            continue;
        }
        if (full[i]) {
            if (!full[i]._signals || full[i]._signalVersion !== SIGNAL_VERSION) {
                const signalStarted = performance.now();
                full[i]._signals = calculateDailySignals(i, full, state.indicators, signalBreakdown, weeklySignalContexts?.[i] || null);
                signalMs += performance.now() - signalStarted;
                signalRows += 1;
            }
            full[i]._signalVersion = SIGNAL_VERSION;
            full[i]._strategy = state.strategy;
            const decisionStarted = performance.now();
            full[i]._decision = computeDecisionForIndex(i, full, prevPos);
            decisionMs += performance.now() - decisionStarted;
            decisionRows += 1;
            prevPos = full[i]._decision.position;
        }
    }
    signalBreakdown.contextMs = Number(signalBreakdown.contextMs.toFixed(1));
    Object.keys(signalBreakdown.ruleMs).forEach(id => {
        signalBreakdown.ruleMs[id] = Number(signalBreakdown.ruleMs[id].toFixed(1));
    });
    PERF.mark(perfTrace, 'decision-loop', {
        rebuildStart,
        signalMs: Number(signalMs.toFixed(1)),
        decisionMs: Number(decisionMs.toFixed(1)),
        signalRows,
        decisionRows,
        reusedRows,
        signalBreakdown
    });

    state.indicatorKey = nextKey;
    state.pendingIndicatorMutation = null;
    storeDerivedIndicatorCache(state.id, state.period, state.strategy, full, state.indicators);
    PERF.mark(perfTrace, 'cache-store');
    PERF.end(perfTrace, { status: shouldFullRebuild ? 'full' : mutation.mode, points: full.length });
}
