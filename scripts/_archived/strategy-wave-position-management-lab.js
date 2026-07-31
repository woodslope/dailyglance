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
const targetFlag = process.argv.find(arg => arg.startsWith('--target-position='));
const TARGET_POSITION = targetFlag ? Number(targetFlag.split('=')[1]) : 50;
if (![50, 80].includes(TARGET_POSITION)) throw new Error('--target-position 只支持 50 或 80');
const CANDIDATE = {
    id: `wave_confirmation_position_${TARGET_POSITION}_v1`,
    label: `波段右侧确认${TARGET_POSITION}%加仓与获利保护`,
    candidateClass: 'performance',
    targetPosition: TARGET_POSITION,
    objective: `保留低位30%试探仓，在趋势确认后升至${TARGET_POSITION}%，并在高位转弱时退回30%，避免改变首次抄底仓位语义。`,
    entry: `已有30%波段试探仓，当日B3或B15出现、收盘站上MA20、无当前离场/预警、风险系数为1且核心门禁允许加仓时，升至${TARGET_POSITION}%。`,
    protection: `确认仓位达到${TARGET_POSITION}%后，L6连阳后首阴或W3放量滞涨出现时降回30%；确认积分暂时归零但未触发强离场时也先退回30%试探仓，避免改变首次买点路径；L5、L9/W1、风险系数下降、跌破MA20与L3/L10仍按生产防守链优先。`,
    boundary: '只作用于股票波段抄底型；不改变首次B、不制造候选独有B、不改变其它三套策略。',
    riskBudget: '平均收益至少提高0.5个百分点；平均回撤最多恶化0.5个百分点；换手最多增加10%；主要分层收益/回撤最多恶化1个百分点；三段窗口至少两段收益不退化。'
};

const CANDIDATE_RUNTIME = `
var __productionWavePositionManagementDecision = computeDecisionForIndex;

function getWavePositionManagementState(idx, full, prevPos, decision, meta) {
    var previous = full[idx - 1] && full[idx - 1]._decision;
    var previousState = previous && previous.wavePositionManagement;
    var rawSignals = full[idx]._signals || [];
    var close = Number(full[idx].close);
    var ma20 = Number(state.indicators.ma && state.indicators.ma[20] && state.indicators.ma[20][idx]);
    var hasDirectExit = (meta.exitSignals || []).length > 0;
    var hasWarning = (meta.warningSignals || []).length > 0;
    var riskNormal = Number(decision.risk && decision.risk.coef) === 1;
    var trendIntact = Number.isFinite(close) && Number.isFinite(ma20) && close >= ma20;
    var marketAllowsAdd = !(decision.market && decision.market.allowAdd === false);
    return {
        previousActive: !!(previousState && previousState.active),
        rawSignals: rawSignals,
        close: close,
        ma20: ma20,
        hasDirectExit: hasDirectExit,
        hasWarning: hasWarning,
        riskNormal: riskNormal,
        trendIntact: trendIntact,
        marketAllowsAdd: marketAllowsAdd,
        rightConfirm: rawSignals.includes('B3') || rawSignals.includes('B15'),
        highRisk: rawSignals.includes('L6') || rawSignals.includes('W3')
    };
}

computeDecisionForIndex = function(idx, full, prevPos) {
    var decision = __productionWavePositionManagementDecision(idx, full, prevPos);
    if (state.strategy !== '波段抄底型' || state.mode !== 'stock') return decision;

    var meta = getSignalMeta(idx, full, state.indicators);
    var ctx = getWavePositionManagementState(idx, full, prevPos, decision, meta);
    var strongExit = ['清仓防守', '强离场'].includes(decision.exit && decision.exit.level);
    var ordinaryDefense = ctx.hasDirectExit || ctx.hasWarning || !ctx.riskNormal || !ctx.trendIntact;

    // Compare the confirm position with the original 30% trial before allowing it to exit.
    // Otherwise a temporary score drop can create a fresh B when repair signals return.
    var trialDecision = ctx.previousActive && prevPos >= ${TARGET_POSITION} && !strongExit
        ? __productionWavePositionManagementDecision(idx, full, 30)
        : null;
    if (trialDecision && decision.position === 0 && trialDecision.position > 0) {
        decision.position = trialDecision.position;
        decision.bsMark = null;
        decision.simpleAction = '防守减仓';
        decision.simpleColorClass = 'text-warn';
        decision.positionDriver = '确认仓触发普通防守时，生产30%试探仓仍可维持；先退回试探仓，避免确认仓退出改变首次买点路径。';
        decision.wavePositionManagement = { active: false, phase: 'revert-to-trial' };
        return decision;
    }

    if (strongExit || ordinaryDefense) {
        decision.wavePositionManagement = { active: false, phase: ordinaryDefense ? 'deactivated' : 'cleared' };
        return decision;
    }

    if (ctx.previousActive && prevPos >= ${TARGET_POSITION} && ctx.highRisk) {
        decision.position = 30;
        decision.bsMark = null;
        decision.simpleAction = '防守减仓';
        decision.simpleColorClass = 'text-warn';
        decision.positionDriver = '波段确认仓出现连阳后首阴或放量滞涨，先由${TARGET_POSITION}%降回30%保护浮盈。';
        decision.wavePositionManagement = { active: false, phase: 'profit-protect', signals: ctx.rawSignals.filter(signal => signal === 'L6' || signal === 'W3') };
        return decision;
    }

    if (ctx.previousActive && prevPos >= ${TARGET_POSITION}) {
        if (decision.position < ${TARGET_POSITION}) {
            decision.position = ${TARGET_POSITION};
            decision.bsMark = null;
            decision.simpleAction = '积极持有';
            decision.simpleColorClass = 'text-bull';
            decision.positionDriver = '波段30%试探仓已完成右侧确认；趋势未破时维持${TARGET_POSITION}%确认仓，避免旧积分到期单独降仓。';
        }
        decision.wavePositionManagement = { active: true, phase: 'confirmed-hold' };
        return decision;
    }

    var canPromote = prevPos === 30 && decision.position === 30
        && ctx.rightConfirm && ctx.marketAllowsAdd;
    if (canPromote) {
        decision.position = ${TARGET_POSITION};
        decision.bsMark = null;
        decision.simpleAction = '顺势加仓';
        decision.simpleColorClass = 'text-bull';
        decision.positionDriver = '波段30%试探仓出现右侧趋势确认，升至${TARGET_POSITION}%确认仓；首次买点语义不变。';
        decision.wavePositionManagement = { active: true, phase: 'confirmed-add', signals: ctx.rawSignals.filter(signal => signal === 'B3' || signal === 'B15') };
        return decision;
    }

    decision.wavePositionManagement = { active: false, phase: 'inactive' };
    return decision;
};
`;

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
    return runProductionChain(context, symbol, strategy, prepared).rows;
}

