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
const INDEX_IDS = ['sh', 'sz', 'hs300', 'zz500', 'zz1000', 'cy', 'kc50', 'bz50'];
const VALIDATION_POLICY = JSON.parse(fs.readFileSync(path.join(ROOT, 'strategy-validation-policy.json'), 'utf8'));
const START_INDEX = VALIDATION_POLICY.baselineStartIndex;
const COST_RATE = VALIDATION_POLICY.costScenarios.find(item => item.id === 'standard')?.costRate || 0.001;
const strategyArgIndex = process.argv.indexOf('--strategy');
const requestedStrategy = strategyArgIndex >= 0 ? process.argv[strategyArgIndex + 1] || '' : '';
const variantArgIndex = process.argv.indexOf('--variant');
const requestedVariant = variantArgIndex >= 0 ? process.argv[variantArgIndex + 1] || '' : '';
const showProgress = process.argv.includes('--progress');

const CANDIDATES = {
    '稳健趋势型': {
        id: 'formal_trend_signal_ablation',
        question: '逐个移除稳健趋势型当前已纳入的趋势确认信号，能否识别重复贡献且不损失默认策略的趋势跟随职责？',
        type: 'buy-signal-ablation',
        control: {
            id: 'retain_production_control',
            label: '保留当前稳健生产配置',
            collectDecisionDetails: true
        },
        preflight: {
            controlId: 'retain_production_control',
            candidateId: 'drop_b15_signal'
        },
        ablations: [
            { id: 'drop_b1_signal', label: '仅移除 B1 均线多头', removeBuySignals: ['B1'] },
            { id: 'drop_b10_signal', label: '仅移除 B10 MA20 上穿 MA60', removeBuySignals: ['B10'] },
            { id: 'drop_b13_signal', label: '仅移除 B13 长级别走强', removeBuySignals: ['B13'] },
            { id: 'drop_b15_signal', label: '仅移除 B15 均线二次金叉', removeBuySignals: ['B15'], collectDecisionDetails: true }
        ]
    },
    '波段抄底型': {
        id: 'formal_wave_repair_signal_ablation',
        question: '逐个移除波段抄底型 B9/B16/B17 修复信号，能否识别其对 30% 试探仓、首次 B 和下跌中继误判的独立贡献？',
        type: 'buy-signal-ablation',
        candidateClass: 'risk_control',
        control: {
            id: 'retain_wave_production_control',
            label: '保留当前波段生产配置',
            collectDecisionDetails: true
        },
        waveTrialAttribution: {
            controlId: 'retain_wave_production_control',
            candidates: [
                { signal: 'B9', candidateId: 'wave_drop_b9_signal' },
                { signal: 'B16', candidateId: 'wave_drop_b16_signal' },
                { signal: 'B17', candidateId: 'wave_drop_b17_signal' }
            ]
        },
        ablations: [
            { id: 'wave_drop_b9_signal', label: '仅移除 B9 MACD 底背离', removeBuySignals: ['B9'], collectDecisionDetails: true },
            {
                id: 'wave_drop_b16_signal',
                label: '仅移除 B16 回踩周线支撑企稳',
                removeBuySignals: ['B16'],
                collectDecisionDetails: true,
                objective: '减少波段抄底型中 B16 在下跌中继阶段触发 30% 试探造成的误买与回撤',
                category: 'risk_control',
                allowedBsImpact: '仅允许改变波段抄底型自身的首次/后续 B/S 与仓位路径；其他三套策略必须零漂移',
                riskBudget: '平均回撤至少改善0.5个百分点；收益最多回退0.5个百分点；换手最多增加10%；主要分层收益/回撤最多恶化1个百分点；三段时间窗口至少两段通过',
                restartCondition: '若历史准入失败，只能在新增独立交易时段/新标的，或出现可定位到 B16 的真实下跌中继误买案例后重启，不在同一快照叠加条件'
            },
            { id: 'wave_drop_b17_signal', label: '仅移除 B17 超跌止跌反弹', removeBuySignals: ['B17'], collectDecisionDetails: true }
        ]
    },
    '突破追涨型': {
        id: 'baseline_retained',
        question: '完整样本下突破追涨保持最低回撤与较高胜率，本轮保持基线，不为少量压力样本收紧参与条件。',
        type: 'baseline-retained',
        candidateClass: 'control'
    },
    '综合全能型': {
        id: 'formal_buy_signal_ablation',
        question: '逐组并逐个移除综合全能型当前已纳入的买入信号，能否识别重复贡献、过度交易或缺少独立价值的信号？',
        type: 'buy-signal-ablation',
        candidateClass: 'efficiency',
        ablations: [
            { id: 'drop_trend_group', label: '移除趋势确认组', removeBuySignals: ['B1', 'B10', 'B15'] },
            { id: 'drop_macd_group', label: '移除 MACD 动量组', removeBuySignals: ['B2', 'B12'] },
            { id: 'drop_b3_group', label: '移除 B3 上穿 20 日线组', removeBuySignals: ['B3'] },
            { id: 'drop_breakout_group', label: '移除突破组', removeBuySignals: ['B4', 'B14'] },
            { id: 'drop_repair_group', label: '移除回踩修复组', removeBuySignals: ['B5', 'B6', 'B11', 'B16'] },
            { id: 'drop_b7_group', label: '移除 B7 超卖修复组', removeBuySignals: ['B7'] },
            {
                id: 'drop_b9_group',
                label: '移除 B9 MACD 底背离组',
                removeBuySignals: ['B9'],
                objective: '减少综合全能型中与其他修复信号重叠造成的重复试探与调仓噪音',
                category: 'efficiency',
                allowedBsImpact: '仅允许改变综合全能型自身的首次/后续 B/S；其他三套策略必须零漂移',
                riskBudget: '换手至少下降10%；收益最多回退0.25个百分点；平均回撤最多恶化0.25个百分点；主要分层收益/回撤最多恶化1个百分点'
            },
            { id: 'drop_b17_group', label: '移除 B17 止跌反弹组', removeBuySignals: ['B17'] },
            { id: 'drop_b1_signal', label: '仅移除 B1 均线多头', removeBuySignals: ['B1'] },
            { id: 'drop_b2_signal', label: '仅移除 B2 MACD 金叉', removeBuySignals: ['B2'] },
            { id: 'drop_b4_signal', label: '仅移除 B4 放量突破新高', removeBuySignals: ['B4'] },
            { id: 'drop_b5_signal', label: '仅移除 B5 阳包阴', removeBuySignals: ['B5'] },
            { id: 'drop_b6_signal', label: '仅移除 B6 缩量回踩不破', removeBuySignals: ['B6'] },
            { id: 'drop_b10_signal', label: '仅移除 B10 MA20 上穿 MA60', removeBuySignals: ['B10'] },
            { id: 'drop_b11_signal', label: '仅移除 B11 均线回踩不破', removeBuySignals: ['B11'] },
            { id: 'drop_b12_signal', label: '仅移除 B12 零轴上金叉', removeBuySignals: ['B12'] },
            { id: 'drop_b14_signal', label: '仅移除 B14 平台放量突破', removeBuySignals: ['B14'] },
            {
                id: 'drop_b15_signal',
                label: '仅移除 B15 均线二次金叉',
                removeBuySignals: ['B15'],
                objective: '减少综合全能型趋势确认组中 B15 独立维持积分造成的重复仓位调整，同时保留 B1/B10 的趋势确认职责',
                category: 'efficiency',
                allowedBsImpact: '仅允许改变综合全能型自身的首次/后续 B/S；其他三套策略必须零漂移',
                riskBudget: '换手至少下降10%；收益最多回退0.25个百分点；平均回撤最多恶化0.25个百分点；主要分层收益/回撤最多恶化1个百分点',
                restartCondition: '若历史准入失败，只能在新增独立交易时段/新标的，或出现可定位到 B15 的真实重复调仓案例后重启，不在同一快照叠加条件'
            },
            { id: 'drop_b16_signal', label: '仅移除 B16 回踩周线支撑企稳', removeBuySignals: ['B16'] }
        ]
    }
};

