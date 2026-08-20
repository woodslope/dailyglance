const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
// 白胖候选研究已冻结，结论保留在 docs/history/strategy/。

const root = path.resolve(__dirname, '..');
const VERSION = require(path.join(root, 'version.json'));
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const stripInit = (source) => source.replace(/\n\/\/ 启动应用\ninit\(\);\s*$/, '');
const appSource = read('assets/js/05-app.js');
const appSourceNoInit = stripInit(appSource);
const dataSource = read('assets/js/02-data.js');
const strategyConfigSource = read('assets/js/00-strategy-config.js');
const uiConfigSource = read('assets/js/01-config-ui.js');
const configSource = `${strategyConfigSource}\n${uiConfigSource}`;
const indexSource = read('index.html');
const strategyInspectorSource = read('strategy-inspector.html');
const calcSource = read('assets/js/03-calculations.js');
const renderSource = read('assets/js/04-render.js');
const cssSource = read('assets/css/dailyglance.css');
const agentsSource = read('AGENTS.md');
const readmeSource = read('README.md');
const uiDesignSystemSource = read('docs/product/UI_DESIGN_SYSTEM.md');
const productGuideSource = read('docs/product/PRODUCT_DECISION_GUIDE.md');
const dataContractSource = read('docs/data/DATA_CONTRACT.md');
const strategyBaselineSnapshotPath = path.join(root, 'tests', 'strategy-baseline-snapshots.json');
const TEST_FILTER = process.env.TEST_FILTER ? new RegExp(process.env.TEST_FILTER) : null;
let executedTests = 0;

function normalizeStrategyForValidation(strategy) {
    const normalized = {
        buySignals: strategy.buySignals || strategy.buy || [],
        exitSignals: strategy.exitSignals || strategy.exit || [],
        warningSignals: strategy.warningSignals || strategy.warning || [],
        scoreGroups: strategy.scoreGroups || strategy.groups || [],
        windowDays: strategy.windowDays || strategy.window,
        buyThreshold: strategy.buyThreshold || strategy.threshold,
        watchPosition: strategy.watchPosition || 0,
        watchPositionSignals: strategy.watchPositionSignals || [],
        windowSignalGuards: strategy.windowSignalGuards || {},
        holdThreshold: strategy.holdThreshold || 0,
        softInvalidationGraceDays: strategy.softInvalidationGraceDays || 0,
        monotonicSignalLifecycle: !!strategy.monotonicSignalLifecycle,
        l10TrendHandoff: strategy.l10TrendHandoff || null,
        readyPosition: strategy.readyPosition || 0,
        cautiousPosition: strategy.cautiousPosition || 0,
        holdPosition: strategy.holdPosition || 0,
        signalPositions: strategy.signalPositions || {},
        strongExitSignals: strategy.strongExitSignals || []
    };
    const signalWeights = strategy.signalWeights || strategy.weights;
    if (signalWeights) normalized.signalWeights = signalWeights;
    return normalized;
}

function loadStrategyBaselineSnapshots() {
    assert.ok(
        fs.existsSync(strategyBaselineSnapshotPath),
        'missing tests/strategy-baseline-snapshots.json; run the strategy baseline snapshot fixture update intentionally'
    );
    return JSON.parse(fs.readFileSync(strategyBaselineSnapshotPath, 'utf8'));
}

function readJsonFixture(file) {
    return JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
}

function loadBaselineFixtures(snapshots) {
    const fixtures = {};
    for (const sample of snapshots.samples) {
        fixtures[sample.file] = readJsonFixture(sample.file);
        for (const file of Object.values(sample.marketFiles || {})) fixtures[file] = readJsonFixture(file);
    }
    return fixtures;
}

