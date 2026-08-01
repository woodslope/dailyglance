#!/usr/bin/env node

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const REPORT_DIR = path.join(ROOT, '.local', 'strategy-reports');
const STRATEGIES = ['稳健趋势型', '波段抄底型', '突破追涨型', '综合全能型'];

if (!process.argv.includes('--reuse-latest')) {
    execFileSync(process.execPath, ['scripts/strategy-formal-baseline.js'], {
        cwd: ROOT,
        stdio: 'inherit'
    });
}

const latest = fs.readdirSync(REPORT_DIR)
    .filter(file => /^formal-strategy-baseline-.*\.json$/.test(file))
    .map(file => ({ file, modifiedAt: fs.statSync(path.join(REPORT_DIR, file)).mtimeMs }))
    .sort((left, right) => right.modifiedAt - left.modifiedAt)[0];

if (!latest) throw new Error('正式策略横向基线没有生成报告');

const report = JSON.parse(fs.readFileSync(path.join(REPORT_DIR, latest.file), 'utf8'));
if (report.method !== 'production-js-vm-local-cache') throw new Error('报告未使用生产策略 VM 基线');
if (report.scope?.stocks < 1 || report.scope?.indices !== 8 || report.scope.indices !== report.coverage?.indices?.cached) {
    throw new Error('报告未覆盖完整缓存范围');
}
if (report.coverage?.stocks?.cached !== report.scope.stocks) throw new Error('报告股票覆盖统计不一致');

for (const strategy of STRATEGIES) {
    const summary = report.strategies?.[strategy];
    if (!summary) throw new Error(`缺少策略：${strategy}`);
    if (summary.symbols !== report.scope.symbols) throw new Error(`${strategy} 标的覆盖不完整`);
    if (!Number.isFinite(summary.performance?.avgStrategyRet)) throw new Error(`${strategy} 缺少平均策略收益`);
    if (!Number.isFinite(summary.performance?.avgBenchmarkRet)) throw new Error(`${strategy} 缺少同标的买入持有基准收益`);
    if (!Number.isFinite(summary.performance?.avgExcessRet)) throw new Error(`${strategy} 缺少相对基准超额收益`);
    if (!Number.isFinite(summary.performance?.medianStrategyRet)) throw new Error(`${strategy} 缺少收益中位数`);
    if (!Number.isFinite(summary.performance?.avgAnnualizedReturn)) throw new Error(`${strategy} 缺少年化收益`);
    if (!Number.isFinite(summary.performance?.avgMaxDrawdown)) throw new Error(`${strategy} 缺少平均最大回撤`);
    if (!Number.isFinite(summary.performance?.avgBenchmarkMaxDrawdown)) throw new Error(`${strategy} 缺少基准最大回撤`);
    if (!Number.isFinite(summary.performance?.avgExpectancy)) throw new Error(`${strategy} 缺少单笔期望`);
    if (!Number.isInteger(summary.bs?.b) || !Number.isInteger(summary.bs?.s)) throw new Error(`${strategy} 缺少 B/S 统计`);
    if (!Number.isFinite(summary.holding?.ratio)) throw new Error(`${strategy} 缺少持仓比例`);
    if (!Array.isArray(summary.symbolsDetail) || summary.symbolsDetail.length !== report.scope.symbols) {
        throw new Error(`${strategy} 缺少分标的同样本结果`);
    }
    if (summary.cohorts?.stocks?.symbols !== report.scope.stocks) throw new Error(`${strategy} 缺少股票样本分层统计`);
    if (summary.cohorts?.indices?.symbols !== report.scope.indices) throw new Error(`${strategy} 缺少指数样本分层统计`);
    if (!summary.cohorts?.byPhase?.seed || !summary.cohorts?.byPhase?.phase1) {
        throw new Error(`${strategy} 缺少 seed/phase1 分层统计`);
    }
    if (!summary.cohorts?.byPhase?.phase2) throw new Error(`${strategy} 缺少 phase2 分层统计`);
    if (!summary.cohorts?.byTag?.stress || !summary.cohorts?.byTag?.highVolatility) {
        throw new Error(`${strategy} 缺少压力和高波动样本分层统计`);
    }
    if (Object.keys(summary.temporal || {}).length !== 3) throw new Error(`${strategy} 缺少三段时间稳健性窗口`);
    if (!summary.scenarios?.cost_020 || !summary.scenarios?.delay_one_bar) throw new Error(`${strategy} 缺少成本或延迟成交压力测试`);
}

if (!report.dataSnapshot?.hash || !report.dataSnapshot?.commonAsOf) throw new Error('正式基线缺少可追踪数据快照');
if (report.validationPolicy?.temporalWindows?.length !== 3) throw new Error('正式基线缺少验证政策窗口');

console.log(`正式策略横向基线报告契约通过：${latest.file}`);
