runTest('empty watchlist exposes one guided workspace state and disables chart controls', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(dataSource, context);
    vm.runInContext(appSourceNoInit, context);
    vm.runInContext(`
        var chartSection = { classList: { active: false, toggle(name, active) { this.active = active; } } };
        var marketWorkspace = { classList: { active: false, toggle(name, active) { this.active = active; } } };
        var chartControls = [{ disabled: false }, { disabled: false }];
        var removedHints = 0;
        var sidebarHidden = false;
        var inputFocused = false;
        var inputSelected = false;
        var originalGetElementById = document.getElementById;
        document.querySelector = function(selector) {
            if (selector === '.chart-section') return chartSection;
            return null;
        };
        document.querySelectorAll = function(selector) {
            if (selector === '.chart-toolbar button, .chart-toolbar input') return chartControls;
            if (selector === '.empty-hint') return [{ remove() { removedHints++; } }, { remove() { removedHints++; } }];
            return [];
        };
        document.getElementById = function(id) {
            if (id === 'marketWorkspace') return marketWorkspace;
            var el = originalGetElementById.call(document, id);
            if (id === 'stockSearchInput') {
                el.focus = function() { inputFocused = true; };
                el.select = function() { inputSelected = true; };
            }
            return el;
        };
        applySidebarHTML = function(bundle) { sidebarHidden = !!bundle.isHide; };
        state.mode = 'stock';
        state.stockId = null;
        setWatchlistEmptyState(true);
        focusWatchlistSearch();
        var emptyResult = {
            chartClass: chartSection.classList.active,
            workspaceClass: marketWorkspace.classList.active,
            chartHidden: document.getElementById('watchlistEmptyState').hidden,
            controlsDisabled: chartControls.every(control => control.disabled),
            removedHints,
            sidebarHidden,
            inputFocused,
            inputSelected,
            refreshDisplay: document.getElementById('lastRefreshBar').style.display,
            backtestDisplay: document.getElementById('btnBacktest').style.display
        };
        state.stockId = '600519';
        setWatchlistEmptyState(false);
        var readyResult = {
            chartClass: chartSection.classList.active,
            workspaceClass: marketWorkspace.classList.active,
            chartHidden: document.getElementById('watchlistEmptyState').hidden,
            controlsEnabled: chartControls.every(control => !control.disabled),
            backtestDisplay: document.getElementById('btnBacktest').style.display
        };
    `, context);
    const emptyResult = JSON.parse(vm.runInContext('JSON.stringify(emptyResult)', context));
    const readyResult = JSON.parse(vm.runInContext('JSON.stringify(readyResult)', context));
    assert.deepStrictEqual(emptyResult, {
        chartClass: true,
        workspaceClass: true,
        chartHidden: false,
        controlsDisabled: true,
        removedHints: 2,
        sidebarHidden: true,
        inputFocused: true,
        inputSelected: true,
        refreshDisplay: 'none',
        backtestDisplay: 'none'
    });
    assert.deepStrictEqual(readyResult, {
        chartClass: false,
        workspaceClass: false,
        chartHidden: true,
        controlsEnabled: true,
        backtestDisplay: 'flex'
    });
    assert.ok(indexSource.includes('id="watchlistEmptyState"'), 'center workspace needs a dedicated empty state');
    assert.ok(!indexSource.includes('id="watchlistInfoEmptyState"'), 'right panel must not duplicate the center empty state');
    assert.ok(cssSource.includes('.main-container.is-watchlist-empty .info-section { display: none; }'), 'right panel should yield its width to the empty workspace');
    assert.ok(!indexSource.includes('K 线图 — 暂无数据'), 'the page shell must not hard-code repeated chart empty copy');
    assert.ok(appSource.includes('renderLeftListHeader(`自选股池 · 0/${SYS_CONFIG.WATCHLIST_LIMIT}`, { showRefresh: false })'), 'empty watchlist header should show the configured limit and hide stale refresh time');
    assert.match(appSource, /function showEmptyWatchlistView\(\) \{[\s\S]*?setWatchlistEmptyState\(true\);[\s\S]*?hideLoading\(\);[\s\S]*?\}/, 'empty watchlist should dismiss a superseded loading overlay');
});

runTest('removing the selected stock stays in the watchlist and selects the adjacent stock or empty state', async () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(appSourceNoInit, context);
    await vm.runInContext(`
        (async function() {
            var pendingTimer = null;
            var selectedCode = '';
            var emptyCount = 0;
            setTimeout = function(fn) { pendingTimer = fn; return 1; };
            renderWatchlist = function() {};
            saveWatchlist = async function() {};
            showToastWithAction = function() {};
            normalizeStockDisplayName = function(code, name) { return name || code; };
            normalizeSecurityTarget = function(stock) {
                return { code: stock.code, name: stock.name, secid: stock.secid || '', type: stock.type || '', tencentSymbol: stock.tencentSymbol || '' };
            };
            isSupportedWatchlistSecurity = function(stock) { return stock.code !== '009881'; };
            selectStock = function(code) { selectedCode = code; };
            showEmptyWatchlistView = function() { emptyCount++; };

            state.tab = 'stock';
            state.mode = 'stock';
            state.stockId = '600519';
            state.watchlist = [
                { code: '600519', name: '贵州茅台' },
                { code: '000001', name: '平安银行' }
            ];
            await removeStock('600519');
            await pendingTimer();
            adjacentResult = { selectedCode, emptyCount, tab: state.tab, remaining: state.watchlist.map(item => item.code) };

            pendingTimer = null;
            selectedCode = '';
            emptyCount = 0;
            state.stockId = '000001';
            state.watchlist = [{ code: '000001', name: '平安银行' }];
            await removeStock('000001');
            await pendingTimer();
            lastResult = { selectedCode, emptyCount, tab: state.tab, remaining: state.watchlist.map(item => item.code) };
        })()
    `, context);
    const adjacentResult = JSON.parse(vm.runInContext('JSON.stringify(adjacentResult)', context));
    const lastResult = JSON.parse(vm.runInContext('JSON.stringify(lastResult)', context));
    assert.deepStrictEqual(adjacentResult, { selectedCode: '000001', emptyCount: 0, tab: 'stock', remaining: ['000001'] });
    assert.deepStrictEqual(lastResult, { selectedCode: '', emptyCount: 1, tab: 'stock', remaining: [] });
});

runTest('watchlist accepts 15 stocks and rejects the sixteenth', async () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(dataSource, context);
    vm.runInContext(appSourceNoInit, context);
    await vm.runInContext(`
        (async function() {
            dbSet = async function() {};
            renderWatchlist = function() {};
            state.watchlist = Array.from({ length: SYS_CONFIG.WATCHLIST_LIMIT - 1 }, function(_, i) {
                return { code: String(i + 1).padStart(6, '0'), name: 'stock-' + i };
            });
            await addToWatchlist('600519', '贵州茅台');
            var countAtLimit = state.watchlist.length;
            var rejectPromise = addToWatchlist('000999', '测试股票');
            var alertText = document.getElementById('customModalMsg').innerText;
            document.getElementById('customModalBtnOk').onclick();
            await rejectPromise;
            watchlistLimitResult = { limit: SYS_CONFIG.WATCHLIST_LIMIT, countAtLimit, finalCount: state.watchlist.length, alertText };
        })()
    `, context);
    const result = JSON.parse(vm.runInContext('JSON.stringify(watchlistLimitResult)', context));
    assert.deepStrictEqual(result, {
        limit: 15,
        countAtLimit: 15,
        finalCount: 15,
        alertText: '最多只能添加 15 只自选股。'
    });
    assert.strictEqual(vm.runInContext('SYS_CONFIG.SIDEBAR_SYNC_CONCURRENCY', context), 3);
});

runTest('market refresh lease blocks an unfocused duplicate page and lets the focused page take over', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(`
        marketRefreshLeadershipStarted = true;
        document.hasFocus = function() { return false; };
        localStorage.setItem(SYS_CONFIG.MARKET_REFRESH_LEASE_KEY, JSON.stringify({ owner: 'other-page', expiresAt: Date.now() + 60000 }));
        var duplicateBlocked = canRequestMarketData();
        claimMarketRefreshLeadership({ force: true });
        var focusedPageAllowed = canRequestMarketData();
        var ownerAfterFocus = readMarketRefreshLease().owner;
        releaseMarketRefreshLeadership();
        marketLeaseResult = {
            duplicateBlocked,
            focusedPageAllowed,
            ownsAfterFocus: ownerAfterFocus === PAGE_SESSION_ID,
            released: readMarketRefreshLease() === null
        };
    `, context);
    assert.deepStrictEqual(JSON.parse(vm.runInContext('JSON.stringify(marketLeaseResult)', context)), {
        duplicateBlocked: false,
        focusedPageAllowed: true,
        ownsAfterFocus: true,
        released: true
    });
});

runTest('duplicate page syncData reads confirmed cache without starting network refresh', async () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(dataSource, context);
    await vm.runInContext(`
        (async function() {
            var cachedRows = Array.from({ length: 30 }, function(_, i) {
                return { date: '2026-06-' + String(i + 1).padStart(2, '0'), open: 10, high: 11, low: 9, close: 10, vol: 100, amt: 1000 };
            });
            var networkRefreshCount = 0;
            var cachedOverlayCount = 0;
            getCachedData = async function() { return cachedRows; };
            syncDataIncremental = async function() { networkRefreshCount++; return cachedRows; };
            tryApplyCachedLiveOverlay = function() { cachedOverlayCount++; return false; };
            isMarketOpen = function() { return true; };
            marketRefreshLeadershipStarted = true;
            document.hasFocus = function() { return false; };
            localStorage.setItem(SYS_CONFIG.MARKET_REFRESH_LEASE_KEY, JSON.stringify({ owner: 'other-page', expiresAt: Date.now() + 60000 }));
            var result = await syncData('sh');
            duplicateCacheResult = { rowCount: result.length, networkRefreshCount, cachedOverlayCount };
        })()
    `, context);
    assert.deepStrictEqual(JSON.parse(vm.runInContext('JSON.stringify(duplicateCacheResult)', context)), {
        rowCount: 30,
        networkRefreshCount: 0,
        cachedOverlayCount: 1
    });
});

runTest('watchlist storage notification reloads another open page without writing back', async () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(dataSource, context);
    vm.runInContext(`
        var storageHandler = null;
        window.addEventListener = function(type, handler) { if (type === 'storage') storageHandler = handler; };
    `, context);
    vm.runInContext(appSourceNoInit, context);
    await vm.runInContext(`
        (async function() {
            var loadCount = 0;
            var renderCount = 0;
            var selectedCode = '';
            loadWatchlist = async function() {
                loadCount++;
                state.watchlist = [{ code: '000001', name: '平安银行', secid: '0.000001' }];
            };
            renderWatchlist = function() { renderCount++; };
            selectStock = function(code) { selectedCode = code; };
            state.mode = 'stock';
            state.stockId = '600519';
            initWatchlistCrossPageSync();
            await storageHandler({
                key: SYS_CONFIG.WATCHLIST_SYNC_KEY,
                newValue: JSON.stringify({ owner: 'other-page', at: Date.now() })
            });
            crossPageWatchlistResult = { loadCount, renderCount, selectedCode };
        })()
    `, context);
    assert.deepStrictEqual(JSON.parse(vm.runInContext('JSON.stringify(crossPageWatchlistResult)', context)), {
        loadCount: 1,
        renderCount: 1,
        selectedCode: '000001'
    });
});

runTest('watchlist snapshot keeps the prior position when tail rebuild is safe', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(`
        var captured = [];
        var Calcs = {
            ma: (data) => data.map(() => 1),
            macd: (data) => ({ diff: data.map(() => 0), dea: data.map(() => 0), bar: data.map(() => 0) }),
            rsi: (data) => ({ val: data.map(() => 50) }),
            kdj: (data) => ({ k: data.map(() => 50), d: data.map(() => 50), j: data.map(() => 50) })
        };
        function buildWeeklySignalContexts(data) { return data.map(() => null); }
        function calculateDailySignals() { return []; }
        function computeDecisionForIndex(idx, full, prevPos) {
            captured.push({ idx, prevPos });
            return { position: prevPos, prevAdv: prevPos };
        }
    `, context);
    vm.runInContext(appSourceNoInit, context);
    vm.runInContext(`
        state.strategy = '稳健趋势型';
        var full = Array.from({ length: 100 }, (_, i) => ({ date: '2026-01-' + String(i + 1).padStart(2, '0'), close: 1 }));
        full[19]._decision = { position: 50 };
        full[19]._strategy = state.strategy;
        full[19]._signalVersion = SIGNAL_VERSION;
        computeWatchlistDecisionSnapshot(full);
    `, context);
    const captured = vm.runInContext('captured', context);
    assert.strictEqual(captured[0].idx, 20);
    assert.strictEqual(captured[0].prevPos, 50);
});

runTest('watchlist snapshot rebuilds from the beginning when no prior tail decision exists', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(`
        var captured = [];
        var Calcs = {
            ma: (data) => data.map(() => 1),
            macd: (data) => ({ diff: data.map(() => 0), dea: data.map(() => 0), bar: data.map(() => 0) }),
            rsi: (data) => ({ val: data.map(() => 50) }),
            kdj: (data) => ({ k: data.map(() => 50), d: data.map(() => 50), j: data.map(() => 50) })
        };
        function buildWeeklySignalContexts(data) { return data.map(() => null); }
        function calculateDailySignals() { return []; }
        function computeDecisionForIndex(idx, full, prevPos) {
            captured.push({ idx, prevPos });
            return { position: prevPos, prevAdv: prevPos };
        }
    `, context);
    vm.runInContext(appSourceNoInit, context);
    vm.runInContext(`
        var full = Array.from({ length: 100 }, (_, i) => ({ date: '2026-01-' + String(i + 1).padStart(2, '0'), close: 1 }));
        computeWatchlistDecisionSnapshot(full);
    `, context);
    const captured = vm.runInContext('captured', context);
    assert.strictEqual(captured[0].idx, 0);
});

runTest('watchlist snapshot does not repeat full daily-to-weekly conversion inside its history loop', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(dataSource, context);
    vm.runInContext(calcSource, context);
    vm.runInContext(appSourceNoInit, context);
    vm.runInContext(`
        var full = [];
        var cursor = new Date('2025-01-02T00:00:00Z');
        while (full.length < 180) {
            var day = cursor.getUTCDay();
            if (day !== 0 && day !== 6) {
                var i = full.length;
                var base = 100 + Math.sin(i / 7) * 4 + i * 0.08;
                full.push({
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
        state.strategy = '稳健趋势型';
        var fullWeeklyConversionCount = 0;
        var originalConvertDailyToWeekly = convertDailyToWeekly;
        convertDailyToWeekly = function() {
            fullWeeklyConversionCount++;
            return originalConvertDailyToWeekly.apply(this, arguments);
        };
        computeWatchlistDecisionSnapshot(full);
    `, context);
    assert.strictEqual(vm.runInContext('fullWeeklyConversionCount', context), 0);
});

