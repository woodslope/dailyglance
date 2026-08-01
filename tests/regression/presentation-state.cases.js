runTest('regression suite exposes focused business group entrypoints', () => {
    const groups = ['data-cache', 'strategy-decision', 'presentation-state', 'chart-navigation', 'watchlist-lifecycle'];
    for (const group of groups) {
        assert.ok(fs.existsSync(path.join(root, 'tests', 'regression', `${group}.js`)), `missing regression group: ${group}`);
        const casesPath = path.join(root, 'tests', 'regression', `${group}.cases.js`);
        assert.ok(fs.existsSync(casesPath), `missing regression cases: ${group}`);
        assert.match(fs.readFileSync(casesPath, 'utf8'), /^runTest\(/m, `empty regression cases: ${group}`);
    }
});

runTest('external environment display stays a separate primary workspace with shared component language', () => {
    const externalTab = indexSource.indexOf('data-tab="external"');
    const indexTab = indexSource.indexOf('data-tab="index"');
    const stockTab = indexSource.indexOf('data-tab="stock"');
    assert.ok(externalTab >= 0 && externalTab < indexTab && indexTab < stockTab, 'primary navigation should be external, index, watchlist');
    assert.ok(indexSource.includes('id="marketWorkspace"'), 'A-share terminal should retain its own workspace owner');
    assert.ok(indexSource.includes('id="externalWorkspace"'), 'external context should have an independent workspace owner');
    assert.ok(indexSource.includes('本页外盘行情、主题映射和代表标的仅作只读观察，不参与大盘八指数、建仓门禁、仓位、B/S 或任何策略计算'), 'external boundary should be visible at the decision surface');
    assert.ok(indexSource.includes('待 A 股开盘确认'), 'external context should expose its open-confirmation boundary before the cards');
    assert.ok(indexSource.includes('最近一轮外部线索'), 'external summary should not imply asynchronous markets belong to the same trading day');
    assert.ok(indexSource.includes('id="externalLeadThemes"'), 'external workspace should expose a dedicated external-lead owner');
    assert.ok(indexSource.includes('隔夜主题映射'), 'external lead should have an explicit observation label');
    assert.ok(indexSource.includes('class="data-status-pill data-status-info"'), 'external status should reuse the shared status component');
    assert.ok(indexSource.includes('class="icon-btn icon-btn-label" onclick="handleExternalRefresh()"'), 'external refresh should reuse the shared labeled icon button');
    assert.ok(dataSource.includes("CACHE_KEY: 'dg_external_market_snapshot_v1'"), 'external snapshot should use an independent cache key');
    assert.ok(dataSource.includes("CACHE_KEY: 'dg_external_lead_snapshot_v1'"), 'external lead should use its own independent cache key');
    assert.ok(dataSource.includes("state.tab !== 'external' || document.hidden"), 'inactive or hidden external workspace must not request data');
    assert.ok(!configSource.includes('100.SPX') && !configSource.includes('133.USDCNH'), 'external symbols must not enter core strategy configuration');
});

runTest('external environment display renders three contexts and five quotes without a unified trading score', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(dataSource, context);
    vm.runInContext(appSourceNoInit, context);
    vm.runInContext(`
        state.tab = 'external';
        state.mode = 'external';
        externalMarketState.status = 'partial';
        externalMarketState.source = '东方财富 + 腾讯';
        externalMarketState.fetchedAt = 1780000000000;
        externalMarketState.items = {
            spx: sanitizeExternalMarketItem('spx', { value: 6200, changePct: 0.4, change: 24, quoteAt: 1780000000000, source: '腾讯' }),
            ndx: sanitizeExternalMarketItem('ndx', { value: 22000, changePct: -0.2, change: -44, quoteAt: 1780000000000, source: '腾讯' }),
            hstech: sanitizeExternalMarketItem('hstech', { value: 5100, changePct: -0.3, change: -15, quoteAt: 1780000000000, source: '东方财富' }),
            a50: sanitizeExternalMarketItem('a50', { value: 14200, changePct: -0.1, change: -14, quoteAt: 1770000000000, source: '东方财富', stale: true }),
            usdcnh: sanitizeExternalMarketItem('usdcnh', { value: 7.12, changePct: 0.2, change: 0.014, quoteAt: 1780000000000, source: '东方财富' })
        };
        renderExternalMarketSnapshot();
        var externalDisplayResult = {
            summaries: document.getElementById('externalEnvironmentSummary').innerHTML,
            quotes: document.getElementById('externalMarketQuotes').innerHTML,
            meta: document.getElementById('externalSnapshotMeta').textContent
        };
    `, context);
    const result = JSON.parse(vm.runInContext('JSON.stringify(externalDisplayResult)', context));
    assert.strictEqual((result.summaries.match(/external-context-card/g) || []).length, 3);
    assert.ok(result.summaries.includes('全球风险偏好'));
    assert.ok(result.summaries.includes('中国资产情绪'));
    assert.ok(result.summaries.includes('汇率压力'));
    assert.ok(result.summaries.indexOf('中国资产情绪') < result.summaries.indexOf('全球风险偏好'), 'A-share readers should see China-asset context before global risk context');
    assert.match(result.summaries, /（\d{2}\/\d{2}）/, 'summary factors should expose the quote date');
    assert.strictEqual((result.quotes.match(/external-quote-card/g) || []).length, 5);
    assert.ok(result.quotes.includes('external-cache-tag'), 'cached quote should be visibly marked');
    assert.ok(result.quotes.indexOf('恒生科技') < result.quotes.indexOf('A50期指'));
    assert.ok(result.quotes.indexOf('A50期指') < result.quotes.indexOf('标普500'));
    assert.ok(result.quotes.indexOf('标普500') < result.quotes.indexOf('纳斯达克'));
    assert.ok(result.quotes.indexOf('纳斯达克') < result.quotes.indexOf('美元兑离岸人民币'));
    assert.match(result.quotes, /行情 \d{2}\/\d{2} \d{2}:\d{2}/, 'quote cards should expose date and time instead of time alone');
    assert.ok(result.meta.includes('东方财富 + 腾讯'));
    assert.ok(result.meta.startsWith('本页更新 '));
    assert.ok(!result.summaries.includes('交易评分') && !result.summaries.includes('建议仓位'));
});

runTest('external lead display exposes overnight evidence, A-share mappings and open confirmation without a trading conclusion', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(dataSource, context);
    vm.runInContext(appSourceNoInit, context);
    vm.runInContext(`
        state.tab = 'external';
        state.mode = 'external';
        externalLeadState.status = 'cached';
        externalLeadState.source = '东方财富';
        externalLeadState.fetchedAt = 1780000000000;
        externalLeadState.items = {
            soxx: sanitizeExternalLeadItem('soxx', { value: 500, changePct: 3.0, change: 14.5, quoteAt: 1780000000000, source: '东方财富', stale: true }),
            smh: sanitizeExternalLeadItem('smh', { value: 530, changePct: 2.4, change: 12.4, quoteAt: 1780000000000, source: '东方财富' }),
            nvda: sanitizeExternalLeadItem('nvda', { value: 185, changePct: 2.2, change: 4, quoteAt: 1780000000000, source: '东方财富' }),
            amd: sanitizeExternalLeadItem('amd', { value: 165, changePct: 1.6, change: 2.6, quoteAt: 1780000000000, source: '东方财富' }),
            qqq: sanitizeExternalLeadItem('qqq', { value: 680, changePct: 0.8, change: 5.4, quoteAt: 1780000000000, source: '东方财富' }),
            msft: sanitizeExternalLeadItem('msft', { value: 445, changePct: 0.9, change: 4, quoteAt: 1780000000000, source: '东方财富' }),
            tsla: sanitizeExternalLeadItem('tsla', { value: 305, changePct: 1.8, change: 5.4, quoteAt: 1780000000000, source: '东方财富' })
        };
        externalLeadState.themes = buildExternalLeadThemes(externalLeadState.items);
        renderExternalLeadSnapshot();
        var externalLeadDisplayResult = {
            cards: document.getElementById('externalLeadThemes').innerHTML,
            meta: document.getElementById('externalLeadMeta').textContent,
            states: externalLeadState.themes.map(theme => theme.state),
            emptyStates: buildExternalLeadThemes({}).map(theme => theme.state)
        };
    `, context);
    const result = JSON.parse(vm.runInContext('JSON.stringify(externalLeadDisplayResult)', context));
    assert.strictEqual((result.cards.match(/external-lead-card/g) || []).length, 3);
    assert.ok(result.cards.includes('半导体与算力'));
    assert.ok(result.cards.includes('SOXX +3.00%'));
    assert.deepStrictEqual(result.states, ['隔夜偏强', '隔夜分化', '隔夜偏强']);
    assert.ok(result.emptyStates.every(state => state === '信息不完整'));
    assert.ok(result.cards.includes('A 股可观察概念'));
    assert.ok(result.cards.includes('北方华创'));
    assert.ok(result.cards.includes('002371'));
    assert.ok(result.cards.includes('待 A 股开盘确认'));
    assert.ok(result.cards.includes('external-cache-tag'), 'cached external evidence should be visibly marked');
    assert.ok(result.meta.includes('7/8 项外盘证据'));
    assert.ok(!result.cards.includes('selectStock('), 'candidate stocks must stay read-only');
    assert.ok(!result.cards.includes('交易评分') && !result.cards.includes('建议仓位'));
});

runTest('external workspace status preserves partial availability and combines source errors', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(dataSource, context);
    vm.runInContext(appSourceNoInit, context);
    const result = JSON.parse(vm.runInContext(`JSON.stringify((function() {
        externalMarketState.status = 'ready';
        externalMarketState.error = '';
        externalLeadState.status = 'ready';
        externalLeadState.error = '';
        const bothReady = getExternalWorkspaceSnapshotStatus();

        externalLeadState.status = 'cached';
        const readyAndCached = getExternalWorkspaceSnapshotStatus();

        externalLeadState.status = 'error';
        externalLeadState.error = '隔夜主题行情请求超时';
        const readyAndError = getExternalWorkspaceSnapshotStatus();

        externalMarketState.status = 'partial';
        externalMarketState.error = '有 2 项外部环境行情暂未更新';
        const partialAndError = getExternalWorkspaceSnapshotStatus();

        externalMarketState.status = 'error';
        externalMarketState.error = '主行情请求超时';
        const bothError = getExternalWorkspaceSnapshotStatus();
        return { bothReady, readyAndCached, readyAndError, partialAndError, bothError };
    })())`, context));

    assert.deepStrictEqual(result.bothReady, { key: 'ready', error: '' });
    assert.deepStrictEqual(result.readyAndCached, {
        key: 'partial',
        error: '部分外部快照尚未更新'
    });
    assert.deepStrictEqual(result.readyAndError, {
        key: 'partial',
        error: '隔夜主题行情请求超时'
    });
    assert.deepStrictEqual(result.partialAndError, {
        key: 'partial',
        error: '有 2 项外部环境行情暂未更新；隔夜主题行情请求超时'
    });
    assert.deepStrictEqual(result.bothError, {
        key: 'error',
        error: '主行情请求超时；隔夜主题行情请求超时'
    });
});

runTest('key application state changes use focused write entrypoints', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(`
        applyActiveSelectionState({ tab: 'stock', mode: 'stock', id: '0.002594', stockId: '002594' });
        var stockState = { tab: state.tab, mode: state.mode, id: state.id, stockId: state.stockId, isFrozen: state.isFrozen };
        applyPeriodState('weekly');
        applyHistoryNavigationState({ lockIdx: 12, isFrozen: true });
        var historyState = { period: state.period, lockIdx: state.lockIdx, isFrozen: state.isFrozen };
        applyActiveSelectionState({ tab: 'index', mode: 'index', id: 'sh', stockId: null });
        var indexState = { tab: state.tab, mode: state.mode, id: state.id, stockId: state.stockId, isFrozen: state.isFrozen };
    `, context);
    const states = JSON.parse(vm.runInContext('JSON.stringify([stockState, historyState, indexState])', context));
    assert.deepStrictEqual(states[0], { tab: 'stock', mode: 'stock', id: '0.002594', stockId: '002594', isFrozen: false });
    assert.deepStrictEqual(states[1], { period: 'weekly', lockIdx: 12, isFrozen: true });
    assert.deepStrictEqual(states[2], { tab: 'index', mode: 'index', id: 'sh', stockId: null, isFrozen: false });
});

