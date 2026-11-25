/* DailyGlance [7] - refresh scheduling. Loaded after the application lifecycle script. */

function scheduleIdleTask(fn, timeout = 300) {
    const idle = typeof window.requestIdleCallback === 'function';
    let handle;
    const run = deadline => {
        refreshSchedulerRuntime.idles.delete(handle);
        return Promise.resolve().then(() => fn(deadline)).catch(error => console.error('[DailyGlance] idle task failed', error));
    };
    handle = idle ? window.requestIdleCallback(run, { timeout }) : window.setTimeout(run, timeout);
    refreshSchedulerRuntime.idles.set(handle, idle);
    return handle;
}

function cancelIdleTask(handle) {
    if (!refreshSchedulerRuntime.idles.has(handle)) return;
    if (refreshSchedulerRuntime.idles.get(handle)) window.cancelIdleCallback?.(handle);
    else window.clearTimeout(handle);
    refreshSchedulerRuntime.idles.delete(handle);
}

async function applyActivePanelAfterMarketPreload() {
    if (!state.pendingIndicatorMutation || typeof scheduleCachedFetchRefreshApply !== 'function') return;
    if (!['index', 'stock'].includes(state.mode) || !getActiveData()?.length) return;
    if (typeof isChartInteractionActive === 'function' && isChartInteractionActive()) {
        updateDataStatusRefreshBadge();
        scheduleCachedFetchRefreshApply(state.id);
        return;
    }
    // 背景缓存已落入内存后，在同一帧提交图表/标记/结论，再展示新的环境卡。
    const txn = beginRefreshTransaction('rightPanel', { source:'market-preload', id:state.id });
    const status = await applyActiveDataRefresh(state.id);
    if (status !== 'no-data' && status !== 'skipped') markRefreshTime(txn, { path:status, id:state.id });
}

let workspaceHydrationGeneration = 0;
let workspaceHydrationIdle = null;
function cancelWorkspaceHydration() {
    workspaceHydrationGeneration++;
    if (workspaceHydrationIdle !== null) cancelIdleTask(workspaceHydrationIdle);
    workspaceHydrationIdle = null;
}

function requestVisibleWorkspaceRefresh() {
    cancelWorkspaceHydration();
    if (document.hidden || !['index', 'stock'].includes(state.tab)) return;
    if (isMarketOpen()) void refreshSidebarRealtime();
    const generation = workspaceHydrationGeneration;
    const tab = state.tab;
    const id = state.id;
    const selectionSeq = globalSelectionSeq;
    const isCurrent = () => !document.hidden && generation === workspaceHydrationGeneration && tab === state.tab && id === state.id && selectionSeq === globalSelectionSeq;
    workspaceHydrationIdle = scheduleIdleTask(async () => {
        workspaceHydrationIdle = null;
        if (!isCurrent()) return;
        const ids = getSidebarRealtimeTargetIds();
        await preloadCacheOnly({ ids, isCurrent });
        if (!isCurrent()) return;
        const txn = beginRefreshTransaction('leftList', { source: 'visible-cache-preload', area: getSidebarRealtimeArea() });
        await applyActivePanelAfterMarketPreload();
        if (!isCurrent()) return;
        if (tab === 'index') renderIndexList();
        else renderWatchlist();
        const appliedCount = ids.filter(key => state.rawData[key]?.length || state.liveQuotes[key]).length;
        if (appliedCount) markLeftListRefreshForActiveTab(txn, { area: getSidebarRealtimeArea(), expectedCount: ids.length, appliedCount, status: appliedCount === ids.length ? 'full' : 'partial' });
        // 先让用户选中的标的就绪，再占用历史请求槽位。
        const pendingSelection = activeSelectionLoad;
        if (pendingSelection?.selectionSeq === selectionSeq) {
            await pendingSelection.promise;
            await pendingSelection.beforeNetwork();
        }
        if (id && confirmedDataInFlight.has(id)) await confirmedDataInFlight.get(id);
        if (!isCurrent()) return;
        const coreIds = CORE_MARKET_INDEX_IDS;
        await preloadCacheOnly({ ids: coreIds, isCurrent });
        if (!isCurrent()) return;
        await ensureMarketTemperatureData({ ids: coreIds, isCurrent });
        if (!isCurrent()) return;
        await applyActivePanelAfterMarketPreload();
        if (!isCurrent()) return;
        if (tab === 'stock') {
            await hydrateWatchlistDecisionCache({ isCurrent });
            if (!isCurrent()) return;
            await updateAllWatchlistData({ isCurrent, historyOnly: true });
        } else {
            await ensureMarketTemperatureData({ ids: ids.filter(key => key !== id && !coreIds.includes(key)), isCurrent });
        }
    }, 300);
}

