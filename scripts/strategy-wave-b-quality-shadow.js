#!/usr/bin/env node

// Tracks a frozen display-only quality rule. It deliberately never approves a
// rule or changes production decisions; it can only request human review.
const fs = require('fs');
const path = require('path');
const { stableHash, hashFile } = require('./strategy-evaluator');
const { summarize } = require('./strategy-wave-b-quality-report');

const ROOT = path.resolve(__dirname, '..');
const SHADOW_DIR = path.join(ROOT, '.local', 'strategy-shadow');
const POLICY = JSON.parse(fs.readFileSync(path.join(ROOT, 'strategy-validation-policy.json'), 'utf8'));
const QUALITY_POLICY = POLICY.waveBQuality || {};
const REGISTERED_RULE = QUALITY_POLICY.registeredRule || {};
const FORWARD_POLICY = QUALITY_POLICY.forwardValidation || {};

function canonicalSignals(values) {
    return [...new Set((values || []).map(value => String(value || '').trim()).filter(Boolean))]
        .sort((left, right) => left.localeCompare(right));
}

function sameSignals(left, right) {
    return canonicalSignals(left).join(',') === canonicalSignals(right).join(',');
}

function ruleFingerprint() {
    return stableHash({
        id: REGISTERED_RULE.id || null,
        strategy: REGISTERED_RULE.strategy || null,
        scope: REGISTERED_RULE.scope || null,
        requiredSignals: canonicalSignals(REGISTERED_RULE.requiredSignals)
    });
}

function eventKey(event) {
    return `${event?.symbol || ''}:${event?.date || ''}`;
}

function getMetric(summary, key) {
    return summary?.gateMetrics?.[key] ?? summary?.[key];
}

function getReturn(summary, key, days) {
    return summary?.gateMetrics?.[key]?.[days] ?? summary?.[key]?.[days];
}

function allPass(checks) {
    return Object.values(checks).every(Boolean);
}

function compactObservation(observation) {
    if (!observation) return null;
    return {
        commonAsOf: observation.commonAsOf,
        status: observation.status,
        historicalStatus: observation.historicalStatus,
        newTradingDays: observation.newTradingDays,
        newMatchedBEvents: observation.newMatchedBEvents,
        newClassifiedBEvents: observation.newClassifiedBEvents,
        failedForwardChecks: Object.entries(observation.forwardChecks || {})
            .filter(([, pass]) => !pass)
            .map(([id]) => id)
    };
}

function validateStrictReport(report) {
    const search = report?.candidateSearch || {};
    const registration = search.preRegistration || {};
    if (!QUALITY_POLICY.requireForwardValidation || !FORWARD_POLICY.manualApprovalOnly) {
        throw new Error('质量标签策略必须启用前向验证且只能人工批准。');
    }
    if (search.discoveryEnabled || search.featureSearchEnabled || search.scoreSearchEnabled || search.qualityOnly || !search.strictReview) {
        throw new Error('质量影子观察只接受无搜索、严格预注册的质量报告。');
    }
    if (registration.ruleId !== REGISTERED_RULE.id) {
        throw new Error('质量报告规则 ID 与当前预注册规则不一致。');
    }
    if (registration.strategy !== REGISTERED_RULE.strategy || registration.scope !== REGISTERED_RULE.scope
        || !sameSignals(registration.requiredSignals, REGISTERED_RULE.requiredSignals)) {
        throw new Error('质量报告预注册定义与当前规则不一致。');
    }
    if (report?.scope?.indices !== 0 || report?.scope?.stocks <= 0) {
        throw new Error('质量影子观察只接受股票范围的报告。');
    }
    if (!report?.dataSnapshot?.commonAsOf || !Array.isArray(report.dataSnapshot.referenceDates)
        || !report?.dataSnapshot?.hash || !report?.sourceSnapshot?.hash) {
        throw new Error('质量报告缺少冻结所需的数据或源码快照。');
    }
    const candidates = report.candidates || [];
    const candidate = candidates.find(item => sameSignals(item.requiredSignals, REGISTERED_RULE.requiredSignals));
    if (!candidate || !Array.isArray(candidate.eventDetails) || !Array.isArray(report?.forwardData?.baselineEvents)) {
        throw new Error('质量影子观察需要由 --event-details 生成的预注册候选和基线事件。');
    }
    return candidate;
}