runTest('watchlist snapshot rebuilds when the latest decision is cached but the prior decision is missing', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(`
        var captured = [];
        var Calcs = {
            ma: (data) => data.map(() => 1),
            macd: (data) => ({ diff: data.map(() => 0), dea: data.map(() => 0), bar: data.map(() => 0) }),
            rsi: (data) => ({ val: data.map(() => 50) }),
            kdj: (data) => ({ k: data.map(() => 50), d: data.map(() => 50), j: data.map(() => 50) })
        };
        function buildWeeklySignalContexts(data) { return data.map(() => null); }
        function calculateDailySignals() { return []; }
        function computeDecisionForIndex(idx, full, prevPos) {
            captured.push(idx);
            return { position: idx === full.length - 1 ? 50 : 0, prevAdv: prevPos };
        }
    `, context);
    vm.runInContext(appSourceNoInit, context);
    vm.runInContext(`
        state.strategy = '稳健趋势型';
        var full = Array.from({ length: 100 }, (_, i) => ({ date: '2026-01-' + String(i + 1).padStart(2, '0'), close: 1 }));
        full[99]._decision = { position: 50 };
        full[99]._strategy = state.strategy;
        full[99]._signalVersion = SIGNAL_VERSION;
        computeWatchlistDecisionSnapshot(full);
    `, context);
    const captured = vm.runInContext('captured', context);
    assert.ok(captured.includes(98), '缺少上一个交易日决策时应重建相邻上下文');
});

runTest('watchlist snapshot restores an exact data-and-strategy derived cache before recomputing history', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(dataSource, context);
    vm.runInContext(calcSource, context);
    vm.runInContext(appSourceNoInit, context);
    vm.runInContext(`
        var full = Array.from({ length: 100 }, function(_, i) {
            var close = 100 + i * 0.2 + Math.sin(i / 4);
            return {
                date: '2026-01-' + String(i + 1).padStart(2, '0'),
                open: close - 0.5,
                high: close + 1,
                low: close - 1,
                close: close,
                vol: 10000 + i * 10,
                amt: (10000 + i * 10) * close
            };
        });
        state.strategy = '稳健趋势型';
        state.watchlist = [{ code: '600519', name: '贵州茅台', secid: '1.600519' }];
        firstWatchlistDecision = computeWatchlistDecisionSnapshot(full, '600519');
        full.forEach(function(row) {
            row._strategy = '综合全能型';
            row._decision = { position: 99 };
        });
        var recomputeCount = 0;
        var originalComputeDecisionForIndex = computeDecisionForIndex;
        computeDecisionForIndex = function() {
            recomputeCount++;
            return originalComputeDecisionForIndex.apply(this, arguments);
        };
        restoredWatchlistDecision = computeWatchlistDecisionSnapshot(full, '600519');
    `, context);
    assert.strictEqual(vm.runInContext('recomputeCount', context), 0);
    assert.strictEqual(vm.runInContext("full[full.length - 1]._strategy", context), '稳健趋势型');
    assert.deepStrictEqual(
        JSON.parse(vm.runInContext('JSON.stringify(restoredWatchlistDecision)', context)),
        JSON.parse(vm.runInContext('JSON.stringify(firstWatchlistDecision)', context))
    );
});

runTest('wave watchlist snapshot rejects stale governance decisions and reuses current governance cache', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(dataSource, context);
    vm.runInContext(calcSource, context);
    vm.runInContext(appSourceNoInit, context);
    vm.runInContext(`
        var full = Array.from({ length: 100 }, function(_, i) {
            var close = 100 + i * 0.05 + Math.sin(i / 5);
            return {
                date: '2026-02-' + String(i + 1).padStart(2, '0'),
                open: close - 0.3, high: close + 1, low: close - 1, close,
                vol: 10000 + i, amt: (10000 + i) * close
            };
        });
        setActiveStrategy('波段抄底型');
        state.mode = 'index';
        state.period = 'daily';
        state.watchlist = [{ code: '600519', name: '贵州茅台', secid: '1.600519' }];
        var cacheKey = buildIndicatorKeyForData('1.600519', 'daily', state.strategy, full);
        var staleRows = full.map(function(row) {
            return {
                _signals: [], _signalVersion: SIGNAL_VERSION, _strategy: state.strategy,
                _decision: { position: 80, simpleAction: '积极持有' }
            };
        });
        derivedIndicatorCache.set(cacheKey, {
            indicators: { ma: {}, macd: {}, rsi: {}, kdj: {} },
            rows: staleRows
        });
        var originalComputeDecisionForIndex = computeDecisionForIndex;
        var staleRecomputeCount = 0;
        computeDecisionForIndex = function() {
            staleRecomputeCount++;
            return originalComputeDecisionForIndex.apply(this, arguments);
        };
        var rebuiltDecision = computeWatchlistDecisionSnapshot(full, '600519');
        var rebuiltVersion = rebuiltDecision.waveGovernanceVersion;
        full.forEach(function(row) {
            row._strategy = '综合全能型';
            row._decision = { position: 99 };
        });
        var currentRecomputeCount = 0;
        computeDecisionForIndex = function() {
            currentRecomputeCount++;
            return originalComputeDecisionForIndex.apply(this, arguments);
        };
        var restoredDecision = computeWatchlistDecisionSnapshot(full, '600519');
        var cacheVersionResult = {
            staleRecomputeCount, currentRecomputeCount, rebuiltVersion,
            restoredVersion: restoredDecision.waveGovernanceVersion,
            restoredStrategy: full[full.length - 1]._strategy,
            expectedVersion: WAVE_GOVERNANCE_VERSION
        };
    `, context);
    const result = JSON.parse(vm.runInContext('JSON.stringify(cacheVersionResult)', context));
    assert.ok(result.staleRecomputeCount > 0);
    assert.strictEqual(result.currentRecomputeCount, 0);
    assert.strictEqual(result.rebuiltVersion, result.expectedVersion);
    assert.strictEqual(result.restoredVersion, result.expectedVersion);
    assert.strictEqual(result.restoredStrategy, '波段抄底型');
});

runTest('stale cache rejects realtime chart overlay but keeps sidebar quote available', async () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    const instrumentedDataSource = dataSource
        .replace(/function getBJDate\(\) \{ return new Date\(new Date\(\)\.toLocaleString\("en-US", \{timeZone: "Asia\/Shanghai"\}\)\); \}/, "function getBJDate() { return new Date('2026-06-30T10:30:00+08:00'); }")
        .replace(/function getCachedData\(id\) \{[\s\S]*?\n\}/, "function getCachedData(id) { return Promise.resolve(cachedRows); }")
        .replace(/function dbGet\(id\) \{[\s\S]*?\n\}/, "function dbGet(id) { return Promise.resolve({ data: cachedRows }); }")
        .replace(/function dbSet\(id, data\) \{[\s\S]*?\n\}/, "function dbSet(id, data) { return Promise.resolve(); }")
        .replace(/async function syncDataWithHistory\(id\) \{[\s\S]*?\n\}/, "async function syncDataWithHistory(id) { return cachedRows.map(row => ({ ...row })); }");
    vm.runInContext(instrumentedDataSource, context);
    vm.runInContext('function markIndicatorsDirty() { state.indicatorKey = ""; }', context);
    vm.runInContext(appSourceNoInit, context);
    vm.runInContext(`
        var cachedRows = Array.from({ length: 31 }, function(_, i) {
            var close = 100 + i;
            return {
                date: i === 30 ? '2026-06-26' : '2026-05-' + String(i + 1).padStart(2, '0'),
                open: close - 0.5,
                high: close + 1,
                low: close - 1,
                close,
                vol: 1000 + i,
                amt: 10000 + i
            };
        });
        requestManager.fetchRealtimeWithThrottle = async function() {
            return { date: '2026-06-30', open: 130, high: 138, low: 129, close: 136, vol: 4000, amt: 40000 };
        };
        state.id = 'sh';
        state.mode = 'index';
        state.tab = 'index';
    `, context);
    await vm.runInContext('(async function() { returnedRows = await syncData("sh"); setRawData("sh", returnedRows); })()', context);
    const result = JSON.parse(vm.runInContext(`JSON.stringify({
        confirmedLastDate: state.rawData.sh[state.rawData.sh.length - 1].date,
        activeLastDate: getActiveData()[getActiveData().length - 1].date,
        activeLastClose: getActiveData()[getActiveData().length - 1].close,
        quoteDate: getVisibleQuoteData('sh')[getVisibleQuoteData('sh').length - 1].date,
        quoteClose: getVisibleQuoteData('sh')[getVisibleQuoteData('sh').length - 1].close,
        liveBarExists: !!state.liveBars.sh
    })`, context));
    assert.deepStrictEqual(result, {
        confirmedLastDate: '2026-06-26',
        activeLastDate: '2026-06-26',
        activeLastClose: 130,
        quoteDate: '2026-06-30',
        quoteClose: 136,
        liveBarExists: false
    });
});

runTest('sidebar quote patch reads live overlay without rebuilding confirmed history', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(dataSource, context);
    vm.runInContext('function markIndicatorsDirty() { state.indicatorKey = ""; }', context);
    vm.runInContext(appSourceNoInit, context);
    vm.runInContext(`
        state.mode = 'index';
        state.tab = 'index';
        state.rawData.sh = [
            { date: '2026-06-26', open: 100, high: 103, low: 99, close: 102, vol: 1000, amt: 10000 },
            { date: '2026-06-27', open: 102, high: 104, low: 101, close: 103, vol: 1200, amt: 12000 }
        ];
        var priceEl = { textContent: '', className: '' };
        var changeEl = { textContent: '', className: '' };
        document.querySelector = function(selector) {
            if (selector === '#indexNavList .lprice[data-code="sh"]') return priceEl;
            if (selector === '#indexNavList .lchange[data-code="sh"]') return changeEl;
            return null;
        };
        setLiveBar('sh', { date: '2026-06-29', open: 103, high: 108, low: 102, close: 107, vol: 2200, amt: 22000 });
        refreshIndexListQuotes();
        var quotePatch = {
            price: priceEl.textContent,
            change: changeEl.textContent,
            confirmedLastDate: state.rawData.sh[state.rawData.sh.length - 1].date,
            visibleLastDate: getVisibleQuoteData('sh')[getVisibleQuoteData('sh').length - 1].date
        };
    `, context);
    assert.deepStrictEqual(JSON.parse(vm.runInContext('JSON.stringify(quotePatch)', context)), {
        price: '107.00',
        change: '+3.88%',
        confirmedLastDate: '2026-06-27',
        visibleLastDate: '2026-06-29'
    });
});

runTest('sidebar quote patch uses realtime previous close when history is stale', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(dataSource, context);
    vm.runInContext('function markIndicatorsDirty() { state.indicatorKey = ""; }', context);
    vm.runInContext(appSourceNoInit, context);
    vm.runInContext(`
        state.mode = 'index';
        state.tab = 'index';
        state.rawData.sh = [
            { date: '2026-06-25', open: 100, high: 103, low: 99, close: 102, vol: 1000, amt: 10000 },
            { date: '2026-06-26', open: 102, high: 132, low: 101, close: 130, vol: 1200, amt: 12000 }
        ];
        var priceEl = { textContent: '', className: '' };
        var changeEl = { textContent: '', className: '' };
        document.querySelector = function(selector) {
            if (selector === '#indexNavList .lprice[data-code="sh"]') return priceEl;
            if (selector === '#indexNavList .lchange[data-code="sh"]') return changeEl;
            return null;
        };
        setLiveQuote('sh', { date: '2026-06-30', open: 132, high: 138, low: 131, close: 136, prevClose: 132, vol: 2200, amt: 22000 });
        refreshIndexListQuotes();
        var quotePatch = {
            price: priceEl.textContent,
            change: changeEl.textContent,
            confirmedLastDate: state.rawData.sh[state.rawData.sh.length - 1].date,
            visibleLastDate: getVisibleQuoteData('sh')[getVisibleQuoteData('sh').length - 1].date
        };
    `, context);
    assert.deepStrictEqual(JSON.parse(vm.runInContext('JSON.stringify(quotePatch)', context)), {
        price: '136.00',
        change: '+3.03%',
        confirmedLastDate: '2026-06-26',
        visibleLastDate: '2026-06-30'
    });
});

