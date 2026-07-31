#!/usr/bin/env node

const fs = require('fs');
const https = require('https');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CACHE_DIR = path.join(ROOT, '.local', 'strategy-cache');
const LOG_DIR = path.join(ROOT, '.local', 'strategy-fetch-logs');
const UNIVERSE_PATH = path.join(ROOT, 'strategy-validation-universe.json');
const MAX_NEW_SYMBOLS = 12;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_HISTORY_PAGES = 12;

function readJson(file) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function parseArgs(argv) {
    const args = new Map();
    for (let index = 0; index < argv.length; index++) {
        const value = argv[index];
        if (!value.startsWith('--')) continue;
        const key = value.slice(2);
        const next = argv[index + 1];
        args.set(key, next && !next.startsWith('--') ? next : true);
    }
    return args;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function requestText(url, timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
        const request = https.get(url, { headers: { 'User-Agent': 'DailyGlance-local-validation/1.0' } }, response => {
            let body = '';
            response.setEncoding('utf8');
            response.on('data', chunk => { body += chunk; });
            response.on('end', () => {
                if (response.statusCode >= 200 && response.statusCode < 300) resolve(body);
                else reject(new Error(`HTTP ${response.statusCode}`));
            });
        });
        request.setTimeout(timeoutMs, () => request.destroy(new Error('request timeout')));
        request.on('error', reject);
    });
}

function number(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function normalizeRows(rows) {
    const normalized = rows.map(row => ({
        date: String(row.date || ''),
        open: number(row.open),
        close: number(row.close),
        high: number(row.high),
        low: number(row.low),
        vol: number(row.vol) || 0,
        amt: number(row.amt) || 0
    })).filter(row => /^\d{4}-\d{2}-\d{2}$/.test(row.date)
        && row.open != null && row.close != null && row.high != null && row.low != null
        && row.close > 0 && row.high >= row.low);
    const deduped = new Map();
    for (const row of normalized) deduped.set(row.date, row);
    return [...deduped.values()].sort((left, right) => left.date.localeCompare(right.date));
}

function getHistoryStart(args) {
    const value = args.get('history-start');
    if (value === undefined) return '';
    if (value === true) throw new Error('--history-start requires a YYYY-MM-DD value');
    if (!ISO_DATE.test(String(value))) throw new Error('--history-start must use YYYY-MM-DD');
    return String(value);
}

function mergeHistoryRows(...rowSets) {
    return normalizeRows(rowSets.flat());
}

function previousCalendarDate(date) {
    const value = new Date(`${date}T00:00:00Z`);
    value.setUTCDate(value.getUTCDate() - 1);
    return value.toISOString().slice(0, 10);
}

function assertHistoryCompatible(primaryRows, historyRows) {
    const historyByDate = new Map(historyRows.map(row => [row.date, row]));
    const shared = primaryRows.map(row => [row, historyByDate.get(row.date)]).filter(([, history]) => history);
    for (const [primary, history] of shared) {
        const closeRatio = Number(history.close) / Number(primary.close);
        if (!Number.isFinite(closeRatio) || Math.abs(closeRatio - 1) > 0.02) {
            throw new Error(`history price basis mismatch on ${primary.date}`);
        }
    }
}

async function fetchPagedHistory(fetchPage, startDate, endDate) {
    const pages = [];
    let pageEnd = endDate;
    let stopReason = 'page_limit';
    for (let pageNumber = 0; pageNumber < MAX_HISTORY_PAGES && pageEnd >= startDate; pageNumber++) {
        const rows = await fetchPage(startDate, pageEnd);
        if (!rows.length) {
            stopReason = pages.length ? 'source_exhausted' : 'no_history';
            break;
        }
        pages.push(rows);
        const earliest = rows[0].date;
        if (earliest <= startDate) {
            stopReason = 'target_reached';
            break;
        }
        const nextEnd = previousCalendarDate(earliest);
        if (nextEnd >= pageEnd) {
            stopReason = 'date_stalled';
            break;
        }
        pageEnd = nextEnd;
    }
    return { rows: mergeHistoryRows(...pages), pages: pages.length, stopReason };
}

function marketForCode(code) {
    return /^(5|6|9)/.test(code) ? '1' : '0';
}

function tencentSymbolForCode(code) {
    return marketForCode(code) === '1' ? `sh${code}` : `sz${code}`;
}

function tickFlowSymbolForCode(code) {
    return `${code}.${marketForCode(code) === '1' ? 'SH' : 'SZ'}`;
}

const TICKFLOW_DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
});

