/* DailyGlance [1] - split from dailyglance.html. Keep classic script order. */
// ==========================================
// [1] 配置与 UI 交互工具 (Config & UI Helpers)
// ==========================================

const rootStyle = getComputedStyle(document.documentElement);
const getCssVar = (name) => rootStyle.getPropertyValue(name).trim();

const APP_BUILD = '2026-08-09-09';
const SYS_CONFIG = {
    THROTTLE_MS: 30000,
    REQ_TIMEOUT: 5000,
    UPDATE_COOLDOWN: 60000,
    VOL_SURGE_RATIO: 1.5,
    VOL_SHRINK_RATIO: 0.9,
    EX_RIGHT_TOLERANCE: 0.02,
    RENDER_CACHE_SIZE: 50,
    HISTORY_FRESH_MS: 15000,
    HISTORY_REFRESH_COOLDOWN_MS: 8000,
    HISTORY_SOURCE_FAILURE_THRESHOLD: 2,
    HISTORY_SOURCE_CIRCUIT_MS: 300000,
    SIDEBAR_SYNC_CONCURRENCY: 3,
    WATCHLIST_LIMIT: 15,
    LIVE_OVERLAY_CACHE_TTL_MS: 45000,
    LIVE_OVERLAY_CACHE_KEY: 'dg_live_overlay_cache_v2',
    MARKET_REFRESH_LEASE_KEY: 'dg_market_refresh_leader_v1',
    MARKET_REFRESH_LEASE_MS: 12000,
    MARKET_REFRESH_HEARTBEAT_MS: 4000,
    WATCHLIST_SYNC_KEY: 'dg_watchlist_sync_v1'
};

const PAGE_SESSION_ID = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
let marketRefreshLeadershipStarted = false;
let marketRefreshHeartbeatTimer = 0;
let marketRefreshLeader = false;

function readMarketRefreshLease() {
    try {
        const raw = localStorage.getItem(SYS_CONFIG.MARKET_REFRESH_LEASE_KEY);
        const lease = raw ? JSON.parse(raw) : null;
        if (!lease || typeof lease.owner !== 'string' || !Number.isFinite(Number(lease.expiresAt))) return null;
        return { owner: lease.owner, expiresAt: Number(lease.expiresAt) };
    } catch (e) {
        return null;
    }
}

function claimMarketRefreshLeadership(options = {}) {
    const now = Date.now();
    const current = readMarketRefreshLease();
    if (!options.force && current && current.owner !== PAGE_SESSION_ID && current.expiresAt > now) {
        marketRefreshLeader = false;
        return false;
    }
    try {
        localStorage.setItem(SYS_CONFIG.MARKET_REFRESH_LEASE_KEY, JSON.stringify({
            owner: PAGE_SESSION_ID,
            expiresAt: now + SYS_CONFIG.MARKET_REFRESH_LEASE_MS
        }));
        marketRefreshLeader = readMarketRefreshLease()?.owner === PAGE_SESSION_ID;
        return marketRefreshLeader;
    } catch (e) {
        // Storage 不可用时保持单页原有行为。
        marketRefreshLeader = true;
        return true;
    }
}

function releaseMarketRefreshLeadership() {
    const current = readMarketRefreshLease();
    if (current?.owner === PAGE_SESSION_ID) {
        try { localStorage.removeItem(SYS_CONFIG.MARKET_REFRESH_LEASE_KEY); } catch (e) {}
    }
    marketRefreshLeader = false;
}

function canRequestMarketData() {
    if (!marketRefreshLeadershipStarted) return true;
    const now = Date.now();
    const current = readMarketRefreshLease();
    if (current?.owner === PAGE_SESSION_ID && current.expiresAt > now) {
        marketRefreshLeader = true;
        return true;
    }
    marketRefreshLeader = false;
    if (document.hidden) return false;
    if (!current || current.expiresAt <= now) return claimMarketRefreshLeadership();
    return false;
}