function read(file) {
    return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

function readJson(file) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function cloneRows(rows) {
    return rows.map(row => ({
        date: row.date,
        open: Number(row.open),
        high: Number(row.high),
        low: Number(row.low),
        close: Number(row.close),
        vol: Number(row.vol) || 0,
        amt: Number(row.amt) || 0
    }));
}

function round(value, digits = 4) {
    return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function mean(values) {
    const valid = values.filter(Number.isFinite);
    return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : NaN;
}

function makeBrowserContext() {
    const storage = new Map();
    const makeEl = () => ({
        style: {}, dataset: {}, innerHTML: '', innerText: '', textContent: '', disabled: false,
        classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} },
        focus() {}, querySelector() { return null; }, querySelectorAll() { return []; },
        addEventListener() {}, appendChild() {}, remove() {}
    });
    const context = {
        console, setTimeout, clearTimeout,
        setInterval() { return 0; },
        clearInterval() {},
        performance: { now: () => 0 },
        localStorage: {
            getItem(key) { return storage.has(key) ? storage.get(key) : null; },
            setItem(key, value) { storage.set(key, String(value)); },
            removeItem(key) { storage.delete(key); }
        },
        requestAnimationFrame(fn) { return setTimeout(fn, 0); },
        cancelAnimationFrame(id) { clearTimeout(id); },
        getComputedStyle() { return { getPropertyValue() { return ''; } }; },
        document: {
            hidden: false, addEventListener() {}, querySelector() { return makeEl(); },
            querySelectorAll() { return []; }, getElementById() { return makeEl(); },
            createElement() { return makeEl(); }, head: makeEl()
        },
        window: {}, indexedDB: { open() { return {}; } }
    };
    context.window = context;
    return vm.createContext(context);
}

function latestBaselinePath() {
    const latest = fs.readdirSync(REPORT_DIR)
        .filter(file => /^formal-strategy-baseline-.*\.json$/.test(file))
        .map(file => ({ file, modifiedAt: fs.statSync(path.join(REPORT_DIR, file)).mtimeMs }))
        .sort((left, right) => right.modifiedAt - left.modifiedAt)[0];
    if (!latest) throw new Error('formal baseline report is missing');
    return path.join(REPORT_DIR, latest.file);
}