function formatTickFlowDate(timestamp) {
    const date = new Date(Number(timestamp));
    if (Number.isNaN(date.getTime())) return '';
    const parts = {};
    TICKFLOW_DATE_FORMATTER.formatToParts(date).forEach(part => { parts[part.type] = part.value; });
    return parts.year && parts.month && parts.day ? `${parts.year}-${parts.month}-${parts.day}` : '';
}

async function fetchTickFlowRows(symbol) {
    const query = new URLSearchParams({
        symbol,
        period: '1d',
        count: '1000',
        adjust: 'forward_additive'
    });
    const payload = JSON.parse(await requestText(`https://free-api.tickflow.org/v1/klines?${query}`));
    const columns = payload?.data;
    const fields = ['timestamp', 'open', 'high', 'low', 'close', 'volume', 'amount'];
    if (!columns || fields.some(field => !Array.isArray(columns[field]))) throw new Error('tickflow response has no kline columns');
    const rowCount = Math.min(...fields.map(field => columns[field].length));
    const rows = normalizeRows(Array.from({ length: rowCount }, (_, index) => ({
        date: formatTickFlowDate(columns.timestamp[index]),
        open: columns.open[index],
        close: columns.close[index],
        high: columns.high[index],
        low: columns.low[index],
        vol: columns.volume[index],
        amt: columns.amount[index]
    })));
    if (rows.length < 140) throw new Error(`tickflow rows too short: ${rows.length}`);
    return rows;
}

function cacheFileForCode(code) {
    return `stock_${code}_${marketForCode(code)}_${code}_101_fqt1_lmt1000.json`;
}

async function fetchEastmoney(code) {
    const secid = `${marketForCode(code)}.${code}`;
    const query = new URLSearchParams({
        secid,
        fields1: 'f1,f2,f3,f4,f5,f6',
        fields2: 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61',
        klt: '101',
        fqt: '1',
        end: '20500101',
        lmt: '1000'
    });
    const payload = JSON.parse(await requestText(`https://push2his.eastmoney.com/api/qt/stock/kline/get?${query}`));
    const klines = payload?.data?.klines;
    if (!Array.isArray(klines)) throw new Error('eastmoney response has no klines');
    const rows = normalizeRows(klines.map(line => {
        const parts = String(line).split(',');
        return { date: parts[0], open: parts[1], close: parts[2], high: parts[3], low: parts[4], vol: parts[5], amt: parts[6] };
    }));
    if (rows.length < 140) throw new Error(`eastmoney rows too short: ${rows.length}`);
    return { source: 'eastmoney-qfq', rows };
}

async function fetchTickFlow(code) {
    return { source: 'tickflow-forward-additive', rows: await fetchTickFlowRows(tickFlowSymbolForCode(code)) };
}

