runTest('history source circuit opens globally after repeated transport failures', async () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(dataSource, context);
    await vm.runInContext(`
        (async function() {
            var appendedScripts = 0;
            document.head.appendChild = function(script) {
                appendedScripts++;
                script.onerror();
            };
            await jsonpFetchEastmoneyKline('sh');
            circuitAfterFirstFailure = isHistorySourceCircuitOpen('eastmoney');
            await jsonpFetchEastmoneyKline('sz');
            circuitAfterSecondFailure = isHistorySourceCircuitOpen('eastmoney');
            await jsonpFetchEastmoneyKline('hs300');
            circuitRequestCount = appendedScripts;
            circuitState = getHistorySourceCircuit('eastmoney');
            resetHistorySourceCircuits();
            circuitAfterReset = isHistorySourceCircuitOpen('eastmoney');
        })()
    `, context);
    const result = JSON.parse(vm.runInContext(`JSON.stringify({
        circuitAfterFirstFailure,
        circuitAfterSecondFailure,
        circuitRequestCount,
        circuitState,
        circuitAfterReset
    })`, context));
    assert.strictEqual(result.circuitAfterFirstFailure, false);
    assert.strictEqual(result.circuitAfterSecondFailure, true);
    assert.strictEqual(result.circuitRequestCount, 2, 'open circuit should skip the third source request globally');
    assert.strictEqual(result.circuitState.consecutiveFailures, 2);
    assert.ok(result.circuitState.openUntil > 0);
    assert.strictEqual(result.circuitAfterReset, false);
});

runTest('jsonp cleanup registry releases completed jobs and settles cancelled jobs', async () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(dataSource, context);
    await vm.runInContext(`
        (async function() {
            document.head.appendChild = function(script) { script.onerror(); };
            await jsonpFetchEastmoneyKline('sh');
            var completedRegistrySize = _jsonpCleanupFns.size;

            document.head.appendChild = function() {};
            var pendingRequest = jsonpFetchTencentKline('sz');
            var pendingRegistrySize = _jsonpCleanupFns.size;
            _runJsonpCleanup();
            var cancelledResult = await pendingRequest;
            var cancelledRegistrySize = _jsonpCleanupFns.size;
            jsonpCleanupResult = { completedRegistrySize, pendingRegistrySize, cancelledResult, cancelledRegistrySize };
        })()
    `, context);
    const result = JSON.parse(vm.runInContext('JSON.stringify(jsonpCleanupResult)', context));
    assert.strictEqual(result.completedRegistrySize, 0);
    assert.strictEqual(result.pendingRegistrySize, 1);
    assert.deepStrictEqual(result.cancelledResult, []);
    assert.strictEqual(result.cancelledRegistrySize, 0);
});

runTest('valid history response with insufficient symbol coverage does not open the source circuit', async () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(dataSource, context);
    await vm.runInContext(`
        (async function() {
            recordHistorySourceTransportFailure('tencent');
            document.head.appendChild = function(script) {
                window[script.id] = {
                    code: 0,
                    data: {
                        bj899050: {
                            day: [['2026-07-21', '1043.26', '1079.04', '1080.71', '1007.64', '8839807']]
                        }
                    }
                };
                script.onload();
            };
            oneRowHistory = await jsonpFetchTencentKline('bz50');
            tencentCircuit = getHistorySourceCircuit('tencent');
        })()
    `, context);
    const result = JSON.parse(vm.runInContext('JSON.stringify({ oneRowHistory, tencentCircuit })', context));
    assert.strictEqual(result.oneRowHistory.length, 1);
    assert.strictEqual(result.oneRowHistory[0].amt, 0, '腾讯历史缺少成交额时不应用指数点位估算');
    assert.deepStrictEqual(result.tencentCircuit, { consecutiveFailures: 0, openUntil: 0 });
    assert.match(dataSource, /resetHistorySourceCircuits\(\);\s*\n\s*btn\.disabled = true/, 'manual history update should reset source circuits before retrying');
});

runTest('TickFlow history is normalized with the existing forward-adjusted price basis', async () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(`
        AbortController = function() { this.signal = {}; this.abort = function() {}; };
        var tickflowUrl = '';
        fetch = async function(url) {
            tickflowUrl = String(url);
            return {
                ok: true,
                status: 200,
                json: async function() {
                    return { data: {
                        timestamp: [Date.parse('2026-07-29T00:00:00+08:00'), Date.parse('2026-07-30T00:00:00+08:00')],
                        open: [10.1, 10.2], high: [10.4, 10.5], low: [10.0, 10.1], close: [10.3, 10.4],
                        volume: [1200, 1300], amount: [12000, 13000]
                    } };
                }
            };
        };
    `, context);
    vm.runInContext(dataSource, context);
    await vm.runInContext('(async function() { tickflowRows = await fetchTickFlowKline("sh"); })()', context);
    const result = JSON.parse(vm.runInContext('JSON.stringify({ tickflowUrl, tickflowRows, circuit: getHistorySourceCircuit("tickflow") })', context));
    assert.ok(result.tickflowUrl.startsWith('https://free-api.tickflow.org/v1/klines?'));
    assert.ok(result.tickflowUrl.includes('symbol=000001.SH'));
    assert.ok(result.tickflowUrl.includes('adjust=forward_additive'));
    assert.deepStrictEqual(result.tickflowRows, [
        { date: '2026-07-29', open: 10.1, close: 10.3, high: 10.4, low: 10, vol: 1200, amt: 12000 },
        { date: '2026-07-30', open: 10.2, close: 10.4, high: 10.5, low: 10.1, vol: 1300, amt: 13000 }
    ]);
    assert.deepStrictEqual(result.circuit, { consecutiveFailures: 0, openUntil: 0 });
});

runTest('history sync prefers TickFlow and keeps source-specific fallbacks', async () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(dataSource, context);
    await vm.runInContext(`
        (async function() {
            var appendedSinaUrl = '';
            document.head.appendChild = function(script) {
                appendedSinaUrl = script.src;
                window[script.id] = Array.from({ length: 40 }, function(_, i) {
                    var date = new Date('2026-05-01T00:00:00Z');
                    date.setUTCDate(date.getUTCDate() + i);
                    return {
                        day: date.toISOString().slice(0, 10),
                        open: '1043.255', high: '1080.713', low: '1007.638', close: '1079.042',
                        volume: '883980714'
                    };
                });
                script.onload();
            };
            sinaRows = await jsonpFetchSinaBz50Kline('bz50');
            nonBzRows = await jsonpFetchSinaBz50Kline('sh');

            var bzOrder = [];
            fetchTickFlowKline = async function() { bzOrder.push('tickflow'); return []; };
            jsonpFetchSinaBz50Kline = async function() { bzOrder.push('sina'); return sinaRows; };
            jsonpFetchEastmoneyKline = async function() { bzOrder.push('eastmoney'); return []; };
            jsonpFetchTencentKline = async function() { bzOrder.push('tencent'); return []; };
            bzData = await syncDataWithHistory('bz50');
            bzStatus = state.confirmedStatus.bz50;

            var shOrder = [];
            fetchTickFlowKline = async function() { shOrder.push('tickflow'); return sinaRows; };
            jsonpFetchEastmoneyKline = async function() { shOrder.push('eastmoney'); return sinaRows; };
            jsonpFetchTencentKline = async function() { shOrder.push('tencent'); return sinaRows; };
            await syncDataWithHistory('sh');
            shStatus = state.confirmedStatus.sh;

            var tencentFallbackOrder = [];
            fetchTickFlowKline = async function() { tencentFallbackOrder.push('tickflow'); return []; };
            jsonpFetchTencentKline = async function() { tencentFallbackOrder.push('tencent'); return sinaRows; };
            jsonpFetchEastmoneyKline = async function() { tencentFallbackOrder.push('eastmoney'); return sinaRows; };
            await syncDataWithHistory('hs300');
            tencentFallbackStatus = state.confirmedStatus.hs300;

            var eastmoneyFallbackOrder = [];
            fetchTickFlowKline = async function() { eastmoneyFallbackOrder.push('tickflow'); return []; };
            jsonpFetchTencentKline = async function() { eastmoneyFallbackOrder.push('tencent'); return []; };
            jsonpFetchEastmoneyKline = async function() { eastmoneyFallbackOrder.push('eastmoney'); return sinaRows; };
            await syncDataWithHistory('zz500');
            eastmoneyFallbackStatus = state.confirmedStatus.zz500;
            historyFallbackResult = { appendedSinaUrl, sinaRows, nonBzRows, bzOrder, bzData, bzStatus, shOrder, shStatus, tencentFallbackOrder, tencentFallbackStatus, eastmoneyFallbackOrder, eastmoneyFallbackStatus };
        })()
    `, context);
    const result = JSON.parse(vm.runInContext('JSON.stringify(historyFallbackResult)', context));
    assert.ok(result.appendedSinaUrl.includes('symbol=bj899050'), result.appendedSinaUrl);
    assert.ok(result.appendedSinaUrl.includes('datalen=1000'), result.appendedSinaUrl);
    assert.strictEqual(result.sinaRows.length, 40);
    assert.strictEqual(result.sinaRows[0].vol, 8839807.14, 'Sina shares should be converted to hands');
    assert.strictEqual(result.sinaRows[0].amt, 0, 'Sina does not provide confirmed turnover amount');
    assert.deepStrictEqual(result.nonBzRows, []);
    assert.deepStrictEqual(result.bzOrder, ['tickflow', 'sina']);
    assert.strictEqual(result.bzData.length, 40);
    assert.strictEqual(result.bzStatus.source, 'sina');
    assert.strictEqual(result.bzStatus.status, 'fresh');
    assert.deepStrictEqual(result.shOrder, ['tickflow']);
    assert.strictEqual(result.shStatus.source, 'tickflow');
    assert.deepStrictEqual(result.tencentFallbackOrder, ['tickflow', 'tencent']);
    assert.strictEqual(result.tencentFallbackStatus.source, 'tencent');
    assert.deepStrictEqual(result.eastmoneyFallbackOrder, ['tickflow', 'tencent', 'eastmoney']);
    assert.strictEqual(result.eastmoneyFallbackStatus.source, 'eastmoney');
});

runTest('sector trend refresh deduplicates the board scan and enforces cooldown', async () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(dataSource, context);
    await vm.runInContext(`
        (async function() {
            AbortController = function() { this.signal = {}; this.abort = function() {}; };
            var sectorListCalls = 0;
            var sectorListActive = 0;
            var sectorListMaxConcurrency = 0;
            var sectorComponentCalls = 0;
            fetch = async function(url) {
                await new Promise(resolve => setTimeout(resolve, 5));
                var text = String(url);
                if (text.includes('fs=b%3A')) {
                    sectorComponentCalls++;
                    return {
                        ok: true,
                        json: async function() {
                            return { rc: 0, data: { diff: [
                                { f12: '600001', f13: 1, f14: '活跃股甲', f2: 12.5, f3: 5.2, f8: 3.1 },
                                { f12: '000002', f13: 0, f14: '活跃股乙', f2: 8.2, f3: 3.4, f8: 2.2 },
                                { f12: '300003', f13: 0, f14: '活跃股丙', f2: 18.8, f3: 2.1, f8: 4.5 },
                                { f12: '600004', f13: 1, f14: '活跃股丁', f2: 22.8, f3: 1.8, f8: 3.7 },
                                { f12: '000005', f13: 0, f14: '活跃股戊', f2: 6.8, f3: 1.5, f8: 2.8 },
                                { f12: '300006', f13: 0, f14: '活跃股己', f2: 10.8, f3: 1.1, f8: 3.2 }
                            ] } };
                        }
                    };
                }
                sectorListCalls++;
                sectorListActive++;
                sectorListMaxConcurrency = Math.max(sectorListMaxConcurrency, sectorListActive);
                return {
                    ok: true,
                    json: async function() {
                        try {
                            return { rc: 0, data: { total: 201, diff: [
                                { f12: 'BK1001', f14: '上涨板块', f3: 3.2, f6: 8000000000, f8: 4.2, f24: 30, f109: 12, f160: 18, f184: 8, f104: 80, f105: 15, f106: 5, f128: '活跃股甲', f140: '600001', f136: 5.2, f124: 1780000000 },
                                { f12: 'BK1002', f14: '转强板块', f3: 1.2, f6: 5000000000, f8: 3.1, f24: -3, f109: 9, f160: 6, f184: 2, f104: 60, f105: 30, f106: 10, f128: '活跃股乙', f140: '000002', f136: 3.4, f124: 1780000000 },
                                { f12: 'BK1003', f14: '异动板块', f3: 4.8, f6: 3000000000, f8: 5.1, f24: -10, f109: -2, f160: -4, f184: -1, f104: 65, f105: 25, f106: 10, f128: '活跃股丙', f140: '300003', f136: 2.1, f124: 1780000000 },
                                { f12: 'BK1004', f14: '弱势板块', f3: -1.1, f24: -8, f109: -6, f160: -8, f104: 20, f105: 70, f106: 10, f124: 1780000000 },
                                { f12: 'BK1005', f14: '普通板块', f3: 0.1, f24: -2, f109: -3, f160: -5, f184: -1, f104: 48, f105: 42, f106: 10, f124: 1780000000 }
                            ] } };
                        } finally {
                            sectorListActive--;
                        }
                    }
                };
            };
            state.tab = 'external';
            state.mode = 'external';
            await Promise.all([
                refreshSectorTrendSnapshot({ reason: 'manual' }),
                refreshSectorTrendSnapshot({ reason: 'visibility' }),
                refreshSectorTrendSnapshot({ reason: 'tab-enter' })
            ]);
            await refreshSectorTrendSnapshot({ reason: 'manual-again' });
            sectorRefreshResult = {
                listCalls: sectorListCalls,
                listMaxConcurrency: sectorListMaxConcurrency,
                componentCalls: sectorComponentCalls,
                status: sectorTrendState.status,
                boardCount: sectorTrendState.boards.length,
                groups: {
                    uptrend: sectorTrendState.groups.uptrend.length,
                    turning: sectorTrendState.groups.turning.length,
                    momentum: sectorTrendState.groups.momentum.length
                },
                conceptCount: sectorTrendState.concepts.length,
                candidateCount: sectorTrendState.boards[0].candidates.length,
                rawDataKeys: Object.keys(state.rawData),
                cooldown: getSectorTrendCooldownRemaining()
            };
        })()
    `, context);
    const result = JSON.parse(vm.runInContext('JSON.stringify(sectorRefreshResult)', context));
    assert.strictEqual(result.listCalls, 4, 'concurrent refreshes should share a full industry scan and one concept-hotspot page');
    assert.ok(result.listMaxConcurrency <= 3, `sector list pagination should stay at three concurrent requests: ${result.listMaxConcurrency}`);
    assert.ok(result.componentCalls > 0 && result.componentCalls <= 6, `only the top six boards should request active stocks: ${result.componentCalls}`);
    assert.strictEqual(result.status, 'ready');
    assert.ok(result.boardCount >= 3);
    assert.strictEqual(result.conceptCount, 5);
    assert.ok(result.groups.uptrend > 0 && result.groups.turning > 0 && result.groups.momentum > 0);
    assert.strictEqual(result.candidateCount, 6);
    assert.deepStrictEqual(result.rawDataKeys, [], 'sector snapshot must stay outside confirmed A-share data');
    assert.ok(result.cooldown > 0 && result.cooldown <= 60000);
});

