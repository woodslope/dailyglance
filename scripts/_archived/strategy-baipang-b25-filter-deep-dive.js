#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const CACHE_DIR = path.join(ROOT, '.local', 'strategy-cache');
const REPORT_DIR = path.join(ROOT, '.local', 'strategy-reports');
const UNIVERSE_PATH = path.join(ROOT, 'strategy-validation-universe.json');
const { STRATEGY_NAME, installBaipangCandidate } = require('./strategy-baipang-research-runtime');
const INDEX_IDS = ['sh', 'cy', 'zz1000', 'kc50'];
const PHASES = new Set(['seed', 'phase1']);

const VARIANTS = {
    baseline: {
        name: '当前基线',
        description: '保留全部原始 B25，不应用质量过滤。',
        passes() { return true; }
    },
    relative_strength: {
        name: '20/60 日相对强弱',
        description: '个股 20 日与 60 日收益均高于对应基准指数。',
        passes(gates) { return gates.relativeStrength; }
    },
    above_ma20_ma60: {
        name: '站上 MA20/MA60',
        description: 'B25 当日收盘价同时高于 20 日和 60 日均线。',
        passes(gates) { return gates.aboveMa20Ma60; }
    },
    not_long_term_downtrend: {
        name: '非长期下跌趋势',
        description: '排除价格低于 MA60、MA20 低于 MA60、且 MA60 近 20 日未上行的完整长期下跌结构。',
        passes(gates) { return gates.notLongTermDowntrend; }
    },
    first_pullback_only: {
        name: '同结构首个 B25',
        description: '每次 B23/B24 突破结构后的 15 日窗口内，只保留首个 B25 回踩确认。',
        passes(gates) { return gates.firstPullbackOnly; }
    },
    combined: {
        name: '三项组合',
        description: '同时满足 20/60 日相对强弱、站上 MA20/MA60、非长期下跌趋势。',
        passes(gates) { return gates.relativeStrength && gates.aboveMa20Ma60 && gates.notLongTermDowntrend; }
    }
};

function read(file) {
    return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

function readJson(file) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function round(value, digits = 4) {
    return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function pct(numerator, denominator) {
    return denominator ? round(numerator / denominator, 4) : 0;
}

function mean(values) {
    const list = values.filter(Number.isFinite);
    return list.length ? list.reduce((sum, value) => sum + value, 0) / list.length : NaN;
}

function formatPct(value) {
    return Number.isFinite(value) ? `${(value * 100).toFixed(2)}%` : '--';
}

function formatSignedPct(value) {
    if (!Number.isFinite(value)) return '--';
    const sign = value > 0 ? '+' : '';
    return `${sign}${(value * 100).toFixed(2)}%`;
}

function cloneRows(rows) {
    return rows.map(row => ({
        date: row.date,
        open: Number(row.open),
        high: Number(row.high),
        low: Number(row.low),
        close: Number(row.close),
        vol: Number(row.vol) || 0,
        amt: Number(row.amt) || 0
    }));
}

function movingAverage(rows, period) {
    const result = Array(rows.length).fill(null);
    let sum = 0;
    for (let i = 0; i < rows.length; i++) {
        sum += Number(rows[i]?.close) || 0;
        if (i >= period) sum -= Number(rows[i - period]?.close) || 0;
        if (i >= period - 1) result[i] = sum / period;
    }
    return result;
}

function findDateIndex(rows, date) {
    let found = -1;
    let left = 0;
    let right = rows.length - 1;
    while (left <= right) {
        const middle = (left + right) >> 1;
        if (rows[middle].date <= date) {
            found = middle;
            left = middle + 1;
        } else {
            right = middle - 1;
        }
    }
    return found;
}

function benchmarkIdForStock(stock) {
    const tags = new Set(stock.tags || []);
    if (tags.has('STAR') || stock.code.startsWith('688')) return 'kc50';
    if (tags.has('growth') || tags.has('technology') || stock.code.startsWith('300')) return 'cy';
    return 'sh';
}

function makeBrowserContext() {
    const storage = new Map();
    const makeEl = () => ({
        style: {},
        dataset: {},
        innerHTML: '',
        innerText: '',
        textContent: '',
        disabled: false,
        classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} },
        focus() {},
        querySelector() { return null; },
        querySelectorAll() { return []; },
        addEventListener() {},
        appendChild() {},
        remove() {}
    });
    const context = {
        console,
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        performance: { now: () => 0 },
        localStorage: {
            getItem(key) { return storage.has(key) ? storage.get(key) : null; },
            setItem(key, value) { storage.set(key, String(value)); },
            removeItem(key) { storage.delete(key); }
        },
        requestAnimationFrame(fn) { return setTimeout(fn, 0); },
        cancelAnimationFrame(id) { clearTimeout(id); },
        getComputedStyle() { return { getPropertyValue() { return ''; } }; },
        document: {
            hidden: false,
            addEventListener() {},
            querySelector() { return makeEl(); },
            querySelectorAll() { return []; },
            getElementById() { return makeEl(); },
            createElement() { return makeEl(); },
            head: makeEl()
        },
        window: {},
        indexedDB: { open() { return {}; } }
    };
    context.window = context;
    return vm.createContext(context);
}

