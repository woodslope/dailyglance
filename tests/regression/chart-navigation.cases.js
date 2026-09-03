runTest('same-day cached refresh keeps the strategy panel visible without redrawing charts', async () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(dataSource, context);
    vm.runInContext(renderSource, context);
    vm.runInContext(`
        var timeoutQueue = [];
        window.setTimeout = function(fn) { timeoutQueue.push(fn); return timeoutQueue.length; };
        clearTimeout = function() {};
        var frameQueue = [];
        requestAnimationFrame = function(fn) { frameQueue.push(fn); return frameQueue.length; };
        var drawCount = 0;
        var indicatorUpdateCount = 0;
        draw = function() { drawCount++; };
        updateAllIndicators = function() { indicatorUpdateCount++; };
        renderMASelector = function() {};
        markRefreshTime = function() {};
        updateLeftMarketContext = function() {};

        var cardPrice = document.getElementById('cardPrice');
        var header = { textContent: '2026-06-26 | SH000001' };
        var priceMain = { textContent: '101.00', className: 'price-main mono up', classList: { add() {}, remove() {} } };
        cardPrice.querySelector = function(selector) {
            if (selector === '.header-meta-row .mono') return header;
            if (selector === '.price-main') return priceMain;
            if (selector === '.price-sub') return { textContent: '+1.00 (+1.00%)', className: 'price-sub mono up', classList: { add() {}, remove() {} } };
            if (selector === '.amt-row .val') return { textContent: '10万', className: 'val', classList: { add() {}, remove() {} } };
            return null;
        };
        cardPrice.querySelectorAll = function(selector) {
            if (selector === '.data-box-row .val') {
                return [
                    { textContent: '100.00', className: 'val', classList: { add() {}, remove() {} } },
                    { textContent: '102.00', className: 'val', classList: { add() {}, remove() {} } },
                    { textContent: '99.00', className: 'val', classList: { add() {}, remove() {} } },
                    { textContent: '1万手', className: 'val', classList: { add() {}, remove() {} } }
                ];
            }
            return [];
        };
        cardPrice.style.display = 'flex';

        var cardAnalysis = document.getElementById('cardAnalysis');
        cardAnalysis.style.display = 'none';
        cardAnalysis.innerHTML = '<div class="action-panel">新手每日结论</div>';

        state.id = 'sh';
        state.mode = 'index';
        state.period = 'daily';
        state.rawData.sh = [
            { date: '2026-06-25', open: 100, high: 101, low: 99, close: 100, vol: 10000, amt: 100000 },
            { date: '2026-06-26', open: 100, high: 103, low: 99, close: 102, vol: 12000, amt: 120000, _decision: { simpleAction: '持币观望', position: 0 } }
        ];
        state.weeklyData.sh = convertDailyToWeekly(state.rawData.sh);
        state.lockIdx = 1;
        state.isFrozen = false;

        scheduleCachedFetchRefreshApply('sh');
        timeoutQueue.shift()();
        frameQueue.shift()();
    `, context);
    assert.strictEqual(vm.runInContext('document.getElementById("cardAnalysis").style.display', context), 'flex');
    assert.strictEqual(vm.runInContext('drawCount', context), 0);
    assert.strictEqual(vm.runInContext('indicatorUpdateCount', context), 1);
});

runTest('realtime quote uses Tencent API quote time before chart overlay', async () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    const instrumentedDataSource = dataSource
        .replace(/function getBJDate\(\) \{ return new Date\(new Date\(\)\.toLocaleString\("en-US", \{timeZone: "Asia\/Shanghai"\}\)\); \}/, "function getBJDate() { return new Date('2026-06-30T10:30:00+08:00'); }");
    vm.runInContext(instrumentedDataSource, context);
    const fields = new Array(38).fill('');
    fields[3] = '136';
    fields[4] = '130';
    fields[5] = '131';
    fields[30] = '20260629145959';
    fields[33] = '138';
    fields[34] = '129';
    fields[36] = '4000';
    fields[37] = '40000';
    context.__quotePayload = fields.join('~');
    vm.runInContext(`
        document.createElement = function() {
            return {
                style: {},
                charset: '',
                src: '',
                parentNode: document.head,
                remove() { this.removed = true; }
            };
        };
        document.head.appendChild = function(script) {
            window.v_sh000001 = __quotePayload;
            if (typeof script.onload === 'function') script.onload();
        };
    `, context);
    const result = JSON.parse(await vm.runInContext(`(async function() {
        const single = await getRealtimePriceJSONP('sh');
        const batch = await batchGetRealtimePrices(['sh']);
        const series = Array.from({ length: 31 }, function(_, i) {
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
        const applyResult = applyRealtimeQuoteForSeries('sh', series, single);
        return JSON.stringify({
            singleDate: single.date,
            singleQuoteTime: single.quoteTime,
            singleQuoteDateSource: single.quoteDateSource,
            singleAmount: single.amt,
            batchDate: batch.sh.date,
            batchQuoteTime: batch.sh.quoteTime,
            batchQuoteDateSource: batch.sh.quoteDateSource,
            batchAmount: batch.sh.amt,
            applyResult,
            liveBarExists: !!state.liveBars.sh,
            quoteDate: state.liveQuotes.sh.date,
            quoteClose: state.liveQuotes.sh.close,
            rejectReason: state.liveQuotes.sh._rejectReason
        });
    })()`, context));
    assert.deepStrictEqual(result, {
        singleDate: '2026-06-29',
        singleQuoteTime: '2026-06-29 14:59:59',
        singleQuoteDateSource: 'api',
        singleAmount: 400000000,
        batchDate: '2026-06-29',
        batchQuoteTime: '2026-06-29 14:59:59',
        batchQuoteDateSource: 'api',
        batchAmount: 400000000,
        applyResult: 'quote-only',
        liveBarExists: false,
        quoteDate: '2026-06-29',
        quoteClose: 136,
        rejectReason: 'quote-date-not-today'
    });
});

runTest('same-day realtime refresh redraws the current viewport without full chart rebuild', async () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(dataSource, context);
    vm.runInContext(calcSource, context);
    vm.runInContext(renderSource, context);
    vm.runInContext(`
        var drawCount = 0;
        var drawViewportCount = 0;
        var indicatorUpdateCount = 0;
        draw = function() { drawCount++; };
        drawViewport = function() { drawViewportCount++; };
        renderMASelector = function() {};
        updateAllIndicators = function() { indicatorUpdateCount++; };
        updateLeftMarketContext = function() {};

        var latestDate = '2026-06-29';
        var cardPrice = document.getElementById('cardPrice');
        var header = { textContent: latestDate + ' | SH000001' };
        cardPrice.querySelector = function(selector) {
            if (selector === '.header-meta-row .mono') return header;
            if (selector === '.price-main') return { textContent: '199.00', className: 'price-main mono up', classList: { add() {}, remove() {} } };
            if (selector === '.price-sub') return { textContent: '+1.00 (+0.51%)', className: 'price-sub mono up', classList: { add() {}, remove() {} } };
            if (selector === '.amt-row .val') return { textContent: '10万', className: 'val', classList: { add() {}, remove() {} } };
            return null;
        };
        cardPrice.querySelectorAll = function(selector) {
            if (selector === '.data-box-row .val') {
                return [
                    { textContent: '199.00', className: 'val', classList: { add() {}, remove() {} } },
                    { textContent: '200.00', className: 'val', classList: { add() {}, remove() {} } },
                    { textContent: '198.00', className: 'val', classList: { add() {}, remove() {} } },
                    { textContent: '1万手', className: 'val', classList: { add() {}, remove() {} } }
                ];
            }
            return [];
        };
        var cardAnalysis = document.getElementById('cardAnalysis');
        cardAnalysis.style.display = 'flex';
        cardAnalysis.innerHTML = '<div class="action-panel">大盘每日结论</div>';

        state.id = 'sh';
        state.mode = 'index';
        state.period = 'daily';
        state.strategy = '稳健趋势型';
        state.isFrozen = false;
        state.charts = { main: {} };
        var rows = Array.from({ length: 100 }, function(_, i) {
            var close = 100 + i;
            return {
                date: i === 99 ? latestDate : '2026-03-' + String(i + 1).padStart(2, '0'),
                open: close - 0.5,
                high: close + 1,
                low: close - 1,
                close: close,
                vol: 10000 + i,
                amt: 100000 + i
            };
        });
        setRawData('sh', rows);
        setLockIdx(rows.length - 1);
        state.liveBars.sh = { date: latestDate, open: 199, high: 205, low: 198, close: 204, vol: 20000, amt: 200000 };
        var path = applyActiveDataRefresh('sh');
    `, context);
    assert.strictEqual(vm.runInContext('path', context), 'same-day-light');
    assert.strictEqual(vm.runInContext('drawCount', context), 0);
    assert.strictEqual(vm.runInContext('drawViewportCount', context), 1);
    assert.strictEqual(vm.runInContext('indicatorUpdateCount', context), 1);
});

