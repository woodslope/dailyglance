#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const {
    FORMAL_STRATEGIES,
    START_INDEX,
    createProductionContext,
    loadCacheSymbols,
    prepareSymbolContext,
    runProductionChain
} = require('./strategy-formal-baseline');
const { summarizePerformance } = require('./strategy-evaluator');

const ROOT = path.resolve(__dirname, '..');
const REPORT_DIR = path.join(ROOT, '.local', 'strategy-reports');
const DEFAULT_RULE = {
    lookbackDays: 60,
    forwardDays: 40,
    localRadiusDays: 10,
    clusterDays: 20,
    minimumDrawdown: 0.05,
    minimumRebound: 0.08,
    bWindowBefore: 5,
    bWindowAfter: 15,
    sWindowBefore: 5,
    sWindowAfter: 15,
    peakHorizonDays: 60
};

function round(value, digits = 4) {
    return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function mean(values) {
    const valid = values.filter(Number.isFinite);
    return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : NaN;
}

function median(values) {
    const valid = values.filter(Number.isFinite).sort((left, right) => left - right);
    if (!valid.length) return NaN;
    const middle = Math.floor(valid.length / 2);
    return valid.length % 2 ? valid[middle] : (valid[middle - 1] + valid[middle]) / 2;
}

function extrema(rows, start, end, field, compare) {
    let bestIndex = start;
    for (let index = start + 1; index <= end; index++) {
        if (compare(Number(rows[index][field]), Number(rows[bestIndex][field]))) bestIndex = index;
    }
    return bestIndex;
}

function detectBottoms(rows, rule) {
    const candidates = [];
    const lastEligible = rows.length - rule.forwardDays - 1;
    for (let index = Math.max(START_INDEX, rule.lookbackDays); index <= lastEligible; index++) {
        const priorHighIndex = extrema(rows, index - rule.lookbackDays, index, 'close', (left, right) => left > right);
        const futureHighIndex = extrema(rows, index, index + rule.forwardDays, 'close', (left, right) => left > right);
        const localLowIndex = extrema(rows, index - rule.localRadiusDays, index + rule.localRadiusDays, 'close', (left, right) => left < right);
        if (localLowIndex !== index) continue;
        const drawdown = Number(rows[index].close) / Number(rows[priorHighIndex].close) - 1;
        const rebound = Number(rows[futureHighIndex].close) / Number(rows[index].close) - 1;
        if (drawdown > -rule.minimumDrawdown || rebound < rule.minimumRebound) continue;
        candidates.push({ index, priorHighIndex, futureHighIndex, drawdown, rebound });
    }

    const clustered = [];
    for (const candidate of candidates) {
        const previous = clustered.at(-1);
        if (previous && candidate.index - previous.index <= rule.clusterDays) {
            if (Number(rows[candidate.index].close) < Number(rows[previous.index].close)) clustered[clustered.length - 1] = candidate;
        } else {
            clustered.push(candidate);
        }
    }

    return clustered.map((bottom, bottomIndex) => {
        const nextBottom = clustered[bottomIndex + 1]?.index;
        const peakEnd = Math.min(rows.length - 1, bottom.index + rule.peakHorizonDays, nextBottom == null ? Infinity : nextBottom - 1);
        const peakIndex = extrema(rows, bottom.index, peakEnd, 'close', (left, right) => left > right);
        return {
            ...bottom,
            peakIndex,
            date: rows[bottom.index].date,
            close: Number(rows[bottom.index].close),
            priorHighDate: rows[bottom.priorHighIndex].date,
            futureHighDate: rows[bottom.futureHighIndex].date,
            peakDate: rows[peakIndex].date,
            peakClose: Number(rows[peakIndex].close)
        };
    });
}

function nearestEvent(events, targetIndex, before, after) {
    const eligible = events.filter(event => event.index >= targetIndex - before && event.index <= targetIndex + after);
    if (!eligible.length) return null;
    return eligible.sort((left, right) => {
        const distance = Math.abs(left.index - targetIndex) - Math.abs(right.index - targetIndex);
        return distance || left.index - right.index;
    })[0];
}

function completedTrades(rows) {
    const trades = [];
    let entry = null;
    for (let index = START_INDEX; index < rows.length; index++) {
        if (rows[index].bsMark === 'B') entry = { index, date: rows[index].date, close: Number(rows[index].close) };
        if (rows[index].bsMark === 'S' && entry) {
            trades.push({
                entryDate: entry.date,
                exitDate: rows[index].date,
                bars: index - entry.index,
                rawReturn: Number(rows[index].close) / entry.close - 1
            });
            entry = null;
        }
    }
    return trades;
}

function analyzeStrategy(rows, bottoms, rule) {
    const bEvents = [];
    const sEvents = [];
    rows.forEach((row, index) => {
        if (index < START_INDEX) return;
        if (row.bsMark === 'B') bEvents.push({ index, date: row.date, close: Number(row.close) });
        if (row.bsMark === 'S') sEvents.push({ index, date: row.date, close: Number(row.close) });
    });
    const details = bottoms.map(bottom => {
        const buy = nearestEvent(bEvents, bottom.index, rule.bWindowBefore, rule.bWindowAfter);
        const sell = nearestEvent(sEvents, bottom.peakIndex, rule.sWindowBefore, rule.sWindowAfter);
        return {
            bottomDate: bottom.date,
            bottomClose: bottom.close,
            drawdownPct: round(bottom.drawdown * 100, 2),
            forwardReboundPct: round(bottom.rebound * 100, 2),
            peakDate: bottom.peakDate,
            peakClose: bottom.peakClose,
            bDate: buy?.date || null,
            bLagDays: buy ? buy.index - bottom.index : null,
            bPricePremiumPct: buy ? round((buy.close / bottom.close - 1) * 100, 2) : null,
            sDate: sell?.date || null,
            sLagDays: sell ? sell.index - bottom.peakIndex : null,
            sPriceGapPct: sell ? round((sell.close / bottom.peakClose - 1) * 100, 2) : null
        };
    });
    const matchedB = details.filter(item => Number.isFinite(item.bLagDays));
    const matchedS = details.filter(item => Number.isFinite(item.sLagDays));
    const matchedBEventDates = new Set(matchedB.map(item => item.bDate));
    const trades = completedTrades(rows);
    const performance = summarizePerformance(rows, { startIndex: START_INDEX, costRate: 0.001 });
    return {
        bSignals: bEvents.length,
        sSignals: sEvents.length,
        bottomCoverage: round(matchedB.length / bottoms.length),
        matchedBottoms: matchedB.length,
        medianAbsBLagDays: round(median(matchedB.map(item => Math.abs(item.bLagDays))), 2),
        meanBLagDays: round(mean(matchedB.map(item => item.bLagDays)), 2),
        medianBPricePremiumPct: round(median(matchedB.map(item => item.bPricePremiumPct)), 2),
        unmatchedBSignals: bEvents.filter(event => !matchedBEventDates.has(event.date)).length,
        unmatchedBSignalRatio: round(bEvents.length ? bEvents.filter(event => !matchedBEventDates.has(event.date)).length / bEvents.length : 0),
        peakCoverage: round(matchedS.length / bottoms.length),
        matchedPeaks: matchedS.length,
        medianAbsSLagDays: round(median(matchedS.map(item => Math.abs(item.sLagDays))), 2),
        meanSLagDays: round(mean(matchedS.map(item => item.sLagDays)), 2),
        completedTrades: trades.length,
        tradeWinRate: round(trades.length ? trades.filter(item => item.rawReturn > 0).length / trades.length : NaN),
        medianTradeReturnPct: round(median(trades.map(item => item.rawReturn)) * 100, 2),
        meanTradeReturnPct: round(mean(trades.map(item => item.rawReturn)) * 100, 2),
        performance: {
            totalReturnPct: round(performance.ret * 100, 2),
            annualizedReturnPct: round(performance.annualizedReturn * 100, 2),
            maxDrawdownPct: round(performance.maxDrawdown * 100, 2),
            winRate: performance.winRate,
            holdingRatio: performance.holdingRatio,
            adjustments: performance.adjustments
        },
        details
    };
}

function analyzeSensitivity(productionRows, priceRows) {
    return [0.05, 0.08, 0.10].map(minimumRebound => {
        const rule = { ...DEFAULT_RULE, minimumRebound };
        const bottoms = detectBottoms(priceRows, rule);
        return {
            minimumRebound,
            bottoms: bottoms.length,
            strategies: Object.fromEntries(FORMAL_STRATEGIES.map(strategy => {
                const result = analyzeStrategy(productionRows[strategy], bottoms, rule);
                return [strategy, {
                    bottomCoverage: result.bottomCoverage,
                    medianAbsBLagDays: result.medianAbsBLagDays,
                    unmatchedBSignalRatio: result.unmatchedBSignalRatio,
                    peakCoverage: result.peakCoverage
                }];
            }))
        };
    });
}

function main() {
    const loaded = loadCacheSymbols();
    const sh = loaded.symbols.find(symbol => symbol.mode === 'index' && symbol.id === 'sh');
    if (!sh) throw new Error('missing cached 上证指数 data');
    const commonAsOf = Object.values(loaded.indexData).map(rows => rows.at(-1)?.date).filter(Boolean).sort()[0] || '';
    const indexData = Object.fromEntries(Object.entries(loaded.indexData).map(([id, rows]) => [id, rows.filter(row => !commonAsOf || row.date <= commonAsOf)]));
    const symbol = { ...sh, rows: sh.rows.filter(row => !commonAsOf || row.date <= commonAsOf) };
    const context = createProductionContext(indexData);
    const prepared = prepareSymbolContext(context, symbol);
    const productionRows = Object.fromEntries(FORMAL_STRATEGIES.map(strategy => [
        strategy,
        runProductionChain(context, symbol, strategy, prepared).rows
    ]));
    const bottoms = detectBottoms(symbol.rows, DEFAULT_RULE);
    const strategies = Object.fromEntries(FORMAL_STRATEGIES.map(strategy => [
        strategy,
        analyzeStrategy(productionRows[strategy], bottoms, DEFAULT_RULE)
    ]));
    const ranking = FORMAL_STRATEGIES.map(strategy => ({ strategy, ...strategies[strategy] }))
        .sort((left, right) => right.bottomCoverage - left.bottomCoverage
            || left.medianAbsBLagDays - right.medianAbsBLagDays
            || left.unmatchedBSignalRatio - right.unmatchedBSignalRatio)
        .map((item, index) => ({ rank: index + 1, strategy: item.strategy }));
    const report = {
        generatedAt: new Date().toISOString(),
        method: 'production-js-vm-local-cache-with-ex-post-swing-labels',
        scope: {
            index: '上证指数',
            firstDate: symbol.rows[START_INDEX]?.date || symbol.rows[0]?.date || '',
            lastDate: symbol.rows.at(-1)?.date || '',
            rows: symbol.rows.length,
            warmupTradingDays: START_INDEX
        },
        caveat: '底部标签使用未来40个交易日，仅用于评估；四套策略B/S仍由当时及此前数据生成。',
        bottomRule: DEFAULT_RULE,
        bottoms: bottoms.map(bottom => ({
            date: bottom.date,
            close: bottom.close,
            drawdownPct: round(bottom.drawdown * 100, 2),
            forwardReboundPct: round(bottom.rebound * 100, 2),
            futureHighDate: bottom.futureHighDate,
            peakDate: bottom.peakDate,
            peakClose: bottom.peakClose
        })),
        ranking,
        strategies,
        sensitivity: analyzeSensitivity(productionRows, symbol.rows)
    };
    fs.mkdirSync(REPORT_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
    const reportPath = path.join(REPORT_DIR, `index-bottom-alignment-${stamp}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({
        reportPath: path.relative(ROOT, reportPath),
        scope: report.scope,
        bottoms: report.bottoms,
        ranking,
        strategies: Object.fromEntries(FORMAL_STRATEGIES.map(strategy => {
            const item = strategies[strategy];
            return [strategy, {
                bSignals: item.bSignals,
                bottomCoverage: item.bottomCoverage,
                medianAbsBLagDays: item.medianAbsBLagDays,
                meanBLagDays: item.meanBLagDays,
                medianBPricePremiumPct: item.medianBPricePremiumPct,
                unmatchedBSignalRatio: item.unmatchedBSignalRatio,
                peakCoverage: item.peakCoverage,
                medianAbsSLagDays: item.medianAbsSLagDays,
                performance: item.performance
            }];
        })),
        sensitivity: report.sensitivity
    }, null, 2));
}

main();