function createStrategyContext(indexData) {
    const context = makeBrowserContext();
    vm.runInContext(read('assets/js/01-config-ui.js'), context);
    vm.runInContext(read('assets/js/02-data.js'), context);
    vm.runInContext(read('assets/js/03-calculations.js'), context);
    installBaipangCandidate(context);
    context.__indexData = Object.fromEntries(Object.entries(indexData).map(([id, rows]) => [id, cloneRows(rows)]));
    vm.runInContext(`
        setActiveStrategy(${JSON.stringify(STRATEGY_NAME)});
        state.strategy = ${JSON.stringify(STRATEGY_NAME)};
        state.period = 'daily';
        state.rawData = {};
        state.weeklyData = {};
        state.liveBars = {};
        state.liveQuotes = {};
        state.liveWeeklyData = {};
        state.liveOverlayCache = {};
        derivedIndicatorCache.clear();
        dateIndexCache.clear();
        for (const id of Object.keys(__indexData)) {
            state.rawData[id] = __indexData[id].map(row => ({ ...row }));
            state.weeklyData[id] = convertDailyToWeekly(state.rawData[id]);
        }
    `, context);
    return context;
}

function runProductionChain(context, stock, signalOverrides = null) {
    context.__stock = { id: stock.code, rows: cloneRows(stock.rows) };
    context.__signalOverrides = signalOverrides ? signalOverrides.map(signals => [...signals]) : null;
    const output = vm.runInContext(`
        (function() {
            setActiveStrategy(${JSON.stringify(STRATEGY_NAME)});
            state.strategy = ${JSON.stringify(STRATEGY_NAME)};
            state.mode = 'stock';
            state.id = __stock.id;
            state.stockId = __stock.id;
            state.period = 'daily';
            resetIndicatorState();
            state.rawData[__stock.id] = __stock.rows.map((row, idx) => {
                const next = { ...row };
                if (__signalOverrides) {
                    next._signals = [...(__signalOverrides[idx] || [])];
                    next._signalVersion = SIGNAL_VERSION;
                }
                return next;
            });
            state.weeklyData[__stock.id] = convertDailyToWeekly(state.rawData[__stock.id]);
            state.liveBars = {};
            state.liveQuotes = {};
            state.liveWeeklyData = {};
            derivedIndicatorCache.clear();
            dateIndexCache.clear();
            updateAllIndicators();
            const full = state.rawData[__stock.id];
            return JSON.stringify({
                appBuild: APP_BUILD,
                signalVersion: SIGNAL_VERSION,
                rows: full.map((row, idx) => ({
                    idx,
                    date: row.date,
                    close: row.close,
                    signals: row._signals || [],
                    position: row._decision?.position || 0,
                    basePosition: row._decision?.basePosition || 0,
                    bsMark: row._decision?.bsMark || null,
                    action: row._decision?.simpleAction || '',
                    marketLabel: row._decision?.market?.label || '',
                    riskScore: row._decision?.risk?.score ?? null,
                    exitLevel: row._decision?.exit?.level || '',
                    windowScore: getSignalMeta(idx, full, state.indicators).windowScore || 0
                }))
            });
        })()
    `, context);
    return JSON.parse(output);
}

