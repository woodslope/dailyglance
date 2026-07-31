#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const REPORT_DIR = path.join(ROOT, '.local', 'strategy-reports');
const FORMAL_BASELINE_PATH = path.join(ROOT, 'scripts', 'strategy-formal-baseline.js');
const STRATEGY = '波段抄底型';
const START_INDEX = 60;
const COST_RATE = 0.001;
const VARIANTS = [
    { id: 'rebound_exit_4pct', threshold: 0.04, cooldownDays: 3, requireUnreleased: false },
    { id: 'rebound_exit_5pct', threshold: 0.05, cooldownDays: 3, requireUnreleased: false },
    { id: 'rebound_exit_6pct', threshold: 0.06, cooldownDays: 3, requireUnreleased: false },
    { id: 'rebound_exit_5pct_trial_only', threshold: 0.05, cooldownDays: 3, requireUnreleased: true },
    { id: 'rebound_exit_5pct_no_cooldown', threshold: 0.05, cooldownDays: 0, requireUnreleased: false }
];

function loadFormalHelpers() {
    const source = fs.readFileSync(FORMAL_BASELINE_PATH, 'utf8')
        .replace(/^#!.*\n/, '')
        .replace(/\nmain\(\);\s*$/, `
globalThis.__formalLab = {
    read,
    cloneRows,
    makeBrowserContext,
    loadCacheSymbols,
    resetActiveSymbolData,
    prepareSymbolContext,
    summarize,
    round,
    mean
};
`);
    const context = vm.createContext({
        console,
        require,
        process,
        __dirname: path.dirname(FORMAL_BASELINE_PATH),
        __filename: FORMAL_BASELINE_PATH,
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval
    });
    vm.runInContext(source, context, { filename: FORMAL_BASELINE_PATH });
    return context.__formalLab;
}

const helpers = loadFormalHelpers();

const CANDIDATE_RUNTIME = `
var __productionComputeDecisionForIndex = computeDecisionForIndex;

function applyWaveReboundExitCandidate(decision, idx, full, prevPos) {
    var config = globalThis.__waveReboundExitConfig;
    if (!config || !isWaveTrialStrategy()) return decision;

    var previousDecision = full && full[idx - 1] && full[idx - 1]._decision;
    var previousCandidate = previousDecision && previousDecision.reboundExitCandidate;
    var candidate = previousCandidate ? { ...previousCandidate } : null;
    if (candidate) {
        candidate.armedToday = false;
        candidate.canceledToday = false;
        candidate.exitedToday = false;
    }

    if (decision.waveTrialEntry && decision.position > 0 && decision.waveTrial && decision.waveTrial.active && !decision.waveTrial.released) {
        candidate = {
            active: true,
            armed: false,
            armedToday: false,
            canceledToday: false,
            exitedToday: false,
            streak: 0,
            largeRiseInStreak: false,
            entryIndex: idx,
            entryDate: full[idx] && full[idx].date || '',
            entryClose: Number(full[idx] && full[idx].close),
            threshold: Number(config.threshold)
        };
    }

    if (!candidate || !candidate.active) {
        decision.reboundExitCandidate = candidate;
        return decision;
    }

    if (decision.position === 0 || (prevPos <= 0 && !decision.waveTrialEntry)) {
        candidate.active = false;
        candidate.canceledToday = true;
        candidate.cancelReason = decision.stopExit && decision.stopExit.triggered ? 'fixed-stop-or-base-exit' : 'base-exit';
        decision.reboundExitCandidate = candidate;
        return decision;
    }

    var stillTrial = decision.waveTrial
        && decision.waveTrial.active
        && (!config.requireUnreleased || !decision.waveTrial.released);
    var stillDowntrend = isLongTermDowntrend(idx, full, state.indicators);
    if (!stillTrial || !stillDowntrend) {
        candidate.active = false;
        candidate.canceledToday = true;
        candidate.cancelReason = !stillTrial ? 'trial-released' : 'downtrend-ended';
        decision.reboundExitCandidate = candidate;
        return decision;
    }

    var close = Number(full[idx] && full[idx].close);
    var previousClose = Number(full[idx - 1] && full[idx - 1].close);
    var dailyReturn = previousClose > 0 ? close / previousClose - 1 : 0;

    if (dailyReturn > 0) {
        if (!candidate.armed) {
            candidate.streak += 1;
            if (dailyReturn >= Number(config.threshold)) candidate.largeRiseInStreak = true;
            if (candidate.streak >= 3 && candidate.largeRiseInStreak) {
                candidate.armed = true;
                candidate.armedToday = true;
                candidate.armedIndex = idx;
                candidate.armedDate = full[idx] && full[idx].date || '';
                candidate.armedClose = close;
                candidate.armedStreak = candidate.streak;
            }
        }
    } else if (dailyReturn < 0 && candidate.armed) {
        candidate.active = false;
        candidate.exitedToday = true;
        candidate.exitIndex = idx;
        candidate.exitDate = full[idx] && full[idx].date || '';
        candidate.exitClose = close;

        decision.position = 0;
        decision.bsMark = prevPos > 0 ? 'S' : null;
        decision.simpleAction = '执行离场';
        decision.simpleColorClass = 'text-bear';
        decision.isCriticalExit = true;
        decision.positionDriver = '长期下跌中连涨3日且出现大涨，随后首个收阴日退出试探仓。';
        decision.reboundExit = {
            triggered: true,
            entryIndex: candidate.entryIndex,
            entryDate: candidate.entryDate,
            entryClose: candidate.entryClose,
            armedIndex: candidate.armedIndex,
            armedDate: candidate.armedDate,
            armedClose: candidate.armedClose,
            exitIndex: idx,
            exitDate: candidate.exitDate,
            exitClose: close,
            threshold: Number(config.threshold)
        };
        decision.waveTrial = {
            ...(decision.waveTrial || {}),
            active: false,
            released: false,
            reboundExited: true,
            reentryBlockedUntil: idx + Number(config.cooldownDays || 0),
            blockedFromIndex: idx
        };
    } else if (!candidate.armed) {
        candidate.streak = 0;
        candidate.largeRiseInStreak = false;
    }

    decision.reboundExitCandidate = candidate;
    return decision;
}

computeDecisionForIndex = function(idx, full, prevPos) {
    return applyWaveReboundExitCandidate(__productionComputeDecisionForIndex(idx, full, prevPos), idx, full, prevPos);
};
`;

function createProductionContext(indexData, candidateConfig = null) {
    const context = helpers.makeBrowserContext();
    vm.runInContext(helpers.read('assets/js/01-config-ui.js'), context);
    vm.runInContext(helpers.read('assets/js/02-data.js'), context);
    vm.runInContext(helpers.read('assets/js/03-calculations.js'), context);
    if (candidateConfig) {
        context.__waveReboundExitConfig = candidateConfig;
        vm.runInContext(CANDIDATE_RUNTIME, context);
    }
    context.__indexData = Object.fromEntries(Object.entries(indexData).map(([id, rows]) => [id, helpers.cloneRows(rows)]));
    vm.runInContext(`
        state.period = 'daily';
        state.rawData = {};
        state.weeklyData = {};
        state.liveBars = {};
        state.liveQuotes = {};
        state.liveWeeklyData = {};
        state.liveOverlayCache = {};
        for (const id of Object.keys(__indexData)) {
            state.rawData[id] = __indexData[id].map(row => ({ ...row }));
            state.weeklyData[id] = convertDailyToWeekly(state.rawData[id]);
        }
    `, context);
    return context;
}

function runProductionChain(context, symbol, prepared) {
    context.__symbol = {
        id: symbol.id,
        mode: symbol.mode,
        rows: helpers.cloneRows(symbol.rows),
        strategy: STRATEGY,
        rawSignals: prepared.rawSignals,
        indicators: prepared.indicators
    };
    return JSON.parse(vm.runInContext(`
        (function() {
            if (!setActiveStrategy(__symbol.strategy)) throw new Error('unknown formal strategy: ' + __symbol.strategy);
            state.strategy = __symbol.strategy;
            state.mode = __symbol.mode;
            state.id = __symbol.id;
            state.stockId = __symbol.mode === 'stock' ? __symbol.id : null;
            state.rawData[__symbol.id] = __symbol.rows.map((row, idx) => ({
                ...row,
                _signals: [...(__symbol.rawSignals[idx] || [])],
                _signalVersion: SIGNAL_VERSION
            }));
            state.weeklyData[__symbol.id] = convertDailyToWeekly(state.rawData[__symbol.id]);
            state.indicators = __symbol.indicators;
            state.indicatorKey = '';
            state.pendingIndicatorMutation = { mode: 'strategy-only', startIdx: 0 };
            updateAllIndicators();
            const full = state.rawData[__symbol.id];
            return JSON.stringify({
                appBuild: APP_BUILD,
                signalVersion: SIGNAL_VERSION,
                rows: full.map((row, idx) => ({
                    date: row.date,
                    open: row.open,
                    high: row.high,
                    low: row.low,
                    close: row.close,
                    position: row._decision?.position || 0,
                    bsMark: row._decision?.bsMark || null,
                    simpleAction: row._decision?.simpleAction || '',
                    waveTrialEntry: !!row._decision?.waveTrialEntry,
                    waveTrialReleased: !!row._decision?.waveTrial?.released,
                    stopExitTriggered: !!row._decision?.stopExit?.triggered,
                    reboundExitCandidate: row._decision?.reboundExitCandidate || null,
                    reboundExit: row._decision?.reboundExit || null,
                    longTermDowntrend: isLongTermDowntrend(idx, full, state.indicators)
                }))
            });
        })()
    `, context));
}

function summarizeEventQuality(rows) {
    const exits = [];
    let armed = 0;
    let canceledAfterArmed = 0;
    for (let idx = START_INDEX; idx < rows.length; idx++) {
        const candidate = rows[idx].reboundExitCandidate;
        if (candidate?.armedToday) armed += 1;
        if (candidate?.canceledToday && candidate?.armed) canceledAfterArmed += 1;
        if (!rows[idx].reboundExit?.triggered) continue;
        const exitClose = Number(rows[idx].close);
        const entryClose = Number(rows[idx].reboundExit.entryClose);
        const armedClose = Number(rows[idx].reboundExit.armedClose);
        const future = offset => rows[idx + offset]?.close;
        const futureReturn = offset => Number.isFinite(Number(future(offset))) && exitClose > 0
            ? Number(future(offset)) / exitClose - 1
            : NaN;
        const window = rows.slice(idx + 1, Math.min(rows.length, idx + 11));
        const maxHigh10 = window.length ? Math.max(...window.map(row => Number(row.high))) : NaN;
        const minLow10 = window.length ? Math.min(...window.map(row => Number(row.low))) : NaN;
        exits.push({
            entryToExit: entryClose > 0 ? exitClose / entryClose - 1 : NaN,
            armedToExit: armedClose > 0 ? exitClose / armedClose - 1 : NaN,
            waitAfterArmed: idx - Number(rows[idx].reboundExit.armedIndex),
            f1: futureReturn(1),
            f3: futureReturn(3),
            f5: futureReturn(5),
            f10: futureReturn(10),
            maxFavorable10: Number.isFinite(maxHigh10) && exitClose > 0 ? maxHigh10 / exitClose - 1 : NaN,
            maxAdverse10: Number.isFinite(minLow10) && exitClose > 0 ? minLow10 / exitClose - 1 : NaN
        });
    }

    const stat = key => {
        const values = exits.map(item => item[key]).filter(Number.isFinite).sort((a, b) => a - b);
        if (!values.length) return { n: 0, mean: null, median: null };
        const middle = Math.floor(values.length / 2);
        return {
            n: values.length,
            mean: helpers.round(helpers.mean(values), 6),
            median: helpers.round(values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2, 6)
        };
    };
    return {
        armed,
        exits: exits.length,
        canceledAfterArmed,
        entryToExit: stat('entryToExit'),
        armedToExit: stat('armedToExit'),
        waitAfterArmed: stat('waitAfterArmed'),
        forward1: stat('f1'),
        forward3: stat('f3'),
        forward5: stat('f5'),
        forward10: stat('f10'),
        maxFavorable10: stat('maxFavorable10'),
        maxAdverse10: stat('maxAdverse10'),
        soldFly5PctWithin10: exits.length
            ? helpers.round(exits.filter(item => item.maxFavorable10 >= 0.05).length / exits.length, 6)
            : null,
        fell5PctWithin10: exits.length
            ? helpers.round(exits.filter(item => item.maxAdverse10 <= -0.05).length / exits.length, 6)
            : null
    };
}

function summarizeResults(results) {
    const stocks = results.filter(item => item.mode === 'stock');
    const indices = results.filter(item => item.mode === 'index');
    const summarizeGroup = group => ({
        symbols: group.length,
        avgReturn: helpers.round(helpers.mean(group.map(item => item.performance.ret)), 6),
        medianReturn: helpers.round(median(group.map(item => item.performance.ret)), 6),
        avgMaxDrawdown: helpers.round(helpers.mean(group.map(item => item.performance.maxDrawdown)), 6),
        avgWinRate: helpers.round(helpers.mean(group.map(item => item.performance.winRate)), 6),
        positiveSymbols: group.filter(item => item.performance.ret > 0).length,
        completedTrades: group.reduce((sum, item) => sum + item.performance.completedTrades, 0),
        adjustments: group.reduce((sum, item) => sum + item.performance.adjustments, 0),
        armed: group.reduce((sum, item) => sum + item.events.armed, 0),
        reboundExits: group.reduce((sum, item) => sum + item.events.exits, 0),
        soldFly5PctWithin10: weightedRate(group, 'soldFly5PctWithin10'),
        fell5PctWithin10: weightedRate(group, 'fell5PctWithin10'),
        exitForward5: weightedMean(group, 'forward5'),
        exitForward10: weightedMean(group, 'forward10'),
        entryToExit: weightedMean(group, 'entryToExit')
    });
    return {
        all: summarizeGroup(results),
        stocks: summarizeGroup(stocks),
        indices: summarizeGroup(indices)
    };
}

function median(values) {
    const valid = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (!valid.length) return NaN;
    const middle = Math.floor(valid.length / 2);
    return valid.length % 2 ? valid[middle] : (valid[middle - 1] + valid[middle]) / 2;
}

function weightedMean(group, key) {
    const pairs = group
        .map(item => item.events[key])
        .filter(item => item && Number.isFinite(item.mean) && item.n > 0);
    const count = pairs.reduce((sum, item) => sum + item.n, 0);
    return count
        ? helpers.round(pairs.reduce((sum, item) => sum + item.mean * item.n, 0) / count, 6)
        : null;
}

function weightedRate(group, key) {
    const valid = group.filter(item => item.events.exits > 0 && Number.isFinite(item.events[key]));
    const count = valid.reduce((sum, item) => sum + item.events.exits, 0);
    return count
        ? helpers.round(valid.reduce((sum, item) => sum + item.events[key] * item.events.exits, 0) / count, 6)
        : null;
}

function buildDelta(candidate, baseline) {
    const deltaGroup = (current, control) => ({
        avgReturn: helpers.round(current.avgReturn - control.avgReturn, 6),
        medianReturn: helpers.round(current.medianReturn - control.medianReturn, 6),
        avgMaxDrawdown: helpers.round(current.avgMaxDrawdown - control.avgMaxDrawdown, 6),
        avgWinRate: helpers.round(current.avgWinRate - control.avgWinRate, 6),
        positiveSymbols: current.positiveSymbols - control.positiveSymbols,
        completedTrades: current.completedTrades - control.completedTrades,
        adjustments: current.adjustments - control.adjustments
    });
    return {
        all: deltaGroup(candidate.all, baseline.all),
        stocks: deltaGroup(candidate.stocks, baseline.stocks),
        indices: deltaGroup(candidate.indices, baseline.indices)
    };
}

function main() {
    const { indexData, symbols } = helpers.loadCacheSymbols();
    const baselineContext = createProductionContext(indexData);
    const variantContexts = Object.fromEntries(VARIANTS.map(variant => [variant.id, createProductionContext(indexData, variant)]));
    const baselineRows = [];
    const variantRows = Object.fromEntries(VARIANTS.map(variant => [variant.id, []]));
    let appBuild = '';
    let signalVersion = '';

    for (const [symbolIndex, symbol] of symbols.entries()) {
        const prepared = helpers.prepareSymbolContext(baselineContext, symbol);
        const baselineRun = runProductionChain(baselineContext, symbol, prepared);
        appBuild = baselineRun.appBuild || appBuild;
        signalVersion = baselineRun.signalVersion || signalVersion;
        baselineRows.push({
            id: symbol.id,
            name: symbol.name,
            mode: symbol.mode,
            phase: symbol.phase || null,
            tags: symbol.tags || [],
            performance: helpers.summarize(baselineRun.rows),
            events: summarizeEventQuality(baselineRun.rows)
        });

        for (const variant of VARIANTS) {
            const context = variantContexts[variant.id];
            helpers.resetActiveSymbolData(context);
            const run = runProductionChain(context, symbol, prepared);
            variantRows[variant.id].push({
                id: symbol.id,
                name: symbol.name,
                mode: symbol.mode,
                phase: symbol.phase || null,
                tags: symbol.tags || [],
                performance: helpers.summarize(run.rows),
                events: summarizeEventQuality(run.rows)
            });
        }
        if (process.argv.includes('--progress')) console.error('[wave-rebound-exit] ' + (symbolIndex + 1) + '/' + symbols.length + ' ' + symbol.id);
    }

    const baseline = summarizeResults(baselineRows);
    const variants = Object.fromEntries(VARIANTS.map(variant => {
        const summary = summarizeResults(variantRows[variant.id]);
        return [variant.id, {
            definition: {
                scope: variant.requireUnreleased
                    ? '仅长期下跌中未解除上限的波段试探仓'
                    : '波段试探入场后且当前仍处长期下跌结构的持仓',
                trigger: '连续至少3个交易日收盘上涨，其中至少1日单日收盘涨幅达阈值',
                exit: '触发后首个收盘下跌日退出试探仓',
                threshold: variant.threshold,
                cooldownDays: variant.cooldownDays,
                requireUnreleased: variant.requireUnreleased,
                fixedStopPriority: true,
                cancelWhen: {
                    trialReleased: variant.requireUnreleased,
                    downtrendEnds: true
                }
            },
            summary,
            delta: buildDelta(summary, baseline),
            symbolsDetail: variantRows[variant.id]
        }];
    }));

    const report = {
        generatedAt: new Date().toISOString(),
        method: 'production-js-vm-local-cache-wave-rebound-exit-overlay',
        appBuild,
        signalVersion,
        costRate: COST_RATE,
        scope: {
            symbols: symbols.length,
            stocks: symbols.filter(symbol => symbol.mode === 'stock').length,
            indices: symbols.filter(symbol => symbol.mode === 'index').length,
            dateRange: {
                first: symbols.map(symbol => symbol.rows[0]?.date).filter(Boolean).sort()[0] || '',
                last: symbols.map(symbol => symbol.rows.at(-1)?.date).filter(Boolean).sort().at(-1) || ''
            }
        },
        baseline,
        variants
    };

    fs.mkdirSync(REPORT_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
    const reportPath = path.join(REPORT_DIR, 'wave-rebound-exit-lab-' + stamp + '.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({
        reportPath: path.relative(ROOT, reportPath),
        appBuild,
        signalVersion,
        scope: report.scope,
        baseline,
        variants: Object.fromEntries(Object.entries(variants).map(([id, item]) => [id, {
            definition: item.definition,
            stocks: item.summary.stocks,
            stockDelta: item.delta.stocks
        }]))
    }, null, 2));
}

main();
