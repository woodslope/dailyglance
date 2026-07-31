#!/usr/bin/env node

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const REPORT_DIR = path.join(ROOT, '.local', 'strategy-reports');
const STRATEGIES = ['稳健趋势型', '波段抄底型', '突破追涨型', '综合全能型'];
const strategyArgIndex = process.argv.indexOf('--strategy');
const requestedStrategy = strategyArgIndex >= 0 ? process.argv[strategyArgIndex + 1] || '' : '';
const EXPECTED_CANDIDATES = {
    '稳健趋势型': 'formal_trend_signal_ablation',
    '波段抄底型': 'formal_wave_repair_signal_ablation',
    '突破追涨型': 'baseline_retained',
    '综合全能型': 'formal_buy_signal_ablation'
};
const EXPECTED_WAVE_SIGNAL_ABLATIONS = {
    wave_drop_b9_signal: ['B9'],
    wave_drop_b16_signal: ['B16'],
    wave_drop_b17_signal: ['B17']
};
const EXPECTED_TREND_SIGNAL_ABLATIONS = {
    drop_b1_signal: ['B1'],
    drop_b10_signal: ['B10'],
    drop_b13_signal: ['B13'],
    drop_b15_signal: ['B15']
};
const EXPECTED_COMPOSITE_GROUP_ABLATIONS = {
    drop_trend_group: ['B1', 'B10', 'B15'],
    drop_macd_group: ['B2', 'B12'],
    drop_b3_group: ['B3'],
    drop_breakout_group: ['B4', 'B14'],
    drop_repair_group: ['B5', 'B6', 'B11', 'B16'],
    drop_b7_group: ['B7'],
    drop_b9_group: ['B9'],
    drop_b17_group: ['B17']
};
const EXPECTED_COMPOSITE_SIGNAL_ABLATIONS = {
    drop_b1_signal: ['B1'],
    drop_b2_signal: ['B2'],
    drop_b3_group: ['B3'],
    drop_b4_signal: ['B4'],
    drop_b5_signal: ['B5'],
    drop_b6_signal: ['B6'],
    drop_b7_group: ['B7'],
    drop_b9_group: ['B9'],
    drop_b10_signal: ['B10'],
    drop_b11_signal: ['B11'],
    drop_b12_signal: ['B12'],
    drop_b14_signal: ['B14'],
    drop_b15_signal: ['B15'],
    drop_b16_signal: ['B16'],
    drop_b17_group: ['B17']
};
const EXPECTED_COMPOSITE_BUY_SIGNALS = [
    'B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B9', 'B10', 'B11', 'B12', 'B14', 'B15', 'B16', 'B17'
];

const source = fs.readFileSync(path.join(ROOT, 'scripts', 'strategy-formal-candidate-lab.js'), 'utf8');
for (const candidateId of Object.values(EXPECTED_CANDIDATES)) {
    if (!source.includes(`id: '${candidateId}'`)) throw new Error(`候选实验缺少当前研究问题：${candidateId}`);
}
const expectedCompositeAblationIds = new Set([
    ...Object.keys(EXPECTED_COMPOSITE_GROUP_ABLATIONS),
    ...Object.keys(EXPECTED_COMPOSITE_SIGNAL_ABLATIONS)
]);
const expectedAblationIds = new Set([
    ...expectedCompositeAblationIds,
    ...Object.keys(EXPECTED_TREND_SIGNAL_ABLATIONS),
    ...Object.keys(EXPECTED_WAVE_SIGNAL_ABLATIONS)
]);
for (const ablationId of expectedAblationIds) {
    if (!source.includes(`id: '${ablationId}'`)) throw new Error(`综合全能缺少生产信号组：${ablationId}`);
}
if (!source.includes("type: 'buy-signal-ablation'")) throw new Error('综合全能消融类型没有覆盖组级与单信号');
if (!source.includes('signalOccurrences')) throw new Error('综合全能消融缺少原始信号触发次数');
if (!source.includes('retain_production_control') || !source.includes('b15Preflight')) {
    throw new Error('稳健趋势缺少 B15 生产前逐日对照');
}
if (!source.includes('b15MarkerQuality')) throw new Error('稳健趋势缺少 B15 标记质量后验');

const strategies = requestedStrategy ? [requestedStrategy] : STRATEGIES;
if (strategies.some(strategy => !STRATEGIES.includes(strategy))) throw new Error(`未知正式策略：${requestedStrategy}`);