runTest('sector trend cache remains independent when public board requests fail', async () => {
    const context = makeBrowserContext();
    context.localStorage.setItem('dg_sector_trend_snapshot_v2', JSON.stringify({
        boards: [{
            type: 'industry', code: 'BK1001', name: '缓存板块', changePct: 1.2, return5: 5, return10: 8, return60: 12,
            breadthPct: 70, upCount: 70, downCount: 20, flatCount: 10, score: 78, trendState: 'uptrend', trendLabel: '上涨趋势',
            tone: 'is-positive', invalidCondition: '若5日或10日涨幅转负，趋势转为观察。', candidates: [{ code: '600001', name: '缓存个股', changePct: 2.1 }]
        }],
        summary: { totalCount: 500, uptrendCount: 18, turningCount: 9, momentumCount: 4, strongest: '缓存板块' },
        source: '东方财富板块行情', fetchedAt: 1770000000000, lastAttemptAt: 0
    }));
    vm.runInContext(configSource, context);
    vm.runInContext(dataSource, context);
    await vm.runInContext(`
        (async function() {
            AbortController = function() { this.signal = {}; this.abort = function() {}; };
            var sectorFetchCalls = 0;
            fetch = async function() {
                sectorFetchCalls++;
                throw new Error('network unavailable');
            };
            state.tab = 'external';
            state.mode = 'external';
            await refreshSectorTrendSnapshot({ reason: 'manual' });
            sectorCacheResult = {
                fetchCalls: sectorFetchCalls,
                status: sectorTrendState.status,
                board: sectorTrendState.boards[0],
                summary: sectorTrendState.summary,
                error: sectorTrendState.error,
                rawDataKeys: Object.keys(state.rawData)
            };
        })()
    `, context);
    const result = JSON.parse(vm.runInContext('JSON.stringify(sectorCacheResult)', context));
    assert.strictEqual(result.fetchCalls, 2, 'industry and concept list requests should both fail before cache fallback');
    assert.strictEqual(result.status, 'cached');
    assert.strictEqual(result.board.name, '缓存板块');
    assert.strictEqual(result.board.stale, true);
    assert.strictEqual(result.board.candidates[0].stale, true);
    assert.strictEqual(result.summary.strongest, '缓存板块');
    assert.match(result.error, /network unavailable/);
    assert.deepStrictEqual(result.rawDataKeys, []);
});

runTest('manual sector trend refresh respects the shared 60-second cooldown', async () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(dataSource, context);
    vm.runInContext(appSourceNoInit, context);
    await vm.runInContext(`
        (async function() {
            const now = Date.now();
            state.tab = 'external';
            state.mode = 'external';
            sectorTrendState.cacheLoaded = true;
            sectorTrendState.status = 'ready';
            sectorTrendState.lastAttemptAt = now - 10000;
            var toastMessage = '';
            showToast = function(message) { toastMessage = message; };
            await handleExternalRefresh();
            manualSectorCooldownResult = {
                toastMessage,
                lastAttemptAt: sectorTrendState.lastAttemptAt
            };
        })()
    `, context);
    const result = JSON.parse(vm.runInContext('JSON.stringify(manualSectorCooldownResult)', context));
    assert.match(result.toastMessage, /50 秒后再更新/, result.toastMessage);
    assert.ok(result.lastAttemptAt > 0);
});

runTest('kline cache version invalidates old market data without dropping user caches', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(dataSource, context);
    const result = JSON.parse(vm.runInContext(`JSON.stringify((function() {
        const klineRecord = buildPersistentCacheRecord('cy', [{ date: '2026-07-21' }]);
        const watchlistRecord = buildPersistentCacheRecord('watchlist_list', [{ code: '600519' }]);
        const stockCacheRecord = buildPersistentCacheRecord('stock_cache', [{ Code: '600519' }]);
        return {
            klineVersion: klineRecord.klineCacheVersion,
            klineUsable: isUsablePersistentCacheRecord('cy', klineRecord),
            oldKlineUsable: isUsablePersistentCacheRecord('cy', { id: 'cy', data: [] }),
            watchlistHasVersion: Object.prototype.hasOwnProperty.call(watchlistRecord, 'klineCacheVersion'),
            watchlistUsable: isUsablePersistentCacheRecord('watchlist_list', { id: 'watchlist_list', data: [] }),
            stockCacheUsable: isUsablePersistentCacheRecord('stock_cache', { id: 'stock_cache', data: [] }),
            liveOverlayKey: SYS_CONFIG.LIVE_OVERLAY_CACHE_KEY
        };
    })())`, context));
    assert.deepStrictEqual(result, {
        klineVersion: 2,
        klineUsable: true,
        oldKlineUsable: false,
        watchlistHasVersion: false,
        watchlistUsable: true,
        stockCacheUsable: true,
        liveOverlayKey: 'dg_live_overlay_cache_v2'
    });
});

runTest('active empty fetch shows current unavailable state while stale fetch stays silent', async () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(dataSource, context);
    await vm.runInContext(`
        (async function() {
            var clearReasons = [];
            var sidebarStates = [];
            dbGet = async function() { return null; };
            clearCharts = function(reason) { clearReasons.push(reason); };
            renderActiveSelectionStatus = function(status) { sidebarStates.push(state.id + ':' + status); };

            state.mode = 'index';
            state.id = 'bz50';
            globalSelectionSeq = 10;
            syncData = async function() { return null; };
            await cachedFetch('bz50');
            activeEmptyResult = { clearReasons: clearReasons.slice(), sidebarStates: sidebarStates.slice() };

            clearReasons.length = 0;
            sidebarStates.length = 0;
            var releaseSync;
            syncData = function() { return new Promise(function(resolve) { releaseSync = resolve; }); };
            var staleFetch = cachedFetch('bz50');
            await Promise.resolve();
            state.id = 'sh';
            globalSelectionSeq = 11;
            releaseSync(null);
            await staleFetch;
            staleEmptyResult = { clearReasons: clearReasons.slice(), sidebarStates: sidebarStates.slice() };
        })()
    `, context);
    const result = JSON.parse(vm.runInContext('JSON.stringify({ activeEmptyResult, staleEmptyResult })', context));
    assert.deepStrictEqual(result.activeEmptyResult, {
        clearReasons: ['error'],
        sidebarStates: ['bz50:unavailable']
    });
    assert.deepStrictEqual(result.staleEmptyResult, { clearReasons: [], sidebarStates: [] });
});

runTest('data refresh result separates confirmed and visible mutations', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(dataSource, context);
    vm.runInContext(`
        var oldRows = [{ date: '2026-01-01', open: 10, high: 11, low: 9, close: 10, vol: 100, amt: 1000 }];
        var sameRows = oldRows.map(row => ({ ...row }));
        var freshRows = oldRows.concat([{ date: '2026-01-02', open: 10, high: 12, low: 10, close: 11, vol: 120, amt: 1320 }]);
        var visibleOverlay = [{ ...oldRows[0], close: 10.5 }];
        var unchangedRefresh = buildDataRefreshResult('sh', oldRows, oldRows, sameRows, oldRows);
        var overlayRefresh = buildDataRefreshResult('sh', oldRows, oldRows, sameRows, visibleOverlay);
        var confirmedRefresh = buildDataRefreshResult('sh', oldRows, oldRows, freshRows, freshRows);
    `, context);
    const results = JSON.parse(vm.runInContext('JSON.stringify([unchangedRefresh, overlayRefresh, confirmedRefresh])', context));
    assert.deepStrictEqual(results[0], { id: 'sh', confirmedChanged: false, visibleChanged: false, path: 'unchanged' });
    assert.deepStrictEqual(results[1], { id: 'sh', confirmedChanged: false, visibleChanged: true, path: 'live-overlay' });
    assert.deepStrictEqual(results[2], { id: 'sh', confirmedChanged: true, visibleChanged: true, path: 'confirmed' });
});

runTest('confirmed manual refresh uses history sync instead of cooled incremental sync', async () => {
    const context = makeBrowserContext();
    const instrumentedConfigSource = configSource
        .replace("const customConfirm = (msg) => new Promise(resolve => {", "var customConfirm = (msg) => new Promise(resolve => {")
        .replace("const customAlert = (msg, isHtml = false) => new Promise(resolve => {", "var customAlert = (msg, isHtml = false) => new Promise(resolve => {");
    vm.runInContext(instrumentedConfigSource, context);
    const instrumentedDataSource = dataSource
        .replace(/async function checkCacheNeedUpdate\(id\) \{[\s\S]*?\n\}/, "async function checkCacheNeedUpdate(id) { return { needUpdate: false, reason: 'fresh' }; }")
        .replace(/async function syncDataIncremental\(id\) \{[\s\S]*?\n\}/, "async function syncDataIncremental(id) { usedSync = 'incremental'; return [{ date: '2026-01-01', close: 1 }]; }")
        .replace(/async function syncDataWithHistory\(id\) \{[\s\S]*?\n\}/, "async function syncDataWithHistory(id) { usedSync = 'history'; return [{ date: '2026-01-01', open: 1, high: 1, low: 1, close: 1, vol: 1, amt: 1 }]; }")
        .replace(/function dbSet\(id, data\) \{[\s\S]*?\n\}/, "function dbSet(id, data) { return Promise.resolve(); }");
    vm.runInContext('var usedSync = "";', context);
    vm.runInContext(instrumentedDataSource, context);
    vm.runInContext(`
        state.id = 'sh';
        customConfirm = async () => true;
        customAlert = async () => true;
        setRawData = () => {};
        setLockIdx = () => {};
        getActiveData = () => [{ date: '2026-01-01', close: 1 }];
        updateAllIndicators = () => {};
        draw = () => {};
        safeUpdateSidebar = () => {};
        handleUpdateData();
    `, context);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.strictEqual(vm.runInContext('usedSync', context), 'history');
});

runTest('same-day light refresh only recomputes the latest decision row', async () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(dataSource, context);
    vm.runInContext(calcSource, context);
    vm.runInContext(renderSource, context);
    vm.runInContext(`
        var timeoutQueue = [];
        window.setTimeout = function(fn) { timeoutQueue.push(fn); return timeoutQueue.length; };
        clearTimeout = function() {};
        var drawCount = 0;
        draw = function() { drawCount++; };
        renderMASelector = function() {};
        markRefreshTime = function() {};
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
        var baseRows = Array.from({ length: 100 }, function(_, i) {
            var close = 100 + i;
            var day = new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
            return {
                date: i === 99 ? latestDate : day,
                open: close - 0.5,
                high: close + 1,
                low: close - 1,
                close: close,
                vol: 10000 + i,
                amt: 100000 + i
            };
        });
        setRawData('sh', baseRows);
        setLockIdx(baseRows.length - 1);
        updateAllIndicators();

        var weeklyConvertCount = 0;
        var originalConvertDailyToWeekly = convertDailyToWeekly;
        convertDailyToWeekly = function() {
            weeklyConvertCount++;
            return originalConvertDailyToWeekly.apply(this, arguments);
        };

        var decisionRecomputeIdxs = [];
        var originalComputeDecisionForIndex = computeDecisionForIndex;
        computeDecisionForIndex = function(idx, full, prevPos) {
            decisionRecomputeIdxs.push(idx);
            return originalComputeDecisionForIndex(idx, full, prevPos);
        };

        function plainRow(item) {
            return {
                date: item.date,
                open: item.open,
                high: item.high,
                low: item.low,
                close: item.close,
                vol: item.vol,
                amt: item.amt
            };
        }
        var updatedRows = baseRows.map(plainRow);
        updatedRows[updatedRows.length - 1] = {
            ...updatedRows[updatedRows.length - 1],
            high: updatedRows[updatedRows.length - 1].high + 2,
            close: updatedRows[updatedRows.length - 1].close + 1,
            vol: updatedRows[updatedRows.length - 1].vol + 1000,
            amt: updatedRows[updatedRows.length - 1].amt + 10000
        };
        setRawData('sh', updatedRows);
        weeklyConvertCount = 0;
        var path = applyActiveDataRefresh('sh');
    `, context);
    assert.strictEqual(vm.runInContext('path', context), 'same-day-light');
    assert.deepStrictEqual(JSON.parse(vm.runInContext('JSON.stringify(decisionRecomputeIdxs)', context)), [99]);
    assert.strictEqual(vm.runInContext('weeklyConvertCount', context), 0);
    assert.strictEqual(vm.runInContext('drawCount', context), 0);
});