function loadCachedData() {
    if (!fs.existsSync(CACHE_DIR)) throw new Error(`missing cache dir: ${CACHE_DIR}`);
    const universe = readJson(UNIVERSE_PATH);
    const files = fs.readdirSync(CACHE_DIR).filter(file => file.endsWith('.json'));
    const indexData = {};
    for (const id of INDEX_IDS) {
        const file = files.find(name => name.startsWith(`index_${id}_`));
        const rows = file ? readJson(path.join(CACHE_DIR, file)) : [];
        if (!Array.isArray(rows) || rows.length < 140) throw new Error(`missing usable index cache: ${id}`);
        indexData[id] = rows;
    }
    const stocks = (universe.stocks || []).filter(stock => PHASES.has(stock.phase)).map(stock => {
        const file = files.find(name => name.startsWith(`stock_${stock.code}_`));
        const rows = file ? readJson(path.join(CACHE_DIR, file)) : null;
        return rows && rows.length >= 140 ? { ...stock, rows, cacheFile: file } : null;
    }).filter(Boolean);
    return { indexData, stocks };
}

function buildGateRows(stock, indexData) {
    const rows = stock.rows;
    const ma20 = movingAverage(rows, 20);
    const ma60 = movingAverage(rows, 60);
    const benchmarkId = benchmarkIdForStock(stock);
    const benchmark = indexData[benchmarkId];
    return rows.map((row, idx) => {
        const benchmarkIdx = findDateIndex(benchmark, row.date);
        const hasReturns = idx >= 60 && benchmarkIdx >= 60 &&
            rows[idx - 20]?.close && rows[idx - 60]?.close &&
            benchmark[benchmarkIdx - 20]?.close && benchmark[benchmarkIdx - 60]?.close;
        const stockRet20 = hasReturns ? (row.close - rows[idx - 20].close) / rows[idx - 20].close : null;
        const stockRet60 = hasReturns ? (row.close - rows[idx - 60].close) / rows[idx - 60].close : null;
        const indexRet20 = hasReturns ? (benchmark[benchmarkIdx].close - benchmark[benchmarkIdx - 20].close) / benchmark[benchmarkIdx - 20].close : null;
        const indexRet60 = hasReturns ? (benchmark[benchmarkIdx].close - benchmark[benchmarkIdx - 60].close) / benchmark[benchmarkIdx - 60].close : null;
        const hasMa = Number.isFinite(ma20[idx]) && Number.isFinite(ma60[idx]);
        const longTermDowntrend = hasMa && idx >= 80 &&
            row.close < ma60[idx] &&
            ma20[idx] < ma60[idx] &&
            ma60[idx] <= ma60[idx - 20];
        return {
            benchmarkId,
            relativeStrength: Number.isFinite(stockRet20) && Number.isFinite(stockRet60) && Number.isFinite(indexRet20) && Number.isFinite(indexRet60) && stockRet20 > indexRet20 && stockRet60 > indexRet60,
            aboveMa20Ma60: hasMa && row.close > ma20[idx] && row.close > ma60[idx],
            notLongTermDowntrend: hasMa && !longTermDowntrend
        };
    });
}

function markFirstPullbackOnly(baselineRows) {
    const result = Array(baselineRows.length).fill(false);
    let structureUntil = -1;
    let firstPullbackSeen = false;
    for (let index = 0; index < baselineRows.length; index++) {
        const signals = baselineRows[index].signals || [];
        if (signals.includes('B23') || signals.includes('B24')) {
            structureUntil = Math.max(structureUntil, index + 15);
            firstPullbackSeen = false;
        }
        if (!signals.includes('B25')) continue;
        if (index > structureUntil || firstPullbackSeen) continue;
        result[index] = true;
        firstPullbackSeen = true;
    }
    return result;
}