function initMarketRefreshLeadership() {
    if (marketRefreshLeadershipStarted) return;
    marketRefreshLeadershipStarted = true;
    if (!document.hidden) {
        const hasFocus = typeof document.hasFocus !== 'function' || document.hasFocus();
        claimMarketRefreshLeadership({ force: hasFocus });
    }
    marketRefreshHeartbeatTimer = window.setInterval(() => {
        if (document.hidden) {
            releaseMarketRefreshLeadership();
            return;
        }
        const current = readMarketRefreshLease();
        if (current?.owner === PAGE_SESSION_ID) claimMarketRefreshLeadership({ force: true });
        else if (!current || current.expiresAt <= Date.now()) claimMarketRefreshLeadership();
    }, SYS_CONFIG.MARKET_REFRESH_HEARTBEAT_MS);

    if (typeof window.addEventListener === 'function') {
        window.addEventListener('focus', () => claimMarketRefreshLeadership({ force: true }));
        window.addEventListener('pagehide', releaseMarketRefreshLeadership);
        window.addEventListener('storage', event => {
            if (event.key !== SYS_CONFIG.MARKET_REFRESH_LEASE_KEY) return;
            marketRefreshLeader = readMarketRefreshLease()?.owner === PAGE_SESSION_ID;
        });
    }
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) releaseMarketRefreshLeadership();
        else claimMarketRefreshLeadership({ force: true });
    });
}

const MA_OPTIONS = [5, 10, 20, 30, 60, 120, 250];
const MA_COLORS = { 5: '#ffffff', 10: '#f5a623', 20: '#c084fc', 30: '#60a5fa', 60: '#f472b6', 120: '#4ade80', 250: '#94a3b8' };

const STRATEGIES = {
    '稳健趋势型': { buySignals: ['B1','B2','B3','B4','B10','B12','B13','B14','B15'], exitSignals: ['L1','L2','L3','L4','L9','L10'], warningSignals: ['W1'], scoreGroups: [['B1','B10','B13','B15'],['B2','B12'],['B4','B14']], windowDays: 12, buyThreshold: 5, watchPosition: 0, desc: '关注趋势结构、MACD动能和突破确认，适合中期趋势跟随' },
    '波段抄底型': { buySignals: ['B5','B6','B7','B8','B9','B11','B16','B17'], exitSignals: ['L3','L5','L10'], warningSignals: ['W1','L9'], scoreGroups: [['B5','B6','B11','B16'],['B7','B8'],['B17']], windowSignalGuards: { B8: { recentDays: 3, companionSignals: ['B5','B6','B9','B11','B16','B17'] } }, windowDays: 10, buyThreshold: 4, holdThreshold: 3, watchPosition: 30, softInvalidationGraceDays: 1, monotonicSignalLifecycle: true, b11StructureDefense: { lookbackDays: 20, pivotDays: 2 }, waveB6TrendAdd: { stocksOnly: true, sourcePosition: 30, targetPosition: 50, movingAveragePeriod: 20, slopeLookbackDays: 1 }, waveMA20PullbackObservation: { stocksOnly: true, position: 30, movingAveragePeriod: 20, slopeLookbackDays: 1, maximumCloseGapRatio: 0.005, minimumLowerShadowBodyRatio: 1.5, minimumLowerShadowRangeRatio: 0.35, minimumRiskScore: 40, takeoverSignals: ['B6','B11'] }, l10TrendHandoff: { stocksOnly: true, blockingSignals: ['L3','L4','L9'], movingAverageSlopeLookbackDays: 5, warningPositionCap: 30 }, waveExpiryHandoff: { position: 30, holdTradingDays: 1, movingAveragePeriod: 5, minimumRiskScore: 40, defensiveObservation: { stocksOnly: true, trendMovingAveragePeriod: 20, trendSlopeLookbackDays: 1, requirePositiveMacdBar: true, nextDayMovingAveragePeriods: [5,20] } }, waveExpiryB11TakeoverAdd: { stocksOnly: true, sourcePosition: 30, targetPosition: 50, triggerSignal: 'B11', shortMovingAveragePeriod: 5, trendMovingAveragePeriod: 20, trendSlopeLookbackDays: 1 }, waveRejectionProtection: { minimumProfitRatio: 0.08, minimumVolumeRatio: 1.5, minimumUpperShadowBodyRatio: 1.5, minimumUpperShadowRangeRatio: 0.35, requireUpperShadowDominance: true, maximumCloseLocation: 0.5, pressureLookbackDays: 20, pressureToleranceRatio: 0.98, minimumLockTradingDays: 2, blockingSignals: ['W2','W3'], recoveryPositionCap: 30, recoveryHoldTradingDays: 1, positionSteps: [0,30,50,80], freshEntryFailure: { maximumEntryAgeTradingDays: 2, minimumIntradayProfitRatio: 0, maximumCloseProfitRatio: 0, minimumGivebackRatio: 0.60, minimumVolumeRatio: 0, minimumUpperShadowRangeRatio: 0.35, maximumCloseLocation: 0.35, pressureLookbackDays: 20, pressureToleranceRatio: 0.03, pressureCloseToleranceRatio: 0.005, movingAveragePeriods: [20,60], movingAverageSlopeLookbackDays: 5, pivotConfirmationDays: 2 }, freshEntryDownsideFailure: { maximumEntryAgeTradingDays: 2, exitOnCloseBelowEntryLow: true, maximumCloseDefenseGapRatio: 0.0015, minimumBearBodyRangeRatio: 0.5, maximumCloseLocation: 0.25, minimumVolumeRatio: 1.0 }, indexFreshEntryDownsideFailure: { maximumEntryAgeTradingDays: 2, exitOnCloseBelowEntryLow: true, maximumCloseDefenseGapRatio: 0.005, minimumBearBodyRangeRatio: 0.4, maximumCloseLocation: 0.25, minimumVolumeRatio: 0 } }, desc: '关注超卖、背离、大级别支撑和回踩企稳，适合回调末端的修复观察' },
    '突破追涨型': { buySignals: ['B3','B4','B14'], exitSignals: ['L4','L5','L6','L9'], warningSignals: ['W1','L10'], signalWeights: {'B3':1,'B4':3,'B14':4}, scoreGroups: [['B4','B14']], windowDays: 8, buyThreshold: 4, watchPosition: 0, desc: '专注放量突破和平台突破，适合强势行情里的右侧确认' },
    '综合全能型': { buySignals: ['B1','B2','B3','B4','B5','B6','B7','B9','B10','B11','B12','B14','B15','B16','B17'], exitSignals: ['L1','L2','L3','L4','L5','L6','L9','L10'], warningSignals: ['W1'], scoreGroups: [['B1','B10','B15'],['B2','B12'],['B4','B14'],['B5','B6','B11','B16'],['B7'],['B17']], windowDays: 12, buyThreshold: 6, watchPosition: 30, watchPositionSignals: ['B5','B6','B7','B9','B11','B16','B17'], desc: '全量雷达观察模式，适合看全局信号，不建议直接等同交易指令' }
};