runTest('active cached fetch restores chart view when preloaded memory data was cleared from the canvas', async () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    const instrumentedDataSource = dataSource
        .replace(/function dbGet\(id\) \{[\s\S]*?\n\}/, "function dbGet(id) { return Promise.resolve({ data: cachedRows }); }")
        .replace(/function scheduleCachedFetchRefresh\(id\) \{[\s\S]*?\n\}/, "function scheduleCachedFetchRefresh(id) { scheduledRefreshIds.push(id); return Promise.resolve(); }");
    vm.runInContext('var scheduledRefreshIds = [];', context);
    vm.runInContext(instrumentedDataSource, context);
    vm.runInContext(`
        var frameQueue = [];
        requestAnimationFrame = function(fn) { frameQueue.push(fn); return frameQueue.length; };
        var drawCount = 0;
        var sidebarRebuildCount = 0;
        var indicatorUpdateCount = 0;
        draw = function() { drawCount++; };
        safeUpdateSidebar = function() { sidebarRebuildCount++; };
        updateAllIndicators = function() { indicatorUpdateCount++; };
        markIndicatorsDirty = function() {};
        renderMASelector = function() {};
        renderIndexList = function() {};
        markRefreshTime = function() {};
        var memoryRows = [
            { date: '2026-06-28', open: 100, high: 101, low: 99, close: 100, vol: 1000, amt: 10000 },
            { date: '2026-06-29', open: 100, high: 102, low: 99, close: 101, vol: 1200, amt: 12000 }
        ];
        var cachedRows = memoryRows.map(function(item) { return { ...item }; });
        state.id = 'sh';
        state.mode = 'index';
        state.period = 'daily';
        state.rawData.sh = memoryRows;
        state.weeklyData.sh = convertDailyToWeekly(memoryRows);
        state.charts = {};
        state.lockIdx = -1;
        state.indicators = { ma: {}, macd: null, rsi: null, kdj: null };
    `, context);
    await vm.runInContext('cachedFetch("sh")', context);
    assert.strictEqual(vm.runInContext('indicatorUpdateCount', context), 1);
    assert.strictEqual(vm.runInContext('frameQueue.length', context), 1);
    vm.runInContext('frameQueue.shift()()', context);
    assert.strictEqual(vm.runInContext('drawCount', context), 1);
    assert.strictEqual(vm.runInContext('sidebarRebuildCount', context), 1);
    assert.strictEqual(vm.runInContext('state.lockIdx', context), 1);
    assert.deepStrictEqual(JSON.parse(vm.runInContext('JSON.stringify(scheduledRefreshIds)', context)), ['sh']);
});

runTest('manual same-day refresh applies price and strategy panel without redrawing charts', async () => {
    const context = makeBrowserContext();
    const instrumentedConfigSource = configSource
        .replace("const customConfirm = (msg) => new Promise(resolve => {", "var customConfirm = (msg) => new Promise(resolve => {")
        .replace("const customAlert = (msg, isHtml = false) => new Promise(resolve => {", "var customAlert = (msg, isHtml = false) => new Promise(resolve => {");
    vm.runInContext(instrumentedConfigSource, context);
    const instrumentedDataSource = dataSource
        .replace(/async function checkCacheNeedUpdate\(id\) \{[\s\S]*?\n\}/, "async function checkCacheNeedUpdate(id) { return { needUpdate: true, reason: '数据过期' }; }")
        .replace(/async function syncData\(id\) \{[\s\S]*?\n\}/, "async function syncData(id) { return nextRows; }")
        .replace(/function dbSet\(id, data\) \{[\s\S]*?\n\}/, "function dbSet(id, data) { return Promise.resolve(); }");
    vm.runInContext(instrumentedDataSource, context);
    vm.runInContext(renderSource, context);
    vm.runInContext(`
        customAlert = async () => true;
        showToast = function() {};
        var drawCount = 0;
        var indicatorUpdateCount = 0;
        var sidebarRebuildCount = 0;
        draw = function() { drawCount++; };
        markIndicatorsDirty = function() {};
        updateAllIndicators = function() { indicatorUpdateCount++; };
        safeUpdateSidebar = function() { sidebarRebuildCount++; };
        renderMASelector = function() {};
        markRefreshTime = function() {};
        updateLeftMarketContext = function() {};

        var btn = document.getElementById('updateDataBtn');
        btn.disabled = false;
        btn.innerHTML = '';

        var cardPrice = document.getElementById('cardPrice');
        var header = { textContent: '2026-06-26 | SH000001' };
        var priceMain = { textContent: '101.00', className: 'price-main mono up', classList: { add() {}, remove() {} } };
        cardPrice.querySelector = function(selector) {
            if (selector === '.header-meta-row .mono') return header;
            if (selector === '.price-main') return priceMain;
            if (selector === '.price-sub') return { textContent: '+1.00 (+1.00%)', className: 'price-sub mono up', classList: { add() {}, remove() {} } };
            if (selector === '.amt-row .val') return { textContent: '10万', className: 'val', classList: { add() {}, remove() {} } };
            return null;
        };
        cardPrice.querySelectorAll = function(selector) {
            if (selector === '.data-box-row .val') {
                return [
                    { textContent: '100.00', className: 'val', classList: { add() {}, remove() {} } },
                    { textContent: '102.00', className: 'val', classList: { add() {}, remove() {} } },
                    { textContent: '99.00', className: 'val', classList: { add() {}, remove() {} } },
                    { textContent: '1万手', className: 'val', classList: { add() {}, remove() {} } }
                ];
            }
            return [];
        };
        cardPrice.style.display = 'flex';

        var cardAnalysis = document.getElementById('cardAnalysis');
        cardAnalysis.style.display = 'none';
        cardAnalysis.innerHTML = '<div class="action-panel">新手每日结论</div>';

        state.id = 'sh';
        state.mode = 'index';
        state.period = 'daily';
        state.rawData.sh = [
            { date: '2026-06-25', open: 100, high: 101, low: 99, close: 100, vol: 10000, amt: 100000 },
            { date: '2026-06-26', open: 100, high: 103, low: 99, close: 102, vol: 12000, amt: 120000, _decision: { simpleAction: '持币观望', position: 0 } }
        ];
        state.weeklyData.sh = convertDailyToWeekly(state.rawData.sh);
        state.lockIdx = 1;
        state.isFrozen = false;
        var nextRows = [
            { date: '2026-06-25', open: 100, high: 101, low: 99, close: 100, vol: 10000, amt: 100000 },
            { date: '2026-06-26', open: 100, high: 104, low: 99, close: 103, vol: 13000, amt: 130000, _decision: { simpleAction: '持币观望', position: 0 } }
        ];
    `, context);
    await vm.runInContext('handleUpdateData()', context);
    assert.strictEqual(vm.runInContext('document.getElementById("cardAnalysis").style.display', context), 'flex');
    assert.strictEqual(vm.runInContext('drawCount', context), 0);
    assert.strictEqual(vm.runInContext('indicatorUpdateCount', context), 1);
    assert.strictEqual(vm.runInContext('sidebarRebuildCount', context), 0);
});

runTest('period switch captures the old-period anchor before changing state.period', () => {
    assert.match(appSource, /const prevPeriod = state\.period;[\s\S]*const prevData = getActiveData\(\);[\s\S]*const prevLock = getPeriodLock\(prevPeriod\);[\s\S]*const anchorDate = prevData\?\.\[prevLock\]\?\.date[\s\S]*applyPeriodState\(p\);[\s\S]*setLockIdx\(alignLockToPeriod\(p, anchorDate\)\);/);
});

runTest('next day navigation clears frozen history state when it reaches the latest bar', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(dataSource, context);
    vm.runInContext(`
        function clearStaleTooltips() {}
        function draw() {}
        function safeUpdateSidebar() {}
        function updateFreezeBadge() {}
    `, context);
    vm.runInContext(appSourceNoInit, context);
    vm.runInContext(`
        state.id = 'sh';
        state.period = 'daily';
        state.rawData.sh = [
            { date: '2026-06-24' },
            { date: '2026-06-25' },
            { date: '2026-06-26' }
        ];
        state.lockIdx = 1;
        state.isFrozen = true;
        nextDay();
    `, context);
    assert.strictEqual(vm.runInContext('state.lockIdx', context), 2);
    assert.strictEqual(vm.runInContext('state.isFrozen', context), false);
});

