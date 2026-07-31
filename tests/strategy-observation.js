#!/usr/bin/env node

const assert = require('assert');
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'dailyglance-observation-'));
const storePath = path.join(temporaryDirectory, 'observations.json');
const env = { ...process.env, DG_STRATEGY_OBSERVATIONS_FILE: storePath };

function run(args) {
    return JSON.parse(execFileSync(process.execPath, ['scripts/strategy-iteration.js', ...args], {
        cwd: ROOT,
        env,
        encoding: 'utf8'
    }));
}

try {
    const template = run(['observe-template']);
    assert.ok(template.issueTypes.duplicate_adjustment);
    assert.ok(template.strategies.includes('综合全能型'));

    const first = run([
        'observe-add', '--date', '2026-07-27', '--symbol', '600519', '--name', '贵州茅台',
        '--strategy', '综合全能型', '--type', 'duplicate_adjustment', '--bs', 'B', '--position', '30',
        '--actual', '连续两天重复加仓', '--expected', '维持仓位', '--signals', 'B15,B1'
    ]).observation;
    assert.strictEqual(first.id, 'obs-20260727-001');
    assert.deepStrictEqual(first.signals, ['B15', 'B1']);

    const second = run([
        'observe-add', '--date', '2026-07-27', '--symbol', '300750', '--name', '宁德时代',
        '--strategy', '综合全能型', '--type', 'duplicate_adjustment', '--position', '50',
        '--actual', '相同趋势信号重复调仓', '--expected', '保持已有仓位'
    ]).observation;
    assert.strictEqual(second.id, 'obs-20260727-002');

    const followup = run([
        'observe-followup', '--id', first.id, '--horizon', '3', '--date', '2026-07-30',
        '--return-pct', '-2.35', '--note', '三日后回撤扩大'
    ]);
    assert.strictEqual(followup.followups[0].horizon, 3);
    assert.strictEqual(followup.followups[0].returnPct, -2.35);

    const list = run(['observe-list', '--type', 'duplicate_adjustment']);
    assert.strictEqual(list.count, 2);

    const summary = run(['observe-summary']);
    assert.strictEqual(summary.total, 2);
    assert.strictEqual(summary.recurringIssues[0].count, 2);
    assert.strictEqual(summary.recurringIssues[0].uniqueSymbols, 2);
    assert.strictEqual(summary.pendingFollowups.length, 2);

    const invalid = spawnSync(process.execPath, [
        'scripts/strategy-iteration.js', 'observe-add', '--date', '2026-07-27', '--symbol', '600519',
        '--strategy', '综合全能型', '--type', 'unknown', '--actual', 'x', '--expected', 'y'
    ], { cwd: ROOT, env, encoding: 'utf8' });
    assert.notStrictEqual(invalid.status, 0);
    assert.match(invalid.stderr, /--type 仅支持/);

    console.log('策略问题观察入口契约通过');
} finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}