// 指数与个股共用“新仓冲高失败”语义，但按指数波动特征使用独立阈值。
STRATEGIES['波段抄底型'].waveRejectionProtection.indexFreshEntryFailure = {
    maximumEntryAgeTradingDays: 2,
    minimumIntradayProfitRatio: -0.01,
    maximumCloseProfitRatio: 0,
    minimumGivebackRatio: 0,
    minimumVolumeRatio: 0,
    minimumUpperShadowRangeRatio: 0.50,
    maximumCloseLocation: 0.30,
    maximumCloseDefenseGapRatio: 0.015,
    requireBearishClose: true,
    pressureLookbackDays: 20,
    pressureToleranceRatio: 0.03,
    pressureCloseToleranceRatio: 0.005,
    movingAveragePeriods: [20,60],
    movingAverageSlopeLookbackDays: 5,
    pivotConfirmationDays: 2
};

// 四个正式策略共用同一套可解释仓位档位；策略之间只区分信号入口和是否允许试探。
const POSITION_STEPS = [0, 30, 50, 80];

// Quality metadata stays in shadow until forward evidence and manual approval are complete.
const WAVE_B_QUALITY_RULESET = Object.freeze({
    id: 'wave-b-quality-20260730-02-b8-b17',
    status: 'shadow',
    sourceRuleId: 'wave-b-quality-20260730-02-b8-b17',
    frozenAsOf: '2026-07-29',
    strategy: '波段抄底型',
    rules: Object.freeze([Object.freeze({
        id: 'wave-b-quality-20260730-02-b8-b17',
        requiredSignals: Object.freeze(['B8', 'B17']),
        reasons: Object.freeze(['KDJ 金叉确认短期动量修复', '超跌止跌反弹确认修复形态'])
    })])
});

