#!/usr/bin/env node

const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const vm = require('vm');
const {
    stableHash,
    getBaselinePolicyContract,
    summarizePerformance,
    summarizeEvaluationRows,
    subtractSummaries,
    buildCalendarWindows,
    buildScenarioSummaries,
    buildTemporalSummaries,
    countAffectedDecisionDays,
    evaluateCandidateScreen,
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
const candidateArgIndex = process.argv.indexOf('--candidate');
const requestedCandidateId = candidateArgIndex >= 0 ? process.argv[candidateArgIndex + 1] || '' : '';
const symbolsArgIndex = process.argv.indexOf('--symbols');
const requestedSymbolIds = symbolsArgIndex >= 0
    ? String(process.argv[symbolsArgIndex + 1] || '').split(',').map(value => value.trim()).filter(Boolean)
    : [];
const screenMode = process.argv.includes('--screen');
const fullMode = process.argv.includes('--full');
const showProgress = process.argv.includes('--progress');
const CANDIDATE_STATUS_LABELS = Object.freeze({
    baseline_control: '基线对照（baseline_control）',
    continue_full: '可申请全量回放（continue_full）',
    insufficient_evidence: '证据不足（insufficient_evidence）',
    recommend_shadow: '建议进入影子观察（recommend_shadow）',
    ready_for_product_review: '可进入人工产品取舍（ready_for_product_review）',
    reject: '已拒绝（reject）'
});

// 语义正确性候选：只在股票连续两日满足独立走强、且生产门禁把 80% 目标截到 50% 时，
// 允许 50% → 80%。候选自身逐日串行使用前一日候选决策，指数与 B/S 标记不改。
const WEAK_MARKET_CONFIRMED_80_VARIANT = {
    id: 'weak_market_confirmed_80_v1',
    question: '核心宽基连续偏弱期间，个股独立走强连续确认后，是否应允许生产门禁卡在50%的仓位恢复至80%？',
    type: 'decision-semantic-correction',
    candidateClass: 'semantic_correctness',
    collectDecisionDetails: true,
    weakMarketConfirmed80: {
        stocksOnly: true,
        marketLabel: '核心宽基偏弱',
        targetStrengthTier: 'independent',
        requiredPreviousPosition: 50,
        productionTargetPosition: 80,
        allowedPosition: 80,
        requireProductionIncreaseCap: 50
    },
    objective: '修正连续独立走强确认后的弱市增仓门禁语义，不新增买入信号，不改变首次建仓、减仓/清仓或指数路径。',
    allowedBsImpact: 'B/S 零漂移；仅允许既有 50% 持仓在满足连续确认时提高至 80%。',
    riskBudget: '只允许语义纠正范围内的仓位变化；首次 0/30% 仍不超过 50%，指数零变化。',
    restartCondition: '若历史准入失败，只能在新增独立交易时段或可定位到门禁语义的真实案例后重启。'
};

const WEAK_MARKET_CONFIRMED_80_CANDIDATE = {
    ...WEAK_MARKET_CONFIRMED_80_VARIANT,
    control: {
        id: 'retain_production_control',
        label: '保留当前生产配置',
        collectDecisionDetails: true
    },
    variant: WEAK_MARKET_CONFIRMED_80_VARIANT
};

function formatCandidateStatus(status) {
    return CANDIDATE_STATUS_LABELS[status] || `未知状态（${status || 'missing'}）`;
}

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
        ],
        alternatives: [{ ...WEAK_MARKET_CONFIRMED_80_CANDIDATE }]
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
        ],
        alternatives: [{
            id: 'wave_trial_two_group_gate_v1',
            question: '波段抄底型的 0%→30% 试探建仓，是否应至少由两个独立 scoreGroups 的有效买入信号共同支持？',
            type: 'trial-entry-score-group-gate',
            candidateClass: 'risk_control',
            control: {
                id: 'retain_wave_production_control',
                label: '保留当前波段生产配置',
                collectDecisionDetails: true
            },
            ablations: [{
                id: 'wave_trial_two_group_gate_v1',
                label: '0%→30% 试探仓要求双 scoreGroups 准入',
                collectDecisionDetails: true,
                trialEntryScoreGroupGate: {
                    minGroups: 2,
                    position: 30,
                    stocksOnly: true,
                    requireSignalReady: false
                },
                objective: '过滤波段抄底型由单一有效分组独自触发的 30% 试探仓；保留原始技术信号，只允许过滤或推迟原有试探 B。',
                category: 'risk_control',
                allowedBsImpact: '仅允许过滤或推迟波段抄底型个股路径中原本 0%→30% 的试探 B；不得新增 B，既有持仓、加减仓、离场、冷静期、风险上限和市场门禁不改。',
                riskBudget: '按 risk_control 候选评估：完整准入时平均回撤至少改善 0.5 个百分点，收益最多回退 0.5 个百分点，主要分层收益/回撤最多恶化 1 个百分点。',
                restartCondition: '快速筛选为 continue_full 时停止，须由人工批准后才可运行完整回放；不得自动进入影子观察或生产接入。'
            }]
        }, {
            id: 'wave_rejection_protection_v1',
            question: '波段持仓已有明显浮盈时，放量冲高回落是否应分档止盈，并阻止旧积分和市场门禁放松在次日自动加仓？',
            type: 'wave-rejection-position-protection',
            candidateClass: 'risk_control',
            control: {
                id: 'retain_wave_production_control',
                label: '保留当前波段生产配置',
                collectDecisionDetails: true
            },
            ablations: [{
                id: 'wave_rejection_protection_v1',
                label: '成熟浮盈放量长上影分档止盈，冻结旧积分并要求新信号确认加仓',
                collectDecisionDetails: true,
                waveRejectionProtection: {
                    stocksOnly: true,
                    minimumProfitRatio: 0.08,
                    minimumVolumeRatio: 1.5,
                    minimumUpperShadowBodyRatio: 1.5,
                    maximumCloseLocation: 0.5,
                    pressureLookbackDays: 20,
                    pressureToleranceRatio: 0.98,
                    minimumLockTradingDays: 2,
                    addConfirmationDays: 2,
                    blockingSignals: ['W2', 'W3'],
                    positionSteps: [0, 30, 50, 80]
                },
                objective: '只在已有明显浮盈的波段个股持仓上识别放量高位回落；分档保护利润，并防止旧积分或市场门禁放松单独触发再入/加仓。',
                category: 'risk_control',
                allowedBsImpact: '只允许波段拄底型个股路径在候选冲高回落日新增止盈 S，或将 80/50% 降一档；冻结期间只允许取消旧积分驱动的 B/加仓，指数与其他三套策略零漂移。',
                riskBudget: '按 risk_control 候选快速筛选；优先确认存在可观察的冲高回落事件和仓位差异，全量回放需另行人工批准。',
                restartCondition: '快速筛选被否决时停止；只能在新增独立时段或明确可定位的放量冲高回落错误案例后重启，不在同一快照追加参数。'
            }]
        }, {
            id: 'wave_rejection_event_guard_v2',
            revisionOf: 'wave_rejection_protection_v1',
            revisionMode: 'same_snapshot_structural_revision',
            question: '保留V1原阈值不变，删除全局加仓确认，只在真实冲高回落事件内做分档止盈、短期再入保护和分步恢复，能否避免V1的全局误伤？',
            type: 'wave-rejection-event-local-guard',
            candidateClass: 'risk_control',
            failedEvidence: 'V1仅触发23个冲高回落事件，但全局无新信号加仓门禁阻止737日、再入锁阻止309日，导致收益保护失败。',
            removedMechanisms: ['global_add_requires_recent_signal', 'strict_full_score_reentry_unlock'],
            preservedNumericParameters: {
                minimumProfitRatio: 0.08,
                minimumVolumeRatio: 1.5,
                minimumUpperShadowBodyRatio: 1.5,
                maximumCloseLocation: 0.5,
                pressureLookbackDays: 20,
                pressureToleranceRatio: 0.98,
                minimumLockTradingDays: 2
            },
            control: {
                id: 'retain_wave_production_control',
                label: '保留当前波段生产配置',
                collectDecisionDetails: true
            },
            ablations: [{
                id: 'wave_rejection_event_guard_v2',
                label: '只在冲高回落事件内分档止盈，按价格恢复或新信号局部解锁',
                collectDecisionDetails: true,
                waveRejectionProtection: {
                    stocksOnly: true,
                    minimumProfitRatio: 0.08,
                    minimumVolumeRatio: 1.5,
                    minimumUpperShadowBodyRatio: 1.5,
                    maximumCloseLocation: 0.5,
                    pressureLookbackDays: 20,
                    pressureToleranceRatio: 0.98,
                    minimumLockTradingDays: 2,
                    blockingSignals: ['W2', 'W3'],
                    positionSteps: [0, 30, 50, 80],
                    lockMode: 'event-local-recovery',
                    requireFreshSignalForAllIncreases: false,
                    recoveryPositionCap: 30,
                    recoveryHoldTradingDays: 1
                },
                objective: '仅修正V1的作用域：未发生冲高回落时与生产完全一致；只在事件后阻止旧积分立即回补，并以收复风险日高点、新波段信号或两日稳定恢复解锁。',
                category: 'risk_control',
                allowedBsImpact: '仅允许波段拄底型个股在事件日降一档，以及该事件恢复前局部阻止再入/加仓；没有事件的决策日、指数和其他三套策略零漂移。',
                riskBudget: '同快照结构性修订只作探索快筛；数值阈值与V1完全相同，快筛后不在同快照重跑。',
                restartCondition: '若V2快筛再次 `reject`，立即停止并等待新时段/新样本；若通过，必须由人工批准后先检查非 `seed` 留出样本。'
            }]
        }, {
            id: 'wave_fresh_entry_pressure_failure_v1',
            question: '波段首次建仓后两日内，若价格冲击下降均线或近期结构压力并出现爆量长上影、盘中盈利大幅回吐，是否应提前认定新仓失败？',
            type: 'wave-fresh-entry-pressure-failure',
            candidateClass: 'signal_timing',
            control: {
                id: 'retain_wave_production_control',
                label: '保留当前波段生产配置',
                collectDecisionDetails: true
            },
            ablations: [{
                id: 'wave_fresh_entry_pressure_failure_v1',
                label: '首次B后两日内遇强压力冲高失败，试探仓当日退出并沿用事件局部恢复',
                collectDecisionDetails: true,
                waveFreshEntryFailureProtection: {
                    stocksOnly: true,
                    maximumEntryAgeTradingDays: 2,
                    minimumIntradayProfitRatio: 0.05,
                    maximumCloseProfitRatio: 0.02,
                    minimumGivebackRatio: 0.60,
                    minimumVolumeRatio: 2.0,
                    minimumUpperShadowRangeRatio: 0.35,
                    maximumCloseLocation: 0.35,
                    pressureLookbackDays: 20,
                    pressureToleranceRatio: 0.015,
                    pressureCloseToleranceRatio: 0.005,
                    movingAveragePeriods: [20, 60],
                    movingAverageSlopeLookbackDays: 5,
                    pivotConfirmationDays: 2,
                    positionSteps: [0, 30, 50, 80]
                },
                objective: '只修正首次B后很快出现的漏卖时机：压力位本身不卖，必须同时出现爆量、长上影、弱收盘和盘中盈利大幅回吐。',
                category: 'signal_timing',
                allowedBsImpact: '仅允许波段抄底型个股在首次B后第1至2个交易日新增失败离场S或降低一档，并沿用既有事件局部恢复；首次B、买入积分、指数和其他三套策略零漂移。',
                riskBudget: '按 signal_timing 预算：平均收益回退不超过1个百分点、平均最大回撤恶化不超过0.5个百分点、换手增幅不超过10%。',
                restartCondition: '若作用域硬边界或组合预算失败则冻结；若达到 ready_for_product_review，用户已批准按冻结定义接入生产。'
            }]
        }, {
            id: 'wave_l10_trend_handoff_warning_v1',
            question: '波段已有持仓进入完整多头结构后，单独L10顶背离是否应从强制清仓改为预警减仓，让趋势接管后续持仓？',
            type: 'wave-l10-trend-handoff-warning',
            candidateClass: 'signal_timing',
            control: {
                id: 'retain_wave_production_control',
                label: '保留当前波段生产配置',
                collectDecisionDetails: true
            },
            ablations: [{
                id: 'wave_l10_trend_handoff_warning_v1',
                label: '完整多头持仓中的单独L10只预警并最多降至30%，不单信号归零',
                collectDecisionDetails: true,
                waveL10TrendHandoffWarning: {
                    stocksOnly: true,
                    blockingSignals: ['L3', 'L4', 'L9'],
                    movingAverageSlopeLookbackDays: 5,
                    warningPositionCap: 30
                },
                objective: '只修正常山北明式主升趋势中的L10误卖时机：已有持仓且收盘价>MA20>MA60、MA20不下降时，单独L10按预警减仓处理。',
                category: 'signal_timing',
                allowedBsImpact: '仅允许波段抄底型个股在符合条件的L10事件日及后续持仓链改变position/B/S；事件前、指数、其他三套策略零漂移。',
                riskBudget: '按 signal_timing 预算：平均收益回退不超过1个百分点、平均最大回撤恶化不超过0.5个百分点、换手增幅不超过10%。',
                restartCondition: '000158定向未阻止2024-10-25单独L10归零则立即冻结；定向通过后才运行seed快筛，不组合其他候选。'
            }]
        }, {
            id: 'wave_ma20_trend_defense_v1',
            question: '波段30%持仓在抬升中的MA20附近，因单独L3或有限幅度的买点价格硬失效准备归零时，是否应保留30%单日观察？',
            type: 'wave-ma20-trend-defense',
            candidateClass: 'signal_timing',
            control: {
                id: 'retain_wave_production_control',
                label: '保留当前波段生产配置',
                collectDecisionDetails: true
            },
            ablations: [{
                id: 'wave_ma20_trend_defense_v1',
                label: 'MA20结构未破时，单独L3或有限硬失效保留30%一日观察',
                collectDecisionDetails: true,
                waveMA20TrendDefense: {
                    stocksOnly: true,
                    position: 30,
                    movingAveragePeriod: 20,
                    longMovingAveragePeriod: 60,
                    completeTrendSlopeLookbackDays: 5,
                    maximumCloseBelowMovingAverageRatio: 0.005,
                    maximumCloseBelowMovingAverageAtr: 0.5,
                    maximumInvalidationGapAtr: 1,
                    minimumRiskScore: 40,
                    standaloneExitSignal: 'L3',
                    blockingSignals: ['L4', 'L9', 'L10'],
                    takeoverSignals: ['B6', 'B11']
                },
                objective: '减少MA20上行且结构未破时的单日误卖；只保留原30%一日，不恢复积分、不加仓、不新增B。',
                category: 'signal_timing',
                allowedBsImpact: '仅允许波段个股30%持仓在合格MA20防守日延后一个S；首次B、加仓、指数和其他三套策略零漂移。',
                riskBudget: '按 signal_timing 预算：平均收益回退不超过1个百分点、平均最大回撤恶化不超过0.5个百分点、换手增幅不超过10%；复合强离场、结构破位和风险归零不得延后。',
                restartCondition: '若seed快筛的作用域或组合预算失败则冻结；不在同快照继续调整ATR、均线或观察天数。'
            }]
        }, {
            id: 'wave_l10_high_reclaim_reentry_v1',
            question: '保留单独L10清仓后，完整多头首次收复风险日高点时，是否应局部解除冷静期并重新建立最多30%试探仓？',
            type: 'wave-l10-high-reclaim-reentry',
            candidateClass: 'signal_timing',
            control: {
                id: 'retain_wave_production_control',
                label: '保留当前波段生产配置',
                collectDecisionDetails: true
            },
            ablations: [{
                id: 'wave_l10_high_reclaim_reentry_v1',
                label: '单独L10清仓后首次收复风险日高点，按生产风险链重建最多30%试探仓',
                collectDecisionDetails: true,
                waveL10HighReclaimReentry: {
                    stocksOnly: true,
                    blockingSignals: ['L3', 'L4', 'L9'],
                    movingAverageSlopeLookbackDays: 5,
                    entryPositionCap: 30
                },
                objective: '保留L10清仓，只在该事件后首次收复风险日高点且完整多头仍成立时局部解除冷静期；不使用旧波段积分。',
                category: 'signal_timing',
                allowedBsImpact: '仅允许波段抄底型个股因单独L10清仓后的首次合格高点收复日新增0%→最多30%的B及后续持仓链变化；其他空仓日、指数和其他三套策略零漂移。',
                riskBudget: '按 signal_timing 预算：平均收益回退不超过1个百分点、平均最大回撤恶化不超过0.5个百分点、换手增幅不超过10%。',
                restartCondition: '000158定向未在L10事件后的首次合格高点收复日重新建仓则立即冻结；定向通过后才运行seed快筛，不组合其他候选。'
            }]
        }, {
            id: 'wave_failed_trial_reentry_v1',
            question: '波段30%试探仓因买入信号价格硬失效清仓后，若很快出现新的修复火花并完成右侧价格确认，是否应允许一次30%重新建仓？',
            type: 'wave-failed-trial-reentry',
            candidateClass: 'signal_timing',
            control: {
                id: 'retain_wave_production_control',
                label: '保留当前波段生产配置',
                collectDecisionDetails: true
            },
            ablations: [{
                id: 'wave_failed_trial_reentry_v1',
                label: '硬失效清仓后经新修复信号与右侧价格收复，允许一次30%重新建仓',
                collectDecisionDetails: true,
                waveFailedTrialReentry: {
                    stocksOnly: true,
                    maximumWaitTradingDays: 5,
                    entryPosition: 30,
                    repairSignals: ['B5', 'B6', 'B7', 'B8', 'B9', 'B11', 'B16', 'B17'],
                    confirmationSignals: ['B3', 'B15'],
                    cancelSignals: ['L3', 'L5', 'L10'],
                    requireCloseAboveMa20: true,
                    requireReclaimEntryAndExitHigh: true,
                    requireNoPostExitLowerLow: true,
                    requireRiskCoefficient: 1,
                    confirmationHoldTradingDays: 2,
                    oneRetryPerProductionTrial: true
                },
                objective: '只修正波段试探仓硬失效后的漏买时机：保留原清仓纪律，不恢复旧积分；必须先有清仓后的新修复信号，再收复原试探高点与清仓日高点并出现右侧确认，才重新建立30%；随后最多保护2个交易日，避免旧积分立刻清仓。',
                category: 'signal_timing',
                allowedBsImpact: '仅允许波段抄底型个股在生产30%试探仓因price-break硬失效清仓后的5个交易日内新增一次0%→30%的重新确认B；强离场、冷静期、再创新低、指数和其他三套策略零漂移。',
                riskBudget: '按 signal_timing 预算：平均收益回退不超过1个百分点、平均最大回撤恶化不超过0.5个百分点、换手增幅不超过10%；事件前、指数和无硬失效试探事件的决策日必须零漂移。',
                restartCondition: '若作用域硬边界或组合预算失败则冻结；不降低4/4门槛，不放宽为所有空仓标的通用右侧开仓。'
            }]
        }, {
            id: 'wave_same_day_repair_confirmation_entry_v2',
            revisionOf: 'wave_right_confirmation_entry_v1',
            revisionMode: 'same_snapshot_structural_revision',
            question: '删除“过去10日任一修复信号即可追认”的宽泛条件后，只在修复信号与B3/B15同日共振时建立30%，能否抓住修复转趋势主升并减少错误右侧开仓？',
            type: 'wave-same-day-repair-confirmation-entry',
            candidateClass: 'signal_timing',
            failedEvidence: 'V1使用过去10日任一修复信号配合B3/B15，新增448个B，5日成本后平均收益为负、失败率56.70%，整体收益下降且回撤增加。',
            removedMechanisms: ['stale_repair_signal_within_10_days', 'right_confirmation_without_same_day_repair'],
            preservedNumericParameters: {
                entryPosition: 30,
                requireRiskCoefficient: 1
            },
            control: {
                id: 'retain_wave_production_control',
                label: '保留当前波段生产配置',
                collectDecisionDetails: true
            },
            ablations: [{
                id: 'wave_same_day_repair_confirmation_entry_v2',
                label: '同日波段修复＋右侧确认时建立30%试探仓',
                collectDecisionDetails: true,
                waveSameDayRepairConfirmationEntry: {
                    stocksOnly: true,
                    entryPosition: 30,
                    repairSignals: ['B5', 'B6', 'B7', 'B9', 'B11', 'B16', 'B17'],
                    confirmationSignals: ['B3', 'B15'],
                    requireCloseAboveMa20: true,
                    requireRiskCoefficient: 1,
                    blockAnyExitOrWarning: true
                },
                objective: '只修正波段修复转趋势时的漏买：修复证据和右侧确认必须同日发生，不使用历史旧修复积分，不改变既有持仓的加减仓与离场链。',
                category: 'signal_timing',
                allowedBsImpact: '仅允许波段抄底型个股空仓日新增0%→最多30%的同日共振B；当日必须同时存在生产原始修复信号与B3/B15，指数和其他三套策略零漂移。后续仓位完全沿用生产风险、离场和冷静期。',
                riskBudget: '按 signal_timing 预算：平均收益回退不超过1个百分点、平均最大回撤恶化不超过0.5个百分点、换手增幅不超过10%；候选独有B必须全部具备同日双重归因。',
                restartCondition: '这是 wave_right_confirmation_entry_v1 在同快照上的唯一结构性修订；若再次失败，停止并等待新时段或新样本，不继续增加信号、天数或价格过滤。'
            }]
        }, {
            id: 'wave_trend_position_recovery_v1',
            question: '波段个股已有20%或30%仓位并进入完整多头结构后，是否应在风险链和市场门禁均允许时恢复到50%，改善主升阶段长期低仓？',
            type: 'wave-trend-position-recovery',
            candidateClass: 'performance',
            control: {
                id: 'retain_wave_production_control',
                label: '保留当前波段生产配置',
                collectDecisionDetails: true
            },
            ablations: [{
                id: 'wave_trend_position_recovery_v1',
                label: '已有低仓进入完整多头时按风险链恢复至50%',
                collectDecisionDetails: true,
                waveTrendPositionRecovery: {
                    stocksOnly: true,
                    maximumSourcePosition: 30,
                    targetPosition: 50,
                    movingAverageSlopeLookbackDays: 5,
                    requireRiskCoefficient: 1,
                    blockAnyExitOrWarning: true
                },
                objective: '只改善已有波段仓位的趋势参与：20%/30%持仓进入收盘价>MA20>MA60且MA20不下降的完整多头后，在风险系数、仓位上限和市场门禁均允许时恢复至50%。',
                category: 'performance',
                allowedBsImpact: '仅允许波段抄底型个股已有非零仓位的20%/30%→50%及后续持仓链变化；不得新增首次B，不覆盖L/W、冷静期、风险降仓、市场门禁、指数或其他三套策略。',
                riskBudget: '定向复算要求上涨区间平均仓位明显改善；快筛按performance门槛，平均收益不得回退、平均最大回撤恶化不超过0.5个百分点、换手增加不超过10%。',
                restartCondition: '定向复算若没有提高趋势区间仓位，或出现B/S、指数、风险事件越界则立即冻结；通过后才运行seed快筛，不在同快照调整均线天数或仓位档位。'
            }]
        }, {
            id: 'wave_independent_trend_recovery_v1',
            revisionOf: 'wave_trend_position_recovery_v1',
            revisionMode: 'same_snapshot_structural_revision',
            failedEvidence: 'wave_trend_position_recovery_v1在常山北明2022-11至2023-03仅凭均线多头恢复仓位，20日收益回退2.1674个百分点；2024主升段又被W1风险系数挡住，原规则没有命中目标段。',
            question: '已有波段仓位在W1风险背景下形成20日新高并保持完整多头结构时，是否应允许一次50%趋势恢复，解决真正右侧主升而不放宽普通均线反弹？',
            type: 'wave-independent-trend-recovery',
            candidateClass: 'performance',
            control: {
                id: 'retain_wave_production_control',
                label: '保留当前波段生产配置',
                collectDecisionDetails: true
            },
            ablations: [{
                id: 'wave_independent_trend_recovery_v1',
                label: '已有低仓在20日新高右侧确认后恢复至50%',
                collectDecisionDetails: true,
                waveIndependentTrendRecovery: {
                    stocksOnly: true,
                    maximumSourcePosition: 30,
                    targetPosition: 50,
                    movingAverageSlopeLookbackDays: 5,
                    pressureLookbackDays: 20,
                    minimumRiskScore: 45,
                    minimumRiskCoefficient: 0.5,
                    blockingSignals: ['L3', 'L4', 'L9', 'L10']
                },
                objective: '删除纯均线反弹误触发，只有已有非零仓位、收盘价站上MA20>MA60、MA20保持上行且突破前20日高点时，才允许W1背景下由低仓恢复至50%。',
                category: 'performance',
                allowedBsImpact: '仅允许波段抄底型个股已有非零20%/30%仓位的20%/30%→50%及后续持仓链变化；不得新增首次B，不覆盖L3/L4/L9/L10、冷静期、指数或其他三套策略。',
                riskBudget: '同快照结构性修订只作探索快筛；平均收益不得回退，平均最大回撤恶化不超过0.5个百分点，换手增加不超过10%。',
                restartCondition: '这是wave_trend_position_recovery_v1在同快照上的唯一结构性修订；若再次reject，停止继续增加价格、天数或风险标签过滤，等待新样本。'
            }]
        }, {
            id: 'wave_failed_short_trade_reentry_lock_v1',
            question: '波段交易在10日内以不高于入场价退出后，是否应短期阻止旧证据重复建仓，直到出现新独立信号或B8+B17强确认？',
            type: 'wave-failed-short-trade-reentry-lock',
            candidateClass: 'efficiency',
            control: {
                id: 'retain_wave_production_control',
                label: '保留当前波段生产配置',
                collectDecisionDetails: true
            },
            ablations: [{
                id: 'wave_failed_short_trade_reentry_lock_v1',
                label: '10日内失败交易后锁定旧证据5日，允许新独立信号或B8+B17绕过',
                collectDecisionDetails: true,
                waveFailedShortTradeReentryLock: {
                    stocksOnly: true,
                    maximumFailedHoldingDays: 10,
                    minimumLockTradingDays: 5,
                    strongPairSignals: ['B8', 'B17']
                },
                objective: '减少波段试探仓在短周期失败后由同一批窗口信号反复触发的B/S往返；新的独立积分信号站上MA20或B8+B17强确认仍可立即重新建仓。',
                category: 'efficiency',
                allowedBsImpact: '仅允许删除波段抄底型个股失败短交易后的旧证据B及其后续S；不得新增B，不改变未进入锁定期的持仓、指数或其他三套策略。',
                riskBudget: '快筛要求换手不增加且收益回退不超过0.25个百分点、回撤恶化不超过0.25个百分点；正式准入要求换手至少减少10%。',
                restartCondition: '若短交易或换手没有下降，或收益/回撤越过efficiency保护线则冻结；不在同快照延长锁定期或增加标的过滤。'
            }]
        }]
    },
    '突破追涨型': {
        id: 'baseline_retained',
        question: '完整样本下突破追涨保持最低回撤与较高胜率，本轮保持基线，不为少量压力样本收紧参与条件。',
        type: 'baseline-retained',
        candidateClass: 'control',
        alternatives: [{ ...WEAK_MARKET_CONFIRMED_80_CANDIDATE }]
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
        ],
        alternatives: [{ ...WEAK_MARKET_CONFIRMED_80_CANDIDATE }]
    }
};

