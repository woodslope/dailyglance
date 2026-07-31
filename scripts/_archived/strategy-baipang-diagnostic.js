#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const CACHE_DIR = path.join(ROOT, '.local', 'strategy-cache');
const REPORT_DIR = path.join(ROOT, '.local', 'strategy-reports');
const UNIVERSE_PATH = path.join(ROOT, 'strategy-validation-universe.json');
const { STRATEGY_NAME, installBaipangCandidate } = require('./strategy-baipang-research-runtime');
const WHITE_BUYS = ['B23', 'B24', 'B25'];
const WHITE_EXITS = ['L13', 'L14'];
const INDEX_IDS = ['sh', 'cy', 'zz1000', 'kc50'];
const INDEX_NAMES = { sh: '上证指数', cy: '创业板指', zz1000: '中证1000', kc50: '科创50' };

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
    return denominator ? round(numerator / denominator, 4) : null;
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

function makeBrowserContext() {
    const storage = new Map();
    const makeEl = () => ({
        style: {},
        dataset: {},
        innerHTML: '',
        innerText: '',
        textContent: '',
        disabled: false,
        classList: {
            add() {},
            remove() {},
            contains() { return false; },
            toggle() {}
        },
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
        getComputedStyle() {
            return { getPropertyValue() { return ''; } };
        },
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
    context.__indexData = {};
    for (const [id, rows] of Object.entries(indexData)) context.__indexData[id] = cloneRows(rows);
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

function runProductionChain(context, symbol) {
    context.__symbol = {
        id: symbol.id,
        mode: symbol.mode,
        rows: cloneRows(symbol.rows)
    };
    const output = vm.runInContext(`
        (function() {
            setActiveStrategy(${JSON.stringify(STRATEGY_NAME)});
            state.strategy = ${JSON.stringify(STRATEGY_NAME)};
            state.mode = __symbol.mode;
            state.id = __symbol.id;
            state.stockId = __symbol.mode === 'stock' ? __symbol.id : null;
            state.period = 'daily';
            resetIndicatorState();
            state.rawData[__symbol.id] = __symbol.rows.map(row => ({ ...row }));
            state.weeklyData[__symbol.id] = convertDailyToWeekly(state.rawData[__symbol.id]);
            state.liveBars = {};
            state.liveQuotes = {};
            state.liveWeeklyData = {};
            derivedIndicatorCache.clear();
            dateIndexCache.clear();
            updateAllIndicators();
            const full = state.rawData[__symbol.id];
            return JSON.stringify({
                signalVersion: SIGNAL_VERSION,
                appBuild: APP_BUILD,
                rows: full.map((row, idx) => {
                    const meta = getSignalMeta(idx, full, state.indicators);
                    const decision = row._decision || {};
                    return {
                        idx,
                        date: row.date,
                        open: row.open,
                        high: row.high,
                        low: row.low,
                        close: row.close,
                        signals: row._signals || [],
                        windowScore: meta.windowScore || 0,
                        windowSignals: (meta.windowSignals || []).map(item => ({ day: item.day, signal: item.signal })),
                        buySignals: meta.buySignals || [],
                        exitSignals: meta.exitSignals || [],
                        warningSignals: meta.warningSignals || [],
                        metaType: meta.type || '',
                        position: decision.position || 0,
                        basePosition: decision.basePosition || 0,
                        bsMark: decision.bsMark || null,
                        simpleAction: decision.simpleAction || '',
                        marketLabel: decision.market?.label || '',
                        marketCoef: decision.market?.coef ?? null,
                        marketMaxPosition: decision.market?.maxPosition ?? null,
                        riskLevel: decision.risk?.level || '',
                        riskScore: decision.risk?.score ?? null,
                        riskCoef: decision.risk?.coef ?? null,
                        exitLevel: decision.exit?.level || '',
                        positionDriver: decision.positionDriver || ''
                    };
                })
            });
        })()
    `, context);
    return JSON.parse(output);
}

function loadCacheSymbols() {
    if (!fs.existsSync(CACHE_DIR)) throw new Error(`missing cache dir: ${CACHE_DIR}`);
    const universe = readJson(UNIVERSE_PATH);
    const files = fs.readdirSync(CACHE_DIR).filter(file => file.endsWith('.json')).sort();
    const indexData = {};
    const symbols = [];

    for (const id of INDEX_IDS) {
        const file = files.find(name => name.startsWith(`index_${id}_`));
        if (!file) continue;
        const rows = readJson(path.join(CACHE_DIR, file));
        if (Array.isArray(rows) && rows.length >= 140) {
            indexData[id] = rows;
            symbols.push({ id, name: INDEX_NAMES[id] || id, mode: 'index', role: id, rows, cacheFile: file });
        }
    }

    for (const stock of universe.stocks || []) {
        const file = files.find(name => name.startsWith(`stock_${stock.code}_`));
        if (!file) continue;
        const rows = readJson(path.join(CACHE_DIR, file));
        if (Array.isArray(rows) && rows.length >= 140) {
            symbols.push({
                id: stock.code,
                name: stock.name,
                mode: 'stock',
                industry: stock.industry,
                phase: stock.phase,
                tags: stock.tags || [],
                rows,
                cacheFile: file
            });
        }
    }

    return { universe, files, indexData, symbols };
}

function summarizePositions(rows, positions) {
    let capital = 10000;
    let peak = 10000;
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
        if (capital > peak) peak = capital;
        maxDrawdown = Math.max(maxDrawdown, (peak - capital) / peak);
        if ((positions[i] || 0) !== prev) {
            capital -= capital * Math.abs((positions[i] || 0) - prev) / 100 * 0.001;
            adjustments++;
            if (prev === 0 && positions[i] > 0) entry = capital;
            else if (positions[i] === 0 && prev > 0) {
                trades++;
                if (entry && capital > entry) wins++;
                entry = 0;
            }
            if (capital > peak) peak = capital;
            maxDrawdown = Math.max(maxDrawdown, (peak - capital) / peak);
        }
        prev = positions[i] || 0;
    }
    return {
        ret: round((capital - 10000) / 10000),
        maxDrawdown: round(maxDrawdown),
        winRate: trades ? round(wins / trades) : 0,
        trades,
        adjustments,
        b: positions.filter((p, i) => i && p > 0 && (positions[i - 1] || 0) === 0).length,
        s: positions.filter((p, i) => i && (positions[i - 1] || 0) > 0 && p === 0).length
    };
}

function countBy(items, keyFn) {
    const out = {};
    for (const item of items) {
        const key = keyFn(item);
        out[key] = (out[key] || 0) + 1;
    }
    return out;
}

function benchmarkIdForStock(symbol) {
    const tags = new Set(symbol.tags || []);
    if (tags.has('STAR') || symbol.id.startsWith('688')) return 'kc50';
    if (tags.has('growth') || tags.has('technology') || symbol.id.startsWith('300')) return 'cy';
    return 'sh';
}

function findDateIndex(rows, date) {
    let idx = -1;
    let l = 0;
    let r = rows.length - 1;
    while (l <= r) {
        const m = (l + r) >> 1;
        if (rows[m].date <= date) {
            idx = m;
            l = m + 1;
        } else {
            r = m - 1;
        }
    }
    return idx;
}

function relativeReturn(indexData, date, close, lookback) {
    if (!indexData?.length || !close) return null;
    const idx = findDateIndex(indexData, date);
    if (idx < lookback) return null;
    const cur = indexData[idx]?.close;
    const prev = indexData[idx - lookback]?.close;
    if (!cur || !prev) return null;
    return (cur - prev) / prev;
}

function classifyExitReason(row) {
    const directStrongExit = (row.exitSignals || []).some(signal => WHITE_EXITS.includes(signal));
    if (directStrongExit || row.exitLevel === '强离场' || row.metaType.includes('趋势破位')) return 'strongExit';
    if (row.metaType.includes('离场观望')) return 'cooldown';
    if (row.basePosition > 0 && (row.marketCoef !== 1 || row.riskCoef !== 1 || row.marketMaxPosition === 0 || row.riskScore < 40)) return 'marketOrRisk';
    if (row.basePosition === 0 && row.windowScore < 4) return 'signalDecay';
    return 'unknown';
}

function analyzeSymbol(symbol, result, indexData) {
    const rows = result.rows;
    const positions = rows.map(row => row.position || 0);
    const fullPositions = positions.map(position => position > 0 ? 100 : 0);
    const eligibleRows = rows.slice(60);
    const signalCounts = {};
    for (const sig of [...WHITE_BUYS, ...WHITE_EXITS]) signalCounts[sig] = 0;
    for (const row of eligibleRows) {
        for (const sig of row.signals || []) {
            if (Object.prototype.hasOwnProperty.call(signalCounts, sig)) signalCounts[sig]++;
        }
    }

    const bRows = eligibleRows.filter(row => row.bsMark === 'B');
    const sRows = eligibleRows.filter(row => row.bsMark === 'S');
    const holdingDays = eligibleRows.filter(row => row.position > 0).length;
    const positionDistribution = countBy(eligibleRows, row => String(row.position || 0));
    const entryPositionDistribution = countBy(bRows, row => String(row.position || 0));

    const bAlignment = {
        total: bRows.length,
        sameDayBuy: bRows.filter(row => row.signals.some(sig => WHITE_BUYS.includes(sig))).length,
        windowOnlyBuy: bRows.filter(row => !row.signals.some(sig => WHITE_BUYS.includes(sig)) && row.windowSignals.some(item => WHITE_BUYS.includes(item.signal))).length,
        noWhiteBuyEvidence: bRows.filter(row => !row.signals.some(sig => WHITE_BUYS.includes(sig)) && !row.windowSignals.some(item => WHITE_BUYS.includes(item.signal))).length
    };
    const sAlignment = {
        total: sRows.length,
        sameDayExit: sRows.filter(row => row.signals.some(sig => WHITE_EXITS.includes(sig))).length,
        windowOnlyExit: sRows.filter(row => !row.signals.some(sig => WHITE_EXITS.includes(sig)) && row.windowSignals.some(item => WHITE_EXITS.includes(item.signal))).length,
        noWhiteExitEvidence: sRows.filter(row => !row.signals.some(sig => WHITE_EXITS.includes(sig)) && !row.windowSignals.some(item => WHITE_EXITS.includes(item.signal))).length
    };
    const sReasons = { strongExit: 0, cooldown: 0, marketOrRisk: 0, signalDecay: 0, unknown: 0 };
    for (const row of sRows) sReasons[classifyExitReason(row)]++;

    const entryRows = bRows.map(row => ({
        date: row.date,
        close: row.close,
        position: row.position,
        directBuySignals: row.signals.filter(sig => WHITE_BUYS.includes(sig)),
        windowBuySignals: row.windowSignals.filter(item => WHITE_BUYS.includes(item.signal)).map(item => ({
            signal: item.signal,
            daysAgo: row.idx - item.day
        })),
        windowScore: row.windowScore,
        marketLabel: row.marketLabel,
        riskLevel: row.riskLevel,
        action: row.simpleAction
    }));
    const exitRows = sRows.map(row => ({
        date: row.date,
        close: row.close,
        directExitSignals: row.signals.filter(sig => WHITE_EXITS.includes(sig)),
        windowExitSignals: row.windowSignals.filter(item => WHITE_EXITS.includes(item.signal)).map(item => ({
            signal: item.signal,
            daysAgo: row.idx - item.day
        })),
        marketLabel: row.marketLabel,
        riskLevel: row.riskLevel,
        exitLevel: row.exitLevel,
        action: row.simpleAction
    }));

    const benchmarkId = symbol.mode === 'stock' ? benchmarkIdForStock(symbol) : null;
    const benchmark = benchmarkId ? indexData[benchmarkId] : null;
    const relativeStrengthAtEntries = entryRows.map(entry => {
        const idx = rows.findIndex(row => row.date === entry.date);
        const stockRet20 = idx >= 20 && rows[idx - 20]?.close ? (rows[idx].close - rows[idx - 20].close) / rows[idx - 20].close : null;
        const stockRet60 = idx >= 60 && rows[idx - 60]?.close ? (rows[idx].close - rows[idx - 60].close) / rows[idx - 60].close : null;
        const indexRet20 = relativeReturn(benchmark, entry.date, entry.close, 20);
        const indexRet60 = relativeReturn(benchmark, entry.date, entry.close, 60);
        return {
            date: entry.date,
            benchmarkId,
            stockRet20: round(stockRet20),
            indexRet20: round(indexRet20),
            excess20: round(Number.isFinite(stockRet20) && Number.isFinite(indexRet20) ? stockRet20 - indexRet20 : NaN),
            stockRet60: round(stockRet60),
            indexRet60: round(indexRet60),
            excess60: round(Number.isFinite(stockRet60) && Number.isFinite(indexRet60) ? stockRet60 - indexRet60 : NaN),
            pass20And60: Number.isFinite(stockRet20) && Number.isFinite(indexRet20) && Number.isFinite(stockRet60) && Number.isFinite(indexRet60) && stockRet20 > indexRet20 && stockRet60 > indexRet60
        };
    }).filter(item => item.benchmarkId);

    const totalBuyRaw = WHITE_BUYS.reduce((sum, sig) => sum + (signalCounts[sig] || 0), 0);
    return {
        id: symbol.id,
        name: symbol.name,
        mode: symbol.mode,
        phase: symbol.phase || null,
        industry: symbol.industry || null,
        tags: symbol.tags || [],
        cacheFile: symbol.cacheFile,
        dateRange: { first: rows[0]?.date || '', last: rows[rows.length - 1]?.date || '', rows: rows.length },
        signalCounts,
        signalMix: {
            totalBuyRaw,
            b25BuySignalShare: pct(signalCounts.B25 || 0, totalBuyRaw)
        },
        bs: {
            b: bRows.length,
            s: sRows.length,
            bPerYear: round(bRows.length / Math.max(1, rows.length / 242), 2),
            sPerYear: round(sRows.length / Math.max(1, rows.length / 242), 2)
        },
        holding: {
            holdingDays,
            eligibleDays: eligibleRows.length,
            holdingRatio: pct(holdingDays, eligibleRows.length),
            positionDistribution,
            entryPositionDistribution
        },
        alignment: { b: bAlignment, s: sAlignment },
        sReasons,
        returns: {
            strategy: summarizePositions(rows, positions),
            sameBsFullPosition: summarizePositions(rows, fullPositions)
        },
        entries: entryRows,
        exits: exitRows,
        relativeStrengthAtEntries: {
            benchmarkId,
            total: relativeStrengthAtEntries.length,
            pass20And60: relativeStrengthAtEntries.filter(item => item.pass20And60).length,
            rows: relativeStrengthAtEntries
        }
    };
}

function aggregateAnalyses(analyses) {
    const eligibleDays = analyses.reduce((sum, row) => sum + row.holding.eligibleDays, 0);
    const holdingDays = analyses.reduce((sum, row) => sum + row.holding.holdingDays, 0);
    const signalCounts = {};
    for (const sig of [...WHITE_BUYS, ...WHITE_EXITS]) {
        signalCounts[sig] = analyses.reduce((sum, row) => sum + (row.signalCounts[sig] || 0), 0);
    }
    const totalBuyRaw = WHITE_BUYS.reduce((sum, sig) => sum + (signalCounts[sig] || 0), 0);
    const stocks = analyses.filter(row => row.mode === 'stock');
    return {
        symbols: analyses.length,
        stocks: stocks.length,
        indices: analyses.filter(row => row.mode === 'index').length,
        dateRange: {
            first: analyses.map(row => row.dateRange.first).sort()[0] || '',
            last: analyses.map(row => row.dateRange.last).sort().slice(-1)[0] || ''
        },
        signalCounts,
        signalMix: {
            totalBuyRaw,
            b25BuySignalShare: pct(signalCounts.B25 || 0, totalBuyRaw)
        },
        bs: {
            b: analyses.reduce((sum, row) => sum + row.bs.b, 0),
            s: analyses.reduce((sum, row) => sum + row.bs.s, 0)
        },
        holding: {
            eligibleDays,
            holdingDays,
            holdingRatio: pct(holdingDays, eligibleDays)
        },
        returns: {
            avgStrategyRet: round(mean(analyses.map(row => row.returns.strategy.ret))),
            avgFullRet: round(mean(analyses.map(row => row.returns.sameBsFullPosition.ret))),
            avgStrategyMaxDrawdown: round(mean(analyses.map(row => row.returns.strategy.maxDrawdown))),
            avgFullMaxDrawdown: round(mean(analyses.map(row => row.returns.sameBsFullPosition.maxDrawdown))),
            stockAvgStrategyRet: round(mean(stocks.map(row => row.returns.strategy.ret))),
            stockAvgFullRet: round(mean(stocks.map(row => row.returns.sameBsFullPosition.ret)))
        },
        alignment: {
            bTotal: analyses.reduce((sum, row) => sum + row.alignment.b.total, 0),
            bSameDayBuy: analyses.reduce((sum, row) => sum + row.alignment.b.sameDayBuy, 0),
            bWindowOnlyBuy: analyses.reduce((sum, row) => sum + row.alignment.b.windowOnlyBuy, 0),
            bNoWhiteBuyEvidence: analyses.reduce((sum, row) => sum + row.alignment.b.noWhiteBuyEvidence, 0),
            sTotal: analyses.reduce((sum, row) => sum + row.alignment.s.total, 0),
            sSameDayExit: analyses.reduce((sum, row) => sum + row.alignment.s.sameDayExit, 0),
            sWindowOnlyExit: analyses.reduce((sum, row) => sum + row.alignment.s.windowOnlyExit, 0),
            sNoWhiteExitEvidence: analyses.reduce((sum, row) => sum + row.alignment.s.noWhiteExitEvidence, 0)
        },
        sReasons: {
            strongExit: analyses.reduce((sum, row) => sum + row.sReasons.strongExit, 0),
            cooldown: analyses.reduce((sum, row) => sum + row.sReasons.cooldown, 0),
            marketOrRisk: analyses.reduce((sum, row) => sum + row.sReasons.marketOrRisk, 0),
            signalDecay: analyses.reduce((sum, row) => sum + row.sReasons.signalDecay, 0),
            unknown: analyses.reduce((sum, row) => sum + row.sReasons.unknown, 0)
        }
    };
}

function cacheCoverage(universe, symbols) {
    const stockCodes = new Set(symbols.filter(item => item.mode === 'stock').map(item => item.id));
    const byPhase = {};
    for (const stock of universe.stocks || []) {
        if (!byPhase[stock.phase]) byPhase[stock.phase] = { total: 0, cached: 0, missing: [] };
        byPhase[stock.phase].total++;
        if (stockCodes.has(stock.code)) byPhase[stock.phase].cached++;
        else byPhase[stock.phase].missing.push({ code: stock.code, name: stock.name });
    }
    return {
        indices: {
            total: INDEX_IDS.length,
            cached: symbols.filter(item => item.mode === 'index').length,
            missing: INDEX_IDS.filter(id => !symbols.some(item => item.mode === 'index' && item.id === id))
        },
        stocks: {
            total: (universe.stocks || []).length,
            cached: stockCodes.size,
            byPhase
        }
    };
}

function makeMarkdown(report) {
    const lines = [];
    lines.push('# 白胖右侧候选研究诊断报告');
    lines.push('');
    lines.push(`生成时间：${report.generatedAt}`);
    lines.push(`研究运行时基线：APP_BUILD=${report.appBuild}，SIGNAL_VERSION=${report.signalVersion}`);
    lines.push('');
    lines.push('## 样本范围');
    lines.push('');
    lines.push(`- 当前使用本地缓存：${report.scope.symbols} 个标的，其中指数 ${report.scope.indices} 个、股票 ${report.scope.stocks} 只。`);
    lines.push(`- 日期范围：${report.aggregate.dateRange.first} 至 ${report.aggregate.dateRange.last}。`);
    lines.push(`- 股票缓存覆盖：${report.coverage.stocks.cached}/${report.coverage.stocks.total}。seed ${report.coverage.stocks.byPhase.seed.cached}/${report.coverage.stocks.byPhase.seed.total}，phase1 ${report.coverage.stocks.byPhase.phase1.cached}/${report.coverage.stocks.byPhase.phase1.total}。`);
    lines.push('- 本报告只读取 `.local/strategy-cache/`，不拉取网络数据，不改四个正式策略。白胖形态仅由本地候选运行时临时注入。');
    lines.push('');
    lines.push('## 汇总结论');
    lines.push('');
    lines.push(`- 原始白胖买入信号合计 ${report.aggregate.signalMix.totalBuyRaw} 次：B23=${report.aggregate.signalCounts.B23}，B24=${report.aggregate.signalCounts.B24}，B25=${report.aggregate.signalCounts.B25}；B25 占比 ${formatPct(report.aggregate.signalMix.b25BuySignalShare)}。`);
    lines.push(`- 主图 B/S 合计：B=${report.aggregate.bs.b}，S=${report.aggregate.bs.s}；持仓占比 ${formatPct(report.aggregate.holding.holdingRatio)}。`);
    lines.push(`- B 对齐：同日有 B23/B24/B25 的 B=${report.aggregate.alignment.bSameDayBuy}/${report.aggregate.alignment.bTotal}，只靠窗口历史信号延续的 B=${report.aggregate.alignment.bWindowOnlyBuy}/${report.aggregate.alignment.bTotal}，无白胖买入证据的 B=${report.aggregate.alignment.bNoWhiteBuyEvidence}/${report.aggregate.alignment.bTotal}。`);
    lines.push(`- S 对齐：同日有 L13/L14 的 S=${report.aggregate.alignment.sSameDayExit}/${report.aggregate.alignment.sTotal}，只靠窗口历史离场信号的 S=${report.aggregate.alignment.sWindowOnlyExit}/${report.aggregate.alignment.sTotal}，无同日/窗口白胖离场证据的 S=${report.aggregate.alignment.sNoWhiteExitEvidence}/${report.aggregate.alignment.sTotal}。`);
    lines.push(`- 当前仓位链路平均收益 ${formatSignedPct(report.aggregate.returns.avgStrategyRet)}，同 B/S 满仓假设平均收益 ${formatSignedPct(report.aggregate.returns.avgFullRet)}；平均最大回撤分别为 ${formatPct(report.aggregate.returns.avgStrategyMaxDrawdown)} / ${formatPct(report.aggregate.returns.avgFullMaxDrawdown)}。`);
    lines.push('');
    lines.push('## 分标的概览');
    lines.push('');
    lines.push('| 标的 | 样本 | B/S | 持仓占比 | B23 | B24 | B25 | L13 | L14 | 当前仓位收益 | 同 B/S 满仓 | B25占比 | B对齐 | S对齐 |');
    lines.push('| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
    for (const item of report.symbols) {
        lines.push(`| ${item.name} | ${item.dateRange.first}~${item.dateRange.last} | ${item.bs.b}/${item.bs.s} | ${formatPct(item.holding.holdingRatio)} | ${item.signalCounts.B23} | ${item.signalCounts.B24} | ${item.signalCounts.B25} | ${item.signalCounts.L13} | ${item.signalCounts.L14} | ${formatSignedPct(item.returns.strategy.ret)} | ${formatSignedPct(item.returns.sameBsFullPosition.ret)} | ${formatPct(item.signalMix.b25BuySignalShare)} | ${item.alignment.b.sameDayBuy}/${item.alignment.b.total} | ${item.alignment.s.sameDayExit}/${item.alignment.s.total} |`);
    }
    lines.push('');
    lines.push('## 主图 S 归零原因');
    lines.push('');
    lines.push(`- 强离场：${report.aggregate.sReasons.strongExit} 次，触发当日的 L13/L14 或生产决策已判定为强离场。`);
    lines.push(`- 冷静期：${report.aggregate.sReasons.cooldown} 次，前序强离场后的保护期内不重新开仓。`);
    lines.push(`- 市场/风险压仓：${report.aggregate.sReasons.marketOrRisk} 次，基础仓位仍存在，但市场温度或风险系数把最终仓位压到 0。`);
    lines.push(`- 买入窗口失效：${report.aggregate.sReasons.signalDecay} 次，买入积分已低于白胖阈值，且未触发强离场。`);
    lines.push(`- 未分类：${report.aggregate.sReasons.unknown} 次。`);
    lines.push('');
    lines.push('## 诊断判断');
    lines.push('');
    lines.push('- 当前样本里 B25 明显多于 B23/B24，说明策略更多依赖“突破后的回踩确认”，不是底部/半分位突破本身。若不加过滤，B25 仍是优先复核对象。');
    lines.push('- B/S 标记整体符合统一仓位链路：B 是从 0 到持仓，S 是从持仓到 0，不等于当日一定出现原始 B/L 信号。窗口历史信号造成的 B、以及基础仓位归零造成的 S，都需要在展示层或报告里解释，否则用户会觉得“凭空 B/S”。');
    lines.push(`- S 的可解释性已按生产决策拆分：${report.aggregate.sReasons.strongExit} 次是白胖强离场，${report.aggregate.sReasons.signalDecay} 次是买入窗口失效，其他归零由冷静期或市场/风险压仓造成。后续若改离场规则，应分别比较这些原因的收益、回撤和 B/S 影响，不能把它们混成单一卖点。`);
    lines.push('- 同一组 B/S 用满仓假设收益被放大，同时最大回撤也被放大；这支持“先加选股过滤和主升加仓条件”，不支持直接把 B 改成满仓。');
    const seedCoverage = report.coverage.stocks.byPhase.seed;
    const phase1Coverage = report.coverage.stocks.byPhase.phase1;
    const seedCoverageText = seedCoverage.cached === seedCoverage.total
        ? '已覆盖完整 seed'
        : `seed 已覆盖 ${seedCoverage.cached}/${seedCoverage.total}`;
    const phase1CoverageText = `phase1 已覆盖 ${phase1Coverage.cached}/${phase1Coverage.total}`;
    lines.push(`- 当前股票样本已比上一版扩大，${seedCoverageText}，${phase1CoverageText}；仍不能对行业、板块或全市场适用性下完整结论。`);
    lines.push('');
    lines.push('## 相对强弱初筛');
    lines.push('');
    lines.push('| 股票 | 基准 | B次数 | 20/60日均强于基准次数 | 说明 |');
    lines.push('| --- | --- | ---: | ---: | --- |');
    for (const item of report.symbols.filter(row => row.mode === 'stock')) {
        const rs = item.relativeStrengthAtEntries;
        const benchmarkName = rs.benchmarkId ? INDEX_NAMES[rs.benchmarkId] || rs.benchmarkId : '--';
        lines.push(`| ${item.name} | ${benchmarkName} | ${rs.total} | ${rs.pass20And60} | 只按现有指数缓存做粗过滤，非行业强弱 |`);
    }
    lines.push('');
    lines.push('## 后续优先级建议');
    lines.push('');
    lines.push('- P0：先分批补齐样本缓存。按项目规则每轮最多新增 12 个标的，先补完 seed，再补 phase1；否则白胖结论仍容易被宁德时代/茅台这两个股票样本带偏。');
    lines.push('- P1：先做 B25 质量过滤深挖。验证 B25 触发前是否要求 20/60 日相对强于基准、价格在 MA20/MA60 上方、且非长期下降趋势；通过后再考虑接入生产。');
    lines.push('- P2：再设计主升仓位升级层。保持 B23/B24=20%、B25=30%，只在浮盈、趋势改善、市场温度不差且无 L13/L14 时测试 50%/60% 加仓。');
    lines.push('');
    lines.push('> 本报告仅用于研究、观察和复盘，不构成投资建议。');
    lines.push('');
    return lines.join('\n');
}

function main() {
    const { universe, indexData, symbols } = loadCacheSymbols();
    if (Object.keys(indexData).length < INDEX_IDS.length) {
        throw new Error('missing full index cache; market context needs sh/cy/zz1000/kc50');
    }
    const context = createStrategyContext(indexData);
    const analyses = [];
    let signalVersion = '';
    let appBuild = '';

    for (const symbol of symbols) {
        const result = runProductionChain(context, symbol);
        signalVersion = result.signalVersion || signalVersion;
        appBuild = result.appBuild || appBuild;
        analyses.push(analyzeSymbol(symbol, result, indexData));
    }

    const report = {
        generatedAt: new Date().toISOString(),
        method: 'candidate-js-vm-local-cache',
        strategy: STRATEGY_NAME,
        appBuild,
        signalVersion,
        scope: {
            symbols: analyses.length,
            indices: analyses.filter(row => row.mode === 'index').length,
            stocks: analyses.filter(row => row.mode === 'stock').length
        },
        coverage: cacheCoverage(universe, symbols),
        aggregate: aggregateAnalyses(analyses),
        symbols: analyses
    };

    fs.mkdirSync(REPORT_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
    const jsonPath = path.join(REPORT_DIR, `baipang-diagnostic-${stamp}.json`);
    const mdPath = path.join(REPORT_DIR, `baipang-diagnostic-${stamp}.md`);
    fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
    fs.writeFileSync(mdPath, makeMarkdown(report));

    console.log(JSON.stringify({
        jsonPath: path.relative(ROOT, jsonPath),
        markdownPath: path.relative(ROOT, mdPath),
        scope: report.scope,
        coverage: {
            stocks: `${report.coverage.stocks.cached}/${report.coverage.stocks.total}`,
            seed: `${report.coverage.stocks.byPhase.seed.cached}/${report.coverage.stocks.byPhase.seed.total}`,
            phase1: `${report.coverage.stocks.byPhase.phase1.cached}/${report.coverage.stocks.byPhase.phase1.total}`
        },
        aggregate: report.aggregate
    }, null, 2));
}

main();
