/* DailyGlance [7] - refresh scheduling. Loaded after the application lifecycle script. */

function scheduleIdleTask(fn, timeout = 300) {
    if (typeof window.requestIdleCallback === 'function') {
        return window.requestIdleCallback(fn, { timeout });
    }
    return window.setTimeout(fn, timeout);
}

function scheduleStartupBackgroundHydration() {
    scheduleIdleTask(async () => {
        await preloadCacheOnly();
        await ensureMarketTemperatureData();
        if (state.mode === 'index') {
            renderIndexList();
            if (!document.hidden && isMarketOpen()) await refreshSidebarRealtime();
        } else if (state.mode === 'stock' || state.tab === 'stock') {
            const leftTxn = beginRefreshTransaction('leftList', { source: 'startup-cache-preload', area: 'stock-list' });
            renderWatchlist();
            markLeftListRefreshForActiveTab(leftTxn, { area: 'stock-list' });
            if (!document.hidden && isMarketOpen()) await refreshSidebarRealtime();
        }
    }, 600);
    scheduleIdleTask(() => refreshWatchlistSignalSnapshots(), 900);
}

function startRefreshSchedulers() {
    if (window.__DG_REFRESH_SCHEDULERS_STARTED__) return;
    window.__DG_REFRESH_SCHEDULERS_STARTED__ = true;

    setInterval(() => {
        if (document.hidden) return;
        const d = getBJDate();
        document.getElementById('liveClock').innerText = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
    }, 1000);

    // 30s 批量侧边栏价格刷新：1 次 JSONP 拿全部侧边栏标的实时价格
    setInterval(() => {
        if (document.hidden || !isMarketOpen()) return;
        refreshSidebarRealtime();
    }, SYS_CONFIG.THROTTLE_MS);

    // 30s 当前标的完整同步：增量历史 + 实时合并 + 图表重绘，延迟启动以错开侧边栏刷新
    setTimeout(() => {
        setInterval(() => {
            if (document.hidden || !isMarketOpen()) return;
            if (state.mode === 'index') cachedFetch(state.id);
            else if (state.mode === 'stock' && state.id) cachedFetch(state.id);
        }, SYS_CONFIG.THROTTLE_MS);
    }, SYS_CONFIG.THROTTLE_MS / 2);

    // 90s 侧边栏全量历史同步：受控并发（并发数 3），覆盖大盘和自选
    startSidebarFullSync();

    // 后台切回前台时，按当前工作区立即刷新对应数据。
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) return;
        if (state.tab === 'external') {
            Promise.all([
                refreshSectorTrendSnapshot({ reason: 'visibility' }),
                refreshExternalLeadStripSnapshot({ reason: 'visibility' })
            ]);
            return;
        }
        if (!isMarketOpen()) return;
        refreshSidebarRealtime();
        if (state.mode === 'index') cachedFetch(state.id);
        else if (state.mode === 'stock' && state.id) cachedFetch(state.id);
    });
}

// 启动应用必须在 05-app.js、06-settings.js 和本调度器全部加载后执行。
init();
