#!/usr/bin/env node

const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const NODE = process.execPath;

const results = { passed: [], skipped: [], failed: [], warnings: [] };
let exitCode = 0;

function label(text) { process.stdout.write(`\n${text}\n`); }
function ok(text) { results.passed.push(text); process.stdout.write(`  ✅ ${text}\n`); }
function warn(text) { results.warnings.push(text); process.stdout.write(`  ⚠️  ${text}\n`); }
function fail(text) { results.failed.push(text); process.stdout.write(`  ❌ ${text}\n`); exitCode = 1; }

function runCmd(cmd, args, opts = {}) {
    try {
        const output = execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
        return { ok: true, stdout: output || '', stderr: '' };
    } catch (e) {
        // Combine stdout + stderr for TAP runners that output to stderr on failure
        const out = [e.stdout, e.stderr].filter(Boolean).join('\n');
        return { ok: false, stdout: out || '', stderr: e.stderr || '', message: e.message || '' };
    }
}

function findJSFiles(dir, excludeArchived = true) {
    const results = [];
    function walk(d) {
        try {
            for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
                if (entry.name.startsWith('.') && entry.name !== '.local') continue;
                const full = path.join(d, entry.name);
                if (entry.isDirectory()) {
                    if (excludeArchived && entry.name === '_archived') continue;
                    walk(full);
                } else if (entry.name.endsWith('.js') && !entry.name.startsWith('.')) {
                    results.push(full);
                }
            }
        } catch (e) { /* skip inaccessible dirs */ }
    }
    walk(dir);
    return results;
}

// ── 1. Syntax check ──
label('1. 语法检查');
const jsFiles = [
    ...findJSFiles(path.join(ROOT, 'assets', 'js')),
    ...findJSFiles(path.join(ROOT, 'scripts')),
    ...findJSFiles(path.join(ROOT, 'tests'))
];
let syntaxOk = 0, syntaxFail = 0;
for (const file of jsFiles) {
    const r = runCmd(NODE, ['--check', file]);
    if (r.ok) syntaxOk++;
    else { syntaxFail++; process.stdout.write(`    ❌ ${path.relative(ROOT, file)}\n`); }
}
if (syntaxFail === 0) ok(`${syntaxOk} 个文件通过`);
else fail(`${syntaxFail}/${jsFiles.length} 个文件失败（${syntaxOk} 通过）`);

// ── 2. Strategy regression ──
label('2. 策略回归');
const regression = path.join(ROOT, 'tests', 'regression.js');
if (fs.existsSync(regression)) {
    const reg = spawnSync(NODE, [regression], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    // TAP runner outputs failures to stderr, pass lines to stdout
    const combined = [(reg.stdout || ''), (reg.stderr || '')].join('\n');
    const failLines = combined.split('\n').filter(l => l.startsWith('not ok'));
    const passLines = combined.split('\n').filter(l => l.startsWith('ok'));
    if (reg.error) {
        fail(`回归测试无法启动：${reg.error.message || reg.error}`);
    } else if (reg.status !== 0 || failLines.length > 0) {
        const details = failLines.length
            ? failLines.map(line => `    ${line}`).join('\n')
            : combined.trim().split('\n').slice(-6).map(line => `    ${line}`).join('\n');
        fail(`${failLines.length || '未知数量'} 个回归失败：\n${details}`);
    } else {
        ok(`${passLines.length} 项全部通过`);
    }
} else {
    warn('回归测试文件不存在，跳过');
}

// ── 3. Script entry points ──
label('3. 核心脚本入口');
const entries = [
    ['strategy-iteration.js', '策略迭代入口'],
    ['strategy-observation.js', '真实观察入口'],
    ['strategy-cache-fetch.js', '缓存拉取'],
    ['strategy-wave-b-quality-report.js', '波段B质量报告'],
    ['strategy-wave-b-quality-shadow.js', '波段B质量影子'],
    ['strategy-batch-screen.js', '批量筛选'],
    ['strategy-formal-baseline.js', '正式基线'],
    ['strategy-evaluator.js', '策略评估器']
];
for (const [script, desc] of entries) {
    const full = path.join(ROOT, 'scripts', script);
    if (fs.existsSync(full)) {
        const r = runCmd(NODE, ['--check', full]);
        if (r.ok) ok(desc);
        else fail(`${desc}: 语法错误`);
    } else {
        warn(`${desc}: 文件不存在 (${script})`);
    }
}

// ── 4. Strategy cache status ──
label('4. 策略缓存状态');
const cacheDir = path.join(ROOT, '.local', 'strategy-cache');
if (fs.existsSync(cacheDir)) {
    const cacheFiles = fs.readdirSync(cacheDir).filter(f => f.endsWith('.json'));
    if (cacheFiles.length) {
        let totalBars = 0, latestDate = '', oldestDate = '';
        for (const f of cacheFiles) {
            try {
                const data = JSON.parse(fs.readFileSync(path.join(cacheDir, f), 'utf8'));
                const items = Array.isArray(data) ? data : (data.items || data.data || []);
                totalBars += items.length;
                if (items.length) {
                    const last = items[items.length - 1]?.date || '';
                    const first = items[0]?.date || '';
                    if (!latestDate || last > latestDate) latestDate = last;
                    if (!oldestDate || first < oldestDate) oldestDate = first;
                }
            } catch (e) { /* skip corrupted files */ }
        }
        ok(`${cacheFiles.length} 个标的缓存，共 ${totalBars.toLocaleString()} 根K线`);
        ok(`日期范围: ${oldestDate || '?'} ~ ${latestDate || '?'}`);
    } else {
        warn('缓存目录为空');
    }
} else {
    warn('缓存目录不存在（尚未拉取策略缓存）');
}

// ── 5. Document cross-references ──
label('5. 文档完整性');
const docs = [
    ['AGENTS.md', 'AI 协作入口'],
    ['CURRENT_STATUS.md', '当前接续状态'],
    ['AI_WORKFLOW_NOTES.md', '协作规范'],
    ['STABILITY_CHECKLIST.md', '生产验证规则'],
    ['docs/strategy/STRATEGY_DECISION_RULES.md', '策略决策规则'],
    ['docs/strategy/STRATEGY_VALIDATION_GUIDE.md', '策略验证指南'],
    ['docs/data/DATA_CONTRACT.md', '数据契约'],
    ['docs/product/PRODUCT_DECISION_GUIDE.md', '产品决策指南']
];
for (const [file, desc] of docs) {
    if (fs.existsSync(path.join(ROOT, file))) ok(desc);
    else warn(`${desc}: ${file} 不存在`);
}

// ── 6. Archived scripts ──
label('6. 归档脚本');
const archivedDir = path.join(ROOT, 'scripts', '_archived');
if (fs.existsSync(archivedDir)) {
    const archived = fs.readdirSync(archivedDir).filter(f => f.endsWith('.js'));
    ok(`${archived.length} 个脚本已归档（研究完成、结论已写入文档）`);
} else {
    warn('归档目录不存在');
}

// ── Summary ──
label('══════════════════════');
const total = results.passed.length + results.skipped.length + results.warnings.length + results.failed.length;
process.stdout.write(`\n  通过 ${results.passed.length}  |  警告 ${results.warnings.length}  |  失败 ${results.failed.length}\n`);
if (exitCode === 0) {
    process.stdout.write('  状态：健康 ✅\n\n');
} else {
    process.stdout.write(`  状态：需要关注 ❌ (exit ${exitCode})\n\n`);
}
process.exit(exitCode);