function createContext(indexData) {
    const context = makeBrowserContext();
    vm.runInContext(read('assets/js/01-config-ui.js'), context);
    vm.runInContext(read('assets/js/02-data.js'), context);
    vm.runInContext(read('assets/js/03-calculations.js'), context);
    vm.runInContext('globalThis.__formalBaseStrategies = JSON.parse(JSON.stringify(STRATEGIES));', context);
    context.__indexData = Object.fromEntries(Object.entries(indexData).map(([id, rows]) => [id, cloneRows(rows)]));
    vm.runInContext(`
        state.period = 'daily';
        state.rawData = {};
        state.weeklyData = {};
        for (const id of Object.keys(__indexData)) {
            state.rawData[id] = __indexData[id].map(row => ({ ...row }));
            state.weeklyData[id] = convertDailyToWeekly(state.rawData[id]);
        }
    `, context);
    return context;
}

function resetActiveSymbol(context) {
    vm.runInContext(`
        for (const id of Object.keys(state.rawData)) {
            if (!Object.prototype.hasOwnProperty.call(__indexData, id)) delete state.rawData[id];
        }
        for (const id of Object.keys(state.weeklyData)) {
            if (!Object.prototype.hasOwnProperty.call(__indexData, id)) delete state.weeklyData[id];
        }
        state.liveBars = {};
        state.liveQuotes = {};
        state.liveWeeklyData = {};
        state.liveOverlayCache = {};
        derivedIndicatorCache.clear();
        dateIndexCache.clear();
    `, context);
}

function prepareRawSignals(context, symbol) {
    context.__symbol = { id: symbol.id, mode: symbol.mode, rows: cloneRows(symbol.rows) };
    resetActiveSymbol(context);
    return JSON.parse(vm.runInContext(`
        (function() {
            state.mode = __symbol.mode;
            state.id = __symbol.id;
            state.stockId = __symbol.mode === 'stock' ? __symbol.id : null;
            state.period = 'daily';
            state.rawData[__symbol.id] = __symbol.rows.map(row => ({ ...row }));
            state.weeklyData[__symbol.id] = convertDailyToWeekly(state.rawData[__symbol.id]);
            resetIndicatorState();
            const full = state.rawData[__symbol.id];
            MA_OPTIONS.forEach(n => { state.indicators.ma[n] = Calcs.ma(full, n); });
            state.indicators.macd = Calcs.macd(full);
            state.indicators.rsi = Calcs.rsi(full);
            state.indicators.kdj = Calcs.kdj(full);
            for (let index = 0; index < full.length; index++) {
                full[index]._signals = calculateDailySignals(index, full, state.indicators);
                full[index]._signalVersion = SIGNAL_VERSION;
            }
            return JSON.stringify({ rawSignals: full.map(row => row._signals || []), indicators: state.indicators });
        })()
    `, context));
}

