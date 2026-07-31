#!/usr/bin/env node

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const NODE = process.execPath;
const REPORT_DIR = path.join(ROOT, '.local', 'strategy-reports');
const EXPECTED_VARIANTS = [
    'baseline',
    'profit5_target50',
    'profit5_target60',
    'profit8_target50',
    'profit8_breakout50',
    'profit8_breakout50_ma20_guard'
];

execFileSync(NODE, ['scripts/strategy-baipang-main-wave-deep-dive.js'], {
    cwd: ROOT,
    stdio: 'inherit'
});

const latest = fs.readdirSync(REPORT_DIR)
    .filter(file => /^baipang-main-wave-deep-dive-.*\.json$/.test(file))
    .map(file => ({ file, modifiedAt: fs.statSync(path.join(REPORT_DIR, file)).mtimeMs }))
    .sort((left, right) => right.modifiedAt - left.modifiedAt)[0];

if (!latest) throw new Error('白胖主升仓位深挖没有生成报告');

const report = JSON.parse(fs.readFileSync(path.join(REPORT_DIR, latest.file), 'utf8'));
if (report.method !== 'candidate-js-vm-main-wave-position-layer') throw new Error('报告未使用候选研究 VM 主升仓位层');
if (report.scope?.stocks < 1) throw new Error('报告未覆盖股票缓存');

for (const id of EXPECTED_VARIANTS) {
    const variant = report.variants?.[id];
    if (!variant) throw new Error(`缺少主升仓位方案：${id}`);
    if (!variant.performance || !Number.isFinite(variant.performance.avgStrategyRet)) {
        throw new Error(`${id} 缺少收益统计`);
    }
    if (!variant.bs || !Number.isInteger(variant.bs.b) || !Number.isInteger(variant.bs.s)) {
        throw new Error(`${id} 缺少 B/S 统计`);
    }
}

if (report.variants.baseline.upgrades !== 0) throw new Error('基线不应产生主升加仓');
for (const id of EXPECTED_VARIANTS.slice(1)) {
    const variant = report.variants[id];
    if (variant.bs.b !== report.variants.baseline.bs.b || variant.bs.s !== report.variants.baseline.bs.s) {
        throw new Error(`${id} 不应改变白胖第一次 B/S`);
    }
    if (!report.comparison?.[id]) throw new Error(`${id} 缺少相对基线差分`);
}

console.log(`白胖主升仓位深挖报告契约通过：${latest.file}`);
