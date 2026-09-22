#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const {
    stableHash,
    hashFile,
    getBaselinePolicyContract,
    summarizePerformance,
    summarizeEvaluationRows,
    buildCalendarWindows,
    buildScenarioSummaries,
    buildTemporalSummaries
} = require('./strategy-evaluator');

const ROOT = path.resolve(__dirname, '..');
const CACHE_DIR = path.join(ROOT, '.local', 'strategy-cache');
const REPORT_DIR = path.join(ROOT, '.local', 'strategy-reports');
const UNIVERSE_PATH = path.join(ROOT, 'strategy-validation-universe.json');
const POLICY_PATH = path.join(ROOT, 'strategy-validation-policy.json');
const INDEX_IDS = ['sh', 'sz', 'hs300', 'zz500', 'zz1000', 'cy', 'kc50', 'bz50'];
const INDEX_NAMES = { sh: '上证指数', sz: '深证成指', hs300: '沪深300', zz500: '中证500', zz1000: '中证1000', cy: '创业板指', kc50: '科创50', bz50: '北证50' };
const FORMAL_STRATEGIES = ['稳健趋势型', '波段抄底型', '突破追涨型', '综合全能型'];
const SCREEN_STOCK_PHASES = ['seed'];
const VALIDATION_POLICY = JSON.parse(fs.readFileSync(POLICY_PATH, 'utf8'));
const START_INDEX = VALIDATION_POLICY.baselineStartIndex;
const COST_RATE = VALIDATION_POLICY.costScenarios.find(item => item.id === 'standard')?.costRate || 0.001;
const showProgress = process.argv.includes('--progress');

function read(file) {
    return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

function readJson(file) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
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

function round(value, digits = 4) {
    return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function mean(values) {
    const valid = values.filter(Number.isFinite);
    return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : NaN;
}

function makeBrowserContext() {
    const storage = new Map();
    const makeEl = () => ({
        style: {}, dataset: {}, innerHTML: '', innerText: '', textContent: '', disabled: false,
        classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} },
        focus() {}, querySelector() { return null; }, querySelectorAll() { return []; },
        addEventListener() {}, appendChild() {}, remove() {}
    });
    const context = {
        console, setTimeout, clearTimeout, setInterval, clearInterval,
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
            hidden: false, addEventListener() {}, querySelector() { return makeEl(); },
            querySelectorAll() { return []; }, getElementById() { return makeEl(); },
            createElement() { return makeEl(); }, head: makeEl()
        },
        window: {}, indexedDB: { open() { return {}; } }
    };
    context.window = context;
    return vm.createContext(context);
}

function createProductionContext(indexData) {
    const context = makeBrowserContext();
    vm.runInContext(`${read('assets/js/00-strategy-config.js')}\n${read('assets/js/01-config-ui.js')}`, context);
    vm.runInContext(read('assets/js/02-data.js'), context);
    vm.runInContext([
        'assets/js/03-calculations.js',
        'assets/js/03-explain.js',
        'assets/js/03-summary.js',
        'assets/js/03-wave-regime.js',
        'assets/js/03-wave-rejection.js',
        'assets/js/03-decision.js'
    ].map(read).join('\n'), context);
    context.__indexData = Object.fromEntries(Object.entries(indexData).map(([id, rows]) => [id, cloneRows(rows)]));
    vm.runInContext(`
        state.period = 'daily';
        state.rawData = {};
        state.weeklyData = {};
        state.liveBars = {};
        state.liveQuotes = {};
        state.liveWeeklyData = {};
        state.liveOverlayCache = {};
        for (const id of Object.keys(__indexData)) {
            state.rawData[id] = __indexData[id].map(row => ({ ...row }));
            state.weeklyData[id] = convertDailyToWeekly(state.rawData[id]);
        }
    `, context);
    return context;
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
            symbols.push({ id, name: INDEX_NAMES[id], mode: 'index', rows, cacheFile: file });
        }
    }
    for (const stock of universe.stocks || []) {
        const file = files.find(name => name.startsWith(`stock_${stock.code}_`));
        if (!file) continue;
        const rows = readJson(path.join(CACHE_DIR, file));
        if (Array.isArray(rows) && rows.length >= 140) {
            symbols.push({
                id: stock.code, name: stock.name, mode: 'stock', industry: stock.industry,
                phase: stock.phase, tags: stock.tags || [], rows, cacheFile: file
            });
        }
    }
    return { universe, indexData, symbols };
}