runTest('main chart keeps hover preview but does not register click locking', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(dataSource, context);
    vm.runInContext(renderSource, context);
    vm.runInContext(`
        var originalGetElementById = document.getElementById.bind(document);
        document.getElementById = function(id) {
            var el = originalGetElementById(id);
            el.id = id;
            return el;
        };
        var chartConfigs = {};
        function Chart(el, cfg) { chartConfigs[el.id] = cfg; }
        Chart.getChart = function() { return null; };
        updateAllIndicators = function() {};
        updateCrosshairOverlay = function() {};
        state.id = 'sh';
        state.mode = 'index';
        state.period = 'daily';
        state.range = 90;
        state.rawData.sh = [
            { date: '2026-06-24', open: 1, high: 2, low: 1, close: 1, vol: 1, amt: 1, _decision: { bsMark: null } },
            { date: '2026-06-25', open: 1, high: 2, low: 1, close: 1, vol: 1, amt: 1, _decision: { bsMark: null } },
            { date: '2026-06-26', open: 1, high: 2, low: 1, close: 1, vol: 1, amt: 1, _decision: { bsMark: null } }
        ];
        state.weeklyData.sh = convertDailyToWeekly(state.rawData.sh);
        state.indicators.ma = { 5: [1, 1, 1], 20: [1, 1, 1], 60: [1, 1, 1] };
        state.indicators.macd = { diff: [0, 0, 0], dea: [0, 0, 0], bar: [0, 0, 0] };
        state.indicators.kdj = { k: [50, 50, 50], d: [50, 50, 50], j: [50, 50, 50] };
        state.lockIdx = 2;
        state.isFrozen = false;
        draw();
    `, context);
    assert.strictEqual(vm.runInContext('typeof chartConfigs.mainChart.options.onHover', context), 'function');
    assert.strictEqual(vm.runInContext('chartConfigs.mainChart.options.onClick', context), undefined);
});

runTest('latest button shows historical state whenever the chart is frozen', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(dataSource, context);
    vm.runInContext(renderSource, context);
    vm.runInContext(`
        var btnClasses = new Set(['btn-sm']);
        var btn = {
            get className() { return Array.from(btnClasses).join(' '); },
            classList: {
                add(name) { btnClasses.add(name); },
                remove(name) { btnClasses.delete(name); }
            }
        };
        document.getElementById = function(id) { return id === 'btnResetLatest' ? btn : null; };
        getSignalMeta = function() { return {}; };
        generateAnalysisHTML = function() { return ''; };
        state.isFrozen = true;
        updateNavCapsuleVisuals(2, 3);
        var frozenClass = btn.className;
        state.isFrozen = false;
        updateNavCapsuleVisuals(2, 3);
        var latestClass = btn.className;
        state.isFrozen = true;
        var frozenBundle = generateSidebarBundle(
            { date: '2026-06-26', open: 1, high: 1, low: 1, close: 1, vol: 1, amt: 1 },
            { date: '2026-06-25', open: 1, high: 1, low: 1, close: 1, vol: 1, amt: 1 },
            2,
            [
                { date: '2026-06-24', open: 1, high: 1, low: 1, close: 1, vol: 1, amt: 1 },
                { date: '2026-06-25', open: 1, high: 1, low: 1, close: 1, vol: 1, amt: 1 },
                { date: '2026-06-26', open: 1, high: 1, low: 1, close: 1, vol: 1, amt: 1, _signals: [] }
            ]
        );
    `, context);
    assert.ok(vm.runInContext('frozenClass.includes("is-history")', context));
    assert.ok(!vm.runInContext('frozenClass.includes("active")', context));
    assert.ok(vm.runInContext('latestClass.includes("active")', context));
    assert.ok(!vm.runInContext('latestClass.includes("is-history")', context));
    assert.ok(vm.runInContext('frozenBundle.priceHtml.includes("btn-sm is-history")', context));
    assert.ok(!vm.runInContext('frozenBundle.priceHtml.includes("btn-sm active")', context));
});

runTest('refresh bar shows a compact data status badge with hover detail', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    const fixedClockDataSource = dataSource
        .replace(/function getBJDate\(\) \{ return new Date\(new Date\(\)\.toLocaleString\("en-US", \{timeZone: "Asia\/Shanghai"\}\)\); \}/, "function getBJDate() { return new Date('2026-06-30T10:30:00+08:00'); }");
    vm.runInContext(fixedClockDataSource, context);
    vm.runInContext(renderSource, context);
    vm.runInContext(`
        getSignalMeta = function() { return { windowScore: 0, windowSignals: [], buySignals: [], exitSignals: [], warningSignals: [] }; };
        generateAnalysisHTML = function() { return ''; };
        state.id = 'sh';
        state.mode = 'index';
        state.period = 'daily';

        var confirmedRows = [
            { date: '2026-06-29', open: 100, high: 101, low: 99, close: 100, vol: 1000, amt: 10000 },
            { date: '2026-06-30', open: 100, high: 102, low: 99, close: 101, vol: 1200, amt: 12000 }
        ];
        state.rawData.sh = confirmedRows;
        state.confirmedStatus.sh = { status: 'fresh', lastDate: '2026-06-30' };
        state.displayStatus.sh = { mode: 'confirmed' };
        var confirmedBundle = generateSidebarBundle(confirmedRows[1], confirmedRows[0], 1, confirmedRows);
        var confirmedStatusHtml = renderDataStatusRefreshBadge(confirmedRows[1], 'sh', confirmedRows);

        state.rawData.sh = [{ date: '2026-06-29', open: 100, high: 101, low: 99, close: 100, vol: 1000, amt: 10000 }];
        setLiveBar('sh', { date: '2026-06-30', open: 100, high: 103, low: 99, close: 102, vol: 1500, amt: 15000 });
        var overlayData = getActiveData();
        var overlayBundle = generateSidebarBundle(overlayData[overlayData.length - 1], overlayData[overlayData.length - 2], overlayData.length - 1, overlayData);
        var overlayStatusHtml = renderDataStatusRefreshBadge(overlayData[overlayData.length - 1], 'sh', overlayData);

        state.liveBars = {};
        state.liveQuotes = {};
        state.rawData.sh = [{ date: '2026-06-26', open: 100, high: 101, low: 99, close: 100, vol: 1000, amt: 10000 }];
        state.confirmedStatus.sh = { status: 'stale', lastDate: '2026-06-26' };
        setLiveQuote('sh', { date: '2026-06-30', open: 100, high: 103, low: 99, close: 102, vol: 1500, amt: 15000 }, 'quote-only', 'confirmed-history-stale');
        var quoteOnlyBundle = generateSidebarBundle(state.rawData.sh[0], null, 0, state.rawData.sh);
        var quoteOnlyStatusHtml = renderDataStatusRefreshBadge(state.rawData.sh[0], 'sh', state.rawData.sh);

        state.displayStatus.sh = {};
        state.confirmedStatus.sh = { status: 'failed', lastDate: '2026-06-26' };
        var failedBundle = generateSidebarBundle(state.rawData.sh[0], null, 0, state.rawData.sh);
        var failedStatusHtml = renderDataStatusRefreshBadge(state.rawData.sh[0], 'sh', state.rawData.sh);
    `, context);
    const result = JSON.parse(vm.runInContext(`JSON.stringify({
        confirmedPrice: confirmedBundle.priceHtml,
        overlayPrice: overlayBundle.priceHtml,
        quoteOnlyPrice: quoteOnlyBundle.priceHtml,
        failedPrice: failedBundle.priceHtml,
        confirmedStatus: confirmedStatusHtml,
        overlayStatus: overlayStatusHtml,
        quoteOnlyStatus: quoteOnlyStatusHtml,
        failedStatus: failedStatusHtml
    })`, context));
    assert.ok(!result.confirmedPrice.includes('data-status-row'), result.confirmedPrice);
    assert.ok(!result.overlayPrice.includes('data-status-row'), result.overlayPrice);
    assert.ok(result.confirmedStatus.includes('收盘确认'), result.confirmedStatus);
    assert.ok(result.confirmedStatus.includes('title="按确认历史计算。"'), result.confirmedStatus);
    assert.ok(result.overlayStatus.includes('盘中临时'), result.overlayStatus);
    assert.ok(result.overlayStatus.includes('title="实时价已进入图表。"'), result.overlayStatus);
    assert.ok(result.quoteOnlyStatus.includes('仅左侧报价'), result.quoteOnlyStatus);
    assert.ok(result.quoteOnlyStatus.includes('title="右侧仍按确认K线。"'), result.quoteOnlyStatus);
    assert.ok(result.failedStatus.includes('历史同步失败'), result.failedStatus);
    assert.ok(result.failedStatus.includes('title="正在使用本地缓存'), result.failedStatus);
});

