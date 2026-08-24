/* DailyGlance [2A] - external market and sector observation data. Loaded after 02-data.js. */
// ==========================================
// 外部环境推测：复用历史版隔夜主题映射，只作 A 股行业方向提示，不进入策略、仓位或 B/S
// ==========================================
const EXTERNAL_LEAD_STRIP_CONFIG = {
    CACHE_KEY: 'dg_external_lead_strip_v1',
    COOLDOWN_MS: 60000,
    REQUEST_TIMEOUT_MS: 5000,
    MIN_SAME_DIRECTION: 2,
    MIN_AVERAGE_CHANGE: 1,
    PRIMARY_URL: 'https://push2delay.eastmoney.com/api/qt/ulist.np/get?fltt=2&invt=2&fields=f2,f3,f4,f12,f13,f14,f124&secids=105.SOXX,105.SMH,105.QQQ,105.MSFT,105.NVDA,105.AMD,105.TSLA,105.LI,105.BOTZ,105.SYM',
    ITEMS: {
        soxx: { code: 'SOXX', name: 'SOXX' },
        smh: { code: 'SMH', name: 'SMH' },
        qqq: { code: 'QQQ', name: 'QQQ' },
        msft: { code: 'MSFT', name: 'MSFT' },
        nvda: { code: 'NVDA', name: 'NVDA' },
        amd: { code: 'AMD', name: 'AMD' },
        tsla: { code: 'TSLA', name: 'TSLA' },
        li: { code: 'LI', name: 'LI' },
        botz: { code: 'BOTZ', name: 'BOTZ' },
        sym: { code: 'SYM', name: 'SYM' }
    },
    THEMES: [
        { key: 'semiconductor-compute', name: '半导体与算力', shortName: '芯片算力', evidenceKeys: ['soxx', 'smh', 'nvda', 'amd'], anchorKeys: ['soxx', 'smh'], minSameDirection: 3, industries: ['半导体', '电子元件', '通信设备'], shortIndustries: ['芯片', '元件', '通信'] },
        { key: 'ai-cloud', name: 'AI 与云计算', shortName: 'AI 云', evidenceKeys: ['qqq', 'msft'], anchorKeys: ['qqq'], minSameDirection: 2, industries: ['软件开发', '计算机设备', '通信设备'], shortIndustries: ['软件', '计算机', '通信'] },
        { key: 'smart-ev', name: '智能电动车', shortName: '智能车', evidenceKeys: ['tsla', 'li'], anchorKeys: ['tsla'], minSameDirection: 2, industries: ['汽车整车', '汽车零部件', '电池'], shortIndustries: ['整车', '零部件', '电池'] },
        { key: 'robotics-manufacturing', name: '机器人与智能制造', shortName: '机器人', evidenceKeys: ['botz', 'sym', 'tsla', 'nvda'], anchorKeys: ['botz'], minSameDirection: 3, industries: ['自动化设备', '通用设备', '专用设备'], shortIndustries: ['自动化', '通用', '专用'] }
    ]
};

const externalLeadStripState = {
    items: {},
    themes: [],
    source: '',
    fetchedAt: 0,
    lastAttemptAt: 0,
    status: 'idle',
    stale: false,
    error: '',
    inFlight: null,
    cacheLoaded: false,
    lastStableStatus: 'idle'
};

let externalLeadStripGeneration = 0;
let externalLeadStripController = null;
let externalLeadStripPreviousState = null;

function createObservationAbortError(message = '观察任务已取消') {
    if (typeof DOMException === 'function') return new DOMException(message, 'AbortError');
    const error = new Error(message);
    error.name = 'AbortError';
    return error;
}

function throwIfObservationAborted(signal) {
    if (signal?.aborted) throw createObservationAbortError();
}

function createObservationRequestScope(parentSignal, timeoutMs) {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    let parentAbortHandler = null;
    if (controller && parentSignal) {
        parentAbortHandler = () => controller.abort();
        if (parentSignal.aborted) parentAbortHandler();
        else if (typeof parentSignal.addEventListener === 'function') parentSignal.addEventListener('abort', parentAbortHandler, { once: true });
    }
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : 0;
    return {
        signal: controller?.signal || parentSignal,
        cleanup() {
            if (timer) clearTimeout(timer);
            if (parentSignal && parentAbortHandler && typeof parentSignal.removeEventListener === 'function') {
                parentSignal.removeEventListener('abort', parentAbortHandler);
            }
        }
    };
}

