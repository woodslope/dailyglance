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

const refreshSchedulerRuntime = {
    intervals: new Set(),
    timeouts: new Set(),
    visibilityHandler: null,
    startedAt: 0,
    stoppedAt: 0,
    restartCount: 0
};
if (typeof window !== 'undefined') window.__DG_REFRESH_RUNTIME__ = refreshSchedulerRuntime;

function registerRefreshInterval(fn, delay) {
    const handle = setInterval(fn, delay);
    refreshSchedulerRuntime.intervals.add(handle);
    return handle;
}

function registerRefreshTimeout(fn, delay) {
    let handle = 0;
    handle = setTimeout(() => {
        refreshSchedulerRuntime.timeouts.delete(handle);
        fn();
    }, delay);
    refreshSchedulerRuntime.timeouts.add(handle);
    return handle;
}

function handleRefreshVisibilityChange() {
    if (document.hidden) {
        if (typeof cancelExternalObservationTasks === 'function') cancelExternalObservationTasks('hidden');
        return;
    }
    if (state.tab === 'external') {
        Promise.all([
            refreshSectorTrendSnapshot({ reason: 'visibility' }),
            refreshExternalLeadStripSnapshot({ reason: 'visibility' })
        ]).catch(error => console.error('[DailyGlance] external visibility refresh failed', error));
        return;
    }
    if (!isMarketOpen()) return;
    refreshSidebarRealtime();
    if (state.mode === 'index') cachedFetch(state.id);
    else if (state.mode === 'stock' && state.id) cachedFetch(state.id);
}

function startRefreshSchedulers() {
    if (window.__DG_REFRESH_SCHEDULERS_STARTED__) return;
    window.__DG_REFRESH_SCHEDULERS_STARTED__ = true;

    refreshSchedulerRuntime.startedAt = Date.now();
    registerRefreshInterval(() => {
        if (document.hidden) return;
        const d = getBJDate();
        document.getElementById('liveClock').innerText = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
    }, 1000);

    // 30s 批量侧边栏价格刷新：1 次 JSONP 拿全部侧边栏标的实时价格
    registerRefreshInterval(() => {
        if (document.hidden || !isMarketOpen()) return;
        refreshSidebarRealtime();
    }, SYS_CONFIG.THROTTLE_MS);

    // 30s 当前标的完整同步：增量历史 + 实时合并 + 图表重绘，延迟启动以错开侧边栏刷新
    registerRefreshTimeout(() => {
        registerRefreshInterval(() => {
            if (document.hidden || !isMarketOpen()) return;
            if (state.mode === 'index') cachedFetch(state.id);
            else if (state.mode === 'stock' && state.id) cachedFetch(state.id);
        }, SYS_CONFIG.THROTTLE_MS);
    }, SYS_CONFIG.THROTTLE_MS / 2);

    // 90s 侧边栏全量历史同步：受控并发（并发数 3），覆盖大盘和自选
    startSidebarFullSync();

    // 后台切回前台时，按当前工作区立即刷新对应数据。
    refreshSchedulerRuntime.visibilityHandler = handleRefreshVisibilityChange;
    document.addEventListener('visibilitychange', handleRefreshVisibilityChange);
}

function stopRefreshSchedulers(reason = 'lifecycle') {
    refreshSchedulerRuntime.intervals.forEach(handle => clearInterval(handle));
    refreshSchedulerRuntime.timeouts.forEach(handle => clearTimeout(handle));
    refreshSchedulerRuntime.intervals.clear();
    refreshSchedulerRuntime.timeouts.clear();
    if (refreshSchedulerRuntime.visibilityHandler && typeof document.removeEventListener === 'function') {
        document.removeEventListener('visibilitychange', refreshSchedulerRuntime.visibilityHandler);
    }
    refreshSchedulerRuntime.visibilityHandler = null;
    refreshSchedulerRuntime.stoppedAt = Date.now();
    window.__DG_REFRESH_SCHEDULERS_STARTED__ = false;
    if (typeof stopMarketRefreshLeadership === 'function') stopMarketRefreshLeadership();
    if (typeof stopSidebarFullSync === 'function') stopSidebarFullSync();
    if (typeof cancelExternalObservationTasks === 'function') cancelExternalObservationTasks(reason);
}

function handleRefreshPageHide(event) {
    stopRefreshSchedulers(event?.persisted ? 'bfcache' : 'pagehide');
}

function handleRefreshPageShow(event) {
    if (!event?.persisted) return;
    refreshSchedulerRuntime.restartCount++;
    if (typeof initMarketRefreshLeadership === 'function') initMarketRefreshLeadership();
    startRefreshSchedulers();
    handleRefreshVisibilityChange();
}

async function startDailyGlanceApplication() {
    try {
        await init();
        return true;
    } catch (error) {
        stopRefreshSchedulers('startup-error');
        console.error('[DailyGlance] startup failed', error);
        if (typeof showStartupError === 'function') showStartupError(error);
        else if (typeof hideLoading === 'function') hideLoading();
        return false;
    }
}

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('pagehide', handleRefreshPageHide);
    window.addEventListener('pageshow', handleRefreshPageShow);
}

// 启动应用必须在 05-app.js、06-settings.js 和本调度器全部加载后执行。
startDailyGlanceApplication();
