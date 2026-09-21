#!/usr/bin/env node
'use strict';

// DailyGlance 导航入口：从活代码即时生成模块地图 / 信号定位 / 路由，避免手维护文档过时。
// 只读，不改任何文件。默认输出精简地图，用子命令按需下钻。
//
// 用法：
//   node scripts/map.js                    模块地图（职责+行数+主要导出概览）
//   node scripts/map.js --signals          信号 ID → 文件:行号（B/L/W）
//   node scripts/map.js --route <file...>  改动文件 → 回归分组（复用 check.js 同一路由源）
//   node scripts/map.js --exports <file>   某模块的主要全局导出清单
//   node scripts/map.js --functions <file> 某模块的顶层函数 → 行号（大文件导航）
//   node scripts/map.js --json             以 JSON 输出当前视图（配合其它子命令）

const fs = require('fs');
const path = require('path');
const { groupsForFile } = require('./lib/routing');

const ROOT = path.resolve(__dirname, '..');
const JS_DIR = path.join(ROOT, 'assets', 'js');

// 允许 `node scripts/map.js ... | head/less` 提前关闭管道而不抛 EPIPE 堆栈。
process.stdout.on('error', err => { if (err.code === 'EPIPE') process.exit(0); throw err; });

function readLines(absPath) {
    return fs.readFileSync(absPath, 'utf8').split(/\r?\n/);
}

function listModuleFiles() {
    return fs.readdirSync(JS_DIR)
        .filter(name => name.endsWith('.js'))
        .sort()
        .map(name => path.join(JS_DIR, name));
}

// 从文件头横幅提取职责。优先中文分区横幅 "// [3] 核心算法层 (Core Algorithms)"，
// 否则回退首行 "/* DailyGlance [N] - description ... */"。
function extractResponsibility(lines) {
    for (const line of lines.slice(0, 8)) {
        const m = line.match(/^\s*\/\/\s*(\[\d+\].*\S)\s*$/);
        if (m && !/=====/.test(m[1])) return m[1].trim();
    }
    const banner = (lines[0] || '').match(/^\/\*\s*DailyGlance\s*(\[[^\]]*\][^.]*?)(?:\.\s|\.\s*Keep|\s*\*\/)/);
    if (banner) return banner[1].trim();
    return '(无头部横幅)';
}

// 主要全局导出：顶层 const/let/function 声明 + window.__DG_*__ 句柄
function extractExports(lines) {
    const decls = [];
    const globals = new Set();
    lines.forEach((line, idx) => {
        const d = line.match(/^(?:const|let|function)\s+([A-Za-z_$][\w$]*)/);
        if (d) decls.push({ name: d[1], line: idx + 1 });
        const g = line.match(/window\.(__DG_[A-Za-z0-9_]*__)/);
        if (g) globals.add(g[1]);
    });
    return { decls, globals: [...globals] };
}

// 顶层与一级缩进的具名函数：function foo(...) 及 const foo = (...) => / function
function extractFunctions(lines) {
    const fns = [];
    lines.forEach((line, idx) => {
        let m = line.match(/^(?:\s{0,4})function\s+([A-Za-z_$][\w$]*)/);
        if (!m) m = line.match(/^(?:\s{0,4})(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function|\([^)]*\)\s*=>)/);
        if (m) fns.push({ name: m[1], line: idx + 1 });
    });
    return fns;
}

// 信号定义：{ id: 'B1', ... }
function extractSignals(absPath, lines) {
    const rel = path.relative(ROOT, absPath).split(path.sep).join('/');
    const found = [];
    lines.forEach((line, idx) => {
        const m = line.match(/id:\s*'([BLWS]\d+)'/);
        if (m) found.push({ id: m[1], file: rel, line: idx + 1 });
    });
    return found;
}

function resolveArg(arg) {
    const abs = path.resolve(ROOT, arg);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
        throw new Error(`文件不存在：${arg}`);
    }
    return abs;
}

function padEnd(str, n) { return String(str).length >= n ? String(str) : String(str) + ' '.repeat(n - String(str).length); }