runTest('status smoke script validates data status attributes and chart recovery', () => {
    const scriptSource = read('scripts/status-smoke.js');
    assert.ok(scriptSource.includes("const DEFAULT_PORT = 8766"), 'status smoke should default to the project smoke port');
    assert.ok(scriptSource.includes("viewport: { width: 1440, height: 900 }"), 'status smoke should force a desktop viewport');
    assert.ok(scriptSource.includes("const EXPECTED_VERSION = VERSION.resourceVersion;"), 'status smoke should read the expected resource version from version.json');
    assert.ok(scriptSource.includes("data-dg-display-mode"), 'status smoke must read display mode attributes');
    assert.ok(scriptSource.includes("data-dg-confirmed-status"), 'status smoke must read confirmed status attributes');
    assert.ok(scriptSource.includes("data-dg-confirmed-date"), 'status smoke must read confirmed date attributes');
    assert.ok(scriptSource.includes("data-dg-item-live"), 'status smoke must read live item attributes');
    assert.ok(scriptSource.includes("mainChart") && scriptSource.includes("volumeChart") && scriptSource.includes("macdChart") && scriptSource.includes("kdjChart"), 'status smoke must verify all four chart canvases');
    assert.ok(scriptSource.includes("emptyHintCount") && scriptSource.includes("noDataText"), 'status smoke must verify no empty chart hints remain');
    assert.ok(scriptSource.includes("warn") && scriptSource.includes("error"), 'status smoke must collect warning/error console logs');
    assert.ok(scriptSource.includes("blockingConsole"), 'status smoke should separate local blocking console errors from external data-source noise');
    assert.ok(scriptSource.includes("externalResourceFailures"), 'status smoke should report external data-source request failures without failing the UI smoke');
    assert.ok(scriptSource.includes("isLocalAppUrl"), 'status smoke should only fail on local app/resource console errors');
    assert.ok(scriptSource.includes("'confirmed', 'live-overlay', 'cached-live-overlay', 'post-close-pending', 'quote-only'"), 'status smoke should accept every valid display mode from the data contract');
    assert.ok(scriptSource.includes("validateStatusBadges"), 'status smoke should validate badge consistency instead of hard-coding one market state');
    assert.ok(scriptSource.includes("conclusionStatusCount === 0"), 'status smoke should confirm the conclusion card has no duplicate status badge');
    assert.ok(!scriptSource.includes("conclusionBadge"), 'status smoke should not read a conclusion status badge');
    const externalUrls = [...scriptSource.matchAll(/https?:\/\/[^`'"\s)]+/g)]
        .map(match => match[0])
        .filter(url => !url.includes('127.0.0.1') && !url.includes('localhost'));
    assert.deepStrictEqual(externalUrls, [], 'status smoke should only target the local app URL');
    assert.ok(!/\bfetch\s*\(/.test(scriptSource), 'status smoke should not call network APIs directly');
});

runTest('live dataflow smoke script validates realtime overlay, left tab, and drag performance', () => {
    const scriptSource = read('scripts/live-dataflow-smoke.js');
    assert.ok(scriptSource.includes('https://woodslope.github.io/dailyglance'), 'live dataflow smoke should default to the deployed GitHub Pages URL');
    assert.ok(scriptSource.includes("const EXPECTED_RESOURCE_VERSION = VERSION.resourceVersion;"), 'live dataflow smoke should read the current resource version from version.json');
    assert.ok(scriptSource.includes("const EXPECTED_APP_BUILD = VERSION.appBuild;"), 'live dataflow smoke should read the current app build from version.json');
    assert.ok(scriptSource.includes("APP_BUILD: window.__DG_BUILD__"), 'live dataflow smoke should read the deployed app build');
    assert.ok(scriptSource.includes("SIGNAL_VERSION"), 'live dataflow smoke should read the deployed signal version');
    assert.ok(scriptSource.includes("rawLatest"), 'live dataflow smoke must inspect confirmed raw history');
    assert.ok(scriptSource.includes("activeLatest"), 'live dataflow smoke must inspect active chart/right-panel data');
    assert.ok(scriptSource.includes("liveQuote"), 'live dataflow smoke must inspect realtime quote data');
    assert.ok(scriptSource.includes("liveBar"), 'live dataflow smoke must inspect realtime overlay data');
    assert.ok(scriptSource.includes("leftTabs"), 'live dataflow smoke must verify the left list tab state');
    assert.ok(scriptSource.includes("#mainTabs .nav-btn[data-tab=\"index\"]"), 'live dataflow smoke should assert the index tab is active');
    assert.ok(scriptSource.includes("indexNavList"), 'live dataflow smoke should verify the index list is visible');
    assert.ok(scriptSource.includes("stockNavList"), 'live dataflow smoke should verify the stock watchlist tab is not active during index checks');
    assert.ok(scriptSource.includes("activeIndexItem"), 'live dataflow smoke should verify the active left index row');
    assert.ok(scriptSource.includes("drawViewportCount"), 'live dataflow smoke should measure drawViewport calls during drag');
    assert.ok(scriptSource.includes("item.transform === '' || item.transform === 'translateX(0px)'"), 'live dataflow smoke should accept unset or explicitly reset drag transforms');
    assert.ok(scriptSource.includes("const endX = startX -"), 'live dataflow smoke should drag left from latest to enter history');
    assert.ok(scriptSource.includes("rightPrice"), 'live dataflow smoke should compare right panel price/date with active data');
    assert.ok(scriptSource.includes("cached-live-overlay"), 'live dataflow smoke should accept cached live overlays');
    assert.ok(scriptSource.includes("data-dg-display-mode"), 'live dataflow smoke should verify display status badges');
    assert.ok(scriptSource.includes("conclusionStatusCount === 0"), 'live dataflow smoke should confirm the conclusion card has no duplicate status badge');
    assert.ok(!scriptSource.includes("conclusionBadge"), 'live dataflow smoke should not read a conclusion status badge');
    assert.ok(!scriptSource.includes("badgeText: text('#cardAnalysis .conclusion-status-pill')"), 'live dataflow smoke should not read conclusion badge text');
    assert.ok(!/\bfetch\s*\(/.test(scriptSource), 'live dataflow smoke should observe the app instead of calling market APIs directly');
});

runTest('hovered historical bar uses the historical visual state without freezing', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(dataSource, context);
    vm.runInContext(renderSource, context);
    vm.runInContext(`
        var badgeDateText = '';
        var badge = {
            style: { display: 'none' },
            querySelector(sel) {
                return sel === '.freeze-badge-date'
                    ? { set textContent(value) { badgeDateText = value; }, get textContent() { return badgeDateText; } }
                    : null;
            }
        };
        var overlayClasses = new Set();
        var hLineClasses = new Set();
        var mainBoxClasses = new Set();
        var overlay = { classList: { add(name) { overlayClasses.add(name); }, remove(name) { overlayClasses.delete(name); } } };
        var line = { style: {} };
        var hLine = { style: {}, classList: { add(name) { hLineClasses.add(name); }, remove(name) { hLineClasses.delete(name); } } };
        var mainBox = { classList: { add(name) { mainBoxClasses.add(name); }, remove(name) { mainBoxClasses.delete(name); } } };
        document.getElementById = function(id) {
            if (id === 'freezeBadge') return badge;
            if (id === 'crosshairOverlay') return overlay;
            if (id === 'crosshairLine') return line;
            if (id === 'crosshairHLine') return hLine;
            return null;
        };
        document.querySelector = function(sel) { return sel === '.main-chart-box' ? mainBox : null; };
        state.id = 'sh';
        state.period = 'daily';
        state.rawData.sh = [
            { date: '2026-06-24', close: 1 },
            { date: '2026-06-25', close: 2 },
            { date: '2026-06-26', close: 3 }
        ];
        state.lockIdx = 1;
        state.isFrozen = false;
        state.charts.main = {
            data: { labels: ['2026-06-24', '2026-06-25', '2026-06-26'] },
            scales: {
                x: { left: 0, right: 300, getPixelForValue(i) { return i * 100; } },
                y: { top: 0, bottom: 300, getPixelForValue(v) { return v * 50; } }
            }
        };
        updateFreezeBadge();
        updateCrosshairOverlay();
        var visualState = {
            badgeDisplay: badge.style.display,
            badgeDateText,
            overlayHistorical: overlayClasses.has('historical'),
            overlayFrozen: overlayClasses.has('frozen'),
            mainHistorical: mainBoxClasses.has('historical'),
            mainFrozen: mainBoxClasses.has('frozen'),
            stateFrozen: state.isFrozen
        };
    `, context);
    assert.deepStrictEqual(JSON.parse(vm.runInContext('JSON.stringify(visualState)', context)), {
        badgeDisplay: 'flex',
        badgeDateText: ' · 2026-06-25',
        overlayHistorical: true,
        overlayFrozen: false,
        mainHistorical: true,
        mainFrozen: false,
        stateFrozen: false
    });
});

runTest('chart hover updates the historical badge for previewed bars', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(dataSource, context);
    vm.runInContext(renderSource, context);
    vm.runInContext(`
        var badgeDateText = '';
        var badge = {
            style: { display: 'none' },
            querySelector(sel) {
                return sel === '.freeze-badge-date'
                    ? { set textContent(value) { badgeDateText = value; }, get textContent() { return badgeDateText; } }
                    : null;
            }
        };
        var overlay = { classList: { add() {}, remove() {} } };
        var line = { style: {} };
        var hLine = { style: {}, classList: { add() {}, remove() {} } };
        var mainBox = { classList: { add() {}, remove() {} } };
        document.getElementById = function(id) {
            if (id === 'freezeBadge') return badge;
            if (id === 'crosshairOverlay') return overlay;
            if (id === 'crosshairLine') return line;
            if (id === 'crosshairHLine') return hLine;
            return null;
        };
        document.querySelector = function(sel) { return sel === '.main-chart-box' ? mainBox : null; };
        requestAnimationFrame = function(fn) { fn(); return 1; };
        safeUpdateSidebar = function() {};
        state.id = 'sh';
        state.period = 'daily';
        state.range = 90;
        state.rawData.sh = [
            { date: '2026-06-24', close: 1 },
            { date: '2026-06-25', close: 2 },
            { date: '2026-06-26', close: 3 }
        ];
        state.lockIdx = 2;
        state.isFrozen = false;
        state.charts.main = {
            data: { labels: ['2026-06-24', '2026-06-25', '2026-06-26'] },
            scales: {
                x: { left: 0, right: 300, getPixelForValue(i) { return i * 100; } },
                y: { top: 0, bottom: 300, getPixelForValue(v) { return v * 50; } }
            }
        };
        handleChartHover({ type: 'mousemove' }, [{ index: 1 }]);
        var hoverBadgeState = {
            badgeDisplay: badge.style.display,
            badgeDateText,
            lockIdx: state.lockIdx,
            frozen: state.isFrozen
        };
    `, context);
    assert.deepStrictEqual(JSON.parse(vm.runInContext('JSON.stringify(hoverBadgeState)', context)), {
        badgeDisplay: 'flex',
        badgeDateText: ' · 2026-06-25',
        lockIdx: 1,
        frozen: false
    });
});

runTest('main chart mouseleave restores latest badge date and crosshair state together', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(dataSource, context);
    vm.runInContext(renderSource, context);
    vm.runInContext(`
        var badgeDateText = '';
        var renderedDate = '';
        var badge = {
            style: { display: 'none' },
            querySelector(sel) {
                return sel === '.freeze-badge-date'
                    ? { set textContent(value) { badgeDateText = value; }, get textContent() { return badgeDateText; } }
                    : null;
            }
        };
        var overlayClasses = new Set();
        var hLineClasses = new Set();
        var mainBoxClasses = new Set();
        var overlay = { classList: { add(name) { overlayClasses.add(name); }, remove(name) { overlayClasses.delete(name); } } };
        var line = { style: {} };
        var hLine = { style: {}, classList: { add(name) { hLineClasses.add(name); }, remove(name) { hLineClasses.delete(name); } } };
        var mainBox = { classList: { add(name) { mainBoxClasses.add(name); }, remove(name) { mainBoxClasses.delete(name); } } };
        document.getElementById = function(id) {
            if (id === 'freezeBadge') return badge;
            if (id === 'crosshairOverlay') return overlay;
            if (id === 'crosshairLine') return line;
            if (id === 'crosshairHLine') return hLine;
            return null;
        };
        document.querySelector = function(sel) { return sel === '.main-chart-box' ? mainBox : null; };
        requestAnimationFrame = function(fn) { fn(); return 1; };
        cancelAnimationFrame = function() {};
        safeUpdateSidebar = function() {
            var rd = getActiveData();
            var idx = getSafeIndex(rd);
            renderedDate = rd[idx].date;
        };
        state.id = 'sh';
        state.period = 'daily';
        state.range = 90;
        state.rawData.sh = [
            { date: '2026-06-24', close: 1 },
            { date: '2026-06-25', close: 2 },
            { date: '2026-06-26', close: 3 }
        ];
        state.lockIdx = 2;
        state.isFrozen = false;
        state.charts.main = {
            data: { labels: ['2026-06-24', '2026-06-25', '2026-06-26'] },
            scales: {
                x: { left: 0, right: 300, getPixelForValue(i) { return i * 100; } },
                y: { top: 0, bottom: 300, getPixelForValue(v) { return v * 50; } }
            }
        };
        handleChartHover({ type: 'mousemove' }, [{ index: 1 }]);
        resetHoverSelectionToLatest();
        var mouseleaveState = {
            badgeDisplay: badge.style.display,
            badgeDateText,
            renderedDate,
            lockIdx: state.lockIdx,
            frozen: state.isFrozen,
            overlayHistorical: overlayClasses.has('historical'),
            mainHistorical: mainBoxClasses.has('historical')
        };
    `, context);
    assert.deepStrictEqual(JSON.parse(vm.runInContext('JSON.stringify(mouseleaveState)', context)), {
        badgeDisplay: 'none',
        badgeDateText: ' · 2026-06-25',
        renderedDate: '2026-06-26',
        lockIdx: 2,
        frozen: false,
        overlayHistorical: false,
        mainHistorical: false
    });
});

runTest('latest button click directly restores latest nav state', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(dataSource, context);
    vm.runInContext(renderSource, context);
    vm.runInContext(appSourceNoInit, context);
    vm.runInContext(`
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
        draw = function() {};
        safeUpdateSidebar = function() {};
        updateFreezeBadge = function() {};
        state.id = 'sh';
        state.period = 'daily';
        state.rawData.sh = [
            { date: '2026-06-24' },
            { date: '2026-06-25' },
            { date: '2026-06-26' }
        ];
        state.lockIdx = 1;
        state.isFrozen = true;
        resetLatest();
        var latestClickClass = btn.className;
    `, context);
    assert.strictEqual(vm.runInContext('state.lockIdx', context), 2);
    assert.strictEqual(vm.runInContext('state.isFrozen', context), false);
    assert.ok(vm.runInContext('latestClickClass.includes("active")', context));
    assert.ok(!vm.runInContext('latestClickClass.includes("is-history")', context));
});

runTest('range preset renders the window around a historical locked bar instead of always using the latest tail', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(dataSource, context);
    vm.runInContext(renderSource, context);
    vm.runInContext(`
        var originalGetElementById = document.getElementById.bind(document);
        document.getElementById = function(id) {
            var el = originalGetElementById(id);
            el.id = id;
            return el;
        };
        var chartConfigs = {};
        function Chart(el, cfg) { chartConfigs[el.id] = cfg; }
        Chart.getChart = function() { return null; };
        updateAllIndicators = function() {};
        updateCrosshairOverlay = function() {};
        state.id = 'sh';
        state.mode = 'index';
        state.period = 'daily';
        state.range = 90;
        state.isFrozen = true;
        state.rawData.sh = Array.from({ length: 200 }, function(_, i) {
            return {
                date: 'D' + String(i).padStart(3, '0'),
                open: 100 + i,
                high: 101 + i,
                low: 99 + i,
                close: 100 + i,
                vol: 1000 + i,
                amt: 100000 + i,
                _decision: { bsMark: i === 50 ? 'B' : null, position: 0 }
            };
        });
        state.weeklyData.sh = convertDailyToWeekly(state.rawData.sh);
        state.indicators.ma = {
            5: state.rawData.sh.map(item => item.close),
            20: state.rawData.sh.map(item => item.close),
            60: state.rawData.sh.map(item => item.close)
        };
        state.indicators.macd = {
            diff: state.rawData.sh.map(() => 0),
            dea: state.rawData.sh.map(() => 0),
            bar: state.rawData.sh.map(() => 0)
        };
        state.indicators.kdj = {
            k: state.rawData.sh.map(() => 50),
            d: state.rawData.sh.map(() => 50),
            j: state.rawData.sh.map(() => 50)
        };
        setLockIdx(50);
        draw();
    `, context);
    const labels = JSON.parse(vm.runInContext('JSON.stringify(chartConfigs.mainChart.data.labels)', context));
    assert.strictEqual(labels.length, 90);
    assert.ok(labels.includes('D050'), 'historical locked bar should remain visible');
    assert.ok(!labels.includes('D199'), 'historical browse window should not be forced to the latest tail');
});

runTest('changing the range preset redraws the viewport without recomputing indicators', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(dataSource, context);
    vm.runInContext(renderSource, context);
    vm.runInContext(appSourceNoInit, context);
    vm.runInContext(`
        var originalGetElementById = document.getElementById.bind(document);
        document.getElementById = function(id) {
            var el = originalGetElementById(id);
            el.id = id;
            return el;
        };
        var chartConfigs = {};
        function Chart(el, cfg) { chartConfigs[el.id] = cfg; }
        Chart.getChart = function() { return null; };
        updateCrosshairOverlay = function() {};

        state.id = 'sh';
        state.mode = 'index';
        state.period = 'daily';
        state.range = 90;
        state.isFrozen = false;
        state.rawData.sh = Array.from({ length: 200 }, function(_, i) {
            return {
                date: 'D' + String(i).padStart(3, '0'),
                open: 100 + i,
                high: 101 + i,
                low: 99 + i,
                close: 100 + i,
                vol: 1000 + i,
                amt: 100000 + i,
                _decision: { bsMark: null, position: 0 }
            };
        });
        state.weeklyData.sh = convertDailyToWeekly(state.rawData.sh);
        state.indicators.ma = {
            5: state.rawData.sh.map(item => item.close),
            20: state.rawData.sh.map(item => item.close),
            60: state.rawData.sh.map(item => item.close)
        };
        state.indicators.macd = {
            diff: state.rawData.sh.map(() => 0),
            dea: state.rawData.sh.map(() => 0),
            bar: state.rawData.sh.map(() => 0)
        };
        state.indicators.kdj = {
            k: state.rawData.sh.map(() => 50),
            d: state.rawData.sh.map(() => 50),
            j: state.rawData.sh.map(() => 50)
        };
        setLockIdx(199);
        resetViewportToLatest(state.rawData.sh);
        var indicatorCalls = 0;
        updateAllIndicators = function() { indicatorCalls++; };
        state.range = 180;
        drawViewport();
    `, context);
    const labels = JSON.parse(vm.runInContext('JSON.stringify(chartConfigs.mainChart.data.labels)', context));
    assert.strictEqual(labels.length, 180);
    assert.strictEqual(vm.runInContext('indicatorCalls', context), 0);
    assert.ok(labels.includes('D199'));
});

runTest('panning viewport moves the visible window and restores latest state at the tail', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(dataSource, context);
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
        var before = getVisibleRange(state.rawData.sh);
        panViewportByBars(-10, state.rawData.sh);
        var historical = getVisibleRange(state.rawData.sh);
        var historicalState = {
            frozen: state.isFrozen,
            lockIdx: state.lockIdx,
            viewport: state.viewport
        };
        panViewportByBars(1000, state.rawData.sh);
        var latest = getVisibleRange(state.rawData.sh);
        var latestState = {
            frozen: state.isFrozen,
            lockIdx: state.lockIdx,
            viewport: state.viewport
        };
    `, context);
    assert.deepStrictEqual(JSON.parse(vm.runInContext('JSON.stringify(before)', context)), { start: 110, end: 199, length: 90 });
    assert.deepStrictEqual(JSON.parse(vm.runInContext('JSON.stringify(historical)', context)), { start: 100, end: 189, length: 90 });
    assert.deepStrictEqual(JSON.parse(vm.runInContext('JSON.stringify(historicalState)', context)), {
        frozen: true,
        lockIdx: 189,
        viewport: { mode: 'pan', endIdx: 189, anchorIdx: 189 }
    });
    assert.deepStrictEqual(JSON.parse(vm.runInContext('JSON.stringify(latest)', context)), { start: 110, end: 199, length: 90 });
    assert.deepStrictEqual(JSON.parse(vm.runInContext('JSON.stringify(latestState)', context)), {
        frozen: false,
        lockIdx: 199,
        viewport: { mode: 'latest', endIdx: 199, anchorIdx: 199 }
    });
});

runTest('main chart drag left from latest enters historical viewport consistently', () => {
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

        var canvas = {
            setPointerCapture() {},
            releasePointerCapture() {},
            closest() {
                return {
                    classList: { add() {}, remove() {}, contains() { return false; } }
                };
            }
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
            badgeCalls
        };
    `, context);
    assert.deepStrictEqual(JSON.parse(vm.runInContext('JSON.stringify(rangeAfterDrag)', context)), { start: 101, end: 190, length: 90 });
    assert.deepStrictEqual(JSON.parse(vm.runInContext('JSON.stringify(dragState)', context)), {
        frozen: true,
        lockIdx: 190,
        viewport: { mode: 'pan', endIdx: 190, anchorIdx: 190 },
        drawCalls: 1,
        sidebarCalls: 1,
        badgeCalls: 1
    });
});

runTest('main chart drag release ignores stale hover events after panning', () => {
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

        var canvas = {
            setPointerCapture() {},
            releasePointerCapture() {},
            closest() {
                return {
                    classList: { add() {}, remove() {}, contains() { return false; } }
                };
            }
        };
        state.charts.main = {
            data: { labels: Array.from({ length: 90 }, function(_, i) { return 'V' + i; }) },
            scales: { x: { width: 900, left: 0, right: 900 } }
        };
        var drawCalls = 0;
        var sidebarCalls = 0;
        drawViewport = function() { drawCalls++; };
        safeUpdateSidebar = function() { sidebarCalls++; };
        updateFreezeBadge = function() {};
        updateCrosshairOverlay = function() {};
        clearStaleTooltips = function() {};

        startChartDragPan({ button: 0, clientX: 500, currentTarget: canvas, pointerId: 1, preventDefault() {} });
        moveChartDragPan({ clientX: 410, preventDefault() {} });
        finishChartDragPan({ pointerId: 1, currentTarget: canvas });
        var afterRelease = { lockIdx: state.lockIdx, viewport: state.viewport, frozen: state.isFrozen };

        handleChartHover({ type: 'mousemove' }, [{ index: 45 }]);
        var afterStaleHover = { lockIdx: state.lockIdx, viewport: state.viewport, frozen: state.isFrozen, drawCalls, sidebarCalls };
    `, context);
    assert.deepStrictEqual(JSON.parse(vm.runInContext('JSON.stringify(afterRelease)', context)), {
        lockIdx: 190,
        viewport: { mode: 'pan', endIdx: 190, anchorIdx: 190 },
        frozen: true
    });
    assert.deepStrictEqual(JSON.parse(vm.runInContext('JSON.stringify(afterStaleHover)', context)), {
        lockIdx: 190,
        viewport: { mode: 'pan', endIdx: 190, anchorIdx: 190 },
        frozen: true,
        drawCalls: 1,
        sidebarCalls: 1
    });
});

runTest('main chart drag clamped at latest suppresses stale hover after release', () => {
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

        var canvas = {
            setPointerCapture() {},
            releasePointerCapture() {},
            closest() {
                return {
                    classList: { add() {}, remove() {}, contains() { return false; } }
                };
            }
        };
        state.charts.main = {
            data: { labels: Array.from({ length: 90 }, function(_, i) { return 'V' + i; }) },
            scales: { x: { width: 900, left: 0, right: 900 } }
        };
        var drawCalls = 0;
        var sidebarCalls = 0;
        drawViewport = function() { drawCalls++; };
        safeUpdateSidebar = function() { sidebarCalls++; };
        updateFreezeBadge = function() {};
        updateCrosshairOverlay = function() {};
        clearStaleTooltips = function() {};

        startChartDragPan({ button: 0, clientX: 500, currentTarget: canvas, pointerId: 1, preventDefault() {} });
        moveChartDragPan({ clientX: 590, preventDefault() {} });
        finishChartDragPan({ pointerId: 1, currentTarget: canvas });
        var afterRelease = { lockIdx: state.lockIdx, viewport: state.viewport, frozen: state.isFrozen };

        handleChartHover({ type: 'mousemove' }, [{ index: 45 }]);
        var afterStaleHover = { lockIdx: state.lockIdx, viewport: state.viewport, frozen: state.isFrozen, drawCalls, sidebarCalls };
    `, context);
    assert.deepStrictEqual(JSON.parse(vm.runInContext('JSON.stringify(afterRelease)', context)), {
        lockIdx: 199,
        viewport: { mode: 'latest', endIdx: 199, anchorIdx: 199 },
        frozen: false
    });
    assert.deepStrictEqual(JSON.parse(vm.runInContext('JSON.stringify(afterStaleHover)', context)), {
        lockIdx: 199,
        viewport: { mode: 'latest', endIdx: 199, anchorIdx: 199 },
        frozen: false,
        drawCalls: 0,
        sidebarCalls: 0
    });
});

runTest('dragging pans the viewport while keeping residual preview bounded', () => {
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
            },
            style: {}
        };
        var canvas = {
            setPointerCapture() {},
            releasePointerCapture() {},
            closest() { return mainBox; }
        };
        document.querySelectorAll = function(selector) {
            if (selector === '.main-chart-box, .volume-chart-box, .macd-chart-box, .kdj-chart-box, #crosshairOverlay') {
                return [mainBox];
            }
            return [];
        };
        state.charts.main = { data: { labels: Array.from({ length: 90 }, function(_, i) { return 'V' + i; }) }, scales: { x: { width: 900, left: 0, right: 900 } } };
        var drawCalls = 0;
        var sidebarCalls = 0;
        drawViewport = function() { drawCalls++; };
        safeUpdateSidebar = function() { sidebarCalls++; };
        clearStaleTooltips = function() {};
        updateFreezeBadge = function() {};
        updateCrosshairOverlay = function() {};
        requestAnimationFrame = function(fn) { fn(); return 1; };
        startChartDragPan({ button: 0, clientX: 500, currentTarget: canvas, pointerId: 1, preventDefault() {} });
        moveChartDragPan({ clientX: 410, preventDefault() {} });
        var previewDuringMove = mainBox.style.transform || '';
        var rangeDuringMove = getVisibleRange(state.rawData.sh);
        finishChartDragPan({ pointerId: 1, currentTarget: canvas });
        var dragPreviewState = { previewDuringMove, rangeDuringMove, drawCalls, sidebarCalls, isDraggingClass: mainBoxClasses.has('drag-panning') };
    `, context);
    assert.ok(vm.runInContext('dragPreviewState.previewDuringMove === ""', context));
    assert.deepStrictEqual(JSON.parse(vm.runInContext('JSON.stringify(dragPreviewState)', context)), {
        previewDuringMove: '',
        rangeDuringMove: { start: 101, end: 190, length: 90 },
        drawCalls: 1,
        sidebarCalls: 1,
        isDraggingClass: false
    });
});