function selectScreenSymbols(symbols) {
    const phases = new Set(SCREEN_STOCK_PHASES);
    return symbols.filter(symbol => symbol.mode === 'index' || phases.has(symbol.phase));
}

function resetActiveSymbolData(context) {
    vm.runInContext(`
        for (const id of Object.keys(state.rawData)) {
            if (!Object.prototype.hasOwnProperty.call(__indexData, id)) delete state.rawData[id];
        }
        for (const id of Object.keys(state.weeklyData)) {
            if (!Object.prototype.hasOwnProperty.call(__indexData, id)) delete state.weeklyData[id];
        }
        state.liveBars = {};
        state.liveQuotes = {};
        state.liveWeeklyData = {};
        state.liveOverlayCache = {};
        derivedIndicatorCache.clear();
        dateIndexCache.clear();
    `, context);
}

function prepareSymbolContext(context, symbol) {
    context.__symbol = { id: symbol.id, mode: symbol.mode, rows: cloneRows(symbol.rows) };
    resetActiveSymbolData(context);
    return JSON.parse(vm.runInContext(`
        (function() {
            state.mode = __symbol.mode;
            state.id = __symbol.id;
            state.stockId = __symbol.mode === 'stock' ? __symbol.id : null;
            state.period = 'daily';
            state.rawData[__symbol.id] = __symbol.rows.map(row => ({ ...row }));
            state.weeklyData[__symbol.id] = convertDailyToWeekly(state.rawData[__symbol.id]);
            resetIndicatorState();
            const full = state.rawData[__symbol.id];
            MA_OPTIONS.forEach(n => { state.indicators.ma[n] = Calcs.ma(full, n); });
            state.indicators.macd = Calcs.macd(full);
            state.indicators.rsi = Calcs.rsi(full);
            state.indicators.kdj = Calcs.kdj(full);
            for (let idx = 0; idx < full.length; idx++) {
                full[idx]._signals = calculateDailySignals(idx, full, state.indicators);
                full[idx]._signalVersion = SIGNAL_VERSION;
            }
            return JSON.stringify({
                rawSignals: full.map(row => row._signals || []),
                indicators: state.indicators
            });
        })()
    `, context));
}

function runProductionChain(context, symbol, strategy, prepared) {
    context.__symbol = {
        id: symbol.id,
        mode: symbol.mode,
        rows: cloneRows(symbol.rows),
        strategy,
        rawSignals: prepared.rawSignals,
        indicators: prepared.indicators
    };
    return JSON.parse(vm.runInContext(`
        (function() {
            if (!setActiveStrategy(__symbol.strategy)) throw new Error('unknown formal strategy: ' + __symbol.strategy);
            state.strategy = __symbol.strategy;
            state.mode = __symbol.mode;
            state.id = __symbol.id;
            state.stockId = __symbol.mode === 'stock' ? __symbol.id : null;
            state.rawData[__symbol.id] = __symbol.rows.map((row, idx) => ({
                ...row,
                _signals: [...(__symbol.rawSignals[idx] || [])],
                _signalVersion: SIGNAL_VERSION
            }));
            state.weeklyData[__symbol.id] = convertDailyToWeekly(state.rawData[__symbol.id]);
            state.indicators = __symbol.indicators;
            state.indicatorKey = '';
            state.pendingIndicatorMutation = { mode: 'strategy-only', startIdx: 0 };
            updateAllIndicators();
            return JSON.stringify({
                appBuild: APP_BUILD,
                signalVersion: SIGNAL_VERSION,
                rows: state.rawData[__symbol.id].map(row => ({
                    date: row.date, close: row.close, position: row._decision?.position || 0,
                    bsMark: row._decision?.bsMark || null, simpleAction: row._decision?.simpleAction || ''
                }))
            });
        })()
    `, context));
}