runTest('performance panel separates interaction traces from background sync traces', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(appSourceNoInit, context);
    vm.runInContext(`
        window.__DG_PERF__.traces = [
            { label: 'selectStock', total: 12.2, meta: { id: '601162' }, steps: [{ step: 'render', duration: 8.1 }] },
            { label: 'draw', total: 21.5, meta: { scope: 'daily' }, steps: [] },
            { label: 'cachedFetchRefresh', total: 389.3, meta: { status: 'unchanged' }, steps: [{ step: 'syncData', duration: 382.7 }] },
            { label: 'cachedFetchRefreshApply', total: 18.4, meta: { path: 'same-day-light', status: 'applied' }, steps: [] }
        ];
        renderPerfPanel();
    `, context);
    const html = vm.runInContext('document.getElementById("perfPanel").innerHTML', context);
    assert.match(html, /交互手感/);
    assert.match(html, /后台同步/);
    assert.match(html, /网络等待/);
    assert.ok(html.indexOf('selectStock') > html.indexOf('交互手感'));
    assert.ok(html.indexOf('cachedFetchRefresh') > html.indexOf('后台同步'));
});

runTest('performance monitor records long tasks for diagnostics', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(`
        window.__DG_PERF__.recordLongTask({ name: 'self', startTime: 12.34, duration: 76.54 });
        var longTasks = window.__DG_PERF__.longTasks;
    `, context);
    const longTasks = JSON.parse(vm.runInContext('JSON.stringify(longTasks)', context));
    assert.deepStrictEqual(longTasks, [
        { name: 'self', startTime: 12.3, duration: 76.5 }
    ]);
});

runTest('performance traces expose browser-timeline bounds for long-task correlation', () => {
    let clock = 10;
    const context = makeBrowserContext({ performance: { now: () => clock } });
    vm.runInContext(configSource, context);
    vm.runInContext(`var trace = window.__DG_PERF__.start('startup');`, context);
    clock = 30;
    vm.runInContext(`window.__DG_PERF__.mark(trace, 'middle');`, context);
    clock = 50;
    const entry = JSON.parse(vm.runInContext(`JSON.stringify(window.__DG_PERF__.end(trace))`, context));
    assert.strictEqual(entry.startTime, 10);
    assert.strictEqual(entry.endTime, 50);
    assert.strictEqual(entry.total, 40);
});

runTest('performance panel shows long task diagnostics', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(appSourceNoInit, context);
    vm.runInContext(`
        window.__DG_PERF__.recordLongTask({ name: 'self', startTime: 12.34, duration: 76.54 });
        renderPerfPanel();
    `, context);
    const html = vm.runInContext('document.getElementById("perfPanel").innerHTML', context);
    assert.match(html, /长任务/);
    assert.match(html, /76.5ms/);
});

runTest('right panel data status bar becomes visible when a status badge is available', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(dataSource, context);
    vm.runInContext(renderSource, context);
    vm.runInContext(`
        state.id = 'sh';
        state.mode = 'index';
        state.period = 'daily';
        state.rawData.sh = [
            { date: '2026-07-08', open: 3996.81, high: 4016.03, low: 3967.91, close: 3970.88, vol: 1000, amt: 10000 }
        ];
        state.confirmedStatus.sh = { status: 'fresh', lastDate: '2026-07-08' };
        state.displayStatus.sh = { mode: 'confirmed' };
        var bar = document.getElementById('lastRefreshBar');
        var time = document.getElementById('lastRefreshTime');
        bar.style.display = 'none';
        time.textContent = '--:--:--';
        updateDataStatusRefreshBadge(state.rawData.sh[0], 'sh', state.rawData.sh);
        var timeAfterBadge = time.textContent;
        markRefreshTime();
        var result = {
            barDisplay: bar.style.display,
            timeText: time.textContent,
            timeAfterBadge,
            barHtml: bar.innerHTML
        };
    `, context);
    const result = JSON.parse(vm.runInContext('JSON.stringify(result)', context));
    assert.strictEqual(result.barDisplay, 'flex');
    assert.strictEqual(result.timeAfterBadge, '--:--:--', 'status badge rendering should not mutate the authoritative refresh timestamp');
    assert.notStrictEqual(result.timeText, '--:--:--');
    assert.ok(result.barHtml.includes('收盘确认'), result.barHtml);
    assert.ok(result.barHtml.includes('data-tooltip="按确认历史计算。"'), result.barHtml);
    assert.ok(!indexSource.includes('class="refresh-dot"'), 'refresh bar should not show a second status dot before the timestamp');
    assert.ok(indexSource.includes('图表及右侧刷新于 <span id="lastRefreshTime">'), 'refresh timestamp should clearly scope the updated area');
    assert.ok(indexSource.includes('class="text-dim mono refresh-time-text"'), 'refresh timestamp should remain visible as lightweight meta text');
    assert.ok(cssSource.includes('.refresh-bar { display: flex; align-items: center; gap: var(--space-2); padding: 0; background: transparent; border: none;'), 'refresh bar should not render an outer card frame');
});

runTest('performance budget script covers fixed interaction scenarios', () => {
    const scriptSource = read('scripts/performance-budget.js');
    assert.ok(scriptSource.includes('EXPECTED_RESOURCE_VERSION'), 'performance budget should assert the current deployed resource version');
    assert.ok(scriptSource.includes('PERFORMANCE_BUDGETS'), 'performance budget should keep named threshold budgets');
    assert.ok(scriptSource.includes('PROFILE_SCENARIOS'), 'performance budget should separate warm and cold profiles');
    assert.ok(scriptSource.includes('--profile'), 'performance budget should expose a profile selector');
    assert.ok(scriptSource.includes('waitForExternalScriptsToSettle'), 'performance budget should drain warm-up JSONP before interaction measurement');
    assert.ok(scriptSource.includes("route.abort('blockedbyclient')"), 'performance budget should isolate interaction measurement from external network callbacks');
    assert.ok(scriptSource.includes('select-stock'), 'performance budget should cover stock selection');
    assert.ok(scriptSource.includes('select-index'), 'performance budget should cover index selection');
    assert.ok(scriptSource.includes("'switch-strategy-first'"), 'performance budget should cover the first strategy switch');
    assert.ok(scriptSource.includes("'switch-strategy-repeat'"), 'performance budget should cover the repeated strategy switch');
    assert.ok(scriptSource.includes('drag-history'), 'performance budget should cover chart drag into history');
    assert.ok(scriptSource.includes('restore-latest'), 'performance budget should cover restoring latest view');
    assert.ok(scriptSource.includes('background-refresh-during-click'), 'performance budget should cover clicking during background refresh');
    assert.ok(scriptSource.includes('p95'), 'performance budget should report p95 latency');
    assert.ok(scriptSource.includes('longTasks'), 'performance budget should collect long task observations');
    assert.ok(scriptSource.includes('scenarioStart') && scriptSource.includes('scenarioEnd'), 'performance budget should filter delayed long-task entries by the active scenario window');
    assert.ok(scriptSource.includes('actionDuration') && scriptSource.includes('observationDuration'), 'performance budget should separate action latency from the observation window');
    assert.ok(scriptSource.includes('observationLongTasks'), 'performance budget should retain post-action long tasks as separate diagnostic evidence');
    assert.ok(scriptSource.includes("traceLabel: 'startup'"), 'cold performance reporting should expose the startup trace');
    assert.ok(scriptSource.includes('startupTraces'), 'cold performance reporting should expose nested startup traces');
    assert.ok(scriptSource.includes('longTaskTraceMatches'), 'cold performance reporting should correlate long tasks with overlapping traces');
    assert.ok(!scriptSource.includes('fonts.googleapis') && !scriptSource.includes('fonts.gstatic'), 'performance budget should not depend on external font loading');
    assert.ok(scriptSource.includes('JSON.stringify'), 'performance budget should print machine-readable JSON');
});

runTest('stock cold performance profile waits for a complete first stock experience in fresh contexts', () => {
    const scriptSource = read('scripts/performance-budget.js');
    assert.ok(scriptSource.includes("'stock-cold': ['stock-first-load']"), 'performance budget should expose a dedicated stock cold profile');
    assert.ok(scriptSource.includes("'stock-first-load': {"), 'stock cold should have an explicit performance budget');
    assert.ok(scriptSource.includes('runStockColdProfile'), 'stock cold should run through a dedicated fresh-context path');
    assert.ok(scriptSource.includes('browser.newContext'), 'each stock cold sample should use a fresh browser context');
    assert.ok(scriptSource.includes('collectStockExperience'), 'stock cold should collect user-visible completeness evidence');
    ['cardAnalysisHasConclusion', 'priceIdentity', 'refreshBadge', 'canvasScopes'].forEach(field => {
        assert.ok(scriptSource.includes(field), `stock cold experience should expose ${field}`);
    });
    assert.ok(scriptSource.includes('experienceOk'), 'stock cold completeness should participate in the final pass/fail result');
});

runTest('default cold performance profile repeats fresh contexts and records host load', () => {
    const scriptSource = read('scripts/performance-budget.js');
    assert.ok(scriptSource.includes("const os = require('os');"), 'cold performance reporting should read portable host load data');
    assert.ok(scriptSource.includes('runColdProfile'), 'default cold should run through a dedicated multi-context path');
    assert.ok(scriptSource.includes("{ profile: 'cold', run: runIndex + 1 }"), 'each default cold sample should identify its independent run');
    assert.ok(scriptSource.includes('readSystemLoadSnapshot'), 'cold runs should capture host load before and after measurement');
    assert.ok(scriptSource.includes('cpuUtilizationPct'), 'cold samples should report CPU utilization during the measurement');
    assert.ok(scriptSource.includes('load1PerCpu'), 'cold samples should report normalized one-minute host load');
    assert.ok(scriptSource.includes('systemLoad: {'), 'scenario summaries should aggregate system load evidence');
    assert.ok(scriptSource.includes("PROFILE_SCENARIOS[profile].includes('first-load')"), 'default cold samples should be collected independently from warm scenarios');
});

runTest('warm interaction samples record host load around each measured scenario', () => {
    const scriptSource = read('scripts/performance-budget.js');
    assert.ok(scriptSource.includes('const scenarioLoadBefore = readSystemLoadSnapshot();'), 'interaction measurement should snapshot host load before the action');
    assert.ok(scriptSource.includes('systemLoad: buildSystemLoad(scenarioLoadBefore, readSystemLoadSnapshot())'), 'interaction samples should include host load for diagnosis');
});

runTest('startup performance trace separates the main initialization phases', () => {
    assert.ok(appSource.includes("PERF.start('startup'"), 'startup should open a dedicated performance trace');
    ['open-db', 'load-watchlist', 'load-stock-cache', 'prepare-ui', 'initial-selection'].forEach(step => {
        assert.ok(appSource.includes(`PERF.mark(startupPerf, '${step}')`), `startup trace should include ${step}`);
    });
    assert.ok(appSource.includes("PERF.end(startupPerf, { path: 'initial-index-ready' })"), 'startup trace should finish after the initial index is ready');
});

runTest('cached fetch trace separates active data indicators and first-paint scheduling', () => {
    ['active-data', 'indicators', 'left-list', 'schedule-draw'].forEach(step => {
        assert.ok(dataSource.includes(`PERF.mark(perfTrace, '${step}'`), `cachedFetch trace should include ${step}`);
    });
});

