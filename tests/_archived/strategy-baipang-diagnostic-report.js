#!/usr/bin/env node

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const NODE = process.execPath;
const REPORT_DIR = path.join(ROOT, '.local', 'strategy-reports');

execFileSync(NODE, ['scripts/strategy-baipang-diagnostic.js'], {
    cwd: ROOT,
    stdio: 'inherit'
});

const latestReport = fs.readdirSync(REPORT_DIR)
    .filter(file => /^baipang-diagnostic-.*\.md$/.test(file))
    .map(file => ({ file, modifiedAt: fs.statSync(path.join(REPORT_DIR, file)).mtimeMs }))
    .sort((left, right) => right.modifiedAt - left.modifiedAt)[0];

if (!latestReport) throw new Error('诊断脚本没有生成 Markdown 报告');

const content = fs.readFileSync(path.join(REPORT_DIR, latestReport.file), 'utf8');
const reportJsonPath = path.join(REPORT_DIR, latestReport.file.replace(/\.md$/, '.json'));
const report = JSON.parse(fs.readFileSync(reportJsonPath, 'utf8'));
const phase1Coverage = report.coverage.stocks.byPhase.phase1;
const expectedPhase1Text = `phase1 已覆盖 ${phase1Coverage.cached}/${phase1Coverage.total}`;

if (!content.includes(expectedPhase1Text)) {
    throw new Error('报告没有反映当前 phase1 覆盖率');
}
if (content.includes('phase1 尚未开始')) {
    throw new Error('报告仍包含与当前缓存冲突的 phase1 静态结论');
}

const exitReasons = report.aggregate.sReasons;
if (!exitReasons) throw new Error('报告缺少主图 S 归零原因分类');
const reasonTotal = exitReasons.strongExit + exitReasons.cooldown + exitReasons.marketOrRisk + exitReasons.signalDecay + exitReasons.unknown;
if (reasonTotal !== report.aggregate.alignment.sTotal) {
    throw new Error('主图 S 归零原因没有完整覆盖');
}
if (exitReasons.unknown !== 0) throw new Error('主图 S 仍存在原因不明的归零');
if (!content.includes('## 主图 S 归零原因')) {
    throw new Error('Markdown 报告没有解释主图 S 的归零原因');
}

console.log(`白胖诊断报告覆盖率文案通过：${latestReport.file}`);