runTest('sidebar realtime batch includes active symbol and refreshes active panel when live overlay is valid', async () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    const fixedClockDataSource = dataSource
        .replace(/function getBJDate\(\) \{ return new Date\(new Date\(\)\.toLocaleString\("en-US", \{timeZone: "Asia\/Shanghai"\}\)\); \}/, "function getBJDate() { return new Date('2026-06-30T10:30:00+08:00'); }");
    vm.runInContext(fixedClockDataSource, context);
    vm.runInContext('function markIndicatorsDirty() { state.indicatorKey = ""; }', context);
    vm.runInContext(appSourceNoInit, context);
    vm.runInContext(`
        var batchIds = [];
        var activeApplyCount = 0;
        var activeApplyPath = '';
        var drawCount = 0;
        var sidebarRebuildCount = 0;
        var indexQuoteRefreshCount = 0;
        var markRefreshCount = 0;
        batchGetRealtimePrices = async function(ids) {
            batchIds = ids.slice();
            return {
                sh: { date: '2026-06-30', open: 131, high: 136, low: 130, close: 135, prevClose: 130, vol: 3000, amt: 30000, quoteTime: '2026-06-30 10:30:00', quoteDateSource: 'api' },
                cy: { date: '2026-06-30', open: 231, high: 236, low: 230, close: 235, prevClose: 230, vol: 4000, amt: 40000, quoteTime: '2026-06-30 10:30:00', quoteDateSource: 'api' }
            };
        };
        var originalApplyActiveDataRefresh = applyActiveDataRefresh;
        applyActiveDataRefresh = function(id) {
            activeApplyCount++;
            activeApplyPath = originalApplyActiveDataRefresh(id);
            return activeApplyPath;
        };
        renderMASelector = function() {};
        updateAllIndicators = function() {};
        draw = function() { drawCount++; };
        safeUpdateSidebar = function() { sidebarRebuildCount++; };
        refreshIndexListQuotes = function() { indexQuoteRefreshCount++; };
        refreshWatchlistQuotes = function() {};
        markRefreshTime = function() { markRefreshCount++; };
        var shRows = Array.from({ length: 31 }, function(_, i) {
            var close = 100 + i;
            return {
                date: i === 30 ? '2026-06-29' : '2026-05-' + String(i + 1).padStart(2, '0'),
                open: close - 0.5,
                high: close + 1,
                low: close - 1,
                close,
                vol: 1000 + i,
                amt: 10000 + i
            };
        });
        var cyRows = shRows.map(function(row) { return { ...row, close: row.close + 100, open: row.open + 100, high: row.high + 100, low: row.low + 100 }; });
        state.id = 'sh';
        state.mode = 'index';
        state.tab = 'index';
        state.period = 'daily';
        state.charts = { main: {} };
        setRawData('sh', shRows);
        setRawData('cy', cyRows);
        setLockIdx(state.rawData.sh.length - 1);
    `, context);
    const realtimeBatchResult = await vm.runInContext('refreshSidebarRealtime()', context);
    const result = JSON.parse(vm.runInContext(`JSON.stringify({
        batchIds,
        activeApplyCount,
        activeApplyPath,
        liveClose: state.liveBars.sh?.close || 0,
        sideLiveClose: state.liveBars.cy?.close || 0,
        activeLatest: getActiveData()[getActiveData().length - 1].date,
        drawCount,
        sidebarRebuildCount,
        indexQuoteRefreshCount,
        markRefreshCount,
        throttledActive: requestManager.limiters.get('sh')?.lastCall > 0,
        batchStatus: ${JSON.stringify(realtimeBatchResult.status)},
        expectedCount: state.refreshSnapshots.leftList?.meta?.expectedCount || 0,
        appliedCount: state.refreshSnapshots.leftList?.meta?.appliedCount || 0
    })`, context));
    assert.deepStrictEqual(result, {
        batchIds: ['sh', 'sz', 'hs300', 'zz500', 'zz1000', 'cy', 'kc50', 'bz50'],
        activeApplyCount: 1,
        activeApplyPath: 'full-redraw',
        liveClose: 135,
        sideLiveClose: 235,
        activeLatest: '2026-06-30',
        drawCount: 1,
        sidebarRebuildCount: 1,
        indexQuoteRefreshCount: 1,
        markRefreshCount: 1,
        throttledActive: true,
        batchStatus: 'partial',
        expectedCount: 8,
        appliedCount: 2
    });
});

runTest('sidebar realtime batch discards results after the visible list changes', async () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    const fixedClockDataSource = dataSource
        .replace(/function getBJDate\(\) \{ return new Date\(new Date\(\)\.toLocaleString\("en-US", \{timeZone: "Asia\/Shanghai"\}\)\); \}/, "function getBJDate() { return new Date('2026-06-30T10:30:00+08:00'); }");
    vm.runInContext(fixedClockDataSource, context);
    vm.runInContext('function markIndicatorsDirty() { state.indicatorKey = ""; }', context);
    vm.runInContext(appSourceNoInit, context);
    vm.runInContext(`
        var resolveRealtimeBatch;
        var realtimeRequestCount = 0;
        batchGetRealtimePrices = function() {
            realtimeRequestCount++;
            return new Promise(function(resolve) { resolveRealtimeBatch = resolve; });
        };
        canRequestMarketData = function() { return true; };
        state.tab = 'index';
        state.mode = 'index';
        state.id = 'sh';
        state.rawData.sh = [{ date: '2026-06-29', open: 130, high: 132, low: 129, close: 130, vol: 1000, amt: 10000 }];
        var staleBatchPromise = refreshSidebarRealtime();
        var reusedBatchPromise = refreshSidebarRealtime();
        state.tab = 'stock';
        state.mode = 'stock';
        state.id = null;
        state.stockId = null;
        state.watchlist = [];
        resolveRealtimeBatch({
            sh: { date: '2026-06-30', open: 131, high: 136, low: 130, close: 135, prevClose: 130, vol: 3000, amt: 30000, quoteTime: '2026-06-30 10:30:00', quoteDateSource: 'api' }
        });
    `, context);
    const result = await vm.runInContext(`Promise.all([staleBatchPromise, reusedBatchPromise]).then(function(results) {
        return {
            statuses: results.map(function(item) { return item.status; }),
            realtimeRequestCount,
            leftSnapshot: state.refreshSnapshots.leftList,
            liveQuote: state.liveQuotes.sh || null
        };
    })`, context);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(result)), {
        statuses: ['stale', 'stale'],
        realtimeRequestCount: 1,
        leftSnapshot: null,
        liveQuote: null
    });
});

runTest('background refresh applies live overlay after active memory cache shortcut', async () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    const instrumentedDataSource = dataSource
        .replace(/function getBJDate\(\) \{ return new Date\(new Date\(\)\.toLocaleString\("en-US", \{timeZone: "Asia\/Shanghai"\}\)\); \}/, "function getBJDate() { return new Date('2026-06-29T10:30:00+08:00'); }")
        .replace(/function dbGet\(id\) \{[\s\S]*?\n\}/, "function dbGet(id) { return Promise.resolve({ data: cachedRows }); }")
        .replace(/function dbSet\(id, data\) \{[\s\S]*?\n\}/, "function dbSet(id, data) { return Promise.resolve(); }")
        .replace(/async function syncDataWithHistory\(id\) \{[\s\S]*?\n\}/, "async function syncDataWithHistory(id) { return cachedRows.map(row => ({ ...row })); }");
    vm.runInContext(instrumentedDataSource, context);
    vm.runInContext(`
        var timeoutQueue = [];
        window.setTimeout = function(fn) { timeoutQueue.push(fn); return timeoutQueue.length; };
        clearTimeout = function() {};
        var frameQueue = [];
        requestAnimationFrame = function(fn) { frameQueue.push(fn); return frameQueue.length; };
        var applyCount = 0;
        var applyPath = '';
        var badgeRefreshCount = 0;
        var badgeRefreshMode = '';
        var badgeRefreshItemDate = '';
        var originalApplyActiveDataRefresh = applyActiveDataRefresh;
        applyActiveDataRefresh = function(id) {
            applyCount++;
            applyPath = originalApplyActiveDataRefresh(id);
            return applyPath;
        };
        renderMASelector = function() {};
        updateAllIndicators = function() {};
        draw = function() {};
        drawViewport = function() {};
        safeUpdateSidebar = function() {};
        renderIndexList = function() {};
        updateSidebarPriceOnly = function() {};
        ensureAnalysisPanelVisibleForRealtimeRefresh = function() {};
        updateNavCapsuleVisuals = function() {};
        updateDataStatusRefreshBadge = function(item, id, full) {
            badgeRefreshCount++;
            badgeRefreshMode = state.displayStatus[id].mode;
            badgeRefreshItemDate = item.date;
        };
        markRefreshTime = function() {};
        updateLeftMarketContext = function() {};
        var cachedRows = Array.from({ length: 31 }, function(_, i) {
            var close = 100 + i;
            return {
                date: i === 30 ? '2026-06-26' : '2026-05-' + String(i + 1).padStart(2, '0'),
                open: close - 0.5,
                high: close + 1,
                low: close - 1,
                close,
                vol: 1000 + i,
                amt: 10000 + i
            };
        });
        requestManager.fetchRealtimeWithThrottle = async function() {
            return { date: '2026-06-29', open: 130, high: 136, low: 129, close: 135, vol: 3000, amt: 30000 };
        };
        state.id = 'sh';
        state.mode = 'index';
        state.period = 'daily';
        setRawData('sh', cachedRows.map(row => ({ ...row })));
        setLiveBar('sh', { date: '2026-06-29', open: 130, high: 131, low: 129, close: 130, vol: 1000, amt: 10000 });
        state.charts = { main: {} };
        state.lockIdx = getActiveData().length - 1;
        var cardPrice = document.getElementById('cardPrice');
        cardPrice.querySelector = function(selector) {
            if (selector === '.header-meta-row .mono') return { textContent: '2026-06-29 | SH000001' };
            if (selector === '.price-main') return { textContent: '130.00', className: 'price-main mono up', classList: { add() {}, remove() {} } };
            if (selector === '.price-sub') return { textContent: '+1.00 (+0.78%)', className: 'price-sub mono up', classList: { add() {}, remove() {} } };
            if (selector === '.amt-row .val') return { textContent: '10万', className: 'val', classList: { add() {}, remove() {} } };
            return null;
        };
        cardPrice.querySelectorAll = function(selector) {
            if (selector === '.data-box-row .val') {
                return [
                    { textContent: '130.00', className: 'val', classList: { add() {}, remove() {} } },
                    { textContent: '131.00', className: 'val', classList: { add() {}, remove() {} } },
                    { textContent: '129.00', className: 'val', classList: { add() {}, remove() {} } },
                    { textContent: '1万手', className: 'val', classList: { add() {}, remove() {} } }
                ];
            }
            return [];
        };
    `, context);
    await vm.runInContext('cachedFetch("sh")', context);
    await vm.runInContext('cachedFetchRefreshJobs.get("sh")', context);
    vm.runInContext('timeoutQueue.shift()(); frameQueue.shift()();', context);
    assert.deepStrictEqual(JSON.parse(vm.runInContext(`JSON.stringify({
        liveClose: state.liveBars.sh.close,
        activeClose: getActiveData()[getActiveData().length - 1].close,
        confirmedClose: state.rawData.sh[state.rawData.sh.length - 1].close,
        applyCount,
        applyPath,
        badgeRefreshCount,
        badgeRefreshMode,
        badgeRefreshItemDate
    })`, context)), {
        liveClose: 135,
        activeClose: 135,
        confirmedClose: 130,
        applyCount: 1,
        applyPath: 'same-day-light',
        badgeRefreshCount: 1,
        badgeRefreshMode: 'live-overlay',
        badgeRefreshItemDate: '2026-06-29'
    });
});

runTest('watchlist snapshot cache prevents full decision recompute when opening the stock chart', async () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    const instrumentedDataSource = dataSource
        .replace(/function dbGet\(id\) \{[\s\S]*?\n\}/, "function dbGet(id) { return Promise.resolve({ data: cachedRows }); }")
        .replace(/function scheduleCachedFetchRefresh\(id\) \{[\s\S]*?\n\}/, "function scheduleCachedFetchRefresh(id) { scheduledRefreshIds.push(id); return Promise.resolve(); }");
    vm.runInContext(instrumentedDataSource, context);
    vm.runInContext(calcSource, context);
    vm.runInContext(appSourceNoInit, context);
    vm.runInContext(`
        var scheduledRefreshIds = [];
        var frameQueue = [];
        requestAnimationFrame = function(fn) { frameQueue.push(fn); return frameQueue.length; };
        draw = function() {};
        safeUpdateSidebar = function() {};
        renderMASelector = function() {};
        scheduleWatchlistRender = function() {};
        markRefreshTime = function() {};

        var secid = '1.600519';
        var memoryRows = Array.from({ length: 100 }, function(_, i) {
            var close = 1400 + i * 2;
            return {
                date: '2026-03-' + String(i + 1).padStart(2, '0'),
                open: close - 3,
                high: close + 8,
                low: close - 7,
                close,
                vol: 10000 + i * 100,
                amt: close * (10000 + i * 100)
            };
        });
        var cachedRows = memoryRows.map(function(item) { return { ...item }; });
        state.mode = 'stock';
        state.period = 'daily';
        state.strategy = '稳健趋势型';
        state.id = secid;
        state.stockId = '600519';
        state.rawData[secid] = memoryRows;
        state.weeklyData[secid] = convertDailyToWeekly(memoryRows);

        syncWatchlistSignalSnapshot('600519', memoryRows);
        resetIndicatorState();
        state.charts = {};

        var decisionRecomputeIdxs = [];
        var originalComputeDecisionForIndex = computeDecisionForIndex;
        computeDecisionForIndex = function(idx, full, prevPos) {
            decisionRecomputeIdxs.push(idx);
            return originalComputeDecisionForIndex(idx, full, prevPos);
        };
    `, context);
    await vm.runInContext('cachedFetch(secid)', context);
    assert.deepStrictEqual(JSON.parse(vm.runInContext('JSON.stringify(decisionRecomputeIdxs)', context)), []);
    assert.strictEqual(vm.runInContext('!!state.indicators.macd', context), true);
    assert.strictEqual(vm.runInContext('frameQueue.length', context), 1);
    assert.deepStrictEqual(JSON.parse(vm.runInContext('JSON.stringify(scheduledRefreshIds)', context)), ['1.600519']);
});

runTest('active memory restore reuses current row decisions when derived cache is missing', async () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    const instrumentedDataSource = dataSource
        .replace(/function dbGet\(id\) \{[\s\S]*?\n\}/, "function dbGet(id) { return Promise.resolve({ data: cachedRows }); }")
        .replace(/function scheduleCachedFetchRefresh\(id\) \{[\s\S]*?\n\}/, "function scheduleCachedFetchRefresh(id) { scheduledRefreshIds.push(id); return Promise.resolve(); }");
    vm.runInContext(instrumentedDataSource, context);
    vm.runInContext(calcSource, context);
    vm.runInContext(`
        var scheduledRefreshIds = [];
        var frameQueue = [];
        requestAnimationFrame = function(fn) { frameQueue.push(fn); return frameQueue.length; };
        draw = function() {};
        safeUpdateSidebar = function() {};
        renderMASelector = function() {};
        scheduleWatchlistRender = function() {};
        markRefreshTime = function() {};

        var secid = '1.600138';
        var memoryRows = Array.from({ length: 100 }, function(_, i) {
            var close = 8 + i * 0.05;
            return {
                date: '2026-04-' + String(i + 1).padStart(2, '0'),
                open: close - 0.02,
                high: close + 0.08,
                low: close - 0.07,
                close,
                vol: 10000 + i * 100,
                amt: close * (10000 + i * 100)
            };
        });
        state.mode = 'stock';
        state.period = 'daily';
        state.strategy = '稳健趋势型';
        state.id = secid;
        state.stockId = '600138';
        state.rawData[secid] = memoryRows;
        state.weeklyData[secid] = convertDailyToWeekly(memoryRows);
        updateAllIndicators();
        var cachedRows = memoryRows.map(function(item) {
            return {
                date: item.date,
                open: item.open,
                high: item.high,
                low: item.low,
                close: item.close,
                vol: item.vol,
                amt: item.amt
            };
        });

        resetIndicatorState();
        derivedIndicatorCache.clear();
        state.charts = {};

        var decisionRecomputeIdxs = [];
        var originalComputeDecisionForIndex = computeDecisionForIndex;
        computeDecisionForIndex = function(idx, full, prevPos) {
            decisionRecomputeIdxs.push(idx);
            return originalComputeDecisionForIndex(idx, full, prevPos);
        };
    `, context);
    await vm.runInContext('cachedFetch(secid)', context);
    assert.deepStrictEqual(JSON.parse(vm.runInContext('JSON.stringify(decisionRecomputeIdxs)', context)), []);
    assert.strictEqual(vm.runInContext('!!state.indicators.macd', context), true);
    assert.strictEqual(vm.runInContext('frameQueue.length', context), 1);
    assert.deepStrictEqual(JSON.parse(vm.runInContext('JSON.stringify(scheduledRefreshIds)', context)), ['1.600138']);
});