let STRATEGY = {}; 
let state = {
    tab: 'index',
    id: 'sh',
    mode: 'index',
    range: 90,
    viewport: { mode: 'latest', endIdx: -1, anchorIdx: -1 },
    lockIdx: -1,
    periodLocks: { daily: -1, weekly: -1 },
    charts: {},
    rawData: {},
    weeklyData: {},
    liveBars: {},
    liveQuotes: {},
    liveOverlayCache: {},
    liveWeeklyData: {},
    confirmedStatus: {},
    displayStatus: {},
    leftListRefreshAt: 0,
    refreshSeq: 0,
    refreshSnapshots: {
        leftList: null,
        rightPanel: null
    },
    period: 'daily',
    activeMAs: [5, 20, 60],
    indicators: { ma: {}, macd: null, rsi: null, kdj: null },
    indicatorKey: '',
    pendingIndicatorMutation: null,
    watchlist: [],
    stockId: null,
    strategy: '稳健趋势型',
    isFrozen: false
};
let globalSelectionSeq = 0;
function applyActiveSelectionState({ tab, mode, id, stockId = null }) {
    state.tab = tab;
    state.mode = mode;
    state.id = id;
    state.stockId = stockId;
    state.isFrozen = false;
}

function applyPeriodState(period) {
    if (!['daily', 'weekly'].includes(period)) return false;
    state.period = period;
    state.isFrozen = false;
    return true;
}

function applyHistoryNavigationState({ lockIdx, isFrozen }) {
    if (Number.isFinite(lockIdx)) {
        if (typeof setLockIdx === 'function') setLockIdx(lockIdx);
        else state.lockIdx = lockIdx;
    }
    state.isFrozen = !!isFrozen;
}

function setActiveStrategy(name) {
    if (!STRATEGIES[name]) return false;
    for (const key of Object.keys(STRATEGY)) delete STRATEGY[key];
    Object.assign(STRATEGY, STRATEGIES[name]);
    state.strategy = name;
    return true;
}
setActiveStrategy('稳健趋势型');

const renderCache = new Map();
const dateIndexCache = new Map();
const indexIndicators = {};
const derivedIndicatorCache = new Map();
let b11StructureDefenseCache = new WeakMap();

const PERF = {
    enabled: true,
    maxEntries: 80,
    maxLongTasks: 80,
    traces: [],
    longTasks: [],
    start(label, meta = {}) {
        if (!this.enabled) return null;
        return { label, meta, start: performance.now(), marks: [] };
    },
    mark(trace, step, meta = {}) {
        if (!this.enabled || !trace) return;
        trace.marks.push({ step, at: performance.now(), meta });
    },
    end(trace, meta = {}) {
        if (!this.enabled || !trace) return null;
        const end = performance.now();
        const steps = trace.marks.map((mark, idx) => ({
            step: mark.step,
            duration: Number((mark.at - (idx === 0 ? trace.start : trace.marks[idx - 1].at)).toFixed(1)),
            meta: mark.meta
        }));
        const entry = {
            label: trace.label,
            total: Number((end - trace.start).toFixed(1)),
            startTime: Number(trace.start.toFixed(1)),
            endTime: Number(end.toFixed(1)),
            meta: { ...trace.meta, ...meta },
            steps,
            endedAt: new Date().toISOString()
        };
        this.traces.push(entry);
        if (this.traces.length > this.maxEntries) this.traces.shift();
        return entry;
    },
    latest(label) {
        const list = label ? this.traces.filter(item => item.label === label) : this.traces;
        return list[list.length - 1] || null;
    },
    summary(label) {
        const list = label ? this.traces.filter(item => item.label === label) : this.traces;
        return list.map(item => ({
            label: item.label,
            total: item.total,
            meta: item.meta,
            steps: item.steps.map(step => `${step.step}:${step.duration}ms`).join(' | ')
        }));
    },
    baseline(label) {
        const list = label ? this.traces.filter(item => item.label === label) : this.traces;
        const groups = new Map();
        for (const item of list) {
            const path = item.meta?.path || '';
            const key = `${item.label}||${path}`;
            if (!groups.has(key)) groups.set(key, { label: item.label, path, totals: [] });
            groups.get(key).totals.push(Number(item.total) || 0);
        }
        return Array.from(groups.values()).map(group => {
            const sum = group.totals.reduce((acc, value) => acc + value, 0);
            const last = group.totals[group.totals.length - 1] || 0;
            return {
                label: group.label,
                path: group.path,
                count: group.totals.length,
                avg: Number((sum / group.totals.length).toFixed(1)),
                max: Number(Math.max(...group.totals).toFixed(1)),
                last: Number(last.toFixed(1))
            };
        });
    },
    recordLongTask(entry = {}) {
        const task = {
            name: entry.name || 'longtask',
            startTime: Number((Number(entry.startTime) || 0).toFixed(1)),
            duration: Number((Number(entry.duration) || 0).toFixed(1))
        };
        this.longTasks.push(task);
        if (this.longTasks.length > this.maxLongTasks) this.longTasks.shift();
        return task;
    },
    longTaskSummary() {
        if (!this.longTasks.length) return { count: 0, avg: 0, max: 0, last: 0 };
        const durations = this.longTasks.map(item => Number(item.duration) || 0);
        const sum = durations.reduce((acc, value) => acc + value, 0);
        const last = durations[durations.length - 1] || 0;
        return {
            count: durations.length,
            avg: Number((sum / durations.length).toFixed(1)),
            max: Number(Math.max(...durations).toFixed(1)),
            last: Number(last.toFixed(1))
        };
    }
};