runTest('indicator rebuild trace separates base calculations signals decisions and cache storage', () => {
    assert.ok(calcSource.includes("PERF.start('updateAllIndicators'"), 'indicator rebuild should open a dedicated trace');
    ['base-indicators', 'decision-loop', 'cache-store'].forEach(step => {
        assert.ok(calcSource.includes(`PERF.mark(perfTrace, '${step}'`), `indicator rebuild trace should include ${step}`);
    });
    ['signalMs', 'decisionMs', 'reusedRows'].forEach(field => {
        assert.ok(calcSource.includes(field), `indicator rebuild trace should expose ${field}`);
    });
});

runTest('daily signal trace aggregates context and per-rule performance without changing rule order', () => {
    assert.ok(calcSource.includes('function calculateDailySignals(idx, full, ind, perfStats = null, weeklyContext = null)'), 'daily signal calculation should accept optional performance stats and weekly context');
    ['contextMs', 'ruleMs', 'ruleChecks', 'ruleHits'].forEach(field => {
        assert.ok(calcSource.includes(field), `daily signal trace should expose ${field}`);
    });
    assert.ok(calcSource.includes('calculateDailySignals(i, full, state.indicators, signalBreakdown, weeklySignalContexts?.[i] || null)'), 'full indicator rebuild should collect daily signal breakdown with precomputed weekly context');
});

runTest('indicator key changes when historical bars are revised before the latest close', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(dataSource, context);
    vm.runInContext(calcSource, context);
    vm.runInContext(`
        state.id = 'sh';
        state.period = 'daily';
        state.strategy = '稳健趋势型';
        var base = Array.from({ length: 80 }, (_, i) => ({
            date: '2026-02-' + String(i + 1).padStart(2, '0'),
            open: 100 + i,
            high: 101 + i,
            low: 99 + i,
            close: 100 + i,
            vol: 1000 + i,
            amt: 100000 + i
        }));
        var revised = base.map(item => ({ ...item }));
        revised[20].high += 8;
        revised[20].vol += 5000;
        state.rawData.sh = base;
        var keyA = getIndicatorKey(base);
        state.rawData.sh = revised;
        var keyB = getIndicatorKey(revised);
    `, context);
    assert.notStrictEqual(vm.runInContext('keyA', context), vm.runInContext('keyB', context));
});

runTest('index list keeps data freshness status out of left navigation rows', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    const fixedClockDataSource = dataSource
        .replace(/function getBJDate\(\) \{ return new Date\(new Date\(\)\.toLocaleString\("en-US", \{timeZone: "Asia\/Shanghai"\}\)\); \}/, "function getBJDate() { return new Date('2026-06-30T10:30:00+08:00'); }");
    vm.runInContext(fixedClockDataSource, context);
    vm.runInContext(appSourceNoInit, context);
    vm.runInContext(`
        updateLeftMarketContext = function() {};
        var freshRows = Array.from({ length: 61 }, function(_, i) {
            var close = 100 + i;
            return {
                date: i === 60 ? '2026-06-29' : '2026-04-' + String((i % 28) + 1).padStart(2, '0'),
                open: close - 0.5,
                high: close + 1,
                low: close - 1,
                close,
                vol: 1000 + i,
                amt: 10000 + i
            };
        });
        var staleRows = freshRows.map(function(row, i) {
            return { ...row, date: i === 60 ? '2026-06-26' : row.date, close: row.close + 100 };
        });
        setRawData('sh', freshRows.map(function(row) { return { ...row }; }));
        setConfirmedStatus('sh', { source: 'eastmoney', status: 'fresh', lastDate: '2026-06-29' });
        setRawData('cy', staleRows.map(function(row) { return { ...row }; }));
        setLiveQuote('cy', { date: '2026-06-30', open: 220, high: 226, low: 218, close: 225, prevClose: 222, vol: 2000, amt: 20000 }, 'quote-only', 'confirmed-history-stale');
        setRawData('zz1000', staleRows.map(function(row) { return { ...row, close: row.close + 100 }; }));
        setConfirmedStatus('zz1000', { source: 'cache', status: 'stale', lastDate: '2026-06-26' });
        setRawData('kc50', freshRows.map(function(row) { return { ...row, close: row.close + 200 }; }));
        setLiveBar('kc50', { date: '2026-06-30', open: 360, high: 366, low: 358, close: 365, prevClose: 360, vol: 3000, amt: 30000 });
        state.id = 'sh';
        state.mode = 'index';
        renderIndexList();
        var html = document.getElementById('indexNavList').innerHTML;
    `, context);
    const html = vm.runInContext('html', context);
    assert.ok(!html.includes('data-dg-left-status'), html);
    assert.ok(!html.includes('index-data-status'), html);
    assert.ok(html.includes('data-code="sh"'), html);
    assert.ok(html.includes('data-code="cy"'), html);
    assert.ok(html.includes('data-code="zz1000"'), html);
    assert.ok(html.includes('data-code="kc50"'), html);
});

runTest('right price panel identity shows one visible label for stock and index', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(dataSource, context);
    vm.runInContext(appSourceNoInit, context);
    vm.runInContext(calcSource, context);
    vm.runInContext(renderSource, context);
    vm.runInContext(`
        state.mode = 'stock';
        state.id = '1.601162';
        state.stockId = '601162';
        state.watchlist = [{ code: '601162', name: '天风证券', secid: '1.601162', type: 'stock', tencentSymbol: 'sh601162' }];
        var stockBundle = generateSidebarBundle(
            { date: '2026-07-09', open: 3.75, high: 3.85, low: 3.70, close: 3.80, vol: 2000, amt: 20000, _decision: { position: 0, simpleAction: '持币观望' } },
            { date: '2026-07-08', close: 3.64 },
            1,
            [{ date: '2026-07-08' }, { date: '2026-07-09' }]
        );
        state.mode = 'index';
        state.id = 'sh';
        state.stockId = null;
        state.watchlist = [];
        var indexBundle = generateSidebarBundle(
            { date: '2026-07-09', open: 3977.55, high: 4040.54, low: 3938.88, close: 4036.59, vol: 2000, amt: 20000, _decision: { position: 0, simpleAction: '持币观望' } },
            { date: '2026-07-08', close: 3970.88 },
            1,
            [{ date: '2026-07-08' }, { date: '2026-07-09' }]
        );
    `, context);
    const stockHtml = vm.runInContext('stockBundle.priceHtml', context);
    const indexHtml = vm.runInContext('indexBundle.priceHtml', context);
    assert.ok(stockHtml.includes('title="天风证券 · 601162"'), stockHtml);
    assert.ok(stockHtml.includes('>天风证券</span>'), stockHtml);
    assert.ok(!stockHtml.includes('>天风证券 · 601162</span>'), stockHtml);
    assert.ok(indexHtml.includes('title="上证指数 · SH000001"'), indexHtml);
    assert.ok(indexHtml.includes('>上证指数</span>'), indexHtml);
    assert.ok(!indexHtml.includes('>上证指数 · SH000001</span>'), indexHtml);
});

runTest('right panel computes temporary live conclusion instead of showing analysis pending', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(dataSource, context);
    vm.runInContext(calcSource, context);
    vm.runInContext(renderSource, context);
    vm.runInContext(`
        state.mode = 'stock';
        state.id = '1.600197';
        state.stockId = '600197';
        state.strategy = '稳健趋势型';
        state.period = 'daily';
        state.rawData['1.600197'] = Array.from({ length: 65 }, (_, i) => {
            const close = 12 - i * 0.03;
            return {
                date: '2026-04-' + String(i + 1).padStart(2, '0'),
                open: close + 0.02,
                high: close + 0.08,
                low: close - 0.08,
                close,
                vol: 10000 + i * 100,
                amt: close * (10000 + i * 100)
            };
        });
        state.weeklyData['1.600197'] = convertDailyToWeekly(state.rawData['1.600197']);
        state.liveBars['1.600197'] = {
            date: '2026-07-03',
            open: 9.94,
            high: 10.13,
            low: 9.93,
            close: 10.04,
            prevClose: 9.93,
            vol: 15400,
            amt: 1547,
            _isLive: true,
            _isCachedLive: true
        };
        state.displayStatus['1.600197'] = { mode: 'cached-live-overlay', reason: '短TTL缓存盘中', quoteDate: '2026-07-03', cacheAgeMs: 0 };
        state.confirmedStatus['1.600197'] = { status: 'fresh', lastDate: '2026-07-02' };
        resetViewportToLatest(getActiveData());
        setLockIdx(getActiveData().length - 1);
        safeUpdateSidebar();
        var latest = getActiveData().slice(-1)[0];
        var analysisHtml = document.getElementById('cardAnalysis').innerHTML;
        var result = {
            latestDecision: latest._decision || null,
            analysisHtml
        };
    `, context);
    const result = vm.runInContext('result', context);
    assert.ok(result.latestDecision, 'cached live row should get a temporary decision before right panel render');
    assert.ok(result.analysisHtml.includes('个股每日结论'), 'right panel should render the actual stock conclusion');
    assert.ok(!result.analysisHtml.includes('分析同步中'), 'right panel should not expose the pending fallback for valid cached live data');
});