runTest('startup selects default index before background hydration rerenders index list', async () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(dataSource, context);
    vm.runInContext(appSourceNoInit, context);
    vm.runInContext(`
        var events = [];
        var timers = [];
        setInterval = function() { return 1; };
        clearInterval = function() {};
        setTimeout = function(fn) { timers.push(fn); return timers.length; };
        requestAnimationFrame = function(fn) { return 1; };
        requestIdleCallback = function(fn) { timers.push(function() { fn({ didTimeout: false, timeRemaining: function() { return 20; } }); }); return timers.length; };
        window.addEventListener = function() {};
        openDB = async function() { events.push('openDB'); };
        loadWatchlist = async function() { state.watchlist = []; events.push('loadWatchlist'); };
        dbGet = async function(id) { events.push('dbGet:' + id); return null; };
        hydrateLiveOverlayCacheState = function() { events.push('hydrate-live-cache'); return {}; };
        renderMASelector = function() { events.push('renderMA'); };
        startSidebarFullSync = function() { events.push('startFullSync'); };
        isMarketOpen = function() { return true; };
        refreshWatchlistSignalSnapshots = function() {};
        var rowsA = Array.from({ length: 60 }, function(_, i) {
            return { date: '2026-05-' + String((i % 28) + 1).padStart(2, '0'), open: 100, high: 101, low: 99, close: 100 + i, vol: 1, amt: 1 };
        });
        var rowsB = rowsA.map(function(row, i) { return { ...row, close: 200 + i }; });
        preloadCacheOnly = async function() {
            events.push('preload:start');
            setRawData('sz', rowsA.map(function(row) { return { ...row }; }));
            events.push('preload:end');
        };
        ensureMarketTemperatureData = async function() {
            events.push('ensure:start');
            setRawData('cyb', rowsB.map(function(row) { return { ...row }; }));
            events.push('ensure:end');
        };
        renderIndexList = function() {
            events.push('renderIndex:sz=' + !!state.rawData.sz + ',cyb=' + !!state.rawData.cyb);
        };
        refreshSidebarRealtime = async function() {
            events.push('refreshRealtime:sz=' + !!state.rawData.sz + ',cyb=' + !!state.rawData.cyb);
        };
        _selectIndexImpl = async function(id) {
            events.push('select:' + id + ':sz=' + !!state.rawData.sz + ',cyb=' + !!state.rawData.cyb);
        };
        async function flushTimers() {
            while (timers.length) {
                var fn = timers.shift();
                await fn();
            }
        }
    `, context);
    await vm.runInContext('init()', context);
    await vm.runInContext('flushTimers()', context);
    const events = JSON.parse(vm.runInContext('JSON.stringify(events)', context));
    const hydratedRenderIndex = events.indexOf('renderIndex:sz=true,cyb=true');
    const firstRealtimeIndex = events.indexOf('refreshRealtime:sz=true,cyb=true');
    const selectIndex = events.findIndex(event => event.startsWith('select:sh'));
    assert.ok(hydratedRenderIndex >= 0, events.join(' > '));
    assert.ok(firstRealtimeIndex >= 0, events.join(' > '));
    assert.ok(selectIndex >= 0, events.join(' > '));
    assert.ok(events.indexOf('startFullSync') < selectIndex, events.join(' > '));
    assert.ok(selectIndex < hydratedRenderIndex, events.join(' > '));
    assert.ok(selectIndex < firstRealtimeIndex, events.join(' > '));
});

runTest('after-close startup confirms watchlist history after cache preload', async () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(dataSource, context);
    vm.runInContext(appSourceNoInit, context);
    vm.runInContext(`
        var events = [];
        var timers = [];
        setTimeout = function(fn) { timers.push(fn); return timers.length; };
        requestIdleCallback = function(fn) {
            timers.push(function() { return fn({ didTimeout: false, timeRemaining: function() { return 20; } }); });
            return timers.length;
        };
        state.mode = 'stock';
        state.tab = 'stock';
        state.watchlist = [{ code: '600519', name: '贵州茅台', secid: '1.600519' }];
        document.hidden = false;
        isMarketOpen = function() { return false; };
        preloadCacheOnly = async function() { events.push('preload'); };
        updateAllWatchlistData = async function() { events.push('watchlist-history'); };
        refreshWatchlistSignalSnapshots = async function() { events.push('snapshots'); };
        ensureMarketTemperatureData = async function() { events.push('ensure'); };
        async function flushTimers() {
            while (timers.length) {
                var fn = timers.shift();
                await fn();
            }
        }
    `, context);
    await vm.runInContext('scheduleStartupBackgroundHydration(); flushTimers()', context);
    const events = JSON.parse(vm.runInContext('JSON.stringify(events)', context));
    assert.deepStrictEqual(events.slice(0, 2), ['preload', 'watchlist-history']);
    assert.strictEqual(events.includes('snapshots'), false);
});

runTest('refresh schedulers start only once', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(dataSource, context);
    vm.runInContext(appSourceNoInit, context);
    const result = JSON.parse(vm.runInContext(`
        var schedulerCalls = { intervals: 0, timeouts: 0, visibility: 0, fullSync: 0 };
        setInterval = function() { schedulerCalls.intervals++; return schedulerCalls.intervals; };
        setTimeout = function() { schedulerCalls.timeouts++; return schedulerCalls.timeouts; };
        document.addEventListener = function(type) {
            if (type === 'visibilitychange') schedulerCalls.visibility++;
        };
        startSidebarFullSync = function() { schedulerCalls.fullSync++; };
        startRefreshSchedulers();
        startRefreshSchedulers();
        JSON.stringify(schedulerCalls);
    `, context));
    assert.deepStrictEqual(result, { intervals: 2, timeouts: 1, visibility: 1, fullSync: 1 });
});

runTest('active chart scheduler reuses a fresh sidebar batch but keeps periodic history checks', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(dataSource, context);
    vm.runInContext(appSourceNoInit, context);
    const result = JSON.parse(vm.runInContext(`
        state.rawData.sh = [{ date: '2026-06-29', open: 100, high: 101, low: 99, close: 100, vol: 1, amt: 1 }];
        state.realtimeBatchAt.sh = Date.now();
        state.activeHistoryRefreshAt.sh = Date.now();
        var skipped = shouldSkipScheduledActiveRefresh('sh');
        state.activeHistoryRefreshAt.sh = Date.now() - SYS_CONFIG.THROTTLE_MS * 6;
        var periodicCheck = shouldSkipScheduledActiveRefresh('sh');
        JSON.stringify({ skipped, periodicCheck });
    `, context));
    assert.deepStrictEqual(result, { skipped: true, periodicCheck: false });
});

runTest('sidebar full history sync waits for the current realtime batch', async () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(dataSource, context);
    vm.runInContext(appSourceNoInit, context);
    const result = JSON.parse(await vm.runInContext(`
        (async function() {
            var releaseRealtime;
            var realtimeBatch = new Promise(function(resolve) { releaseRealtime = resolve; });
            sidebarRealtimeInFlight = realtimeBatch;
            state.tab = 'index';
            state.mode = 'index';
            state.id = 'sh';
            isMarketOpen = function() { return true; };
            canRequestMarketData = function() { return true; };
            var syncCalls = 0;
            syncData = async function() { syncCalls++; return []; };
            setRawData = function() {};
            renderIndexList = function() {};
            markLeftListRefreshForActiveTab = function() {};
            var fullSync = runSidebarFullSync();
            await Promise.resolve();
            var callsWhileRealtimeIsPending = syncCalls;
            releaseRealtime();
            await fullSync;
            return JSON.stringify({ callsWhileRealtimeIsPending, syncCalls });
        })()
    `, context));
    assert.deepStrictEqual(result, { callsWhileRealtimeIsPending: 0, syncCalls: 7 });
});

runTest('sidebar full history sync never overlaps a still-running cycle', async () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(dataSource, context);
    vm.runInContext(appSourceNoInit, context);
    vm.runInContext(`
        var releaseSidebarSync;
        var sidebarSyncGate = new Promise(function(resolve) { releaseSidebarSync = resolve; });
        var sidebarSyncCalls = 0;
        var sidebarRows = Array.from({ length: 40 }, function(_, index) {
            return { date: '2026-07-' + String((index % 28) + 1).padStart(2, '0'), open: 100, high: 102, low: 99, close: 101, vol: 10, amt: 1000 };
        });
        state.tab = 'index';
        state.mode = 'index';
        state.id = 'sh';
        isMarketOpen = function() { return true; };
        canRequestMarketData = function() { return true; };
        syncData = async function() { sidebarSyncCalls++; await sidebarSyncGate; return sidebarRows; };
        dbSet = async function() {};
        renderIndexList = function() {};
        markLeftListRefreshForActiveTab = function() {};
        firstSidebarSync = runSidebarFullSync();
        secondSidebarSync = runSidebarFullSync();
    `, context);
    await new Promise(resolve => setTimeout(resolve, 0));
    const during = JSON.parse(vm.runInContext('JSON.stringify({ calls: sidebarSyncCalls, runtime: window.__DG_SIDEBAR_FULL_SYNC__ })', context));
    assert.strictEqual(during.calls, 3);
    assert.strictEqual(during.runtime.inFlight, true);
    assert.strictEqual(during.runtime.runCount, 1);
    assert.strictEqual(during.runtime.skippedCount, 1);
    vm.runInContext('releaseSidebarSync()', context);
    await vm.runInContext('Promise.all([firstSidebarSync, secondSidebarSync])', context);
    const after = JSON.parse(vm.runInContext('JSON.stringify({ calls: sidebarSyncCalls, runtime: window.__DG_SIDEBAR_FULL_SYNC__ })', context));
    assert.strictEqual(after.calls, 7, 'the one accepted cycle should still cover the seven non-active indices');
    assert.strictEqual(after.runtime.inFlight, false);
    assert.strictEqual(after.runtime.runCount, 1);
    assert.strictEqual(after.runtime.skippedCount, 1);
    assert.ok(after.runtime.completedAt >= after.runtime.startedAt);
});

runTest('startup failures end the blocking loader in a retryable terminal state', async () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(dataSource, context);
    vm.runInContext(appSourceNoInit, context);
    const result = JSON.parse(await vm.runInContext(`
        (async function() {
            var stoppedReason = '';
            var shownError = '';
            console.error = function() {};
            init = async function() { throw new Error('startup denied'); };
            stopRefreshSchedulers = function(reason) { stoppedReason = reason; };
            showStartupError = function(error) { shownError = error.message; };
            var ok = await startDailyGlanceApplication();
            return JSON.stringify({ ok: ok, stoppedReason: stoppedReason, shownError: shownError });
        })()
    `, context));
    assert.deepStrictEqual(result, { ok: false, stoppedReason: 'startup-error', shownError: 'startup denied' });
});

runTest('leaving the external workspace cancels observation tasks before selecting market data', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(dataSource, context);
    vm.runInContext(appSourceNoInit, context);
    const events = JSON.parse(vm.runInContext(`
        var workspaceEvents = [];
        state.tab = 'external';
        state.mode = 'external';
        cancelExternalObservationTasks = function(reason) { workspaceEvents.push('cancel:' + reason); };
        setPrimaryWorkspace = function(tab) { workspaceEvents.push('workspace:' + tab); };
        selectIndex = function(id) { workspaceEvents.push('select:' + id); };
        openMarketWorkspace('index');
        JSON.stringify(workspaceEvents);
    `, context));
    assert.deepStrictEqual(events, ['cancel:workspace-leave', 'workspace:index', 'select:sh']);
});

runTest('bfcache pagehide stops refresh handles and persisted pageshow starts one fresh scheduler set', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(dataSource, context);
    vm.runInContext(appSourceNoInit, context);
    const result = JSON.parse(vm.runInContext(`
        var nextHandle = 0;
        var clearedIntervals = [];
        var clearedTimeouts = [];
        var lifecycleEvents = [];
        setInterval = function() { return ++nextHandle; };
        setTimeout = function() { return ++nextHandle; };
        clearInterval = function(handle) { clearedIntervals.push(handle); };
        clearTimeout = function(handle) { clearedTimeouts.push(handle); };
        document.addEventListener = function(type) { lifecycleEvents.push('add:' + type); };
        document.removeEventListener = function(type) { lifecycleEvents.push('remove:' + type); };
        window.addEventListener = function(type) { lifecycleEvents.push('window-add:' + type); };
        window.removeEventListener = function(type) { lifecycleEvents.push('window-remove:' + type); };
        startSidebarFullSync = function() { lifecycleEvents.push('full:start'); };
        stopSidebarFullSync = function() { lifecycleEvents.push('full:stop'); };
        cancelExternalObservationTasks = function(reason) { lifecycleEvents.push('cancel:' + reason); };
        refreshSidebarRealtime = function() { lifecycleEvents.push('realtime'); };
        cachedFetch = function() { lifecycleEvents.push('active'); };
        isMarketOpen = function() { return false; };
        initMarketRefreshLeadership();
        startRefreshSchedulers();
        handleRefreshPageHide({ persisted: true });
        handleRefreshPageShow({ persisted: true });
        JSON.stringify({
            started: window.__DG_REFRESH_SCHEDULERS_STARTED__,
            intervalCount: refreshSchedulerRuntime.intervals.size,
            timeoutCount: refreshSchedulerRuntime.timeouts.size,
            restartCount: refreshSchedulerRuntime.restartCount,
            leadershipStarted: marketRefreshLeadershipRuntime.started,
            leadershipHeartbeatActive: marketRefreshLeadershipRuntime.heartbeatActive,
            clearedIntervals: clearedIntervals,
            clearedTimeouts: clearedTimeouts,
            events: lifecycleEvents
        });
    `, context));
    assert.strictEqual(result.started, true);
    assert.strictEqual(result.intervalCount, 2);
    assert.strictEqual(result.timeoutCount, 1);
    assert.strictEqual(result.restartCount, 1);
    assert.strictEqual(result.leadershipStarted, true);
    assert.strictEqual(result.leadershipHeartbeatActive, true);
    assert.strictEqual(result.clearedIntervals.length, 3);
    assert.strictEqual(result.clearedTimeouts.length, 1);
    assert.deepStrictEqual(result.events, [
        'window-add:focus', 'window-add:pagehide', 'window-add:storage', 'add:visibilitychange',
        'full:start', 'add:visibilitychange', 'remove:visibilitychange',
        'window-remove:focus', 'window-remove:pagehide', 'window-remove:storage', 'remove:visibilitychange',
        'full:stop', 'cancel:bfcache',
        'window-add:focus', 'window-add:pagehide', 'window-add:storage', 'add:visibilitychange',
        'full:start', 'add:visibilitychange'
    ]);
});

