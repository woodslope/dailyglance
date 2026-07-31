#!/usr/bin/env node

// Replays the production wave-bottom decision chain. It never changes a decision;
// it only evaluates whether an existing first B has stronger historical confirmation.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const {
    stableHash,
    hashFile,
    buildCalendarWindows
} = require('./strategy-evaluator');
const {
    START_INDEX,
    createProductionContext,
    loadCacheSymbols,
    prepareSymbolContext,
    runProductionChain
} = require('./strategy-formal-baseline');

const ROOT = path.resolve(__dirname, '..');
const REPORT_DIR = path.join(ROOT, '.local', 'strategy-reports');
const POLICY = JSON.parse(fs.readFileSync(path.join(ROOT, 'strategy-validation-policy.json'), 'utf8'));
const STRATEGY = '波段抄底型';
const HORIZONS = [5, 10, 20];
const QUALITY_POLICY = POLICY.waveBQuality || {};
const MIN_SAMPLES = Number(QUALITY_POLICY.minimumSamples) || 30;
const MIN_SYMBOLS = Number(QUALITY_POLICY.minimumSymbols) || 10;
const MIN_SUCCESS_ADVANTAGE = Number(QUALITY_POLICY.minimumSuccessAdvantage) || 0.15;
const MIN_FAILURE_ADVANTAGE = Number(QUALITY_POLICY.minimumFailureAdvantage) || 0.10;
const MAX_SYMBOL_SHARE = Number(QUALITY_POLICY.maximumSymbolShare) || 0.25;
const MAX_YEAR_SHARE = Number(QUALITY_POLICY.maximumYearShare) || 0.35;
const MIN_RETURN_ADVANTAGES = Number(QUALITY_POLICY.minimumReturnAdvantages) || 2;
const MIN_DELAYED_COST_ADVANTAGES = Number(QUALITY_POLICY.minimumDelayedCostAdvantages) || 2;
const STRESS_SCENARIO = QUALITY_POLICY.stressScenario || {};
const STRESS_ENTRY_DELAY_BARS = Number(STRESS_SCENARIO.entryDelayBars) || 1;
const STRESS_COST_RATE = Number(STRESS_SCENARIO.costRate) || 0.002;
const MIN_TEMPORAL_SAMPLES = Number(QUALITY_POLICY.minimumTemporalSamples) || 5;
const MIN_POSITIVE_TEMPORAL_WINDOWS = Number(QUALITY_POLICY.minimumPositiveTemporalWindows) || 2;
const WAVE_SIGNAL_IDS = ['B5', 'B6', 'B7', 'B8', 'B9', 'B11', 'B16', 'B17'];
const REGISTERED_RULE = QUALITY_POLICY.registeredRule || {};
const REGISTERED_SIGNAL_FILTER = normalizeSignalList(REGISTERED_RULE.requiredSignals || ['B8', 'B17']);
const DISCOVERY_ENABLED = process.argv.includes('--discover');
const FEATURE_SEARCH_ENABLED = process.argv.includes('--with-features');
const SCORE_SEARCH_ENABLED = process.argv.includes('--with-scores');
const QUALITY_ONLY = process.argv.includes('--quality-only');
const INCLUDE_EVENT_DETAILS = process.argv.includes('--event-details');
const SIGNAL_FILTER_ARG = process.argv.find(arg => arg.startsWith('--signals='));
const SIGNAL_FILTER = SIGNAL_FILTER_ARG
    ? normalizeSignalList(SIGNAL_FILTER_ARG.slice('--signals='.length).split(','))
    : null;
