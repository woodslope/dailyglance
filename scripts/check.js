#!/usr/bin/env node

const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const NODE = process.execPath;
const REGRESSION_GROUPS = ['data-cache', 'strategy-decision', 'presentation-state', 'chart-navigation', 'watchlist-lifecycle'];
const results = { passed: [], warnings: [], failed: [] };
let exitCode = 0;

function label(text) { process.stdout.write(`\n${text}\n`); }
function ok(text) { results.passed.push(text); process.stdout.write(`  ✅ ${text}\n`); }
function warn(text) { results.warnings.push(text); process.stdout.write(`  ⚠️  ${text}\n`); }
function fail(text) { results.failed.push(text); process.stdout.write(`  ❌ ${text}\n`); exitCode = 1; }

function runCmd(cmd, args, options = {}) {
    try {
        const stdout = execFileSync(cmd, args, {
            cwd: ROOT,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
            ...options
        });
        return { ok: true, stdout: stdout || '', stderr: '' };
    } catch (error) {
        return {
            ok: false,
            stdout: [error.stdout, error.stderr].filter(Boolean).join('\n'),
            stderr: error.stderr || '',
            message: error.message || ''
        };
    }
}

function parseMode(argv) {
    let mode = '';
    let group = '';
    let files = [];
    for (let index = 0; index < argv.length; index++) {
        const arg = argv[index];
        if (arg === '--changed' || arg === '--full') {
            if (mode) throw new Error('只能指定一个检查范围：--files、--changed、--group 或 --full');
            mode = arg.slice(2);
        } else if (arg === '--files') {
            if (!argv[index + 1]) throw new Error('--files 需要逗号分隔的项目内文件路径');
            if (mode) throw new Error('只能指定一个检查范围：--files、--changed、--group 或 --full');
            mode = 'files';
            files = argv[++index].split(',').map(value => value.trim()).filter(Boolean);
        } else if (arg.startsWith('--files=')) {
            if (mode) throw new Error('只能指定一个检查范围：--files、--changed、--group 或 --full');
            mode = 'files';
            files = arg.slice('--files='.length).split(',').map(value => value.trim()).filter(Boolean);
        } else if (arg === '--group') {
            if (!argv[index + 1]) throw new Error('--group 需要一个分组名');
            if (mode) throw new Error('只能指定一个检查范围：--files、--changed、--group 或 --full');
            mode = 'group';
            group = argv[++index];
        } else if (arg.startsWith('--group=')) {
            if (mode) throw new Error('只能指定一个检查范围：--files、--changed、--group 或 --full');
            mode = 'group';
            group = arg.slice('--group='.length);
        } else {
            throw new Error(`未知参数：${arg}`);
        }
    }
    if (!mode) throw new Error('请显式指定检查范围：--files、--group、--changed 或 --full');
    if (mode === 'files' && !files.length) throw new Error('--files 至少需要一个项目内文件路径');
    if (mode === 'group' && !REGRESSION_GROUPS.includes(group)) {
        throw new Error(`未知回归分组：${group}；可选值：${REGRESSION_GROUPS.join(', ')}`);
    }
    return { mode, group, files };
}

function resolveSelectedFiles(files) {
    return [...new Set(files)].map(file => {
        const absolute = path.resolve(ROOT, file);
        const relative = path.relative(ROOT, absolute);
        if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
            throw new Error(`--files 只接受项目内文件：${file}`);
        }
        if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
            throw new Error(`--files 文件不存在：${file}`);
        }
        return { relative: relative.split(path.sep).join('/'), absolute };
    });
}

function gitLines(args) {
    const result = runCmd('git', args);
    if (!result.ok) throw new Error(`无法读取 Git 改动：${result.message}`);
    return result.stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
}

function changedFiles() {
    return [...new Set([
        ...gitLines(['diff', '--name-only', 'HEAD']),
        ...gitLines(['ls-files', '--others', '--exclude-standard'])
    ])].sort();
}

function findJSFiles(dir) {
    const files = [];
    function walk(current) {
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            if (entry.name.startsWith('.')) continue;
            const full = path.join(current, entry.name);
            if (entry.isDirectory()) {
                if (entry.name !== '_archived') walk(full);
            } else if (entry.name.endsWith('.js')) {
                files.push(full);
            }
        }
    }
    if (fs.existsSync(dir)) walk(dir);
    return files;
}

function groupsForFile(file) {
    if (file === 'tests/regression.js') return REGRESSION_GROUPS;
    const match = file.match(/^tests\/regression\/([\w-]+)(?:\.cases)?\.js$/);
    if (match && REGRESSION_GROUPS.includes(match[1])) return [match[1]];
    if (file.startsWith('assets/js/00-')) return ['strategy-decision'];
    if (file.startsWith('assets/js/01-')) return ['presentation-state'];
    if (file.startsWith('assets/js/02-') || file.includes('data-contract')) return ['data-cache'];
    if (file.startsWith('assets/js/03-') || file.startsWith('scripts/strategy-')) return ['strategy-decision'];
    if (file.startsWith('assets/js/04-')) return ['chart-navigation', 'presentation-state'];
    if (file.startsWith('assets/js/05-')) return ['chart-navigation', 'watchlist-lifecycle'];
    if (file.startsWith('assets/js/07-')) return ['chart-navigation', 'watchlist-lifecycle'];
    if (file === 'index.html' || file === 'strategy-inspector.html' || file.startsWith('assets/js/strategy-inspector.js') || file.startsWith('assets/js/06-') || file.startsWith('assets/css/')) return ['presentation-state'];
    if (file === 'scripts/status-smoke.js' || file === 'scripts/live-dataflow-smoke.js' || file === 'scripts/performance-budget.js' || file === 'scripts/ui-governance-smoke.js') return ['chart-navigation', 'presentation-state'];
    return [];
}