runTest('wave B quality stays hidden in production shadow while explicit research states remain testable', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext('function convertDailyToWeekly() { return []; }', context);
    vm.runInContext(calcSource, context);
    vm.runInContext(`
        state.strategy = '波段抄底型';
        state.mode = 'stock';
        var standardQuality = getWaveBQualityMetadata({ windowScoreSignals: [{ signal: 'B9' }] }, { bsMark: 'B' });
        var strongDecision = { bsMark: 'B', position: 30, simpleAction: '轻仓建仓' };
        var configuredTrialQuality = getWaveBQualityMetadata({ windowScoreSignals: [{ signal: 'B8' }, { signal: 'B17' }] }, strongDecision);
        var shadowRuleset = {
            status: 'shadow',
            rules: [{
                id: 'test-wave-b-quality-b8-b17',
                requiredSignals: ['B8', 'B17'],
                reasons: ['KDJ 金叉确认短期动量修复', '超跌止跌反弹确认修复形态']
            }]
        };
        var shadowQuality = getWaveBQualityMetadata({ windowScoreSignals: [{ signal: 'B8' }, { signal: 'B17' }] }, strongDecision, shadowRuleset);
        var trialRuleset = {
            status: 'trial',
            sourceRuleId: 'wave-b-quality-20260730-02-b8-b17',
            rules: [{
                id: 'test-wave-b-quality-b8-b17',
                requiredSignals: ['B8', 'B17'],
                reasons: ['KDJ 金叉确认短期动量修复', '超跌止跌反弹确认修复形态']
            }]
        };
        var trialQuality = getWaveBQualityMetadata({ windowScoreSignals: [{ signal: 'B8' }, { signal: 'B17' }] }, strongDecision, trialRuleset);
        var approvedRuleset = {
            status: 'approved',
            rules: [{
                id: 'test-wave-b-quality-b8-b17',
                requiredSignals: ['B8', 'B17'],
                reasons: ['KDJ 金叉确认短期动量修复', '超跌止跌反弹确认修复形态']
            }]
        };
        var strongQuality = getWaveBQualityMetadata({ windowScoreSignals: [{ signal: 'B8' }, { signal: 'B17' }] }, strongDecision, approvedRuleset);
        var expiredB8Quality = getWaveBQualityMetadata({
            windowSignals: [{ signal: 'B8' }, { signal: 'B17' }],
            windowScoreSignals: [{ signal: 'B17' }]
        }, { bsMark: 'B' }, trialRuleset);
        state.mode = 'index';
        var indexQuality = getWaveBQualityMetadata({ windowScoreSignals: [{ signal: 'B8' }, { signal: 'B17' }] }, { bsMark: 'B' }, trialRuleset);
        state.strategy = '稳健趋势型';
        var unrelatedQuality = getWaveBQualityMetadata({ windowSignals: [{ signal: 'B9' }] }, { bsMark: 'B' });
        var trialSummary = getNoviceDecisionSummary({ windowScore: 4, warningSignals: [], exitSignals: [], buySignals: ['B9'], allSignals: {}, windowSignals: [], inCooldown: false }, {
            position: 30, prevAdv: 0, bsMark: 'B', bQuality: 'trial',
            bQualityReasons: ['KDJ 金叉确认短期动量修复', '超跌止跌反弹确认修复形态'],
            simpleAction: '轻仓建仓', market: { label: '核心宽基分化' },
            risk: { level: '低波动/偏离', score: 80, flags: [], stop: 10, pressure: 12 },
            exit: { level: '无明确离场' }, signalReady: true
        });
        var strongSummary = getNoviceDecisionSummary({ windowScore: 4, warningSignals: [], exitSignals: [], buySignals: ['B9'], allSignals: {}, windowSignals: [], inCooldown: false }, {
            position: 30, prevAdv: 0, bsMark: 'B', bQuality: 'strong',
            bQualityReasons: ['MACD底背离确认', '周线支撑共同确认'],
            simpleAction: '轻仓建仓', market: { label: '核心宽基分化' },
            risk: { level: '低波动/偏离', score: 80, flags: [], stop: 10, pressure: 12 },
            exit: { level: '无明确离场' }, signalReady: true
        });
    `, context);
    assert.deepStrictEqual(JSON.parse(vm.runInContext('JSON.stringify(standardQuality)', context)), {
        bQuality: 'standard', bQualityReasons: [], bQualityRuleId: null
    });
    assert.deepStrictEqual(JSON.parse(vm.runInContext('JSON.stringify(configuredTrialQuality)', context)), {
        bQuality: 'standard', bQualityReasons: [], bQualityRuleId: null
    }, 'the configured B8+B17 ruleset stays shadow and is hidden by default');
    assert.deepStrictEqual(JSON.parse(vm.runInContext('JSON.stringify(shadowQuality)', context)), {
        bQuality: 'standard', bQualityReasons: [], bQualityRuleId: null
    }, 'shadow candidates must not change the user-visible B label');
    assert.deepStrictEqual(JSON.parse(vm.runInContext('JSON.stringify(trialQuality)', context)), {
        bQuality: 'trial',
        bQualityReasons: ['KDJ 金叉确认短期动量修复', '超跌止跌反弹确认修复形态'],
        bQualityRuleId: 'test-wave-b-quality-b8-b17'
    }, 'a manually selected trial must remain distinct from an approved strong confirmation');
    assert.deepStrictEqual(JSON.parse(vm.runInContext('JSON.stringify(strongQuality)', context)), {
        bQuality: 'strong',
        bQualityReasons: ['KDJ 金叉确认短期动量修复', '超跌止跌反弹确认修复形态'],
        bQualityRuleId: 'test-wave-b-quality-b8-b17'
    });
    assert.deepStrictEqual(JSON.parse(vm.runInContext('JSON.stringify(strongDecision)', context)), {
        bsMark: 'B', position: 30, simpleAction: '轻仓建仓'
    }, 'quality metadata must not mutate the original B decision');
    assert.deepStrictEqual(JSON.parse(vm.runInContext('JSON.stringify(expiredB8Quality)', context)), {
        bQuality: 'standard', bQualityReasons: [], bQualityRuleId: null
    }, 'an invalidated B8 may not qualify a B as strong');
    assert.strictEqual(vm.runInContext('indexQuality', context), null, 'an index B must never receive stock quality metadata');
    assert.strictEqual(vm.runInContext('unrelatedQuality', context), null, 'other strategies must not receive B quality metadata');
    const trialSummary = JSON.parse(vm.runInContext('JSON.stringify(trialSummary)', context));
    assert.strictEqual(trialSummary.state, '金色 B（试用）');
    assert.strictEqual(trialSummary.reason, 'KDJ 金叉确认短期动量修复；超跌止跌反弹确认修复形态');
    const strongSummary = JSON.parse(vm.runInContext('JSON.stringify(strongSummary)', context));
    assert.strictEqual(strongSummary.state, '强确认买点');
    assert.strictEqual(strongSummary.reason, 'MACD底背离确认；周线支撑共同确认');
    assert.ok(renderSource.includes("ctx.strokeText('B', px, markerY);") && renderSource.includes("ctx.fillText('B', px, markerY);"), 'daily chart must keep the B glyph for strong metadata');
    assert.ok(renderSource.includes("const isGoldBuy = ['trial', 'strong'].includes(d._decision.bQuality);"), 'daily chart must distinguish trial and approved B with gold');
    assert.ok(renderSource.includes("ctx.fillStyle = isGoldBuy ? (getCssVar('--yellow') || '#f5a623') : colorUpHex;"), 'daily chart must render gold B with gold');
    assert.ok(renderSource.includes("state.period === 'weekly'"), 'weekly chart must continue to suppress B/S markers');
});

runTest('build version is bumped consistently', () => {
    assert.ok(configSource.includes("const APP_BUILD = '2026-08-02-01';"));
    assert.ok(configSource.includes("const SIGNAL_VERSION = 'v4.2.13';"));
    const versions = [...indexSource.matchAll(/[?&]v=(\d{8}-\d{2})/g)].map((match) => match[1]);
    assert.ok(versions.length >= 7, 'expected vendor, CSS, and script version parameters');
    assert.deepStrictEqual([...new Set(versions)], ['20260802-01']);
    assert.ok(indexSource.includes('assets/vendor/chart.umd.min.js?v=20260802-01'), 'Chart.js should load from local vendor first');
    assert.ok(!indexSource.includes('https://cdn.jsdelivr.net/npm/chart.js@4.4.3/dist/chart.umd.min.js"></script>'), 'first Chart.js load should not depend on remote CDN');
    assert.ok(!indexSource.includes('fonts.googleapis') && !indexSource.includes('fonts.gstatic'), 'app shell should not block on external font hosts');
    assert.ok(cssSource.includes('font-family: -apple-system, BlinkMacSystemFont'), 'body should use system font stack');
    assert.ok(cssSource.includes('font-family: ui-monospace, SFMono-Regular'), 'monospace text should use system monospace stack');
});

runTest('production UI keeps offline strategy certification out of daily decisions', () => {
    assert.ok(!configSource.includes('STRATEGY_HEALTH_MANIFEST'));
    assert.ok(!configSource.includes('evaluateStrategyHealth'));
    assert.ok(!appSource.includes('getStrategyHealth'));
    assert.ok(!appSource.includes('健康等级'));
});

runTest('header and desktop sidebars keep fixed asymmetric columns', () => {
    assert.ok(cssSource.includes('grid-template-columns: 260px minmax(0, 1fr) 350px;'), 'header grid should match the fixed 260px/350px sidebars');
    assert.ok(cssSource.includes('.nav-section { width: 260px;'), 'left sidebar should stay fixed at 260px');
    assert.ok(cssSource.includes('.info-section { width: 350px;'), 'right sidebar should stay fixed at 350px');
    assert.ok(!cssSource.includes('grid-template-columns: 220px minmax(0, 1fr) 300px;') &&
        !cssSource.includes('grid-template-columns: 200px minmax(0, 1fr) 280px;'), 'responsive rules should not resize the header columns');
    assert.ok(!cssSource.includes('.nav-section { width: 220px;') &&
        !cssSource.includes('.nav-section { width: 200px;') &&
        !cssSource.includes('.info-section { width: 300px;') &&
        !cssSource.includes('.info-section { width: 280px;'), 'responsive rules should not resize either sidebar');
});

runTest('project ownership and copyright metadata are visible', () => {
    assert.ok(indexSource.includes('<meta name="author" content="LINPO LAB">'), 'missing author metadata');
    assert.ok(indexSource.includes('<meta name="copyright" content="© 2026 LINPO LAB. All rights reserved.">'), 'missing copyright metadata');
    assert.ok(indexSource.includes('<meta property="og:site_name" content="DailyGlance">'), 'missing Open Graph site name');
    assert.ok(indexSource.includes('<title>DailyGlance 每日一览</title>'), 'page title should expose the Chinese product name');
    assert.ok(indexSource.includes('<meta property="og:title" content="DailyGlance 每日一览">'), 'Open Graph title should expose the Chinese product name');
    assert.ok(indexSource.includes('<div class="header-title">每日一览</div>'), 'header should expose the Chinese product name');
    assert.ok(indexSource.includes('<div class="header-owner">DailyGlance</div>'), 'header should expose the English product name');
    assert.ok(indexSource.includes('DailyGlance · LINPO LAB'), 'help panel should expose brand attribution');
    assert.ok(indexSource.includes('© 2026 LINPO LAB. All rights reserved.'), 'help panel should expose copyright text');
    assert.ok(cssSource.includes('.brand-attribution'), 'missing attribution styles');
    assert.ok(cssSource.includes('.header-owner'), 'missing header owner styles');
});

runTest('header tools separate global, contextual, and maintenance actions', () => {
    const headerSource = (indexSource.match(/<header class="header">[\s\S]*?<\/header>/) || [''])[0];
    const toolbarSource = (indexSource.match(/<div class="toolbar-right">[\s\S]*?id="updateDataBtn"[\s\S]*?<\/button>/) || [''])[0];
    assert.ok(headerSource.includes('id="liveClock"') && headerSource.includes('class="header-tool-divider"'), 'clock should be visually separated from global actions');
    assert.ok(headerSource.includes('id="btnSettings"') && headerSource.includes('id="btnHelp"') && headerSource.includes('id="btnMore"'), 'header should retain settings, help, and one more-tools trigger');
    assert.ok(!headerSource.includes('id="btnBacktest"'), 'stock backtest should not remain in the global header');
    assert.ok(!headerSource.includes('id="btnClearCache"') && !headerSource.includes('id="btnPerf"'), 'maintenance actions should not remain as equal-weight header buttons');
    assert.ok(headerSource.includes('id="headerMoreMenu"') && headerSource.includes('>性能诊断</span>') && headerSource.includes('>重置本地数据</span>'), 'more menu should own the maintenance actions');
    assert.ok(toolbarSource.includes('id="btnBacktest"') && toolbarSource.includes('id="updateDataBtn"'), 'stock backtest should move beside chart-scoped tools');
    assert.ok(appSource.includes('function toggleHeaderMoreMenu(') && appSource.includes('function handleHeaderMoreMenuKeydown('), 'more menu should expose click and keyboard interaction contracts');
    assert.ok(cssSource.includes('.header-action-group') && cssSource.includes('.header-more-menu') && cssSource.includes('.icon-btn-label'), 'header and chart actions should reuse shared component styles');
    assert.ok(!appSource.includes('彻底重置系统数据'), 'destructive reset should not be duplicated inside settings');
});

runTest('settings dialog keeps its body as the bounded scroll container', () => {
    assert.ok(cssSource.includes('min-height: 0; overflow: hidden;'), 'dialog panel should clip content for inner scrolling');
    assert.ok(cssSource.includes('flex: 1 1 auto; min-height: 0;') && cssSource.includes('overscroll-behavior: contain;'), 'dialog body should be a bounded isolated scroll container');
});