function runCandidate(context, symbol, strategy, prepared, candidate) {
    const rawSignals = candidate.filterRawSignals
        ? candidate.filterRawSignals(symbol.rows, prepared.indicators, prepared.rawSignals)
        : prepared.rawSignals;
    context.__symbol = {
        id: symbol.id,
        mode: symbol.mode,
        rows: cloneRows(symbol.rows),
        strategy,
        rawSignals,
        indicators: prepared.indicators,
        configPatch: candidate.configPatch || {},
        removeBuySignals: candidate.removeBuySignals || [],
        collectDecisionDetails: candidate.collectDecisionDetails || false,
        decisionAwareStrongExit: candidate.decisionAwareStrongExit || null
    };
    return JSON.parse(vm.runInContext(`
        (function() {
            const baseStrategy = __formalBaseStrategies[__symbol.strategy];
            const removedBuySignals = new Set(__symbol.removeBuySignals || []);
            const nextStrategy = { ...baseStrategy, ...__symbol.configPatch };
            if (removedBuySignals.size > 0) {
                nextStrategy.buySignals = (baseStrategy.buySignals || []).filter(signal => !removedBuySignals.has(signal));
                nextStrategy.scoreGroups = (baseStrategy.scoreGroups || [])
                    .map(group => group.filter(signal => !removedBuySignals.has(signal)))
                    .filter(group => group.length > 0);
            }
            STRATEGIES[__symbol.strategy] = nextStrategy;
            if (!setActiveStrategy(__symbol.strategy)) throw new Error('unknown formal strategy: ' + __symbol.strategy);
            state.mode = __symbol.mode;
            state.id = __symbol.id;
            state.stockId = __symbol.mode === 'stock' ? __symbol.id : null;
            state.period = 'daily';
            state.rawData[__symbol.id] = __symbol.rows.map((row, index) => ({
                ...row,
                _signals: [...(__symbol.rawSignals[index] || [])],
                _signalVersion: SIGNAL_VERSION
            }));
            state.weeklyData[__symbol.id] = convertDailyToWeekly(state.rawData[__symbol.id]);
            state.indicators = __symbol.indicators;
            state.indicatorKey = '';
            const diagnostics = {
                appliedStrongExits: 0,
                appliedAtTrialPosition: 0,
                appliedAtNonTrialPosition: 0,
                skippedAtNonTrialPosition: 0
            };
            const full = state.rawData[__symbol.id];
            const rule = __symbol.decisionAwareStrongExit;
            if (rule) {
                let prevPos = 0;
                let previousDecision = null;
                for (let index = 0; index < full.length; index++) {
                    const signals = full[index]._signals || [];
                    const sourcePresent = signals.includes(rule.sourceSignal);
                    const isTrialPosition = prevPos === rule.requiredPreviousPosition &&
                        previousDecision?.signalReady === rule.requiredPreviousSignalReady;
                    if (sourcePresent && isTrialPosition) {
                        full[index]._signals = [...signals, rule.syntheticSignal];
                        diagnostics.appliedStrongExits++;
                        diagnostics.appliedAtTrialPosition++;
                    } else if (sourcePresent) {
                        diagnostics.skippedAtNonTrialPosition++;
                    }
                    full[index]._signalVersion = SIGNAL_VERSION;
                    full[index]._strategy = state.strategy;
                    full[index]._decision = computeDecisionForIndex(index, full, prevPos);
                    previousDecision = full[index]._decision;
                    prevPos = previousDecision.position;
                }
            } else {
                derivedIndicatorCache.clear();
                state.pendingIndicatorMutation = { mode: 'strategy-only', startIdx: 0 };
                updateAllIndicators();
            }
            const resultRows = full.map((row, index) => {
                const basic = {
                    date: row.date,
                    close: row.close,
                    high: row.high,
                    low: row.low,
                    position: row._decision?.position || 0,
                    bsMark: row._decision?.bsMark || null,
                    simpleAction: row._decision?.simpleAction || ''
                };
                if (!__symbol.collectDecisionDetails) return basic;
                const meta = getSignalMeta(index, full, state.indicators);
                const novice = getNoviceDecisionSummary(meta, row._decision);
                return {
                    ...basic,
                    rawSignals: [...(row._signals || [])],
                    activeBuySignals: [...(meta.buySignals || [])],
                    windowBuySignals: (meta.windowSignals || []).filter(item => item.signal.startsWith('B')).map(item => item.signal),
                    windowScore: meta.windowScore || 0,
                    signalReady: !!row._decision?.signalReady,
                    simpleAction: row._decision?.simpleAction || '',
                    positionDriver: row._decision?.positionDriver || '',
                    noviceState: novice.state || '',
                    noviceAction: novice.action || '',
                    noviceReason: novice.reason || '',
                    noviceInvalidCondition: novice.invalidCondition || ''
                };
            });
            return JSON.stringify({
                rows: resultRows,
                candidateDiagnostics: diagnostics
            });
        })()
    `, context));
}

function summarize(rows) {
    return summarizePerformance(rows, { startIndex: START_INDEX, costRate: COST_RATE });
}

function summarizeRows(rows) {
    return summarizeEvaluationRows(rows);
}

function summarizeBaseline(rows) {
    return summarizeRows(rows.map(row => ({ ...row, performance: row.performance, bs: row.bs })));
}

function subtract(variant, baseline) {
    return subtractSummaries(variant, baseline);
}

function matchesCohort(row, cohort) {
    if (cohort === 'stocks') return row.mode === 'stock';
    if (cohort === 'phase2') return row.phase === 'phase2';
    return row.mode === 'stock' && row.tags.includes(cohort);
}

function loadSymbols(baseline) {
    const reference = baseline.strategies['稳健趋势型'].symbolsDetail;
    const commonAsOf = baseline.dataSnapshot?.commonAsOf || baseline.scope?.dateRange?.last || '';
    return reference.map(row => ({
        ...row,
        tags: row.tags || [],
        rows: readJson(path.join(ROOT, '.local', 'strategy-cache', row.cacheFile))
            .filter(item => !commonAsOf || item.date <= commonAsOf)
    }));
}

function getCandidateVariants(candidate) {
    if (!Array.isArray(candidate.ablations) || !candidate.ablations.length) return [candidate];
    const ablations = requestedVariant
        ? candidate.ablations.filter(variant => variant.id === requestedVariant)
        : candidate.ablations;
    if (requestedVariant && !ablations.length) throw new Error(`unknown candidate variant: ${requestedVariant}`);
    return candidate.control
        ? [candidate.control, ...ablations]
        : [{ id: 'retain_production_control', label: '保留当前生产配置', collectDecisionDetails: true }, ...ablations];
}

function summarizeNested(rows, key, id) {
    return summarizeRows(rows
        .filter(row => row[key]?.[id])
        .map(row => ({ ...row, performance: row[key][id], bs: { b: 0, s: 0 } })));
}

