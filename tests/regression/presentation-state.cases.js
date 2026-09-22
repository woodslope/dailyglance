function assertPresentationSummary(summary, { index = false } = {}) {
    assert.ok(summary.why && summary.positionWhy && summary.nextFocus, 'summary should expose the three presentation fields');
    assert.strictEqual(summary.reason, summary.why, 'reason should remain a compatibility alias for why');
    assert.strictEqual(summary.positionExplanation, summary.positionWhy, 'positionExplanation should remain a compatibility alias for positionWhy');
    assert.strictEqual(summary.invalidCondition, summary.nextFocus, 'invalidCondition should remain a compatibility alias for nextFocus');
    const visibleCopy = [summary.why, summary.positionWhy, summary.nextFocus].join(' ');
    assert.ok(!/\b[BLW]\d+\b/.test(visibleCopy), 'main conclusion must not expose internal B/L/W codes');
    assert.ok(!visibleCopy.includes('风险系数'), 'main conclusion must not expose the risk coefficient');
    if (index) {
        assert.ok(!/个股|买入信号|买入积分|试探仓|策略参考仓位/.test(visibleCopy), 'index conclusion must not leak stock wording');
    }
}

runTest('regression suite exposes focused business group entrypoints', () => {
    const groups = ['data-cache', 'strategy-decision', 'presentation-state', 'chart-navigation', 'watchlist-lifecycle'];
    for (const group of groups) {
        assert.ok(fs.existsSync(path.join(root, 'tests', 'regression', `${group}.js`)), `missing regression group: ${group}`);
        const casesPath = path.join(root, 'tests', 'regression', `${group}.cases.js`);
        assert.ok(fs.existsSync(casesPath), `missing regression cases: ${group}`);
        assert.match(fs.readFileSync(casesPath, 'utf8'), /^runTest\(/m, `empty regression cases: ${group}`);
    }
});

runTest('application design system registers shared and sector component contracts', () => {
    assert.ok(agentsSource.includes('docs/product/UI_DESIGN_SYSTEM.md') && agentsSource.includes('实际改变设计契约时必须同步该规范'), 'visual task routing should require design-contract synchronization');
    assert.ok(readmeSource.includes('docs/product/UI_DESIGN_SYSTEM.md'), 'README document map should expose the application design system');
    assert.ok(uiDesignSystemSource.includes('## 变更同步边界') && uiDesignSystemSource.includes('## Design Token') && uiDesignSystemSource.includes('## 共享组件'), 'design system should define tokens, shared components and synchronization boundaries');
    const registeredSelectors = [
        '.nav-btn', '.icon-btn', '.terminal-block', '.action-panel', '.nav-list-item',
        '.external-env-strip', '.external-env-strip-item',
        '.sector-summary-card', '.sector-summary-dot', '.sector-concept-row', '.sector-concept-leader-name', '.sector-concept-leader-code',
        '.sector-trend-card', '.sector-trend-invalid'
    ];
    for (const selector of registeredSelectors) {
        assert.ok(cssSource.includes(selector), `missing implemented component ${selector}`);
        assert.ok(uiDesignSystemSource.includes(selector), `missing design-system registration for ${selector}`);
    }
    assert.ok(uiDesignSystemSource.includes('#settingsOverlay') && uiDesignSystemSource.includes('#helpOverlay') && uiDesignSystemSource.includes('#perfOverlay') && uiDesignSystemSource.includes('必须关闭 `backdrop-filter`'), 'scrollable dialog performance rule should be documented');
});

runTest('interactive components preserve hierarchy and keyboard contracts', () => {
    assert.ok(appSource.includes('class="sector-concept-leader-code mono"') && cssSource.includes('.sector-concept-row .sector-concept-leader-code'), 'representative stock code should use its registered secondary-text component');
    assert.ok(appSource.includes('class="sector-concept-leader-name"') && cssSource.includes('.sector-concept-row .sector-concept-leader-name'), 'representative stock name should use its registered evidence-text component');
    assert.ok(!appSource.includes('<strong>${leader ?'), 'representative stock evidence should not reuse the concept-title emphasis element');
    assert.ok(!appSource.includes('<em class="mono">${escapeHTML(leader.code)}</em>'), 'representative stock code should not inherit default italic emphasis');
    assert.ok(indexSource.includes('aria-label="关闭帮助"') && appSource.includes('aria-label="关闭设置"') && appSource.includes('aria-label="关闭性能诊断"'), 'icon-only dialog close buttons should expose explicit accessible names');
    assert.ok(cssSource.includes('opacity: 0; visibility: hidden; pointer-events: none;') && cssSource.includes('opacity: 1; visibility: visible; pointer-events: auto;'), 'closed overlays should leave the keyboard and accessibility path without losing the opacity transition');
    assert.ok(cssSource.includes('.ma-checkbox:has(input:focus-visible)') && !cssSource.includes('.ma-checkbox input { display: none; }'), 'MA checkboxes should retain native keyboard focus');
    assert.ok(appSource.includes('<button type="button" class="nav-list-item ${active}"'), 'index rows should use native keyboard-operable buttons');
    assert.ok(appSource.includes('class="lname-wrap watchlist-select-target"') && appSource.includes('handleWatchlistSelectKeydown(event)'), 'watchlist selection should expose a keyboard target without flattening drag and remove buttons');
    assert.ok(appSource.includes('role="combobox"') && appSource.includes('role="listbox"') && appSource.includes('role="option"') && appSource.includes('aria-activedescendant'), 'stock search should expose the combobox/listbox option relationship');
    assert.ok(indexSource.includes('role="dialog"') && indexSource.includes('aria-modal="true"') && appSource.includes('function toggleDialogOverlay('), 'dialogs should expose modal semantics and shared focus entry/return behavior');
    assert.ok(configSource.includes("if (e.key === 'Tab' && openOverlay)") && configSource.includes("else if (perf.classList.contains('show')) togglePerfPanel()") && configSource.includes('if (!openOverlay &&'), 'open dialogs should trap focus, close with Escape and block background arrow navigation');
    assert.ok(uiDesignSystemSource.includes('不能用 `display:none` 移除原生控件') && uiDesignSystemSource.includes('不能只依赖 `opacity` 和 `pointer-events`'), 'design system should retain the keyboard and hidden-surface constraints');
});

runTest('sector trend display stays a separate read-only workspace', () => {
    const externalTab = indexSource.indexOf('data-tab="external"');
    const indexTab = indexSource.indexOf('data-tab="index"');
    const stockTab = indexSource.indexOf('data-tab="stock"');
    assert.ok(externalTab >= 0 && externalTab < indexTab && indexTab < stockTab, 'primary navigation should be external, index, watchlist');
    assert.ok(indexSource.includes('id="marketWorkspace"'), 'A-share terminal should retain its own workspace owner');
    assert.ok(indexSource.includes('id="externalWorkspace"'), 'sector trend should have an independent workspace owner');
    assert.ok(indexSource.includes('>板块趋势</button>'), 'primary navigation should use the sector-trend name');
    assert.ok(indexSource.includes('id="externalLeadStrip"'));
    assert.ok(indexSource.includes('id="externalLeadStripMeta"'));
    assert.ok(indexSource.includes('id="sectorTrendOverview"'));
    assert.ok(indexSource.includes('id="sectorConceptHighlights"'));
    assert.ok(indexSource.includes('id="sectorTrendLeaders"'));
    assert.ok(indexSource.includes('id="sectorTrendTurning"'));
    assert.ok(indexSource.includes('id="sectorTrendMomentum"'));
    const overviewSection = indexSource.indexOf('id="sectorTrendOverview"');
    const leadersSection = indexSource.indexOf('id="sectorTrendLeaders"');
    const turningSection = indexSource.indexOf('id="sectorTrendTurning"');
    const momentumSection = indexSource.indexOf('id="sectorTrendMomentum"');
    const conceptSection = indexSource.indexOf('id="sectorConceptHighlights"');
    assert.ok(overviewSection < leadersSection && leadersSection < turningSection && turningSection < momentumSection && momentumSection < conceptSection, 'sector modules should move from confirmed trends to weaker auxiliary evidence');
    assert.ok(indexSource.includes('今日辅助观察') && indexSource.includes('不纳入行业趋势统计'), 'concept hotspots should be visibly demoted to auxiliary evidence');
    assert.ok(indexSource.includes('不参与大盘八指数、核心宽基环境、个股仓位、B/S 或收益计算'), 'sector boundary should be visible');
    assert.ok(indexSource.includes('class="icon-btn icon-btn-label" onclick="handleExternalRefresh()"'));
    assert.ok(cssSource.includes('.sector-summary-grid'));
    assert.ok(cssSource.includes('.external-env-strip'));
    assert.ok(cssSource.includes('.sector-trend-card'));
    assert.ok(cssSource.includes('.sector-trend-etf'));
    assert.ok(!cssSource.includes('.external-cache-tag'), 'snapshot freshness should not be repeated inside every card');
    assert.ok(!cssSource.includes('.sector-summary-card.is-positive') && !cssSource.includes('.sector-trend-card.is-positive'), 'read-only sector cards should not reuse conclusion-surface color bars');
    assert.ok(!cssSource.includes('border-left: 3px solid var(--yellow)'), 'concept rows should not repeat a warning-colored edge');
    assert.ok(!cssSource.includes('.sector-trend-state') && !appSource.includes('class="sector-trend-state'), 'grouped trend cards should not repeat their section-owned status');
    assert.ok(appSource.includes('aria-label="${escapeHTML(`${board.name}，${board.trendLabel}，趋势分 ${board.score}`)}"'), 'trend state should remain available to assistive technology');
    assert.ok(dataSource.includes('INDUSTRY_ETF_MAP'));
    assert.ok(dataSource.includes("CACHE_KEY: 'dg_external_lead_strip_v1'"));
    assert.ok(dataSource.includes("CACHE_KEY: 'dg_sector_trend_snapshot_v2'"));
    assert.ok(dataSource.includes("state.tab !== 'external' || document.hidden"));
    assert.ok(dataSource.includes('105.SOXX') && dataSource.includes('105.TSLA') && dataSource.includes('105.BOTZ') && dataSource.includes('105.SYM'), 'compact overnight theme evidence should cover the four mapped directions');
    assert.ok(!dataSource.includes('100.SPX'), 'the broad external-market dashboard should stay removed');
});

runTest('external environment strip maps overnight US themes without entering strategy state', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(dataSource, context);
    vm.runInContext(appSourceNoInit, context);
    vm.runInContext(`
        externalLeadStripState.cacheLoaded = true;
        externalLeadStripState.status = 'ready';
        externalLeadStripState.source = '东方财富';
        externalLeadStripState.fetchedAt = 1780000000000;
        externalLeadStripState.items = {
            soxx: sanitizeExternalLeadStripItem('soxx', { value: 300, changePct: 2.2 }),
            smh: sanitizeExternalLeadStripItem('smh', { value: 250, changePct: 1.8 }),
            nvda: sanitizeExternalLeadStripItem('nvda', { value: 180, changePct: 3.1 }),
            amd: sanitizeExternalLeadStripItem('amd', { value: 160, changePct: 1.2 }),
            qqq: sanitizeExternalLeadStripItem('qqq', { value: 500, changePct: -1.4 }),
            msft: sanitizeExternalLeadStripItem('msft', { value: 480, changePct: -1.2 }),
            tsla: sanitizeExternalLeadStripItem('tsla', { value: 320, changePct: 0.3 }),
            li: sanitizeExternalLeadStripItem('li', { value: 28, changePct: -0.2 }),
            botz: sanitizeExternalLeadStripItem('botz', { value: 35, changePct: 2.0 }),
            sym: sanitizeExternalLeadStripItem('sym', { value: 52, changePct: 1.5 })
        };
        Object.keys(externalLeadStripState.items).forEach(function(key) { externalLeadStripState.items[key].quoteAt = 1786132800000; });
        externalLeadStripState.themes = buildExternalLeadStripThemes(externalLeadStripState.items);
        var strictThemes = buildExternalLeadStripThemes({
            qqq: sanitizeExternalLeadStripItem('qqq', { value: 500, changePct: 2.2 }),
            msft: sanitizeExternalLeadStripItem('msft', { value: 480, changePct: -0.1 }),
            botz: sanitizeExternalLeadStripItem('botz', { value: 35, changePct: -0.1 }),
            sym: sanitizeExternalLeadStripItem('sym', { value: 52, changePct: 2.5 }),
            tsla: sanitizeExternalLeadStripItem('tsla', { value: 320, changePct: 2.5 }),
            nvda: sanitizeExternalLeadStripItem('nvda', { value: 180, changePct: 2.5 })
        });
        renderExternalLeadStrip();
        var externalStripResult = {
            html: document.getElementById('externalLeadStrip').innerHTML,
            meta: document.getElementById('externalLeadStripMeta').textContent,
            directions: externalLeadStripState.themes.map(function(theme) { return theme.direction; }),
            strictDirections: [strictThemes[1].direction, strictThemes[3].direction],
            rawDataKeys: Object.keys(state.rawData)
        };
    `, context);
    const result = JSON.parse(vm.runInContext('JSON.stringify(externalStripResult)', context));
    assert.strictEqual((result.html.match(/external-env-strip-item/g) || []).length, 4);
    assert.ok(result.html.includes('半导体与算力') && result.html.includes('半导体、电子元件、通信设备'));
    assert.ok(result.html.includes('AI 与云计算') && result.html.includes('可能承压'));
    assert.ok(result.html.includes('智能电动车') && result.html.includes('方向分化'));
    assert.ok(result.html.includes('机器人与智能制造') && result.html.includes('自动化设备、通用设备、专用设备'));
    assert.deepStrictEqual(result.directions, ['可能偏强', '可能承压', '方向分化', '可能偏强']);
    assert.deepStrictEqual(result.strictDirections, ['方向分化', '方向分化'], 'two-item themes need 2/2 agreement and robotics must follow its anchor');
    assert.strictEqual(result.meta, '美股 08/07 收盘');
    assert.deepStrictEqual(result.rawDataKeys, []);
});

