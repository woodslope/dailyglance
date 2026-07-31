#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const {
    stableHash,
    mean,
    median,
    summarizePerformance,
    summarizeEvaluationRows,
    subtractSummaries,
    buildScenarioSummaries,
    buildTemporalSummaries,
    countAffectedDecisionDays,
    evaluateCandidateScreen,
    evaluateCandidateGates
} = require('./strategy-evaluator');
const {
    createProductionContext,
    loadCacheSymbols,
    resetActiveSymbolData,
    SCREEN_STOCK_PHASES,
    selectScreenSymbols,
    prepareSymbolContext,
    runProductionChain
} = require('./strategy-formal-baseline');

const ROOT = path.resolve(__dirname, '..');
const REPORT_DIR = path.join(ROOT, '.local', 'strategy-reports');
const POLICY = JSON.parse(fs.readFileSync(path.join(ROOT, 'strategy-validation-policy.json'), 'utf8'));
const STRATEGY_NAME = '波段抄底型';
const START_INDEX = POLICY.baselineStartIndex;
const showProgress = process.argv.includes('--progress');
const SCREEN_MODE = process.argv.includes('--screen');
const STANDARD_COST = POLICY.costScenarios.find(item => item.id === 'standard')?.costRate || 0.001;
const STRESS_COST = POLICY.costScenarios.find(item => item.id === 'cost_020')?.costRate || 0.002;
const REPAIR_SIGNALS = ['B5', 'B6', 'B7', 'B9', 'B11', 'B16', 'B17'];
const CANDIDATE = {
    id: 'wave_right_confirmation_entry_v1',
    label: '波段修复后的右侧确认新开仓',
    candidateClass: 'performance',
    objective: '让已完成波段修复、但生产积分尚未开仓的标的，在右侧趋势确认日建立30%试探仓，避免错过随后上涨，同时保留原有离场防守。',
    entry: '仅空仓：当日出现B3或B15、收盘站上MA20；过去10日出现B5/B6/B7/B9/B11/B16/B17任一修复信号；当前无L/W、无冷静期、风险系数为1且市场允许加仓时，建立30%。',
    boundary: '只作用于股票波段抄底型；只产生候选独有的0%->30% B；不改已有仓位的加仓、减仓、风险、离场或其它三套策略。',
    riskBudget: '平均收益至少提高0.5个百分点；平均回撤最多恶化0.5个百分点；换手最多增加10%；主要分层收益/回撤最多恶化1个百分点；三段窗口至少两段收益不退化。'
};

const CANDIDATE_RUNTIME = `
var __productionWaveRightConfirmationDecision = computeDecisionForIndex;
var __waveRightConfirmationRepairSignals = ${JSON.stringify(REPAIR_SIGNALS)};

function findWaveRightConfirmationRepair(idx, full) {
    for (var day = idx - 1; day >= Math.max(0, idx - 10); day--) {
        var signals = full[day]._signals || [];
        var matched = signals.filter(function(signal) { return __waveRightConfirmationRepairSignals.includes(signal); });
        if (matched.length) return { day: day, signals: matched };
    }
    return null;
}

computeDecisionForIndex = function(idx, full, prevPos) {
    var decision = __productionWaveRightConfirmationDecision(idx, full, prevPos);
    if (state.strategy !== '波段抄底型' || state.mode !== 'stock') return decision;

    var meta = getSignalMeta(idx, full, state.indicators);
    var rawSignals = full[idx]._signals || [];
    var close = Number(full[idx].close);
    var ma20 = Number(state.indicators.ma && state.indicators.ma[20] && state.indicators.ma[20][idx]);
    var repair = findWaveRightConfirmationRepair(idx, full);
    var hasRightConfirmation = rawSignals.includes('B3') || rawSignals.includes('B15');
    var hasAnyExitOrWarning = rawSignals.some(function(signal) { return /^L|^W/.test(signal); });
    var marketAllowsAdd = !!(decision.market && decision.market.allowAdd);
    var canEnter = prevPos === 0 && decision.position === 0
        && hasRightConfirmation
        && repair
        && Number.isFinite(close) && Number.isFinite(ma20) && close > ma20
        && !hasAnyExitOrWarning
        && !meta.inCooldown
        && Number(decision.risk && decision.risk.coef) === 1
        && marketAllowsAdd;

    if (!canEnter) return decision;

    decision.position = 30;
    decision.bsMark = 'B';
    decision.simpleAction = '右侧确认建仓';
    decision.simpleColorClass = 'text-info';
    decision.positionDriver = '波段修复后出现右侧趋势确认，建立30%试探仓；后续完全按原有防守链处理。';
    decision.waveRightConfirmationEntry = {
        active: true,
        signals: rawSignals.filter(function(signal) { return signal === 'B3' || signal === 'B15'; }),
        repairSignals: repair.signals,
        repairDay: repair.day
    };
    return decision;
};
`;

