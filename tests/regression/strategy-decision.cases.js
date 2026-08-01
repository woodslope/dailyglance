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
    assert.ok(cssSource.includes('rgba(61, 109, 249, 0.08)'), 'strategy tracking tag should use a quiet tinted background');
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

runTest('hard risk caps override ten-point position hysteresis', () => {
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
    assert.strictEqual(vm.runInContext('hysteresisDecision.position', context), 20);
    assert.strictEqual(vm.runInContext('hysteresisDecision.simpleAction', context), '防守减仓');
});

runTest('wave B11 keeps a 30% trial after a local break and exits only below its confirmed structure low', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext('function convertDailyToWeekly() { return []; }', context);
    vm.runInContext(calcSource, context);
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
            return { wd: ctx.wd, weeklySupport: ctx.weeklySupport };
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

runTest('weak core breadth caps ordinary increases at 30 and independent strength at 50 without forcing reductions', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext('function convertDailyToWeekly() { return []; }', context);
    vm.runInContext(calcSource, context);
    vm.runInContext(renderSource, context);
    vm.runInContext(`
        state.period = 'daily';
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
        var ordinaryEvidence = getNoviceEvidenceCopy(gateMeta, ordinaryEntry, '未触发离场', '');

        state.indicators.ma[20][59] = 94;
        state.indicators.ma[20][64] = 95;
        state.indicators.ma[60][64] = 90;
        var independentEntry = computeDecisionForIndex(64, full, 0);
        var independentAdd = computeDecisionForIndex(64, full, 30);
        var blockedAbove50 = computeDecisionForIndex(64, full, 50);
        var heldAboveCap = computeDecisionForIndex(64, full, 80);
        var independentEvidence = getNoviceEvidenceCopy(gateMeta, independentEntry, '未触发离场', '');

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

        gateRisk = { score: 100, level: '低波动/偏离', coef: 1, flags: [], stop: 95, pressure: 110 };
        gateMeta = { ...gateMeta, type: '🚪 趋势破位', buySignals: [], exitSignals: ['L4'], allSignals: { L4: { status: true } } };
        gateExit = { level: '强离场', detail: '触发核心破位防守：L4' };
        var allowedExit = computeDecisionForIndex(65, full, 50);

        gateMeta = { ...gateMeta, type: '✅ 明确转强', buySignals: ['B1'], exitSignals: [], allSignals: { B1: { status: true } } };
        gateExit = { level: '无明确离场', detail: '暂无明确离场依据' };
        gateMarket = { label: '环境未知', cls: 'neutral', increaseCaps: { ordinary: 0, independent: 0 }, reason: '市场温度数据不足', trends: [] };
        var unknownEntry = computeDecisionForIndex(64, full, 0);
        gateMarket = { label: '环境待确认', cls: 'neutral', increaseCaps: { ordinary: 0, independent: 0 }, reason: '三项核心宽基尚未补齐', trends: [] };
        var pendingEntry = computeDecisionForIndex(64, full, 0);
    `, context);

    const result = JSON.parse(vm.runInContext('JSON.stringify({ ordinaryEntry, ordinaryEvidence, independentEntry, independentAdd, blockedAbove50, heldAboveCap, independentEvidence, riskLimitedEntry, allowedEntry, allowedReduce, allowedExit, unknownEntry, pendingEntry })', context));
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
    assert.ok(result.independentEntry.marketGate.reasons.includes('风险与离场检查通过'));
    assert.strictEqual(result.independentAdd.position, 50);
    assert.strictEqual(result.independentAdd.bsMark, null);
    assert.strictEqual(result.independentAdd.simpleAction, '顺势加仓');
    assert.strictEqual(result.blockedAbove50.position, 50);
    assert.strictEqual(result.blockedAbove50.marketGate.type, 'increase-capped');
    assert.strictEqual(result.heldAboveCap.position, 80);
    assert.strictEqual(result.heldAboveCap.marketGate.type, 'open');
    assert.ok(result.independentEvidence.marketHint.includes('标的自身独立走强') && result.independentEvidence.marketHint.includes('50%'), result.independentEvidence.marketHint);

    assert.strictEqual(result.riskLimitedEntry.position, 20);
    assert.strictEqual(result.riskLimitedEntry.bsMark, 'B');
    assert.strictEqual(result.riskLimitedEntry.marketGate.type, 'open');

    assert.strictEqual(result.allowedEntry.position, 80);
    assert.strictEqual(result.allowedEntry.bsMark, 'B');
    assert.strictEqual(result.allowedEntry.simpleAction, '积极建仓');

    assert.strictEqual(result.allowedReduce.position, 20);
    assert.strictEqual(result.allowedReduce.simpleAction, '防守减仓');
    assert.strictEqual(result.allowedReduce.bsMark, null);

    assert.strictEqual(result.allowedExit.position, 0);
    assert.strictEqual(result.allowedExit.simpleAction, '清仓离场');
    assert.strictEqual(result.allowedExit.bsMark, 'S');

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

runTest('hydrating non-active indices invalidates stale market-gated decisions without rebuilding stock indicators', () => {
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
    assert.strictEqual(result.beforeHydration.position, 0);
    assert.strictEqual(result.pendingModeAfterHydration, 'market-only');
    assert.strictEqual(result.calcCalls, 0);
    assert.strictEqual(result.afterHydration.market.label, '核心宽基偏强');
    assert.strictEqual(result.afterHydration.position, 80);
    assert.strictEqual(result.afterHydration.bsMark, 'B');
});

runTest('four formal strategies share the decision and B/S contract while keeping their configured focus', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext('function convertDailyToWeekly() { return []; }', context);
    vm.runInContext(calcSource, context);
    vm.runInContext(`
        state.period = 'daily';
        state.indicators = { ma: {}, macd: null, rsi: null, kdj: null };
        getMarketContext = () => ({ label: '全面多头', cls: 'bull', coef: 1, maxPosition: 80, reason: 'test fixture', trends: [] });
        getRiskContext = () => ({ score: 100, level: '低波动/偏离', coef: 1, flags: [], stop: 95, pressure: 110 });
        var full = Array.from({ length: 70 }, (_, i) => ({ date: '2026-06-' + String(i + 1).padStart(2, '0'), open: 100, high: 102, low: 98, close: 100, vol: 1000 }));
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
        assert.strictEqual(result.exit.position, 0);
        assert.strictEqual(result.exit.bsMark, 'S');
        assert.strictEqual(result.exit.action, '清仓离场');
        assert.strictEqual(result.exit.color, 'text-bear');
        assert.ok(result.summary.state);
        assert.ok(result.summary.action);
        assert.strictEqual(result.summary.positionText, '0%');
        assert.ok(result.summary.reason);
        assert.ok(result.summary.reason.includes(result.exitSignal), result.summary.reason);
        assert.ok(result.summary.reason.includes(`当前从${result.expectedPosition}%降至 0%`), result.summary.reason);
        assert.ok(result.summary.reason.includes('先空仓防守'), result.summary.reason);
        assert.ok(result.summary.invalidCondition);
    }
    assert.ok(results.every(item => item.summary.state === '破位防守'));
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
        assert.ok(result.summary.reason.includes(`${result.exitSignal} ${result.exitText}`), result.summary.reason);
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
            return {
                key: sample.key,
                hasDailyConclusion: text.includes(state.mode === 'index' ? '大盘每日结论' : '个股每日结论'),
                hasAction: state.mode === 'index'
                    ? (text.includes('增加风险') || text.includes('维持当前风险仓位') || text.includes('降低风险暴露') || text.includes('保持低风险暴露'))
                    : (text.includes(sample.expected.simpleAction) || text.includes('空仓观望') || text.includes('先不碰') || text.includes('继续持有') || text.includes('可积极关注')),
                hasPosition: text.includes(state.mode === 'index' ? '当前风险仓位' : '策略参考仓位') && text.includes(String(sample.expected.position) + '%'),
                hasRisk: text.includes(state.mode === 'index' ? '市场风险/防守' : '风控/防守') && (text.includes(sample.expected.riskLevel) || text.includes(sample.expected.exitLevel) || text.includes('防守观察')),
                hasInvalidCondition: text.includes('失效条件：') && (text.includes('买入积分') || text.includes('防守位') || text.includes('强离场信号')),
                hasEvidence: text.includes('关键推导依据') && text.includes(state.mode === 'index' ? '核心市场环境' : '核心建仓门禁') && (text.includes(state.mode === 'index' ? '指数自身动能' : '个股信号')),
                hasNoviceWhy: state.mode === 'index' ? (text.includes('动能依据') || text.includes('维持依据') || text.includes('动能不足') || text.includes('观察依据')) : (text.includes('买入依据') || text.includes('持仓依据') || text.includes('未买入原因') || text.includes('观察依据')),
                hasGuardAction: state.mode === 'index' ? text.includes('市场风险：') : text.includes('风险依据'),
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
            hasAction: true,
            hasPosition: true,
            hasRisk: true,
            hasInvalidCondition: true,
            hasEvidence: true,
            hasNoviceWhy: true,
            hasGuardAction: true,
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
    assert.strictEqual(vm.runInContext('summary.action', context), '可积极关注');
    assert.strictEqual(vm.runInContext('summary.positionText', context), '80%');
    assert.ok(vm.runInContext('summary.reason.includes("买入积分") && summary.reason.includes("均线多头")', context));
    assert.ok(vm.runInContext('summary.invalidCondition.includes("防守位 96.00")', context));
    assert.ok(vm.runInContext('summary.invalidCondition.includes("强离场信号")', context));
    assert.ok(vm.runInContext('summary.invalidCondition.includes("降仓或离场")', context));
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

// [Archived] L12/W5 deep-dive scripts moved to scripts/_archived/ (conclusions in STRATEGY_DECISION_RULES.md)
// Test cases removed: "L12 deep-dive script is local-cache only" and "strategy deep-dive scripts use production baseline"