function buildVariantResult(baselineRows, variantRows, controlRows, candidateClass = 'performance') {
    const summaryVariant = summarizeRows(variantRows);
    const cohorts = {};
    for (const cohort of ['stocks', 'phase2', 'stress', 'highVolatility', 'technology', 'defensive', 'cyclical']) {
        const baselineCohort = baselineRows.filter(row => matchesCohort(row, cohort));
        const variantCohort = variantRows.filter(row => matchesCohort(row, cohort));
        const baselineSummary = summarizeBaseline(baselineCohort);
        const variantSummary = summarizeRows(variantCohort);
        cohorts[cohort] = {
            baseline: baselineSummary,
            variant: variantSummary,
            delta: subtract(variantSummary, baselineSummary)
        };
    }
    const result = {
        variant: summaryVariant,
        delta: subtract(summaryVariant, summarizeBaseline(baselineRows)),
        cohorts,
        symbolDeltas: variantRows.map(row => {
            const base = baselineRows.find(item => item.id === row.id);
            return {
                id: row.id,
                name: row.name,
                mode: row.mode,
                phase: row.phase,
                tags: row.tags,
                delta: subtract(summarizeRows([row]), summarizeBaseline([base]))
            };
        }),
        affectedDecisions: countAffectedDecisionDays(controlRows, variantRows)
    };
    const temporalIds = Object.keys(baselineRows[0]?.temporal || {});
    result.temporal = Object.fromEntries(temporalIds.map(id => {
        const baseline = summarizeNested(baselineRows, 'temporal', id);
        const variant = summarizeNested(variantRows, 'temporal', id);
        return [id, { baseline, variant, delta: subtract(variant, baseline) }];
    }));
    const stressScenarioId = VALIDATION_POLICY.gates.stress.scenarioId;
    const stressBaseline = summarizeNested(baselineRows, 'scenarios', stressScenarioId);
    const stressVariant = summarizeNested(variantRows, 'scenarios', stressScenarioId);
    result.costStress = {
        scenarioId: stressScenarioId,
        baseline: stressBaseline,
        variant: stressVariant,
        delta: subtract(stressVariant, stressBaseline)
    };
    result.evaluation = evaluateCandidateGates({
        candidateClass,
        policy: VALIDATION_POLICY,
        overallDelta: result.delta,
        temporalDeltas: Object.values(result.temporal).map(item => item.delta),
        symbolDeltas: result.symbolDeltas.filter(item => item.mode === 'stock'),
        cohorts,
        stressDelta: result.costStress.delta,
        affectedDecisionDays: result.affectedDecisions.total,
        completedTrades: result.variant.trades.completed
    });
    return result;
}

function buildDecisionPreflight(controlId, candidateId, controlRows, candidateRows) {
    const fields = [
        'windowScore', 'signalReady', 'position', 'bsMark', 'simpleAction', 'positionDriver',
        'noviceState', 'noviceAction', 'noviceReason', 'noviceInvalidCondition'
    ];
    const changedDays = Object.fromEntries(fields.map(field => [field, 0]));
    const positionTransitions = {};
    const bsTransitions = {};
    let eligibleDays = 0;
    let changedSymbols = 0;
    let rawB15Control = 0;
    let rawB15Candidate = 0;
    let activeB15Control = 0;
    let activeB15Candidate = 0;

    for (const candidateSymbol of candidateRows) {
        const controlSymbol = controlRows.find(row => row.id === candidateSymbol.id);
        if (!controlSymbol) throw new Error(`missing B15 control symbol: ${candidateSymbol.id}`);
        let symbolChanged = false;
        for (let index = START_INDEX; index < candidateSymbol.decisionRows.length; index++) {
            const control = controlSymbol.decisionRows[index];
            const candidate = candidateSymbol.decisionRows[index];
            if (!control || !candidate) continue;
            eligibleDays++;
            if (control.rawSignals?.includes('B15')) rawB15Control++;
            if (candidate.rawSignals?.includes('B15')) rawB15Candidate++;
            if (control.activeBuySignals?.includes('B15')) activeB15Control++;
            if (candidate.activeBuySignals?.includes('B15')) activeB15Candidate++;
            for (const field of fields) {
                if (control[field] !== candidate[field]) {
                    changedDays[field]++;
                    symbolChanged = true;
                }
            }
            if (control.position !== candidate.position) {
                const key = `${control.position}->${candidate.position}`;
                positionTransitions[key] = (positionTransitions[key] || 0) + 1;
            }
            if (control.bsMark !== candidate.bsMark) {
                const key = `${control.bsMark || 'none'}->${candidate.bsMark || 'none'}`;
                bsTransitions[key] = (bsTransitions[key] || 0) + 1;
            }
        }
        if (symbolChanged) changedSymbols++;
    }

    return {
        controlId,
        candidateId,
        symbols: candidateRows.length,
        eligibleDays,
        changedSymbols,
        rawB15Days: { control: rawB15Control, candidate: rawB15Candidate },
        activeB15Days: { control: activeB15Control, candidate: activeB15Candidate },
        changedDays,
        positionTransitions,
        bsTransitions
    };
}