function summarize(rows) {
    return summarizePerformance(rows, { startIndex: START_INDEX, costRate: COST_RATE });
}

function summarizeCohort(rows) {
    return summarizeEvaluationRows(rows);
}

function summarizeNestedPerformance(rows, key, ids) {
    return Object.fromEntries(ids.map(id => {
        const selected = rows
            .filter(row => row[key]?.[id])
            .map(row => ({ ...row, performance: row[key][id], bs: { b: 0, s: 0 } }));
        return [id, summarizeEvaluationRows(selected)];
    }));
}

function summarizeStrategy(rows) {
    const stocks = rows.filter(row => row.mode === 'stock');
    const phases = ['seed', 'phase1', 'phase2', 'phase3'];
    const tags = ['defensive', 'cyclical', 'stress', 'highVolatility', 'growth', 'technology', 'dividend'];
    const byPhase = Object.fromEntries(phases
        .map(phase => [phase, stocks.filter(row => row.phase === phase)])
        .filter(([, cohort]) => cohort.length)
        .map(([phase, cohort]) => [phase, summarizeCohort(cohort)]));
    const byTag = Object.fromEntries(tags
        .map(tag => [tag, stocks.filter(row => row.tags.includes(tag))])
        .filter(([, cohort]) => cohort.length)
        .map(([tag, cohort]) => [tag, summarizeCohort(cohort)]));
    const aggregate = summarizeCohort(rows);
    return {
        ...aggregate,
        performance: {
            ...aggregate.performance,
            stockAvgStrategyRet: round(mean(stocks.map(row => row.performance.ret))),
            stockAvgMaxDrawdown: round(mean(stocks.map(row => row.performance.maxDrawdown)))
        },
        cohorts: {
            stocks: summarizeCohort(stocks),
            indices: summarizeCohort(rows.filter(row => row.mode === 'index')),
            byPhase,
            byTag
        },
        scenarios: summarizeNestedPerformance(rows, 'scenarios', VALIDATION_POLICY.costScenarios.map(item => item.id)),
        temporal: summarizeNestedPerformance(rows, 'temporal', rows[0] ? Object.keys(rows[0].temporal || {}) : []),
        symbolsDetail: rows
    };
}

function cacheCoverage(universe, symbols) {
    const stockCodes = new Set(symbols.filter(symbol => symbol.mode === 'stock').map(symbol => symbol.id));
    return {
        stocks: {
            total: (universe.stocks || []).length,
            cached: stockCodes.size
        },
        indices: {
            total: INDEX_IDS.length,
            cached: symbols.filter(symbol => symbol.mode === 'index').length
        }
    };
}