runTest('hidden lifecycle cancels external observation work without refreshing data', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(dataSource, context);
    vm.runInContext(appSourceNoInit, context);
    const result = JSON.parse(vm.runInContext(`
        var hiddenEvents = [];
        cancelExternalObservationTasks = function(reason) { hiddenEvents.push('cancel:' + reason); };
        refreshSectorTrendSnapshot = function() { hiddenEvents.push('sector'); return Promise.resolve(); };
        refreshExternalLeadStripSnapshot = function() { hiddenEvents.push('lead'); return Promise.resolve(); };
        refreshSidebarRealtime = function() { hiddenEvents.push('sidebar'); };
        cachedFetch = function() { hiddenEvents.push('active'); };
        state.tab = 'external';
        state.mode = 'external';
        document.hidden = true;
        handleRefreshVisibilityChange();
        JSON.stringify(hiddenEvents);
    `, context));
    assert.deepStrictEqual(result, ['cancel:hidden']);
});

runTest('startup market hydration refreshes stale index caches even when row count is enough', async () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    const fixedClockDataSource = dataSource
        .replace(/function getBJDate\(\) \{ return new Date\(new Date\(\)\.toLocaleString\("en-US", \{timeZone: "Asia\/Shanghai"\}\)\); \}/, "function getBJDate() { return new Date('2026-06-30T10:30:00+08:00'); }");
    vm.runInContext(fixedClockDataSource, context);
    vm.runInContext(`
        var syncedIds = [];
        function makeRows(lastDate, offset) {
            return Array.from({ length: 61 }, function(_, i) {
                var d = new Date('2026-03-01T00:00:00Z');
                d.setUTCDate(d.getUTCDate() + i);
                var date = i === 60 ? lastDate : d.toISOString().slice(0, 10);
                var close = 100 + (offset || 0) + i;
                return {
                    date,
                    open: close - 0.5,
                    high: close + 1,
                    low: close - 1,
                    close,
                    vol: 1000 + i,
                    amt: 10000 + i
                };
            });
        }
        syncData = async function(id) {
            syncedIds.push(id);
            return makeRows('2026-06-29', 500);
        };
        dbSet = async function() {};
        updateAllIndicators = function() {};
        safeUpdateSidebar = function() {};
        state.mode = 'index';
        state.id = 'sh';
        setRawData('sh', makeRows('2026-06-26', 0));
        setRawData('hs300', makeRows('2026-06-29', 100));
        setRawData('zz500', makeRows('2026-06-29', 200));
        setRawData('zz1000', makeRows('2026-06-29', 300));
        setRawData('sz', makeRows('2026-06-29', 400));
        setRawData('cy', makeRows('2026-06-29', 500));
        setRawData('kc50', makeRows('2026-06-29', 600));
        setRawData('bz50', makeRows('2026-06-29', 700));
    `, context);
    await vm.runInContext('ensureMarketTemperatureData()', context);
    const result = JSON.parse(vm.runInContext(`JSON.stringify({
        syncedIds,
        shLastDate: state.rawData.sh[state.rawData.sh.length - 1].date
    })`, context));
    assert.deepStrictEqual(result, {
        syncedIds: ['sh'],
        shLastDate: '2026-06-29'
    });
});

runTest('realtime sidebar refresh defers weekly live overlay conversion during daily view', async () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    const fixedClockDataSource = dataSource
        .replace(/function getBJDate\(\) \{ return new Date\(new Date\(\)\.toLocaleString\("en-US", \{timeZone: "Asia\/Shanghai"\}\)\); \}/, "function getBJDate() { return new Date('2026-06-30T10:30:00+08:00'); }");
    vm.runInContext(fixedClockDataSource, context);
    vm.runInContext('function markIndicatorsDirty() { state.indicatorKey = ""; }', context);
    vm.runInContext(appSourceNoInit, context);
    vm.runInContext(`
        batchGetRealtimePrices = async function(ids) {
            return {
                sh: { date: '2026-06-30', open: 131, high: 136, low: 130, close: 135, prevClose: 130, vol: 3000, amt: 30000, quoteTime: '2026-06-30 10:30:00', quoteDateSource: 'api' },
                cy: { date: '2026-06-30', open: 231, high: 236, low: 230, close: 235, prevClose: 230, vol: 4000, amt: 40000, quoteTime: '2026-06-30 10:30:00', quoteDateSource: 'api' }
            };
        };
        renderMASelector = function() {};
        updateAllIndicators = function() {};
        draw = function() {};
        drawViewport = function() {};
        safeUpdateSidebar = function() {};
        refreshIndexListQuotes = function() {};
        refreshWatchlistQuotes = function() {};
        markRefreshTime = function() {};
        var shRows = Array.from({ length: 31 }, function(_, i) {
            var close = 100 + i;
            return {
                date: i === 30 ? '2026-06-29' : '2026-05-' + String(i + 1).padStart(2, '0'),
                open: close - 0.5,
                high: close + 1,
                low: close - 1,
                close,
                vol: 1000 + i,
                amt: 10000 + i
            };
        });
        var cyRows = shRows.map(function(row) { return { ...row, close: row.close + 100, open: row.open + 100, high: row.high + 100, low: row.low + 100 }; });
        state.id = 'sh';
        state.mode = 'index';
        state.tab = 'index';
        state.period = 'daily';
        state.charts = { main: {} };
        setRawData('sh', shRows);
        setRawData('cy', cyRows);
        setLockIdx(state.rawData.sh.length - 1);
        var weeklyConvertCount = 0;
        var originalConvertDailyToWeekly = convertDailyToWeekly;
        convertDailyToWeekly = function() {
            weeklyConvertCount++;
            return originalConvertDailyToWeekly.apply(this, arguments);
        };
    `, context);
    await vm.runInContext('refreshSidebarRealtime()', context);
    const result = JSON.parse(vm.runInContext(`JSON.stringify({
        weeklyConvertCount,
        liveWeeklyKeys: Object.keys(state.liveWeeklyData || {}),
        liveDates: Object.fromEntries(Object.entries(state.liveBars || {}).map(([id, row]) => [id, row.date]))
    })`, context));
    assert.deepStrictEqual(result, {
        weeklyConvertCount: 0,
        liveWeeklyKeys: [],
        liveDates: { sh: '2026-06-30', cy: '2026-06-30' }
    });
});

runTest('cached sidebar hit still refreshes the data status badge', () => {
    const context = makeBrowserContext();
    const bar = {
        style: {},
        appended: [],
        statusEl: null,
        querySelector(sel) {
            if (sel === '.data-status-pill') return this.statusEl;
            return null;
        },
        insertAdjacentHTML(_pos, html) {
            this.appended.push(html);
            this.statusEl = { outerHTML: html };
        }
    };
    const price = {
        style: {},
        dataset: {},
        innerHTML: '<div class="terminal-block">cached</div>',
        offsetHeight: 1,
        querySelector() { return null; }
    };
    const analysis = {
        style: {},
        dataset: {},
        innerHTML: '<div>analysis</div>',
        offsetHeight: 1,
        querySelector() { return null; }
    };
    context.document.getElementById = function(id) {
        if (id === 'lastRefreshBar') return bar;
        if (id === 'cardPrice') return price;
        if (id === 'cardAnalysis') return analysis;
        return null;
    };
    vm.runInContext(configSource, context);
    const fixedClockDataSource = dataSource
        .replace(/function getBJDate\(\) \{ return new Date\(new Date\(\)\.toLocaleString\("en-US", \{timeZone: "Asia\/Shanghai"\}\)\); \}/, "function getBJDate() { return new Date('2026-06-30T10:30:00+08:00'); }");
    vm.runInContext(fixedClockDataSource, context);
    vm.runInContext(renderSource, context);
    vm.runInContext(`
        state.id = 'sh';
        state.mode = 'index';
        state.period = 'daily';
        state.rawData.sh = [{ date: '2026-06-29', open: 100, high: 101, low: 99, close: 100, vol: 1000, amt: 10000 }];
        setLiveBar('sh', { date: '2026-06-30', open: 100, high: 103, low: 99, close: 102, vol: 1500, amt: 15000 });
        document.getElementById('cardPrice').dataset.key = 'same-cache-key';
        applySidebarHTML({ priceHtml: '<div>cached</div>', analysisHtml: '<div>analysis</div>', isHide: false }, 'same-cache-key');
    `, context);
    assert.ok(bar.statusEl, 'expected cache-hit sidebar path to render status badge');
    assert.ok(bar.statusEl.outerHTML.includes('盘中临时'), bar.statusEl.outerHTML);
    assert.ok(bar.statusEl.outerHTML.includes('title="实时价已进入图表。"'), bar.statusEl.outerHTML);
});

runTest('chart hover throttles sidebar refresh while keeping crosshair immediate', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(dataSource, context);
    vm.runInContext(renderSource, context);
    vm.runInContext(`
        var now = 1000;
        Date.now = function() { return now; };
        var timers = [];
        setTimeout = function(fn, delay) {
            timers.push({ fn: fn, delay: delay, cancelled: false });
            return timers.length;
        };
        clearTimeout = function(id) {
            if (timers[id - 1]) timers[id - 1].cancelled = true;
        };
        var frameQueue = [];
        var cancelledFrames = new Set();
        var nextFrameId = 1;
        requestAnimationFrame = function(fn) {
            var id = nextFrameId++;
            frameQueue.push({ id: id, fn: fn });
            return id;
        };
        cancelAnimationFrame = function(id) { cancelledFrames.add(id); };
        function drainFrames() {
            while (frameQueue.length) {
                var item = frameQueue.shift();
                if (!cancelledFrames.has(item.id)) item.fn();
            }
        }

        var crosshairCalls = 0;
        var sidebarDates = [];
        var badgeCalls = 0;
        updateCrosshairOverlay = function() { crosshairCalls++; };
        updateFreezeBadge = function() { badgeCalls++; };
        safeUpdateSidebar = function() {
            var rd = getActiveData();
            sidebarDates.push(rd[getSafeIndex(rd)].date);
        };
        state.id = 'sh';
        state.period = 'daily';
        state.range = 90;
        state.rawData.sh = [
            { date: '2026-06-24', close: 1 },
            { date: '2026-06-25', close: 2 },
            { date: '2026-06-26', close: 3 },
            { date: '2026-06-29', close: 4 }
        ];
        state.lockIdx = 3;
        state.isFrozen = false;

        handleChartHover({ type: 'mousemove' }, [{ index: 2 }]);
        drainFrames();
        handleChartHover({ type: 'mousemove' }, [{ index: 1 }]);
        handleChartHover({ type: 'mousemove' }, [{ index: 0 }]);
        var beforeTimer = {
            lockIdx: state.lockIdx,
            crosshairCalls: crosshairCalls,
            badgeCalls: badgeCalls,
            sidebarDates: sidebarDates.slice(),
            timerCount: timers.length,
            timerDelay: timers[0] && timers[0].delay
        };
        now += 60;
        timers.forEach(function(timer) { if (!timer.cancelled) timer.fn(); });
        drainFrames();
        var afterTimer = {
            lockIdx: state.lockIdx,
            crosshairCalls: crosshairCalls,
            badgeCalls: badgeCalls,
            sidebarDates: sidebarDates.slice()
        };
    `, context);
    assert.deepStrictEqual(JSON.parse(vm.runInContext('JSON.stringify(beforeTimer)', context)), {
        lockIdx: 0,
        crosshairCalls: 3,
        badgeCalls: 3,
        sidebarDates: ['2026-06-26'],
        timerCount: 1,
        timerDelay: 48
    });
    assert.deepStrictEqual(JSON.parse(vm.runInContext('JSON.stringify(afterTimer)', context)), {
        lockIdx: 0,
        crosshairCalls: 3,
        badgeCalls: 3,
        sidebarDates: ['2026-06-26', '2026-06-24']
    });
});

runTest('latest button cancels pending hover sidebar sync before restoring latest', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(dataSource, context);
    vm.runInContext(renderSource, context);
    vm.runInContext(appSourceNoInit, context);
    vm.runInContext(`
        var frameQueue = [];
        var cancelledFrames = new Set();
        var nextFrameId = 1;
        requestAnimationFrame = function(fn) {
            var id = nextFrameId++;
            frameQueue.push({ id: id, fn: fn });
            return id;
        };
        cancelAnimationFrame = function(id) { cancelledFrames.add(id); };
        function drainFrames() {
            while (frameQueue.length) {
                var item = frameQueue.shift();
                if (!cancelledFrames.has(item.id)) item.fn();
            }
        }

        var btnClasses = new Set(['btn-sm', 'is-history']);
        var btn = {
            get className() { return Array.from(btnClasses).join(' '); },
            classList: {
                add(name) { btnClasses.add(name); },
                remove(name) { btnClasses.delete(name); }
            }
        };
        document.getElementById = function(id) { return id === 'btnResetLatest' ? btn : null; };
        clearStaleTooltips = function() {};
        updateFreezeBadge = function() {};
        updateCrosshairOverlay = function() {};
        safeUpdateSidebar = function() {
            var rd = getActiveData();
            var idx = getSafeIndex(rd);
            renderedDate = rd[idx].date;
            updateNavCapsuleVisuals(idx, rd.length);
        };
        var renderedDate = '';

        state.id = 'sh';
        state.period = 'daily';
        state.range = 90;
        state.rawData.sh = [
            { date: '2026-06-24', open: 1, high: 1, low: 1, close: 1, vol: 1, amt: 1 },
            { date: '2026-06-25', open: 1, high: 1, low: 1, close: 1, vol: 1, amt: 1 },
            { date: '2026-06-26', open: 1, high: 1, low: 1, close: 1, vol: 1, amt: 1 }
        ];
        state.lockIdx = 1;
        state.isFrozen = false;
        pendingHoverIdx = 0;
        hoverRAF = requestAnimationFrame(function() { refreshHoverSelection(); });

        resetLatest();
        handleChartHover({ type: 'mousemove' }, [{ index: 0 }]);
        drainFrames();
        var latestClickClassAfterFrames = btn.className;
        var latestRenderedDateAfterFrames = renderedDate;
    `, context);
    assert.strictEqual(vm.runInContext('state.lockIdx', context), 2);
    assert.strictEqual(vm.runInContext('latestRenderedDateAfterFrames', context), '2026-06-26');
    assert.ok(vm.runInContext('latestClickClassAfterFrames.includes("active")', context));
    assert.ok(!vm.runInContext('latestClickClassAfterFrames.includes("is-history")', context));
});