function makeSignalOverrides(baselineRows, gates, variant) {
    let raw = 0;
    let retained = 0;
    const firstPullbackOnly = markFirstPullbackOnly(baselineRows);
    const overrides = baselineRows.map((row, idx) => {
        const signals = [...row.signals];
        if (!signals.includes('B25')) return signals;
        raw++;
        if (variant.passes({ ...gates[idx], firstPullbackOnly: firstPullbackOnly[idx] })) {
            retained++;
            return signals;
        }
        return signals.filter(signal => signal !== 'B25');
    });
    return { overrides, raw, retained, filtered: raw - retained };
}

function summarize(result) {
    const rows = result.rows;
    const positions = rows.map(row => row.position || 0);
    let capital = 10000;
    let peak = capital;
    let maxDrawdown = 0;
    let prev = positions[59] || 0;
    let entry = 0;
    let wins = 0;
    let trades = 0;
    let adjustments = 0;
    for (let i = 60; i < rows.length; i++) {
        if (prev > 0 && rows[i - 1]?.close) {
            capital *= 1 + ((rows[i].close - rows[i - 1].close) / rows[i - 1].close) * (prev / 100);
        }
        peak = Math.max(peak, capital);
        maxDrawdown = Math.max(maxDrawdown, (peak - capital) / peak);
        if ((positions[i] || 0) !== prev) {
            capital -= capital * Math.abs((positions[i] || 0) - prev) / 100 * 0.001;
            adjustments++;
            if (prev === 0 && positions[i] > 0) entry = capital;
            if (prev > 0 && positions[i] === 0) {
                trades++;
                if (entry && capital > entry) wins++;
                entry = 0;
            }
        }
        prev = positions[i] || 0;
    }
    const eligible = Math.max(0, rows.length - 60);
    const holdingDays = positions.slice(60).filter(position => position > 0).length;
    return {
        ret: round((capital - 10000) / 10000),
        maxDrawdown: round(maxDrawdown),
        winRate: trades ? round(wins / trades) : 0,
        trades,
        adjustments,
        b: positions.filter((position, idx) => idx > 0 && position > 0 && (positions[idx - 1] || 0) === 0).length,
        s: positions.filter((position, idx) => idx > 0 && position === 0 && (positions[idx - 1] || 0) > 0).length,
        eligibleDays: eligible,
        holdingDays,
        holdingRatio: pct(holdingDays, eligible)
    };
}

function summarizeVariant(rows) {
    const summaries = rows.map(row => row.summary);
    const eligibleDays = summaries.reduce((sum, item) => sum + item.eligibleDays, 0);
    const holdingDays = summaries.reduce((sum, item) => sum + item.holdingDays, 0);
    return {
        b25Raw: rows.reduce((sum, item) => sum + item.b25Raw, 0),
        b25Retained: rows.reduce((sum, item) => sum + item.b25Retained, 0),
        b25Filtered: rows.reduce((sum, item) => sum + item.b25Filtered, 0),
        b25FilterRatio: pct(rows.reduce((sum, item) => sum + item.b25Filtered, 0), rows.reduce((sum, item) => sum + item.b25Raw, 0)),
        performance: {
            avgStrategyRet: round(mean(summaries.map(item => item.ret))),
            avgMaxDrawdown: round(mean(summaries.map(item => item.maxDrawdown))),
            avgWinRate: round(mean(summaries.map(item => item.winRate))),
            avgTrades: round(mean(summaries.map(item => item.trades))),
            avgAdjustments: round(mean(summaries.map(item => item.adjustments)))
        },
        bs: {
            b: summaries.reduce((sum, item) => sum + item.b, 0),
            s: summaries.reduce((sum, item) => sum + item.s, 0)
        },
        holding: {
            eligibleDays,
            holdingDays,
            holdingRatio: pct(holdingDays, eligibleDays)
        }
    };
}