window.__DG_PERF__ = PERF;

function installPerformanceLongTaskObserver() {
    if (typeof PerformanceObserver === 'undefined') return;
    try {
        const observer = new PerformanceObserver(list => {
            for (const entry of list.getEntries()) PERF.recordLongTask(entry);
        });
        observer.observe({ entryTypes: ['longtask'] });
    } catch (error) {}
}
installPerformanceLongTaskObserver();

function clearDerivedCaches() {
    renderCache.clear();
    dateIndexCache.clear();
    b11StructureDefenseCache = new WeakMap();
}
function clearLookupCacheOnly() { dateIndexCache.clear(); }

const SIGNAL_VERSION = 'v4.2.28';
window.__DG_BUILD__ = APP_BUILD;

function getDecisionSignature(decision) {
    if (!decision) return 'none';
    return [
        decision.simpleAction || '',
        decision.position ?? '',
        decision.market?.label || '',
        decision.risk?.score ?? '',
        decision.exit?.level || '',
        decision.b11StructureDefense?.structureLevel ?? '',
        decision.b11StructureDefense?.structureDate || '',
        decision.b11StructureDefense?.localBreak ? 'local-break' : ''
    ].join('|');
}
const SIGNAL_SCORES = { 'B1':3,'B2':3,'B3':2,'B4':2,'B5':2,'B6':2,'B7':1,'B8':1,'B9':4,'B10':2,'B11':2,'B12':3,'B13':3,'B14':2,'B15':2,'B16':3,'B17':3,'B18':2 };
const SIGNAL_DESC = {
    'B1':{desc:'均线多头'}, 'B2':{desc:'MACD金叉'}, 'B3':{desc:'上穿20日线'}, 'B4':{desc:'放量突破新高'}, 'B5':{desc:'阳包阴'}, 'B6':{desc:'缩量回踩不破'}, 'B7':{desc:'RSI超卖回升'}, 'B8':{desc:'KDJ金叉'}, 'B9':{desc:'MACD底背离'}, 'B10':{desc:'MA20上穿MA60'}, 'B11':{desc:'均线回踩不破'}, 'B12':{desc:'零轴上金叉'}, 'B13':{desc:'长级别走强'}, 'B14':{desc:'平台放量突破'}, 'B15':{desc:'均线二次金叉'}, 'B16':{desc:'回踩周线支撑企稳'}, 'B17':{desc:'超跌止跌反弹'}, 'B18':{desc:'BOLL下轨止跌收回'},
    'L1':{desc:'跌破短期趋势'}, 'L2':{desc:'均线死叉'}, 'L3':{desc:'MACD死叉'}, 'L4':{desc:'跌破20日线'}, 'L5':{desc:'阴包阳'}, 'L6':{desc:'连阳后首阴'}, 'L7':{desc:'RSI超买回落'}, 'L8':{desc:'布林上轨受阻'}, 'L9':{desc:'高点回撤破位'}, 'L10':{desc:'MACD顶背离'}, 'W1':{desc:'偏离均线过大'}, 'W2':{desc:'连阳缩量迹象'}, 'W3':{desc:'放量滞涨'}, 'W4':{desc:'缩量上涨背离'}
};