function sanitizeExternalLeadStripItem(key, item, options = {}) {
    const config = EXTERNAL_LEAD_STRIP_CONFIG.ITEMS[key];
    const value = Number(item?.value ?? item?.f2);
    const changePct = Number(item?.changePct ?? item?.f3);
    if (!config || !Number.isFinite(value) || !Number.isFinite(changePct)) return null;
    return {
        key,
        code: config.code,
        name: config.name,
        value,
        changePct,
        change: Number.isFinite(Number(item?.change ?? item?.f4)) ? Number(item?.change ?? item?.f4) : 0,
        quoteAt: normalizeSectorQuoteAt(item?.quoteAt ?? item?.f124),
        source: String(item?.source || ''),
        stale: options.stale ?? !!item?.stale
    };
}
function buildExternalLeadStripThemes(items = {}) {
    return EXTERNAL_LEAD_STRIP_CONFIG.THEMES.map(theme => {
        const evidence = theme.evidenceKeys.map(key => items[key]).filter(Boolean);
        const anchorKeys = Array.isArray(theme.anchorKeys) && theme.anchorKeys.length ? theme.anchorKeys : theme.evidenceKeys;
        const anchorEvidence = anchorKeys.map(key => items[key]).filter(Boolean);
        const confirmationEvidence = theme.evidenceKeys.filter(key => !anchorKeys.includes(key)).map(key => items[key]).filter(Boolean);
        const availableCount = evidence.length;
        const positiveCount = evidence.filter(item => item.changePct > 0).length;
        const negativeCount = evidence.filter(item => item.changePct < 0).length;
        const rawAverageChangePct = availableCount
            ? evidence.reduce((sum, item) => sum + item.changePct, 0) / availableCount
            : null;
        const anchorChangePct = anchorEvidence.length
            ? anchorEvidence.reduce((sum, item) => sum + item.changePct, 0) / anchorEvidence.length
            : null;
        const weightedCount = anchorEvidence.length * 2 + confirmationEvidence.length;
        const averageChangePct = weightedCount
            ? (anchorEvidence.reduce((sum, item) => sum + item.changePct * 2, 0)
                + confirmationEvidence.reduce((sum, item) => sum + item.changePct, 0)) / weightedCount
            : null;
        const minSameDirection = theme.minSameDirection ?? EXTERNAL_LEAD_STRIP_CONFIG.MIN_SAME_DIRECTION;
        const anchorsComplete = anchorEvidence.length === anchorKeys.length;
        let state = '信息不完整';
        let direction = '等待证据';
        let tone = 'is-neutral';
        if (anchorsComplete && availableCount >= minSameDirection) {
            if (positiveCount >= minSameDirection && anchorChangePct > 0 && averageChangePct >= EXTERNAL_LEAD_STRIP_CONFIG.MIN_AVERAGE_CHANGE) {
                state = '隔夜偏强';
                direction = '可能偏强';
                tone = 'is-positive';
            } else if (negativeCount >= minSameDirection && anchorChangePct < 0 && averageChangePct <= -EXTERNAL_LEAD_STRIP_CONFIG.MIN_AVERAGE_CHANGE) {
                state = '隔夜偏弱';
                direction = '可能承压';
                tone = 'is-negative';
            } else {
                state = '隔夜分化';
                direction = '方向分化';
                tone = 'is-mixed';
            }
        }
        return {
            key: theme.key,
            name: theme.name,
            shortName: theme.shortName || theme.name,
            industries: [...theme.industries],
            shortIndustries: [...(theme.shortIndustries || theme.industries)],
            evidence,
            anchorEvidence,
            confirmationEvidence,
            expectedCount: theme.evidenceKeys.length,
            availableCount,
            averageChangePct,
            rawAverageChangePct,
            anchorChangePct,
            state,
            direction,
            tone,
            stale: evidence.some(item => item.stale),
            quoteAt: evidence.reduce((latest, item) => Math.max(latest, item.quoteAt || 0), 0)
        };
    });
}

function loadExternalLeadStripCache() {
    if (externalLeadStripState.cacheLoaded) return externalLeadStripState;
    externalLeadStripState.cacheLoaded = true;
    try {
        const raw = localStorage.getItem(EXTERNAL_LEAD_STRIP_CONFIG.CACHE_KEY);
        const cached = raw ? JSON.parse(raw) : null;
        const items = {};
        Object.keys(EXTERNAL_LEAD_STRIP_CONFIG.ITEMS).forEach(key => {
            const item = sanitizeExternalLeadStripItem(key, cached?.items?.[key], { stale: true });
            if (item) items[key] = item;
        });
        externalLeadStripState.items = items;
        externalLeadStripState.themes = buildExternalLeadStripThemes(items);
        externalLeadStripState.source = String(cached?.source || (Object.keys(items).length ? '本地缓存' : ''));
        externalLeadStripState.fetchedAt = Number(cached?.fetchedAt) || 0;
        externalLeadStripState.lastAttemptAt = Number(cached?.lastAttemptAt) || 0;
        externalLeadStripState.status = Object.keys(items).length ? 'cached' : 'idle';
        externalLeadStripState.lastStableStatus = externalLeadStripState.status;
        externalLeadStripState.stale = Object.keys(items).length > 0;
    } catch (error) {}
    return externalLeadStripState;
}

function saveExternalLeadStripCache() {
    try {
        localStorage.setItem(EXTERNAL_LEAD_STRIP_CONFIG.CACHE_KEY, JSON.stringify({
            version: 1,
            items: externalLeadStripState.items,
            source: externalLeadStripState.source,
            fetchedAt: externalLeadStripState.fetchedAt,
            lastAttemptAt: externalLeadStripState.lastAttemptAt
        }));
    } catch (error) {}
}

function getExternalLeadStripCooldownRemaining(now = Date.now()) {
    return Math.max(0, EXTERNAL_LEAD_STRIP_CONFIG.COOLDOWN_MS - (now - externalLeadStripState.lastAttemptAt));
}

function notifyExternalLeadStripState() {
    if (state.tab !== 'external' || document.hidden) return;
    if (typeof renderExternalLeadStrip === 'function') renderExternalLeadStrip();
}