function summarizeMarkerEvents(events, horizons = [5, 10, 20]) {
    return {
        events: events.length,
        horizons: Object.fromEntries(horizons.map(horizon => {
            const samples = events.map(event => {
                const end = event.index + horizon;
                if (end >= event.rows.length || !Number.isFinite(event.entryClose) || event.entryClose <= 0) return null;
                const future = event.rows.slice(event.index + 1, end + 1);
                if (!future.length) return null;
                const forwardReturn = (future[future.length - 1].close - event.entryClose) / event.entryClose;
                const maxAdverse = Math.min(...future.map(row => row.low)) / event.entryClose - 1;
                const maxFavorable = Math.max(...future.map(row => row.high)) / event.entryClose - 1;
                return { forwardReturn, maxAdverse, maxFavorable };
            }).filter(Boolean);
            return [String(horizon), {
                events: samples.length,
                avgForwardReturn: round(mean(samples.map(sample => sample.forwardReturn))),
                positiveRate: round(samples.filter(sample => sample.forwardReturn > 0).length / samples.length),
                avgMaxAdverse: round(mean(samples.map(sample => sample.maxAdverse))),
                avgMaxFavorable: round(mean(samples.map(sample => sample.maxFavorable)))
            }];
        }))
    };
}

function buildMarkerQuality(controlRows, candidateRows) {
    const categories = {
        controlOnlyB: [],
        candidateOnlyB: [],
        controlOnlyS: [],
        candidateOnlyS: [],
        bToS: []
    };
    for (const candidateSymbol of candidateRows) {
        const controlSymbol = controlRows.find(row => row.id === candidateSymbol.id);
        if (!controlSymbol) throw new Error(`missing marker quality control symbol: ${candidateSymbol.id}`);
        for (let index = START_INDEX; index < candidateSymbol.decisionRows.length; index++) {
            const control = controlSymbol.decisionRows[index];
            const candidate = candidateSymbol.decisionRows[index];
            if (!control || !candidate || control.bsMark === candidate.bsMark) continue;
            let category = null;
            if (control.bsMark === 'B' && candidate.bsMark === 'S') category = 'bToS';
            else if (control.bsMark === 'B' && !candidate.bsMark) category = 'controlOnlyB';
            else if (!control.bsMark && candidate.bsMark === 'B') category = 'candidateOnlyB';
            else if (control.bsMark === 'S' && !candidate.bsMark) category = 'controlOnlyS';
            else if (!control.bsMark && candidate.bsMark === 'S') category = 'candidateOnlyS';
            if (!category) continue;
            categories[category].push({
                index,
                entryClose: candidate.close,
                rows: candidateSymbol.decisionRows,
                mode: candidateSymbol.mode,
                phase: candidateSymbol.phase,
                tags: candidateSymbol.tags
            });
        }
    }
    const result = { totalChangedEvents: Object.values(categories).reduce((sum, events) => sum + events.length, 0), categories: {} };
    for (const [category, events] of Object.entries(categories)) {
        result.categories[category] = {
            events: events.length,
            all: summarizeMarkerEvents(events),
            stocks: summarizeMarkerEvents(events.filter(event => matchesCohort(event, 'stocks'))),
            phase2: summarizeMarkerEvents(events.filter(event => matchesCohort(event, 'phase2'))),
            stress: summarizeMarkerEvents(events.filter(event => matchesCohort(event, 'stress')))
        };
    }
    return result;
}

function countEventsByCohort(events) {
    return {
        all: events.length,
        stocks: events.filter(event => matchesCohort(event, 'stocks')).length,
        phase2: events.filter(event => matchesCohort(event, 'phase2')).length,
        stress: events.filter(event => matchesCohort(event, 'stress')).length
    };
}

function summarizeEventsByCohort(events) {
    return {
        all: summarizeMarkerEvents(events),
        stocks: summarizeMarkerEvents(events.filter(event => matchesCohort(event, 'stocks'))),
        phase2: summarizeMarkerEvents(events.filter(event => matchesCohort(event, 'phase2'))),
        stress: summarizeMarkerEvents(events.filter(event => matchesCohort(event, 'stress')))
    };
}

function isTrialEntry(row) {
    return row?.bsMark === 'B' && row.position === 30 && !row.signalReady;
}

function makeForwardEvent(symbol, index) {
    return {
        index,
        entryClose: symbol.decisionRows[index].close,
        rows: symbol.decisionRows,
        mode: symbol.mode,
        phase: symbol.phase,
        tags: symbol.tags
    };
}

