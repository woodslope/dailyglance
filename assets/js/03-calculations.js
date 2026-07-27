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

function getWindowSignalInvalidation(signal, signalDay, currentDay, full, ind, strategy = STRATEGY) {
    if (!signal?.startsWith('B') || signalDay >= currentDay) return null;
    const signalLow = Number(full?.[signalDay]?.low);
    const kValues = ind?.kdj?.k || [];
    const dValues = ind?.kdj?.d || [];
    const firstCheckDay = strategy?.monotonicSignalLifecycle ? signalDay + 1 : currentDay;
    for (let day = firstCheckDay; day <= currentDay; day++) {
        const close = Number(full?.[day]?.close);
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
    return null;
}

function calculateAllSignals(idx, full, ind) {
    if(idx < 60 || !full[idx]) return { currentDay: idx, currentDate: full?.[idx]?.date || '', currentClose: full?.[idx]?.close ?? null, buySignals: [], exitSignals: [], allSignals: {}, windowScore: 0, windowSignals: [], windowScoreSignals: [], invalidatedWindowSignals: [], inCooldown: false, cooldownDays: 3, daysSinceExit: Infinity, lastStrongExitDate: '', previousStrongExitDate: '', repeatedStrongExit: false };
    
    const rawSigs = full[idx]?._signals || calculateDailySignals(idx, full, ind), signals = {}, S = STRATEGY; 
    rawSigs.forEach(s => { signals[s] = { status: true, score: SIGNAL_SCORES[s] || 0 }; });
    
    const activeBuySignals = rawSigs.filter(s => S.buySignals?.includes(s)), activeExitSignals = rawSigs.filter(s => S.exitSignals?.includes(s));
    
    let lastExitIdx = -1, previousStrongExitIdx = -1;
    const strongExitSet = getStrongExitSignals(S);
    for(let i = idx; i >= Math.max(0, idx - 60); i--) { 
        if((full[i]?._signals || []).some(s => s.startsWith('L') && S.exitSignals?.includes(s) && strongExitSet.has(s))) {
            if(lastExitIdx < 0) lastExitIdx = i;
            else { previousStrongExitIdx = i; break; }
        }
    }
    
    const cooldownDays = 3;
    let inCooldown = false, daysSinceExit = Infinity;
    if(lastExitIdx >= 0 && lastExitIdx < idx) { daysSinceExit = idx - lastExitIdx; if(daysSinceExit <= cooldownDays) inCooldown = true; }
    const repeatedStrongExit = lastExitIdx === idx && previousStrongExitIdx >= 0 && idx - previousStrongExitIdx <= cooldownDays;
    
    let windowSignals = [], invalidatedWindowSignals = []; const usedSignals = new Set(), groupBest = new Map();
    for(let i = Math.max(0, idx - S.windowDays + 1); i <= idx; i++) {
        (full[i]?._signals || []).forEach(sig => {
            if(!usedSignals.has(sig)) {
                if(sig.startsWith('L') && S.exitSignals?.includes(sig)) { windowSignals.push({day: i, signal: sig}); usedSignals.add(sig); } 
                else if(sig.startsWith('B') && S.buySignals?.includes(sig) && i > lastExitIdx && isWindowBuySignalEligible(sig, i, full, S)) {
                    const invalidation = getWindowSignalInvalidation(sig, i, idx, full, ind, S);
                    if (invalidation) { invalidatedWindowSignals.push(invalidation); return; }
                    const score = getSignalScore(sig, S), groupKey = getScoreGroupKey(S, sig), existing = groupBest.get(groupKey);
                    if(!existing || score > existing.score) groupBest.set(groupKey, { score, signal: sig, day: i, groupKey });
                    windowSignals.push({day: i, signal: sig}); usedSignals.add(sig);
                }
            }
        });
    }
    
    const windowScoreSignals = Array.from(groupBest.values()).map(item => ({ ...item, dayOffset: idx - item.day }));
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

function strategyUsesUnconditionalExitCombo(strategy = STRATEGY) {
    return !!(strategy?.exitSignals?.includes('L3') && strategy?.exitSignals?.includes('L10'));
}

function checkUnconditionalExit(idx, full, ind) {
    if(idx < 5 || !full[idx] || !strategyUsesUnconditionalExitCombo(STRATEGY) || !(full[idx]._signals || []).includes('L3')) return false;
    for(let i = idx - 1; i >= Math.max(0, idx - 4); i--) if((full[i]?._signals || []).includes('L10')) return true;
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
    if (meta.type === '✅ 明确转强') return getReadyPositionForStrategy(STRATEGY, meta, 80);
    if (meta.type === '⚠️ 谨慎看多') return Number(STRATEGY.cautiousPosition || 0) || 50;
    if (meta.type === '👀 关注异动') return getWatchPositionForStrategy(STRATEGY, meta);
    if (meta.type === '📈 趋势抱单') {
        const holdPosition = Number(STRATEGY.holdPosition || 0);
        if (holdPosition > 0) return holdPosition;
        return (ind.ma?.[20]?.[idx] && ind.ma?.[60]?.[idx] && ind.ma[20][idx] > ind.ma[60][idx]) ? 60 : 40;
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
    if(!trends.length) return { label:'环境未知', cls:'neutral', newPositionCap:0, allowAdd:false, reason:'核心宽基数据不足，暂停开新仓和加仓', trends:[] };
    if(trends.length < CORE_MARKET_INDEX_IDS.length) return { label:'环境待确认', cls:'neutral', newPositionCap:0, allowAdd:false, reason:'三项核心宽基尚未补齐，暂停开新仓和加仓', trends };
    
    const bull = trends.filter(t => t.score > 0), bear = trends.filter(t => t.score < 0);
    
    let label, cls, newPositionCap = null, allowAdd = true, reason;
    if (bull.length >= 2) { label = '核心偏强'; cls = 'bull'; reason = '三项核心宽基多数走强，增仓门禁开放'; }
    else if (bear.length >= 2) { label = '全面弱势'; cls = 'bear'; newPositionCap = 20; allowAdd = false; reason = '三项核心宽基多数空头，新仓上限20%，已有仓位暂停加仓'; }
    else { label = '核心分化'; cls = 'neutral'; reason = '三项核心宽基未形成多数空头，个股按自身信号和风控决定仓位'; }
    return { label, cls, newPositionCap, allowAdd, reason, trends };
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

function getExitSeverity(meta, idx, full, ind) {
    const exits = meta.exitSignals || [], raw = Object.keys(meta.allSignals || {});
    if ((meta.type && meta.type.includes('清仓规避')) || (strategyUsesUnconditionalExitCombo(STRATEGY) && raw.includes('L10') && raw.includes('L3'))) return { level: '清仓防守', detail: '触发高危清仓信号' };
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
    if ((risk?.coef ?? 1) !== 1) pieces.push(`风险系数 ${risk.coef.toFixed(2)}`);
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
    const offsets = selected.map(item => Number(item.dayOffset));
    const hasToday = offsets.some(offset => offset === 0);
    const allToday = offsets.length > 0 && offsets.every(offset => offset === 0);
    const timing = allToday ? '今日出现的' : (hasToday ? '今日与近窗内的' : '近窗内的');
    const suffix = items.length > selected.length ? '等有效信号' : '有效信号';
    return { items, selected, names, timing, text: `${timing}${names.join('、')}${suffix}` };
}

function getTodaySignalInvalidations(meta, reason = '') {
    const currentDay = Number(meta?.currentDay);
    return (meta?.invalidatedWindowSignals || []).filter(item => {
        if (Number(item?.invalidationDay) !== currentDay) return false;
        return !reason || item?.reason === reason;
    });
}

function getSignalLifecycleTransition(meta, decision, mode = 'stock') {
    const hard = getTodaySignalInvalidations(meta, 'price-break');
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
        const levels = [...new Set(hard.map(item => Number(item?.invalidationLevel)).filter(Number.isFinite).map(value => value.toFixed(2)))];
        const levelText = levels.length === 1 ? `信号防守位${levels[0]}` : `相关信号防守位${levels.join('/')}`;
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

    if (position === 0 && marketGate.type === 'entry-blocked') {
        return `${decision.market.label}下增仓门禁关闭；待沪深300、中证500和中证1000补齐并重新开放后，再按个股信号考虑开仓。`;
    }

    if (marketGate.type === 'new-position-cap') {
        const stopGuard = canShowStop ? `若跌破防守位 ${stopText}，或再出离场信号，降到 0%。` : '若再出离场信号，降到 0%。';
        return `全面弱势期间新仓最多20%；待增仓门禁重新开放，且个股信号仍有效时，才考虑提高仓位。${stopGuard}`;
    }

    if (marketGate.type === 'add-blocked') {
        const stopGuard = canShowStop ? `若跌破防守位 ${stopText}，或再出离场信号，按个股规则减仓或离场。` : '若再出离场信号，按个股规则减仓或离场。';
        return `全面弱势期间暂停加仓；待增仓门禁重新开放，且个股信号仍有效时，才考虑加仓。${stopGuard}`;
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

    if (marketGate.type === 'new-position-cap') {
        const stopGuard = canShowStop ? `若跌破指数防守位 ${stopText}，或再出离场信号，将风险仓位降至 0%。` : '若再出离场信号，将风险仓位降至 0%。';
        return `核心宽基全面弱势期间新增风险仓位最多20%；待核心环境改善且指数动能仍有效时，才考虑继续提高风险暴露。${stopGuard}`;
    }

    if (marketGate.type === 'add-blocked') {
        const stopGuard = canShowStop ? `若跌破指数防守位 ${stopText}，或再出离场信号，继续降低风险暴露。` : '若再出离场信号，继续降低风险暴露。';
        return `核心宽基全面弱势期间暂停提高风险仓位；待核心环境改善且指数动能仍有效时，才考虑恢复增加。${stopGuard}`;
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

function getStockDecisionSummary(meta, decision) {
    const position = decision?.position ?? 0;
    const action = decision?.simpleAction || '持币观望';
    const exitLevel = decision?.exit?.level || '无明确离场';
    const marketLabel = decision?.market?.label || '环境未知';
    const riskFlags = decision?.risk?.flags || [];
    const scoreReady = !!decision?.signalReady || (meta?.windowScore ?? 0) >= (STRATEGY?.buyThreshold ?? Infinity);
    const hasWarning = (meta?.warningSignals || []).length > 0 || riskFlags.length > 0;
    const hasCriticalExit = ['清仓防守', '强离场'].includes(exitLevel) || ['清仓离场', '规避风险'].includes(action);
    const hasPositionExit = hasCriticalExit || action === '执行离场';
    const directExitSignals = meta?.exitSignals || [];
    const previousPosition = Number(decision?.prevAdv) || 0;
    const threshold = Number(STRATEGY?.buyThreshold);
    const scoreBelowThreshold = Number.isFinite(threshold) && (meta?.windowScore ?? 0) < threshold;
    const basePosition = Number(decision?.basePosition);
    const basePositionIsEmpty = Number.isFinite(basePosition) ? basePosition <= 0 : scoreBelowThreshold;
    const isFavorableMarket = ['核心偏强', '全面多头', '温和偏多'].includes(marketLabel);
    let stateLabel = '弱势观察';
    let userAction = '先不碰';
    if (hasCriticalExit) {
        stateLabel = '破位防守';
        userAction = position === 0 ? '空仓观望' : '优先防守';
    } else if (position === 0) {
        stateLabel = meta?.inCooldown ? '离场冷静期' : (hasPositionExit ? (basePositionIsEmpty && directExitSignals.length === 0 ? '信号失效' : '风险防守') : '弱势观察');
        userAction = hasPositionExit ? '空仓观望' : '先不碰';
    } else if (position <= 30) {
        stateLabel = action.includes('减仓') || hasWarning ? '风险观察' : '试探观察';
        userAction = action.includes('减仓') ? '降低仓位' : '只适合轻仓';
    } else if (scoreReady && position >= 50) {
        stateLabel = hasWarning ? '转强但偏热' : '趋势转强';
        userAction = position >= 80 ? '可积极关注' : '可继续观察';
    } else {
        stateLabel = '持仓观察';
        userAction = action.includes('加仓') ? '顺势持有' : '继续持有';
    }

    const scoreText = `${meta?.windowScore ?? 0}/${STRATEGY?.buyThreshold ?? '-'}`;
    const strongExitSet = getStrongExitSignals(STRATEGY);
    const strongExitSignals = directExitSignals.filter(signal => strongExitSet.has(signal));
    const otherExitSignals = directExitSignals.filter(signal => !strongExitSet.has(signal));
    const formatExitSignal = signal => `${signal} ${getUserSignalText(signal)}`;
    const hasPreviousPosition = previousPosition > 0;
    const scoreIsEmpty = (meta?.windowScore ?? 0) <= 0;
    const positionToZeroText = hasPreviousPosition ? `当前从${previousPosition}%降至 0%` : '建议仓位降至 0%';
    const positionPressure = [];
    if (Number(decision?.risk?.coef) < 1) positionPressure.push(`风险系数 ${Number(decision.risk.coef).toFixed(2)}`);
    const marketGate = decision?.marketGate || {};
    const signalCause = getSignalCauseSummary(meta);
    const buyCauseText = signalCause.text || '近窗有效买入信号';
    const lifecycleTransition = getSignalLifecycleTransition(meta, decision, 'stock');
    const isEntry = previousPosition === 0 && position > 0;
    const isIncrease = position > previousPosition;
    const isReduce = previousPosition > 0 && position < previousPosition;
    if (!hasCriticalExit && lifecycleTransition.kind === 'hard' && !isIncrease) {
        stateLabel = '信号硬失效';
        userAction = position === 0 ? '空仓观察' : '优先防守';
    } else if (!hasCriticalExit && lifecycleTransition.kind === 'soft') {
        stateLabel = '动能转弱';
        userAction = position > 0 ? '轻仓观察' : '先不碰';
    } else if (!hasCriticalExit && lifecycleTransition.kind === 'soft-expired') {
        stateLabel = '信号失效';
        userAction = '空仓观察';
    }

    let reason = '';
    if (!hasCriticalExit && position === 0 && meta?.inCooldown) {
        reason = `${getCooldownProgress(meta).label}，买入积分为 ${scoreText}，${positionToZeroText}，先空仓观察`;
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
        reason = `买入积分为 ${scoreText}，${baseText}，但${pressureText}使建议仓位归零，${positionToZeroText}，先空仓防守`;
    } else if (hasPositionExit && exitLevel === '无明确离场') {
        reason = `市场环境为${marketLabel}，当前未满足开仓条件，建议仓位降至 0%，先空仓观察`;
    } else if (hasCriticalExit && strongExitSignals.length) {
        const strongText = strongExitSignals.map(formatExitSignal).join(' / ');
        const otherText = otherExitSignals.length ? `，同时出现 ${otherExitSignals.map(formatExitSignal).join(' / ')}` : '';
        const triggerText = meta?.repeatedStrongExit ? '今日再次触发强离场' : '今日触发强离场';
        reason = `${triggerText} ${strongText}${otherText}；强离场会让此前买入积分失效，当前清零为 ${scoreText}，${positionToZeroText}；${getStrongExitCooldownText(meta)}，先空仓防守`;
    } else if (hasCriticalExit) {
        const exitReason = directExitSignals.length
            ? `出现 ${directExitSignals.map(formatExitSignal).join(' / ')}，当前按${exitLevel}处理`
            : (decision?.exit?.detail || `当前按${exitLevel}处理`);
        const zeroPositionText = position === 0 ? `，${positionToZeroText}，先空仓防守` : '，当前先处理风险';
        reason = `市场环境为${marketLabel}，${exitReason}${zeroPositionText}`;
    } else if (marketGate.type === 'entry-blocked' && position === 0) {
        reason = `${buyCauseText}使买入积分达到 ${scoreText}，但${marketLabel}下增仓门禁关闭，仍暂不开新仓`;
    } else if (marketGate.type === 'new-position-cap') {
        reason = `${buyCauseText}使买入积分达到 ${scoreText}，本次由空仓转为持仓；但全面弱势下新仓上限20%，当前只适合 ${position}% 轻仓试探`;
    } else if (marketGate.type === 'add-blocked') {
        reason = `${buyCauseText}使买入积分维持在 ${scoreText}，但全面弱势暂停加仓，当前维持${position}%`;
    } else if (isReduce) {
        const reduceCause = directExitSignals.length
            ? `出现 ${directExitSignals.map(formatExitSignal).join(' / ')}，当前按${exitLevel}处理`
            : (riskFlags.length ? `个股风险提示为${riskFlags.join('、')}` : (decision?.exit?.detail || '短线风险升高'));
        const reduceAction = position === 0 ? `当前从${previousPosition}%降至 0%，先空仓防守` : `当前从${previousPosition}%降至${position}%防守`;
        reason = `${reduceCause}，${reduceAction}`;
    } else if (position === 0) {
        reason = `${isFavorableMarket ? '大盘虽偏好，但' : ''}买入积分只有 ${scoreText}，当前还不满足开仓条件`;
    } else if (isEntry) {
        reason = `${buyCauseText}使买入积分达到 ${scoreText}，本次由空仓转为${position}%轻仓试探`;
    } else if (isIncrease) {
        reason = `${buyCauseText}使买入积分达到 ${scoreText}，当前由${previousPosition}%提高至${position}%`;
    } else if (position <= 30) {
        reason = scoreReady
            ? `${buyCauseText}使买入积分维持在 ${scoreText}，当前按${position}%轻仓继续观察`
            : `买入积分为 ${scoreText}，当前按${position}%轻仓继续观察`;
    } else {
        reason = scoreReady
            ? `${buyCauseText}使买入积分维持在 ${scoreText}，继续支持当前${position}%仓位`
            : `买入积分为 ${scoreText}，当前按${position}%仓位继续观察`;
    }
    const invalidCondition = getStockInvalidCondition(meta, decision, position, hasWarning);

    return {
        state: stateLabel,
        action: userAction,
        positionText: `${position}%`,
        reason,
        invalidCondition
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
    const formatExitSignal = signal => `${signal} ${getUserSignalText(signal)}`;
    const signalCause = getSignalCauseSummary(meta);
    const causeText = signalCause.text || '近窗有效指数信号';
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
        reason = `${getCooldownProgress(meta).label}，指数动能积分为 ${scoreText}，${riskPositionToZero}，暂不增加市场风险`;
    } else if (!hasCriticalExit && lifecycleTransition.text) {
        reason = lifecycleTransition.text;
    } else if (hasPositionExit && exitLevel === '无明确离场' && previousPosition > 0 && basePositionIsEmpty) {
        const scoreReason = scoreIsEmpty
            ? `此前指数动能已失效，积分降为 ${scoreText}`
            : `此前指数动能已不足，积分为 ${scoreText}，低于门槛 ${threshold}/${threshold}`;
        reason = `${scoreReason}，${riskPositionToZero}，暂不增加市场风险`;
    } else if (hasPositionExit && exitLevel === '无明确离场' && previousPosition > 0) {
        const pressureText = Number(decision?.risk?.coef) < 1 ? `指数风险系数 ${Number(decision.risk.coef).toFixed(2)}` : '指数自身风险限制';
        reason = `指数动能积分为 ${scoreText}，但${pressureText}使风险仓位归零，${riskPositionToZero}`;
    } else if (hasCriticalExit && strongExitSignals.length) {
        const strongText = strongExitSignals.map(formatExitSignal).join(' / ');
        const otherText = otherExitSignals.length ? `，同时出现 ${otherExitSignals.map(formatExitSignal).join(' / ')}` : '';
        const triggerText = meta?.repeatedStrongExit ? '今日指数再次触发强离场' : '今日指数触发强离场';
        reason = `${triggerText} ${strongText}${otherText}，动能积分清零为 ${scoreText}，${riskPositionToZero}；${getStrongExitCooldownText(meta)}`;
    } else if (hasCriticalExit) {
        const exitReason = directExitSignals.length
            ? `指数出现 ${directExitSignals.map(formatExitSignal).join(' / ')}，当前按${exitLevel}处理`
            : (decision?.exit?.detail || `当前指数按${exitLevel}处理`);
        reason = `${exitReason}，${position === 0 ? riskPositionToZero : '当前优先处理市场风险'}`;
    } else if (marketGate.type === 'entry-blocked' && position === 0) {
        reason = `${causeText}使指数动能积分达到 ${scoreText}，但核心宽基数据未补齐，暂不增加市场风险暴露`;
    } else if (marketGate.type === 'new-position-cap') {
        reason = `${causeText}使指数动能积分达到 ${scoreText}，风险仓位由0%提高至${position}%；但核心宽基全面弱势，新增风险仓位上限20%`;
    } else if (marketGate.type === 'add-blocked') {
        reason = `${causeText}使指数动能积分维持在 ${scoreText}，但核心宽基全面弱势，暂停提高风险仓位并维持${position}%`;
    } else if (isReduce) {
        const reduceCause = directExitSignals.length
            ? `指数出现 ${directExitSignals.map(formatExitSignal).join(' / ')}，当前按${exitLevel}处理`
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

    return {
        state: stateLabel,
        action: userAction,
        positionText: `${position}%`,
        reason,
        invalidCondition: getIndexInvalidCondition(meta, decision, position, hasWarning)
    };
}

function getNoviceDecisionSummary(meta, decision, mode = 'stock') {
    return mode === 'index'
        ? getIndexDecisionSummary(meta, decision)
        : getStockDecisionSummary(meta, decision);
}

function quantizePosition(val) { const steps = [0, 10, 20, 30, 50, 80, 100]; return steps.reduce((prev, curr) => Math.abs(curr - val) < Math.abs(prev - val) ? curr : prev); }

function getPositionCap(meta, prevPos, position) {
    if (!meta.allSignals?.W4 || prevPos <= 0 || position < 80) return null;
    return { limit: 50, reason: 'W4缩量上涨背离，高仓位上限50%' };
}

function applyMarketRiskGate(market, prevPos, targetPosition) {
    const previous = Math.max(0, Number(prevPos) || 0);
    const target = Math.max(0, Number(targetPosition) || 0);
    const label = market?.label || '环境未知';
    const configuredCap = Number.isFinite(market?.newPositionCap)
        ? Number(market.newPositionCap)
        : (label === '全面弱势' ? 20 : (label === '环境未知' || label === '环境待确认' ? 0 : null));
    const allowAdd = typeof market?.allowAdd === 'boolean'
        ? market.allowAdd
        : !['全面弱势', '环境未知', '环境待确认'].includes(label);

    if (previous === 0 && Number.isFinite(configuredCap) && target > 0 && target >= configuredCap) {
        const position = quantizePosition(Math.min(target, configuredCap));
        if (configuredCap <= 0) return { position, applied:true, type:'entry-blocked', detail:`${label}增仓门禁关闭` };
        return { position, applied:true, type:'new-position-cap', detail:`${label}新仓上限${configuredCap}%` };
    }
    if (previous > 0 && target > previous && !allowAdd) {
        const detail = label === '全面弱势' ? '全面弱势暂停加仓' : `${label}暂停加仓`;
        return { position:previous, applied:true, type:'add-blocked', detail };
    }
    return { position:target, applied:false, type:'open', detail:'' };
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

function computeDecisionForIndex(idx, full, prevPos) {
    const meta = getSignalMeta(idx, full, state.indicators), market = getMarketContext(full[idx].date);
    const risk = getRiskContext(idx, full, state.indicators), exit = getExitSeverity(meta, idx, full, state.indicators);
    let base = getBasePosition(idx, full, state.indicators, meta);
    const softSignalGrace = getSoftSignalGraceContext(meta, prevPos, base, exit, idx, STRATEGY);
    if (softSignalGrace.applied) base = prevPos;

    let rawPosition = base * risk.coef, position = quantizePosition(rawPosition);
    const isCriticalExit = exit.level === '清仓防守' || exit.level === '强离场' || (meta.type || '').includes('规避') || (meta.type || '').includes('破位');

    if (isCriticalExit || meta.inCooldown) position = 0;
    else if (exit.level === '减仓观察' || exit.level === '延续防守') position = quantizePosition(Math.min(position, 30));

    if (meta.warningSignals?.length) position = quantizePosition(Math.min(position, 40));
    if (risk.score < 40) position = quantizePosition(Math.min(position, 20));

    const positionCap = getPositionCap(meta, prevPos, position);
    if (positionCap) position = quantizePosition(Math.min(position, positionCap.limit));

    if (Math.abs(position - prevPos) <= 10 && position !== 0) position = prevPos;
    if (prevPos === 0 && position > 0 && meta.type === '📈 趋势抱单') position = 0;
    const marketGate = applyMarketRiskGate(market, prevPos, position);
    position = marketGate.position;
    const positionDriver = getPositionDriverText(meta, market, risk, exit, base, position, prevPos, positionCap, marketGate);

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
    return {
        basePosition: base,
        position,
        prevAdv: prevPos,
        market,
        marketGate,
        risk,
        exit,
        positionCap,
        positionDriver,
        signalReady: meta.windowScore >= STRATEGY.buyThreshold,
        windowScore: meta.windowScore,
        previousWindowScore: Number.isFinite(previousWindowScore) ? previousWindowScore : meta.windowScore + invalidatedTodayScore,
        softSignalGrace,
        previousSoftSignalGrace: !!full?.[idx - 1]?._decision?.softSignalGrace?.applied,
        simpleAction,
        simpleColorClass,
        bsMark
    };
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