function compareToBaseline(variant, baseline, rows) {
    const betterReturn = rows.filter(row => row.summary.ret > row.baseline.ret).length;
    const lowerDrawdown = rows.filter(row => row.summary.maxDrawdown < row.baseline.maxDrawdown).length;
    const improvedBoth = rows.filter(row => row.summary.ret > row.baseline.ret && row.summary.maxDrawdown <= row.baseline.maxDrawdown).length;
    const comparison = {
        deltaAvgStrategyRet: round(variant.performance.avgStrategyRet - baseline.performance.avgStrategyRet),
        deltaAvgMaxDrawdown: round(variant.performance.avgMaxDrawdown - baseline.performance.avgMaxDrawdown),
        deltaAvgWinRate: round(variant.performance.avgWinRate - baseline.performance.avgWinRate),
        deltaAvgTrades: round(variant.performance.avgTrades - baseline.performance.avgTrades),
        deltaAvgAdjustments: round(variant.performance.avgAdjustments - baseline.performance.avgAdjustments),
        deltaB: variant.bs.b - baseline.bs.b,
        deltaS: variant.bs.s - baseline.bs.s,
        deltaHoldingRatio: round(variant.holding.holdingRatio - baseline.holding.holdingRatio),
        stocksWithHigherReturn: betterReturn,
        stocksWithLowerDrawdown: lowerDrawdown,
        stocksImprovedBoth: improvedBoth
    };
    const hasEvidence = variant.b25Filtered > 0 &&
        comparison.deltaAvgStrategyRet > 0 &&
        comparison.deltaAvgMaxDrawdown <= 0 &&
        improvedBoth > rows.length / 2;
    return {
        ...comparison,
        assessment: hasEvidence ? '值得扩样复核，暂不接入生产' : '当前样本不支持接入生产'
    };
}

function makeMarkdown(report) {
    const lines = [];
    lines.push('# 白胖 B25 质量过滤深挖');
    lines.push('');
    lines.push(`生成时间：${report.generatedAt}`);
    lines.push(`研究运行时基线：APP_BUILD=${report.appBuild}，SIGNAL_VERSION=${report.signalVersion}`);
    lines.push('');
    lines.push('## 范围与方法');
    lines.push('');
    lines.push(`- 样本：本地缓存股票 ${report.scope.stocks} 只，阶段 ${report.scope.phases.join('、')}，日期 ${report.scope.dateRange.first} 至 ${report.scope.dateRange.last}。`);
    lines.push('- 方法：只在原始 B25 出现当天执行候选过滤；通过后才保留 B25，再重新运行本地白胖候选链路。B23/B24、L13/L14、市场温度和风险计算均不改动。');
    lines.push('- 相对强弱基准：growth/technology/300 开头股票用创业板指，科创板用科创50，其余用上证指数。');
    lines.push('');
    lines.push('## 过滤方案');
    lines.push('');
    for (const [id, variant] of Object.entries(VARIANTS)) lines.push(`- ${id}：${variant.description}`);
    lines.push('');
    lines.push('## 聚合结果');
    lines.push('');
    lines.push('| 方案 | B25保留/原始 | 过滤率 | 平均收益 | 平均最大回撤 | B/S | 相对基线收益 | 相对基线回撤 | 同时改善股数 | 结论 |');
    lines.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |');
    for (const [id, variant] of Object.entries(report.variants)) {
        const comparison = report.comparison[id];
        lines.push(`| ${VARIANTS[id].name} | ${variant.b25Retained}/${variant.b25Raw} | ${formatPct(variant.b25FilterRatio)} | ${formatSignedPct(variant.performance.avgStrategyRet)} | ${formatPct(variant.performance.avgMaxDrawdown)} | ${variant.bs.b}/${variant.bs.s} | ${formatSignedPct(comparison.deltaAvgStrategyRet)} | ${formatSignedPct(comparison.deltaAvgMaxDrawdown)} | ${comparison.stocksImprovedBoth}/${report.scope.stocks} | ${comparison.assessment} |`);
    }
    lines.push('');
    lines.push('## 解释边界');
    lines.push('');
    lines.push('- 本报告是本地样本上的离线消融，不构成投资建议，也不代表已改变线上策略。');
    lines.push('- 若任何方案要进入生产，还必须在扩大样本后确认收益、回撤、B/S 密度和行业适用性，并补生产回归。');
    lines.push('');
    return lines.join('\n');
}