let latestReportFile = '';
for (const strategy of strategies) {
    execFileSync(process.execPath, ['scripts/strategy-formal-candidate-lab.js', '--strategy', strategy], {
        cwd: ROOT,
        stdio: 'ignore'
    });
    const latest = fs.readdirSync(REPORT_DIR)
        .filter(file => /^formal-strategy-candidate-lab-.*\.json$/.test(file))
        .map(file => ({ file, modifiedAt: fs.statSync(path.join(REPORT_DIR, file)).mtimeMs }))
        .sort((left, right) => right.modifiedAt - left.modifiedAt)[0];
    if (!latest) throw new Error(`${strategy} 候选实验没有生成报告`);
    latestReportFile = latest.file;
    const report = JSON.parse(fs.readFileSync(path.join(REPORT_DIR, latest.file), 'utf8'));
    if (report.method !== 'production-js-vm-local-candidate-lab') throw new Error('候选实验未使用生产 VM 决策链');
    if (report.scope?.stocks < 1 || report.scope?.indices !== 8) throw new Error('候选实验未覆盖完整缓存范围');
    const experiment = report.experiments?.[strategy];
    if (!experiment?.candidate?.id || !experiment?.candidate?.question) throw new Error(`${strategy} 缺少候选定义`);
    if (experiment.candidate.id !== EXPECTED_CANDIDATES[strategy]) {
        throw new Error(`${strategy} 候选不是当前研究问题：${experiment.candidate.id}`);
    }
    if (!experiment.candidate.hash || !experiment.candidate.candidateClass) throw new Error(`${strategy} 缺少冻结候选哈希或候选类别`);
    if (strategy === '稳健趋势型') {
        if (experiment.candidate.type !== 'buy-signal-ablation') {
            throw new Error('稳健趋势候选必须是生产趋势信号消融');
        }
        const ablations = experiment.ablations || {};
        if (Object.keys(ablations).length !== Object.keys(EXPECTED_TREND_SIGNAL_ABLATIONS).length) {
            throw new Error('稳健趋势没有完整输出四个趋势信号消融');
        }
        for (const [ablationId, removedSignals] of Object.entries(EXPECTED_TREND_SIGNAL_ABLATIONS)) {
            const ablation = ablations[ablationId];
            if (!ablation || JSON.stringify(ablation.removedSignals) !== JSON.stringify(removedSignals)) {
                throw new Error(`${ablationId} 不符合当前稳健趋势生产信号`);
            }
            for (const signal of removedSignals) {
                if (!Number.isInteger(ablation.signalOccurrences?.[signal]) || ablation.signalOccurrences[signal] < 1) {
                    throw new Error(`${ablationId} 缺少 ${signal} 的原始触发覆盖`);
                }
            }
            if (!Number.isFinite(ablation.delta?.avgStrategyRet) || !Number.isFinite(ablation.delta?.avgMaxDrawdown)) {
                throw new Error(`${ablationId} 缺少整体收益或回撤差分`);
            }
            if (!Number.isInteger(ablation.delta?.bs?.b) || !Number.isInteger(ablation.delta?.bs?.s)) {
                throw new Error(`${ablationId} 缺少 B/S 差分`);
            }
            if (!ablation.evaluation?.status || !Number.isInteger(ablation.affectedDecisions?.total)) {
                throw new Error(`${ablationId} 缺少持续迭代准入结论`);
            }
            for (const cohort of ['stocks', 'phase2', 'stress']) {
                if (!ablation.cohorts?.[cohort]?.baseline || !ablation.cohorts?.[cohort]?.variant || !ablation.cohorts?.[cohort]?.delta) {
                    throw new Error(`${ablationId} 缺少 ${cohort} 分层差分`);
                }
            }
        }
        const preflight = experiment.b15Preflight;
        if (preflight?.controlId !== 'retain_production_control' || preflight?.candidateId !== 'drop_b15_signal') {
            throw new Error('稳健 B15 预检缺少生产控制组或候选组');
        }
        if (preflight.symbols !== report.scope.symbols || preflight.eligibleDays < 1 || preflight.changedSymbols < 1) {
            throw new Error('稳健 B15 预检没有覆盖完整样本或没有产生可观察差异');
        }
        if (preflight.rawB15Days?.control < 1 || preflight.rawB15Days.control !== preflight.rawB15Days.candidate) {
            throw new Error('稳健 B15 候选不得删除原始技术信号');
        }
        if (preflight.activeB15Days?.control < 1 || preflight.activeB15Days.candidate !== 0) {
            throw new Error('稳健 B15 候选没有从有效买入依据中移除 B15');
        }
        for (const field of [
            'windowScore', 'signalReady', 'position', 'bsMark', 'simpleAction', 'positionDriver',
            'noviceState', 'noviceAction', 'noviceReason', 'noviceInvalidCondition'
        ]) {
            if (!Number.isInteger(preflight.changedDays?.[field]) || preflight.changedDays[field] < 1) {
                throw new Error(`稳健 B15 预检缺少 ${field} 变化统计`);
            }
        }
        const quality = experiment.b15MarkerQuality;
        const categories = ['controlOnlyB', 'candidateOnlyB', 'controlOnlyS', 'candidateOnlyS', 'bToS'];
        if (!quality || quality.totalChangedEvents !== preflight.changedDays.bsMark) {
            throw new Error('稳健 B15 标记质量没有覆盖全部 B/S 变化');
        }
        const categoryEvents = categories.reduce((sum, category) => sum + (quality.categories?.[category]?.events || 0), 0);
        if (categoryEvents !== quality.totalChangedEvents) throw new Error('稳健 B15 五类标记变化没有完整分桶');
        for (const category of categories) {
            const stocks = quality.categories?.[category]?.stocks;
            if (!stocks || stocks.events < 1) throw new Error(`${category} 缺少股票后验样本`);
            for (const horizon of [5, 10, 20]) {
                const metrics = stocks.horizons?.[String(horizon)];
                if (!metrics || metrics.events < 1 || !Number.isFinite(metrics.avgForwardReturn) || !Number.isFinite(metrics.avgMaxAdverse) || !Number.isFinite(metrics.avgMaxFavorable)) {
                    throw new Error(`${category} 缺少 ${horizon} 日后验指标`);
                }
            }
        }
        continue;
    }
    if (strategy === '综合全能型') {
        if (experiment.candidate.type !== 'buy-signal-ablation') {
            throw new Error('综合全能候选必须覆盖已纳入买入信号的组级与单信号消融');
        }
        const ablations = experiment.ablations || {};
        if (Object.keys(ablations).length !== expectedCompositeAblationIds.size) {
            throw new Error('综合全能没有完整输出组级和单信号消融');
        }
        const coveredGroupSignals = Object.keys(EXPECTED_COMPOSITE_GROUP_ABLATIONS)
            .flatMap(id => ablations[id]?.removedSignals || [])
            .sort();
        const coveredIndividualSignals = Object.keys(EXPECTED_COMPOSITE_SIGNAL_ABLATIONS)
            .flatMap(id => ablations[id]?.removedSignals || [])
            .sort();
        const expectedSignals = [...EXPECTED_COMPOSITE_BUY_SIGNALS].sort();
        if (JSON.stringify(coveredGroupSignals) !== JSON.stringify(expectedSignals)) {
            throw new Error('综合全能组级消融没有恰好覆盖当前全部生产买入信号');
        }
        if (JSON.stringify(coveredIndividualSignals) !== JSON.stringify(expectedSignals)) {
            throw new Error('综合全能单信号消融没有恰好覆盖当前全部生产买入信号');
        }
        const expectedAblations = {
            ...EXPECTED_COMPOSITE_GROUP_ABLATIONS,
            ...EXPECTED_COMPOSITE_SIGNAL_ABLATIONS
        };
        for (const [ablationId, removedSignals] of Object.entries(expectedAblations)) {
            const ablation = ablations[ablationId];
            if (!ablation) throw new Error(`综合全能缺少消融项：${ablationId}`);
            if (JSON.stringify(ablation.removedSignals) !== JSON.stringify(removedSignals)) {
                throw new Error(`${ablationId} 移除信号不符合当前生产分组`);
            }
            for (const signal of removedSignals) {
                if (!Number.isInteger(ablation.signalOccurrences?.[signal]) || ablation.signalOccurrences[signal] < 1) {
                    throw new Error(`${ablationId} 缺少 ${signal} 的原始触发覆盖`);
                }
            }
            if (!Number.isFinite(ablation.variant?.performance?.avgMaxDrawdown)) {
                throw new Error(`${ablationId} 缺少候选回撤`);
            }
            if (!Number.isFinite(ablation.delta?.avgStrategyRet)) {
                throw new Error(`${ablationId} 缺少收益差分`);
            }
            if (!Number.isInteger(ablation.delta?.bs?.b) || !Number.isInteger(ablation.delta?.bs?.s)) {
                throw new Error(`${ablationId} 缺少 B/S 差分`);
            }
            for (const cohort of ['stocks', 'phase2', 'stress']) {
                if (!ablation.cohorts?.[cohort]?.baseline || !ablation.cohorts?.[cohort]?.variant || !ablation.cohorts?.[cohort]?.delta) {
                    throw new Error(`${ablationId} 缺少 ${cohort} 分层差分`);
                }
            }
        }
        continue;
    }
    if (strategy === '波段抄底型') {
        if (experiment.candidate.type !== 'buy-signal-ablation') {
            throw new Error('波段候选必须是生产修复信号消融');
        }
        const ablations = experiment.ablations || {};
        if (Object.keys(ablations).length !== Object.keys(EXPECTED_WAVE_SIGNAL_ABLATIONS).length) {
            throw new Error('波段候选没有完整输出 B9/B16/B17 消融');
        }
        const attribution = experiment.waveTrialAttribution;
        if (attribution?.controlId !== 'retain_wave_production_control' || attribution.controlTrialEntries?.stocks < 1) {
            throw new Error('波段候选缺少生产控制组或 30% 试探仓基线');
        }
        for (const [candidateId, removedSignals] of Object.entries(EXPECTED_WAVE_SIGNAL_ABLATIONS)) {
            const signal = removedSignals[0];
            const ablation = ablations[candidateId];
            const signalAttribution = attribution.signals?.[signal];
            if (!ablation || JSON.stringify(ablation.removedSignals) !== JSON.stringify(removedSignals)) {
                throw new Error(`${candidateId} 不符合当前波段生产信号`);
            }
            if (!Number.isInteger(ablation.signalOccurrences?.[signal]) || ablation.signalOccurrences[signal] < 1) {
                throw new Error(`${candidateId} 缺少 ${signal} 原始触发覆盖`);
            }
            if (!Number.isFinite(ablation.delta?.avgStrategyRet) || !Number.isFinite(ablation.delta?.avgMaxDrawdown)) {
                throw new Error(`${candidateId} 缺少整体收益或回撤差分`);
            }
            for (const cohort of ['stocks', 'phase2', 'stress']) {
                if (!ablation.cohorts?.[cohort]?.delta) throw new Error(`${candidateId} 缺少 ${cohort} 分层差分`);
            }
            if (signalAttribution?.candidateId !== candidateId) {
                throw new Error(`${candidateId} 缺少 ${signal} 试探仓归因`);
            }
            for (const field of ['removedTrialEntries', 'addedTrialEntries', 'positionChangedDays', 'bsChangedDays']) {
                if (!Number.isInteger(signalAttribution[field]) || signalAttribution[field] < 0) {
                    throw new Error(`${candidateId} 缺少 ${field} 统计`);
                }
            }
            const directTrialEvents = signalAttribution.trialEntriesWithSignal?.stocks || 0;
            const removedTrialEvents = signalAttribution.removedTrialEntries || 0;
            const addedTrialEvents = signalAttribution.addedTrialEntries || 0;
            const indirectTrialEvents = removedTrialEvents + addedTrialEvents;
            if (directTrialEvents < 1 && indirectTrialEvents < 1) {
                throw new Error(`${candidateId} 缺少 ${signal} 直接或间接试探仓影响`);
            }
            const qualitySources = [
                ['直接', directTrialEvents, signalAttribution.trialEntryQuality?.stocks],
                ['移除', removedTrialEvents, signalAttribution.removedTrialQuality?.stocks],
                ['新增', addedTrialEvents, signalAttribution.addedTrialQuality?.stocks]
            ].filter(([, events]) => events > 0);
            for (const [label, , quality] of qualitySources) {
                for (const horizon of [5, 10, 20]) {
                    const metrics = quality?.horizons?.[String(horizon)];
                    if (!metrics || metrics.events < 1 || !Number.isFinite(metrics.avgForwardReturn) || !Number.isFinite(metrics.avgMaxAdverse)) {
                        throw new Error(`${candidateId} 缺少${label}${horizon}日试探仓质量`);
                    }
                }
            }
        }
        continue;
    }
    if (!Number.isFinite(experiment.baseline?.performance?.avgStrategyRet)) throw new Error(`${strategy} 缺少基线收益`);
    if (!Number.isFinite(experiment.variant?.performance?.avgMaxDrawdown)) throw new Error(`${strategy} 缺少候选回撤`);
    if (!Number.isFinite(experiment.delta?.avgStrategyRet)) throw new Error(`${strategy} 缺少收益差分`);
    if (!Number.isInteger(experiment.delta?.bs?.b) || !Number.isInteger(experiment.delta?.bs?.s)) {
        throw new Error(`${strategy} 缺少 B/S 差分`);
    }
    for (const cohort of ['stocks', 'phase2', 'stress']) {
        if (!experiment.cohorts?.[cohort]?.baseline || !experiment.cohorts?.[cohort]?.variant || !experiment.cohorts?.[cohort]?.delta) {
            throw new Error(`${strategy} 缺少 ${cohort} 分层差分`);
        }
    }
}

if (/\bfetch\s*\(|https?:\/\//.test(source)) throw new Error('候选实验不得访问网络');

console.log(`正式策略候选实验报告契约通过：${latestReportFile}`);