runTest('sector trend display separates uptrends, turning boards and one-day momentum', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(dataSource, context);
    vm.runInContext(appSourceNoInit, context);
    vm.runInContext(`
        state.tab = 'external';
        state.mode = 'external';
        var snapshot = buildSectorTrendSnapshot([
            { type: 'industry', f12: 'BK1001', f14: '证券', f3: 3.2, f6: 8000000000, f8: 4.2, f24: 30, f109: 12, f160: 18, f184: 8, f104: 80, f105: 15, f106: 5, f128: '领涨股', f140: '600001', f136: 7.5 },
            { type: 'concept', f12: 'BK1002', f14: '转强概念', f3: 1.2, f6: 5000000000, f8: 3.1, f24: -3, f109: 9, f160: 6, f184: 2, f104: 60, f105: 30, f106: 10, f128: '转强股', f140: '000002', f136: 4.1 },
            { type: 'concept', f12: 'BK1003', f14: '单日异动', f3: 4.8, f6: 3000000000, f8: 5.1, f24: -10, f109: -2, f160: -4, f184: -1, f104: 65, f105: 25, f106: 10, f128: '异动股', f140: '300003', f136: 9.8 },
            { type: 'industry', f12: 'BK1004', f14: '弱势板块', f3: -1.1, f24: -8, f109: -6, f160: -8, f104: 20, f105: 70, f106: 10 },
            { type: 'industry', f12: 'BK1005', f14: '普通板块', f3: 0.1, f24: -2, f109: -3, f160: -5, f104: 48, f105: 42, f106: 10 }
        ]);
        sectorTrendState.status = 'cached';
        sectorTrendState.source = '东方财富板块行情';
        sectorTrendState.fetchedAt = 1780000000000;
        sectorTrendState.boards = snapshot.boards.map(function(board) { return { ...board, stale: true }; });
        applyIndustryEtfMappings(sectorTrendState.boards);
        sectorTrendState.concepts = buildSectorConceptSnapshot([
            { type: 'concept', f12: 'BK1002', f14: '转强概念', f3: 1.2, f24: -3, f109: 9, f160: 6, f104: 60, f105: 30, f106: 10, f128: '转强股', f140: '000002', f136: 4.1 },
            { type: 'concept', f12: 'BK1003', f14: '单日异动', f3: 4.8, f24: -10, f109: -2, f160: -4, f104: 65, f105: 25, f106: 10, f128: '异动股', f140: '300003', f136: 9.8 }
        ]).concepts.map(function(board) { return { ...board, stale: true }; });
        sectorTrendState.groups = restoreSectorTrendGroups(sectorTrendState.boards);
        sectorTrendState.summary = snapshot.summary;
        var relatedEtfMapping = getIndustryEtfMapping({ type: 'industry', name: '印制电路板' });
        renderSectorTrendSnapshot();
        var sectorDisplayResult = {
            overview: document.getElementById('sectorTrendOverview').innerHTML,
            concepts: document.getElementById('sectorConceptHighlights').innerHTML,
            leaders: document.getElementById('sectorTrendLeaders').innerHTML,
            leadersText: document.getElementById('sectorTrendLeaders').innerHTML.replace(/<[^>]*>/g, ' '),
            turning: document.getElementById('sectorTrendTurning').innerHTML,
            turningText: document.getElementById('sectorTrendTurning').innerHTML.replace(/<[^>]*>/g, ' '),
            momentum: document.getElementById('sectorTrendMomentum').innerHTML,
            meta: document.getElementById('sectorTrendMeta').textContent,
            states: sectorTrendState.boards.map(function(board) { return board.trendState; }),
            relatedEtfMapping
        };
    `, context);
    const result = JSON.parse(vm.runInContext('JSON.stringify(sectorDisplayResult)', context));
    assert.strictEqual((result.overview.match(/sector-summary-card/g) || []).length, 4);
    assert.deepStrictEqual(result.states.sort(), ['momentum', 'turning', 'uptrend']);
    assert.ok(result.leadersText.includes('证券') && !result.leadersText.includes('上涨趋势'));
    assert.ok(result.leaders.includes('中证全指证券公司指数') && result.leaders.includes('券商ETF') && result.leaders.includes('512000'));
    assert.strictEqual(result.relatedEtfMapping.relation, 'related');
    assert.strictEqual(result.relatedEtfMapping.etfCode, '515260');
    assert.ok(result.turningText.includes('转强概念') && !result.turningText.includes('刚刚转强'));
    assert.ok(result.momentum.includes('单日异动'));
    assert.ok(result.leaders.includes('领涨股') && result.leaders.includes('600001'));
    assert.ok(result.leaders.includes('失效观察'));
    assert.ok(!result.leaders.includes('external-cache-tag') && !result.concepts.includes('external-cache-tag'), 'shared snapshot cache state should only appear at workspace level');
    assert.ok(result.concepts.includes('转强概念') && result.concepts.includes('单日异动'));
    assert.ok(result.concepts.includes('转强股') && result.concepts.includes('300003'));
    assert.ok(result.meta.includes('5/10/60日趋势'));
    const visibleCards = [result.leaders, result.turning, result.momentum].join(' ');
    assert.ok(!visibleCards.includes('selectStock('), 'active stocks must stay read-only');
    assert.ok(!visibleCards.includes('建议仓位') && !visibleCards.includes('买入建议'));
});