function main() {
    const loaded = loadCacheSymbols();
    const commonAsOf = loaded.symbols.map(symbol => symbol.rows.at(-1)?.date).filter(Boolean).sort()[0] || '';
    const symbols = loaded.symbols.map(symbol => ({
        ...symbol,
        rows: symbol.rows.filter(row => !commonAsOf || row.date <= commonAsOf)
    }));
    const universe = loaded.universe;
    const indexData = Object.fromEntries(symbols.filter(symbol => symbol.mode === 'index').map(symbol => [symbol.id, symbol.rows]));
    if (Object.keys(indexData).length !== INDEX_IDS.length) throw new Error('missing full index cache for market context');
    if (symbols.some(symbol => symbol.rows.length < 140)) throw new Error('common confirmed cutoff leaves insufficient strategy history');
    const referenceId = VALIDATION_POLICY.temporalWindows.referenceIndex;
    const temporalWindows = buildCalendarWindows(indexData[referenceId] || [], VALIDATION_POLICY);
    if (temporalWindows.length !== VALIDATION_POLICY.temporalWindows.count) throw new Error('insufficient reference history for temporal validation windows');
    const snapshotFiles = symbols.map(symbol => {
        const absolute = path.join(CACHE_DIR, symbol.cacheFile);
        return {
            id: symbol.id,
            file: symbol.cacheFile,
            sha256: hashFile(absolute),
            rows: symbol.rows.length,
            first: symbol.rows[0]?.date || '',
            last: symbol.rows.at(-1)?.date || ''
        };
    });
    const context = createProductionContext(indexData);
    const strategyRows = Object.fromEntries(FORMAL_STRATEGIES.map(strategy => [strategy, []]));
    let appBuild = '';
    let signalVersion = '';

    for (const [symbolIndex, symbol] of symbols.entries()) {
        const prepared = prepareSymbolContext(context, symbol);
        for (const strategy of FORMAL_STRATEGIES) {
            const result = runProductionChain(context, symbol, strategy, prepared);
            appBuild = result.appBuild || appBuild;
            signalVersion = result.signalVersion || signalVersion;
            const performance = summarize(result.rows);
            strategyRows[strategy].push({
                id: symbol.id, name: symbol.name, mode: symbol.mode, phase: symbol.phase || null,
                industry: symbol.industry || null, tags: symbol.tags || [], cacheFile: symbol.cacheFile,
                dateRange: { first: result.rows[0]?.date || '', last: result.rows.at(-1)?.date || '', rows: result.rows.length },
                performance,
                scenarios: buildScenarioSummaries(result.rows, VALIDATION_POLICY),
                temporal: buildTemporalSummaries(result.rows, temporalWindows, VALIDATION_POLICY),
                bs: {
                    b: result.rows.slice(START_INDEX).filter(row => row.bsMark === 'B').length,
                    s: result.rows.slice(START_INDEX).filter(row => row.bsMark === 'S').length
                }
            });
        }
        if (showProgress) console.error(`[formal-baseline] ${symbolIndex + 1}/${symbols.length} ${symbol.id}`);
    }
    const strategies = Object.fromEntries(FORMAL_STRATEGIES.map(strategy => [strategy, summarizeStrategy(strategyRows[strategy])]));

    const report = {
        generatedAt: new Date().toISOString(),
        method: 'production-js-vm-local-cache',
        appBuild,
        signalVersion,
        validationPolicy: {
            schemaVersion: VALIDATION_POLICY.schemaVersion,
            policyHash: stableHash(VALIDATION_POLICY),
            baselinePolicyHash: stableHash(getBaselinePolicyContract(VALIDATION_POLICY)),
            baselineContract: getBaselinePolicyContract(VALIDATION_POLICY),
            temporalWindows,
            costScenarios: VALIDATION_POLICY.costScenarios
        },
        dataSnapshot: {
            commonAsOf,
            hash: stableHash(snapshotFiles),
            files: snapshotFiles
        },
        scope: {
            symbols: symbols.length,
            indices: symbols.filter(symbol => symbol.mode === 'index').length,
            stocks: symbols.filter(symbol => symbol.mode === 'stock').length,
            dateRange: {
                first: symbols.map(symbol => symbol.rows[0]?.date).filter(Boolean).sort()[0] || '',
                last: commonAsOf
            }
        },
        coverage: cacheCoverage(universe, symbols),
        strategies
    };
    fs.mkdirSync(REPORT_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
    const reportPath = path.join(REPORT_DIR, `formal-strategy-baseline-${stamp}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({
        reportPath: path.relative(ROOT, reportPath),
        scope: report.scope,
        strategies: Object.fromEntries(Object.entries(strategies).map(([name, item]) => [name, {
            performance: item.performance,
            bs: item.bs,
            holding: item.holding,
            trades: item.trades
        }]))
    }, null, 2));
}

if (require.main === module) main();

module.exports = {
    FORMAL_STRATEGIES,
    SCREEN_STOCK_PHASES,
    START_INDEX,
    cloneRows,
    createProductionContext,
    loadCacheSymbols,
    resetActiveSymbolData,
    selectScreenSymbols,
    prepareSymbolContext,
    runProductionChain
};