runTest('decision evidence panel uses novice-readable why/action copy', () => {
    assert.ok(renderSource.includes('function getNoviceEvidenceCopy('), 'missing novice evidence copy helper');
    assert.ok(renderSource.includes('核心建仓门禁开放'), 'market evidence must explain the one-way risk gate');
    assert.ok(renderSource.includes('核心宽基偏弱') && renderSource.includes('普通机会') && renderSource.includes('标的自身独立走强') && renderSource.includes('marketGate.cap'), 'weak-market evidence must explain tiered increase caps');
    assert.ok(renderSource.includes('买入依据') && renderSource.includes('未买入原因'), 'signal evidence must explain buy/no-buy reason');
    assert.ok(renderSource.includes('风险依据') && renderSource.includes('防守位'), 'risk evidence must explain defensive basis');
    assert.ok(renderSource.includes('noviceEvidence.marketHint'), 'market hint must be rendered');
    assert.ok(renderSource.includes('noviceEvidence.signalHint'), 'signal hint must be rendered');
    assert.ok(renderSource.includes('noviceEvidence.guardHint'), 'guard hint must be rendered');
});

runTest('market context UI exposes an increase gate instead of a position coefficient', () => {
    assert.ok(appSource.includes('核心建仓门禁'), 'market context card must name the core entry gate');
    assert.ok(appSource.includes('market.increaseCaps') && appSource.includes('market.increaseCaps.ordinary') && appSource.includes('market.increaseCaps.independent'), 'weak market gate must show tiered increase caps');
    assert.ok(appSource.includes('门禁核心') && appSource.includes('仅观察'), 'index rows must distinguish gate inputs from observation-only indices');
    assert.ok(appSource.includes("renderLeftListHeader('市场与板块指数')"), 'left list title must cover market and board indices');
    assert.ok(cssSource.includes('.market-gate-panel') && cssSource.includes('.market-core-grid'), 'core gate module must use the compact layout');
    assert.ok(!appSource.includes('建议仓位上限'), 'market context must not present a holding cap');
    assert.ok(indexSource.includes('普通机会新增风险上限30%') && indexSource.includes('标的自身独立走强上限50%') && indexSource.includes('宽基只限制增加风险'), 'help copy must explain tiered stock/index gate semantics');
    assert.ok(!indexSource.includes('决定市场环境系数和仓位上限'), 'help copy must not describe the retired multiplier model');
});

runTest('historical exit context does not turn a current hold into a reduce instruction', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(calcSource, context);
    vm.runInContext(renderSource, context);
    vm.runInContext(`
        Object.assign(STRATEGY, STRATEGIES['稳健趋势型']);
        var evidence = getNoviceEvidenceCopy(
            { windowScore: STRATEGY.buyThreshold },
            {
                position: 50,
                simpleAction: '积极建仓',
                market: { cls: 'neutral' },
                exit: { level: '无明确离场' }
            },
            '防守观察',
            '近期出现过普通离场信号'
        );
    `, context);
    const guardHint = vm.runInContext('evidence.guardHint', context);
    assert.ok(guardHint.includes('近期出现过普通离场信号'));
    assert.ok(guardHint.includes('风险依据'));
    assert.ok(!guardHint.includes('降低仓位'));
});

runTest('right panel keeps one decision card and lightweight evidence rows', () => {
    assert.ok(renderSource.includes('<div class="decision-invalid"><span>失效条件：</span>'), 'decision card must keep an explicit invalidation condition');
    assert.ok(!renderSource.includes('decision.positionDriver ?'), 'decision card should not repeat the position driver in a second box');
    assert.ok(renderSource.includes('<div class="decision-evidence-list">'), 'evidence should use one lightweight list');
    assert.ok(renderSource.includes('<span>${evidenceTitle1}</span>'), 'market evidence needs a mode-specific leading label');
    assert.ok(renderSource.includes('${escapeHTML(noviceEvidence.marketHint)}'), 'market evidence must keep the novice explanation');
    assert.ok(renderSource.includes('<span>${evidenceTitle2}</span>'), 'signal evidence needs a leading label');
    assert.ok(renderSource.includes('${meta.windowScore}/${STRATEGY.buyThreshold}'), 'signal evidence must keep the score');
    assert.ok(renderSource.includes('${escapeHTML(noviceEvidence.signalHint)}'), 'signal evidence must keep the novice explanation');
    assert.ok(renderSource.includes('<span>${evidenceTitle3}</span>'), 'guard evidence needs a mode-specific leading label');
    assert.ok(renderSource.includes('${escapeHTML(noviceEvidence.guardHint)}'), 'guard evidence must keep the defensive instruction');
    assert.ok(cssSource.includes('.decision-evidence-row') && cssSource.includes('border-bottom'), 'evidence rows should use separators instead of nested cards');
    assert.ok(!cssSource.includes('.evidence-detail {'), 'nested evidence cards should be removed');
    assert.ok(renderSource.includes('<details class="terminal-block signal-disclosure">'), 'technical signals should be collapsed by default');
    assert.ok(renderSource.includes('<div class="decision-evidence-list weekly-context-list">'), 'weekly context should reuse the formatted evidence list');
    assert.ok(renderSource.includes('<span>当前位置</span>') && renderSource.includes('${escapeHTML(wk.position)}'), 'weekly position needs a formatted label and value');
    assert.ok(renderSource.includes('<span>趋势修复</span>') && renderSource.includes('${escapeHTML(wk.repair)}'), 'weekly repair needs a formatted label and value');
    assert.ok(!renderSource.includes('class="evidence-grid"') && !renderSource.includes('class="evidence-item"'), 'weekly context must not use legacy classes without CSS');
    assert.ok(renderSource.includes('<div class="level-line weekly-level-line">'), 'weekly key levels need a narrow-sidebar layout variant');
    assert.ok(cssSource.includes('.weekly-level-line .level-pill') && cssSource.includes('flex-direction: column'), 'weekly key levels should stack labels and values');
});

runTest('buy conclusion names the effective signal and keeps technical traceability folded', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(dataSource, context);
    vm.runInContext('function convertDailyToWeekly() { return []; }', context);
    vm.runInContext(calcSource, context);
    vm.runInContext(renderSource, context);
    vm.runInContext(`
        Object.assign(STRATEGY, STRATEGIES['稳健趋势型']);
        state.mode = 'index';
        state.period = 'daily';
        state.indicators = { ma: {}, macd: null, rsi: null, kdj: null };
        var full = Array.from({ length: 70 }, (_, i) => ({ date: '2026-06-' + String(i + 1).padStart(2, '0'), close: 100, high: 102, low: 98, open: 100, vol: 1000 }));
        full[64]._signals = ['B1', 'B10'];
        full[64]._decision = {
            basePosition: 80,
            position: 80,
            prevAdv: 0,
            bsMark: 'B',
            simpleAction: '积极建仓',
            simpleColorClass: 'text-bull',
            market: { label: '核心宽基偏强', cls: 'bull' },
            marketGate: { type: 'open', detail: '' },
            risk: { level: '低波动/偏离', score: 86, coef: 1, flags: [], stop: 96, pressure: 112 },
            exit: { level: '无明确离场', detail: '暂无明确离场依据' },
            positionCap: null
        };
        var meta = {
            windowScore: 5,
            windowScoreSignals: [{ day: 64, dayOffset: 0, signal: 'B1', score: 3 }],
            windowSignals: [{ day: 64, signal: 'B1' }, { day: 64, signal: 'B10' }],
            buySignals: ['B1', 'B10'],
            exitSignals: [],
            warningSignals: [],
            inCooldown: false,
            allSignals: {}
        };
        var panelHtml = generateAnalysisHTML(64, full, meta);
        var panelText = panelHtml.replace(/<[^>]*>/g, ' ').replace(/\\s+/g, ' ').trim();
    `, context);
    const panelText = vm.runInContext('panelText', context);
    assert.ok(panelText.includes('均线多头'), panelText);
    assert.ok(panelText.includes('动能依据'), panelText);
    assert.ok(panelText.includes('市场风险'), panelText);
    assert.ok(panelText.includes('风险仓位计算链') && panelText.includes('最终风险仓位 80%'), panelText);
    assert.ok(panelText.includes('今日 · 计分 +3') && panelText.includes('今日 · 同组去重'), panelText);
    assert.ok(renderSource.includes('技术细节') && renderSource.includes('今日原始信号') && renderSource.includes('指数动能与离场窗口'), 'technical detail must expose stock/index trace sections');
    assert.ok(cssSource.includes('.position-calculation-copy'), 'technical detail must style the position calculation chain');
});

runTest('stock and index conclusions share decisions but use different product language', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(dataSource, context);
    vm.runInContext('function convertDailyToWeekly() { return []; }', context);
    vm.runInContext(calcSource, context);
    vm.runInContext(renderSource, context);
    vm.runInContext(`
        Object.assign(STRATEGY, STRATEGIES['稳健趋势型']);
        state.period = 'daily';
        state.indicators = { ma: {}, macd: null, rsi: null, kdj: null };
        var full = Array.from({ length: 70 }, (_, i) => ({ date: '2026-06-' + String(i + 1).padStart(2, '0'), close: 100, high: 102, low: 98, open: 100, vol: 1000, _signals: [] }));
        full[64]._signals = ['B1'];
        full[64]._decision = {
            basePosition: 80,
            position: 80,
            prevAdv: 0,
            bsMark: 'B',
            simpleAction: '积极建仓',
            simpleColorClass: 'text-bull',
            market: { label: '核心宽基偏弱', cls: 'bear', increaseCaps: { ordinary: 30, independent: 50 } },
            marketGate: { type: 'increase-capped', cap: 50, strengthTier: 'independent', detail: '标的自身独立走强，新增风险上限50%' },
            risk: { level: '低波动/偏离', score: 86, coef: 1, flags: [], stop: 96, pressure: 112 },
            exit: { level: '无明确离场', detail: '暂无明确离场依据' },
            positionCap: null
        };
        var meta = {
            windowScore: 5,
            windowScoreSignals: [{ day: 64, dayOffset: 0, signal: 'B1', score: 3 }],
            windowSignals: [{ day: 64, signal: 'B1' }],
            buySignals: ['B1'],
            exitSignals: [],
            warningSignals: [],
            inCooldown: false,
            allSignals: {}
        };
        state.mode = 'stock';
        var stockText = generateAnalysisHTML(64, full, meta).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        state.mode = 'index';
        var indexText = generateAnalysisHTML(64, full, meta).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        var before = { position: full[64]._decision.position, bsMark: full[64]._decision.bsMark };
        getNoviceDecisionSummary(meta, full[64]._decision, 'stock');
        getNoviceDecisionSummary(meta, full[64]._decision, 'index');
        var after = { position: full[64]._decision.position, bsMark: full[64]._decision.bsMark };
    `, context);
    const stockText = vm.runInContext('stockText', context);
    const indexText = vm.runInContext('indexText', context);
    assert.ok(stockText.includes('个股每日结论') && stockText.includes('策略参考仓位') && stockText.includes('买入依据'), stockText);
    assert.ok(stockText.includes('核心建仓门禁') && stockText.includes('标的自身独立走强') && stockText.includes('50%'), stockText);
    assert.ok(indexText.includes('大盘每日结论') && indexText.includes('当前风险仓位') && indexText.includes('动能依据'), indexText);
    assert.ok(indexText.includes('核心市场环境') && indexText.includes('标的自身独立走强') && indexText.includes('50%'), indexText);
    assert.ok(indexText.includes('指数自身动能') && indexText.includes('市场风险/防守') && indexText.includes('风险仓位计算链'), indexText);
    assert.ok(!indexText.includes('个股信号') && !indexText.includes('买入依据') && !indexText.includes('持仓依据'), indexText);
    assert.deepStrictEqual(vm.runInContext('after', context), vm.runInContext('before', context));
});