async function fetchTencent(code) {
    const symbol = tencentSymbolForCode(code);
    const variable = `dg_qfq_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const payloadText = await requestText(`https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${symbol},day,,,1000,qfq&_var=${variable}`);
    const jsonText = payloadText.slice(payloadText.indexOf('=') + 1).replace(/;\s*$/, '').trim();
    if (!jsonText) throw new Error('tencent response has no JSON payload');
    const payload = JSON.parse(jsonText);
    const klines = payload?.data?.[symbol]?.qfqday || payload?.data?.[symbol]?.day;
    if (!Array.isArray(klines)) throw new Error('tencent response has no qfqday');
    const rows = normalizeRows(klines.map(parts => ({
        date: parts[0], open: parts[1], close: parts[2], high: parts[3], low: parts[4],
        vol: parts[5], amt: parts.length > 6 ? parts[6] : 0
    })));
    if (rows.length < 140) throw new Error(`tencent rows too short: ${rows.length}`);
    return { source: 'tencent-qfq', rows };
}

async function fetchTencentHistoryPage(code, startDate, endDate) {
    const symbol = tencentSymbolForCode(code);
    const variable = `dg_qfq_history_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const payloadText = await requestText(`https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${symbol},day,${startDate},${endDate},1000,qfq&_var=${variable}`);
    const jsonText = payloadText.slice(payloadText.indexOf('=') + 1).replace(/;\s*$/, '').trim();
    if (!jsonText) throw new Error('tencent history response has no JSON payload');
    const payload = JSON.parse(jsonText);
    const klines = payload?.data?.[symbol]?.qfqday || payload?.data?.[symbol]?.day;
    if (!Array.isArray(klines)) throw new Error('tencent history response has no qfqday');
    return normalizeRows(klines.map(parts => ({
        date: parts[0], open: parts[1], close: parts[2], high: parts[3], low: parts[4],
        vol: parts[5], amt: parts.length > 6 ? parts[6] : 0
    })));
}

async function fetchTencentHistory(code, startDate, endDate) {
    return fetchPagedHistory((rangeStart, rangeEnd) => fetchTencentHistoryPage(code, rangeStart, rangeEnd), startDate, endDate);
}

async function fetchRows(code) {
    try {
        return await fetchTickFlow(code);
    } catch (tickflowError) {
        try {
            return await fetchTencent(code);
        } catch (tencentError) {
            try {
                return await fetchEastmoney(code);
            } catch (eastmoneyError) {
                throw new Error(`tickflow: ${tickflowError.message}; tencent: ${tencentError.message}; eastmoney: ${eastmoneyError.message}`);
            }
        }
    }
}

function cacheFileForIndex(sample) {
    const [market, code] = sample.secid.split('.');
    return `index_${sample.id}_${market}_${code}_101_fqt1_lmt1000.json`;
}

async function fetchIndexEastmoney(sample) {
    const query = new URLSearchParams({
        secid: sample.secid,
        fields1: 'f1,f2,f3,f4,f5,f6',
        fields2: 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61',
        klt: '101',
        fqt: '1',
        end: '20500101',
        lmt: '1000'
    });
    const payload = JSON.parse(await requestText(`https://push2his.eastmoney.com/api/qt/stock/kline/get?${query}`));
    const klines = payload?.data?.klines;
    if (!Array.isArray(klines)) throw new Error('eastmoney response has no klines');
    const rows = normalizeRows(klines.map(line => {
        const parts = String(line).split(',');
        return { date: parts[0], open: parts[1], close: parts[2], high: parts[3], low: parts[4], vol: parts[5], amt: parts[6] };
    }));
    if (rows.length < 140) throw new Error(`eastmoney rows too short: ${rows.length}`);
    return { source: 'eastmoney-index', rows };
}

function tickFlowSymbolForIndex(sample) {
    const [market, code] = sample.secid.split('.');
    if (sample.id === 'bz50') return `${code}.BJ`;
    return `${code}.${market === '1' ? 'SH' : 'SZ'}`;
}

async function fetchIndexTickFlow(sample) {
    return { source: 'tickflow-index', rows: await fetchTickFlowRows(tickFlowSymbolForIndex(sample)) };
}