runTest('next day reaching latest suppresses stale hover sidebar sync', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(dataSource, context);
    vm.runInContext(renderSource, context);
    vm.runInContext(appSourceNoInit, context);
    vm.runInContext(`
        var frameQueue = [];
        var cancelledFrames = new Set();
        var nextFrameId = 1;
        requestAnimationFrame = function(fn) {
            var id = nextFrameId++;
            frameQueue.push({ id: id, fn: fn });
            return id;
        };
        cancelAnimationFrame = function(id) { cancelledFrames.add(id); };
        function drainFrames() {
            while (frameQueue.length) {
                var item = frameQueue.shift();
                if (!cancelledFrames.has(item.id)) item.fn();
            }
        }

        var btnClasses = new Set(['btn-sm', 'is-history']);
        var btn = {
            get className() { return Array.from(btnClasses).join(' '); },
            classList: {
                add(name) { btnClasses.add(name); },
                remove(name) { btnClasses.delete(name); }
            }
        };
        document.getElementById = function(id) { return id === 'btnResetLatest' ? btn : null; };
        clearStaleTooltips = function() {};
        updateFreezeBadge = function() {};
        updateCrosshairOverlay = function() {};
        drawViewport = function() {};
        safeUpdateSidebar = function() {
            var rd = getActiveData();
            var idx = getSafeIndex(rd);
            renderedDate = rd[idx].date;
            updateNavCapsuleVisuals(idx, rd.length);
        };
        var renderedDate = '';

        state.id = 'sh';
        state.period = 'daily';
        state.range = 90;
        state.rawData.sh = [
            { date: '2026-06-24', open: 1, high: 1, low: 1, close: 1, vol: 1, amt: 1 },
            { date: '2026-06-25', open: 1, high: 1, low: 1, close: 1, vol: 1, amt: 1 },
            { date: '2026-06-26', open: 1, high: 1, low: 1, close: 1, vol: 1, amt: 1 }
        ];
        state.lockIdx = 1;
        state.isFrozen = true;
        pendingHoverIdx = 0;
        hoverRAF = requestAnimationFrame(function() { refreshHoverSelection(); });

        nextDay();
        handleChartHover({ type: 'mousemove' }, [{ index: 0 }]);
        drainFrames();
        var nextDayLatestClassAfterFrames = btn.className;
        var nextDayRenderedDateAfterFrames = renderedDate;
    `, context);
    assert.strictEqual(vm.runInContext('state.lockIdx', context), 2);
    assert.strictEqual(vm.runInContext('state.isFrozen', context), false);
    assert.strictEqual(vm.runInContext('nextDayRenderedDateAfterFrames', context), '2026-06-26');
    assert.ok(vm.runInContext('nextDayLatestClassAfterFrames.includes("active")', context));
    assert.ok(!vm.runInContext('nextDayLatestClassAfterFrames.includes("is-history")', context));
});

runTest('main chart drag pans the viewport and syncs the sidebar on release', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(dataSource, context);
    vm.runInContext(renderSource, context);
    vm.runInContext(`
        state.id = 'sh';
        state.mode = 'index';
        state.period = 'daily';
        state.range = 90;
        state.rawData.sh = Array.from({ length: 200 }, function(_, i) {
            return { date: 'D' + String(i).padStart(3, '0') };
        });
        resetViewportToLatest(state.rawData.sh);
        setLockIdx(199);
        state.isFrozen = false;

        var mainBoxClasses = new Set();
        var mainBox = {
            classList: {
                add(name) { mainBoxClasses.add(name); },
                remove(name) { mainBoxClasses.delete(name); },
                contains(name) { return mainBoxClasses.has(name); }
            }
        };
        var canvas = {
            setPointerCapture() {},
            releasePointerCapture() {},
            closest() { return mainBox; }
        };
        state.charts.main = {
            data: { labels: Array.from({ length: 90 }, function(_, i) { return 'V' + i; }) },
            scales: { x: { width: 900, left: 0, right: 900 } }
        };
        var drawCalls = 0;
        var sidebarCalls = 0;
        var badgeCalls = 0;
        drawViewport = function() { drawCalls++; };
        safeUpdateSidebar = function() { sidebarCalls++; };
        updateFreezeBadge = function() { badgeCalls++; };
        updateCrosshairOverlay = function() {};
        clearStaleTooltips = function() {};

        startChartDragPan({ button: 0, clientX: 500, currentTarget: canvas, pointerId: 1, preventDefault() {} });
        moveChartDragPan({ clientX: 410, preventDefault() {} });
        finishChartDragPan({ pointerId: 1, currentTarget: canvas });

        var rangeAfterDrag = getVisibleRange(state.rawData.sh);
        var dragState = {
            frozen: state.isFrozen,
            lockIdx: state.lockIdx,
            viewport: state.viewport,
            drawCalls,
            sidebarCalls,
            badgeCalls,
            isDraggingClass: mainBoxClasses.has('drag-panning')
        };
    `, context);
    assert.deepStrictEqual(JSON.parse(vm.runInContext('JSON.stringify(rangeAfterDrag)', context)), { start: 101, end: 190, length: 90 });
    assert.deepStrictEqual(JSON.parse(vm.runInContext('JSON.stringify(dragState)', context)), {
        frozen: true,
        lockIdx: 190,
        viewport: { mode: 'pan', endIdx: 190, anchorIdx: 190 },
        drawCalls: 1,
        sidebarCalls: 1,
        badgeCalls: 1,
        isDraggingClass: false
    });
});

runTest('left list header exposes its own refresh timestamp', () => {
    assert.ok(configSource.includes('leftListRefreshAt: 0'), 'left list refresh time should be tracked separately from right panel refresh time');
    assert.ok(configSource.includes('refreshSnapshots:'), 'refresh timestamps should be backed by committed snapshots');
    assert.ok(configSource.includes('function beginRefreshTransaction('), 'refresh transactions should be explicit');
    assert.ok(configSource.includes('function commitRefreshSnapshot('), 'refresh snapshots should commit through one helper');
    assert.ok(configSource.includes('function renderLeftListHeader(title, options = {})'), 'left list header should support scoped refresh visibility');
    assert.ok(configSource.includes('列表刷新于 ${formatLeftListRefreshTime('), 'left list timestamp copy should scope the refresh to the list');
    assert.ok(configSource.includes('data-refresh-version'), 'left list timestamp should expose snapshot version for checks');
    assert.ok(appSource.includes("${renderLeftListHeader('市场与板块指数')}"), 'index list should show the left-list timestamp');
    assert.ok(appSource.includes('renderLeftListHeader(`自选股池 · ${state.watchlist.length}/${SYS_CONFIG.WATCHLIST_LIMIT}`)'), 'stock list should show the configured count and left-list timestamp');
    assert.ok(appSource.includes('renderLeftListHeader(`自选股池 · 0/${SYS_CONFIG.WATCHLIST_LIMIT}`, { showRefresh: false })'), 'empty stock list should show the configured limit and hide stale refresh time');
    assert.ok(appSource.includes('markLeftListRefreshForActiveTab(leftTxn'), 'realtime batch refresh should update the left-list timestamp after list values are applied');
    assert.ok(appSource.includes('if (activeOverlayChanged && !state.isFrozen) {') && appSource.includes('markRefreshTime(rightTxn'), 'right-panel refresh time should only move when right data is applied');
    assert.ok(cssSource.includes('.left-list-refresh-time'), 'left-list timestamp should have a lightweight style');
});

runTest('watchlist rerender keeps the search input node and active query intact', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(appSourceNoInit, context);
    vm.runInContext(`
        var searchBox = { value: '600' };
        var headerSlot = { innerHTML: '' };
        var itemsSlot = { innerHTML: '' };
        var stickyHead = {
            querySelector(selector) {
                if (selector === '.watchlist-header-slot') return headerSlot;
                if (selector === '.stock-search') return searchBox;
                return null;
            }
        };
        var containerWrites = 0;
        var stockNavContainer = {
            querySelector(selector) {
                if (selector === '.watchlist-sticky-head') return stickyHead;
                if (selector === '.watchlist-items') return itemsSlot;
                return null;
            },
            set innerHTML(value) { containerWrites++; },
            get innerHTML() { return ''; }
        };
        var originalGetElementById = document.getElementById;
        document.getElementById = function(id) {
            if (id === 'stockNavList') return stockNavContainer;
            return originalGetElementById.call(document, id);
        };
        state.watchlist = [];
        renderWatchlist();
        var searchPreserveResult = {
            containerWrites,
            query: searchBox.value,
            headerHtml: headerSlot.innerHTML,
            itemsHtml: itemsSlot.innerHTML
        };
    `, context);
    const result = vm.runInContext('searchPreserveResult', context);
    assert.strictEqual(result.containerWrites, 0, 'existing search shell should not be replaced during data refresh');
    assert.strictEqual(result.query, '600');
    assert.ok(result.headerHtml.includes('自选股池 · 0/'));
    assert.ok(result.itemsHtml.includes('watchlist-items-empty') && !result.itemsHtml.includes('还没有自选股'));
    assert.ok(cssSource.includes('.stock-search input:focus-visible { outline: none; }'), 'search focus should avoid the duplicate hard outline');
});

runTest('startup cache preload covers the full watchlist and rerenders the stock list', () => {
    assert.ok(!dataSource.includes('state.watchlist.slice(0, 5)'), 'startup cache preload should not leave later watchlist rows blank');
    assert.ok(appSource.includes("if (state.mode === 'stock' || state.tab === 'stock') {") && appSource.includes("renderWatchlist();"), 'stock tab should rerender after startup cache preload');
});

runTest('stock display names stay canonical across search suggestion selection and watchlist rendering', async () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(dataSource, context);
    vm.runInContext(appSourceNoInit, context);
    vm.runInContext(`
        var suggest = document.getElementById('stockSuggest');
        renderSuggest(suggest, [{ Code: '600519', Name: 'XD贵州茅' }]);
        var suggestHtml = suggest.innerHTML;

        state.watchlist = [];
        addToWatchlist('600519', 'XD贵州茅');
        var storedWatchlist = state.watchlist.map(item => ({ code: item.code, name: item.name }));

        state.watchlist = [{ code: '600519', name: 'XD贵州茅' }];
        state.mode = 'stock';
        state.stockId = '600519';
        renderWatchlist();
        var watchlistHtml = document.getElementById('stockNavList').innerHTML;

        state.watchlist = [];
        var savedDuringMigration = null;
        dbGet = async () => ({ data: [{ code: '600519', name: 'XD贵州茅' }] });
        dbSet = async (key, value) => { savedDuringMigration = { key, value }; throw new Error('quota'); };
        var genericNames = [
            normalizeStockDisplayName('688001', 'XR华兴源创'),
            normalizeStockDisplayName('688002', 'DR睿创微纳'),
            normalizeStockDisplayName('688003', 'XD天准科技')
        ];
    `, context);
    await vm.runInContext('loadWatchlist()', context);
    await vm.runInContext("addToWatchlist('600519', 'XD贵州茅')", context);
    const migrated = vm.runInContext('({ suggestHtml, storedWatchlist, watchlistHtml, migratedWatchlist: state.watchlist.map(item => ({ code: item.code, name: item.name })) })', context);
    assert.ok(migrated.suggestHtml.includes('贵州茅台'));
    assert.ok(!migrated.suggestHtml.includes('XD贵州茅'));
    assert.strictEqual(JSON.stringify(migrated.storedWatchlist), JSON.stringify([{ code: '600519', name: '贵州茅台' }]));
    assert.ok(migrated.watchlistHtml.includes('贵州茅台'));
    assert.ok(!migrated.watchlistHtml.includes('XD贵州茅'));
    assert.strictEqual(JSON.stringify(migrated.migratedWatchlist), JSON.stringify([{ code: '600519', name: '贵州茅台' }]));
    assert.strictEqual(JSON.stringify(vm.runInContext('genericNames', context)), JSON.stringify(['华兴源创', '睿创微纳', '天准科技']));
});

runTest('ETF search metadata keeps the exchange identity for market data APIs', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(dataSource, context);
    vm.runInContext(appSourceNoInit, context);
    vm.runInContext(`
        var shEtf = normalizeSecurityTarget({
            Code: '510300',
            Name: '沪深300ETF华泰柏瑞',
            QuoteID: '1.510300',
            Classify: 'Fund',
            SecurityTypeName: '基金'
        });
        var szEtf = normalizeSecurityTarget({
            Code: '159915',
            Name: '创业板ETF易方达',
            QuoteID: '0.159915',
            Classify: 'Fund',
            SecurityTypeName: '基金'
        });
        var stock = normalizeSecurityTarget({ Code: '600519', Name: 'XD贵州茅' });
        var result = {
            shEtf,
            szEtf,
            stock,
            shSecid: resolveSecuritySecid(shEtf),
            szSecid: resolveSecuritySecid(szEtf),
            shTencent: resolveSecurityTencentSymbol(shEtf),
            szTencent: resolveSecurityTencentSymbol(szEtf),
            legacyEtfSecid: codeToSecid('510300')
        };
    `, context);
    const result = vm.runInContext('result', context);
    assert.strictEqual(result.shEtf.type, 'fund');
    assert.strictEqual(result.shEtf.secid, '1.510300');
    assert.strictEqual(result.shEtf.tencentSymbol, 'sh510300');
    assert.strictEqual(result.szEtf.type, 'fund');
    assert.strictEqual(result.szEtf.secid, '0.159915');
    assert.strictEqual(result.szEtf.tencentSymbol, 'sz159915');
    assert.strictEqual(result.stock.type, 'stock');
    assert.strictEqual(result.stock.name, '贵州茅台');
    assert.strictEqual(result.shSecid, '1.510300');
    assert.strictEqual(result.szSecid, '0.159915');
    assert.strictEqual(result.shTencent, 'sh510300');
    assert.strictEqual(result.szTencent, 'sz159915');
    assert.strictEqual(result.legacyEtfSecid, '1.510300');
});

