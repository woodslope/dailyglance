#!/usr/bin/env node

const assert = require('assert');
const {
    stableHash,
    summarizePerformance,
    summarizeEvaluationRows,
    subtractSummaries,
    buildCalendarWindows,
    evaluateCandidateScreen,
    evaluateCandidateGates
} = require('../scripts/strategy-evaluator');
const policy = require('../strategy-validation-policy.json');

function rows(values) {
    return values.map((item, index) => ({
        date: `2026-01-${String(index + 1).padStart(2, '0')}`,
        close: item.close,
        position: item.position,
        bsMark: item.bsMark || null
    }));
}

const balanced = summarizePerformance(rows([
    { close: 100, position: 0 },
    { close: 100, position: 100 },
    { close: 110, position: 100 },
    { close: 110, position: 0 },
    { close: 110, position: 100 },
    { close: 99, position: 100 },
    { close: 99, position: 0 }
]), { startIndex: 1, costRate: 0 });

assert.strictEqual(balanced.completedTrades, 2);
assert.strictEqual(balanced.winRate, 0.5);
assert.strictEqual(balanced.avgWin, 0.1);
assert.strictEqual(balanced.avgLoss, -0.1);
assert.strictEqual(balanced.payoffRatio, 1);
assert.strictEqual(balanced.profitFactor, 1);
assert.strictEqual(balanced.expectancy, 0);
assert.strictEqual(balanced.ret, -0.01);

const withCost = summarizePerformance(rows([
    { close: 100, position: 0 },
    { close: 100, position: 100 },
    { close: 110, position: 100 },
    { close: 110, position: 0 }
]), { startIndex: 1, costRate: 0.001 });
assert.ok(withCost.ret < 0.1, '交易成本应降低收益');
assert.strictEqual(withCost.turnover, 2);

const referenceRows = Array.from({ length: 600 }, (_, index) => ({
    date: new Date(Date.UTC(2023, 0, 1 + index)).toISOString().slice(0, 10)
}));
const windows = buildCalendarWindows(referenceRows, policy);
assert.strictEqual(windows.length, 3);
assert.ok(windows.every(window => window.tradingDays === 126));
assert.ok(windows[0].endDate < windows[1].startDate);

const baseRow = { performance: balanced, bs: { b: 2, s: 2 } };
const cohort = summarizeEvaluationRows([baseRow, baseRow]);
assert.strictEqual(cohort.trades.completed, 4);
assert.strictEqual(cohort.performance.aggregateWinRate, 0.5);
const delta = subtractSummaries(cohort, cohort);
assert.strictEqual(delta.avgStrategyRet, 0);
assert.strictEqual(delta.turnoverRatio, 0);

const passingGate = evaluateCandidateGates({
    candidateClass: 'performance',
    policy,
    overallDelta: { avgStrategyRet: 0.006, avgMaxDrawdown: 0, turnoverRatio: 0 },
    temporalDeltas: [{ avgStrategyRet: 0.01 }, { avgStrategyRet: 0.005 }, { avgStrategyRet: -0.001 }],
    symbolDeltas: Array.from({ length: 10 }, (_, index) => ({ delta: { avgStrategyRet: index < 6 ? 0.001 : -0.001 } })),
    cohorts: {},
    stressDelta: { avgStrategyRet: 0 },
    affectedDecisionDays: 30,
    completedTrades: 30
});
assert.strictEqual(passingGate.status, 'recommend_shadow');

const rejectedGate = evaluateCandidateGates({
    candidateClass: 'performance',
    policy,
    overallDelta: { avgStrategyRet: 0.001, avgMaxDrawdown: 0.02, turnoverRatio: 0.2 },
    temporalDeltas: [{ avgStrategyRet: -0.01 }, { avgStrategyRet: -0.01 }, { avgStrategyRet: 0.001 }],
    symbolDeltas: Array.from({ length: 10 }, () => ({ delta: { avgStrategyRet: -0.001 } })),
    cohorts: {},
    stressDelta: { avgStrategyRet: -0.01 },
    affectedDecisionDays: 50,
    completedTrades: 50
});
assert.strictEqual(rejectedGate.status, 'reject');
const passingScreen = evaluateCandidateScreen({
    candidateClass: 'risk_control',
    policy,
    overallDelta: { avgStrategyRet: -0.001, avgMaxDrawdown: -0.0001 },
    affectedDecisionDays: 2
});
assert.strictEqual(passingScreen.status, 'continue_full');
assert.strictEqual(passingScreen.formalAdmissionRequired, true);
const rejectedScreen = evaluateCandidateScreen({
    candidateClass: 'performance',
    policy,
    overallDelta: { avgStrategyRet: 0.002, avgMaxDrawdown: 0.01 },
    affectedDecisionDays: 2
});
assert.strictEqual(rejectedScreen.status, 'reject');
const historicalCandidateH = evaluateCandidateGates({
    candidateClass: 'performance',
    policy,
    overallDelta: { avgStrategyRet: 0.0113, avgMaxDrawdown: -0.0232, turnoverRatio: -0.01 },
    temporalDeltas: [{ avgStrategyRet: 0.02 }, { avgStrategyRet: 0.01 }, { avgStrategyRet: -0.005 }],
    symbolDeltas: Array.from({ length: 89 }, (_, index) => ({ delta: { avgStrategyRet: index < 42 ? 0.001 : -0.001 } })),
    cohorts: {},
    stressDelta: { avgStrategyRet: 0 },
    affectedDecisionDays: 100,
    completedTrades: 100
});
assert.strictEqual(historicalCandidateH.status, 'reject', '候选H应因跨股票收益不稳定被否决');

const semanticLifecycle = evaluateCandidateGates({
    candidateClass: 'semantic_correctness',
    policy,
    overallDelta: { avgStrategyRet: -0.0044, avgMaxDrawdown: -0.0044, turnoverRatio: -0.03 },
    temporalDeltas: [{ avgStrategyRet: -0.002, avgMaxDrawdown: -0.001 }, { avgStrategyRet: -0.005, avgMaxDrawdown: -0.003 }, { avgStrategyRet: 0, avgMaxDrawdown: 0 }],
    symbolDeltas: [],
    cohorts: {},
    stressDelta: { avgStrategyRet: 0 },
    affectedDecisionDays: 100,
    completedTrades: 100
});
assert.strictEqual(semanticLifecycle.status, 'recommend_shadow', '语义修正允许在风险预算内进入影子观察');
const controlGate = evaluateCandidateGates({
    candidateClass: 'control',
    policy,
    overallDelta: { avgStrategyRet: 0, avgMaxDrawdown: 0 },
    affectedDecisionDays: 0
});
assert.strictEqual(controlGate.status, 'baseline_control');
assert.strictEqual(stableHash({ b: 2, a: 1 }), stableHash({ a: 1, b: 2 }));

console.log('策略共享评估器契约通过');