async function fetchIndexTencent(sample) {
    const variable = `dg_index_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const payloadText = await requestText(`https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${sample.tencent},day,,,1000,qfq&_var=${variable}`);
    const jsonText = payloadText.slice(payloadText.indexOf('=') + 1).replace(/;\s*$/, '').trim();
    if (!jsonText) throw new Error('tencent response has no JSON payload');
    const payload = JSON.parse(jsonText);
    const klines = payload?.data?.[sample.tencent]?.qfqday || payload?.data?.[sample.tencent]?.day;
    if (!Array.isArray(klines)) throw new Error('tencent response has no index day data');
    const rows = normalizeRows(klines.map(parts => ({
        date: parts[0], open: parts[1], close: parts[2], high: parts[3], low: parts[4],
        vol: parts[5], amt: parts.length > 6 ? parts[6] : 0
    })));
    if (rows.length < 140) throw new Error(`tencent rows too short: ${rows.length}`);
    return { source: 'tencent-index', rows };
}

async function fetchIndexTencentHistoryPage(sample, startDate, endDate) {
    const variable = `dg_index_history_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const payloadText = await requestText(`https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${sample.tencent},day,${startDate},${endDate},1000,qfq&_var=${variable}`);
    const jsonText = payloadText.slice(payloadText.indexOf('=') + 1).replace(/;\s*$/, '').trim();
    if (!jsonText) throw new Error('tencent index history response has no JSON payload');
    const payload = JSON.parse(jsonText);
    const klines = payload?.data?.[sample.tencent]?.qfqday || payload?.data?.[sample.tencent]?.day;
    if (!Array.isArray(klines)) throw new Error('tencent index history response has no day data');
    return normalizeRows(klines.map(parts => ({
        date: parts[0], open: parts[1], close: parts[2], high: parts[3], low: parts[4],
        vol: parts[5], amt: parts.length > 6 ? parts[6] : 0
    })));
}

async function fetchIndexTencentHistory(sample, startDate, endDate) {
    return fetchPagedHistory((rangeStart, rangeEnd) => fetchIndexTencentHistoryPage(sample, rangeStart, rangeEnd), startDate, endDate);
}

function parseSinaJsonp(payloadText) {
    const firstParen = payloadText.indexOf('(');
    const lastParen = payloadText.lastIndexOf(')');
    if (firstParen >= 0 && lastParen > firstParen) return JSON.parse(payloadText.slice(firstParen + 1, lastParen));
    const equals = payloadText.indexOf('=');
    if (equals >= 0) return JSON.parse(payloadText.slice(equals + 1).replace(/;\s*$/, '').trim());
    throw new Error('sina response has no JSONP payload');
}

async function fetchIndexSina(sample) {
    if (!sample.sina) throw new Error('sina symbol is not configured');
    const callback = `dg_strategy_sina_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const callbackExpr = encodeURIComponent(`window[${JSON.stringify(callback)}]`);
    const payloadText = await requestText(`https://quotes.sina.cn/cn/api/jsonp_v2.php/${callbackExpr}=/CN_MarketDataService.getKLineData?symbol=${sample.sina}&scale=240&ma=no&datalen=1000`);
    const payload = parseSinaJsonp(payloadText);
    if (!Array.isArray(payload)) throw new Error('sina response has no index rows');
    const rows = normalizeRows(payload.map(row => ({
        date: row.day,
        open: row.open,
        close: row.close,
        high: row.high,
        low: row.low,
        vol: Number(row.volume) / 100,
        amt: 0
    })));
    if (rows.length < 140) throw new Error(`sina rows too short: ${rows.length}`);
    return { source: 'sina-index', rows };
}

async function fetchIndexRows(sample) {
    try {
        return await fetchIndexTickFlow(sample);
    } catch (tickflowError) {
        if (sample.sina) {
            try {
                return await fetchIndexSina(sample);
            } catch (sinaError) {
                try {
                    return await fetchIndexEastmoney(sample);
                } catch (eastmoneyError) {
                    try {
                        return await fetchIndexTencent(sample);
                    } catch (tencentError) {
                        throw new Error(`tickflow: ${tickflowError.message}; sina: ${sinaError.message}; eastmoney: ${eastmoneyError.message}; tencent: ${tencentError.message}`);
                    }
                }
            }
        }
        try {
            return await fetchIndexTencent(sample);
        } catch (tencentError) {
            try {
                return await fetchIndexEastmoney(sample);
            } catch (eastmoneyError) {
                throw new Error(`tickflow: ${tickflowError.message}; tencent: ${tencentError.message}; eastmoney: ${eastmoneyError.message}`);
            }
        }
    }
}