function main() {
    const { indexData, stocks } = loadCachedData();
    const variantRows = Object.fromEntries(Object.keys(VARIANTS).map(id => [id, []]));
    let appBuild = '';
    let signalVersion = '';

    for (const stock of stocks) {
        const context = createStrategyContext(indexData);
        const baselineResult = runProductionChain(context, stock);
        appBuild = baselineResult.appBuild || appBuild;
        signalVersion = baselineResult.signalVersion || signalVersion;
        const baseline = summarize(baselineResult);
        const baselineReplay = runProductionChain(context, stock, baselineResult.rows.map(row => row.signals));
        if (JSON.stringify(baselineResult.rows.map(row => [row.position, row.bsMark])) !== JSON.stringify(baselineReplay.rows.map(row => [row.position, row.bsMark]))) {
            throw new Error(`baseline replay mismatch: ${stock.code}`);
        }
        const gates = buildGateRows(stock, indexData);

        for (const [variantId, variant] of Object.entries(VARIANTS)) {
            const filtered = makeSignalOverrides(baselineResult.rows, gates, variant);
            const result = variantId === 'baseline'
                ? baselineResult
                : runProductionChain(context, stock, filtered.overrides);
            variantRows[variantId].push({
                code: stock.code,
                name: stock.name,
                industry: stock.industry,
                phase: stock.phase,
                benchmarkId: gates[0]?.benchmarkId || null,
                b25Raw: filtered.raw,
                b25Retained: filtered.retained,
                b25Filtered: filtered.filtered,
                baseline,
                summary: variantId === 'baseline' ? baseline : summarize(result)
            });
        }
    }

    const variants = Object.fromEntries(Object.entries(variantRows).map(([id, rows]) => [id, summarizeVariant(rows)]));
    const baseline = variants.baseline;
    const comparison = Object.fromEntries(Object.entries(variants).map(([id, variant]) => [
        id,
        id === 'baseline'
            ? { deltaAvgStrategyRet: 0, deltaAvgMaxDrawdown: 0, deltaAvgWinRate: 0, deltaAvgTrades: 0, deltaAvgAdjustments: 0, deltaB: 0, deltaS: 0, deltaHoldingRatio: 0, stocksWithHigherReturn: 0, stocksWithLowerDrawdown: 0, stocksImprovedBoth: 0, assessment: '当前基线，不执行过滤' }
            : compareToBaseline(variant, baseline, variantRows[id])
    ]));
    const dates = stocks.flatMap(stock => [stock.rows[0]?.date, stock.rows.at(-1)?.date]).filter(Boolean).sort();
    const report = {
        generatedAt: new Date().toISOString(),
        method: 'candidate-js-vm-b25-signal-filter',
        strategy: STRATEGY_NAME,
        appBuild,
        signalVersion,
        scope: { phases: [...PHASES], stocks: stocks.length, indices: INDEX_IDS.length, dateRange: { first: dates[0] || '', last: dates.at(-1) || '' } },
        filterDefinitions: Object.fromEntries(Object.entries(VARIANTS).map(([id, variant]) => [id, variant.description])),
        variants,
        comparison,
        rows: variantRows
    };
    fs.mkdirSync(REPORT_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
    const jsonPath = path.join(REPORT_DIR, `baipang-b25-filter-deep-dive-${stamp}.json`);
    const markdownPath = path.join(REPORT_DIR, `baipang-b25-filter-deep-dive-${stamp}.md`);
    fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
    fs.writeFileSync(markdownPath, makeMarkdown(report));
    console.log(JSON.stringify({
        jsonPath: path.relative(ROOT, jsonPath),
        markdownPath: path.relative(ROOT, markdownPath),
        scope: report.scope,
        variants,
        comparison
    }, null, 2));
}

if (require.main === module) main();

module.exports = {
    ROOT,
    CACHE_DIR,
    REPORT_DIR,
    STRATEGY_NAME,
    INDEX_IDS,
    PHASES,
    cloneRows,
    movingAverage,
    createStrategyContext,
    runProductionChain,
    loadCachedData
};