function round(value, digits = 6) {
    return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function latestBaseline() {
    const entry = fs.readdirSync(REPORT_DIR)
        .filter(file => /^formal-strategy-baseline-.*\.json$/.test(file))
        .map(file => ({ file, modifiedAt: fs.statSync(path.join(REPORT_DIR, file)).mtimeMs }))
        .sort((left, right) => right.modifiedAt - left.modifiedAt)[0];
    if (!entry) throw new Error('缺少正式策略基线，请先运行 scripts/strategy-formal-baseline.js');
    return JSON.parse(fs.readFileSync(path.join(REPORT_DIR, entry.file), 'utf8'));
}

function createCandidateContext(indexData) {
    const context = createProductionContext(indexData);
    vm.runInContext(CANDIDATE_RUNTIME, context);
    return context;
}

function runRows(context, symbol, prepared, strategy = STRATEGY_NAME) {
    const result = runProductionChain(context, symbol, strategy, prepared);
    return { rows: result.rows, rawSignals: prepared.rawSignals };
}

function evaluationRow(symbol, result, temporalWindows) {
    const decisionRows = result.rows.map((row, index) => ({
        ...row,
        high: Number(symbol.rows[index]?.high),
        low: Number(symbol.rows[index]?.low),
        rawSignals: result.rawSignals[index] || []
    }));
    return {
        id: symbol.id,
        name: symbol.name,
        mode: symbol.mode,
        phase: symbol.phase || null,
        tags: symbol.tags || [],
        performance: summarizePerformance(decisionRows, { startIndex: START_INDEX, costRate: STANDARD_COST }),
        scenarios: buildScenarioSummaries(decisionRows, POLICY),
        temporal: buildTemporalSummaries(decisionRows, temporalWindows, POLICY),
        bs: {
            b: decisionRows.slice(START_INDEX).filter(row => row.bsMark === 'B').length,
            s: decisionRows.slice(START_INDEX).filter(row => row.bsMark === 'S').length
        },
        decisionRows
    };
}

function matchesCohort(row, cohort) {
    if (cohort === 'stocks') return row.mode === 'stock';
    if (cohort === 'phase2') return row.phase === 'phase2';
    return row.mode === 'stock' && row.tags.includes(cohort);
}

function nestedSummary(rows, key, id) {
    return summarizeEvaluationRows(rows
        .filter(row => row[key] && row[key][id])
        .map(row => ({ ...row, performance: row[key][id], bs: { b: 0, s: 0 } })));
}

function evaluate(controlRows, candidateRows, temporalWindows, screenMode = false) {
    const baseline = summarizeEvaluationRows(controlRows);
    const variant = summarizeEvaluationRows(candidateRows);
    const cohorts = Object.fromEntries(['stocks', 'phase2', 'stress', 'highVolatility', 'technology', 'defensive', 'cyclical'].map(cohort => {
        const control = summarizeEvaluationRows(controlRows.filter(row => matchesCohort(row, cohort)));
        const candidate = summarizeEvaluationRows(candidateRows.filter(row => matchesCohort(row, cohort)));
        return [cohort, { baseline: control, variant: candidate, delta: subtractSummaries(candidate, control) }];
    }));
    const temporal = Object.fromEntries(temporalWindows.map(window => {
        const control = nestedSummary(controlRows, 'temporal', window.id);
        const candidate = nestedSummary(candidateRows, 'temporal', window.id);
        return [window.id, { baseline: control, variant: candidate, delta: subtractSummaries(candidate, control) }];
    }));
    const stressId = POLICY.gates.stress.scenarioId;
    const stressControl = nestedSummary(controlRows, 'scenarios', stressId);
    const stressCandidate = nestedSummary(candidateRows, 'scenarios', stressId);
    const affected = countAffectedDecisionDays(controlRows, candidateRows);
    const symbolDeltas = candidateRows.map(candidate => {
        const control = controlRows.find(row => row.id === candidate.id);
        return { id: candidate.id, mode: candidate.mode, delta: subtractSummaries(summarizeEvaluationRows([candidate]), summarizeEvaluationRows([control])) };
    });
    const delta = subtractSummaries(variant, baseline);
    return {
        baseline,
        variant,
        delta,
        cohorts,
        temporal,
        costStress: { scenarioId: stressId, delta: subtractSummaries(stressCandidate, stressControl) },
        affectedDecisions: affected,
        symbolDeltas,
        admission: (screenMode ? evaluateCandidateScreen : evaluateCandidateGates)({
            candidateClass: CANDIDATE.candidateClass,
            policy: POLICY,
            overallDelta: delta,
            temporalDeltas: Object.values(temporal).map(item => item.delta),
            symbolDeltas: symbolDeltas.filter(item => item.mode === 'stock'),
            cohorts,
            stressDelta: subtractSummaries(stressCandidate, stressControl),
            affectedDecisionDays: affected.total,
            completedTrades: variant.trades.completed
        })
    };
}

function findRecentRepair(rows, index) {
    for (let day = index - 1; day >= Math.max(0, index - 10); day--) {
        const signals = (rows[day]?.rawSignals || []).filter(signal => REPAIR_SIGNALS.includes(signal));
        if (signals.length) return { day, date: rows[day]?.date || '', signals };
    }
    return null;
}

function collectCandidateEntries(controlRows, candidateRows) {
    const entries = [];
    const bsTransitions = {};
    const positionTransitions = {};
    for (const candidate of candidateRows) {
        const control = controlRows.find(row => row.id === candidate.id);
        for (let index = START_INDEX; index < candidate.decisionRows.length; index++) {
            const before = control.decisionRows[index];
            const after = candidate.decisionRows[index];
            if (before.position !== after.position) {
                const key = `${before.position}->${after.position}`;
                positionTransitions[key] = (positionTransitions[key] || 0) + 1;
            }
            if (before.bsMark !== after.bsMark) {
                const key = `${before.bsMark || 'none'}->${after.bsMark || 'none'}`;
                bsTransitions[key] = (bsTransitions[key] || 0) + 1;
            }
            if (after.bsMark !== 'B' || before.bsMark === 'B') continue;
            const rawSignals = after.rawSignals || [];
            const repair = findRecentRepair(candidate.decisionRows, index);
            entries.push({
                id: candidate.id,
                name: candidate.name,
                mode: candidate.mode,
                phase: candidate.phase,
                tags: candidate.tags,
                index,
                date: after.date,
                entryClose: Number(after.close),
                rows: candidate.decisionRows,
                controlPosition: before.position,
                candidatePosition: after.position,
                confirmationSignals: rawSignals.filter(signal => signal === 'B3' || signal === 'B15'),
                repair
            });
        }
    }
    return { entries, bsTransitions, positionTransitions };
}

function summarizeEntryQuality(entries, horizons = [5, 10, 20]) {
    return {
        events: entries.length,
        horizons: Object.fromEntries(horizons.map(horizon => {
            const samples = entries.map(event => {
                const end = event.index + horizon;
                if (end >= event.rows.length || !Number.isFinite(event.entryClose) || event.entryClose <= 0) return null;
                const future = event.rows.slice(event.index + 1, end + 1);
                const forwardReturn = Number(future.at(-1)?.close) / event.entryClose - 1;
                const maxAdverse = Math.min(...future.map(row => Number(row.low))) / event.entryClose - 1;
                const maxFavorable = Math.max(...future.map(row => Number(row.high))) / event.entryClose - 1;
                return { forwardReturn, maxAdverse, maxFavorable };
            }).filter(Boolean);
            const returns = samples.map(sample => sample.forwardReturn);
            const netStandard = samples.map(sample => (1 + sample.forwardReturn) * (1 - STANDARD_COST) - 1);
            const netStress = samples.map(sample => (1 + sample.forwardReturn) * (1 - STRESS_COST) - 1);
            return [String(horizon), {
                events: samples.length,
                avgForwardReturn: round(mean(returns)),
                medianForwardReturn: round(median(returns)),
                positiveRate: samples.length ? round(returns.filter(value => value > 0).length / samples.length) : null,
                standardCostAdjustedReturn: round(mean(netStandard)),
                standardCostFailureRate: samples.length ? round(netStandard.filter(value => value <= 0).length / samples.length) : null,
                stressCostAdjustedReturn: round(mean(netStress)),
                stressCostFailureRate: samples.length ? round(netStress.filter(value => value <= 0).length / samples.length) : null,
                avgMaxAdverse: round(mean(samples.map(sample => sample.maxAdverse))),
                avgMaxFavorable: round(mean(samples.map(sample => sample.maxFavorable)))
            }];
        }))
    };
}

function buildBehaviorAudit(controlRows, candidateRows) {
    const attribution = collectCandidateEntries(controlRows, candidateRows);
    const entries = attribution.entries;
    const invalidEntries = entries.filter(entry => entry.controlPosition !== 0
        || entry.candidatePosition !== 30
        || entry.confirmationSignals.length === 0
        || !entry.repair?.signals?.length);
    return {
        candidateOnlyB: entries.length,
        explicitRightConfirmationOnly: invalidEntries.length === 0,
        invalidEntries: invalidEntries.map(entry => ({ id: entry.id, date: entry.date })),
        positionTransitions: attribution.positionTransitions,
        bsTransitions: attribution.bsTransitions,
        entryQuality: summarizeEntryQuality(entries),
        entries: entries.map(entry => ({
            id: entry.id,
            name: entry.name,
            date: entry.date,
            confirmationSignals: entry.confirmationSignals,
            repairDate: entry.repair?.date || '',
            repairSignals: entry.repair?.signals || []
        }))
    };
}

function main() {
    const baseline = latestBaseline();
    const commonAsOf = baseline.dataSnapshot?.commonAsOf;
    const temporalWindows = baseline.validationPolicy?.temporalWindows || [];
    if (temporalWindows.length !== POLICY.temporalWindows.count) throw new Error('正式基线缺少完整时间窗口');
    const loaded = loadCacheSymbols();
    const allSymbols = loaded.symbols.map(symbol => ({ ...symbol, rows: symbol.rows.filter(row => !commonAsOf || row.date <= commonAsOf) }));
    const symbols = SCREEN_MODE ? selectScreenSymbols(allSymbols) : allSymbols;
    if (!symbols.some(symbol => symbol.mode === 'stock')) throw new Error('快速筛选缺少股票样本');
    const indexData = Object.fromEntries(symbols.filter(symbol => symbol.mode === 'index').map(symbol => [symbol.id, symbol.rows]));
    const controlContext = createProductionContext(indexData);
    const candidateContext = createCandidateContext(indexData);
    const controlRows = [];
    const candidateRows = [];
    const startedAt = Date.now();

    for (const [symbolIndex, symbol] of symbols.entries()) {
        // Signals and indicators do not depend on the candidate overlay, so prepare once.
        const prepared = prepareSymbolContext(controlContext, symbol);
        controlRows.push(evaluationRow(symbol, runRows(controlContext, symbol, prepared), temporalWindows));
        resetActiveSymbolData(candidateContext);
        candidateRows.push(evaluationRow(symbol, runRows(candidateContext, symbol, prepared), temporalWindows));
        if (showProgress && ((symbolIndex + 1) % 10 === 0 || symbolIndex + 1 === symbols.length)) {
            console.error(`[wave-right-confirmation-entry] ${symbolIndex + 1}/${symbols.length} ${symbol.id} ${Math.round((Date.now() - startedAt) / 1000)}s`);
        }
    }

    const evaluation = evaluate(controlRows, candidateRows, temporalWindows, SCREEN_MODE);
    const report = {
        generatedAt: new Date().toISOString(),
        method: 'production-js-vm-local-cache-wave-right-confirmation-entry-overlay',
        appBuild: baseline.appBuild,
        signalVersion: baseline.signalVersion,
        candidate: { ...CANDIDATE, hash: stableHash(CANDIDATE) },
        dataSnapshot: {
            commonAsOf,
            hash: baseline.dataSnapshot?.hash,
            symbols: symbols.length,
            stocks: symbols.filter(symbol => symbol.mode === 'stock').length
        },
        behaviorAudit: buildBehaviorAudit(controlRows, candidateRows),
        evaluation,
        ...(SCREEN_MODE ? {
            screen: {
                stockPhases: SCREEN_STOCK_PHASES,
                formalAdmissionRequired: true
            }
        } : {})
    };
    fs.mkdirSync(REPORT_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
    const reportPath = path.join(REPORT_DIR, `wave-right-confirmation-entry-lab-${stamp}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    const affected = evaluation.affectedDecisions;
    const admission = evaluation.admission;
    console.log(JSON.stringify({
        reportPath: path.relative(ROOT, reportPath),
        candidate: {
            id: report.candidate.id,
            label: report.candidate.label,
            candidateClass: report.candidate.candidateClass
        },
        dataSnapshot: report.dataSnapshot,
        screen: report.screen,
        behaviorAudit: {
            candidateOnlyB: report.behaviorAudit.candidateOnlyB,
            explicitRightConfirmationOnly: report.behaviorAudit.explicitRightConfirmationOnly,
            bsTransitions: report.behaviorAudit.bsTransitions,
            entryCount: report.behaviorAudit.entries.length
        },
        result: {
            delta: {
                avgStrategyRet: evaluation.delta.avgStrategyRet,
                avgMaxDrawdown: evaluation.delta.avgMaxDrawdown,
                turnoverRatio: evaluation.delta.turnoverRatio,
                bs: evaluation.delta.bs
            },
            affectedDecisions: {
                total: affected.total,
                uniqueTradingDates: affected.uniqueTradingDates,
                firstDate: affected.firstDate,
                lastDate: affected.lastDate,
                symbols: affected.symbols
            },
            admission: {
                status: admission.status,
                failedChecks: admission.checks.filter(check => !check.pass).map(check => check.id)
            }
        }
    }, null, 2));
}

main();