async function fetchRequestedIndices(args) {
    const universe = readJson(UNIVERSE_PATH);
    const indexSamples = Object.fromEntries((universe.indices || []).map(sample => [sample.id, sample]));
    const rawRequested = String(args.get('indices') || '');
    const requestedIds = rawRequested === 'all'
        ? Object.keys(indexSamples)
        : rawRequested.split(',').map(id => id.trim()).filter(Boolean);
    const samples = requestedIds.map(id => indexSamples[id]).filter(Boolean);
    if (samples.length !== requestedIds.length) {
        const known = new Set(samples.map(sample => sample.id));
        throw new Error(`unknown index ids: ${requestedIds.filter(id => !known.has(id)).join(',')}`);
    }
    const dryRun = args.has('dry-run');
    const refresh = args.has('refresh');
    const historyStart = getHistoryStart(args);
    if (historyStart && !refresh) throw new Error('--history-start requires --refresh');
    const delayMs = Number(args.get('delay-ms') || 1200);
    if (!Number.isFinite(delayMs) || delayMs < 1200) throw new Error('--delay-ms must be at least 1200');
    const results = [];
    let fetched = 0, cached = 0, failed = 0;
    for (const sample of samples) {
        const cacheFile = cacheFileForIndex(sample);
        const target = path.join(CACHE_DIR, cacheFile);
        const exists = fs.existsSync(target);
        if (exists && !refresh) {
            cached++;
            results.push({ id: sample.id, name: sample.name, action: 'cached', file: cacheFile });
            continue;
        }
        if (dryRun) {
            results.push({ id: sample.id, name: sample.name, action: exists ? 'refresh' : 'fetch', file: cacheFile });
            continue;
        }
        try {
            const response = await fetchIndexRows(sample);
            let rows = response.rows;
            let historyRows = 0;
            let historyPages = 0;
            let historyStopReason = historyStart ? 'already_covered' : 'not_requested';
            if (historyStart && rows[0]?.date > historyStart) {
                const history = await fetchIndexTencentHistory(sample, historyStart, rows[0].date);
                if (history.stopReason === 'page_limit' || history.stopReason === 'date_stalled') {
                    throw new Error(`history coverage incomplete: ${history.stopReason}`);
                }
                assertHistoryCompatible(rows, history.rows);
                historyRows = history.rows.length;
                historyPages = history.pages;
                historyStopReason = history.stopReason;
                rows = mergeHistoryRows(history.rows, rows);
            }
            fs.mkdirSync(CACHE_DIR, { recursive: true });
            fs.writeFileSync(target, JSON.stringify(rows, null, 2));
            fetched++;
            results.push({ id: sample.id, name: sample.name, action: 'fetched', source: response.source, rows: rows.length, first: rows[0].date, last: rows.at(-1).date, historyRows, historyPages, historyStopReason, file: cacheFile });
        } catch (error) {
            failed++;
            results.push({ id: sample.id, name: sample.name, action: 'failed', error: error.message, file: cacheFile });
        }
        if (samples.indexOf(sample) < samples.length - 1) await sleep(delayMs);
    }
    return { generatedAt: new Date().toISOString(), sourcePolicy: 'tickflow-primary-with-tencent-eastmoney-and-bz50-sina-fallback', historyStart, mode: dryRun ? 'dry-run' : (refresh ? 'refresh' : 'fetch'), requested: requestedIds.length, selected: samples.length, cached, fetched, failed, results };
}

function selectStocks(universe, args) {
    const requestedCodes = typeof args.get('codes') === 'string'
        ? new Set(args.get('codes').split(',').map(code => code.trim()).filter(Boolean))
        : null;
    const phase = typeof args.get('phase') === 'string' ? args.get('phase') : null;
    const selected = (universe.stocks || []).filter(stock => {
        if (requestedCodes) return requestedCodes.has(stock.code);
        return phase ? stock.phase === phase : false;
    });
    if (!requestedCodes && !phase) throw new Error('specify --codes code1,code2 or --phase phase1');
    if (requestedCodes && selected.length !== requestedCodes.size) {
        const known = new Set(selected.map(stock => stock.code));
        throw new Error(`unknown sample codes: ${[...requestedCodes].filter(code => !known.has(code)).join(',')}`);
    }
    return selected;
}

