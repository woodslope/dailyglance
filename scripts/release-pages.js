#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const VERSION = require(path.join(ROOT, 'version.json'));
const REMOTE = 'origin';
const TARGET_BRANCH = 'main';
const ALLOWED_PATHS = ['index.html', 'strategy-inspector.html', 'assets', '.gitignore'];
const args = new Set(process.argv.slice(2));
const VALID_ARGS = new Set(['--help', '--push', '--cleanup', '--verbose']);
const push = args.has('--push');
const cleanup = args.has('--cleanup');
const summary = !args.has('--verbose');

function runGit(args, cwd = ROOT, options = {}) {
    const output = execFileSync('git', args, {
        cwd,
        encoding: 'utf8',
        stdio: options.stdio || ['ignore', 'pipe', 'pipe']
    });
    return String(output || '').trim();
}

function runNode(args, cwd = ROOT, options = {}) {
    const output = execFileSync(process.execPath, args, {
        cwd,
        encoding: 'utf8',
        stdio: options.stdio || ['ignore', 'pipe', 'pipe']
    });
    return String(output || '').trim();
}

function log(message) {
    if (!summary) process.stdout.write(`${message}\n`);
}

function assertCleanReleaseScope(worktree) {
    const names = runGit(['diff', '--cached', '--name-only'], worktree)
        .split(/\r?\n/).map(value => value.trim()).filter(Boolean);
    const invalid = names.filter(name => !ALLOWED_PATHS.some(allowed => name === allowed || name.startsWith(`${allowed}/`)));
    if (invalid.length) throw new Error(`部署包包含禁止路径：${invalid.join(', ')}`);
    if (!names.length) {
        throw new Error('没有可发布的 Pages 资源改动；仅文档、测试或本地脚本改动无需发布');
    }
    if (!names.includes('index.html')) {
        throw new Error('部署包缺少 index.html 入口');
    }
    return names;
}

function main() {
    const unknownArgs = [...args].filter(arg => !VALID_ARGS.has(arg));
    if (unknownArgs.length) throw new Error(`未知参数：${unknownArgs.join(', ')}`);
    if (args.has('--help')) {
        console.log('用法：node scripts/release-pages.js [--push] [--cleanup] [--verbose]');
        console.log('默认只准备并提交 Pages worktree；只有显式 --push 才推送 origin/main。');
        return;
    }

    runGit(['fetch', REMOTE, TARGET_BRANCH], ROOT, { stdio: 'inherit' });
    runNode(['scripts/sync-version.js', '--check'], ROOT, { stdio: 'inherit' });

    const branch = `codex/pages-release-${VERSION.resourceVersion}-${Date.now()}`;
    const worktree = fs.mkdtempSync(path.join(os.tmpdir(), `dailyglance-release-${VERSION.resourceVersion}-`));
    let registered = false;
    let completed = false;
    try {
        runGit(['worktree', 'add', '-b', branch, worktree, `${REMOTE}/${TARGET_BRANCH}`], ROOT, { stdio: 'inherit' });
        registered = true;
        for (const relative of ALLOWED_PATHS) {
            const source = path.join(ROOT, relative);
            const target = path.join(worktree, relative);
            if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
            fs.cpSync(source, target, { recursive: true });
        }
        runGit(['add', '--', ...ALLOWED_PATHS], worktree);
        const staged = assertCleanReleaseScope(worktree);
        const commitMessage = `Release DailyGlance ${VERSION.appBuild}`;
        runGit(['commit', '-m', commitMessage], worktree, { stdio: 'inherit' });
        if (push) runGit(['push', REMOTE, `HEAD:${TARGET_BRANCH}`], worktree, { stdio: 'inherit' });
        completed = true;
        console.log(JSON.stringify({
            ok: true,
            pushed: push,
            branch,
            worktree,
            commit: runGit(['rev-parse', 'HEAD'], worktree),
            appBuild: VERSION.appBuild,
            resourceVersion: VERSION.resourceVersion,
            stagedPaths: staged
        }, null, summary ? 0 : 2));
    } finally {
        if (registered && (cleanup || !completed)) {
            try { runGit(['worktree', 'remove', '--force', worktree], ROOT); } catch (error) { log(`清理 worktree 失败：${error.message || error}`); }
            if (!completed) {
                try { runGit(['branch', '-D', branch], ROOT); } catch (error) { log(`清理发布分支失败：${error.message || error}`); }
            }
        }
    }
}

try {
    main();
} catch (error) {
    console.error(error.stack || error.message);
    process.exit(1);
}
