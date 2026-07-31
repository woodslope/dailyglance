#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const ROOT = path.resolve(__dirname, '..');
const CACHE_DIR = path.join(ROOT, '.local', 'strategy-cache');
const TODAY = new Date();

function daysAgo(dateStr) {
    if (!dateStr) return Infinity;
    const d = new Date(dateStr);
    return Math.floor((TODAY - d) / (1000 * 60 * 60 * 24));
}

function formatDate(dateStr) {
    if (!dateStr) return '--';
    const d = new Date(dateStr);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function pingUrl(url, timeoutMs = 5000) {
    return new Promise((resolve) => {
        const client = url.startsWith('https') ? https : http;
        const req = client.get(url, { timeout: timeoutMs }, (res) => {
            resolve({ ok: res.statusCode >= 200 && res.statusCode < 400, status: res.statusCode });
            res.resume();
        });
        req.on('error', (e) => resolve({ ok: false, status: 0, error: e.code || e.message }));
        req.on('timeout', () => { req.destroy(); resolve({ ok: false, status: 0, error: 'timeout' }); });
    });
}

function main() {
    const args = new Set(process.argv.slice(2));
    const checkApi = args.has('--api');
    const showStale = args.has('--stale');

    process.stdout.write('\n📊 DailyGlance 数据健康检查\n');
    process.stdout.write(`检查时间: ${formatDate(TODAY.toISOString().slice(0, 10))}\n\n`);

    if (!fs.existsSync(CACHE_DIR)) {
        process.stdout.write('  ❌ 策略缓存目录不存在\n');
        process.stdout.write('     请先运行: node scripts/strategy-iteration.js refresh --after-close\n');
        process.exit(1);
    }

    const cacheFiles = fs.readdirSync(CACHE_DIR).filter(f => f.endsWith('.json'));
    if (!cacheFiles.length) {
        process.stdout.write('  ⚠️  缓存目录为空\n');
        process.exit(0);
    }

    // ── 1. Cache freshness ──
    process.stdout.write('── 1. 缓存新鲜度 ──\n');

    const symbols = [];
    for (const file of cacheFiles) {
        try {
            const data = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, file), 'utf8'));
            const items = Array.isArray(data) ? data : (data.items || data.data || []);
            if (!items.length) continue;

            const last = items[items.length - 1];
            const first = items[0];
            const lastDate = last?.date || '';
            const firstDate = first?.date || '';
            const age = daysAgo(lastDate);

            // Parse symbol info from filename
            const parts = file.replace('.json', '').split('_');
            const type = parts[0] === 'index' ? '指数' : '股票';
            const code = type === '指数' ? parts[2] : parts[1];
            const name = type === '指数'
                ? ({ '000001': '上证', '399001': '深证', '000300': '沪深300', '000905': '中证500', '000852': '中证1000', '399006': '创业板指', '000688': '科创50', '899050': '北证50' })[code] || code
                : code;

            symbols.push({ file, type, code, name, lastDate, firstDate, age, count: items.length });
        } catch (e) {
            process.stdout.write(`  ⚠️  ${file}: 无法解析\n`);
        }
    }

    // Sort by age descending (stalest first)
    symbols.sort((a, b) => b.age - a.age);

    const fresh = symbols.filter(s => s.age <= 1);
    const recent = symbols.filter(s => s.age >= 2 && s.age <= 5);
    const stale = symbols.filter(s => s.age >= 6);

    process.stdout.write(`  ${'✅'} 最新（≤1天）: ${fresh.length} 个标的\n`);
    if (recent.length) {
        process.stdout.write(`  ${'🟡'} 较新（2-5天）: ${recent.length} 个标的\n`);
    }
    if (stale.length) {
        process.stdout.write(`  ${'🔴'} 过期（≥6天）: ${stale.length} 个标的\n`);
    }

    if (showStale && (recent.length || stale.length)) {
        process.stdout.write('\n  非最新标的详情:\n');
        for (const s of [...recent, ...stale]) {
            const ageLabel = s.age === Infinity ? '未知' : `${s.age}天前`;
            process.stdout.write(`    ${s.type} ${s.name}(${s.code}) 最后: ${s.lastDate || '--'} (${ageLabel}) | ${s.count}根K线\n`);
        }
    }

    // ── 2. Coverage summary ──
    process.stdout.write('\n── 2. 覆盖汇总 ──\n');
    const indices = symbols.filter(s => s.type === '指数');
    const stocks = symbols.filter(s => s.type === '股票');

    const indexDates = indices.map(s => s.lastDate).filter(Boolean).sort().reverse();
    const stockDates = stocks.map(s => s.lastDate).filter(Boolean).sort().reverse();

    const indexLatest = indexDates[0] || '--';
    const stockLatest = stockDates[0] || '--';
    const allLatest = symbols.map(s => s.lastDate).filter(Boolean).sort().reverse()[0] || '--';

    // Count how many stocks share the same latest date
    const atLatest = stocks.filter(s => s.lastDate === stockLatest).length;

    process.stdout.write(`  指数: ${indices.length} 个，最新 ${indexLatest}\n`);
    process.stdout.write(`  股票: ${stocks.length} 个，最新 ${stockLatest}（${atLatest}/${stocks.length} 只同步）\n`);

    const totalBars = symbols.reduce((sum, s) => sum + s.count, 0);
    process.stdout.write(`  总计: ${symbols.length} 个标的，${totalBars.toLocaleString()} 根K线\n`);

    // ── 3. Data gaps ──
    process.stdout.write('\n── 3. 数据缺口检查 ──\n');
    // A-share trading holidays (Spring Festival, National Day etc) can cause 7-10 day gaps.
    // Only flag gaps > 14 calendar days as suspicious actual data issues.
    const SUSPICIOUS_GAP_DAYS = 14;
    let gapsFound = 0;
    for (const s of symbols) {
        try {
            const data = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, s.file), 'utf8'));
            const items = Array.isArray(data) ? data : (data.items || data.data || []);
            if (items.length < 2) continue;

            let maxGap = 0;
            for (let i = 1; i < items.length; i++) {
                const prev = new Date(items[i - 1].date);
                const curr = new Date(items[i].date);
                const gap = Math.round((curr - prev) / (1000 * 60 * 60 * 24));
                if (gap > maxGap) maxGap = gap;
            }

            if (maxGap > SUSPICIOUS_GAP_DAYS) {
                gapsFound++;
                if (gapsFound <= 8) {
                    process.stdout.write(`  ⚠️  ${s.type} ${s.name}(${s.code}): 最大间隔 ${maxGap} 天（起始 ${s.firstDate}）\n`);
                }
            }
        } catch (e) { /* skip */ }
    }
    if (gapsFound === 0) {
        process.stdout.write('  ✅ 未发现可疑数据缺口（>14天间隔，A股节假日在正常范围）\n');
    } else if (gapsFound > 8) {
        process.stdout.write(`  ... 共 ${gapsFound} 个标的，可能因同一天起算（初始拉取日期前无数据）\n`);
    }

    // ── 4. API availability (optional) ──
    if (checkApi) {
        process.stdout.write('\n── 4. 数据源可用性 ──\n');
        const apis = [
            { name: 'TickFlow', url: 'https://api.tickflow.com/v1/market/status' },
            { name: '东方财富', url: 'https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=1.000001&klt=101&fqt=0&fields1=f1&fields2=f2&lmt=1' },
            { name: '腾讯', url: 'https://web.ifzq.gtimg.cn/appstock/app/minute/query?_var=min_data&code=sh000001' }
        ];

        (async () => {
            for (const api of apis) {
                const result = await pingUrl(api.url);
                if (result.ok) {
                    process.stdout.write(`  ✅ ${api.name}: HTTP ${result.status}\n`);
                } else {
                    process.stdout.write(`  ❌ ${api.name}: ${result.error || ('HTTP ' + result.status)}\n`);
                }
            }
            process.stdout.write('\n══════════════════════\n');
            process.stdout.write('  检查完成\n\n');
        })();
    } else {
        process.stdout.write('\n══════════════════════\n');
        process.stdout.write('  提示: 加 --api 检查数据源可用性，加 --stale 显示过期标的详情\n');
        process.stdout.write('  检查完成\n\n');
    }
}

main();
