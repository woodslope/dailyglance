#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.resolve(__dirname, '..');
const CACHE_DIR = path.join(ROOT, '.local', 'strategy-cache');
const DELAY_MS = 1500;

// Map Eastmoney secid → Tencent code
function toTencentCode(file) {
    const parts = file.replace('.json', '').split('_');
    // index_sh_1_000001_101_fqt1_lmt1000.json
    // stock_600519_1_600519_101_fqt1_lmt1000.json (stock files use a different format)
    if (parts[0] === 'index') {
        const code = parts[2];
        // Eastmoney secid: 1.000001 = sh, 0.399001 = sz, 0.899050 = bj
        const exchange = parts[1] === '1' ? 'sh' : parts[1] === '0' ? 'sz' : 'bj';
        return `${exchange}${code}`;
    } else if (parts[0] === 'stock') {
        const code = parts[1]; // e.g., "600519"
        const prefix = code.startsWith('6') ? 'sh' : 'sz';
        return `${prefix}${code}`;
    }
    return null;
}

function fetchTencent(code, beg, end) {
    return new Promise((resolve, reject) => {
        const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${code},day,${beg},${end},1000,qfq`;
        const req = https.get(url, { timeout: 15000 }, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                try {
                    const j = JSON.parse(data);
                    const stockData = j.data?.[code];
                    const type = stockData?.qfqday ? 'qfqday' : stockData?.day ? 'day' : null;
                    const klines = type ? stockData[type] : [];
                    if (!klines.length) { resolve([]); return; }
                    const bars = klines.map(k => ({
                        date: k[0],
                        open: parseFloat(k[1]),
                        close: parseFloat(k[2]),
                        high: parseFloat(k[3]),
                        low: parseFloat(k[4]),
                        vol: parseFloat(k[5]),
                        amt: k[6] ? parseFloat(k[6]) : 0
                    }));
                    resolve(bars);
                } catch (e) { reject(new Error(`Parse error: ${e.message}`)); }
            });
        });
        req.on('error', e => reject(e));
        req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    });
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
    const cacheFiles = fs.readdirSync(CACHE_DIR).filter(f => f.endsWith('.json') && f.startsWith('index_'));
    // Only do indices first since they're ~8; stocks take longer
    const stockFiles = fs.readdirSync(CACHE_DIR).filter(f => f.endsWith('.json') && f.startsWith('stock_'));
    const allFiles = [...cacheFiles, ...stockFiles];

    process.stdout.write(`📥 扩展历史数据: ${allFiles.length} 个标的\n`);
    process.stdout.write(`数据源: 腾讯前复权 → 补 2021-01-01 起缺失数据\n\n`);

    let extended = 0, unchanged = 0, failed = 0;

    for (let i = 0; i < allFiles.length; i++) {
        const file = allFiles[i];
        const filePath = path.join(CACHE_DIR, file);
        const tcCode = toTencentCode(file);
        if (!tcCode) { failed++; process.stdout.write(`  ❌ ${file}: 无法映射腾讯代码\n`); continue; }

        try {
            const existing = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            const items = Array.isArray(existing) ? existing : (existing.items || existing.data || []);
            if (!items.length) { unchanged++; continue; }

            const firstDate = items[0]?.date;
            if (!firstDate) { unchanged++; continue; }

            // If data already starts in 2021, skip
            if (firstDate <= '2021-01-10') { unchanged++; continue; }

            // Fetch earlier data
            const older = await fetchTencent(tcCode, '2021-01-01', firstDate);
            if (!older.length) { unchanged++; process.stdout.write(`  ${'  '}${file.match(/\d+/)?.[0] || '?'} 无早期数据\n`); continue; }

            // Filter to only dates before existing data start
            const newBars = older.filter(b => b.date < firstDate);
            if (!newBars.length) { unchanged++; continue; }

            // Merge: new data + existing data
            const merged = [...newBars, ...items];
            // Remove any potential duplicates by date
            const seen = new Set();
            const deduped = merged.filter(b => {
                if (seen.has(b.date)) return false;
                seen.add(b.date);
                return true;
            });
            deduped.sort((a, b) => a.date.localeCompare(b.date));

            fs.writeFileSync(filePath, JSON.stringify(deduped), 'utf8');
            extended++;
            const shortCode = file.match(/\d+/)?.[0] || '?';
            const pct = Math.round((i + 1) / allFiles.length * 100);
            process.stdout.write(`  [${String(pct).padStart(2)}%] ✅ ${shortCode}: +${newBars.length}根 (${newBars[0].date}~${newBars[newBars.length-1].date}) → 共${deduped.length}根\n`);
        } catch (e) {
            failed++;
            process.stdout.write(`  ❌ ${file}: ${e.message}\n`);
        }

        await sleep(DELAY_MS);
    }

    process.stdout.write(`\n══════════════════════\n`);
    process.stdout.write(`扩展: ${extended} | 无需扩展: ${unchanged} | 失败: ${failed}\n`);
    process.stdout.write(`数据源: 腾讯前复权 → 东方财富前复权合并\n`);
    process.stdout.write(`注意: 扩展后需重新运行基线: node scripts/strategy-iteration.js baseline\n`);
}

main().catch(e => { process.stderr.write(`${e.message}\n`); process.exit(1); });