function getSignalScore(sig, strategy=STRATEGY) { return strategy.signalWeights?.[sig] ?? SIGNAL_SCORES[sig] ?? 0; }
function getUserSignalText(sig) { return SIGNAL_DESC[sig]?.desc || sig; }
function getScoreGroupKey(strategy, sig) { const group = (strategy.scoreGroups || []).find(g => g.includes(sig)); return group ? group.join('|') : sig; }

const escapeHTML = v => String(v ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const escapeJSArg = v => String(v ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '\\r');
function hashString32(s) {
    var h = 0, i = 0;
    s = String(s || '');
    while (i < s.length) { h = ((h << 5) - h + s.charCodeAt(i++)) | 0; }
    return h;
}

// === UI 工具与模态框逻辑 ===
const UI = {
    signalRow: (name, sig, isMonitored, isBull) => {
        const tag = isMonitored ? '策略追踪' : '已过滤';
        return `<div class="signal-row"><span class="name ${isMonitored ? 'text-main' : 'text-dim'}">${name} <span class="mono text-dim" style="font-size:10px;margin-left:4px;">${sig}</span></span><span class="tag">${tag}</span></div>`;
    },
    sectionTitle: (title, colorClass) => `<div class="signal-section-title ${colorClass}">${title}</div>`
};

function formatLeftListRefreshTime(ts = state.leftListRefreshAt) {
    return ts ? new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }) : '--:--';
}

function beginRefreshTransaction(scope, meta = {}) {
    state.refreshSeq = (state.refreshSeq || 0) + 1;
    return {
        id: `${scope}-${state.refreshSeq}`,
        version: state.refreshSeq,
        scope,
        startedAt: Date.now(),
        meta: { ...meta }
    };
}

function commitRefreshSnapshot(scope, txn = null, patch = {}) {
    const appliedAt = Date.now();
    const version = txn?.version || ((state.refreshSeq || 0) + 1);
    if (!txn?.version) state.refreshSeq = version;
    const snapshot = {
        id: txn?.id || `${scope}-${version}`,
        version,
        scope,
        startedAt: txn?.startedAt || appliedAt,
        appliedAt,
        meta: { ...(txn?.meta || {}), ...patch }
    };
    if (!state.refreshSnapshots) state.refreshSnapshots = {};
    state.refreshSnapshots[scope] = snapshot;
    return snapshot;
}

function getRefreshSnapshot(scope) {
    return state.refreshSnapshots?.[scope] || null;
}

function getLeftListRefreshText() {
    const snapshot = getRefreshSnapshot('leftList');
    return `列表刷新于 ${formatLeftListRefreshTime(snapshot?.appliedAt || state.leftListRefreshAt)}`;
}

function renderLeftListHeader(title, options = {}) {
    const snapshot = getRefreshSnapshot('leftList') || {};
    const refreshHtml = options.showRefresh === false ? '' : `
                <span class="left-list-refresh-time" data-left-list-refresh data-refresh-id="${escapeHTML(snapshot.id || '')}" data-refresh-version="${snapshot.version || 0}" data-refresh-applied-at="${snapshot.appliedAt || 0}">${getLeftListRefreshText()}</span>`;
    return `
        <div class="stock-header">
            <div class="title-wrap">
                <span>${escapeHTML(title)}</span>
                ${refreshHtml}
            </div>
        </div>
    `;
}

function updateLeftListRefreshLabels() {
    const snapshot = getRefreshSnapshot('leftList') || {};
    document.querySelectorAll('[data-left-list-refresh]').forEach(el => {
        el.textContent = getLeftListRefreshText();
        el.dataset.refreshId = snapshot.id || '';
        el.dataset.refreshVersion = String(snapshot.version || 0);
        el.dataset.refreshAppliedAt = String(snapshot.appliedAt || 0);
    });
}

function markLeftListRefreshTime(txn = null, patch = {}) {
    const snapshot = commitRefreshSnapshot('leftList', txn && typeof txn === 'object' ? txn : null, patch);
    state.leftListRefreshAt = snapshot.appliedAt;
    updateLeftListRefreshLabels();
    return snapshot;
}