function scheduleStartupBackgroundHydration() {
    // 可见工作区水合由选择入口启动；搜索词库不占首屏准备路径。
    scheduleIdleTask(async () => {
        if (document.hidden) return;
        const token=createDataTaskToken();
        const cached = await dbGet('stock_cache');
        if(!isDataTaskCurrent(token))return;
        stockCache = Array.isArray(cached?.data) ? cached.data : [];
    }, 600);
}

const refreshSchedulerRuntime = {
    idles: new Map(),
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

// 复用 30 秒调度器检查盘后缺口；每标的每天最多补确认 3 次，至少间隔 60 秒。
const postCloseConfirmation = {date:'',attempts:new Map(),lastAttemptAt:0,inFlight:null,token:null};

async function refreshPostCloseConfirmation() {
    if (document.hidden || !isAfterMarketClose() || !isTradingDay(getTodayDate())) return;
    if (typeof canRequestMarketData === 'function' && !canRequestMarketData()) return;
    if (postCloseConfirmation.inFlight && isDataTaskCurrent(postCloseConfirmation.token)) return postCloseConfirmation.inFlight;
    const token=createDataTaskToken(true);
    postCloseConfirmation.token=token;
    const today = getTodayDate();
    if (postCloseConfirmation.date !== today) {
        postCloseConfirmation.date = today;
        postCloseConfirmation.attempts.clear();
        postCloseConfirmation.lastAttemptAt = 0;
    }
    if (Date.now() - postCloseConfirmation.lastAttemptAt < 60000) return;
    const area = getSidebarRealtimeArea();
    const targets = getSidebarRealtimeTargetIds();
    const ids = targets.filter(id => !isConfirmedSeriesFreshEnough(state.rawData[id]) && (postCloseConfirmation.attempts.get(id) || 0) < 3);
    if (!ids.length) return;
    postCloseConfirmation.lastAttemptAt = Date.now();
    const activeId = state.id;
    const task = (async () => {
        watchlistSnapshotBatchDepth++;
        const confirmedIds = [];
        let activeChanged = false;
        try {
            await pLimit(ids, SYS_CONFIG.SIDEBAR_SYNC_CONCURRENCY, async id => {
                if (!isDataTaskCurrent(token) || document.hidden || !canRequestMarketData()) return;
                postCloseConfirmation.attempts.set(id, (postCloseConfirmation.attempts.get(id) || 0) + 1);
                const previousMode = state.displayStatus[id]?.mode;
                const data = await syncData(id);
                if (!isDataTaskCurrent(token) || !data?.length) return;
                const result = setRawData(id, data);
                if (isConfirmedSeriesFreshEnough(data)) confirmedIds.push(id);
                if (id === activeId && (result.changed || isConfirmedSeriesFreshEnough(data) || previousMode !== state.displayStatus[id]?.mode)) activeChanged = true;
                if (result.changed) {
                    const stock = (state.watchlist || []).find(item => normalizeSecurityTarget(item).secid === id);
                    if (stock) syncWatchlistSignalSnapshotFast(stock.code, data);
                }
            });
        } finally {
            finishWatchlistSnapshotBatch();
        }
        await waitForWatchlistSnapshotQueue();
        if (!isDataTaskCurrent(token) || document.hidden || !isCurrentSidebarRealtimeBatch(area,targets)) return;
        if (area === 'index-list') renderIndexList();
        else if (area === 'stock-list') renderWatchlist();
        if (confirmedIds.length) {
            const txn = beginRefreshTransaction('leftList', { source: 'post-close-confirmation', area });
            markLeftListRefreshForActiveTab(txn, {
                area, expectedCount: ids.length, appliedCount: confirmedIds.length,
                status: confirmedIds.length === ids.length ? 'full' : 'partial'
            });
        }
        if (activeChanged && state.id === activeId) scheduleCachedFetchRefreshApply(activeId);
    })();
    postCloseConfirmation.inFlight = task;
    try { return await task; }
    finally { if (postCloseConfirmation.inFlight === task) postCloseConfirmation.inFlight = null; }
}

function handleRefreshVisibilityChange() {
    if (document.hidden) {
        cancelWorkspaceHydration();
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
    requestVisibleWorkspaceRefresh();
    if (!isMarketOpen()) {
        refreshPostCloseConfirmation().catch(error => console.error('[DailyGlance] post-close confirmation failed', error));
        return;
    }
    refreshSidebarRealtime();
    if (state.mode === 'index') cachedFetch(state.id);
    else if (state.mode === 'stock' && state.id) cachedFetch(state.id);
}

function startRefreshSchedulers() {
    if (window.__DG_REFRESH_SCHEDULERS_STARTED__) return;
    window.__DG_REFRESH_SCHEDULERS_STARTED__ = true;

    refreshSchedulerRuntime.startedAt = Date.now();
    const tickLiveClock = () => {
        if (document.hidden) return;
        const clock = document.getElementById('liveClock');
        if (!clock) return;
        const d = getBJDate();
        clock.innerText = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
    };
    tickLiveClock();
    registerRefreshInterval(tickLiveClock, 1000);

    // 30s 批量侧边栏价格刷新：1 次 JSONP 拿全部侧边栏标的实时价格
    registerRefreshInterval(() => {
        if (document.hidden) return;
        if (isMarketOpen()) refreshSidebarRealtime();
        else refreshPostCloseConfirmation().catch(error => console.error('[DailyGlance] post-close confirmation failed', error));
    }, SYS_CONFIG.THROTTLE_MS);

    // 30s 当前标的完整同步：增量历史 + 实时合并 + 图表重绘，延迟启动以错开侧边栏刷新
    registerRefreshTimeout(() => {
        registerRefreshInterval(() => {
            if (document.hidden || !isMarketOpen()) return;
            if (state.mode === 'index' && !shouldSkipScheduledActiveRefresh(state.id)) cachedFetch(state.id);
            else if (state.mode === 'stock' && state.id && !shouldSkipScheduledActiveRefresh(state.id)) cachedFetch(state.id);
        }, SYS_CONFIG.THROTTLE_MS);
    }, SYS_CONFIG.THROTTLE_MS / 2);

    // 90s 侧边栏全量历史同步：受控并发（并发数 3），覆盖大盘和自选
    startSidebarFullSync();

    // 后台切回前台时，按当前工作区立即刷新对应数据。
    refreshSchedulerRuntime.visibilityHandler = handleRefreshVisibilityChange;
    document.addEventListener('visibilitychange', handleRefreshVisibilityChange);
}

function stopRefreshSchedulers(reason = 'lifecycle') {
    if (typeof cancelDataTasks === 'function') cancelDataTasks(reason);
    cancelWorkspaceHydration();
    if (typeof invalidatePendingSelection === 'function') invalidatePendingSelection();
    if (typeof releaseChartInteractionBlock === 'function') releaseChartInteractionBlock();
    for (const handle of refreshSchedulerRuntime.idles.keys()) cancelIdleTask(handle);
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
    if (typeof checkDataGenerationAfterResume==='function') void checkDataGenerationAfterResume();
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