runTest('drag panning clears stale tooltips without forcing extra chart updates', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(dataSource, context);
    vm.runInContext(renderSource, context);
    vm.runInContext(`
        var updateCalls = 0;
        var setActiveCalls = 0;
        state.charts = {
            main: { tooltip: { setActiveElements() { setActiveCalls++; } }, update() { updateCalls++; } },
            vol: { tooltip: { setActiveElements() { setActiveCalls++; } }, update() { updateCalls++; } },
            macd: { tooltip: { setActiveElements() { setActiveCalls++; } }, update() { updateCalls++; } },
            kdj: { tooltip: { setActiveElements() { setActiveCalls++; } }, update() { updateCalls++; } }
        };
        clearStaleTooltips();
        var tooltipClearState = { updateCalls, setActiveCalls };
    `, context);
    assert.deepStrictEqual(JSON.parse(vm.runInContext('JSON.stringify(tooltipClearState)', context)), {
        updateCalls: 0,
        setActiveCalls: 4
    });
});

runTest('chart drag binding does not add a click lock handler', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(dataSource, context);
    vm.runInContext(renderSource, context);
    vm.runInContext(`
        var targetHandlers = {};
        var docHandlers = {};
        var target = {
            addEventListener(type, fn, options) { targetHandlers[type] = { fn, options }; }
        };
        document.querySelector = function(selector) { return selector === '.integrated-container' ? target : null; };
        document.addEventListener = function(type, fn) { docHandlers[type] = fn; };
        bindChartDragPan();
    `, context);
    assert.deepStrictEqual(JSON.parse(vm.runInContext('JSON.stringify(Object.keys(targetHandlers).sort())', context)), [
        'lostpointercapture',
        'mousedown',
        'pointercancel',
        'pointerdown',
        'pointermove',
        'pointerup',
        'wheel'
    ]);
    assert.deepStrictEqual(JSON.parse(vm.runInContext('JSON.stringify(Object.keys(docHandlers).sort())', context)), [
        'mousemove',
        'mouseup'
    ]);
    assert.strictEqual(vm.runInContext('targetHandlers.click', context), undefined);
});