const QUALITY_FEATURE_ARG = process.argv.find(arg => arg.startsWith('--quality-feature='));
const QUALITY_FEATURE_FILTER = QUALITY_FEATURE_ARG ? QUALITY_FEATURE_ARG.slice('--quality-feature='.length).trim() : null;
const QUALITY_FEATURES = [
    { id: 'risk_ge_70', label: '风险系数不低于70', test: item => item.riskScore >= 70 },
    { id: 'market_not_bear', label: '市场未处于全面弱势', test: item => item.marketLabel !== '全面弱势' },
    { id: 'vol_ge_20', label: '成交量不低于20日均量', test: item => item.volRel20 >= 1 },
    { id: 'weekly_support', label: '周线支撑未失守', test: item => item.weeklySupport },
    { id: 'drawdown_ge_10', label: '近60日回撤不少于10%', test: item => item.drawdown60 >= 0.10 },
    { id: 'ma20_rising', label: 'MA20保持上行', test: item => item.ma20Rising },
    { id: 'ma20_above_ma60', label: 'MA20位于MA60上方', test: item => item.ma20AboveMa60 },
    { id: 'quality_strong_reversal_bar', label: '强势反转K线确认', test: item => item.qualityStrongReversalBar },
    { id: 'quality_macd_acceleration', label: 'MACD动能连续改善', test: item => item.qualityMacdAcceleration },
    { id: 'quality_higher_low_reclaim', label: '低点抬高并收复前收', test: item => item.qualityHigherLowReclaim }
];

if (process.argv.includes('--include-indices')) {
    throw new Error('金色 B 质量研究只面向股票；指数不得与股票混合筛选或展示。');
}
if (QUALITY_ONLY) {
    throw new Error('质量特征不能脱离既有波段买入信号单独构成金色 B 候选。');
}
if (!DISCOVERY_ENABLED && !SIGNAL_FILTER && require.main === module) {
    throw new Error('质量复核必须显式传入 --signals=B8,B17；只有 --discover 才允许枚举候选，且枚举结果不能直接启用展示。');
}
if (!DISCOVERY_ENABLED && (FEATURE_SEARCH_ENABLED || SCORE_SEARCH_ENABLED || QUALITY_FEATURE_FILTER)) {
    throw new Error('正式质量复核只允许预注册信号组合；特征、积分阈值和质量条件搜索必须显式使用 --discover。');
}
if (!DISCOVERY_ENABLED && SIGNAL_FILTER && SIGNAL_FILTER.join(',') !== REGISTERED_SIGNAL_FILTER.join(',')) {
    throw new Error(`正式质量复核只允许预注册组合 --signals=${REGISTERED_SIGNAL_FILTER.join(',')}。`);
}

function normalizeSignalList(values) {
    const requested = new Set((values || []).map(item => String(item || '').trim()).filter(Boolean));
    const unknown = [...requested].filter(signal => !WAVE_SIGNAL_IDS.includes(signal));
    if (unknown.length) throw new Error(`未知波段买入信号：${unknown.join(',')}`);
    return WAVE_SIGNAL_IDS.filter(signal => requested.has(signal));
}

