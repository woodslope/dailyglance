const vm = require('vm');

const STRATEGY_NAME = '白胖右侧候选研究';
const CANDIDATE_STRATEGY = {
    buySignals: ['B23', 'B24', 'B25'],
    exitSignals: ['L13', 'L14'],
    warningSignals: ['W1'],
    signalWeights: { B23: 4, B24: 4, B25: 5 },
    scoreGroups: [['B23', 'B24'], ['B25']],
    windowDays: 15,
    buyThreshold: 4,
    watchPosition: 0,
    readyPosition: 30,
    cautiousPosition: 20,
    holdPosition: 30,
    signalPositions: { B23: 20, B24: 20, B25: 30 },
    strongExitSignals: ['L13', 'L14']
};

const researchSignalSource = String.raw`
function getResearchAverageVolume(full, start, end) {
    let sum = 0, count = 0;
    for (let i = Math.max(0, start); i <= end; i++) {
        const vol = full[i]?.vol || 0;
        if (vol > 0) { sum += vol; count++; }
    }
    return count ? sum / count : 0;
}

function getBaipangBaseBreakoutLevel(full, idx) {
    if (idx < 80 || !full[idx]) return null;
    const base = full.slice(Math.max(0, idx - 45), idx).filter(Boolean);
    if (base.length < 30) return null;
    const pressure = Math.max(...base.map(d => d.high || 0));
    const support = Math.min(...base.map(d => d.low || Infinity));
    if (!pressure || !Number.isFinite(support) || support <= 0) return null;
    const rangePct = (pressure - support) / support;
    return rangePct <= 0.25 ? { level: pressure, support, rangePct } : null;
}

function checkBaipangBaseBreakout(ctx) {
    const base = getBaipangBaseBreakoutLevel(ctx.full, ctx.idx);
    if (!base || !ctx.prev || !ctx.item) return false;
    const close = ctx.item.close || 0, open = ctx.item.open || close, prevClose = ctx.prev.close || 0;
    const avgVol20 = getResearchAverageVolume(ctx.full, ctx.idx - 20, ctx.idx - 1);
    if (!close || !prevClose || !avgVol20) return false;
    return prevClose <= base.level * 1.01 && close >= base.level * 1.01 && (ctx.item.vol || 0) >= avgVol20 * 1.25 && close > open && (!ctx.ma20 || close >= ctx.ma20);
}

function getBaipangHalfBreakoutLevel(full, idx) {
    if (idx < 70 || !full[idx]) return null;
    const start = Math.max(0, idx - 60);
    let high = 0, highIdx = -1;
    for (let i = start; i < idx - 3; i++) {
        const value = full[i]?.high || 0;
        if (value > high) { high = value; highIdx = i; }
    }
    if (highIdx < 0) return null;
    let low = Infinity, lowIdx = -1;
    for (let i = highIdx + 1; i < idx; i++) {
        const value = full[i]?.low || Infinity;
        if (value < low) { low = value; lowIdx = i; }
    }
    if (lowIdx < 0 || !Number.isFinite(low) || low <= 0 || lowIdx >= idx || (high - low) / high < 0.08) return null;
    return { level: (high + low) / 2, high, low, highIdx, lowIdx };
}

function checkBaipangHalfBreakout(ctx) {
    const half = getBaipangHalfBreakoutLevel(ctx.full, ctx.idx);
    if (!half || !ctx.prev || !ctx.item) return false;
    const close = ctx.item.close || 0, open = ctx.item.open || close;
    const avgVol20 = getResearchAverageVolume(ctx.full, ctx.idx - 20, ctx.idx - 1);
    return !!avgVol20 && ctx.prev.close <= half.level && close > half.level && (ctx.item.vol || 0) >= avgVol20 * 1.2 && close > open;
}

function getBaipangSignalSupport(full, idx, sigs = null) {
    const signals = sigs || full[idx]?._signals || [];
    if (signals.includes('B24')) return getBaipangHalfBreakoutLevel(full, idx);
    if (signals.includes('B23')) return getBaipangBaseBreakoutLevel(full, idx);
    return null;
}

function findRecentBaipangEntry(full, idx, lookback = 15, includePullback = true) {
    const accepted = includePullback ? ['B25', 'B24', 'B23'] : ['B24', 'B23'];
    for (let i = idx - 1; i >= Math.max(0, idx - lookback); i--) {
        const sigs = full[i]?._signals || [];
        if (!sigs.some(sig => accepted.includes(sig))) continue;
        let support = getBaipangSignalSupport(full, i, sigs);
        if (!support && sigs.includes('B25')) support = findRecentBaipangEntry(full, i, 15, false)?.support;
        if (support?.level) return { idx: i, support };
    }
    return null;
}

function checkBaipangPullbackConfirm(ctx) {
    const entry = findRecentBaipangEntry(ctx.full, ctx.idx, 15, false);
    if (!entry || !ctx.prev || !ctx.item) return false;
    const days = ctx.idx - entry.idx;
    if (days < 1 || days > 15) return false;
    const level = entry.support.level, close = ctx.item.close || 0, open = ctx.item.open || close;
    const touchedSupport = (ctx.item.low || close) <= level * 1.035 || (ctx.prev.low || close) <= level * 1.035 || (ctx.ma20 && (ctx.item.low || close) <= ctx.ma20 * 1.02);
    return touchedSupport && close >= level * 0.98 && (close > open || close > (ctx.prev.close || 0));
}

function checkBaipangKeyLevelFailure(ctx) {
    const entry = findRecentBaipangEntry(ctx.full, ctx.idx, 20, true);
    if (!entry || !ctx.prev || !ctx.item) return false;
    const level = entry.support.level, close = ctx.item.close || 0;
    const avgVol20 = getResearchAverageVolume(ctx.full, ctx.idx - 20, ctx.idx - 1);
    return close < level * 0.97 || (ctx.prev.close >= level && close < level && avgVol20 && (ctx.item.vol || 0) >= avgVol20 * 1.1);
}

function checkBaipangTimeStop(ctx) {
    const entry = findRecentBaipangEntry(ctx.full, ctx.idx, 13, true);
    if (!entry || !ctx.item) return false;
    const days = ctx.idx - entry.idx;
    if (days < 8 || days > 13) return false;
    const entryClose = ctx.full[entry.idx]?.close || 0, close = ctx.item.close || 0;
    if (!entryClose || !close) return false;
    const maxHigh = Math.max(...ctx.full.slice(entry.idx, ctx.idx + 1).filter(Boolean).map(d => d.high || 0));
    return maxHigh < entryClose * 1.1 && (close <= entryClose * 1.03 || (ctx.ma20 && close < ctx.ma20) || close < (ctx.prev?.close || close));
}
`;

function installBaipangCandidate(context) {
    const installSource = `
        if (!STRATEGIES[${JSON.stringify(STRATEGY_NAME)}]) {
            STRATEGIES[${JSON.stringify(STRATEGY_NAME)}] = ${JSON.stringify(CANDIDATE_STRATEGY)};
            ${researchSignalSource}
            SIGNAL_RULES.push(
                { id: 'B23', check: ctx => checkBaipangBaseBreakout(ctx) },
                { id: 'B24', check: ctx => checkBaipangHalfBreakout(ctx) },
                { id: 'B25', check: ctx => checkBaipangPullbackConfirm(ctx) },
                { id: 'L13', check: ctx => checkBaipangKeyLevelFailure(ctx) },
                { id: 'L14', check: ctx => checkBaipangTimeStop(ctx) }
            );
        }
    `;
    vm.runInContext(installSource, context);
}

module.exports = { STRATEGY_NAME, CANDIDATE_STRATEGY, installBaipangCandidate };