runTest('trackpad horizontal wheel pans the main chart viewport', () => {
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

        var targetHandlers = {};
        var mainBox = {
            classList: { add() {}, remove() {}, contains() { return false; } }
        };
        var target = {
            addEventListener(type, fn, options) { targetHandlers[type] = { fn, options }; },
            setPointerCapture() {},
            releasePointerCapture() {},
            closest() { return null; }
        };
        document.querySelector = function(selector) {
            if (selector === '.integrated-container') return target;
            if (selector === '.main-chart-box') return mainBox;
            return null;
        };
        document.addEventListener = function() {};
        state.charts.main = {
            data: { labels: Array.from({ length: 90 }, function(_, i) { return 'V' + i; }) },
            scales: { x: { width: 900, left: 0, right: 900 } }
        };
        var drawCalls = 0;
        var sidebarCalls = 0;
        var badgeCalls = 0;
        var crosshairCalls = 0;
        var prevented = false;
        drawViewport = function() { drawCalls++; };
        safeUpdateSidebar = function() { sidebarCalls++; };
        updateFreezeBadge = function() { badgeCalls++; };
        updateCrosshairOverlay = function() { crosshairCalls++; };
        clearStaleTooltips = function() {};

        bindChartDragPan();
        targetHandlers.wheel.fn({ deltaX: -90, deltaY: 0, preventDefault() { prevented = true; } });
        var wheelState = {
            range: getVisibleRange(state.rawData.sh),
            frozen: state.isFrozen,
            lockIdx: state.lockIdx,
            viewport: state.viewport,
            drawCalls,
            sidebarCalls,
            badgeCalls,
            crosshairCalls,
            prevented,
            wheelPassive: targetHandlers.wheel.options && targetHandlers.wheel.options.passive
        };
    `, context);
    assert.deepStrictEqual(JSON.parse(vm.runInContext('JSON.stringify(wheelState)', context)), {
        range: { start: 101, end: 190, length: 90 },
        frozen: true,
        lockIdx: 190,
        viewport: { mode: 'pan', endIdx: 190, anchorIdx: 190 },
        drawCalls: 1,
        sidebarCalls: 1,
        badgeCalls: 1,
        crosshairCalls: 1,
        prevented: true,
        wheelPassive: false
    });
});

runTest('trackpad horizontal wheel prevents browser back even before bar panning threshold', () => {
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

        var targetHandlers = {};
        var mainBox = {
            classList: { add() {}, remove() {}, contains() { return false; } }
        };
        var target = {
            addEventListener(type, fn, options) { targetHandlers[type] = { fn, options }; },
            closest() { return null; }
        };
        document.querySelector = function(selector) {
            if (selector === '.integrated-container') return target;
            if (selector === '.main-chart-box') return mainBox;
            return null;
        };
        document.addEventListener = function() {};
        state.charts.main = {
            data: { labels: Array.from({ length: 90 }, function(_, i) { return 'V' + i; }) },
            scales: { x: { width: 900, left: 0, right: 900 } }
        };
        var drawCalls = 0;
        var sidebarCalls = 0;
        var prevented = false;
        drawViewport = function() { drawCalls++; };
        safeUpdateSidebar = function() { sidebarCalls++; };

        bindChartDragPan();
        targetHandlers.wheel.fn({ deltaX: -3, deltaY: 0, preventDefault() { prevented = true; } });
        var wheelState = {
            range: getVisibleRange(state.rawData.sh),
            frozen: state.isFrozen,
            lockIdx: state.lockIdx,
            drawCalls,
            sidebarCalls,
            prevented
        };
    `, context);
    assert.deepStrictEqual(JSON.parse(vm.runInContext('JSON.stringify(wheelState)', context)), {
        range: { start: 110, end: 199, length: 90 },
        frozen: false,
        lockIdx: 199,
        drawCalls: 0,
        sidebarCalls: 0,
        prevented: true
    });
});

