#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const {
    stableHash,
    summarizePerformance,
    summarizeEvaluationRows,
    subtractSummaries,
    buildScenarioSummaries,
    buildTemporalSummaries,
    countAffectedDecisionDays,
    evaluateCandidateGates
} = require('./strategy-evaluator');

const ROOT = path.resolve(__dirname, '..');
const REPORT_DIR = path.join(ROOT, '.local', 'strategy-reports');
const FORMAL_BASELINE_PATH = path.join(ROOT, 'scripts', 'strategy-formal-baseline.js');
const POLICY = JSON.parse(fs.readFileSync(path.join(ROOT, 'strategy-validation-policy.json'), 'utf8'));
const STRATEGY = '波段抄底型';
const START_INDEX = POLICY.baselineStartIndex;
const COST_RATE = POLICY.costScenarios.find(item => item.id === 'standard')?.costRate || 0.001;
const VARIANTS = {
    retain_previous: { id: 'retain_previous', label: '保留原有仓位', maxRetainedPosition: null },
    retain_50: { id: 'retain_50', label: '最高保留50%仓位', maxRetainedPosition: 50 }
};
const variantArgIndex = process.argv.indexOf('--variant');
const variantId = variantArgIndex >= 0 ? process.argv[variantArgIndex + 1] || '' : 'retain_50';
const VARIANT = VARIANTS[variantId];
if (!VARIANT) throw new Error(`未知趋势接管变体：${variantId}`);
const CANDIDATE = {
    id: 'wave_b15_holding_trend_handoff',
    label: 'B15确认后的已有波段仓位趋势接管',
    variant: VARIANT,
    candidateClass: 'performance',
    objective: '减少波段抄底成功后，旧抄底积分自然移出窗口导致的过早降仓；不增加追涨开仓。',
    trigger: '已有仓位至少50%，当日出现B15均线二次金叉且收盘站上MA20。',
    carry: '接管后仅在收盘不低于MA20时延续。',
    boundary: `只阻止纯积分衰减造成的降仓；${VARIANT.maxRetainedPosition ? `接管仓位最高${VARIANT.maxRetainedPosition}%；` : ''}不主动加仓，不覆盖风险系数、W4上限、普通/强离场、冷静期或市场门禁。`,
    allowedBsImpact: '不得产生候选独有B；允许因避免纯积分衰减退出而减少后续重复S/B。',
    riskBudget: '平均收益至少提高0.5个百分点；平均回撤最多恶化0.5个百分点；换手最多增加10%；主要分层收益/回撤最多恶化1个百分点；三段时间窗口至少两段收益不退化。'
};

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
    prepareSymbolContext
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

function getWaveTrendHandoffContext(idx, full, prevPos) {
    var previous = full && full[idx - 1] && full[idx - 1]._decision;
    var previousState = previous && previous.waveTrendHandoff;
    var rawSignals = full && full[idx] && full[idx]._signals || [];
    var close = Number(full && full[idx] && full[idx].close);
    var ma20 = Number(state.indicators && state.indicators.ma && state.indicators.ma[20] && state.indicators.ma[20][idx]);
    var activated = prevPos >= 50 && rawSignals.includes('B15') && Number.isFinite(ma20) && close > ma20;
    var carried = !!(previousState && previousState.active && prevPos >= 50 && Number.isFinite(ma20) && close >= ma20);
    return {
        active: activated || carried,
        activatedToday: activated,
        sourceDate: activated ? full[idx].date : previousState && previousState.sourceDate || '',
        close: close,
        ma20: ma20
    };
}

