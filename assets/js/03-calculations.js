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
            weeklySupport: getWeeklySupportFromSeries(weeks)
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

function isWaveL10TrendHandoffSignal(full, index, signal, strategy = STRATEGY) {
    return signal === 'L10'
        && !!strategy?.l10TrendHandoff
        && full?.[index]?._decision?.waveL10TrendHandoff?.applied === true;
}

function isWindowBuySignalEligible(signal, signalDay, full, strategy = STRATEGY) {
    const guard = strategy?.windowSignalGuards?.[signal];
    if (!guard) return true;
    const companionSignals = new Set(guard.companionSignals || []);
    const recentDays = Math.max(1, Number(guard.recentDays) || 1);
    for (let day = Math.max(0, signalDay - recentDays + 1); day <= signalDay; day++) {
        if ((full[day]?._signals || []).some(item => companionSignals.has(item))) return true;
    }
    return false;
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
    const strongExitSet = getStrongExitSignals(S);
    for(let i = idx; i >= Math.max(0, idx - 60); i--) { 
        if((full[i]?._signals || []).some(s => s.startsWith('L') && S.exitSignals?.includes(s)
            && strongExitSet.has(s) && !isWaveL10TrendHandoffSignal(full, i, s, S))) {
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
                if(sig.startsWith('L') && S.exitSignals?.includes(sig) && !isWaveL10TrendHandoffSignal(full, i, sig, S)) { windowSignals.push({day: i, signal: sig}); usedSignals.add(sig); }
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
    if(!trends.length) return { label:'环境未知', cls:'neutral', increaseCaps:{ ordinary:0, independent:0 }, reason:'核心宽基数据不足，暂停增加风险', trends:[] };
    if(trends.length < CORE_MARKET_INDEX_IDS.length) return { label:'环境待确认', cls:'neutral', increaseCaps:{ ordinary:0, independent:0 }, reason:'三项核心宽基尚未补齐，暂停增加风险', trends };
    
    const bull = trends.filter(t => t.score > 0), bear = trends.filter(t => t.score < 0);
    
    let label, cls, increaseCaps = null, reason;
    if (bull.length >= 2) { label = '核心宽基偏强'; cls = 'bull'; reason = '三项核心宽基多数走强，增仓门禁开放'; }
    else if (bear.length >= 2) {
        label = '核心宽基偏弱';
        cls = 'bear';
        increaseCaps = { ordinary:30, independent:50 };
        reason = '三项核心宽基多数空头；普通机会新增风险上限30%，标的独立走强上限50%';
    }
    else { label = '核心宽基分化'; cls = 'neutral'; reason = '三项核心宽基未形成多数空头，标的按自身信号和风控决定仓位'; }
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
    if (exits.some(s => ['L1', 'L2', 'L5', 'L6', 'L7', 'L8'].includes(s)) || (meta.warningSignals || []).length) return { level: '减仓观察', detail: '短线转弱或过热，适合降低仓位等待确认' };
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

function getPositionDriverText(meta, market, risk, exit, base, position, prevPos, positionCap = null, marketGate = null) {
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
    const riskCap = getRiskPositionCap(risk);
    if (base > riskCap) pieces.push(`风险最高允许 ${riskCap}%`);
    if (positionCap?.reason) pieces.push(positionCap.reason);
    if (marketGate?.detail) pieces.push(marketGate.detail);
    pieces.push(position === prevPos ? `维持 ${position}%` : `调整至 ${position}%`);
    if (position === 0 && prevPos > 0) pieces.push(`较前次收至 0%`);
    return pieces.join('，') + '。';
}

function formatPriceLevel(value) {
    return Number.isFinite(value) ? Number(value).toFixed(2) : '--';
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

function getPlainRiskAdjustmentText(risk = {}, basePosition, riskCoef, adjustedPosition, positionLabel = '基础仓位') {
    const base = Number(basePosition);
    const cap = getRiskPositionCap(risk);
    const details = getRiskAdjustmentDetails(risk);
    if (!Number.isFinite(base) || base <= cap) return `风险评估未限制，${positionLabel}按${Number.isFinite(base) ? `${base}%` : '当前档位'}执行`;
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
    const riskCoef = Number(decision?.risk?.coef);
    const riskCap = getRiskPositionCap(decision?.risk);
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
    let hasLimiter = Number.isFinite(basePosition) && basePosition > riskCap;
    const adjustedPosition = Number.isFinite(basePosition) ? quantizePosition(Math.min(basePosition, riskCap)) : null;

    if (Number.isFinite(basePosition)) {
        if (basePosition <= 0) {
            path.push(isIndex ? '当前指数动能不足，基础风险仓位为0%' : '当前没有满足开仓条件，基础仓位为0%');
        } else if (Number.isFinite(riskCoef)) {
            path.push(`${basePositionLabel}为${basePosition}%（信号计算结果）`);
            path.push(getPlainRiskAdjustmentText(decision?.risk, basePosition, riskCoef, adjustedPosition, basePositionLabel));
        } else {
            path.push(`${basePositionLabel}为${basePosition}%（信号计算结果），风险评估暂按原值处理`);
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
        if (Number(decision?.risk?.score) < 40) {
            hasLimiter = true;
            path.push(`当前风险进入极端档，${currentPositionLabel}归零防守`);
        }
        if (!isIndex && decision?.positionCap?.reason) {
            hasLimiter = true;
            path.push(getPlainPositionLimitText(decision.positionCap.reason));
        }
    }

    if (marketGate.type === 'increase-capped') {
        hasLimiter = true;
        const tierText = marketGate.strengthTier === 'independent' ? (isIndex ? '指数自身独立走强' : '标的独立走强') : '普通机会';
        path.push(`核心宽基偏弱时，${tierText}新增风险上限为${marketGate.cap}%，已有${currentPositionLabel}不因市场偏弱被动降低`);
    }
    if (isIncrease && !hasLimiter) {
        if (marketGate.cap != null && Number.isFinite(Number(marketGate.cap))) path.push(`当前基础仓位未超过市场新增风险上限 ${marketGate.cap}%`);
        else path.push('风险评估未额外下调，市场也未限制本次增加仓位');
    }
    if (position === previousPosition && position > 0) {
        const sourceText = signalCause?.text || `此前形成的有效${signalName}`;
        const higherTierText = !hasLimiter ? `，但尚未满足进入更高${currentPositionLabel}档位的条件` : '';
        path.push(`${sourceText}仍支持当前${currentPositionLabel}${higherTierText}`);
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
        if (Number.isFinite(basePosition)) drivers.push(getPlainRiskAdjustmentText(decision?.risk, basePosition, riskCoef, position));
        if (Number(decision?.risk?.score) < 40) drivers.push('风险评分进入极端风险档');
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
    const marketGate = decision?.marketGate || {};
    const b11Defense = decision?.b11StructureDefense;
    const structureLevel = Number(b11Defense?.structureLevel);
    const structureDateText = b11Defense?.structureDate ? `（${b11Defense.structureDate}确认）` : '';
    const hasB11StructureDefense = Number.isFinite(structureLevel);

    if (position === 0 && marketGate.type === 'entry-blocked') {
        return `${decision.market.label}下增仓门禁关闭；待沪深300、中证500和中证1000补齐并重新开放后，再按个股信号考虑开仓。`;
    }

    if (position === 0 && hasB11StructureDefense && b11Defense?.hardInvalidated) {
        return `已收盘跌破结构防守位 ${structureLevel.toFixed(2)}${structureDateText}；待买入积分重新达到 ${threshold}/${threshold} 后，才重新考虑。`;
    }

    if (position > 0 && position <= 30 && hasB11StructureDefense) {
        const localHint = b11Defense?.localBreak ? 'B11局部回踩已失守，当前暂停加仓；' : '';
        return `${localHint}若收盘跌破结构防守位 ${structureLevel.toFixed(2)}${structureDateText}，或再出离场信号，降到 0%。`;
    }

    if (marketGate.type === 'increase-capped') {
        const stopGuard = canShowStop ? `若跌破防守位 ${stopText}，或再出离场信号，按个股规则减仓或离场。` : '若再出离场信号，按个股规则减仓或离场。';
        return `核心宽基偏弱期间新增风险上限为${marketGate.cap}%；只有标的自身条件继续改善且门禁允许时，才考虑提高仓位。${stopGuard}`;
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
    const marketGate = decision?.marketGate || {};
    const defense = decision?.b11StructureDefense;
    const waveRejection = decision?.waveRejectionProtection;
    const stop = formatPriceLevel(decision?.risk?.stop);
    const stopText = stop === '--' ? '防守位' : `防守位${stop}`;
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
        return `收复风险日高点${Number(waveRejection.triggerHigh).toFixed(2)}、出现事件后新的有效买入信号，或至少两个交易日后站回风险日收盘${Number(waveRejection.triggerClose).toFixed(2)}，才考虑局部恢复；若再出现量价分歧，继续保持当前防守仓位。`;
    }
    if (waveRejection?.status === 'recovery_pending') {
        return `出现新的有效买入信号且风险稳定后，才考虑首次恢复，首次最多30%；若再出现量价分歧或离场信号，继续空仓。`;
    }
    if (['released', 'recovery_started', 'recovery_hold'].includes(waveRejection?.status)) {
        return `完成事件后的低仓观察且风险保持稳定后，才考虑继续提高仓位；若再出现量价分歧或离场信号，先降低仓位或离场。`;
    }
    if (position === 0 && marketGate.type === 'entry-blocked') {
        return `核心宽基数据补齐、市场允许新增风险且${scoreText}后，才考虑开仓；若出现防守信号，继续空仓。`;
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
    if (marketGate.type === 'increase-capped') {
        return `${addCondition}、且市场重新允许增加风险后，才考虑提高仓位；若跌破${stopText}或出现离场信号，减仓或离场。`;
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
        return `核心市场环境改善、且${addCondition}后，才考虑超过当前新增风险上限；若跌破${stopText}或出现离场信号，降低风险。`;
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

function getStockDecisionSummary(meta, decision) {
    const position = decision?.position ?? 0;
    const action = decision?.simpleAction || '持币观望';
    const exitLevel = decision?.exit?.level || '无明确离场';
    const marketLabel = decision?.market?.label || '环境未知';
    const riskFlags = decision?.risk?.flags || [];
    const scoreReady = !!decision?.signalReady || (meta?.windowScore ?? 0) >= (STRATEGY?.buyThreshold ?? Infinity);
    const hasWarning = (meta?.warningSignals || []).length > 0 || riskFlags.length > 0;
    const hasHeatRisk = hasShortTermHeatRisk(meta, decision?.risk);
    const hasCriticalExit = ['清仓防守', '强离场'].includes(exitLevel) || ['清仓离场', '规避风险'].includes(action);
    const hasPositionExit = hasCriticalExit || action === '执行离场';
    const directExitSignals = meta?.exitSignals || [];
    const waveRejection = decision?.waveRejectionProtection || { status: 'none', active: false };
    const waveL10Handoff = decision?.waveL10TrendHandoff || { applied: false };
    const previousPosition = Number(decision?.prevAdv) || 0;
    const threshold = Number(STRATEGY?.buyThreshold);
    const scoreBelowThreshold = Number.isFinite(threshold) && (meta?.windowScore ?? 0) < threshold;
    const basePosition = Number(decision?.basePosition);
    const basePositionIsEmpty = Number.isFinite(basePosition) ? basePosition <= 0 : scoreBelowThreshold;
    const isFavorableMarket = ['核心宽基偏强', '全面多头', '温和偏多'].includes(marketLabel);
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
    const positionPressure = [];
    if (Number.isFinite(basePosition)) positionPressure.push(getPlainRiskAdjustmentText(decision.risk, basePosition, Number(decision.risk.coef), position, '基础仓位'));
    const marketGate = decision?.marketGate || {};
    const signalCause = getSignalCauseSummary(meta);
    const buyCauseText = signalCause.text || '当前有效买入信号';
    const lifecycleTransition = getSignalLifecycleTransition(meta, decision, 'stock');
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
    } else if (!hasCriticalExit && waveRejection.status === 'triggered') {
        stateLabel = waveRejection.eventType === 'fresh_entry_failure' ? '新仓失败离场' : '冲高回落止盈';
        userAction = position === 0 ? '离场观察' : '降低仓位';
    } else if (!hasCriticalExit && waveRejection.status === 'locked') {
        stateLabel = '风险恢复观察';
        userAction = position === 0 ? '暂时不买' : '持仓观察';
    } else if (!hasCriticalExit && ['released', 'recovery_pending'].includes(waveRejection.status)) {
        stateLabel = '风险解除';
        userAction = position > 0 ? '继续持有' : '继续观察';
    } else if (!hasCriticalExit && ['recovery_started', 'recovery_hold'].includes(waveRejection.status)) {
        stateLabel = '分步恢复';
        userAction = '轻仓观察';
    }

    let reason = '';
    if (!hasCriticalExit && waveL10Handoff.applied) {
        reason = `完整多头持仓中单独出现MACD顶背离，当前按趋势接管预警处理，不因单个L10清仓，仓位保持在${position}%以内观察`;
    } else if (!hasCriticalExit && waveRejection.status === 'triggered') {
        reason = waveRejection.eventType === 'fresh_entry_failure'
            ? `首次建仓后冲击压力位失败，盘中盈利大幅回吐并放量收长上影，风险日从${previousPosition}%降至${position}%`
            : `已有浮盈遇到放量冲高回落，风险日实时分档止盈，当前从${previousPosition}%降至${position}%`;
    } else if (!hasCriticalExit && waveRejection.status === 'locked') {
        reason = `冲高回落风险尚未解除，事件前的旧积分不立即触发回补，当前保持${position}%防守仓位`;
    } else if (!hasCriticalExit && waveRejection.status === 'released') {
        reason = `冲高回落风险已局部解除，当前先恢复至${position}%仓位观察`;
    } else if (!hasCriticalExit && waveRejection.status === 'recovery_pending') {
        reason = '冲高回落风险已局部解除，但当前尚无可执行的恢复仓位，继续空仓观察';
    } else if (!hasCriticalExit && waveRejection.status === 'recovery_started') {
        reason = `冲高回落事件后首次恢复，当前最多恢复至${position}%仓位`;
    } else if (!hasCriticalExit && waveRejection.status === 'recovery_hold') {
        reason = `冲高回落事件后仍在低仓确认期，当前保持${position}%仓位`;
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
        const baseText = Number.isFinite(basePosition) ? `基础仓位原为 ${basePosition}%` : '基础仓位仍大于 0%';
        const pressureText = positionPressure.length ? positionPressure.join('、') : '个股风险限制';
        reason = `买入积分为 ${scoreText}，${baseText}，但${pressureText}使策略参考仓位归零，${positionToZeroText}，先空仓防守`;
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
    } else if (marketGate.type === 'entry-blocked' && position === 0) {
        reason = `${buyCauseText}使买入积分达到${scoreText}，但核心市场数据还不完整，当前暂时不买`;
    } else if (marketGate.type === 'increase-capped') {
        if (isIncrease) reason = positionChange.reason;
        else {
            const tierText = marketGate.strengthTier === 'independent' ? '标的独立走强' : '普通机会';
            reason = `${buyCauseText}使买入积分维持在${scoreText}，但核心市场偏弱，${tierText}最多新增到${marketGate.cap}%，当前保持${position}%`;
        }
    } else if (isReduce) {
        reason = positionChange.reason;
    } else if (position === 0) {
        reason = `${isFavorableMarket ? '大盘虽偏好，但' : ''}买入积分只有 ${scoreText}，当前还不满足开仓条件`;
    } else if (isEntry) {
        reason = positionChange.reason;
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
    let positionWhy = getPlainDisplayText(positionChange.positionExplanation);
    if (waveL10Handoff.applied) {
        positionWhy = `单独L10只触发趋势接管预警，风险链与完整多头资格共同将策略参考仓位限制在${position}%`;
    } else if (waveRejection.status === 'triggered') {
        positionWhy = waveRejection.eventType === 'fresh_entry_failure'
            ? `新仓冲击压力失败在当日直接触发防守，策略参考仓位从${previousPosition}%降至${position}%`
            : `冲高回落风险在当日直接降一档，策略参考仓位从${previousPosition}%降至${position}%`;
    } else if (waveRejection.status === 'locked') {
        positionWhy = `风险事件尚未解除，只阻止该标的旧积分立即回补，策略参考仓位保持${position}%`;
    } else if (['released', 'recovery_started', 'recovery_hold'].includes(waveRejection.status)) {
        positionWhy = `风险解除后按分步恢复规则执行，当前策略参考仓位为${position}%`;
    }
    const nextFocus = getPlainDisplayText(getStockNextFocus(meta, decision, position, hasWarning));

    return {
        state: stateLabel,
        action: userAction,
        positionText: `${position}%`,
        why,
        positionWhy,
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
    const marketLabel = decision?.market?.label || '环境未知';
    const riskFlags = decision?.risk?.flags || [];
    const scoreReady = !!decision?.signalReady || (meta?.windowScore ?? 0) >= (STRATEGY?.buyThreshold ?? Infinity);
    const hasWarning = (meta?.warningSignals || []).length > 0 || riskFlags.length > 0;
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

    if (!hasCriticalExit && lifecycleTransition.kind === 'hard' && !isIncrease) {
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
    if (!hasCriticalExit && position === 0 && meta?.inCooldown) {
        reason = `当前是${getCooldownProgress(meta).label}；指数动能积分为${scoreText}，风险仓位保持0%`;
    } else if (!hasCriticalExit && lifecycleTransition.text) {
        reason = lifecycleTransition.text;
    } else if (hasPositionExit && exitLevel === '无明确离场' && previousPosition > 0 && basePositionIsEmpty) {
        const scoreReason = scoreIsEmpty
            ? `此前指数动能已失效，积分降为 ${scoreText}`
            : `此前指数动能已不足，积分为 ${scoreText}，低于门槛 ${threshold}/${threshold}`;
        reason = `${scoreReason}，${riskPositionToZero}，暂不增加市场风险`;
    } else if (hasPositionExit && exitLevel === '无明确离场' && previousPosition > 0) {
        const pressureText = Number(decision?.risk?.coef) < 1 ? '指数当前风险偏高' : '指数自身风险限制';
        reason = `指数动能积分为 ${scoreText}，但${pressureText}使风险仓位归零，${riskPositionToZero}`;
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
            : (riskFlags.length ? `指数风险提示为${riskFlags.join('、')}` : (decision?.exit?.detail || '指数短线风险升高'));
        const reduceAction = position === 0 ? `当前风险仓位从${previousPosition}%降至 0%，保持低风险暴露` : `当前风险仓位从${previousPosition}%降至${position}%`;
        reason = `${reduceCause}，${reduceAction}`;
    } else if (position === 0) {
        reason = `当前指数动能积分只有 ${scoreText}，暂不增加市场风险暴露`;
    } else if (isEntry) {
        reason = `${causeText}使指数动能积分达到 ${scoreText}，支持风险仓位由0%提高至${position}%`;
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
    const positionWhy = getPlainDisplayText(positionDetails.positionExplanation)
        .replace(/买入积分/g, '指数动能积分')
        .replace(/买入信号/g, '指数动能信号')
        .replace(/试探仓/g, '低风险仓位');
    const nextFocus = getPlainDisplayText(getIndexNextFocus(meta, decision, position, hasWarning));

    return {
        state: stateLabel,
        action: userAction,
        positionText: `${position}%`,
        why,
        positionWhy,
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

function getStockTrendPositionCap(idx, full, ind, position) {
    if (state.mode !== 'stock') return null;
    const ma20 = Number(ind?.ma?.[20]?.[idx]);
    const ma60 = Number(ind?.ma?.[60]?.[idx]);
    const ma20Prev = Number(ind?.ma?.[20]?.[Math.max(0, idx - 5)]);
    const close = Number(full?.[idx]?.close);
    const hasTrendData = [close, ma20, ma60, ma20Prev].every(Number.isFinite);
    let limit = 50;
    let reason = '个股趋势数据不足，高仓位上限50%';
    if (hasTrendData && ma20 < ma60 && ma20 < ma20Prev) {
        limit = 30;
        reason = '个股处于中期下降趋势，高仓位上限30%';
    } else if (hasTrendData && close > ma20 && ma20 > ma60 && ma20 >= ma20Prev) {
        return null;
    } else if (hasTrendData) {
        reason = '个股尚未形成完整多头结构，高仓位上限50%';
    }
    return position > limit ? { limit, reason } : null;
}

function getPositionCap(meta, prevPos, position, idx, full, ind) {
    const caps = [];
    const trendCap = getStockTrendPositionCap(idx, full, ind, position);
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
        && Number(risk?.score) >= 80
        && !(meta?.warningSignals || []).length
        && !(meta?.exitSignals || []).length
        && !meta?.inCooldown
        && exit?.level === '无明确离场';
    return {
        tier: independent ? 'independent' : 'ordinary',
        label: independent ? '标的独立走强' : '普通机会',
        reasons: independent ? ['买入积分达标', '收盘价与MA20/MA60保持多头结构', 'MA20未转弱', '风险与离场检查通过'] : []
    };
}

function applyMarketRiskGate(market, prevPos, targetPosition, strength = { tier:'ordinary', label:'普通机会' }) {
    const previous = Math.max(0, Number(prevPos) || 0);
    const target = Math.max(0, Number(targetPosition) || 0);
    const label = market?.label || '环境未知';
    const caps = market?.increaseCaps;
    const strengthTier = strength?.tier === 'independent' ? 'independent' : 'ordinary';
    const cap = caps && Number.isFinite(Number(caps[strengthTier])) ? Number(caps[strengthTier]) : null;
    const reasons = Array.isArray(strength?.reasons) ? [...strength.reasons] : [];

    if (target <= previous || cap == null) {
        return { position:target, applied:false, type:'open', cap, strengthTier, strengthLabel:strength?.label || '普通机会', reasons, detail:'' };
    }
    if (previous === 0 && cap <= 0) {
        return { position:0, applied:true, type:'entry-blocked', cap, strengthTier, strengthLabel:strength?.label || '普通机会', reasons, detail:`${label}增仓门禁关闭` };
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
        sources.push({ type: 'pivot', period: null, level: pivot.value, day: pivot.day });
    }
    const slopeDays = Math.max(1, Number(config.movingAverageSlopeLookbackDays) || 5);
    for (const period of config.movingAveragePeriods || []) {
        const series = indicators?.ma?.[period] || [];
        const level = Number(series[idx]);
        const previousLevel = Number(series[idx - slopeDays]);
        if (!Number.isFinite(level) || !Number.isFinite(previousLevel) || level > previousLevel) continue;
        if (high >= level * (1 - tolerance) && close <= level * (1 + closeTolerance)) {
            sources.push({ type: 'ma', period, level, day: idx });
        }
    }
    return { matched: sources.length > 0, sources };
}

function getWaveRejectionProtectionContext(idx, full, meta, prevPos, targetPosition, strategy = STRATEGY) {
    const config = strategy?.waveRejectionProtection;
    const empty = { active: false, status: 'none', targetPosition };
    if (state.strategy !== '波段抄底型' || state.mode !== 'stock' || state.period !== 'daily' || !config) return empty;

    const item = full?.[idx] || {};
    const close = Number(item.close);
    const previous = full?.[idx - 1]?._decision?.waveRejectionProtection;
    if (previous?.active) {
        const age = idx - Number(previous.triggerDay);
        const rawSignals = item._signals || [];
        const blockedByRiskSignal = (config.blockingSignals || []).some(signal => rawSignals.includes(signal));
        const recoveredRiskHigh = Number.isFinite(close) && close > Number(previous.triggerHigh);
        const hasFreshPostEventSignal = (meta?.windowScoreSignals || []).some(signal => Number(signal.day) > Number(previous.triggerDay));
        const stableRecovery = age >= Math.max(1, Number(config.minimumLockTradingDays) || 2)
            && Number.isFinite(close)
            && close > Number(previous.triggerClose);
        const canRelease = !blockedByRiskSignal && (recoveredRiskHigh || hasFreshPostEventSignal || stableRecovery);
        if (!canRelease) {
            return {
                ...previous,
                active: true,
                status: 'locked',
                lockAge: age,
                blockedByRiskSignal,
                targetPosition: Math.min(targetPosition, prevPos)
            };
        }
        const recoveryCap = Math.max(0, Number(config.recoveryPositionCap) || 30);
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
                recoveryPending: false,
                recoveryHoldRemaining: holdDays,
                targetPosition: Math.min(targetPosition, Math.max(prevPos, recoveryCap))
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
        if (targetPosition <= 0) return { ...previous, status: 'recovery_pending', targetPosition };
        return {
            ...previous,
            status: 'recovery_started',
            recoveryPending: false,
            recoveryHoldRemaining: Math.max(0, Number(config.recoveryHoldTradingDays) || 0),
            targetPosition: Math.min(targetPosition, Math.max(0, Number(config.recoveryPositionCap) || 30))
        };
    }

    if (Number(previous?.recoveryHoldRemaining) > 0) {
        const recoveryCap = Math.max(0, Number(config.recoveryPositionCap) || 30);
        return {
            ...previous,
            status: 'recovery_hold',
            recoveryHoldRemaining: Number(previous.recoveryHoldRemaining) - 1,
            targetPosition: Math.min(targetPosition, Math.max(prevPos, recoveryCap))
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
    const freshEntryConfig = config.freshEntryFailure;
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
    const intradayProfitRatio = high / entryClose - 1;
    const givebackRatio = high > entryClose ? (high - close) / (high - entryClose) : 0;
    const upperShadowRangeRatio = range > 0 ? upperShadow / range : 0;
    const freshEntryPressure = freshEntryConfig
        ? getWaveFreshEntryPressureContext(idx, full, state.indicators, freshEntryConfig)
        : { matched: false, sources: [] };
    const freshEntryFailureTriggered = freshEntryConfig
        && Number.isInteger(entryAge)
        && entryAge >= 1
        && entryAge <= Math.max(1, Number(freshEntryConfig.maximumEntryAgeTradingDays) || 2)
        && intradayProfitRatio >= Number(freshEntryConfig.minimumIntradayProfitRatio)
        && profitRatio <= Number(freshEntryConfig.maximumCloseProfitRatio)
        && givebackRatio >= Number(freshEntryConfig.minimumGivebackRatio)
        && volumeRatio >= Number(freshEntryConfig.minimumVolumeRatio)
        && upperShadowRangeRatio >= Number(freshEntryConfig.minimumUpperShadowRangeRatio)
        && closeLocation <= Number(freshEntryConfig.maximumCloseLocation)
        && freshEntryPressure.matched;
    const matureProfitRejectionTriggered = Number.isFinite(profitRatio)
        && profitRatio >= Number(config.minimumProfitRatio)
        && volumeRatio >= Number(config.minimumVolumeRatio)
        && nearPressure
        && upperShadow >= Math.max(body * Number(config.minimumUpperShadowBodyRatio), 0)
        && upperShadowRangeRatio >= Number(config.minimumUpperShadowRangeRatio || 0)
        && (!config.requireUpperShadowDominance || upperShadow > lowerShadow)
        && closeLocation <= Number(config.maximumCloseLocation);
    const triggered = freshEntryFailureTriggered || matureProfitRejectionTriggered;
    if (!triggered) return empty;
    return {
        active: true,
        status: 'triggered',
        triggerDay: idx,
        triggerDate: item.date || '',
        triggerHigh: high,
        triggerLow: low,
        triggerClose: close,
        entryClose,
        entryDay,
        entryAge,
        eventType: freshEntryFailureTriggered ? 'fresh_entry_failure' : 'mature_profit_rejection',
        profitRatio,
        intradayProfitRatio,
        givebackRatio,
        volumeRatio,
        upperShadowBodyRatio: body > 0 ? upperShadow / body : null,
        lowerShadow,
        upperShadowRangeRatio,
        closeLocation,
        pressureSources: freshEntryFailureTriggered ? freshEntryPressure.sources : [{ type: 'recent_high', period: null, level: previousHigh, day: null }],
        sourcePosition: prevPos,
        targetPosition: Math.min(targetPosition, getLowerWavePositionStep(prevPos, config.positionSteps)),
        recoveryPending: false,
        recoveryHoldRemaining: 0
    };
}

function getWaveL10TrendHandoffContext(idx, full, meta, prevPos, strategy = STRATEGY) {
    const config = strategy?.l10TrendHandoff;
    const empty = { eligible: false, applied: false, reason: '' };
    if (!config || (config.stocksOnly && state.mode !== 'stock') || prevPos <= 0) return empty;
    const rawSignals = full?.[idx]?._signals || [];
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

function computeDecisionForIndex(idx, full, prevPos) {
    const rawMeta = getSignalMeta(idx, full, state.indicators), market = getMarketContext(full[idx].date);
    const risk = getRiskContext(idx, full, state.indicators), rawExit = getExitSeverity(rawMeta, idx, full, state.indicators);
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
    let exit = waveL10TrendHandoff.eligible
        ? { level: '减仓观察', detail: '完整多头结构中单独出现MACD顶背离，先降仓预警，不单信号归零' }
        : rawExit;
    const b11StructureDefense = getB11StructureDefenseContext(meta, full, STRATEGY);
    let base = getBasePosition(idx, full, state.indicators, meta);
    const softSignalGrace = getSoftSignalGraceContext(meta, prevPos, base, exit, idx, STRATEGY);
    const localStructureDefense = getLocalStructureDefenseContext(meta, b11StructureDefense, prevPos, exit, STRATEGY);
    if (softSignalGrace.applied) base = prevPos;
    if (localStructureDefense.applied) base = prevPos;

    // 风险评估只决定最高允许档位，不再把仓位连续缩放成10%、20%、40%等中间值。
    let rawPosition = base, position = quantizePosition(rawPosition);
    let isCriticalExit = (rawExit.level === '清仓防守' || rawExit.level === '强离场'
        || (meta.type || '').includes('规避') || (meta.type || '').includes('破位')) && !waveL10TrendHandoff.eligible;

    if (isCriticalExit || meta.inCooldown) position = 0;
    else if (exit.level === '减仓观察' || exit.level === '延续防守') position = quantizePosition(Math.min(position, 30));

    if (meta.warningSignals?.length) position = quantizePosition(Math.min(position, 30));
    if (waveL10TrendHandoff.eligible) position = quantizePosition(Math.min(position, waveL10TrendHandoff.targetPositionCap));
    position = quantizePosition(Math.min(position, getRiskPositionCap(risk)));

    const positionCap = getPositionCap(meta, prevPos, position, idx, full, state.indicators);
    if (positionCap) position = quantizePosition(Math.min(position, positionCap.limit));

    if (position > prevPos && Math.abs(position - prevPos) <= 10) position = prevPos;
    if (prevPos === 0 && position > 0 && meta.type === '📈 趋势抱单') position = 0;
    const targetStrength = getTargetStrengthTier(meta, idx, full, state.indicators, risk, exit);
    const marketGate = applyMarketRiskGate(market, prevPos, position, targetStrength);
    position = marketGate.position;
    let waveRejectionProtection = isCriticalExit
        ? { active: false, status: 'superseded', targetPosition: position }
        : getWaveRejectionProtectionContext(idx, full, meta, prevPos, position, STRATEGY);
    if (Number.isFinite(Number(waveRejectionProtection.targetPosition))) {
        position = Math.min(position, Number(waveRejectionProtection.targetPosition));
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
    const waveDriver = waveRejectionProtection.status === 'triggered'
        ? (waveRejectionProtection.eventType === 'fresh_entry_failure'
            ? '首次建仓后冲击压力失败，当日提前防守'
            : '已有浮盈遇放量冲高回落，当日分档保护利润')
        : (waveRejectionProtection.status === 'locked'
            ? '冲高回落风险尚未解除，局部阻止旧积分立即回补'
            : (['released', 'recovery_pending'].includes(waveRejectionProtection.status)
                ? '冲高回落风险已局部解除'
                : (['recovery_started', 'recovery_hold'].includes(waveRejectionProtection.status) ? '冲高回落风险解除后分步恢复' : '')));
    const basePositionDriver = getPositionDriverText(meta, market, risk, exit, base, position, prevPos, positionCap, marketGate);
    const handoffDriver = waveL10TrendHandoff.applied ? waveL10TrendHandoff.reason : '';
    const extraDrivers = [waveDriver, handoffDriver].filter(Boolean).join('；');
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
        waveL10TrendHandoff,
        waveRejectionProtection,
        previousSoftSignalGrace: !!full?.[idx - 1]?._decision?.softSignalGrace?.applied,
        simpleAction,
        simpleColorClass,
        bsMark
    };
    const bQuality = getWaveBQualityMetadata(meta, decision);
    return bQuality ? { ...decision, ...bQuality } : decision;
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
    if (incrementalIdx === -1 && pendingMutation?.mode !== 'market-only' && state.indicatorKey === nextKey && state.indicators.macd && state.indicators.rsi && state.indicators.kdj) {
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

    if (mutation.mode === 'unchanged' && state.indicators.macd) {
        state.indicatorKey = nextKey;
        state.pendingIndicatorMutation = null;
        PERF.end(perfTrace, { status: 'unchanged-mutation', points: full.length });
        return;
    }

    if (incrementalIdx === -1 && !isMarketOnlyMutation && (mutation.mode === 'full' || mutation.mode === 'strategy-only') && derivedIndicatorCache.has(cacheKey)) {
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
        full[full.length - 2]?._signalVersion === SIGNAL_VERSION;
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
        if (!isMarketOnlyMutation && full[i]?._signals && full[i]._signalVersion === SIGNAL_VERSION && full[i]._strategy === state.strategy && full[i]._decision) {
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
