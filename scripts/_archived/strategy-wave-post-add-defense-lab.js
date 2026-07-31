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
const modeFlag = process.argv.find(arg => arg.startsWith('--mode='));
const DEFENSE_MODE = modeFlag ? modeFlag.split('=')[1] : 'add-day-and-higher-low';
if (!['add-day-and-higher-low', 'confirmed-higher-low'].includes(DEFENSE_MODE)) {
    throw new Error('--mode 只支持 add-day-and-higher-low 或 confirmed-higher-low');
}
const USE_ADD_DAY_DEFENSE = DEFENSE_MODE === 'add-day-and-higher-low';
const CANDIDATE = {
    id: USE_ADD_DAY_DEFENSE ? 'wave_post_add_structure_defense_v1' : 'wave_confirmed_higher_low_defense_v1',
    label: USE_ADD_DAY_DEFENSE ? '波段加仓后更高低点动态防守' : '波段确认更高低点动态防守',
    candidateClass: 'risk_control',
    defenseMode: DEFENSE_MODE,
    objective: USE_ADD_DAY_DEFENSE
        ? '解决波段仓位由试探仓提高后仍只依赖较远失效位的问题；仅在确认更高低点后上移近端防守，跌破时把确认仓退回30%试探仓。'
        : '只验证回踩后再次上涨形成的确认更高低点能否成为确认仓防守线，避免把加仓日低点提前当作结构低点。',
    activation: USE_ADD_DAY_DEFENSE
        ? '仅股票波段抄底型：已有1%至30%仓位，生产链当日将仓位提高到50%或80%时，记录加仓日低点作为临时近端防守。'
        : '仅股票波段抄底型：已有1%至30%仓位，生产链当日将仓位提高到50%或80%后，等待回踩低点得到确认；未确认前不新增近端结构卖出。',
    higherLow: '回踩低点必须在其后至少两根K线低点均更高后才确认，且该低点高于本轮有效买入信号的原始结构锚点；防守位只允许上移，不允许下移。',
    protection: '收盘跌破近端防守位时，50%或80%确认仓降至30%试探仓，并禁止同一轮持仓再次自动加仓；原有硬失效、强离场、冷静期和市场门禁继续优先。',
    boundary: '不修改首次B、不制造候选独有B/S、不改变首次开仓或原有硬清仓条件；只在本地VM回放中覆盖最终仓位。',
    riskBudget: '平均最大回撤至少改善0.5个百分点，平均收益最多回退0.5个百分点，换手增加不超过10%，且至少两个时间窗口的回撤达到改善门槛。'
};