function setupBaselineSnapshotContext({ includeRender = false } = {}) {
    const snapshots = loadStrategyBaselineSnapshots();
    assert.strictEqual(snapshots.schemaVersion, 1);
    assert.ok(!Object.prototype.hasOwnProperty.call(snapshots, 'appBuild'));
    assert.strictEqual(snapshots.signalVersion, VERSION.signalVersion);
    assert.ok(Array.isArray(snapshots.samples) && snapshots.samples.length >= 5);

    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(dataSource, context);
    vm.runInContext(calcSource, context);
    if (includeRender) vm.runInContext(renderSource, context);
    context.__baselineSnapshots = snapshots;
    context.__baselineFixtures = loadBaselineFixtures(snapshots);
    vm.runInContext(`
        function cloneRows(rows) {
            return rows.map(row => ({ ...row }));
        }
        function loadBaselineSample(sample) {
            setActiveStrategy(sample.strategy);
            state.mode = sample.mode;
            state.period = 'daily';
            state.id = sample.id;
            state.stockId = sample.mode === 'stock' ? sample.id : null;
            resetIndicatorState();
            derivedIndicatorCache.clear();
            dateIndexCache.clear();
            renderCache.clear();
            state.rawData = {};
            state.weeklyData = {};
            for (const [id, file] of Object.entries(sample.marketFiles || {})) {
                state.rawData[id] = cloneRows(__baselineFixtures[file]);
                state.weeklyData[id] = convertDailyToWeekly(state.rawData[id]);
            }
            const full = cloneRows(__baselineFixtures[sample.file]);
            state.rawData[sample.id] = full;
            state.weeklyData[sample.id] = convertDailyToWeekly(full);
            updateAllIndicators();
            const idx = findDateIndex(full, sample.date, sample.id);
            const row = full[idx];
            const meta = getSignalMeta(idx, full, state.indicators);
            return { idx, full, row, meta };
        }
        function summarizeLoadedBaselineSample(sample) {
            const loaded = loadBaselineSample(sample);
            const decision = loaded.row?._decision;
            return {
                key: sample.key,
                id: sample.id,
                mode: sample.mode,
                strategy: sample.strategy,
                date: sample.date,
                close: loaded.row?.close ?? null,
                windowScore: loaded.meta.windowScore,
                windowSignals: loaded.meta.windowSignals.map(item => item.signal),
                buySignals: loaded.meta.buySignals,
                exitSignals: loaded.meta.exitSignals,
                warningSignals: loaded.meta.warningSignals,
                type: loaded.meta.type,
                position: decision?.position ?? null,
                bsMark: decision?.bsMark ?? null,
                simpleAction: decision?.simpleAction ?? null,
                marketLabel: decision?.market?.label ?? null,
                riskLevel: decision?.risk?.level ?? null,
                exitLevel: decision?.exit?.level ?? null
            };
        }
    `, context);
    return { context, snapshots };
}

function readScriptConstant(scriptSource, name) {
    const context = {
        require,
        console,
        process: { argv: [] },
        __dirname: path.join(root, 'scripts')
    };
    vm.createContext(context);
    vm.runInContext(
        scriptSource
            .replace(/\nmain\(\);\s*$/, '')
            .replace(`const ${name} =`, `var ${name} =`),
        context
    );
    return JSON.parse(JSON.stringify(vm.runInContext(name, context)));
}

function makeBrowserContext(extra = {}) {
    const elements = new Map();
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
            getElementById(id) {
                if (!elements.has(id)) elements.set(id, makeEl());
                return elements.get(id);
            },
            createElement() { return makeEl(); },
            head: makeEl()
        },
        window: {},
        indexedDB: {
            open() {
                return {};
            }
        },
        ...extra
    };
    context.window = context;
    return vm.createContext(context);
}

async function runTest(name, fn) {
    if (TEST_FILTER && !TEST_FILTER.test(name)) return;
    executedTests++;
    try {
        await fn();
        console.log(`ok - ${name}`);
    } catch (error) {
        console.error(`not ok - ${name}`);
        console.error(error.stack || error.message);
        process.exitCode = 1;
    }
}

const REGRESSION_GROUPS = ["data-cache","strategy-decision","presentation-state","chart-navigation","watchlist-lifecycle"];
const requestedRegressionGroups = process.env.TEST_GROUP
    ? process.env.TEST_GROUP.split(',').map(group => group.trim()).filter(Boolean)
    : REGRESSION_GROUPS;
const unknownRegressionGroups = requestedRegressionGroups.filter(group => !REGRESSION_GROUPS.includes(group));
if (unknownRegressionGroups.length) throw new Error(`unknown regression group: ${unknownRegressionGroups.join(', ')}`);
const selectedRegressionGroups = requestedRegressionGroups;

for (const group of selectedRegressionGroups) {
    const groupSource = read(`tests/regression/${group}.cases.js`);
    eval(groupSource);
}

if (executedTests === 0) throw new Error('no regression tests matched the requested group/filter');