function buildWaveTrialAttribution(config, controlRows, variantRowsById) {
    const targetSignals = new Set(config.candidates.map(item => item.signal));
    const controlTrialEvents = [];
    const attributedEvents = Object.fromEntries(config.candidates.map(item => [item.signal, []]));
    const soleTargetEvents = Object.fromEntries(config.candidates.map(item => [item.signal, []]));
    for (const symbol of controlRows) {
        for (let index = START_INDEX; index < symbol.decisionRows.length; index++) {
            const row = symbol.decisionRows[index];
            if (!isTrialEntry(row)) continue;
            const event = makeForwardEvent(symbol, index);
            controlTrialEvents.push(event);
            const presentTargets = [...new Set((row.windowBuySignals || []).filter(signal => targetSignals.has(signal)))];
            for (const signal of presentTargets) attributedEvents[signal].push(event);
            if (presentTargets.length === 1) soleTargetEvents[presentTargets[0]].push(event);
        }
    }

    const signals = {};
    for (const item of config.candidates) {
        const candidateRows = variantRowsById[item.candidateId];
        const removedTrialEvents = [];
        const addedTrialEvents = [];
        let positionChangedDays = 0;
        let bsChangedDays = 0;
        for (const candidateSymbol of candidateRows) {
            const controlSymbol = controlRows.find(row => row.id === candidateSymbol.id);
            if (!controlSymbol) throw new Error(`missing wave trial control symbol: ${candidateSymbol.id}`);
            for (let index = START_INDEX; index < candidateSymbol.decisionRows.length; index++) {
                const control = controlSymbol.decisionRows[index];
                const candidate = candidateSymbol.decisionRows[index];
                if (!control || !candidate) continue;
                if (control.position !== candidate.position) positionChangedDays++;
                if (control.bsMark !== candidate.bsMark) bsChangedDays++;
                if (isTrialEntry(control) && !isTrialEntry(candidate)) removedTrialEvents.push(makeForwardEvent(controlSymbol, index));
                if (!isTrialEntry(control) && isTrialEntry(candidate)) addedTrialEvents.push(makeForwardEvent(candidateSymbol, index));
            }
        }
        signals[item.signal] = {
            candidateId: item.candidateId,
            trialEntriesWithSignal: countEventsByCohort(attributedEvents[item.signal]),
            soleTargetSignalEntries: countEventsByCohort(soleTargetEvents[item.signal]),
            trialEntryQuality: summarizeEventsByCohort(attributedEvents[item.signal]),
            removedTrialEntries: removedTrialEvents.length,
            addedTrialEntries: addedTrialEvents.length,
            removedTrialQuality: summarizeEventsByCohort(removedTrialEvents),
            addedTrialQuality: summarizeEventsByCohort(addedTrialEvents),
            positionChangedDays,
            bsChangedDays
        };
    }

    return {
        controlId: config.controlId,
        controlTrialEntries: countEventsByCohort(controlTrialEvents),
        signals
    };
}

