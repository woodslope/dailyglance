#!/usr/bin/env node

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const NODE = process.execPath;
const REPORT_DIR = path.join(ROOT, '.local', 'strategy-reports');
const EXPECTED_VARIANTS = ['baseline', 'relative_strength', 'above_ma20_ma60', 'not_long_term_downtrend', 'first_pullback_only', 'combined'];

execFileSync(NODE, ['scripts/strategy-baipang-b25-filter-deep-dive.js'], {
    cwd: ROOT,
    stdio: 'inherit'
});

const latest = fs.readdirSync(REPORT_DIR)
    .filter(file => /^baipang-b25-filter-deep-dive-.*\.json$/.test(file))
    .map(file => ({ file, modifiedAt: fs.statSync(path.join(REPORT_DIR, file)).mtimeMs }))
    .sort((left, right) => right.modifiedAt - left.modifiedAt)[0];

if (!latest) throw new Error('B25 过滤深挖没有生成报告');

const report = JSON.parse(fs.readFileSync(path.join(REPORT_DIR, latest.file), 'utf8'));
if (report.method !== 'candidate-js-vm-b25-signal-filter') throw new Error('报告未使用候选研究 VM 信号过滤链路');
if (report.scope?.stocks < 1) throw new Error('报告未覆盖任何股票缓存');

for (const variant of EXPECTED_VARIANTS) {
    const result = report.variants?.[variant];
    if (!result) throw new Error(`缺少过滤方案：${variant}`);
    if (!Number.isInteger(result.b25Raw) || !Number.isInteger(result.b25Retained) || !Number.isInteger(result.b25Filtered)) {
        throw new Error(`${variant} 缺少 B25 保留与过滤计数`);
    }
    if (result.b25Raw !== result.b25Retained + result.b25Filtered) {
        throw new Error(`${variant} 的 B25 计数不守恒`);
    }
    if (!result.performance || !Number.isFinite(result.performance.avgStrategyRet)) {
        throw new Error(`${variant} 缺少仓位链路收益统计`);
    }
    if (!result.bs || !Number.isInteger(result.bs.b) || !Number.isInteger(result.bs.s)) {
        throw new Error(`${variant} 缺少 B/S 统计`);
    }
}

if (report.variants.baseline.b25Filtered !== 0) throw new Error('基线方案不应过滤 B25');
if (!report.comparison?.combined) throw new Error('报告缺少组合方案对基线的差分');

console.log(`白胖 B25 过滤深挖报告契约通过：${latest.file}`);
