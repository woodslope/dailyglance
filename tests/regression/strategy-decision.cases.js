runTest('wave B quality requires stock-only scope and sufficient independent time windows', () => {
    const { summarize, passes, getTemporalGate } = require(path.join(root, 'scripts', 'strategy-wave-b-quality-report.js'));
    const candidateReturn = { 5: 0.02, 10: 0.02, 20: 0.03 };
    const candidateDelayedReturn = { 5: 0.015, 10: 0.015, 20: 0.025 };
    const events = Array.from({ length: 30 }, (_, index) => ({
        symbol: `stock-${index}`,
        mode: 'stock',
        year: String(2020 + index % 4),
        outcome: 'success',
        returns: candidateReturn,
        delayedCostReturns: candidateDelayedReturn,
        maxFavorable: 0.03,
        maxAdverse: -0.01
    }));
    const baseline = {
        successRate: 0.3,
        failureRate: 0.65,
        returns: { 5: 0.01, 10: 0.01, 20: 0.01 },
        delayedCostReturns: { 5: 0.005, 10: 0.005, 20: 0.005 }
    };
    const summary = summarize(events, baseline);
    const adequateStages = [
        { samples: 5, return20Advantage: true },
        { samples: 5, return20Advantage: true },
        { samples: 5, return20Advantage: false }
    ];
    const sparseStages = [
        { samples: 13, return20Advantage: true },
        { samples: 2, return20Advantage: true },
        { samples: 2, return20Advantage: true }
    ];
    assert.strictEqual(summary.indices, 0);
    assert.strictEqual(passes(summary, baseline, adequateStages).temporal, true);
    assert.strictEqual(getTemporalGate(sparseStages).pass, false, 'two-sample periods cannot validate a gold B');
    assert.strictEqual(passes(summary, baseline, sparseStages).temporal, false);
    const withIndeterminate = summarize(events.slice(0, 29).concat([{
        ...events[29], outcome: 'indeterminate'
    }]), baseline);
    assert.strictEqual(passes(withIndeterminate, baseline, adequateStages).samples, false, 'unresolved intraday outcomes do not satisfy the minimum classified sample count');
    const rawEdgeCandidate = {
        samples: 30, classifiedSamples: 30, symbols: 10, temporalAdvantages: 3, delayedCostAdvantages: 3,
        successRate: 0.45, failureRate: 0.5, maxSymbolShare: 0.1, maxYearShare: 0.2,
        gateMetrics: {
            successRate: 0.44996, failureRate: 0.5,
            returns: { 5: 0.02, 10: 0.02, 20: 0.02 },
            delayedCostReturns: { 5: 0.02, 10: 0.02, 20: 0.02 },
            maxSymbolShare: 0.1, maxYearShare: 0.2
        }
    };
    const rawEdgeBaseline = {
        successRate: 0.3, failureRate: 0.65,
        returns: { 5: 0.01, 10: 0.01, 20: 0.01 },
        delayedCostReturns: { 5: 0.01, 10: 0.01, 20: 0.01 }
    };
    assert.strictEqual(passes(rawEdgeCandidate, rawEdgeBaseline, adequateStages).success, false, 'rounded display values must not relax the success-rate gate');
    const qualitySource = fs.readFileSync(path.join(root, 'scripts', 'strategy-wave-b-quality-report.js'), 'utf8');
    assert.ok(qualitySource.includes("const symbols = allSymbols.filter(symbol => symbol.mode === 'stock');"));
    assert.ok(qualitySource.includes("质量复核必须显式传入 --signals=B8,B17"));
});

runTest('wave B quality shadow freezes a pre-registered rule and only requests human review after forward evidence', () => {
    const os = require('os');
    const qualityReport = require(path.join(root, 'scripts', 'strategy-wave-b-quality-report.js'));
    const {
        updateQualityShadow,
        validateStrictReport
    } = require(path.join(root, 'scripts', 'strategy-wave-b-quality-shadow.js'));
    const policy = JSON.parse(fs.readFileSync(path.join(root, 'strategy-validation-policy.json'), 'utf8'));
    const registeredRule = policy.waveBQuality.registeredRule;
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dailyglance-wave-quality-'));
    const returnValues = { 5: 0.03, 10: 0.035, 20: 0.04 };
    const delayedReturnValues = { 5: 0.025, 10: 0.03, 20: 0.035 };
    const failureReturns = { 5: -0.01, 10: -0.015, 20: -0.02 };
    const event = (index, date, outcome, returns, delayedCostReturns = returns) => ({
        symbol: `stock-${index}`,
        name: `样本${index}`,
        mode: 'stock',
        date,
        year: date.slice(0, 4),
        signals: ['B8', 'B17'],
        outcome,
        returns,
        delayedCostReturns,
        maxFavorable: 0.05,
        maxAdverse: -0.02
    });
    const oldCandidateEvents = Array.from({ length: 30 }, (_, index) => event(index, '2026-01-05', 'success', returnValues, delayedReturnValues));
    const newCandidateEvents = Array.from({ length: 30 }, (_, index) => event(index, '2026-02-01', 'success', returnValues, delayedReturnValues));
    const oldBaselineEvents = oldCandidateEvents.concat(Array.from({ length: 30 }, (_, index) => event(index + 30, '2026-01-05', 'failure', failureReturns)));
    const newBaselineEvents = newCandidateEvents.concat(Array.from({ length: 30 }, (_, index) => event(index + 30, '2026-02-01', 'failure', failureReturns)));
    const makeReport = ({ commonAsOf, dataHash, candidateEvents, baselineEvents, referenceDates }) => ({
        scope: { stocks: 90, indices: 0 },
        candidateSearch: {
            discoveryEnabled: false,
            featureSearchEnabled: false,
            scoreSearchEnabled: false,
            qualityOnly: false,
            strictReview: true,
            preRegistration: {
                ruleId: registeredRule.id,
                strategy: registeredRule.strategy,
                scope: registeredRule.scope,
                requiredSignals: registeredRule.requiredSignals
            }
        },
        dataSnapshot: {
            commonAsOf,
            hash: dataHash,
            policyHash: 'policy-hash',
            referenceDates
        },
        sourceSnapshot: { hash: 'source-hash' },
        candidates: [{
            id: 'signals_B8_B17',
            requiredSignals: ['B8', 'B17'],
            historicalQualified: true,
            checks: { samples: true },
            temporalGate: { pass: true },
            summary: { samples: 30 },
            eventDetails: candidateEvents
        }],
        forwardData: { baselineEvents }
    });
    try {
        assert.deepStrictEqual(qualityReport.normalizeSignalList(['B17', 'B8']), ['B8', 'B17']);
        const initialReport = makeReport({
            commonAsOf: '2026-01-10',
            dataHash: 'frozen-data-hash',
            candidateEvents: oldCandidateEvents,
            baselineEvents: oldBaselineEvents,
            referenceDates: ['2026-01-05', '2026-01-10']
        });
        const initial = updateQualityShadow(initialReport, {
            root: tempRoot,
            reportFile: 'initial-quality-report.json',
            now: '2026-01-10T16:00:00.000Z'
        });
        assert.strictEqual(initial.observation.status, 'shadow_observe');
        assert.strictEqual(initial.observation.newTradingDays, 0);
        const referenceDates = Array.from({ length: 25 }, (_, index) => `2026-02-${String(index + 1).padStart(2, '0')}`);
        const forwardReport = makeReport({
            commonAsOf: '2026-02-25',
            dataHash: 'forward-data-hash',
            candidateEvents: oldCandidateEvents.concat(newCandidateEvents),
            baselineEvents: oldBaselineEvents.concat(newBaselineEvents),
            referenceDates
        });
        const forward = updateQualityShadow(forwardReport, {
            root: tempRoot,
            reportFile: 'forward-quality-report.json',
            now: '2026-02-25T16:00:00.000Z'
        });
        assert.strictEqual(forward.observation.newTradingDays, 25);
        assert.strictEqual(forward.observation.newMatchedBEvents, 30);
        assert.strictEqual(forward.observation.status, 'recommend_human_review');
        assert.strictEqual(forward.observation.approval, 'manual_only');
        assert.ok(!Object.values(forward.state).includes('approved'));
        assert.throws(() => validateStrictReport({
            ...forwardReport,
            candidateSearch: { ...forwardReport.candidateSearch, strictReview: false }
        }), /严格预注册/);
        assert.throws(() => updateQualityShadow({
            ...forwardReport,
            sourceSnapshot: { hash: 'changed-source-hash' }
        }, { root: tempRoot, reportFile: 'changed-source.json' }), /重新冻结/);
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

runTest('MACD histogram uses A-share display convention of two times DIF minus DEA', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(calcSource, context);
    vm.runInContext(`
        var rows = [10, 11, 12, 11, 13, 14, 13, 15, 16, 15, 17, 18].map(function(close, idx) {
            return { date: '2026-01-' + String(idx + 1).padStart(2, '0'), open: close, high: close + 1, low: close - 1, close, vol: 1000, amt: 10000 };
        });
        var macdFixture = Calcs.macd(rows);
        function emaSeries(values, n) {
            var alpha = 2 / (n + 1);
            var prev = null;
            return values.map(function(value, idx) {
                if (idx === 0) {
                    prev = value;
                    return value;
                }
                prev = value * alpha + prev * (1 - alpha);
                return prev;
            });
        }
        var closes = rows.map(function(row) { return row.close; });
        var ema12 = emaSeries(closes, 12);
        var ema26 = emaSeries(closes, 26);
        var standardDiff = ema12.map(function(value, idx) { return value - ema26[idx]; });
        var standardDea = emaSeries(standardDiff, 9);
        var macdSample = macdFixture.diff.map(function(diff, idx) {
            return {
                diff: Number(diff.toFixed(8)),
                dea: Number(macdFixture.dea[idx].toFixed(8)),
                bar: Number(macdFixture.bar[idx].toFixed(8)),
                expectedBar: Number(((diff - macdFixture.dea[idx]) * 2).toFixed(8)),
                standardDea: Number(standardDea[idx].toFixed(8)),
                standardBar: Number(((standardDiff[idx] - standardDea[idx]) * 2).toFixed(8))
            };
        });
    `, context);
    const sample = JSON.parse(vm.runInContext('JSON.stringify(macdSample)', context));
    assert.ok(sample.some(item => Math.abs(item.expectedBar) > 0.000001), 'fixture should produce non-zero histogram values');
    sample.forEach(item => {
        assert.strictEqual(item.bar, item.expectedBar);
        assert.strictEqual(item.dea, item.standardDea);
        assert.strictEqual(item.bar, item.standardBar);
    });
});

runTest('performance baseline groups traces by label and refresh path', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(`
        window.__DG_PERF__.traces = [
            { label: 'cachedFetchRefreshApply', total: 12.4, meta: { path: 'same-day-light', status: 'applied' }, steps: [] },
            { label: 'cachedFetchRefreshApply', total: 18.6, meta: { path: 'same-day-light', status: 'applied' }, steps: [] },
            { label: 'selectIndex', total: 42.2, meta: { id: 'sh' }, steps: [] }
        ];
        var baseline = window.__DG_PERF__.baseline();
    `, context);
    const baseline = JSON.parse(vm.runInContext('JSON.stringify(baseline)', context));
    assert.deepStrictEqual(baseline, [
        { label: 'cachedFetchRefreshApply', path: 'same-day-light', count: 2, avg: 15.5, max: 18.6, last: 18.6 },
        { label: 'selectIndex', path: '', count: 1, avg: 42.2, max: 42.2, last: 42.2 }
    ]);
});

runTest('strategy switch reuses indicator arrays and daily signals', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(dataSource, context);
    vm.runInContext(calcSource, context);
    vm.runInContext(`
        var rows = [];
        for (var i = 0; i < 120; i++) {
            rows.push({
                date: '2026-03-' + String((i % 28) + 1).padStart(2, '0'),
                open: 100 + i * 0.1,
                high: 102 + i * 0.1,
                low: 99 + i * 0.1,
                close: 101 + i * 0.1,
                vol: 10000 + i,
                amt: 100000 + i
            });
        }
        state.id = 'sh';
        state.mode = 'index';
        state.period = 'daily';
        state.rawData.sh = rows;
        updateAllIndicators();
        var originalSignals = rows[rows.length - 1]._signals;
        var calcCalls = 0;
        var originalMa = Calcs.ma;
        var originalMacd = Calcs.macd;
        var originalRsi = Calcs.rsi;
        var originalKdj = Calcs.kdj;
        var originalMaIncremental = Calcs.maIncremental;
        var originalMacdIncremental = Calcs.macdIncremental;
        var originalRsiIncremental = Calcs.rsiIncremental;
        var originalKdjIncremental = Calcs.kdjIncremental;
        Calcs.ma = function() { calcCalls++; return originalMa.apply(this, arguments); };
        Calcs.macd = function() { calcCalls++; return originalMacd.apply(this, arguments); };
        Calcs.rsi = function() { calcCalls++; return originalRsi.apply(this, arguments); };
        Calcs.kdj = function() { calcCalls++; return originalKdj.apply(this, arguments); };
        Calcs.maIncremental = function() { calcCalls++; return originalMaIncremental.apply(this, arguments); };
        Calcs.macdIncremental = function() { calcCalls++; return originalMacdIncremental.apply(this, arguments); };
        Calcs.rsiIncremental = function() { calcCalls++; return originalRsiIncremental.apply(this, arguments); };
        Calcs.kdjIncremental = function() { calcCalls++; return originalKdjIncremental.apply(this, arguments); };
        setActiveStrategy('综合全能型');
        state.pendingIndicatorMutation = { mode: 'strategy-only', startIdx: 0 };
        markIndicatorsDirty();
        updateAllIndicators();
        var result = {
            calcCalls,
            sameSignals: rows[rows.length - 1]._signals === originalSignals,
            strategy: rows[rows.length - 1]._strategy,
            hasDecision: !!rows[rows.length - 1]._decision
        };
    `, context);
    const result = JSON.parse(vm.runInContext('JSON.stringify(result)', context));
    assert.deepStrictEqual(result, {
        calcCalls: 0,
        sameSignals: true,
        strategy: '综合全能型',
        hasDecision: true
    });
});

runTest('strategy switch performance excludes confirmation wait time', async () => {
    let clock = 0;
    const context = makeBrowserContext({ performance: { now: () => clock } });
    const instrumentedConfigSource = configSource
        .replace("const customConfirm = (msg) => new Promise(resolve => {", "var customConfirm = (msg) => new Promise(resolve => {")
        .replace("const customAlert = (msg, isHtml = false) => new Promise(resolve => {", "var customAlert = (msg, isHtml = false) => new Promise(resolve => {");
    vm.runInContext(instrumentedConfigSource, context);
    vm.runInContext('function getActiveData() { return [{ close: 1 }]; }', context);
    vm.runInContext(appSourceNoInit, context);
    context.__advanceClock = value => { clock += value; };
    await vm.runInContext(`
        (async function() {
            customConfirm = async () => { __advanceClock(5000); return true; };
            state.indicators = { ma: {}, macd: {}, rsi: {}, kdj: {} };
            renderSettings = () => {};
            markIndicatorsDirty = () => {};
            updateAllIndicators = () => { __advanceClock(10); };
            draw = () => {};
            safeUpdateSidebar = () => {};
            refreshWatchlistSignalSnapshots = () => {};
            renderWatchlist = () => {};
            await switchStrategy('综合全能型');
        })()
    `, context);
    const trace = JSON.parse(vm.runInContext('JSON.stringify(window.__DG_PERF__.latest("switchStrategy"))', context));
    assert.strictEqual(trace.total, 10);
    assert.strictEqual(trace.steps[0].step, 'indicators');
    assert.strictEqual(trace.steps[0].duration, 10);
});

runTest('strategy tracking signal tag uses a subdued status style', () => {
    assert.ok(cssSource.includes('.signal-row .tag'), 'signal tag style should exist');
    assert.ok(!cssSource.includes('.signal-row .tag { flex-shrink: 0; background: var(--dark-bg);'), 'strategy tracking tag should not use a heavy black fill');
    assert.ok(cssSource.includes('rgba(55, 101, 237, 0.08)'), 'strategy tracking tag should use the governed action-blue tint');
});

runTest('switching strategies clears stale signal weight overrides', async () => {
    const context = makeBrowserContext();
    const instrumentedConfigSource = configSource
        .replace("const customConfirm = (msg) => new Promise(resolve => {", "var customConfirm = (msg) => new Promise(resolve => {")
        .replace("const customAlert = (msg, isHtml = false) => new Promise(resolve => {", "var customAlert = (msg, isHtml = false) => new Promise(resolve => {");
    vm.runInContext(instrumentedConfigSource, context);
    vm.runInContext('function getActiveData() { return null; }', context);
    vm.runInContext(appSourceNoInit, context);
    await vm.runInContext(`
        (async function() {
            customConfirm = async () => true;
            renderSettings = () => {};
            updateAllIndicators = () => {};
            draw = () => {};
            safeUpdateSidebar = () => {};
            refreshWatchlistSignalSnapshots = () => {};
            renderWatchlist = () => {};
            await switchStrategy('突破追涨型');
            await switchStrategy('稳健趋势型');
        })()
    `, context);
    assert.strictEqual(vm.runInContext('state.strategy', context), '稳健趋势型');
    assert.strictEqual(vm.runInContext('STRATEGY.signalWeights', context), undefined);
    assert.strictEqual(vm.runInContext('getSignalScore("B4")', context), 2);
});

runTest('B8 remains a bottom-fishing signal but is not a composite strategy driver', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    assert.strictEqual(vm.runInContext('STRATEGIES["波段抄底型"].buySignals.includes("B8")', context), true);
    assert.strictEqual(vm.runInContext('STRATEGIES["波段抄底型"].scoreGroups.some(group => group.includes("B8"))', context), true);
    assert.strictEqual(vm.runInContext('STRATEGIES["综合全能型"].buySignals.includes("B8")', context), false);
    assert.strictEqual(vm.runInContext('STRATEGIES["综合全能型"].scoreGroups.some(group => group.includes("B8"))', context), false);
});

runTest('bottom-fishing B8 needs recent repair evidence before it contributes to the decision window', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext('function convertDailyToWeekly() { return []; }', context);
    vm.runInContext(calcSource, context);
    vm.runInContext(renderSource, context);
    vm.runInContext(`
        setActiveStrategy('波段抄底型');
        state.period = 'daily';
        var full = Array.from({ length: 70 }, (_, index) => ({
            date: '2026-01-' + String(index + 1).padStart(2, '0'),
            open: 100, high: 101, low: 99, close: 100, vol: 1000, _signals: []
        }));
        var indicators = {
            ma: { 5: [], 10: [], 20: [], 60: [] },
            macd: { diff: [], dea: [] },
            rsi: { val: [] },
            kdj: { k: [], d: [], j: [] }
        };
        full[64]._signals = ['B8'];
        var isolatedB8 = getSignalMeta(64, full, indicators);
        full[62]._signals = ['B5'];
        var confirmedB8 = getSignalMeta(64, full, indicators);
    `, context);
    assert.strictEqual(vm.runInContext('isolatedB8.windowScore', context), 0);
    assert.deepStrictEqual(JSON.parse(vm.runInContext('JSON.stringify(isolatedB8.windowSignals)', context)), []);
    assert.strictEqual(vm.runInContext('confirmedB8.windowScore', context), 3);
    assert.deepStrictEqual(
        JSON.parse(vm.runInContext('JSON.stringify(confirmedB8.windowSignals.map(item => item.signal))', context)),
        ['B5', 'B8']
    );
});

runTest('bottom-fishing B8 expires after a dead cross and only a fresh cross can score again', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext('function convertDailyToWeekly() { return []; }', context);
    vm.runInContext(calcSource, context);
    vm.runInContext(`
        setActiveStrategy('波段抄底型');
        state.period = 'daily';
        var full = Array.from({ length: 70 }, (_, index) => ({
            date: '2026-01-' + String(index + 1).padStart(2, '0'),
            open: 100, high: 101, low: 99, close: 100, vol: 1000, _signals: []
        }));
        var indicators = {
            ma: { 5: [], 10: [], 20: [], 60: [] },
            macd: { diff: [], dea: [] },
            rsi: { val: [] },
            kdj: {
                k: Array.from({ length: 70 }, () => 10),
                d: Array.from({ length: 70 }, () => 20),
                j: Array.from({ length: 70 }, () => -10)
            }
        };
        full[62]._signals = ['B5'];
        full[64]._signals = ['B8'];
        indicators.kdj.k[64] = 25;
        indicators.kdj.d[64] = 20;
        indicators.kdj.k[65] = 15;
        indicators.kdj.d[65] = 20;
        indicators.kdj.k[66] = 25;
        indicators.kdj.d[66] = 20;
        var freshCrossMeta = getSignalMeta(64, full, indicators);
        var deadCrossMeta = getSignalMeta(65, full, indicators);
        var recoveredWithoutFreshCross = getSignalMeta(66, full, indicators);
        full[66]._signals = ['B5', 'B8'];
        var secondFreshCrossMeta = getSignalMeta(66, full, indicators);
    `, context);
    assert.strictEqual(vm.runInContext('freshCrossMeta.windowScore', context), 3);
    assert.strictEqual(vm.runInContext('deadCrossMeta.windowScore', context), 2);
    assert.strictEqual(vm.runInContext('recoveredWithoutFreshCross.windowScore', context), 2);
    assert.deepStrictEqual(
        JSON.parse(vm.runInContext('JSON.stringify(deadCrossMeta.invalidatedWindowSignals)', context)),
        [{ signal: 'B8', day: 64, signalDate: '2026-01-65', score: 1, reason: 'kdj-dead-cross', invalidationDay: 65, invalidationDate: '2026-01-66', invalidationLevel: null }]
    );
    assert.strictEqual(vm.runInContext('secondFreshCrossMeta.windowScore', context), 3);
    assert.strictEqual(vm.runInContext('secondFreshCrossMeta.windowScoreSignals.find(item => item.signal === "B8").day', context), 66);
});

runTest('price-break invalidation is permanent and a later signal must create a new score instance', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext('function convertDailyToWeekly() { return []; }', context);
    vm.runInContext(calcSource, context);
    vm.runInContext(`
        setActiveStrategy('波段抄底型');
        var full = Array.from({ length: 70 }, (_, index) => ({
            date: '2026-02-' + String(index + 1).padStart(2, '0'),
            open: 100, high: 101, low: 99, close: 100, vol: 1000, _signals: []
        }));
        var indicators = {
            ma: { 5: [], 10: [], 20: [], 60: [] },
            macd: { diff: [], dea: [] },
            rsi: { val: [] },
            kdj: { k: [], d: [], j: [] }
        };
        full[62]._signals = ['B16'];
        full[63].close = 98;
        var brokenMeta = getSignalMeta(63, full, indicators);
        full[64].close = 100;
        var recoveredOldSignalMeta = getSignalMeta(64, full, indicators);
        full[65]._signals = ['B16'];
        full[65].low = 98;
        var newSignalMeta = getSignalMeta(65, full, indicators);
    `, context);
    assert.strictEqual(vm.runInContext('brokenMeta.windowScore', context), 0);
    assert.strictEqual(vm.runInContext('recoveredOldSignalMeta.windowScore', context), 0);
    assert.strictEqual(vm.runInContext('newSignalMeta.windowScore', context), 3);
    assert.strictEqual(vm.runInContext('newSignalMeta.windowScoreSignals[0].day', context), 65);
    assert.strictEqual(vm.runInContext('brokenMeta.invalidatedWindowSignals[0].reason', context), 'price-break');
    assert.strictEqual(vm.runInContext('brokenMeta.invalidatedWindowSignals[0].invalidationLevel', context), 99);
});

runTest('monotonic buy-signal invalidation remains opt-in for formal strategies', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext('function convertDailyToWeekly() { return []; }', context);
    vm.runInContext(calcSource, context);
    vm.runInContext(`
        var full = Array.from({ length: 66 }, (_, index) => ({
            date: '2026-02-' + String(index + 1).padStart(2, '0'),
            open: 100, high: 101, low: 99, close: 100, vol: 1000, _signals: []
        }));
        full[62]._signals = ['B1'];
        full[63].close = 98;
        full[64].close = 100;
        var indicators = { kdj: { k: [], d: [] } };
        var trendInvalidation = getWindowSignalInvalidation('B1', 62, 64, full, indicators, STRATEGIES['稳健趋势型']);
        var waveInvalidation = getWindowSignalInvalidation('B1', 62, 64, full, indicators, STRATEGIES['波段抄底型']);
    `, context);
    assert.strictEqual(vm.runInContext('trendInvalidation', context), null);
    assert.deepStrictEqual(JSON.parse(vm.runInContext('JSON.stringify(waveInvalidation)', context)), {
        signal: 'B1',
        day: 62,
        signalDate: '2026-02-63',
        score: 3,
        reason: 'price-break',
        invalidationDay: 63,
        invalidationDate: '2026-02-64',
        invalidationLevel: 99
    });
});

runTest('same-day L10 and L3 keep the documented high-risk clear-out semantics', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext('function convertDailyToWeekly() { return []; }', context);
    vm.runInContext(calcSource, context);
    vm.runInContext(`
        setActiveStrategy('稳健趋势型');
        var full = Array.from({ length: 65 }, (_, index) => ({
            date: '2026-03-' + String(index + 1).padStart(2, '0'),
            open: 100, high: 101, low: 99, close: 100, vol: 1000, _signals: []
        }));
        full[64]._signals = ['L3', 'L10'];
        var indicators = { ma: {}, macd: {}, rsi: {}, kdj: { k: [], d: [] } };
        var comboMeta = getSignalMeta(64, full, indicators);
        var comboExit = getExitSeverity(comboMeta, 64, full, indicators);
    `, context);
    assert.strictEqual(vm.runInContext('comboMeta.type', context), '🛑 清仓规避');
    assert.deepStrictEqual(JSON.parse(vm.runInContext('JSON.stringify(comboExit)', context)), {
        level: '清仓防守',
        detail: '触发高危清仓信号'
    });
});

runTest('wave L10 trend handoff keeps a complete-uptrend stock position but preserves blocking exits and index behavior', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext('function convertDailyToWeekly() { return []; }', context);
    vm.runInContext(calcSource, context);
    vm.runInContext(`
        setActiveStrategy('波段抄底型');
        state.mode = 'stock';
        var full = Array.from({ length: 65 }, (_, index) => ({
            date: '2026-03-' + String(index + 1).padStart(2, '0'),
            open: 108, high: 112, low: 107, close: 110, vol: 1000, _signals: []
        }));
        full[64]._signals = ['L10'];
        state.indicators = {
            ma: { 20: Array(65).fill(100), 60: Array(65).fill(90) },
            macd: {}, rsi: {}, kdj: {}
        };
        state.indicators.ma[20][59] = 99;
        var meta = {
            type: '🚪 趋势破位', windowScore: 4, buySignals: [], exitSignals: ['L10'],
            warningSignals: [], allSignals: { L10: { status: true } }, windowSignals: [{ day: 64, signal: 'L10' }],
            invalidatedWindowSignals: [], inCooldown: false
        };
        getSignalMeta = () => meta;
        getMarketContext = () => ({ label: '核心宽基分化', cls: 'neutral', increaseCaps: null });
        getRiskContext = () => ({ score: 90, level: '正常', coef: 1, flags: [], stop: 95, pressure: 120 });
        getBasePosition = () => 80;
        getPositionCap = () => null;
        getTargetStrengthTier = () => ({ tier: 'independent', label: '独立走强', reasons: [] });
        applyMarketRiskGate = (market, prevPos, position) => ({ position, type: 'none', cap: null });
        getWaveRejectionProtectionContext = () => ({ active: false, status: 'none' });
        var handoffDecision = computeDecisionForIndex(64, full, 80);
        var handoffSummary = getStockDecisionSummary(meta, handoffDecision);

        full[64]._signals = ['L3', 'L10'];
        meta = { ...meta, exitSignals: ['L3', 'L10'], allSignals: { L3: { status: true }, L10: { status: true } } };
        var blockedDecision = computeDecisionForIndex(64, full, 80);

        full[64]._signals = ['L10'];
        meta = { ...meta, exitSignals: ['L10'], allSignals: { L10: { status: true } } };
        state.mode = 'index';
        var indexDecision = computeDecisionForIndex(64, full, 80);
    `, context);
    assert.deepStrictEqual(JSON.parse(vm.runInContext('JSON.stringify({ position: handoffDecision.position, handoff: handoffDecision.waveL10TrendHandoff, exit: handoffDecision.exit, action: handoffDecision.simpleAction })', context)), {
        position: 30,
        handoff: {
            eligible: true,
            applied: true,
            reason: '完整多头持仓中的单独L10按预警处理，趋势接管后续持仓',
            sourcePosition: 80,
            targetPositionCap: 30,
            triggerDay: 64,
            triggerDate: '2026-03-65',
            triggerHigh: 112,
            triggerClose: 110,
            targetPosition: 30
        },
        exit: { level: '减仓观察', detail: '完整多头结构中单独出现MACD顶背离，先降仓预警，不单信号归零' },
        action: '防守减仓'
    });
    assert.strictEqual(vm.runInContext('handoffDecision.bsMark', context), null);
    assert.strictEqual(vm.runInContext('handoffDecision.simpleAction', context), '防守减仓');
    assert.strictEqual(vm.runInContext('handoffDecision.waveL10TrendHandoff.applied', context), true);
    assert.strictEqual(vm.runInContext('handoffSummary.state', context), '趋势接管预警');
    assert.ok(vm.runInContext('handoffSummary.why.includes("趋势接管预警") && handoffSummary.why.includes("不因单个") && handoffSummary.why.includes("清仓")', context));
    assert.strictEqual(vm.runInContext('blockedDecision.position', context), 0);
    assert.strictEqual(vm.runInContext('blockedDecision.bsMark', context), 'S');
    assert.strictEqual(vm.runInContext('blockedDecision.waveL10TrendHandoff.applied', context), false);
    assert.strictEqual(vm.runInContext('indexDecision.position', context), 0);
    assert.strictEqual(vm.runInContext('indexDecision.bsMark', context), 'S');
});

runTest('wave L10 trend handoff does not start cooldown or remain in the recent exit window', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext('function convertDailyToWeekly() { return []; }', context);
    vm.runInContext(calcSource, context);
    vm.runInContext(`
        setActiveStrategy('波段抄底型');
        state.mode = 'stock';
        var full = Array.from({ length: 66 }, (_, index) => ({
            date: '2026-04-' + String(index + 1).padStart(2, '0'),
            open: 100, high: 101, low: 99, close: 100, vol: 1000, _signals: []
        }));
        full[64]._signals = ['L10'];
        full[64]._decision = { waveL10TrendHandoff: { applied: true } };
        var indicators = { ma: {}, macd: {}, rsi: {}, kdj: {} };
        var nextMeta = getSignalMeta(65, full, indicators);
    `, context);
    assert.strictEqual(vm.runInContext('nextMeta.inCooldown', context), false);
    assert.ok(!vm.runInContext('nextMeta.windowSignals.some(item => item.signal === "L10")', context));
});

runTest('risk score does not override signal position hysteresis', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext('function convertDailyToWeekly() { return []; }', context);
    vm.runInContext(calcSource, context);
    vm.runInContext(`
        setActiveStrategy('稳健趋势型');
        state.indicators = { ma: {}, macd: {}, rsi: {}, kdj: {} };
        var full = Array.from({ length: 65 }, (_, index) => ({
            date: '2026-04-' + String(index + 1).padStart(2, '0'),
            open: 100, high: 101, low: 99, close: 100, vol: 1000
        }));
        var meta = {
            type: '✅ 明确转强', windowScore: 6, buySignals: ['B1'], exitSignals: [],
            warningSignals: [], allSignals: {}, windowSignals: [], invalidatedWindowSignals: [], inCooldown: false
        };
        getSignalMeta = () => meta;
        getMarketContext = () => ({ label: '核心宽基分化', cls: 'neutral', increaseCaps: null });
        getRiskContext = () => ({ score: 30, level: '极端波动风险', coef: 0.25, flags: ['波动过高'], stop: 95, pressure: 110 });
        getExitSeverity = () => ({ level: '无明确离场', detail: '无' });
        getBasePosition = () => 80;
        var hysteresisDecision = computeDecisionForIndex(64, full, 30);
    `, context);
    assert.strictEqual(vm.runInContext('hysteresisDecision.position', context), 80);
    assert.strictEqual(vm.runInContext('hysteresisDecision.simpleAction', context), '顺势加仓');
});

runTest('all production positions stay on the shared four-tier ladder', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext('function convertDailyToWeekly() { return []; }', context);
    vm.runInContext(calcSource, context);
    assert.deepStrictEqual(JSON.parse(vm.runInContext('JSON.stringify([0, 10, 20, 30, 40, 50, 60, 80, 100].map(quantizePosition))', context)), [0, 0, 30, 30, 30, 50, 50, 80, 80]);
    assert.deepStrictEqual(JSON.parse(vm.runInContext('JSON.stringify([getRiskPositionCap({ score: 90 }), getRiskPositionCap({ score: 70 }), getRiskPositionCap({ score: 50 }), getRiskPositionCap({ score: 30 })])', context)), [80, 50, 30, 0]);
});

runTest('wave B11 keeps a 30% trial after a local break and exits only below its confirmed structure low', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext('function convertDailyToWeekly() { return []; }', context);
    vm.runInContext(calcSource, context);
    vm.runInContext("getWaveContext = () => ({ inScope: false, regime: 'down' });", context);
    vm.runInContext(`
        setActiveStrategy('波段抄底型');
        state.mode = 'stock';
        state.period = 'daily';
        state.indicators = { ma: {}, macd: { diff: [], dea: [] }, rsi: { val: [] }, kdj: { k: [], d: [], j: [] } };
        var full = Array.from({ length: 75 }, (_, index) => ({
            date: '2026-04-' + String(index + 1).padStart(2, '0'),
            open: 9, high: 9.2, low: 9, close: 9, vol: 1000, _signals: []
        }));
        full[56].low = 9; full[57].low = 9; full[58].low = 8.03; full[59].low = 9; full[60].low = 9;
        full[60].low = 9; full[61].low = 9; full[62].low = 8.24; full[63].low = 9; full[64].low = 9;
        full[70].low = 8.48; full[70].close = 8.71; full[70]._signals = ['B11'];
        full[71].low = 8.42; full[71].close = 8.42;
        full[72].low = 8.20; full[72].close = 8.20;
        getMarketContext = () => ({ label: '核心宽基分化', cls: 'neutral', increaseCaps: null });
        getRiskContext = () => ({ score: 100, level: '低波动/偏离', coef: 1, flags: [], stop: 8.03, pressure: 9.75 });
        getExitSeverity = () => ({ level: '无明确离场', detail: '无' });
        getBasePosition = (idx, rows, ind, meta) => meta.windowScore > 0 ? 30 : 0;
        var defense = getB11StructureDefense(70, full, STRATEGY);
        var entryMeta = getSignalMeta(70, full, state.indicators);
        var entryDecision = computeDecisionForIndex(70, full, 0);
        full[70]._decision = entryDecision;
        var localMeta = getSignalMeta(71, full, state.indicators);
        var localDecision = computeDecisionForIndex(71, full, entryDecision.position);
        full[71]._decision = localDecision;
        var hardMeta = getSignalMeta(72, full, state.indicators);
        var hardDecision = computeDecisionForIndex(72, full, localDecision.position);
        setActiveStrategy('综合全能型');
        state.mode = 'stock';
        var compositeInvalidation = getWindowSignalInvalidation('B11', 70, 71, full, state.indicators, STRATEGY);
        setActiveStrategy('波段抄底型');
        state.mode = 'index';
        var indexInvalidation = getWindowSignalInvalidation('B11', 70, 71, full, state.indicators, STRATEGY);
    `, context);
    assert.deepStrictEqual(JSON.parse(vm.runInContext('JSON.stringify(defense)', context)), {
        localLevel: 8.48,
        structureLevel: 8.24,
        structureDay: 62,
        structureDate: '2026-04-63'
    });
    assert.strictEqual(vm.runInContext('entryDecision.position', context), 30);
    assert.strictEqual(vm.runInContext('entryDecision.bsMark', context), 'B');
    assert.strictEqual(vm.runInContext('localMeta.windowScore', context), 2);
    assert.strictEqual(vm.runInContext('localMeta.invalidatedWindowSignals.length', context), 0);
    assert.strictEqual(vm.runInContext('localMeta.localBreakWindowSignals[0].reason', context), 'local-price-break');
    assert.strictEqual(vm.runInContext('localMeta.localBreakWindowSignals[0].invalidationLevel', context), 8.48);
    assert.strictEqual(vm.runInContext('localMeta.localBreakWindowSignals[0].structureLevel', context), 8.24);
    assert.strictEqual(vm.runInContext('localDecision.position', context), 30);
    assert.strictEqual(vm.runInContext('localDecision.bsMark', context), null);
    assert.strictEqual(vm.runInContext('localDecision.localStructureDefense.applied', context), true);
    assert.strictEqual(vm.runInContext('hardDecision.position', context), 0);
    assert.strictEqual(vm.runInContext('hardDecision.bsMark', context), 'S');
    assert.strictEqual(vm.runInContext('hardMeta.invalidatedWindowSignals[0].reason', context), 'price-break');
    assert.strictEqual(vm.runInContext('hardMeta.invalidatedWindowSignals[0].defenseType', context), 'structure');
    assert.strictEqual(vm.runInContext('hardMeta.invalidatedWindowSignals[0].invalidationLevel', context), 8.24);
    assert.strictEqual(vm.runInContext('compositeInvalidation.reason', context), 'price-break');
    assert.strictEqual(vm.runInContext('compositeInvalidation.invalidationLevel', context), 8.48);
    assert.strictEqual(vm.runInContext('indexInvalidation.reason', context), 'price-break');
    assert.strictEqual(vm.runInContext('indexInvalidation.invalidationLevel', context), 8.48);
});

runTest('wave rejection V2 sells on the risk day and only guards event-local recovery', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(calcSource, context);
    vm.runInContext("getWaveContext = () => ({ inScope: false, regime: 'down' });", context);
    vm.runInContext(`
        setActiveStrategy('波段抄底型');
        state.mode = 'stock';
        state.period = 'daily';
        state.indicators = { ma: {}, macd: {}, rsi: {}, kdj: {} };
        var full = Array.from({ length: 75 }, (_, index) => ({
            date: '2026-05-' + String(index + 1).padStart(2, '0'),
            open: 100, high: 101, low: 99, close: 100, vol: 1000, _signals: []
        }));
        full[65]._decision = { position: 30, prevAdv: 0, bsMark: 'B' };
        for (var day = 66; day < 70; day++) full[day]._decision = { position: 30, prevAdv: 30, bsMark: null };
        var activeMeta = {
            type: '✅ 明确转强', windowScore: 4, buySignals: ['B17'], exitSignals: [], warningSignals: [],
            allSignals: {}, windowSignals: [], windowScoreSignals: [], invalidatedWindowSignals: [], inCooldown: false
        };
        getSignalMeta = () => activeMeta;
        getMarketContext = () => ({ label: '核心宽基分化', cls: 'neutral', increaseCaps: null });
        getRiskContext = () => ({ score: 100, level: '低波动/偏离', coef: 1, flags: [], stop: 95, pressure: 112 });
        getExitSeverity = () => ({ level: '无明确离场', detail: '无' });
        getBasePosition = () => 80;
        getPositionCap = () => null;
        getTargetStrengthTier = () => ({ tier: 'ordinary', label: '普通机会', reasons: [] });

        full[70] = { ...full[70], open: 109, high: 112, low: 108, close: 109, vol: 2000 };
        var riskDayDecision = computeDecisionForIndex(70, full, 30);
        full[70]._decision = riskDayDecision;
        var riskDaySummary = getStockDecisionSummary(activeMeta, riskDayDecision);

        full[71] = { ...full[71], open: 109.2, high: 111, low: 108.5, close: 110, vol: 900 };
        var lockedDecision = computeDecisionForIndex(71, full, 0);
        full[71]._decision = lockedDecision;
        var lockedSummary = getStockDecisionSummary(activeMeta, lockedDecision);

        full[72] = { ...full[72], open: 109.5, high: 111, low: 108.5, close: 110.5, vol: 950, _signals: ['W2'] };
        var w2LockedDecision = computeDecisionForIndex(72, full, 0);
        full[72]._decision = w2LockedDecision;

        full[73] = { ...full[73], open: 111, high: 113.5, low: 110.5, close: 113, vol: 1000, _signals: [] };
        var releasedDecision = computeDecisionForIndex(73, full, 0);
        full[73]._decision = releasedDecision;
        var releasedSummary = getStockDecisionSummary(activeMeta, releasedDecision);

        full[74] = { ...full[74], open: 113, high: 114, low: 112, close: 113.5, vol: 1000, _signals: [] };
        var recoveryHoldDecision = computeDecisionForIndex(74, full, 30);

        var fiftyRows = Array.from({ length: 71 }, (_, index) => ({
            date: '2026-06-' + String(index + 1).padStart(2, '0'),
            open: 100, high: 101, low: 99, close: 100, vol: 1000, _signals: []
        }));
        fiftyRows[65]._decision = { position: 50, prevAdv: 0, bsMark: 'B' };
        for (var fiftyDay = 66; fiftyDay < 70; fiftyDay++) fiftyRows[fiftyDay]._decision = { position: 50, prevAdv: 50, bsMark: null };
        fiftyRows[70] = { ...fiftyRows[70], open: 109, high: 112, low: 108, close: 109, vol: 2000 };
        var fiftyRiskDecision = computeDecisionForIndex(70, fiftyRows, 50);

        var ordinaryRows = Array.from({ length: 71 }, (_, index) => ({
            date: '2026-07-' + String(index + 1).padStart(2, '0'),
            open: 100, high: 101, low: 99, close: 100, vol: 1000, _signals: []
        }));
        ordinaryRows[65]._decision = { position: 30, prevAdv: 0, bsMark: 'B' };
        for (var ordinaryDay = 66; ordinaryDay < 70; ordinaryDay++) ordinaryRows[ordinaryDay]._decision = { position: 30, prevAdv: 30, bsMark: null };
        ordinaryRows[70] = { ...ordinaryRows[70], open: 101, high: 102, low: 100, close: 101.5, vol: 1000 };
        var ordinaryIncreaseDecision = computeDecisionForIndex(70, ordinaryRows, 30);

        var dojiRows = Array.from({ length: 71 }, (_, index) => ({
            date: '2026-08-' + String(index + 1).padStart(2, '0'),
            open: 100, high: 101, low: 99, close: 100, vol: 1000, _signals: []
        }));
        dojiRows[65]._decision = { position: 10, prevAdv: 0, bsMark: 'B' };
        for (var dojiDay = 66; dojiDay < 70; dojiDay++) dojiRows[dojiDay]._decision = { position: 10, prevAdv: 10, bsMark: null };
        dojiRows[70] = { ...dojiRows[70], open: 109, high: 112, low: 106, close: 109, vol: 2000 };
        var dojiRiskDecision = computeDecisionForIndex(70, dojiRows, 10);

        state.mode = 'index';
        var indexDecision = computeDecisionForIndex(70, ordinaryRows, 30);
    `, context);
    assert.strictEqual(vm.runInContext('riskDayDecision.position', context), 0);
    assert.strictEqual(vm.runInContext('riskDayDecision.bsMark', context), 'S');
    assert.strictEqual(vm.runInContext('riskDayDecision.waveRejectionProtection.status', context), 'triggered');
    assert.ok(vm.runInContext('riskDaySummary.why.includes("风险日实时分档止盈")', context));
    assert.ok(vm.runInContext('riskDaySummary.positionWhy.includes("从30%降至0%")', context));
    assert.strictEqual(vm.runInContext('riskDaySummary.positionWhyCode', context), 'rejection-triggered');
    assert.strictEqual(vm.runInContext('lockedDecision.position', context), 0);
    assert.strictEqual(vm.runInContext('lockedDecision.bsMark', context), null);
    assert.strictEqual(vm.runInContext('lockedDecision.waveRejectionProtection.status', context), 'locked');
    assert.ok(vm.runInContext('lockedSummary.why.includes("旧积分不立即触发回补")', context));
    assert.strictEqual(vm.runInContext('w2LockedDecision.position', context), 0);
    assert.strictEqual(vm.runInContext('w2LockedDecision.waveRejectionProtection.status', context), 'locked');
    assert.strictEqual(vm.runInContext('w2LockedDecision.waveRejectionProtection.blockedByRiskSignal', context), true);
    assert.strictEqual(vm.runInContext('releasedDecision.position', context), 30);
    assert.strictEqual(vm.runInContext('releasedDecision.bsMark', context), 'B');
    assert.strictEqual(vm.runInContext('releasedDecision.waveRejectionProtection.status', context), 'released');
    assert.ok(vm.runInContext('releasedSummary.why.includes("先恢复至30%")', context));
    assert.strictEqual(vm.runInContext('recoveryHoldDecision.position', context), 30);
    assert.strictEqual(vm.runInContext('recoveryHoldDecision.waveRejectionProtection.status', context), 'recovery_hold');
    assert.strictEqual(vm.runInContext('fiftyRiskDecision.position', context), 30);
    assert.strictEqual(vm.runInContext('fiftyRiskDecision.bsMark', context), null);
    assert.strictEqual(vm.runInContext('fiftyRiskDecision.waveRejectionProtection.status', context), 'triggered');
    assert.strictEqual(vm.runInContext('ordinaryIncreaseDecision.position', context), 30);
    assert.strictEqual(vm.runInContext('ordinaryIncreaseDecision.waveRejectionProtection.status', context), 'none');
    assert.strictEqual(vm.runInContext('dojiRiskDecision.position', context), 80);
    assert.strictEqual(vm.runInContext('dojiRiskDecision.waveRejectionProtection.status', context), 'none');
    assert.strictEqual(vm.runInContext('indexDecision.position', context), 80);
    assert.strictEqual(vm.runInContext('indexDecision.waveRejectionProtection.status', context), 'none');
});

runTest('wave mature-profit rejection can restore one reduced tier on a confirmed MA20 pullback', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(calcSource, context);
    vm.runInContext("getWaveContext = () => ({ inScope: false, regime: 'up' });", context);
    vm.runInContext(`
        setActiveStrategy('波段抄底型');
        state.mode = 'stock';
        state.period = 'daily';
        state.indicators = {
            ma: { 20: Array(75).fill(108), 60: Array(75).fill(105) },
            macd: {}, rsi: {}, kdj: {}
        };
        state.indicators.ma[20][70] = 108.0;
        state.indicators.ma[20][71] = 108.2;
        state.indicators.ma[20][72] = 108.4;
        var full = Array.from({ length: 75 }, (_, index) => ({
            date: '2026-09-' + String(index + 1).padStart(2, '0'),
            open: 100, high: 101, low: 99, close: 100, vol: 1000, _signals: []
        }));
        var riskEvent = {
            active: true, status: 'triggered', eventType: 'mature_profit_rejection',
            triggerDay: 70, triggerDate: '2026-09-71', triggerHigh: 112,
            triggerLow: 108, triggerClose: 109, recoveryCloseLevel: 109,
            sourcePosition: 50, targetPosition: 30, recoveryPending: false,
            recoveryHoldRemaining: 0
        };
        full[70] = { ...full[70], open: 109, high: 112, low: 108, close: 109, vol: 2000,
            _decision: { position: 30, prevAdv: 50, bsMark: null, waveRejectionProtection: riskEvent } };
        var activeMeta = {
            type: '📈 趋势抱单', currentClose: 108.8, windowScore: 4,
            buySignals: ['B11'], exitSignals: [], warningSignals: [], allSignals: {},
            windowSignals: [], windowScoreSignals: [{ signal: 'B11', day: 72, score: 2 }],
            invalidatedWindowSignals: [], inCooldown: false
        };
        getSignalMeta = () => activeMeta;
        getMarketContext = () => ({ label: '核心宽基分化', cls: 'neutral', increaseCaps: null });
        getRiskContext = () => ({ score: 100, level: '低波动/偏离', coef: 1, flags: [], stop: 107, pressure: 112 });
        getExitSeverity = () => ({ level: '无明确离场', detail: '无' });
        getBasePosition = () => 50;
        getPositionCap = () => null;
        getTargetStrengthTier = () => ({ tier: 'ordinary', label: '普通机会', reasons: [] });

        full[71] = { ...full[71], open: 108.8, high: 109.1, low: 108.1, close: 108.6, vol: 800,
            _decision: { position: 30, prevAdv: 30, bsMark: null, waveRejectionProtection: { ...riskEvent, status: 'locked', lockAge: 1 } } };
        full[72] = { ...full[72], open: 108.5, high: 109.0, low: 108.2, close: 108.8, vol: 700, _signals: ['B11'] };
        var pullbackDecision = computeDecisionForIndex(72, full, 30);
        var pullbackSummary = getStockDecisionSummary(activeMeta, pullbackDecision);

        var zeroRiskEvent = { ...riskEvent, sourcePosition: 30, targetPosition: 0 };
        full[71]._decision = { position: 0, prevAdv: 0, bsMark: null, waveRejectionProtection: { ...zeroRiskEvent, status: 'locked', lockAge: 1 } };
        var zeroPullbackDecision = computeDecisionForIndex(72, full, 0);
        full[71]._decision = { position: 30, prevAdv: 30, bsMark: null, waveRejectionProtection: { ...riskEvent, status: 'locked', lockAge: 1 } };
        getPositionCap = () => ({ limit: 30, reason: '趋势未确认' });
        var trendCappedDecision = computeDecisionForIndex(72, full, 30);
        getPositionCap = () => null;

        var weakMa = state.indicators.ma[20][72];
        state.indicators.ma[20][72] = 108.0;
        var fallingMaDecision = computeDecisionForIndex(72, full, 30);
        state.indicators.ma[20][72] = weakMa;
        full[72]._signals = [];
        var noSignalDecision = computeDecisionForIndex(72, full, 30);
        full[72]._signals = ['B11'];

        state.mode = 'index';
        full[71]._decision.waveRejectionProtection = { active: false, status: 'none', targetPosition: 30 };
        var indexDecision = computeDecisionForIndex(72, full, 30);
    `, context);
    assert.strictEqual(vm.runInContext('pullbackDecision.position', context), 50);
    assert.strictEqual(vm.runInContext('pullbackDecision.bsMark', context), null);
    assert.strictEqual(vm.runInContext('pullbackDecision.waveRejectionProtection.status', context), 'released');
    assert.strictEqual(vm.runInContext('pullbackDecision.waveRejectionProtection.pullbackRecovery', context), true);
    assert.deepStrictEqual(JSON.parse(vm.runInContext('JSON.stringify(pullbackDecision.waveRejectionProtection.freshPullbackSignals)', context)), ['B11']);
    assert.ok(vm.runInContext('pullbackSummary.why.includes("回踩") && pullbackSummary.why.includes("MA20")', context));
    assert.strictEqual(vm.runInContext('zeroPullbackDecision.position', context), 30);
    assert.strictEqual(vm.runInContext('zeroPullbackDecision.bsMark', context), 'B');
    assert.strictEqual(vm.runInContext('zeroPullbackDecision.waveRejectionProtection.pullbackRecovery', context), true);
    assert.strictEqual(vm.runInContext('trendCappedDecision.position', context), 30);
    assert.strictEqual(vm.runInContext('trendCappedDecision.waveRejectionProtection.status', context), 'locked');
    assert.strictEqual(vm.runInContext('fallingMaDecision.position', context), 30);
    assert.strictEqual(vm.runInContext('fallingMaDecision.waveRejectionProtection.status', context), 'locked');
    assert.strictEqual(vm.runInContext('noSignalDecision.position', context), 30);
    assert.strictEqual(vm.runInContext('noSignalDecision.waveRejectionProtection.status', context), 'locked');
    assert.strictEqual(vm.runInContext('indexDecision.position', context), 50);
    assert.strictEqual(vm.runInContext('indexDecision.waveRejectionProtection.status', context), 'none');
});

runTest('wave fresh-entry pressure failure permits a complete post-event repair below the old risk close', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(calcSource, context);
    vm.runInContext(`
        setActiveStrategy('波段抄底型');
        state.mode = 'stock';
        state.period = 'daily';
        state.indicators = {
            ma: { 20: Array(73).fill(110), 60: Array(73).fill(120) },
            macd: {}, rsi: {}, kdj: {}
        };
        var full = Array.from({ length: 73 }, (_, index) => ({
            date: '2026-06-' + String(index + 1).padStart(2, '0'),
            open: 99, high: 101, low: 98, close: 99, vol: 1000, _signals: []
        }));
        var event = {
            active: true, status: 'triggered', eventType: 'fresh_entry_failure',
            triggerDay: 70, triggerDate: '2026-06-71', triggerHigh: 102,
            triggerLow: 98, triggerClose: 100, recoveryCloseLevel: 100,
            sourcePosition: 30, targetPosition: 0, recoveryPending: false,
            recoveryHoldRemaining: 0
        };
        full[70] = { ...full[70], close: 100,
            _decision: { position: 0, prevAdv: 30, bsMark: 'S', waveRejectionProtection: event } };
        full[71] = { ...full[71], close: 99, _signals: ['B16'] };
        var singleSignalMeta = {
            currentDay: 71, currentClose: 99, type: '👀 关注异动', windowScore: 3,
            buySignals: ['B16'], exitSignals: [], warningSignals: [],
            windowSignals: [{ day: 71, signal: 'B16' }],
            windowScoreSignals: [{ day: 71, signal: 'B16', score: 3 }],
            invalidatedWindowSignals: [], localBreakWindowSignals: [], inCooldown: false
        };
        var locked = getWaveRejectionProtectionContext(71, full, singleSignalMeta, 0, 30, STRATEGY);
        full[71]._decision = { position: 0, prevAdv: 0, bsMark: null, waveRejectionProtection: locked };

        full[72] = { ...full[72], close: 99.5, _signals: ['B7', 'B16'] };
        var freshMeta = {
            currentDay: 72, currentClose: 99.5, type: '✅ 明确转强', windowScore: 4,
            buySignals: ['B7', 'B16'], exitSignals: [], warningSignals: [],
            windowSignals: [{ day: 71, signal: 'B16' }, { day: 72, signal: 'B7' }],
            windowScoreSignals: [
                { day: 71, signal: 'B16', score: 3 },
                { day: 72, signal: 'B7', score: 1 }
            ],
            invalidatedWindowSignals: [], localBreakWindowSignals: [], inCooldown: false
        };
        var released = getWaveRejectionProtectionContext(72, full, freshMeta, 0, 30, STRATEGY);
        full[71]._decision.waveRejectionProtection = { ...locked, eventType: 'fresh_entry_downside_failure' };
        var downsideReleased = getWaveRejectionProtectionContext(72, full, freshMeta, 0, 30, STRATEGY);
    `, context);
    assert.strictEqual(vm.runInContext('locked.status', context), 'locked');
    assert.strictEqual(vm.runInContext('locked.lockRemaining', context), 1);
    assert.strictEqual(vm.runInContext('locked.strongFreshRecovery', context), false);
    assert.strictEqual(vm.runInContext('released.status', context), 'released');
    assert.strictEqual(vm.runInContext('released.targetPosition', context), 30);
    assert.strictEqual(vm.runInContext('released.strongFreshRecovery', context), true);
    assert.strictEqual(vm.runInContext('released.stableRecovery', context), false);
    assert.strictEqual(vm.runInContext('released.postEventScore', context), 4);
    assert.strictEqual(vm.runInContext('released.postEventScoreSignals.length', context), 2);
    assert.strictEqual(vm.runInContext('downsideReleased.status', context), 'released');
    assert.strictEqual(vm.runInContext('downsideReleased.targetPosition', context), 30);
});

runTest('wave low risk score does not force an exit or isolate old scores', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(calcSource, context);
    vm.runInContext(`
        setActiveStrategy('波段抄底型');
        state.mode = 'stock';
        state.period = 'daily';
        state.indicators = {
            ma: { 20: Array(75).fill(110), 60: Array(75).fill(120) },
            macd: { bar: Array(75).fill(0) },
            rsi: {},
            kdj: { k: Array(75).fill(30), d: Array(75).fill(20) }
        };
        var full = Array.from({ length: 75 }, (_, index) => ({
            date: '2026-05-' + String(index + 1).padStart(2, '0'),
            open: 100, high: 101, low: 99, close: 100, vol: 1000, _signals: []
        }));
        full[65]._signals = ['B11'];
        full[66]._signals = ['B8'];
        full[68]._decision = { position: 30, prevAdv: 0, bsMark: 'B' };
        full[69]._decision = { position: 30, prevAdv: 30, bsMark: null };
        var oldMeta = {
            type: '👀 关注异动', windowScore: 3, buySignals: [], exitSignals: [], warningSignals: [],
            allSignals: {}, windowSignals: [{ signal: 'B11', day: 65 }, { signal: 'B8', day: 66 }],
            windowScoreSignals: [{ signal: 'B11', day: 65, score: 2 }, { signal: 'B8', day: 66, score: 1 }],
            invalidatedWindowSignals: [], localBreakWindowSignals: [], inCooldown: false
        };
        var metaByDay = { 70: oldMeta, 71: oldMeta };
        full[72]._signals = ['B8'];
        metaByDay[72] = {
            ...oldMeta,
            windowSignals: [{ signal: 'B11', day: 65 }, { signal: 'B8', day: 72 }],
            windowScoreSignals: [{ signal: 'B11', day: 65, score: 2 }, { signal: 'B8', day: 72, score: 1 }]
        };
        full[73] = { ...full[73], close: 99.5, low: 99.2, _signals: ['B11', 'B8'] };
        metaByDay[73] = {
            ...oldMeta,
            currentDay: 73,
            currentClose: 99.5,
            windowSignals: [{ signal: 'B11', day: 73 }, { signal: 'B8', day: 73 }],
            windowScoreSignals: [{ signal: 'B11', day: 73, score: 2 }, { signal: 'B8', day: 73, score: 1 }]
        };
        getSignalMeta = index => metaByDay[index] || oldMeta;
        getMarketContext = () => ({ label: '核心宽基分化', cls: 'neutral', increaseCaps: null });
        var riskScore = 37;
        getRiskContext = () => ({ score: riskScore, level: riskScore < 40 ? '极端波动风险' : '高偏离风险', coef: 0.5, flags: [], stop: 95, pressure: 110 });
        getExitSeverity = () => ({ level: '无明确离场', detail: '无' });
        getPositionCap = () => null;
        getTargetStrengthTier = () => ({ tier: 'ordinary', label: '普通机会', reasons: [] });

        var riskExit = computeDecisionForIndex(70, full, 30);
        full[70]._decision = riskExit;
        riskScore = 55;
        var oldScoreRetry = computeDecisionForIndex(71, full, 0);
        full[71]._decision = oldScoreRetry;
        var oldScoreRetrySummary = getStockDecisionSummary(oldMeta, oldScoreRetry);
        var isolatedB8Retry = computeDecisionForIndex(72, full, 0);
        full[72]._decision = isolatedB8Retry;
        var freshRepairEntry = computeDecisionForIndex(73, full, 0);
        var freshRepairEntrySummary = getStockDecisionSummary(metaByDay[73], freshRepairEntry);
    `, context);
    assert.strictEqual(vm.runInContext('riskExit.position', context), 30);
    assert.strictEqual(vm.runInContext('riskExit.bsMark', context), null);
    assert.strictEqual(vm.runInContext('riskExit.waveRejectionProtection.status', context), 'none');
    assert.strictEqual(vm.runInContext('oldScoreRetry.position', context), 0);
    assert.strictEqual(vm.runInContext('oldScoreRetry.bsMark', context), null);
    assert.strictEqual(vm.runInContext('oldScoreRetry.waveRejectionProtection.status', context), 'none');
    assert.ok(!vm.runInContext('oldScoreRetrySummary.why.includes("风险评分")', context));
    assert.strictEqual(vm.runInContext('isolatedB8Retry.position', context), 0);
    assert.strictEqual(vm.runInContext('isolatedB8Retry.waveRejectionProtection.status', context), 'none');
    assert.strictEqual(vm.runInContext('freshRepairEntry.position', context), 0);
    assert.strictEqual(vm.runInContext('freshRepairEntry.bsMark', context), null);
    assert.strictEqual(vm.runInContext('freshRepairEntry.waveRejectionProtection.status', context), 'none');
    assert.ok(!vm.runInContext('freshRepairEntrySummary.why.includes("风险评分")', context));
});

runTest('wave established uptrend keeps a second expiry-washout day and hands back to trend hold', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(calcSource, context);
    vm.runInContext(`
        setActiveStrategy('波段抄底型');
        state.mode = 'stock';
        state.period = 'daily';
        var ma20 = Array(75).fill(100);
        var ma60 = Array(75).fill(90);
        var ma5 = Array(75).fill(100.2);
        for (var day = 60; day < 75; day++) ma20[day] = 100 + (day - 60) * 0.03;
        state.indicators = {
            ma: { 5: ma5, 20: ma20, 60: ma60 },
            macd: { bar: Array(75).fill(0.5) },
            rsi: {},
            kdj: { k: Array(75).fill(40), d: Array(75).fill(30) }
        };
        var full = Array.from({ length: 75 }, (_, index) => ({
            date: '2026-06-' + String(index + 1).padStart(2, '0'),
            open: 101, high: 102, low: 99, close: 101, vol: 1000, _signals: []
        }));
        full[65]._decision = { position: 30, prevAdv: 0, bsMark: 'B' };
        for (var heldDay = 66; heldDay < 70; heldDay++) full[heldDay]._decision = { position: 30, prevAdv: 30, bsMark: null };
        full[70] = { ...full[70], open: 100.4, high: 100.7, low: 99.4, close: 99.8 };
        full[71] = { ...full[71], open: 100, high: 100.4, low: 99.2, close: 99.6 };
        full[72] = { ...full[72], open: 100, high: 101.4, low: 99.8, close: 101 };
        var previousMeta = {
            type: '👀 关注异动', windowScore: 3, buySignals: [], exitSignals: [], warningSignals: [], allSignals: {},
            windowSignals: [{ signal: 'B11', day: 60 }, { signal: 'B8', day: 60 }],
            windowScoreSignals: [{ signal: 'B11', day: 60, score: 2 }, { signal: 'B8', day: 60, score: 1 }],
            invalidatedWindowSignals: [], localBreakWindowSignals: [], inCooldown: false
        };
        var weakMeta = {
            type: '👀 弱势震荡', windowScore: 0, buySignals: [], exitSignals: [], warningSignals: [], allSignals: {},
            windowSignals: [], windowScoreSignals: [], invalidatedWindowSignals: [], localBreakWindowSignals: [], inCooldown: false
        };
        var trendMeta = { ...weakMeta, type: '📈 趋势抱单', currentDay: 72, currentClose: 101 };
        var metaByDay = { 69: previousMeta, 70: weakMeta, 71: weakMeta, 72: trendMeta };
        getSignalMeta = index => metaByDay[index] || weakMeta;
        getMarketContext = () => ({ label: '核心宽基分化', cls: 'neutral', increaseCaps: null });
        getRiskContext = () => ({ score: 80, level: '低波动/偏离', coef: 1, flags: [], stop: 95, pressure: 110 });
        getExitSeverity = () => ({ level: '无明确离场', detail: '无' });
        getPositionCap = () => null;
        getTargetStrengthTier = () => ({ tier: 'ordinary', label: '普通机会', reasons: [] });

        var firstWashoutDay = computeDecisionForIndex(70, full, 30);
        full[70]._decision = firstWashoutDay;
        var secondWashoutDay = computeDecisionForIndex(71, full, 30);
        full[71]._decision = secondWashoutDay;
        var secondWashoutSummary = getStockDecisionSummary(weakMeta, secondWashoutDay);
        var recoveredTrendDay = computeDecisionForIndex(72, full, 30);
    `, context);
    assert.strictEqual(vm.runInContext('firstWashoutDay.position', context), 30, vm.runInContext('JSON.stringify(firstWashoutDay, null, 2)', context));
    assert.strictEqual(vm.runInContext('firstWashoutDay.bsMark', context), null);
    assert.strictEqual(vm.runInContext('firstWashoutDay.waveExpiryHandoff.trendWashout', context), true);
    assert.strictEqual(vm.runInContext('secondWashoutDay.position', context), 30);
    assert.strictEqual(vm.runInContext('secondWashoutDay.bsMark', context), null);
    assert.strictEqual(vm.runInContext('secondWashoutDay.waveExpiryHandoff.status', context), 'observing');
    assert.strictEqual(vm.runInContext('secondWashoutDay.waveExpiryHandoff.observationAge', context), 1);
    assert.strictEqual(vm.runInContext('secondWashoutSummary.state', context), '趋势洗盘观察');
    assert.ok(vm.runInContext('secondWashoutSummary.why.includes("积分仅因窗口到期")', context));
    assert.strictEqual(vm.runInContext('secondWashoutSummary.positionWhyCode', context), 'expiry-handoff-trend-washout');
    assert.strictEqual(vm.runInContext('recoveredTrendDay.position', context), 30);
    assert.strictEqual(vm.runInContext('recoveredTrendDay.bsMark', context), null);
    assert.strictEqual(vm.runInContext('recoveredTrendDay.waveExpiryHandoff.status', context), 'taken_over');
});

runTest('wave signal hard-invalidation recovery still requires price recovery', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(calcSource, context);
    vm.runInContext(`
        setActiveStrategy('波段抄底型');
        state.mode = 'stock';
        state.period = 'daily';
        state.indicators = {
            ma: { 20: Array(74).fill(110), 60: Array(74).fill(120) },
            macd: {}, rsi: {}, kdj: {}
        };
        var full = Array.from({ length: 74 }, (_, index) => ({
            date: '2026-05-' + String(index + 1).padStart(2, '0'),
            open: 100, high: 101, low: 99, close: 100, vol: 1000, _signals: []
        }));
        full[68] = { ...full[68], low: 95, close: 100, _decision: { position: 30, prevAdv: 0, bsMark: 'B' } };
        full[69]._decision = { position: 30, prevAdv: 30, bsMark: null };
        full[70]._decision = { position: 30, prevAdv: 30, bsMark: null };
        full[71] = { ...full[71], open: 99.5, high: 100.5, low: 98.5, close: 98.8 };
        var hardMeta = {
            currentDay: 71, currentClose: 98.8, type: '👀 弱势震荡', windowScore: 0,
            buySignals: [], exitSignals: [], warningSignals: [], windowSignals: [], windowScoreSignals: [],
            invalidatedWindowSignals: [{
                signal: 'B16', day: 68, signalDate: full[68].date, score: 3,
                reason: 'price-break', invalidationDay: 71, invalidationDate: full[71].date, invalidationLevel: 99
            }],
            localBreakWindowSignals: [], allSignals: {}, inCooldown: false
        };
        var triggered = getWaveRejectionProtectionContext(71, full, hardMeta, 30, 0, STRATEGY);
        full[71]._decision = { position: 0, prevAdv: 30, bsMark: 'S', waveRejectionProtection: triggered };

        full[72] = { ...full[72], open: 99, high: 100, low: 98.7, close: 99.2, _signals: ['B9'] };
        var recoveryMeta = {
            currentDay: 72, currentClose: 99.2, type: '✅ 明确转强', windowScore: 4,
            buySignals: ['B9'], exitSignals: [], warningSignals: [], windowSignals: [{ day: 72, signal: 'B9' }],
            windowScoreSignals: [{ day: 72, signal: 'B9', score: 4 }], invalidatedWindowSignals: [],
            localBreakWindowSignals: [], allSignals: { B9: { status: true } }, inCooldown: false
        };
        var locked = getWaveRejectionProtectionContext(72, full, recoveryMeta, 0, 30, STRATEGY);
        full[72]._decision = { position: 0, prevAdv: 0, bsMark: null, waveRejectionProtection: locked };

        full[73] = { ...full[73], open: 99, high: 100, low: 98.9, close: 99.2, _signals: ['B9'] };
        recoveryMeta = { ...recoveryMeta, currentDay: 73, currentClose: 99.2 };
        var released = getWaveRejectionProtectionContext(73, full, recoveryMeta, 0, 30, STRATEGY);

        full[73] = { ...full[73], close: 98.9, _signals: ['B9'] };
        recoveryMeta = { ...recoveryMeta, currentClose: 98.9 };
        var singleSignalLocked = getWaveRejectionProtectionContext(73, full, recoveryMeta, 0, 30, STRATEGY);

        full[73]._signals = ['B9', 'B16'];
        var strongRecoveryMeta = {
            ...recoveryMeta, windowScore: 7, buySignals: ['B9', 'B16'],
            windowSignals: [{ day: 72, signal: 'B9' }, { day: 73, signal: 'B16' }],
            windowScoreSignals: [{ day: 72, signal: 'B9', score: 4 }, { day: 73, signal: 'B16', score: 3 }],
            allSignals: { B9: { status: true }, B16: { status: true } }
        };
        var ordinaryStrongSignalLocked = getWaveRejectionProtectionContext(73, full, strongRecoveryMeta, 0, 30, STRATEGY);

        full[72]._decision.waveRejectionProtection = { ...locked, eventType: 'fresh_entry_hard_break' };
        full[73]._signals = ['B9'];
        var freshSingleSignalLocked = getWaveRejectionProtectionContext(73, full, recoveryMeta, 0, 30, STRATEGY);
        full[73]._signals = ['B9', 'B16'];
        var freshStrongSignalReleased = getWaveRejectionProtectionContext(73, full, strongRecoveryMeta, 0, 30, STRATEGY);
    `, context);
    assert.strictEqual(vm.runInContext('triggered.status', context), 'triggered');
    assert.strictEqual(vm.runInContext('triggered.eventType', context), 'signal_hard_invalidation');
    assert.strictEqual(vm.runInContext('triggered.recoveryCloseLevel', context), 99);
    assert.strictEqual(vm.runInContext('locked.status', context), 'locked');
    assert.strictEqual(vm.runInContext('locked.targetPosition', context), 0);
    assert.strictEqual(vm.runInContext('locked.lockRemaining', context), 1);
    assert.strictEqual(vm.runInContext('released.status', context), 'released');
    assert.strictEqual(vm.runInContext('released.targetPosition', context), 30);
    assert.strictEqual(vm.runInContext('released.stableRecovery', context), true);
    assert.strictEqual(vm.runInContext('singleSignalLocked.status', context), 'locked');
    assert.strictEqual(vm.runInContext('singleSignalLocked.strongFreshRecovery', context), false);
    assert.strictEqual(vm.runInContext('ordinaryStrongSignalLocked.status', context), 'locked');
    assert.strictEqual(vm.runInContext('ordinaryStrongSignalLocked.strongFreshRecovery', context), false);
    assert.strictEqual(vm.runInContext('freshSingleSignalLocked.status', context), 'locked');
    assert.strictEqual(vm.runInContext('freshSingleSignalLocked.strongFreshRecovery', context), false);
    assert.strictEqual(vm.runInContext('freshStrongSignalReleased.status', context), 'released');
    assert.strictEqual(vm.runInContext('freshStrongSignalReleased.targetPosition', context), 30);
    assert.strictEqual(vm.runInContext('freshStrongSignalReleased.stableRecovery', context), false);
    assert.strictEqual(vm.runInContext('freshStrongSignalReleased.strongFreshRecovery', context), true);
    assert.strictEqual(vm.runInContext('freshStrongSignalReleased.postEventScore', context), 7);
    assert.strictEqual(vm.runInContext('freshStrongSignalReleased.postEventScoreSignals.length', context), 2);
});

runTest('wave signal hard-invalidation preserves trial position while frozen structure holds', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(calcSource, context);
    vm.runInContext(`
        setActiveStrategy('波段抄底型');
        state.mode = 'stock';
        state.period = 'daily';
        state.indicators = { ma: { 20: [100, 100, 100], 60: [110, 110, 110] }, macd: {}, rsi: {}, kdj: {} };
        var full = [
            { date: '2026-07-22', open: 7.10, high: 7.20, low: 6.97, close: 7.10, vol: 1000, _signals: [] },
            { date: '2026-07-23', open: 7.10, high: 7.20, low: 7.055, close: 7.10, vol: 1000, _signals: [], _decision: {
                position: 30, prevAdv: 30, bsMark: null,
                waveContext: { lifecycle: { active: true, entryDay: 0, hardDefense: 7.015, localDefense: 7.055, supportSource: 'weekly-pivot' } }
            } },
            { date: '2026-07-24', open: 7.255, high: 7.325, low: 7.025, close: 7.035, vol: 1000, _signals: [] }
        ];
        getSignalMeta = () => ({ exitSignals: [], warningSignals: [], inCooldown: false });
        getTodaySignalInvalidations = () => [{ signal: 'B16', score: 3, reason: 'price-break', invalidationDay: 2, invalidationLevel: 7.055 }];
        getWaveRegimeQualification = () => ({ freshGroups: [], multiTimeframeProbeQualified: false });
        var candidate = {
            position: 0, prevAdv: 30,
            exit: { level: '无明确离场' },
            simpleAction: '轻仓持有', simpleColorClass: 'text-info', bsMark: null,
            risk: { score: 80 }, positionDriver: '',
            waveRejectionProtection: { status: 'triggered', eventType: 'signal_hard_invalidation', targetPosition: 0 },
            waveContext: { inScope: true, regime: 'down', regimeLabel: '下跌', boxSupport: null, boxPressure: null, boxMidpoint: null, box: { valid: false, atr14: 1 } }
        };
        var governed = applyWaveRegimeGovernance(2, full, 30, candidate, STRATEGY);
        var summaryMeta = {
            currentDay: 2, currentClose: 7.035, windowScore: 0, buySignals: [], exitSignals: [], warningSignals: [],
            windowSignals: [], windowScoreSignals: [], invalidatedWindowSignals: [], localBreakWindowSignals: [], allSignals: {}, inCooldown: false
        };
        var summary = getStockDecisionSummary(summaryMeta, { ...governed, previousWindowScore: 3, basePosition: 0 });
    `, context);
    assert.strictEqual(vm.runInContext('governed.position', context), 30);
    assert.strictEqual(vm.runInContext('governed.bsMark', context), null);
    assert.ok(vm.runInContext('governed.waveContext.mainEvent.includes("保留30%试探仓观察")', context));
    assert.strictEqual(vm.runInContext('governed.waveContext.frozenHardDefense', context), 7.015);
    assert.strictEqual(vm.runInContext('summary.state', context), '结构未破');
    assert.strictEqual(vm.runInContext('summary.action', context), '轻仓观察');
    assert.ok(vm.runInContext('summary.why.includes("不生成S")', context));
    assert.strictEqual(vm.runInContext('summary.positionWhyCode', context), 'rejection-signal-local-hold');
});

runTest('wave hard invalidation allows MA20 support recovery in an uptrend', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(calcSource, context);
    vm.runInContext(`
        setActiveStrategy('波段抄底型');
        state.mode = 'stock';
        state.period = 'daily';
        state.indicators = {
            ma: { 20: Array(73).fill(109), 60: Array(73).fill(100) },
            macd: {}, rsi: {}, kdj: {}
        };
        var full = Array.from({ length: 73 }, (_, index) => ({
            date: '2026-06-' + String(index + 1).padStart(2, '0'),
            open: 110, high: 112, low: 108, close: 110, vol: 1000, _signals: []
        }));
        full[70]._decision = {
            position: 0,
            prevAdv: 30,
            bsMark: 'S',
            waveRejectionProtection: {
                active: true,
                status: 'triggered',
                eventType: 'signal_hard_invalidation',
                triggerDay: 70,
                triggerDate: full[70].date,
                triggerHigh: 116,
                triggerLow: 106,
                triggerClose: 108,
                recoveryCloseLevel: 112,
                sourcePosition: 30,
                targetPosition: 0
            }
        };
        full[71]._signals = [];
        full[71]._decision = {
            position: 0,
            prevAdv: 0,
            bsMark: null,
            waveRejectionProtection: full[70]._decision.waveRejectionProtection
        };
        full[72] = { ...full[72], open: 109.5, high: 111.5, low: 108.5, close: 110.5, _signals: ['B11'] };
        var supportMeta = {
            currentDay: 72, currentClose: 110.5, type: '✅ 明确转强', windowScore: 2,
            buySignals: ['B11'], exitSignals: [], warningSignals: [], windowSignals: [{ day: 72, signal: 'B11' }],
            windowScoreSignals: [{ day: 72, signal: 'B11', score: 2 }], invalidatedWindowSignals: [],
            localBreakWindowSignals: [], allSignals: { B11: { status: true } }, inCooldown: false
        };
        var recovered = getWaveRejectionProtectionContext(72, full, supportMeta, 0, 0, STRATEGY, {
            riskPositionCap: 30,
            market: { increaseCaps: null },
            targetStrength: { tier: 'ordinary' },
            exit: { level: '无明确离场' },
            positionCap: { limit: 30 },
            trendRegime: { key: 'up' }
        });
    `, context);
    assert.strictEqual(vm.runInContext('recovered.status', context), 'released');
    assert.strictEqual(vm.runInContext('recovered.pullbackRecovery', context), true);
    assert.strictEqual(vm.runInContext('recovered.targetPosition', context), 30);
});

runTest('wave entry-day pressure veto blocks a downtrend long-upper-shadow B and locks next-day re-entry', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(calcSource, context);
    vm.runInContext("getWaveContext = () => ({ inScope: false, regime: 'down' });", context);
    vm.runInContext(`
        setActiveStrategy('波段抄底型');
        state.mode = 'stock';
        state.period = 'daily';
        state.indicators = {
            ma: { 20: Array(73).fill(4.60), 60: Array(73).fill(5.35) },
            macd: {}, rsi: {}, kdj: {}
        };
        state.indicators.ma[20][65] = 4.80;
        state.indicators.ma[20][70] = 4.5365;
        state.indicators.ma[20][71] = 4.49;
        state.indicators.ma[20][72] = 4.45;
        var full = Array.from({ length: 73 }, (_, index) => ({
            date: '2026-06-' + String(index + 1).padStart(2, '0'),
            open: 4.10, high: 4.20, low: 4.00, close: 4.12, vol: 1000, _signals: []
        }));
        full[70] = { ...full[70], date: '2026-06-15', open: 4.20, high: 4.54, low: 4.16, close: 4.23, _signals: ['B16'] };
        var entryMeta = {
            type: '👀 关注异动', windowScore: 3, buySignals: ['B16'], exitSignals: [], warningSignals: [],
            allSignals: { B16: true }, windowSignals: [{ day: 70, signal: 'B16' }],
            windowScoreSignals: [{ day: 70, signal: 'B16' }], invalidatedWindowSignals: [], inCooldown: false
        };
        var recoveryMeta = {
            type: '✅ 明确转强', windowScore: 4, buySignals: ['B9'], exitSignals: [], warningSignals: [],
            allSignals: { B9: true }, windowSignals: [{ day: 71, signal: 'B9' }],
            windowScoreSignals: [{ day: 71, signal: 'B9' }], invalidatedWindowSignals: [], inCooldown: false
        };
        getSignalMeta = idx => idx === 70 ? entryMeta : recoveryMeta;
        getMarketContext = () => ({ label: '核心宽基分化', cls: 'neutral', increaseCaps: null });
        getRiskContext = () => ({ score: 100, level: '低波动/偏离', coef: 1, flags: [], stop: 4.07, pressure: 4.54 });
        getExitSeverity = () => ({ level: '无明确离场', detail: '无' });
        getBasePosition = () => 30;
        getPositionCap = () => null;
        getTargetStrengthTier = () => ({ tier: 'ordinary', label: '普通机会', reasons: [] });

        var vetoDecision = computeDecisionForIndex(70, full, 0);
        var vetoSummary = getStockDecisionSummary(entryMeta, vetoDecision);

        full[70] = { ...full[70], close: 4.48 };
        var strongCloseDecision = computeDecisionForIndex(70, full, 0);

        full[70] = { ...full[70], close: 4.23 };
        state.indicators.ma[20][65] = 4.40;
        var risingMA20Decision = computeDecisionForIndex(70, full, 0);

        state.indicators.ma[20][65] = 4.80;
        state.mode = 'index';
        var indexDecision = computeDecisionForIndex(70, full, 0);

        state.mode = 'stock';
        setActiveStrategy('综合全能型');
        var otherStrategyDecision = computeDecisionForIndex(70, full, 0);

        setActiveStrategy('波段抄底型');
        full[70]._decision = vetoDecision;
        full[71] = { ...full[71], date: '2026-06-16', open: 4.10, high: 4.22, low: 4.05, close: 4.18, _signals: ['B9'] };
        var nextDayDecision = computeDecisionForIndex(71, full, 0);
        full[71]._decision = nextDayDecision;

        full[72] = { ...full[72], date: '2026-06-17', open: 4.30, high: 4.58, low: 4.28, close: 4.56, _signals: [] };
        var secondDayDecision = computeDecisionForIndex(72, full, 0);
    `, context);
    assert.strictEqual(vm.runInContext('vetoDecision.position', context), 0);
    assert.strictEqual(vm.runInContext('vetoDecision.bsMark', context), null);
    assert.strictEqual(vm.runInContext('vetoDecision.waveRejectionProtection.status', context), 'entry_blocked');
    assert.strictEqual(vm.runInContext('vetoDecision.waveRejectionProtection.eventType', context), 'entry_day_pressure_rejection');
    assert.ok(vm.runInContext('vetoDecision.waveRejectionProtection.upperShadowRangeRatio > 0.8', context));
    assert.ok(vm.runInContext('vetoDecision.waveRejectionProtection.pressureSources.some(item => item.type === "ma" && item.period === 20)', context));
    assert.strictEqual(vm.runInContext('vetoSummary.state', context), '压力受阻');
    assert.ok(vm.runInContext('vetoSummary.why.includes("长上影") && vetoSummary.why.includes("MA20")', context));
    assert.strictEqual(vm.runInContext('strongCloseDecision.position', context), 30);
    assert.strictEqual(vm.runInContext('strongCloseDecision.bsMark', context), 'B');
    assert.strictEqual(vm.runInContext('risingMA20Decision.position', context), 30);
    assert.strictEqual(vm.runInContext('indexDecision.position', context), 30);
    assert.strictEqual(vm.runInContext('otherStrategyDecision.position', context), 30);
    assert.strictEqual(vm.runInContext('nextDayDecision.position', context), 0);
    assert.strictEqual(vm.runInContext('nextDayDecision.bsMark', context), null);
    assert.strictEqual(vm.runInContext('nextDayDecision.waveRejectionProtection.status', context), 'locked');
    assert.strictEqual(vm.runInContext('nextDayDecision.waveRejectionProtection.lockRemaining', context), 1);
    assert.strictEqual(vm.runInContext('secondDayDecision.position', context), 30);
    assert.strictEqual(vm.runInContext('secondDayDecision.bsMark', context), 'B');
    assert.strictEqual(vm.runInContext('secondDayDecision.waveRejectionProtection.status', context), 'released');
});

runTest('wave fresh entry failure exits below MA20 after rejection but preserves a close above MA20', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(calcSource, context);
    vm.runInContext(`
        setActiveStrategy('波段抄底型');
        state.mode = 'stock';
        state.period = 'daily';
        var full = Array.from({ length: 72 }, (_, index) => ({
            date: '2026-06-' + String(index + 1).padStart(2, '0'),
            open: 3.90, high: 3.96, low: 3.84, close: 3.90, vol: 500000, _signals: []
        }));
        state.indicators = { ma: { 20: Array(72).fill(3.70), 60: Array(72).fill(4.14) }, macd: {}, rsi: {}, kdj: {} };
        state.indicators.ma[20][65] = 4.00;
        state.indicators.ma[20][70] = 3.92;
        state.indicators.ma[60][65] = 4.20;
        full[69]._decision = { position: 30, prevAdv: 0, bsMark: 'B' };
        full[69] = { ...full[69], date: '2026-06-15', open: 3.94, high: 3.99, low: 3.86, close: 3.90 };
        full[70] = { ...full[70], date: '2026-06-16', open: 3.86, high: 4.04, low: 3.83, close: 3.90, vol: 563380 };
        var meta = {
            type: '✅ 明确转强', windowScore: 4, buySignals: ['B17'], exitSignals: [], warningSignals: [],
            allSignals: {}, windowSignals: [], windowScoreSignals: [], invalidatedWindowSignals: [], inCooldown: false
        };
        getSignalMeta = () => meta;
        getMarketContext = () => ({ label: '核心宽基分化', cls: 'neutral', increaseCaps: null });
        getRiskContext = () => ({ score: 100, level: '低波动/偏离', coef: 1, flags: [], stop: 3.56, pressure: 4.14 });
        getExitSeverity = () => ({ level: '无明确离场', detail: '无' });
        getBasePosition = () => 30;
        getPositionCap = () => null;
        getTargetStrengthTier = () => ({ tier: 'ordinary', label: '普通机会', reasons: [] });
        var decision = computeDecisionForIndex(70, full, 30);
        var summary = getStockDecisionSummary(meta, decision);

        full[70] = { ...full[70], close: 3.91 };
        var aboveEntryCloseDecision = computeDecisionForIndex(70, full, 30);
        full[70] = { ...full[70], close: 3.93 };
        var aboveMa20Decision = computeDecisionForIndex(70, full, 30);
        full[70] = { ...full[70], close: 3.90 };
        state.indicators.ma[20][70] = 3.70;
        state.indicators.ma[60][70] = 4.30;
        var withoutPressureDecision = computeDecisionForIndex(70, full, 30);
        state.indicators.ma[60][70] = 4.14;
        state.mode = 'index';
        var indexDecision = computeDecisionForIndex(70, full, 30);

        state.mode = 'stock';
        full[70] = { ...full[70], open: 3.95, high: 4.04, low: 3.90, close: 3.96, _decision: { position: 30, prevAdv: 30, bsMark: null } };
        full[71] = { ...full[71], open: 3.96, high: 4.09, low: 3.88, close: 3.90, vol: 563380 };
        state.indicators.ma[20][66] = 4.00;
        state.indicators.ma[20][71] = 3.94;
        state.indicators.ma[60][71] = 4.14;
        var secondDayHigherHighDecision = computeDecisionForIndex(71, full, 30);
        var secondDayHigherHighSummary = getStockDecisionSummary(meta, secondDayHigherHighDecision);
    `, context);
    assert.strictEqual(vm.runInContext('decision.position', context), 0);
    assert.strictEqual(vm.runInContext('decision.bsMark', context), 'S');
    assert.strictEqual(vm.runInContext('decision.waveRejectionProtection.eventType', context), 'fresh_entry_failure');
    assert.strictEqual(vm.runInContext('decision.waveRejectionProtection.entryAge', context), 1);
    assert.ok(vm.runInContext('decision.waveRejectionProtection.pressureSources.some(item => item.type === "ma" && item.period === 20)', context));
    assert.strictEqual(vm.runInContext('decision.waveRejectionProtection.ma20RejectionExit', context), true);
    assert.strictEqual(vm.runInContext('summary.state', context), '新仓失败离场');
    assert.ok(vm.runInContext('summary.why.includes("收盘重新落回MA20下方")', context));
    assert.strictEqual(vm.runInContext('aboveEntryCloseDecision.position', context), 0);
    assert.strictEqual(vm.runInContext('aboveEntryCloseDecision.waveRejectionProtection.ma20RejectionExit', context), true);
    assert.strictEqual(vm.runInContext('aboveMa20Decision.position', context), 30);
    assert.strictEqual(vm.runInContext('aboveMa20Decision.bsMark', context), null);
    assert.strictEqual(vm.runInContext('aboveMa20Decision.waveRejectionProtection.status', context), 'ma20_hold');
    assert.strictEqual(vm.runInContext('withoutPressureDecision.position', context), 30);
    assert.strictEqual(vm.runInContext('withoutPressureDecision.waveRejectionProtection.status', context), 'none');
    assert.strictEqual(vm.runInContext('indexDecision.position', context), 30);
    assert.strictEqual(vm.runInContext('indexDecision.waveRejectionProtection.status', context), 'none');
    assert.strictEqual(vm.runInContext('secondDayHigherHighDecision.position', context), 0);
    assert.strictEqual(vm.runInContext('secondDayHigherHighDecision.bsMark', context), 'S');
    assert.strictEqual(vm.runInContext('secondDayHigherHighDecision.waveRejectionProtection.pressureAttackType', context), 'higher_high');
    assert.ok(vm.runInContext('secondDayHigherHighSummary.why.includes("第二个交易日高点较前一日继续提高1.2%")', context));
});

runTest('real Tianfu Wenlv fixture keeps 30 percent when the rejection still closes above MA20', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(dataSource, context);
    vm.runInContext(calcSource, context);
    vm.runInContext("getWaveContext = () => ({ inScope: false, regime: 'down' });", context);
    context.__tianfuRows = readJsonFixture('.local/strategy-cache/stock_000558_0_000558_101_fqt1_lmt1000.json');
    context.__coreRows = {
        hs300: readJsonFixture('.local/strategy-cache/index_hs300_1_000300_101_fqt1_lmt1000.json'),
        zz500: readJsonFixture('.local/strategy-cache/index_zz500_1_000905_101_fqt1_lmt1000.json'),
        zz1000: readJsonFixture('.local/strategy-cache/index_zz1000_1_000852_101_fqt1_lmt1000.json')
    };
    vm.runInContext(`
        setActiveStrategy('波段抄底型');
        state.mode = 'stock';
        state.period = 'daily';
        state.id = '000558';
        state.stockId = '000558';
        state.rawData = {
            '000558': __tianfuRows.map(row => ({ ...row })),
            hs300: __coreRows.hs300.map(row => ({ ...row })),
            zz500: __coreRows.zz500.map(row => ({ ...row })),
            zz1000: __coreRows.zz1000.map(row => ({ ...row }))
        };
        state.weeklyData = {};
        resetIndicatorState();
        derivedIndicatorCache.clear();
        dateIndexCache.clear();
        updateAllIndicators();
        var tianfuFull = state.rawData['000558'];
        var tianfuEntryIdx = findDateIndex(tianfuFull, '2026-06-15', '000558');
        var tianfuExitIdx = findDateIndex(tianfuFull, '2026-06-16', '000558');
        var tianfuEntryDecision = tianfuFull[tianfuEntryIdx]._decision;
        var tianfuExitDecision = tianfuFull[tianfuExitIdx]._decision;
        var tianfuExitMeta = getSignalMeta(tianfuExitIdx, tianfuFull, state.indicators);
        var tianfuExitSummary = getStockDecisionSummary(tianfuExitMeta, tianfuExitDecision);
    `, context);
    assert.strictEqual(vm.runInContext('tianfuEntryDecision.position', context), 30);
    assert.strictEqual(vm.runInContext('tianfuEntryDecision.bsMark', context), 'B');
    assert.strictEqual(vm.runInContext('tianfuExitDecision.position', context), 30);
    assert.strictEqual(vm.runInContext('tianfuExitDecision.bsMark', context), null);
    assert.strictEqual(vm.runInContext('tianfuExitDecision.waveRejectionProtection.status', context), 'ma20_hold');
    assert.strictEqual(vm.runInContext('tianfuExitDecision.waveRejectionProtection.eventType', context), 'fresh_entry_ma20_hold');
    assert.strictEqual(vm.runInContext('tianfuExitSummary.state', context), 'MA20上方观察');
    assert.ok(vm.runInContext('tianfuExitSummary.why.includes("收盘仍站在MA20上方")', context));
});

runTest('real Changshan Beiming fixture exits MA20 rejection trials and ignores a same-zone repeat', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(dataSource, context);
    vm.runInContext(calcSource, context);
    vm.runInContext("getWaveContext = () => ({ inScope: false, regime: 'down' });", context);
    context.__changshanRows = readJsonFixture('.local/strategy-cache/stock_000158_0_000158_101_fqt1_lmt1000.json');
    context.__coreRows = {
        hs300: readJsonFixture('.local/strategy-cache/index_hs300_1_000300_101_fqt1_lmt1000.json'),
        zz500: readJsonFixture('.local/strategy-cache/index_zz500_1_000905_101_fqt1_lmt1000.json'),
        zz1000: readJsonFixture('.local/strategy-cache/index_zz1000_1_000852_101_fqt1_lmt1000.json')
    };
    vm.runInContext(`
        setActiveStrategy('波段抄底型');
        state.mode = 'stock';
        state.period = 'daily';
        state.id = '000158';
        state.stockId = '000158';
        state.rawData = {
            '000158': __changshanRows.map(row => ({ ...row })),
            hs300: __coreRows.hs300.map(row => ({ ...row })),
            zz500: __coreRows.zz500.map(row => ({ ...row })),
            zz1000: __coreRows.zz1000.map(row => ({ ...row }))
        };
        state.weeklyData = {};
        resetIndicatorState();
        derivedIndicatorCache.clear();
        dateIndexCache.clear();
        updateAllIndicators();
        var changshanFull = state.rawData['000158'];
        var changshanFirstEntryIdx = findDateIndex(changshanFull, '2026-05-25', '000158');
        var changshanFirstExitIdx = findDateIndex(changshanFull, '2026-05-26', '000158');
        var changshanSecondEntryIdx = findDateIndex(changshanFull, '2026-06-09', '000158');
        var changshanSecondExitIdx = findDateIndex(changshanFull, '2026-06-10', '000158');
        var changshanEntryIdx = findDateIndex(changshanFull, '2026-07-28', '000158');
        var changshanPriorIdx = findDateIndex(changshanFull, '2026-07-29', '000158');
        var changshanRepeatIdx = findDateIndex(changshanFull, '2026-07-30', '000158');
        var changshanFirstEntry = changshanFull[changshanFirstEntryIdx]._decision;
        var changshanFirstExit = changshanFull[changshanFirstExitIdx]._decision;
        var changshanActualSecondEntry = changshanFull[changshanSecondEntryIdx]._decision;
        var changshanEntry = changshanFull[changshanEntryIdx]._decision;
        var changshanPrior = changshanFull[changshanPriorIdx]._decision;
        var changshanRepeat = changshanFull[changshanRepeatIdx]._decision;
        var savedSecondEntry = changshanFull[changshanSecondEntryIdx]._decision;
        changshanFull[changshanSecondEntryIdx]._decision = {
            ...savedSecondEntry,
            position: 30,
            prevAdv: 0,
            bsMark: 'B',
            waveRejectionProtection: { active: false, status: 'none', targetPosition: 30 }
        };
        var changshanIsolatedSecondExit = computeDecisionForIndex(changshanSecondExitIdx, changshanFull, 30);
        changshanFull[changshanSecondEntryIdx]._decision = savedSecondEntry;
    `, context);
    const result = JSON.parse(vm.runInContext(`JSON.stringify({
        firstEntry: changshanFirstEntry,
        firstExit: changshanFirstExit,
        actualSecondEntry: changshanActualSecondEntry,
        isolatedSecondExit: changshanIsolatedSecondExit,
        entry: changshanEntry,
        prior: changshanPrior,
        repeat: changshanRepeat
    })`, context));
    assert.strictEqual(result.firstEntry.position, 30);
    assert.strictEqual(result.firstEntry.bsMark, 'B');
    assert.strictEqual(result.firstExit.position, 0);
    assert.strictEqual(result.firstExit.bsMark, 'S');
    assert.strictEqual(result.firstExit.waveRejectionProtection.eventType, 'fresh_entry_failure');
    assert.strictEqual(result.firstExit.waveRejectionProtection.ma20RejectionExit, true);
    assert.strictEqual(result.actualSecondEntry.position, 0);
    assert.strictEqual(result.actualSecondEntry.waveRejectionProtection.status, 'locked');
    assert.strictEqual(result.isolatedSecondExit.position, 0);
    assert.strictEqual(result.isolatedSecondExit.bsMark, 'S');
    assert.strictEqual(result.isolatedSecondExit.waveRejectionProtection.eventType, 'fresh_entry_failure');
    assert.strictEqual(result.isolatedSecondExit.waveRejectionProtection.ma20RejectionExit, true);
    assert.strictEqual(result.entry.position, 30);
    assert.strictEqual(result.entry.bsMark, 'B');
    assert.strictEqual(result.prior.position, 30);
    assert.strictEqual(result.prior.bsMark, null);
    assert.strictEqual(result.repeat.position, 30, JSON.stringify(result.repeat.waveRejectionProtection, null, 2));
    assert.strictEqual(result.repeat.bsMark, null);
    assert.strictEqual(result.repeat.waveRejectionProtection.status, 'none');
});

runTest('real Changshan Beiming pressure veto restores a 30 percent trial after the observation day', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(dataSource, context);
    vm.runInContext(calcSource, context);
    context.__changshanRows = readJsonFixture('.local/strategy-cache/stock_000158_0_000158_101_fqt1_lmt1000.json');
    context.__coreRows = {
        hs300: readJsonFixture('.local/strategy-cache/index_hs300_1_000300_101_fqt1_lmt1000.json'),
        zz500: readJsonFixture('.local/strategy-cache/index_zz500_1_000905_101_fqt1_lmt1000.json'),
        zz1000: readJsonFixture('.local/strategy-cache/index_zz1000_1_000852_101_fqt1_lmt1000.json')
    };
    vm.runInContext(`
        setActiveStrategy('波段抄底型');
        state.mode = 'stock';
        state.period = 'daily';
        state.id = '000158';
        state.stockId = '000158';
        state.rawData = {
            '000158': __changshanRows.map(row => ({ ...row })),
            hs300: __coreRows.hs300.map(row => ({ ...row })),
            zz500: __coreRows.zz500.map(row => ({ ...row })),
            zz1000: __coreRows.zz1000.map(row => ({ ...row }))
        };
        state.weeklyData = {};
        resetIndicatorState();
        derivedIndicatorCache.clear();
        dateIndexCache.clear();
        updateAllIndicators();
        var changshanFull = state.rawData['000158'];
        var observationIdx = findDateIndex(changshanFull, '2026-07-27', '000158');
        var recoveryIdx = findDateIndex(changshanFull, '2026-07-28', '000158');
        var holdIdx = findDateIndex(changshanFull, '2026-07-29', '000158');
        var observation = changshanFull[observationIdx]._decision;
        var recovery = changshanFull[recoveryIdx]._decision;
        var hold = changshanFull[holdIdx]._decision;
        var observationMeta = getSignalMeta(observationIdx, changshanFull, state.indicators);
        var observationSummary = getStockDecisionSummary(observationMeta, observation);
        var observationPressureVeto = getWaveEntryDayPressureVetoContext(observationIdx, changshanFull, observationMeta, observation.prevAdv, observation.position, STRATEGY);
    `, context);
    const result = JSON.parse(vm.runInContext(`JSON.stringify({
        observation: {
            position: observation.position,
            bsMark: observation.bsMark,
            status: observation.waveRejectionProtection.status,
            lockRemaining: observation.waveRejectionProtection.lockRemaining,
            nextFocus: observationSummary.nextFocus
        },
        recovery: {
            position: recovery.position,
            bsMark: recovery.bsMark,
            status: recovery.waveRejectionProtection.status,
            allowRecoveryIncrease: recovery.waveRejectionProtection.allowRecoveryIncrease,
            regime: recovery.waveContext.regime
        },
        hold: {
            position: hold.position,
            bsMark: hold.bsMark
        },
        row: changshanFull[observationIdx],
        meta: observationMeta,
        veto: observationPressureVeto
    })`, context));
    assert.strictEqual(result.observation.position, 0);
    assert.strictEqual(result.observation.bsMark, null);
    assert.strictEqual(result.observation.status, 'locked');
    assert.strictEqual(result.observation.lockRemaining, 1);
    assert.ok(result.observation.nextFocus.includes('第1个观察交易日') && result.observation.nextFocus.includes('下一个交易日重新评估30%试探仓'));
    assert.strictEqual(result.recovery.position, 30, JSON.stringify(result));
    assert.strictEqual(result.recovery.bsMark, 'B');
    assert.strictEqual(result.recovery.status, 'released');
    assert.strictEqual(result.recovery.allowRecoveryIncrease, true);
    assert.strictEqual(result.recovery.regime, 'down');
    assert.strictEqual(result.hold.position, 30);
    assert.strictEqual(result.hold.bsMark, null);
});

runTest('real Haima fixture blocks hard-invalidation churn and post-rejection retries until price recovery', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(dataSource, context);
    vm.runInContext(calcSource, context);
    vm.runInContext("getWaveContext = () => ({ inScope: false, regime: 'down' });", context);
    context.__haimaRows = readJsonFixture('.local/strategy-cache/stock_000572_0_000572_101_fqt1_lmt1000.json');
    context.__coreRows = {
        hs300: readJsonFixture('.local/strategy-cache/index_hs300_1_000300_101_fqt1_lmt1000.json'),
        zz500: readJsonFixture('.local/strategy-cache/index_zz500_1_000905_101_fqt1_lmt1000.json'),
        zz1000: readJsonFixture('.local/strategy-cache/index_zz1000_1_000852_101_fqt1_lmt1000.json')
    };
    vm.runInContext(`
        setActiveStrategy('波段抄底型');
        state.mode = 'stock';
        state.period = 'daily';
        state.id = '000572';
        state.stockId = '000572';
        state.rawData = {
            '000572': __haimaRows.map(row => ({ ...row })),
            hs300: __coreRows.hs300.map(row => ({ ...row })),
            zz500: __coreRows.zz500.map(row => ({ ...row })),
            zz1000: __coreRows.zz1000.map(row => ({ ...row }))
        };
        state.weeklyData = {};
        resetIndicatorState();
        derivedIndicatorCache.clear();
        dateIndexCache.clear();
        updateAllIndicators();
        var haimaFull = state.rawData['000572'];
        var haimaFirstEntryIdx = findDateIndex(haimaFull, '2026-06-01', '000572');
        var haimaHardExitIdx = findDateIndex(haimaFull, '2026-06-04', '000572');
        var haimaImmediateRetryIdx = findDateIndex(haimaFull, '2026-06-05', '000572');
        var haimaEntryIdx = findDateIndex(haimaFull, '2026-06-15', '000572');
        var haimaRetryIdx = findDateIndex(haimaFull, '2026-06-16', '000572');
        var haimaOldExitIdx = findDateIndex(haimaFull, '2026-06-17', '000572');
        var haimaRecoveryIdx = findDateIndex(haimaFull, '2026-06-18', '000572');
        var haimaJulyEntryIdx = findDateIndex(haimaFull, '2026-07-23', '000572');
        var haimaJulyFailureIdx = findDateIndex(haimaFull, '2026-07-24', '000572');
        var haimaDec04Idx = findDateIndex(haimaFull, '2025-12-04', '000572');
        var haimaDec05Idx = findDateIndex(haimaFull, '2025-12-05', '000572');
        var haimaDec09Idx = findDateIndex(haimaFull, '2025-12-09', '000572');
        var haimaDec10Idx = findDateIndex(haimaFull, '2025-12-10', '000572');
        var haimaDec22Idx = findDateIndex(haimaFull, '2025-12-22', '000572');
        var haimaDec25Idx = findDateIndex(haimaFull, '2025-12-25', '000572');
        var haimaDec26Idx = findDateIndex(haimaFull, '2025-12-26', '000572');
        var haimaDec29Idx = findDateIndex(haimaFull, '2025-12-29', '000572');
        var haimaNov28Idx = findDateIndex(haimaFull, '2025-11-28', '000572');
        var haimaDec01Idx = findDateIndex(haimaFull, '2025-12-01', '000572');
        var haimaDec17Idx = findDateIndex(haimaFull, '2025-12-17', '000572');
        var haimaDec18Idx = findDateIndex(haimaFull, '2025-12-18', '000572');
        var haimaFirstEntry = haimaFull[haimaFirstEntryIdx]._decision;
        var haimaHardExit = haimaFull[haimaHardExitIdx]._decision;
        var haimaImmediateRetry = haimaFull[haimaImmediateRetryIdx]._decision;
        var haimaEntry = haimaFull[haimaEntryIdx]._decision;
        var haimaRetry = haimaFull[haimaRetryIdx]._decision;
        var haimaOldExit = haimaFull[haimaOldExitIdx]._decision;
        var haimaRecovery = haimaFull[haimaRecoveryIdx]._decision;
        var haimaJulyEntry = haimaFull[haimaJulyEntryIdx]._decision;
        var haimaJulyFailure = haimaFull[haimaJulyFailureIdx]._decision;
        var haimaDecember = [haimaDec04Idx, haimaDec05Idx, haimaDec09Idx, haimaDec10Idx, haimaDec22Idx, haimaDec25Idx, haimaDec26Idx, haimaDec29Idx].map(index => ({
            date: haimaFull[index].date,
            signals: haimaFull[index]._signals,
            decision: haimaFull[index]._decision
        }));
        var haimaSupportReclaim = [haimaNov28Idx, haimaDec01Idx, haimaDec17Idx, haimaDec18Idx].map(index => ({
            date: haimaFull[index].date,
            signals: haimaFull[index]._signals,
            decision: haimaFull[index]._decision
        }));
        var haimaEntryMeta = getSignalMeta(haimaEntryIdx, haimaFull, state.indicators);
        var haimaEntrySummary = getStockDecisionSummary(haimaEntryMeta, haimaEntry);
        var haimaJulyFailureMeta = getSignalMeta(haimaJulyFailureIdx, haimaFull, state.indicators);
        var haimaJulyFailureSummary = getStockDecisionSummary(haimaJulyFailureMeta, haimaJulyFailure);
    `, context);
    const result = JSON.parse(vm.runInContext(`JSON.stringify({
        firstEntry: haimaFirstEntry,
        hardExit: haimaHardExit,
        immediateRetry: haimaImmediateRetry,
        entry: haimaEntry,
        retry: haimaRetry,
        oldExit: haimaOldExit,
        recovery: haimaRecovery,
        summary: haimaEntrySummary,
        julyEntry: haimaJulyEntry,
        julyFailure: haimaJulyFailure,
        julyFailureSummary: haimaJulyFailureSummary,
        december: haimaDecember,
        supportReclaim: haimaSupportReclaim
    })`, context));
    assert.strictEqual(result.firstEntry.position, 50);
    assert.strictEqual(result.firstEntry.bsMark, 'B');
    assert.strictEqual(result.hardExit.position, 0);
    assert.strictEqual(result.hardExit.bsMark, 'S');
    assert.strictEqual(result.hardExit.waveRejectionProtection.status, 'triggered');
    assert.strictEqual(result.hardExit.waveRejectionProtection.eventType, 'signal_hard_invalidation');
    assert.strictEqual(result.hardExit.waveRejectionProtection.recoveryCloseLevel, 4.47);
    assert.strictEqual(result.immediateRetry.position, 0);
    assert.strictEqual(result.immediateRetry.bsMark, null);
    assert.strictEqual(result.immediateRetry.waveRejectionProtection.status, 'locked');
    assert.strictEqual(result.immediateRetry.waveRejectionProtection.lockRemaining, 1);
    assert.strictEqual(result.immediateRetry.waveRejectionProtection.hasFreshPostEventSignal, true);
    assert.strictEqual(result.entry.position, 0);
    assert.strictEqual(result.entry.bsMark, null);
    assert.strictEqual(result.entry.waveRejectionProtection.status, 'entry_blocked');
    assert.strictEqual(result.entry.waveRejectionProtection.eventType, 'entry_day_pressure_rejection');
    assert.ok(result.entry.waveRejectionProtection.upperShadowRangeRatio > 0.8);
    assert.ok(result.entry.waveRejectionProtection.pressureSources.some(item => item.type === 'ma' && item.period === 20));
    assert.strictEqual(result.retry.position, 0);
    assert.strictEqual(result.retry.bsMark, null);
    assert.strictEqual(result.retry.waveRejectionProtection.status, 'locked');
    assert.strictEqual(result.oldExit.position, 0);
    assert.strictEqual(result.oldExit.bsMark, null);
    assert.strictEqual(result.summary.state, '压力受阻');
    assert.ok(result.summary.why.includes('长上影') && result.summary.why.includes('MA20'));
    assert.strictEqual(result.recovery.position, 0);
    assert.strictEqual(result.recovery.bsMark, null);
    assert.strictEqual(result.recovery.waveRejectionProtection.status, 'locked');
    assert.strictEqual(result.recovery.waveRejectionProtection.hasFreshPostEventSignal, true);
    assert.strictEqual(result.recovery.waveRejectionProtection.recoveredRiskHigh, false);
    assert.strictEqual(result.recovery.waveRejectionProtection.stableRecovery, false);
    assert.strictEqual(result.julyEntry.position, 30);
    assert.strictEqual(result.julyEntry.bsMark, null);
    assert.strictEqual(result.julyFailure.position, 30);
    assert.strictEqual(result.julyFailure.bsMark, null);
    assert.notStrictEqual(result.julyFailureSummary.state, '新仓失败离场');
    const [dec04, dec05, dec09, dec10, dec22, dec25, dec26, dec29] = result.december.map(item => item.decision);
    // B22 让 11-28 的回踩支撑收复提前建仓；风险评分不再把持仓归零，只有真实结构失效才生成 S。
    const [nov28, dec01, dec17, dec18] = result.supportReclaim.map(item => item.decision);
    assert.ok(result.supportReclaim[0].signals.includes('B22'));
    assert.strictEqual(nov28.position, 30);
    assert.strictEqual(nov28.bsMark, 'B');
    assert.strictEqual(dec01.position, 30);
    assert.strictEqual(dec01.bsMark, null);
    assert.strictEqual(dec01.waveRejectionProtection.status, 'none');
    assert.strictEqual(dec17.position, 30);
    assert.strictEqual(dec17.bsMark, null);
    assert.strictEqual(dec17.waveRejectionProtection.status, 'none');
    assert.strictEqual(dec18.position, 0);
    assert.strictEqual(dec18.bsMark, 'S');
    assert.strictEqual(dec04.position, 30, JSON.stringify(result.december, null, 2));
    assert.strictEqual(dec04.bsMark, null);
    assert.strictEqual(dec04.waveRejectionProtection.status, 'none', JSON.stringify(result.december, null, 2));
    assert.strictEqual(dec05.position, 30);
    assert.strictEqual(dec05.bsMark, null);
    assert.strictEqual(dec09.position, 30);
    assert.strictEqual(dec09.bsMark, null);
    assert.strictEqual(dec10.position, 30);
    assert.strictEqual(dec10.bsMark, null);
    assert.strictEqual(dec22.position, 30);
    assert.strictEqual(dec22.bsMark, 'B');
    assert.strictEqual(dec22.waveRejectionProtection.status, 'released');
    assert.strictEqual(dec25.position, 30);
    assert.strictEqual(dec25.bsMark, null);
    assert.strictEqual(dec25.waveRejectionProtection.status, 'none');
    assert.strictEqual(dec26.position, 30);
    assert.strictEqual(dec26.bsMark, null);
    assert.strictEqual(dec29.position, 30);
    assert.strictEqual(dec29.bsMark, null);
});

runTest('wave fresh entry downside failure uses separate stock and index thresholds without affecting other strategies', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(calcSource, context);
    vm.runInContext(`
        setActiveStrategy('波段抄底型');
        state.mode = 'stock';
        state.period = 'daily';
        state.indicators = { ma: {}, macd: {}, rsi: {}, kdj: {} };
        var full = Array.from({ length: 72 }, (_, index) => ({
            date: '2026-07-' + String(index + 1).padStart(2, '0'),
            open: 1.000, high: 1.010, low: 0.990, close: 1.000, vol: 1000, _signals: []
        }));
        full[69] = { ...full[69], open: 0.986, high: 1.000, low: 0.978, close: 0.999, _decision: { position: 30, prevAdv: 0, bsMark: 'B' } };
        full[70] = { ...full[70], open: 0.998, high: 1.004, low: 0.996, close: 0.997, _decision: { position: 30, prevAdv: 30, bsMark: null } };
        full[71] = { ...full[71], open: 0.990, high: 0.994, low: 0.976, close: 0.979, vol: 1200 };
        var meta = {
            type: '✅ 明确转强', windowScore: 4, buySignals: ['B16', 'B8'], exitSignals: [], warningSignals: [],
            allSignals: {}, windowSignals: [], windowScoreSignals: [], invalidatedWindowSignals: [], inCooldown: false
        };
        getSignalMeta = () => meta;
        getMarketContext = () => ({ label: '核心宽基分化', cls: 'neutral', increaseCaps: null });
        getRiskContext = () => ({ score: 100, level: '低波动/偏离', coef: 1, flags: [], stop: 0.95, pressure: 1.02 });
        getExitSeverity = () => ({ level: '无明确离场', detail: '无' });
        getBasePosition = () => 30;
        getPositionCap = () => null;
        getTargetStrengthTier = () => ({ tier: 'ordinary', label: '普通机会', reasons: [] });

        var decision = computeDecisionForIndex(71, full, 30);
        var summary = getStockDecisionSummary(meta, decision);

        full[71] = { ...full[71], close: 0.982 };
        var ordinaryWickDecision = computeDecisionForIndex(71, full, 30);

        full[71] = { ...full[71], close: 0.979, vol: 900 };
        var lowVolumeDecision = computeDecisionForIndex(71, full, 30);

        full[69]._decision = { position: 50, prevAdv: 0, bsMark: 'B' };
        full[70]._decision = { position: 50, prevAdv: 50, bsMark: null };
        full[71] = { ...full[71], close: 0.977, vol: 900 };
        var hardBreakDecision = computeDecisionForIndex(71, full, 50);
        var hardBreakSummary = getStockDecisionSummary(meta, hardBreakDecision);

        full[69]._decision = { position: 30, prevAdv: 0, bsMark: 'B' };
        full[70]._decision = { position: 30, prevAdv: 30, bsMark: null };
        full[71] = { ...full[71], close: 0.979, vol: 900 };
        state.mode = 'index';
        var indexDecision = computeDecisionForIndex(71, full, 30);
        var indexSummary = getIndexDecisionSummary(meta, indexDecision);

        full[71] = { ...full[71], close: 0.982 };
        var indexOrdinaryWickDecision = computeDecisionForIndex(71, full, 30);

        full[71] = { ...full[71], close: 0.979 };
        setActiveStrategy('稳健趋势型');
        var otherStrategyDecision = computeDecisionForIndex(71, full, 30);
    `, context);
    assert.strictEqual(vm.runInContext('decision.position', context), 0);
    assert.strictEqual(vm.runInContext('decision.bsMark', context), 'S');
    assert.strictEqual(vm.runInContext('decision.waveRejectionProtection.eventType', context), 'fresh_entry_downside_failure');
    assert.strictEqual(vm.runInContext('decision.waveRejectionProtection.entryAge', context), 2);
    assert.strictEqual(vm.runInContext('decision.waveRejectionProtection.entrySignalLow', context), 0.978);
    assert.ok(vm.runInContext('decision.waveRejectionProtection.downsideBearBodyRangeRatio >= 0.5', context));
    assert.ok(vm.runInContext('decision.waveRejectionProtection.downsideCloseGapRatio <= 0.0015', context));
    assert.strictEqual(vm.runInContext('summary.state', context), '新仓失败离场');
    assert.ok(vm.runInContext('summary.why.includes("贴近防守位的大阴线")', context));
    assert.strictEqual(vm.runInContext('ordinaryWickDecision.position', context), 30);
    assert.strictEqual(vm.runInContext('ordinaryWickDecision.waveRejectionProtection.status', context), 'none');
    assert.strictEqual(vm.runInContext('lowVolumeDecision.position', context), 30);
    assert.strictEqual(vm.runInContext('lowVolumeDecision.waveRejectionProtection.status', context), 'none');
    assert.strictEqual(vm.runInContext('hardBreakDecision.position', context), 0);
    assert.strictEqual(vm.runInContext('hardBreakDecision.bsMark', context), 'S');
    assert.strictEqual(vm.runInContext('hardBreakDecision.waveRejectionProtection.eventType', context), 'fresh_entry_hard_break');
    assert.ok(vm.runInContext('hardBreakSummary.why.includes("收盘跌破") && hardBreakSummary.why.includes("买入日最低价") && hardBreakSummary.why.includes("收盘0.98")', context));
    assert.strictEqual(vm.runInContext('hardBreakSummary.positionWhyCode', context), 'rejection-fresh-entry-hard-break');
    assert.strictEqual(vm.runInContext('indexDecision.position', context), 0);
    assert.strictEqual(vm.runInContext('indexDecision.bsMark', context), 'S');
    assert.strictEqual(vm.runInContext('indexDecision.waveRejectionProtection.eventType', context), 'fresh_entry_downside_failure');
    assert.ok(vm.runInContext('indexDecision.waveRejectionProtection.downsideBearBodyRangeRatio >= 0.4', context));
    assert.ok(vm.runInContext('indexDecision.waveRejectionProtection.downsideCloseGapRatio <= 0.005', context));
    assert.strictEqual(vm.runInContext('indexSummary.state', context), '指数新仓失败离场');
    assert.ok(vm.runInContext('indexSummary.why.includes("收盘虽收回") && indexSummary.why.includes("弱势阴线")', context));
    assert.strictEqual(vm.runInContext('indexOrdinaryWickDecision.position', context), 30);
    assert.strictEqual(vm.runInContext('indexOrdinaryWickDecision.waveRejectionProtection.status', context), 'none');
    assert.strictEqual(vm.runInContext('otherStrategyDecision.position', context), 30);
    assert.strictEqual(vm.runInContext('otherStrategyDecision.waveRejectionProtection.status', context), 'none');
});

runTest('wave index fresh-entry rejection requires a near-defense bearish long upper shadow at real pressure', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(calcSource, context);
    vm.runInContext(`
        setActiveStrategy('波段抄底型');
        state.mode = 'index';
        state.period = 'daily';
        state.indicators = {
            ma: { 20: Array(72).fill(1.04), 60: Array(72).fill(1.08) },
            macd: {}, rsi: {}, kdj: {}
        };
        state.indicators.ma[20][71] = 1.02;
        state.indicators.ma[60][71] = 1.06;
        var full = Array.from({ length: 72 }, (_, index) => ({
            date: '2026-07-' + String(index + 1).padStart(2, '0'),
            open: 0.99, high: 1.00, low: 0.98, close: 0.99, vol: 1000, _signals: []
        }));
        full[69] = { ...full[69], open: 0.97, high: 1.00, low: 0.961, close: 1.00, _decision: { position: 30, prevAdv: 0, bsMark: 'B' } };
        full[70] = { ...full[70], open: 0.995, high: 1.005, low: 0.985, close: 0.995, _decision: { position: 30, prevAdv: 30, bsMark: null } };
        full[71] = { ...full[71], open: 0.985, high: 1.00, low: 0.970, close: 0.975 };
        var meta = {
            type: '👀 关注异动', windowScore: 3, buySignals: [], exitSignals: [], warningSignals: [],
            allSignals: {}, windowSignals: [], windowScoreSignals: [], invalidatedWindowSignals: [], inCooldown: false
        };
        getSignalMeta = () => meta;
        getMarketContext = () => ({ label: '核心宽基分化', cls: 'neutral', increaseCaps: null });
        getRiskContext = () => ({ score: 100, level: '低波动/偏离', coef: 1, flags: [], stop: 0.95, pressure: 1.02 });
        getExitSeverity = () => ({ level: '无明确离场', detail: '无' });
        getBasePosition = () => 30;
        getPositionCap = () => null;
        getTargetStrengthTier = () => ({ tier: 'ordinary', label: '普通机会', reasons: [] });

        var decision = computeDecisionForIndex(71, full, 30);
        var summary = getIndexDecisionSummary(meta, decision);

        full[71] = { ...full[71], high: 0.995 };
        var ordinaryWickDecision = computeDecisionForIndex(71, full, 30);

        full[71] = { ...full[71], high: 1.00 };
        full[69] = { ...full[69], low: 0.94 };
        var farFromDefenseDecision = computeDecisionForIndex(71, full, 30);

        full[69] = { ...full[69], low: 0.961 };
        full[71] = { ...full[71], open: 0.972 };
        var bullishWickDecision = computeDecisionForIndex(71, full, 30);

        full[71] = { ...full[71], open: 0.985 };
        setActiveStrategy('稳健趋势型');
        var otherStrategyDecision = computeDecisionForIndex(71, full, 30);
    `, context);
    assert.strictEqual(vm.runInContext('decision.position', context), 0);
    assert.strictEqual(vm.runInContext('decision.bsMark', context), 'S');
    assert.strictEqual(vm.runInContext('decision.waveRejectionProtection.eventType', context), 'fresh_entry_failure');
    assert.ok(vm.runInContext('decision.waveRejectionProtection.upperShadowRangeRatio >= 0.5', context));
    assert.ok(vm.runInContext('decision.waveRejectionProtection.closeLocation <= 0.3', context));
    assert.ok(vm.runInContext('decision.waveRejectionProtection.downsideCloseGapRatio <= 0.015', context));
    assert.ok(vm.runInContext('decision.waveRejectionProtection.pressureSources.some(item => item.type === "ma" && item.period === 20)', context));
    assert.strictEqual(vm.runInContext('summary.state', context), '指数新仓失败离场');
    assert.ok(vm.runInContext('summary.why.includes("长上影") && summary.why.includes("压力")', context));
    assert.strictEqual(vm.runInContext('summary.positionWhyCode', context), 'index-fresh-entry-failure');
    assert.strictEqual(vm.runInContext('ordinaryWickDecision.position', context), 30);
    assert.strictEqual(vm.runInContext('farFromDefenseDecision.position', context), 30);
    assert.strictEqual(vm.runInContext('bullishWickDecision.position', context), 30);
    assert.strictEqual(vm.runInContext('otherStrategyDecision.position', context), 30);
    assert.strictEqual(vm.runInContext('otherStrategyDecision.waveRejectionProtection.status', context), 'none');
});

runTest('real HS300 fixture moves the wave S from 2026-07-17 to the long upper-shadow rejection on 2026-07-16', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(dataSource, context);
    vm.runInContext(calcSource, context);
    context.__coreRows = {
        hs300: readJsonFixture('.local/strategy-cache/index_hs300_1_000300_101_fqt1_lmt1000.json'),
        zz500: readJsonFixture('.local/strategy-cache/index_zz500_1_000905_101_fqt1_lmt1000.json'),
        zz1000: readJsonFixture('.local/strategy-cache/index_zz1000_1_000852_101_fqt1_lmt1000.json')
    };
    vm.runInContext(`
        setActiveStrategy('波段抄底型');
        state.mode = 'index';
        state.period = 'daily';
        state.id = 'hs300';
        state.stockId = null;
        state.rawData = {
            hs300: __coreRows.hs300.map(row => ({ ...row })),
            zz500: __coreRows.zz500.map(row => ({ ...row })),
            zz1000: __coreRows.zz1000.map(row => ({ ...row }))
        };
        state.weeklyData = {};
        resetIndicatorState();
        derivedIndicatorCache.clear();
        dateIndexCache.clear();
        updateAllIndicators();
        var full = state.rawData.hs300;
        var entry = full[findDateIndex(full, '2026-07-14', 'hs300')]._decision;
        var rejectionIdx = findDateIndex(full, '2026-07-16', 'hs300');
        var rejection = full[rejectionIdx]._decision;
        var oldExit = full[findDateIndex(full, '2026-07-17', 'hs300')]._decision;
        var recovery = full[findDateIndex(full, '2026-07-20', 'hs300')]._decision;
        var rejectionMeta = getSignalMeta(rejectionIdx, full, state.indicators);
        var summary = getIndexDecisionSummary(rejectionMeta, rejection);
    `, context);
    const result = JSON.parse(vm.runInContext(`JSON.stringify({ entry, rejection, oldExit, recovery, summary })`, context));
    assert.strictEqual(result.entry.position, 30);
    assert.strictEqual(result.entry.bsMark, 'B');
    assert.strictEqual(result.rejection.position, 0);
    assert.strictEqual(result.rejection.prevAdv, 30);
    assert.strictEqual(result.rejection.bsMark, 'S');
    assert.strictEqual(result.rejection.waveRejectionProtection.eventType, 'fresh_entry_failure');
    assert.ok(result.rejection.waveRejectionProtection.upperShadowRangeRatio >= 0.5);
    assert.ok(result.rejection.waveRejectionProtection.closeLocation <= 0.3);
    assert.ok(result.rejection.waveRejectionProtection.downsideCloseGapRatio <= 0.015);
    assert.ok(result.rejection.waveRejectionProtection.pressureSources.length > 0);
    assert.strictEqual(result.oldExit.position, 0);
    assert.strictEqual(result.oldExit.bsMark, null);
    assert.strictEqual(result.recovery.position, 30);
    assert.strictEqual(result.recovery.bsMark, 'B');
    assert.strictEqual(result.summary.state, '指数新仓失败离场');
    assert.ok(result.summary.why.includes('长上影') && result.summary.why.includes('压力'));
});

runTest('real Shanghai index fixture moves the wave S from 2026-07-17 to the weak recovery candle on 2026-07-16', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(dataSource, context);
    vm.runInContext(calcSource, context);
    context.__shRows = readJsonFixture('.local/strategy-cache/index_sh_1_000001_101_fqt1_lmt1000.json');
    context.__coreRows = {
        hs300: readJsonFixture('.local/strategy-cache/index_hs300_1_000300_101_fqt1_lmt1000.json'),
        zz500: readJsonFixture('.local/strategy-cache/index_zz500_1_000905_101_fqt1_lmt1000.json'),
        zz1000: readJsonFixture('.local/strategy-cache/index_zz1000_1_000852_101_fqt1_lmt1000.json')
    };
    vm.runInContext(`
        setActiveStrategy('波段抄底型');
        state.mode = 'index';
        state.period = 'daily';
        state.id = 'sh';
        state.stockId = null;
        state.rawData = {
            sh: __shRows.map(row => ({ ...row })),
            hs300: __coreRows.hs300.map(row => ({ ...row })),
            zz500: __coreRows.zz500.map(row => ({ ...row })),
            zz1000: __coreRows.zz1000.map(row => ({ ...row }))
        };
        state.weeklyData = {};
        resetIndicatorState();
        derivedIndicatorCache.clear();
        dateIndexCache.clear();
        updateAllIndicators();
        var shFull = state.rawData.sh;
        var shEntryIdx = findDateIndex(shFull, '2026-07-14', 'sh');
        var shFirstDefenseIdx = findDateIndex(shFull, '2026-07-15', 'sh');
        var shFailureIdx = findDateIndex(shFull, '2026-07-16', 'sh');
        var shOldExitIdx = findDateIndex(shFull, '2026-07-17', 'sh');
        var shRecoveryIdx = findDateIndex(shFull, '2026-07-20', 'sh');
        var shEntryDecision = shFull[shEntryIdx]._decision;
        var shFirstDefenseDecision = shFull[shFirstDefenseIdx]._decision;
        var shFailureDecision = shFull[shFailureIdx]._decision;
        var shOldExitDecision = shFull[shOldExitIdx]._decision;
        var shRecoveryDecision = shFull[shRecoveryIdx]._decision;
        var shFailureMeta = getSignalMeta(shFailureIdx, shFull, state.indicators);
        var shFailureSummary = getIndexDecisionSummary(shFailureMeta, shFailureDecision);
    `, context);
    const result = JSON.parse(vm.runInContext(`JSON.stringify({
        entry: shEntryDecision,
        firstDefense: shFirstDefenseDecision,
        failure: shFailureDecision,
        oldExit: shOldExitDecision,
        recovery: shRecoveryDecision,
        summary: shFailureSummary
    })`, context));
    assert.strictEqual(result.entry.position, 80);
    assert.strictEqual(result.entry.bsMark, 'B');
    assert.strictEqual(result.firstDefense.position, 30);
    assert.strictEqual(result.firstDefense.bsMark, null);
    assert.strictEqual(result.failure.position, 0);
    assert.strictEqual(result.failure.prevAdv, 30);
    assert.strictEqual(result.failure.bsMark, 'S');
    assert.strictEqual(result.failure.waveRejectionProtection.eventType, 'fresh_entry_downside_failure');
    assert.ok(result.failure.waveRejectionProtection.downsideCloseGapRatio <= 0.005);
    assert.ok(result.failure.waveRejectionProtection.downsideBearBodyRangeRatio >= 0.4);
    assert.ok(result.failure.waveRejectionProtection.closeLocation <= 0.25);
    assert.strictEqual(result.oldExit.position, 0);
    assert.strictEqual(result.oldExit.bsMark, null);
    assert.strictEqual(result.recovery.position, 30);
    assert.strictEqual(result.recovery.bsMark, 'B');
    assert.strictEqual(result.summary.state, '指数新仓失败离场');
    assert.ok(result.summary.why.includes('盘中最低') && result.summary.why.includes('买入日最低价') && result.summary.why.includes('阴线实体占全天振幅'));
    assert.ok(result.summary.why.includes('收盘虽收回'));
    assert.ok(result.summary.why.includes('弱势阴线'));
});

runTest('wave MA20 pullback observation keeps one 30 percent stock day without turning the candle into B6', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext('function convertDailyToWeekly() { return []; }', context);
    vm.runInContext(calcSource, context);
    vm.runInContext(`
        setActiveStrategy('波段抄底型');
        state.mode = 'stock';
        state.period = 'daily';
        state.indicators = { ma: { 20: Array(72).fill(100), 60: Array(72).fill(105) }, macd: {}, rsi: {}, kdj: {} };
        state.indicators.ma[20][69] = 99.9;
        state.indicators.ma[20][70] = 100;
        state.indicators.ma[20][71] = 100.1;
        var full = Array.from({ length: 72 }, (_, index) => ({
            date: '2026-08-' + String(index + 1).padStart(2, '0'),
            open: 100, high: 100.4, low: 99.6, close: 100.1, vol: 1000, _signals: []
        }));
        full[69] = { ...full[69], close: 100.5, _decision: { position: 30, prevAdv: 30, bsMark: null } };
        full[70] = { ...full[70], open: 100.1, high: 100.2, low: 99.2, close: 99.8, _signals: [] };
        full[71] = { ...full[71], open: 99.9, high: 100.4, low: 99.7, close: 100.2, _signals: [] };
        var meta = {
            type: '👀 弱势震荡', windowScore: 2, buySignals: [], exitSignals: [], warningSignals: [],
            allSignals: {}, windowSignals: [], windowScoreSignals: [{ signal: 'B11', day: 61, signalDate: '2026-07-24', score: 2 }],
            invalidatedWindowSignals: [], localBreakWindowSignals: [], inCooldown: false, daysSinceExit: Infinity
        };
        getSignalMeta = () => meta;
        getMarketContext = () => ({ label: '核心宽基分化', cls: 'neutral', increaseCaps: null });
        getRiskContext = () => ({ score: 100, level: '低波动/偏离', coef: 1, flags: [], stop: 98, pressure: 103 });
        getExitSeverity = () => ({ level: '无明确离场', detail: '无' });
        getPositionCap = () => null;
        getTargetStrengthTier = () => ({ tier: 'ordinary', label: '普通机会', reasons: [] });
        getWaveRejectionProtectionContext = (idx, rows, currentMeta, prevPos, targetPosition) => ({ active: false, status: 'none', targetPosition });

        var observation = computeDecisionForIndex(70, full, 30);
        var observationSummary = getStockDecisionSummary(meta, observation);
        full[70]._decision = observation;

        var recovered = computeDecisionForIndex(71, full, 30);

        full[71] = { ...full[71], close: 99.7, _signals: [] };
        var expired = computeDecisionForIndex(71, full, 30);

        full[71] = { ...full[71], _signals: ['B11'] };
        var freshB11 = computeDecisionForIndex(71, full, 30);

        full[70]._decision = undefined;
        full[70] = { ...full[70], open: 99.9, high: 100.1, low: 99.7, close: 99.8, _signals: [] };
        var noLowerShadow = computeDecisionForIndex(70, full, 30);

        full[70] = { ...full[70], open: 100.1, high: 100.2, low: 98.8, close: 99.3 };
        var tooFarBelow = computeDecisionForIndex(70, full, 30);

        full[70] = { ...full[70], low: 99.2, close: 99.8 };
        state.indicators.ma[20][70] = 99.8;
        var fallingMA20 = computeDecisionForIndex(70, full, 30);

        state.indicators.ma[20][70] = 100;
        state.mode = 'index';
        var indexPath = computeDecisionForIndex(70, full, 30);
    `, context);
    const result = JSON.parse(vm.runInContext('JSON.stringify({ observation, observationSummary, recovered, expired, freshB11, noLowerShadow, tooFarBelow, fallingMA20, indexPath })', context));
    assert.strictEqual(result.observation.position, 30);
    assert.strictEqual(result.observation.bsMark, null);
    assert.strictEqual(result.observation.waveB6TrendAdd.eligible, false);
    assert.strictEqual(result.observation.waveMA20PullbackObservation.applied, true);
    assert.strictEqual(result.observationSummary.state, 'MA20回踩观察');
    assert.ok(result.observationSummary.why.includes('不加仓也不清仓'));
    assert.strictEqual(result.observationSummary.positionWhyCode, 'ma20-pullback-observation');
    assert.ok(result.observationSummary.nextFocus.includes('重新站回MA20'));
    assert.strictEqual(result.recovered.position, 30);
    assert.strictEqual(result.recovered.bsMark, null);
    assert.strictEqual(result.recovered.waveMA20PullbackObservation.status, 'taken_over');
    assert.strictEqual(result.expired.position, 0);
    assert.strictEqual(result.expired.bsMark, 'S');
    assert.strictEqual(result.expired.waveMA20PullbackObservation.status, 'expired');
    assert.strictEqual(result.freshB11.position, 30);
    assert.strictEqual(result.freshB11.waveMA20PullbackObservation.status, 'taken_over');
    assert.strictEqual(result.noLowerShadow.position, 0);
    assert.strictEqual(result.noLowerShadow.waveMA20PullbackObservation.applied, false);
    assert.strictEqual(result.tooFarBelow.position, 0);
    assert.strictEqual(result.tooFarBelow.waveMA20PullbackObservation.applied, false);
    assert.strictEqual(result.fallingMA20.position, 0);
    assert.strictEqual(result.fallingMA20.waveMA20PullbackObservation.applied, false);
    assert.strictEqual(result.indexPath.position, 0);
    assert.strictEqual(result.indexPath.waveMA20PullbackObservation.applied, false);
});

runTest('wave breakout MA20 pullback is distinct from declining-MA20 defense', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(calcSource, context);
    vm.runInContext("getWaveContext = () => ({ inScope: false, regime: 'up' });", context);
    vm.runInContext(`
        setActiveStrategy('波段抄底型');
        state.mode = 'stock';
        state.period = 'daily';
        state.indicators = {
            ma: { 20: Array(80).fill(100), 60: Array(80).fill(95) },
            macd: {}, rsi: {}, kdj: {}
        };
        state.indicators.ma[20][68] = 99;
        state.indicators.ma[20][69] = 100;
        state.indicators.ma[20][70] = 100.1;
        state.indicators.ma[20][71] = 100.2;
        var full = Array.from({ length: 80 }, (_, index) => ({
            date: '2026-09-' + String(index + 1).padStart(2, '0'),
            open: 100, high: 101, low: 99.5, close: 100, vol: 1000, _signals: []
        }));
        full[65]._decision = { position: 30, prevAdv: 0, bsMark: 'B' };
        for (var day = 66; day < 69; day++) full[day]._decision = { position: 30, prevAdv: 30, bsMark: null };
        full[68] = { ...full[68], close: 99, _decision: { position: 30, prevAdv: 30, bsMark: null } };
        full[69] = { ...full[69], close: 101, high: 101.4, low: 99.8, _decision: { position: 30, prevAdv: 30, bsMark: null } };
        full[70] = { ...full[70], open: 100.5, high: 100.7, low: 99.6, close: 100.05, _signals: [] };
        full[71] = { ...full[71], open: 100, high: 100.8, low: 99.9, close: 100.4, _signals: [] };
        var metaByDay = {
            70: { currentDay: 70, currentClose: 100.05, type: '👀 弱势震荡', windowScore: 0, buySignals: [], exitSignals: [], warningSignals: [], allSignals: {}, windowSignals: [], windowScoreSignals: [], invalidatedWindowSignals: [{ signal: 'B6', day: 65, score: 2, reason: 'price-break', invalidationDay: 70, invalidationLevel: 100.5 }], localBreakWindowSignals: [], inCooldown: false, daysSinceExit: Infinity },
            71: { currentDay: 71, currentClose: 100.4, type: '📈 趋势抱单', windowScore: 0, buySignals: [], exitSignals: [], warningSignals: [], allSignals: {}, windowSignals: [], windowScoreSignals: [], invalidatedWindowSignals: [], localBreakWindowSignals: [], inCooldown: false, daysSinceExit: Infinity }
        };
        getSignalMeta = index => metaByDay[index];
        getMarketContext = () => ({ label: '核心宽基分化', cls: 'neutral', increaseCaps: null });
        getRiskContext = () => ({ score: 100, level: '低波动/偏离', coef: 1, flags: [], stop: 98, pressure: 103, atrPct: 0.01, distMA20: 0, drawdown: 0 });
        getExitSeverity = () => ({ level: '无明确离场', detail: '无' });
        getBasePosition = () => 0;
        getPositionCap = () => null;
        getTargetStrengthTier = () => ({ tier: 'ordinary', label: '普通机会', reasons: [] });
        var breakoutPullback = computeDecisionForIndex(70, full, 30);
        full[70]._decision = breakoutPullback;
        var breakoutRecovered = computeDecisionForIndex(71, full, 30);

        state.indicators.ma[20][70] = 99.5;
        state.indicators.ma[20][71] = 99.4;
        full[70] = { ...full[70], close: 99.4, low: 98.9, _decision: undefined };
        metaByDay[70] = { ...metaByDay[70], currentClose: 99.4 };
        var decliningMaDefense = computeDecisionForIndex(70, full, 30);
    `, context);
    const result = JSON.parse(vm.runInContext('JSON.stringify({ breakoutPullback, breakoutRecovered, decliningMaDefense })', context));
    assert.strictEqual(result.breakoutPullback.position, 30);
    assert.strictEqual(result.breakoutPullback.bsMark, null);
    assert.strictEqual(result.breakoutPullback.waveMA20PullbackObservation.defenseType, 'breakout_pullback');
    assert.strictEqual(result.breakoutPullback.waveMA20PullbackObservation.applied, true);
    assert.strictEqual(result.breakoutRecovered.position, 30);
    assert.strictEqual(result.breakoutRecovered.waveMA20PullbackObservation.status, 'taken_over');
    assert.strictEqual(result.decliningMaDefense.position, 0);
    assert.strictEqual(result.decliningMaDefense.waveMA20PullbackObservation.applied, false);
});

runTest('wave MA20 trend defense delays standalone L3 and limited hard invalidation only for one stock day', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(calcSource, context);
    vm.runInContext("getWaveContext = () => ({ inScope: false, regime: 'up' });", context);
    vm.runInContext(`
        setActiveStrategy('波段抄底型');
        state.mode = 'stock';
        state.period = 'daily';
        state.indicators = {
            ma: { 20: Array(80).fill(100), 60: Array(80).fill(95) },
            macd: {}, rsi: {}, kdj: {}
        };
        state.indicators.ma[20][69] = 99.8;
        state.indicators.ma[20][70] = 100;
        state.indicators.ma[20][71] = 100;
        var full = Array.from({ length: 80 }, (_, index) => ({
            date: '2026-08-' + String(index + 1).padStart(2, '0'),
            open: 100, high: 101, low: 99, close: 100, vol: 1000, _signals: []
        }));
        full[70] = { ...full[70], open: 100.2, high: 101, low: 99.5, close: 100.1, _signals: ['L3'] };
        full[71] = { ...full[71], open: 100, high: 101, low: 99.8, close: 100.2, _signals: [] };
        var metaByDay = {
            70: { currentDay: 70, currentClose: 100.1, type: '🚪 趋势破位', windowScore: 0, buySignals: [], exitSignals: ['L3'], warningSignals: [], allSignals: { L3: { status: true } }, windowSignals: [], windowScoreSignals: [], invalidatedWindowSignals: [], localBreakWindowSignals: [], inCooldown: false, daysSinceExit: 0 },
            71: { currentDay: 71, currentClose: 100.2, type: '📈 趋势抱单', windowScore: 0, buySignals: [], exitSignals: [], warningSignals: [], allSignals: {}, windowSignals: [], windowScoreSignals: [], invalidatedWindowSignals: [], localBreakWindowSignals: [], inCooldown: false, daysSinceExit: Infinity }
        };
        getSignalMeta = index => metaByDay[index];
        getMarketContext = () => ({ label: '核心宽基分化', cls: 'neutral', increaseCaps: null });
        getRiskContext = () => ({ score: 100, level: '低波动/偏离', coef: 1, flags: [], stop: 98, pressure: 103, atrPct: 0.01, distMA20: 0, drawdown: 0 });
        getExitSeverity = meta => meta.exitSignals.length ? { level: '强离场', detail: '触发核心破位防守' } : { level: '无明确离场', detail: '无' };
        getPositionCap = () => null;
        getTargetStrengthTier = () => ({ tier: 'ordinary', label: '普通机会', reasons: [] });
        getWaveRejectionProtectionContext = (idx, rows, currentMeta, prevPos, targetPosition) => ({ active: false, status: 'none', targetPosition });
        var l3Defense = computeDecisionForIndex(70, full, 30);
        full[70]._decision = l3Defense;
        var l3Recovered = computeDecisionForIndex(71, full, 30);

        full[70] = { ...full[70], _decision: undefined, _signals: ['L3', 'L10'] };
        metaByDay[70] = { ...metaByDay[70], exitSignals: ['L3', 'L10'], allSignals: { L3: { status: true }, L10: { status: true } } };
        var compositeExit = computeDecisionForIndex(70, full, 30);

        full[70] = { ...full[70], _decision: undefined, _signals: ['L3'] };
        metaByDay[70] = { ...metaByDay[70], type: '🛑 清仓规避', exitSignals: ['L3'], allSignals: { L3: { status: true } } };
        var historicalL10Risk = computeDecisionForIndex(70, full, 30);

        full[70] = { ...full[70], _decision: undefined, _signals: ['B6'] };
        metaByDay[70] = { currentDay: 70, currentClose: 100.1, type: '👀 弱势震荡', windowScore: 0, buySignals: [], exitSignals: [], warningSignals: [], allSignals: {}, windowSignals: [], windowScoreSignals: [], invalidatedWindowSignals: [{ signal: 'B6', day: 60, score: 2, reason: 'price-break', invalidationDay: 70, invalidationLevel: 99.6 }], localBreakWindowSignals: [], inCooldown: false, daysSinceExit: Infinity };
        var hardDefense = computeDecisionForIndex(70, full, 30);
        full[70]._decision = hardDefense;
        var hardRecovered = computeDecisionForIndex(71, full, 30);
        full[71] = { ...full[71], close: 99.5, _signals: [] };
        metaByDay[71] = { ...metaByDay[71], currentClose: 99.5, type: '👀 弱势震荡' };
        var hardExpired = computeDecisionForIndex(71, full, 30);

        state.mode = 'index';
        full[70] = { ...full[70], close: 100.1, _signals: ['L3'], _decision: undefined };
        metaByDay[70] = { currentDay: 70, currentClose: 100.1, type: '🚪 趋势破位', windowScore: 0, buySignals: [], exitSignals: ['L3'], warningSignals: [], allSignals: { L3: { status: true } }, windowSignals: [], windowScoreSignals: [], invalidatedWindowSignals: [], localBreakWindowSignals: [], inCooldown: false, daysSinceExit: 0 };
        var indexExit = computeDecisionForIndex(70, full, 30);
    `, context);
    const result = JSON.parse(vm.runInContext(`JSON.stringify({
        l3Defense: { position: l3Defense.position, bsMark: l3Defense.bsMark, defense: l3Defense.waveMA20PullbackObservation, summary: getStockDecisionSummary(metaByDay[70], l3Defense) },
        l3Recovered: { position: l3Recovered.position, status: l3Recovered.waveMA20PullbackObservation.status },
        compositeExit: { position: compositeExit.position, bsMark: compositeExit.bsMark },
        historicalL10Risk: { position: historicalL10Risk.position, bsMark: historicalL10Risk.bsMark },
        hardDefense: { position: hardDefense.position, bsMark: hardDefense.bsMark, defense: hardDefense.waveMA20PullbackObservation },
        hardRecovered: { position: hardRecovered.position, status: hardRecovered.waveMA20PullbackObservation.status },
        hardExpired: { position: hardExpired.position, bsMark: hardExpired.bsMark, status: hardExpired.waveMA20PullbackObservation.status },
        indexExit: { position: indexExit.position, bsMark: indexExit.bsMark }
    })`, context));
    assert.strictEqual(result.l3Defense.position, 30);
    assert.strictEqual(result.l3Defense.bsMark, null);
    assert.strictEqual(result.l3Defense.defense.defenseType, 'standalone_l3');
    assert.strictEqual(result.l3Defense.summary.state, 'MA20趋势防守');
    assert.ok(result.l3Defense.summary.why.includes('单独MACD死叉'));
    assert.strictEqual(result.l3Recovered.position, 30);
    assert.strictEqual(result.l3Recovered.status, 'taken_over');
    assert.strictEqual(result.compositeExit.position, 0);
    assert.strictEqual(result.compositeExit.bsMark, 'S');
    assert.strictEqual(result.historicalL10Risk.position, 0);
    assert.strictEqual(result.historicalL10Risk.bsMark, 'S');
    assert.strictEqual(result.hardDefense.position, 30);
    assert.strictEqual(result.hardDefense.bsMark, null);
    assert.strictEqual(result.hardDefense.defense.defenseType, 'limited_hard_invalidation');
    assert.strictEqual(result.hardRecovered.position, 30);
    assert.strictEqual(result.hardRecovered.status, 'taken_over');
    assert.strictEqual(result.hardExpired.position, 0);
    assert.strictEqual(result.hardExpired.bsMark, 'S');
    assert.strictEqual(result.hardExpired.status, 'expired');
    assert.strictEqual(result.indexExit.position, 30);
    assert.strictEqual(result.indexExit.bsMark, null);
});

runTest('wave bottom and range environments do not treat standalone MACD death cross as immediate clear-out', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(calcSource, context);
    vm.runInContext(`
        setActiveStrategy('波段抄底型');
        state.mode = 'stock';
        state.period = 'daily';
        state.indicators = { ma: { 20: Array(80).fill(100), 60: Array(80).fill(110) }, macd: {}, rsi: {}, kdj: {} };
        var full = Array.from({ length: 80 }, (_, index) => ({
            date: '2026-09-' + String(index + 1).padStart(2, '0'),
            open: 100, high: 101, low: 98, close: 99, vol: 1000, _signals: []
        }));
        full[69]._decision = { position: 30, prevAdv: 0, bsMark: 'B' };
        full[70]._signals = ['L3'];
        var meta = {
            currentDay: 70, currentClose: 99, type: '🚪 趋势破位', windowScore: 0,
            buySignals: [], exitSignals: ['L3'], warningSignals: [], allSignals: { L3: true },
            windowSignals: [], windowScoreSignals: [], invalidatedWindowSignals: [], localBreakWindowSignals: [],
            inCooldown: false, daysSinceExit: 0
        };
        getWaveContext = () => ({ inScope: true, regime: 'down', regimeLabel: '下跌', boxSupport: 98, boxPressure: 105, boxMidpoint: 101.5, box: { valid: false, atr14: 1 } });
        getSignalMeta = () => meta;
        getMarketContext = () => ({ label: '核心宽基分化', cls: 'neutral', increaseCaps: null });
        getRiskContext = () => ({ score: 80, level: '低波动/偏离', coef: 1, flags: [], stop: 95, pressure: 105 });
        getExitSeverity = () => ({ level: '强离场', detail: 'MACD死叉' });
        getBasePosition = () => 0;
        getPositionCap = () => null;
        getTargetStrengthTier = () => ({ tier: 'ordinary', label: '普通机会', reasons: [] });
        getWaveRejectionProtectionContext = (idx, rows, currentMeta, prevPos, targetPosition) => ({ active: false, status: 'none', targetPosition });
        var decision = computeDecisionForIndex(70, full, 30);
    `, context);
    const result = JSON.parse(vm.runInContext('JSON.stringify({ position: decision.position, bsMark: decision.bsMark, action: decision.simpleAction, observed: decision.waveStandaloneL3Observation })', context));
    assert.strictEqual(result.position, 30);
    assert.strictEqual(result.bsMark, null);
    assert.strictEqual(result.action, '谨慎持有');
    assert.strictEqual(result.observed, true);
});

runTest('real CYTS fixture adds the B11 wave layer then releases it on the 2026-08-07 MA20 observation day', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(dataSource, context);
    vm.runInContext(calcSource, context);
    vm.runInContext("getWaveContext = () => ({ inScope: false, regime: 'down' });", context);
    context.__cytsRows = readJsonFixture('.local/strategy-cache/stock_600138_1_600138_101_fqt1_lmt1000.json');
    context.__coreRows = {
        hs300: readJsonFixture('.local/strategy-cache/index_hs300_1_000300_101_fqt1_lmt1000.json'),
        zz500: readJsonFixture('.local/strategy-cache/index_zz500_1_000905_101_fqt1_lmt1000.json'),
        zz1000: readJsonFixture('.local/strategy-cache/index_zz1000_1_000852_101_fqt1_lmt1000.json')
    };
    vm.runInContext(`
        setActiveStrategy('波段抄底型');
        state.mode = 'stock';
        state.period = 'daily';
        state.id = '600138';
        state.stockId = '600138';
        state.rawData = {
            '600138': __cytsRows.map(row => ({ ...row })),
            hs300: __coreRows.hs300.map(row => ({ ...row })),
            zz500: __coreRows.zz500.map(row => ({ ...row })),
            zz1000: __coreRows.zz1000.map(row => ({ ...row }))
        };
        state.weeklyData = {};
        resetIndicatorState();
        derivedIndicatorCache.clear();
        dateIndexCache.clear();
        updateAllIndicators();
        var cytsFull = state.rawData['600138'];
        var cytsAddIdx = findDateIndex(cytsFull, '2026-07-27', '600138');
        var cytsAddRow = cytsFull[cytsAddIdx];
        var cytsAddMeta = getSignalMeta(cytsAddIdx, cytsFull, state.indicators);
        var cytsAddDecision = cytsAddRow._decision;
        var cytsAddSummary = getStockDecisionSummary(cytsAddMeta, cytsAddDecision);
        var cytsIdx = findDateIndex(cytsFull, '2026-08-07', '600138');
        var cytsRow = cytsFull[cytsIdx];
        var cytsMeta = getSignalMeta(cytsIdx, cytsFull, state.indicators);
        var cytsDecision = cytsRow._decision;
        var cytsSummary = getStockDecisionSummary(cytsMeta, cytsDecision);
    `, context);
    const result = JSON.parse(vm.runInContext(`JSON.stringify({
        add: {
            position: cytsAddDecision.position,
            prevAdv: cytsAddDecision.prevAdv,
            bsMark: cytsAddDecision.bsMark,
            layer: cytsAddDecision.waveExpiryB11TakeoverAdd,
            summary: cytsAddSummary
        },
        signals: cytsRow._signals,
        close: cytsRow.close,
        ma20: state.indicators.ma[20][cytsIdx],
        previousMA20: state.indicators.ma[20][cytsIdx - 1],
        meta: { windowScore: cytsMeta.windowScore, exitSignals: cytsMeta.exitSignals, warningSignals: cytsMeta.warningSignals },
        decision: cytsDecision,
        summary: cytsSummary
    })`, context));
    assert.deepStrictEqual(result.signals, []);
    assert.ok(result.close < result.ma20);
    assert.ok(result.ma20 >= result.previousMA20);
    assert.strictEqual(result.meta.windowScore, 2);
    assert.deepStrictEqual(result.meta.exitSignals, []);
    assert.deepStrictEqual(result.meta.warningSignals, []);
    assert.strictEqual(result.add.position, 50);
    assert.strictEqual(result.add.prevAdv, 30);
    assert.strictEqual(result.add.bsMark, null);
    assert.strictEqual(result.add.layer.applied, true);
    assert.strictEqual(result.add.layer.marketException, false);
    assert.strictEqual(result.add.summary.state, '防守接管加仓');
    assert.strictEqual(result.decision.position, 30);
    assert.strictEqual(result.decision.prevAdv, 50);
    assert.strictEqual(result.decision.bsMark, null);
    assert.strictEqual(result.decision.waveB6TrendAdd.eligible, false);
    assert.strictEqual(result.decision.waveMA20PullbackObservation.applied, true);
    assert.strictEqual(result.decision.waveExpiryB11TakeoverAdd.status, 'released');
    assert.strictEqual(result.summary.state, '波段仓减仓');
    assert.ok(result.summary.why.includes('额外20%波段仓已先减'));
    assert.ok(result.summary.why.includes('不生成S'));
    assert.ok(result.summary.nextFocus.includes('观察日低点6.93'));
    assert.ok(result.summary.nextFocus.includes('结构防守位6.72'));
});

runTest('wave expiry handoff keeps one 30 percent recovery day and requires trend or fresh-signal takeover next', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(calcSource, context);
    vm.runInContext(`
        setActiveStrategy('波段抄底型');
        state.mode = 'index';
        state.period = 'daily';
        state.indicators = {
            ma: { 5: Array(73).fill(100) },
            macd: { bar: Array(73).fill(-2) },
            rsi: {},
            kdj: { k: Array(73).fill(30), d: Array(73).fill(35) }
        };
        state.indicators.macd.bar[71] = -1;
        state.indicators.kdj.k[71] = 40;
        var full = Array.from({ length: 73 }, (_, index) => ({
            date: '2026-08-' + String(index + 1).padStart(2, '0'),
            open: 99, high: 101, low: 98, close: 100, vol: 1000, _signals: []
        }));
        full[61] = { ...full[61], low: 95, close: 98, _decision: { position: 30, prevAdv: 0, bsMark: 'B' } };
        for (var day = 62; day <= 70; day++) full[day]._decision = { position: 30, prevAdv: 30, bsMark: null };
        full[70] = { ...full[70], close: 99, _decision: { position: 30, prevAdv: 30, bsMark: null, windowScore: 4 } };
        full[71] = { ...full[71], open: 99.5, high: 102, low: 98.5, close: 101 };

        var previousMeta = {
            type: '✅ 明确转强', windowScore: 4, buySignals: [], exitSignals: [], warningSignals: [],
            allSignals: {}, windowSignals: [], windowScoreSignals: [
                { signal: 'B7', day: 61, signalDate: '2026-08-62', score: 1 },
                { signal: 'B16', day: 61, signalDate: '2026-08-62', score: 3 }
            ], invalidatedWindowSignals: [], localBreakWindowSignals: [], inCooldown: false
        };
        var expiredMeta = {
            type: '👀 弱势震荡', windowScore: 0, buySignals: [], exitSignals: [], warningSignals: [],
            allSignals: {}, windowSignals: [], windowScoreSignals: [], invalidatedWindowSignals: [], localBreakWindowSignals: [], inCooldown: false
        };
        var trendMeta = { ...expiredMeta, type: '📈 趋势抱单' };
        var activeMeta = expiredMeta;
        getSignalMeta = idx => idx === 70 ? previousMeta : activeMeta;
        getMarketContext = () => ({ label: '核心宽基分化', cls: 'neutral', increaseCaps: null });
        getRiskContext = () => ({ score: 80, level: '低波动/偏离', coef: 1, flags: [], stop: 95, pressure: 110 });
        getExitSeverity = () => ({ level: '无明确离场', detail: '无' });
        getPositionCap = () => null;
        getTargetStrengthTier = () => ({ tier: 'ordinary', label: '普通机会', reasons: [] });

        var handoffDecision = computeDecisionForIndex(71, full, 30);
        full[71]._decision = handoffDecision;
        var handoffSummary = getIndexDecisionSummary(expiredMeta, handoffDecision);

        activeMeta = expiredMeta;
        full[72] = { ...full[72], open: 101, high: 102, low: 99, close: 100 };
        var expiredAfterGraceDecision = computeDecisionForIndex(72, full, 30);

        activeMeta = trendMeta;
        var trendTakeoverDecision = computeDecisionForIndex(72, full, 30);
        var trendTakeoverSummary = getIndexDecisionSummary(trendMeta, trendTakeoverDecision);

        activeMeta = { ...expiredMeta, invalidatedWindowSignals: [{ signal: 'B16', day: 61, invalidationDay: 71, reason: 'price-break' }] };
        var invalidatedDecision = computeDecisionForIndex(71, full, 30);

        activeMeta = expiredMeta;
        state.indicators.ma[5][71] = 102;
        var belowShortMaDecision = computeDecisionForIndex(71, full, 30);
    `, context);
    assert.strictEqual(vm.runInContext('handoffDecision.position', context), 30);
    assert.strictEqual(vm.runInContext('handoffDecision.bsMark', context), null);
    assert.strictEqual(vm.runInContext('handoffDecision.waveExpiryHandoff.applied', context), true);
    assert.deepStrictEqual(JSON.parse(vm.runInContext('JSON.stringify(handoffDecision.waveExpiryHandoff.expiredSignals.map(item => item.signal))', context)), ['B7', 'B16']);
    assert.strictEqual(vm.runInContext('handoffSummary.state', context), '反弹接管观察');
    assert.ok(vm.runInContext('handoffSummary.why.includes("仅因窗口到期")', context));
    assert.strictEqual(vm.runInContext('handoffSummary.positionWhyCode', context), 'index-expiry-handoff');
    assert.strictEqual(vm.runInContext('expiredAfterGraceDecision.position', context), 0);
    assert.strictEqual(vm.runInContext('expiredAfterGraceDecision.bsMark', context), 'S');
    assert.strictEqual(vm.runInContext('trendTakeoverDecision.position', context), 50);
    assert.strictEqual(vm.runInContext('trendTakeoverDecision.bsMark', context), null);
    assert.ok(vm.runInContext('trendTakeoverSummary.why.includes("趋势抱单状态接管")', context));
    assert.strictEqual(vm.runInContext('invalidatedDecision.position', context), 0);
    assert.strictEqual(vm.runInContext('invalidatedDecision.waveExpiryHandoff.applied', context), false);
    assert.strictEqual(vm.runInContext('belowShortMaDecision.position', context), 0);
    assert.strictEqual(vm.runInContext('belowShortMaDecision.waveExpiryHandoff.applied', context), false);
});

runTest('wave stock expiry keeps one defensive day when structure and medium momentum remain intact', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(calcSource, context);
    vm.runInContext(`
        setActiveStrategy('波段抄底型');
        state.mode = 'stock';
        state.period = 'daily';
        state.indicators = {
            ma: { 5: Array(73).fill(6.96), 20: Array(73).fill(6.83) },
            macd: { bar: Array(73).fill(0.10) },
            rsi: {},
            kdj: { k: Array(73).fill(43), d: Array(73).fill(60) }
        };
        state.indicators.ma[20][70] = 6.837;
        state.indicators.ma[20][71] = 6.847;
        state.indicators.ma[5][72] = 6.94;
        state.indicators.ma[20][72] = 6.86;
        state.indicators.macd.bar[70] = 0.133;
        state.indicators.macd.bar[71] = 0.092;
        var full = Array.from({ length: 73 }, (_, index) => ({
            date: '2026-07-' + String(index + 1).padStart(2, '0'),
            open: 7, high: 7.08, low: 6.90, close: 7, vol: 90000, _signals: []
        }));
        full[61] = { ...full[61], low: 6.35, close: 6.72, _decision: { position: 30, prevAdv: 0, bsMark: 'B' } };
        for (var day = 62; day <= 70; day++) full[day]._decision = { position: 30, prevAdv: 30, bsMark: null };
        full[70] = { ...full[70], close: 7.02, _decision: {
            position: 30, prevAdv: 30, bsMark: null,
            waveContext: { lifecycle: { hardDefense: 6.35 } }
        } };
        full[71] = { ...full[71], date: '2026-07-24', open: 7.00, high: 7.04, low: 6.76, close: 6.78, _signals: ['L1'] };
        full[72] = { ...full[72], date: '2026-07-27', open: 6.79, high: 7.02, low: 6.79, close: 6.95 };

        var previousMeta = {
            type: '👀 关注异动', windowScore: 3, buySignals: [], exitSignals: [], warningSignals: [],
            allSignals: {}, windowSignals: [], windowScoreSignals: [
                { signal: 'B16', day: 61, signalDate: '2026-07-10', score: 3 }
            ], invalidatedWindowSignals: [], localBreakWindowSignals: [], inCooldown: false
        };
        var expiredMeta = {
            type: '👀 弱势震荡', windowScore: 0, buySignals: [], exitSignals: [], warningSignals: [],
            allSignals: {}, windowSignals: [], windowScoreSignals: [], invalidatedWindowSignals: [], localBreakWindowSignals: [], inCooldown: false
        };
        var trendMeta = { ...expiredMeta, type: '📈 趋势抱单' };
        var freshMeta = { ...expiredMeta, windowScore: 2, windowScoreSignals: [{ signal: 'B11', day: 72, signalDate: '2026-07-27', score: 2 }] };
        var activeMeta = expiredMeta;
        getSignalMeta = idx => idx === 70 ? previousMeta : activeMeta;
        getMarketContext = () => ({ label: '核心宽基分化', cls: 'neutral', increaseCaps: null });
        getRiskContext = () => ({ score: 92, level: '低波动/偏离', coef: 1, flags: [], stop: 6.35, pressure: 7.27 });
        getExitSeverity = () => ({ level: '无明确离场', detail: '无' });
        getPositionCap = () => null;
        getTargetStrengthTier = () => ({ tier: 'ordinary', label: '普通机会', reasons: [] });

        var defensiveDecision = computeDecisionForIndex(71, full, 30);
        full[71]._decision = defensiveDecision;
        var defensiveSummary = getStockDecisionSummary(expiredMeta, defensiveDecision);

        activeMeta = trendMeta;
        var recoveredDecision = computeDecisionForIndex(72, full, 30);

        activeMeta = expiredMeta;
        full[72] = { ...full[72], close: 6.80 };
        var expiredDecision = computeDecisionForIndex(72, full, 30);
        var expiredSummary = getStockDecisionSummary(expiredMeta, expiredDecision);

        activeMeta = freshMeta;
        var freshSignalDecision = computeDecisionForIndex(72, full, 30);
        full[72] = { ...full[72], close: 6.75 };
        var observationLowBreakDecision = computeDecisionForIndex(72, full, 30);

        activeMeta = expiredMeta;
        state.mode = 'index';
        var indexDecision = computeDecisionForIndex(71, full, 30);
        state.mode = 'stock';
        state.indicators.ma[20][71] = 6.82;
        var fallingMaDecision = computeDecisionForIndex(71, full, 30);
        state.indicators.macd.bar[71] = -0.10;
        var fallingMaWeakMomentumDecision = computeDecisionForIndex(71, full, 30);
        state.indicators.macd.bar[71] = 0.092;
        state.indicators.ma[20][71] = 6.847;
        activeMeta = { ...expiredMeta, invalidatedWindowSignals: [{ signal: 'B16', day: 61, invalidationDay: 71, reason: 'price-break' }] };
        var invalidatedDecision = computeDecisionForIndex(71, full, 30);
    `, context);
    assert.strictEqual(vm.runInContext('defensiveDecision.position', context), 30);
    assert.strictEqual(vm.runInContext('defensiveDecision.bsMark', context), null);
    assert.strictEqual(vm.runInContext('defensiveDecision.waveExpiryHandoff.observationMode', context), 'defensive');
    assert.strictEqual(vm.runInContext('defensiveSummary.state', context), '到期防守观察');
    assert.ok(vm.runInContext('defensiveSummary.why.includes("MA20未下行")', context));
    assert.strictEqual(vm.runInContext('defensiveSummary.positionWhyCode', context), 'expiry-handoff');
    assert.ok(vm.runInContext('defensiveSummary.nextFocus.includes("重新站上MA5与MA20")', context));
    assert.ok(vm.runInContext('defensiveSummary.nextFocus.includes("观察日低点6.76")', context));
    assert.strictEqual(vm.runInContext('recoveredDecision.position', context), 30);
    assert.strictEqual(vm.runInContext('recoveredDecision.bsMark', context), null);
    assert.strictEqual(vm.runInContext('recoveredDecision.waveB6TrendAdd.eligible', context), false);
    assert.strictEqual(vm.runInContext('expiredDecision.position', context), 0);
    assert.strictEqual(vm.runInContext('expiredDecision.bsMark', context), 'S');
    assert.strictEqual(vm.runInContext('expiredDecision.waveExpiryHandoff.status', context), 'expired');
    assert.strictEqual(vm.runInContext('expiredSummary.state', context), '到期观察结束');
    assert.strictEqual(vm.runInContext('freshSignalDecision.position', context), 30);
    assert.strictEqual(vm.runInContext('freshSignalDecision.bsMark', context), null);
    assert.strictEqual(vm.runInContext('observationLowBreakDecision.position', context), 0);
    assert.strictEqual(vm.runInContext('observationLowBreakDecision.bsMark', context), 'S');
    assert.strictEqual(vm.runInContext('indexDecision.position', context), 0);
    assert.strictEqual(vm.runInContext('fallingMaDecision.position', context), 30, '守住冻结硬防守位且MACD为正时，MA20下行也只进入一次到期防守观察');
    assert.strictEqual(vm.runInContext('fallingMaDecision.waveExpiryHandoff.bottomDefenseObservation', context), true);
    assert.strictEqual(vm.runInContext('fallingMaDecision.bsMark', context), null);
    assert.strictEqual(vm.runInContext('fallingMaWeakMomentumDecision.position', context), 0, '缺少正向中期动能时仍应清仓');
    assert.strictEqual(vm.runInContext('invalidatedDecision.position', context), 0);
});

runTest('wave defensive expiry B11 takeover uses a separate 30 plus 20 position layer without new B/S', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(calcSource, context);
    vm.runInContext("getWaveContext = () => ({ inScope: false, regime: 'transition' });", context);
    vm.runInContext(renderSource, context);
    vm.runInContext(`
        setActiveStrategy('波段抄底型');
        state.mode = 'stock';
        state.period = 'daily';
        state.indicators = {
            ma: {
                5: Array(75).fill(6.90),
                20: Array(75).fill(6.84),
                60: Array(75).fill(7.40)
            },
            macd: { bar: Array(75).fill(0.08) },
            rsi: {},
            kdj: { k: Array(75).fill(55), d: Array(75).fill(45) }
        };
        state.indicators.ma[20][71] = 6.847;
        state.indicators.ma[5][72] = 6.94;
        state.indicators.ma[20][72] = 6.8635;
        var full = Array.from({ length: 75 }, (_, index) => ({
            date: '2026-07-' + String(index + 1).padStart(2, '0'),
            open: 6.90, high: 7.02, low: 6.80, close: 6.95, vol: 90000, _signals: []
        }));
        full[71] = {
            ...full[71],
            date: '2026-07-24',
            close: 6.78,
            _decision: {
                position: 30,
                prevAdv: 30,
                bsMark: null,
                waveExpiryHandoff: {
                    applied: true,
                    observationMode: 'defensive',
                    triggerDay: 71,
                    triggerDate: '2026-07-24',
                    triggerLow: 6.76,
                    entryLow: 6.35
                }
            }
        };
        full[72] = { ...full[72], date: '2026-07-27', close: 6.95, _signals: ['B11'] };
        full[73] = { ...full[73], date: '2026-07-28', close: 7.00, _signals: [] };
        full[74] = { ...full[74], date: '2026-08-07', open: 7.10, high: 7.12, low: 6.94, close: 7.03, _signals: [] };

        var trendMeta = {
            type: '📈 趋势抱单', windowScore: 2, buySignals: [], exitSignals: [], warningSignals: [],
            allSignals: {}, windowSignals: [], windowScoreSignals: [{ signal: 'B11', day: 72, signalDate: '2026-07-27', score: 2 }],
            invalidatedWindowSignals: [], localBreakWindowSignals: [], inCooldown: false
        };
        var weakMeta = {
            ...trendMeta, type: '👀 弱势震荡', windowScore: 0, windowScoreSignals: []
        };
        var activeMeta = trendMeta;
        var riskScore = 92;
        var activePositionCap = null;
        getSignalMeta = () => activeMeta;
        getMarketContext = () => ({
            label: '核心宽基偏弱',
            cls: 'bear',
            increaseCaps: { ordinary: 30, independent: 50 }
        });
        getRiskContext = () => ({ score: riskScore, level: '低波动/偏离', coef: 1, flags: [], stop: 6.35, pressure: 7.27 });
        getExitSeverity = () => ({ level: '无明确离场', detail: '无' });
        getPositionCap = () => activePositionCap;
        getTargetStrengthTier = () => ({ tier: 'ordinary', label: '普通机会', reasons: [] });
        getWaveRejectionProtectionContext = (idx, rows, meta, previous, target) => ({ active: false, status: 'none', targetPosition: target });

        var addDecision = computeDecisionForIndex(72, full, 30);
        full[72]._decision = addDecision;
        var addSummary = getStockDecisionSummary(trendMeta, addDecision);
        var addEvidence = getStockEvidenceCopy(trendMeta, addDecision, addDecision.exit.level, '');

        var holdDecision = computeDecisionForIndex(73, full, 50);
        full[73]._decision = holdDecision;
        var holdSummary = getStockDecisionSummary(trendMeta, holdDecision);

        activeMeta = weakMeta;
        var originalPullbackObservation = getWaveMA20PullbackObservationContext;
        getWaveMA20PullbackObservationContext = (idx, rows, meta, previous) => idx === 74 && previous === 30
            ? { applied: true, status: 'observing', triggerLow: 6.94, defenseLevel: 6.35, movingAveragePeriod: 20, reason: '测试基础仓观察' }
            : { applied: false, reason: '' };
        var releaseDecision = computeDecisionForIndex(74, full, 50);
        var releaseSummary = getStockDecisionSummary(weakMeta, releaseDecision);
        getWaveMA20PullbackObservationContext = originalPullbackObservation;

        activeMeta = trendMeta;
        full[72]._signals = [];
        var noFreshB11 = computeDecisionForIndex(72, full, 30);
        full[72]._signals = ['B11'];
        state.indicators.ma[20][72] = 6.84;
        var fallingMa20 = computeDecisionForIndex(72, full, 30);
        state.indicators.ma[20][72] = 6.8635;
        riskScore = 50;
        var riskLimited = computeDecisionForIndex(72, full, 30);
        riskScore = 92;
        activePositionCap = { limit: 30, reason: '测试趋势上限' };
        var trendLimited = computeDecisionForIndex(72, full, 30);
        activePositionCap = null;
        state.mode = 'index';
        var indexDecision = computeDecisionForIndex(72, full, 30);
        state.mode = 'stock';
        setActiveStrategy('稳健趋势型');
        var otherBaseDecision = computeBaseDecisionForIndex(72, full, 30);
        var otherStrategyDecision = computeDecisionForIndex(72, full, 30);
    `, context);

    assert.strictEqual(vm.runInContext('addDecision.position', context), 50);
    assert.strictEqual(vm.runInContext('addDecision.bsMark', context), null);
    assert.strictEqual(vm.runInContext('addDecision.waveExpiryB11TakeoverAdd.applied', context), true);
    assert.strictEqual(vm.runInContext('addDecision.waveExpiryB11TakeoverAdd.marketException', context), false);
    assert.strictEqual(vm.runInContext('addDecision.marketGate.type', context), 'open');
    assert.strictEqual(vm.runInContext('addSummary.state', context), '防守接管加仓');
    assert.strictEqual(vm.runInContext('addSummary.positionWhyCode', context), 'expiry-b11-takeover-add');
    assert.ok(vm.runInContext('addEvidence.marketHint.includes("仅作市场背景参考")', context));
    assert.ok(vm.runInContext('!addEvidence.marketHint.includes("不限制个股仓位")', context));
    assert.strictEqual(vm.runInContext('holdDecision.position', context), 50);
    assert.strictEqual(vm.runInContext('holdDecision.bsMark', context), null);
    assert.strictEqual(vm.runInContext('holdDecision.waveExpiryB11TakeoverAdd.active', context), true);
    assert.strictEqual(vm.runInContext('holdSummary.state', context), '波段仓持有');
    assert.strictEqual(vm.runInContext('releaseDecision.position', context), 30);
    assert.strictEqual(vm.runInContext('releaseDecision.bsMark', context), null);
    assert.strictEqual(vm.runInContext('releaseDecision.waveExpiryB11TakeoverAdd.status', context), 'released');
    assert.strictEqual(vm.runInContext('releaseDecision.waveMA20PullbackObservation.applied', context), true);
    assert.strictEqual(vm.runInContext('releaseSummary.state', context), '波段仓减仓');
    assert.ok(vm.runInContext('releaseSummary.why.includes("不生成S")', context));
    assert.strictEqual(vm.runInContext('noFreshB11.position', context), 30);
    assert.strictEqual(vm.runInContext('fallingMa20.position', context), 30);
    assert.strictEqual(vm.runInContext('riskLimited.position', context), 50);
    assert.strictEqual(vm.runInContext('trendLimited.position', context), 30);
    assert.strictEqual(vm.runInContext('indexDecision.waveExpiryB11TakeoverAdd.applied', context), false);
    assert.strictEqual(vm.runInContext('otherStrategyDecision.position === otherBaseDecision.position', context), true);
    assert.strictEqual(vm.runInContext('otherStrategyDecision.bsMark === otherBaseDecision.bsMark', context), true);
});

runTest('bottom-fishing trial position gets one soft-invalidation observation day but hard invalidation exits immediately', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(calcSource, context);
    vm.runInContext(`
        setActiveStrategy('波段抄底型');
        state.indicators = { ma: {}, macd: {}, rsi: {}, kdj: {} };
        var full = Array.from({ length: 4 }, (_, index) => ({
            date: '2026-03-0' + (index + 1), open: 100, high: 101, low: 99, close: 100, vol: 1000
        }));
        var makeMeta = (currentDay, invalidationDay, reason) => ({
            currentDay,
            currentClose: 100,
            type: '👀 弱势震荡',
            windowScore: 2,
            windowSignals: [],
            windowScoreSignals: [],
            invalidatedWindowSignals: [{
                signal: reason === 'kdj-dead-cross' ? 'B8' : 'B16',
                day: 0,
                signalDate: '2026-03-01',
                score: reason === 'kdj-dead-cross' ? 1 : 3,
                reason,
                invalidationDay,
                invalidationDate: '2026-03-0' + (invalidationDay + 1),
                invalidationLevel: reason === 'price-break' ? 99 : null
            }],
            buySignals: [], exitSignals: [], warningSignals: [], allSignals: {}, inCooldown: false
        });
        var activeMeta = makeMeta(1, 1, 'kdj-dead-cross');
        getSignalMeta = () => activeMeta;
        getMarketContext = () => ({ label: '核心宽基分化', cls: 'neutral', increaseCaps: null });
        getRiskContext = () => ({ score: 100, level: '低波动/偏离', coef: 1, flags: [], stop: 99, pressure: 110 });
        getExitSeverity = () => ({ level: '无明确离场', detail: '无' });
        getBasePosition = () => 0;
        var softDayDecision = computeDecisionForIndex(1, full, 30);
        activeMeta = makeMeta(2, 1, 'kdj-dead-cross');
        var nextDayDecision = computeDecisionForIndex(2, full, 30);
        activeMeta = makeMeta(3, 3, 'price-break');
        var hardDayDecision = computeDecisionForIndex(3, full, 30);
    `, context);
    assert.strictEqual(vm.runInContext('softDayDecision.position', context), 30);
    assert.strictEqual(vm.runInContext('softDayDecision.softSignalGrace.applied', context), true);
    assert.strictEqual(vm.runInContext('softDayDecision.bsMark', context), null);
    assert.strictEqual(vm.runInContext('nextDayDecision.position', context), 0);
    assert.strictEqual(vm.runInContext('nextDayDecision.bsMark', context), 'S');
    assert.strictEqual(vm.runInContext('hardDayDecision.position', context), 0);
    assert.strictEqual(vm.runInContext('hardDayDecision.bsMark', context), 'S');
});

runTest('B13 is a steady trend confirmation only for the conservative trend strategy', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    assert.strictEqual(vm.runInContext('STRATEGIES["稳健趋势型"].buySignals.includes("B13")', context), true);
    assert.strictEqual(vm.runInContext('STRATEGIES["稳健趋势型"].scoreGroups.some(group => group.includes("B1") && group.includes("B13"))', context), true);
    assert.strictEqual(vm.runInContext('STRATEGIES["综合全能型"].buySignals.includes("B13")', context), false);
    assert.strictEqual(vm.runInContext('STRATEGIES["综合全能型"].scoreGroups.some(group => group.includes("B13"))', context), false);
});

runTest('precomputed weekly signal contexts preserve every daily signal result', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(dataSource, context);
    vm.runInContext(calcSource, context);
    vm.runInContext(`
        var weeklyContextRows = [];
        var cursor = new Date('2025-01-02T00:00:00Z');
        while (weeklyContextRows.length < 180) {
            var day = cursor.getUTCDay();
            if (day !== 0 && day !== 6) {
                var i = weeklyContextRows.length;
                var base = 100 + Math.sin(i / 7) * 4 + i * 0.08;
                weeklyContextRows.push({
                    date: cursor.toISOString().slice(0, 10),
                    open: base - Math.sin(i / 3),
                    high: base + 2 + (i % 4) * 0.2,
                    low: base - 2 - (i % 3) * 0.2,
                    close: base + Math.cos(i / 5),
                    vol: 10000 + (i % 11) * 900,
                    amt: 1000000 + i * 1000
                });
            }
            cursor.setUTCDate(cursor.getUTCDate() + 1);
        }
        state.id = 'sh';
        state.mode = 'index';
        state.period = 'daily';
        state.rawData.sh = weeklyContextRows;
        var weeklyContextIndicators = {
            ma: { 5: Calcs.ma(weeklyContextRows, 5), 10: Calcs.ma(weeklyContextRows, 10), 20: Calcs.ma(weeklyContextRows, 20), 60: Calcs.ma(weeklyContextRows, 60) },
            macd: Calcs.macd(weeklyContextRows),
            rsi: Calcs.rsi(weeklyContextRows),
            kdj: Calcs.kdj(weeklyContextRows)
        };
        var originalWeeklyContexts = weeklyContextRows.map(function(_, idx) {
            var ctx = new SignalContext(idx, weeklyContextRows, weeklyContextIndicators, state);
            return { wd: ctx.wd, weeklySupport: ctx.weeklySupport, weeklyDoubleBottom: ctx.weeklyDoubleBottom };
        });
        var precomputedWeeklyContexts = buildWeeklySignalContexts(weeklyContextRows);
        var originalDailySignals = weeklyContextRows.map(function(_, idx) {
            return calculateDailySignals(idx, weeklyContextRows, weeklyContextIndicators);
        });
        var precomputedDailySignals = weeklyContextRows.map(function(_, idx) {
            return calculateDailySignals(idx, weeklyContextRows, weeklyContextIndicators, null, precomputedWeeklyContexts[idx]);
        });
    `, context);
    const result = JSON.parse(vm.runInContext('JSON.stringify({ originalWeeklyContexts, precomputedWeeklyContexts, originalDailySignals, precomputedDailySignals })', context));
    assert.deepStrictEqual(result.precomputedWeeklyContexts, result.originalWeeklyContexts);
    assert.deepStrictEqual(result.precomputedDailySignals, result.originalDailySignals);
});

runTest('W2 is an observation signal and does not drive strategy warnings', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    assert.strictEqual(vm.runInContext('Object.values(STRATEGIES).some(strategy => strategy.warningSignals.includes("W2"))', context), false);
    assert.strictEqual(vm.runInContext('SIGNAL_DESC.W2.desc', context), '连阳缩量迹象');
});

runTest('W3 flags volume-price stalling but remains observation-only', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext('function convertDailyToWeekly() { return []; }', context);
    vm.runInContext(calcSource, context);
    vm.runInContext(renderSource, context);
    vm.runInContext(`
        state.period = 'daily';
        var data = Array.from({ length: 65 }, (_, i) => ({
            date: '2026-06-' + String(i + 1).padStart(2, '0'),
            open: 100,
            high: 101,
            low: 99,
            close: 100,
            vol: 1000
        }));
        for (var i = 44; i < 64; i++) {
            data[i].open = 100 + (i - 44) * 0.2;
            data[i].close = data[i].open + 0.2;
            data[i].high = data[i].close + 0.3;
            data[i].low = data[i].open - 0.3;
            data[i].vol = 1000;
        }
        data[64] = {
            date: '2026-08-04',
            open: 104.8,
            high: 108.5,
            low: 104.2,
            close: 105.0,
            vol: 2600
        };
        var ind = {
            ma: { 5: [], 10: [], 20: [], 60: [] },
            macd: { diff: [], dea: [] },
            rsi: { val: [] },
            kdj: { k: [], d: [], j: [] }
        };
        for (var j = 0; j < data.length; j++) {
            ind.ma[5][j] = 103;
            ind.ma[10][j] = 102;
            ind.ma[20][j] = 101;
            ind.ma[60][j] = 95;
            ind.macd.diff[j] = 0;
            ind.macd.dea[j] = 0;
            ind.rsi.val[j] = 55;
            ind.kdj.k[j] = 50;
            ind.kdj.d[j] = 50;
            ind.kdj.j[j] = 50;
        }
        var signals = calculateDailySignals(64, data, ind);
        data[64]._signals = ['W3'];
        Object.assign(STRATEGY, STRATEGIES['综合全能型']);
        state.indicators = ind;
        getMarketContext = () => ({ label: '全面多头', cls: 'bull', coef: 1, maxPosition: 80, reason: 'test fixture', trends: [] });
        var meta = getSignalMeta(64, data, ind);
        var exit = getExitSeverity(meta, 64, data, ind);
        var decision = computeDecisionForIndex(64, data, 50);
    `, context);
    assert.ok(vm.runInContext('signals.includes("W3")', context));
    assert.strictEqual(vm.runInContext('SIGNAL_DESC.W3.desc', context), '放量滞涨');
    assert.strictEqual(vm.runInContext('Object.values(STRATEGIES).some(strategy => strategy.warningSignals.includes("W3"))', context), false);
    assert.strictEqual(vm.runInContext('meta.warningSignals.length', context), 0);
    assert.strictEqual(vm.runInContext('exit.level', context), '无明确离场');
    assert.strictEqual(vm.runInContext('decision.bsMark', context), null);
    assert.ok(vm.runInContext('decision.position > 0', context));
});

runTest('W4 caps only existing high positions without changing first B or S', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext('function convertDailyToWeekly() { return []; }', context);
    vm.runInContext(calcSource, context);
    vm.runInContext(`
        Object.assign(STRATEGY, STRATEGIES['稳健趋势型']);
        state.strategy = '稳健趋势型';
        getMarketContext = () => ({ label: '全面多头', cls: 'bull', coef: 1, maxPosition: 80, reason: 'test fixture', trends: [] });
        state.indicators = {
            ma: { 5: [], 10: [], 20: [], 60: [] },
            macd: { diff: [], dea: [] },
            rsi: { val: [] },
            kdj: { k: [], d: [], j: [] }
        };
        for (var i = 0; i < 90; i++) {
            state.indicators.ma[5][i] = 108;
            state.indicators.ma[10][i] = 106;
            state.indicators.ma[20][i] = 103;
            state.indicators.ma[60][i] = 98;
            state.indicators.macd.diff[i] = 1;
            state.indicators.macd.dea[i] = 0;
            state.indicators.rsi.val[i] = 62;
            state.indicators.kdj.k[i] = 50;
            state.indicators.kdj.d[i] = 50;
            state.indicators.kdj.j[i] = 50;
        }
        var full = Array.from({ length: 90 }, (_, i) => ({
            date: '2026-12-' + String(i + 1).padStart(2, '0'),
            open: 100,
            high: 104,
            low: 99,
            close: 103,
            vol: 1000,
            _signals: ['B1', 'B2', 'W4']
        }));
        var firstOpen = computeDecisionForIndex(80, full, 0);
        var highHeld = computeDecisionForIndex(80, full, 80);
        var midHeld = computeDecisionForIndex(80, full, 50);
        var meta = getSignalMeta(80, full, state.indicators);
    `, context);
    assert.strictEqual(vm.runInContext('SIGNAL_DESC.W4.desc', context), '缩量上涨背离');
    assert.strictEqual(vm.runInContext('Object.values(STRATEGIES).some(strategy => strategy.warningSignals.includes("W4"))', context), false);
    assert.strictEqual(vm.runInContext('meta.warningSignals.includes("W4")', context), false);
    assert.strictEqual(vm.runInContext('firstOpen.bsMark', context), 'B');
    assert.ok(vm.runInContext('firstOpen.position > 50', context));
    assert.strictEqual(vm.runInContext('highHeld.position', context), 50);
    assert.strictEqual(vm.runInContext('highHeld.bsMark', context), null);
    assert.strictEqual(vm.runInContext('midHeld.position', context), 50);
    assert.strictEqual(vm.runInContext('midHeld.bsMark', context), null);
});

runTest('W4 detects volume-shrinking rise near pressure', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext('function convertDailyToWeekly() { return []; }', context);
    vm.runInContext(calcSource, context);
    vm.runInContext(`
        state.period = 'daily';
        var data = Array.from({ length: 90 }, (_, i) => ({
            date: '2026-11-' + String(i + 1).padStart(2, '0'),
            open: 100,
            high: 103,
            low: 99,
            close: 101,
            vol: 1000
        }));
        for (var i = 70; i < 80; i++) {
            data[i].open = 100 + (i - 70) * 0.4;
            data[i].close = data[i].open + 0.2;
            data[i].high = data[i].close + 1.8;
            data[i].low = data[i].open - 0.8;
            data[i].vol = i < 75 ? 2200 : 1400;
        }
        data[80] = { date: '2027-01-20', open: 104.0, high: 106.8, low: 103.5, close: 106.0, vol: 1250 };
        var ind = {
            ma: { 5: [], 10: [], 20: [], 60: [] },
            macd: { diff: [], dea: [] },
            rsi: { val: [] },
            kdj: { k: [], d: [], j: [] }
        };
        for (var j = 0; j < data.length; j++) {
            ind.ma[5][j] = 104;
            ind.ma[10][j] = 103;
            ind.ma[20][j] = 100;
            ind.ma[60][j] = 95;
            ind.macd.diff[j] = 0;
            ind.macd.dea[j] = 0;
            ind.rsi.val[j] = 61;
            ind.kdj.k[j] = 50;
            ind.kdj.d[j] = 50;
            ind.kdj.j[j] = 50;
        }
        var signals = calculateDailySignals(80, data, ind);
    `, context);
    assert.ok(vm.runInContext('signals.includes("W4")', context));
});

runTest('B17 marks a short-term oversold stop-fall rebound only after serial selloff', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext('function convertDailyToWeekly() { return []; }', context);
    vm.runInContext(calcSource, context);
    vm.runInContext(`
        state.period = 'daily';
        var data = Array.from({ length: 65 }, (_, i) => ({
            date: '2026-03-' + String(i + 1).padStart(2, '0'),
            open: 100,
            high: 101,
            low: 99,
            close: 100,
            vol: 1000
        }));
        data[60] = { date: '2026-05-01', open: 100, high: 101, low: 95, close: 96, vol: 1200 };
        data[61] = { date: '2026-05-02', open: 96, high: 97, low: 91, close: 92, vol: 1400 };
        data[62] = { date: '2026-05-03', open: 92, high: 93, low: 87, close: 88, vol: 1600 };
        data[63] = { date: '2026-05-04', open: 88, high: 89, low: 82, close: 84, vol: 2200 };
        data[64] = { date: '2026-05-05', open: 83, high: 88, low: 80, close: 86, vol: 2400 };
        var ind = {
            ma: { 5: [], 10: [], 20: [], 60: [] },
            macd: { diff: [], dea: [] },
            rsi: { val: [] },
            kdj: { k: [], d: [], j: [] }
        };
        for (var i = 0; i < data.length; i++) {
            ind.ma[5][i] = 90;
            ind.ma[10][i] = 95;
            ind.ma[20][i] = 100;
            ind.ma[60][i] = 100;
            ind.macd.diff[i] = 0;
            ind.macd.dea[i] = 0;
            ind.rsi.val[i] = i === 63 ? 24 : (i === 64 ? 28 : 50);
            ind.kdj.k[i] = 50;
            ind.kdj.d[i] = 50;
            ind.kdj.j[i] = 50;
        }
        var signals = calculateDailySignals(64, data, ind);

        var mild = data.map(item => ({ ...item }));
        mild[60] = { ...mild[60], close: 100, open: 101, low: 99 };
        mild[61] = { ...mild[61], close: 99, open: 100, low: 98 };
        mild[62] = { ...mild[62], close: 98, open: 99, low: 97 };
        mild[63] = { ...mild[63], close: 97, open: 98, low: 96 };
        mild[64] = { ...mild[64], open: 97, high: 99, low: 95, close: 98 };
        var mildSignals = calculateDailySignals(64, mild, ind);
    `, context);
    assert.ok(vm.runInContext('signals.includes("B17")', context));
    assert.strictEqual(vm.runInContext('mildSignals.includes("B17")', context), false);
});

runTest('B18 flags BOLL lower-band reclaim after selloff but remains observation-only', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext('function convertDailyToWeekly() { return []; }', context);
    vm.runInContext(calcSource, context);
    vm.runInContext(`
        state.period = 'daily';
        var data = Array.from({ length: 65 }, (_, i) => ({
            date: '2026-07-' + String(i + 1).padStart(2, '0'),
            open: 100,
            high: 101,
            low: 99,
            close: 100,
            vol: 1000
        }));
        data[60] = { date: '2026-09-01', open: 101, high: 102, low: 99, close: 100, vol: 1200 };
        data[61] = { date: '2026-09-02', open: 100, high: 101, low: 94, close: 95, vol: 1500 };
        data[62] = { date: '2026-09-03', open: 95, high: 96, low: 89, close: 90, vol: 1800 };
        data[63] = { date: '2026-09-04', open: 90, high: 91, low: 84, close: 86, vol: 2300 };
        data[64] = { date: '2026-09-05', open: 85, high: 93, low: 83, close: 91, vol: 2600 };
        var ind = {
            ma: { 5: [], 10: [], 20: [], 60: [] },
            macd: { diff: [], dea: [] },
            rsi: { val: [] },
            kdj: { k: [], d: [], j: [] }
        };
        for (var i = 0; i < data.length; i++) {
            ind.ma[5][i] = 94;
            ind.ma[10][i] = 97;
            ind.ma[20][i] = 100;
            ind.ma[60][i] = 102;
            ind.macd.diff[i] = 0;
            ind.macd.dea[i] = 0;
            ind.rsi.val[i] = i === 63 ? 24 : (i === 64 ? 31 : 50);
            ind.kdj.k[i] = 50;
            ind.kdj.d[i] = 50;
            ind.kdj.j[i] = 50;
        }
        var signals = calculateDailySignals(64, data, ind);
        Object.assign(STRATEGY, STRATEGIES['波段抄底型']);
        var meta = getSignalMeta(64, data, ind);
    `, context);
    assert.ok(vm.runInContext('signals.includes("B18")', context));
    assert.strictEqual(vm.runInContext('SIGNAL_DESC.B18.desc', context), 'BOLL下轨止跌收回');
    assert.strictEqual(vm.runInContext('Object.values(STRATEGIES).some(strategy => strategy.buySignals.includes("B18"))', context), false);
    assert.strictEqual(vm.runInContext('meta.buySignals.includes("B18")', context), false);
    assert.strictEqual(vm.runInContext('meta.windowSignals.some(w => w.signal === "B18")', context), false);
});

runTest('B19 double bottom waits for a right-side breakout and only scores the wave strategy', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext('function convertDailyToWeekly() { return []; }', context);
    vm.runInContext(calcSource, context);
    vm.runInContext(`
        state.mode = 'stock';
        state.period = 'daily';
        var data = Array.from({ length: 71 }, (_, i) => ({
            date: '2026-08-' + String(i + 1).padStart(2, '0'),
            open: 13.8,
            high: 14.1,
            low: 13.6,
            close: 13.9,
            vol: 1000
        }));
        data[62].low = 12.9;
        data[63].low = 12.7;
        data[64] = { date: '2026-08-24', open: 12.7, high: 12.9, low: 12.30, close: 12.6, vol: 1300 };
        data[65] = { date: '2026-08-25', open: 12.6, high: 13.0, low: 12.55, close: 12.9, vol: 1200 };
        data[66] = { date: '2026-08-26', open: 12.9, high: 13.50, low: 12.8, close: 13.4, vol: 1400 };
        data[67] = { date: '2026-08-27', open: 13.35, high: 13.45, low: 13.0, close: 13.1, vol: 1100 };
        data[68] = { date: '2026-08-28', open: 13.1, high: 13.2, low: 12.65, close: 12.8, vol: 1000 };
        data[69] = { date: '2026-08-31', open: 12.75, high: 12.95, low: 12.34, close: 12.7, vol: 1250 };
        data[70] = { date: '2026-09-01', open: 13.2, high: 14.0, low: 13.1, close: 13.88, vol: 1800 };
        var ind = {
            ma: { 5: [], 10: [], 20: [], 60: [] },
            macd: { diff: [], dea: [] },
            rsi: { val: [] },
            kdj: { k: [], d: [], j: [] }
        };
        for (var i = 0; i < data.length; i++) {
            ind.ma[5][i] = 13.0;
            ind.ma[10][i] = 13.0;
            ind.ma[20][i] = 13.2;
            ind.ma[60][i] = 14.0;
            ind.macd.diff[i] = 0;
            ind.macd.dea[i] = 0;
            ind.rsi.val[i] = 50;
            ind.kdj.k[i] = 50;
            ind.kdj.d[i] = 50;
            ind.kdj.j[i] = 50;
        }
        var secondBottomSignals = calculateDailySignals(69, data, ind);
        var breakoutSignals = calculateDailySignals(70, data, ind);
        var weak = data.map(item => ({ ...item }));
        weak[70] = { ...weak[70], open: 13.2, high: 13.58, close: 13.55 };
        var weakSignals = calculateDailySignals(70, weak, ind);
        state.mode = 'index';
        var indexSignals = calculateDailySignals(70, data, ind);
    `, context);
    assert.strictEqual(vm.runInContext('secondBottomSignals.includes("B19")', context), false);
    assert.strictEqual(vm.runInContext('breakoutSignals.includes("B19")', context), true);
    assert.strictEqual(vm.runInContext('weakSignals.includes("B19")', context), false);
    assert.strictEqual(vm.runInContext('indexSignals.includes("B19")', context), false);
    assert.strictEqual(vm.runInContext('SIGNAL_SCORES.B19', context), 3);
    assert.strictEqual(vm.runInContext('SIGNAL_DESC.B19.desc', context), '双底突破确认');
    assert.strictEqual(vm.runInContext('STRATEGIES["波段抄底型"].buySignals.includes("B19")', context), true);
    assert.strictEqual(vm.runInContext('STRATEGIES["波段抄底型"].scoreGroups.some(group => group.length === 1 && group[0] === "B19")', context), true);
    assert.strictEqual(vm.runInContext('Object.entries(STRATEGIES).filter(([name]) => name !== "波段抄底型").some(([, strategy]) => strategy.buySignals.includes("B19"))', context), false);
});

runTest('wave strategy recognizes larger daily and weekly double-bottom repair candidates', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext('function convertDailyToWeekly() { return []; }', context);
    vm.runInContext(calcSource, context);
    vm.runInContext(`
        state.mode = 'stock';
        state.period = 'daily';
        var daily = Array.from({ length: 140 }, (_, i) => ({ date: '2026-01-' + String(i + 1).padStart(3, '0'), open: 100, high: 102, low: 98, close: 100, vol: 1000 }));
        daily[108].low = 94; daily[109].low = 92; daily[110] = { date: '2026-04-21', open: 95, high: 97, low: 90, close: 92, vol: 1000 }; daily[111].low = 93; daily[112].low = 94;
        daily[127].low = 96; daily[128].low = 95; daily[129] = { ...daily[129], low: 94, close: 96 }; daily[130] = { date: '2026-05-29', open: 95, high: 98, low: 91, close: 97, vol: 900 };
        var ind = { ma: { 5: [], 10: [], 20: [], 60: [] }, macd: { diff: [], dea: [] }, rsi: { val: [] }, kdj: { k: [], d: [], j: [] } };
        for (var i = 0; i < daily.length; i++) { ind.ma[5][i] = 100; ind.ma[10][i] = 100; ind.ma[20][i] = 100; ind.ma[60][i] = 100; ind.macd.diff[i] = 0; ind.macd.dea[i] = 0; ind.rsi.val[i] = 50; ind.kdj.k[i] = 50; ind.kdj.d[i] = 50; ind.kdj.j[i] = 50; }
        var dailySignals = calculateDailySignals(130, daily, ind);
        state.period = 'weekly';
        var weekly = Array.from({ length: 70 }, (_, i) => ({ date: '2026-W' + String(i + 1).padStart(2, '0'), open: 100, high: 102, low: 98, close: 100, vol: 1000 }));
        weekly[43].low = 95; weekly[44] = { date: '2026-W45', open: 95, high: 98, low: 90, close: 92, vol: 1000 }; weekly[45].low = 94;
        weekly[63].low = 96; weekly[64] = { ...weekly[64], low: 95, close: 96 }; weekly[65] = { date: '2026-W66', open: 95, high: 98, low: 92, close: 97, vol: 900 };
        var weeklySignals = calculateDailySignals(65, weekly, ind);
    `, context);
    assert.ok(vm.runInContext('dailySignals.includes("B20")', context));
    assert.ok(vm.runInContext('weeklySignals.includes("B21")', context));
    assert.strictEqual(vm.runInContext('SIGNAL_DESC.B20.desc', context), '大级别双底第二底修复');
    assert.strictEqual(vm.runInContext('SIGNAL_DESC.B21.desc', context), '周线双底第二底修复');
});

runTest('B22 support reclaim scores on confirmed structure below MA20 without opening a position alone', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext('function convertDailyToWeekly() { return []; }', context);
    vm.runInContext(calcSource, context);
    vm.runInContext(`
        setActiveStrategy('波段抄底型');
        state.strategy = '波段抄底型'; state.mode = 'stock'; state.period = 'daily';
        var daily = Array.from({ length: 140 }, (_, i) => ({ date: '2026-01-' + String(i + 1).padStart(3, '0'), open: 100, high: 101, low: 99, close: 100, vol: 1000 }));
        daily[100].low = 96; daily[101].low = 95;
        daily[102] = { date: '2026-04-13', open: 97, high: 98, low: 94, close: 97, vol: 1000 };
        daily[103].low = 95; daily[104].low = 96;
        daily[130] = { date: '2026-05-29', open: 95, high: 98, low: 94.2, close: 97.5, vol: 900 };
        var ind = { ma: { 5: [], 10: [], 20: [], 60: [] }, macd: { diff: [], dea: [] }, rsi: { val: [] }, kdj: { k: [], d: [], j: [] } };
        for (var i = 0; i < daily.length; i++) { ind.ma[5][i] = 100; ind.ma[10][i] = 100; ind.ma[20][i] = 100; ind.ma[60][i] = 100; ind.macd.diff[i] = 0; ind.macd.dea[i] = 0; ind.rsi.val[i] = 50; ind.kdj.k[i] = 50; ind.kdj.d[i] = 50; ind.kdj.j[i] = 50; }
        state.indicators = ind;
        var reclaimSignals = calculateDailySignals(130, daily, ind);
        var reclaim = findSupportReclaimCandidate({ idx: 130, full: daily, ind: ind, item: daily[130], prev: daily[129], weeklySeries: [] }, STRATEGY);
        var nearMaInd = { ...ind, ma: { ...ind.ma, 20: ind.ma[20].map(() => 94.5) } };
        var nearMa = findSupportReclaimCandidate({ idx: 130, full: daily, ind: nearMaInd, item: daily[130], prev: daily[129], weeklySeries: [] }, STRATEGY);
        state.mode = 'index';
        var indexSignals = calculateDailySignals(130, daily, ind);
        state.mode = 'stock';
    `, context);
    assert.ok(vm.runInContext('reclaimSignals.includes("B22")', context));
    assert.strictEqual(vm.runInContext('reclaim.sources.includes("pivot")', context), true);
    assert.strictEqual(vm.runInContext('reclaim.level', context), 94);
    // 支撑贴近 MA20 时必须让位给 B6/B11，不重复计分。
    assert.strictEqual(vm.runInContext('nearMa', context), null);
    assert.strictEqual(vm.runInContext('indexSignals.includes("B22")', context), false);
    assert.strictEqual(vm.runInContext('SIGNAL_SCORES.B22', context), 3);
    assert.strictEqual(vm.runInContext('SIGNAL_DESC.B22.desc', context), '回踩已确认支撑收复');
    assert.ok(vm.runInContext('SIGNAL_SCORES.B22 < STRATEGIES["波段抄底型"].buyThreshold', context));
    assert.strictEqual(vm.runInContext('STRATEGIES["波段抄底型"].buySignals.includes("B22")', context), true);
    // B22 并入 B5/B6/B11/B16 同组去重，不新增独立计分组，也不扩散到其他策略。
    assert.strictEqual(vm.runInContext('STRATEGIES["波段抄底型"].scoreGroups.filter(group => group.includes("B22")).length', context), 1);
    assert.strictEqual(vm.runInContext('STRATEGIES["波段抄底型"].scoreGroups.some(group => group.includes("B22") && ["B5","B6","B11","B16"].every(member => group.includes(member)))', context), true);
    assert.strictEqual(vm.runInContext('Object.entries(STRATEGIES).filter(([name]) => name !== "波段抄底型").some(([, strategy]) => strategy.buySignals.includes("B22"))', context), false);
});

runTest('wave first trial checks local signal defense while preserving distant hard defense', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext('function convertDailyToWeekly() { return []; }', context);
    vm.runInContext(calcSource, context);
    vm.runInContext([
        "setActiveStrategy('波段抄底型'); state.strategy = '波段抄底型'; state.mode = 'stock'; state.period = 'daily';",
        "var full = Array.from({ length: 80 }, (_, day) => ({ date: 'D' + day, open: 99.5, high: 100.5, low: 99, close: 100, vol: 1000, _signals: [] }));",
        // 64 日确认的历史结构低点距离收盘 10%，当日 B9 的局部低点只距离收盘 1.5%。
        "full[63].low = 95; full[64].low = 90; full[65].low = 95;",
        "full[70] = { date: 'D70', open: 99.5, high: 101, low: 98.5, close: 100, vol: 1000, _signals: ['B9'] };",
        "full[71] = { date: 'D71', open: 90, high: 91, low: 88, close: 89, vol: 1000, _signals: [] };",
        "state.indicators = { ma: { 20: Array(80).fill(100), 60: Array(80).fill(100) }, macd: {}, rsi: {}, kdj: {} };",
        "var activeMeta = { currentDay: 70, type: '明确转强', windowScore: 4, buySignals: ['B9'], exitSignals: [], warningSignals: [], allSignals: { B9: true }, windowSignals: [{ day: 70, signal: 'B9' }], windowScoreSignals: [{ day: 70, signal: 'B9', score: 4 }], invalidatedWindowSignals: [], localBreakWindowSignals: [], inCooldown: false };",
        "getSignalMeta = day => ({ ...activeMeta, currentDay: day });",
        "function candidate(position) { return { position, prevAdv: 0, exit: { level: '无明确离场' }, simpleAction: position ? '轻仓建仓' : '持币观望', simpleColorClass: position ? 'text-info' : 'text-dim', bsMark: position ? 'B' : null, positionDriver: '', risk: { score: 100 }, waveRejectionProtection: { status: 'none' }, waveContext: { inScope: true, regime: 'down', regimeLabel: '下跌', boxSupport: null, boxPressure: null, boxMidpoint: null, box: { valid: false, atr14: 1 } } }; }",
        "var trial = applyWaveRegimeGovernance(70, full, 0, candidate(50), STRATEGY);",
        "full[70]._decision = trial; activeMeta = { ...activeMeta, currentDay: 71, buySignals: [], allSignals: {}, windowSignals: [], windowScoreSignals: [] };",
        "var hardBreak = applyWaveRegimeGovernance(71, full, 30, candidate(30), STRATEGY);"
    ].join('\n'), context);
    const result = JSON.parse(vm.runInContext('JSON.stringify({ trial, hardBreak })', context));
    assert.strictEqual(result.trial.position, 30);
    assert.strictEqual(result.trial.bsMark, 'B');
    assert.strictEqual(result.trial.waveContext.entryDefense, 98.5);
    assert.strictEqual(result.trial.waveContext.entryDefenseSource, 'local-signal');
    assert.strictEqual(result.trial.waveContext.frozenLocalDefense, 98.5);
    assert.strictEqual(result.trial.waveContext.frozenHardDefense, 90);
    assert.ok(result.trial.positionDriver.includes('局部防守位98.50通过距离检查'));
    assert.strictEqual(result.hardBreak.position, 0);
    assert.strictEqual(result.hardBreak.bsMark, 'S');
    assert.ok(result.hardBreak.positionDriver.includes('收盘跌破冻结硬防守位90.00'));
});

runTest('wave strategy permits a multi-timeframe double-bottom trial without lowering the ordinary score gate', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext('function convertDailyToWeekly() { return state.weeklyData[state.id] || []; }', context);
    vm.runInContext(calcSource, context);
    vm.runInContext(`
        setActiveStrategy('波段抄底型');
        state.strategy = '波段抄底型'; state.mode = 'stock'; state.period = 'daily'; state.id = 'mtf-test';
        state.indicators = { ma: { 20: [], 60: [] }, macd: null, rsi: null, kdj: null };
        var full = Array.from({ length: 70 }, (_, index) => {
            var date = new Date(Date.UTC(2026, 0, 1 + index)).toISOString().slice(0, 10);
            return { date, open: 100, high: 102, low: 98, close: 100, vol: 1000, _signals: [] };
        });
        full[69] = { ...full[69], date: '2026-08-31', open: 99, high: 101, low: 98.5, close: 100, vol: 1100, _signals: ['B20'] };
        for (var i = 0; i < full.length; i++) { state.indicators.ma[20][i] = 100; state.indicators.ma[60][i] = 110; }
        state.indicators.ma[20][68] = 101;
        var weekly = Array.from({ length: 10 }, (_, index) => ({ date: '2026-W' + String(index + 1).padStart(2, '0'), open: 100, high: 102, low: 95, close: 99, vol: 1000 }));
        weekly[3].low = 95; weekly[4] = { date: '2026-W05', open: 95, high: 100, low: 90, close: 94, vol: 1000 }; weekly[5].low = 95;
        weekly[6].low = 95; weekly[7].low = 96; weekly[8] = { ...weekly[8], low: 95, close: 93 };
        weekly[9] = { date: '2026-08-31', open: 92, high: 96, low: 91, close: 94, vol: 1100 };
        state.weeklyData['mtf-test'] = weekly;
        state.rawData['mtf-test'] = full;
        getWaveContext = () => ({ inScope: true, regime: 'down', regimeLabel: '下跌', boxSupport: 98, boxPressure: 110, boxMidpoint: 104, positionCap: 30, box: { valid: false, atr14: 1 }, lifecycle: null });
        getMarketContext = () => ({ label: '核心宽基偏弱', cls: 'bear', increaseCaps: { ordinary: 30, independent: 50 }, trends: [] });
        getRiskContext = () => ({ score: 100, level: '低波动/偏离', coef: 1, stop: 95, pressure: 110 });
        getExitSeverity = () => ({ level: '无明确离场', detail: '暂无明确离场依据' });
        getWaveRejectionProtectionContext = (idx, rows, meta, prevPos, targetPosition) => ({ active: false, status: 'none', targetPosition });
        var meta = {
            type: '👀 关注异动', windowScore: 3, buySignals: ['B20'], exitSignals: [], warningSignals: [],
            allSignals: { B20: { status: true, score: 3 } }, windowSignals: [{ day: 69, signal: 'B20' }],
            windowScoreSignals: [{ day: 69, signal: 'B20', score: 3 }], invalidatedWindowSignals: [],
            localBreakWindowSignals: [], inCooldown: false, daysSinceExit: Infinity
        };
        getSignalMeta = () => meta;
        var probeEntry = computeDecisionForIndex(69, full, 0);
        var probeSummary = getStockDecisionSummary(meta, probeEntry);
        weekly[4].low = 70;
        var ordinaryThreePointEntry = computeDecisionForIndex(69, full, 0);
    `, context);
    const result = JSON.parse(vm.runInContext('JSON.stringify({ probeEntry, probeSummary, ordinaryThreePointEntry })', context));
    assert.strictEqual(result.probeEntry.position, 30);
    assert.strictEqual(result.probeEntry.bsMark, 'B');
    assert.strictEqual(result.probeEntry.waveContext.lifecycle.entryMode, 'multi-timeframe-double-bottom-probe');
    assert.strictEqual(result.probeEntry.waveContext.multiTimeframeBottomProbe.qualified, true);
    assert.strictEqual(result.probeEntry.waveContext.multiTimeframeBottomProbe.provisional, true);
    assert.ok(result.probeEntry.positionDriver.includes('周线双底候选与日线B20共振'));
    assert.strictEqual(result.probeSummary.state, '多周期底部共振试探');
    assert.ok(result.probeSummary.why.includes('周线双底第二底与日线共振'));
    assert.strictEqual(result.ordinaryThreePointEntry.position, 0);
    assert.strictEqual(result.ordinaryThreePointEntry.waveContext.multiTimeframeBottomProbe, null);
});

runTest('weekly double-bottom context accepts a nearby second-bottom cluster without loosening daily B20', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext('function convertDailyToWeekly() { return state.weeklyData[state.id] || []; }', context);
    vm.runInContext(calcSource, context);
    vm.runInContext(`
        state.mode = 'stock'; state.period = 'daily'; state.id = 'weekly-cluster-test';
        var daily = Array.from({ length: 40 }, (_, index) => ({ date: '2026-01-' + String(index + 1).padStart(2, '0'), open: 100, high: 102, low: 98, close: 100, vol: 1000 }));
        var weeks = [
            { date: '2026-W01', open: 100, high: 102, low: 98, close: 100 },
            { date: '2026-W02', open: 100, high: 102, low: 98, close: 100 },
            { date: '2026-W03', open: 100, high: 102, low: 98, close: 100 },
            { date: '2026-W04', open: 100, high: 102, low: 98, close: 100 },
            { date: '2026-W05', open: 100, high: 103, low: 95, close: 99 },
            { date: '2026-W06', open: 99, high: 104, low: 101, close: 103 },
            { date: '2026-W07', open: 103, high: 104, low: 100, close: 102 },
            { date: '2026-W08', open: 102, high: 103, low: 95.2, close: 99 },
            { date: '2026-W09', open: 99, high: 103, low: 101, close: 102 },
            { date: '2026-W10', open: 102, high: 103, low: 100, close: 101 },
            { date: '2026-W11', open: 101, high: 103, low: 99, close: 102 },
            { date: '2026-W12', open: 102, high: 103, low: 95.0, close: 99 },
            { date: '2026-W13', open: 99, high: 103, low: 95.4, close: 101 }
        ];
        var contextWithNearbyLow = getWeeklyDoubleBottomContext(daily, 39, weeks, { lookbackDays: 52, minimumGap: 4, maximumGap: 26, tolerance: 0.07, pivotDays: 1, allowNearbyRecentLow: true, recentLowTolerance: 0.03 });
        var contextWithoutNearbyLow = getWeeklyDoubleBottomContext(daily, 39, weeks, { lookbackDays: 52, minimumGap: 4, maximumGap: 26, tolerance: 0.07, pivotDays: 1, allowNearbyRecentLow: false });
    `, context);
    const result = JSON.parse(vm.runInContext('JSON.stringify({ contextWithNearbyLow, contextWithoutNearbyLow })', context));
    assert.strictEqual(result.contextWithNearbyLow.candidate, true);
    assert.strictEqual(result.contextWithNearbyLow.details.firstBottomValue, 95.2);
    assert.strictEqual(result.contextWithoutNearbyLow.candidate, false);
});

runTest('wave strategy exposes daily and weekly pressure as a peak candidate and confirms weak rejection', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext('function convertDailyToWeekly() { return []; }', context);
    vm.runInContext(calcSource, context);
    vm.runInContext(`
        setActiveStrategy('波段抄底型');
        state.strategy = '波段抄底型'; state.mode = 'stock'; state.period = 'daily';
        var full = Array.from({ length: 140 }, (_, i) => ({ date: '2026-01-' + String(i + 1).padStart(3, '0'), open: 100, high: 102, low: 98, close: 100, vol: 1000 }));
        full[110] = { date: '2026-04-21', open: 100, high: 120, low: 98, close: 115, vol: 1000 }; full[109].high = 100; full[111].high = 100;
        full[139] = { date: '2026-06-15', open: 114, high: 122, low: 100, close: 104, vol: 1000 };
        var ind = { ma: { 20: full.map(() => 100), 60: full.map(() => 100) } };
        var peak = getWavePeakContext(139, full, ind, { exitSignals: [] });
    `, context);
    assert.strictEqual(vm.runInContext('peak.candidate', context), true);
    assert.strictEqual(vm.runInContext('peak.confirmed', context), true);
    assert.ok(vm.runInContext('peak.sources.length >= 1', context));
});

runTest('L7 and L8 remain visible take-profit observations without driving strategy exits', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext('function convertDailyToWeekly() { return []; }', context);
    vm.runInContext(calcSource, context);
    vm.runInContext(`
        Object.assign(STRATEGY, STRATEGIES['波段抄底型']);
        state.strategy = '波段抄底型';
        var data = Array.from({ length: 65 }, (_, i) => ({
            date: '2026-10-' + String(i + 1).padStart(2, '0'),
            open: 100,
            high: 101,
            low: 99,
            close: 100,
            vol: 1000,
            _signals: []
        }));
        data[64]._signals = ['L7', 'L8'];
        var ind = {
            ma: { 5: [], 10: [], 20: [], 60: [] },
            macd: { diff: [], dea: [] },
            rsi: { val: [] },
            kdj: { k: [], d: [], j: [] }
        };
        for (var i = 0; i < data.length; i++) {
            ind.ma[5][i] = 100;
            ind.ma[10][i] = 100;
            ind.ma[20][i] = 100;
            ind.ma[60][i] = 100;
            ind.macd.diff[i] = 0;
            ind.macd.dea[i] = 0;
            ind.rsi.val[i] = 65;
            ind.kdj.k[i] = 50;
            ind.kdj.d[i] = 50;
            ind.kdj.j[i] = 50;
        }
        var meta = getSignalMeta(64, data, ind);
        var exit = getExitSeverity(meta, 64, data, ind);
    `, context);
    assert.strictEqual(vm.runInContext('SIGNAL_DESC.L7.desc', context), 'RSI超买回落');
    assert.strictEqual(vm.runInContext('SIGNAL_DESC.L8.desc', context), '布林上轨受阻');
    assert.strictEqual(vm.runInContext('Object.values(STRATEGIES).some(strategy => strategy.exitSignals.includes("L7") || strategy.exitSignals.includes("L8"))', context), false);
    assert.strictEqual(vm.runInContext('meta.exitSignals.includes("L7") || meta.exitSignals.includes("L8")', context), false);
    assert.strictEqual(vm.runInContext('meta.windowSignals.some(w => w.signal === "L7" || w.signal === "L8")', context), false);
    assert.strictEqual(vm.runInContext('exit.level', context), '无明确离场');
});

runTest('backtest summary delays execution and compares the same-period buy-hold benchmark', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(appSourceNoInit, context);
    vm.runInContext(`
        var sample = [
            { date: '2026-01-01', close: 100, _decision: { position: 0, simpleAction: '持币观望' } },
            { date: '2026-01-02', close: 100, _decision: { position: 50, simpleAction: '轻仓建仓' } },
            { date: '2026-01-03', close: 110, _decision: { position: 50, simpleAction: '轻仓持有' } },
            { date: '2026-01-04', close: 105, _decision: { position: 0, simpleAction: '执行离场' } },
            { date: '2026-01-05', close: 105, _decision: { position: 0, simpleAction: '持币观望' } }
        ];
        var summary = calculateBacktestSummary(sample, {
            startIdx: 1,
            initialCapital: 10000,
            costRate: 0.001,
            delayBars: 1
        });
    `, context);
    const summary = vm.runInContext('summary', context);
    assert.strictEqual(summary.totalTrades, 1);
    assert.strictEqual(summary.winCount, 0);
    assert.strictEqual(summary.trades.length, 2);
    assert.strictEqual(summary.trades[0].signalDate, '2026-01-02');
    assert.strictEqual(summary.trades[0].executionDate, '2026-01-03');
    assert.strictEqual(summary.trades[1].signalDate, '2026-01-04');
    assert.strictEqual(summary.trades[1].executionDate, '2026-01-05');
    assert.strictEqual(summary.delayBars, 1);
    assert.strictEqual(summary.benchmarkRet, '4.90');
    assert.strictEqual(summary.excessRet, '-7.27');
    assert.strictEqual(summary.winRateQualified, false);
    assert.strictEqual(summary.winRate, '0.0');
    assert.strictEqual(summary.openPositionAtEnd, false);
});

runTest('strategy watch state only opens probe positions when the active strategy allows it', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(dataSource, context);
    vm.runInContext(calcSource, context);
    vm.runInContext(renderSource, context);
    vm.runInContext(`
        state.period = 'daily';
        state.mode = 'index';
        state.id = 'sh';
        getMarketContext = () => ({ label: '全面多头', cls: 'bull', coef: 1, maxPosition: 80, reason: 'test fixture', trends: [] });
        state.indicators = {
            ma: { 5: [], 10: [], 20: [], 60: [] },
            macd: { diff: [], dea: [], bar: [] },
            rsi: { val: [] },
            kdj: { k: [], d: [], j: [] }
        };
        for (var i = 0; i < 70; i++) {
            state.indicators.ma[5][i] = 100;
            state.indicators.ma[10][i] = 99;
            state.indicators.ma[20][i] = 98;
            state.indicators.ma[60][i] = 96;
            state.indicators.macd.diff[i] = 0.2;
            state.indicators.macd.dea[i] = 0.1;
            state.indicators.macd.bar[i] = 0.2;
            state.indicators.rsi.val[i] = 50;
            state.indicators.kdj.k[i] = 50;
            state.indicators.kdj.d[i] = 50;
            state.indicators.kdj.j[i] = 50;
        }
        var full = Array.from({ length: 70 }, (_, i) => ({
            date: '2026-02-' + String(i + 1).padStart(2, '0'),
            open: 100,
            high: 101,
            low: 99,
            close: 100,
            vol: 1000,
            _signals: []
        }));

        setActiveStrategy('稳健趋势型');
        full[64]._signals = ['B1'];
        var steadyWatchMeta = getSignalMeta(64, full, state.indicators);
        var steadyWatchDecision = computeDecisionForIndex(64, full, 0);
        full[64]._decision = steadyWatchDecision;
        var steadyWatchHtml = generateAnalysisHTML(64, full, steadyWatchMeta);

        full[64]._signals = ['B2', 'B3'];
        var steadyReadyMeta = getSignalMeta(64, full, state.indicators);
        var steadyReadyDecision = computeDecisionForIndex(64, full, 0);

        setActiveStrategy('波段抄底型');
        full[64]._signals = ['B17'];
        var bottomWatchMeta = getSignalMeta(64, full, state.indicators);
        var bottomWatchDecision = computeDecisionForIndex(64, full, 0);
    `, context);

    assert.strictEqual(vm.runInContext('steadyWatchMeta.windowScore', context), 3);
    assert.strictEqual(vm.runInContext('steadyWatchMeta.type', context), '👀 关注异动');
    assert.strictEqual(vm.runInContext('steadyWatchDecision.position', context), 0);
    assert.strictEqual(vm.runInContext('steadyWatchDecision.bsMark', context), null);
    assert.strictEqual(vm.runInContext('steadyWatchDecision.simpleAction', context), '持币观望');
    assert.ok(vm.runInContext('steadyWatchHtml.includes("当前风险仓位") && steadyWatchHtml.includes("0%")', context));
    assert.ok(vm.runInContext('!steadyWatchHtml.includes("20%") && !steadyWatchHtml.includes("30%")', context));

    assert.strictEqual(vm.runInContext('steadyReadyMeta.windowScore', context), 5);
    assert.strictEqual(vm.runInContext('steadyReadyDecision.position', context), 80);
    assert.strictEqual(vm.runInContext('steadyReadyDecision.bsMark', context), 'B');

    assert.strictEqual(vm.runInContext('bottomWatchMeta.windowScore', context), 3);
    assert.strictEqual(vm.runInContext('bottomWatchMeta.type', context), '👀 关注异动');
    assert.strictEqual(vm.runInContext('bottomWatchDecision.position', context), 30);
    assert.strictEqual(vm.runInContext('bottomWatchDecision.bsMark', context), 'B');
});

runTest('weak core breadth caps ordinary index increases at 30 and independent strength at 50 without forcing reductions', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext('function convertDailyToWeekly() { return []; }', context);
    vm.runInContext(calcSource, context);
    vm.runInContext(renderSource, context);
    vm.runInContext(`
        state.period = 'daily';
        state.mode = 'index';
        state.indicators = { ma: { 20: Array(70).fill(101), 60: Array(70).fill(90) }, macd: null, rsi: null, kdj: null };
        setActiveStrategy('稳健趋势型');
        var full = Array.from({ length: 70 }, (_, i) => ({
            date: '2026-06-' + String(i + 1).padStart(2, '0'),
            open: 100,
            high: 102,
            low: 98,
            close: 100,
            vol: 1000
        }));
        var gateMeta = {
            type: '✅ 明确转强',
            windowScore: STRATEGY.buyThreshold,
            buySignals: ['B1'],
            exitSignals: [],
            warningSignals: [],
            allSignals: { B1: { status: true } },
            windowSignals: [{ day: 64, signal: 'B1' }],
            inCooldown: false,
            daysSinceExit: Infinity
        };
        var gateMarket = {
            label: '核心宽基偏弱',
            cls: 'bear',
            increaseCaps: { ordinary: 30, independent: 50 },
            reason: '普通机会新增风险上限30%，标的独立走强上限50%',
            trends: []
        };
        var gateRisk = { score: 100, level: '低波动/偏离', coef: 1, flags: [], stop: 95, pressure: 110 };
        var gateExit = { level: '无明确离场', detail: '暂无明确离场依据' };
        getSignalMeta = () => gateMeta;
        getMarketContext = () => gateMarket;
        getRiskContext = () => gateRisk;
        getExitSeverity = () => gateExit;

        var ordinaryEntry = computeDecisionForIndex(64, full, 0);
        var ordinaryEvidence = getNoviceEvidenceCopy(gateMeta, ordinaryEntry, '未触发离场', '', 'index');

        state.indicators.ma[20][59] = 94;
        state.indicators.ma[20][64] = 95;
        state.indicators.ma[60][64] = 90;
        var independentEntry = computeDecisionForIndex(64, full, 0);
        var independentAdd = computeDecisionForIndex(64, full, 30);
        var blockedAbove50 = computeDecisionForIndex(64, full, 50);
        var heldAboveCap = computeDecisionForIndex(64, full, 80);
        var independentEvidence = getNoviceEvidenceCopy(gateMeta, independentEntry, '未触发离场', '', 'index');

        gateRisk = { score: 30, level: '极端波动风险', coef: 0.25, flags: ['波动过高'], stop: 90, pressure: 110 };
        var riskLimitedEntry = computeDecisionForIndex(64, full, 0);
        gateRisk = { score: 100, level: '低波动/偏离', coef: 1, flags: [], stop: 95, pressure: 110 };

        gateMarket = {
            label: '核心宽基分化',
            cls: 'neutral',
            increaseCaps: null,
            reason: '市场未进入核心宽基偏弱',
            trends: []
        };
        var allowedEntry = computeDecisionForIndex(64, full, 0);

        gateMarket = {
            label: '核心宽基偏弱',
            cls: 'bear',
            increaseCaps: { ordinary: 30, independent: 50 },
            reason: '普通机会新增风险上限30%，标的独立走强上限50%',
            trends: []
        };
        gateRisk = { score: 30, level: '极端波动风险', coef: 0.25, flags: ['波动过高'], stop: 90, pressure: 110 };
        var allowedReduce = computeDecisionForIndex(64, full, 50);
        var allowedReduceSummary = getNoviceDecisionSummary(gateMeta, allowedReduce);

        gateRisk = { score: 100, level: '低波动/偏离', coef: 1, flags: [], stop: 95, pressure: 110 };
        gateMeta = { ...gateMeta, type: '🚪 趋势破位', buySignals: [], exitSignals: ['L4'], allSignals: { L4: { status: true } } };
        gateExit = { level: '强离场', detail: '触发核心破位防守：L4' };
        var allowedExit = computeDecisionForIndex(65, full, 50);
        var allowedExitSummary = getNoviceDecisionSummary(gateMeta, allowedExit);

        gateMeta = { ...gateMeta, type: '✅ 明确转强', buySignals: ['B1'], exitSignals: [], allSignals: { B1: { status: true } } };
        gateExit = { level: '无明确离场', detail: '暂无明确离场依据' };
        gateMarket = { label: '环境未知', cls: 'neutral', increaseCaps: { ordinary: 0, independent: 0 }, reason: '市场温度数据不足', trends: [] };
        var unknownEntry = computeDecisionForIndex(64, full, 0);
        gateMarket = { label: '环境待确认', cls: 'neutral', increaseCaps: { ordinary: 0, independent: 0 }, reason: '三项核心宽基尚未补齐', trends: [] };
        var pendingEntry = computeDecisionForIndex(64, full, 0);
    `, context);

    const result = JSON.parse(vm.runInContext('JSON.stringify({ ordinaryEntry, ordinaryEvidence, independentEntry, independentAdd, blockedAbove50, heldAboveCap, independentEvidence, riskLimitedEntry, allowedEntry, allowedReduce, allowedReduceSummary, allowedExit, allowedExitSummary, unknownEntry, pendingEntry })', context));
    assert.strictEqual(result.ordinaryEntry.position, 30);
    assert.strictEqual(result.ordinaryEntry.bsMark, 'B');
    assert.strictEqual(result.ordinaryEntry.simpleAction, '轻仓建仓');
    assert.strictEqual(result.ordinaryEntry.marketGate.type, 'increase-capped');
    assert.strictEqual(result.ordinaryEntry.marketGate.cap, 30);
    assert.strictEqual(result.ordinaryEntry.marketGate.strengthTier, 'ordinary');
    assert.ok(result.ordinaryEvidence.marketHint.includes('普通机会') && result.ordinaryEvidence.marketHint.includes('30%'), result.ordinaryEvidence.marketHint);

    assert.strictEqual(result.independentEntry.position, 50);
    assert.strictEqual(result.independentEntry.bsMark, 'B');
    assert.strictEqual(result.independentEntry.marketGate.strengthTier, 'independent');
    assert.ok(result.independentEntry.marketGate.reasons.includes('买入积分达标'));
    assert.ok(result.independentEntry.marketGate.reasons.includes('离场检查通过'));
    assert.strictEqual(result.independentAdd.position, 50);
    assert.strictEqual(result.independentAdd.bsMark, null);
    assert.strictEqual(result.independentAdd.simpleAction, '顺势加仓');
    assert.strictEqual(result.blockedAbove50.position, 50);
    assert.strictEqual(result.blockedAbove50.marketGate.type, 'increase-capped');
    assert.strictEqual(result.heldAboveCap.position, 80);
    assert.strictEqual(result.heldAboveCap.marketGate.type, 'open');
    assert.ok(result.independentEvidence.marketHint.includes('指数自身独立走强') && result.independentEvidence.marketHint.includes('50%'), result.independentEvidence.marketHint);

    // 风险评分降到30分也不再覆盖指数自身信号与市场新增上限。
    assert.strictEqual(result.riskLimitedEntry.position, 50);
    assert.strictEqual(result.riskLimitedEntry.bsMark, 'B');
    assert.strictEqual(result.riskLimitedEntry.marketGate.type, 'increase-capped');
    assert.strictEqual(result.riskLimitedEntry.marketGate.cap, 50);

    assert.strictEqual(result.allowedEntry.position, 80);
    assert.strictEqual(result.allowedEntry.bsMark, 'B');
    assert.strictEqual(result.allowedEntry.simpleAction, '积极建仓');

    // 风险评分降到30分不再触发归零，已有50%风险仓位继续按指数信号与市场上限持有。
    assert.strictEqual(result.allowedReduce.position, 50);
    assert.strictEqual(result.allowedReduce.simpleAction, '积极持有');
    assert.strictEqual(result.allowedReduce.bsMark, null);
    assert.ok(!result.allowedReduceSummary.reason.includes('波动过高'), result.allowedReduceSummary.reason);
    assert.ok(!result.allowedReduceSummary.reason.includes('风险系数') && !result.allowedReduceSummary.reason.includes('风险评分'), result.allowedReduceSummary.reason);
    assert.ok(!result.allowedReduceSummary.positionExplanation.includes('风险评分') && !result.allowedReduceSummary.positionExplanation.includes('风险评估'), result.allowedReduceSummary.positionExplanation);
    assert.ok(result.allowedReduceSummary.positionExplanation.includes('最终维持50%'), result.allowedReduceSummary.positionExplanation);

    assert.strictEqual(result.allowedExit.position, 0);
    assert.strictEqual(result.allowedExit.simpleAction, '清仓离场');
    assert.strictEqual(result.allowedExit.bsMark, 'S');
    assert.ok(result.allowedExitSummary.reason.includes('跌破20日线'), result.allowedExitSummary.reason);
    assert.ok(result.allowedExitSummary.positionExplanation.includes('强离场规则要求仓位归零'), result.allowedExitSummary.positionExplanation);
    assert.ok(result.allowedExitSummary.positionExplanation.includes('最终由50%降至0%'), result.allowedExitSummary.positionExplanation);

    assert.strictEqual(result.unknownEntry.position, 0);
    assert.strictEqual(result.pendingEntry.position, 0);
});

runTest('market gate uses only CSI 300, CSI 500 and CSI 1000 majority state', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(dataSource, context);
    vm.runInContext(calcSource, context);
    vm.runInContext(`
        var trendScores = { sh: -1, sz: -1, hs300: 1, zz500: 0, zz1000: -1, cy: -1, kc50: -1, bz50: -1 };
        getIndexTrend = function(id) {
            if (!Object.prototype.hasOwnProperty.call(trendScores, id)) return null;
            var score = trendScores[id];
            return { id, name: getIndexConfig(id).name, score, state: score > 0 ? '多头' : score < 0 ? '空头' : '震荡' };
        };
        var splitCore = getMarketContext('2026-07-21');
        trendScores = { sh: 1, sz: 1, hs300: -1, zz500: -1, zz1000: 1, cy: 1, kc50: 1, bz50: 1 };
        var weakCore = getMarketContext('2026-07-21');
        delete trendScores.zz500;
        var pendingCore = getMarketContext('2026-07-21');
    `, context);
    const result = JSON.parse(vm.runInContext('JSON.stringify({ splitCore, weakCore, pendingCore, coreIds: CORE_MARKET_INDEX_IDS })', context));
    assert.deepStrictEqual(result.coreIds, ['hs300', 'zz500', 'zz1000']);
    assert.strictEqual(result.splitCore.label, '核心宽基分化');
    assert.strictEqual(result.splitCore.increaseCaps, null);
    assert.strictEqual(result.weakCore.label, '核心宽基偏弱');
    assert.deepStrictEqual(result.weakCore.increaseCaps, { ordinary: 30, independent: 50 });
    assert.strictEqual(result.pendingCore.label, '环境待确认');
    assert.deepStrictEqual(result.pendingCore.increaseCaps, { ordinary: 0, independent: 0 });
});

runTest('hydrating non-active indices invalidates stale market-context decisions without rebuilding stock indicators', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(dataSource, context);
    vm.runInContext(calcSource, context);
    vm.runInContext(`
        state.period = 'daily';
        state.mode = 'stock';
        state.id = '1.600519';
        state.stockId = '600519';
        setActiveStrategy('稳健趋势型');
        var stockRows = Array.from({ length: 70 }, function(_, i) {
            var close = 100 + i;
            return {
                date: '2026-06-' + String(i + 1).padStart(2, '0'),
                open: close - 1,
                high: close + 1,
                low: close - 2,
                close,
                vol: 1000 + i,
                amt: 10000 + i
            };
        });
        state.rawData[state.id] = stockRows;
        state.pendingIndicatorMutation = { mode: 'full', startIdx: 0 };
        getSignalMeta = function(idx) {
            var isLatest = idx === 69;
            return {
                type: isLatest ? '✅ 明确转强' : '⏸️ 观察',
                windowScore: isLatest ? STRATEGY.buyThreshold : 0,
                buySignals: isLatest ? ['B1'] : [],
                exitSignals: [],
                warningSignals: [],
                allSignals: isLatest ? { B1: { status: true } } : {},
                windowSignals: isLatest ? [{ day: 69, signal: 'B1' }] : [],
                inCooldown: false,
                daysSinceExit: Infinity
            };
        };
        getRiskContext = function() { return { score: 100, level: '低波动/偏离', coef: 1, flags: [], stop: 95, pressure: 180 }; };
        getExitSeverity = function() { return { level: '无明确离场', detail: '暂无明确离场依据' }; };
        updateAllIndicators();
        var beforeHydration = stockRows[69]._decision;

        var calcCalls = 0;
        var originalMa = Calcs.ma;
        var originalMacd = Calcs.macd;
        var originalRsi = Calcs.rsi;
        var originalKdj = Calcs.kdj;
        Calcs.ma = function(data) { if (data === stockRows) calcCalls++; return originalMa.apply(this, arguments); };
        Calcs.macd = function(data) { if (data === stockRows) calcCalls++; return originalMacd.apply(this, arguments); };
        Calcs.rsi = function(data) { if (data === stockRows) calcCalls++; return originalRsi.apply(this, arguments); };
        Calcs.kdj = function(data) { if (data === stockRows) calcCalls++; return originalKdj.apply(this, arguments); };

        function bullishIndexRows(offset) {
            return Array.from({ length: 70 }, function(_, i) {
                var close = 100 + offset + i;
                return {
                    date: '2026-06-' + String(i + 1).padStart(2, '0'),
                    open: close - 1,
                    high: close + 1,
                    low: close - 2,
                    close,
                    vol: 1000 + i,
                    amt: 10000 + i
                };
            });
        }
        setRawData('sh', bullishIndexRows(0));
        setRawData('sz', bullishIndexRows(100));
        setRawData('cy', bullishIndexRows(200));
        setRawData('kc50', bullishIndexRows(300));
        setRawData('hs300', bullishIndexRows(400));
        setRawData('zz500', bullishIndexRows(500));
        setRawData('zz1000', bullishIndexRows(600));
        mergePendingIndicatorMutation({ mode: 'unchanged', startIdx: -1 });
        var pendingModeAfterHydration = state.pendingIndicatorMutation && state.pendingIndicatorMutation.mode;
        updateAllIndicators();
        var afterHydration = stockRows[69]._decision;
    `, context);

    const result = JSON.parse(vm.runInContext('JSON.stringify({ beforeHydration, afterHydration, pendingModeAfterHydration, calcCalls })', context));
    assert.strictEqual(result.beforeHydration.market.label, '环境未知');
    // 核心宽基已不再限制个股仓位，因此补齐前后个股仓位一致；只有市场背景标签变化。
    assert.strictEqual(result.beforeHydration.position, 80);
    assert.strictEqual(result.pendingModeAfterHydration, 'market-only');
    assert.strictEqual(result.calcCalls, 0);
    assert.strictEqual(result.afterHydration.market.label, '核心宽基偏强');
    assert.strictEqual(result.afterHydration.position, 80);
    assert.strictEqual(result.afterHydration.bsMark, 'B');
});

runTest('stock high-position qualification caps declining and unconfirmed structures without changing index path', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext('function convertDailyToWeekly() { return []; }', context);
    vm.runInContext(calcSource, context);
    vm.runInContext(`
        state.period = 'daily';
        state.mode = 'stock';
        state.indicators = { ma: { 20: [], 60: [] }, macd: null, rsi: null, kdj: null };
        getMarketContext = () => ({ label: '全面多头', cls: 'bull', coef: 1, maxPosition: 80, reason: 'test fixture', trends: [] });
        getRiskContext = () => ({ score: 100, level: '低波动/偏离', coef: 1, flags: [], stop: 95, pressure: 110 });
        getExitSeverity = () => ({ level: '无明确离场', detail: '暂无明确离场依据' });
        var full = Array.from({ length: 70 }, (_, i) => ({ date: '2026-06-' + String(i + 1).padStart(2, '0'), open: 100, high: 102, low: 98, close: 100, vol: 1000 }));
        var meta = { type: '✅ 明确转强', windowScore: 6, buySignals: ['B1'], exitSignals: [], warningSignals: [], allSignals: { B1: { status: true } }, windowSignals: [{ day: 64, signal: 'B1' }], inCooldown: false, daysSinceExit: Infinity };
        getSignalMeta = () => meta;
        function setTrend(close, ma20, ma60, ma20Prev) {
            full[64].close = close;
            state.indicators.ma[20][64] = ma20;
            state.indicators.ma[60][64] = ma60;
            state.indicators.ma[20][59] = ma20Prev;
        }
        setActiveStrategy('稳健趋势型');
        setTrend(95, 100, 110, 105);
        var declining = computeDecisionForIndex(64, full, 0);
        meta.allSignals.W4 = { status: true };
        var decliningHeld = computeDecisionForIndex(64, full, 80);
        setTrend(99, 100, 90, 99);
        var unconfirmed = computeDecisionForIndex(64, full, 0);
        setTrend(110, 100, 90, 99);
        var bullish = computeDecisionForIndex(64, full, 0);
        state.indicators.ma[20][64] = undefined;
        var missingTrend = computeDecisionForIndex(64, full, 0);
        state.mode = 'index';
        setTrend(95, 100, 110, 105);
        var indexPath = computeDecisionForIndex(64, full, 0);
    `, context);
    const result = JSON.parse(vm.runInContext('JSON.stringify({ declining, decliningHeld, unconfirmed, bullish, missingTrend, indexPath })', context));
    assert.strictEqual(result.declining.position, 30);
    assert.strictEqual(result.declining.positionCap.limit, 30);
    assert.ok(result.declining.positionCap.reason.includes('中期下降趋势'));
    assert.strictEqual(result.decliningHeld.position, 30);
    assert.strictEqual(result.decliningHeld.bsMark, null);
    assert.ok(result.decliningHeld.positionCap.reason.includes('W4缩量上涨背离'));
    assert.strictEqual(result.unconfirmed.position, 50);
    assert.strictEqual(result.unconfirmed.positionCap.limit, 50);
    assert.ok(result.unconfirmed.positionCap.reason.includes('完整多头结构'));
    assert.strictEqual(result.bullish.position, 80);
    assert.strictEqual(result.bullish.positionCap, null);
    assert.strictEqual(result.missingTrend.position, 50);
    assert.strictEqual(result.missingTrend.positionCap.limit, 50);
    assert.ok(result.missingTrend.positionCap.reason.includes('数据不足'));
    assert.strictEqual(result.indexPath.position, 80);
    assert.strictEqual(result.indexPath.positionCap, null);
});

runTest('wave strategy uses event-driven 30/50/80 stages instead of moving-average qualification alone', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext('function convertDailyToWeekly() { return []; }', context);
    vm.runInContext(calcSource, context);
    vm.runInContext("getWaveContext = () => ({ inScope: false, regime: 'down' });", context);
    vm.runInContext(`
        state.period = 'daily';
        state.mode = 'stock';
        state.indicators = { ma: { 20: [], 60: [] }, macd: null, rsi: null, kdj: null };
        setActiveStrategy('波段抄底型');
        getMarketContext = () => ({ label: '全面多头', cls: 'bull', coef: 1, maxPosition: 80, reason: 'test fixture', trends: [] });
        getRiskContext = () => ({ score: 100, level: '低波动/偏离', coef: 1, flags: [], stop: 95, pressure: 110 });
        getExitSeverity = () => ({ level: '无明确离场', detail: '暂无明确离场依据' });
        var full = Array.from({ length: 70 }, (_, i) => ({ date: '2026-06-' + String(i + 1).padStart(2, '0'), open: 100, high: 102, low: 98, close: 100, vol: 1000 }));
        var meta = { type: '👀 关注异动', windowScore: 3, buySignals: ['B5'], exitSignals: [], warningSignals: [], allSignals: { B5: { status: true } }, windowSignals: [{ day: 64, signal: 'B5' }], inCooldown: false, daysSinceExit: Infinity };
        getSignalMeta = () => meta;
        function setTrend(close, ma20, ma60, ma20Prev) {
            full[64].close = close;
            state.indicators.ma[20][64] = ma20;
            state.indicators.ma[60][64] = ma60;
            state.indicators.ma[20][59] = ma20Prev;
        }
        setTrend(110, 100, 90, 99);
        var watch = computeDecisionForIndex(64, full, 0);
        meta = { ...meta, type: '✅ 明确转强', windowScore: 4 };
        setTrend(95, 100, 110, 105);
        var declining = computeDecisionForIndex(64, full, 0);
        setTrend(99, 100, 90, 99);
        var repairing = computeDecisionForIndex(64, full, 30);
        setTrend(110, 100, 90, 99);
        var bullish = computeDecisionForIndex(64, full, 50);
    `, context);
    const result = JSON.parse(vm.runInContext('JSON.stringify({ watch, declining, repairing, bullish })', context));
    assert.strictEqual(result.watch.basePosition, 30);
    assert.strictEqual(result.watch.position, 30);
    assert.strictEqual(result.declining.basePosition, 30);
    assert.strictEqual(result.declining.position, 30);
    assert.strictEqual(result.repairing.position, 30);
    assert.strictEqual(result.bullish.position, 50);
    assert.strictEqual(result.bullish.bsMark, null);
});

runTest('wave short moving-average repair releases the declining-trend cap for a confirmed 50 percent hold', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext('function convertDailyToWeekly() { return []; }', context);
    vm.runInContext(calcSource, context);
    vm.runInContext(`
        setActiveStrategy('波段抄底型');
        state.period = 'daily';
        state.mode = 'stock';
        state.indicators = { ma: { 5: [], 20: [], 60: [] }, macd: null, rsi: null, kdj: null };
        var full = Array.from({ length: 70 }, (_, index) => ({
            date: '2026-09-' + String(index + 1).padStart(2, '0'),
            open: 99, high: 102, low: 98, close: 100, vol: 1000, _signals: []
        }));
        full[63]._decision = {
            position: 30,
            waveContext: {
                lifecycle: {
                    active: true, entryDay: 60, entryDate: full[60].date, entryClose: 98,
                    localDefense: 96, hardDefense: 94, entryDefense: 96,
                    entrySignalGroups: ['超跌反弹'], positionLayer: 30
                }
            }
        };
        full[64]._signals = ['B16', 'B20'];
        state.indicators.ma[5][64] = 101;
        state.indicators.ma[20][64] = 100;
        state.indicators.ma[20][63] = 99;
        state.indicators.ma[20][59] = 103;
        state.indicators.ma[60][64] = 105;
        var activeWaveContext = {
            inScope: true, regime: 'down', regimeLabel: '下跌', boxSupport: 98, boxPressure: 110,
            boxMidpoint: 104, positionCap: 30, box: { valid: false, atr14: 1 }, lifecycle: null
        };
        getWaveContext = () => activeWaveContext;
        getMarketContext = () => ({ label: '核心宽基分化', cls: 'neutral', increaseCaps: null, trends: [] });
        getRiskContext = () => ({ score: 100, level: '低波动/偏离', coef: 1, flags: [], stop: 94, pressure: 110 });
        getExitSeverity = () => ({ level: '无明确离场', detail: '暂无明确离场依据' });
        getWaveRejectionProtectionContext = (idx, rows, currentMeta, prevPos, targetPosition) => ({ active: false, status: 'none', targetPosition });
        var meta = {
            type: '⚠️ 谨慎看多', windowScore: 6, buySignals: ['B16', 'B20'], exitSignals: [], warningSignals: [],
            allSignals: { B16: { status: true }, B20: { status: true } },
            windowSignals: [{ day: 64, signal: 'B16' }, { day: 64, signal: 'B20' }],
            windowScoreSignals: [{ day: 64, signal: 'B16', score: 3 }, { day: 64, signal: 'B20', score: 3 }],
            invalidatedWindowSignals: [], localBreakWindowSignals: [], inCooldown: false, daysSinceExit: Infinity
        };
        getSignalMeta = () => meta;
        var repaired = computeDecisionForIndex(64, full, 30);
        var repairedFromFlat = computeDecisionForIndex(64, full, 0);
        full[64]._signals = ['B16'];
        var withoutStructuralPair = computeDecisionForIndex(64, full, 30);
    `, context);
    const result = JSON.parse(vm.runInContext('JSON.stringify({ repaired, repairedFromFlat, withoutStructuralPair })', context));
    assert.strictEqual(result.repaired.waveShortRepair.qualified, true);
    assert.strictEqual(result.repaired.wavePositionStage.stage, 'confirmation');
    assert.strictEqual(result.repaired.position, 50);
    assert.strictEqual(result.repaired.positionCap, null);
    assert.ok(result.repaired.wavePositionStage.reason.includes('MA5/MA20回踩修复共振'));
    assert.ok(result.repairedFromFlat, JSON.stringify(result));
    assert.strictEqual(result.repairedFromFlat.waveShortRepair.qualified, true);
    assert.strictEqual(result.repairedFromFlat.wavePositionStage.stage, 'confirmation');
    assert.strictEqual(result.repairedFromFlat.basePosition, 50);
    assert.strictEqual(result.repairedFromFlat.position, 50);
    assert.strictEqual(result.repairedFromFlat.bsMark, 'B');
    assert.ok(result.repairedFromFlat.waveShortRepair.reason.includes('从0%直接建立'));
    assert.strictEqual(result.withoutStructuralPair.waveShortRepair.qualified, false);
    assert.strictEqual(result.withoutStructuralPair.position, 30);
});

runTest('wave double-bottom breakout waits for a pullback trial while only a fresh trend breakout reaches 80', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext('function convertDailyToWeekly() { return []; }', context);
    vm.runInContext(calcSource, context);
    vm.runInContext("getWaveContext = () => ({ inScope: false, regime: 'down' });", context);
    vm.runInContext(`
        setActiveStrategy('波段抄底型');
        state.period = 'daily';
        state.mode = 'stock';
        state.indicators = { ma: { 20: [], 60: [] }, macd: null, rsi: null, kdj: null };
        var full = Array.from({ length: 70 }, (_, index) => ({
            date: '2026-09-' + String(index + 1).padStart(2, '0'),
            open: 100, high: 102, low: 98, close: 101, vol: 1000, _signals: []
        }));
        state.indicators.ma[20][59] = 103;
        state.indicators.ma[20][63] = 100;
        state.indicators.ma[20][64] = 101;
        state.indicators.ma[60][64] = 105;
        var activeMarket = { label: '环境未知', cls: 'neutral', increaseCaps: { ordinary: 0, independent: 0 }, trends: [] };
        getMarketContext = () => activeMarket;
        getRiskContext = () => ({ score: 100, level: '低波动/偏离', coef: 1, flags: [], stop: 95, pressure: 110 });
        getExitSeverity = () => ({ level: '无明确离场', detail: '暂无明确离场依据' });
        getWaveRejectionProtectionContext = (idx, rows, currentMeta, prevPos, targetPosition) => ({ active: false, status: 'none', targetPosition });
        var meta = {
            type: '👀 关注异动', windowScore: 3, buySignals: ['B19'], exitSignals: [], warningSignals: [],
            allSignals: { B19: { status: true } }, windowSignals: [{ day: 64, signal: 'B19' }],
            windowScoreSignals: [{ day: 64, signal: 'B19', score: 3 }], invalidatedWindowSignals: [],
            localBreakWindowSignals: [], inCooldown: false, daysSinceExit: Infinity
        };
        getSignalMeta = () => meta;
        full[64]._signals = ['B19'];
        var doubleBottomEntry = computeDecisionForIndex(64, full, 0);
        var doubleBottomSummary = getStockDecisionSummary(meta, doubleBottomEntry);
        full[65]._signals = ['B6'];
        full[65].close = 101;
        state.indicators.ma[20][65] = 100;
        state.indicators.ma[60][65] = 105;
        meta = { ...meta, type: '👀 关注异动', windowScore: 3, buySignals: ['B6'], windowSignals: [{ day: 65, signal: 'B6' }], windowScoreSignals: [{ day: 65, signal: 'B6', score: 2 }], allSignals: { B6: { status: true } } };
        var breakoutPullbackEntry = computeDecisionForIndex(65, full, 0);
        var breakoutPullbackSummary = getStockDecisionSummary(meta, breakoutPullbackEntry);

        full[64]._signals = ['B9', 'B17'];
        meta = {
            ...meta, type: '✅ 明确转强', windowScore: 7, buySignals: ['B9', 'B17'],
            allSignals: { B9: { status: true }, B17: { status: true } },
            windowSignals: [{ day: 64, signal: 'B9' }, { day: 64, signal: 'B17' }],
            windowScoreSignals: [{ day: 64, signal: 'B9', score: 4 }, { day: 64, signal: 'B17', score: 3 }]
        };
        var divergenceEntry = computeDecisionForIndex(64, full, 0);

        full[64]._signals = [];
        var historicalReversalOnly = computeDecisionForIndex(64, full, 0);

        activeMarket = { label: '核心宽基分化', cls: 'neutral', increaseCaps: null, trends: [] };
        state.indicators.ma[20][59] = 99;
        state.indicators.ma[20][64] = 101;
        state.indicators.ma[60][64] = 95;
        full[64].close = 110;
        meta = { ...meta, type: '✅ 明确转强', windowScore: 7 };
        var movingAverageOnly = computeDecisionForIndex(64, full, 50);

        full[64]._signals = ['B4'];
        var trendBreakout = computeDecisionForIndex(64, full, 50);
        var trendBreakoutSummary = getStockDecisionSummary(meta, trendBreakout);

        activeMarket = { label: '核心宽基偏弱', cls: 'bear', increaseCaps: { ordinary: 30, independent: 50 }, trends: [] };
        var weakTrendBreakout = computeDecisionForIndex(64, full, 50);
        activeMarket = { label: '环境待确认', cls: 'neutral', increaseCaps: { ordinary: 0, independent: 0 }, trends: [] };
        var pendingTrendBreakout = computeDecisionForIndex(64, full, 50);

        meta = { ...meta, windowScore: 3 };
        var scoreNotReady = computeDecisionForIndex(64, full, 50);

        full[64]._signals = ['B5'];
        meta = {
            ...meta, type: '👀 关注异动', windowScore: 3, buySignals: ['B5'],
            allSignals: { B5: { status: true } }, windowSignals: [{ day: 64, signal: 'B5' }],
            windowScoreSignals: [{ day: 64, signal: 'B5', score: 3 }]
        };
        var pendingTrialEntry = computeDecisionForIndex(64, full, 0);
    `, context);
    const result = JSON.parse(vm.runInContext('JSON.stringify({ doubleBottomEntry, doubleBottomSummary, breakoutPullbackEntry, breakoutPullbackSummary, divergenceEntry, historicalReversalOnly, movingAverageOnly, trendBreakout, trendBreakoutSummary, weakTrendBreakout, pendingTrendBreakout, scoreNotReady, pendingTrialEntry })', context));
    assert.strictEqual(result.doubleBottomEntry.position, 0);
    assert.strictEqual(result.doubleBottomEntry.bsMark, null);
    assert.strictEqual(result.doubleBottomEntry.wavePositionStage.stage, 'breakout-wait');
    assert.strictEqual(result.doubleBottomEntry.wavePositionStage.triggerSignal, 'B19');
    assert.strictEqual(result.doubleBottomEntry.marketGate.type, 'open');
    assert.strictEqual(result.doubleBottomSummary.state, '突破后等回踩');
    assert.strictEqual(result.doubleBottomSummary.positionWhyCode, 'stage-breakout-wait');
    assert.strictEqual(result.breakoutPullbackEntry.position, 30);
    assert.strictEqual(result.breakoutPullbackEntry.bsMark, 'B');
    assert.strictEqual(result.breakoutPullbackEntry.wavePositionStage.stage, 'entry');
    assert.strictEqual(result.breakoutPullbackEntry.wavePositionStage.triggerSignal, 'B6');
    assert.strictEqual(result.breakoutPullbackSummary.state, '回踩试探建仓');
    assert.strictEqual(result.breakoutPullbackSummary.action, '轻仓建仓');
    assert.ok(result.breakoutPullbackSummary.why.includes('低吸试探仓'));
    assert.strictEqual(result.breakoutPullbackSummary.positionWhyCode, 'stage-entry-pullback');
    assert.strictEqual(result.divergenceEntry.position, 50);
    assert.strictEqual(result.divergenceEntry.wavePositionStage.triggerSignal, 'multi-reversal');
    assert.strictEqual(result.divergenceEntry.wavePositionStage.freshGroupCount, 2);
    assert.strictEqual(result.historicalReversalOnly.position, 30);
    assert.strictEqual(result.movingAverageOnly.position, 50);
    assert.strictEqual(result.movingAverageOnly.wavePositionStage.stage, 'confirmation');
    assert.strictEqual(result.trendBreakout.position, 80);
    assert.strictEqual(result.trendBreakout.bsMark, null);
    assert.strictEqual(result.trendBreakout.wavePositionStage.stage, 'trend');
    assert.strictEqual(result.trendBreakout.wavePositionStage.triggerSignal, 'B4');
    assert.strictEqual(result.trendBreakoutSummary.state, '趋势延续加仓');
    assert.strictEqual(result.trendBreakoutSummary.positionWhyCode, 'stage-trend-increase');
    // 核心宽基已不参与个股仓位：偏弱与待确认环境都不再把80%趋势仓封回50%。
    assert.strictEqual(result.weakTrendBreakout.position, 80);
    assert.strictEqual(result.weakTrendBreakout.marketGate.type, 'open');
    assert.strictEqual(result.weakTrendBreakout.marketGate.cap, null);
    assert.strictEqual(result.pendingTrendBreakout.position, 80);
    assert.strictEqual(result.pendingTrendBreakout.marketGate.type, 'open');
    assert.strictEqual(result.scoreNotReady.position, 50);
    assert.strictEqual(result.pendingTrialEntry.position, 30);
    assert.strictEqual(result.pendingTrialEntry.marketGate.type, 'open');
});

runTest('wave B6 trend add raises only a current 30 percent stock hold to 50 percent', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext('function convertDailyToWeekly() { return []; }', context);
    vm.runInContext(calcSource, context);
    vm.runInContext("getWaveContext = () => ({ inScope: false, regime: 'up' });", context);
    vm.runInContext(`
        setActiveStrategy('波段抄底型');
        state.period = 'daily';
        state.mode = 'stock';
        state.indicators = { ma: { 20: [], 60: [] }, macd: null, rsi: null, kdj: null };
        var full = Array.from({ length: 70 }, (_, index) => ({
            date: '2026-08-' + String(index + 1).padStart(2, '0'),
            open: 101.2, high: 102, low: 100.8, close: 101.5, vol: 800, _signals: []
        }));
        full[64]._signals = ['B6'];
        state.indicators.ma[20][59] = 100.5;
        state.indicators.ma[20][63] = 100.9;
        state.indicators.ma[20][64] = 101;
        state.indicators.ma[60][64] = 100;
        var meta = {
            type: '📈 趋势抱单', windowScore: 2, buySignals: [], exitSignals: [], warningSignals: [],
            allSignals: { B6: { status: true } }, windowSignals: [{ day: 64, signal: 'B6' }],
            windowScoreSignals: [{ day: 64, signal: 'B6', score: 2 }], invalidatedWindowSignals: [],
            localBreakWindowSignals: [], inCooldown: false, daysSinceExit: Infinity
        };
        getSignalMeta = () => meta;
        getMarketContext = () => ({ label: '全面多头', cls: 'bull', increaseCaps: null, trends: [] });
        getRiskContext = () => ({ score: 100, level: '低波动/偏离', coef: 1, flags: [], stop: 98, pressure: 105 });
        getExitSeverity = () => ({ level: '无明确离场', detail: '暂无明确离场依据' });
        getWaveRejectionProtectionContext = (idx, rows, currentMeta, prevPos, targetPosition) => ({ active: false, status: 'none', targetPosition });

        var currentB6 = computeDecisionForIndex(64, full, 30);
        var currentB6Summary = getStockDecisionSummary(meta, currentB6);

        full[64]._signals = [];
        meta = { ...meta, allSignals: {}, windowSignals: [], windowScoreSignals: [] };
        var trendOnly = computeDecisionForIndex(64, full, 30);

        meta = {
            ...meta,
            allSignals: { B6: { status: true } },
            windowSignals: [{ day: 62, signal: 'B6' }],
            windowScoreSignals: [{ day: 62, signal: 'B6', score: 2 }]
        };
        var historicalB6 = computeDecisionForIndex(64, full, 30);

        full[64]._signals = ['B6'];
        state.indicators.ma[20][63] = 101.1;
        var fallingMa20 = computeDecisionForIndex(64, full, 30);

        state.indicators.ma[20][63] = 100.9;
        getRiskContext = () => ({ score: 50, level: '高偏离风险', coef: 1, flags: [], stop: 98, pressure: 105 });
        var riskLimited = computeDecisionForIndex(64, full, 30);

        getRiskContext = () => ({ score: 100, level: '低波动/偏离', coef: 1, flags: [], stop: 98, pressure: 105 });
        meta = { ...meta, type: '✅ 明确转强', windowScore: 4 };
        var scoreReady = computeDecisionForIndex(64, full, 50);

        meta = { ...meta, type: '📈 趋势抱单', windowScore: 2 };
        state.mode = 'index';
        var indexPath = computeDecisionForIndex(64, full, 30);
        state.mode = 'stock';
        setActiveStrategy('稳健趋势型');
        var otherStrategy = computeDecisionForIndex(64, full, 30);
    `, context);
    const result = JSON.parse(vm.runInContext('JSON.stringify({ currentB6, currentB6Summary, trendOnly, historicalB6, fallingMa20, riskLimited, scoreReady, indexPath, otherStrategy })', context));
    assert.strictEqual(result.currentB6.position, 50);
    assert.strictEqual(result.currentB6.prevAdv, 30);
    assert.strictEqual(result.currentB6.bsMark, null);
    assert.strictEqual(result.currentB6.waveB6TrendAdd.eligible, true);
    assert.strictEqual(result.currentB6.waveB6TrendAdd.applied, true);
    assert.strictEqual(result.currentB6Summary.state, '趋势修复加仓');
    assert.ok(result.currentB6Summary.why.includes('今日缩量回踩20日线后收回'));
    assert.ok(!result.currentB6Summary.why.includes('重新站回20日线'));
    assert.strictEqual(result.currentB6Summary.positionWhyCode, 'b6-trend-add');
    assert.strictEqual(result.trendOnly.position, 30);
    assert.strictEqual(result.trendOnly.waveB6TrendAdd.eligible, false);
    assert.strictEqual(result.historicalB6.position, 30);
    assert.strictEqual(result.historicalB6.waveB6TrendAdd.eligible, false);
    assert.strictEqual(result.fallingMa20.position, 30);
    assert.strictEqual(result.fallingMa20.waveB6TrendAdd.eligible, false);
    assert.strictEqual(result.riskLimited.position, 50);
    assert.strictEqual(result.riskLimited.waveB6TrendAdd.eligible, true);
    assert.strictEqual(result.riskLimited.waveB6TrendAdd.applied, true);
    assert.strictEqual(result.scoreReady.position, 50);
    assert.strictEqual(result.scoreReady.waveB6TrendAdd.eligible, false);
    assert.strictEqual(result.indexPath.position, 50);
    assert.strictEqual(result.indexPath.waveB6TrendAdd.eligible, false);
    assert.strictEqual(result.otherStrategy.position, 50);
    assert.strictEqual(result.otherStrategy.waveB6TrendAdd.eligible, false);
});

runTest('real Yilite fixture recovers on fresh multi-group signals under wave regime governance', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(dataSource, context);
    vm.runInContext(calcSource, context);
    context.__yiliteRows = readJsonFixture('.local/strategy-cache/stock_600197_1_600197_101_fqt1_lmt1000.json');
    context.__coreRows = {
        hs300: readJsonFixture('.local/strategy-cache/index_hs300_1_000300_101_fqt1_lmt1000.json'),
        zz500: readJsonFixture('.local/strategy-cache/index_zz500_1_000905_101_fqt1_lmt1000.json'),
        zz1000: readJsonFixture('.local/strategy-cache/index_zz1000_1_000852_101_fqt1_lmt1000.json')
    };
    vm.runInContext(`
        setActiveStrategy('波段抄底型');
        state.mode = 'stock';
        state.period = 'daily';
        state.id = '600197';
        state.stockId = '600197';
        state.rawData = {
            '600197': __yiliteRows.map(row => ({ ...row })),
            hs300: __coreRows.hs300.map(row => ({ ...row })),
            zz500: __coreRows.zz500.map(row => ({ ...row })),
            zz1000: __coreRows.zz1000.map(row => ({ ...row }))
        };
        state.weeklyData = {};
        resetIndicatorState();
        derivedIndicatorCache.clear();
        dateIndexCache.clear();
        updateAllIndicators();
        var yiliteFull = state.rawData['600197'];
        var yiliteJuneIdx = findDateIndex(yiliteFull, '2026-06-29', '600197');
        var yiliteJuneRow = yiliteFull[yiliteJuneIdx];
        var yiliteJuneMeta = getSignalMeta(yiliteJuneIdx, yiliteFull, state.indicators);
        var yiliteJuneDecision = yiliteJuneRow._decision;
        var yiliteJuneSummary = getStockDecisionSummary(yiliteJuneMeta, yiliteJuneDecision);
    `, context);
    const result = JSON.parse(vm.runInContext(`JSON.stringify({
        juneRecovery: {
            date: yiliteJuneRow.date,
            signals: yiliteJuneRow._signals,
            windowScore: yiliteJuneMeta.windowScore,
            position: yiliteJuneDecision.position,
            prevAdv: yiliteJuneDecision.prevAdv,
            bsMark: yiliteJuneDecision.bsMark,
            protection: yiliteJuneDecision.waveRejectionProtection,
            waveContext: yiliteJuneDecision.waveContext,
            positionDriver: yiliteJuneDecision.positionDriver,
            summary: yiliteJuneSummary
        }
    })`, context));
    assert.strictEqual(result.juneRecovery.windowScore, 8, JSON.stringify(result.juneRecovery, null, 2));
    assert.deepStrictEqual(result.juneRecovery.signals, ['B8', 'B9', 'B16']);
    assert.strictEqual(result.juneRecovery.position, 30, JSON.stringify(result.juneRecovery, null, 2));
    assert.strictEqual(result.juneRecovery.prevAdv, 0);
    assert.strictEqual(result.juneRecovery.bsMark, 'B');
    assert.strictEqual(result.juneRecovery.protection.status, 'released');
    assert.strictEqual(result.juneRecovery.protection.strongFreshRecovery, true);
    assert.strictEqual(result.juneRecovery.protection.postEventScore, 8);
    assert.strictEqual(result.juneRecovery.protection.postEventScoreSignals.length, 3);
    assert.strictEqual(result.juneRecovery.waveContext.supportSource, 'event-recovery-signal-low');
    assert.ok(Number.isFinite(result.juneRecovery.waveContext.frozenHardDefense));
    assert.strictEqual(result.juneRecovery.summary.state, '风险解除');
    assert.strictEqual(result.juneRecovery.summary.action, '轻仓建仓');
    assert.ok(result.juneRecovery.summary.why.includes('新积分已达到8/4'));
});

runTest('four formal strategies share the decision and B/S contract while keeping their configured focus', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext('function convertDailyToWeekly() { return []; }', context);
    vm.runInContext(calcSource, context);
    vm.runInContext(`
        state.period = 'daily';
        state.indicators = { ma: { 20: [], 60: [] }, macd: null, rsi: null, kdj: null };
        getMarketContext = () => ({ label: '全面多头', cls: 'bull', coef: 1, maxPosition: 80, reason: 'test fixture', trends: [] });
        getRiskContext = () => ({ score: 100, level: '低波动/偏离', coef: 1, flags: [], stop: 95, pressure: 110 });
        var full = Array.from({ length: 70 }, (_, i) => ({ date: '2026-06-' + String(i + 1).padStart(2, '0'), open: 100, high: 102, low: 98, close: 100, vol: 1000 }));
        full[64].close = 110;
        state.indicators.ma[20][59] = 99;
        state.indicators.ma[20][64] = 100;
        state.indicators.ma[60][64] = 90;
        var contractCases = [
            { strategy: '稳健趋势型', buy: 'B1', exit: 'L3', expectedPosition: 80 },
            { strategy: '波段抄底型', buy: 'B5', exit: 'L3', expectedPosition: 80 },
            { strategy: '突破追涨型', buy: 'B4', exit: 'L4', expectedPosition: 80 },
            { strategy: '综合全能型', buy: 'B1', exit: 'L3', expectedPosition: 80 }
        ];
        var phase = 'entry';
        var activeCase = null;
        getSignalMeta = function() {
            var isExit = phase === 'exit';
            return {
                type: isExit ? '🚪 趋势破位' : '✅ 明确转强',
                windowScore: STRATEGY.buyThreshold,
                buySignals: isExit ? [] : [activeCase.buy],
                exitSignals: isExit ? [activeCase.exit] : [],
                warningSignals: [],
                allSignals: isExit ? { [activeCase.exit]: { status: true } } : { [activeCase.buy]: { status: true } },
                windowSignals: isExit ? [{ day: 65, signal: activeCase.exit }] : [{ day: 64, signal: activeCase.buy }],
                inCooldown: false,
                daysSinceExit: Infinity
            };
        };
        var contractResults = contractCases.map(item => {
            activeCase = item;
            setActiveStrategy(item.strategy);
            phase = 'entry';
            var entry = computeDecisionForIndex(64, full, 0);
            var hold = computeDecisionForIndex(64, full, entry.position);
            phase = 'exit';
            var exit = computeDecisionForIndex(65, full, entry.position);
            var summary = getNoviceDecisionSummary(getSignalMeta(), exit);
            return {
                strategy: item.strategy,
                exitSignal: item.exit,
                expectedPosition: item.expectedPosition,
                entry: { position: entry.position, bsMark: entry.bsMark, action: entry.simpleAction, color: entry.simpleColorClass },
                hold: { position: hold.position, bsMark: hold.bsMark },
                exit: { position: exit.position, bsMark: exit.bsMark, action: exit.simpleAction, color: exit.simpleColorClass },
                summary
            };
        });
    `, context);

    const results = JSON.parse(JSON.stringify(vm.runInContext('contractResults', context)));
    assert.deepStrictEqual(results.map(item => item.strategy), ['稳健趋势型', '波段抄底型', '突破追涨型', '综合全能型']);
    for (const result of results) {
        assert.strictEqual(result.entry.position, result.expectedPosition);
        assert.strictEqual(result.entry.bsMark, 'B');
        assert.ok(['轻仓建仓', '积极建仓'].includes(result.entry.action));
        assert.ok(['text-info', 'text-bull'].includes(result.entry.color));
        assert.strictEqual(result.hold.bsMark, null);
        if (result.strategy === '波段抄底型') {
            assert.strictEqual(result.exit.position, 30);
            assert.strictEqual(result.exit.bsMark, null);
            assert.strictEqual(result.exit.action, '防守减仓');
            assert.strictEqual(result.exit.color, 'text-warn');
            assert.strictEqual(result.summary.positionText, '30%');
            assert.ok(result.summary.reason.includes('MACD死叉'), result.summary.reason);
            assert.ok(!result.summary.reason.includes('冷静期'), result.summary.reason);
            continue;
        }
        assert.strictEqual(result.exit.position, 0);
        assert.strictEqual(result.exit.bsMark, 'S');
        assert.strictEqual(result.exit.action, '清仓离场');
        assert.strictEqual(result.exit.color, 'text-bear');
        assert.ok(result.summary.state);
        assert.ok(result.summary.action);
        assert.strictEqual(result.summary.positionText, '0%');
        assert.ok(result.summary.why);
        assert.ok(result.summary.positionWhy);
        assert.ok(result.summary.nextFocus);
        assert.ok(result.summary.reason.includes(vm.runInContext(`getUserSignalText('${result.exitSignal}')`, context)), result.summary.reason);
        assert.ok(!result.summary.reason.includes(result.exitSignal), result.summary.reason);
        assert.ok(result.summary.reason.includes(`当前从${result.expectedPosition}%降至 0%`), result.summary.reason);
        assert.ok(result.summary.reason.includes('冷静期'), result.summary.reason);
        assert.ok(result.summary.invalidCondition);
        assert.ok(!/\b[BLW]\d+\b/.test(`${result.summary.why} ${result.summary.positionWhy} ${result.summary.nextFocus}`));
        assert.ok(!`${result.summary.why} ${result.summary.positionWhy}`.includes('风险系数'));
    }
    assert.ok(results.filter(item => item.strategy !== '波段抄底型').every(item => item.summary.state === '破位防守'));
    assert.ok(results.every(item => !item.summary.reason.includes('归零原因：白胖')));
});

runTest('four formal strategies explain score-driven S points before showing an empty position', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext('function convertDailyToWeekly() { return []; }', context);
    vm.runInContext(calcSource, context);
    vm.runInContext(`
        state.period = 'daily';
        state.indicators = { ma: {}, macd: null, rsi: null, kdj: null };
        getMarketContext = () => ({ label: '震荡分化', cls: 'neutral', coef: 1, maxPosition: 80, reason: 'test fixture', trends: [] });
        getRiskContext = () => ({ score: 100, level: '低波动/偏离', coef: 1, flags: [], stop: 95, pressure: 110 });
        var full = Array.from({ length: 70 }, (_, i) => ({ date: '2026-06-' + String(i + 1).padStart(2, '0'), open: 100, high: 102, low: 98, close: 100, vol: 1000 }));
        var emptyExitCases = Object.keys(STRATEGIES).map(strategy => {
            setActiveStrategy(strategy);
            var meta = {
                type: '👀 弱势震荡',
                windowScore: 0,
                buySignals: [],
                exitSignals: [],
                warningSignals: [],
                allSignals: {},
                windowSignals: [],
                inCooldown: false,
                daysSinceExit: Infinity
            };
            getSignalMeta = () => meta;
            var decision = computeDecisionForIndex(65, full, 80);
            var summary = getNoviceDecisionSummary(meta, decision);
            return { strategy, threshold: STRATEGY.buyThreshold, decision, summary };
        });
    `, context);

    const results = JSON.parse(vm.runInContext('JSON.stringify(emptyExitCases)', context));
    assert.deepStrictEqual(results.map(item => item.strategy), ['稳健趋势型', '波段抄底型', '突破追涨型', '综合全能型']);
    for (const result of results) {
        assert.strictEqual(result.decision.position, 0);
        assert.strictEqual(result.decision.bsMark, 'S');
        assert.strictEqual(result.decision.simpleAction, '执行离场');
        assert.strictEqual(result.summary.positionText, '0%');
        assert.ok(result.summary.reason.includes('此前持仓依赖的买入信号已失效'), result.summary.reason);
        assert.ok(result.summary.reason.includes(`买入积分降为 0/${result.threshold}`), result.summary.reason);
        assert.ok(result.summary.reason.includes('当前从80%降至 0%'), result.summary.reason);
        assert.ok(result.summary.reason.includes('先空仓观察'), result.summary.reason);
    }
});

runTest('four formal strategies name ordinary exit signals when they accompany an S point', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext('function convertDailyToWeekly() { return []; }', context);
    vm.runInContext(calcSource, context);
    vm.runInContext(`
        state.period = 'daily';
        state.indicators = { ma: {}, macd: null, rsi: null, kdj: null };
        getMarketContext = () => ({ label: '震荡分化', cls: 'neutral', coef: 1, maxPosition: 80, reason: 'test fixture', trends: [] });
        getRiskContext = () => ({ score: 100, level: '低波动/偏离', coef: 1, flags: [], stop: 95, pressure: 110 });
        var full = Array.from({ length: 70 }, (_, i) => ({ date: '2026-06-' + String(i + 1).padStart(2, '0'), open: 100, high: 102, low: 98, close: 100, vol: 1000 }));
        var ordinaryExitFixtures = [
            { strategy: '稳健趋势型', exitSignal: 'L1' },
            { strategy: '波段抄底型', exitSignal: 'L5' },
            { strategy: '突破追涨型', exitSignal: 'L6' },
            { strategy: '综合全能型', exitSignal: 'L1' }
        ];
        var ordinaryExitCases = ordinaryExitFixtures.map(item => {
            setActiveStrategy(item.strategy);
            var meta = {
                type: '👀 弱势震荡',
                windowScore: 0,
                buySignals: [],
                exitSignals: [item.exitSignal],
                warningSignals: [],
                allSignals: { [item.exitSignal]: { status: true } },
                windowSignals: [{ day: 65, signal: item.exitSignal }],
                inCooldown: false,
                daysSinceExit: Infinity
            };
            getSignalMeta = () => meta;
            var decision = computeDecisionForIndex(65, full, 80);
            var summary = getNoviceDecisionSummary(meta, decision);
            return { ...item, exitText: getUserSignalText(item.exitSignal), decision, summary };
        });
    `, context);

    const results = JSON.parse(vm.runInContext('JSON.stringify(ordinaryExitCases)', context));
    assert.deepStrictEqual(results.map(item => item.strategy), ['稳健趋势型', '波段抄底型', '突破追涨型', '综合全能型']);
    for (const result of results) {
        assert.strictEqual(result.decision.exit.level, '减仓观察');
        assert.strictEqual(result.decision.position, 0);
        assert.strictEqual(result.decision.bsMark, 'S');
        assert.ok(result.summary.reason.includes(result.exitText), result.summary.reason);
        assert.ok(!result.summary.reason.includes(result.exitSignal), result.summary.reason);
        assert.ok(result.summary.reason.includes('当前按减仓观察处理'), result.summary.reason);
        assert.ok(result.summary.reason.includes('当前从80%降至 0%'), result.summary.reason);
        assert.ok(result.summary.reason.includes('先空仓防守'), result.summary.reason);
    }
});

runTest('strategy baseline snapshots pin production decisions for fixed cached samples', () => {
    const { context, snapshots } = setupBaselineSnapshotContext();
    vm.runInContext('var baselineResults = __baselineSnapshots.samples.map(summarizeLoadedBaselineSample);', context);
    const baselineResults = JSON.parse(JSON.stringify(vm.runInContext('baselineResults', context)));
    assert.deepStrictEqual(baselineResults, snapshots.samples.map(sample => sample.expected));
});

runTest('right panel copy explains state action risk and invalidation for baseline samples', () => {
    assert.ok(productGuideSource.includes('快照样本联动校验'), 'product guide must require snapshot-based right panel copy checks');
    const { context, snapshots } = setupBaselineSnapshotContext({ includeRender: true });
    vm.runInContext(`
        function textFromHtml(html) {
            return String(html || '').replace(/<[^>]*>/g, ' ').replace(/\\s+/g, ' ').trim();
        }
        var rightPanelCopyResults = __baselineSnapshots.samples.map(sample => {
            const loaded = loadBaselineSample(sample);
            const html = generateAnalysisHTML(loaded.idx, loaded.full, loaded.meta);
            const text = textFromHtml(html);
            const shortStrategy = ({
                '稳健趋势型': '稳健',
                '波段抄底型': '波段',
                '突破追涨型': '突破',
                '综合全能型': '综合'
            })[sample.strategy];
            return {
                key: sample.key,
                hasDailyConclusion: text.includes(state.mode === 'index' ? '大盘每日结论' : '个股每日结论'),
                hasStrategyLabel: text.includes('（' + shortStrategy + '）'),
                hasAction: state.mode === 'index'
                    ? (text.includes('增加风险') || text.includes('维持当前风险仓位') || text.includes('降低风险暴露') || text.includes('保持低风险暴露'))
                    : (text.includes(sample.expected.simpleAction) || text.includes('暂时不买') || text.includes('离场观察') || text.includes('先不碰') || text.includes('继续持有') || text.includes('提高仓位')),
                hasPosition: text.includes(state.mode === 'index' ? '当前风险仓位' : '策略参考仓位') && text.includes(String(sample.expected.position) + '%'),
                // 风险评分已退出正式展示；右侧只保留结构/离场防守依据。
                hasDefense: text.includes(state.mode === 'index' ? '市场防守：' : '防守依据：')
                    && (text.includes(sample.expected.exitLevel) || text.includes('防守观察') || text.includes('暂无额外风险压制')),
                hasInvalidCondition: text.includes('接下来关注：') && (text.includes('买入积分') || text.includes('防守位') || text.includes('离场信号')),
                hasEvidence: text.includes('关键推导依据') && text.includes(state.mode === 'index' ? '核心宽基环境' : '市场背景') && (text.includes(state.mode === 'index' ? '指数自身动能' : '个股信号')),
                hasNoviceWhy: state.mode === 'index' ? (text.includes('动能依据') || text.includes('维持依据') || text.includes('动能不足') || text.includes('观察依据')) : (text.includes('买入依据') || text.includes('持仓依据') || text.includes('未买入原因') || text.includes('观察依据')),
                hasGuardAction: state.mode === 'index' ? text.includes('市场防守：') : text.includes('防守依据：'),
                hasNoRiskScore: !text.includes('风险评分') && !text.includes('风险状况') && !text.includes('风险最高允许'),
                hasNoAdviceLeak: !text.includes('必涨') && !text.includes('稳赚') && !text.includes('抄底成功')
            };
        });
    `, context);
    const results = JSON.parse(JSON.stringify(vm.runInContext('rightPanelCopyResults', context)));
    assert.deepStrictEqual(results.map(item => item.key), snapshots.samples.map(sample => sample.key));
    for (const result of results) {
        assert.deepStrictEqual(result, {
            key: result.key,
            hasDailyConclusion: true,
            hasStrategyLabel: true,
            hasAction: true,
            hasPosition: true,
            hasDefense: true,
            hasInvalidCondition: true,
            hasEvidence: true,
            hasNoviceWhy: true,
            hasGuardAction: true,
            hasNoRiskScore: true,
            hasNoAdviceLeak: true
        });
    }
});

runTest('novice summary translates the existing decision without changing position or B/S', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext('function convertDailyToWeekly() { return []; }', context);
    vm.runInContext(calcSource, context);
    vm.runInContext(`
        Object.assign(STRATEGY, STRATEGIES['稳健趋势型']);
        state.strategy = '稳健趋势型';
        var meta = {
            type: '✅ 明确转强',
            windowScore: 6,
            buySignals: ['B1', 'B2'],
            exitSignals: [],
            warningSignals: [],
            inCooldown: false
        };
        var decision = {
            position: 80,
            prevAdv: 0,
            bsMark: 'B',
            simpleAction: '积极建仓',
            market: { label: '温和偏多', reason: '部分指数走强' },
            risk: { level: '中等波动/偏离', score: 70, flags: [], stop: 96, pressure: 112 },
            exit: { level: '无明确离场', detail: '暂未看到需要立即防守的核心离场信号' },
            positionDriver: '基础 80%，市场系数 1.00，调整至 80%。'
        };
        var before = { position: decision.position, bsMark: decision.bsMark };
        var summary = getNoviceDecisionSummary(meta, decision);
        var after = { position: decision.position, bsMark: decision.bsMark };
    `, context);
    assert.deepStrictEqual(vm.runInContext('after', context), vm.runInContext('before', context));
    assert.strictEqual(vm.runInContext('summary.state', context), '趋势转强');
    assert.strictEqual(vm.runInContext('summary.action', context), '提高仓位');
    assert.strictEqual(vm.runInContext('summary.positionText', context), '80%');
    assert.ok(vm.runInContext('summary.reason.includes("买入积分") && summary.reason.includes("均线多头")', context));
    assert.ok(vm.runInContext('summary.invalidCondition.includes("防守位96.00")', context));
    assert.ok(vm.runInContext('summary.invalidCondition.includes("离场信号")', context));
    assert.ok(vm.runInContext('summary.invalidCondition.includes("降低仓位或离场")', context));
});

runTest('stock position increase conclusion states the concrete driver and permitted path', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext('function convertDailyToWeekly() { return []; }', context);
    vm.runInContext(calcSource, context);
    vm.runInContext(`
        Object.assign(STRATEGY, STRATEGIES['稳健趋势型']);
        state.strategy = '稳健趋势型';
        var meta = {
            type: '✅ 明确转强',
            windowScore: 6,
            buySignals: ['B1', 'B2'],
            exitSignals: [],
            warningSignals: [],
            inCooldown: false
        };
        var decision = {
            position: 80,
            prevAdv: 30,
            basePosition: 80,
            bsMark: null,
            simpleAction: '顺势加仓',
            market: { label: '温和偏多', reason: '部分指数走强' },
            marketGate: { type: 'open', cap: null },
            risk: { level: '低波动/偏离', coef: 1, score: 85, flags: [], stop: 96, pressure: 112 },
            exit: { level: '无明确离场', detail: '暂未看到需要立即防守的核心离场信号' }
        };
        var summary = getNoviceDecisionSummary(meta, decision);
        var riskLimitedSummary = getNoviceDecisionSummary(meta, {
            ...decision,
            position: 50,
            risk: { ...decision.risk, coef: 0.75, score: 70, flags: ['短线偏热'], distMA20: 0.091 }
        });
        var marketLimitedSummary = getNoviceDecisionSummary(meta, {
            ...decision,
            position: 50,
            marketGate: { type: 'increase-capped', cap: 50, strengthTier: 'independent' }
        }, 'index');
        var drawdownLimitedSummary = getNoviceDecisionSummary(meta, {
            ...decision,
            position: 50,
            risk: { ...decision.risk, coef: 0.75, score: 70, flags: ['回撤较深'], drawdown: 0.1214 }
        });
    `, context);
    const reason = vm.runInContext('summary.reason', context);
    assert.ok(reason.includes('均线多头'), reason);
    assert.ok(reason.includes('买入积分达到 6/5'), reason);
    assert.ok(reason.includes('满足继续增加仓位条件'), reason);
    assert.ok(vm.runInContext('summary.positionExplanation.includes("基础仓位为80%")', context));
    // 风险评估没有压低 80% 时不写任何风险句，只保留驱动说明。
    assert.ok(vm.runInContext('!summary.positionExplanation.includes("风险评估")', context));
    assert.ok(vm.runInContext('summary.positionExplanation.includes("本次提高仓位由个股信号与趋势决定")', context));
    assert.ok(vm.runInContext('!summary.positionExplanation.includes("null%")', context));
    assert.ok(vm.runInContext('summary.positionExplanation.includes("最终由30%提高至80%")', context));
    assert.ok(vm.runInContext('!riskLimitedSummary.positionExplanation.includes("风险评分") && !riskLimitedSummary.positionExplanation.includes("风险评估") && !riskLimitedSummary.positionExplanation.includes("风险系数")', context));
    assert.ok(vm.runInContext('riskLimitedSummary.positionExplanation.includes("本次提高仓位由个股信号与趋势决定")', context));
    assert.ok(vm.runInContext('riskLimitedSummary.positionExplanation.includes("最终由30%提高至50%")', context));
    assert.ok(vm.runInContext('marketLimitedSummary.positionExplanation.includes("核心宽基偏弱时，指数自身独立走强新增风险上限为50%")', context));
    assert.strictEqual(vm.runInContext('drawdownLimitedSummary.state', context), '趋势转强');
    assert.ok(vm.runInContext('!drawdownLimitedSummary.positionExplanation.includes("近20日高点回撤") && !drawdownLimitedSummary.positionExplanation.includes("风险评分")', context));
    assert.ok(vm.runInContext('drawdownLimitedSummary.positionExplanation.includes("本次提高仓位由个股信号与趋势决定")', context));
});

runTest('stock position changes explain reduce, entry, exit and their final position tiers', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext('function convertDailyToWeekly() { return []; }', context);
    vm.runInContext(calcSource, context);
    vm.runInContext(`
        Object.assign(STRATEGY, STRATEGIES['稳健趋势型']);
        state.strategy = '稳健趋势型';
        var baseMeta = {
            type: '✅ 明确转强',
            windowScore: 6,
            buySignals: ['B1', 'B2'],
            exitSignals: [],
            warningSignals: [],
            inCooldown: false
        };
        var baseDecision = {
            position: 80,
            prevAdv: 30,
            basePosition: 80,
            bsMark: null,
            simpleAction: '顺势加仓',
            market: { label: '核心宽基分化', reason: '按标的自身信号决定' },
            marketGate: { type: 'open' },
            risk: { level: '低波动/偏离', coef: 1, score: 85, flags: [], stop: 96, pressure: 112 },
            exit: { level: '无明确离场', detail: '暂未看到需要立即防守的核心离场信号' }
        };
        var warningMeta = { ...baseMeta, warningSignals: ['W1'] };
        var warningReduce = getNoviceDecisionSummary(warningMeta, {
            ...baseDecision,
            position: 30,
            prevAdv: 80,
            simpleAction: '防守减仓',
            exit: { level: '减仓观察', detail: '短线转弱或过热，适合降低仓位等待确认' }
        });
        var w4Reduce = getNoviceDecisionSummary(baseMeta, {
            ...baseDecision,
            position: 50,
            prevAdv: 80,
            simpleAction: '防守减仓',
            positionCap: { limit: 50, reason: 'W4缩量上涨背离，高仓位上限50%' }
        });
        var riskEntry = getNoviceDecisionSummary(baseMeta, {
            ...baseDecision,
            position: 30,
            prevAdv: 0,
            simpleAction: '轻仓建仓',
            bsMark: 'B',
            risk: { ...baseDecision.risk, coef: 0.5, score: 52, flags: ['回撤较深'], drawdown: 0.132 }
        });
        var strongExitMeta = { ...baseMeta, windowScore: 0, buySignals: [], exitSignals: ['L4'] };
        var strongExit = getNoviceDecisionSummary(strongExitMeta, {
            ...baseDecision,
            position: 0,
            prevAdv: 30,
            basePosition: 0,
            simpleAction: '清仓离场',
            bsMark: 'S',
            exit: { level: '强离场', detail: '触发核心破位防守：跌破20日线' }
        });
    `, context);

    const warningReason = vm.runInContext('warningReduce.reason', context);
    assert.ok(warningReason.includes('偏离均线过大预警'), warningReason);
    assert.ok(!warningReason.includes('暂未看到需要立即防守'), warningReason);
    assert.ok(vm.runInContext('warningReduce.positionExplanation.includes("仓位防守上限为30%")', context));
    assert.ok(vm.runInContext('warningReduce.positionExplanation.includes("最终由80%降至30%")', context));
    assert.ok(vm.runInContext('w4Reduce.reason.includes("上涨动能减弱")', context));
    assert.ok(vm.runInContext('!w4Reduce.reason.includes("W4")', context));
    assert.ok(vm.runInContext('w4Reduce.positionExplanation.includes("仓位上限50%")', context));
    assert.ok(vm.runInContext('w4Reduce.positionExplanation.includes("最终由80%降至50%")', context));
    assert.ok(vm.runInContext('riskEntry.reason.includes("均线多头")', context));
    assert.ok(vm.runInContext('!riskEntry.positionExplanation.includes("近20日高点回撤") && !riskEntry.positionExplanation.includes("风险评分") && !riskEntry.positionExplanation.includes("风险评估")', context));
    assert.ok(vm.runInContext('riskEntry.positionExplanation.includes("本次提高仓位由个股信号与趋势决定")', context));
    assert.ok(vm.runInContext('riskEntry.positionExplanation.includes("最终由空仓转为30%")', context));
    assert.ok(vm.runInContext('strongExit.reason.includes("跌破20日线") && !strongExit.reason.includes("L4")', context));
    assert.ok(vm.runInContext('strongExit.positionExplanation.includes("强离场规则要求仓位归零")', context));
    assert.ok(vm.runInContext('strongExit.positionExplanation.includes("最终由30%降至0%")', context));
});

runTest('ETF wave structure exit explains the frozen defense break and keeps three-decimal prices', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(dataSource, context);
    vm.runInContext(calcSource, context);
    vm.runInContext(`
        setActiveStrategy('波段抄底型');
        state.mode = 'stock';
        state.id = '1.588730';
        state.stockId = '588730';
        state.watchlist = [];
        var meta = {
            currentDay: 0,
            type: '👀 关注异动',
            windowScore: 4,
            buySignals: ['B16'],
            exitSignals: [],
            warningSignals: [],
            windowSignals: [{ day: 0, signal: 'B16' }],
            windowScoreSignals: [{ day: 0, signal: 'B16', score: 3 }],
            invalidatedWindowSignals: [],
            localBreakWindowSignals: [],
            allSignals: {},
            inCooldown: false
        };
        var decision = {
            position: 0,
            prevAdv: 30,
            // B16 单独只有 3 分，基础仓位可能已归零；结构离场原因仍必须覆盖该兜底路径。
            basePosition: 0,
            bsMark: 'S',
            simpleAction: '执行离场',
            signalReady: true,
            risk: { stop: 1.365 },
            exit: { level: '无明确离场', detail: '暂未看到需要立即防守的核心离场信号' },
            waveContext: {
                inScope: true,
                mainEvent: '收盘跌破冻结硬防守位1.365，结构失效归零',
                nextCondition: '等待环境转为横盘或上涨后再申请50%'
            },
            waveRejectionProtection: { status: 'none', active: false }
        };
        var summary = getStockDecisionSummary(meta, decision);
        var invalidCondition = getStockInvalidCondition(meta, decision, 0, false);
        var precision = formatPriceLevel(1.365);
    `, context);
    const result = JSON.parse(vm.runInContext('JSON.stringify({ summary, invalidCondition, precision })', context));
    assert.strictEqual(result.precision, '1.365');
    assert.ok(result.summary.why.includes('收盘跌破冻结硬防守位1.365'), result.summary.why);
    assert.ok(result.summary.positionWhy.includes('收盘跌破冻结硬防守位1.365'), result.summary.positionWhy);
    assert.ok(result.summary.positionWhy.includes('策略参考仓位从30%降至0%') && result.summary.positionWhy.includes('生成S'), result.summary.positionWhy);
    assert.ok(result.summary.nextFocus.includes('已跌破冻结硬防守位并完成结构离场'), result.summary.nextFocus);
    assert.ok(result.invalidCondition.includes('已跌破冻结硬防守位并完成结构离场'), result.invalidCondition);
    assert.ok(!result.invalidCondition.includes('暂未看到需要立即防守的核心离场信号'), result.invalidCondition);
});

runTest('plain-language summaries cover action states, historical causes, fixed tiers and index vocabulary', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext('function convertDailyToWeekly() { return []; }', context);
    vm.runInContext(calcSource, context);
    vm.runInContext(`
        Object.assign(STRATEGY, STRATEGIES['稳健趋势型']);
        state.strategy = '稳健趋势型';
        state.mode = 'stock';
        var baseMeta = {
            type: '✅ 明确转强', currentDay: 10, windowScore: 5,
            buySignals: [], exitSignals: [], warningSignals: [], inCooldown: false,
            windowScoreSignals: [{ signal: 'B1', day: 8, dayOffset: 2, signalDate: '2026-08-04', score: 3 }]
        };
        var baseDecision = {
            position: 50, prevAdv: 50, basePosition: 60, bsMark: null,
            simpleAction: '持仓观察', signalReady: true,
            market: { label: '温和偏多' }, marketGate: { type: 'open' },
            risk: { level: '低波动/偏离', coef: 1, score: 85, flags: [], stop: 96, pressure: 112 },
            exit: { level: '无明确离场', detail: '暂无明确离场依据' }
        };
        var actionCases = [
            { name: 'empty', meta: { ...baseMeta, windowScore: 0, windowScoreSignals: [] }, decision: { ...baseDecision, position: 0, prevAdv: 0, basePosition: 0, signalReady: false, simpleAction: '持币观望' } },
            { name: 'entry', meta: baseMeta, decision: { ...baseDecision, position: 30, prevAdv: 0, basePosition: 30, bsMark: 'B', simpleAction: '轻仓建仓' } },
            { name: 'increase', meta: baseMeta, decision: { ...baseDecision, position: 80, prevAdv: 30, basePosition: 80, simpleAction: '顺势加仓' } },
            { name: 'hold', meta: baseMeta, decision: baseDecision },
            { name: 'reduce', meta: { ...baseMeta, warningSignals: ['W1'] }, decision: { ...baseDecision, position: 30, prevAdv: 80, simpleAction: '防守减仓', exit: { level: '减仓观察', detail: '短线转弱' } } },
            { name: 'exit', meta: { ...baseMeta, windowScore: 0, windowScoreSignals: [], exitSignals: ['L3'] }, decision: { ...baseDecision, position: 0, prevAdv: 30, basePosition: 0, bsMark: 'S', simpleAction: '清仓离场', signalReady: false, exit: { level: '强离场', detail: 'MACD死叉' } } },
            { name: 'cooldown', meta: { ...baseMeta, windowScore: 0, windowScoreSignals: [], inCooldown: true, cooldownDays: 3, daysSinceExit: 2 }, decision: { ...baseDecision, position: 0, prevAdv: 0, basePosition: 0, simpleAction: '持币观望', signalReady: false } }
        ];
        var actionSummaries = actionCases.map(item => {
            var before = { position: item.decision.position, bsMark: item.decision.bsMark };
            var summary = getNoviceDecisionSummary(item.meta, item.decision);
            return { name: item.name, before, after: { position: item.decision.position, bsMark: item.decision.bsMark }, summary };
        });
        var historicalSummary = getNoviceDecisionSummary(baseMeta, baseDecision);
        state.strategy = '波段抄底型';
        Object.assign(STRATEGY, STRATEGIES['波段抄底型']);
        var b11Decision = { ...baseDecision, position: 30, prevAdv: 30, basePosition: 30, b11StructureDefense: { localBreak: true } };
        var waveB11Summary = getNoviceDecisionSummary({ ...baseMeta, windowScore: 4 }, b11Decision);
        state.strategy = '稳健趋势型';
        Object.assign(STRATEGY, STRATEGIES['稳健趋势型']);
        var nonWaveB11Summary = getNoviceDecisionSummary(baseMeta, b11Decision);
        state.mode = 'index';
        var indexActionSummaries = actionCases.map(item => ({ name: item.name, summary: getNoviceDecisionSummary(item.meta, item.decision, 'index') }));
        var indexSummary = getNoviceDecisionSummary(baseMeta, baseDecision, 'index');
    `, context);

    const cases = JSON.parse(vm.runInContext('JSON.stringify(actionSummaries)', context));
    assert.deepStrictEqual(cases.map(item => item.name), ['empty', 'entry', 'increase', 'hold', 'reduce', 'exit', 'cooldown']);
    for (const item of cases) {
        assert.deepStrictEqual(item.after, item.before);
        assert.ok(item.summary.why, `${item.name} missing why`);
        assert.ok(item.summary.positionWhy, `${item.name} missing positionWhy`);
        assert.ok(item.summary.nextFocus, `${item.name} missing nextFocus`);
        assert.ok(/才(?:重新)?考虑/.test(item.summary.nextFocus), `${item.name} missing upward condition: ${item.summary.nextFocus}`);
        assert.ok(item.summary.nextFocus.includes('若'), `${item.name} missing defensive condition: ${item.summary.nextFocus}`);
        const text = `${item.summary.why} ${item.summary.positionWhy} ${item.summary.nextFocus}`;
        assert.ok(!/\b[BLW]\d+\b/.test(text), `${item.name}: ${text}`);
        assert.ok(!text.includes('风险系数'), `${item.name}: ${text}`);
        assert.ok(!text.includes('本日未发生仓位变化'), `${item.name}: ${text}`);
        assert.ok(item.summary.why.length <= 120, `${item.name} why is too long: ${item.summary.why}`);
        assert.ok(item.summary.positionWhy.length <= 150, `${item.name} positionWhy is too long: ${item.summary.positionWhy}`);
        assert.ok(item.summary.nextFocus.length <= 120, `${item.name} nextFocus is too long: ${item.summary.nextFocus}`);
    }
    const indexCases = JSON.parse(vm.runInContext('JSON.stringify(indexActionSummaries)', context));
    for (const item of indexCases) {
        assert.ok(item.summary.why && item.summary.positionWhy && item.summary.nextFocus, `index ${item.name} has incomplete copy`);
        const text = `${item.summary.why} ${item.summary.positionWhy} ${item.summary.nextFocus}`;
        assert.ok(!/个股|买入信号|买入积分|试探仓|策略参考仓位/.test(text), `index ${item.name}: ${text}`);
        assert.ok(/才(?:重新)?考虑/.test(item.summary.nextFocus), `index ${item.name} missing upward condition: ${item.summary.nextFocus}`);
        assert.ok(item.summary.nextFocus.includes('若'), `index ${item.name} missing defensive condition: ${item.summary.nextFocus}`);
        assert.ok(item.summary.why.length <= 120, `index ${item.name} why is too long: ${item.summary.why}`);
        assert.ok(item.summary.positionWhy.length <= 150, `index ${item.name} positionWhy is too long: ${item.summary.positionWhy}`);
        assert.ok(item.summary.nextFocus.length <= 120, `index ${item.name} nextFocus is too long: ${item.summary.nextFocus}`);
    }
    const historical = JSON.parse(vm.runInContext('JSON.stringify(historicalSummary)', context));
    assert.ok(historical.why.includes('2026-08-04出现均线多头，目前仍有效'), historical.why);
    assert.ok(!historical.why.includes('今日出现'), historical.why);
    assert.ok(historical.positionWhy.includes('基础仓位为60%'), historical.positionWhy);
    // 风险评分 85 没有压低 60%，因此不写风险句，只保留信号支持说明。
    assert.ok(!historical.positionWhy.includes('风险评估'), historical.positionWhy);
    assert.ok(historical.positionWhy.includes('仍支持当前仓位'), historical.positionWhy);
    const waveB11 = JSON.parse(vm.runInContext('JSON.stringify(waveB11Summary)', context));
    assert.ok(waveB11.positionWhy.includes('结构位未破'));
    assert.ok(waveB11.nextFocus.includes('才考虑加仓') && waveB11.nextFocus.includes('若'));
    assert.ok(!JSON.parse(vm.runInContext('JSON.stringify(nonWaveB11Summary)', context)).positionWhy.includes('结构位未破'));
    const index = JSON.parse(vm.runInContext('JSON.stringify(indexSummary)', context));
    assert.ok(index.why && index.positionWhy && index.nextFocus);
    assert.ok(index.nextFocus.includes('才考虑') && index.nextFocus.includes('若'));
    assert.ok(index.positionWhy.includes('基础风险仓位'));
    assert.ok(index.positionWhy.includes('最终风险仓位'));
    assert.ok(!index.positionWhy.includes('个股') && !index.positionWhy.includes('试探仓'), index.positionWhy);
});

runTest('wave regime shadow classifies flat MA20 only with a confirmed valid box', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext('function convertDailyToWeekly() { return []; }', context);
    vm.runInContext(calcSource, context);
    vm.runInContext([
        "setActiveStrategy('波段抄底型'); state.mode = 'stock'; state.period = 'daily';",
        "var full = Array.from({ length: 70 }, (_, day) => ({ date: 'D' + day, open: 100, high: 101, low: 99, close: 100, vol: 1000, _signals: [] }));",
        "full[45].low = 90; full[50].high = 104; full[55].low = 90.3; full[60].high = 104.2; full[68].low = 88;",
        "var ind = { ma: { 20: Array(70).fill(100), 60: Array(70).fill(100) } }; state.indicators = ind;",
        "var box = getWaveBoxContext(69, full, STRATEGY.waveRegimePolicy);",
        "var ranged = getWaveContext(69, full, ind, STRATEGY);",
        "var noBoxRows = full.map(row => ({ ...row, high: 101, low: 99 }));",
        "var transition = getWaveContext(69, noBoxRows, ind, STRATEGY);"
    ].join('\n'), context);
    const result = JSON.parse(vm.runInContext('JSON.stringify({ box, ranged, transition })', context));
    assert.strictEqual(result.box.valid, true);
    assert.strictEqual(result.box.pivots.lows.some(item => item.day === 68), false, 'right-side confirmation must exclude the latest unconfirmed low');
    assert.strictEqual(result.ranged.regime, 'range');
    assert.strictEqual(result.ranged.consecutiveDays, 3);
    assert.strictEqual(result.transition.regime, 'transition');
    assert.strictEqual(result.transition.box.valid, false);
});

runTest('wave down qualification requires same-day evidence and rejects history-only scored signals', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext('function convertDailyToWeekly() { return []; }', context);
    vm.runInContext(calcSource, context);
    vm.runInContext([
        "setActiveStrategy('波段抄底型'); state.strategy = '波段抄底型'; state.mode = 'stock'; state.period = 'daily';",
        // 平盘数据、无确认摆动低点；箱体支撑设在远处（90），使 nearSupport 不成立。
        "var full = Array.from({ length: 70 }, (_, day) => ({ date: 'D' + day, open: 100, high: 101, low: 98, close: 100, vol: 1000, _signals: [] }));",
        "state.indicators = { ma: { 20: Array(70).fill(100), 60: Array(70).fill(110) }, macd: {}, rsi: {}, kdj: {} };",
        "var waveContext = { inScope: true, regime: 'down', regimeLabel: '下跌', boxSupport: 90, boxPressure: 120, box: { valid: false, atr14: 1 } };",
        // 窗口内有历史 B16（既是修复信号又是下跌入场信号），但当日 rawSignals 为空。
        "var histMeta = { windowScore: 4, buySignals: [], exitSignals: [], warningSignals: [], windowSignals: [{ day: 64, signal: 'B16' }], windowScoreSignals: [{ day: 64, signal: 'B16', score: 3 }], invalidatedWindowSignals: [], localBreakWindowSignals: [], inCooldown: false };",
        "var historyOnly = getWaveRegimeQualification(69, full, histMeta, waveContext, [], STRATEGY);",
        // 对照：同一天出现新的 B16（当日实证），资格应成立。
        "var todayMeta = { ...histMeta, buySignals: ['B16'], windowSignals: [{ day: 69, signal: 'B16' }] };",
        "var sameDay = getWaveRegimeQualification(69, full, todayMeta, waveContext, ['B16'], STRATEGY);"
    ].join('\n'), context);
    const result = JSON.parse(vm.runInContext('JSON.stringify({ historyOnly, sameDay })', context));
    // 敏感性内建：两次仅差"当日是否有新信号"，其余条件相同。
    assert.strictEqual(result.historyOnly.scoreReady, true, '积分本身达标');
    assert.strictEqual(result.historyOnly.nearSupport, false, '不贴近支撑');
    assert.strictEqual(result.historyOnly.downQualified, false, '仅靠窗口内历史记分信号不再放行下跌建仓');
    assert.strictEqual(result.sameDay.downQualified, true, '当日出现新的下跌入场信号时资格仍成立');
});

runTest('wave regime governance enforces down range up lifecycle caps and frozen defense', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext('function convertDailyToWeekly() { return []; }', context);
    vm.runInContext(calcSource, context);
    vm.runInContext([
        "setActiveStrategy('波段抄底型'); state.mode = 'stock'; state.period = 'daily';",
        "var full = Array.from({ length: 90 }, (_, day) => ({ date: 'D' + day, open: 99.5, high: 100.5, low: 99, close: 100, vol: 1000, _signals: [] }));",
        "state.indicators = { ma: { 20: Array(90).fill(100), 60: Array(90).fill(100) }, macd: {}, rsi: {}, kdj: {} };",
        "var activeMeta = { currentDay: 64, type: '明确转强', windowScore: 4, buySignals: ['B9'], exitSignals: [], warningSignals: [], allSignals: { B9: true }, windowSignals: [], windowScoreSignals: [], invalidatedWindowSignals: [], localBreakWindowSignals: [], inCooldown: false };",
        "getSignalMeta = day => ({ ...activeMeta, currentDay: day });",
        "function candidate(regime, position, boxSupport, boxPressure) { return { position, prevAdv: 0, exit: { level: '无明确离场' }, simpleAction: position ? '轻仓建仓' : '持币观望', simpleColorClass: 'text-info', bsMark: position ? 'B' : null, positionDriver: '', waveRejectionProtection: { status: 'none' }, waveContext: { inScope: true, regime, regimeLabel: ({ down: '下跌', range: '横盘', up: '上涨', unknown: '未知' })[regime], boxSupport, boxPressure, boxMidpoint: boxSupport && boxPressure ? (boxSupport + boxPressure) / 2 : null, box: { valid: !!(boxSupport && boxPressure), atr14: 1 } } }; }",
        "full[64]._signals = ['B9']; var downEntry = applyWaveRegimeGovernance(64, full, 0, candidate('down', 50, 99, 105), STRATEGY); var downRepairEntry = applyWaveRegimeGovernance(64, full, 0, candidate('down', 50, null, null), STRATEGY); full[64]._decision = downEntry;",
        "full[65]._decision = downEntry; full[66]._signals = ['B11']; var downAdd = applyWaveRegimeGovernance(66, full, 30, candidate('down', 50, 99, 105), STRATEGY);",
        "full[65]._decision = downEntry; full[66].close = 98; full[66].low = 97.8; var downBreak = applyWaveRegimeGovernance(66, full, 30, candidate('down', 30, 99, 105), STRATEGY);",
        "full[66].close = 101; full[66].low = 99; full[64]._signals = ['B9']; var rangeEntry = applyWaveRegimeGovernance(64, full, 0, candidate('range', 30, 99, 105), STRATEGY); full[65]._decision = rangeEntry; full[65].high = 100.5; full[66]._signals = ['B11']; var rangeAdd = applyWaveRegimeGovernance(66, full, 30, candidate('range', 50, 99, 105), STRATEGY);",
        "state.indicators.ma[20][69] = 99.5; state.indicators.ma[20][70] = 100; full[70].low = 99.8; full[70].close = 100.5; full[70]._signals = ['B11']; var upEntry = applyWaveRegimeGovernance(70, full, 0, candidate('up', 30, null, null), STRATEGY);",
        "full[71]._decision = upEntry; full[72].low = 100; full[72].close = 101; full[72]._signals = ['B6']; var upAdd = applyWaveRegimeGovernance(72, full, 30, candidate('up', 50, null, null), STRATEGY);",
        "full[72]._decision = upAdd; full[73]._signals = ['B4']; var upTrend = applyWaveRegimeGovernance(73, full, 50, candidate('up', 80, null, null), STRATEGY);",
        "full[73]._decision = upTrend; var riskCandidate = candidate('up', 80, null, null); riskCandidate.risk = { score: 20 }; riskCandidate.waveRejectionProtection = { status: 'triggered', eventType: 'risk_cap_zero_exit' }; var upRiskExit = applyWaveRegimeGovernance(74, full, 80, riskCandidate, STRATEGY);",
        "full[80]._signals = ['B9']; var unknown = applyWaveRegimeGovernance(80, full, 0, candidate('unknown', 30, 99, 105), STRATEGY);",
        "activeMeta = { ...activeMeta, exitSignals: [], invalidatedWindowSignals: [], inCooldown: false }; full[81]._decision = { position: 80 }; var legacyDown = applyWaveRegimeGovernance(82, full, 80, { ...candidate('down', 80, 99, 105), risk: { score: 90 } }, STRATEGY);",
        "full[82]._decision = { position: 80 }; var legacyRange = applyWaveRegimeGovernance(83, full, 80, { ...candidate('range', 80, 99, 105), risk: { score: 90 } }, STRATEGY);",
        "full[83]._decision = { position: 50 }; var legacyUnknown = applyWaveRegimeGovernance(84, full, 50, { ...candidate('unknown', 80, 99, 105), risk: { score: 90 } }, STRATEGY);",
        "full[84]._decision = { position: 50 }; var legacyUnknownRisk = applyWaveRegimeGovernance(85, full, 50, { ...candidate('unknown', 0, 99, 105), risk: { score: 20 }, simpleAction: '规避风险' }, STRATEGY);",
        "var rangeLifecycle = { active: true, entryRegime: 'range', entrySignals: ['B9'], entrySignalGroups: ['B9'], entryDay: 78, entryDate: 'D78', entryClose: 100, localDefense: 98, hardDefense: 95, supportSource: 'box-support', stage: 'confirmation', positionLayer: 50, upperObservation: null };",
        "full[85]._decision = { position: 50, waveContext: { lifecycle: rangeLifecycle } }; full[86] = { ...full[86], open: 100, high: 105, low: 99, close: 100, _signals: ['L10'] }; activeMeta = { ...activeMeta, currentDay: 86, exitSignals: ['L10'], allSignals: { L10: true } }; var rangeL10Candidate = { ...candidate('range', 0, 99, 105), exit: { level: '强离场' }, risk: { score: 90 }, waveRejectionProtection: { status: 'superseded' } }; var rangeStandaloneL10 = applyWaveRegimeGovernance(86, full, 50, rangeL10Candidate, STRATEGY);",
        "full[86]._decision = { position: 50, waveContext: { lifecycle: rangeLifecycle } }; full[87] = { ...full[87], open: 100, high: 105, low: 99, close: 100, _signals: ['L10', 'L5'] }; activeMeta = { ...activeMeta, currentDay: 87, exitSignals: ['L10', 'L5'], allSignals: { L10: true, L5: true } }; var rangeCompositeExit = applyWaveRegimeGovernance(87, full, 50, { ...rangeL10Candidate, waveContext: candidate('range', 0, 99, 105).waveContext }, STRATEGY);",
        "full[87]._decision = { position: 50, waveContext: { lifecycle: rangeLifecycle } }; full[88] = { ...full[88], close: 94, low: 93.5, _signals: ['L10'] }; activeMeta = { ...activeMeta, currentDay: 88, exitSignals: ['L10'], invalidatedWindowSignals: [{ signal: 'B9', reason: 'price-break', invalidationDay: 88, invalidationLevel: 95 }] }; var rangeStructureBreak = applyWaveRegimeGovernance(88, full, 50, { ...rangeL10Candidate, waveContext: candidate('range', 0, 99, 105).waveContext }, STRATEGY);"
    ].join('\n'), context);
    const result = JSON.parse(vm.runInContext('JSON.stringify({ downEntry, downRepairEntry, downAdd, downBreak, rangeEntry, rangeAdd, upEntry, upAdd, upTrend, upRiskExit, unknown, legacyDown, legacyRange, legacyUnknown, legacyUnknownRisk, rangeStandaloneL10, rangeCompositeExit, rangeStructureBreak })', context));
    assert.strictEqual(result.downEntry.position, 30);
    assert.strictEqual(result.downEntry.bsMark, 'B');
    assert.strictEqual(result.downEntry.waveContext.lifecycle.entryRegime, 'down');
    assert.strictEqual(result.downRepairEntry.position, 30);
    assert.strictEqual(result.downRepairEntry.bsMark, 'B');
    assert.strictEqual(result.downRepairEntry.waveContext.lifecycle.supportSource, 'signal-low');
    assert.strictEqual(result.downAdd.position, 30);
    assert.strictEqual(result.downBreak.position, 0);
    assert.strictEqual(result.downBreak.bsMark, 'S');
    assert.strictEqual(result.rangeEntry.position, 30);
    assert.strictEqual(result.rangeAdd.position, 50);
    assert.strictEqual(result.rangeAdd.bsMark, null);
    assert.strictEqual(result.upEntry.position, 30);
    assert.strictEqual(result.upAdd.position, 50);
    assert.strictEqual(result.upTrend.position, 80);
    assert.strictEqual(result.upTrend.bsMark, null);
    assert.strictEqual(result.upRiskExit.position, 80, '废弃的风险归零事件不能覆盖已有仓位');
    assert.strictEqual(result.upRiskExit.bsMark, null);
    assert.strictEqual(result.unknown.position, 0);
    assert.strictEqual(result.unknown.bsMark, null);
    assert.strictEqual(result.legacyDown.position, 30);
    assert.strictEqual(result.legacyDown.waveContext.stage, 'legacy-holding');
    assert.strictEqual(result.legacyRange.position, 50);
    assert.strictEqual(result.legacyUnknown.position, 50);
    assert.strictEqual(result.legacyUnknown.bsMark, null);
    assert.strictEqual(result.legacyUnknownRisk.position, 0);
    assert.strictEqual(result.legacyUnknownRisk.bsMark, 'S');
    assert.strictEqual(result.rangeStandaloneL10.position, 30);
    assert.strictEqual(result.rangeStandaloneL10.bsMark, null);
    assert.ok(result.rangeStandaloneL10.waveContext.lifecycle.upperObservation);
    assert.strictEqual(result.rangeCompositeExit.position, 0);
    assert.strictEqual(result.rangeCompositeExit.bsMark, 'S');
    assert.strictEqual(result.rangeStructureBreak.position, 0);
    assert.strictEqual(result.rangeStructureBreak.bsMark, 'S');
});

runTest('wave structure hard break resets stale score and locks immediate re-entry', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext('function convertDailyToWeekly() { return []; }', context);
    vm.runInContext(calcSource, context);
    vm.runInContext([
        "setActiveStrategy('波段抄底型'); state.mode = 'stock'; state.period = 'daily';",
        "var full = Array.from({ length: 80 }, (_, day) => ({ date: 'D' + day, open: 100, high: 101, low: 99, close: 100, vol: 1000, _signals: [] }));",
        "state.indicators = { ma: { 5: Array(80).fill(100), 20: Array(80).fill(100), 60: Array(80).fill(100) }, macd: {}, rsi: {}, kdj: {} };",
        "function rangeCandidate(position, protection) { return { position: position, prevAdv: 0, exit: { level: '无明确离场' }, simpleAction: position ? '轻仓建仓' : '持币观望', simpleColorClass: position ? 'text-info' : 'text-dim', bsMark: position ? 'B' : null, positionDriver: '', waveRejectionProtection: protection || { active: false, status: 'none', targetPosition: position }, waveContext: { inScope: true, regime: 'range', regimeLabel: '横盘', boxSupport: 95, boxPressure: 105, boxMidpoint: 100, box: { valid: true, atr14: 1 } } }; }",
        "full[69]._signals = ['B9'];",
        "full[70]._decision = { position: 30, waveContext: { lifecycle: { active: true, entryRegime: 'range', entrySignals: ['B9'], entrySignalGroups: ['B9'], entryDay: 69, entryDate: 'D69', entryClose: 100, localDefense: 97, hardDefense: 95, supportSource: 'box-support', stage: 'entry', positionLayer: 30, upperObservation: null } } };",
        "full[71] = { ...full[71], open: 96, high: 97, low: 93, close: 94 };",
        "var hardExit = applyWaveRegimeGovernance(71, full, 30, rangeCandidate(30), STRATEGY); full[71]._decision = hardExit;",
        "var staleMeta = calculateAllSignals(72, full, state.indicators);",
        "var locked = getWaveRejectionProtectionContext(72, full, staleMeta, 0, 30, STRATEGY, { trendRegime: { key: 'range' }, exit: { level: '无明确离场' }, market: {}, targetStrength: { tier: 'ordinary' }, positionCap: null });",
        "var immediateRetry = applyWaveRegimeGovernance(72, full, 0, rangeCandidate(30, locked), STRATEGY); full[72]._decision = immediateRetry;",
        "full[73] = { ...full[73], open: 100, high: 102, low: 99, close: 101, _signals: ['B11'] };",
        "var recoveryMeta = calculateAllSignals(73, full, state.indicators);",
        "var released = getWaveRejectionProtectionContext(73, full, recoveryMeta, 0, 30, STRATEGY, { trendRegime: { key: 'range' }, exit: { level: '无明确离场' }, market: {}, targetStrength: { tier: 'ordinary' }, positionCap: null });",
        "var recovered = applyWaveRegimeGovernance(73, full, 0, rangeCandidate(30, released), STRATEGY);"
    ].join('\n'), context);
    const result = JSON.parse(vm.runInContext('JSON.stringify({ hardExit, staleMeta, locked, immediateRetry, released, recovered })', context));
    assert.strictEqual(result.hardExit.position, 0);
    assert.strictEqual(result.hardExit.bsMark, 'S');
    assert.strictEqual(result.hardExit.waveRejectionProtection.status, 'triggered');
    assert.strictEqual(result.hardExit.waveRejectionProtection.eventType, 'structure_hard_break');
    assert.strictEqual(result.staleMeta.windowScore, 0, '离场前旧买入积分不能跨过真实 S');
    assert.strictEqual(result.staleMeta.lastPositionExitDate, 'D71');
    assert.strictEqual(result.locked.status, 'locked');
    assert.strictEqual(result.locked.lockRemaining, 1);
    assert.strictEqual(result.immediateRetry.position, 0);
    assert.strictEqual(result.immediateRetry.bsMark, null);
    assert.strictEqual(result.released.status, 'released');
    assert.strictEqual(result.released.pullbackRecovery, true);
    assert.strictEqual(result.recovered.position, 30);
    assert.strictEqual(result.recovered.bsMark, 'B');
});

runTest('wave peak confirmation drops one tier and ratchet lift requires minimum ATR buffer', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext('function convertDailyToWeekly() { return []; }', context);
    vm.runInContext(calcSource, context);
    vm.runInContext([
        "setActiveStrategy('波段抄底型'); state.mode = 'stock'; state.period = 'daily';",
        "var full = Array.from({ length: 90 }, (_, day) => ({ date: 'D' + day, open: 99.5, high: 100.5, low: 99, close: 100, vol: 1000, _signals: [] }));",
        "state.indicators = { ma: { 20: Array(90).fill(100), 60: Array(90).fill(100) }, macd: {}, rsi: {}, kdj: {} };",
        "var activeMeta = { currentDay: 70, type: '明确转强', windowScore: 4, buySignals: [], exitSignals: [], warningSignals: [], allSignals: {}, windowSignals: [], windowScoreSignals: [], invalidatedWindowSignals: [], localBreakWindowSignals: [], inCooldown: false };",
        "getSignalMeta = day => ({ ...activeMeta, currentDay: day });",
        "function lifecycle(positionLayer) { return { active: true, entryRegime: 'up', entrySignals: ['B11'], entrySignalGroups: ['B11'], entryDay: 60, entryDate: 'D60', entryClose: 100, localDefense: 96, hardDefense: 95, supportSource: 'box-support', stage: positionLayer === 50 ? 'confirmation' : 'entry', positionLayer: positionLayer, upperObservation: null }; }",
        "function candidate(position, peakConfirmed) { return { position: position, prevAdv: 0, exit: { level: '无明确离场' }, simpleAction: '谨慎持有', simpleColorClass: 'text-info', bsMark: null, positionDriver: '', waveRejectionProtection: { status: 'none' }, wavePeak: { status: peakConfirmed ? 'confirmed' : 'none', candidate: peakConfirmed, confirmed: peakConfirmed, reason: '触及日线压力后出现长上影弱收盘，按波峰确认防守' }, waveContext: { inScope: true, regime: 'up', regimeLabel: '上涨', boxSupport: null, boxPressure: null, boxMidpoint: null, box: { valid: false, atr14: 1 } } }; }",
        // 波峰确认：50% 降一档到 30%，30% 只保持不清仓，都不生成新的 S。
        "full[69]._decision = { position: 50, waveContext: { lifecycle: lifecycle(50) } }; var peakDropsTier = applyWaveRegimeGovernance(70, full, 50, candidate(50, true), STRATEGY);",
        "var peakHoldsFloor = applyWaveRegimeGovernance(70, full, 30, candidate(30, true), STRATEGY);",
        "var noPeakKeepsTier = applyWaveRegimeGovernance(70, full, 50, candidate(50, false), STRATEGY);",
        // 棘轮：缓冲足够（99.5 <= 100 - 0.5×1）时上移；缓冲不足（99.7）时保留原防守位。
        "var ratchetRows = full.map(row => ({ ...row })); [64, 65, 67, 68].forEach(day => { ratchetRows[day].low = 99.8; }); ratchetRows[66].low = 99.5;",
        "ratchetRows[69]._decision = { position: 30, waveContext: { lifecycle: lifecycle(30) } }; var ratchetLifts = applyWaveRegimeGovernance(70, ratchetRows, 30, candidate(30, false), STRATEGY);",
        "var noiseRows = full.map(row => ({ ...row })); [64, 65, 67, 68].forEach(day => { noiseRows[day].low = 99.8; }); noiseRows[66].low = 99.7;",
        "noiseRows[69]._decision = { position: 30, waveContext: { lifecycle: lifecycle(30) } }; var ratchetBlocked = applyWaveRegimeGovernance(70, noiseRows, 30, candidate(30, false), STRATEGY);"
    ].join('\n'), context);
    const result = JSON.parse(vm.runInContext('JSON.stringify({ peakDropsTier, peakHoldsFloor, noPeakKeepsTier, ratchetLifts, ratchetBlocked })', context));
    assert.strictEqual(result.peakDropsTier.position, 30);
    assert.strictEqual(result.peakDropsTier.bsMark, null, 'peak defense must not create a new S');
    assert.ok(result.peakDropsTier.waveContext.mainEvent.includes('波峰确认防守'));
    assert.strictEqual(result.peakHoldsFloor.position, 30, 'peak defense must not zero the 30% floor');
    assert.strictEqual(result.peakHoldsFloor.bsMark, null);
    assert.strictEqual(result.noPeakKeepsTier.position, 50, 'without peak confirmation the tier is unchanged');
    assert.strictEqual(result.ratchetLifts.waveContext.frozenHardDefense, 99.5);
    assert.strictEqual(result.ratchetLifts.waveContext.supportSource, 'confirmed-pivot-ratchet');
    assert.strictEqual(result.ratchetBlocked.waveContext.frozenHardDefense, 95, 'lift into the close noise band must be rejected');
    assert.strictEqual(result.ratchetBlocked.waveContext.supportSource, 'box-support');
});

runTest('L5 bearish engulfing is a reduce-watch exit, not a strong trend break', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext('function convertDailyToWeekly() { return []; }', context);
    vm.runInContext(calcSource, context);
    vm.runInContext(`
        Object.assign(STRATEGY, STRATEGIES['综合全能型']);
        state.strategy = '综合全能型';
        var data = Array.from({ length: 65 }, (_, i) => ({
            date: '2026-04-' + String(i + 1).padStart(2, '0'),
            open: 100,
            high: 101,
            low: 99,
            close: 100,
            vol: 1000,
            _signals: []
        }));
        data[64]._signals = ['L5'];
        var ind = {
            ma: { 5: [], 10: [], 20: [], 60: [] },
            macd: { diff: [], dea: [] },
            rsi: { val: [] },
            kdj: { k: [], d: [], j: [] }
        };
        for (var i = 0; i < data.length; i++) {
            ind.ma[5][i] = 100;
            ind.ma[10][i] = 100;
            ind.ma[20][i] = 100;
            ind.ma[60][i] = 100;
            ind.macd.diff[i] = 0;
            ind.macd.dea[i] = 0;
            ind.rsi.val[i] = 50;
            ind.kdj.k[i] = 50;
            ind.kdj.d[i] = 50;
            ind.kdj.j[i] = 50;
        }
        var meta = getSignalMeta(64, data, ind);
        var exit = getExitSeverity(meta, 64, data, ind);
    `, context);
    assert.strictEqual(vm.runInContext('meta.type', context), '👀 弱势震荡');
    assert.strictEqual(vm.runInContext('exit.level', context), '减仓观察');
});

// L12/W5 深挖已退役，结论保留在 docs/history/strategy/。
// Test cases removed: "L12 deep-dive script is local-cache only" and "strategy deep-dive scripts use production baseline"