runTest('right panel explains a KDJ dead cross as a one-point soft invalidation without changing the decision', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(dataSource, context);
    vm.runInContext(calcSource, context);
    vm.runInContext(renderSource, context);
    vm.runInContext(`
        Object.assign(STRATEGY, STRATEGIES['波段抄底型']);
        state.mode = 'stock';
        state.period = 'daily';
        var full = Array.from({ length: 70 }, (_, i) => ({
            date: '2026-01-' + String(i + 1).padStart(2, '0'),
            close: 100,
            high: 102,
            low: 98,
            open: 100,
            vol: 1000,
            _signals: []
        }));
        full[62].date = '2026-05-28';
        full[63].date = '2026-05-29';
        full[63]._decision = {
            basePosition: 30,
            position: 30,
            prevAdv: 30,
            bsMark: null,
            signalReady: false,
            windowScore: 3,
            previousWindowScore: 4,
            softSignalGrace: { applied: false, days: 0, signals: ['B8'], invalidations: [] },
            simpleAction: '轻仓持有',
            simpleColorClass: 'text-info',
            market: { label: '核心宽基分化', cls: 'neutral' },
            marketGate: { type: 'open', detail: '' },
            risk: { level: '低波动/偏离', score: 86, coef: 1, flags: [], stop: 96, pressure: 112 },
            exit: { level: '无明确离场', detail: '暂无明确离场依据' },
            positionCap: null
        };
        state.indicators = {
            ma: {},
            macd: { diff: [], dea: [] },
            rsi: { val: [] },
            kdj: {
                k: Array.from({ length: 70 }, () => 15),
                d: Array.from({ length: 70 }, () => 12),
                j: Array.from({ length: 70 }, () => 21)
            }
        };
        state.indicators.kdj.k[63] = 8.40;
        state.indicators.kdj.d[63] = 12.02;
        var meta = {
            currentDay: 63,
            currentDate: '2026-05-29',
            currentClose: 100,
            windowScore: 3,
            windowScoreSignals: [
                { day: 62, dayOffset: 1, signal: 'B16', score: 3 }
            ],
            windowSignals: [
                { day: 62, signal: 'B16' }
            ],
            invalidatedWindowSignals: [{
                signal: 'B8', day: 62, signalDate: '2026-05-28', score: 1,
                reason: 'kdj-dead-cross', invalidationDay: 63,
                invalidationDate: '2026-05-29', invalidationLevel: null
            }],
            buySignals: [],
            exitSignals: [],
            warningSignals: [],
            inCooldown: false,
            allSignals: {}
        };
        var before = {
            score: meta.windowScore,
            position: full[63]._decision.position,
            bsMark: full[63]._decision.bsMark
        };
        var panelText = generateAnalysisHTML(63, full, meta).replace(/<[^>]*>/g, ' ').replace(/\\s+/g, ' ').trim();
        var after = {
            score: meta.windowScore,
            position: full[63]._decision.position,
            bsMark: full[63]._decision.bsMark
        };
    `, context);
    const panelText = vm.runInContext('panelText', context);
    assert.ok(panelText.includes('KDJ金叉已转为死叉') && panelText.includes('1分失效'), panelText);
    assert.ok(panelText.includes('4/4降至3/4'), panelText);
    assert.ok(panelText.includes('当前保持30%试探仓观察'), panelText);
    assert.ok(panelText.includes('2026-05-28触发') && panelText.includes('2026-05-29死叉失效') && panelText.includes('不计分'), panelText);
    assert.ok(!panelText.includes('KDJ金叉有效信号'), panelText);
    assert.deepStrictEqual(vm.runInContext('after', context), vm.runInContext('before', context));
});

runTest('right panel explains a price-break hard invalidation with score delta and trial exit', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(dataSource, context);
    vm.runInContext(calcSource, context);
    vm.runInContext(renderSource, context);
    vm.runInContext(`
        Object.assign(STRATEGY, STRATEGIES['波段抄底型']);
        state.mode = 'stock';
        state.period = 'daily';
        state.indicators = { ma: {}, macd: { diff: [], dea: [] }, rsi: { val: [] }, kdj: { k: [], d: [], j: [] } };
        var full = Array.from({ length: 70 }, (_, i) => ({
            date: '2026-01-' + String(i + 1).padStart(2, '0'), close: 7.46,
            high: 7.55, low: 7.35, open: 7.37, vol: 1000, _signals: []
        }));
        full[63].date = '2026-06-10';
        full[64].date = '2026-06-11';
        full[64].close = 7.27;
        full[64]._decision = {
            basePosition: 0, position: 0, prevAdv: 30, bsMark: 'S', signalReady: false,
            windowScore: 0, previousWindowScore: 7,
            softSignalGrace: { applied: false, days: 0, signals: [], invalidations: [] },
            simpleAction: '执行离场', simpleColorClass: 'text-bear',
            market: { label: '核心宽基分化', cls: 'neutral' },
            marketGate: { type: 'open', detail: '' },
            risk: { level: '低波动/偏离', score: 86, coef: 1, flags: [], stop: 7.20, pressure: 8.66 },
            exit: { level: '无明确离场', detail: '暂无明确离场依据' },
            positionCap: null
        };
        var meta = {
            currentDay: 64, currentDate: '2026-06-11', currentClose: 7.27,
            windowScore: 0, windowScoreSignals: [], windowSignals: [],
            invalidatedWindowSignals: [
                { signal: 'B16', day: 61, signalDate: '2026-06-08', score: 3, reason: 'price-break', invalidationDay: 62, invalidationDate: '2026-06-09', invalidationLevel: 7.39 },
                { signal: 'B9', day: 63, signalDate: '2026-06-10', score: 4, reason: 'price-break', invalidationDay: 64, invalidationDate: '2026-06-11', invalidationLevel: 7.35 },
                { signal: 'B16', day: 63, signalDate: '2026-06-10', score: 3, reason: 'price-break', invalidationDay: 64, invalidationDate: '2026-06-11', invalidationLevel: 7.35 }
            ],
            buySignals: [], exitSignals: [], warningSignals: [], inCooldown: false, allSignals: {}
        };
        var before = { score: meta.windowScore, position: full[64]._decision.position, bsMark: full[64]._decision.bsMark };
        var panelText = generateAnalysisHTML(64, full, meta).replace(/<[^>]*>/g, ' ').replace(/\\s+/g, ' ').trim();
        var after = { score: meta.windowScore, position: full[64]._decision.position, bsMark: full[64]._decision.bsMark };
    `, context);
    const panelText = vm.runInContext('panelText', context);
    assert.ok(panelText.includes('收盘7.27跌破信号防守位7.35'), panelText);
    assert.ok(panelText.includes('MACD底背离(+4)') && panelText.includes('回踩周线支撑企稳(+3)'), panelText);
    assert.ok(panelText.includes('7/4降至0/4') && panelText.includes('退出30%试探仓'), panelText);
    assert.strictEqual((panelText.match(/回踩周线支撑企稳/g) || []).length, 2, 'conclusion plus technical details should each show B16 once');
    assert.ok(!panelText.includes('2026-06-08触发'), panelText);
    assert.deepStrictEqual(vm.runInContext('after', context), vm.runInContext('before', context));
});

runTest('right panel keeps a B11 trial on a local break and shows its structure defense', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(dataSource, context);
    vm.runInContext(calcSource, context);
    vm.runInContext(renderSource, context);
    vm.runInContext(`
        Object.assign(STRATEGY, STRATEGIES['波段抄底型']);
        state.mode = 'stock';
        state.period = 'daily';
        state.indicators = { ma: {}, macd: { diff: [], dea: [] }, rsi: { val: [] }, kdj: { k: [], d: [], j: [] } };
        var full = Array.from({ length: 70 }, (_, i) => ({
            date: '2026-07-' + String(i + 1).padStart(2, '0'),
            open: 8.5, high: 8.8, low: 8.4, close: 8.5, vol: 1000, _signals: []
        }));
        full[64].date = '2026-07-24';
        full[64].close = 8.42;
        full[64]._decision = {
            basePosition: 30, position: 30, prevAdv: 30, bsMark: null, signalReady: false,
            windowScore: 2, previousWindowScore: 3,
            softSignalGrace: { applied: false, days: 0, signals: [], invalidations: [] },
            localStructureDefense: { applied: true, signals: ['B11'], localBreaks: [] },
            b11StructureDefense: {
                signal: 'B11', signalDay: 63, signalDate: '2026-07-23',
                localLevel: 8.48, structureLevel: 8.24, structureDay: 54,
                structureDate: '2026-07-10', localBreak: true, localBreakDay: 64,
                localBreakDate: '2026-07-24', hardInvalidated: false
            },
            simpleAction: '轻仓持有', simpleColorClass: 'text-info',
            market: { label: '核心宽基分化', cls: 'neutral' }, marketGate: { type: 'open', detail: '' },
            risk: { level: '低波动/偏离', score: 86, coef: 1, flags: [], stop: 8.03, pressure: 9.75 },
            exit: { level: '无明确离场', detail: '暂无明确离场依据' }, positionCap: null
        };
        var meta = {
            currentDay: 64, currentDate: '2026-07-24', currentClose: 8.42,
            windowScore: 2,
            windowScoreSignals: [{ day: 63, dayOffset: 1, signal: 'B11', score: 2 }],
            windowSignals: [{ day: 63, signal: 'B11' }],
            invalidatedWindowSignals: [],
            localBreakWindowSignals: [{
                signal: 'B11', day: 63, signalDate: '2026-07-23', score: 2,
                reason: 'local-price-break', defenseType: 'local', invalidationDay: 64,
                invalidationDate: '2026-07-24', invalidationLevel: 8.48,
                structureLevel: 8.24, structureDay: 54, structureDate: '2026-07-10'
            }],
            buySignals: [], exitSignals: [], warningSignals: [], inCooldown: false, allSignals: {}
        };
        var panelText = generateAnalysisHTML(64, full, meta).replace(/<[^>]*>/g, ' ').replace(/\\s+/g, ' ').trim();
    `, context);
    const panelText = vm.runInContext('panelText', context);
    assert.ok(panelText.includes('收盘8.42跌破均线回踩不破局部防守位8.48'), panelText);
    assert.ok(panelText.includes('结构防守位8.24（2026-07-10确认）'), panelText);
    assert.ok(panelText.includes('暂停加仓') && panelText.includes('当前维持30%试探仓观察'), panelText);
    assert.ok(panelText.includes('B11结构防守 8.24'), panelText);
    assert.ok(!panelText.includes('8.03'), panelText);
});

runTest('B11 structure defense state invalidates the cached sidebar signature', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(`
        var baseDecision = {
            simpleAction: '轻仓持有', position: 30,
            market: { label: '核心宽基分化' }, risk: { score: 86 }, exit: { level: '无明确离场' },
            b11StructureDefense: { structureLevel: 8.24, structureDate: '2026-07-10', localBreak: false }
        };
        var beforeLocalBreakSignature = getDecisionSignature(baseDecision);
        var afterLocalBreakSignature = getDecisionSignature({
            ...baseDecision,
            b11StructureDefense: { ...baseDecision.b11StructureDefense, localBreak: true }
        });
    `, context);
    assert.notStrictEqual(
        vm.runInContext('beforeLocalBreakSignature', context),
        vm.runInContext('afterLocalBreakSignature', context)
    );
});