function main() {
    const argv = process.argv.slice(2);
    const json = argv.includes('--json');
    const rest = argv.filter(a => a !== '--json');
    const cmd = rest[0];

    // --route <file...>
    if (cmd === '--route') {
        const files = rest.slice(1);
        if (!files.length) throw new Error('--route 需要至少一个项目内文件路径');
        const rows = files.map(f => {
            const relative = path.relative(ROOT, path.resolve(ROOT, f)).split(path.sep).join('/');
            return { file: relative, groups: groupsForFile(relative) };
        });
        if (json) return process.stdout.write(JSON.stringify(rows, null, 2) + '\n');
        process.stdout.write('\n改动文件 → 回归分组（node scripts/check.js --files=... 用同一路由）\n\n');
        rows.forEach(r => process.stdout.write(`  ${padEnd(r.file, 46)} ${r.groups.length ? r.groups.join(', ') : '(未映射，仅语法检查)'}\n`));
        process.stdout.write('\n');
        return;
    }

    // --exports <file>
    if (cmd === '--exports') {
        const abs = resolveArg(rest[1] || '');
        const { decls, globals } = extractExports(readLines(abs));
        if (json) return process.stdout.write(JSON.stringify({ decls, globals }, null, 2) + '\n');
        process.stdout.write(`\n${path.relative(ROOT, abs)} 主要导出\n\n  顶层声明：\n`);
        decls.forEach(d => process.stdout.write(`    ${padEnd(':' + d.line, 7)} ${d.name}\n`));
        if (globals.length) { process.stdout.write('\n  全局句柄：\n'); globals.forEach(g => process.stdout.write(`    window.${g}\n`)); }
        process.stdout.write('\n');
        return;
    }

    // --functions <file>
    if (cmd === '--functions') {
        const abs = resolveArg(rest[1] || '');
        const fns = extractFunctions(readLines(abs));
        if (json) return process.stdout.write(JSON.stringify(fns, null, 2) + '\n');
        process.stdout.write(`\n${path.relative(ROOT, abs)} 顶层函数（${fns.length} 个）\n\n`);
        fns.forEach(f => process.stdout.write(`  ${padEnd(':' + f.line, 8)} ${f.name}\n`));
        process.stdout.write('\n');
        return;
    }

    // --signals
    if (cmd === '--signals') {
        const all = [];
        listModuleFiles().forEach(abs => { extractSignals(abs, readLines(abs)).forEach(s => all.push(s)); });
        all.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
        if (json) return process.stdout.write(JSON.stringify(all, null, 2) + '\n');
        process.stdout.write(`\n信号 ID → 位置（${all.length} 个；策略契约见 docs/strategy/STRATEGY_DECISION_RULES.md）\n\n`);
        all.forEach(s => process.stdout.write(`  ${padEnd(s.id, 5)} ${s.file}:${s.line}\n`));
        process.stdout.write('\n');
        return;
    }

    if (cmd && cmd.startsWith('--') && !['--json'].includes(cmd)) {
        throw new Error(`未知子命令：${cmd}`);
    }

    // 默认：模块地图
    const modules = listModuleFiles().map(abs => {
        const lines = readLines(abs);
        const { decls, globals } = extractExports(lines);
        return {
            file: path.relative(ROOT, abs).split(path.sep).join('/'),
            lines: lines.length,
            responsibility: extractResponsibility(lines),
            exportCount: decls.length,
            globals
        };
    });
    if (json) return process.stdout.write(JSON.stringify(modules, null, 2) + '\n');
    process.stdout.write('\nDailyGlance 模块地图（node scripts/map.js 生成，实时读活代码）\n\n');
    modules.forEach(m => {
        process.stdout.write(`  ${padEnd(m.file, 30)} ${padEnd(m.lines + '行', 8)} ${m.responsibility}\n`);
        if (m.globals.length) process.stdout.write(`  ${' '.repeat(30)} ${' '.repeat(8)} 全局: ${m.globals.map(g => 'window.' + g).join(', ')}\n`);
    });
    process.stdout.write('\n下钻：--signals 信号定位 | --exports <file> 导出 | --functions <file> 函数 | --route <file...> 回归分组\n\n');
}

try {
    main();
} catch (error) {
    process.stderr.write(`map 参数错误：${error.message || error}\n`);
    process.exit(1);
}
