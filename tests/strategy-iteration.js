#!/usr/bin/env node

const assert = require('assert');
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const policy = JSON.parse(fs.readFileSync(path.join(ROOT, 'strategy-validation-policy.json'), 'utf8'));
assert.strictEqual(policy.temporalWindows.count, 3);
assert.strictEqual(policy.temporalWindows.lengthTradingDays, 126);
assert.strictEqual(policy.costScenarios.find(item => item.id === 'standard').costRate, 0.001);
assert.ok(policy.costScenarios.some(item => item.id === 'delay_one_bar'));
assert.strictEqual(policy.waveBQuality.scope, 'stock');
assert.strictEqual(policy.waveBQuality.requireForwardValidation, true);
assert.deepStrictEqual(policy.waveBQuality.registeredRule.requiredSignals, ['B8', 'B17']);
assert.strictEqual(policy.waveBQuality.forwardValidation.minimumNewTradingDays, 20);
assert.strictEqual(policy.waveBQuality.forwardValidation.minimumMaturedBEvents, 30);
assert.strictEqual(policy.waveBQuality.forwardValidation.manualApprovalOnly, true);
assert.strictEqual(policy.gates.signal_timing.maximumReturnRegression, 0.01);
assert.strictEqual(policy.gates.signal_timing.maximumDrawdownRegression, 0.005);

const dryRun = JSON.parse(execFileSync(process.execPath, [
    'scripts/strategy-cache-fetch.js', '--dry-run', '--indices', 'all'
], { cwd: ROOT, encoding: 'utf8' }));
assert.strictEqual(dryRun.selected, 8);
assert.strictEqual(dryRun.sourcePolicy, 'tickflow-primary-with-tencent-eastmoney-and-bz50-sina-fallback');
assert.ok(dryRun.results.some(item => item.id === 'bz50'));

const status = JSON.parse(execFileSync(process.execPath, [
    'scripts/strategy-iteration.js', 'status'
], { cwd: ROOT, encoding: 'utf8' }));
assert.ok(Object.prototype.hasOwnProperty.call(status, 'latestCandidateReport'));
assert.ok(Array.isArray(status.shadowStates));
assert.ok(Array.isArray(status.qualityShadowStates));

const qualityStatus = JSON.parse(execFileSync(process.execPath, [
    'scripts/strategy-iteration.js', 'quality-status'
], { cwd: ROOT, encoding: 'utf8' }));
assert.ok(Array.isArray(qualityStatus.qualityShadowStates));

const unsafeRefresh = spawnSync(process.execPath, [
    'scripts/strategy-iteration.js', 'refresh', '--codes', '600519'
], { cwd: ROOT, encoding: 'utf8' });
assert.notStrictEqual(unsafeRefresh.status, 0);
assert.match(unsafeRefresh.stderr, /--after-close/);

const implicitRefresh = spawnSync(process.execPath, [
    'scripts/strategy-iteration.js', 'refresh', '--dry-run'
], { cwd: ROOT, encoding: 'utf8' });
assert.notStrictEqual(implicitRefresh.status, 0);
assert.match(implicitRefresh.stderr, /显式指定 --indices、--codes 或 --all/);

const implicitBaseline = spawnSync(process.execPath, [
    'scripts/strategy-iteration.js', 'baseline'
], { cwd: ROOT, encoding: 'utf8' });
assert.notStrictEqual(implicitBaseline.status, 0);
assert.match(implicitBaseline.stderr, /必须显式传入 --full/);

const incompleteEvaluate = spawnSync(process.execPath, [
    'scripts/strategy-iteration.js', 'evaluate', '--reuse-baseline', '--screen', '--strategy', '波段抄底型'
], { cwd: ROOT, encoding: 'utf8' });
assert.notStrictEqual(incompleteEvaluate.status, 0);
assert.match(incompleteEvaluate.stderr, /--strategy、--variant 和 --candidate/);

const source = fs.readFileSync(path.join(ROOT, 'scripts/strategy-iteration.js'), 'utf8');
assert.ok(source.includes("command === 'shadow'"));
assert.ok(source.includes("command === 'quality-shadow'"));
assert.ok(source.includes("command === 'quality-status'"));
assert.ok(source.includes("command.startsWith('observe-')"));
assert.ok(!source.includes("command === 'promote'"), '研究入口不得自动发布生产策略');
assert.ok(source.includes("const isScreenReport = report.selection?.mode === 'screen'"), '报告状态必须按快速筛选和正式回放分流');
assert.ok(source.includes('status: isScreenReport'), '快速筛选不得展示正式回放状态');
assert.ok(source.includes('screenStatusCode: item.result?.screen?.status || null'), '筛选状态代码应单独展示');
assert.ok(source.includes("已拒绝（reject）"), '候选状态应以中文展示');
assert.ok(source.includes("可进入人工产品取舍（ready_for_product_review）"), '信号时机类应有独立人工取舍状态');
const candidateLabSource = fs.readFileSync(path.join(ROOT, 'scripts/strategy-formal-candidate-lab.js'), 'utf8');
const selectReferenceIndex = candidateLabSource.indexOf('const selectedReferences = selectSymbols(symbolReferences)');
const loadSelectedIndex = candidateLabSource.indexOf('alignSymbolsToCurrentSnapshot(loadSymbols(baselineReport, compatibilityReferences))');
assert.ok(selectReferenceIndex >= 0 && loadSelectedIndex > selectReferenceIndex, '快筛必须先选定标的再载入缓存');
assert.ok(candidateLabSource.includes('loadedSymbols: compatibilitySymbols.map'), '候选报告应记录实际载入的标的');
assert.ok(!candidateLabSource.includes('baseline signalVersion 已过期'), '信号版本变化后快筛应使用当前生产控制组，不得强制重建105标基线');
assert.ok(!candidateLabSource.includes('样本缓存已变化'), '局部缓存更新或新交易日不得强制重建105标基线');
assert.ok(candidateLabSource.includes('alignSymbolsToCurrentSnapshot'), '快筛应使用选中样本的最新共同确认快照');
assert.ok(candidateLabSource.includes("compatibilityMode: 'current-production-control-selected-snapshot'"), '候选报告应明确当前生产控制组口径');
assert.ok(candidateLabSource.includes('baselinePolicyHash'), '基线计算口径应与准入门槛分离');
const qualityShadowSource = fs.readFileSync(path.join(ROOT, 'scripts/strategy-wave-b-quality-shadow.js'), 'utf8');
assert.ok(qualityShadowSource.includes("status: readyForReview ? 'recommend_human_review' : 'shadow_observe'"));
assert.ok(!qualityShadowSource.includes("status: 'approved'"), '质量影子观察不得自动批准展示规则');

console.log('策略持续迭代入口契约通过');