runTest('market-open realtime bar stays in live overlay instead of confirmed history cache', async () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    const instrumentedDataSource = dataSource
        .replace(/function getBJDate\(\) \{ return new Date\(new Date\(\)\.toLocaleString\("en-US", \{timeZone: "Asia\/Shanghai"\}\)\); \}/, "function getBJDate() { return new Date('2026-06-29T10:30:00+08:00'); }")
        .replace(/function getCachedData\(id\) \{[\s\S]*?\n\}/, "function getCachedData(id) { return Promise.resolve(cachedRows); }")
        .replace(/function dbGet\(id\) \{[\s\S]*?\n\}/, "function dbGet(id) { return Promise.resolve({ data: cachedRows }); }")
        .replace(/function dbSet\(id, data\) \{[\s\S]*?\n\}/, "function dbSet(id, data) { dbSetPayloads.push(data.map(row => ({ ...row }))); return Promise.resolve(); }")
        .replace(/async function syncDataWithHistory\(id\) \{[\s\S]*?\n\}/, "async function syncDataWithHistory(id) { return cachedRows.map(row => ({ ...row })); }");
    vm.runInContext('var dbSetPayloads = [];', context);
    vm.runInContext(instrumentedDataSource, context);
    vm.runInContext('function markIndicatorsDirty() { state.indicatorKey = ""; }', context);
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
            return { date: '2026-06-29', open: 103, high: 108, low: 102, close: 107, vol: 2200, amt: 22000 };
        };
    `, context);
    await vm.runInContext('(async function() { returnedRows = await syncData("sh"); setRawData("sh", returnedRows); })()', context);
    const result = JSON.parse(vm.runInContext(`JSON.stringify({
        confirmedLastDate: state.rawData.sh?.[state.rawData.sh.length - 1]?.date || '',
        activeLastDate: getActiveData()?.[getActiveData().length - 1]?.date || '',
        activeLastClose: getActiveData()?.[getActiveData().length - 1]?.close || 0,
        returnedLastDate: returnedRows?.[returnedRows.length - 1]?.date || '',
        cachedLastCloses: dbSetPayloads.map(rows => rows[rows.length - 1]?.close || 0)
    })`, context));
    assert.strictEqual(result.confirmedLastDate, '2026-06-26');
    assert.strictEqual(result.activeLastDate, '2026-06-29');
    assert.strictEqual(result.activeLastClose, 107);
    assert.strictEqual(result.returnedLastDate, '2026-06-26');
    assert.ok(result.cachedLastCloses.every(close => close !== 107), JSON.stringify(result.cachedLastCloses));
});

runTest('market-open cached live overlay restores within ttl without mutating confirmed history', async () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    const instrumentedDataSource = dataSource
        .replace(/function getBJDate\(\) \{ return new Date\(new Date\(\)\.toLocaleString\("en-US", \{timeZone: "Asia\/Shanghai"\}\)\); \}/, "function getBJDate() { return new Date('2026-06-30T10:30:20+08:00'); }")
        .replace(/function dbGet\(id\) \{[\s\S]*?\n\}/, "function dbGet(id) { return Promise.resolve({ data: cachedRows }); }")
        .replace(/function dbSet\(id, data\) \{[\s\S]*?\n\}/, "function dbSet(id, data) { return Promise.resolve(); }");
    vm.runInContext(instrumentedDataSource, context);
    vm.runInContext('function markIndicatorsDirty() { state.indicatorKey = ""; }', context);
    vm.runInContext(`
        var cachedRows = Array.from({ length: 31 }, function(_, i) {
            var close = 130 + i * 0.2;
            var day = String(i + 1).padStart(2, '0');
            return {
                date: i === 30 ? '2026-06-29' : '2026-05-' + day,
                open: close - 0.5,
                high: close + 1,
                low: close - 1,
                close,
                vol: 3000 + i * 10,
                amt: 30000 + i * 100
            };
        });
        state.id = 'sh';
        state.mode = 'index';
        state.tab = 'index';
        state.rawData.sh = cachedRows.map(row => ({ ...row }));
        state.confirmedStatus.sh = { source: 'eastmoney', status: 'fresh', lastDate: '2026-06-29', syncedAt: 1 };
        state.liveOverlayCache = {
            sh: {
                cachedAt: Date.now() - 18000,
                cacheAgeMs: 18000,
                source: 'api',
                bar: { date: '2026-06-30', open: 131, high: 134, low: 130, close: 133, prevClose: 131, vol: 3400, amt: 34000, quoteTime: '2026-06-30 10:30:00', quoteDateSource: 'api' }
            }
        };
        localStorage.setItem(SYS_CONFIG.LIVE_OVERLAY_CACHE_KEY, JSON.stringify(state.liveOverlayCache));
        syncDataWithHistory = async function() { return cachedRows.map(row => ({ ...row })); };
        requestManager.fetchRealtimeWithThrottle = async function() { return null; };
    `, context);
    await vm.runInContext('(async function() { returnedRows = await syncData("sh"); })()', context);
    const result = JSON.parse(vm.runInContext(`JSON.stringify({
        rawLatest: state.rawData.sh[state.rawData.sh.length - 1].date,
        activeLatest: getActiveData()[getActiveData().length - 1].date,
        activeClose: getActiveData()[getActiveData().length - 1].close,
        displayMode: state.displayStatus.sh.mode,
        liveBarDate: state.liveBars.sh.date,
        liveBarCached: !!state.liveBars.sh._isCachedLive,
        liveQuoteCached: !!state.liveQuotes.sh._isCachedLive,
        cachedStore: JSON.parse(localStorage.getItem(SYS_CONFIG.LIVE_OVERLAY_CACHE_KEY) || '{}').sh?.bar?.date || ''
    })`, context));
    assert.deepStrictEqual(result, {
        rawLatest: '2026-06-29',
        activeLatest: '2026-06-30',
        activeClose: 133,
        displayMode: 'cached-live-overlay',
        liveBarDate: '2026-06-30',
        liveBarCached: true,
        liveQuoteCached: true,
        cachedStore: '2026-06-30'
    });
});

runTest('same-day cached live overlay stays visible after soft ttl while market is open', async () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    const instrumentedDataSource = dataSource
        .replace(/function getBJDate\(\) \{ return new Date\(new Date\(\)\.toLocaleString\("en-US", \{timeZone: "Asia\/Shanghai"\}\)\); \}/, "function getBJDate() { return new Date('2026-06-30T10:31:30+08:00'); }")
        .replace(/function dbGet\(id\) \{[\s\S]*?\n\}/, "function dbGet(id) { return Promise.resolve({ data: cachedRows }); }")
        .replace(/function dbSet\(id, data\) \{[\s\S]*?\n\}/, "function dbSet(id, data) { return Promise.resolve(); }");
    vm.runInContext(instrumentedDataSource, context);
    vm.runInContext('function markIndicatorsDirty() { state.indicatorKey = ""; }', context);
    vm.runInContext(`
        var cachedRows = Array.from({ length: 31 }, function(_, i) {
            var close = 130 + i * 0.2;
            var day = String(i + 1).padStart(2, '0');
            return {
                date: i === 30 ? '2026-06-29' : '2026-05-' + day,
                open: close - 0.5,
                high: close + 1,
                low: close - 1,
                close,
                vol: 3000 + i * 10,
                amt: 30000 + i * 100
            };
        });
        state.id = 'sh';
        state.mode = 'index';
        state.tab = 'index';
        state.rawData.sh = cachedRows.map(row => ({ ...row }));
        state.confirmedStatus.sh = { source: 'eastmoney', status: 'fresh', lastDate: '2026-06-29', syncedAt: 1 };
        state.liveOverlayCache = {
            sh: {
                cachedAt: Date.now() - 90000,
                cacheAgeMs: 90000,
                source: 'api',
                bar: { date: '2026-06-30', open: 131, high: 134, low: 130, close: 133, prevClose: 131, vol: 3400, amt: 34000, quoteTime: '2026-06-30 10:30:00', quoteDateSource: 'api' }
            }
        };
        localStorage.setItem(SYS_CONFIG.LIVE_OVERLAY_CACHE_KEY, JSON.stringify(state.liveOverlayCache));
        syncDataWithHistory = async function() { return cachedRows.map(row => ({ ...row })); };
        requestManager.fetchRealtimeWithThrottle = async function() { return null; };
    `, context);
    await vm.runInContext('(async function() { returnedRows = await syncData("sh"); })()', context);
    const result = JSON.parse(vm.runInContext(`JSON.stringify({
        rawLatest: state.rawData.sh[state.rawData.sh.length - 1].date,
        activeLatest: getActiveData()[getActiveData().length - 1].date,
        activeClose: getActiveData()[getActiveData().length - 1].close,
        displayMode: state.displayStatus.sh.mode,
        displayReason: state.displayStatus.sh.reason,
        liveBarExists: !!state.liveBars.sh,
        liveBarDate: state.liveBars.sh?.date || '',
        liveBarCached: !!state.liveBars.sh?._isCachedLive,
        liveQuoteExists: !!state.liveQuotes.sh,
        cachedStore: JSON.parse(localStorage.getItem(SYS_CONFIG.LIVE_OVERLAY_CACHE_KEY) || '{}').sh ? 'present' : ''
    })`, context));
    assert.deepStrictEqual(result, {
        rawLatest: '2026-06-29',
        activeLatest: '2026-06-30',
        activeClose: 133,
        displayMode: 'cached-live-overlay',
        displayReason: '沿用盘中',
        liveBarExists: true,
        liveBarDate: '2026-06-30',
        liveBarCached: true,
        liveQuoteExists: true,
        cachedStore: 'present'
    });
});

runTest('cached live overlay recomputes cache age from cachedAt after page reload', async () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    const instrumentedDataSource = dataSource
        .replace(/function getBJDate\(\) \{ return new Date\(new Date\(\)\.toLocaleString\("en-US", \{timeZone: "Asia\/Shanghai"\}\)\); \}/, "function getBJDate() { return new Date('2026-06-30T10:31:30+08:00'); }")
        .replace(/function dbGet\(id\) \{[\s\S]*?\n\}/, "function dbGet(id) { return Promise.resolve({ data: cachedRows }); }")
        .replace(/function dbSet\(id, data\) \{[\s\S]*?\n\}/, "function dbSet(id, data) { return Promise.resolve(); }");
    vm.runInContext(instrumentedDataSource, context);
    vm.runInContext('function markIndicatorsDirty() { state.indicatorKey = ""; }', context);
    vm.runInContext(`
        var cachedRows = Array.from({ length: 31 }, function(_, i) {
            var close = 130 + i * 0.2;
            var day = String(i + 1).padStart(2, '0');
            return {
                date: i === 30 ? '2026-06-29' : '2026-05-' + day,
                open: close - 0.5,
                high: close + 1,
                low: close - 1,
                close,
                vol: 3000 + i * 10,
                amt: 30000 + i * 100
            };
        });
        state.id = 'sh';
        state.mode = 'index';
        state.tab = 'index';
        state.rawData.sh = cachedRows.map(row => ({ ...row }));
        state.confirmedStatus.sh = { source: 'eastmoney', status: 'fresh', lastDate: '2026-06-29', syncedAt: 1 };
        localStorage.setItem(SYS_CONFIG.LIVE_OVERLAY_CACHE_KEY, JSON.stringify({
            sh: {
                cachedAt: Date.now() - 90000,
                cacheAgeMs: 0,
                source: 'api',
                bar: { date: '2026-06-30', open: 131, high: 134, low: 130, close: 133, prevClose: 131, vol: 3400, amt: 34000, quoteTime: '2026-06-30 10:30:00', quoteDateSource: 'api' }
            }
        }));
        syncDataWithHistory = async function() { return cachedRows.map(row => ({ ...row })); };
        requestManager.fetchRealtimeWithThrottle = async function() { return null; };
    `, context);
    await vm.runInContext('(async function() { returnedRows = await syncData("sh"); })()', context);
    const result = JSON.parse(vm.runInContext(`JSON.stringify({
        displayMode: state.displayStatus.sh.mode,
        displayReason: state.displayStatus.sh.reason,
        cacheAgeMs: state.displayStatus.sh.cacheAgeMs,
        ttlMs: SYS_CONFIG.LIVE_OVERLAY_CACHE_TTL_MS,
        liveBarCached: !!state.liveBars.sh?._isCachedLive,
        liveBarSoftExpired: !!state.liveBars.sh?._isSoftExpiredLive
    })`, context));
    assert.strictEqual(result.displayMode, 'cached-live-overlay');
    assert.strictEqual(result.displayReason, '沿用盘中');
    assert.ok(result.cacheAgeMs > result.ttlMs, JSON.stringify(result));
    assert.strictEqual(result.liveBarCached, true);
    assert.strictEqual(result.liveBarSoftExpired, true);
});

runTest('trading calendar skips official 2026 mainland market holidays', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    const fixedClockDataSource = dataSource
        .replace(/function getBJDate\(\) \{ return new Date\(new Date\(\)\.toLocaleString\("en-US", \{timeZone: "Asia\/Shanghai"\}\)\); \}/, "function getBJDate() { return new Date('2026-02-19T10:30:00+08:00'); }");
    vm.runInContext(fixedClockDataSource, context);
    const result = JSON.parse(vm.runInContext(`JSON.stringify({
        today: getTodayDate(),
        isTradingDay: isTradingDay(getTodayDate()),
        lastTradingDate: getLastTradingDate(),
        expectedConfirmedDate: getExpectedConfirmedDate(),
        normalizedDates: normalizeConfirmedHistoryData([
            { date: '2026-02-13', open: 100, high: 101, low: 99, close: 100, vol: 1, amt: 1 },
            { date: '2026-02-18', open: 100, high: 101, low: 99, close: 100, vol: 1, amt: 1 },
            { date: '2026-02-19', open: 100, high: 101, low: 99, close: 100, vol: 1, amt: 1 }
        ], 'sh').map(row => row.date)
    })`, context));
    assert.deepStrictEqual(result, {
        today: '2026-02-19',
        isTradingDay: false,
        lastTradingDate: '2026-02-13',
        expectedConfirmedDate: '2026-02-13',
        normalizedDates: ['2026-02-13']
    });
});

runTest('trading calendar keeps official 2026 reopening dates tradable', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    const fixedClockDataSource = dataSource
        .replace(/function getBJDate\(\) \{ return new Date\(new Date\(\)\.toLocaleString\("en-US", \{timeZone: "Asia\/Shanghai"\}\)\); \}/, "function getBJDate() { return new Date('2026-10-08T16:30:00+08:00'); }");
    vm.runInContext(fixedClockDataSource, context);
    const result = JSON.parse(vm.runInContext(`JSON.stringify({
        today: getTodayDate(),
        isTradingDay: isTradingDay(getTodayDate()),
        lastTradingDate: getLastTradingDate(),
        expectedConfirmedDate: getExpectedConfirmedDate()
    })`, context));
    assert.deepStrictEqual(result, {
        today: '2026-10-08',
        isTradingDay: true,
        lastTradingDate: '2026-10-08',
        expectedConfirmedDate: '2026-10-08'
    });
});

runTest('post-close cached live overlay restores from local cache while confirmed history waits for today', async () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    const instrumentedDataSource = dataSource
        .replace(/function getBJDate\(\) \{ return new Date\(new Date\(\)\.toLocaleString\("en-US", \{timeZone: "Asia\/Shanghai"\}\)\); \}/, "function getBJDate() { return new Date('2026-06-30T15:45:00+08:00'); }")
        .replace(/function dbGet\(id\) \{[\s\S]*?\n\}/, "function dbGet(id) { return Promise.resolve({ data: cachedRows }); }")
        .replace(/function dbSet\(id, data\) \{[\s\S]*?\n\}/, "function dbSet(id, data) { return Promise.resolve(); }");
    vm.runInContext(instrumentedDataSource, context);
    vm.runInContext('function markIndicatorsDirty() { state.indicatorKey = ""; }', context);
    vm.runInContext(`
        var cachedRows = Array.from({ length: 31 }, function(_, i) {
            var close = 130 + i * 0.2;
            var day = String(i + 1).padStart(2, '0');
            return {
                date: i === 30 ? '2026-06-29' : '2026-05-' + day,
                open: close - 0.5,
                high: close + 1,
                low: close - 1,
                close,
                vol: 3000 + i * 10,
                amt: 30000 + i * 100
            };
        });
        state.id = 'sh';
        state.mode = 'index';
        state.tab = 'index';
        state.rawData.sh = cachedRows.map(row => ({ ...row }));
        state.confirmedStatus.sh = { source: 'eastmoney', status: 'fresh', lastDate: '2026-06-29', syncedAt: 1 };
        state.liveOverlayCache = {
            sh: {
                cachedAt: Date.now() - 420000,
                cacheAgeMs: 420000,
                source: 'api',
                bar: { date: '2026-06-30', open: 131, high: 134, low: 130, close: 133, prevClose: 136, vol: 3400, amt: 34000, quoteTime: '2026-06-30 14:56:00', quoteDateSource: 'api' }
            }
        };
        localStorage.setItem(SYS_CONFIG.LIVE_OVERLAY_CACHE_KEY, JSON.stringify(state.liveOverlayCache));
        syncDataWithHistory = async function() { return cachedRows.map(row => ({ ...row })); };
        requestManager.fetchRealtimeWithThrottle = async function() { throw new Error('post-close should not fetch realtime quote'); };
    `, context);
    await vm.runInContext('(async function() { returnedRows = await syncData("sh"); })()', context);
    const result = JSON.parse(vm.runInContext(`JSON.stringify({
        rawLatest: state.rawData.sh[state.rawData.sh.length - 1].date,
        activeLatest: getActiveData()[getActiveData().length - 1].date,
        activeClose: getActiveData()[getActiveData().length - 1].close,
        displayMode: state.displayStatus.sh.mode,
        displayReason: state.displayStatus.sh.reason,
        liveBarExists: !!state.liveBars.sh,
        liveBarDate: state.liveBars.sh?.date || '',
        liveBarCached: !!state.liveBars.sh?._isCachedLive,
        cachedStore: JSON.parse(localStorage.getItem(SYS_CONFIG.LIVE_OVERLAY_CACHE_KEY) || '{}').sh ? 'present' : ''
    })`, context));
    assert.deepStrictEqual(result, {
        rawLatest: '2026-06-29',
        activeLatest: '2026-06-30',
        activeClose: 133,
        displayMode: 'post-close-pending',
        displayReason: '盘后待确认',
        liveBarExists: true,
        liveBarDate: '2026-06-30',
        liveBarCached: true,
        cachedStore: 'present'
    });
});

runTest('market-open history today row is excluded from confirmed cache and only shown as live overlay', async () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    const instrumentedDataSource = dataSource
        .replace(/function getBJDate\(\) \{ return new Date\(new Date\(\)\.toLocaleString\("en-US", \{timeZone: "Asia\/Shanghai"\}\)\); \}/, "function getBJDate() { return new Date('2026-06-30T10:30:00+08:00'); }")
        .replace(/function getCachedData\(id\) \{[\s\S]*?\n\}/, "function getCachedData(id) { return Promise.resolve(null); }")
        .replace(/function dbGet\(id\) \{[\s\S]*?\n\}/, "function dbGet(id) { return Promise.resolve(null); }")
        .replace(/function dbSet\(id, data\) \{[\s\S]*?\n\}/, "function dbSet(id, data) { dbSetPayloads.push(data.map(row => ({ ...row }))); return Promise.resolve(); }");
    vm.runInContext('var dbSetPayloads = [];', context);
    vm.runInContext(instrumentedDataSource, context);
    vm.runInContext('function markIndicatorsDirty() { state.indicatorKey = ""; }', context);
    vm.runInContext(`
        var historyRows = Array.from({ length: 31 }, function(_, i) {
            var close = 100 + i;
            if (i === 29) {
                return { date: '2026-06-29', open: 128, high: 132, low: 127, close: 130, vol: 3000, amt: 30000 };
            }
            if (i === 30) {
                return { date: '2026-06-30', open: 130, high: 999, low: 129, close: 998, vol: 9999, amt: 99999 };
            }
            return {
                date: '2026-05-' + String(i + 1).padStart(2, '0'),
                open: close - 0.5,
                high: close + 1,
                low: close - 1,
                close,
                vol: 1000 + i,
                amt: 10000 + i
            };
        });
        jsonpFetchEastmoneyKline = async function() { return historyRows.map(row => ({ ...row })); };
        jsonpFetchTencentKline = async function() { return []; };
        requestManager.fetchRealtimeWithThrottle = async function() {
            return { date: '2026-06-30', open: 130, high: 138, low: 129, close: 136, prevClose: 130, vol: 4000, amt: 40000 };
        };
        state.id = 'sh';
        state.mode = 'index';
        state.tab = 'index';
    `, context);
    await vm.runInContext('(async function() { returnedRows = await syncData("sh"); setRawData("sh", returnedRows); })()', context);
    const result = JSON.parse(vm.runInContext(`JSON.stringify({
        confirmedLastDate: state.rawData.sh[state.rawData.sh.length - 1].date,
        confirmedLastClose: state.rawData.sh[state.rawData.sh.length - 1].close,
        activeLastDate: getActiveData()[getActiveData().length - 1].date,
        activeLastClose: getActiveData()[getActiveData().length - 1].close,
        returnedLastDate: returnedRows[returnedRows.length - 1].date,
        cachedLastDates: dbSetPayloads.map(rows => rows[rows.length - 1].date),
        cachedLastCloses: dbSetPayloads.map(rows => rows[rows.length - 1].close)
    })`, context));
    assert.deepStrictEqual(result, {
        confirmedLastDate: '2026-06-29',
        confirmedLastClose: 130,
        activeLastDate: '2026-06-30',
        activeLastClose: 136,
        returnedLastDate: '2026-06-29',
        cachedLastDates: ['2026-06-29'],
        cachedLastCloses: [130]
    });
});

runTest('market-open first history load applies valid realtime overlay without caching it', async () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    const instrumentedDataSource = dataSource
        .replace(/function getBJDate\(\) \{ return new Date\(new Date\(\)\.toLocaleString\("en-US", \{timeZone: "Asia\/Shanghai"\}\)\); \}/, "function getBJDate() { return new Date('2026-06-30T10:30:00+08:00'); }")
        .replace(/function getCachedData\(id\) \{[\s\S]*?\n\}/, "function getCachedData(id) { return Promise.resolve(null); }")
        .replace(/function dbGet\(id\) \{[\s\S]*?\n\}/, "function dbGet(id) { return Promise.resolve(null); }")
        .replace(/function dbSet\(id, data\) \{[\s\S]*?\n\}/, "function dbSet(id, data) { dbSetPayloads.push(data.map(row => ({ ...row }))); return Promise.resolve(); }")
        .replace(/async function syncDataWithHistory\(id\) \{[\s\S]*?\n\}/, "async function syncDataWithHistory(id) { return historyRows.map(row => ({ ...row })); }");
    vm.runInContext('var dbSetPayloads = [];', context);
    vm.runInContext(instrumentedDataSource, context);
    vm.runInContext('function markIndicatorsDirty() { state.indicatorKey = ""; }', context);
    vm.runInContext(`
        var historyRows = Array.from({ length: 31 }, function(_, i) {
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
        requestManager.fetchRealtimeWithThrottle = async function() {
            return { date: '2026-06-30', open: 130, high: 138, low: 129, close: 136, prevClose: 130, vol: 4000, amt: 40000 };
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
        returnedLastDate: returnedRows[returnedRows.length - 1].date,
        cachedLastCloses: dbSetPayloads.map(rows => rows[rows.length - 1].close)
    })`, context));
    assert.deepStrictEqual(result, {
        confirmedLastDate: '2026-06-29',
        activeLastDate: '2026-06-30',
        activeLastClose: 136,
        returnedLastDate: '2026-06-29',
        cachedLastCloses: [130]
    });
});

runTest('confirmed same-day close wins over stale left-list quote after close', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(dataSource, context);
    vm.runInContext(`
        state.rawData.sh = [
            { date: '2026-07-08', open: 3900, high: 4020, low: 3890, close: 3970, vol: 1000, amt: 10000 },
            { date: '2026-07-09', open: 3977.55, high: 4040.54, low: 3938.88, close: 4036.59, vol: 1200, amt: 12000 }
        ];
        state.confirmedStatus.sh = { status: 'fresh', lastDate: '2026-07-09' };
        state.displayStatus.sh = { mode: 'confirmed', confirmedDate: '2026-07-09' };
        setLiveQuote('sh', { date: '2026-07-09', open: 3977, high: 4000, low: 3900, close: 3991.33, prevClose: 3970, vol: 900, amt: 9000 }, 'quote-only', 'stale-quote');
        var visible = getVisibleQuoteData('sh');
        var quoteDisplay = {
            close: visible[visible.length - 1].close,
            base: getVisibleQuoteChangeBase('sh', visible)
        };
    `, context);
    const result = vm.runInContext('quoteDisplay', context);
    assert.strictEqual(result.close, 4036.59);
    assert.strictEqual(result.base, 3970);
});

runTest('active cached fetch skips cache-first redraw when memory data already exists', async () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    const instrumentedDataSource = dataSource
        .replace(/function dbGet\(id\) \{[\s\S]*?\n\}/, "function dbGet(id) { dbGetCount++; return Promise.resolve({ data: cachedRows }); }")
        .replace(/function scheduleCachedFetchRefresh\(id\) \{[\s\S]*?\n\}/, "function scheduleCachedFetchRefresh(id) { scheduledRefreshIds.push(id); return Promise.resolve(); }");
    vm.runInContext('var dbGetCount = 0; var scheduledRefreshIds = [];', context);
    vm.runInContext(instrumentedDataSource, context);
    vm.runInContext(`
        var frameQueue = [];
        requestAnimationFrame = function(fn) { frameQueue.push(fn); return frameQueue.length; };
        var drawCount = 0;
        var indicatorUpdateCount = 0;
        draw = function() { drawCount++; };
        updateAllIndicators = function() { indicatorUpdateCount++; };
        markIndicatorsDirty = function() {};
        renderMASelector = function() {};
        renderIndexList = function() {};
        safeUpdateSidebar = function() {};
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
        state.charts = { main: {}, vol: {}, macd: {}, kdj: {} };
        state.lockIdx = 1;
    `, context);
    await vm.runInContext('cachedFetch("sh")', context);
    assert.strictEqual(vm.runInContext('drawCount', context), 0);
    assert.strictEqual(vm.runInContext('indicatorUpdateCount', context), 0);
    assert.strictEqual(vm.runInContext('frameQueue.length', context), 0);
    assert.deepStrictEqual(JSON.parse(vm.runInContext('JSON.stringify(scheduledRefreshIds)', context)), ['sh']);
});

runTest('cache-first render restores same-day live overlay from localStorage before first paint', async () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    const instrumentedDataSource = dataSource
        .replace(/function getBJDate\(\) \{ return new Date\(new Date\(\)\.toLocaleString\("en-US", \{timeZone: "Asia\/Shanghai"\}\)\); \}/, "function getBJDate() { return new Date('2026-06-30T10:30:20+08:00'); }")
        .replace(/function dbGet\(id\) \{[\s\S]*?\n\}/, "function dbGet(id) { return Promise.resolve({ data: cachedRows }); }")
        .replace(/function scheduleCachedFetchRefresh\(id\) \{[\s\S]*?\n\}/, "function scheduleCachedFetchRefresh(id) { scheduledRefreshIds.push(id); return Promise.resolve(); }");
    vm.runInContext('var scheduledRefreshIds = [];', context);
    vm.runInContext(instrumentedDataSource, context);
    vm.runInContext(`
        var frameQueue = [];
        requestAnimationFrame = function(fn) { frameQueue.push(fn); return frameQueue.length; };
        draw = function() {};
        safeUpdateSidebar = function() {};
        updateAllIndicators = function() {};
        markIndicatorsDirty = function() {};
        renderMASelector = function() {};
        renderIndexList = function() {};
        markRefreshTime = function() {};
        var cachedRows = Array.from({ length: 31 }, function(_, i) {
            var close = 130 + i * 0.2;
            return {
                date: i === 30 ? '2026-06-29' : '2026-05-' + String(i + 1).padStart(2, '0'),
                open: close - 0.5,
                high: close + 1,
                low: close - 1,
                close,
                vol: 3000 + i * 10,
                amt: 30000 + i * 100
            };
        });
        localStorage.setItem(SYS_CONFIG.LIVE_OVERLAY_CACHE_KEY, JSON.stringify({
            sh: {
                cachedAt: Date.now() - 18000,
                cacheAgeMs: 18000,
                source: 'api',
                bar: { date: '2026-06-30', open: 136, high: 138, low: 135, close: 137, prevClose: 136, vol: 4200, amt: 42000, quoteTime: '2026-06-30 10:30:00', quoteDateSource: 'api' }
            }
        }));
        state.id = 'sh';
        state.mode = 'index';
        state.period = 'daily';
    `, context);
    await vm.runInContext('cachedFetch("sh")', context);
    const result = JSON.parse(vm.runInContext(`JSON.stringify({
        rawLatest: state.rawData.sh[state.rawData.sh.length - 1].date,
        activeLatest: getActiveData()[getActiveData().length - 1].date,
        activeClose: getActiveData()[getActiveData().length - 1].close,
        displayMode: state.displayStatus.sh.mode,
        liveBarCached: !!state.liveBars.sh?._isCachedLive,
        lockIdx: state.lockIdx,
        frameCount: frameQueue.length,
        scheduledRefreshIds
    })`, context));
    assert.deepStrictEqual(result, {
        rawLatest: '2026-06-29',
        activeLatest: '2026-06-30',
        activeClose: 137,
        displayMode: 'cached-live-overlay',
        liveBarCached: true,
        lockIdx: 31,
        frameCount: 1,
        scheduledRefreshIds: ['sh']
    });
});

runTest('live overlay cache preserves entries written by another same-origin page', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    const fixedClockDataSource = dataSource
        .replace(/function getBJDate\(\) \{ return new Date\(new Date\(\)\.toLocaleString\("en-US", \{timeZone: "Asia\/Shanghai"\}\)\); \}/, "function getBJDate() { return new Date('2026-06-30T10:30:20+08:00'); }");
    vm.runInContext(fixedClockDataSource, context);
    vm.runInContext(`
        state.liveOverlayCache = {};
        localStorage.setItem(SYS_CONFIG.LIVE_OVERLAY_CACHE_KEY, JSON.stringify({
            sh: {
                cachedAt: Date.now() - 1000,
                cacheAgeMs: 1000,
                source: 'api',
                bar: { date: '2026-06-30', open: 100, high: 103, low: 99, close: 102, prevClose: 101, vol: 1000, amt: 10000 }
            }
        }));
        setLiveOverlayCache('cy', {
            date: '2026-06-30', open: 200, high: 205, low: 198, close: 204, prevClose: 201, vol: 2000, amt: 20000
        }, { cachedAt: Date.now(), source: 'api' });
        var persistedOverlayKeys = Object.keys(JSON.parse(localStorage.getItem(SYS_CONFIG.LIVE_OVERLAY_CACHE_KEY) || '{}')).sort();
        state.liveOverlayCache = {};
        state.liveBars = {};
        state.liveQuotes = {};
        state.rawData.sh = Array.from({ length: 31 }, function(_, i) {
            var close = 71 + i;
            return {
                date: i === 30 ? '2026-06-29' : '2026-05-' + String(i + 1).padStart(2, '0'),
                open: close - 0.5, high: close + 1, low: close - 1, close,
                vol: 1000 + i, amt: 10000 + i
            };
        });
        var restoredAfterReload = tryApplyCachedLiveOverlay('sh', state.rawData.sh);
        var restoredLatestDate = getMergedLiveDailyData('sh').slice(-1)[0].date;
    `, context);
    assert.deepStrictEqual(
        JSON.parse(vm.runInContext('JSON.stringify(persistedOverlayKeys)', context)),
        ['cy', 'sh'],
        '同源另一页面刚写入的盘中缓存不应被旧内存快照覆盖'
    );
    assert.strictEqual(vm.runInContext('restoredAfterReload', context), true);
    assert.strictEqual(vm.runInContext('restoredLatestDate', context), '2026-06-30', '刷新恢复后不应退回昨日确认历史');
});

runTest('clearing one live overlay cache preserves newer entries from another same-origin page', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(dataSource, context);
    vm.runInContext(`
        var makeEntry = function(close) {
            return {
                cachedAt: Date.now(), cacheAgeMs: 0, source: 'api',
                bar: { date: '2026-06-30', open: close - 1, high: close + 1, low: close - 2, close, prevClose: close - 1, vol: 1000, amt: 10000 }
            };
        };
        state.liveOverlayCache = { sh: makeEntry(102), cy: makeEntry(204) };
        localStorage.setItem(SYS_CONFIG.LIVE_OVERLAY_CACHE_KEY, JSON.stringify({
            sh: makeEntry(102), cy: makeEntry(204), kc50: makeEntry(306)
        }));
        clearLiveOverlayCache('sh');
        var remainingOverlayKeys = Object.keys(JSON.parse(localStorage.getItem(SYS_CONFIG.LIVE_OVERLAY_CACHE_KEY) || '{}')).sort();
    `, context);
    assert.deepStrictEqual(
        JSON.parse(vm.runInContext('JSON.stringify(remainingOverlayKeys)', context)),
        ['cy', 'kc50'],
        '清理已确认标的时不应连带删除其他页面新保存的缓存'
    );
});

runTest('stale realtime quote does not clear restored same-day cached live overlay', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    const fixedClockDataSource = dataSource
        .replace(/function getBJDate\(\) \{ return new Date\(new Date\(\)\.toLocaleString\("en-US", \{timeZone: "Asia\/Shanghai"\}\)\); \}/, "function getBJDate() { return new Date('2026-06-30T10:35:20+08:00'); }");
    vm.runInContext(fixedClockDataSource, context);
    vm.runInContext('function markIndicatorsDirty() { state.indicatorKey = ""; }', context);
    vm.runInContext(`
        var confirmedRows = Array.from({ length: 31 }, function(_, i) {
            var close = 130 + i * 0.2;
            return {
                date: i === 30 ? '2026-06-29' : '2026-05-' + String(i + 1).padStart(2, '0'),
                open: close - 0.5,
                high: close + 1,
                low: close - 1,
                close,
                vol: 3000 + i * 10,
                amt: 30000 + i * 100
            };
        });
        state.id = 'sh';
        state.mode = 'index';
        state.period = 'daily';
        setRawData('sh', confirmedRows);
        setLiveOverlayCache('sh', { date: '2026-06-30', open: 136, high: 138, low: 135, close: 137, prevClose: 136, vol: 4200, amt: 42000, quoteTime: '2026-06-30 10:30:00', quoteDateSource: 'api' }, { cachedAt: Date.now() - 18000, source: 'api' });
        tryApplyCachedLiveOverlay('sh', state.rawData.sh);
        var applyResult = applyRealtimeQuoteForSeries('sh', state.rawData.sh, { date: '2026-06-29', open: 135, high: 136, low: 134, close: 135, prevClose: 134, vol: 1000, amt: 10000, quoteTime: '2026-06-29 14:59:59', quoteDateSource: 'api' });
        var activeRows = getActiveData();
        var result = {
            applyResult,
            activeLatest: activeRows[activeRows.length - 1].date,
            activeClose: activeRows[activeRows.length - 1].close,
            displayMode: state.displayStatus.sh.mode,
            displayReason: state.displayStatus.sh.reason,
            liveBarCached: !!state.liveBars.sh?._isCachedLive,
            liveQuoteDate: state.liveQuotes.sh.date
        };
    `, context);
    assert.deepStrictEqual(JSON.parse(vm.runInContext('JSON.stringify(result)', context)), {
        applyResult: 'cached-overlay',
        activeLatest: '2026-06-30',
        activeClose: 137,
        displayMode: 'cached-live-overlay',
        displayReason: '短TTL缓存盘中',
        liveBarCached: true,
        liveQuoteDate: '2026-06-30'
    });
});

runTest('performance panel exposes refresh path labels for refresh traces', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(appSourceNoInit, context);
    vm.runInContext(`
        window.__DG_PERF__.traces = [
            { label: 'cachedFetchRefreshApply', total: 12.4, meta: { path: 'same-day-light', status: 'applied' }, steps: [] },
            { label: 'cachedFetchRefreshApply', total: 18.1, meta: { path: 'full-redraw', status: 'applied' }, steps: [] },
            { label: 'cachedFetchRefreshApply', total: 22.6, meta: { path: 'frozen-redraw', status: 'applied' }, steps: [] }
        ];
        renderPerfPanel();
    `, context);
    const html = vm.runInContext('document.getElementById("perfPanel").innerHTML', context);
    assert.match(html, /刷新路径/);
    assert.match(html, /性能基线/);
    assert.match(html, /平均 12.4ms/);
    assert.ok(html.includes('same-day-light'));
    assert.ok(html.includes('full-redraw'));
    assert.ok(html.includes('frozen-redraw'));
});

runTest('date index cache separates daily and weekly arrays for the same id and date', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(dataSource, context);
    vm.runInContext(`
        var daily = [
            { date: '2026-01-01' },
            { date: '2026-01-02' },
            { date: '2026-01-03' },
            { date: '2026-01-04' },
            { date: '2026-01-05' }
        ];
        var weekly = [{ date: '2026-01-05' }];
        var dailyIdx = findDateIndex(daily, '2026-01-05', 'sh');
        var weeklyIdx = findDateIndex(weekly, '2026-01-05', 'sh');
    `, context);
    assert.strictEqual(vm.runInContext('dailyIdx', context), 4);
    assert.strictEqual(vm.runInContext('weeklyIdx', context), 0);
});

runTest('incremental weekly aggregation matches full daily-to-weekly conversion', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(dataSource, context);
    vm.runInContext(`
        var weeklyFixture = [
            ['2026-06-29', 100, 103, 99, 102, 1000, 10000],
            ['2026-06-30', 102, 104, 101, 103, 1100, 11000],
            ['2026-07-01', 103, 105, 100, 101, 1200, 12000],
            ['2026-07-03', 101, 106, 100, 105, 1300, 13000],
            ['2026-07-06', 105, 108, 104, 107, 1400, 14000],
            ['2026-07-07', 107, 109, 103, 104, 1500, 15000]
        ].map(function(row) {
            return { date: row[0], open: row[1], high: row[2], low: row[3], close: row[4], vol: row[5], amt: row[6] };
        });
        var fullWeekly = convertDailyToWeekly(weeklyFixture);
        var incrementalWeekly = [];
        weeklyFixture.forEach(function(row) { appendDailyBarToWeeklySeries(incrementalWeekly, row); });
    `, context);
    const result = JSON.parse(vm.runInContext('JSON.stringify({ fullWeekly, incrementalWeekly })', context));
    assert.deepStrictEqual(result.incrementalWeekly, result.fullWeekly);
});

runTest('refresh bar data status copy is unified and concise for index and stock modes', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    const fixedClockDataSource = dataSource
        .replace(/function getBJDate\(\) \{ return new Date\(new Date\(\)\.toLocaleString\("en-US", \{timeZone: "Asia\/Shanghai"\}\)\); \}/, "function getBJDate() { return new Date('2026-06-30T10:30:00+08:00'); }");
    vm.runInContext(fixedClockDataSource, context);
    vm.runInContext(calcSource, context);
    vm.runInContext(renderSource, context);
    vm.runInContext(`
        function collectStatusCopy(mode, id) {
            state.id = id;
            state.mode = mode;
            state.period = 'daily';
            state.rawData = {};
            state.liveBars = {};
            state.liveQuotes = {};
            state.liveWeeklyData = {};
            state.confirmedStatus = {};
            state.displayStatus = {};

            var confirmedRows = [
                { date: '2026-06-29', open: 100, high: 101, low: 99, close: 100, vol: 1000, amt: 10000 },
                { date: '2026-06-30', open: 100, high: 102, low: 99, close: 101, vol: 1200, amt: 12000 }
            ];
            state.rawData[id] = confirmedRows;
            state.confirmedStatus[id] = { status: 'fresh', lastDate: '2026-06-30' };
            state.displayStatus[id] = { mode: 'confirmed' };
            var confirmed = renderDataStatusRefreshBadge(confirmedRows[1], id, confirmedRows);

            var overlayRows = [
                { date: '2026-06-29', open: 100, high: 101, low: 99, close: 100, vol: 1000, amt: 10000 },
                { date: '2026-06-30', open: 100, high: 103, low: 99, close: 102, vol: 1500, amt: 15000, _isLive: true }
            ];
            state.rawData[id] = [overlayRows[0]];
            state.confirmedStatus[id] = { status: 'fresh', lastDate: '2026-06-29' };
            state.displayStatus[id] = { mode: 'live-overlay' };
            var live = renderDataStatusRefreshBadge(overlayRows[1], id, overlayRows);

            var cachedItem = { ...overlayRows[1], _isCachedLive: true };
            state.displayStatus[id] = { mode: 'cached-live-overlay', reason: '沿用盘中', cacheAgeMs: 22000 };
            var cached = renderDataStatusRefreshBadge(cachedItem, id, [overlayRows[0], cachedItem]);

            state.displayStatus[id] = { mode: 'post-close-pending', reason: '盘后待确认', cacheAgeMs: 420000 };
            var pending = renderDataStatusRefreshBadge(cachedItem, id, [overlayRows[0], cachedItem]);

            state.rawData[id] = [overlayRows[0]];
            state.confirmedStatus[id] = { status: 'stale', lastDate: '2026-06-29' };
            state.displayStatus[id] = { mode: 'quote-only', reason: 'confirmed-history-stale', quoteDate: '2026-06-30' };
            var quoteOnly = renderDataStatusRefreshBadge(overlayRows[0], id, [overlayRows[0]]);

            return { confirmed, live, cached, pending, quoteOnly };
        }

        var indexCopy = collectStatusCopy('index', 'sh');
        var stockCopy = collectStatusCopy('stock', '1.600519');
    `, context);
    const result = JSON.parse(vm.runInContext('JSON.stringify({ indexCopy, stockCopy })', context));
    for (const copy of [result.indexCopy, result.stockCopy]) {
        assert.ok(copy.confirmed.includes('收盘确认'), copy.confirmed);
        assert.ok(copy.confirmed.includes('title="按确认历史计算。"'), copy.confirmed);
        assert.ok(copy.confirmed.includes('data-tooltip="按确认历史计算。"'), copy.confirmed);
        assert.ok(copy.confirmed.includes('aria-label="按确认历史计算。"'), copy.confirmed);
        assert.ok(copy.confirmed.includes('tabindex="0"'), copy.confirmed);

        assert.ok(copy.live.includes('盘中临时'), copy.live);
        assert.ok(copy.live.includes('title="实时价已进入图表。"'), copy.live);

        assert.ok(copy.cached.includes('缓存盘中'), copy.cached);
        assert.ok(!copy.cached.includes('<span class="data-status-label">沿用盘中</span>'), copy.cached);
        assert.ok(copy.cached.includes('title="沿用最近盘中数据。"'), copy.cached);

        assert.ok(copy.pending.includes('盘后待确认'), copy.pending);
        assert.ok(copy.pending.includes('title="等收盘K线确认。"'), copy.pending);

        assert.ok(copy.quoteOnly.includes('仅左侧报价'), copy.quoteOnly);
        assert.ok(copy.quoteOnly.includes('title="右侧仍按确认K线。"'), copy.quoteOnly);
    }
    assert.ok(cssSource.includes('.data-status-pill::after'), 'refresh status badge should render an in-page tooltip');
    assert.ok(cssSource.includes('content: attr(data-tooltip);'), 'status tooltip should read from data-tooltip');
    assert.ok(cssSource.includes('.data-status-pill:hover::after'), 'refresh status tooltip should open on hover');
    assert.ok(cssSource.includes(':focus-visible::after'), 'status tooltip should also work from keyboard focus');
    assert.ok(!renderSource.includes('renderConclusionStatusBadge'), 'conclusion card should not keep a separate status badge renderer');
    assert.ok(!cssSource.includes('.conclusion-status-pill'), 'conclusion card should not keep a separate status badge style');
});

runTest('right panel conclusion card delegates data status to the refresh bar', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    const fixedClockDataSource = dataSource
        .replace(/function getBJDate\(\) \{ return new Date\(new Date\(\)\.toLocaleString\("en-US", \{timeZone: "Asia\/Shanghai"\}\)\); \}/, "function getBJDate() { return new Date('2026-06-30T10:30:00+08:00'); }");
    vm.runInContext(fixedClockDataSource, context);
    vm.runInContext(calcSource, context);
    vm.runInContext(renderSource, context);
    vm.runInContext(`
        state.id = 'sh';
        state.mode = 'index';
        state.period = 'daily';
        state.indicators = {
            ma: { 5: [100, 101], 10: [100, 101], 20: [99, 100], 60: [98, 99] },
            macd: { diff: [1, 1], dea: [0, 0] },
            rsi: { val: [50, 50] },
            kdj: { k: [50, 50], d: [50, 50], j: [50, 50] }
        };
        getMarketContext = function() { return { label: '温和偏多', reason: '测试市场环境', cls: 'bull', coef: 1, maxPosition: 80 }; };
        getRiskContext = function() { return { level: '风险可控', score: 80, flags: [], coef: 1, stop: 99, pressure: 110 }; };
        getExitSeverity = function() { return { level: '无明确离场' }; };
        getBasePosition = function() { return 50; };
        getSignalMeta = function() {
            return { windowScore: 5, windowSignals: [{ day: 1, signal: 'B1' }], buySignals: ['B1'], exitSignals: [], warningSignals: [], allSignals: {}, inCooldown: false, type: '测试转强' };
        };

        var confirmedRows = [
            { date: '2026-06-29', open: 100, high: 102, low: 99, close: 101, vol: 1000, amt: 10000, _signals: ['B1'] },
            { date: '2026-06-30', open: 101, high: 104, low: 100, close: 103, vol: 1200, amt: 12000, _signals: ['B1'] }
        ];
        confirmedRows[1]._decision = computeDecisionForIndex(1, confirmedRows, 30);
        state.rawData.sh = confirmedRows;
        state.confirmedStatus.sh = { status: 'fresh', lastDate: '2026-06-30' };
        state.displayStatus.sh = { mode: 'confirmed' };
        var confirmedHtml = generateAnalysisHTML(1, confirmedRows, getSignalMeta(1, confirmedRows, state.indicators));

        var overlayRows = [
            { date: '2026-06-29', open: 100, high: 102, low: 99, close: 101, vol: 1000, amt: 10000, _signals: ['B1'] },
            { date: '2026-06-30', open: 101, high: 105, low: 100, close: 104, vol: 1300, amt: 13000, _signals: ['B1'], _isLive: true }
        ];
        overlayRows[1]._decision = computeDecisionForIndex(1, overlayRows, 30);
        state.rawData.sh = [overlayRows[0]];
        state.liveBars.sh = overlayRows[1];
        state.displayStatus.sh = { mode: 'live-overlay', quoteDate: '2026-06-30' };
        var overlayHtml = generateAnalysisHTML(1, overlayRows, getSignalMeta(1, overlayRows, state.indicators));

        state.liveBars = {};
        state.liveWeeklyData = {};
        state.liveQuotes = {};
        state.rawData.sh = [confirmedRows[0]];
        state.confirmedStatus.sh = { status: 'fresh', lastDate: '2026-06-29' };
        setLiveBar('sh', { date: '2026-06-30', open: 101, high: 105, low: 100, close: 104, vol: 1300, amt: 13000, _signals: ['B1'] }, 'cache', { cachedAt: Date.now() - 22000, cacheAgeMs: 22000 });
        var cachedOverlayRows = getActiveData();
        var cachedOverlayItem = cachedOverlayRows[cachedOverlayRows.length - 1];
        var cachedOverlayRefresh = renderDataStatusRefreshBadge(cachedOverlayItem, 'sh', cachedOverlayRows);

        state.liveBars = {};
        state.liveQuotes = { sh: { date: '2026-06-30', close: 104, _quoteQuality: 'quote-only' } };
        state.rawData.sh = [confirmedRows[0]];
        state.confirmedStatus.sh = { status: 'stale', lastDate: '2026-06-29' };
        state.displayStatus.sh = { mode: 'quote-only', reason: 'confirmed-history-stale', quoteDate: '2026-06-30' };
        confirmedRows[0]._decision = computeDecisionForIndex(0, confirmedRows, 30);
        var quoteOnlyHtml = generateAnalysisHTML(0, [confirmedRows[0]], getSignalMeta(0, [confirmedRows[0]], state.indicators));
    `, context);
    const result = JSON.parse(vm.runInContext(`JSON.stringify({
        confirmedHtml,
        overlayHtml,
        cachedOverlayRefresh,
        quoteOnlyHtml
    })`, context));
    assert.ok(result.confirmedHtml.includes('大盘每日结论'), result.confirmedHtml);
    assert.ok(!result.confirmedHtml.includes('conclusion-status-pill'), result.confirmedHtml);
    assert.ok(!result.confirmedHtml.includes('收盘确认结论'), result.confirmedHtml);
    assert.ok(!result.confirmedHtml.includes('盘中临时结论'), result.confirmedHtml);
    assert.ok(result.overlayHtml.includes('大盘每日结论'), result.overlayHtml);
    assert.ok(!result.overlayHtml.includes('conclusion-status-pill'), result.overlayHtml);
    assert.ok(!result.overlayHtml.includes('盘中临时结论'), result.overlayHtml);
    assert.ok(!result.overlayHtml.includes('收盘确认结论'), result.overlayHtml);
    assert.ok(result.cachedOverlayRefresh.includes('data-dg-display-mode="cached-live-overlay"'), result.cachedOverlayRefresh);
    assert.ok(result.cachedOverlayRefresh.includes('data-dg-live-cached="true"'), result.cachedOverlayRefresh);
    assert.ok(result.cachedOverlayRefresh.includes('缓存盘中'), result.cachedOverlayRefresh);
    assert.ok(!result.quoteOnlyHtml.includes('conclusion-status-pill'), result.quoteOnlyHtml);
    assert.ok(!result.quoteOnlyHtml.includes('收盘确认结论'), result.quoteOnlyHtml);
    assert.ok(!result.quoteOnlyHtml.includes('盘中临时结论'), result.quoteOnlyHtml);
});

runTest('after market close freezes same-day cached live conclusion as pending confirmation', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    const fixedClockDataSource = dataSource
        .replace(/function getBJDate\(\) \{ return new Date\(new Date\(\)\.toLocaleString\("en-US", \{timeZone: "Asia\/Shanghai"\}\)\); \}/, "function getBJDate() { return new Date('2026-06-30T15:45:00+08:00'); }");
    vm.runInContext(fixedClockDataSource, context);
    vm.runInContext(calcSource, context);
    vm.runInContext(renderSource, context);
    vm.runInContext(`
        state.id = 'sh';
        state.mode = 'index';
        state.period = 'daily';
        state.rawData.sh = [
            { date: '2026-06-29', open: 100, high: 102, low: 99, close: 101, vol: 1000, amt: 10000, _signals: ['B1'] }
        ];
        state.confirmedStatus.sh = { status: 'fresh', lastDate: '2026-06-29' };
        setLiveBar('sh', { date: '2026-06-30', open: 101, high: 105, low: 100, close: 104, vol: 1300, amt: 13000, _signals: ['B1'], quoteTime: '2026-06-30 14:56:00' }, 'cache', { cachedAt: Date.now() - 420000, cacheAgeMs: 420000 });
        var activeRows = getActiveData();
        var item = activeRows[activeRows.length - 1];
        var refresh = renderDataStatusRefreshBadge(item, 'sh', activeRows);
        var result = {
            displayMode: state.displayStatus.sh.mode,
            displayReason: state.displayStatus.sh.reason,
            activeDate: item.date,
            liveBarExists: !!state.liveBars.sh,
            refresh
        };
    `, context);
    const result = vm.runInContext('result', context);
    assert.strictEqual(result.displayMode, 'post-close-pending');
    assert.strictEqual(result.displayReason, '盘后待确认');
    assert.strictEqual(result.activeDate, '2026-06-30');
    assert.strictEqual(result.liveBarExists, true);
    assert.ok(result.refresh.includes('盘后待确认'), result.refresh);
    assert.ok(result.refresh.includes('data-dg-display-mode="post-close-pending"'), result.refresh);
});

runTest('refresh status badge exposes confirmed and display status smoke attributes', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    const fixedClockDataSource = dataSource
        .replace(/function getBJDate\(\) \{ return new Date\(new Date\(\)\.toLocaleString\("en-US", \{timeZone: "Asia\/Shanghai"\}\)\); \}/, "function getBJDate() { return new Date('2026-06-30T10:30:00+08:00'); }");
    vm.runInContext(fixedClockDataSource, context);
    vm.runInContext(calcSource, context);
    vm.runInContext(renderSource, context);
    vm.runInContext(`
        state.id = 'sh';
        state.mode = 'index';
        state.period = 'daily';

        var confirmedRows = [
            { date: '2026-06-29', open: 100, high: 102, low: 99, close: 101, vol: 1000, amt: 10000, _signals: ['B1'] },
            { date: '2026-06-30', open: 101, high: 104, low: 100, close: 103, vol: 1200, amt: 12000, _signals: ['B1'] }
        ];
        state.rawData.sh = confirmedRows;
        state.confirmedStatus.sh = { status: 'fresh', lastDate: '2026-06-30' };
        state.displayStatus.sh = { mode: 'confirmed' };
        var confirmedRefresh = renderDataStatusRefreshBadge(confirmedRows[1], 'sh', confirmedRows);

        state.liveBars = {};
        state.liveQuotes = {};
        state.rawData.sh = [{ date: '2026-06-29', open: 100, high: 102, low: 99, close: 101, vol: 1000, amt: 10000, _signals: ['B1'] }];
        state.confirmedStatus.sh = { status: 'fresh', lastDate: '2026-06-29' };
        setLiveBar('sh', { date: '2026-06-30', open: 101, high: 105, low: 100, close: 104, vol: 1300, amt: 13000, _signals: ['B1'] });
        var overlayRows = getActiveData();
        var overlayItem = overlayRows[overlayRows.length - 1];
        var overlayRefresh = renderDataStatusRefreshBadge(overlayItem, 'sh', overlayRows);
        var historicalItem = overlayRows[overlayRows.length - 2];
        var historicalRefresh = renderDataStatusRefreshBadge(historicalItem, 'sh', overlayRows);

        state.liveBars = {};
        state.liveWeeklyData = {};
        state.liveQuotes = {};
        state.rawData.sh = [{ date: '2026-06-29', open: 100, high: 102, low: 99, close: 101, vol: 1000, amt: 10000, _signals: ['B1'] }];
        state.confirmedStatus.sh = { status: 'stale', lastDate: '2026-06-29' };
        setLiveQuote('sh', { date: '2026-06-30', open: 101, high: 105, low: 100, close: 104, vol: 1300, amt: 13000 }, 'quote-only', 'confirmed-history-stale');
        var quoteOnlyRefresh = renderDataStatusRefreshBadge(state.rawData.sh[0], 'sh', state.rawData.sh);
    `, context);
    const result = JSON.parse(vm.runInContext(`JSON.stringify({
        confirmedRefresh,
        overlayRefresh,
        historicalRefresh,
        quoteOnlyRefresh
    })`, context));

    assert.ok(result.confirmedRefresh.includes('data-dg-source="refresh-bar"'), result.confirmedRefresh);
    assert.ok(result.confirmedRefresh.includes('data-dg-display-mode="confirmed"'), result.confirmedRefresh);
    assert.ok(result.confirmedRefresh.includes('data-dg-confirmed-status="fresh"'), result.confirmedRefresh);
    assert.ok(result.confirmedRefresh.includes('data-dg-confirmed-date="2026-06-30"'), result.confirmedRefresh);
    assert.ok(result.confirmedRefresh.includes('data-dg-item-date="2026-06-30"'), result.confirmedRefresh);

    assert.ok(result.overlayRefresh.includes('data-dg-display-mode="live-overlay"'), result.overlayRefresh);
    assert.ok(result.overlayRefresh.includes('data-dg-confirmed-date="2026-06-29"'), result.overlayRefresh);
    assert.ok(result.overlayRefresh.includes('data-dg-item-date="2026-06-30"'), result.overlayRefresh);
    assert.ok(result.overlayRefresh.includes('data-dg-item-live="true"'), result.overlayRefresh);

    assert.ok(result.historicalRefresh.includes('收盘确认'), result.historicalRefresh);
    assert.ok(result.historicalRefresh.includes('data-dg-display-mode="confirmed"'), result.historicalRefresh);
    assert.ok(result.historicalRefresh.includes('data-dg-item-date="2026-06-29"'), result.historicalRefresh);
    assert.ok(result.historicalRefresh.includes('data-dg-item-live="false"'), result.historicalRefresh);

    assert.ok(result.quoteOnlyRefresh.includes('data-dg-display-mode="quote-only"'), result.quoteOnlyRefresh);
    assert.ok(result.quoteOnlyRefresh.includes('data-dg-display-reason="confirmed-history-stale"'), result.quoteOnlyRefresh);
    assert.ok(result.quoteOnlyRefresh.includes('data-dg-confirmed-status="stale"'), result.quoteOnlyRefresh);
});

runTest('confirmed history application exposes confirmed display mode for browser smoke', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    const fixedClockDataSource = dataSource
        .replace(/function getBJDate\(\) \{ return new Date\(new Date\(\)\.toLocaleString\("en-US", \{timeZone: "Asia\/Shanghai"\}\)\); \}/, "function getBJDate() { return new Date('2026-06-30T16:30:00+08:00'); }");
    vm.runInContext(fixedClockDataSource, context);
    vm.runInContext(calcSource, context);
    vm.runInContext(renderSource, context);
    vm.runInContext(`
        state.id = 'sh';
        state.mode = 'index';
        state.period = 'daily';
        var rows = [];
        for (var i = 1; i <= 35; i++) {
            var day = String(i).padStart(2, '0');
            rows.push({ date: '2026-05-' + day, open: 100 + i, high: 101 + i, low: 99 + i, close: 100 + i, vol: 1000 + i, amt: 10000 + i });
        }
        rows[rows.length - 1].date = '2026-06-30';
        state.confirmedStatus.sh = { source: 'eastmoney', status: 'fresh', lastDate: '2026-06-30', syncedAt: 1 };
        setRawData('sh', rows);
        var item = state.rawData.sh[state.rawData.sh.length - 1];
        var statusHtml = renderDataStatusRefreshBadge(item, 'sh', state.rawData.sh);
    `, context);
    const result = JSON.parse(vm.runInContext(`JSON.stringify({
        displayStatus: state.displayStatus.sh,
        statusHtml
    })`, context));
    assert.strictEqual(result.displayStatus.mode, 'confirmed');
    assert.ok(result.statusHtml.includes('data-dg-display-mode="confirmed"'), result.statusHtml);
    assert.ok(result.statusHtml.includes('data-dg-confirmed-status="fresh"'), result.statusHtml);
    assert.ok(result.statusHtml.includes('收盘确认'), result.statusHtml);
});

runTest('cached confirmed history application exposes confirmed status for browser smoke', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    const fixedClockDataSource = dataSource
        .replace(/function getBJDate\(\) \{ return new Date\(new Date\(\)\.toLocaleString\("en-US", \{timeZone: "Asia\/Shanghai"\}\)\); \}/, "function getBJDate() { return new Date('2026-06-30T16:30:00+08:00'); }");
    vm.runInContext(fixedClockDataSource, context);
    vm.runInContext(renderSource, context);
    vm.runInContext(`
        state.id = 'sh';
        state.mode = 'index';
        state.period = 'daily';
        var rows = [];
        for (var i = 1; i <= 35; i++) {
            var day = String(i).padStart(2, '0');
            rows.push({ date: '2026-05-' + day, open: 100 + i, high: 101 + i, low: 99 + i, close: 100 + i, vol: 1000 + i, amt: 10000 + i });
        }
        rows[rows.length - 1].date = '2026-06-30';
        setRawData('sh', rows);
        var item = state.rawData.sh[state.rawData.sh.length - 1];
        var statusHtml = renderDataStatusRefreshBadge(item, 'sh', state.rawData.sh);
    `, context);
    const result = JSON.parse(vm.runInContext(`JSON.stringify({
        confirmedStatus: state.confirmedStatus.sh,
        displayStatus: state.displayStatus.sh,
        statusHtml
    })`, context));
    assert.strictEqual(result.confirmedStatus.status, 'fresh');
    assert.strictEqual(result.confirmedStatus.lastDate, '2026-06-30');
    assert.strictEqual(result.displayStatus.mode, 'confirmed');
    assert.ok(result.statusHtml.includes('data-dg-confirmed-status="fresh"'), result.statusHtml);
    assert.ok(result.statusHtml.includes('data-dg-confirmed-date="2026-06-30"'), result.statusHtml);
});

runTest('stable records live under docs history after root cleanup', () => {
    const sortStableRecords = (a, b) => {
        const parse = name => {
            const match = name.match(/^STABLE_VERSION_(\d{4}-\d{2}-\d{2})(?:-(\d{2}))?\.md$/);
            return { date: match?.[1] || '', sequence: Number(match?.[2] || 0) };
        };
        const left = parse(a), right = parse(b);
        return left.date.localeCompare(right.date) || left.sequence - right.sequence;
    };
    const rootStableRecords = fs.readdirSync(root)
        .filter(name => /^STABLE_VERSION_\d{4}-\d{2}-\d{2}(?:-\d{2})?\.md$/.test(name))
        .sort(sortStableRecords);
    const historyRecords = fs.readdirSync(path.join(root, 'docs/history'))
        .filter(name => /^STABLE_VERSION_\d{4}-\d{2}-\d{2}(?:-\d{2})?\.md$/.test(name))
        .sort(sortStableRecords);
    const latestHistoryRecord = historyRecords[historyRecords.length - 1];

    assert.deepStrictEqual(rootStableRecords, [], 'root should not keep stable records after cleanup');
    assert.ok(latestHistoryRecord, 'docs/history should keep at least one stable record');
    assert.ok(fs.existsSync(path.join(root, 'docs/history', latestHistoryRecord)), 'latest stable record should be readable');
    assert.ok(fs.existsSync(path.join(root, 'CURRENT_STATUS.md')), 'current status entry should exist');
});

runTest('index empty quote placeholders carry the real data-code', () => {
    assert.ok(appSource.includes('data-code="${id}">${quoteDisplay.priceText}</span><span class="lchange mono ${quoteDisplay.cl}" data-code="${id}">${quoteDisplay.changeText}</span>'));
});

runTest('refresh timestamps are written after the matching UI data is applied', () => {
    assert.ok(!renderSource.includes('timeEl && (!timeEl.textContent'), 'status badge helper must not write the right-panel refresh timestamp');
    const initLeftRenderIdx = appSource.indexOf('    renderMASelector();\n    renderIndexList();');
    const initDefaultSelectIdx = appSource.indexOf("await _selectIndexImpl('sh');");
    const initHydrationIdx = appSource.indexOf('scheduleStartupBackgroundHydration();');
    assert.ok(initLeftRenderIdx > -1 && initLeftRenderIdx < initDefaultSelectIdx, 'startup should render the index left list before selecting the default right panel');
    assert.ok(initDefaultSelectIdx > -1 && initDefaultSelectIdx < initHydrationIdx, 'startup background hydration should wait until the default index selection is applied');
    assert.ok(dataSource.includes('draw();\n                safeUpdateSidebar();\n                markRefreshTime(rightTxn'), 'full right-panel render should mark refresh time after draw and sidebar apply');
    assert.ok(dataSource.includes('applyActiveDataRefresh(id);\n            markRefreshTime(rightTxn'), 'light active-data refresh should mark refresh time after active data apply');
    const firstLeftApplyIdx = dataSource.indexOf("renderActiveLeftListAfterDataApply(leftTxn, { id });");
    const firstRightApplyIdx = dataSource.indexOf("markRefreshTime(rightTxn, { path: 'restore-memory-chart', id });");
    assert.ok(firstLeftApplyIdx > -1 && firstLeftApplyIdx < firstRightApplyIdx, 'active cached data should commit the left-list snapshot before the right-panel snapshot');
    assert.ok(appSource.includes('renderWatchlist();\n            if (shouldMarkRefresh) markLeftListRefreshForActiveTab(refreshTxn'), 'scheduled stock list render should mark refresh time after DOM render');
    assert.ok(appSource.includes('refreshIndexListQuotes();') && appSource.includes('markLeftListRefreshForActiveTab(leftTxn'), 'realtime left-list quote refresh should mark time after quote DOM update');
    assert.ok(dataSource.includes('renderIndexList();\n            if (typeof markLeftListRefreshForActiveTab === \'function\') markLeftListRefreshForActiveTab(leftTxn'), 'background index list data refresh should mark after index list render');
    assert.ok(dataSource.includes('scheduleWatchlistRender({\n                markRefresh: true,\n                refreshTxn: beginRefreshTransaction'), 'background stock list data refresh should mark after scheduled stock list render');
});

runTest('refresh transaction snapshots expose independent left and right versions', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(`
        var leftTxn = beginRefreshTransaction('leftList', { source: 'test-left' });
        var rightTxn = beginRefreshTransaction('rightPanel', { source: 'test-right' });
        markLeftListRefreshTime(leftTxn, { rows: 4 });
        markRefreshTime(rightTxn, { id: 'sh' });
        var result = {
            left: state.refreshSnapshots.leftList,
            right: state.refreshSnapshots.rightPanel,
            leftText: getLeftListRefreshText(),
            rightText: document.getElementById('lastRefreshTime').textContent,
            leftDataset: document.querySelector('[data-left-list-refresh]')?.dataset || null,
            rightDataset: document.getElementById('lastRefreshBar').dataset
        };
    `, context);
    const result = JSON.parse(vm.runInContext('JSON.stringify(result)', context));
    assert.ok(result.left.id.startsWith('leftList-'), result.left.id);
    assert.ok(result.right.id.startsWith('rightPanel-'), result.right.id);
    assert.notStrictEqual(result.left.version, result.right.version);
    assert.ok(result.left.appliedAt >= result.left.startedAt);
    assert.ok(result.right.appliedAt >= result.right.startedAt);
    assert.ok(result.leftText.includes('列表刷新于'));
    assert.notStrictEqual(result.rightText, '--:--:--');
    assert.strictEqual(result.rightDataset.refreshId, result.right.id);
    assert.strictEqual(Number(result.rightDataset.refreshVersion), result.right.version);
});

runTest('ETF right price panel shows compact identity and three decimal OHLC prices', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(dataSource, context);
    vm.runInContext(appSourceNoInit, context);
    vm.runInContext(calcSource, context);
    vm.runInContext(renderSource, context);
    vm.runInContext(`
        var target = normalizeSecurityTarget({
            Code: '510300',
            Name: '沪深300ETF华泰柏瑞',
            QuoteID: '1.510300',
            Classify: 'Fund',
            SecurityTypeName: '基金'
        });
        state.mode = 'stock';
        state.id = target.secid;
        state.stockId = target.code;
        state.watchlist = [target];
        var bundle = generateSidebarBundle(
            { date: '2026-07-09', open: 4.813, high: 4.925, low: 4.777, close: 4.916, vol: 2000, amt: 20000, _decision: { position: 0, simpleAction: '持币观望' } },
            { date: '2026-07-08', close: 4.798 },
            1,
            [{ date: '2026-07-08' }, { date: '2026-07-09' }]
        );
        var priceHtml = bundle.priceHtml;
    `, context);
    const html = vm.runInContext('priceHtml', context);
    assert.ok(html.includes('title="沪深300ETF华泰柏瑞 · 510300"'), html);
    assert.ok(html.includes('沪深300ETF'), html);
    assert.ok(!html.includes('沪深300ETF</span><span class="text-dim" style="margin:0 6px;">·</span><span class="mono text-main">510300</span>'), html);
    assert.ok(html.includes('4.916'), html);
    assert.ok(html.includes('4.813'), html);
    assert.ok(html.includes('4.925'), html);
    assert.ok(html.includes('4.777'), html);
});

runTest('ETF right price panel keeps the header compact near date navigation', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(dataSource, context);
    vm.runInContext(appSourceNoInit, context);
    vm.runInContext(calcSource, context);
    vm.runInContext(renderSource, context);
    vm.runInContext(`
        var target = normalizeSecurityTarget({
            Code: '510300',
            Name: '沪深300ETF华泰柏瑞',
            QuoteID: '1.510300',
            Classify: 'Fund',
            SecurityTypeName: '基金'
        });
        state.mode = 'stock';
        state.id = target.secid;
        state.stockId = target.code;
        state.watchlist = [target];
        var bundle = generateSidebarBundle(
            { date: '2026-07-09', open: 4.813, high: 4.925, low: 4.777, close: 4.916, vol: 2000, amt: 20000, _decision: { position: 0, simpleAction: '持币观望' } },
            { date: '2026-07-08', close: 4.798 },
            1,
            [{ date: '2026-07-08' }, { date: '2026-07-09' }]
        );
        var priceHtml = bundle.priceHtml;
    `, context);
    const html = vm.runInContext('priceHtml', context);
    assert.ok(html.includes('2026-07-09'), html);
    assert.ok(html.includes('沪深300ETF'), html);
    assert.ok(html.includes('title="沪深300ETF华泰柏瑞 · 510300"'), html);
    assert.ok(!html.includes('沪深300ETF</span><span class="text-dim" style="margin:0 6px;">·</span><span class="mono text-main">510300</span>'), html);
});

runTest('data contract explains realtime terminology and UI scope', () => {
    assert.ok(dataContractSource.includes('## 术语说明'), 'data contract should expose a terminology section');
    assert.ok(dataContractSource.includes('`gate` / 准入检查'), 'gate should be explained in plain Chinese');
    assert.ok(dataContractSource.includes('能否进入图表和策略'), 'gate explanation should state the chart/strategy boundary');
    assert.ok(dataContractSource.includes('`quote-only` / 仅左侧报价'), 'quote-only should explain left-list-only realtime quotes');
    assert.ok(dataContractSource.includes('`live-overlay` / 盘中临时 K 线'), 'live-overlay should explain chart overlay semantics');
    assert.ok(dataContractSource.includes('`cached-live-overlay` / 缓存盘中 K 线'), 'cached live overlay should explain cached intraday semantics');
    assert.ok(dataContractSource.includes('`post-close-pending` / 盘后待确认'), 'post-close pending should explain after-close waiting semantics');
    assert.ok(dataContractSource.includes('`refresh transaction` / 刷新事务'), 'refresh transaction should be explained');
    assert.ok(dataContractSource.includes('`refresh snapshot` / 刷新快照版本'), 'refresh snapshot version should be explained');
    assert.ok(dataContractSource.includes('## 界面对应关系'), 'data contract should map terms to the user interface');
    assert.ok(dataContractSource.includes('左侧列表显示最新可用报价'), 'UI scope should define the left-list quote role');
    assert.ok(dataContractSource.includes('右侧面板解释当前图表、指标、策略和结论的数据口径'), 'UI scope should define the right-panel data role');
    assert.ok(dataContractSource.includes('数据状态提示统一放在右侧顶部刷新条'), 'UI scope should keep data status in the top refresh bar');
    assert.ok(dataContractSource.includes('结论卡片标题不重复显示数据状态标签'), 'UI scope should keep conclusion card titles free of duplicate data badges');
    assert.ok(dataContractSource.includes('左侧价格可能比右侧图表/策略更早更新'), 'UI scope should explain why left and right can update at different times');
    assert.ok(dataContractSource.includes('用户进入应用默认先到大盘页'), 'UI scope should explain the first-screen market-page load order');
    assert.ok(dataContractSource.includes('先提交 `leftList` 快照') && dataContractSource.includes('再提交 `rightPanel` 快照'), 'UI scope should document left-list snapshot before right-panel snapshot');
    assert.ok(dataContractSource.includes('状态徽章或提示文字单独渲染时不得推进刷新时间'), 'UI scope should bind refresh time to applied snapshots');
});

runTest('persistent storage failures degrade to memory mode without rejecting startup', async () => {
    assert.strictEqual(vm.runInContext('DB_OPEN_TIMEOUT_MS', (() => {
        const context = makeBrowserContext();
        vm.runInContext(configSource, context);
        vm.runInContext(dataSource, context);
        return context;
    })()), 3000);
    async function readStorageResult(indexedDBValue, expression = 'openDB({ timeoutMs: 5 })') {
        const context = makeBrowserContext({ indexedDB: indexedDBValue });
        vm.runInContext(configSource, context);
        vm.runInContext(dataSource, context);
        await vm.runInContext(`(async function() { storageResult = await ${expression}; })()`, context);
        return JSON.parse(vm.runInContext('JSON.stringify({ result: storageResult, runtime: window.__DG_STORAGE__, hasDB: !!DB })', context));
    }

    const missing = await readStorageResult(undefined);
    assert.strictEqual(missing.result.status, 'unavailable');
    assert.strictEqual(missing.runtime.persistent, false);
    assert.strictEqual(missing.hasDB, false);

    const thrown = await readStorageResult({ open() { throw new Error('denied'); } });
    assert.strictEqual(thrown.result.status, 'failed');
    assert.match(thrown.result.reason, /denied/);
    assert.strictEqual(thrown.hasDB, false);

    const blocked = await readStorageResult({
        open() {
            const request = {};
            setTimeout(() => request.onblocked(), 0);
            return request;
        }
    });
    assert.strictEqual(blocked.result.status, 'blocked');
    assert.match(blocked.result.reason, /占用/);

    const timedOut = await readStorageResult({ open() { return {}; } });
    assert.strictEqual(timedOut.result.status, 'failed');
    assert.match(timedOut.result.reason, /超时/);
});

runTest('database transaction failures disable persistence and keep reads and writes non-fatal', async () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(dataSource, context);
    await vm.runInContext(`
        (async function() {
            DB = { transaction: function() { throw new Error('transaction denied'); }, close: function() {} };
            setStorageCapability('available');
            failedRead = await dbGet('sh');
            DB = { transaction: function() { throw new Error('write denied'); }, close: function() {} };
            setStorageCapability('available');
            await dbSet('sh', []);
            transactionFailureResult = { failedRead, storage: { ...window.__DG_STORAGE__ }, hasDB: !!DB };
        })()
    `, context);
    const result = JSON.parse(vm.runInContext('JSON.stringify(transactionFailureResult)', context));
    assert.strictEqual(result.failedRead, null);
    assert.strictEqual(result.storage.status, 'failed');
    assert.strictEqual(result.storage.persistent, false);
    assert.strictEqual(result.hasDB, false);
});

runTest('leaving the external workspace cancels observation generations and rejects stale commits', async () => {
    const context = makeBrowserContext({ AbortController, DOMException });
    vm.runInContext(configSource, context);
    vm.runInContext(dataSource, context);
    vm.runInContext(`
        var pendingObservationResponses = [];
        fetch = function(url) {
            return new Promise(function(resolve) {
                pendingObservationResponses.push({ url: String(url), resolve: resolve });
            });
        };
        function resolveObservationRequests() {
            pendingObservationResponses.splice(0).forEach(function(entry) {
                var isLead = entry.url.includes('ulist.np');
                entry.resolve({
                    ok: true,
                    status: 200,
                    json: async function() {
                        return isLead
                            ? { rc: 0, data: { diff: [{ f12: 'SOXX', f2: 100, f3: 2.2, f4: 2, f124: 1780000000 }] } }
                            : { rc: 0, data: { total: 1, diff: [{ f12: 'BK1001', f14: '迟到板块', f3: 3.2, f24: 20, f109: 8, f160: 12, f104: 8, f105: 1, f106: 1, f124: 1780000000 }] } };
                    }
                });
            });
        }
        state.tab = 'external';
        state.mode = 'external';
        canRequestMarketData = function() { return true; };
        externalLeadStripState.cacheLoaded = true;
        sectorTrendState.cacheLoaded = true;
        externalLeadStripState.lastAttemptAt = 123;
        sectorTrendState.lastAttemptAt = 456;
        leadPromise = refreshExternalLeadStripSnapshot({ reason: 'test' });
        sectorPromise = refreshSectorTrendSnapshot({ reason: 'test' });
    `, context);
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.ok(vm.runInContext('pendingObservationResponses.length >= 3', context));
    vm.runInContext(`
        cancelRuntime = cancelExternalObservationTasks('workspace-leave');
        resolveObservationRequests();
    `, context);
    await vm.runInContext('Promise.all([leadPromise, sectorPromise])', context);
    const result = JSON.parse(vm.runInContext(`JSON.stringify({
        leadStatus: externalLeadStripState.status,
        sectorStatus: sectorTrendState.status,
        leadItems: Object.keys(externalLeadStripState.items),
        sectorBoards: sectorTrendState.boards.map(function(item) { return item.name; }),
        leadAttempt: externalLeadStripState.lastAttemptAt,
        sectorAttempt: sectorTrendState.lastAttemptAt,
        runtime: getExternalObservationRuntime()
    })`, context));
    assert.strictEqual(result.leadStatus, 'idle');
    assert.strictEqual(result.sectorStatus, 'idle');
    assert.deepStrictEqual(result.leadItems, []);
    assert.deepStrictEqual(result.sectorBoards, []);
    assert.strictEqual(result.leadAttempt, 123);
    assert.strictEqual(result.sectorAttempt, 456);
    assert.deepStrictEqual(result.runtime, {
        externalLeadGeneration: 2,
        sectorTrendGeneration: 2,
        externalLeadInFlight: false,
        sectorTrendInFlight: false,
        externalLeadController: false,
        sectorTrendController: false
    });
});
