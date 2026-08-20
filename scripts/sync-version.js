#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const VERSION = require(path.join(ROOT, 'version.json'));
const CHECK_ONLY = process.argv.includes('--check');

function assertVersion(value, pattern, label) {
    if (!pattern.test(value || '')) throw new Error(`${label} 格式无效：${value || '(empty)'}`);
}

function replaceOrCheck(file, pattern, replacement, label) {
    const absolute = path.join(ROOT, file);
    const source = fs.readFileSync(absolute, 'utf8');
    const matches = source.match(pattern) || [];
    if (matches.length !== 1) throw new Error(`${label} 在 ${file} 中必须且只能出现一次`);
    const next = source.replace(pattern, replacement);
    if (CHECK_ONLY) {
        if (next !== source) throw new Error(`${file} 的 ${label} 未与 version.json 同步；运行 node scripts/sync-version.js`);
    } else if (next !== source) {
        fs.writeFileSync(absolute, next);
        console.log(`已同步 ${file}`);
    }
}

function syncHtmlResources(file, minimumCount) {
    const absolute = path.join(ROOT, file);
    const source = fs.readFileSync(absolute, 'utf8');
    const versions = [...source.matchAll(/[?&]v=(\d{8}-\d{2})/g)].map(match => match[1]);
    if (versions.length < minimumCount) throw new Error(`${file} 缺少完整资源版本参数`);
    const next = source.replace(/([?&]v=)\d{8}-\d{2}/g, `$1${VERSION.resourceVersion}`);
    if (CHECK_ONLY) {
        if (next !== source) throw new Error(`${file} 的资源版本未与 version.json 同步；运行 node scripts/sync-version.js`);
    } else if (next !== source) {
        fs.writeFileSync(absolute, next);
        console.log(`已同步 ${file}`);
    }
}

function main() {
    assertVersion(VERSION.appBuild, /^\d{4}-\d{2}-\d{2}-\d{2}$/, 'appBuild');
    assertVersion(VERSION.resourceVersion, /^\d{8}-\d{2}$/, 'resourceVersion');
    assertVersion(VERSION.signalVersion, /^v\d+(?:\.\d+){2}$/, 'signalVersion');
    replaceOrCheck('assets/js/00-strategy-config.js', /const APP_BUILD = '[^']+';/, `const APP_BUILD = '${VERSION.appBuild}';`, 'APP_BUILD');
    replaceOrCheck('assets/js/00-strategy-config.js', /const SIGNAL_VERSION = '[^']+';/, `const SIGNAL_VERSION = '${VERSION.signalVersion}';`, 'SIGNAL_VERSION');
    syncHtmlResources('index.html', 11);
    syncHtmlResources('strategy-inspector.html', 3);
    console.log(CHECK_ONLY ? '版本同步检查通过' : '版本同步完成');
}

main();