function forwardChecks(candidateSummary, baselineSummary) {
    const minimumEvents = Number(FORWARD_POLICY.minimumMaturedBEvents) || 30;
    const minimumBaselineEvents = Number(FORWARD_POLICY.minimumBaselineBEvents) || minimumEvents;
    const minimumSymbols = Number(QUALITY_POLICY.minimumSymbols) || 10;
    const minimumSuccessAdvantage = Number(QUALITY_POLICY.minimumSuccessAdvantage) || 0.15;
    const minimumFailureAdvantage = Number(QUALITY_POLICY.minimumFailureAdvantage) || 0.10;
    const maximumSymbolShare = Number(QUALITY_POLICY.maximumSymbolShare) || 0.25;
    const minimumReturnAdvantages = Number(QUALITY_POLICY.minimumReturnAdvantages) || 2;
    const minimumDelayedCostAdvantages = Number(QUALITY_POLICY.minimumDelayedCostAdvantages) || 2;
    return {
        matureEvents: candidateSummary.samples >= minimumEvents,
        classifiedEvents: candidateSummary.classifiedSamples >= minimumEvents,
        baselineEvents: baselineSummary.classifiedSamples >= minimumBaselineEvents,
        symbols: candidateSummary.symbols >= minimumSymbols,
        success: getMetric(candidateSummary, 'successRate') - getMetric(baselineSummary, 'successRate') >= minimumSuccessAdvantage,
        failure: getMetric(baselineSummary, 'failureRate') - getMetric(candidateSummary, 'failureRate') >= minimumFailureAdvantage,
        returnWindows: candidateSummary.temporalAdvantages >= minimumReturnAdvantages,
        delayAndCost: candidateSummary.delayedCostAdvantages >= minimumDelayedCostAdvantages,
        // A 20-day forward window is necessarily concentrated in one calendar year.
        // Year concentration remains a frozen historical gate; forward evidence can
        // still reject a rule concentrated in one or two symbols.
        contribution: getMetric(candidateSummary, 'maxSymbolShare') <= maximumSymbolShare
    };
}

function observationFor(state, report, candidate, reportFile, now) {
    const commonAsOf = report.dataSnapshot.commonAsOf;
    const referenceDates = [...new Set(report.dataSnapshot.referenceDates)]
        .filter(date => date > state.frozenAsOf && date <= commonAsOf)
        .sort();
    const frozenKeys = new Set(state.frozenMatchedEventKeys || []);
    const candidateEvents = candidate.eventDetails
        .filter(event => event.date > state.frozenAsOf && !frozenKeys.has(eventKey(event)));
    const baselineEvents = report.forwardData.baselineEvents
        .filter(event => event.date > state.frozenAsOf);
    const candidateSummary = summarize(candidateEvents, summarize(baselineEvents, { returns: {}, delayedCostReturns: {} }));
    const baselineSummary = summarize(baselineEvents, { returns: {}, delayedCostReturns: {} });
    const checks = forwardChecks(candidateSummary, baselineSummary);
    const minimumTradingDays = Number(FORWARD_POLICY.minimumNewTradingDays) || 20;
    const newTradingDaysPass = referenceDates.length >= minimumTradingDays;
    const historicalPass = state.frozenHistorical?.qualified === true;
    const forwardPass = newTradingDaysPass && allPass(checks);
    const readyForReview = historicalPass && forwardPass;
    return {
        observedAt: now,
        report: reportFile,
        commonAsOf,
        dataSnapshotHash: report.dataSnapshot.hash,
        newTradingDays: referenceDates.length,
        minimumNewTradingDays: minimumTradingDays,
        newMatchedBEvents: candidateSummary.samples,
        newClassifiedBEvents: candidateSummary.classifiedSamples,
        newBaselineBEvents: baselineSummary.classifiedSamples,
        historicalStatus: historicalPass ? 'historical_qualified' : 'historical_insufficient',
        historicalChecks: state.frozenHistorical?.checks || {},
        forwardSummary: {
            candidate: candidateSummary,
            baseline: baselineSummary
        },
        forwardChecks: checks,
        status: readyForReview ? 'recommend_human_review' : 'shadow_observe',
        approval: 'manual_only'
    };
}

