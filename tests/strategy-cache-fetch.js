#!/usr/bin/env node

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CODES = '688981,000895,601888,600104,002709,688008,300502,300122,600188,000002,600019,601006';

const output = execFileSync(process.execPath, [
    'scripts/strategy-cache-fetch.js',
    '--dry-run',
    '--codes', CODES
], {
    cwd: ROOT,
    encoding: 'utf8'
});
const report = JSON.parse(output);
const source = fs.readFileSync(path.join(ROOT, 'scripts', 'strategy-cache-fetch.js'), 'utf8');

if (report.mode !== 'dry-run') throw new Error('干跑模式没有被识别');
if (report.sourcePolicy !== 'tickflow-forward-additive-with-tencent-and-eastmoney-fallback') throw new Error('历史源优先级没有切换到 TickFlow');
if (report.requested !== 12 || report.selected !== 12) throw new Error('干跑没有按指定的 12 个样本选择');
if (report.fetched !== 0 || report.failed !== 0) throw new Error('干跑不应写入行情缓存');
if (report.results.some(item => !['fetch', 'cached'].includes(item.action))) throw new Error('干跑应标识待拉取或已有缓存的样本');
if (!report.results.some(item => item.code === '688981' && item.phase === 'phase1')) throw new Error('干跑遗漏 phase1 缺失样本');
if (!source.includes('https://free-api.tickflow.org/v1/klines') || !source.includes("adjust: 'forward_additive'")) throw new Error('TickFlow 历史请求未锁定免费端与差值前复权');

console.log('策略缓存拉取工具干跑契约通过');
