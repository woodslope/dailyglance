#!/usr/bin/env node

const crypto = require('crypto');
const fs = require('fs');

function round(value, digits = 6) {
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

function stableHash(value) {
    const normalize = input => {
        if (Array.isArray(input)) return input.map(normalize);
        if (input && typeof input === 'object') {
            return Object.fromEntries(Object.keys(input).sort().map(key => [key, normalize(input[key])]));
        }
        if (typeof input === 'function') return input.toString();
        return input;
    };
    return crypto.createHash('sha256').update(JSON.stringify(normalize(value))).digest('hex');
}

function hashFile(file) {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function effectivePosition(rows, index, delayBars) {
    const sourceIndex = Math.max(0, index - Math.max(0, delayBars || 0));
    return Number(rows[sourceIndex]?.position) || 0;
}

function summarizePerformance(rows, options = {}) {
    const startIndex = Math.max(1, Number(options.startIndex) || 1);
    const endIndex = Math.min(rows.length - 1, Number.isInteger(options.endIndex) ? options.endIndex : rows.length - 1);
    const costRate = Number.isFinite(options.costRate) ? options.costRate : 0.001;
    const delayBars = Math.max(0, Number(options.delayBars) || 0);
    let capital = 10000;
    let peak = capital;
    let maxDrawdown = 0;
    let adjustments = 0;
    let turnover = 0;
    let holdingDays = 0;
    let previousPosition = effectivePosition(rows, startIndex - 1, delayBars);
    let entryCapital = previousPosition > 0 ? capital : null;
    const tradeReturns = [];

    for (let index = startIndex; index <= endIndex; index++) {
        const position = effectivePosition(rows, index, delayBars);
        const previousClose = Number(rows[index - 1]?.close);
        const close = Number(rows[index]?.close);
        if (previousPosition > 0 && previousClose > 0 && close > 0) {
            capital *= 1 + ((close - previousClose) / previousClose) * (previousPosition / 100);
        }
        if (position > 0) holdingDays++;
        if (position !== previousPosition) {
            const positionChange = Math.abs(position - previousPosition) / 100;
            capital -= capital * positionChange * costRate;
            turnover += positionChange;
            adjustments++;
            if (previousPosition === 0 && position > 0) entryCapital = capital;
            if (previousPosition > 0 && position === 0 && entryCapital) {
                tradeReturns.push(capital / entryCapital - 1);
                entryCapital = null;
            }
        }
        peak = Math.max(peak, capital);
        maxDrawdown = Math.max(maxDrawdown, peak > 0 ? (peak - capital) / peak : 0);
        previousPosition = position;
    }

    const eligibleDays = Math.max(0, endIndex - startIndex + 1);
    const wins = tradeReturns.filter(value => value > 0);
    const losses = tradeReturns.filter(value => value <= 0);
    const avgWin = mean(wins);
    const avgLoss = mean(losses);
    const grossProfit = wins.reduce((sum, value) => sum + value, 0);
    const grossLoss = Math.abs(losses.reduce((sum, value) => sum + value, 0));
    const ret = capital / 10000 - 1;
    const annualizedReturn = eligibleDays > 0 && capital > 0
        ? Math.pow(capital / 10000, 252 / eligibleDays) - 1
        : NaN;
    return {
        ret: round(ret),
        annualizedReturn: round(annualizedReturn),
        maxDrawdown: round(maxDrawdown),
        calmar: maxDrawdown > 0 ? round(annualizedReturn / maxDrawdown) : null,
        completedTrades: tradeReturns.length,
        winningTrades: wins.length,
        losingTrades: losses.length,
        winRate: tradeReturns.length ? round(wins.length / tradeReturns.length) : null,
        avgWin: round(avgWin),
        avgLoss: round(avgLoss),
        payoffRatio: Number.isFinite(avgWin) && Number.isFinite(avgLoss) && avgLoss !== 0
            ? round(avgWin / Math.abs(avgLoss))
            : null,
        profitFactor: grossLoss > 0 ? round(grossProfit / grossLoss) : (grossProfit > 0 ? null : 0),
        expectancy: tradeReturns.length ? round(mean(tradeReturns)) : null,
        grossProfit: round(grossProfit),
        grossLoss: round(grossLoss),
        adjustments,
        turnover: round(turnover),
        holdingDays,
        eligibleDays,
        holdingRatio: eligibleDays ? round(holdingDays / eligibleDays) : null,
        openPositionAtEnd: previousPosition > 0
    };
}

function summarizeEvaluationRows(rows) {
    const holdingDays = rows.reduce((sum, row) => sum + (row.performance.holdingDays || 0), 0);
    const eligibleDays = rows.reduce((sum, row) => sum + (row.performance.eligibleDays || 0), 0);
    const winningTrades = rows.reduce((sum, row) => sum + (row.performance.winningTrades || 0), 0);
    const losingTrades = rows.reduce((sum, row) => sum + (row.performance.losingTrades || 0), 0);
    const grossProfit = rows.reduce((sum, row) => sum + (row.performance.grossProfit || 0), 0);
    const grossLoss = rows.reduce((sum, row) => sum + (row.performance.grossLoss || 0), 0);
    const completedTrades = winningTrades + losingTrades;
    return {
        symbols: rows.length,
        performance: {
            avgStrategyRet: round(mean(rows.map(row => row.performance.ret))),
            medianStrategyRet: round(median(rows.map(row => row.performance.ret))),
            avgAnnualizedReturn: round(mean(rows.map(row => row.performance.annualizedReturn))),
            avgMaxDrawdown: round(mean(rows.map(row => row.performance.maxDrawdown))),
            avgCalmar: round(mean(rows.map(row => row.performance.calmar))),
            avgWinRate: round(mean(rows.map(row => row.performance.winRate))),
            avgPayoffRatio: round(mean(rows.map(row => row.performance.payoffRatio))),
            avgProfitFactor: round(mean(rows.map(row => row.performance.profitFactor))),
            avgExpectancy: round(mean(rows.map(row => row.performance.expectancy))),
            aggregateWinRate: completedTrades ? round(winningTrades / completedTrades) : null,
            aggregateProfitFactor: grossLoss > 0 ? round(grossProfit / grossLoss) : null
        },
        bs: {
            b: rows.reduce((sum, row) => sum + (row.bs?.b || 0), 0),
            s: rows.reduce((sum, row) => sum + (row.bs?.s || 0), 0)
        },
        holding: {
            days: holdingDays,
            eligibleDays,
            ratio: eligibleDays ? round(holdingDays / eligibleDays) : null
        },
        trades: {
            completed: completedTrades,
            adjustments: rows.reduce((sum, row) => sum + (row.performance.adjustments || 0), 0),
            turnover: round(rows.reduce((sum, row) => sum + (row.performance.turnover || 0), 0))
        }
    };
}

function subtractSummaries(variant, baseline) {
    const baseTurnover = baseline.trades?.turnover || 0;
    const variantTurnover = variant.trades?.turnover || 0;
    return {
        avgStrategyRet: round((variant.performance?.avgStrategyRet || 0) - (baseline.performance?.avgStrategyRet || 0)),
        medianStrategyRet: round((variant.performance?.medianStrategyRet || 0) - (baseline.performance?.medianStrategyRet || 0)),
        avgAnnualizedReturn: round((variant.performance?.avgAnnualizedReturn || 0) - (baseline.performance?.avgAnnualizedReturn || 0)),
        avgMaxDrawdown: round((variant.performance?.avgMaxDrawdown || 0) - (baseline.performance?.avgMaxDrawdown || 0)),
        avgCalmar: round((variant.performance?.avgCalmar || 0) - (baseline.performance?.avgCalmar || 0)),
        avgWinRate: round((variant.performance?.avgWinRate || 0) - (baseline.performance?.avgWinRate || 0)),
        avgPayoffRatio: round((variant.performance?.avgPayoffRatio || 0) - (baseline.performance?.avgPayoffRatio || 0)),
        avgProfitFactor: round((variant.performance?.avgProfitFactor || 0) - (baseline.performance?.avgProfitFactor || 0)),
        avgExpectancy: round((variant.performance?.avgExpectancy || 0) - (baseline.performance?.avgExpectancy || 0)),
        holdingRatio: round((variant.holding?.ratio || 0) - (baseline.holding?.ratio || 0)),
        completedTrades: (variant.trades?.completed || 0) - (baseline.trades?.completed || 0),
        adjustments: (variant.trades?.adjustments || 0) - (baseline.trades?.adjustments || 0),
        turnover: round(variantTurnover - baseTurnover),
        turnoverRatio: baseTurnover > 0 ? round((variantTurnover - baseTurnover) / baseTurnover) : null,
        bs: {
            b: (variant.bs?.b || 0) - (baseline.bs?.b || 0),
            s: (variant.bs?.s || 0) - (baseline.bs?.s || 0)
        }
    };
}

function buildCalendarWindows(referenceRows, policy) {
    const count = policy.temporalWindows.count;
    const length = policy.temporalWindows.lengthTradingDays;
    const warmup = policy.warmupTradingDays;
    const dates = referenceRows.map(row => row.date).filter(Boolean);
    const usableStart = Math.max(warmup, dates.length - count * length);
    const usable = dates.slice(usableStart);
    const windows = [];
    for (let index = 0; index < count; index++) {
        const chunk = usable.slice(index * length, (index + 1) * length);
        if (!chunk.length) continue;
        windows.push({
            id: `wf_${index + 1}`,
            startDate: chunk[0],
            endDate: chunk[chunk.length - 1],
            tradingDays: chunk.length
        });
    }
    return windows;
}

function summarizeWindow(rows, window, scenario) {
    const startIndex = rows.findIndex(row => row.date >= window.startDate);
    let endIndex = -1;
    for (let index = rows.length - 1; index >= 0; index--) {
        if (rows[index].date <= window.endDate) {
            endIndex = index;
            break;
        }
    }
    if (startIndex < 1 || endIndex < startIndex) return null;
    return summarizePerformance(rows, {
        startIndex,
        endIndex,
        costRate: scenario.costRate,
        delayBars: scenario.delayBars
    });
}

function buildScenarioSummaries(rows, policy) {
    return Object.fromEntries(policy.costScenarios.map(scenario => [scenario.id, summarizePerformance(rows, {
        startIndex: policy.baselineStartIndex,
        costRate: scenario.costRate,
        delayBars: scenario.delayBars
    })]));
}

function buildTemporalSummaries(rows, windows, policy) {
    const standard = policy.costScenarios.find(item => item.id === 'standard') || policy.costScenarios[0];
    return Object.fromEntries(windows.map(window => [window.id, summarizeWindow(rows, window, standard)]));
}

function countAffectedDecisionDays(controlRows, variantRows) {
    let changed = 0;
    const dates = new Set();
    const bySymbol = [];
    for (const variant of variantRows) {
        const control = controlRows.find(row => row.id === variant.id);
        if (!control?.decisionRows || !variant.decisionRows) continue;
        let symbolChanged = 0;
        const length = Math.min(control.decisionRows.length, variant.decisionRows.length);
        for (let index = 0; index < length; index++) {
            const left = control.decisionRows[index];
            const right = variant.decisionRows[index];
            if (!left || !right) continue;
            if (left.position !== right.position || left.bsMark !== right.bsMark || left.simpleAction !== right.simpleAction) {
                changed++;
                symbolChanged++;
                if (right.date) dates.add(right.date);
            }
        }
        if (symbolChanged) bySymbol.push({ id: variant.id, changedDays: symbolChanged });
    }
    return {
        total: changed,
        uniqueTradingDates: dates.size,
        firstDate: [...dates].sort()[0] || '',
        lastDate: [...dates].sort().at(-1) || '',
        symbols: bySymbol.length,
        bySymbol
    };
}

function evaluateCandidateScreen(input) {
    const { candidateClass = 'performance', policy, overallDelta = {}, affectedDecisionDays = 0 } = input;
    if (candidateClass === 'control') {
        return {
            candidateClass,
            status: 'baseline_control',
            checks: []
        };
    }
    const rules = policy.gates[candidateClass] || policy.gates.performance;
    const checks = [];
    const add = (id, pass, actual, expected) => checks.push({ id, pass: !!pass, actual, expected, blocking: true });
    const minimumAffected = 1;

    add('candidate_changes_decision', affectedDecisionDays >= minimumAffected, affectedDecisionDays, `>= ${minimumAffected}`);
    if (candidateClass === 'risk_control') {
        add('drawdown_non_regression', overallDelta.avgMaxDrawdown <= 0, overallDelta.avgMaxDrawdown, '<= 0');
        add('return_guardrail', overallDelta.avgStrategyRet >= -rules.maximumReturnRegression, overallDelta.avgStrategyRet, `>= -${rules.maximumReturnRegression}`);
    } else if (candidateClass === 'efficiency') {
        add('turnover_non_regression', overallDelta.turnoverRatio != null && overallDelta.turnoverRatio <= 0, overallDelta.turnoverRatio, '<= 0');
        add('return_guardrail', overallDelta.avgStrategyRet >= -rules.maximumReturnRegression, overallDelta.avgStrategyRet, `>= -${rules.maximumReturnRegression}`);
        add('drawdown_guardrail', overallDelta.avgMaxDrawdown <= rules.maximumDrawdownRegression, overallDelta.avgMaxDrawdown, `<= ${rules.maximumDrawdownRegression}`);
    } else if (candidateClass === 'semantic_correctness') {
        add('return_guardrail', overallDelta.avgStrategyRet >= -rules.maximumReturnRegression, overallDelta.avgStrategyRet, `>= -${rules.maximumReturnRegression}`);
        add('drawdown_guardrail', overallDelta.avgMaxDrawdown <= rules.maximumDrawdownRegression, overallDelta.avgMaxDrawdown, `<= ${rules.maximumDrawdownRegression}`);
    } else {
        add('return_non_regression', overallDelta.avgStrategyRet >= 0, overallDelta.avgStrategyRet, '>= 0');
        add('drawdown_guardrail', overallDelta.avgMaxDrawdown <= rules.maximumDrawdownRegression, overallDelta.avgMaxDrawdown, `<= ${rules.maximumDrawdownRegression}`);
    }

    const passes = checks.every(check => check.pass);
    return {
        candidateClass,
        status: affectedDecisionDays < minimumAffected ? 'insufficient_evidence' : (passes ? 'continue_full' : 'reject'),
        checks,
        formalAdmissionRequired: true
    };
}

function evaluateCandidateGates(input) {
    const { candidateClass = 'performance', policy, overallDelta, temporalDeltas = [], symbolDeltas = [], cohorts = {}, stressDelta = null, affectedDecisionDays = 0, completedTrades = 0 } = input;
    if (candidateClass === 'control') {
        return {
            candidateClass,
            status: 'baseline_control',
            checks: [{
                id: 'baseline_zero_drift',
                pass: overallDelta.avgStrategyRet === 0 && overallDelta.avgMaxDrawdown === 0 && affectedDecisionDays === 0,
                actual: { returnDelta: overallDelta.avgStrategyRet, drawdownDelta: overallDelta.avgMaxDrawdown, affectedDecisionDays },
                expected: { returnDelta: 0, drawdownDelta: 0, affectedDecisionDays: 0 },
                blocking: true
            }]
        };
    }
    const rules = policy.gates[candidateClass] || policy.gates.performance;
    const checks = [];
    const add = (id, pass, actual, expected, blocking = true) => checks.push({ id, pass: !!pass, actual, expected, blocking });
    const positiveTemporal = temporalDeltas.filter(delta => {
        if (!delta) return false;
        if (candidateClass === 'risk_control') return delta.avgMaxDrawdown <= -rules.minimumDrawdownImprovement;
        if (candidateClass === 'efficiency') return delta.turnoverRatio <= -rules.minimumTurnoverReductionRatio;
        if (candidateClass === 'semantic_correctness') return delta.avgStrategyRet >= -rules.maximumReturnRegression && delta.avgMaxDrawdown <= rules.maximumDrawdownRegression;
        return delta.avgStrategyRet >= 0;
    }).length;
    const improvedSymbols = symbolDeltas.filter(item => (item.delta?.avgStrategyRet || 0) >= 0).length;
    const improvedSymbolRatio = symbolDeltas.length ? improvedSymbols / symbolDeltas.length : 0;

    if (candidateClass === 'risk_control') {
        add('drawdown_improvement', overallDelta.avgMaxDrawdown <= -rules.minimumDrawdownImprovement, overallDelta.avgMaxDrawdown, `<= -${rules.minimumDrawdownImprovement}`);
        add('return_guardrail', overallDelta.avgStrategyRet >= -rules.maximumReturnRegression, overallDelta.avgStrategyRet, `>= -${rules.maximumReturnRegression}`);
    } else if (candidateClass === 'efficiency') {
        add('turnover_reduction', overallDelta.turnoverRatio != null && overallDelta.turnoverRatio <= -rules.minimumTurnoverReductionRatio, overallDelta.turnoverRatio, `<= -${rules.minimumTurnoverReductionRatio}`);
        add('return_guardrail', overallDelta.avgStrategyRet >= -rules.maximumReturnRegression, overallDelta.avgStrategyRet, `>= -${rules.maximumReturnRegression}`);
        add('drawdown_guardrail', overallDelta.avgMaxDrawdown <= rules.maximumDrawdownRegression, overallDelta.avgMaxDrawdown, `<= ${rules.maximumDrawdownRegression}`);
    } else if (candidateClass === 'semantic_correctness') {
        add('return_guardrail', overallDelta.avgStrategyRet >= -rules.maximumReturnRegression, overallDelta.avgStrategyRet, `>= -${rules.maximumReturnRegression}`);
        add('drawdown_guardrail', overallDelta.avgMaxDrawdown <= rules.maximumDrawdownRegression, overallDelta.avgMaxDrawdown, `<= ${rules.maximumDrawdownRegression}`);
    } else {
        add('return_improvement', overallDelta.avgStrategyRet >= rules.minimumReturnDelta, overallDelta.avgStrategyRet, `>= ${rules.minimumReturnDelta}`);
        add('drawdown_guardrail', overallDelta.avgMaxDrawdown <= rules.maximumDrawdownRegression, overallDelta.avgMaxDrawdown, `<= ${rules.maximumDrawdownRegression}`);
    }

    add('temporal_stability', positiveTemporal >= policy.gates.minimumPositiveTemporalWindows, positiveTemporal, `>= ${policy.gates.minimumPositiveTemporalWindows}`);
    if (candidateClass !== 'semantic_correctness') {
        add('symbol_stability', improvedSymbolRatio >= policy.gates.minimumImprovedSymbolRatio, round(improvedSymbolRatio), `>= ${policy.gates.minimumImprovedSymbolRatio}`);
    }
    if (Number.isFinite(rules.maximumTurnoverIncreaseRatio)) {
        add('turnover_guardrail', overallDelta.turnoverRatio == null || overallDelta.turnoverRatio <= rules.maximumTurnoverIncreaseRatio, overallDelta.turnoverRatio, `<= ${rules.maximumTurnoverIncreaseRatio}`);
    }
    add('affected_evidence', affectedDecisionDays >= policy.gates.minimumAffectedDecisionDays, affectedDecisionDays, `>= ${policy.gates.minimumAffectedDecisionDays}`, false);
    add('completed_trade_evidence', completedTrades >= policy.gates.minimumCompletedTrades, completedTrades, `>= ${policy.gates.minimumCompletedTrades}`, false);

    for (const [name, cohort] of Object.entries(cohorts)) {
        const symbols = cohort.variant?.symbols || cohort.baseline?.symbols || 0;
        if (symbols < policy.gates.cohort.minimumHardGateSymbols) {
            add(`cohort_${name}`, true, symbols, `样本数<${policy.gates.cohort.minimumHardGateSymbols}，仅警告`, false);
            continue;
        }
        const pass = cohort.delta.avgStrategyRet >= -policy.gates.cohort.maximumReturnRegression
            && cohort.delta.avgMaxDrawdown <= policy.gates.cohort.maximumDrawdownRegression;
        add(`cohort_${name}`, pass, {
            returnDelta: cohort.delta.avgStrategyRet,
            drawdownDelta: cohort.delta.avgMaxDrawdown,
            symbols
        }, {
            returnDelta: `>= -${policy.gates.cohort.maximumReturnRegression}`,
            drawdownDelta: `<= ${policy.gates.cohort.maximumDrawdownRegression}`
        });
    }

    if (stressDelta) {
        add('cost_stress', stressDelta.avgStrategyRet >= -policy.gates.stress.maximumAdvantageRegression,
            stressDelta.avgStrategyRet, `>= -${policy.gates.stress.maximumAdvantageRegression}`);
    }
    const blockingChecks = checks.filter(check => check.blocking);
    const hasEvidence = affectedDecisionDays >= policy.gates.minimumAffectedDecisionDays
        && completedTrades >= policy.gates.minimumCompletedTrades;
    const pass = blockingChecks.every(check => check.pass);
    return {
        candidateClass,
        status: pass && hasEvidence ? 'recommend_shadow' : (pass ? 'insufficient_evidence' : 'reject'),
        checks
    };
}

module.exports = {
    round,
    mean,
    median,
    stableHash,
    hashFile,
    summarizePerformance,
    summarizeEvaluationRows,
    subtractSummaries,
    buildCalendarWindows,
    buildScenarioSummaries,
    buildTemporalSummaries,
    countAffectedDecisionDays,
    evaluateCandidateScreen,
    evaluateCandidateGates
};