runTest('hard invalidation copy follows the final entry or holding position', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(calcSource, context);
    vm.runInContext(`
        Object.assign(STRATEGY, STRATEGIES['综合全能型']);
        var meta = {
            currentDay: 64,
            currentDate: '2026-07-27',
            currentClose: 14.10,
            windowScore: 6,
            windowScoreSignals: [
                { day: 64, dayOffset: 0, signal: 'B2', score: 3 },
                { day: 63, dayOffset: 1, signal: 'B5', score: 3 }
            ],
            windowSignals: [
                { day: 64, signal: 'B2' },
                { day: 63, signal: 'B5' }
            ],
            invalidatedWindowSignals: [{
                signal: 'B16',
                day: 62,
                signalDate: '2026-07-25',
                score: 3,
                reason: 'price-break',
                invalidationDay: 64,
                invalidationDate: '2026-07-27',
                invalidationLevel: 14.20
            }],
            buySignals: ['B2'],
            exitSignals: [],
            warningSignals: [],
            inCooldown: false,
            allSignals: {}
        };
        var entryDecision = {
            basePosition: 80,
            position: 20,
            prevAdv: 0,
            bsMark: 'B',
            signalReady: true,
            windowScore: 6,
            previousWindowScore: 3,
            simpleAction: '轻仓建仓',
            market: { label: '核心宽基偏弱', increaseCaps: { ordinary: 30, independent: 50 } },
            marketGate: { type: 'open' },
            risk: { flags: [], coef: 1 },
            exit: { level: '无明确离场' }
        };
        var holdDecision = {
            ...entryDecision,
            position: 30,
            prevAdv: 30,
            bsMark: null,
            simpleAction: '谨慎持有',
            marketGate: { type: 'open' }
        };
        var entryBefore = { position: entryDecision.position, bsMark: entryDecision.bsMark, action: entryDecision.simpleAction };
        var holdBefore = { position: holdDecision.position, bsMark: holdDecision.bsMark, action: holdDecision.simpleAction };
        var entrySummary = getNoviceDecisionSummary(meta, entryDecision, 'stock');
        var holdSummary = getNoviceDecisionSummary(meta, holdDecision, 'stock');
        var entryAfter = { position: entryDecision.position, bsMark: entryDecision.bsMark, action: entryDecision.simpleAction };
        var holdAfter = { position: holdDecision.position, bsMark: holdDecision.bsMark, action: holdDecision.simpleAction };
    `, context);
    const entrySummary = JSON.parse(vm.runInContext('JSON.stringify(entrySummary)', context));
    const holdSummary = JSON.parse(vm.runInContext('JSON.stringify(holdSummary)', context));
    assert.strictEqual(entrySummary.action, '只适合轻仓');
    assert.ok(entrySummary.reason.includes('买入积分当前为6/6'), entrySummary.reason);
    assert.ok(entrySummary.reason.includes('本次由空仓转为20%轻仓试探'), entrySummary.reason);
    assert.ok(!entrySummary.reason.includes('当前空仓观察'), entrySummary.reason);
    assert.ok(!entrySummary.reason.includes('3/6降至6/6'), entrySummary.reason);
    assert.ok(holdSummary.reason.includes('当前维持30%轻仓观察'), holdSummary.reason);
    assert.ok(!holdSummary.reason.includes('当前空仓观察'), holdSummary.reason);
    assert.deepStrictEqual(vm.runInContext('entryAfter', context), vm.runInContext('entryBefore', context));
    assert.deepStrictEqual(vm.runInContext('holdAfter', context), vm.runInContext('holdBefore', context));
});

runTest('novice copy explains the one-day soft-invalidation grace and its expiry', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(calcSource, context);
    vm.runInContext(`
        Object.assign(STRATEGY, STRATEGIES['波段抄底型']);
        var softMeta = {
            currentDay: 64, currentClose: 100, windowScore: 2,
            invalidatedWindowSignals: [{ signal: 'B8', score: 1, reason: 'kdj-dead-cross', invalidationDay: 64 }],
            windowSignals: [], windowScoreSignals: [], buySignals: [], exitSignals: [], warningSignals: [], allSignals: {}, inCooldown: false
        };
        var softDecision = {
            basePosition: 30, position: 30, prevAdv: 30, windowScore: 2, previousWindowScore: 3,
            softSignalGrace: { applied: true, days: 1, signals: ['B8'] },
            simpleAction: '轻仓持有', market: { label: '核心宽基分化' }, marketGate: {},
            risk: { flags: [], coef: 1 }, exit: { level: '无明确离场' }
        };
        var graceSummary = getNoviceDecisionSummary(softMeta, softDecision, 'stock');
        var expiredMeta = { ...softMeta, currentDay: 65, invalidatedWindowSignals: [] };
        var expiredDecision = {
            ...softDecision, basePosition: 0, position: 0, previousSoftSignalGrace: true,
            softSignalGrace: { applied: false, days: 0, signals: [] }, simpleAction: '执行离场'
        };
        var expiredSummary = getNoviceDecisionSummary(expiredMeta, expiredDecision, 'stock');
    `, context);
    const graceReason = vm.runInContext('graceSummary.reason', context);
    const expiredReason = vm.runInContext('expiredSummary.reason', context);
    assert.ok(graceReason.includes('3/4降至2/4') && graceReason.includes('30%试探仓保留1个交易日观察'), graceReason);
    assert.ok(expiredReason.includes('1日观察期结束') && expiredReason.includes('退出30%试探仓'), expiredReason);
});

runTest('product guide fixes the right panel copy standard', () => {
    assert.ok(productGuideSource.includes('右侧决策面板话术规范'), 'missing right-panel copy standard');
    assert.ok(productGuideSource.includes('结论 -> 推导依据 -> 技术细节'), 'copy standard must define the three-level writing order');
    assert.ok(productGuideSource.includes('只限制增加风险') && productGuideSource.includes('普通机会新增风险上限为30%') && productGuideSource.includes('标的自身独立走强') && productGuideSource.includes('上限为50%'), 'copy standard must explain the tiered market gate');
    assert.ok(productGuideSource.includes('买入依据') && productGuideSource.includes('持仓依据') && productGuideSource.includes('未买入原因'), 'copy standard must cover novice evidence language');
    assert.ok(productGuideSource.includes('信号发生日') && productGuideSource.includes('失效原因'), 'copy standard must expose historical signal timing and invalidation reason');
    assert.ok(productGuideSource.includes('不新增第二套策略判断'), 'copy standard must preserve the strategy boundary');
});

runTest('product guide keeps corporate-action name handling as narrow display policy', () => {
    assert.ok(productGuideSource.includes('特殊行情状态展示规范'), 'missing special market-state display policy');
    assert.ok(productGuideSource.includes('股票是谁') && productGuideSource.includes('今天有什么特殊状态'), 'policy must separate identity from temporary market state');
    assert.ok(productGuideSource.includes('不展示 `XD/XR/DR` 前缀'), 'policy must keep corporate-action prefixes out of base names');
    assert.ok(productGuideSource.includes('只属于展示/命名层'), 'policy must keep this out of strategy and data logic');
    assert.ok(productGuideSource.includes('不新增除权除息分析模块'), 'policy must prevent scope creep into a corporate-action analysis feature');
});

runTest('novice summary explains bullish market but defensive stock state without changing decision', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext('function convertDailyToWeekly() { return []; }', context);
    vm.runInContext(calcSource, context);
    vm.runInContext(`
        Object.assign(STRATEGY, STRATEGIES['稳健趋势型']);
        state.strategy = '稳健趋势型';
        var meta = {
            type: '⚠️ 趋势破位',
            windowScore: 0,
            buySignals: [],
            exitSignals: ['L1'],
            warningSignals: [],
            inCooldown: false
        };
        var decision = {
            position: 0,
            prevAdv: 0,
            bsMark: null,
            simpleAction: '规避风险',
            market: { label: '全面多头', reason: '多数指数走强' },
            risk: { level: '低波动/偏离', score: 86, flags: [], stop: 3927.85, pressure: 4175.35 },
            exit: { level: '减仓观察', detail: '跌破短期趋势，先按防守处理' },
            positionDriver: '基础仓位为 0%，当前不满足开仓条件。'
        };
        var before = { position: decision.position, bsMark: decision.bsMark, action: decision.simpleAction };
        var summary = getNoviceDecisionSummary(meta, decision);
        var after = { position: decision.position, bsMark: decision.bsMark, action: decision.simpleAction };
    `, context);
    assert.deepStrictEqual(vm.runInContext('after', context), vm.runInContext('before', context));
    assert.strictEqual(vm.runInContext('summary.state', context), '破位防守');
    assert.strictEqual(vm.runInContext('summary.action', context), '空仓观望');
    assert.ok(vm.runInContext('summary.reason.startsWith("市场环境为全面多头")', context));
    assert.ok(vm.runInContext('summary.reason.includes("L1 跌破短期趋势")', context));
    assert.ok(vm.runInContext('summary.reason.includes("当前按减仓观察处理")', context));
    assert.ok(vm.runInContext('summary.reason.includes("策略参考仓位降至 0%")', context));
    assert.ok(vm.runInContext('summary.reason.includes("先空仓防守")', context));
    assert.ok(vm.runInContext('!summary.reason.includes("；")', context), 'main reason should stay a single novice-readable sentence');
});

runTest('novice summary does not claim an undefined exit signal caused a defensive action', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext('function convertDailyToWeekly() { return []; }', context);
    vm.runInContext(calcSource, context);
    vm.runInContext(`
        Object.assign(STRATEGY, STRATEGIES['稳健趋势型']);
        var meta = {
            type: '⚠️ 趋势破位',
            windowScore: 0,
            buySignals: [],
            exitSignals: [],
            warningSignals: [],
            inCooldown: false
        };
        var makeSummary = marketLabel => getNoviceDecisionSummary(meta, {
            position: 0,
            prevAdv: 30,
            bsMark: 'S',
            simpleAction: '执行离场',
            market: { label: marketLabel },
            risk: { level: '低波动/偏离', score: 86, flags: [], stop: 3927.85, pressure: 4175.35 },
            exit: { level: '无明确离场', detail: '暂未看到需要立即防守的核心离场信号' }
        });
        var summaries = ['结构性题材行情', '温和偏多'].map(makeSummary);
    `, context);
    const summaries = JSON.parse(vm.runInContext('JSON.stringify(summaries)', context));
    for (const summary of summaries) {
        assert.strictEqual(summary.state, '信号失效');
        assert.strictEqual(summary.action, '空仓观望');
        assert.ok(summary.reason.includes('此前试探仓依赖的买入信号已失效'));
        assert.ok(summary.reason.includes('买入积分降为 0/5'));
        assert.ok(summary.reason.includes('退出30%试探仓，当前仓位为 0%'));
        assert.ok(!summary.reason.includes('破位防守'));
        assert.ok(!summary.reason.includes('已出现无明确离场信号'));
    }
});

runTest('novice summary names the strong exit and explains why the score resets', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext('function convertDailyToWeekly() { return []; }', context);
    vm.runInContext(calcSource, context);
    vm.runInContext(`
        Object.assign(STRATEGY, STRATEGIES['稳健趋势型']);
        var meta = {
            windowScore: 0,
            buySignals: [],
            exitSignals: ['L1', 'L9'],
            warningSignals: [],
            inCooldown: false
        };
        var decision = {
            position: 0,
            prevAdv: 30,
            bsMark: 'S',
            simpleAction: '清仓离场',
            market: { label: '震荡分化' },
            risk: { level: '中等波动/偏离', score: 75, flags: [], stop: 3.03, pressure: 3.54 },
            exit: { level: '强离场', detail: '触发核心破位防守：高点回撤破位' },
            signalReady: false
        };
        var before = { position: decision.position, bsMark: decision.bsMark, action: decision.simpleAction };
        var summary = getNoviceDecisionSummary(meta, decision);
        var after = { position: decision.position, bsMark: decision.bsMark, action: decision.simpleAction };
    `, context);
    assert.deepStrictEqual(vm.runInContext('after', context), vm.runInContext('before', context));
    const reason = vm.runInContext('summary.reason', context);
    assert.ok(reason.includes('L9 高点回撤破位'), reason);
    assert.ok(reason.includes('L1 跌破短期趋势'), reason);
    assert.ok(reason.includes('强离场会让此前买入积分失效'), reason);
    assert.ok(reason.includes('当前清零为 0/5'), reason);
    assert.ok(reason.includes('当前从30%降至 0%'), reason);
    assert.ok(reason.includes('从下一交易日起进入3个交易日冷静期'), reason);
    assert.ok(reason.includes('先空仓防守'), reason);
});