function evaluationRow(symbol, rows, temporalWindows) {
    return {
        id: symbol.id,
        name: symbol.name,
        mode: symbol.mode,
        phase: symbol.phase || null,
        tags: symbol.tags || [],
        performance: summarizePerformance(rows, { startIndex: START_INDEX, costRate: 0.001 }),
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

function behaviorAudit(controlRows, candidateRows) {
    let candidateOnlyB = 0;
    let adds = 0;
    let protections = 0;
    const transitions = {};
    const candidateOnlyBEvents = [];
    for (const candidate of candidateRows) {
        const control = controlRows.find(row => row.id === candidate.id);
        for (let index = START_INDEX; index < candidate.decisionRows.length; index++) {
            const before = control.decisionRows[index];
            const after = candidate.decisionRows[index];
            if (after.bsMark === 'B' && before.bsMark !== 'B') {
                candidateOnlyB++;
                candidateOnlyBEvents.push({
                    id: candidate.id,
                    name: candidate.name,
                    date: after.date,
                    controlPosition: before.position,
                    candidatePosition: after.position
                });
            }
            if (after.position > before.position) adds++;
            if (before.position >= TARGET_POSITION && after.position === 30) protections++;
            if (before.position !== after.position) {
                const key = `${before.position}->${after.position}`;
                transitions[key] = (transitions[key] || 0) + 1;
            }
        }
    }
    return { candidateOnlyB, candidateOnlyBEvents, adds, protections, transitions };
}

function main() {
    const baseline = latestBaseline();
    const commonAsOf = baseline.dataSnapshot && baseline.dataSnapshot.commonAsOf;
    const temporalWindows = baseline.validationPolicy && baseline.validationPolicy.temporalWindows || [];
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
            console.error(`[wave-position-management] ${symbolIndex + 1}/${symbols.length} ${symbol.id} ${Math.round((Date.now() - startedAt) / 1000)}s`);
        }
    }

    const evaluation = evaluate(controlRows, candidateRows, temporalWindows, SCREEN_MODE);
    const report = {
        generatedAt: new Date().toISOString(),
        method: 'production-js-vm-local-cache-wave-position-management-overlay',
        appBuild: baseline.appBuild,
        signalVersion: baseline.signalVersion,
        candidate: { ...CANDIDATE, hash: stableHash(CANDIDATE) },
        dataSnapshot: { commonAsOf, hash: baseline.dataSnapshot && baseline.dataSnapshot.hash, symbols: symbols.length, stocks: symbols.filter(symbol => symbol.mode === 'stock').length },
        behaviorAudit: behaviorAudit(controlRows, candidateRows),
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
    const reportPrefix = TARGET_POSITION === 50 ? 'wave-position-management-lab' : `wave-position-management-${TARGET_POSITION}-lab`;
    const reportPath = path.join(REPORT_DIR, `${reportPrefix}-${stamp}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    const affected = evaluation.affectedDecisions;
    const admission = evaluation.admission;
    console.log(JSON.stringify({
        reportPath: path.relative(ROOT, reportPath),
        candidate: {
            id: report.candidate.id,
            label: report.candidate.label,
            candidateClass: report.candidate.candidateClass,
            targetPosition: report.candidate.targetPosition
        },
        dataSnapshot: report.dataSnapshot,
        screen: report.screen,
        behaviorAudit: {
            candidateOnlyB: report.behaviorAudit.candidateOnlyB,
            adds: report.behaviorAudit.adds,
            protections: report.behaviorAudit.protections,
            transitions: report.behaviorAudit.transitions,
            candidateOnlyBEventCount: report.behaviorAudit.candidateOnlyBEvents.length
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