const SVG_ICONS = {
    SPIN: `<svg class="icon spin" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/></svg>`,
    UPDATE: `<svg class="icon" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M44 31C44 36.5228 39.5228 41 34 41C32.2091 41 30.5281 40.5292 29.0741 39.7046C26.5143 38.2529 24.6579 35.7046 24.1436 32.6983C24.0492 32.1463 24 31.5789 24 31C24 28.4323 24.9678 26.0906 26.5585 24.3198C28.3892 22.2818 31.0449 21 34 21C39.5228 21 44 25.4772 44 31Z" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><path d="M34 12V20V21C31.0449 21 28.3892 22.2818 26.5585 24.3198C24.9678 26.0906 24 28.4323 24 31C24 31.5789 24.0492 32.1463 24.1436 32.6983C24.6579 35.7046 26.5143 38.2529 29.0741 39.7046C26.4116 40.5096 22.8776 41 19 41C10.7157 41 4 38.7614 4 36V28V20V12" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><path d="M34 12C34 14.7614 27.2843 17 19 17C10.7157 17 4 14.7614 4 12C4 9.23858 10.7157 7 19 7C27.2843 7 34 9.23858 34 12Z" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 28C4 30.7614 10.7157 33 19 33C20.807 33 22.5393 32.8935 24.1436 32.6983" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 20C4 22.7614 10.7157 25 19 25C21.7563 25 24.339 24.7522 26.5585 24.3198" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><path d="M38 31C38 33.2091 36.2091 35 34 35" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><path d="M30 31C30 28.7909 31.7909 27 34 27" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`
};

const showLoading = (msg = 'DailyGlance 同步中...') => { 
    const l = document.getElementById('loading'); 
    l.innerHTML = `<div class="loading-wrap"><svg class="icon spin" viewBox="0 0 24 24" fill="none" style="width:20px;height:20px;color:var(--blue);"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" stroke-dasharray="16 46" stroke-linecap="round"/></svg><span>${msg}</span></div>`; 
    l.classList.add('show'); 
};
const hideLoading = () => document.getElementById('loading').classList.remove('show');

const customAlert = (msg, isHtml = false) => new Promise(resolve => {
    const m = document.getElementById('customModal');
    m._returnFocus = document.activeElement;
    if(isHtml) document.getElementById('customModalMsg').innerHTML = msg; else document.getElementById('customModalMsg').innerText = msg;
    document.getElementById('customModalBtnCancel').style.display = 'none';
    const okBtn = document.getElementById('customModalBtnOk');
    okBtn.onclick = () => { m.classList.remove('show'); m._returnFocus?.focus?.(); resolve(true); };
    m.classList.add('show'); okBtn.focus();
});

const customConfirm = (msg) => new Promise(resolve => {
    const m = document.getElementById('customModal'); document.getElementById('customModalMsg').innerText = msg;
    m._returnFocus = document.activeElement;
    const cancelBtn = document.getElementById('customModalBtnCancel'), okBtn = document.getElementById('customModalBtnOk');
    cancelBtn.style.display = 'block';
    const close = (res) => { m.classList.remove('show'); m._returnFocus?.focus?.(); resolve(res); };
    cancelBtn.onclick = () => close(false); okBtn.onclick = () => close(true);
    m.classList.add('show'); okBtn.focus();
});