function main() {
    const baselinePath = latestBaselinePath();
    const baselineReport = readJson(baselinePath);
    const temporalWindows = baselineReport.validationPolicy?.temporalWindows || [];
    if (temporalWindows.length !== VALIDATION_POLICY.temporalWindows.count) {
        throw new Error('baseline report is missing sustainable temporal windows');
    }
    const symbols = loadSymbols(baselineReport);
    const indexData = Object.fromEntries(symbols.filter(symbol => symbol.mode === 'index').map(symbol => [symbol.id, symbol.rows]));
    if (Object.keys(indexData).length !== INDEX_IDS.length) throw new Error('missing full index cache for candidate lab');
    const strategies = requestedStrategy ? [requestedStrategy] : Object.keys(CANDIDATES);
    if (strategies.some(strategy => !CANDIDATES[strategy])) throw new Error(`unknown formal strategy: ${requestedStrategy}`);
    const context = createContext(indexData);
    const experiments = {};

    const candidateVariantsByStrategy = Object.fromEntries(
        strategies.map(strategy => [strategy, getCandidateVariants(CANDIDATES[strategy])])
    );
    const variantRowsByStrategy = {};
    const diagnosticsByStrategy = {};
    const signalOccurrencesByStrategy = {};
    for (const strategy of strategies) {
        variantRowsByStrategy[strategy] = {};
        diagnosticsByStrategy[strategy] = {};
        signalOccurrencesByStrategy[strategy] = {};
        for (const variant of candidateVariantsByStrategy[strategy]) {
            variantRowsByStrategy[strategy][variant.id] = [];
            signalOccurrencesByStrategy[strategy][variant.id] = Object.fromEntries(
                (variant.removeBuySignals || []).map(signal => [signal, 0])
            );
            diagnosticsByStrategy[strategy][variant.id] = {
                appliedStrongExits: 0,
                appliedAtTrialPosition: 0,
                appliedAtNonTrialPosition: 0,
                skippedAtNonTrialPosition: 0
            };
        }
    }
    for (const [symbolIndex, symbol] of symbols.entries()) {
        const prepared = prepareRawSignals(context, symbol);
        for (const strategy of strategies) {
            for (const variant of candidateVariantsByStrategy[strategy]) {
                const signalOccurrences = signalOccurrencesByStrategy[strategy][variant.id];
                for (const signals of prepared.rawSignals) {
                    for (const signal of variant.removeBuySignals || []) {
                        if (signals.includes(signal)) signalOccurrences[signal]++;
                    }
                }
                const result = runCandidate(context, symbol, strategy, prepared, variant);
                const rows = result.rows;
                const diagnostics = diagnosticsByStrategy[strategy][variant.id];
                for (const key of Object.keys(diagnostics)) {
                    diagnostics[key] += Number(result.candidateDiagnostics?.[key]) || 0;
                }
                const performance = summarize(rows);
                variantRowsByStrategy[strategy][variant.id].push({
                    id: symbol.id,
                    name: symbol.name,
                    mode: symbol.mode,
                    phase: symbol.phase || null,
                    tags: symbol.tags || [],
                    performance,
                    scenarios: buildScenarioSummaries(rows, VALIDATION_POLICY),
                    temporal: buildTemporalSummaries(rows, temporalWindows, VALIDATION_POLICY),
                    decisionRows: rows,
                    bs: {
                        b: rows.slice(START_INDEX).filter(row => row.bsMark === 'B').length,
                        s: rows.slice(START_INDEX).filter(row => row.bsMark === 'S').length
                    }
                });
            }
        }
        if (showProgress) console.error(`[formal-candidate] ${symbolIndex + 1}/${symbols.length} ${symbol.id}`);
    }

    for (const strategy of strategies) {
        const candidate = CANDIDATES[strategy];
        const baselineRows = baselineReport.strategies[strategy].symbolsDetail;
        const summaryBaseline = summarizeBaseline(baselineRows);
        const candidateClass = candidate.candidateClass || 'performance';
        const candidateSummary = {
            id: candidate.id,
            question: candidate.question,
            type: candidate.type,
            candidateClass,
            hash: stableHash({ candidate, signalVersion: baselineReport.signalVersion, policyHash: baselineReport.validationPolicy?.policyHash })
        };
        const controlId = candidate.control?.id || (candidate.ablations ? 'retain_production_control' : candidateVariantsByStrategy[strategy][0].id);
        const controlRows = variantRowsByStrategy[strategy][controlId];
        if (candidate.ablations) {
            const ablations = {};
            for (const variant of candidate.ablations.filter(item => !requestedVariant || item.id === requestedVariant)) {
                ablations[variant.id] = {
                    label: variant.label,
                    removedSignals: variant.removeBuySignals,
                    objective: variant.objective || '',
                    category: variant.category || candidateClass,
                    allowedBsImpact: variant.allowedBsImpact || '',
                    riskBudget: variant.riskBudget || '',
                    restartCondition: variant.restartCondition || '',
                    hash: stableHash({ candidateId: candidate.id, variant, signalVersion: baselineReport.signalVersion }),
                    signalOccurrences: signalOccurrencesByStrategy[strategy][variant.id],
                    ...buildVariantResult(baselineRows, variantRowsByStrategy[strategy][variant.id], controlRows, candidateClass)
                };
            }
            experiments[strategy] = { candidate: candidateSummary, baseline: summaryBaseline, ablations };
            if (candidate.preflight && (!requestedVariant || candidate.preflight.candidateId === requestedVariant)) {
                experiments[strategy].b15Preflight = buildDecisionPreflight(
                    candidate.preflight.controlId,
                    candidate.preflight.candidateId,
                    variantRowsByStrategy[strategy][candidate.preflight.controlId],
                    variantRowsByStrategy[strategy][candidate.preflight.candidateId]
                );
                experiments[strategy].b15MarkerQuality = buildMarkerQuality(
                    variantRowsByStrategy[strategy][candidate.preflight.controlId],
                    variantRowsByStrategy[strategy][candidate.preflight.candidateId]
                );
            }
            if (candidate.waveTrialAttribution) {
                const attributionConfig = {
                    ...candidate.waveTrialAttribution,
                    candidates: candidate.waveTrialAttribution.candidates.filter(item => !requestedVariant || item.candidateId === requestedVariant)
                };
                experiments[strategy].waveTrialAttribution = buildWaveTrialAttribution(
                    attributionConfig,
                    variantRowsByStrategy[strategy][candidate.waveTrialAttribution.controlId],
                    variantRowsByStrategy[strategy]
                );
            }
        } else {
            const variant = candidateVariantsByStrategy[strategy][0];
            experiments[strategy] = {
                candidate: candidateSummary,
                candidateDiagnostics: diagnosticsByStrategy[strategy][variant.id],
                baseline: summaryBaseline,
                ...buildVariantResult(baselineRows, variantRowsByStrategy[strategy][variant.id], controlRows, candidateClass)
            };
        }
    }

    const report = {
        generatedAt: new Date().toISOString(),
        method: 'production-js-vm-local-candidate-lab',
        baselineReport: path.relative(ROOT, baselinePath),
        appBuild: baselineReport.appBuild,
        signalVersion: baselineReport.signalVersion,
        validationPolicy: baselineReport.validationPolicy,
        dataSnapshot: baselineReport.dataSnapshot,
        scope: baselineReport.scope,
        coverage: baselineReport.coverage,
        experiments
    };
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
    const reportPath = path.join(REPORT_DIR, `formal-strategy-candidate-lab-${stamp}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({
        reportPath: path.relative(ROOT, reportPath),
        scope: report.scope,
        experiments: Object.fromEntries(Object.entries(experiments).map(([strategy, item]) => [strategy,
            item.ablations
                ? {
                    candidate: item.candidate,
                    ablations: Object.fromEntries(Object.entries(item.ablations).map(([id, result]) => [id, {
                        removedSignals: result.removedSignals,
                        signalOccurrences: result.signalOccurrences,
                        delta: result.delta,
                        evaluation: result.evaluation,
                        cohortDeltas: Object.fromEntries(Object.entries(result.cohorts).map(([cohort, value]) => [cohort, value.delta]))
                    }]))
                }
                : {
                    candidate: item.candidate,
                    delta: item.delta,
                    evaluation: item.evaluation,
                    cohortDeltas: Object.fromEntries(Object.entries(item.cohorts).map(([cohort, result]) => [cohort, result.delta]))
                }
        ]))
    }));
}

main();
process.exit(0);