function round(value, digits = 4) {
    return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function mean(values) {
    const valid = values.filter(Number.isFinite);
    return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : NaN;
}

function maxShare(items, key, predicate = () => true) {
    const counts = new Map();
    items.filter(predicate).forEach(item => counts.set(item[key], (counts.get(item[key]) || 0) + 1));
    return items.length && counts.size ? Math.max(...counts.values()) / items.length : 0;
}

function labelOutcome(rows, index) {
    const signal = rows[index];
    const target = Number(signal.close) * 1.05;
    const stop = Number(signal.low);
    let maxFavorable = 0;
    let maxAdverse = 0;
    for (let offset = 1; offset <= 20 && index + offset < rows.length; offset++) {
        const row = rows[index + offset];
        maxFavorable = Math.max(maxFavorable, Number(row.high) / Number(signal.close) - 1);
        maxAdverse = Math.min(maxAdverse, Number(row.low) / Number(signal.close) - 1);
        const up = Number(row.high) >= target;
        const down = Number(row.low) < stop;
        if (up && down) return { outcome: 'indeterminate', offset, maxFavorable, maxAdverse };
        if (up) return { outcome: 'success', offset, maxFavorable, maxAdverse };
        if (down) return { outcome: 'failure', offset, maxFavorable, maxAdverse };
    }
    return { outcome: 'neutral', offset: 20, maxFavorable, maxAdverse };
}

function returns(rows, index, entryIndex = index, cost = 0) {
    const entry = Number(rows[entryIndex]?.close);
    return Object.fromEntries(HORIZONS.map(days => {
        const exit = Number(rows[entryIndex + days]?.close);
        return [days, Number.isFinite(entry) && entry > 0 && Number.isFinite(exit) ? exit / entry - 1 - cost : null];
    }));
}

function snapshotFeatureRows(context, symbol) {
    context.__bQualitySymbol = { id: symbol.id };
    return JSON.parse(vm.runInContext(`
        (function() {
            const full = state.rawData[__bQualitySymbol.id] || [];
            const ind = state.indicators;
            const weekly = state.weeklyData[__bQualitySymbol.id] || [];
            const weeklyMa20 = Calcs.ma(weekly, 20), weeklyMa60 = Calcs.ma(weekly, 60);
            const average = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
            return JSON.stringify(full.map((row, idx) => {
                if (row._decision?.bsMark !== 'B') return null;
                const meta = getSignalMeta(idx, full, ind);
                const risk = getRiskContext(idx, full, ind);
                const dayWeeklyIndex = weekly.findIndex(item => item.date >= row.date);
                const weekIdx = dayWeeklyIndex >= 0 ? dayWeeklyIndex : weekly.length - 1;
                const w = weekly[weekIdx] || {};
                const ma20w = weeklyMa20[weekIdx], ma60w = weeklyMa60[weekIdx];
                const vol20 = full.slice(Math.max(0, idx - 19), idx + 1).map(item => Number(item.vol) || 0);
                const vol60 = full.slice(Math.max(0, idx - 59), idx + 1).map(item => Number(item.vol) || 0);
                const high60 = Math.max(...full.slice(Math.max(0, idx - 59), idx + 1).map(item => Number(item.high) || 0));
                const prev = full[idx - 1] || {}, prev2 = full[idx - 2] || {};
                const atr = getATR(full, idx);
                const range = Math.max(Number(row.high) - Number(row.low), 0.0001);
                const body = Number(row.close) - Number(row.open);
                const closeLocation = (Number(row.close) - Number(row.low)) / range;
                const diff = Number(ind.macd?.diff?.[idx]);
                const prevDiff = Number(ind.macd?.diff?.[idx - 1]);
                const prev2Diff = Number(ind.macd?.diff?.[idx - 2]);
                const histogram = diff - Number(ind.macd?.dea?.[idx]);
                const prevHistogram = prevDiff - Number(ind.macd?.dea?.[idx - 1]);
                const combination = (meta.windowScoreSignals || []).map(item => item.signal).sort();
                return {
                    date: row.date,
                    bsMark: row._decision?.bsMark || null,
                    position: row._decision?.position || 0,
                    signals: combination,
                    windowScore: Number(meta.windowScore) || 0,
                    effectiveSignalCount: combination.length,
                    drawdown60: high60 > 0 ? (high60 - Number(row.close)) / high60 : 0,
                    volRel20: average(vol20) > 0 ? (Number(row.vol) || 0) / average(vol20) : null,
                    volRel60: average(vol60) > 0 ? (Number(row.vol) || 0) / average(vol60) : null,
                    ma20: Number(ind.ma?.[20]?.[idx]) || null,
                    ma60: Number(ind.ma?.[60]?.[idx]) || null,
                    ma20Rising: !!(ind.ma?.[20]?.[idx] && ind.ma?.[20]?.[idx - 1]
                        && Number(ind.ma[20][idx]) > Number(ind.ma[20][idx - 1])),
                    ma20AboveMa60: !!(ind.ma?.[20]?.[idx] && ind.ma?.[60]?.[idx]
                        && Number(ind.ma[20][idx]) > Number(ind.ma[60][idx])),
                    qualityStrongReversalBar: !!(atr > 0 && body >= atr * 0.5 && closeLocation >= 0.75
                        && Number(row.close) > Number(prev.close)),
                    qualityMacdAcceleration: !!(Number.isFinite(diff) && Number.isFinite(prevDiff)
                        && Number.isFinite(prev2Diff) && diff > prevDiff && prevDiff > prev2Diff
                        && histogram > prevHistogram),
                    qualityHigherLowReclaim: !!(Number(row.low) >= Number(prev.low)
                        && Number(row.close) > Number(prev.close) && Number(prev.close) <= Number(prev2.close)),
                    weeklySupport: !!(w.close && ma20w && ma60w && Number(w.close) >= Math.min(Number(ma20w), Number(ma60w))),
                    weeklyStructure: w.close && ma20w && ma60w
                        ? (Number(w.close) >= Number(ma20w) && Number(ma20w) >= Number(ma60w)
                            ? 'bull'
                            : (Number(w.close) < Number(ma20w) && Number(ma20w) < Number(ma60w) ? 'bear' : 'range'))
                        : 'unknown',
                    riskScore: Number(risk.score) || 0,
                    marketLabel: row._decision?.market?.label || '',
                    exitLevel: row._decision?.exit?.level || ''
                };
            }));
        })()
    `, context));
}

function getGateMetric(summary, key) {
    return summary?.gateMetrics?.[key] ?? summary?.[key];
}

function getGateReturn(summary, key, days) {
    return summary?.gateMetrics?.[key]?.[days] ?? summary?.[key]?.[days];
}

function summarize(items, baseline) {
    const classified = items.filter(item => item.outcome !== 'indeterminate');
    const rawSuccessRate = classified.length ? classified.filter(item => item.outcome === 'success').length / classified.length : 0;
    const rawFailureRate = classified.length ? classified.filter(item => item.outcome === 'failure').length / classified.length : 0;
    const rawReturns = Object.fromEntries(HORIZONS.map(days => [days, mean(items.map(item => item.returns[days]))]));
    const rawDelayedCostReturns = Object.fromEntries(HORIZONS.map(days => [days, mean(items.map(item => item.delayedCostReturns[days]))]));
    const rawMaxSymbolShare = maxShare(items, 'symbol');
    const rawMaxIndexShare = maxShare(items, 'symbol', item => item.mode === 'index');
    const rawMaxYearShare = maxShare(items, 'year');
    const returnAdvantages = HORIZONS.map(days => rawReturns[days] > getGateReturn(baseline, 'returns', days));
    const delayedCostAdvantages = HORIZONS.map(days => rawDelayedCostReturns[days] > getGateReturn(baseline, 'delayedCostReturns', days));
    return {
        samples: items.length,
        classifiedSamples: classified.length,
        indeterminateSamples: items.length - classified.length,
        symbols: new Set(items.map(item => item.symbol)).size,
        indices: new Set(items.filter(item => item.mode === 'index').map(item => item.symbol)).size,
        successRate: round(rawSuccessRate),
        failureRate: round(rawFailureRate),
        neutralRate: round(classified.length ? classified.filter(item => item.outcome === 'neutral').length / classified.length : 0),
        returns: Object.fromEntries(HORIZONS.map(days => [days, round(rawReturns[days])])),
        delayedCostReturns: Object.fromEntries(HORIZONS.map(days => [days, round(rawDelayedCostReturns[days])])),
        maxSymbolShare: round(rawMaxSymbolShare),
        maxIndexShare: round(rawMaxIndexShare),
        maxYearShare: round(rawMaxYearShare),
        temporalAdvantages: returnAdvantages.filter(Boolean).length,
        delayedCostAdvantages: delayedCostAdvantages.filter(Boolean).length,
        averageMfe20: round(mean(items.map(item => item.maxFavorable))),
        averageMae20: round(mean(items.map(item => item.maxAdverse))),
        gateMetrics: {
            successRate: rawSuccessRate,
            failureRate: rawFailureRate,
            returns: rawReturns,
            delayedCostReturns: rawDelayedCostReturns,
            maxSymbolShare: rawMaxSymbolShare,
            maxYearShare: rawMaxYearShare
        }
    };
}

function getTemporalGate(calendarStages) {
    const eligible = (calendarStages || []).filter(stage => stage.samples >= MIN_TEMPORAL_SAMPLES);
    const positive = eligible.filter(stage => stage.return20Advantage);
    return {
        eligibleWindows: eligible.length,
        positiveWindows: positive.length,
        pass: eligible.length >= MIN_POSITIVE_TEMPORAL_WINDOWS
            && positive.length >= MIN_POSITIVE_TEMPORAL_WINDOWS
    };
}

function passes(summary, baseline, calendarStages = []) {
    const contributionPass = getGateMetric(summary, 'maxSymbolShare') <= MAX_SYMBOL_SHARE
        && getGateMetric(summary, 'maxYearShare') <= MAX_YEAR_SHARE;
    const temporal = getTemporalGate(calendarStages);
    return {
        samples: summary.classifiedSamples >= MIN_SAMPLES,
        symbols: summary.symbols >= MIN_SYMBOLS,
        success: getGateMetric(summary, 'successRate') - getGateMetric(baseline, 'successRate') >= MIN_SUCCESS_ADVANTAGE,
        failure: getGateMetric(baseline, 'failureRate') - getGateMetric(summary, 'failureRate') >= MIN_FAILURE_ADVANTAGE,
        returnWindows: summary.temporalAdvantages >= MIN_RETURN_ADVANTAGES,
        contribution: contributionPass,
        delayAndCost: summary.delayedCostAdvantages >= MIN_DELAYED_COST_ADVANTAGES,
        temporal: temporal.pass
    };
}

function passedCheckCount(checks) {
    return Object.values(checks).filter(Boolean).length;
}

function candidateDefinitions(events) {
    const definitions = [];
    const scoreThresholds = DISCOVERY_ENABLED && SCORE_SEARCH_ENABLED
        ? Array.from(new Set(events.map(event => Number(event.windowScore) || 0).filter(score => score >= 4))).sort((a, b) => a - b)
        : [null];
    const requestedFeature = QUALITY_FEATURE_FILTER
        ? QUALITY_FEATURES.find(item => item.id === QUALITY_FEATURE_FILTER)
        : null;
    if (QUALITY_FEATURE_FILTER && (!requestedFeature || !requestedFeature.id.startsWith('quality_'))) {
        throw new Error(`unknown quality feature: ${QUALITY_FEATURE_FILTER}`);
    }
    const masks = DISCOVERY_ENABLED
        ? Array.from({ length: (1 << WAVE_SIGNAL_IDS.length) - 1 }, (_, index) => index + 1)
        : [WAVE_SIGNAL_IDS.reduce((mask, signal, index) => SIGNAL_FILTER?.includes(signal) ? mask | (1 << index) : mask, 0)];
    for (const mask of masks) {
        const requiredSignals = WAVE_SIGNAL_IDS.filter((_, index) => (mask & (1 << index)) !== 0);
        if (!requiredSignals.length) continue;
        if (SIGNAL_FILTER && requiredSignals.join(',') !== SIGNAL_FILTER.join(',')) continue;
        const variants = requestedFeature
            ? [[requestedFeature.id]]
            : (FEATURE_SEARCH_ENABLED ? [[]].concat(QUALITY_FEATURES.map(feature => [feature.id])) : [[]]);
        for (const minScore of scoreThresholds) {
            for (const features of variants) {
                definitions.push({
                    id: `signals_${requiredSignals.join('_')}${minScore ? `__score_ge_${minScore}` : ''}${features.length ? `__${features[0]}` : ''}`,
                    requiredSignals,
                    minScore,
                    features
                });
            }
        }
    }
    return definitions.map(definition => ({
        ...definition,
        items: events.filter(event => definition.requiredSignals.every(signal => event.signals.includes(signal))
            && (!definition.minScore || Number(event.windowScore) >= definition.minScore)
            && definition.features.every(id => QUALITY_FEATURES.find(feature => feature.id === id).test(event)))
    }));
}

function summarizeCalendarStages(items, baselineItems, windows) {
    return windows.map(window => {
        const within = event => event.date >= window.startDate && event.date <= window.endDate;
        const baseline = summarize(baselineItems.filter(within), { returns: {}, delayedCostReturns: {} });
        const summary = summarize(items.filter(within), baseline);
        return {
            ...window,
            samples: summary.samples,
            successRate: summary.successRate,
            failureRate: summary.failureRate,
            return20: summary.returns[20],
            baselineReturn20: baseline.returns[20],
            return20Advantage: getGateReturn(summary, 'returns', 20) > getGateReturn(baseline, 'returns', 20)
        };
    });
}

function eventDetail(item) {
    return {
        symbol: item.symbol,
        name: item.name,
        mode: item.mode,
        date: item.date,
        year: item.year,
        signals: item.signals,
        outcome: item.outcome,
        returns: item.returns,
        delayedCostReturns: item.delayedCostReturns,
        maxFavorable: item.maxFavorable,
        maxAdverse: item.maxAdverse
    };
}

function main() {
    const loaded = loadCacheSymbols();
    const { universe } = loaded;
    const commonAsOf = loaded.symbols.map(symbol => symbol.rows.at(-1)?.date).filter(Boolean).sort()[0] || '';
    const allSymbols = loaded.symbols.map(symbol => ({
        ...symbol,
        rows: symbol.rows.filter(row => !commonAsOf || row.date <= commonAsOf)
    }));
    const symbols = allSymbols.filter(symbol => symbol.mode === 'stock');
    const indexData = Object.fromEntries(allSymbols.filter(symbol => symbol.mode === 'index').map(symbol => [symbol.id, symbol.rows]));
    const requiredIndexIds = ['sh', 'sz', 'hs300', 'zz500', 'zz1000', 'cy', 'kc50', 'bz50'];
    const missingIndexIds = requiredIndexIds.filter(id => !indexData[id]);
    if (missingIndexIds.length) throw new Error(`质量复核缺少市场门禁指数缓存：${missingIndexIds.join(',')}`);
    const referenceId = POLICY.temporalWindows.referenceIndex;
    const referenceRows = indexData[referenceId];
    if (!referenceRows) throw new Error(`质量复核缺少时间窗口参考指数：${referenceId}`);
    const calendarWindows = buildCalendarWindows(referenceRows, POLICY);
    if (calendarWindows.length !== POLICY.temporalWindows.count) {
        throw new Error(`质量复核需要 ${POLICY.temporalWindows.count} 个独立时间窗口，当前只有 ${calendarWindows.length} 个。`);
    }
    const snapshotFiles = allSymbols.map(symbol => ({
        id: symbol.id,
        file: symbol.cacheFile,
        sha256: hashFile(path.join(ROOT, '.local', 'strategy-cache', symbol.cacheFile)),
        rows: symbol.rows.length,
        first: symbol.rows[0]?.date || '',
        last: symbol.rows.at(-1)?.date || ''
    }));
    const context = createProductionContext(indexData);
    const events = [];
    let appBuild = '', signalVersion = '';
    for (const [symbolIndex, symbol] of symbols.entries()) {
        const prepared = prepareSymbolContext(context, symbol);
        const result = runProductionChain(context, symbol, STRATEGY, prepared);
        appBuild = result.appBuild || appBuild;
        signalVersion = result.signalVersion || signalVersion;
        const features = snapshotFeatureRows(context, symbol);
        result.rows.forEach((row, index) => {
            if (index < START_INDEX || row.bsMark !== 'B' || index + STRESS_ENTRY_DELAY_BARS + Math.max(...HORIZONS) >= result.rows.length) return;
            const feature = features[index];
            const outcome = labelOutcome(symbol.rows, index);
            events.push({
                symbol: symbol.id,
                name: symbol.name,
                mode: symbol.mode,
                year: String(row.date || '').slice(0, 4),
                date: row.date,
                ...feature,
                ...outcome,
                returns: returns(symbol.rows, index),
                delayedCostReturns: returns(symbol.rows, index, index + STRESS_ENTRY_DELAY_BARS, STRESS_COST_RATE)
            });
        });
        if (process.argv.includes('--progress')) console.error(`[wave-b-quality] ${symbolIndex + 1}/${symbols.length} ${symbol.id}`);
    }
    const baseline = summarize(events, { returns: {}, delayedCostReturns: {} });
    const stockEvents = events.filter(event => event.mode === 'stock');
    const stockBaseline = summarize(stockEvents, { returns: {}, delayedCostReturns: {} });
    const strictReview = !DISCOVERY_ENABLED && !FEATURE_SEARCH_ENABLED && !SCORE_SEARCH_ENABLED
        && !QUALITY_FEATURE_FILTER && !QUALITY_ONLY
        && SIGNAL_FILTER?.join(',') === REGISTERED_SIGNAL_FILTER.join(',');
    const candidates = candidateDefinitions(events).map(candidate => {
        const summary = summarize(candidate.items, baseline);
        const calendarStages = summarizeCalendarStages(candidate.items, events, calendarWindows);
        const checks = passes(summary, baseline, calendarStages);
        const temporalGate = getTemporalGate(calendarStages);
        const historicalQualified = Object.values(checks).every(Boolean);
        return {
            id: candidate.id,
            requiredSignals: candidate.requiredSignals,
            minScore: candidate.minScore,
            features: candidate.features,
            summary,
            stocks: summarize(candidate.items, stockBaseline),
            calendarStages,
            temporalGate,
            checks,
            historicalQualified,
            status: historicalQualified && strictReview ? 'recommend_shadow' : 'insufficient_evidence',
            activation: '禁止直接启用展示；须先完成冻结后的独立前向观察。',
            eventDetails: INCLUDE_EVENT_DETAILS ? candidate.items.map(eventDetail) : undefined
        };
    }).sort((left, right) => Number(right.historicalQualified) - Number(left.historicalQualified)
        || right.summary.successRate - left.summary.successRate
        || left.summary.failureRate - right.summary.failureRate
        || right.summary.samples - left.summary.samples);
    const report = {
        generatedAt: new Date().toISOString(),
        method: 'production-js-vm-wave-first-b-quality-replay',
        appBuild,
        signalVersion,
        scope: {
            symbols: symbols.length,
            stocks: symbols.filter(symbol => symbol.mode === 'stock').length,
            indices: 0,
            commonAsOf
        },
        policy: {
            startIndex: START_INDEX,
            horizons: HORIZONS,
            outcome: '后续20个交易日内，先以盘中高价达到信号日收盘价+5%为成功；先以盘中低价跌破信号日低点为失败；同日双触发顺序不明，保守排除。',
            thresholds: {
                MIN_SAMPLES,
                MIN_SYMBOLS,
                MIN_SUCCESS_ADVANTAGE,
                MIN_FAILURE_ADVANTAGE,
                MAX_SYMBOL_SHARE,
                MAX_YEAR_SHARE,
                MIN_RETURN_ADVANTAGES,
                MIN_DELAYED_COST_ADVANTAGES,
                MIN_TEMPORAL_SAMPLES,
                MIN_POSITIVE_TEMPORAL_WINDOWS
            },
            delayedCost: {
                id: STRESS_SCENARIO.id || 'delay_one_bar_cost_020',
                label: STRESS_SCENARIO.label || '延迟一根K线成交，单边成本0.20%',
                entryDelayBars: STRESS_ENTRY_DELAY_BARS,
                costRate: STRESS_COST_RATE
            }
        },
        candidateSearch: {
            signalIds: WAVE_SIGNAL_IDS,
            signalSubsets: DISCOVERY_ENABLED ? (1 << WAVE_SIGNAL_IDS.length) - 1 : 1,
            featureVariantsPerSubset: FEATURE_SEARCH_ENABLED ? QUALITY_FEATURES.length + 1 : 1,
            totalCandidates: candidates.length,
            signalFilter: SIGNAL_FILTER,
            discoveryEnabled: DISCOVERY_ENABLED,
            featureSearchEnabled: FEATURE_SEARCH_ENABLED,
            scoreSearchEnabled: SCORE_SEARCH_ENABLED,
            qualityOnly: QUALITY_ONLY,
            qualityFeatureFilter: QUALITY_FEATURE_FILTER,
            strictReview,
            preRegistration: {
                ruleId: REGISTERED_RULE.id || null,
                strategy: REGISTERED_RULE.strategy || STRATEGY,
                scope: REGISTERED_RULE.scope || 'stock',
                requiredSignals: REGISTERED_SIGNAL_FILTER
            },
            scope: 'stock-only',
            featureRule: '辅助条件只能附加在至少一个既有波段买入信号组合上；成交量不单独构成候选。',
            activationRule: '发现型枚举结果和历史回放结果都不能直接启用金色 B；必须冻结后完成独立前向观察。'
        },
        dataSnapshot: {
            universeHash: stableHash(universe),
            policyHash: stableHash(POLICY),
            commonAsOf,
            hash: stableHash(snapshotFiles),
            files: snapshotFiles,
            referenceIndex: referenceId,
            referenceDates: referenceRows.map(row => row.date).filter(Boolean),
            temporalWindows: calendarWindows
        },
        sourceSnapshot: {
            hash: stableHash({
                config: hashFile(path.join(ROOT, 'assets/js/01-config-ui.js')),
                data: hashFile(path.join(ROOT, 'assets/js/02-data.js')),
                calculations: hashFile(path.join(ROOT, 'assets/js/03-calculations.js')),
                policy: hashFile(path.join(ROOT, 'strategy-validation-policy.json')),
                universe: hashFile(path.join(ROOT, 'strategy-validation-universe.json')),
                qualityReport: hashFile(__filename),
                qualityShadow: hashFile(path.join(ROOT, 'scripts/strategy-wave-b-quality-shadow.js'))
            }),
            files: {
                config: hashFile(path.join(ROOT, 'assets/js/01-config-ui.js')),
                data: hashFile(path.join(ROOT, 'assets/js/02-data.js')),
                calculations: hashFile(path.join(ROOT, 'assets/js/03-calculations.js')),
                policy: hashFile(path.join(ROOT, 'strategy-validation-policy.json')),
                universe: hashFile(path.join(ROOT, 'strategy-validation-universe.json')),
                qualityReport: hashFile(__filename),
                qualityShadow: hashFile(path.join(ROOT, 'scripts/strategy-wave-b-quality-shadow.js'))
            }
        },
        baseline,
        stockBaseline,
        qualifiedForShadow: candidates.filter(candidate => candidate.historicalQualified && !DISCOVERY_ENABLED),
        candidates,
        eventCount: events.length,
        forwardData: INCLUDE_EVENT_DETAILS ? { baselineEvents: events.map(eventDetail) } : undefined
    };
    fs.mkdirSync(REPORT_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
    const reportPath = path.join(REPORT_DIR, `wave-b-quality-report-${stamp}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({
        reportPath: path.relative(ROOT, reportPath),
        scope: report.scope,
        eventCount: events.length,
        baseline,
        qualifiedForShadow: report.qualifiedForShadow
    }, null, 2));
}

if (require.main === module) main();

module.exports = { summarize, passes, getTemporalGate, summarizeCalendarStages, normalizeSignalList };