function runSyntax(files) {
    label('1. 语法检查');
    if (!files.length) return warn('本次没有改动 JavaScript 文件');
    let failures = 0;
    for (const file of files) {
        const result = runCmd(NODE, ['--check', file]);
        if (!result.ok) {
            failures++;
            process.stdout.write(`    ❌ ${path.relative(ROOT, file)}\n`);
        }
    }
    if (failures) fail(`${failures}/${files.length} 个文件语法错误`);
    else ok(`${files.length} 个文件通过`);
}

function runRegression(groups) {
    label('2. 定向回归');
    if (!groups.length) return warn('本次改动未映射到产品回归分组');
    for (const group of groups) {
        const result = spawnSync(NODE, ['tests/regression.js'], {
            cwd: ROOT,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
            env: { ...process.env, TEST_GROUP: group }
        });
        const output = [(result.stdout || ''), (result.stderr || '')].join('\n');
        const failed = output.split(/\r?\n/).filter(line => line.startsWith('not ok'));
        const passed = output.split(/\r?\n/).filter(line => line.startsWith('ok -'));
        if (result.error) fail(`${group} 无法启动：${result.error.message || result.error}`);
        else if (result.status !== 0 || failed.length || !passed.length) {
            const detail = failed.length ? failed.join('; ') : output.trim().split(/\r?\n/).slice(-5).join(' | ');
            fail(`${group} 回归失败：${detail || '没有执行测试'}`);
        } else {
            ok(`${group}：${passed.length} 项通过`);
        }
    }
}

function runFullMaintenanceChecks() {
    label('3. 本地研究缓存');
    const cacheDir = path.join(ROOT, '.local', 'strategy-cache');
    if (!fs.existsSync(cacheDir)) warn('缓存目录不存在（尚未拉取策略缓存）');
    else {
        const cacheFiles = fs.readdirSync(cacheDir).filter(file => file.endsWith('.json'));
        ok(`${cacheFiles.length} 个缓存文件可读取`);
    }

    label('4. 文档与归档入口');
    const required = ['AGENTS.md', 'CURRENT_STATUS.md', 'STABILITY_CHECKLIST.md', 'README.md'];
    const missing = required.filter(file => !fs.existsSync(path.join(ROOT, file)));
    if (missing.length) fail(`缺少入口文档：${missing.join(', ')}`);
    else ok('核心入口文档完整');
    const archivedDir = path.join(ROOT, 'scripts', '_archived');
    if (fs.existsSync(archivedDir)) ok('归档脚本目录存在');
    else warn('归档脚本目录不存在');
}

function main() {
    const { mode, group, files: requestedFiles } = parseMode(process.argv.slice(2));
    const selectedFiles = mode === 'files' ? resolveSelectedFiles(requestedFiles) : [];
    const files = mode === 'full'
        ? [
            ...findJSFiles(path.join(ROOT, 'assets', 'js')),
            ...findJSFiles(path.join(ROOT, 'scripts')),
            ...findJSFiles(path.join(ROOT, 'tests'))
        ]
        : mode === 'files'
            ? selectedFiles.filter(file => file.relative.endsWith('.js')).map(file => file.absolute)
            : mode === 'changed'
                ? changedFiles().filter(file => file.endsWith('.js')).map(file => path.join(ROOT, file)).filter(fs.existsSync)
                : [];
    const groups = mode === 'full'
        ? REGRESSION_GROUPS
        : mode === 'group'
            ? [group]
            : mode === 'files'
                ? [...new Set(selectedFiles.flatMap(file => groupsForFile(file.relative)))]
                : [...new Set(changedFiles().flatMap(groupsForFile))];

    const scopeLabel = mode === 'group'
        ? `group:${group}`
        : mode === 'files'
            ? `files:${selectedFiles.map(file => file.relative).join(',')}`
            : mode;
    label(`检查范围：${scopeLabel}`);
    const version = runCmd(NODE, ['scripts/sync-version.js', '--check']);
    if (version.ok) ok('版本来源一致');
    else fail(`版本来源不一致：${version.stdout.trim() || version.message}`);
    runSyntax(files);
    runRegression(groups);
    if (mode === 'full') runFullMaintenanceChecks();

    label('══════════════════════');
    process.stdout.write(`\n  通过 ${results.passed.length}  |  警告 ${results.warnings.length}  |  失败 ${results.failed.length}\n`);
    process.stdout.write(exitCode ? '  状态：需要关注 ❌\n\n' : '  状态：健康 ✅\n\n');
    process.exit(exitCode);
}

try {
    main();
} catch (error) {
    process.stderr.write(`检查参数错误：${error.message || error}\n`);
    process.exit(1);
}