runTest('OTC funds are rejected while exchange ETFs remain supported', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(dataSource, context);
    vm.runInContext(appSourceNoInit, context);
    vm.runInContext(`
        var notice = '';
        var selectedCount = 0;
        showToast = function(message) { notice = message; };
        selectStock = function() { selectedCount++; };

        var suggest = document.getElementById('stockSuggest');
        renderSuggest(suggest, [{
            Code: '009881',
            Name: '广发中证医疗ETF联接C',
            QuoteID: '150.009881',
            Classify: 'OTCFUND',
            SecurityTypeName: '基金'
        }]);
        var suggestHtml = suggest.innerHTML;
        selectSuggestItem('009881', '广发中证医疗ETF联接C', '150.009881', 'fund', '');

        state.watchlist = [normalizeSecurityTarget({
            Code: '009881',
            Name: '广发中证医疗ETF联接C',
            QuoteID: '150.009881',
            Classify: 'OTCFUND',
            SecurityTypeName: '基金'
        })];
        renderWatchlist();
        var watchlistHtml = document.getElementById('stockNavList').innerHTML;
        var result = {
            otcSupported: isSupportedWatchlistSecurity({ Code: '009881', QuoteID: '150.009881' }),
            shEtfSupported: isSupportedWatchlistSecurity({ Code: '510300', QuoteID: '1.510300' }),
            szEtfSupported: isSupportedWatchlistSecurity({ Code: '159915', QuoteID: '0.159915' }),
            notice,
            selectedCount,
            suggestHtml,
            watchlistHtml
        };
    `, context);
    const result = vm.runInContext('result', context);
    assert.strictEqual(result.otcSupported, false);
    assert.strictEqual(result.shEtfSupported, true);
    assert.strictEqual(result.szEtfSupported, true);
    assert.strictEqual(result.selectedCount, 0);
    assert.ok(result.notice.includes('暂不支持场外基金'), result.notice);
    assert.ok(result.suggestHtml.includes('is-unsupported'), result.suggestHtml);
    assert.ok(result.suggestHtml.includes('暂不支持'), result.suggestHtml);
    assert.ok(result.watchlistHtml.includes('is-unsupported'), result.watchlistHtml);
    assert.ok(result.watchlistHtml.includes('>不支持</span>'), result.watchlistHtml);
    assert.ok(result.watchlistHtml.includes('onclick="showUnsupportedSecurityNotice()"'), result.watchlistHtml);
});

runTest('left list headers stay outside scrollable content and scrollbars stay intentionally hidden', () => {
    assert.match(appSource, /index-list-sticky-head[\s\S]*?市场与板块指数[\s\S]*?index-list-items[\s\S]*?leftMarketContext/, 'index title should stay outside the scrollable index and market context area');
    assert.ok(appSource.includes("document.getElementById('indexNavList').style.display = 'flex';"), 'index list should restore its flex layout when shown');
    assert.ok(appSource.includes('class="watchlist-sticky-head"'), 'watchlist should render one shared header');
    assert.match(appSource, /watchlist-sticky-head[\s\S]*?watchlist-header-slot[\s\S]*?sHtml[\s\S]*?watchlist-items/, 'title, search, and items should have separate slots');
    assert.ok(cssSource.includes('#indexNavList { min-height: 0; flex: 1; flex-direction: column; overflow: hidden; }'), 'index shell should constrain its own layout');
    assert.ok(cssSource.includes('#stockNavList { min-height: 0; flex: 1; flex-direction: column; overflow: hidden; }'), 'watchlist shell should constrain its own layout');
    assert.match(cssSource, /\.index-list-items,\s*\.watchlist-items \{[^}]*margin-right: calc\(0px - var\(--space-4\)\);[^}]*overflow-y: auto;[^}]*padding-right: var\(--space-4\);[^}]*scrollbar-width: none;/, 'both left-list scroll areas should align content with the fixed header and hide Firefox scrollbars');
    assert.match(cssSource, /\.index-list-items::\-webkit-scrollbar,\s*\.watchlist-items::\-webkit-scrollbar \{[^}]*width: 0;[^}]*height: 0;[^}]*display: none;/, 'both left-list scroll areas should explicitly hide Chromium and Safari scrollbars');
    assert.doesNotMatch(cssSource, /\.index-list-items,\s*\.watchlist-items \{[^}]*scrollbar-gutter:/, 'hidden left-list scrollbars should not reserve an unused gutter');
});

runTest('watchlist drag handle replaces the active dot and persists reordered items', async () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(dataSource, context);
    vm.runInContext(appSourceNoInit, context);
    await vm.runInContext(`
        (async function() {
            var savedOrders = [];
            var renderCount = 0;
            saveWatchlist = async function() { savedOrders.push(state.watchlist.map(item => item.code)); };
            renderWatchlist = function() { renderCount++; };
            state.stockId = '000001';
            state.watchlist = [
                { code: '600519', name: '贵州茅台' },
                { code: '000001', name: '平安银行' },
                { code: '510300', name: '沪深300ETF' }
            ];
            await moveWatchlistItem('510300', '600519', false);
            await handleWatchlistDragKeydown({
                key: 'ArrowDown',
                preventDefault() {},
                stopPropagation() {}
            }, '510300');
            reorderResult = {
                selectedCode: state.stockId,
                order: state.watchlist.map(item => item.code),
                savedOrders,
                renderCount
            };
        })()
    `, context);
    const result = JSON.parse(vm.runInContext('JSON.stringify(reorderResult)', context));
    assert.deepStrictEqual(result, {
        selectedCode: '000001',
        order: ['600519', '510300', '000001'],
        savedOrders: [
            ['510300', '600519', '000001'],
            ['600519', '510300', '000001']
        ],
        renderCount: 2
    });
    assert.ok(appSource.includes('class="wl-drag-handle"'), 'watchlist rows should expose one consistent drag handle');
    assert.ok(appSource.includes('draggable="true"'), 'watchlist drag handle should use native desktop dragging');
    assert.ok(cssSource.includes('.nav-list-item .wl-drag-handle'), 'drag handle should have a shared component style');
    assert.ok(appSource.includes('nav-list-item watchlist-item'), 'watchlist rows should scope their interaction styles without changing index rows');
    assert.ok(cssSource.includes('.nav-list-item.watchlist-item::before { display: none; }'), 'the old leading active dot should only be removed from watchlist rows');
});

runTest('legacy OTC funds stay out of history, realtime, snapshot, and cache preload queues', async () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(dataSource, context);
    vm.runInContext(appSourceNoInit, context);
    await vm.runInContext(`
        (async function() {
            var historyIds = [];
            var realtimeIds = [];
            var snapshotCodes = [];
            var preloadIds = [];
            state.tab = 'stock';
            state.mode = 'stock';
            state.stockId = '600519';
            state.id = '1.600519';
            state.watchlist = [
                normalizeSecurityTarget({ Code: '009881', Name: '广发中证医疗ETF联接C', QuoteID: '150.009881', Classify: 'OTCFUND' }),
                normalizeSecurityTarget({ Code: '600519', Name: '贵州茅台', QuoteID: '1.600519' }),
                normalizeSecurityTarget({ Code: '510300', Name: '沪深300ETF', QuoteID: '1.510300', Classify: 'Fund' })
            ];
            syncData = async function(id) {
                historyIds.push(id);
                return Array.from({ length: 30 }, function(_, i) {
                    return { date: '2026-06-' + String(i + 1).padStart(2, '0'), open: 10, high: 11, low: 9, close: 10, vol: 100 };
                });
            };
            dbSet = async function() {};
            beginRefreshTransaction = function() { return null; };
            scheduleWatchlistRender = function() {};
            syncWatchlistSignalSnapshotFast = function(code) { snapshotCodes.push(code); };
            batchGetRealtimePrices = async function(ids) { realtimeIds = ids.slice(); return {}; };
            canRequestMarketData = function() { return true; };

            await updateAllWatchlistData();
            snapshotCodes = [];
            refreshWatchlistSignalSnapshots();
            await refreshSidebarRealtime();

            dbGet = async function(id) { preloadIds.push(id); return null; };
            await preloadCacheOnly();
            otcQueueResult = { historyIds, realtimeIds, snapshotCodes, preloadIds };
        })()
    `, context);
    const result = JSON.parse(vm.runInContext('JSON.stringify(otcQueueResult)', context));
    assert.deepStrictEqual(result.historyIds, ['1.510300']);
    assert.deepStrictEqual(result.realtimeIds.sort(), ['1.510300', '1.600519']);
    assert.deepStrictEqual(result.snapshotCodes.sort(), ['510300', '600519']);
    assert.ok(result.preloadIds.includes('1.510300'), 'exchange ETF should preload');
    assert.ok(result.preloadIds.includes('1.600519'), 'A-share should preload');
    assert.ok(!result.preloadIds.includes('150.009881'), 'OTC fund must not preload');
    assert.strictEqual(vm.runInContext('SYS_CONFIG.SIDEBAR_SYNC_CONCURRENCY', context), 3);
});

runTest('ETF watchlist rendering uses short names, full title, and three decimal prices', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(dataSource, context);
    vm.runInContext(appSourceNoInit, context);
    vm.runInContext(`
        var target = normalizeSecurityTarget({
            Code: '510300',
            Name: '沪深300ETF华泰柏瑞',
            QuoteID: '1.510300',
            Classify: 'Fund',
            SecurityTypeName: '基金'
        });
        state.mode = 'stock';
        state.stockId = '510300';
        state.watchlist = [target];
        state.rawData[target.secid] = [
            { date: '2026-07-08', open: 4.700, high: 4.810, low: 4.690, close: 4.798, vol: 1000, amt: 10000 },
            { date: '2026-07-09', open: 4.813, high: 4.925, low: 4.777, close: 4.916, vol: 2000, amt: 20000 }
        ];
        renderWatchlist();
        var watchlistHtml = document.getElementById('stockNavList').innerHTML;
        var quoteDisplay = getLeftQuoteDisplay(target);
    `, context);
    const result = vm.runInContext('({ watchlistHtml, quoteDisplay })', context);
    assert.ok(result.watchlistHtml.includes('沪深300ETF'), result.watchlistHtml);
    assert.ok(result.watchlistHtml.includes('title="沪深300ETF华泰柏瑞"'), result.watchlistHtml);
    assert.ok(!result.watchlistHtml.includes('沪深300ETF华泰柏瑞</span>'), result.watchlistHtml);
    assert.ok(!result.watchlistHtml.includes('>ETF</span>'), result.watchlistHtml);
    assert.ok(result.watchlistHtml.includes('4.916'), result.watchlistHtml);
    assert.strictEqual(result.quoteDisplay.priceText, '4.916');
});

runTest('watchlist renders status tag and code without duplicate action text', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(dataSource, context);
    vm.runInContext(appSourceNoInit, context);
    vm.runInContext(`
        state.mode = 'stock';
        state.strategy = '稳健趋势型';
        state.stockId = '601162';
        state.watchlist = [
            { code: '601162', name: '天风证券' },
            { code: '600519', name: '贵州茅台' }
        ];
        state.rawData['1.601162'] = [
            { date: '2026-07-02', open: 3.71, high: 3.82, low: 3.67, close: 3.71, vol: 3189930, amt: 119300, _strategy: '稳健趋势型', _signalVersion: SIGNAL_VERSION }
        ];
        state.rawData['1.600519'] = [
            { date: '2026-07-02', open: 1500, high: 1520, low: 1490, close: 1510, vol: 12000, amt: 180000000, _strategy: '稳健趋势型', _signalVersion: SIGNAL_VERSION, _decision: { simpleAction: '轻仓建仓', simpleColorClass: 'text-info', position: 20 } }
        ];
        renderWatchlist();
        var html = document.getElementById('stockNavList').innerHTML;
    `, context);
    const html = vm.runInContext('html', context);
    assert.ok(!html.includes('class="wl-action'), 'watchlist should not show a duplicate strategy action after the code');
    assert.ok(html.includes('>同步</span>'), 'pending stock should keep a compact status tag beside the name');
    assert.ok(html.includes('>入场</span>'), 'computed stock decision should still show the compact strategy bucket beside the name');
    assert.ok(html.includes('0.00%'), 'flat quotes should show 0.00% instead of -- when the price baseline is valid');
});

runTest('watchlist status and action copy stay aligned with the right panel novice action', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(dataSource, context);
    vm.runInContext(appSourceNoInit, context);
    vm.runInContext(`
        state.mode = 'stock';
        state.strategy = '稳健趋势型';
        state.stockId = '601162';
        state.watchlist = [{ code: '601162', name: '天风证券' }];
        state.rawData['1.601162'] = [
            {
                date: '2026-07-02',
                open: 3.76,
                high: 3.82,
                low: 3.67,
                close: 3.69,
                vol: 3189930,
                amt: 119300,
                _strategy: '稳健趋势型',
                _signalVersion: SIGNAL_VERSION,
                _decision: {
                    simpleAction: '积极持有',
                    simpleColorClass: 'text-bull',
                    position: 50,
                    signalReady: true,
                    market: { label: '温和偏多' },
                    risk: { level: '中等波动/偏离', flags: [] },
                    exit: { level: '无明确离场' }
                }
            }
        ];
        renderWatchlist();
        var html = document.getElementById('stockNavList').innerHTML;
    `, context);
    const html = vm.runInContext('html', context);
    assert.ok(html.includes('>持仓</span>'), 'watchlist pill should describe the strategy bucket, not a separate conclusion');
    assert.ok(!html.includes('class="wl-action'), 'watchlist should not show a duplicate strategy action after the code');
    assert.ok(!html.includes('策略：可继续观察'), 'right panel novice action should stay out of the compact left row');
});

runTest('watchlist position change ignores status-only transitions and invalid contexts', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(dataSource, context);
    vm.runInContext(appSourceNoInit, context);
    vm.runInContext(`
        state.strategy = '稳健趋势型';
        var observeDecision = {
            simpleAction: '持币观望', simpleColorClass: 'text-dim', position: 0,
            risk: { flags: [] }, exit: { level: '无明确离场' }
        };
        var holdDecision = {
            simpleAction: '积极持有', simpleColorClass: 'text-bull', position: 50,
            signalReady: true, risk: { flags: [] }, exit: { level: '无明确离场' }
        };
        var unchanged = buildWatchlistPositionChange([
            { date: '2026-07-01', _strategy: state.strategy, _signalVersion: SIGNAL_VERSION, _decision: holdDecision },
            { date: '2026-07-02', _strategy: state.strategy, _signalVersion: SIGNAL_VERSION, _decision: { ...holdDecision } }
        ]);
        var statusOnly = buildWatchlistPositionChange([
            { date: '2026-07-01', _strategy: state.strategy, _signalVersion: SIGNAL_VERSION, _decision: { ...holdDecision, simpleAction: '积极持有' } },
            { date: '2026-07-02', _strategy: state.strategy, _signalVersion: SIGNAL_VERSION, _decision: { ...holdDecision, simpleAction: '谨慎持有' } }
        ]);
        var firstDay = buildWatchlistPositionChange([
            { date: '2026-07-02', _strategy: state.strategy, _signalVersion: SIGNAL_VERSION, _decision: holdDecision }
        ]);
        var staleStrategy = buildWatchlistPositionChange([
            { date: '2026-07-01', _strategy: '突破追涨型', _signalVersion: SIGNAL_VERSION, _decision: observeDecision },
            { date: '2026-07-02', _strategy: state.strategy, _signalVersion: SIGNAL_VERSION, _decision: holdDecision }
        ]);
    `, context);
    const result = vm.runInContext('({ unchanged, statusOnly, firstDay, staleStrategy })', context);
    assert.strictEqual(result.unchanged, null, '状态和仓位都未变时不应误报');
    assert.strictEqual(result.firstDay, null, '没有上一个交易日时不应生成变化');
    assert.strictEqual(result.staleStrategy, null, '不同策略的决策不应跨策略比较');
    assert.strictEqual(result.statusOnly, null, '状态分类变化但建议仓位未变时不应显示后缀');
});