runTest('strong-exit copy exposes repeated reset and cooldown progress', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext('function convertDailyToWeekly() { return []; }', context);
    vm.runInContext(calcSource, context);
    vm.runInContext(`
        Object.assign(STRATEGY, STRATEGIES['波段抄底型']);
        var repeatedMeta = {
            windowScore: 0,
            buySignals: [],
            exitSignals: ['L3'],
            warningSignals: [],
            inCooldown: false,
            cooldownDays: 3,
            repeatedStrongExit: true,
            previousStrongExitDate: '2026-07-09'
        };
        var repeatedDecision = {
            position: 0,
            prevAdv: 0,
            bsMark: null,
            simpleAction: '规避风险',
            market: { label: '核心宽基分化' },
            risk: { level: '中等波动/偏离', score: 70, flags: [], stop: 3.32, pressure: 4.54 },
            exit: { level: '强离场', detail: '触发核心破位防守：MACD 死叉' },
            signalReady: false
        };
        var repeatedSummary = getNoviceDecisionSummary(repeatedMeta, repeatedDecision);
        var repeatedIndexSummary = getNoviceDecisionSummary(repeatedMeta, repeatedDecision, 'index');
        var cooldownMeta = {
            windowScore: 0,
            buySignals: [],
            exitSignals: [],
            warningSignals: [],
            inCooldown: true,
            cooldownDays: 3,
            daysSinceExit: 2
        };
        var cooldownDecision = {
            position: 0,
            prevAdv: 0,
            bsMark: null,
            simpleAction: '持币观望',
            market: { label: '核心宽基分化' },
            risk: { level: '中等波动/偏离', score: 70, flags: [], stop: 3.32, pressure: 4.54 },
            exit: { level: '无明确离场', detail: '暂未看到新的强离场信号' },
            signalReady: false
        };
        var cooldownSummary = getNoviceDecisionSummary(cooldownMeta, cooldownDecision);
        var cooldownIndexSummary = getNoviceDecisionSummary(cooldownMeta, cooldownDecision, 'index');
    `, context);
    const repeated = JSON.parse(vm.runInContext('JSON.stringify(repeatedSummary)', context));
    assert.strictEqual(repeated.state, '破位防守');
    assert.ok(repeated.reason.includes('再次触发强离场 L3 MACD死叉'), repeated.reason);
    assert.ok(repeated.reason.includes('3个交易日冷静期从下一交易日起重新计时'), repeated.reason);
    assert.ok(repeated.invalidCondition.includes('今日再次触发强离场'), repeated.invalidCondition);
    assert.ok(repeated.invalidCondition.includes('冷静期结束且买入积分重新达到 4/4'), repeated.invalidCondition);
    const cooldown = JSON.parse(vm.runInContext('JSON.stringify(cooldownSummary)', context));
    assert.strictEqual(cooldown.state, '离场冷静期');
    assert.ok(cooldown.reason.includes('第 2/3 个交易日，还剩 1 个交易日'), cooldown.reason);
    assert.ok(cooldown.invalidCondition.includes('第 2/3 个交易日，还剩 1 个交易日'), cooldown.invalidCondition);
    const repeatedIndex = JSON.parse(vm.runInContext('JSON.stringify(repeatedIndexSummary)', context));
    assert.strictEqual(repeatedIndex.state, '指数破位防守');
    assert.ok(repeatedIndex.reason.includes('今日指数再次触发强离场'), repeatedIndex.reason);
    assert.ok(repeatedIndex.reason.includes('3个交易日冷静期从下一交易日起重新计时'), repeatedIndex.reason);
    assert.ok(repeatedIndex.invalidCondition.includes('指数动能积分重新达到 4/4'), repeatedIndex.invalidCondition);
    assert.ok(!repeatedIndex.reason.includes('买入积分'), repeatedIndex.reason);
    const cooldownIndex = JSON.parse(vm.runInContext('JSON.stringify(cooldownIndexSummary)', context));
    assert.strictEqual(cooldownIndex.state, '指数冷静期');
    assert.ok(cooldownIndex.reason.includes('第 2/3 个交易日，还剩 1 个交易日'), cooldownIndex.reason);
    assert.ok(cooldownIndex.reason.includes('指数动能积分'), cooldownIndex.reason);
});

runTest('strong-exit metadata distinguishes a repeated trigger from cooldown days', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext('function convertDailyToWeekly() { return []; }', context);
    vm.runInContext(calcSource, context);
    vm.runInContext(`
        Object.assign(STRATEGY, STRATEGIES['波段抄底型']);
        var rows = Array.from({ length: 71 }, (_, i) => ({
            date: '2026-07-' + String(i + 1).padStart(2, '0'),
            open: 3.5,
            high: 3.6,
            low: 3.4,
            close: 3.5,
            vol: 1000,
            _signals: []
        }));
        rows[64].date = '2026-07-09';
        rows[64]._signals = ['L3'];
        rows[65].date = '2026-07-10';
        rows[66].date = '2026-07-13';
        rows[66]._signals = ['L3'];
        rows[67].date = '2026-07-14';
        rows[68].date = '2026-07-15';
        rows[69].date = '2026-07-16';
        rows[70].date = '2026-07-17';
        var firstExitMeta = calculateAllSignals(64, rows, {});
        var repeatedExitMeta = calculateAllSignals(66, rows, {});
        var cooldownDayOneMeta = calculateAllSignals(67, rows, {});
        var cooldownDayThreeMeta = calculateAllSignals(69, rows, {});
        var afterCooldownMeta = calculateAllSignals(70, rows, {});
    `, context);
    const first = JSON.parse(vm.runInContext('JSON.stringify(firstExitMeta)', context));
    const repeated = JSON.parse(vm.runInContext('JSON.stringify(repeatedExitMeta)', context));
    const dayOne = JSON.parse(vm.runInContext('JSON.stringify(cooldownDayOneMeta)', context));
    const dayThree = JSON.parse(vm.runInContext('JSON.stringify(cooldownDayThreeMeta)', context));
    const after = JSON.parse(vm.runInContext('JSON.stringify(afterCooldownMeta)', context));
    assert.strictEqual(first.repeatedStrongExit, false);
    assert.strictEqual(first.lastStrongExitDate, '2026-07-09');
    assert.strictEqual(repeated.repeatedStrongExit, true);
    assert.strictEqual(repeated.lastStrongExitDate, '2026-07-13');
    assert.strictEqual(repeated.previousStrongExitDate, '2026-07-09');
    assert.strictEqual(dayOne.inCooldown, true);
    assert.strictEqual(dayOne.daysSinceExit, 1);
    assert.strictEqual(dayThree.inCooldown, true);
    assert.strictEqual(dayThree.daysSinceExit, 3);
    assert.strictEqual(after.inCooldown, false);
    assert.strictEqual(after.daysSinceExit, 4);
});

runTest('novice summary attributes position compression to stock risk instead of market state', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext('function convertDailyToWeekly() { return []; }', context);
    vm.runInContext(calcSource, context);
    vm.runInContext(`
        Object.assign(STRATEGY, STRATEGIES['稳健趋势型']);
        var meta = {
            type: '📈 趋势抱单',
            windowScore: 5,
            buySignals: [],
            exitSignals: [],
            warningSignals: [],
            allSignals: {},
            windowSignals: [],
            inCooldown: false
        };
        var decision = {
            basePosition: 40,
            position: 0,
            prevAdv: 40,
            bsMark: 'S',
            simpleAction: '执行离场',
            market: { label: '核心宽基偏弱', increaseCaps: { ordinary: 30, independent: 50 } },
            risk: { level: '极端波动风险', score: 30, coef: 0.25, flags: ['波动过高'], stop: 90, pressure: 110 },
            exit: { level: '无明确离场', detail: '暂未看到需要立即防守的核心离场信号' },
            signalReady: true
        };
        var summary = getNoviceDecisionSummary(meta, decision);
    `, context);
    const reason = vm.runInContext('summary.reason', context);
    assert.ok(reason.includes('买入积分为 5/5'), reason);
    assert.ok(reason.includes('基础仓位原为 40%'), reason);
    assert.ok(reason.includes('风险系数 0.25'), reason);
    assert.ok(!reason.includes('市场系数'), reason);
    assert.ok(reason.includes('当前从40%降至 0%'), reason);
    assert.ok(reason.includes('先空仓防守'), reason);
});

runTest('novice invalid condition is executable for empty defensive state', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext('function convertDailyToWeekly() { return []; }', context);
    vm.runInContext(calcSource, context);
    vm.runInContext(`
        Object.assign(STRATEGY, STRATEGIES['稳健趋势型']);
        state.strategy = '稳健趋势型';
        var meta = {
            type: '⚠️ 趋势破位',
            windowScore: 0,
            buySignals: [],
            exitSignals: ['L1'],
            warningSignals: [],
            inCooldown: false
        };
        var decision = {
            position: 0,
            prevAdv: 0,
            bsMark: null,
            simpleAction: '规避风险',
            market: { label: '全面多头' },
            risk: { level: '低波动/偏离', score: 86, flags: [], stop: 3927.85, pressure: 4175.35 },
            exit: { level: '减仓观察' }
        };
        var before = { position: decision.position, bsMark: decision.bsMark, action: decision.simpleAction };
        var summary = getNoviceDecisionSummary(meta, decision);
        var after = { position: decision.position, bsMark: decision.bsMark, action: decision.simpleAction };
    `, context);
    assert.deepStrictEqual(vm.runInContext('after', context), vm.runInContext('before', context));
    assert.ok(vm.runInContext('summary.invalidCondition.includes("买入积分重新达到 5/5")', context));
    assert.ok(vm.runInContext('!summary.invalidCondition.includes("冷静期")', context));
    assert.ok(vm.runInContext('summary.invalidCondition.includes("才重新考虑")', context));
    assert.ok(vm.runInContext('summary.invalidCondition.includes("跌破防守位 3927.85")', context));
});
runTest('right panel selection state replaces stale identity and hides old refresh status', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(dataSource, context);
    vm.runInContext(renderSource, context);
    vm.runInContext(`
        state.mode = 'index';
        state.id = 'bz50';
        var cardPrice = document.getElementById('cardPrice');
        var cardAnalysis = document.getElementById('cardAnalysis');
        var refreshBar = document.getElementById('lastRefreshBar');
        cardPrice.innerHTML = '<div>创业板指 3685.97</div>';
        cardAnalysis.innerHTML = '<div>创业板旧结论</div>';
        refreshBar.style.display = 'flex';
        renderActiveSelectionStatus('loading');
        loadingSelectionResult = {
            price: cardPrice.innerHTML,
            analysis: cardAnalysis.innerHTML,
            refreshDisplay: refreshBar.style.display
        };
        renderActiveSelectionStatus('unavailable');
        unavailableSelectionResult = {
            price: cardPrice.innerHTML,
            analysis: cardAnalysis.innerHTML,
            refreshDisplay: refreshBar.style.display
        };
    `, context);
    const result = JSON.parse(vm.runInContext('JSON.stringify({ loadingSelectionResult, unavailableSelectionResult })', context));
    assert.ok(result.loadingSelectionResult.price.includes('北证50'), result.loadingSelectionResult.price);
    assert.ok(result.loadingSelectionResult.price.includes('数据加载中'), result.loadingSelectionResult.price);
    assert.ok(!result.loadingSelectionResult.price.includes('创业板'), result.loadingSelectionResult.price);
    assert.ok(!result.loadingSelectionResult.analysis.includes('创业板'), result.loadingSelectionResult.analysis);
    assert.strictEqual(result.loadingSelectionResult.refreshDisplay, 'none');
    assert.ok(result.unavailableSelectionResult.price.includes('数据暂不可用'), result.unavailableSelectionResult.price);
    assert.ok(result.unavailableSelectionResult.analysis.includes('无法生成行情图和策略结论'), result.unavailableSelectionResult.analysis);
    assert.strictEqual(result.unavailableSelectionResult.refreshDisplay, 'none');
});