async function fetchExternalLeadStripItems(options = {}) {
    throwIfObservationAborted(options.signal);
    const requestScope = createObservationRequestScope(options.signal, EXTERNAL_LEAD_STRIP_CONFIG.REQUEST_TIMEOUT_MS);
    try {
        const response = await fetch(EXTERNAL_LEAD_STRIP_CONFIG.PRIMARY_URL, { method: 'GET', cache: 'no-store', ...(requestScope.signal ? { signal: requestScope.signal } : {}) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json();
        if (payload?.rc !== 0 || !Array.isArray(payload?.data?.diff)) throw new Error('外部主题行情返回无效');
        const items = {};
        payload.data.diff.forEach(row => {
            const key = Object.keys(EXTERNAL_LEAD_STRIP_CONFIG.ITEMS).find(itemKey => EXTERNAL_LEAD_STRIP_CONFIG.ITEMS[itemKey].code === String(row?.f12 || ''));
            const item = key ? sanitizeExternalLeadStripItem(key, { ...row, source: '东方财富', stale: false }) : null;
            if (item) items[key] = item;
        });
        if (!Object.keys(items).length) throw new Error('外部主题行情为空');
        return items;
    } finally {
        requestScope.cleanup();
    }
}

async function refreshExternalLeadStripSnapshot(options = {}) {
    loadExternalLeadStripCache();
    if (externalLeadStripState.inFlight) return externalLeadStripState.inFlight;
    if (state.tab !== 'external' || document.hidden) return externalLeadStripState;
    if (typeof canRequestMarketData === 'function' && !canRequestMarketData()) return externalLeadStripState;
    if (getExternalLeadStripCooldownRemaining() > 0) {
        notifyExternalLeadStripState();
        return externalLeadStripState;
    }
    const generation = ++externalLeadStripGeneration;
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    externalLeadStripController = controller;
    externalLeadStripState.lastStableStatus = externalLeadStripState.status === 'loading'
        ? externalLeadStripState.lastStableStatus
        : externalLeadStripState.status;
    externalLeadStripPreviousState = {
        status: externalLeadStripState.lastStableStatus || externalLeadStripState.status,
        error: externalLeadStripState.error,
        lastAttemptAt: externalLeadStripState.lastAttemptAt
    };
    const isCurrent = () => generation === externalLeadStripGeneration && !controller?.signal?.aborted;
    const task = (async () => {
        const cachedItems = { ...externalLeadStripState.items };
        externalLeadStripState.lastAttemptAt = Date.now();
        externalLeadStripState.status = 'loading';
        externalLeadStripState.error = '';
        saveExternalLeadStripCache();
        notifyExternalLeadStripState();
        let freshItems = {};
        try {
            freshItems = await fetchExternalLeadStripItems({ signal: controller?.signal });
        } catch (error) {
            if (!isCurrent()) return externalLeadStripState;
            externalLeadStripState.error = error?.name === 'AbortError' ? '外部主题行情请求超时' : (error?.message || '外部主题行情请求失败');
        }
        if (!isCurrent()) return externalLeadStripState;
        const nextItems = { ...freshItems };
        Object.keys(EXTERNAL_LEAD_STRIP_CONFIG.ITEMS).forEach(key => {
            if (nextItems[key]) return;
            const cached = sanitizeExternalLeadStripItem(key, cachedItems[key], { stale: true });
            if (cached) nextItems[key] = cached;
        });
        const freshCount = Object.keys(freshItems).length;
        const availableCount = Object.keys(nextItems).length;
        externalLeadStripState.items = nextItems;
        externalLeadStripState.themes = buildExternalLeadStripThemes(nextItems);
        externalLeadStripState.stale = freshCount < Object.keys(EXTERNAL_LEAD_STRIP_CONFIG.ITEMS).length;
        externalLeadStripState.status = freshCount
            ? (externalLeadStripState.stale ? 'partial' : 'ready')
            : (availableCount ? 'cached' : 'error');
        externalLeadStripState.lastStableStatus = externalLeadStripState.status;
        if (freshCount) {
            externalLeadStripState.source = '东方财富';
            externalLeadStripState.fetchedAt = Date.now();
        }
        saveExternalLeadStripCache();
        notifyExternalLeadStripState();
        return externalLeadStripState;
    })();
    const trackedTask = task.finally(() => {
        if (externalLeadStripState.inFlight === trackedTask) externalLeadStripState.inFlight = null;
        if (externalLeadStripController === controller) externalLeadStripController = null;
    });
    externalLeadStripState.inFlight = trackedTask;
    return trackedTask;
}

// 板块趋势快照：只用于发现正在走强的 A 股行业/概念，不进入历史 K 线、策略、仓位或 B/S
// ==========================================
const SECTOR_TREND_CONFIG = {
    CACHE_KEY: 'dg_sector_trend_snapshot_v2',
    LEGACY_CACHE_KEYS: ['dg_sector_trend_snapshot_v1', 'dg_external_market_snapshot_v1', 'dg_external_lead_snapshot_v1'],
    COOLDOWN_MS: 60000,
    REQUEST_TIMEOUT_MS: 8000,
    LIST_PAGE_SIZE: 100,
    MAX_LIST_PAGES: 6,
    LIST_CONCURRENCY: 3,
    COMPONENT_LIMIT: 6,
    COMPONENT_BOARD_LIMIT: 6,
    COMPONENT_CONCURRENCY: 3,
    TYPES: {
        industry: { label: '行业', fs: 'm:90+t:2', maxPages: 6, fullScan: true },
        concept: { label: '概念', fs: 'm:90+t:3', maxPages: 1, fullScan: false }
    },
    LIST_FIELDS: 'f2,f3,f6,f8,f12,f14,f20,f24,f25,f62,f104,f105,f106,f109,f128,f136,f140,f160,f184,f124',
    COMPONENT_FIELDS: 'f2,f3,f8,f12,f13,f14,f20,f62,f124'
};

// 只维护有明确官方指数对应关系的行业；细分行业没有可靠对应时不强行匹配。
const INDUSTRY_ETF_MAP = Object.freeze([
    { names: ['证券'], relation: 'direct', indexCode: '399975', indexName: '中证全指证券公司指数', etfCode: '512000', etfName: '券商ETF' },
    { names: ['银行'], relation: 'direct', indexCode: '399986', indexName: '中证银行指数', etfCode: '512800', etfName: '银行ETF' },
    { names: ['半导体'], relation: 'direct', indexCode: '931865', indexName: '中证全指半导体指数', etfCode: '512480', etfName: '半导体ETF' },
    { names: ['计算机'], relation: 'direct', indexCode: '930651', indexName: '中证计算机主题指数', etfCode: '512720', etfName: '计算机ETF' },
    { names: ['医疗', '医疗服务'], relation: 'direct', indexCode: '399989', indexName: '中证医疗指数', etfCode: '512170', etfName: '医疗ETF' },
    { names: ['军工', '国防军工'], relation: 'direct', indexCode: '399967', indexName: '中证军工指数', etfCode: '512660', etfName: '军工ETF' },
    { names: ['医疗研发外包', '其他生物制品'], relation: 'related', indexCode: '399989', indexName: '中证医疗相关方向', etfCode: '512170', etfName: '医疗ETF' },
    { names: ['印制电路板', '元件'], relation: 'related', indexCode: '', indexName: '电子行业相关方向', etfCode: '515260', etfName: '电子ETF' }
]);

const sectorTrendState = {
    boards: [],
    concepts: [],
    groups: { uptrend: [], turning: [], momentum: [] },
    summary: { totalCount: 0, conceptCount: 0, conceptTotal: 0, uptrendCount: 0, turningCount: 0, momentumCount: 0, strongest: '' },
    source: '',
    fetchedAt: 0,
    lastAttemptAt: 0,
    status: 'idle',
    stale: false,
    error: '',
    inFlight: null,
    cacheLoaded: false,
    lastStableStatus: 'idle'
};

let sectorTrendGeneration = 0;
let sectorTrendController = null;
let sectorTrendPreviousState = null;

function normalizeSectorQuoteAt(value) {
    const quoteAt = Number(value);
    if (!Number.isFinite(quoteAt) || quoteAt <= 0) return 0;
    return quoteAt < 1e12 ? quoteAt * 1000 : quoteAt;
}

function getFiniteSectorNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function sanitizeSectorCandidate(item) {
    const code = String(item?.code ?? item?.f12 ?? '').trim();
    const name = String(item?.name ?? item?.f14 ?? '').trim();
    if (!/^\d{6}$/.test(code) || !name || /(?:\*?ST|\u9000)/i.test(name)) return null;
    return {
        code,
        name,
        price: getFiniteSectorNumber(item?.price ?? item?.f2, 0),
        changePct: getFiniteSectorNumber(item?.changePct ?? item?.f3, 0),
        market: String(item?.market ?? item?.f13 ?? ''),
        stale: !!item?.stale
    };
}

function sanitizeSectorTrendBoard(item, options = {}) {
    const code = String(item?.code ?? item?.f12 ?? '').trim();
    const name = String(item?.name ?? item?.f14 ?? '').trim();
    const type = item?.type === 'concept' ? 'concept' : 'industry';
    if (!/^BK\d{4}$/.test(code) || !name) return null;
    const upCount = Math.max(0, Math.round(getFiniteSectorNumber(item?.upCount ?? item?.f104, 0)));
    const downCount = Math.max(0, Math.round(getFiniteSectorNumber(item?.downCount ?? item?.f105, 0)));
    const flatCount = Math.max(0, Math.round(getFiniteSectorNumber(item?.flatCount ?? item?.f106, 0)));
    const memberCount = upCount + downCount + flatCount;
    const candidates = Array.isArray(item?.candidates)
        ? item.candidates.map(candidate => sanitizeSectorCandidate({ ...candidate, stale: options.stale ?? candidate?.stale })).filter(Boolean).slice(0, SECTOR_TREND_CONFIG.COMPONENT_LIMIT)
        : [];
    const leader = sanitizeSectorCandidate({
        code: item?.leader?.code ?? item?.leaderCode ?? item?.f140,
        name: item?.leader?.name ?? item?.leaderName ?? item?.f128,
        changePct: item?.leader?.changePct ?? item?.leaderChangePct ?? item?.f136,
        stale: options.stale ?? item?.stale
    });
    if (!candidates.length && leader) candidates.push(leader);
    return {
        key: `${type}:${code}`,
        code,
        name,
        type,
        typeLabel: SECTOR_TREND_CONFIG.TYPES[type].label,
        price: getFiniteSectorNumber(item?.price ?? item?.f2, 0),
        changePct: getFiniteSectorNumber(item?.changePct ?? item?.f3, 0),
        return5: getFiniteSectorNumber(item?.return5 ?? item?.f109, 0),
        return10: getFiniteSectorNumber(item?.return10 ?? item?.f160, 0),
        return60: getFiniteSectorNumber(item?.return60 ?? item?.f24, 0),
        ytdReturn: getFiniteSectorNumber(item?.ytdReturn ?? item?.f25, 0),
        turnoverRate: getFiniteSectorNumber(item?.turnoverRate ?? item?.f8, 0),
        amount: Math.max(0, getFiniteSectorNumber(item?.amount ?? item?.f6, 0)),
        marketCap: Math.max(0, getFiniteSectorNumber(item?.marketCap ?? item?.f20, 0)),
        mainFlow: getFiniteSectorNumber(item?.mainFlow ?? item?.f62, 0),
        mainFlowPct: getFiniteSectorNumber(item?.mainFlowPct ?? item?.f184, 0),
        upCount,
        downCount,
        flatCount,
        memberCount,
        breadthPct: Number.isFinite(Number(item?.breadthPct))
            ? Number(item.breadthPct)
            : (memberCount ? upCount / memberCount * 100 : 0),
        relative5: getFiniteSectorNumber(item?.relative5, 0),
        relative10: getFiniteSectorNumber(item?.relative10, 0),
        score: Math.max(0, Math.min(100, Math.round(getFiniteSectorNumber(item?.score, 0)))),
        trendState: ['uptrend', 'turning', 'momentum', 'neutral'].includes(item?.trendState) ? item.trendState : 'neutral',
        trendLabel: String(item?.trendLabel || '待判定'),
        tone: String(item?.tone || 'is-neutral'),
        invalidCondition: String(item?.invalidCondition || ''),
        candidates,
        quoteAt: normalizeSectorQuoteAt(item?.quoteAt ?? item?.f124),
        stale: options.stale ?? !!item?.stale
    };
}

function getIndustryEtfMapping(board) {
    if (!board || board.type !== 'industry') return null;
    const mapping = INDUSTRY_ETF_MAP.find(item => item.names.includes(board.name));
    return mapping ? { ...mapping } : null;
}

function applyIndustryEtfMappings(boards = []) {
    const targets = new Set(boards.slice(0, SECTOR_TREND_CONFIG.COMPONENT_BOARD_LIMIT).map(board => board.key));
    boards.forEach(board => {
        board.etfMappingChecked = targets.has(board.key);
        board.etfMapping = board.etfMappingChecked ? getIndustryEtfMapping(board) : null;
    });
    return boards;
}

function getSectorMedian(values) {
    const valid = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (!valid.length) return 0;
    const middle = Math.floor(valid.length / 2);
    return valid.length % 2 ? valid[middle] : (valid[middle - 1] + valid[middle]) / 2;
}

function clampSectorScore(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function scoreSectorTrendBoard(board, medians) {
    let score = 0;
    if (board.return5 > 0) score += 10;
    if (board.return5 >= 3) score += 5;
    if (board.return5 >= 8) score += 5;
    if (board.return10 > 0) score += 10;
    if (board.return10 >= 5) score += 5;
    if (board.return60 > 0) score += 5;
    if (board.return60 >= 10) score += 5;
    if (board.return5 > medians.return5) score += 15;
    if (board.return10 > medians.return10) score += 10;
    score += clampSectorScore((board.breadthPct - 45) / 40 * 20, 0, 20);
    if (board.mainFlowPct > 0) score += 5;
    if (board.mainFlowPct >= 5) score += 3;
    if (board.changePct > 0) score += 2;
    score = Math.round(clampSectorScore(score, 0, 100));

    const multiPeriodUp = board.return5 > 0 && board.return10 > 0 && board.return60 > 0;
    let trendState = 'neutral';
    let trendLabel = '未进入前排';
    let tone = 'is-neutral';
    let invalidCondition = '';
    if (multiPeriodUp && board.breadthPct >= 55 && score >= 65) {
        trendState = 'uptrend';
        trendLabel = '上涨趋势';
        tone = 'is-positive';
        invalidCondition = '若5日或10日涨幅转负，或上涨家数降至50%以下，趋势转为观察。';
    } else if (board.return5 > 0 && (board.return10 > 0 || board.relative5 > 0) && board.breadthPct >= 50 && score >= 48) {
        trendState = 'turning';
        trendLabel = '刚刚转强';
        tone = 'is-mixed';
        invalidCondition = '若5日涨幅转负或上涨家数不足50%，转强观察失效。';
    } else if (board.changePct >= 2.5 && (!multiPeriodUp || board.breadthPct < 55)) {
        trendState = 'momentum';
        trendLabel = '单日异动';
        tone = 'is-warning';
        invalidCondition = '需等5日与10日涨幅同步转正且上涨家数扩散，才升级为趋势。';
    }
    return {
        ...board,
        relative5: board.return5 - medians.return5,
        relative10: board.return10 - medians.return10,
        score,
        trendState,
        trendLabel,
        tone,
        invalidCondition
    };
}

function buildSectorTrendSnapshot(rawBoards = [], options = {}) {
    const sourceBoards = options.industryOnly
        ? rawBoards.filter(item => item?.type !== 'concept')
        : rawBoards;
    const sanitized = sourceBoards.map(item => sanitizeSectorTrendBoard(item)).filter(Boolean);
    const medians = {
        return5: getSectorMedian(sanitized.map(item => item.return5)),
        return10: getSectorMedian(sanitized.map(item => item.return10))
    };
    const scored = sanitized.map(board => scoreSectorTrendBoard({
        ...board,
        relative5: board.return5 - medians.return5,
        relative10: board.return10 - medians.return10
    }, medians));
    const byScore = (a, b) => b.score - a.score || b.return5 - a.return5 || b.changePct - a.changePct;
    const uptrend = scored.filter(item => item.trendState === 'uptrend').sort(byScore).slice(0, 10);
    const turning = scored.filter(item => item.trendState === 'turning').sort(byScore).slice(0, 6);
    const momentum = scored.filter(item => item.trendState === 'momentum')
        .sort((a, b) => b.changePct - a.changePct || b.score - a.score).slice(0, 6);
    const displayed = [];
    const seen = new Set();
    [...uptrend, ...turning, ...momentum].forEach(item => {
        if (!seen.has(item.key)) {
            seen.add(item.key);
            displayed.push(item);
        }
    });
    const strongest = uptrend[0] || turning[0] || momentum[0] || null;
    return {
        boards: displayed,
        groups: { uptrend, turning, momentum },
        summary: {
            totalCount: scored.length,
            uptrendCount: scored.filter(item => item.trendState === 'uptrend').length,
            turningCount: scored.filter(item => item.trendState === 'turning').length,
            momentumCount: scored.filter(item => item.trendState === 'momentum').length,
            strongest: strongest?.name || '',
            median5: medians.return5,
            median10: medians.return10
        }
    };
}

function buildSectorConceptSnapshot(rawBoards = []) {
    const concepts = rawBoards
        .map(item => sanitizeSectorTrendBoard(item))
        .filter(Boolean)
        .sort((a, b) => b.changePct - a.changePct || b.return5 - a.return5 || b.amount - a.amount)
        .slice(0, 12);
    return { concepts, scannedCount: rawBoards.length };
}

function restoreSectorTrendGroups(boards) {
    return {
        uptrend: boards.filter(item => item.trendState === 'uptrend'),
        turning: boards.filter(item => item.trendState === 'turning'),
        momentum: boards.filter(item => item.trendState === 'momentum')
    };
}

function loadSectorTrendCache() {
    if (sectorTrendState.cacheLoaded) return sectorTrendState;
    sectorTrendState.cacheLoaded = true;
    try {
        const raw = localStorage.getItem(SECTOR_TREND_CONFIG.CACHE_KEY);
        const cached = raw ? JSON.parse(raw) : null;
        const cachedBoards = Array.isArray(cached?.boards)
            ? cached.boards.map(item => sanitizeSectorTrendBoard(item, { stale: true })).filter(Boolean)
            : [];
        const boards = cachedBoards.filter(item => item.type !== 'concept');
        const concepts = [
            ...(Array.isArray(cached?.concepts) ? cached.concepts : []),
            ...cachedBoards.filter(item => item.type === 'concept')
        ].map(item => sanitizeSectorTrendBoard(item, { stale: true })).filter(Boolean).slice(0, 12);
        if (!boards.length) return sectorTrendState;
        sectorTrendState.boards = boards;
        sectorTrendState.concepts = concepts;
        applyIndustryEtfMappings(sectorTrendState.boards);
        sectorTrendState.groups = restoreSectorTrendGroups(boards);
        sectorTrendState.summary = { ...sectorTrendState.summary, ...(cached.summary || {}) };
        sectorTrendState.source = String(cached.source || '本地缓存');
        sectorTrendState.fetchedAt = Number(cached.fetchedAt) || 0;
        sectorTrendState.lastAttemptAt = Number(cached.lastAttemptAt) || 0;
        sectorTrendState.status = 'cached';
        sectorTrendState.lastStableStatus = 'cached';
        sectorTrendState.stale = true;
    } catch (error) {}
    return sectorTrendState;
}

function saveSectorTrendCache() {
    try {
        localStorage.setItem(SECTOR_TREND_CONFIG.CACHE_KEY, JSON.stringify({
            version: 1,
            boards: sectorTrendState.boards,
            concepts: sectorTrendState.concepts,
            summary: sectorTrendState.summary,
            source: sectorTrendState.source,
            fetchedAt: sectorTrendState.fetchedAt,
            lastAttemptAt: sectorTrendState.lastAttemptAt
        }));
    } catch (error) {}
}

function getSectorTrendCooldownRemaining(now = Date.now()) {
    return Math.max(0, SECTOR_TREND_CONFIG.COOLDOWN_MS - (now - sectorTrendState.lastAttemptAt));
}

function notifySectorTrendState() {
    if (state.tab !== 'external' || document.hidden) return;
    if (typeof renderSectorTrendSnapshot === 'function') renderSectorTrendSnapshot();
}

function buildSectorTrendListUrl(type, page = 1) {
    const config = SECTOR_TREND_CONFIG.TYPES[type];
    if (!config) return '';
    return `https://push2delay.eastmoney.com/api/qt/clist/get?pn=${Math.max(1, page)}&pz=${SECTOR_TREND_CONFIG.LIST_PAGE_SIZE}&po=1&np=1&fltt=2&invt=2&fid=f3&fs=${encodeURIComponent(config.fs)}&fields=${SECTOR_TREND_CONFIG.LIST_FIELDS}`;
}

async function fetchSectorTrendJson(url, options = {}) {
    throwIfObservationAborted(options.signal);
    const requestScope = createObservationRequestScope(options.signal, SECTOR_TREND_CONFIG.REQUEST_TIMEOUT_MS);
    try {
        const response = await fetch(url, { method: 'GET', cache: 'no-store', ...(requestScope.signal ? { signal: requestScope.signal } : {}) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json();
        if (payload?.rc !== 0 || !Array.isArray(payload?.data?.diff)) throw new Error('板块行情返回无效');
        return {
            rows: payload.data.diff,
            total: Number.isFinite(Number(payload.data.total)) ? Number(payload.data.total) : 0
        };
    } finally {
        requestScope.cleanup();
    }
}

async function fetchSectorTrendPage(type, page, options = {}) {
    const url = buildSectorTrendListUrl(type, page);
    if (!url) return { rows: [], total: 0 };
    const payload = await fetchSectorTrendJson(url, options);
    return {
        rows: payload.rows.map(row => ({ ...row, type })).map(item => sanitizeSectorTrendBoard(item)).filter(Boolean),
        total: payload.total
    };
}

function createSectorTrendRequestLimiter(concurrency, signal) {
    const queue = [];
    let active = 0;
    const rejectQueued = () => {
        while (queue.length) queue.shift().reject(createObservationAbortError());
    };
    if (signal && typeof signal.addEventListener === 'function') signal.addEventListener('abort', rejectQueued, { once: true });
    const pump = () => {
        if (signal?.aborted) {
            rejectQueued();
            return;
        }
        while (active < concurrency && queue.length) {
            const entry = queue.shift();
            active++;
            Promise.resolve()
                .then(entry.task)
                .then(entry.resolve, entry.reject)
                .finally(() => {
                    active--;
                    pump();
                });
        }
    };
    return task => new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(createObservationAbortError());
            return;
        }
        queue.push({ task, resolve, reject });
        pump();
    });
}

async function fetchSectorTrendList(type, request = task => task(), options = {}) {
    throwIfObservationAborted(options.signal);
    const firstPage = await request(() => fetchSectorTrendPage(type, 1, options));
    const total = firstPage.total;
    const expectedPages = total > 0
        ? Math.ceil(total / SECTOR_TREND_CONFIG.LIST_PAGE_SIZE)
        : 1;
    const typeConfig = SECTOR_TREND_CONFIG.TYPES[type] || {};
    const maxPages = Number(typeConfig.maxPages) || SECTOR_TREND_CONFIG.MAX_LIST_PAGES;
    const pageCount = Math.min(expectedPages, maxPages);
    const remainingPages = Array.from({ length: Math.max(0, pageCount - 1) }, (_, index) => index + 2);
    const pageResults = await Promise.all(remainingPages.map(page => request(() => fetchSectorTrendPage(type, page, options))
        .then(result => ({ page, result }))
        .catch(error => ({ page, error }))));
    const failedPages = pageResults.filter(item => item?.error);
    const rows = [firstPage.rows, ...pageResults.filter(item => item?.result).map(item => item.result.rows)].flat();
    const errors = failedPages.map(item => item.error);
    if (expectedPages > maxPages && typeConfig.fullScan !== false) {
        errors.push(new Error(`${maxPages}页后仍有板块未扫描`));
    }
    return {
        rows,
        total,
        expectedPages,
        fetchedPages: 1 + pageResults.filter(item => item?.result).length,
        complete: errors.length === 0,
        errors
    };
}

async function fetchSectorBoardCandidates(board, options = {}) {
    throwIfObservationAborted(options.signal);
    const fs = encodeURIComponent(`b:${board.code}`);
    const url = `https://push2delay.eastmoney.com/api/qt/clist/get?pn=1&pz=8&po=1&np=1&fltt=2&invt=2&fid=f3&fs=${fs}&fields=${SECTOR_TREND_CONFIG.COMPONENT_FIELDS}`;
    const payload = await fetchSectorTrendJson(url, options);
    return payload.rows.map(row => sanitizeSectorCandidate(row)).filter(Boolean).slice(0, SECTOR_TREND_CONFIG.COMPONENT_LIMIT);
}

async function refreshSectorTrendSnapshot(options = {}) {
    loadSectorTrendCache();
    if (sectorTrendState.inFlight) return sectorTrendState.inFlight;
    if (state.tab !== 'external' || document.hidden) return sectorTrendState;
    if (typeof canRequestMarketData === 'function' && !canRequestMarketData()) return sectorTrendState;
    if (getSectorTrendCooldownRemaining() > 0) {
        notifySectorTrendState();
        return sectorTrendState;
    }

    const generation = ++sectorTrendGeneration;
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    sectorTrendController = controller;
    sectorTrendState.lastStableStatus = sectorTrendState.status === 'loading'
        ? sectorTrendState.lastStableStatus
        : sectorTrendState.status;
    sectorTrendPreviousState = {
        status: sectorTrendState.lastStableStatus || sectorTrendState.status,
        error: sectorTrendState.error,
        lastAttemptAt: sectorTrendState.lastAttemptAt
    };
    const isCurrent = () => generation === sectorTrendGeneration && !controller?.signal?.aborted;
    const task = (async () => {
        sectorTrendState.lastAttemptAt = Date.now();
        sectorTrendState.status = 'loading';
        sectorTrendState.error = '';
        notifySectorTrendState();

        const listRequest = createSectorTrendRequestLimiter(SECTOR_TREND_CONFIG.LIST_CONCURRENCY, controller?.signal);
        const listResults = await Promise.allSettled(Object.keys(SECTOR_TREND_CONFIG.TYPES).map(type => fetchSectorTrendList(type, listRequest, { signal: controller?.signal })));
        if (!isCurrent()) return sectorTrendState;
        const freshRows = listResults.flatMap(result => result.status === 'fulfilled' ? result.value.rows : []);
        const freshIndustryBoards = freshRows.filter(item => item.type === 'industry');
        const freshConceptBoards = freshRows.filter(item => item.type === 'concept');
        const listErrors = listResults.flatMap(result => {
            if (result.status === 'rejected') return [result.reason];
            return result.value.errors || [];
        }).map(error => error?.name === 'AbortError' ? '板块列表请求超时' : (error?.message || '板块列表请求失败'));

        if (!freshIndustryBoards.length) {
            sectorTrendState.error = Array.from(new Set(listErrors)).join('；') || '板块行情暂不可用';
            sectorTrendState.status = sectorTrendState.boards.length ? 'cached' : 'error';
            sectorTrendState.lastStableStatus = sectorTrendState.status;
            sectorTrendState.stale = sectorTrendState.boards.length > 0;
            saveSectorTrendCache();
            notifySectorTrendState();
            return sectorTrendState;
        }

        const snapshot = buildSectorTrendSnapshot(freshIndustryBoards, { industryOnly: true });
        const conceptSnapshot = buildSectorConceptSnapshot(freshConceptBoards);
        const candidateTargets = snapshot.boards.slice(0, SECTOR_TREND_CONFIG.COMPONENT_BOARD_LIMIT);
        const candidateResults = await pLimit(candidateTargets, SECTOR_TREND_CONFIG.COMPONENT_CONCURRENCY, board => fetchSectorBoardCandidates(board, { signal: controller?.signal }));
        if (!isCurrent()) return sectorTrendState;
        let componentFailures = 0;
        candidateTargets.forEach((board, index) => {
            const candidates = candidateResults[index];
            if (Array.isArray(candidates) && candidates.length) board.candidates = candidates;
            else componentFailures++;
        });

        sectorTrendState.boards = snapshot.boards;
        applyIndustryEtfMappings(sectorTrendState.boards);
        sectorTrendState.concepts = conceptSnapshot.concepts;
        sectorTrendState.groups = snapshot.groups;
        sectorTrendState.summary = {
            ...snapshot.summary,
            conceptCount: conceptSnapshot.scannedCount,
            conceptTotal: listResults.find(result => result.status === 'fulfilled' && result.value.rows.some(item => item.type === 'concept'))?.value.total || conceptSnapshot.scannedCount
        };
        sectorTrendState.source = '东方财富板块行情（行业全量 + 概念热点首100）';
        sectorTrendState.fetchedAt = Date.now();
        sectorTrendState.stale = listErrors.length > 0 || componentFailures > 0;
        sectorTrendState.error = [
            ...Array.from(new Set(listErrors)),
            componentFailures ? `${componentFailures} 个前排板块暂未补齐活跃个股` : ''
        ].filter(Boolean).join('；');
        sectorTrendState.status = sectorTrendState.stale ? 'partial' : 'ready';
        sectorTrendState.lastStableStatus = sectorTrendState.status;
        saveSectorTrendCache();
        notifySectorTrendState();
        return sectorTrendState;
    })();

    const trackedTask = task.finally(() => {
        if (sectorTrendState.inFlight === trackedTask) sectorTrendState.inFlight = null;
        if (sectorTrendController === controller) sectorTrendController = null;
    });
    sectorTrendState.inFlight = trackedTask;
    return trackedTask;
}

function restoreCancelledObservationState(snapshotState, hasSnapshot, previousState) {
    if (snapshotState.status === 'loading') {
        snapshotState.status = previousState?.status || (hasSnapshot ? 'cached' : 'idle');
    }
    snapshotState.lastAttemptAt = Number(previousState?.lastAttemptAt) || 0;
    snapshotState.error = previousState?.error || '';
}

function cancelExternalObservationTasks(reason = 'lifecycle') {
    const cancelLeadStrip = !!externalLeadStripController || !!externalLeadStripState.inFlight;
    const cancelSectorTrend = !!sectorTrendController || !!sectorTrendState.inFlight;
    externalLeadStripGeneration++;
    sectorTrendGeneration++;
    try { externalLeadStripController?.abort?.(reason); } catch (error) {}
    try { sectorTrendController?.abort?.(reason); } catch (error) {}
    externalLeadStripController = null;
    sectorTrendController = null;
    externalLeadStripState.inFlight = null;
    sectorTrendState.inFlight = null;
    if (cancelLeadStrip) {
        restoreCancelledObservationState(externalLeadStripState, Object.keys(externalLeadStripState.items || {}).length > 0, externalLeadStripPreviousState);
        saveExternalLeadStripCache();
    }
    if (cancelSectorTrend) {
        restoreCancelledObservationState(sectorTrendState, (sectorTrendState.boards || []).length > 0, sectorTrendPreviousState);
        saveSectorTrendCache();
    }
    return getExternalObservationRuntime();
}

function getExternalObservationRuntime() {
    return {
        externalLeadGeneration: externalLeadStripGeneration,
        sectorTrendGeneration,
        externalLeadInFlight: !!externalLeadStripState.inFlight,
        sectorTrendInFlight: !!sectorTrendState.inFlight,
        externalLeadController: !!externalLeadStripController,
        sectorTrendController: !!sectorTrendController
    };
}