runTest('sector trend workspace status exposes partial and cached availability', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(dataSource, context);
    vm.runInContext(appSourceNoInit, context);
    const result = JSON.parse(vm.runInContext(`JSON.stringify((function() {
        sectorTrendState.status = 'ready';
        sectorTrendState.error = '';
        const ready = getSectorTrendWorkspaceStatus();
        sectorTrendState.status = 'partial';
        sectorTrendState.error = '2个前排板块暂未补齐活跃个股';
        const partial = getSectorTrendWorkspaceStatus();
        sectorTrendState.status = 'cached';
        sectorTrendState.error = '板块列表请求超时';
        const cached = getSectorTrendWorkspaceStatus();
        return { ready, partial, cached };
    })())`, context));
    assert.deepStrictEqual(result.ready, { key: 'ready', error: '' });
    assert.deepStrictEqual(result.partial, { key: 'partial', error: '2个前排板块暂未补齐活跃个股' });
    assert.deepStrictEqual(result.cached, { key: 'cached', error: '板块列表请求超时' });
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
    assert.ok(indexSource.includes('数据刷新于 <span id="lastRefreshTime">'), 'refresh timestamp should use concise shared copy');
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
    assert.ok(scriptSource.includes("stopRefreshSchedulers('performance-isolation')"), 'fixed interaction samples should exclude recurring scheduler overlap');
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
    assert.ok(scriptSource.includes('observationLongTaskMax'), 'post-action long tasks should participate in pass/fail budgets');
    assert.ok(scriptSource.includes('MIN_P95_SAMPLES = 20'), 'p95 should require a statistically meaningful sample count');
    assert.ok(scriptSource.includes("gateStatistic: enoughForP95 ? 'p95' : 'max'"), 'small samples should be gated and labelled as max rather than p95');
    assert.ok(scriptSource.includes('RESOURCE_BUDGETS'), 'performance governance should protect request and resource growth');
    assert.ok(scriptSource.includes('collectResourceFootprint'), 'performance reports should capture same-origin resource footprint');
    assert.ok(scriptSource.includes('MEASUREMENT_ENVIRONMENT_LIMITS'), 'performance reports should reject host-load-contaminated measurements');
    assert.ok(scriptSource.includes('measurementEnvironment.valid'), 'host-load validity should remain separate from product budget results');
    assert.ok(scriptSource.includes('deliberateBlockedRequests'), 'test-isolated blocked requests should stay separate from real external failures');
    assert.ok(scriptSource.includes("args.has('--summary')"), 'performance reporting should expose a compact machine-readable mode');
    assert.ok(scriptSource.includes('buildCompactReport'), 'compact reporting should preserve summaries without printing every trace');
    assert.ok(scriptSource.includes("traceLabel: 'startup'"), 'cold performance reporting should expose the startup trace');
    assert.ok(scriptSource.includes('startupTraces'), 'cold performance reporting should expose nested startup traces');
    assert.ok(scriptSource.includes('longTaskTraceMatches'), 'cold performance reporting should correlate long tasks with overlapping traces');
    assert.ok(scriptSource.includes('observationLongTaskTraceMatches'), 'interaction reporting should correlate delayed long tasks with collected traces');
    assert.ok(!scriptSource.includes('fonts.googleapis') && !scriptSource.includes('fonts.gstatic'), 'performance budget should not depend on external font loading');
    assert.ok(scriptSource.includes('JSON.stringify'), 'performance budget should print machine-readable JSON');
});

runTest('stability governance covers startup degradation lifecycle and bounded long runs', () => {
    const scriptSource = read('scripts/stability-governance.js');
    assert.ok(scriptSource.includes("['normal', 'missing', 'throw', 'blocked', 'timeout', 'fatal']"), 'startup stability should cover recoverable storage modes, an open timeout, and a terminal failure');
    assert.ok(scriptSource.includes('Page.backForwardCacheNotUsed'), 'lifecycle evidence should record why browser back-forward cache was not exercised');
    assert.ok(scriptSource.includes('persistedPageshow'), 'lifecycle evidence should inspect persisted page returns');
    assert.ok(scriptSource.includes('leadershipHeartbeats'), 'lifecycle and soak checks should protect the market-refresh heartbeat singleton');
    assert.ok(scriptSource.includes('HeapProfiler.collectGarbage'), 'soak comparisons should use forced-GC heap checkpoints');
    assert.ok(scriptSource.includes('Memory.getDOMCounters'), 'soak comparisons should include DOM and listener counts');
    assert.ok(scriptSource.includes('RUNTIME_BUFFER_BUDGETS'), 'soak checks should gate application caches and diagnostic buffers explicitly');
    assert.ok(scriptSource.includes('heapGrowth <= 0.15'), 'soak heap growth should have an explicit gate');
    assert.ok(scriptSource.includes("args.has('--summary')") && scriptSource.includes('compactStabilityResult'), 'stability reporting should expose a compact evidence mode');
    assert.ok(scriptSource.includes("desktop: { width: 1440, height: 900, chartCount: 4, defaultMinutes: 60 }"), 'desktop soak should default to 60 minutes');
    assert.ok(scriptSource.includes("mobile: { width: 390, height: 844, chartCount: 1, defaultMinutes: 30 }"), 'mobile soak should default to 30 minutes');
});