// The runtime is injected after the production decision function so the candidate
// can exercise the exact production signal, risk, gate, and exit chain first.
const CANDIDATE_RUNTIME = String.raw`
var __productionWavePostAddDefenseDecision = computeDecisionForIndex;
var __wavePostAddDefenseMode = '${DEFENSE_MODE}';

function getWaveSignalStructureAnchor(meta, full, fallback) {
    var levels = (meta && meta.windowScoreSignals || [])
        .filter(function(item) { return item && typeof item.signal === 'string' && item.signal.indexOf('B') === 0; })
        .map(function(item) { return Number(full[item.day] && full[item.day].low); })
        .filter(Number.isFinite);
    if (levels.length) return Math.min.apply(null, levels);
    return Number.isFinite(Number(fallback)) ? Number(fallback) : null;
}

function getConfirmedWaveHigherLow(idx, full, activationDay, structureAnchor, currentDefense) {
    var pivotDays = 2;
    // A pivot can only become newly knowable today when its second right-side
    // bar closes, so checking older bars again adds no information.
    var day = idx - pivotDays;
    if (day <= activationDay || day < pivotDays) return null;
    var low = Number(full[day] && full[day].low);
    if (!Number.isFinite(low) || low <= structureAnchor || (Number.isFinite(currentDefense) && low <= currentDefense)) return null;
    for (var offset = 1; offset <= pivotDays; offset++) {
        var leftLow = Number(full[day - offset] && full[day - offset].low);
        var rightLow = Number(full[day + offset] && full[day + offset].low);
        if (!Number.isFinite(leftLow) || !Number.isFinite(rightLow) || low >= leftLow || low >= rightLow) {
            return null;
        }
    }
    return {
        level: low,
        day: day,
        date: full[day] && full[day].date || '',
        confirmedDay: idx,
        confirmedDate: full[idx] && full[idx].date || ''
    };
}

function capWavePostAddPosition(decision, trail, phase, reason) {
    var currentPosition = Number(decision.position) || 0;
    var cappedPosition = Math.min(currentPosition, 30);
    var applied = currentPosition > cappedPosition;
    if (applied) {
        decision.position = cappedPosition;
        decision.bsMark = null;
        decision.simpleAction = '防守减仓';
        decision.simpleColorClass = 'text-warn';
        decision.positionDriver = reason;
    }
    decision.wavePostAddDefense = Object.assign({}, trail, {
        active: true,
        locked: true,
        phase: phase,
        applied: applied,
        activatedToday: false,
        breakToday: phase === 'near-defense-break',
        raisedToday: false
    });
    return decision;
}

computeDecisionForIndex = function(idx, full, prevPos) {
    var decision = __productionWavePostAddDefenseDecision(idx, full, prevPos);
    if (state.strategy !== '波段抄底型' || state.mode !== 'stock') return decision;

    var previous = full[idx - 1] && full[idx - 1]._decision;
    var previousTrail = previous && previous.wavePostAddDefense;
    var trail = previousTrail ? Object.assign({}, previousTrail) : null;
    var currentPosition = Number(decision.position) || 0;

    // Production exits always win. A completed holding cycle unlocks the next cycle.
    if (trail && trail.active && currentPosition === 0) {
        decision.wavePostAddDefense = Object.assign({}, trail, {
            active: false,
            phase: 'ended-by-production-exit',
            applied: false,
            activatedToday: false,
            breakToday: false,
            raisedToday: false
        });
        return decision;
    }

    // Once the confirmation leg fails, production may keep its 30% trial but may not
    // use the same old signals to add back until the holding cycle has ended.
    if (trail && trail.active && trail.locked) {
        return capWavePostAddPosition(
            decision,
            trail,
            'locked-to-trial',
            '加仓后的近端结构防守已失守；本轮只保留生产链允许的试探仓，待清仓后再重新评估。'
        );
    }

    var promoted = Number(prevPos) > 0
        && Number(prevPos) <= 30
        && currentPosition >= 50
        && currentPosition > Number(prevPos);
    if (!trail || !trail.active) {
        if (!promoted) {
            decision.wavePostAddDefense = trail || null;
            return decision;
        }
        var meta = getSignalMeta(idx, full, state.indicators);
        var addLow = Number(full[idx] && full[idx].low);
        var b11Structure = Number(decision.b11StructureDefense && decision.b11StructureDefense.structureLevel);
        var anchor = Number.isFinite(b11Structure)
            ? b11Structure
            : getWaveSignalStructureAnchor(meta, full, addLow);
        var useAddDayDefense = __wavePostAddDefenseMode === 'add-day-and-higher-low';
        trail = {
            active: true,
            locked: false,
            phase: useAddDayDefense ? 'armed' : 'waiting-for-higher-low',
            activationDay: idx,
            activationDate: full[idx] && full[idx].date || '',
            activationPosition: currentPosition,
            structureAnchor: anchor,
            structureAnchorSource: Number.isFinite(b11Structure) ? 'b11-structure' : 'effective-buy-signal-low',
            initialDefense: useAddDayDefense ? addLow : null,
            defenseLevel: useAddDayDefense ? addLow : null,
            defenseSource: useAddDayDefense ? 'add-day-low' : '',
            defenseDate: useAddDayDefense ? full[idx] && full[idx].date || '' : '',
            applied: false,
            activatedToday: true,
            breakToday: false,
            raisedToday: false
        };
        decision.wavePostAddDefense = trail;
        return decision;
    }

    var higherLow = getConfirmedWaveHigherLow(
        idx,
        full,
        Number(trail.activationDay),
        Number(trail.structureAnchor),
        Number.isFinite(trail.defenseLevel) ? Number(trail.defenseLevel) : null
    );
    if (higherLow) {
        trail.defenseLevel = higherLow.level;
        trail.defenseSource = 'confirmed-higher-low';
        trail.defenseDay = higherLow.day;
        trail.defenseDate = higherLow.date;
        trail.confirmedDay = higherLow.confirmedDay;
        trail.confirmedDate = higherLow.confirmedDate;
        trail.raisedToday = true;
    } else {
        trail.raisedToday = false;
    }

    var close = Number(full[idx] && full[idx].close);
    if (idx > Number(trail.activationDay)
        && Number.isFinite(trail.defenseLevel)
        && Number.isFinite(close)
        && close < Number(trail.defenseLevel)) {
        return capWavePostAddPosition(
            decision,
            trail,
            'near-defense-break',
            '收盘跌破加仓后的近端结构防守位；确认仓退回30%试探仓，原始硬失效和强离场规则仍有效。'
        );
    }

    decision.wavePostAddDefense = Object.assign({}, trail, {
        active: true,
        locked: false,
        phase: higherLow ? 'higher-low-raised' : (Number.isFinite(trail.defenseLevel) ? 'holding' : 'waiting-for-higher-low'),
        applied: false,
        activatedToday: false,
        breakToday: false
    });
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

function runRows(context, symbol, prepared) {
    runProductionChain(context, symbol, STRATEGY_NAME, prepared);
    context.__wavePostAddDefenseSymbolId = symbol.id;
    return JSON.parse(vm.runInContext(`
        JSON.stringify(state.rawData[__wavePostAddDefenseSymbolId].map(row => ({
            date: row.date,
            close: row.close,
            position: row._decision?.position || 0,
            bsMark: row._decision?.bsMark || null,
            simpleAction: row._decision?.simpleAction || '',
            wavePostAddDefense: row._decision?.wavePostAddDefense || null
        })))
    `, context));
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
        return {
            id: candidate.id,
            mode: candidate.mode,
            delta: subtractSummaries(
                summarizeEvaluationRows([candidate]),
                summarizeEvaluationRows([control])
            )
        };
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
    let armed = 0;
    let higherLowRaised = 0;
    let defenseBreaks = 0;
    let directDemotions = 0;
    let lockedDecisionDays = 0;
    const transitions = {};
    const breakEvents = [];

    for (const candidate of candidateRows) {
        const control = controlRows.find(row => row.id === candidate.id);
        for (let index = START_INDEX; index < candidate.decisionRows.length; index++) {
            const before = control.decisionRows[index];
            const after = candidate.decisionRows[index];
            const trail = after.wavePostAddDefense;
            if (after.bsMark === 'B' && before.bsMark !== 'B') candidateOnlyB++;
            if (trail?.activatedToday) armed++;
            if (trail?.raisedToday) higherLowRaised++;
            if (trail?.locked) lockedDecisionDays++;
            if (trail?.breakToday) {
                defenseBreaks++;
                if (after.position < before.position) directDemotions++;
                breakEvents.push({
                    id: candidate.id,
                    name: candidate.name,
                    date: after.date,
                    controlPosition: before.position,
                    candidatePosition: after.position,
                    defenseLevel: trail.defenseLevel,
                    defenseSource: trail.defenseSource
                });
            }
            if (before.position !== after.position) {
                const key = `${before.position}->${after.position}`;
                transitions[key] = (transitions[key] || 0) + 1;
            }
        }
    }
    return {
        candidateOnlyB,
        armed,
        higherLowRaised,
        defenseBreaks,
        directDemotions,
        lockedDecisionDays,
        transitions,
        breakEvents
    };
}

function main() {
    const baseline = latestBaseline();
    const commonAsOf = baseline.dataSnapshot?.commonAsOf;
    const temporalWindows = baseline.validationPolicy?.temporalWindows || [];
    if (temporalWindows.length !== POLICY.temporalWindows.count) throw new Error('正式基线缺少完整时间窗口');
    const loaded = loadCacheSymbols();
    const allSymbols = loaded.symbols.map(symbol => ({
        ...symbol,
        rows: symbol.rows.filter(row => !commonAsOf || row.date <= commonAsOf)
    }));
    const symbols = SCREEN_MODE ? selectScreenSymbols(allSymbols) : allSymbols;
    if (!symbols.some(symbol => symbol.mode === 'stock')) throw new Error('快速筛选缺少股票样本');
    const indexData = Object.fromEntries(symbols
        .filter(symbol => symbol.mode === 'index')
        .map(symbol => [symbol.id, symbol.rows]));
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
            console.error(`[wave-post-add-defense] ${symbolIndex + 1}/${symbols.length} ${symbol.id} ${Math.round((Date.now() - startedAt) / 1000)}s`);
        }
    }

    const evaluation = evaluate(controlRows, candidateRows, temporalWindows, SCREEN_MODE);
    const report = {
        generatedAt: new Date().toISOString(),
        method: 'production-js-vm-local-cache-wave-post-add-structure-defense-overlay',
        appBuild: baseline.appBuild,
        signalVersion: baseline.signalVersion,
        candidate: { ...CANDIDATE, hash: stableHash(CANDIDATE) },
        dataSnapshot: {
            commonAsOf,
            hash: baseline.dataSnapshot?.hash,
            symbols: symbols.length,
            stocks: symbols.filter(symbol => symbol.mode === 'stock').length
        },
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
    const reportPath = path.join(REPORT_DIR, `wave-post-add-defense-${DEFENSE_MODE}-lab-${stamp}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    const affected = evaluation.affectedDecisions;
    const admission = evaluation.admission;
    console.log(JSON.stringify({
        reportPath: path.relative(ROOT, reportPath),
        candidate: {
            id: report.candidate.id,
            label: report.candidate.label,
            candidateClass: report.candidate.candidateClass,
            defenseMode: report.candidate.defenseMode
        },
        dataSnapshot: report.dataSnapshot,
        screen: report.screen,
        behaviorAudit: {
            candidateOnlyB: report.behaviorAudit.candidateOnlyB,
            armed: report.behaviorAudit.armed,
            higherLowRaised: report.behaviorAudit.higherLowRaised,
            defenseBreaks: report.behaviorAudit.defenseBreaks,
            directDemotions: report.behaviorAudit.directDemotions,
            lockedDecisionDays: report.behaviorAudit.lockedDecisionDays,
            transitions: report.behaviorAudit.transitions,
            breakEventCount: report.behaviorAudit.breakEvents.length
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