computeDecisionForIndex = function(idx, full, prevPos) {
    var decision = __productionComputeDecisionForIndex(idx, full, prevPos);
    if (state.strategy !== '波段抄底型') return decision;

    var handoff = getWaveTrendHandoffContext(idx, full, prevPos);
    if (!handoff.active) {
        decision.waveTrendHandoff = { ...handoff, applied: false };
        return decision;
    }

    var meta = getSignalMeta(idx, full, state.indicators);
    var noExit = decision.exit && decision.exit.level === '无明确离场';
    var noWarning = !(meta.warningSignals || []).length;
    var normalRisk = Number(decision.risk && decision.risk.coef) === 1;
    var scoreDecayed = Number(meta.windowScore) < Number(STRATEGY.buyThreshold);
    var wouldReduce = decision.position < prevPos;
    var canHold = prevPos >= 50 && noExit && noWarning && normalRisk && !meta.inCooldown && scoreDecayed && wouldReduce;

    if (!canHold) {
        var deactivatedByDefense = wouldReduce && (!noExit || !noWarning || !normalRisk || meta.inCooldown);
        decision.waveTrendHandoff = {
            ...handoff,
            active: deactivatedByDefense ? false : handoff.active,
            applied: false,
            deactivatedByDefense: deactivatedByDefense
        };
        return decision;
    }

    var configuredMaximum = Number(globalThis.__waveTrendHandoffConfig && globalThis.__waveTrendHandoffConfig.maxRetainedPosition);
    var retainedPosition = Number.isFinite(configuredMaximum) && configuredMaximum > 0
        ? Math.min(prevPos, configuredMaximum)
        : prevPos;
    if (meta.allSignals && meta.allSignals.W4) retainedPosition = Math.min(retainedPosition, 50);
    if (retainedPosition <= decision.position) {
        decision.waveTrendHandoff = { ...handoff, applied: false };
        return decision;
    }

    var productionPosition = decision.position;
    decision.position = retainedPosition;
    decision.bsMark = null;
    decision.simpleAction = retainedPosition < prevPos ? '防守减仓' : '积极持有';
    decision.simpleColorClass = retainedPosition < prevPos ? 'text-warn' : 'text-bull';
    decision.positionDriver = 'B15确认后由趋势接管已有波段仓位；旧抄底积分到期不单独触发降仓。';
    decision.waveTrendHandoff = {
        ...handoff,
        active: true,
        applied: true,
        productionPosition: productionPosition,
        retainedPosition: retainedPosition
    };
    return decision;
};
`;

function latestBaseline() {
    const entry = fs.readdirSync(REPORT_DIR)
        .filter(file => /^formal-strategy-baseline-.*\.json$/.test(file))
        .map(file => ({ file, mtime: fs.statSync(path.join(REPORT_DIR, file)).mtimeMs }))
        .sort((left, right) => right.mtime - left.mtime)[0];
    if (!entry) throw new Error('正式策略基线不存在，请先运行 scripts/strategy-formal-baseline.js');
    return JSON.parse(fs.readFileSync(path.join(REPORT_DIR, entry.file), 'utf8'));
}

function createContext(indexData, candidate = false) {
    const context = helpers.makeBrowserContext();
    vm.runInContext(helpers.read('assets/js/01-config-ui.js'), context);
    vm.runInContext(helpers.read('assets/js/02-data.js'), context);
    vm.runInContext(helpers.read('assets/js/03-calculations.js'), context);
    if (candidate) {
        context.__waveTrendHandoffConfig = VARIANT;
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

function runChain(context, symbol, prepared) {
    helpers.resetActiveSymbolData(context);
    context.__symbol = {
        id: symbol.id,
        mode: symbol.mode,
        rows: helpers.cloneRows(symbol.rows),
        rawSignals: prepared.rawSignals,
        indicators: prepared.indicators
    };
    return JSON.parse(vm.runInContext(`
        (function() {
            setActiveStrategy('波段抄底型');
            state.strategy = '波段抄底型';
            state.mode = __symbol.mode;
            state.id = __symbol.id;
            state.stockId = __symbol.mode === 'stock' ? __symbol.id : null;
            state.rawData[__symbol.id] = __symbol.rows.map((row, index) => ({
                ...row,
                _signals: [...(__symbol.rawSignals[index] || [])],
                _signalVersion: SIGNAL_VERSION
            }));
            state.weeklyData[__symbol.id] = convertDailyToWeekly(state.rawData[__symbol.id]);
            state.indicators = __symbol.indicators;
            state.indicatorKey = '';
            derivedIndicatorCache.clear();
            state.pendingIndicatorMutation = { mode: 'strategy-only', startIdx: 0 };
            updateAllIndicators();
            const full = state.rawData[__symbol.id];
            return JSON.stringify(full.map((row, index) => ({
                date: row.date,
                close: row.close,
                high: row.high,
                low: row.low,
                rawSignals: row._signals || [],
                position: row._decision?.position || 0,
                bsMark: row._decision?.bsMark || null,
                simpleAction: row._decision?.simpleAction || '',
                windowScore: row._decision?.windowScore || 0,
                exitLevel: row._decision?.exit?.level || '',
                riskCoef: row._decision?.risk?.coef ?? 1,
                market: row._decision?.market?.label || '',
                handoff: row._decision?.waveTrendHandoff || null
            })));
        })()
    `, context));
}

function summarizeRows(rows) {
    return summarizePerformance(rows, { startIndex: START_INDEX, costRate: COST_RATE });
}

function buildEvaluationRow(symbol, rows, temporalWindows) {
    return {
        id: symbol.id,
        name: symbol.name,
        mode: symbol.mode,
        phase: symbol.phase || null,
        tags: symbol.tags || [],
        performance: summarizeRows(rows),
        scenarios: buildScenarioSummaries(rows, POLICY),
        temporal: buildTemporalSummaries(rows, temporalWindows, POLICY),
        bs: {
            b: rows.slice(START_INDEX).filter(row => row.bsMark === 'B').length,
            s: rows.slice(START_INDEX).filter(row => row.bsMark === 'S').length
        },
        decisionRows: rows
    };
}

function matchesCohort(row, cohort) {
    if (cohort === 'stocks') return row.mode === 'stock';
    if (cohort === 'phase2') return row.phase === 'phase2';
    return row.mode === 'stock' && row.tags.includes(cohort);
}

function nestedSummary(rows, key, id) {
    return summarizeEvaluationRows(rows
        .filter(row => row[key]?.[id])
        .map(row => ({ ...row, performance: row[key][id], bs: { b: 0, s: 0 } })));
}

function buildEvaluation(controlRows, candidateRows, temporalWindows) {
    const controlSummary = summarizeEvaluationRows(controlRows);
    const candidateSummary = summarizeEvaluationRows(candidateRows);
    const cohorts = {};
    for (const cohort of ['stocks', 'phase2', 'stress', 'highVolatility', 'technology', 'defensive', 'cyclical']) {
        const control = summarizeEvaluationRows(controlRows.filter(row => matchesCohort(row, cohort)));
        const candidate = summarizeEvaluationRows(candidateRows.filter(row => matchesCohort(row, cohort)));
        cohorts[cohort] = { baseline: control, variant: candidate, delta: subtractSummaries(candidate, control) };
    }
    const temporal = Object.fromEntries(temporalWindows.map(window => {
        const control = nestedSummary(controlRows, 'temporal', window.id);
        const candidate = nestedSummary(candidateRows, 'temporal', window.id);
        return [window.id, { baseline: control, variant: candidate, delta: subtractSummaries(candidate, control) }];
    }));
    const stressId = POLICY.gates.stress.scenarioId;
    const stressControl = nestedSummary(controlRows, 'scenarios', stressId);
    const stressCandidate = nestedSummary(candidateRows, 'scenarios', stressId);
    const affected = countAffectedDecisionDays(controlRows, candidateRows);
    const symbolDeltas = candidateRows.map(row => {
        const control = controlRows.find(item => item.id === row.id);
        return { id: row.id, name: row.name, mode: row.mode, delta: subtractSummaries(summarizeEvaluationRows([row]), summarizeEvaluationRows([control])) };
    });
    const delta = subtractSummaries(candidateSummary, controlSummary);
    return {
        baseline: controlSummary,
        variant: candidateSummary,
        delta,
        cohorts,
        temporal,
        costStress: { scenarioId: stressId, delta: subtractSummaries(stressCandidate, stressControl) },
        affectedDecisions: affected,
        symbolDeltas,
        admission: evaluateCandidateGates({
            candidateClass: CANDIDATE.candidateClass,
            policy: POLICY,
            overallDelta: delta,
            temporalDeltas: Object.values(temporal).map(item => item.delta),
            symbolDeltas: symbolDeltas.filter(item => item.mode === 'stock'),
            cohorts,
            stressDelta: subtractSummaries(stressCandidate, stressControl),
            affectedDecisionDays: affected.total,
            completedTrades: candidateSummary.trades.completed
        })
    };
}

function buildBehaviorAudit(controlRows, candidateRows) {
    let candidateOnlyB = 0;
    let appliedDays = 0;
    let appliedAdds = 0;
    const transitions = {};
    for (const candidateSymbol of candidateRows) {
        const controlSymbol = controlRows.find(row => row.id === candidateSymbol.id);
        for (let index = START_INDEX; index < candidateSymbol.decisionRows.length; index++) {
            const control = controlSymbol.decisionRows[index];
            const candidate = candidateSymbol.decisionRows[index];
            if (candidate.bsMark === 'B' && control.bsMark !== 'B') candidateOnlyB++;
            if (candidate.handoff?.applied) {
                appliedDays++;
                const previous = candidateSymbol.decisionRows[index - 1]?.position || 0;
                if (candidate.position > previous) appliedAdds++;
                const key = `${control.position}->${candidate.position}`;
                transitions[key] = (transitions[key] || 0) + 1;
            }
        }
    }
    if (candidateOnlyB !== 0) throw new Error(`趋势接管制造了 ${candidateOnlyB} 个候选独有B`);
    if (appliedAdds !== 0) throw new Error(`趋势接管主动加仓 ${appliedAdds} 次`);
    return { candidateOnlyB, appliedDays, appliedAdds, transitions };
}

function main() {
    const baseline = latestBaseline();
    const commonAsOf = baseline.dataSnapshot?.commonAsOf || '';
    const temporalWindows = baseline.validationPolicy?.temporalWindows || [];
    if (temporalWindows.length !== POLICY.temporalWindows.count) throw new Error('正式基线缺少三段时间窗口');

    const loaded = helpers.loadCacheSymbols();
    const symbols = loaded.symbols.map(symbol => ({
        ...symbol,
        rows: symbol.rows.filter(row => !commonAsOf || row.date <= commonAsOf)
    }));
    const indexData = Object.fromEntries(symbols.filter(symbol => symbol.mode === 'index').map(symbol => [symbol.id, symbol.rows]));
    const productionContext = createContext(indexData, false);
    const candidateContext = createContext(indexData, true);
    const controlRows = [];
    const candidateRows = [];

    for (const [symbolIndex, symbol] of symbols.entries()) {
        const prepared = helpers.prepareSymbolContext(productionContext, symbol);
        const control = runChain(productionContext, symbol, prepared);
        const candidate = runChain(candidateContext, symbol, prepared);
        controlRows.push(buildEvaluationRow(symbol, control, temporalWindows));
        candidateRows.push(buildEvaluationRow(symbol, candidate, temporalWindows));
        if (process.argv.includes('--progress')) console.error(`[wave-trend-handoff] ${symbolIndex + 1}/${symbols.length} ${symbol.id}`);
    }

    const evaluation = buildEvaluation(controlRows, candidateRows, temporalWindows);
    const behaviorAudit = buildBehaviorAudit(controlRows, candidateRows);
    const focusControl = controlRows.find(row => row.id === '605337');
    const focusCandidate = candidateRows.find(row => row.id === '605337');
    const focusChanges = focusControl && focusCandidate ? focusCandidate.decisionRows.map((row, index) => ({
        date: row.date,
        close: row.close,
        rawSignals: row.rawSignals,
        controlPosition: focusControl.decisionRows[index]?.position || 0,
        candidatePosition: row.position,
        handoff: row.handoff
    })).filter(row => row.controlPosition !== row.candidatePosition) : [];

    const report = {
        generatedAt: new Date().toISOString(),
        method: 'production-js-vm-local-cache-wave-trend-handoff-overlay',
        strategy: STRATEGY,
        candidate: { ...CANDIDATE, hash: stableHash(CANDIDATE) },
        appBuild: baseline.appBuild,
        signalVersion: baseline.signalVersion,
        dataSnapshot: {
            commonAsOf,
            hash: baseline.dataSnapshot?.hash || '',
            symbols: symbols.length,
            stocks: symbols.filter(symbol => symbol.mode === 'stock').length,
            indices: symbols.filter(symbol => symbol.mode === 'index').length
        },
        behaviorAudit,
        focusCase: { id: '605337', name: '李子园', changes: focusChanges },
        evaluation
    };
    fs.mkdirSync(REPORT_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
    const reportPath = path.join(REPORT_DIR, `wave-trend-handoff-lab-${stamp}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({
        reportPath: path.relative(ROOT, reportPath),
        candidate: report.candidate,
        dataSnapshot: report.dataSnapshot,
        behaviorAudit,
        focusCase: report.focusCase,
        result: {
            delta: evaluation.delta,
            affectedDecisions: evaluation.affectedDecisions,
            admission: evaluation.admission
        }
    }, null, 2));
}

main();