runTest('performance governance exposes supported viewports storage failures and strategy inspector coverage', () => {
    const scriptSource = read('scripts/performance-budget.js');
    ['mobile', 'compact-boundary', 'desktop-boundary', 'desktop'].forEach(viewport => {
        assert.ok(scriptSource.includes(`${viewport}:`) || scriptSource.includes(`'${viewport}':`), `missing ${viewport} performance viewport`);
    });
    assert.ok(scriptSource.includes('--viewport'), 'performance budget should expose a viewport selector');
    assert.ok(scriptSource.includes('--storage'), 'performance budget should expose storage failure profiles');
    ['missing', 'throw', 'blocked', 'timeout'].forEach(mode => assert.ok(scriptSource.includes(`'${mode}'`), `missing ${mode} storage profile`));
    assert.ok(scriptSource.includes('--network'), 'performance budget should expose a slow-network profile');
    assert.ok(scriptSource.includes("inspector: ['strategy-inspector-load']"), 'strategy inspector should have an explicit profile');
    assert.ok(scriptSource.includes('runInspectorProfile'), 'strategy inspector performance should run in fresh contexts');
    assert.ok(scriptSource.includes("const compactMobile = matchMedia('(max-width: 1023px)').matches"), 'stock readiness should validate the compact one-chart mobile path');
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
    assert.ok(appSource.includes("compactMobile ? 'initial-mobile-index-ready' : 'initial-index-ready'"), 'startup trace should distinguish mobile and desktop readiness after the initial index is ready');
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

runTest('right panel rejects stale wave governance decisions before rendering', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(dataSource, context);
    vm.runInContext(calcSource, context);
    vm.runInContext(renderSource, context);
    vm.runInContext(`
        state.mode = 'stock';
        state.id = '1.600000';
        state.stockId = '600000';
        state.strategy = '波段抄底型';
        state.period = 'daily';
        state.rawData['1.600000'] = [{
            date: '2026-07-13', open: 9.60, high: 9.78, low: 9.48, close: 9.69, vol: 1000, amt: 10000,
            _strategy: state.strategy,
            _signalVersion: SIGNAL_VERSION,
            _decision: { position: 0, bsMark: 'S', simpleAction: '规避风险', waveGovernanceVersion: 'wave-regime-v3' }
        }];
        state.lockIdx = 0;
        var recomputeCount = 0;
        var renderedDecision = null;
        updateAllIndicators = function(idx) {
            recomputeCount++;
            var row = getActiveData()[idx];
            row._strategy = state.strategy;
            row._signalVersion = SIGNAL_VERSION;
            row._decision = { position: 30, bsMark: null, simpleAction: '持有观察', waveGovernanceVersion: WAVE_GOVERNANCE_VERSION };
        };
        generateSidebarBundle = function(item) {
            renderedDecision = item._decision;
            return { priceHtml: '', analysisHtml: '', isHide: false };
        };
        applySidebarHTML = function() {};
        updateNavCapsuleVisuals = function() {};
        safeUpdateSidebar();
    `, context);
    const result = JSON.parse(vm.runInContext('JSON.stringify({ recomputeCount, renderedDecision })', context));
    assert.strictEqual(result.recomputeCount, 1, 'stale governance decisions should trigger an indicator rebuild');
    assert.strictEqual(result.renderedDecision.position, 30, 'right panel should render the rebuilt position');
    assert.strictEqual(result.renderedDecision.bsMark, null, 'right panel should not render the stale sell marker');
    assert.strictEqual(result.renderedDecision.waveGovernanceVersion, vm.runInContext('WAVE_GOVERNANCE_VERSION', context));
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
    assert.strictEqual(trialSummary.state, '试用确认买点');
    assertPresentationSummary(trialSummary);
    assert.ok(!/\b[BLW]\d+\b/.test(`${trialSummary.state} ${trialSummary.why} ${trialSummary.positionWhy} ${trialSummary.nextFocus}`));
    assert.strictEqual(trialSummary.why, 'KDJ 金叉确认短期动量修复；超跌止跌反弹确认修复形态');
    const strongSummary = JSON.parse(vm.runInContext('JSON.stringify(strongSummary)', context));
    assert.strictEqual(strongSummary.state, '强确认买点');
    assertPresentationSummary(strongSummary);
    assert.ok(!/\b[BLW]\d+\b/.test(`${strongSummary.state} ${strongSummary.why} ${strongSummary.positionWhy} ${strongSummary.nextFocus}`));
    assert.strictEqual(strongSummary.why, 'MACD底背离确认；周线支撑共同确认');
    assert.ok(renderSource.includes("ctx.strokeText('B', px, markerY);") && renderSource.includes("ctx.fillText('B', px, markerY);"), 'daily chart must keep the B glyph for strong metadata');
    assert.ok(renderSource.includes("const isGoldBuy = ['trial', 'strong'].includes(d._decision.bQuality);"), 'daily chart must distinguish trial and approved B with gold');
    assert.ok(renderSource.includes("ctx.fillStyle = isGoldBuy ? (getCssVar('--yellow') || '#f5a623') : colorUpHex;"), 'daily chart must render gold B with gold');
    assert.ok(renderSource.includes("state.period === 'weekly'"), 'weekly chart must continue to suppress B/S markers');
});

runTest('build version is bumped consistently', () => {
    assert.ok(strategyConfigSource.includes(`const APP_BUILD = '${VERSION.appBuild}';`));
    assert.ok(strategyConfigSource.includes(`const SIGNAL_VERSION = '${VERSION.signalVersion}';`));
    const strategySnapshots = loadStrategyBaselineSnapshots();
    assert.ok(!Object.prototype.hasOwnProperty.call(strategySnapshots, 'appBuild'), 'UI APP_BUILD must not invalidate strategy snapshots');
    assert.strictEqual(strategySnapshots.signalVersion, VERSION.signalVersion, 'strategy snapshots must remain tied to SIGNAL_VERSION');
    const versions = [...indexSource.matchAll(/[?&]v=(\d{8}-\d{2})/g)].map((match) => match[1]);
    assert.ok(versions.length >= 11, 'expected vendor, CSS, strategy config, core data, observation data, application, settings, and refresh controller version parameters');
    assert.deepStrictEqual([...new Set(versions)], [VERSION.resourceVersion]);
    const inspectorVersions = [...strategyInspectorSource.matchAll(/[?&]v=(\d{8}-\d{2})/g)].map((match) => match[1]);
    assert.ok(inspectorVersions.length >= 3, 'strategy inspector must version its CSS, strategy config, and renderer');
    assert.deepStrictEqual([...new Set(inspectorVersions)], [VERSION.resourceVersion]);
    assert.ok(indexSource.indexOf('assets/js/00-strategy-config.js') < indexSource.indexOf('assets/js/01-config-ui.js'), 'production strategy config must load before UI state');
    assert.ok(indexSource.indexOf('assets/js/02-data.js') < indexSource.indexOf('assets/js/02-observation-data.js'), 'core market data must load before the observation data layer');
    assert.ok(indexSource.indexOf('assets/js/02-observation-data.js') < indexSource.indexOf('assets/js/03-calculations.js'), 'observation data must load before application calculations and lifecycle scripts');
    // 03 核心算法层已按职责拆分为多个 03-*.js；它们必须保持切分顺序，且整体在渲染层之前加载。
    const calcModuleOrder = [
        'assets/js/03-calculations.js',
        'assets/js/03-explain.js',
        'assets/js/03-summary.js',
        'assets/js/03-wave-regime.js',
        'assets/js/03-wave-rejection.js',
        'assets/js/03-decision.js'
    ];
    const calcModuleIndexes = calcModuleOrder.map(file => indexSource.indexOf(file));
    assert.ok(calcModuleIndexes.every(idx => idx > 0), 'all split 03-*.js calculation modules must be present in index.html');
    for (let i = 1; i < calcModuleIndexes.length; i++) {
        assert.ok(calcModuleIndexes[i - 1] < calcModuleIndexes[i], `${calcModuleOrder[i]} must load after ${calcModuleOrder[i - 1]} to preserve split order`);
    }
    assert.ok(calcModuleIndexes[calcModuleIndexes.length - 1] < indexSource.indexOf('assets/js/04-render.js'), 'all calculation modules must load before the render layer');
    assert.ok(indexSource.indexOf('assets/js/06-settings.js') < indexSource.indexOf('assets/js/07-refresh-controller.js'), 'refresh controller must load after settings controller');
    assert.ok(strategyInspectorSource.includes('assets/js/00-strategy-config.js') && !/<script[^>]+assets\/js\/01-config-ui\.js/.test(strategyInspectorSource), 'strategy inspector must read production strategy config without initializing the main application UI');
    assert.ok(indexSource.includes(`assets/vendor/chart.umd.min.js?v=${VERSION.resourceVersion}`), 'Chart.js should load from local vendor first');
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

runTest('header and desktop sidebars share default and narrow-desktop column tokens', () => {
    assert.ok(cssSource.includes('--nav-width: 260px;') && cssSource.includes('--info-width: 350px;'), 'default desktop columns should stay 260px/350px');
    assert.ok(cssSource.includes('grid-template-columns: var(--nav-width) minmax(0, 1fr) var(--info-width);'), 'header should consume the shared column tokens');
    assert.ok(cssSource.includes('.nav-section { width: var(--nav-width);'), 'left sidebar should consume the shared column token');
    assert.ok(cssSource.includes('.info-section { width: var(--info-width);'), 'right sidebar should consume the shared column token');
    assert.ok(cssSource.includes('@media (min-width: 1024px) and (max-width: 1180px)') &&
        cssSource.includes('--nav-width: 248px;') && cssSource.includes('--info-width: 338px;'), '1024px narrow desktop should use the governed compact columns');
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

runTest('scrollable dialogs avoid backdrop blur during scrolling', () => {
    assert.ok(cssSource.includes('#settingsOverlay, #helpOverlay, #perfOverlay { background: rgba(11,14,20,0.92); backdrop-filter: none; -webkit-backdrop-filter: none; }'), 'scrollable dialogs should disable backdrop blur to avoid expensive background redraws');
});

runTest('decision evidence panel uses novice-readable why/action copy', () => {
    assert.ok(renderSource.includes('function getNoviceEvidenceCopy('), 'missing novice evidence copy helper');
    assert.ok(renderSource.includes('仅作市场背景参考'), 'stock market evidence must present core breadth as background only');
    // 个股仓位本就不受核心宽基约束，因此不得再逐个环境声明“不限制个股仓位”这条并不存在的限制。
    assert.ok(!renderSource.includes('不限制个股仓位'), 'stock evidence must not explain a limit that no longer exists');
    assert.ok(!renderSource.includes('未触发额外截断') && !renderSource.includes('核心宽基环境未限制'), 'index evidence must not narrate a cap that did not apply');
    assert.ok(renderSource.includes('核心宽基偏弱') && renderSource.includes('普通机会') && renderSource.includes('指数自身独立走强') && renderSource.includes('marketGate.cap'), 'index evidence must explain tiered increase caps when one actually applies');
    assert.ok(renderSource.includes('买入依据') && renderSource.includes('未买入原因'), 'signal evidence must explain buy/no-buy reason');
    assert.ok(renderSource.includes('防守依据') && renderSource.includes('防守位'), 'defensive evidence must explain structural basis');
    assert.ok(renderSource.includes('noviceEvidence.marketHint'), 'market hint must be rendered');
    assert.ok(renderSource.includes('noviceEvidence.signalHint'), 'signal hint must be rendered');
    assert.ok(renderSource.includes('noviceEvidence.guardHint'), 'guard hint must be rendered');
});

runTest('conclusion copy never narrates a limit that did not apply', () => {
    // 只清理“说了但不生效”的描述：风险评估没有压低仓位、市场没有截断时，不得出现任何限制句。
    assert.ok(!calcSource.includes('风险评估未限制'), 'position path must omit the risk line when risk did not cap the position');
    assert.ok(!calcSource.includes('风险评估未额外下调'), 'position path must not claim risk made no adjustment');
    assert.ok(!calcSource.includes('未超过市场新增风险上限'), 'stock and index paths must not cite an untriggered market cap');
    assert.ok(!calcSource.includes('风险评估暂按原值处理'), 'position path must not narrate an inert risk step');
    assert.ok(!calcSource.includes('大盘虽偏好'), 'stock conclusions must not frame the no-entry reason around market mood');
    assert.ok(!calcSource.includes('isFavorableMarket'), 'the retired favorable-market branch must be gone');
    assert.ok(calcSource.includes('本次提高仓位由个股信号与趋势决定') && calcSource.includes('本次提高风险仓位由指数自身动能与趋势决定'), 'an unconstrained increase must still say what drove it');
});

runTest('strong exits reset the effective score in stock and index evidence', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(calcSource, context);
    vm.runInContext(renderSource, context);
    vm.runInContext(`
        Object.assign(STRATEGY, STRATEGIES['稳健趋势型']);
        var exitMeta = { windowScore: STRATEGY.buyThreshold, exitSignals: ['L3'], warningSignals: [], inCooldown: false };
        var exitDecision = {
            position: 0, prevAdv: 80, simpleAction: '清仓离场',
            market: { label: '核心宽基分化' },
            risk: { flags: [], stop: 96 },
            exit: { level: '强离场' }
        };
        var stockExitEvidence = getNoviceEvidenceCopy(exitMeta, exitDecision, '强离场', 'MACD死叉', 'stock');
        var indexExitEvidence = getNoviceEvidenceCopy(exitMeta, exitDecision, '强离场', 'MACD死叉', 'index');
    `, context);
    const stock = JSON.parse(vm.runInContext('JSON.stringify(stockExitEvidence)', context));
    const index = JSON.parse(vm.runInContext('JSON.stringify(indexExitEvidence)', context));
    assert.strictEqual(stock.scoreText, `0/${JSON.parse(vm.runInContext('JSON.stringify(STRATEGY.buyThreshold)', context))}`);
    assert.ok(stock.signalHint.includes('此前买入依据已失效') && stock.signalHint.includes(stock.scoreText), stock.signalHint);
    assert.strictEqual(index.scoreText, stock.scoreText);
    assert.ok(index.signalHint.includes('此前动能依据已失效') && index.signalHint.includes(index.scoreText), index.signalHint);
});

runTest('market context UI stays an environment browser instead of a position suggestion', () => {
    assert.ok(appSource.includes('核心宽基环境'), 'market context card must name the core breadth environment');
    assert.ok(!appSource.includes('market.increaseCaps'), 'browsing card must not render index increase caps as a standing number');
    assert.ok(!appSource.includes('指数新增风险'), 'browsing card must not label a number as an index risk allowance');
    assert.ok(appSource.includes('核心宽基') && appSource.includes('仅观察'), 'index rows must distinguish environment inputs from observation-only indices');
    assert.ok(!appSource.includes('环境核心'), 'index rows must reuse the single core-breadth term instead of a second synonym');
    assert.ok(appSource.includes("renderLeftListHeader('市场与板块指数')"), 'left list title must cover market and board indices');
    assert.ok(cssSource.includes('.market-gate-panel') && cssSource.includes('.market-core-grid'), 'core gate module must use the compact layout');
    assert.ok(!cssSource.includes('.market-gate-panel .action-cap'), 'the retired cap slot must not keep dead styling');
    assert.ok(!appSource.includes('建议仓位上限'), 'market context must not present a holding cap');
    assert.ok(indexSource.includes('先看状态') && indexSource.includes('再看动作') && indexSource.includes('最后看风险'), 'help copy must keep the compact daily-use path');
    assert.ok(indexSource.includes('strategy-inspector.html') && indexSource.includes('查看完整策略说明'), 'help copy must route advanced strategy details to the standalone inspector');
    assert.ok(!indexSource.includes('决定市场环境系数和仓位上限'), 'help copy must not describe the retired multiplier model');
});

runTest('core breadth card shows only the environment, never a standing cap number', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(calcSource, context);
    vm.runInContext(appSourceNoInit, context);
    vm.runInContext(`
        var trends = [
            { id: 'hs300', name: '沪深300', state: '空头', score: -1 },
            { id: 'zz500', name: '中证500', state: '空头', score: -1 },
            { id: 'zz1000', name: '中证1000', state: '震荡', score: 0 }
        ];
        var cases = {
            weak: { label: '核心宽基偏弱', cls: 'bear', increaseCaps: { ordinary: 30, independent: 50 }, reason: '三项核心宽基多数空头；指数普通机会新增风险上限 30%', trends: trends },
            blocked: { label: '环境待确认', cls: 'neutral', increaseCaps: { ordinary: 0, independent: 0 }, reason: '三项核心宽基尚未补齐，指数暂停增加风险', trends: trends },
            open: { label: '核心宽基偏强', cls: 'bull', increaseCaps: null, reason: '三项核心宽基多数走强，指数新增风险不受限', trends: trends }
        };
        var rendered = {};
        Object.keys(cases).forEach(function(name) {
            getMarketContext = function() { return cases[name]; };
            updateLeftMarketContext('2026-07-21');
            rendered[name] = document.getElementById('leftMarketContext').innerHTML;
        });
    `, context);
    const rendered = JSON.parse(vm.runInContext('JSON.stringify(rendered)', context));
    // 卡片只做浏览：环境标签、指数口径说明和三项核心宽基状态；不再有独立的上限数字栏。
    for (const [name, html] of Object.entries(rendered)) {
        assert.ok(!html.includes('action-cap'), `${name} must not keep the retired cap slot`);
        assert.ok(!html.includes('独立走强'), `${name} must not surface the near-unused independent tier: ${html}`);
        assert.ok(html.includes('沪深300') && html.includes('中证500') && html.includes('中证1000'), `${name} must keep the three core breadth states`);
    }
    assert.ok(rendered.weak.includes('核心宽基偏弱') && rendered.weak.includes('指数普通机会新增风险上限 30%'), rendered.weak);
    assert.ok(rendered.blocked.includes('环境待确认') && rendered.blocked.includes('指数暂停增加风险'), rendered.blocked);
    assert.ok(rendered.open.includes('核心宽基偏强') && rendered.open.includes('指数新增风险不受限'), rendered.open);
});

runTest('core breadth reasons describe the index path only', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(dataSource, context);
    vm.runInContext(calcSource, context);
    vm.runInContext(`
        var reasons = [];
        var trendStub = {};
        getIndexTrend = function(id) {
            if (!(id in trendStub)) return null;
            var score = trendStub[id];
            return { id: id, name: id, state: score > 0 ? '多头' : (score < 0 ? '空头' : '震荡'), score: score };
        };
        function reasonFor(stub) {
            trendStub = stub;
            return getMarketContext('2026-07-21').reason;
        }
        var ids = CORE_MARKET_INDEX_IDS;
        reasons.push(reasonFor({ [ids[0]]: -1, [ids[1]]: -1, [ids[2]]: 0 }));
        reasons.push(reasonFor({ [ids[0]]: 1, [ids[1]]: 1, [ids[2]]: 0 }));
        reasons.push(reasonFor({ [ids[0]]: 1, [ids[1]]: -1, [ids[2]]: 0 }));
        reasons.push(reasonFor({ [ids[0]]: -1 }));
        reasons.push(reasonFor({}));
    `, context);
    const reasons = JSON.parse(vm.runInContext('JSON.stringify(reasons)', context));
    assert.strictEqual(reasons.length, 5);
    // 该文案只在大盘页的核心宽基环境卡片出现，不能再提个股，否则又变成“说了但不生效”的限制描述。
    for (const reason of reasons) {
        assert.ok(!reason.includes('个股'), `core breadth reason must not mention stock positions: ${reason}`);
        assert.ok(!reason.includes('标的'), `core breadth reason must stay index-scoped: ${reason}`);
    }
    assert.ok(reasons[0].includes('指数普通机会新增风险上限 30%'), reasons[0]);
    // independent 档在全量回放里只占偏弱 bar 的 0.09%，不放进常驻 reason，避免读成常见分档。
    assert.ok(!reasons[0].includes('独立走强'), `browsing reason must not advertise the near-unused independent tier: ${reasons[0]}`);
    assert.ok(reasons[1].includes('指数新增风险不受限'), reasons[1]);
    assert.ok(reasons[2].includes('不额外限制指数新增风险'), reasons[2]);
    assert.ok(reasons[3].includes('指数暂停增加风险'), reasons[3]);
    assert.ok(reasons[4].includes('指数暂停增加风险'), reasons[4]);
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
    assert.ok(guardHint.includes('防守依据'));
    assert.ok(!guardHint.includes('降低仓位'));
});

runTest('right panel keeps one decision card and lightweight evidence rows', () => {
    assert.ok(!renderSource.includes('class="decision-invalid"'), 'invalidation condition should not render as a standalone component');
    assert.ok(!renderSource.includes('decision.positionDriver ?'), 'decision card should not repeat the position driver in a second box');
    assert.ok(renderSource.includes('<div class="decision-reason-block">'), 'decision cause and position path should share one conclusion block');
    assert.ok((renderSource.match(/<div class="decision-reason-row">/g) || []).length >= 3, 'decision block should contain three uniform rows');
    assert.ok(renderSource.includes('<span>为什么这么做：</span>'), 'decision block should explain the action');
    assert.ok(renderSource.includes('const positionWhyLabel = `为什么是${noviceSummary.positionText}`'), 'stock and index conclusions should both show the actual position in the label');
    assert.ok(renderSource.includes('<span>${escapeHTML(positionWhyLabel)}：</span>'), 'position changes should expose why the current position is used');
    assert.ok(!renderSource.includes("UI.sectionTitle('历史信号说明', 'text-main')"), 'historical KDJ detail should move out of the daily panel');
    assert.ok(!renderSource.includes('why: `${baseNoviceSummary.why || baseNoviceSummary.reason}。${kdjScoreClarification}`'), 'historical KDJ clarification should not be appended to the main conclusion');
    assert.ok(renderSource.includes('<span>接下来关注：</span>'), 'decision block should keep an explicit next-focus row');
    assert.ok(!renderSource.includes('decision-reason-main') && !renderSource.includes('decision-position-path'), 'conclusion rows should not have one-off typography variants');
    assert.ok(!renderSource.includes('class="position-explanation"'), 'position path should not render as a nested standalone card');
    assert.ok(cssSource.includes('.decision-reason-block') && cssSource.includes('.decision-reason-row'), 'integrated conclusion block styles should be present');
    assert.ok(cssSource.includes('grid-template-columns: 7.5em minmax(0, 1fr)'), 'conclusion rows should share one label column');
    assert.ok(renderSource.includes('<div class="decision-evidence-list">'), 'evidence should use one lightweight list');
    assert.ok(renderSource.includes('<span>${evidenceTitle1}</span>'), 'market evidence needs a mode-specific leading label');
    assert.ok(renderSource.includes('${escapeHTML(noviceEvidence.marketHint)}'), 'market evidence must keep the novice explanation');
    assert.ok(renderSource.includes('<span>${evidenceTitle2}</span>'), 'signal evidence needs a leading label');
    assert.ok(renderSource.includes('${escapeHTML(noviceEvidence.scoreText)}'), 'signal evidence must show the effective decision score');
    assert.ok(renderSource.includes('${escapeHTML(noviceEvidence.signalHint)}'), 'signal evidence must keep the novice explanation');
    assert.ok(renderSource.includes('<span>${evidenceTitle3}</span>'), 'guard evidence needs a mode-specific leading label');
    assert.ok(renderSource.includes('${escapeHTML(noviceEvidence.guardHint)}'), 'guard evidence must keep the defensive instruction');
    assert.ok(cssSource.includes('.decision-evidence-row') && cssSource.includes('border-bottom'), 'evidence rows should use separators instead of nested cards');
    assert.ok(!cssSource.includes('.evidence-detail {'), 'nested evidence cards should be removed');
    assert.ok(!renderSource.includes('<details class="terminal-block signal-disclosure">'), 'daily panel should not render a duplicate technical detail section');
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
    assert.ok(panelText.includes('市场防守'), panelText);
    assert.ok(!panelText.includes('风险仓位计算链') && !panelText.includes('今日 · 计分 +3'), panelText);
    assert.ok(!renderSource.includes('技术细节') && !renderSource.includes('今日原始信号') && !renderSource.includes('指数动能与离场窗口'), 'daily panel should leave technical trace to the standalone strategy page');
    assert.ok(!cssSource.includes('.position-calculation-copy'), 'daily panel should not keep duplicate technical detail styles');
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
        var stockSummary = getNoviceDecisionSummary(meta, full[64]._decision, 'stock');
        var indexSummary = getNoviceDecisionSummary(meta, full[64]._decision, 'index');
        var after = { position: full[64]._decision.position, bsMark: full[64]._decision.bsMark };
    `, context);
    const stockText = vm.runInContext('stockText', context);
    const indexText = vm.runInContext('indexText', context);
    assertPresentationSummary(JSON.parse(vm.runInContext('JSON.stringify(stockSummary)', context)));
    assertPresentationSummary(JSON.parse(vm.runInContext('JSON.stringify(indexSummary)', context)), { index: true });
    assert.ok(stockText.includes('为什么是80%'), stockText);
    assert.ok(indexText.includes('为什么是80%'), indexText);
    assert.ok(stockText.includes('个股每日结论') && stockText.includes('策略参考仓位') && stockText.includes('买入依据'), stockText);
    assert.ok(stockText.includes('市场背景') && stockText.includes('仅作市场背景参考'), stockText);
    assert.ok(!stockText.includes('不限制个股仓位') && !stockText.includes('风险评估未限制'), stockText);
    assert.ok(indexText.includes('大盘每日结论') && indexText.includes('当前风险仓位') && indexText.includes('动能依据'), indexText);
    assert.ok(indexText.includes('核心宽基环境') && indexText.includes('指数自身独立走强') && indexText.includes('50%'), indexText);
    assert.ok(indexText.includes('指数自身动能') && indexText.includes('市场环境/防守'), indexText);
    assert.ok(!indexText.includes('风险仓位计算链'), indexText);
    assert.ok(!indexText.includes('个股信号') && !indexText.includes('买入依据') && !indexText.includes('持仓依据'), indexText);
    assert.deepStrictEqual(vm.runInContext('after', context), vm.runInContext('before', context));
});

runTest('wave conclusion keeps only the useful environment row and hides empty-position defense', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(dataSource, context);
    vm.runInContext('function convertDailyToWeekly() { return []; }', context);
    vm.runInContext(calcSource, context);
    vm.runInContext(renderSource, context);
    vm.runInContext(`
        setActiveStrategy('波段抄底型');
        state.mode = 'stock';
        state.period = 'daily';
        state.indicators = { ma: {}, macd: null, rsi: null, kdj: null };
        var full = Array.from({ length: 70 }, (_, i) => ({ date: 'D' + i, open: 100, high: 102, low: 98, close: 100, vol: 1000, _signals: [] }));
        var decision = {
            basePosition: 30, position: 0, prevAdv: 0, bsMark: null, simpleAction: '持币观望', simpleColorClass: 'text-dim',
            market: { label: '核心宽基分化', cls: 'neutral', trends: [] }, marketGate: { type: 'open' },
            risk: { level: '低波动/偏离', score: 88, coef: 1, flags: [], stop: 96, pressure: 108 },
            exit: { level: '无明确离场', detail: '暂无明确离场依据' }, positionCap: null,
            waveContext: { inScope: true, regime: 'transition', regimeLabel: '过渡', stage: 'flat', positionLayer: 0, frozenHardDefense: null }
        };
        full[64]._decision = decision;
        var meta = { windowScore: 3, windowScoreSignals: [], windowSignals: [], buySignals: [], exitSignals: [], warningSignals: [], inCooldown: false, allSignals: {} };
        var emptyHtml = generateAnalysisHTML(64, full, meta);
        var emptyText = emptyHtml.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        var blockedMeta = { ...meta, windowScore: 7 };
        full[64]._decision = { ...decision, signalReady: true, waveContext: { ...decision.waveContext, mainEvent: '过渡环境未满足首次建仓资格', nextCondition: '等待环境完成确认' } };
        var blockedSummary = getStockDecisionSummary(blockedMeta, full[64]._decision);
        full[64]._decision = { ...decision, position: 30, simpleAction: '轻仓持有', simpleColorClass: 'text-info', waveContext: { ...decision.waveContext, stage: 'entry', positionLayer: 30, frozenHardDefense: 95 } };
        var holdingHtml = generateAnalysisHTML(64, full, meta);
    `, context);
    const emptyHtml = vm.runInContext('emptyHtml', context);
    const emptyText = vm.runInContext('emptyText', context);
    const blockedSummary = JSON.parse(vm.runInContext('JSON.stringify(blockedSummary)', context));
    const holdingHtml = vm.runInContext('holdingHtml', context);
    assert.ok(!emptyText.includes('当前环境：'), emptyText);
    assert.ok(!emptyText.includes('当前阶段：') && !emptyText.includes('仓位构成：') && !emptyText.includes('下一动作条件：') && !emptyText.includes('flat'), emptyText);
    assert.ok(!emptyHtml.includes('<span>硬防守位</span>') && !emptyHtml.includes('<span>防守位</span>'), emptyHtml);
    assert.ok(holdingHtml.includes('<span>硬防守位</span>'), holdingHtml);
    assert.ok(blockedSummary.why.includes('买入积分已达到 7/4') && blockedSummary.why.includes('过渡环境未满足首次建仓资格'), blockedSummary.why);
    assert.ok(!blockedSummary.why.includes('积分只有'), blockedSummary.why);
    assert.ok(blockedSummary.nextFocus.includes('等待环境完成确认'), JSON.stringify(blockedSummary));
    assert.strictEqual(blockedSummary.positionWhyCode, 'wave-entry-blocked', JSON.stringify(blockedSummary));
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
    assert.ok(!panelText.includes('2026-05-28触发') && !panelText.includes('2026-05-29死叉失效') && !panelText.includes('不计分'), panelText);
    assert.ok(!panelText.includes('KDJ金叉有效信号'), panelText);
    assert.deepStrictEqual(vm.runInContext('after', context), vm.runInContext('before', context));
});

runTest('historical KDJ detail stays folded while the dated cause remains in the conclusion', () => {
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
            date: '2026-07-' + String(i + 1).padStart(2, '0'),
            close: 3.32,
            high: 3.38,
            low: 3.26,
            open: 3.30,
            vol: 1000,
            _signals: []
        }));
        full[62].date = '2026-07-22';
        full[63].date = '2026-07-23';
        full[64].date = '2026-08-03';
        full[64]._decision = {
            basePosition: 80,
            position: 30,
            prevAdv: 30,
            bsMark: null,
            signalReady: true,
            simpleAction: '轻仓持有',
            simpleColorClass: 'text-info',
            market: { label: '核心宽基偏弱', cls: 'bear' },
            marketGate: { type: 'increase-capped', cap: 30, strengthTier: 'ordinary', detail: '普通机会新增风险上限30%' },
            risk: { level: '低波动/偏离', score: 86, coef: 1, flags: [], stop: 3.21, pressure: 3.48 },
            exit: { level: '无明确离场', detail: '暂无明确离场依据' },
            positionCap: { limit: 50, reason: '个股尚未形成完整多头结构，高仓位上限50%' }
        };
        state.indicators = {
            ma: {},
            macd: { diff: [], dea: [] },
            rsi: { val: [] },
            kdj: {
                k: Array.from({ length: 70 }, () => 18),
                d: Array.from({ length: 70 }, () => 14),
                j: Array.from({ length: 70 }, () => 26)
            }
        };
        var meta = {
            currentDay: 64,
            currentDate: '2026-08-03',
            currentClose: 3.32,
            windowScore: 4,
            windowScoreSignals: [
                { day: 62, dayOffset: 2, signalDate: '2026-07-22', signal: 'B16', score: 3 },
                { day: 63, dayOffset: 1, signalDate: '2026-07-23', signal: 'B8', score: 1 }
            ],
            windowSignals: [
                { day: 62, signal: 'B16' },
                { day: 63, signal: 'B8' }
            ],
            invalidatedWindowSignals: [],
            buySignals: ['B16', 'B8'],
            exitSignals: [],
            warningSignals: [],
            inCooldown: false,
            allSignals: {}
        };
        var summary = getNoviceDecisionSummary(meta, full[64]._decision, 'stock');
        var panelHtml = generateAnalysisHTML(64, full, meta);
        var conclusionStart = panelHtml.indexOf('decision-reason-block');
        var conclusionEnd = panelHtml.indexOf('<div class="level-line">', conclusionStart);
        var conclusionHtml = panelHtml.slice(conclusionStart, conclusionEnd);
    `, context);
    const summary = JSON.parse(vm.runInContext('JSON.stringify(summary)', context));
    const conclusionHtml = vm.runInContext('conclusionHtml', context);
    const panelHtml = vm.runInContext('panelHtml', context);
    assert.ok(summary.why.includes('2026-07-23出现KDJ金叉，目前仍有效'), summary.why);
    assert.ok(conclusionHtml.includes('2026-07-23出现KDJ金叉，目前仍有效'), conclusionHtml);
    assert.ok(!conclusionHtml.includes('KDJ说明'), conclusionHtml);
    assert.ok(!panelHtml.includes('历史信号说明') && !panelHtml.includes('KDJ说明'), 'daily panel should not render the detailed KDJ explanation');
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
    assert.strictEqual((panelText.match(/回踩周线支撑企稳/g) || []).length, 1, 'daily conclusion should show B16 once without duplicate technical details');
    assert.ok(!panelText.includes('2026-06-08触发'), panelText);
    assert.deepStrictEqual(vm.runInContext('after', context), vm.runInContext('before', context));
});

runTest('right panel keeps a trial position when signal defense breaks above bottom support', () => {
    const context = makeBrowserContext();
    vm.runInContext(configSource, context);
    vm.runInContext(calcSource, context);
    vm.runInContext(`
        Object.assign(STRATEGY, STRATEGIES['波段抄底型']);
        state.mode = 'stock';
        state.period = 'daily';
        var meta = {
            currentDay: 64, currentDate: '2026-07-07', currentClose: 12.54,
            windowScore: 7, previousWindowScore: 7,
            windowScoreSignals: [], windowSignals: [],
            invalidatedWindowSignals: [{ signal: 'B8', day: 63, signalDate: '2026-07-01', score: 1, reason: 'price-break', invalidationDay: 64, invalidationLevel: 12.80 }],
            buySignals: [], exitSignals: [], warningSignals: [], allSignals: {}, inCooldown: false
        };
        var decision = {
            basePosition: 30, position: 30, prevAdv: 30, bsMark: null, signalReady: true,
            simpleAction: '轻仓持有', simpleColorClass: 'text-info', windowScore: 7,
            market: { label: '核心宽基分化', cls: 'neutral' }, marketGate: { type: 'open', detail: '' },
            risk: { level: '低波动/偏离', score: 86, coef: 1, flags: [], stop: 12.48, pressure: 16.23 },
            exit: { level: '无明确离场', detail: '暂无明确离场依据' },
            waveContext: {
                inScope: true, frozenHardDefense: 12.48, supportSource: 'confirmed-pivot',
                lifecycle: { active: true, entryDay: 63, entryDate: '2026-07-01', hardDefense: 12.48, localDefense: 12.80 }
            }
        };
        var summary = getStockDecisionSummary(meta, decision);
    `, context);
    const summary = JSON.parse(vm.runInContext('JSON.stringify(summary)', context));
    assert.strictEqual(summary.positionText, '30%');
    assert.ok(summary.why.includes('跌破信号防守位12.80') && summary.why.includes('底部结构支撑12.48未破'), summary.why);
    assert.ok(summary.why.includes('不生成S'), summary.why);
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
    assertPresentationSummary(entrySummary);
    assertPresentationSummary(holdSummary);
    assert.strictEqual(entrySummary.action, '轻仓观察');
    assert.ok(entrySummary.why.includes('买入积分当前为6/6'), entrySummary.why);
    assert.ok(entrySummary.positionWhy.includes('最终由空仓转为20%'), entrySummary.positionWhy);
    assert.ok(!entrySummary.positionWhy.includes('当前空仓观察'), entrySummary.positionWhy);
    assert.ok(!entrySummary.why.includes('3/6降至6/6'), entrySummary.why);
    assert.ok(holdSummary.positionWhy.includes('最终维持30%'), holdSummary.positionWhy);
    assert.ok(!holdSummary.positionWhy.includes('当前空仓观察'), holdSummary.positionWhy);
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
    const graceReason = vm.runInContext('graceSummary.why', context);
    const expiredReason = vm.runInContext('expiredSummary.why', context);
    assert.ok(graceReason.includes('3/4降至2/4') && graceReason.includes('30%试探仓保留1个交易日观察'), graceReason);
    assert.ok(expiredReason.includes('1日观察期结束') && expiredReason.includes('退出30%试探仓'), expiredReason);
});

runTest('product guide fixes the right panel copy standard', () => {
    assert.ok(productGuideSource.includes('右侧决策面板话术规范'), 'missing right-panel copy standard');
    assert.ok(productGuideSource.includes('结论 -> 关键推导依据') && productGuideSource.includes('独立策略页'), 'copy standard must define the two-level daily panel and standalone detail page');
    assert.ok(productGuideSource.includes('指数路径仍按核心宽基状态说明实际新增风险上限') && productGuideSource.includes('30%') && productGuideSource.includes('50%'), 'copy standard must preserve the index-only market limit');
    assert.ok(productGuideSource.includes('明确它不限制个股仓位') && productGuideSource.includes('不得写成仓位上限'), 'copy standard must state that core breadth never caps stock positions');
    assert.ok(productGuideSource.includes('它不常驻展示上限数字') && productGuideSource.includes('由右侧结论面板在当天说明'), 'copy standard must keep the left card a browsing surface instead of a standing cap display');
    assert.ok(productGuideSource.includes('结论三行只写真正生效的限制') && productGuideSource.includes('无限制的加仓只说明驱动因素'), 'copy standard must forbid narrating limits that did not apply');
    assert.ok(productGuideSource.includes('买入依据') && productGuideSource.includes('持仓依据') && productGuideSource.includes('未买入原因'), 'copy standard must cover novice evidence language');
    assert.ok(productGuideSource.includes('信号发生日') && productGuideSource.includes('失效原因'), 'copy standard must expose historical signal timing and invalidation reason');
    assert.ok(productGuideSource.includes('实际压力类型与价格') && productGuideSource.includes('上影占全天振幅的比例'), 'pressure-failure copy must expose verifiable price evidence');
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
    assert.strictEqual(vm.runInContext('summary.action', context), '离场观察');
    assertPresentationSummary(JSON.parse(vm.runInContext('JSON.stringify(summary)', context)));
    assert.ok(vm.runInContext('summary.why.startsWith("跌破短期趋势")', context));
    assert.ok(vm.runInContext('summary.why.includes("跌破短期趋势")', context));
    assert.ok(vm.runInContext('summary.positionWhy.includes("当前按0%处理") || summary.positionWhy.includes("最终保持0%空仓")', context));
    assert.ok(vm.runInContext('summary.nextFocus.includes("买入积分重新达到5/5")', context));
    assert.ok(vm.runInContext('!summary.why.includes("；")', context), 'main why should stay a single novice-readable sentence');
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
        assertPresentationSummary(summary);
        assert.strictEqual(summary.action, '离场观察');
        assert.ok(summary.why.includes('此前试探仓依赖的买入信号已失效'));
        assert.ok(summary.why.includes('买入积分降为 0/5'));
        assert.ok(summary.positionWhy.includes('最终由30%降至0%'));
        assert.ok(!summary.why.includes('破位防守'));
        assert.ok(!summary.why.includes('已出现无明确离场信号'));
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
    const summary = JSON.parse(vm.runInContext('JSON.stringify(summary)', context));
    assertPresentationSummary(summary);
    assert.ok(summary.why.includes('高点回撤破位'), summary.why);
    assert.ok(summary.why.includes('跌破短期趋势'), summary.why);
    assert.ok(summary.why.includes('此前买入依据失效'), summary.why);
    assert.ok(summary.why.includes('积分清零至0/5'), summary.why);
    assert.ok(summary.why.includes('当前从30%降至 0%'), summary.why);
    assert.ok(summary.why.includes('从下一交易日起进入3个交易日冷静期'), summary.why);
    assert.ok(summary.positionWhy.includes('最终由30%降至0%'), summary.positionWhy);
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
    assertPresentationSummary(repeated);
    assert.ok(repeated.why.includes('再次触发强离场：MACD死叉'), repeated.why);
    assert.ok(repeated.why.includes('3个交易日冷静期从下一交易日起重新计时'), repeated.why);
    assert.ok(repeated.nextFocus.includes('3个交易日冷静期'), repeated.nextFocus);
    assert.ok(repeated.nextFocus.includes('买入积分重新达到4/4后'), repeated.nextFocus);
    const cooldown = JSON.parse(vm.runInContext('JSON.stringify(cooldownSummary)', context));
    assert.strictEqual(cooldown.state, '离场冷静期');
    assertPresentationSummary(cooldown);
    assert.ok(cooldown.why.includes('第 2/3 个交易日，还剩 1 个交易日'), cooldown.why);
    assert.ok(cooldown.nextFocus.includes('剩余1个冷静期交易日'), cooldown.nextFocus);
    const repeatedIndex = JSON.parse(vm.runInContext('JSON.stringify(repeatedIndexSummary)', context));
    assert.strictEqual(repeatedIndex.state, '指数破位防守');
    assertPresentationSummary(repeatedIndex, { index: true });
    assert.ok(repeatedIndex.why.includes('今日指数再次触发强离场'), repeatedIndex.why);
    assert.ok(repeatedIndex.why.includes('3个交易日冷静期从下一交易日起重新计时'), repeatedIndex.why);
    assert.ok(repeatedIndex.nextFocus.includes('指数动能积分重新达到4/4'), repeatedIndex.nextFocus);
    assert.ok(!repeatedIndex.why.includes('买入积分'), repeatedIndex.why);
    const cooldownIndex = JSON.parse(vm.runInContext('JSON.stringify(cooldownIndexSummary)', context));
    assert.strictEqual(cooldownIndex.state, '指数冷静期');
    assertPresentationSummary(cooldownIndex, { index: true });
    assert.ok(cooldownIndex.why.includes('第 2/3 个交易日，还剩 1 个交易日'), cooldownIndex.why);
    assert.ok(cooldownIndex.why.includes('指数动能积分'), cooldownIndex.why);
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

runTest('novice summary does not attribute position compression to the retired risk score', () => {
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
    const summary = JSON.parse(vm.runInContext('JSON.stringify(summary)', context));
    assertPresentationSummary(summary);
    assert.ok(!summary.why.includes('风险系数') && !summary.why.includes('风险评分') && !summary.why.includes('极端风险'), summary.why);
    assert.ok(!summary.positionWhy.includes('风险系数') && !summary.positionWhy.includes('风险评分') && !summary.positionWhy.includes('极端风险'), summary.positionWhy);
    assert.ok(summary.positionWhy.includes('最终由40%降至0%'), summary.positionWhy);
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
    const summary = JSON.parse(vm.runInContext('JSON.stringify(summary)', context));
    assertPresentationSummary(summary);
    assert.ok(summary.nextFocus.includes('买入积分重新达到5/5后'), summary.nextFocus);
    assert.ok(!summary.nextFocus.includes('冷静期'), summary.nextFocus);
    assert.ok(summary.nextFocus.includes('才考虑开仓'), summary.nextFocus);
    assert.ok(summary.nextFocus.includes('跌破防守位3927.85'), summary.nextFocus);
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