// === P1-6: 轻量 Toast 组件（非阻塞） ===
let _toastSeq = 0;
function showToast(msg, type, duration) {
    type = type || 'info'; duration = duration || 3000;
    const container = document.getElementById('toastContainer');
    if (!container) return 0;
    const id = ++_toastSeq;
    const toast = document.createElement('div');
    toast.className = 'toast toast-' + type;
    toast.dataset.id = id;
    toast.textContent = msg;
    container.appendChild(toast);
    requestAnimationFrame(function() { toast.classList.add('show'); });
    toast._timer = setTimeout(function() { _dismissToast(id); }, duration);
    return id;
}
function showToastWithAction(msg, actionLabel, onAction, type, duration) {
    type = type || 'info'; duration = duration || 4000;
    const container = document.getElementById('toastContainer');
    if (!container) return 0;
    const id = ++_toastSeq;
    const toast = document.createElement('div');
    toast.className = 'toast toast-' + type + ' toast-with-action';
    toast.dataset.id = id;
    const msgSpan = document.createElement('span');
    msgSpan.className = 'toast-msg';
    msgSpan.textContent = msg;
    var btn = document.createElement('button');
    btn.className = 'toast-action';
    btn.textContent = actionLabel;
    btn.onclick = function() { clearTimeout(toast._timer); _dismissToast(id); if (onAction) onAction(); };
    toast.appendChild(msgSpan);
    toast.appendChild(btn);
    container.appendChild(toast);
    requestAnimationFrame(function() { toast.classList.add('show'); });
    toast._timer = setTimeout(function() { _dismissToast(id); }, duration);
    return id;
}
function _dismissToast(id) {
    var container = document.getElementById('toastContainer');
    if (!container) return;
    var toast = container.querySelector('.toast[data-id="' + id + '"]');
    if (!toast) return;
    clearTimeout(toast._timer);
    toast.classList.remove('show');
    setTimeout(function() { if (toast.parentNode) toast.remove(); }, 300);
}
function dismissToast(id) { _dismissToast(id); }

// === P1-5: 数据刷新时间戳 ===
function markRefreshTime(txn = null, patch = {}) {
    const snapshot = commitRefreshSnapshot('rightPanel', txn && typeof txn === 'object' ? txn : null, patch);
    var el = document.getElementById('lastRefreshTime');
    var bar = document.getElementById('lastRefreshBar');
    if (el) {
        el.textContent = new Date(snapshot.appliedAt).toLocaleTimeString('en-GB', { hour12: false });
        el.dataset.refreshId = snapshot.id;
        el.dataset.refreshVersion = String(snapshot.version);
        el.dataset.refreshAppliedAt = String(snapshot.appliedAt);
    }
    if (bar) {
        bar.style.display = 'flex';
        bar.dataset.refreshId = snapshot.id;
        bar.dataset.refreshVersion = String(snapshot.version);
        bar.dataset.refreshAppliedAt = String(snapshot.appliedAt);
    }
    if (typeof updateDataStatusRefreshBadge === 'function') updateDataStatusRefreshBadge();
    return snapshot;
}

document.addEventListener('keydown', (e) => {
    const modal = document.getElementById('customModal'), help = document.getElementById('helpOverlay'), settings = document.getElementById('settingsOverlay'), perf = document.getElementById('perfOverlay');
    const isModalOpen = modal.classList.contains('show');
    const openOverlay = [modal, settings, help, perf].find(overlay => overlay?.classList.contains('show'));

    if (e.key === 'Tab' && openOverlay) {
        const focusable = Array.from(openOverlay.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')).filter(element => {
            const style = getComputedStyle(element);
            return style.display !== 'none' && style.visibility !== 'hidden' && !element.disabled;
        });
        if (focusable.length) {
            const first = focusable[0], last = focusable[focusable.length - 1];
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
    }

    if (e.key === 'Escape') {
        if (isModalOpen) {
            const cancelBtn = document.getElementById('customModalBtnCancel');
            if (cancelBtn.style.display !== 'none') cancelBtn.click(); else document.getElementById('customModalBtnOk').click();
        } else if (settings.classList.contains('show')) toggleSettings();
        else if (help.classList.contains('show')) toggleHelp();
        else if (perf.classList.contains('show')) togglePerfPanel();
        else closeSuggestions();
    }
    
    if (e.key === 'Enter' && isModalOpen) { e.preventDefault(); document.getElementById('customModalBtnOk').click(); }

    if (!openOverlay && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
        if (e.key === 'ArrowLeft') { e.preventDefault(); prevDay(); }
        if (e.key === 'ArrowRight') { e.preventDefault(); nextDay(); }
    }
});

document.addEventListener('click', (e) => {
    const sug = document.getElementById('stockSuggest');
    if (sug && sug.style.display === 'block' && !e.target.closest('.stock-search')) closeSuggestions();
    if(e.target.id === 'settingsOverlay') toggleSettings();
    if(e.target.id === 'helpOverlay') toggleHelp();
    if(e.target.id === 'perfOverlay') togglePerfPanel();
});