function initialState(report, candidate, reportFile, now) {
    return {
        schemaVersion: 1,
        kind: 'wave-b-quality-shadow',
        ruleId: REGISTERED_RULE.id,
        strategy: REGISTERED_RULE.strategy,
        scope: REGISTERED_RULE.scope,
        requiredSignals: canonicalSignals(REGISTERED_RULE.requiredSignals),
        ruleFingerprint: ruleFingerprint(),
        frozenAt: now,
        frozenAsOf: report.dataSnapshot.commonAsOf,
        frozenReport: reportFile,
        frozenDataSnapshotHash: report.dataSnapshot.hash,
        frozenSourceHash: report.sourceSnapshot.hash,
        frozenShadowSourceHash: hashFile(__filename),
        frozenPolicyHash: report.dataSnapshot.policyHash,
        frozenMatchedEventKeys: candidate.eventDetails.map(eventKey),
        frozenHistorical: {
            qualified: candidate.historicalQualified === true,
            checks: candidate.checks || {},
            temporalGate: candidate.temporalGate || {},
            summary: candidate.summary || {}
        },
        observations: []
    };
}

function assertFrozenStateMatches(state, report) {
    if (state.kind !== 'wave-b-quality-shadow' || state.ruleFingerprint !== ruleFingerprint()) {
        throw new Error('预注册质量规则已经变化，必须创建新的影子观察。');
    }
    if (state.frozenSourceHash !== report.sourceSnapshot.hash) {
        throw new Error('生产决策或质量规则源码已经变化，必须以新源码重新冻结观察。');
    }
    const currentShadowSourceHash = hashFile(__filename);
    if (!state.frozenShadowSourceHash) {
        const hasForwardEvidence = (state.observations || []).some(item => Number(item?.newTradingDays) > 0 || Number(item?.newMatchedBEvents) > 0);
        if (hasForwardEvidence) throw new Error('影子观察算法缺少冻结源码指纹，已有前向证据必须重新冻结。');
        state.frozenShadowSourceHash = currentShadowSourceHash;
    } else if (state.frozenShadowSourceHash !== currentShadowSourceHash) {
        throw new Error('质量影子观察算法已经变化，必须以新算法重新冻结观察。');
    }
    if (state.scope !== REGISTERED_RULE.scope || !sameSignals(state.requiredSignals, REGISTERED_RULE.requiredSignals)) {
        throw new Error('影子观察范围或信号组合已经变化，必须重新冻结。');
    }
}

function hasForwardEvidence(state) {
    return (state?.observations || []).some(item => Number(item?.newTradingDays) > 0 || Number(item?.newMatchedBEvents) > 0);
}

function updateQualityShadow(report, {
    root = ROOT,
    reportFile = null,
    now = new Date().toISOString(),
    allowEmptyRefreeze = false
} = {}) {
    const candidate = validateStrictReport(report);
    const shadowDir = path.join(root, '.local', 'strategy-shadow');
    const statePath = path.join(shadowDir, `${REGISTERED_RULE.id}.json`);
    fs.mkdirSync(shadowDir, { recursive: true });
    let state;
    if (fs.existsSync(statePath)) {
        state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
        try {
            assertFrozenStateMatches(state, report);
        } catch (error) {
            if (!allowEmptyRefreeze || hasForwardEvidence(state)) throw error;
            state = initialState(report, candidate, reportFile, now);
        }
    } else {
        state = initialState(report, candidate, reportFile, now);
    }
    const observation = observationFor(state, report, candidate, reportFile, now);
    const previous = state.observations.at(-1);
    if (!previous || previous.dataSnapshotHash !== observation.dataSnapshotHash) state.observations.push(observation);
    state.latest = observation;
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
    return { statePath: path.relative(root, statePath), state, observation };
}

function listQualityShadowStates(root = ROOT) {
    const shadowDir = path.join(root, '.local', 'strategy-shadow');
    if (!fs.existsSync(shadowDir)) return [];
    return fs.readdirSync(shadowDir)
        .filter(file => file.startsWith('wave-b-quality-') && file.endsWith('.json'))
        .sort()
        .map(file => {
            const state = JSON.parse(fs.readFileSync(path.join(shadowDir, file), 'utf8'));
            return {
                file,
                ruleId: state.ruleId,
                frozenAsOf: state.frozenAsOf,
                historicalQualified: state.frozenHistorical?.qualified === true,
                latest: compactObservation(state.latest)
            };
        });
}

module.exports = {
    canonicalSignals,
    forwardChecks,
    initialState,
    updateQualityShadow,
    listQualityShadowStates,
    validateStrictReport,
    compactObservation
};