function read(file) {
    return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

function readJson(file) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function hashFile(file) {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
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

function runCandidate(context, symbol, strategy, prepared, candidate, controlDecisionRows = null) {
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
        includeNoviceDetails: !screenMode,
        decisionAwareStrongExit: candidate.decisionAwareStrongExit || null,
        trialEntryScoreGroupGate: candidate.trialEntryScoreGroupGate || null,
        weakMarketConfirmed80: candidate.weakMarketConfirmed80 || null,
        waveRejectionProtection: candidate.waveRejectionProtection || null,
        waveFreshEntryFailureProtection: candidate.waveFreshEntryFailureProtection || null,
        waveL10TrendHandoffWarning: candidate.waveL10TrendHandoffWarning || null,
        waveMA20TrendDefense: candidate.waveMA20TrendDefense || null,
        waveL10HighReclaimReentry: candidate.waveL10HighReclaimReentry || null,
        waveFailedTrialReentry: candidate.waveFailedTrialReentry || null,
        waveSameDayRepairConfirmationEntry: candidate.waveSameDayRepairConfirmationEntry || null,
        waveTrendPositionRecovery: candidate.waveTrendPositionRecovery || null,
        waveIndependentTrendRecovery: candidate.waveIndependentTrendRecovery || null,
        waveFailedShortTradeReentryLock: candidate.waveFailedShortTradeReentryLock || null,
        controlDecisionRows
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
                skippedAtNonTrialPosition: 0,
                trialGateEvaluated: 0,
                trialGateFilteredSingleGroup: 0,
                trialGateAllowedTwoGroups: 0,
                trialGateDeferredEntries: 0,
                trialGateBlockedUnattributedB: 0,
                trialGateAppliedAtExistingPosition: 0,
                trialGateCandidateBWithoutSource: 0,
                trialGateRawSignalMismatches: 0,
                weakMarketConfirmed80Eligible: 0,
                weakMarketConfirmed80Applied: 0,
                weakMarketConfirmed80RejectedNoPrevious: 0,
                weakMarketConfirmed80RejectedNotStock: 0,
                weakMarketConfirmed80RejectedTargetMismatch: 0,
                weakMarketConfirmed80BsDrift: 0,
                waveRejectionEvaluated: 0,
                waveRejectionTriggered: 0,
                waveRejectionExited: 0,
                waveRejectionReduced: 0,
                waveReentryLockBlocked: 0,
                waveReentryLockReleased: 0,
                waveIncreaseBlockedNoFreshSignal: 0,
                waveIncreaseBlockedRiskSignal: 0,
                waveRecoveryPositionCapped: 0,
                waveRejectionIndexDrift: 0,
                waveFreshEntryEvaluated: 0,
                waveFreshEntryTriggered: 0,
                waveFreshEntryExited: 0,
                waveFreshEntryReduced: 0,
                waveFreshEntryIndexDrift: 0,
                waveL10HandoffEvaluated: 0,
                waveL10HandoffApplied: 0,
                waveL10HandoffIndexDrift: 0,
                waveMA20TrendDefenseEligible: 0,
                waveMA20TrendDefenseApplied: 0,
                waveMA20TrendDefenseTakenOver: 0,
                waveMA20TrendDefenseExpired: 0,
                waveMA20TrendDefenseInvalidB: 0,
                waveMA20TrendDefenseIndexDrift: 0,
                waveL10ReentryArmed: 0,
                waveL10ReentryReclaimed: 0,
                waveL10ReentryConfirmed: 0,
                waveL10ReentryMissed: 0,
                waveL10ReentryIndexDrift: 0,
                waveFailedTrialReentryArmed: 0,
                waveFailedTrialReentryRepairObserved: 0,
                waveFailedTrialReentryConfirmed: 0,
                waveFailedTrialReentryHoldDays: 0,
                waveFailedTrialReentryCanceledLowerLow: 0,
                waveFailedTrialReentryCanceledSignal: 0,
                waveFailedTrialReentryExpired: 0,
                waveFailedTrialReentryIndexDrift: 0,
                waveSameDayEntryEligible: 0,
                waveSameDayEntryConfirmed: 0,
                waveSameDayEntryIndexDrift: 0,
                waveSameDayEntryInvalidB: 0,
                waveTrendPositionRecoveryEligible: 0,
                waveTrendPositionRecoveryApplied: 0,
                waveTrendPositionRecoveryMarketBlocked: 0,
                waveTrendPositionRecoveryBsDrift: 0,
                waveTrendPositionRecoveryIndexDrift: 0,
                waveFailedShortTradeLockArmed: 0,
                waveFailedShortTradeReentryBlocked: 0,
                waveFailedShortTradeLockBypassed: 0,
                waveFailedShortTradeLockExpired: 0,
                waveFailedShortTradeInvalidB: 0,
                waveFailedShortTradeIndexDrift: 0
                ,waveIndependentTrendRecoveryEligible: 0,
                waveIndependentTrendRecoveryApplied: 0,
                waveIndependentTrendRecoveryMarketBlocked: 0,
                waveIndependentTrendRecoveryBsDrift: 0,
                waveIndependentTrendRecoveryIndexDrift: 0
            };
            const full = state.rawData[__symbol.id];
            const baseGetSignalMeta = getSignalMeta;
            const computeDecisionWithMeta = (index, prevPos) => {
                let capturedMeta = null;
                getSignalMeta = (...args) => {
                    capturedMeta = baseGetSignalMeta(...args);
                    return capturedMeta;
                };
                try {
                    return { decision: computeDecisionForIndex(index, full, prevPos), meta: capturedMeta };
                } finally {
                    getSignalMeta = baseGetSignalMeta;
                }
            };
            const rule = __symbol.decisionAwareStrongExit;
            const weakMarketRule = __symbol.weakMarketConfirmed80;
            const waveRejectionRule = __symbol.waveRejectionProtection;
            const waveFreshEntryRule = __symbol.waveFreshEntryFailureProtection;
            const waveL10HandoffRule = __symbol.waveL10TrendHandoffWarning;
            const waveMA20TrendDefenseRule = __symbol.waveMA20TrendDefense;
            const waveL10ReentryRule = __symbol.waveL10HighReclaimReentry;
            const waveFailedTrialReentryRule = __symbol.waveFailedTrialReentry;
            const waveSameDayEntryRule = __symbol.waveSameDayRepairConfirmationEntry;
            const waveTrendPositionRecoveryRule = __symbol.waveTrendPositionRecovery;
            const waveIndependentTrendRecoveryRule = __symbol.waveIndependentTrendRecovery;
            const waveFailedShortTradeReentryLockRule = __symbol.waveFailedShortTradeReentryLock;
            const hasCompleteUptrend = (index, lookbackDays) => {
                const close = Number(full[index]?.close);
                const ma20 = Number(state.indicators?.ma?.[20]?.[index]);
                const ma60 = Number(state.indicators?.ma?.[60]?.[index]);
                const previousMa20 = Number(state.indicators?.ma?.[20]?.[index - lookbackDays]);
                return Number.isFinite(close) && Number.isFinite(ma20) && Number.isFinite(ma60)
                    && Number.isFinite(previousMa20) && close > ma20 && ma20 > ma60 && ma20 >= previousMa20;
            };
            if (waveIndependentTrendRecoveryRule) {
                let candidatePrevPos = 0;
                for (let index = 0; index < full.length; index++) {
                    full[index]._strategy = state.strategy;
                    const controlPrevPos = Number(__symbol.controlDecisionRows?.[index]?.prevAdv);
                    const sourcePrevPosition = Number.isFinite(controlPrevPos) ? controlPrevPos : candidatePrevPos;
                    const computed = computeDecisionWithMeta(index, sourcePrevPosition);
                    const productionDecision = computed.decision;
                    const meta = computed.meta;
                    const item = full[index] || {};
                    const rawSignals = [...(item._signals || [])];
                    const close = Number(item.close);
                    const ma20 = Number(state.indicators?.ma?.[20]?.[index]);
                    const ma60 = Number(state.indicators?.ma?.[60]?.[index]);
                    const previousMa20 = Number(state.indicators?.ma?.[20]?.[index - Math.max(1, Number(waveIndependentTrendRecoveryRule.movingAverageSlopeLookbackDays) || 5)]);
                    const priorRows = full.slice(Math.max(0, index - Math.max(1, Number(waveIndependentTrendRecoveryRule.pressureLookbackDays) || 20)), index);
                    const previousHigh = priorRows.length ? Math.max(...priorRows.map(row => Number(row.high) || 0)) : 0;
                    const candidatePosition = Number(productionDecision.position) || 0;
                    const targetPosition = Math.max(0, Number(waveIndependentTrendRecoveryRule.targetPosition) || 50);
                    const blockingSignals = rawSignals.filter(signal => (waveIndependentTrendRecoveryRule.blockingSignals || []).includes(signal));
                    const eligible = __symbol.mode === 'stock'
                        && sourcePrevPosition > 0
                        && sourcePrevPosition <= Math.max(0, Number(waveIndependentTrendRecoveryRule.maximumSourcePosition) || 30)
                        && candidatePosition > 0
                        && candidatePosition <= Math.max(0, Number(waveIndependentTrendRecoveryRule.maximumSourcePosition) || 30)
                        && Number.isFinite(close) && Number.isFinite(ma20) && Number.isFinite(ma60) && Number.isFinite(previousMa20)
                        && close > ma20 && ma20 > ma60 && ma20 >= previousMa20
                        && previousHigh > 0 && close > previousHigh
                        && Number(productionDecision?.risk?.score) >= Number(waveIndependentTrendRecoveryRule.minimumRiskScore || 45)
                        && Number(productionDecision?.risk?.coef) >= Number(waveIndependentTrendRecoveryRule.minimumRiskCoefficient || 0.5)
                        && blockingSignals.length === 0 && !meta?.inCooldown;
                    let decision = productionDecision;
                    if (eligible) {
                        diagnostics.waveIndependentTrendRecoveryEligible++;
                        const strength = { tier: 'independent', label: '独立走强', reasons: ['收盘突破20日高点', '完整多头结构'] };
                        const marketGate = applyMarketRiskGate(productionDecision.market, sourcePrevPosition, targetPosition, strength);
                        const gatedPosition = Math.max(0, Number(marketGate.position) || 0);
                        if (gatedPosition >= targetPosition) {
                            const event = {
                                active: true,
                                status: 'independent_trend_recovery',
                                day: index,
                                date: item.date || '',
                                previousHigh,
                                sourcePosition: candidatePosition,
                                previousPosition: candidatePrevPos,
                                targetPosition
                            };
                            decision = {
                                ...productionDecision,
                                prevAdv: sourcePrevPosition,
                                basePosition: Math.max(Number(productionDecision.basePosition) || 0, targetPosition),
                                position: targetPosition,
                                marketGate: { ...marketGate, position: targetPosition },
                                targetStrength: strength,
                                simpleAction: '顺势加仓',
                                simpleColorClass: 'text-bull',
                                bsMark: null,
                                positionDriver: (productionDecision.positionDriver || '')
                                    + (productionDecision.positionDriver ? '；' : '')
                                    + '已有波段仓位突破20日高点并保持完整多头，候选恢复至50%',
                                waveIndependentTrendRecovery: event
                            };
                            diagnostics.waveIndependentTrendRecoveryApplied++;
                        } else {
                            diagnostics.waveIndependentTrendRecoveryMarketBlocked++;
                        }
                    }
                    if (decision.bsMark !== productionDecision.bsMark) diagnostics.waveIndependentTrendRecoveryBsDrift++;
                    if (__symbol.mode !== 'stock' && (decision.position !== productionDecision.position || decision.bsMark !== productionDecision.bsMark)) diagnostics.waveIndependentTrendRecoveryIndexDrift++;
                    full[index]._candidateMeta = meta;
                    full[index]._decision = decision;
                    candidatePrevPos = decision.position;
                }
            } else if (waveTrendPositionRecoveryRule) {
                let candidatePrevPos = 0;
                for (let index = 0; index < full.length; index++) {
                    full[index]._strategy = state.strategy;
                    const computed = computeDecisionWithMeta(index, candidatePrevPos);
                    const productionDecision = computed.decision;
                    const meta = computed.meta;
                    const rawSignals = [...(full[index]._signals || [])];
                    let decision = productionDecision;
                    const appliesToSymbol = !waveTrendPositionRecoveryRule.stocksOnly || __symbol.mode === 'stock';
                    const sourcePosition = Number(productionDecision.position) || 0;
                    const requestedPosition = Math.max(0, Number(waveTrendPositionRecoveryRule.targetPosition) || 50);
                    const maximumSourcePosition = Math.max(0, Number(waveTrendPositionRecoveryRule.maximumSourcePosition) || 30);
                    const noRiskSignal = !waveTrendPositionRecoveryRule.blockAnyExitOrWarning
                        || !rawSignals.some(signal => /^L|^W/.test(signal));
                    const riskMatches = Number(productionDecision?.risk?.coef) === Number(waveTrendPositionRecoveryRule.requireRiskCoefficient);
                    const positionCapAllows = !productionDecision.positionCap
                        || Number(productionDecision.positionCap.limit) >= requestedPosition;
                    const eligible = appliesToSymbol
                        && candidatePrevPos > 0
                        && sourcePosition > 0
                        && sourcePosition <= maximumSourcePosition
                        && hasCompleteUptrend(index, Math.max(1, Number(waveTrendPositionRecoveryRule.movingAverageSlopeLookbackDays) || 5))
                        && noRiskSignal
                        && !meta?.inCooldown
                        && riskMatches
                        && positionCapAllows
                        && productionDecision?.market?.allowAdd !== false;
                    if (eligible) {
                        diagnostics.waveTrendPositionRecoveryEligible++;
                        const marketGate = applyMarketRiskGate(
                            productionDecision.market,
                            candidatePrevPos,
                            requestedPosition,
                            productionDecision.targetStrength
                        );
                        const targetPosition = Math.max(0, Number(marketGate.position) || 0);
                        if (targetPosition >= requestedPosition) {
                            const event = {
                                active: true,
                                status: 'complete_uptrend_position_recovery',
                                day: index,
                                date: full[index].date || '',
                                sourcePosition,
                                previousPosition: candidatePrevPos,
                                targetPosition
                            };
                            decision = {
                                ...productionDecision,
                                prevAdv: candidatePrevPos,
                                basePosition: Math.max(Number(productionDecision.basePosition) || 0, targetPosition),
                                position: targetPosition,
                                marketGate: { ...marketGate, position: targetPosition },
                                simpleAction: targetPosition > candidatePrevPos ? '顺势加仓' : '积极持有',
                                simpleColorClass: 'text-bull',
                                bsMark: productionDecision.bsMark,
                                positionDriver: (productionDecision.positionDriver || '')
                                    + (productionDecision.positionDriver ? '；' : '')
                                    + '已有波段仓位进入完整多头且风险链允许，候选将低仓恢复至50%',
                                waveTrendPositionRecovery: event
                            };
                            diagnostics.waveTrendPositionRecoveryApplied++;
                        } else {
                            diagnostics.waveTrendPositionRecoveryMarketBlocked++;
                        }
                    }
                    if (decision.bsMark !== productionDecision.bsMark) diagnostics.waveTrendPositionRecoveryBsDrift++;
                    if (__symbol.mode !== 'stock' && (decision.position !== productionDecision.position || decision.bsMark !== productionDecision.bsMark)) {
                        diagnostics.waveTrendPositionRecoveryIndexDrift++;
                    }
                    full[index]._candidateMeta = meta;
                    full[index]._decision = decision;
                    candidatePrevPos = decision.position;
                }
            } else if (waveFailedShortTradeReentryLockRule) {
                let candidatePrevPos = 0;
                let entryContext = null;
                let lockContext = null;
                for (let index = 0; index < full.length; index++) {
                    full[index]._strategy = state.strategy;
                    const computed = computeDecisionWithMeta(index, candidatePrevPos);
                    const productionDecision = computed.decision;
                    const meta = computed.meta;
                    const item = full[index] || {};
                    const rawSignals = [...(item._signals || [])];
                    const scoreSignals = (meta?.windowScoreSignals || []).map(entry => entry?.signal).filter(Boolean);
                    let decision = productionDecision;
                    const appliesToSymbol = !waveFailedShortTradeReentryLockRule.stocksOnly || __symbol.mode === 'stock';

                    if (lockContext && index > lockContext.lockUntilDay) {
                        diagnostics.waveFailedShortTradeLockExpired++;
                        lockContext = null;
                    }
                    if (appliesToSymbol && lockContext && candidatePrevPos === 0
                        && productionDecision.position > 0 && productionDecision.bsMark === 'B') {
                        const signalSet = new Set(scoreSignals);
                        const strongPair = (waveFailedShortTradeReentryLockRule.strongPairSignals || [])
                            .every(signal => signalSet.has(signal));
                        const freshSignal = scoreSignals.some(signal => !(lockContext.failedEntrySignals || []).includes(signal));
                        const ma20 = Number(state.indicators?.ma?.[20]?.[index]);
                        const close = Number(item.close);
                        const freshStructure = freshSignal && Number.isFinite(ma20) && Number.isFinite(close) && close > ma20
                            && !rawSignals.some(signal => /^L|^W/.test(signal));
                        if (strongPair || freshStructure) {
                            diagnostics.waveFailedShortTradeLockBypassed++;
                            lockContext = null;
                        } else {
                            const event = {
                                active: true,
                                status: 'blocked_stale_reentry',
                                day: index,
                                date: item.date || '',
                                lockUntilDay: lockContext.lockUntilDay,
                                failedEntryDate: lockContext.failedEntryDate,
                                failedExitDate: lockContext.failedExitDate,
                                failedEntrySignals: lockContext.failedEntrySignals || [],
                                blockedSignals: scoreSignals
                            };
                            decision = {
                                ...productionDecision,
                                prevAdv: 0,
                                basePosition: 0,
                                position: 0,
                                marketGate: { ...productionDecision.marketGate, position: 0 },
                                simpleAction: '持币观望',
                                simpleColorClass: 'text-dim',
                                bsMark: null,
                                positionDriver: '短周期失败交易后的旧证据仍在锁定期，候选等待新独立信号或B8+B17确认',
                                waveFailedShortTradeReentryLock: event
                            };
                            diagnostics.waveFailedShortTradeReentryBlocked++;
                        }
                    }

                    if (candidatePrevPos === 0 && decision.position > 0) {
                        entryContext = {
                            entryDay: index,
                            entryDate: item.date || '',
                            entryClose: Number(item.close),
                            entrySignals: scoreSignals
                        };
                    } else if (candidatePrevPos > 0 && decision.position === 0 && entryContext) {
                        const holdingDays = index - entryContext.entryDay;
                        const exitClose = Number(item.close);
                        const failed = holdingDays <= Math.max(1, Number(waveFailedShortTradeReentryLockRule.maximumFailedHoldingDays) || 10)
                            && Number.isFinite(exitClose) && Number.isFinite(entryContext.entryClose)
                            && exitClose <= entryContext.entryClose;
                        if (appliesToSymbol && failed) {
                            lockContext = {
                                failedEntryDate: entryContext.entryDate,
                                failedExitDate: item.date || '',
                                failedEntrySignals: entryContext.entrySignals || [],
                                lockUntilDay: index + Math.max(1, Number(waveFailedShortTradeReentryLockRule.minimumLockTradingDays) || 5)
                            };
                            diagnostics.waveFailedShortTradeLockArmed++;
                        }
                        entryContext = null;
                    }
                    if (decision.bsMark === 'B' && productionDecision.bsMark !== 'B') diagnostics.waveFailedShortTradeInvalidB++;
                    if (__symbol.mode !== 'stock' && (decision.position !== productionDecision.position || decision.bsMark !== productionDecision.bsMark)) {
                        diagnostics.waveFailedShortTradeIndexDrift++;
                    }
                    full[index]._candidateMeta = meta;
                    full[index]._decision = decision;
                    candidatePrevPos = decision.position;
                }
            } else if (waveMA20TrendDefenseRule) {
                let candidatePrevPos = 0;
                let observation = null;
                const requiredPosition = Math.max(0, Number(waveMA20TrendDefenseRule.position) || 30);
                const period = Math.max(1, Number(waveMA20TrendDefenseRule.movingAveragePeriod) || 20);
                const longPeriod = Math.max(1, Number(waveMA20TrendDefenseRule.longMovingAveragePeriod) || 60);
                const slopeDays = Math.max(1, Number(waveMA20TrendDefenseRule.completeTrendSlopeLookbackDays) || 5);
                for (let index = 0; index < full.length; index++) {
                    full[index]._strategy = state.strategy;
                    const originalSignals = [...(full[index]._signals || [])];
                    full[index]._candidateOriginalSignals = originalSignals;
                    let suppressedTriggerSignals = null;
                    if (observation?.triggerType === 'standalone_l3') {
                        suppressedTriggerSignals = [...(full[observation.triggerDay]?._signals || [])];
                        full[observation.triggerDay]._signals = suppressedTriggerSignals.filter(signal => signal !== waveMA20TrendDefenseRule.standaloneExitSignal);
                    }
                    const computed = computeDecisionWithMeta(index, candidatePrevPos);
                    if (suppressedTriggerSignals) full[observation.triggerDay]._signals = suppressedTriggerSignals;
                    const productionDecision = computed.decision;
                    const meta = computed.meta;
                    let decision = productionDecision;
                    const item = full[index] || {};
                    const close = Number(item.close);
                    const ma = Number(state.indicators?.ma?.[period]?.[index]);
                    const previousMA = Number(state.indicators?.ma?.[period]?.[index - 1]);
                    const longMA = Number(state.indicators?.ma?.[longPeriod]?.[index]);
                    const trendMA = Number(state.indicators?.ma?.[period]?.[index - slopeDays]);
                    const atr = getATR(full, index);
                    const maGap = Number.isFinite(ma) && Number.isFinite(close) ? Math.max(0, ma - close) : Infinity;
                    const maGapRatio = Number.isFinite(ma) && ma > 0 ? maGap / ma : Infinity;
                    const maGapAtr = atr > 0 ? maGap / atr : Infinity;
                    const maSupport = [close, ma, previousMA].every(Number.isFinite)
                        && ma >= previousMA
                        && maGapRatio <= Math.max(0, Number(waveMA20TrendDefenseRule.maximumCloseBelowMovingAverageRatio) || 0.005)
                        && maGapAtr <= Math.max(0, Number(waveMA20TrendDefenseRule.maximumCloseBelowMovingAverageAtr) || 0.5);
                    const completeUptrend = [close, ma, longMA, trendMA].every(Number.isFinite)
                        && close >= ma && ma > longMA && ma >= trendMA;
                    const defenseLevel = Number(productionDecision.risk?.stop);
                    const defenseIntact = !Number.isFinite(defenseLevel) || close >= defenseLevel;
                    const riskAllows = Number(productionDecision.risk?.score) >= Math.max(0, Number(waveMA20TrendDefenseRule.minimumRiskScore) || 40)
                        && getRiskPositionCap(productionDecision.risk) >= requiredPosition;
                    const currentExitSignals = [...(meta?.exitSignals || [])];
                    const blockingSignals = originalSignals.filter(signal => (waveMA20TrendDefenseRule.blockingSignals || []).includes(signal));
                    const invalidationsToday = (meta?.invalidatedWindowSignals || []).filter(signal =>
                        signal?.reason === 'price-break' && Number(signal?.invalidationDay) === index
                    );
                    const invalidationGap = invalidationsToday.length
                        ? Math.max(...invalidationsToday.map(signal => Math.max(0, Number(signal.invalidationLevel) - close)).filter(Number.isFinite), 0)
                        : Infinity;
                    const limitedHardInvalidation = invalidationsToday.length > 0 && atr > 0
                        && invalidationGap / atr <= Math.max(0, Number(waveMA20TrendDefenseRule.maximumInvalidationGapAtr) || 1);
                    const standaloneL3 = currentExitSignals.length === 1
                        && currentExitSignals[0] === waveMA20TrendDefenseRule.standaloneExitSignal
                        && blockingSignals.length === 0
                        && completeUptrend;
                    const hardInvalidationPullback = currentExitSignals.length === 0
                        && !(meta?.warningSignals || []).length
                        && limitedHardInvalidation
                        && close >= ma;
                    const eligible = (!waveMA20TrendDefenseRule.stocksOnly || __symbol.mode === 'stock')
                        && candidatePrevPos === requiredPosition
                        && Number(productionDecision.position) === 0
                        && !meta?.inCooldown
                        && maSupport
                        && defenseIntact
                        && riskAllows
                        && (standaloneL3 || hardInvalidationPullback);

                    if (observation) {
                        const freshTakeoverSignals = (waveMA20TrendDefenseRule.takeoverSignals || ['B6', 'B11'])
                            .filter(signal => originalSignals.includes(signal));
                        const takeoverPassed = maSupport
                            && defenseIntact
                            && riskAllows
                            && !(meta?.exitSignals || []).length
                            && !(meta?.warningSignals || []).length
                            && !meta?.inCooldown
                            && close >= Number(observation.triggerLow)
                            && (close >= ma || freshTakeoverSignals.length > 0);
                        decision = takeoverPassed
                            ? {
                                ...productionDecision,
                                position: requiredPosition,
                                prevAdv: candidatePrevPos,
                                marketGate: { ...productionDecision.marketGate, position: requiredPosition },
                                simpleAction: '轻仓持有',
                                simpleColorClass: 'text-info',
                                bsMark: null,
                                waveMA20TrendDefense: {
                                    ...observation,
                                    applied: false,
                                    status: 'taken_over',
                                    followUpDay: index,
                                    followUpDate: item.date || '',
                                    freshTakeoverSignals
                                }
                            }
                            : {
                                ...productionDecision,
                                position: 0,
                                prevAdv: candidatePrevPos,
                                marketGate: { ...productionDecision.marketGate, position: 0 },
                                simpleAction: '执行离场',
                                simpleColorClass: 'text-bear',
                                bsMark: 'S',
                                waveMA20TrendDefense: {
                                    ...observation,
                                    applied: false,
                                    status: 'expired',
                                    followUpDay: index,
                                    followUpDate: item.date || '',
                                    freshTakeoverSignals
                                }
                            };
                        if (takeoverPassed) diagnostics.waveMA20TrendDefenseTakenOver++;
                        else diagnostics.waveMA20TrendDefenseExpired++;
                        observation = null;
                    } else if (eligible) {
                        const triggerType = standaloneL3 ? 'standalone_l3' : 'limited_hard_invalidation';
                        observation = {
                            applied: true,
                            status: 'observing',
                            triggerType,
                            triggerDay: index,
                            triggerDate: item.date || '',
                            triggerLow: Number(item.low),
                            triggerClose: close,
                            movingAverage: ma,
                            previousMovingAverage: previousMA,
                            defenseLevel: Number.isFinite(defenseLevel) ? defenseLevel : null,
                            invalidationGapAtr: limitedHardInvalidation && atr > 0 ? invalidationGap / atr : null
                        };
                        decision = {
                            ...productionDecision,
                            position: requiredPosition,
                            prevAdv: candidatePrevPos,
                            marketGate: { ...productionDecision.marketGate, position: requiredPosition },
                            exit: standaloneL3
                                ? { level: '减仓观察', detail: '完整多头中的单独MACD死叉先作MA20防守观察' }
                                : productionDecision.exit,
                            simpleAction: '谨慎持有',
                            simpleColorClass: 'text-warn',
                            bsMark: null,
                            positionDriver: (productionDecision.positionDriver || '')
                                + (productionDecision.positionDriver ? '；' : '')
                                + 'MA20上行且结构未破，原30%保留一日观察',
                            waveMA20TrendDefense: observation
                        };
                        diagnostics.waveMA20TrendDefenseEligible++;
                        diagnostics.waveMA20TrendDefenseApplied++;
                    }
                    if (decision.bsMark === 'B' && productionDecision.bsMark !== 'B') diagnostics.waveMA20TrendDefenseInvalidB++;
                    if (__symbol.mode !== 'stock' && (decision.position !== productionDecision.position || decision.bsMark !== productionDecision.bsMark)) {
                        diagnostics.waveMA20TrendDefenseIndexDrift++;
                    }
                    full[index]._candidateMeta = meta;
                    full[index]._decision = decision;
                    candidatePrevPos = decision.position;
                }
            } else if (waveL10HandoffRule) {
                let candidatePrevPos = 0;
                for (let index = 0; index < full.length; index++) {
                    full[index]._strategy = state.strategy;
                    const originalSignals = [...(full[index]._signals || [])];
                    full[index]._candidateOriginalSignals = originalSignals;
                    const production = computeDecisionWithMeta(index, candidatePrevPos);
                    let decision = production.decision;
                    let meta = production.meta;
                    const appliesToSymbol = !waveL10HandoffRule.stocksOnly || __symbol.mode === 'stock';
                    const blockingSignals = originalSignals.filter(signal => (waveL10HandoffRule.blockingSignals || []).includes(signal));
                    const eligible = appliesToSymbol && candidatePrevPos > 0 && originalSignals.includes('L10')
                        && blockingSignals.length === 0
                        && hasCompleteUptrend(index, Math.max(1, Number(waveL10HandoffRule.movingAverageSlopeLookbackDays) || 5));
                    if (eligible) {
                        diagnostics.waveL10HandoffEvaluated++;
                        full[index]._signals = originalSignals.filter(signal => signal !== 'L10');
                        const alternative = computeDecisionWithMeta(index, candidatePrevPos);
                        const targetPosition = Math.min(
                            Number(alternative.decision.position) || 0,
                            Math.max(0, Number(waveL10HandoffRule.warningPositionCap) || 30)
                        );
                        if (targetPosition > 0) {
                            const event = {
                                status: 'trend_handoff_warning',
                                triggerDay: index,
                                triggerDate: full[index].date || '',
                                triggerHigh: Number(full[index].high),
                                triggerClose: Number(full[index].close),
                                sourcePosition: candidatePrevPos,
                                targetPosition
                            };
                            decision = {
                                ...alternative.decision,
                                prevAdv: candidatePrevPos,
                                position: targetPosition,
                                marketGate: { ...alternative.decision.marketGate, position: targetPosition },
                                simpleAction: targetPosition < candidatePrevPos ? '防守减仓' : '谨慎持有',
                                simpleColorClass: 'text-warn',
                                bsMark: null,
                                positionDriver: (alternative.decision.positionDriver || '')
                                    + (alternative.decision.positionDriver ? '；' : '')
                                    + '完整多头持仓中的单独L10按预警处理，趋势接管后续持仓',
                                waveL10TrendHandoffWarning: event
                            };
                            meta = alternative.meta;
                            diagnostics.waveL10HandoffApplied++;
                        } else {
                            full[index]._signals = originalSignals;
                        }
                    }
                    if (__symbol.mode !== 'stock' && (decision.position !== production.decision.position || decision.bsMark !== production.decision.bsMark)) {
                        diagnostics.waveL10HandoffIndexDrift++;
                    }
                    full[index]._candidateMeta = meta;
                    full[index]._decision = decision;
                    candidatePrevPos = decision.position;
                }
            } else if (waveL10ReentryRule) {
                let candidatePrevPos = 0;
                let armedEvent = null;
                for (let index = 0; index < full.length; index++) {
                    full[index]._strategy = state.strategy;
                    const computed = computeDecisionWithMeta(index, candidatePrevPos);
                    const productionDecision = computed.decision;
                    const meta = computed.meta;
                    const rawSignals = [...(full[index]._signals || [])];
                    let decision = productionDecision;
                    const appliesToSymbol = !waveL10ReentryRule.stocksOnly || __symbol.mode === 'stock';
                    if (appliesToSymbol && armedEvent && candidatePrevPos === 0 && Number(full[index].close) > Number(armedEvent.triggerHigh)) {
                        diagnostics.waveL10ReentryReclaimed++;
                        const blockingSignals = rawSignals.filter(signal => (waveL10ReentryRule.blockingSignals || []).includes(signal));
                        const eligible = blockingSignals.length === 0
                            && hasCompleteUptrend(index, Math.max(1, Number(waveL10ReentryRule.movingAverageSlopeLookbackDays) || 5));
                        if (eligible) {
                            const requestedPosition = Math.max(0, Number(waveL10ReentryRule.entryPositionCap) || 30);
                            let targetPosition = quantizePosition(requestedPosition * Number(productionDecision?.risk?.coef || 0));
                            if (Number(productionDecision?.risk?.score) < 40) targetPosition = quantizePosition(Math.min(targetPosition, 20));
                            const positionCap = getPositionCap(meta, 0, targetPosition, index, full, state.indicators);
                            if (positionCap) targetPosition = quantizePosition(Math.min(targetPosition, positionCap.limit));
                            const strength = { tier: 'ordinary', label: '普通机会', reasons: ['L10风险日高点首次收复'] };
                            const marketGate = applyMarketRiskGate(productionDecision.market, 0, targetPosition, strength);
                            targetPosition = Math.min(requestedPosition, Math.max(0, Number(marketGate.position) || 0));
                            if (targetPosition > 0) {
                                const event = {
                                    ...armedEvent,
                                    status: 'high_reclaim_reentry',
                                    confirmationDay: index,
                                    confirmationDate: full[index].date || '',
                                    confirmationClose: Number(full[index].close),
                                    targetPosition
                                };
                                decision = {
                                    ...productionDecision,
                                    prevAdv: 0,
                                    basePosition: targetPosition,
                                    position: targetPosition,
                                    marketGate: { ...marketGate, position: targetPosition },
                                    targetStrength: strength,
                                    simpleAction: '轻仓建仓',
                                    simpleColorClass: 'text-info',
                                    bsMark: 'B',
                                    positionDriver: (productionDecision.positionDriver || '')
                                        + (productionDecision.positionDriver ? '；' : '')
                                        + '单独L10清仓后首次收复风险日高点，局部解除冷静期并按风险链重建试探仓',
                                    waveL10HighReclaimReentry: event
                                };
                                diagnostics.waveL10ReentryConfirmed++;
                            } else {
                                diagnostics.waveL10ReentryMissed++;
                            }
                        } else {
                            diagnostics.waveL10ReentryMissed++;
                        }
                        armedEvent = null;
                    }
                    const blockingAtExit = rawSignals.filter(signal => (waveL10ReentryRule.blockingSignals || []).includes(signal));
                    const singleL10Exit = appliesToSymbol && candidatePrevPos > 0 && productionDecision.position === 0
                        && productionDecision.bsMark === 'S' && rawSignals.includes('L10') && blockingAtExit.length === 0;
                    if (singleL10Exit) {
                        armedEvent = {
                            status: 'armed_after_l10_exit',
                            triggerDay: index,
                            triggerDate: full[index].date || '',
                            triggerHigh: Number(full[index].high),
                            triggerClose: Number(full[index].close),
                            sourcePosition: candidatePrevPos
                        };
                        decision = { ...decision, waveL10HighReclaimReentry: armedEvent };
                        diagnostics.waveL10ReentryArmed++;
                    }
                    if (__symbol.mode !== 'stock' && (decision.position !== productionDecision.position || decision.bsMark !== productionDecision.bsMark)) {
                        diagnostics.waveL10ReentryIndexDrift++;
                    }
                    full[index]._candidateMeta = meta;
                    full[index]._decision = decision;
                    candidatePrevPos = decision.position;
                }
            } else if (waveSameDayEntryRule) {
                let candidatePrevPos = 0;
                for (let index = 0; index < full.length; index++) {
                    full[index]._strategy = state.strategy;
                    const computed = computeDecisionWithMeta(index, candidatePrevPos);
                    const productionDecision = computed.decision;
                    const meta = computed.meta;
                    const item = full[index] || {};
                    const rawSignals = [...(item._signals || [])];
                    const appliesToSymbol = !waveSameDayEntryRule.stocksOnly || __symbol.mode === 'stock';
                    const repairSignals = rawSignals.filter(signal => (waveSameDayEntryRule.repairSignals || []).includes(signal));
                    const confirmationSignals = rawSignals.filter(signal => (waveSameDayEntryRule.confirmationSignals || []).includes(signal));
                    const close = Number(item.close);
                    const ma20 = Number(state.indicators?.ma?.[20]?.[index]);
                    const riskMatches = Number(productionDecision?.risk?.coef) === Number(waveSameDayEntryRule.requireRiskCoefficient);
                    const noRiskSignal = !waveSameDayEntryRule.blockAnyExitOrWarning || !rawSignals.some(signal => /^L|^W/.test(signal));
                    const priceConfirmed = !waveSameDayEntryRule.requireCloseAboveMa20 || (Number.isFinite(ma20) && close > ma20);
                    const eligible = appliesToSymbol
                        && candidatePrevPos === 0
                        && productionDecision.position === 0
                        && repairSignals.length > 0
                        && confirmationSignals.length > 0
                        && noRiskSignal
                        && !meta?.inCooldown
                        && riskMatches
                        && priceConfirmed;
                    let decision = productionDecision;
                    if (eligible) {
                        diagnostics.waveSameDayEntryEligible++;
                        const requestedPosition = Math.max(0, Number(waveSameDayEntryRule.entryPosition) || 30);
                        const strength = { tier: 'ordinary', label: '普通机会', reasons: ['同日波段修复与右侧确认'] };
                        const marketGate = applyMarketRiskGate(productionDecision.market, candidatePrevPos, requestedPosition, strength);
                        const targetPosition = Math.max(0, Number(marketGate.position) || 0);
                        if (targetPosition > 0) {
                            const event = {
                                active: true,
                                status: 'confirmed',
                                day: index,
                                date: item.date || '',
                                repairSignals,
                                confirmationSignals,
                                close,
                                ma20,
                                requestedPosition,
                                targetPosition
                            };
                            decision = {
                                ...productionDecision,
                                prevAdv: candidatePrevPos,
                                basePosition: targetPosition,
                                position: targetPosition,
                                marketGate,
                                simpleAction: targetPosition <= 30 ? '轻仓建仓' : '积极建仓',
                                simpleColorClass: targetPosition <= 30 ? 'text-info' : 'text-bull',
                                bsMark: 'B',
                                positionDriver: (productionDecision.positionDriver || '')
                                    + (productionDecision.positionDriver ? '；' : '')
                                    + '波段修复信号与右侧确认同日共振，候选建立30%试探仓',
                                waveSameDayRepairConfirmationEntry: event
                            };
                            diagnostics.waveSameDayEntryConfirmed++;
                        }
                    }
                    if (__symbol.mode !== 'stock' && (decision.position !== productionDecision.position || decision.bsMark !== productionDecision.bsMark)) {
                        diagnostics.waveSameDayEntryIndexDrift++;
                    }
                    if (decision.bsMark === 'B' && !decision.waveSameDayRepairConfirmationEntry && productionDecision.bsMark !== 'B') {
                        diagnostics.waveSameDayEntryInvalidB++;
                    }
                    full[index]._candidateMeta = meta;
                    full[index]._decision = decision;
                    candidatePrevPos = decision.position;
                }
            } else if (waveFailedTrialReentryRule) {
                let candidatePrevPos = 0;
                let entryContext = null;
                let reentryWatch = null;
                let reentryHoldUntil = -1;
                let reentryStopLow = null;
                for (let index = 0; index < full.length; index++) {
                    full[index]._strategy = state.strategy;
                    const computed = computeDecisionWithMeta(index, candidatePrevPos);
                    const productionDecision = computed.decision;
                    const meta = computed.meta;
                    const item = full[index] || {};
                    const rawSignals = [...(item._signals || [])];
                    const appliesToSymbol = !waveFailedTrialReentryRule.stocksOnly || __symbol.mode === 'stock';
                    let decision = productionDecision;
                    let event = null;

                    if (appliesToSymbol && candidatePrevPos > 0 && index <= reentryHoldUntil) {
                        const close = Number(item.close);
                        const hasCurrentRiskSignal = rawSignals.some(signal => /^L|^W/.test(signal));
                        const stopBroken = Number.isFinite(reentryStopLow) && Number.isFinite(close) && close < reentryStopLow;
                        const riskCoefficient = Number(productionDecision?.risk?.coef);
                        const holdBasePosition = Number(waveFailedTrialReentryRule.entryPosition) || 30;
                        const riskAdjustedHold = Number.isFinite(riskCoefficient)
                            ? quantizePosition(holdBasePosition * riskCoefficient)
                            : 0;
                        if (!hasCurrentRiskSignal && !meta?.inCooldown && !stopBroken && riskAdjustedHold > 0
                            && productionDecision.position < riskAdjustedHold) {
                            const targetPosition = riskAdjustedHold;
                            const reducing = targetPosition < candidatePrevPos;
                            event = {
                                status: 'confirmation_hold',
                                holdUntilDay: reentryHoldUntil,
                                stopLow: reentryStopLow,
                                targetPosition
                            };
                            decision = {
                                ...productionDecision,
                                prevAdv: candidatePrevPos,
                                position: targetPosition,
                                marketGate: { ...productionDecision.marketGate, position: targetPosition },
                                simpleAction: reducing ? '防守减仓' : '轻仓持有',
                                simpleColorClass: reducing ? 'text-warn' : 'text-info',
                                bsMark: null,
                                positionDriver: (productionDecision.positionDriver || '')
                                    + (productionDecision.positionDriver ? '；' : '')
                                    + '重新确认后短期保留风险调整后的试探仓，避免旧积分立即触发清仓',
                                waveTrialReentry: event
                            };
                            diagnostics.waveFailedTrialReentryHoldDays++;
                        } else if (hasCurrentRiskSignal || meta?.inCooldown || stopBroken) {
                            reentryHoldUntil = -1;
                            reentryStopLow = null;
                        }
                    }

                    if (appliesToSymbol && reentryWatch) {
                        const age = index - reentryWatch.exitDay;
                        const hasCancelSignal = rawSignals.some(signal => (waveFailedTrialReentryRule.cancelSignals || []).includes(signal));
                        const lowerLow = waveFailedTrialReentryRule.requireNoPostExitLowerLow
                            && Number.isFinite(Number(item.low))
                            && Number(item.low) < Number(reentryWatch.exitLow);
                        if (hasCancelSignal || meta?.inCooldown) {
                            event = { ...reentryWatch, status: 'canceled_signal', cancelDay: index, cancelDate: item.date || '', cancelSignals: rawSignals.filter(signal => (waveFailedTrialReentryRule.cancelSignals || []).includes(signal)) };
                            reentryWatch = null;
                            diagnostics.waveFailedTrialReentryCanceledSignal++;
                        } else if (lowerLow) {
                            event = { ...reentryWatch, status: 'canceled_lower_low', cancelDay: index, cancelDate: item.date || '', cancelLow: Number(item.low) };
                            reentryWatch = null;
                            diagnostics.waveFailedTrialReentryCanceledLowerLow++;
                        } else if (age > Math.max(1, Number(waveFailedTrialReentryRule.maximumWaitTradingDays) || 5)) {
                            event = { ...reentryWatch, status: 'expired', expiredDay: index, expiredDate: item.date || '' };
                            reentryWatch = null;
                            diagnostics.waveFailedTrialReentryExpired++;
                        } else {
                            const repairSignals = rawSignals.filter(signal => (waveFailedTrialReentryRule.repairSignals || []).includes(signal));
                            if (repairSignals.length) {
                                reentryWatch = {
                                    ...reentryWatch,
                                    repairDay: index,
                                    repairDate: item.date || '',
                                    repairSignals: [...new Set([...(reentryWatch.repairSignals || []), ...repairSignals])]
                                };
                                diagnostics.waveFailedTrialReentryRepairObserved++;
                            }
                            const confirmationSignals = rawSignals.filter(signal => (waveFailedTrialReentryRule.confirmationSignals || []).includes(signal));
                            const close = Number(item.close);
                            const ma20 = Number(state.indicators?.ma?.[20]?.[index]);
                            const noCurrentRiskSignal = !rawSignals.some(signal => /^L|^W/.test(signal));
                            const riskMatches = Number(productionDecision?.risk?.coef) === Number(waveFailedTrialReentryRule.requireRiskCoefficient);
                            const marketAllowsAdd = productionDecision?.market?.allowAdd !== false;
                            const reclaimHigh = Number(reentryWatch.reclaimHigh);
                            const priceConfirmed = (!waveFailedTrialReentryRule.requireCloseAboveMa20 || (Number.isFinite(ma20) && close > ma20))
                                && (!waveFailedTrialReentryRule.requireReclaimEntryAndExitHigh || (Number.isFinite(reclaimHigh) && close > reclaimHigh));
                            const canReenter = candidatePrevPos === 0
                                && productionDecision.position === 0
                                && confirmationSignals.length > 0
                                && Number.isInteger(reentryWatch.repairDay)
                                && reentryWatch.repairDay > reentryWatch.exitDay
                                && noCurrentRiskSignal
                                && !meta?.inCooldown
                                && riskMatches
                                && marketAllowsAdd
                                && priceConfirmed;
                            if (canReenter) {
                                const targetPosition = Math.max(0, Number(waveFailedTrialReentryRule.entryPosition) || 30);
                                event = {
                                    ...reentryWatch,
                                    status: 'confirmed',
                                    confirmationDay: index,
                                    confirmationDate: item.date || '',
                                    confirmationSignals,
                                    confirmationClose: close,
                                    ma20,
                                    targetPosition
                                };
                                decision = {
                                    ...productionDecision,
                                    prevAdv: candidatePrevPos,
                                    basePosition: Math.max(Number(productionDecision.basePosition) || 0, targetPosition),
                                    position: targetPosition,
                                    marketGate: { ...productionDecision.marketGate, position: targetPosition },
                                    simpleAction: '重新确认建仓',
                                    simpleColorClass: 'text-info',
                                    bsMark: 'B',
                                    positionDriver: (productionDecision.positionDriver || '')
                                        + (productionDecision.positionDriver ? '；' : '')
                                        + '试探仓硬失效后出现新修复信号，并收复原试探与清仓高点，候选重新建立30%仓位',
                                    waveTrialReentry: event
                                };
                                reentryWatch = null;
                                reentryHoldUntil = index + Math.max(0, Number(waveFailedTrialReentryRule.confirmationHoldTradingDays) || 0);
                                reentryStopLow = Number(item.low);
                                entryContext = {
                                    day: index,
                                    date: item.date || '',
                                    high: Number(item.high),
                                    low: Number(item.low),
                                    close,
                                    source: 'candidate-reentry'
                                };
                                diagnostics.waveFailedTrialReentryConfirmed++;
                            }
                        }
                    }

                    const invalidatedToday = (meta?.invalidatedWindowSignals || []).filter(invalidation =>
                        invalidation?.reason === 'price-break' && Number(invalidation?.invalidationDay) === index
                    );
                    const isHardInvalidationExit = appliesToSymbol
                        && candidatePrevPos > 0
                        && candidatePrevPos <= Number(waveFailedTrialReentryRule.entryPosition || 30)
                        && productionDecision.position === 0
                        && productionDecision.bsMark === 'S'
                        && invalidatedToday.length > 0
                        && !meta?.inCooldown
                        && !['清仓防守', '强离场'].includes(productionDecision?.exit?.level)
                        && entryContext?.source === 'production';
                    if (isHardInvalidationExit) {
                        const failedSignalHigh = Math.max(...invalidatedToday.map(invalidation => Number(full[invalidation.day]?.high)).filter(Number.isFinite));
                        const exitHigh = Number(item.high);
                        const entryHigh = Number(entryContext?.high);
                        const reclaimHigh = Math.max(...[failedSignalHigh, exitHigh, entryHigh].filter(Number.isFinite));
                        reentryWatch = {
                            status: 'watching',
                            exitDay: index,
                            exitDate: item.date || '',
                            exitHigh,
                            exitLow: Number(item.low),
                            exitClose: Number(item.close),
                            entryDay: entryContext.day,
                            entryDate: entryContext.date,
                            entryHigh,
                            entryLow: Number(entryContext.low),
                            failedSignals: invalidatedToday.map(invalidation => invalidation.signal),
                            failedSignalHigh,
                            reclaimHigh,
                            repairDay: null,
                            repairDate: '',
                            repairSignals: []
                        };
                        event = reentryWatch;
                        diagnostics.waveFailedTrialReentryArmed++;
                    }

                    if (__symbol.mode !== 'stock' && (decision.position !== productionDecision.position || decision.bsMark !== productionDecision.bsMark)) {
                        diagnostics.waveFailedTrialReentryIndexDrift++;
                    }
                    if (candidatePrevPos === 0 && decision.position > 0 && !entryContext) {
                        entryContext = {
                            day: index,
                            date: item.date || '',
                            high: Number(item.high),
                            low: Number(item.low),
                            close: Number(item.close),
                            source: decision.bsMark === 'B' ? 'production' : 'existing'
                        };
                    }
                    if (candidatePrevPos > 0 && decision.position === 0) entryContext = null;
                    if (!decision.waveTrialReentry && event) decision = { ...decision, waveTrialReentry: event };
                    full[index]._candidateMeta = meta;
                    full[index]._decision = decision;
                    candidatePrevPos = decision.position;
                }
            } else if (waveFreshEntryRule) {
                const positionSteps = [...(waveFreshEntryRule.positionSteps || [0, 30, 50, 80])].sort((left, right) => left - right);
                const lowerPositionStep = position => {
                    const eligible = positionSteps.filter(step => step < position);
                    return eligible.length ? eligible[eligible.length - 1] : 0;
                };
                const findRecentPivotHigh = (index, lookbackDays, pivotDays) => {
                    const start = Math.max(pivotDays, index - lookbackDays);
                    for (let day = index - pivotDays - 1; day >= start; day--) {
                        const value = Number(full[day]?.high);
                        if (!Number.isFinite(value)) continue;
                        let confirmed = true;
                        for (let offset = 1; offset <= pivotDays; offset++) {
                            if (Number(full[day - offset]?.high) >= value || Number(full[day + offset]?.high) >= value) {
                                confirmed = false;
                                break;
                            }
                        }
                        if (confirmed) return { day, value };
                    }
                    return null;
                };
                const getPressureContext = (index, item) => {
                    const tolerance = Math.max(0, Number(waveFreshEntryRule.pressureToleranceRatio) || 0);
                    const closeTolerance = Math.max(0, Number(waveFreshEntryRule.pressureCloseToleranceRatio) || 0);
                    const lookbackDays = Math.max(1, Number(waveFreshEntryRule.pressureLookbackDays) || 20);
                    const pivotDays = Math.max(1, Number(waveFreshEntryRule.pivotConfirmationDays) || 2);
                    const high = Number(item.high);
                    const close = Number(item.close);
                    const sources = [];
                    const pivot = findRecentPivotHigh(index, lookbackDays, pivotDays);
                    if (pivot && high >= pivot.value * (1 - tolerance) && close <= pivot.value * (1 + closeTolerance)) {
                        sources.push({ type: 'pivot', period: null, level: pivot.value, day: pivot.day });
                    }
                    const slopeDays = Math.max(1, Number(waveFreshEntryRule.movingAverageSlopeLookbackDays) || 5);
                    for (const period of waveFreshEntryRule.movingAveragePeriods || []) {
                        const series = state.indicators?.ma?.[period] || [];
                        const level = Number(series[index]);
                        const previousLevel = Number(series[index - slopeDays]);
                        if (!Number.isFinite(level) || !Number.isFinite(previousLevel) || level > previousLevel) continue;
                        if (high >= level * (1 - tolerance) && close <= level * (1 + closeTolerance)) {
                            sources.push({ type: 'ma', period, level, day: index });
                        }
                    }
                    return { matched: sources.length > 0, sources };
                };
                let candidatePrevPos = 0;
                let entryDay = null;
                let entryClose = null;
                for (let index = 0; index < full.length; index++) {
                    full[index]._strategy = state.strategy;
                    const computed = computeDecisionWithMeta(index, candidatePrevPos);
                    const productionDecision = computed.decision;
                    let decision = productionDecision;
                    const item = full[index] || {};
                    const existingWaveEvent = productionDecision?.waveRejectionProtection || {};
                    const entryAge = Number.isInteger(entryDay) ? index - entryDay : null;
                    const eligibleAge = Number.isInteger(entryAge)
                        && entryAge >= 1
                        && entryAge <= Math.max(1, Number(waveFreshEntryRule.maximumEntryAgeTradingDays) || 2);
                    const appliesToSymbol = !waveFreshEntryRule.stocksOnly || __symbol.mode === 'stock';
                    if (appliesToSymbol && candidatePrevPos > 0 && productionDecision.position > 0
                        && eligibleAge && Number.isFinite(entryClose) && entryClose > 0
                        && !existingWaveEvent.active && !['triggered', 'superseded'].includes(existingWaveEvent.status)) {
                        diagnostics.waveFreshEntryEvaluated++;
                        const previousFive = full.slice(Math.max(0, index - 5), index);
                        const averageVolume = previousFive.length
                            ? previousFive.reduce((sum, row) => sum + (Number(row?.vol) || 0), 0) / previousFive.length
                            : 0;
                        const open = Number(item.open);
                        const high = Number(item.high);
                        const low = Number(item.low);
                        const close = Number(item.close);
                        const volume = Number(item.vol) || 0;
                        const range = high - low;
                        const upperShadow = high - Math.max(open, close);
                        const intradayProfitRatio = high / entryClose - 1;
                        const closeProfitRatio = close / entryClose - 1;
                        const givebackRatio = high > entryClose ? (high - close) / (high - entryClose) : 0;
                        const volumeRatio = averageVolume > 0 ? volume / averageVolume : 0;
                        const upperShadowRangeRatio = range > 0 ? upperShadow / range : 0;
                        const closeLocation = range > 0 ? (close - low) / range : 1;
                        const pressure = getPressureContext(index, item);
                        const triggered = intradayProfitRatio >= Number(waveFreshEntryRule.minimumIntradayProfitRatio)
                            && closeProfitRatio <= Number(waveFreshEntryRule.maximumCloseProfitRatio)
                            && givebackRatio >= Number(waveFreshEntryRule.minimumGivebackRatio)
                            && volumeRatio >= Number(waveFreshEntryRule.minimumVolumeRatio)
                            && upperShadowRangeRatio >= Number(waveFreshEntryRule.minimumUpperShadowRangeRatio)
                            && closeLocation <= Number(waveFreshEntryRule.maximumCloseLocation)
                            && pressure.matched;
                        if (triggered) {
                            const targetPosition = lowerPositionStep(candidatePrevPos);
                            const event = {
                                active: true,
                                status: 'triggered',
                                eventType: 'fresh_entry_failure',
                                triggerDay: index,
                                triggerDate: item.date || '',
                                triggerHigh: high,
                                triggerLow: low,
                                triggerClose: close,
                                entryDay,
                                entryClose,
                                entryAge,
                                intradayProfitRatio,
                                closeProfitRatio,
                                givebackRatio,
                                volumeRatio,
                                upperShadowRangeRatio,
                                closeLocation,
                                pressureSources: pressure.sources,
                                sourcePosition: candidatePrevPos,
                                targetPosition,
                                recoveryPending: false,
                                recoveryHoldRemaining: 0
                            };
                            decision = {
                                ...productionDecision,
                                position: Math.min(productionDecision.position, targetPosition),
                                marketGate: { ...productionDecision.marketGate, position: Math.min(productionDecision.position, targetPosition) },
                                simpleAction: targetPosition === 0 ? '执行离场' : '防守减仓',
                                simpleColorClass: targetPosition === 0 ? 'text-bear' : 'text-warn',
                                bsMark: targetPosition === 0 ? 'S' : null,
                                positionDriver: (productionDecision.positionDriver || '')
                                    + (productionDecision.positionDriver ? '；' : '')
                                    + '首次建仓后冲击压力失败，候选提前防守',
                                waveRejectionProtection: event
                            };
                            diagnostics.waveFreshEntryTriggered++;
                            if (targetPosition === 0) diagnostics.waveFreshEntryExited++;
                            else diagnostics.waveFreshEntryReduced++;
                        }
                    }
                    if (__symbol.mode !== 'stock' && (decision.position !== productionDecision.position || decision.bsMark !== productionDecision.bsMark)) {
                        diagnostics.waveFreshEntryIndexDrift++;
                    }
                    if (candidatePrevPos === 0 && decision.position > 0) {
                        entryDay = index;
                        entryClose = Number(item.close) || null;
                    }
                    if (decision.position === 0) {
                        entryDay = null;
                        entryClose = null;
                    }
                    full[index]._candidateMeta = computed.meta;
                    full[index]._decision = decision;
                    candidatePrevPos = decision.position;
                }
            } else if (waveRejectionRule) {
                const positionSteps = [...(waveRejectionRule.positionSteps || [0, 30, 50, 80])].sort((left, right) => left - right);
                const lowerPositionStep = position => {
                    const eligible = positionSteps.filter(step => step < position);
                    return eligible.length ? eligible[eligible.length - 1] : 0;
                };
                const withCandidatePosition = (decision, position, prevPosition, reason, event = null) => {
                    const exiting = prevPosition > 0 && position === 0;
                    const reducing = prevPosition > position && position > 0;
                    const holding = prevPosition === position && position > 0;
                    return {
                        ...decision,
                        prevAdv: prevPosition,
                        position,
                        marketGate: { ...decision.marketGate, position },
                        simpleAction: exiting ? '执行离场' : (reducing ? '防守减仓' : (holding ? (position <= 30 ? '轻仓持有' : '谨慎持有') : decision.simpleAction)),
                        simpleColorClass: exiting ? 'text-bear' : (reducing ? 'text-warn' : (holding ? (position <= 30 ? 'text-info' : 'text-warn') : decision.simpleColorClass)),
                        bsMark: exiting ? 'S' : (prevPosition === 0 && position > 0 ? decision.bsMark : null),
                        positionDriver: (decision.positionDriver || '') + (decision.positionDriver ? '；' : '') + reason,
                        waveRejectionProtection: event
                    };
                };
                const hasBlockingRiskSignal = signals => (waveRejectionRule.blockingSignals || []).some(signal => signals.includes(signal));
                const freshScoreAfter = (meta, day) => (meta?.windowScoreSignals || [])
                    .filter(item => Number(item.day) > day)
                    .reduce((sum, item) => sum + (Number(item.score) || 0), 0);
                const hasRecentFreshSignal = (meta, index) => {
                    const days = Math.max(1, Number(waveRejectionRule.addConfirmationDays) || 1);
                    return (meta?.windowScoreSignals || []).some(item => Number(item.day) >= index - days + 1);
                };
                let candidatePrevPos = 0;
                let entryClose = null;
                let rejectionLock = null;
                let pendingRecovery = null;
                let recoveryCapUntilIndex = -1;
                for (let index = 0; index < full.length; index++) {
                    full[index]._strategy = state.strategy;
                    const computed = computeDecisionWithMeta(index, candidatePrevPos);
                    const productionDecision = computed.decision;
                    const meta = computed.meta;
                    const item = full[index] || {};
                    const rawSignals = [...(item._signals || [])];
                    const appliesToSymbol = !waveRejectionRule.stocksOnly || __symbol.mode === 'stock';
                    let decision = productionDecision;
                    let event = null;

                    if (appliesToSymbol && rejectionLock) {
                        const lockAge = index - rejectionLock.triggerIndex;
                        const freshScore = freshScoreAfter(meta, rejectionLock.triggerIndex);
                        const blockedByRiskSignal = hasBlockingRiskSignal(rawSignals);
                        const isEventLocalRecovery = waveRejectionRule.lockMode === 'event-local-recovery';
                        const close = Number(item.close);
                        const recoveredRiskHigh = Number.isFinite(close) && close > Number(rejectionLock.triggerHigh);
                        const hasFreshPostEventSignal = (meta?.windowScoreSignals || [])
                            .some(signal => Number(signal.day) > rejectionLock.triggerIndex);
                        const stableRecovery = lockAge >= waveRejectionRule.minimumLockTradingDays
                            && Number.isFinite(close)
                            && close > Number(rejectionLock.triggerClose);
                        const lockCanRelease = isEventLocalRecovery
                            ? (!blockedByRiskSignal && (recoveredRiskHigh || hasFreshPostEventSignal || stableRecovery))
                            : (lockAge >= waveRejectionRule.minimumLockTradingDays
                                && freshScore >= Number(STRATEGY.buyThreshold || 0)
                                && !blockedByRiskSignal);
                        if (lockCanRelease) {
                            const releasedLock = { ...rejectionLock };
                            rejectionLock = null;
                            diagnostics.waveReentryLockReleased++;
                            if (isEventLocalRecovery) {
                                const recoveryCap = Number(waveRejectionRule.recoveryPositionCap) || 30;
                                const holdDays = Math.max(0, Number(waveRejectionRule.recoveryHoldTradingDays) || 0);
                                pendingRecovery = {
                                    triggerDate: releasedLock.triggerDate,
                                    recoveredRiskHigh,
                                    hasFreshPostEventSignal,
                                    stableRecovery,
                                    recoveryCap,
                                    holdDays
                                };
                                if (candidatePrevPos > 0 || decision.position > 0) {
                                    recoveryCapUntilIndex = index + holdDays;
                                    const cappedPosition = Math.min(decision.position, Math.max(candidatePrevPos, recoveryCap));
                                    event = {
                                        status: 'recovery_position_capped',
                                        ...pendingRecovery
                                    };
                                    if (cappedPosition !== decision.position) {
                                        decision = withCandidatePosition(decision, cappedPosition, candidatePrevPos, '冲高回落风险已局部解除，候选先恢复到30%观察', event);
                                        diagnostics.waveRecoveryPositionCapped++;
                                    }
                                    pendingRecovery = null;
                                }
                            }
                        } else if (decision.position > candidatePrevPos) {
                            event = {
                                status: 'reentry_locked',
                                triggerDate: rejectionLock.triggerDate,
                                triggerHigh: rejectionLock.triggerHigh,
                                lockAge,
                                freshScore
                            };
                            decision = withCandidatePosition(
                                decision,
                                candidatePrevPos,
                                candidatePrevPos,
                                isEventLocalRecovery
                                    ? '冲高回落风险事件尚未收复，候选局部阻止旧积分立即回补'
                                    : '冲高回落后旧积分冻结，等待退出后新信号重新达标',
                                event
                            );
                            diagnostics.waveReentryLockBlocked++;
                        }
                    }

                    if (appliesToSymbol && !rejectionLock && pendingRecovery && candidatePrevPos === 0 && decision.position > 0) {
                        const recoveryCap = pendingRecovery.recoveryCap;
                        const cappedPosition = Math.min(decision.position, recoveryCap);
                        recoveryCapUntilIndex = index + pendingRecovery.holdDays;
                        event = { status: 'recovery_position_capped', ...pendingRecovery };
                        if (cappedPosition !== decision.position) {
                            decision = withCandidatePosition(decision, cappedPosition, candidatePrevPos, '冲高回落风险已解除，首次回补最多30%', event);
                            diagnostics.waveRecoveryPositionCapped++;
                        }
                        pendingRecovery = null;
                    }

                    if (appliesToSymbol && recoveryCapUntilIndex >= index && candidatePrevPos > 0 && decision.position > candidatePrevPos) {
                        const recoveryCap = Number(waveRejectionRule.recoveryPositionCap) || 30;
                        const cappedPosition = Math.min(Math.max(candidatePrevPos, recoveryCap), decision.position);
                        event = { status: 'recovery_hold_capped', recoveryCap, capUntilIndex: recoveryCapUntilIndex };
                        decision = withCandidatePosition(decision, cappedPosition, candidatePrevPos, '风险事件解除后先保持一个交易日的低仓确认', event);
                        diagnostics.waveRecoveryPositionCapped++;
                    }

                    const requireFreshSignalForAllIncreases = waveRejectionRule.requireFreshSignalForAllIncreases !== false;
                    if (appliesToSymbol && requireFreshSignalForAllIncreases && !rejectionLock
                        && recoveryCapUntilIndex < index && candidatePrevPos > 0 && decision.position > candidatePrevPos) {
                        const blockedByRiskSignal = hasBlockingRiskSignal(rawSignals);
                        const hasFreshSignal = hasRecentFreshSignal(meta, index);
                        if (blockedByRiskSignal || !hasFreshSignal) {
                            event = {
                                status: blockedByRiskSignal ? 'increase_blocked_risk_signal' : 'increase_blocked_no_fresh_signal',
                                blockingSignals: rawSignals.filter(signal => (waveRejectionRule.blockingSignals || []).includes(signal)),
                                hasFreshSignal
                            };
                            decision = withCandidatePosition(
                                decision,
                                candidatePrevPos,
                                candidatePrevPos,
                                blockedByRiskSignal ? '当前有量价分歧，候选暂停加仓' : '市场限制放松但标的没有新的波段确认信号，候选维持原仓位',
                                event
                            );
                            if (blockedByRiskSignal) diagnostics.waveIncreaseBlockedRiskSignal++;
                            else diagnostics.waveIncreaseBlockedNoFreshSignal++;
                        }
                    }

                    const canEvaluateRejection = waveRejectionRule.lockMode !== 'event-local-recovery' || !rejectionLock;
                    if (appliesToSymbol && canEvaluateRejection && candidatePrevPos > 0 && Number.isFinite(entryClose) && entryClose > 0) {
                        diagnostics.waveRejectionEvaluated++;
                        const lookbackDays = Math.max(1, Number(waveRejectionRule.pressureLookbackDays) || 20);
                        const previousRows = full.slice(Math.max(0, index - lookbackDays), index);
                        const previousFive = full.slice(Math.max(0, index - 5), index);
                        const previousHigh = previousRows.length ? Math.max(...previousRows.map(row => Number(row?.high) || 0)) : 0;
                        const averageVolume = previousFive.length
                            ? previousFive.reduce((sum, row) => sum + (Number(row?.vol) || 0), 0) / previousFive.length
                            : 0;
                        const open = Number(item.open);
                        const high = Number(item.high);
                        const low = Number(item.low);
                        const close = Number(item.close);
                        const volume = Number(item.vol) || 0;
                        const range = high - low;
                        const body = Math.abs(close - open);
                        const upperShadow = high - Math.max(open, close);
                        const closeLocation = range > 0 ? (close - low) / range : 1;
                        const profitRatio = close / entryClose - 1;
                        const volumeRatio = averageVolume > 0 ? volume / averageVolume : 0;
                        const nearPressure = previousHigh > 0 && high >= previousHigh * waveRejectionRule.pressureToleranceRatio;
                        const rejectionTriggered = Number.isFinite(profitRatio)
                            && profitRatio >= waveRejectionRule.minimumProfitRatio
                            && volumeRatio >= waveRejectionRule.minimumVolumeRatio
                            && nearPressure
                            && upperShadow >= Math.max(body * waveRejectionRule.minimumUpperShadowBodyRatio, 0)
                            && closeLocation <= waveRejectionRule.maximumCloseLocation;
                        if (rejectionTriggered) {
                            const targetPosition = lowerPositionStep(candidatePrevPos);
                            event = {
                                status: 'rejection_triggered',
                                triggerDate: item.date,
                                triggerHigh: high,
                                entryClose,
                                profitRatio,
                                volumeRatio,
                                upperShadowBodyRatio: body > 0 ? upperShadow / body : null,
                                closeLocation,
                                sourcePosition: candidatePrevPos,
                                targetPosition
                            };
                            decision = withCandidatePosition(decision, Math.min(decision.position, targetPosition), candidatePrevPos, '已有浮盈遇放量冲高回落，候选分档保护利润', event);
                            rejectionLock = { triggerIndex: index, triggerDate: item.date, triggerHigh: high, triggerClose: close };
                            diagnostics.waveRejectionTriggered++;
                            if (targetPosition === 0) diagnostics.waveRejectionExited++;
                            else diagnostics.waveRejectionReduced++;
                        }
                    }

                    if (__symbol.mode !== 'stock' && (decision.position !== productionDecision.position || decision.bsMark !== productionDecision.bsMark)) {
                        diagnostics.waveRejectionIndexDrift++;
                    }
                    if (candidatePrevPos === 0 && decision.position > 0) entryClose = Number(item.close) || null;
                    if (decision.position === 0) entryClose = null;
                    if (!decision.waveRejectionProtection && event) decision = { ...decision, waveRejectionProtection: event };
                    full[index]._candidateMeta = meta;
                    full[index]._decision = decision;
                    candidatePrevPos = decision.position;
                }
            } else if (weakMarketRule) {
                let candidatePrevPos = 0;
                let previousCandidateDecision = null;
                let capturedTargetPosition = null;
                let capturedMarketGate = null;
                const baseApplyMarketRiskGate = applyMarketRiskGate;
                applyMarketRiskGate = (...args) => {
                    capturedTargetPosition = Number(args[2]);
                    capturedMarketGate = baseApplyMarketRiskGate(...args);
                    return capturedMarketGate;
                };
                try {
                    for (let index = 0; index < full.length; index++) {
                        capturedTargetPosition = null;
                        capturedMarketGate = null;
                        full[index]._strategy = state.strategy;
                        const computed = computeDecisionWithMeta(index, candidatePrevPos);
                        const productionDecision = computed.decision;
                        let decision = productionDecision;
                        const currentMarketMatches = productionDecision?.market?.label === weakMarketRule.marketLabel;
                        const currentStrengthMatches = productionDecision?.targetStrength?.tier === weakMarketRule.targetStrengthTier;
                        const previousConfirmed = previousCandidateDecision?.market?.label === weakMarketRule.marketLabel
                            && previousCandidateDecision?.targetStrength?.tier === weakMarketRule.targetStrengthTier;
                        const positionGateMatches = candidatePrevPos === weakMarketRule.requiredPreviousPosition
                            && productionDecision?.position === weakMarketRule.requiredPreviousPosition;
                        const productionGateMatches = productionDecision?.marketGate?.type === 'increase-capped'
                            && Number(productionDecision.marketGate.cap) === weakMarketRule.requireProductionIncreaseCap;
                        const targetMatches = capturedTargetPosition === weakMarketRule.productionTargetPosition;
                        const eligible = (!weakMarketRule.stocksOnly || __symbol.mode === 'stock')
                            && currentMarketMatches && currentStrengthMatches && previousConfirmed
                            && positionGateMatches && productionGateMatches && targetMatches;
                        if (__symbol.mode !== 'stock' && currentMarketMatches && currentStrengthMatches) {
                            diagnostics.weakMarketConfirmed80RejectedNotStock++;
                        } else if (__symbol.mode === 'stock' && candidatePrevPos === weakMarketRule.requiredPreviousPosition
                            && currentMarketMatches && currentStrengthMatches && !previousConfirmed) {
                            diagnostics.weakMarketConfirmed80RejectedNoPrevious++;
                        } else if (__symbol.mode === 'stock' && currentMarketMatches && currentStrengthMatches
                            && candidatePrevPos === weakMarketRule.requiredPreviousPosition && !targetMatches) {
                            diagnostics.weakMarketConfirmed80RejectedTargetMismatch++;
                        }
                        if (eligible) {
                            diagnostics.weakMarketConfirmed80Eligible++;
                            decision = {
                                ...productionDecision,
                                position: weakMarketRule.allowedPosition,
                                marketGate: {
                                    ...productionDecision.marketGate,
                                    position: weakMarketRule.allowedPosition,
                                    applied: false,
                                    type: 'open',
                                    cap: weakMarketRule.allowedPosition,
                                    detail: '连续两日标的独立走强确认，候选恢复至' + weakMarketRule.allowedPosition + '%'
                                },
                                simpleAction: '顺势加仓',
                                simpleColorClass: 'text-bull',
                                positionDriver: (productionDecision.positionDriver || '')
                                    + (productionDecision.positionDriver ? '；' : '')
                                    + '连续两日独立走强，弱市门禁候选恢复至' + weakMarketRule.allowedPosition + '%',
                                weakMarketConfirmed80: {
                                    applied: true,
                                    sourcePosition: productionDecision.position,
                                    targetPosition: capturedTargetPosition,
                                    previousConfirmed: true,
                                    productionGateType: productionDecision.marketGate?.type || '',
                                    productionGateCap: Number.isFinite(Number(productionDecision.marketGate?.cap))
                                        ? Number(productionDecision.marketGate.cap)
                                        : null,
                                    marketLabel: productionDecision.market?.label || '',
                                    targetStrengthTier: productionDecision.targetStrength?.tier || ''
                                }
                            };
                            diagnostics.weakMarketConfirmed80Applied++;
                        } else {
                            decision = {
                                ...productionDecision,
                                weakMarketConfirmed80: {
                                    applied: false,
                                    sourcePosition: productionDecision.position,
                                    targetPosition: capturedTargetPosition,
                                    previousConfirmed,
                                    productionGateType: productionDecision.marketGate?.type || '',
                                    productionGateCap: Number.isFinite(Number(productionDecision.marketGate?.cap))
                                        ? Number(productionDecision.marketGate.cap)
                                        : null,
                                    marketLabel: productionDecision.market?.label || '',
                                    targetStrengthTier: productionDecision.targetStrength?.tier || ''
                                }
                            };
                        }
                        if (decision.bsMark !== productionDecision.bsMark) diagnostics.weakMarketConfirmed80BsDrift++;
                        full[index]._candidateMeta = computed.meta;
                        full[index]._candidateTargetPosition = capturedTargetPosition;
                        full[index]._candidateMarketGate = capturedMarketGate;
                        full[index]._decision = decision;
                        previousCandidateDecision = decision;
                        candidatePrevPos = decision.position;
                    }
                } finally {
                    applyMarketRiskGate = baseApplyMarketRiskGate;
                }
            } else if (rule) {
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
                    const computed = computeDecisionWithMeta(index, prevPos);
                    full[index]._decision = computed.decision;
                    full[index]._candidateMeta = computed.meta;
                    previousDecision = full[index]._decision;
                    prevPos = previousDecision.position;
                }
            } else if (__symbol.trialEntryScoreGroupGate) {
                const gate = __symbol.trialEntryScoreGroupGate;
                const productionDecisions = __symbol.controlDecisionRows;
                if (!Array.isArray(productionDecisions) || productionDecisions.length !== full.length) {
                    throw new Error('trial entry gate requires matching production control rows');
                }

                const isTrialEntry = decision => decision?.prevAdv === 0
                    && decision?.position === gate.position
                    && decision?.bsMark === 'B'
                    && decision?.signalReady === gate.requireSignalReady;
                const blockTrialEntry = (decision, groupKeys, reason, sourceDate = '') => ({
                    ...decision,
                    basePosition: 0,
                    position: 0,
                    marketGate: { ...decision.marketGate, position: 0 },
                    positionDriver: (decision.positionDriver || '') + (decision.positionDriver ? '；' : '') + '候选试探仓准入未通过',
                    simpleAction: '持币观望',
                    simpleColorClass: 'text-dim',
                    bsMark: null,
                    trialEntryGate: {
                        status: reason,
                        groupKeys,
                        groupCount: groupKeys.length,
                        sourceDate
                    }
                });
                const pendingTrialSources = [];
                let candidatePrevPos = 0;
                for (let index = 0; index < full.length; index++) {
                    const rawSignalsBefore = [...(full[index]._signals || [])];
                    full[index]._strategy = state.strategy;
                    const computed = computeDecisionWithMeta(index, candidatePrevPos);
                    let decision = computed.decision;
                    const meta = computed.meta;
                    full[index]._candidateMeta = meta;
                    const groupKeys = [...new Set((meta.windowScoreSignals || []).map(item => item.groupKey).filter(Boolean))];
                    const productionTrialEntry = isTrialEntry(productionDecisions[index]);
                    const candidateTrialEntry = isTrialEntry(decision);
                    const candidateNewB = decision?.bsMark === 'B' && !candidateTrialEntry;
                    const isEligiblePath = (!gate.stocksOnly || __symbol.mode === 'stock') && candidatePrevPos === 0;

                    if (isEligiblePath && candidateTrialEntry) {
                        diagnostics.trialGateEvaluated++;
                        const hasTwoGroups = groupKeys.length >= gate.minGroups;
                        if (!hasTwoGroups) {
                            if (productionTrialEntry) pendingTrialSources.push({ date: full[index].date, groupKeys });
                            decision = blockTrialEntry(decision, groupKeys, 'filtered_single_group');
                            diagnostics.trialGateFilteredSingleGroup++;
                        } else if (productionTrialEntry) {
                            decision = {
                                ...decision,
                                trialEntryGate: { status: 'allowed_two_groups', groupKeys, groupCount: groupKeys.length, sourceDate: full[index].date }
                            };
                            diagnostics.trialGateAllowedTwoGroups++;
                        } else if (pendingTrialSources.length > 0) {
                            const source = pendingTrialSources.shift();
                            decision = {
                                ...decision,
                                trialEntryGate: { status: 'deferred_two_groups', groupKeys, groupCount: groupKeys.length, sourceDate: source.date }
                            };
                            diagnostics.trialGateDeferredEntries++;
                        } else {
                            decision = blockTrialEntry(decision, groupKeys, 'blocked_unattributed_trial_b');
                            diagnostics.trialGateBlockedUnattributedB++;
                        }
                    } else if (isEligiblePath && candidateNewB) {
                        decision = blockTrialEntry(decision, groupKeys, 'blocked_unattributed_b');
                        diagnostics.trialGateBlockedUnattributedB++;
                    } else if (candidatePrevPos > 0 && (candidateTrialEntry || candidateNewB)) {
                        diagnostics.trialGateAppliedAtExistingPosition++;
                    }

                    if (JSON.stringify(rawSignalsBefore) !== JSON.stringify(full[index]._signals || [])) {
                        diagnostics.trialGateRawSignalMismatches++;
                    }
                    if ((!gate.stocksOnly || __symbol.mode === 'stock') && decision?.bsMark === 'B' && !decision?.trialEntryGate) {
                        diagnostics.trialGateCandidateBWithoutSource++;
                    }
                    full[index]._decision = decision;
                    candidatePrevPos = decision.position;
                }
            } else {
                derivedIndicatorCache.clear();
                let prevPos = 0;
                for (let index = 0; index < full.length; index++) {
                    full[index]._strategy = state.strategy;
                    const computed = computeDecisionWithMeta(index, prevPos);
                    full[index]._decision = computed.decision;
                    full[index]._candidateMeta = computed.meta;
                    prevPos = computed.decision.position;
                }
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
                const meta = row._candidateMeta || getSignalMeta(index, full, state.indicators);
                const novice = __symbol.includeNoviceDetails ? getNoviceDecisionSummary(meta, row._decision) : {};
                return {
                    ...basic,
                    rawSignals: [...(row._candidateOriginalSignals || row._signals || [])],
                    activeBuySignals: [...(meta.buySignals || [])],
                    windowBuySignals: (meta.windowSignals || []).filter(item => item.signal.startsWith('B')).map(item => item.signal),
                    windowScoreGroupKeys: [...new Set((meta.windowScoreSignals || []).map(item => item.groupKey).filter(Boolean))],
                    windowScore: meta.windowScore || 0,
                    signalReady: !!row._decision?.signalReady,
                    basePosition: Number.isFinite(Number(row._decision?.basePosition)) ? Number(row._decision.basePosition) : null,
                    productionTargetPosition: Number.isFinite(Number(row._candidateTargetPosition)) ? Number(row._candidateTargetPosition) : null,
                    marketLabel: row._decision?.market?.label || '',
                    targetStrengthTier: row._decision?.targetStrength?.tier || '',
                    marketGateType: row._decision?.marketGate?.type || '',
                    marketGateCap: Number.isFinite(Number(row._decision?.marketGate?.cap)) ? Number(row._decision.marketGate.cap) : null,
                    weakMarketConfirmed80: row._decision?.weakMarketConfirmed80 || null,
                    waveRejectionProtection: row._decision?.waveRejectionProtection || null,
                    waveTrialReentry: row._decision?.waveTrialReentry || null,
                    waveSameDayRepairConfirmationEntry: row._decision?.waveSameDayRepairConfirmationEntry || null,
                    waveL10TrendHandoffWarning: row._decision?.waveL10TrendHandoffWarning || null,
                    waveMA20TrendDefense: row._decision?.waveMA20TrendDefense || null,
                    waveL10HighReclaimReentry: row._decision?.waveL10HighReclaimReentry || null,
                    waveTrendPositionRecovery: row._decision?.waveTrendPositionRecovery || null,
                    waveIndependentTrendRecovery: row._decision?.waveIndependentTrendRecovery || null,
                    waveFailedShortTradeReentryLock: row._decision?.waveFailedShortTradeReentryLock || null,
                    prevAdv: row._decision?.prevAdv || 0,
                    trialEntryGate: row._decision?.trialEntryGate || null,
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

function loadSymbols(baseline, references = null) {
    const reference = references || baseline.strategies['稳健趋势型'].symbolsDetail;
    return reference.map(row => ({
        ...row,
        tags: row.tags || [],
        rows: readJson(path.join(ROOT, '.local', 'strategy-cache', row.cacheFile))
    }));
}

function alignSymbolsToCurrentSnapshot(symbols) {
    const lastDates = symbols.map(symbol => symbol.rows.at(-1)?.date).filter(Boolean).sort();
    const commonAsOf = lastDates[0] || '';
    if (!commonAsOf) throw new Error('当前候选样本缺少可用的确认截止日');
    const aligned = symbols.map(symbol => ({
        ...symbol,
        rows: symbol.rows.filter(item => item.date <= commonAsOf)
    }));
    if (aligned.some(symbol => symbol.rows.length < 140)) throw new Error('当前候选样本在共同截止日前历史不足');
    return { symbols: aligned, commonAsOf };
}

function buildCurrentDataSnapshot(symbols, commonAsOf) {
    const files = symbols.map(symbol => ({
        id: symbol.id,
        file: symbol.cacheFile,
        sha256: hashFile(path.join(ROOT, '.local', 'strategy-cache', symbol.cacheFile)),
        usedRowsHash: stableHash(symbol.rows),
        rows: symbol.rows.length,
        first: symbol.rows[0]?.date || '',
        last: symbol.rows.at(-1)?.date || ''
    }));
    return {
        commonAsOf,
        hash: stableHash(files.map(file => ({ id: file.id, usedRowsHash: file.usedRowsHash }))),
        files
    };
}

function selectSymbols(symbols) {
    const scopeFlags = [screenMode, fullMode, requestedSymbolIds.length > 0];
    if (scopeFlags.filter(Boolean).length !== 1) {
        throw new Error('候选实验需要且只能指定一个范围：--screen、--full 或 --symbols');
    }
    if (!requestedStrategy) throw new Error('候选实验需要显式指定 --strategy');
    if ((screenMode || requestedSymbolIds.length > 0) && !requestedVariant) {
        throw new Error('快速筛选需要显式指定 --variant，避免一次运行全部候选');
    }
    if (screenMode && requestedSymbolIds.length > 0) throw new Error('--screen 不得与 --symbols 同时使用');
    if (fullMode && requestedSymbolIds.length > 0) throw new Error('--full 不得与 --symbols 同时使用');
    if (screenMode) return symbols.filter(symbol => symbol.mode === 'index' || symbol.phase === 'seed');
    if (requestedSymbolIds.length > 0) {
        const known = new Set(symbols.map(symbol => symbol.id));
        const unknown = requestedSymbolIds.filter(id => !known.has(id));
        if (unknown.length) throw new Error(`unknown symbols: ${unknown.join(',')}`);
        return symbols.filter(symbol => requestedSymbolIds.includes(symbol.id));
    }
    return symbols;
}

function scopeForSymbols(symbols) {
    const firstDates = symbols.map(symbol => symbol.rows[0]?.date).filter(Boolean).sort();
    const lastDates = symbols.map(symbol => symbol.rows.at(-1)?.date).filter(Boolean).sort();
    return {
        symbols: symbols.length,
        indices: symbols.filter(symbol => symbol.mode === 'index').length,
        stocks: symbols.filter(symbol => symbol.mode === 'stock').length,
        dateRange: { first: firstDates[0] || '', last: lastDates.at(-1) || '' }
    };
}

function assertBaselineCompatibility(baselineReport, symbols, context) {
    const expectedBaselinePolicyHash = stableHash(getBaselinePolicyContract(VALIDATION_POLICY));
    const runtime = JSON.parse(vm.runInContext('JSON.stringify({ appBuild: APP_BUILD, signalVersion: SIGNAL_VERSION })', context));
    for (const symbol of symbols) {
        const cachePath = path.join(ROOT, '.local', 'strategy-cache', symbol.cacheFile);
        if (!fs.existsSync(cachePath)) throw new Error(`候选样本缓存不存在：${symbol.id}`);
    }
    return {
        ...runtime,
        baselinePolicyHash: expectedBaselinePolicyHash,
        compatibilityMode: 'current-production-control-selected-snapshot'
    };
}

function getCandidateDefinition(strategy) {
    const primary = CANDIDATES[strategy];
    if (!primary) throw new Error(`unknown formal strategy: ${strategy}`);
    if (!requestedCandidateId || primary.id === requestedCandidateId) return primary;
    const alternative = (primary.alternatives || []).find(item => item.id === requestedCandidateId);
    if (!alternative) throw new Error(`candidateId 与策略不一致：${requestedCandidateId}`);
    return alternative;
}

function getCandidateVariants(candidate) {
    if (candidate.variant) {
        const allowed = new Set([candidate.control?.id, candidate.variant.id].filter(Boolean));
        if (requestedVariant && !allowed.has(requestedVariant)) throw new Error(`unknown candidate variant: ${requestedVariant}`);
        return [candidate.control || { id: 'retain_production_control', label: '保留当前生产配置', collectDecisionDetails: true }, candidate.variant];
    }
    if (!Array.isArray(candidate.ablations) || !candidate.ablations.length) {
        if (requestedVariant && requestedVariant !== candidate.id) throw new Error(`unknown candidate variant: ${requestedVariant}`);
        return [candidate];
    }
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

function buildVariantResult(variantRows, controlRows, candidateClass = 'performance') {
    const summaryControl = summarizeRows(controlRows);
    const summaryVariant = summarizeRows(variantRows);
    const cohorts = {};
    for (const cohort of ['stocks', 'phase2', 'stress', 'highVolatility', 'technology', 'defensive', 'cyclical']) {
        const baselineCohort = controlRows.filter(row => matchesCohort(row, cohort));
        const variantCohort = variantRows.filter(row => matchesCohort(row, cohort));
        const baselineSummary = summarizeRows(baselineCohort);
        const variantSummary = summarizeRows(variantCohort);
        cohorts[cohort] = {
            baseline: baselineSummary,
            variant: variantSummary,
            delta: subtract(variantSummary, baselineSummary)
        };
    }
    const result = {
        variant: summaryVariant,
        delta: subtract(summaryVariant, summaryControl),
        cohorts,
        symbolDeltas: variantRows.map(row => {
            const base = controlRows.find(item => item.id === row.id);
            return {
                id: row.id,
                name: row.name,
                mode: row.mode,
                phase: row.phase,
                tags: row.tags,
                delta: subtract(summarizeRows([row]), summarizeRows([base]))
            };
        }),
        affectedDecisions: countAffectedDecisionDays(controlRows, variantRows)
    };
    const temporalIds = Object.keys(controlRows[0]?.temporal || {});
    result.temporal = Object.fromEntries(temporalIds.map(id => {
        const baseline = summarizeNested(controlRows, 'temporal', id);
        const variant = summarizeNested(variantRows, 'temporal', id);
        return [id, { baseline, variant, delta: subtract(variant, baseline) }];
    }));
    const stressScenarioId = VALIDATION_POLICY.gates.stress.scenarioId;
    const stressBaseline = summarizeNested(controlRows, 'scenarios', stressScenarioId);
    const stressVariant = summarizeNested(variantRows, 'scenarios', stressScenarioId);
    result.costStress = {
        scenarioId: stressScenarioId,
        baseline: stressBaseline,
        variant: stressVariant,
        delta: subtract(stressVariant, stressBaseline)
    };
    result.evaluation = screenMode
        ? evaluateCandidateScreen({
            candidateClass,
            policy: VALIDATION_POLICY,
            overallDelta: result.delta,
            affectedDecisionDays: result.affectedDecisions.total
        })
        : evaluateCandidateGates({
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
    result.evaluation.statusLabel = formatCandidateStatus(result.evaluation.status);
    return result;
}

function withScreenResult(result) {
    if (!screenMode) return result;
    const affectedDecisionDays = result.affectedDecisions?.total || 0;
    return {
        ...result,
        screen: {
            status: result.evaluation?.status || 'insufficient_evidence',
            statusLabel: result.evaluation?.statusLabel || formatCandidateStatus(result.evaluation?.status),
            affectedDecisionDays,
            reason: result.evaluation?.status === 'continue_full'
                ? 'candidate_passed_screen_guardrails'
                : (result.evaluation?.status === 'ready_for_product_review'
                    ? 'candidate_ready_for_product_review'
                : (result.evaluation?.status === 'reject'
                    ? 'candidate_failed_screen_guardrails'
                    : 'candidate_did_not_change_screen_decisions')),
            checks: result.evaluation?.checks || []
        }
    };
}

function screenOutput(report, reportPath) {
    const results = [];
    for (const [strategy, experiment] of Object.entries(report.experiments || {})) {
        if (experiment.ablations) {
            for (const [variantId, result] of Object.entries(experiment.ablations)) {
                results.push({
                    strategy,
                    candidateId: experiment.candidate.id,
                    variantId,
                    status: result.screen?.statusLabel || formatCandidateStatus(result.screen?.status),
                    statusCode: result.screen?.status || 'insufficient_evidence',
                    affectedDecisionDays: result.screen?.affectedDecisionDays || 0,
                    delta: result.delta
                });
            }
        } else {
            results.push({
                strategy,
                    candidateId: experiment.candidate.id,
                    variantId: experiment.candidate.id,
                    status: experiment.screen?.statusLabel || formatCandidateStatus(experiment.screen?.status),
                    statusCode: experiment.screen?.status || 'insufficient_evidence',
                affectedDecisionDays: experiment.screen?.affectedDecisionDays || 0,
                delta: experiment.delta
            });
        }
    }
    console.log(JSON.stringify({
        reportPath: path.relative(ROOT, reportPath),
        timing: report.timing,
        selection: report.selection,
        scope: report.scope,
        results
    }, null, 2));
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

function buildWaveCandidateEventSamples(controlRows, candidateRows, eventField, limit = 60) {
    const samples = [];
    const bySymbol = [];
    let changedDays = 0;
    let eventDays = 0;
    let bsDriftDays = 0;
    let indexDriftDays = 0;
    let firstEntryDriftDays = 0;
    const forwardReturn = (rows, index, horizon) => {
        const end = index + horizon;
        const entryClose = Number(rows[index]?.close);
        const endClose = Number(rows[end]?.close);
        return end < rows.length && entryClose > 0 && endClose > 0 ? round(endClose / entryClose - 1) : null;
    };
    for (const candidateSymbol of candidateRows) {
        const controlSymbol = controlRows.find(row => row.id === candidateSymbol.id);
        if (!controlSymbol) throw new Error(`missing wave candidate control symbol: ${candidateSymbol.id}`);
        const rows = candidateSymbol.decisionRows || [];
        const controlDecisionRows = controlSymbol.decisionRows || [];
        let symbolChangedDays = 0;
        let symbolBsDriftDays = 0;
        let symbolFirstEntryDriftDays = 0;
        for (let index = START_INDEX; index < rows.length; index++) {
            const control = controlDecisionRows[index];
            const candidate = rows[index];
            if (!control || !candidate) continue;
            const positionChanged = Number(control.position) !== Number(candidate.position);
            const bsChanged = (control.bsMark || null) !== (candidate.bsMark || null);
            if (!positionChanged && !bsChanged) continue;
            changedDays++;
            symbolChangedDays++;
            if (bsChanged) bsDriftDays++;
            if (bsChanged) symbolBsDriftDays++;
            if (candidateSymbol.mode !== 'stock') indexDriftDays++;
            if (Number(control.position) === 0 && Number(candidate.position) > 0) {
                firstEntryDriftDays++;
                symbolFirstEntryDriftDays++;
            }
            const event = candidate[eventField] || null;
            if (event) eventDays++;
            if (samples.length >= limit) continue;
            samples.push({
                id: candidateSymbol.id,
                name: candidateSymbol.name,
                mode: candidateSymbol.mode,
                date: candidate.date,
                controlPosition: Number(control.position) || 0,
                candidatePosition: Number(candidate.position) || 0,
                controlBsMark: control.bsMark || null,
                candidateBsMark: candidate.bsMark || null,
                rawSignals: candidate.rawSignals || [],
                activeBuySignals: candidate.activeBuySignals || [],
                windowScore: Number(candidate.windowScore) || 0,
                marketLabel: candidate.marketLabel || '',
                event,
                forwardReturns: {
                    d5: forwardReturn(rows, index, 5),
                    d10: forwardReturn(rows, index, 10),
                    d20: forwardReturn(rows, index, 20)
                }
            });
        }
        bySymbol.push({
            id: candidateSymbol.id,
            name: candidateSymbol.name,
            mode: candidateSymbol.mode,
            changedDays: symbolChangedDays,
            bsDriftDays: symbolBsDriftDays,
            firstEntryDriftDays: symbolFirstEntryDriftDays
        });
    }
    return { changedDays, eventDays, bsDriftDays, indexDriftDays, firstEntryDriftDays, bySymbol, samples };
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

function buildWaveTrialTwoGroupPreflight(controlRows, candidateRows, candidateId) {
    const summary = {
        candidateId,
        symbols: candidateRows.length,
        productionTrialEntries: 0,
        productionSingleGroupTrialEntries: 0,
        productionTwoGroupTrialEntries: 0,
        singleGroupScoreAtLeastFour: 0,
        filteredSingleGroupTrialEntries: 0,
        allowedTwoGroupTrialEntries: 0,
        deferredTwoGroupTrialEntries: 0,
        rawSignalMismatches: 0,
        candidateBWithoutOriginalTrial: 0,
        gateAppliedAtExistingPosition: 0,
        violations: []
    };

    for (const candidateSymbol of candidateRows) {
        const controlSymbol = controlRows.find(row => row.id === candidateSymbol.id);
        if (!controlSymbol) throw new Error(`missing wave two-group control symbol: ${candidateSymbol.id}`);
        if (candidateSymbol.mode !== 'stock') continue;
        for (let index = START_INDEX; index < candidateSymbol.decisionRows.length; index++) {
            const control = controlSymbol.decisionRows[index];
            const candidate = candidateSymbol.decisionRows[index];
            if (!control || !candidate) continue;
            if (JSON.stringify(control.rawSignals || []) !== JSON.stringify(candidate.rawSignals || [])) {
                summary.rawSignalMismatches++;
            }
            const controlTrial = isTrialEntry(control) && controlSymbol.mode === 'stock';
            const groupCount = (control.windowScoreGroupKeys || []).length;
            if (controlTrial) {
                summary.productionTrialEntries++;
                if (groupCount < 2) {
                    summary.productionSingleGroupTrialEntries++;
                    if (control.windowScore >= 4) summary.singleGroupScoreAtLeastFour++;
                    if (candidate.position !== 0 || candidate.bsMark === 'B') {
                        summary.violations.push({ id: candidateSymbol.id, date: candidate.date, type: 'single_group_trial_not_filtered' });
                    } else {
                        summary.filteredSingleGroupTrialEntries++;
                    }
                } else {
                    summary.productionTwoGroupTrialEntries++;
                    if (candidate.trialEntryGate?.status === 'allowed_two_groups') summary.allowedTwoGroupTrialEntries++;
                }
            }
            if (candidate.trialEntryGate?.status === 'deferred_two_groups') summary.deferredTwoGroupTrialEntries++;
            if (candidate.bsMark === 'B' && !['allowed_two_groups', 'deferred_two_groups'].includes(candidate.trialEntryGate?.status)) {
                summary.candidateBWithoutOriginalTrial++;
                summary.violations.push({ id: candidateSymbol.id, date: candidate.date, type: 'candidate_b_without_original_trial' });
            }
        }
    }
    return summary;
}

function buildWaveRejectionProtectionPreflight(controlRows, candidateRows, diagnostics = {}, requiredEventType = '') {
    const summary = {
        symbols: candidateRows.length,
        triggerEvents: 0,
        exitEvents: 0,
        reduceEvents: 0,
        lockBlockedDays: 0,
        increaseBlockedNoFreshSignalDays: 0,
        increaseBlockedRiskSignalDays: 0,
        changedDecisionDays: 0,
        changedSymbols: 0,
        changesWithoutTriggerDays: 0,
        indexDriftDays: 0,
        diagnosticsTriggerMismatch: 0,
        samples: [],
        violations: []
    };
    for (const candidateSymbol of candidateRows) {
        const controlSymbol = controlRows.find(row => row.id === candidateSymbol.id);
        if (!controlSymbol) throw new Error(`missing wave rejection control symbol: ${candidateSymbol.id}`);
        let hasPriorTrigger = false;
        let symbolChanged = false;
        for (let index = START_INDEX; index < candidateSymbol.decisionRows.length; index++) {
            const candidate = candidateSymbol.decisionRows[index];
            const control = controlSymbol.decisionRows[index];
            if (!candidate || !control) continue;
            const event = candidate.waveRejectionProtection;
            const eventMatches = event && (!requiredEventType || event.eventType === requiredEventType);
            const isTriggerEvent = eventMatches && ['rejection_triggered', 'triggered'].includes(event.status);
            if (isTriggerEvent) hasPriorTrigger = true;
            const decisionChanged = candidate.position !== control.position
                || candidate.bsMark !== control.bsMark
                || candidate.simpleAction !== control.simpleAction;
            if (decisionChanged) {
                summary.changedDecisionDays++;
                symbolChanged = true;
                if (!hasPriorTrigger) summary.changesWithoutTriggerDays++;
            }
            if (candidateSymbol.mode === 'index'
                && (candidate.position !== control.position || candidate.bsMark !== control.bsMark || candidate.simpleAction !== control.simpleAction)) {
                summary.indexDriftDays++;
                if (summary.violations.length < 30) summary.violations.push({
                    id: candidateSymbol.id,
                    date: candidate.date,
                    type: 'index_decision_drift',
                    controlPosition: control.position,
                    candidatePosition: candidate.position
                });
            }
            if (!eventMatches) continue;
            if (isTriggerEvent) {
                summary.triggerEvents++;
                if (event.targetPosition === 0) summary.exitEvents++;
                else summary.reduceEvents++;
                const transitionMatches = Number(candidate.prevAdv) === Number(event.sourcePosition)
                    && Number(candidate.position) === Number(event.targetPosition);
                const markerMatches = Number(event.targetPosition) === 0 ? candidate.bsMark === 'S' : candidate.bsMark !== 'S';
                if (candidateSymbol.mode !== 'stock' || !transitionMatches || !markerMatches) {
                    if (summary.violations.length < 30) summary.violations.push({
                        id: candidateSymbol.id,
                        date: candidate.date,
                        type: 'invalid_rejection_transition',
                        mode: candidateSymbol.mode,
                        sourcePosition: event.sourcePosition,
                        targetPosition: event.targetPosition,
                        candidatePosition: candidate.position,
                        bsMark: candidate.bsMark
                    });
                }
                if (summary.samples.length < 20) summary.samples.push({
                    id: candidateSymbol.id,
                    name: candidateSymbol.name,
                    date: candidate.date,
                    from: event.sourcePosition,
                    to: event.targetPosition,
                    profitRatio: round(event.profitRatio ?? event.closeProfitRatio),
                    intradayProfitRatio: round(event.intradayProfitRatio),
                    givebackRatio: round(event.givebackRatio),
                    volumeRatio: round(event.volumeRatio),
                    upperShadowBodyRatio: round(event.upperShadowBodyRatio),
                    upperShadowRangeRatio: round(event.upperShadowRangeRatio),
                    closeLocation: round(event.closeLocation)
                });
            } else if (event.status === 'reentry_locked') summary.lockBlockedDays++;
            else if (event.status === 'increase_blocked_no_fresh_signal') summary.increaseBlockedNoFreshSignalDays++;
            else if (event.status === 'increase_blocked_risk_signal') summary.increaseBlockedRiskSignalDays++;
        }
        if (symbolChanged) summary.changedSymbols++;
    }
    const diagnosticsTriggers = requiredEventType === 'fresh_entry_failure'
        ? Number(diagnostics.waveFreshEntryTriggered || 0)
        : Number(diagnostics.waveRejectionTriggered || 0);
    summary.diagnosticsTriggerMismatch = summary.triggerEvents === diagnosticsTriggers ? 0 : 1;
    if (summary.diagnosticsTriggerMismatch) summary.violations.push({
        type: 'diagnostics_trigger_mismatch',
        preflight: summary.triggerEvents,
        diagnostics: diagnosticsTriggers
    });
    return summary;
}

function buildWeakMarketConfirmed80Preflight(controlRows, candidateRows, diagnostics = {}) {
    const indexIds = new Set(INDEX_IDS);
    const summary = {
        symbols: candidateRows.length,
        appliedEvents: 0,
        appliedSamples: [],
        bsDriftDays: 0,
        indexDriftDays: 0,
        firstEntryDriftDays: 0,
        unauthorizedUpgradeDays: 0,
        diagnosticsAppliedMismatch: 0,
        violations: []
    };
    const addViolation = (candidateSymbol, candidate, type, detail = {}) => {
        const item = { id: candidateSymbol.id, date: candidate?.date || '', type, ...detail };
        if (summary.violations.length < 30) summary.violations.push(item);
    };

    for (const candidateSymbol of candidateRows) {
        const controlSymbol = controlRows.find(row => row.id === candidateSymbol.id);
        if (!controlSymbol) throw new Error(`missing weak-market control symbol: ${candidateSymbol.id}`);
        const candidateDecisions = candidateSymbol.decisionRows || [];
        const controlDecisions = controlSymbol.decisionRows || [];
        for (let index = START_INDEX; index < candidateDecisions.length; index++) {
            const candidate = candidateDecisions[index];
            const control = controlDecisions[index];
            const previousCandidate = candidateDecisions[index - 1];
            if (!candidate || !control) continue;

            if (candidate.bsMark !== control.bsMark) {
                summary.bsDriftDays++;
                addViolation(candidateSymbol, candidate, 'bs_drift', { control: control.bsMark, candidate: candidate.bsMark });
            }
            if (indexIds.has(candidateSymbol.id)
                && (candidate.position !== control.position
                    || candidate.bsMark !== control.bsMark
                    || candidate.simpleAction !== control.simpleAction)) {
                summary.indexDriftDays++;
                addViolation(candidateSymbol, candidate, 'index_decision_drift', {
                    controlPosition: control.position,
                    candidatePosition: candidate.position
                });
            }
            if ((candidate.prevAdv === 0 || control.prevAdv === 0) && candidate.position !== control.position) {
                summary.firstEntryDriftDays++;
                addViolation(candidateSymbol, candidate, 'first_entry_drift', {
                    controlPosition: control.position,
                    candidatePosition: candidate.position
                });
            }

            const event = candidate.weakMarketConfirmed80;
            if (!event?.applied) {
                const isNewUpgrade = candidate.position > control.position
                    && Number(candidate.prevAdv) <= 50
                    && Number(previousCandidate?.position) <= 50;
                if (isNewUpgrade) {
                    summary.unauthorizedUpgradeDays++;
                    addViolation(candidateSymbol, candidate, 'upgrade_without_applied_event', {
                        controlPosition: control.position,
                        candidatePosition: candidate.position,
                        previousPosition: previousCandidate?.position
                    });
                }
                continue;
            }

            summary.appliedEvents++;
            const checks = {
                stock: candidateSymbol.mode === 'stock' && !indexIds.has(candidateSymbol.id),
                transition: Number(candidate.prevAdv) === 50 && Number(previousCandidate?.position) === 50
                    && Number(event.sourcePosition) === 50 && Number(candidate.position) === 80,
                currentMarket: candidate.marketLabel === '核心宽基偏弱',
                previousMarket: previousCandidate?.marketLabel === '核心宽基偏弱',
                currentStrength: candidate.targetStrengthTier === 'independent',
                previousStrength: previousCandidate?.targetStrengthTier === 'independent',
                target: Number(candidate.productionTargetPosition) === 80 && Number(event.targetPosition) === 80,
                productionGate: event.productionGateType === 'increase-capped' && Number(event.productionGateCap) === 50,
                candidateGate: candidate.marketGateType === 'open' && Number(candidate.marketGateCap) === 80,
                bsStable: candidate.bsMark === control.bsMark
            };
            const failedChecks = Object.entries(checks).filter(([, pass]) => !pass).map(([name]) => name);
            const sample = {
                id: candidateSymbol.id,
                date: candidate.date,
                from: candidate.prevAdv,
                to: candidate.position,
                previousMarket: previousCandidate?.marketLabel || '',
                currentMarket: candidate.marketLabel,
                previousStrength: previousCandidate?.targetStrengthTier || '',
                currentStrength: candidate.targetStrengthTier,
                productionTarget: candidate.productionTargetPosition,
                productionGateCap: event.productionGateCap,
                candidateGateCap: candidate.marketGateCap
            };
            if (summary.appliedSamples.length < 20) summary.appliedSamples.push(sample);
            if (failedChecks.length) addViolation(candidateSymbol, candidate, 'invalid_applied_event', { failedChecks, sample });
        }
    }

    summary.diagnosticsAppliedMismatch = summary.appliedEvents === Number(diagnostics.weakMarketConfirmed80Applied || 0) ? 0 : 1;
    if (summary.diagnosticsAppliedMismatch) {
        summary.violations.push({
            type: 'diagnostics_applied_mismatch',
            preflight: summary.appliedEvents,
            diagnostics: Number(diagnostics.weakMarketConfirmed80Applied || 0)
        });
    }
    return summary;
}

function main() {
    const startedAtMs = Date.now();
    const startedAt = new Date(startedAtMs).toISOString();
    const baselinePath = latestBaselinePath();
    const baselineReport = readJson(baselinePath);
    const symbolReferences = baselineReport.strategies['稳健趋势型'].symbolsDetail.map(symbol => ({ ...symbol, tags: symbol.tags || [] }));
    const selectedReferences = selectSymbols(symbolReferences);
    const strategies = requestedStrategy ? [requestedStrategy] : Object.keys(CANDIDATES);
    if (strategies.some(strategy => !CANDIDATES[strategy])) throw new Error(`unknown formal strategy: ${requestedStrategy}`);
    if (requestedCandidateId && !requestedStrategy) throw new Error('使用 --candidate 时必须同时指定 --strategy');
    const candidateByStrategy = Object.fromEntries(strategies.map(strategy => [strategy, getCandidateDefinition(strategy)]));
    const candidateVariantsByStrategy = Object.fromEntries(
        strategies.map(strategy => [strategy, getCandidateVariants(candidateByStrategy[strategy])])
    );
    const stockOnlyScreen = screenMode && strategies.every(strategy => {
        const controlId = candidateByStrategy[strategy].control?.id;
        const activeVariants = candidateVariantsByStrategy[strategy].filter(variant => variant.id !== controlId);
        return activeVariants.length > 0 && activeVariants.every(variant => variant.trialEntryScoreGroupGate?.stocksOnly);
    });
    const runReferences = stockOnlyScreen ? selectedReferences.filter(symbol => symbol.mode === 'stock') : selectedReferences;
    const indexReferences = symbolReferences.filter(symbol => symbol.mode === 'index');
    const compatibilityReferences = [...new Map([...runReferences, ...indexReferences].map(symbol => [symbol.id, symbol])).values()];
    const currentSnapshot = alignSymbolsToCurrentSnapshot(loadSymbols(baselineReport, compatibilityReferences));
    const loadedSymbols = currentSnapshot.symbols;
    const runIds = new Set(runReferences.map(symbol => symbol.id));
    const symbols = loadedSymbols.filter(symbol => runIds.has(symbol.id));
    const indexSymbols = loadedSymbols.filter(symbol => symbol.mode === 'index');
    const indexData = Object.fromEntries(indexSymbols.map(symbol => [symbol.id, symbol.rows]));
    if (Object.keys(indexData).length !== INDEX_IDS.length) throw new Error('missing full index cache for candidate lab');
    const referenceId = VALIDATION_POLICY.temporalWindows.referenceIndex;
    const temporalWindows = buildCalendarWindows(indexData[referenceId] || [], VALIDATION_POLICY);
    if (temporalWindows.length !== VALIDATION_POLICY.temporalWindows.count) {
        throw new Error('current selected snapshot is missing sustainable temporal windows');
    }
    const compatibilitySymbols = [...new Map([...symbols, ...indexSymbols].map(symbol => [symbol.id, symbol])).values()];
    const context = createContext(indexData);
    const runtime = assertBaselineCompatibility(baselineReport, compatibilitySymbols, context);
    const dataSnapshot = buildCurrentDataSnapshot(compatibilitySymbols, currentSnapshot.commonAsOf);
    const experiments = {};

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
                skippedAtNonTrialPosition: 0,
                trialGateEvaluated: 0,
                trialGateFilteredSingleGroup: 0,
                trialGateAllowedTwoGroups: 0,
                trialGateDeferredEntries: 0,
                trialGateBlockedUnattributedB: 0,
                trialGateAppliedAtExistingPosition: 0,
                trialGateCandidateBWithoutSource: 0,
                trialGateRawSignalMismatches: 0,
                weakMarketConfirmed80Eligible: 0,
                weakMarketConfirmed80Applied: 0,
                weakMarketConfirmed80RejectedNoPrevious: 0,
                weakMarketConfirmed80RejectedNotStock: 0,
                weakMarketConfirmed80RejectedTargetMismatch: 0,
                weakMarketConfirmed80BsDrift: 0,
                waveRejectionEvaluated: 0,
                waveRejectionTriggered: 0,
                waveRejectionExited: 0,
                waveRejectionReduced: 0,
                waveReentryLockBlocked: 0,
                waveReentryLockReleased: 0,
                waveIncreaseBlockedNoFreshSignal: 0,
                waveIncreaseBlockedRiskSignal: 0,
                waveRecoveryPositionCapped: 0,
                waveRejectionIndexDrift: 0,
                waveFreshEntryEvaluated: 0,
                waveFreshEntryTriggered: 0,
                waveFreshEntryExited: 0,
                waveFreshEntryReduced: 0,
                waveFreshEntryIndexDrift: 0,
                waveL10HandoffEvaluated: 0,
                waveL10HandoffApplied: 0,
                waveL10HandoffIndexDrift: 0,
                waveMA20TrendDefenseEligible: 0,
                waveMA20TrendDefenseApplied: 0,
                waveMA20TrendDefenseTakenOver: 0,
                waveMA20TrendDefenseExpired: 0,
                waveMA20TrendDefenseInvalidB: 0,
                waveMA20TrendDefenseIndexDrift: 0,
                waveL10ReentryArmed: 0,
                waveL10ReentryReclaimed: 0,
                waveL10ReentryConfirmed: 0,
                waveL10ReentryMissed: 0,
                waveL10ReentryIndexDrift: 0,
                waveFailedTrialReentryArmed: 0,
                waveFailedTrialReentryRepairObserved: 0,
                waveFailedTrialReentryConfirmed: 0,
                waveFailedTrialReentryHoldDays: 0,
                waveFailedTrialReentryCanceledLowerLow: 0,
                waveFailedTrialReentryCanceledSignal: 0,
                waveFailedTrialReentryExpired: 0,
                waveFailedTrialReentryIndexDrift: 0,
                waveSameDayEntryEligible: 0,
                waveSameDayEntryConfirmed: 0,
                waveSameDayEntryIndexDrift: 0,
                waveSameDayEntryInvalidB: 0,
                waveTrendPositionRecoveryEligible: 0,
                waveTrendPositionRecoveryApplied: 0,
                waveTrendPositionRecoveryMarketBlocked: 0,
                waveTrendPositionRecoveryBsDrift: 0,
                waveTrendPositionRecoveryIndexDrift: 0,
                waveFailedShortTradeLockArmed: 0,
                waveFailedShortTradeReentryBlocked: 0,
                waveFailedShortTradeLockBypassed: 0,
                waveFailedShortTradeLockExpired: 0,
                waveFailedShortTradeInvalidB: 0,
                waveFailedShortTradeIndexDrift: 0
                ,waveIndependentTrendRecoveryEligible: 0,
                waveIndependentTrendRecoveryApplied: 0,
                waveIndependentTrendRecoveryMarketBlocked: 0,
                waveIndependentTrendRecoveryBsDrift: 0,
                waveIndependentTrendRecoveryIndexDrift: 0
            };
        }
    }
    for (const [symbolIndex, symbol] of symbols.entries()) {
        const prepared = prepareRawSignals(context, symbol);
        for (const strategy of strategies) {
            const candidate = candidateByStrategy[strategy];
            let controlDecisionRows = null;
            for (const variant of candidateVariantsByStrategy[strategy]) {
                const signalOccurrences = signalOccurrencesByStrategy[strategy][variant.id];
                for (const signals of prepared.rawSignals) {
                    for (const signal of variant.removeBuySignals || []) {
                        if (signals.includes(signal)) signalOccurrences[signal]++;
                    }
                }
                const canReuseUnaffectedControl = variant.trialEntryScoreGroupGate?.stocksOnly
                    && symbol.mode !== 'stock'
                    && controlDecisionRows;
                const result = canReuseUnaffectedControl
                    ? { rows: controlDecisionRows, candidateDiagnostics: {} }
                    : runCandidate(context, symbol, strategy, prepared, variant, controlDecisionRows);
                const rows = result.rows;
                if (variant.id === candidate.control?.id) controlDecisionRows = rows;
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
        const candidate = candidateByStrategy[strategy];
        const candidateClass = candidate.candidateClass || 'performance';
        const controlId = candidate.control?.id || (candidate.ablations ? 'retain_production_control' : candidateVariantsByStrategy[strategy][0].id);
        const controlRows = variantRowsByStrategy[strategy][controlId];
        const summaryBaseline = summarizeRows(controlRows);
        const evaluationPolicyHash = stableHash(VALIDATION_POLICY.gates);
        const candidateSummary = {
            id: candidate.id,
            question: candidate.question,
            type: candidate.type,
            candidateClass,
            revisionOf: candidate.revisionOf || null,
            revisionMode: candidate.revisionMode || null,
            failedEvidence: candidate.failedEvidence || '',
            removedMechanisms: candidate.removedMechanisms || [],
            preservedNumericParameters: candidate.preservedNumericParameters || null,
            hash: stableHash({ candidate, signalVersion: runtime.signalVersion, baselinePolicyHash: runtime.baselinePolicyHash, evaluationPolicyHash })
        };
        if (candidate.variant) {
            const variant = candidate.variant;
            const variantRows = variantRowsByStrategy[strategy][variant.id];
            const diagnostics = diagnosticsByStrategy[strategy][variant.id];
            const weakMarketConfirmed80Preflight = buildWeakMarketConfirmed80Preflight(controlRows, variantRows, diagnostics);
            if (weakMarketConfirmed80Preflight.violations.length > 0
                || weakMarketConfirmed80Preflight.bsDriftDays > 0
                || weakMarketConfirmed80Preflight.indexDriftDays > 0
                || weakMarketConfirmed80Preflight.firstEntryDriftDays > 0
                || weakMarketConfirmed80Preflight.unauthorizedUpgradeDays > 0
                || weakMarketConfirmed80Preflight.diagnosticsAppliedMismatch > 0) {
                throw new Error('弱市连续确认80%候选越过了股票50%→80%、首次建仓、指数或B/S边界');
            }
            experiments[strategy] = {
                candidate: candidateSummary,
                baseline: summaryBaseline,
                candidateDiagnostics: diagnostics,
                weakMarketConfirmed80Preflight,
                control: {
                    id: candidate.control?.id || 'retain_production_control',
                    label: candidate.control?.label || '保留当前生产配置'
                },
                ...withScreenResult(buildVariantResult(
                    variantRows,
                    controlRows,
                    candidateClass
                ))
            };
        } else if (candidate.ablations) {
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
                    hash: stableHash({ candidateId: candidate.id, variant, signalVersion: runtime.signalVersion, evaluationPolicyHash }),
                    signalOccurrences: signalOccurrencesByStrategy[strategy][variant.id],
                    candidateDiagnostics: diagnosticsByStrategy[strategy][variant.id],
                    ...withScreenResult(buildVariantResult(variantRowsByStrategy[strategy][variant.id], controlRows, candidateClass))
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
            const trialEntryGateVariant = candidate.ablations?.find(item => item.trialEntryScoreGroupGate);
            if (trialEntryGateVariant && (!requestedVariant || trialEntryGateVariant.id === requestedVariant)) {
                const preflight = buildWaveTrialTwoGroupPreflight(
                    controlRows,
                    variantRowsByStrategy[strategy][trialEntryGateVariant.id],
                    trialEntryGateVariant.id
                );
                const diagnostics = diagnosticsByStrategy[strategy][trialEntryGateVariant.id];
                if (preflight.rawSignalMismatches > 0 || preflight.candidateBWithoutOriginalTrial > 0 || preflight.violations.length > 0
                    || diagnostics.trialGateRawSignalMismatches > 0 || diagnostics.trialGateCandidateBWithoutSource > 0
                    || diagnostics.trialGateAppliedAtExistingPosition > 0) {
                    throw new Error('波段双分组试探仓候选越过了“仅过滤/推迟原有试探 B”的边界');
                }
                experiments[strategy].waveTrialTwoGroupPreflight = preflight;
            }
            const waveRejectionVariant = candidate.ablations?.find(item => item.waveRejectionProtection);
            if (waveRejectionVariant && (!requestedVariant || waveRejectionVariant.id === requestedVariant)) {
                const diagnostics = diagnosticsByStrategy[strategy][waveRejectionVariant.id];
                const preflight = buildWaveRejectionProtectionPreflight(
                    controlRows,
                    variantRowsByStrategy[strategy][waveRejectionVariant.id],
                    diagnostics
                );
                const isEventLocalRevision = waveRejectionVariant.waveRejectionProtection.lockMode === 'event-local-recovery';
                const eventLocalBoundaryViolated = isEventLocalRevision
                    && (preflight.changesWithoutTriggerDays > 0
                        || preflight.increaseBlockedNoFreshSignalDays > 0
                        || preflight.increaseBlockedRiskSignalDays > 0
                        || diagnostics.waveIncreaseBlockedNoFreshSignal > 0
                        || diagnostics.waveIncreaseBlockedRiskSignal > 0);
                if (preflight.indexDriftDays > 0 || preflight.diagnosticsTriggerMismatch > 0
                    || diagnostics.waveRejectionIndexDrift > 0 || preflight.violations.length > 0
                    || eventLocalBoundaryViolated) {
                    throw new Error('波段冲高回落候选越过了“只改个股分档止盈、再入锁和加仓确认”的边界');
                }
                experiments[strategy].waveRejectionProtectionPreflight = preflight;
            }
            const waveFreshEntryVariant = candidate.ablations?.find(item => item.waveFreshEntryFailureProtection);
            if (waveFreshEntryVariant && (!requestedVariant || waveFreshEntryVariant.id === requestedVariant)) {
                const diagnostics = diagnosticsByStrategy[strategy][waveFreshEntryVariant.id];
                const preflight = buildWaveRejectionProtectionPreflight(
                    controlRows,
                    variantRowsByStrategy[strategy][waveFreshEntryVariant.id],
                    diagnostics,
                    'fresh_entry_failure'
                );
                if (preflight.indexDriftDays > 0 || preflight.diagnosticsTriggerMismatch > 0
                    || diagnostics.waveFreshEntryIndexDrift > 0 || preflight.violations.length > 0
                    || preflight.changesWithoutTriggerDays > 0) {
                    throw new Error('波段新仓失败候选越过了“只改首次B后两日压力冲高失败及事件局部恢复”的边界');
                }
                experiments[strategy].waveFreshEntryFailurePreflight = preflight;
            }
            const waveSameDayEntryVariant = candidate.ablations?.find(item => item.waveSameDayRepairConfirmationEntry);
            if (waveSameDayEntryVariant && (!requestedVariant || waveSameDayEntryVariant.id === requestedVariant)) {
                const diagnostics = diagnosticsByStrategy[strategy][waveSameDayEntryVariant.id];
                const preflight = {
                    eligible: Number(diagnostics.waveSameDayEntryEligible || 0),
                    confirmed: Number(diagnostics.waveSameDayEntryConfirmed || 0),
                    indexDrift: Number(diagnostics.waveSameDayEntryIndexDrift || 0),
                    invalidCandidateB: Number(diagnostics.waveSameDayEntryInvalidB || 0)
                };
                if (preflight.indexDrift > 0 || preflight.invalidCandidateB > 0 || preflight.confirmed > preflight.eligible) {
                    throw new Error('波段同日修复确认候选越过了“仅个股空仓日同日双归因新增B”的边界');
                }
                experiments[strategy].waveSameDayEntryPreflight = preflight;
            }
            const waveTrendPositionRecoveryVariant = candidate.ablations?.find(item => item.waveTrendPositionRecovery);
            if (waveTrendPositionRecoveryVariant && (!requestedVariant || waveTrendPositionRecoveryVariant.id === requestedVariant)) {
                const diagnostics = diagnosticsByStrategy[strategy][waveTrendPositionRecoveryVariant.id];
                const preflight = buildWaveCandidateEventSamples(
                    controlRows,
                    variantRowsByStrategy[strategy][waveTrendPositionRecoveryVariant.id],
                    'waveTrendPositionRecovery'
                );
                if (preflight.bsDriftDays > 0 || preflight.indexDriftDays > 0 || preflight.firstEntryDriftDays > 0
                    || Number(diagnostics.waveTrendPositionRecoveryBsDrift || 0) > 0
                    || Number(diagnostics.waveTrendPositionRecoveryIndexDrift || 0) > 0) {
                    throw new Error('波段趋势仓位恢复候选越过了“只改已有个股低仓、不新增B/S”的边界');
                }
                experiments[strategy].waveTrendPositionRecoveryPreflight = preflight;
            }
            const waveIndependentTrendRecoveryVariant = candidate.ablations?.find(item => item.waveIndependentTrendRecovery);
            if (waveIndependentTrendRecoveryVariant && (!requestedVariant || requestedVariant === waveIndependentTrendRecoveryVariant.id)) {
                const diagnostics = diagnosticsByStrategy[strategy][waveIndependentTrendRecoveryVariant.id];
                const preflight = buildWaveCandidateEventSamples(
                    controlRows,
                    variantRowsByStrategy[strategy][waveIndependentTrendRecoveryVariant.id],
                    'waveIndependentTrendRecovery'
                );
                if (preflight.bsDriftDays > 0 || preflight.indexDriftDays > 0 || preflight.firstEntryDriftDays > 0
                    || Number(diagnostics.waveIndependentTrendRecoveryBsDrift || 0) > 0
                    || Number(diagnostics.waveIndependentTrendRecoveryIndexDrift || 0) > 0) {
                    throw new Error(`波段独立趋势恢复候选越过了“只改已有个股低仓、不新增B/S”的边界：${JSON.stringify({
                        bsDriftDays: preflight.bsDriftDays,
                        indexDriftDays: preflight.indexDriftDays,
                        firstEntryDriftDays: preflight.firstEntryDriftDays,
                        bySymbol: preflight.bySymbol,
                        diagnosticBsDrift: diagnostics.waveIndependentTrendRecoveryBsDrift,
                        diagnosticIndexDrift: diagnostics.waveIndependentTrendRecoveryIndexDrift
                    })}`);
                }
                experiments[strategy].waveIndependentTrendRecoveryPreflight = preflight;
            }
            const waveFailedShortTradeLockVariant = candidate.ablations?.find(item => item.waveFailedShortTradeReentryLock);
            if (waveFailedShortTradeLockVariant && (!requestedVariant || waveFailedShortTradeLockVariant.id === requestedVariant)) {
                const diagnostics = diagnosticsByStrategy[strategy][waveFailedShortTradeLockVariant.id];
                const preflight = buildWaveCandidateEventSamples(
                    controlRows,
                    variantRowsByStrategy[strategy][waveFailedShortTradeLockVariant.id],
                    'waveFailedShortTradeReentryLock'
                );
                if (preflight.indexDriftDays > 0 || Number(diagnostics.waveFailedShortTradeInvalidB || 0) > 0
                    || Number(diagnostics.waveFailedShortTradeIndexDrift || 0) > 0) {
                    throw new Error('波段失败短交易锁候选越过了“只删除个股旧证据B、不新增B”的边界');
                }
                experiments[strategy].waveFailedShortTradeReentryLockPreflight = preflight;
            }
        } else {
            const variant = candidateVariantsByStrategy[strategy][0];
            experiments[strategy] = {
                candidate: candidateSummary,
                candidateDiagnostics: diagnosticsByStrategy[strategy][variant.id],
                baseline: summaryBaseline,
                ...withScreenResult(buildVariantResult(variantRowsByStrategy[strategy][variant.id], controlRows, candidateClass))
            };
        }
    }

    const completedAt = new Date().toISOString();
    const report = {
        generatedAt: completedAt,
        timing: {
            startedAt,
            completedAt,
            durationMs: Date.now() - startedAtMs
        },
        method: 'production-js-vm-local-candidate-lab',
        baselineReport: path.relative(ROOT, baselinePath),
        appBuild: runtime.appBuild,
        signalVersion: runtime.signalVersion,
        validationPolicy: {
            ...baselineReport.validationPolicy,
            baselinePolicyHash: runtime.baselinePolicyHash,
            evaluationPolicyHash: stableHash(VALIDATION_POLICY.gates),
            compatibilityMode: runtime.compatibilityMode
        },
        dataSnapshot,
        scope: scopeForSymbols(symbols),
        coverage: {
            stocks: { total: baselineReport.coverage?.stocks?.total || 0, cached: symbols.filter(symbol => symbol.mode === 'stock').length },
            indices: { total: INDEX_IDS.length, cached: indexSymbols.length }
        },
        selection: {
            mode: screenMode ? 'screen' : (fullMode ? 'full' : 'symbols'),
            strategy: requestedStrategy,
            candidateId: candidateByStrategy[requestedStrategy].id,
            variantId: requestedVariant || null,
            revisionOf: candidateByStrategy[requestedStrategy].revisionOf || null,
            revisionMode: candidateByStrategy[requestedStrategy].revisionMode || null,
            evidenceUse: candidateByStrategy[requestedStrategy].revisionMode === 'same_snapshot_structural_revision'
                ? 'exploratory_screen_only_requires_non_seed_holdout'
                : 'standard',
            symbols: symbols.map(symbol => symbol.id),
            contextSymbols: indexSymbols.filter(symbol => !symbols.some(item => item.id === symbol.id)).map(symbol => symbol.id),
            loadedSymbols: compatibilitySymbols.map(symbol => symbol.id),
            dataHash: dataSnapshot.hash
        },
        experiments
    };
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
    const reportPath = path.join(REPORT_DIR, `formal-strategy-candidate-lab-${stamp}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    if (screenMode) return screenOutput(report, reportPath);
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