runTest('bound mouse drag events pan the main chart viewport', () => {
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

        var targetHandlers = {};
        var docHandlers = {};
        var mainBoxClasses = new Set();
        var mainBox = {
            classList: {
                add(name) { mainBoxClasses.add(name); },
                remove(name) { mainBoxClasses.delete(name); },
                contains(name) { return mainBoxClasses.has(name); }
            }
        };
        var target = {
            addEventListener(type, fn) { targetHandlers[type] = fn; },
            setPointerCapture() {},
            releasePointerCapture() {},
            closest() { return null; }
        };
        document.querySelector = function(selector) {
            if (selector === '.integrated-container') return target;
            if (selector === '.main-chart-box') return mainBox;
            return null;
        };
        document.addEventListener = function(type, fn) { docHandlers[type] = fn; };
        state.charts.main = {
            data: { labels: Array.from({ length: 90 }, function(_, i) { return 'V' + i; }) },
            scales: { x: { width: 900, left: 0, right: 900 } }
        };
        var drawCalls = 0;
        var sidebarCalls = 0;
        drawViewport = function() { drawCalls++; };
        safeUpdateSidebar = function() { sidebarCalls++; };
        updateFreezeBadge = function() {};
        updateCrosshairOverlay = function() {};
        clearStaleTooltips = function() {};

        bindChartDragPan();
        targetHandlers.mousedown({ button: 0, clientX: 500, currentTarget: target, preventDefault() {} });
        docHandlers.mousemove({ clientX: 410, preventDefault() {} });
        docHandlers.mouseup({ currentTarget: document });

        var mouseDragRange = getVisibleRange(state.rawData.sh);
        var mouseDragState = {
            frozen: state.isFrozen,
            lockIdx: state.lockIdx,
            viewport: state.viewport,
            drawCalls,
            sidebarCalls,
            dragging: mainBoxClasses.has('drag-panning')
        };
    `, context);
    assert.deepStrictEqual(JSON.parse(vm.runInContext('JSON.stringify(mouseDragRange)', context)), { start: 101, end: 190, length: 90 });
    assert.deepStrictEqual(JSON.parse(vm.runInContext('JSON.stringify(mouseDragState)', context)), {
        frozen: true,
        lockIdx: 190,
        viewport: { mode: 'pan', endIdx: 190, anchorIdx: 190 },
        drawCalls: 1,
        sidebarCalls: 1,
        dragging: false
    });
});

runTest('empty chart placeholders do not intercept chart pointer interactions', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(renderSource, context);
    vm.runInContext(`
        var placeholders = {};
        function makePlaceholder() {
            return {
                className: '',
                style: { cssText: '' },
                innerText: '',
                remove() {}
            };
        }
        function makeCanvas(id) {
            var parent = {
                style: {},
                classList: { add() {} },
                querySelector(sel) {
                    if (sel !== '.empty-hint') return null;
                    return placeholders[id] || null;
                },
                appendChild(el) {
                    placeholders[id] = el;
                }
            };
            return { parentElement: parent };
        }
        document.getElementById = function(id) { return makeCanvas(id); };
        Chart = { getChart() { return null; } };
        clearCharts();
        var placeholderClasses = Object.fromEntries(Object.entries(placeholders).map(([id, el]) => [id, el.className]));
    `, context);
    const classes = JSON.parse(vm.runInContext('JSON.stringify(placeholderClasses)', context));
    assert.ok(Object.keys(classes).length >= 4);
    assert.ok(Object.values(classes).every(className => className.includes('empty-hint')));
    assert.ok(cssSource.includes('.empty-hint {') && cssSource.includes('pointer-events: none;'), 'shared placeholder CSS should never intercept pointer input');
});

runTest('failed chart placeholders are distinct from an unselected empty chart', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(renderSource, context);
    vm.runInContext(`
        var placeholders = {};
        function makeCanvas(id) {
            var parent = {
                style: {},
                classList: { add() {} },
                querySelector() { return placeholders[id] || null; },
                appendChild(el) { placeholders[id] = el; }
            };
            return { parentElement: parent };
        }
        document.getElementById = function(id) { return makeCanvas(id); };
        Chart = { getChart() { return null; } };
        clearCharts('error');
        var placeholderText = Object.values(placeholders).map(el => el.innerText);
    `, context);
    const text = JSON.parse(vm.runInContext('JSON.stringify(placeholderText)', context));
    assert.strictEqual(text.length, 4);
    assert.ok(text.every(item => item.includes('加载失败')));
    assert.ok(text.every(item => !item.includes('暂无数据')));
});

runTest('chart area footer shows a subtle copyright and risk line with spacing', () => {
    assert.ok(indexSource.includes('<div class="chart-copyright-line">© 2026 LINPO LAB · 仅供研究观察，不构成投资建议</div>'), 'chart footer should expose copyright and risk text');
    assert.ok(indexSource.includes('<div class="kdj-chart-box"><canvas id="kdjChart"></canvas></div>\n        </div>\n        <div class="chart-copyright-line">'), 'chart footer should sit outside the integrated chart frame');
    assert.ok(cssSource.includes('.chart-copyright-line'), 'missing chart footer style');
    assert.ok(cssSource.includes('flex: 0 0 14px'), 'chart footer should reserve stable one-line height');
    assert.ok(cssSource.includes('margin-top: 8px'), 'chart footer should keep spacing from the chart frame');
    assert.ok(cssSource.includes('padding: 0 16px'), 'chart footer should keep horizontal breathing room');
    assert.ok(/\.chart-copyright-line\s*\{[^}]*font-weight:\s*400\b/.test(cssSource), 'chart footer should use normal weight instead of medium/bold');
    assert.ok(cssSource.includes('white-space: nowrap'), 'chart footer should remain one line');
});

runTest('mobile viewport initializes the compact main app while strategy inspection stays desktop-only', () => {
    assert.ok(indexSource.includes('<body class="dailyglance-app">'), 'main app should expose a scoped responsive root');
    assert.ok(!indexSource.includes('id="mobileGate"'), 'main app must not keep the old mobile startup gate');
    assert.ok(indexSource.includes('class="mobile-chart-meta"'), 'mobile main-chart context label is missing');
    assert.ok(strategyInspectorSource.includes('id="mobileGate"') && strategyInspectorSource.includes('至少 1024px'), 'strategy inspector should retain the desktop-use gate');

    const cssSource = read('assets/css/dailyglance.css');
    assert.ok(cssSource.includes('@media(max-width: 1023px)'), 'missing governed compact breakpoint');
    assert.ok(cssSource.includes('.dailyglance-app .main-container') && cssSource.includes('flex-direction: column;'), 'compact main app should use a single-column workspace');
    assert.ok(cssSource.includes('.dailyglance-app .header-center .nav-btn[data-tab="external"] { display: none; }'), 'compact navigation should hide sector trends');
    assert.ok(cssSource.includes('.dailyglance-app .volume-chart-box') && cssSource.includes('display: none !important;'), 'compact layout should hide secondary charts');
    assert.ok(cssSource.includes('.strategy-inspector-shell { display: none !important; }') && cssSource.includes('#mobileGate'), 'strategy inspector gate styles should remain available');

    assert.ok(configSource.includes("const COMPACT_MOBILE_MEDIA_QUERY = '(max-width: 1023px)'"), 'compact layout should have one shared media query');
    assert.ok(configSource.includes('function isCompactMobileLayout()'), 'compact layout helper is missing');
    assert.ok(appSource.includes('applyCompactMobileDefaults()') && appSource.includes("applyPeriodState('daily')") && appSource.includes('state.range = 90'), 'mobile initialization should select the governed daily 90-day view');
    assert.ok(appSource.includes('bindResponsiveLayoutChange()') && appSource.includes("media.addEventListener('change', handleChange)"), 'crossing the desktop breakpoint should preserve the current layout lifecycle');
    assert.ok(appSource.includes('drawViewport()') && !appSource.includes('window.location.reload();'), 'responsive breakpoint changes should redraw the current view instead of reloading the page');
    assert.ok(!appSource.includes('shouldUseMobileGate'), 'main app initialization must not return through the old gate');
    assert.ok(renderSource.includes('shouldRenderCompactMainChartOnly()') && renderSource.includes("charts: 'main-only'"), 'compact rendering should create only the main chart');
});

runTest('main chart B/S marks only first open and full close transitions', () => {
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
        for (var i = 0; i < 80; i++) {
            state.indicators.ma[5][i] = 105;
            state.indicators.ma[10][i] = 104;
            state.indicators.ma[20][i] = 103;
            state.indicators.ma[60][i] = 100;
            state.indicators.macd.diff[i] = 1;
            state.indicators.macd.dea[i] = 0;
            state.indicators.rsi.val[i] = 50;
            state.indicators.kdj.k[i] = 50;
            state.indicators.kdj.d[i] = 50;
            state.indicators.kdj.j[i] = 50;
        }

        var full = Array.from({ length: 80 }, (_, i) => ({
            date: '2026-01-' + String(i + 1).padStart(2, '0'),
            open: 100,
            high: 101,
            low: 99,
            close: 110,
            vol: 1000,
            _signals: ['B1', 'B2']
        }));
        full[70]._signals = ['B1', 'B2', 'L1'];
        full[71]._signals = ['L3'];

        var openDecision = computeDecisionForIndex(65, full, 0);
        var addDecision = computeDecisionForIndex(66, full, 30);
        var reduceDecision = computeDecisionForIndex(70, full, 50);
        var closeDecision = computeDecisionForIndex(71, full, 50);
    `, context);
    assert.strictEqual(vm.runInContext('openDecision.bsMark', context), 'B');
    assert.ok(vm.runInContext('openDecision.position > 0', context));
    assert.strictEqual(vm.runInContext('addDecision.bsMark', context), null);
    assert.ok(vm.runInContext('addDecision.position > 30', context));
    assert.strictEqual(vm.runInContext('reduceDecision.bsMark', context), null);
    assert.ok(vm.runInContext('reduceDecision.position > 0 && reduceDecision.position < 50', context));
    assert.strictEqual(vm.runInContext('closeDecision.bsMark', context), 'S');
    assert.strictEqual(vm.runInContext('closeDecision.position', context), 0);
});

runTest('main price scale reserves room for B/S markers at chart edges', () => {
    const renderSource = read('assets/js/04-render.js');
    assert.ok(renderSource.includes('const visiblePriceValues = slice.flatMap'), 'main price scale should include candle highs and lows');
    assert.ok(renderSource.includes('mainOpts.scales.y.min = priceMin - pricePad'), 'main price scale should reserve bottom room for B markers');
    assert.ok(renderSource.includes('mainOpts.scales.y.max = priceMax + pricePad'), 'main price scale should reserve top room for S markers');
    assert.ok(renderSource.includes('Math.min(py + 18, bottom - 9)'), 'B marker should keep its bottom boundary guard');
    assert.ok(renderSource.includes('Math.max(py - 18, top + 9)'), 'S marker should keep its top boundary guard');
});