function summarizeResult(stock, action, extra = {}) {
    return { code: stock.code, name: stock.name, industry: stock.industry, phase: stock.phase, action, ...extra };
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.has('indices')) {
        const report = await fetchRequestedIndices(args);
        console.log(JSON.stringify(report, null, 2));
        if (report.failed) process.exitCode = 1;
        return;
    }
    const dryRun = args.has('dry-run');
    const refresh = args.has('refresh');
    const historyStart = getHistoryStart(args);
    if (historyStart && !refresh) throw new Error('--history-start requires --refresh');
    const delayMs = Number(args.get('delay-ms') || 1200);
    if (!Number.isFinite(delayMs) || delayMs < 1200) throw new Error('--delay-ms must be at least 1200');
    const universe = readJson(UNIVERSE_PATH);
    const stocks = selectStocks(universe, args);
    const selectedForFetch = refresh
        ? stocks
        : stocks.filter(stock => !fs.existsSync(path.join(CACHE_DIR, cacheFileForCode(stock.code))));
    if (selectedForFetch.length > MAX_NEW_SYMBOLS) {
        throw new Error(`a run may fetch or refresh at most ${MAX_NEW_SYMBOLS} symbols; selected ${selectedForFetch.length}`);
    }
    const results = [];
    let fetched = 0;
    let cached = 0;
    let failed = 0;

    for (const stock of stocks) {
        const cacheFile = cacheFileForCode(stock.code);
        const target = path.join(CACHE_DIR, cacheFile);
        const exists = fs.existsSync(target);
        if (exists && !refresh) {
            cached++;
            results.push(summarizeResult(stock, 'cached', { file: cacheFile }));
            continue;
        }
        if (dryRun) {
            results.push(summarizeResult(stock, exists ? 'refresh' : 'fetch', { file: cacheFile }));
            continue;
        }
        try {
            const response = await fetchRows(stock.code);
            let rows = response.rows;
            let historyRows = 0;
            let historyPages = 0;
            let historyStopReason = historyStart ? 'already_covered' : 'not_requested';
            if (historyStart && rows[0]?.date > historyStart) {
                const history = await fetchTencentHistory(stock.code, historyStart, rows[0].date);
                if (history.stopReason === 'page_limit' || history.stopReason === 'date_stalled') {
                    throw new Error(`history coverage incomplete: ${history.stopReason}`);
                }
                assertHistoryCompatible(rows, history.rows);
                historyRows = history.rows.length;
                historyPages = history.pages;
                historyStopReason = history.stopReason;
                rows = mergeHistoryRows(history.rows, rows);
            }
            fs.mkdirSync(CACHE_DIR, { recursive: true });
            fs.writeFileSync(target, JSON.stringify(rows, null, 2));
            fetched++;
            results.push(summarizeResult(stock, 'fetched', {
                source: response.source,
                rows: rows.length,
                first: rows[0].date,
                last: rows.at(-1).date,
                historyRows,
                historyPages,
                historyStopReason,
                file: cacheFile
            }));
        } catch (error) {
            failed++;
            results.push(summarizeResult(stock, 'failed', { error: error.message, file: cacheFile }));
        }
        if (stocks.indexOf(stock) < stocks.length - 1) await sleep(delayMs);
    }

    const report = {
        generatedAt: new Date().toISOString(),
        sourcePolicy: 'tickflow-forward-additive-with-tencent-and-eastmoney-fallback',
        historyStart,
        mode: dryRun ? 'dry-run' : (refresh ? 'refresh' : 'fetch'),
        requested: stocks.length,
        selected: stocks.length,
        cached,
        fetched,
        failed,
        results
    };
    if (!dryRun) {
        fs.mkdirSync(LOG_DIR, { recursive: true });
        const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
        fs.writeFileSync(path.join(LOG_DIR, `strategy-cache-fetch-${stamp}.json`), JSON.stringify(report, null, 2));
    }
    console.log(JSON.stringify(report, null, 2));
    if (failed) process.exitCode = 1;
}

main().catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
});
