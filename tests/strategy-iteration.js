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

const source = fs.readFileSync(path.join(ROOT, 'scripts/strategy-iteration.js'), 'utf8');
assert.ok(source.includes("command === 'shadow'"));
assert.ok(source.includes("command === 'quality-shadow'"));
assert.ok(source.includes("command === 'quality-status'"));
assert.ok(source.includes("command.startsWith('observe-')"));
assert.ok(!source.includes("command === 'promote'"), '研究入口不得自动发布生产策略');
const qualityShadowSource = fs.readFileSync(path.join(ROOT, 'scripts/strategy-wave-b-quality-shadow.js'), 'utf8');
assert.ok(qualityShadowSource.includes("status: readyForReview ? 'recommend_human_review' : 'shadow_observe'"));
assert.ok(!qualityShadowSource.includes("status: 'approved'"), '质量影子观察不得自动批准展示规则');

console.log('策略持续迭代入口契约通过');