runTest('watchlist position change reports only actual position movement', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(dataSource, context);
    vm.runInContext(appSourceNoInit, context);
    vm.runInContext(`
        state.strategy = '稳健趋势型';
        var makeDecision = function(action, position, color) {
            return {
                simpleAction: action, simpleColorClass: color, position,
                risk: { flags: [] }, exit: { level: '无明确离场' }
            };
        };
        var positionOnly = buildWatchlistPositionChange([
            { date: '2026-07-01', _strategy: state.strategy, _signalVersion: SIGNAL_VERSION, _decision: makeDecision('积极持有', 50, 'text-bull') },
            { date: '2026-07-02', _strategy: state.strategy, _signalVersion: SIGNAL_VERSION, _decision: makeDecision('轻仓持有', 30, 'text-info') }
        ]);
        var livePreview = buildWatchlistPositionChange([
            { date: '2026-07-02', _strategy: state.strategy, _signalVersion: SIGNAL_VERSION, _decision: makeDecision('持币观望', 0, 'text-dim') },
            { date: '2026-07-03', _isLive: true, _strategy: state.strategy, _signalVersion: SIGNAL_VERSION, _decision: makeDecision('轻仓建仓', 30, 'text-info') }
        ]);
    `, context);
    const result = vm.runInContext('({ positionOnly, livePreview })', context);
    assert.strictEqual(result.positionOnly, '50%→30%');
    assert.strictEqual(result.livePreview, '0%→30%');
});

runTest('watchlist renders position change after the primary status pill without tooltip', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(dataSource, context);
    vm.runInContext(appSourceNoInit, context);
    vm.runInContext(`
        state.mode = 'stock';
        state.strategy = '稳健趋势型';
        state.watchlist = [{ code: '600519', name: '贵州茅台' }];
        state.rawData['1.600519'] = [
            {
                date: '2026-07-01', open: 1490, high: 1510, low: 1480, close: 1500, vol: 10000, amt: 15000000,
                _strategy: state.strategy, _signalVersion: SIGNAL_VERSION,
                _decision: { simpleAction: '持币观望', simpleColorClass: 'text-dim', position: 0, risk: { flags: [] }, exit: { level: '无明确离场' } }
            },
            {
                date: '2026-07-02', open: 1500, high: 1530, low: 1495, close: 1520, vol: 12000, amt: 18240000,
                _strategy: state.strategy, _signalVersion: SIGNAL_VERSION,
                _decision: { simpleAction: '积极持有', simpleColorClass: 'text-bull', position: 50, signalReady: true, risk: { flags: [] }, exit: { level: '无明确离场' } }
            }
        ];
        renderWatchlist();
        var html = document.getElementById('stockNavList').innerHTML;
    `, context);
    const html = vm.runInContext('html', context);
    const statusIndex = html.indexOf('>\u6301\u4ed3</span>');
    const changeIndex = html.indexOf('class="wl-position-change');
    assert.ok(statusIndex >= 0, '主状态标签应保留');
    assert.ok(changeIndex > statusIndex, '仓位变化应位于主状态标签之后');
    assert.ok(html.includes('<span class="wl-position-change">0%→50%</span>'));
    assert.ok(!html.includes('wl-status-change'), '旧的状态变化后缀不应继续渲染');
});

runTest('watchlist live overlay computes a temporary strategy badge from display data', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(dataSource, context);
    vm.runInContext(calcSource, context);
    vm.runInContext(appSourceNoInit, context);
    vm.runInContext(`
        state.mode = 'stock';
        state.strategy = '稳健趋势型';
        state.stockId = '600519';
        state.watchlist = [{ code: '600519', name: '贵州茅台' }];
        state.rawData['1.600519'] = Array.from({ length: 65 }, (_, i) => {
            const close = 1450 + i * 2;
            return {
                date: '2026-04-' + String(i + 1).padStart(2, '0'),
                open: close - 1,
                high: close + 3,
                low: close - 4,
                close,
                vol: 10000 + i * 120,
                amt: close * (10000 + i * 120)
            };
        });
        state.liveBars['1.600519'] = {
            date: '2026-07-03',
            open: 1512,
            high: 1528,
            low: 1508,
            close: 1523,
            prevClose: 1510,
            vol: 18000,
            amt: 270000000,
            _isLive: true
        };
        state.displayStatus['1.600519'] = { mode: 'live-overlay' };
        renderWatchlist();
        flushWatchlistSnapshotQueue({ didTimeout: true, timeRemaining: () => 100 });
        renderWatchlist();
        var latest = getMergedLiveDailyData('1.600519').slice(-1)[0];
        var html = document.getElementById('stockNavList').innerHTML;
        var result = {
            html,
            latestDate: latest.date,
            latestDecision: latest._decision || null,
            navStatus: state.watchlist[0]._navStatus || null
        };
    `, context);
    const result = vm.runInContext('result', context);
    assert.strictEqual(result.latestDate, '2026-07-03');
    assert.ok(result.latestDecision, 'live overlay row should receive the temporary decision used by the right panel');
    assert.strictEqual(result.navStatus?.date, '2026-07-03');
    assert.strictEqual(result.navStatus?.rawAction, result.latestDecision.simpleAction);
    assert.ok(!result.html.includes('>同步</span>'), 'live overlay display data should not stay in perpetual sync state');
    assert.ok(result.html.includes('1523.00'), 'watchlist price should still use the live quote');
});

runTest('watchlist snapshot work waits for the history batch to finish', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(dataSource, context);
    vm.runInContext(appSourceNoInit, context);
    vm.runInContext(`
        var idleScheduleCount = 0;
        requestIdleCallback = function() { idleScheduleCount++; return idleScheduleCount; };
        state.strategy = '稳健趋势型';
        state.watchlist = [{ code: '600519', name: '贵州茅台', secid: '1.600519' }];
        state.rawData['1.600519'] = [{ date: '2026-07-01', open: 1, high: 1, low: 1, close: 1, vol: 1, amt: 1 }];
        watchlistSnapshotBatchDepth = 1;
        queueWatchlistSignalSnapshot('600519', state.rawData['1.600519']);
        var duringBatch = { idleScheduleCount, queued: watchlistSnapshotQueue.size };
        finishWatchlistSnapshotBatch();
        var afterBatch = { idleScheduleCount, queued: watchlistSnapshotQueue.size };
    `, context);
    const result = JSON.parse(vm.runInContext('JSON.stringify({ duringBatch, afterBatch })', context));
    assert.deepStrictEqual(result.duringBatch, { idleScheduleCount: 0, queued: 1 });
    assert.deepStrictEqual(result.afterBatch, { idleScheduleCount: 1, queued: 1 });
});

runTest('watchlist snapshot timeout is still sliced into bounded work', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(appSourceNoInit, context);
    vm.runInContext(`
        var clock = 0;
        Date.now = function() { clock += 5; return clock; };
        var processedCodes = [];
        var idleScheduleCount = 0;
        requestIdleCallback = function() { idleScheduleCount++; return idleScheduleCount; };
        syncWatchlistSignalSnapshot = function(code) { processedCodes.push(code); };
        watchlistSnapshotQueue.set('a', []);
        watchlistSnapshotQueue.set('b', []);
        watchlistSnapshotQueue.set('c', []);
        flushWatchlistSnapshotQueue({ didTimeout: true, timeRemaining: function() { return 100; } });
        var result = { processedCodes, queued: watchlistSnapshotQueue.size, idleScheduleCount };
    `, context);
    const result = JSON.parse(vm.runInContext('JSON.stringify(result)', context));
    assert.ok(result.processedCodes.length < 3, JSON.stringify(result));
    assert.ok(result.queued > 0, JSON.stringify(result));
    assert.strictEqual(result.idleScheduleCount, 1);
});

runTest('watchlist rendering waits until native drag finishes', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(appSourceNoInit, context);
    vm.runInContext(`
        var rafCallback = null;
        var renderCount = 0;
        requestAnimationFrame = function(fn) { rafCallback = fn; return 1; };
        renderWatchlist = function() { renderCount++; };
        state.mode = 'stock';
        watchlistDragCode = '600519';
        scheduleWatchlistRender();
        rafCallback();
        var duringDrag = renderCount;
        finishWatchlistDrag();
        rafCallback();
        var afterDrag = renderCount;
    `, context);
    const result = JSON.parse(vm.runInContext('JSON.stringify({ duringDrag, afterDrag })', context));
    assert.deepStrictEqual(result, { duringDrag: 0, afterDrag: 1 });
});

runTest('sidebar analysis panel never becomes blank when analysis html is temporarily empty', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(dataSource, context);
    vm.runInContext(calcSource, context);
    vm.runInContext(renderSource, context);
    vm.runInContext(`
        var cardPrice = document.getElementById('cardPrice');
        var cardAnalysis = document.getElementById('cardAnalysis');
        cardPrice.dataset = {};
        cardAnalysis.dataset = {};
        cardAnalysis.innerHTML = '<div class="action-panel">新手每日结论</div>';
        cardAnalysis.dataset.ah = String(hashString32(cardAnalysis.innerHTML));
        applySidebarHTML({
            priceHtml: '<div class="terminal-block"><div class="price-main">3.71</div></div>',
            analysisHtml: '',
            isHide: false
        }, 'blank-analysis-refresh');
        var result = {
            display: cardAnalysis.style.display,
            html: cardAnalysis.innerHTML
        };
    `, context);
    const result = vm.runInContext('result', context);
    assert.strictEqual(result.display, 'flex');
    assert.ok(result.html.trim(), 'analysis panel should keep useful content or render a fallback instead of becoming blank');
    assert.ok(result.html.includes('每日结论') || result.html.includes('分析同步'), 'blank refresh needs an actionable analysis fallback');
});

runTest('only four formal strategies are exposed and white-fat research signals stay out of production', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext('function convertDailyToWeekly() { return []; }', context);
    vm.runInContext(calcSource, context);

    const formalStrategies = JSON.parse(vm.runInContext('JSON.stringify(Object.keys(STRATEGIES))', context));
    assert.deepStrictEqual(formalStrategies, ['稳健趋势型', '波段抄底型', '突破追涨型', '综合全能型']);
    assert.strictEqual(vm.runInContext("setActiveStrategy('白胖右侧确认型')", context), false);
    assert.strictEqual(vm.runInContext("STRATEGIES['白胖右侧确认型']", context), undefined);
    assert.deepStrictEqual(
        JSON.parse(vm.runInContext("JSON.stringify(SIGNAL_RULES.filter(rule => ['B23', 'B24', 'B25', 'L13', 'L14'].includes(rule.id)).map(rule => rule.id))", context)),
        []
    );
    assert.deepStrictEqual(
        JSON.parse(vm.runInContext("JSON.stringify(Object.keys(SIGNAL_SCORES).filter(signal => ['B23', 'B24', 'B25'].includes(signal)))", context)),
        []
    );
});

runTest('watchlist snapshot flush yields busy frames to interaction and drains on idle or timeout', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(appSourceNoInit, context);
    vm.runInContext(`
        var processedCodes = [];
        // 用轻量桩替换单只快照计算，只记录被处理的标的，专注调度行为本身。
        syncWatchlistSignalSnapshot = function(code) { processedCodes.push(code); };
        function fillQueue(n) {
            watchlistSnapshotQueue.clear();
            for (var i = 0; i < n; i++) watchlistSnapshotQueue.set('c' + i, [{ date: 'd', close: 1 }]);
        }

        // 繁忙帧：rIC 未超时且几乎无空闲（timeRemaining=1）——一只都不该处理，整帧让给鼠标交互。
        fillQueue(5);
        var busyBefore = watchlistSnapshotQueue.size;
        flushWatchlistSnapshotQueue({ didTimeout: false, timeRemaining: function() { return 1; } });
        var processedOnBusy = processedCodes.length;
        var remainingAfterBusy = watchlistSnapshotQueue.size;

        // 空闲帧：空闲充足，应把队列排空。
        processedCodes = [];
        flushWatchlistSnapshotQueue({ didTimeout: false, timeRemaining: function() { return 50; } });
        var processedOnIdle = processedCodes.length;
        var remainingAfterIdle = watchlistSnapshotQueue.size;

        // 兜底帧：rIC 已超时（didTimeout=true），即便无空闲也必须推进，避免队列饿死。
        processedCodes = [];
        fillQueue(3);
        flushWatchlistSnapshotQueue({ didTimeout: true, timeRemaining: function() { return 0; } });
        var processedOnTimeout = processedCodes.length;

        // 退化路径：无 deadline（setTimeout 分支）也至少推进一只。
        processedCodes = [];
        fillQueue(4);
        flushWatchlistSnapshotQueue();
        var processedNoDeadline = processedCodes.length;

        var result = {
            busyBefore: busyBefore,
            processedOnBusy: processedOnBusy,
            remainingAfterBusy: remainingAfterBusy,
            processedOnIdle: processedOnIdle,
            remainingAfterIdle: remainingAfterIdle,
            processedOnTimeout: processedOnTimeout,
            processedNoDeadlineAtLeastOne: processedNoDeadline >= 1
        };
    `, context);
    const result = JSON.parse(vm.runInContext('JSON.stringify(result)', context));
    assert.strictEqual(result.busyBefore, 5);
    assert.strictEqual(result.processedOnBusy, 0, 'busy frame must not steal time from mouse interaction');
    assert.strictEqual(result.remainingAfterBusy, 5, 'queue is preserved for a later idle/timeout frame');
    assert.strictEqual(result.processedOnIdle, 5, 'idle frame drains the queue');
    assert.strictEqual(result.remainingAfterIdle, 0);
    assert.strictEqual(result.processedOnTimeout, 3, 'timeout fallback must advance even with no idle time');
    assert.strictEqual(result.processedNoDeadlineAtLeastOne, true, 'setTimeout fallback never starves the queue');
});

// [Archived] Baipang candidate research frozen. White-fat test cases removed:
//   "white-fat candidate research uses an isolated position and B/S chain"
//   "white-fat candidate research detects half-breakout pullback confirmation and key-level failure"
// 对应研究脚本已退役，结论保留在 docs/history/strategy/。
