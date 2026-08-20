/* DailyGlance [2] - split from dailyglance.html. Keep classic script order. */
// ==========================================
// [2] 接口与数据层 (API & Data Layer)
// ==========================================

const INDEX_CONFIG = {
    sh: { name: '上证指数', tickflow: '000001.SH', eastmoney: '1.000001', tencent: 'sh000001', role: 'observe' },
    sz: { name: '深证成指', tickflow: '399001.SZ', eastmoney: '0.399001', tencent: 'sz399001', role: 'observe' },
    hs300: { name: '沪深300', tickflow: '000300.SH', eastmoney: '1.000300', tencent: 'sh000300', role: 'core' },
    zz500: { name: '中证500', tickflow: '000905.SH', eastmoney: '1.000905', tencent: 'sh000905', role: 'core' },
    zz1000: { name: '中证1000', tickflow: '000852.SH', eastmoney: '1.000852', tencent: 'sh000852', role: 'core' },
    cy: { name: '创业板指', tickflow: '399006.SZ', eastmoney: '0.399006', tencent: 'sz399006', role: 'observe' },
    kc50: { name: '科创50', tickflow: '000688.SH', eastmoney: '1.000688', tencent: 'sh000688', role: 'observe' },
    bz50: { name: '北证50', tickflow: '899050.BJ', eastmoney: '0.899050', tencent: 'bj899050', role: 'observe' }
};
const INDEX_IDS = Object.keys(INDEX_CONFIG);
const CORE_MARKET_INDEX_IDS = INDEX_IDS.filter(id => INDEX_CONFIG[id].role === 'core');
function getIndexConfig(id) { return INDEX_CONFIG[id] || null; }
function resolveSecid(id) {
    const cfg = getIndexConfig(id);
    if (cfg) return cfg.eastmoney;
    if (id && typeof id === 'object') return resolveSecuritySecid(id);
    const text = String(id || '').trim();
    if (/^\d{6}$/.test(text)) return codeToSecid(text);
    return text;
}
function resolveTencentSymbol(id) {
    const cfg = getIndexConfig(id);
    if(cfg) return cfg.tencent;
    return resolveSecurityTencentSymbol(id);
}
function resolveTickFlowSymbol(id) {
    const cfg = getIndexConfig(id);
    if (cfg) return cfg.tickflow;
    const secid = resolveSecuritySecid(id);
    const code = getSecurityCode(id) || (String(secid || '').includes('.') ? String(secid).split('.')[1] : '');
    const market = getMarketFromSecid(secid);
    if (!/^\d{6}$/.test(code) || !['sh', 'sz'].includes(market)) return '';
    return `${code}.${market === 'sh' ? 'SH' : 'SZ'}`;
}

const STOCK_TOKEN='D43BF722C8E33BDC906FB84D85E326E8';
function codeToSecid(c){
    const code = String(c || '').trim();
    return /^(5|6|9)/.test(code) ? '1.' + code : '0.' + code;
}
const STOCK_DATABASE = [
    {Code:'601398',Name:'工商银行'},{Code:'601939',Name:'建设银行'},{Code:'601988',Name:'中国银行'},{Code:'601318',Name:'中国平安'},{Code:'600519',Name:'贵州茅台'},{Code:'000858',Name:'五粮液'},{Code:'000333',Name:'美的集团'},{Code:'002594',Name:'比亚迪'},{Code:'300750',Name:'宁德时代'},{Code:'601012',Name:'隆基绿能'},{Code:'002371',Name:'北方华创'},{Code:'603501',Name:'韦尔股份'},{Code:'002475',Name:'立讯精密'},{Code:'600276',Name:'恒瑞医药'},{Code:'300760',Name:'迈瑞医疗'},{Code:'601899',Name:'紫金矿业'}
];
let stockCache = [];
function stripCorporateActionNamePrefix(name) {
    return String(name || '').trim().replace(/^(XD|XR|DR)\s*/i, '').trim();
}
function getBuiltInStockName(code) {
    return STOCK_DATABASE.find(stock => stock.Code === code)?.Name || '';
}
function normalizeStockDisplayName(code, name) {
    const safeCode = String(code || '').trim();
    const builtInName = getBuiltInStockName(safeCode);
    if (builtInName) return builtInName;
    const strippedName = stripCorporateActionNamePrefix(name);
    return strippedName || safeCode;
}
function getSecurityCode(input) {
    if (!input) return '';
    if (typeof input === 'string') {
        const text = input.trim();
        return text.includes('.') ? text.split('.')[1] : text;
    }
    return String(input.code || input.Code || input.UnifiedCode || '').trim();
}
function getSecurityQuoteId(input) {
    if (!input || typeof input !== 'object') return '';
    return String(input.secid || input.QuoteID || input.quoteId || input.quoteID || '').trim();
}
function getMarketFromSecid(secid) {
    const text = String(secid || '').trim();
    if (text.startsWith('1.')) return 'sh';
    if (text.startsWith('0.')) return 'sz';
    return '';
}
function inferSecurityType(input = {}) {
    if (typeof input === 'string') return 'stock';
    const typeText = [
        input.type,
        input.Classify,
        input.SecurityTypeName,
        input.SecurityType
    ].map(v => String(v || '').toLowerCase()).join('|');
    const name = String(input.name || input.Name || '');
    if (typeText.includes('fund') || typeText.includes('基金') || typeText.includes('|8') || /ETF/i.test(name)) return 'fund';
    return 'stock';
}
function isSupportedWatchlistSecurity(input = {}) {
    const code = getSecurityCode(input);
    const quoteId = getSecurityQuoteId(input);
    if (!/^\d{6}$/.test(code)) return false;
    if (quoteId && !/^[01]\.\d{6}$/.test(quoteId)) return false;

    const isAStock = /^(?:00[0-3]|30[01]|60[0135]|68[89])\d{3}$/.test(code);
    const isExchangeFund = /^(?:5\d{5}|1[568]\d{4})$/.test(code);
    return isAStock || isExchangeFund;
}
function resolveSecuritySecid(input) {
    const cfg = typeof input === 'string' ? getIndexConfig(input) : null;
    if (cfg) return cfg.eastmoney;
    const quoteId = getSecurityQuoteId(input);
    if (/^[01]\.\d{6}$/.test(quoteId)) return quoteId;
    const code = getSecurityCode(input);
    if (/^\d{6}$/.test(code)) return codeToSecid(code);
    return typeof input === 'string' ? input : quoteId;
}
function resolveSecurityTencentSymbol(input) {
    if (input && typeof input === 'object' && input.tencentSymbol) return input.tencentSymbol;
    const secid = resolveSecuritySecid(input);
    const code = getSecurityCode(input) || (String(secid || '').includes('.') ? String(secid).split('.')[1] : String(secid || ''));
    const market = getMarketFromSecid(secid);
    if (market === 'sh') return 'sh' + code;
    if (market === 'sz') return 'sz' + code;
    return String(code || '').startsWith('6') ? 'sh' + code : 'sz' + code;
}
function normalizeSecurityTarget(input = {}) {
    const code = getSecurityCode(input);
    const rawName = typeof input === 'string' ? code : (input.name || input.Name || code);
    const name = normalizeStockDisplayName(code, rawName);
    const type = inferSecurityType(input);
    const secid = resolveSecuritySecid({ ...input, code });
    const market = getMarketFromSecid(secid) || (secid.startsWith('1.') ? 'sh' : 'sz');
    return {
        code,
        name,
        type,
        secid,
        market,
        tencentSymbol: resolveSecurityTencentSymbol({ ...input, code, secid })
    };
}
function isFundSecurity(input) {
    if (!input) return false;
    if (typeof input === 'object') return normalizeSecurityTarget(input).type === 'fund';
    const text = String(input || '').trim();
    const matched = state?.watchlist?.find(item => item.secid === text || item.code === text);
    return matched ? normalizeSecurityTarget(matched).type === 'fund' : false;
}
function getSecurityPricePrecision(input) {
    return isFundSecurity(input) ? 3 : 2;
}
function getSecurityShortName(input, fallbackName = '') {
    const target = typeof input === 'object'
        ? normalizeSecurityTarget(input)
        : normalizeSecurityTarget({ Code: getSecurityCode(input), Name: fallbackName || input });
    if (target.type !== 'fund') return target.name;
    const idx = target.name.toUpperCase().indexOf('ETF');
    return idx >= 0 ? target.name.slice(0, idx + 3) : target.name;
}
function getActiveSecurityTarget() {
    if (state.mode !== 'stock' || !state.stockId) return null;
    const found = (state.watchlist || []).find(item => item.code === state.stockId || item.secid === state.id);
    if (found) return normalizeSecurityTarget(found);
    return normalizeSecurityTarget({ Code: state.stockId, Name: state.stockId, secid: state.id });
}
const cachedFetchRefreshJobs = new Map();
let cachedFetchRefreshApplyTimer = 0;
let pendingCachedFetchRefreshApplyId = '';

// JSONP cleanup registry — prevents script tag and global callback leaks on page unload
const _jsonpCleanupFns = new Set();
function _registerJsonpCleanup(fn) { _jsonpCleanupFns.add(fn); }
function _unregisterJsonpCleanup(fn) { _jsonpCleanupFns.delete(fn); }
function _runJsonpCleanup() { Array.from(_jsonpCleanupFns).forEach(fn => { try { fn(); } catch(e) {} }); _jsonpCleanupFns.clear(); }
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('pagehide', _runJsonpCleanup);
}
const historyRefreshMeta = new Map();
const historySourceCircuits = new Map();
const CN_MARKET_HOLIDAYS = new Set([
    // 2026 mainland exchange holidays, from SSE/SZSE yearly market-close notices.
    '2026-01-01', '2026-01-02',
    '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19', '2026-02-20', '2026-02-23',
    '2026-04-06',
    '2026-05-01', '2026-05-04', '2026-05-05',
    '2026-06-19',
    '2026-09-25',
    '2026-10-01', '2026-10-02', '2026-10-05', '2026-10-06', '2026-10-07'
]);

function getBJDate() { return new Date(new Date().toLocaleString("en-US", {timeZone: "Asia/Shanghai"})); }
function isValidPrice(price, id) { return !isNaN(price) && price > 0; }
function formatBJDate(date = getBJDate()) { return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`; }
function getTodayDate() { return formatBJDate(getBJDate()); }

function getHistorySourceCircuit(source) {
    return historySourceCircuits.get(source) || { consecutiveFailures: 0, openUntil: 0 };
}

function isHistorySourceCircuitOpen(source, now = Date.now()) {
    const circuit = getHistorySourceCircuit(source);
    if (!circuit.openUntil) return false;
    if (circuit.openUntil > now) return true;
    historySourceCircuits.delete(source);
    return false;
}

function recordHistorySourceTransportFailure(source, now = Date.now()) {
    const circuit = getHistorySourceCircuit(source);
    const consecutiveFailures = circuit.consecutiveFailures + 1;
    const openUntil = consecutiveFailures >= SYS_CONFIG.HISTORY_SOURCE_FAILURE_THRESHOLD
        ? now + SYS_CONFIG.HISTORY_SOURCE_CIRCUIT_MS
        : 0;
    historySourceCircuits.set(source, { consecutiveFailures, openUntil });
}

function recordHistorySourceSuccess(source) {
    historySourceCircuits.delete(source);
}

function resetHistorySourceCircuits() {
    historySourceCircuits.clear();
}

function parseTencentQuoteTime(raw) {
    const text = String(raw || '').trim();
    if (!/^\d{14}$/.test(text)) return null;
    const y = Number(text.slice(0, 4));
    const mo = Number(text.slice(4, 6));
    const d = Number(text.slice(6, 8));
    const h = Number(text.slice(8, 10));
    const mi = Number(text.slice(10, 12));
    const s = Number(text.slice(12, 14));
    if (y < 2000 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null;
    const parsed = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
    if (Number.isNaN(parsed.getTime())) return null;
    if (parsed.getUTCFullYear() !== y || parsed.getUTCMonth() + 1 !== mo || parsed.getUTCDate() !== d || parsed.getUTCHours() !== h || parsed.getUTCMinutes() !== mi || parsed.getUTCSeconds() !== s) return null;
    const date = `${text.slice(0,4)}-${text.slice(4,6)}-${text.slice(6,8)}`;
    const time = `${text.slice(8,10)}:${text.slice(10,12)}:${text.slice(12,14)}`;
    return { date, quoteTime: `${date} ${time}`, quoteDateSource: 'api' };
}
function getTencentQuoteTimeInfo(fields, fallbackDate = getTodayDate()) {
    const candidates = [fields?.[30], ...(fields || [])];
    for (const raw of candidates) {
        const parsed = parseTencentQuoteTime(raw);
        if (parsed) return parsed;
    }
    return { date: fallbackDate, quoteTime: '', quoteDateSource: 'local-fallback' };
}

function normalizeTencentQuoteAmount(rawAmount) {
    const amountInTenThousands = parseFloat(rawAmount);
    return Number.isFinite(amountInTenThousands) && amountInTenThousands >= 0
        ? amountInTenThousands * 10000
        : 0;
}
function isTradingDay(dateStr) {
    if (!dateStr) return false;
    const d = new Date(dateStr + 'T00:00:00+08:00');
    const day = d.getDay();
    return day !== 0 && day !== 6 && !CN_MARKET_HOLIDAYS.has(dateStr);
}
function isMarketOpen() {
    const now = getBJDate(), m = now.getHours() * 60 + now.getMinutes();
    return isTradingDay(formatBJDate(now)) && m >= 9 * 60 + 15 && m <= 15 * 60 + 15;
}
function isAfterMarketClose() {
    const now = getBJDate(), m = now.getHours() * 60 + now.getMinutes();
    return !isTradingDay(formatBJDate(now)) || m > 15 * 60 + 15;
}
function getLastTradingDate(refDate = getBJDate()) {
    const d = new Date(refDate.getTime());
    const today = formatBJDate(d);
    const m = d.getHours() * 60 + d.getMinutes();
    if (isTradingDay(today) && m > 15 * 60 + 15) return today;
    do {
        d.setDate(d.getDate() - 1);
    } while (!isTradingDay(formatBJDate(d)));
    return formatBJDate(d);
}
function getPreviousTradingDate(refDate = getBJDate()) {
    const d = new Date(refDate.getTime());
    do {
        d.setDate(d.getDate() - 1);
    } while (!isTradingDay(formatBJDate(d)));
    return formatBJDate(d);
}
function getExpectedConfirmedDate() {
    const now = getBJDate(), today = formatBJDate(now), m = now.getHours() * 60 + now.getMinutes();
    return isTradingDay(today) && m > 15 * 60 + 15 ? today : getLastTradingDate(now);
}
function isConfirmedSeriesFreshEnough(series) {
    if (!series || !series.length) return false;
    return (series[series.length - 1]?.date || '') >= getExpectedConfirmedDate();
}
function getConfirmedHistoryCutoffDate() {
    return getExpectedConfirmedDate();
}
function normalizeConfirmedHistoryData(rows, id) {
    if (!rows || !rows.length) return [];
    const cutoffDate = getConfirmedHistoryCutoffDate();
    const byDate = new Map();
    rows.forEach(row => {
        if (!row || !row.date || row.date > cutoffDate) return;
        const open = parseFloat(row.open);
        const close = parseFloat(row.close);
        const high = parseFloat(row.high);
        const low = parseFloat(row.low);
        const vol = parseFloat(row.vol);
        const amt = parseFloat(row.amt);
        if (!isValidPrice(open, id) || !isValidPrice(close, id) || !isValidPrice(high, id) || !isValidPrice(low, id)) return;
        const fixedHigh = Math.max(high, open, close, low);
        const fixedLow = Math.min(low, open, close, high);
        byDate.set(row.date, {
            date: row.date,
            open,
            close,
            high: fixedHigh,
            low: fixedLow,
            vol: Number.isFinite(vol) && vol >= 0 ? vol : 0,
            amt: Number.isFinite(amt) && amt >= 0 ? amt : 0
        });
    });
    return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}
function getQuoteBar(id) {
    syncExpiredCachedLiveOverlay(id);
    return state.liveQuotes?.[id] || state.liveBars?.[id] || null;
}
function getMergedLiveDailyData(id) {
    syncExpiredCachedLiveOverlay(id);
    const confirmed = state.rawData[id] || [];
    const liveBar = state.liveBars?.[id];
    if (!liveBar) return confirmed;
    if (!confirmed.length) return [liveBar];
    const last = confirmed[confirmed.length - 1];
    if (!last || liveBar.date < last.date) return confirmed;
    if (liveBar.date === last.date) {
        return confirmed.slice(0, -1).concat(liveBar);
    }
    return confirmed.concat(liveBar);
}

function getMergedLiveWeeklyData(id) {
    syncExpiredCachedLiveOverlay(id);
    if (!state.liveBars?.[id]) return state.weeklyData[id];
    if (!state.liveWeeklyData?.[id]) state.liveWeeklyData[id] = convertDailyToWeekly(getMergedLiveDailyData(id));
    return state.liveWeeklyData[id];
}

function getActiveData() {
    return state.period === 'weekly'
        ? getMergedLiveWeeklyData(state.id)
        : getMergedLiveDailyData(state.id);
}

function getVisibleQuoteData(id) {
    const confirmed = state.rawData[id] || [];
    const quote = getQuoteBar(id);
    if (!quote || !isValidPrice(quote.close, id)) return getMergedLiveDailyData(id);
    if (!confirmed.length) return [quote];
    const last = confirmed[confirmed.length - 1];
    if (!last || quote.date < last.date) return getMergedLiveDailyData(id);
    const confirmedStatus = state.confirmedStatus?.[id] || {};
    if (
        quote.date === last.date &&
        confirmedStatus.status === 'fresh' &&
        confirmedStatus.lastDate === last.date
    ) {
        return confirmed;
    }
    if (quote.date === last.date) return confirmed.slice(0, -1).concat(quote);
    return confirmed.concat(quote);
}

function getVisibleQuoteChangeBase(id, visibleData = getVisibleQuoteData(id)) {
    const quote = getQuoteBar(id);
    if (quote && quote.prevClose && isValidPrice(quote.prevClose, id)) return quote.prevClose;
    if (visibleData?.length > 1) return visibleData[visibleData.length - 2].close;
    if (visibleData?.length) return visibleData[0].open;
    return 1;
}

function getLiveOverlayCacheKey(id) {
    return `${SYS_CONFIG.LIVE_OVERLAY_CACHE_KEY}:${id}`;
}

function hydrateLiveOverlayCacheState() {
    if (!state.liveOverlayCache) state.liveOverlayCache = {};
    try {
        const raw = localStorage.getItem(SYS_CONFIG.LIVE_OVERLAY_CACHE_KEY);
        state.liveOverlayCache = raw ? JSON.parse(raw) || {} : {};
    } catch (error) {
        state.liveOverlayCache = {};
    }
    return state.liveOverlayCache;
}

function persistLiveOverlayCacheState() {
    if (!state.liveOverlayCache) state.liveOverlayCache = {};
    try {
        localStorage.setItem(SYS_CONFIG.LIVE_OVERLAY_CACHE_KEY, JSON.stringify(state.liveOverlayCache));
    } catch (error) {}
}

function normalizeLiveOverlayCacheBar(id, bar) {
    if (!id || !bar || !isValidPrice(bar.close, id)) return null;
    return {
        date: bar.date || getTodayDate(),
        open: Number(bar.open) || Number(bar.close) || 0,
        high: Number.isFinite(Number(bar.high)) ? Number(bar.high) : Number(bar.close) || 0,
        low: Number.isFinite(Number(bar.low)) ? Number(bar.low) : Number(bar.close) || 0,
        close: Number(bar.close),
        prevClose: Number.isFinite(Number(bar.prevClose)) ? Number(bar.prevClose) : 0,
        vol: Number.isFinite(Number(bar.vol)) ? Number(bar.vol) : 0,
        amt: Number.isFinite(Number(bar.amt)) ? Number(bar.amt) : 0,
        quoteTime: bar.quoteTime || '',
        quoteDateSource: bar.quoteDateSource || '',
        _isLive: true,
        _isCachedLive: true
    };
}

function getLiveOverlayCacheEntry(id) {
    const store = hydrateLiveOverlayCacheState();
    const entry = store[id];
    if (!entry || !entry.bar) return null;
    const cachedAt = Number(entry.cachedAt) || 0;
    const cacheAgeMs = Number.isFinite(Number(entry.cacheAgeMs)) ? Number(entry.cacheAgeMs) : (cachedAt ? Date.now() - cachedAt : Infinity);
    const bar = normalizeLiveOverlayCacheBar(id, entry.bar);
    if (!bar || !cachedAt) {
        if (entry) {
            delete store[id];
            persistLiveOverlayCacheState();
        }
        return null;
    }
    return {
        id,
        cachedAt,
        cacheAgeMs,
        bar,
        source: entry.source || 'api'
    };
}

function setLiveOverlayCache(id, bar, meta = {}) {
    if (!id) return false;
    const normalizedBar = normalizeLiveOverlayCacheBar(id, bar);
    if (!normalizedBar) return false;
    hydrateLiveOverlayCacheState();
    state.liveOverlayCache[id] = {
        cachedAt: Number(meta.cachedAt) || Date.now(),
        cacheAgeMs: Number.isFinite(Number(meta.cacheAgeMs)) ? Number(meta.cacheAgeMs) : 0,
        source: meta.source || 'api',
        bar: normalizedBar
    };
    persistLiveOverlayCacheState();
    return true;
}

function clearLiveOverlayCache(id) {
    hydrateLiveOverlayCacheState();
    if (state.liveOverlayCache && state.liveOverlayCache[id]) {
        delete state.liveOverlayCache[id];
        persistLiveOverlayCacheState();
    }
}

function canUseCachedLiveOverlay(id, series, cacheEntry) {
    if (!cacheEntry || !cacheEntry.bar) return { ok: false, reason: 'missing-cache' };
    if (isAfterMarketClose() && cacheEntry.bar.date === getTodayDate()) {
        const lastBar = series?.length ? series[series.length - 1] : null;
        if (!lastBar || !isValidPrice(cacheEntry.bar.close, id)) return { ok: false, reason: 'invalid-price' };
        if (lastBar.date < getPreviousTradingDate()) return { ok: false, reason: 'confirmed-history-stale' };
        if (cacheEntry.bar.date < lastBar.date) return { ok: false, reason: 'quote-older-than-history' };
        const isIndex = !!getIndexConfig(id);
        if (isIndex || cacheEntry.bar.date === lastBar.date) return { ok: true, reason: 'post-close-pending' };
        if (!cacheEntry.bar.prevClose || !isValidPrice(cacheEntry.bar.prevClose, id) || !lastBar.close || !isValidPrice(lastBar.close, id)) {
            return { ok: false, reason: 'missing-prev-close' };
        }
        const prevCloseDiff = Math.abs(cacheEntry.bar.prevClose - lastBar.close) / lastBar.close;
        if (prevCloseDiff > SYS_CONFIG.EX_RIGHT_TOLERANCE) return { ok: false, reason: 'price-basis-mismatch' };
        return { ok: true, reason: 'post-close-pending' };
    }
    const overlayGate = canUseRealtimeOverlay(id, series, cacheEntry.bar);
    if (!overlayGate.ok) return overlayGate;
    return { ok: true, reason: '' };
}

function tryApplyCachedLiveOverlay(id, series) {
    if (!id || !series || !series.length) return false;
    const cacheEntry = getLiveOverlayCacheEntry(id);
    const lastBar = series[series.length - 1];
    if (lastBar && cacheEntry?.bar?.date && cacheEntry.bar.date <= lastBar.date) {
        clearLiveOverlayCache(id);
        if (state.liveBars?.[id]?.date && state.liveBars[id].date <= lastBar.date) clearLiveBar(id);
        return false;
    }
    const cachedGate = canUseCachedLiveOverlay(id, series, cacheEntry);
    if (!cachedGate.ok) return false;
    setLiveBar(id, cacheEntry.bar, 'cache', { cachedAt: cacheEntry.cachedAt, cacheAgeMs: cacheEntry.cacheAgeMs, source: cacheEntry.source });
    return true;
}

function setDisplayStatus(id, patch = {}) {
    if (!state.displayStatus) state.displayStatus = {};
    state.displayStatus[id] = { ...(state.displayStatus[id] || {}), ...patch };
}

function setConfirmedStatus(id, patch = {}) {
    if (!state.confirmedStatus) state.confirmedStatus = {};
    state.confirmedStatus[id] = { ...(state.confirmedStatus[id] || {}), ...patch };
}

function setLiveQuote(id, bar, quality = 'quote-only', reason = '', meta = {}) {
    if (!id || !bar || !isValidPrice(bar.close, id)) return false;
    if (!state.liveQuotes) state.liveQuotes = {};
    state.liveQuotes[id] = {
        ...bar,
        _isLiveQuote: true,
        _quoteQuality: quality,
        _rejectReason: reason,
        _isCachedLive: !!meta.isCachedLive,
        _cachedAt: Number(meta.cachedAt) || 0
    };
    if (quality !== 'valid-overlay') {
        setDisplayStatus(id, {
            mode: 'quote-only',
            reason: reason || '实时行情仅用于报价，图表等待历史数据确认',
            quoteDate: bar.date || '',
            quoteAt: Date.now()
        });
    }
    return true;
}

function setLiveBar(id, bar, source = 'api', meta = {}) {
    if (!id || !bar || !isValidPrice(bar.close, id)) return false;
    if (!state.liveBars) state.liveBars = {};
    if (!state.liveWeeklyData) state.liveWeeklyData = {};
    const isCachedLive = source === 'cache' || !!meta.isCachedLive;
    const cachedAt = Number(meta.cachedAt) || (isCachedLive ? Date.now() : 0);
    const cacheAgeMs = Number.isFinite(Number(meta.cacheAgeMs)) ? Number(meta.cacheAgeMs) : (isCachedLive && cachedAt ? Math.max(0, Date.now() - cachedAt) : 0);
    const isSoftExpired = isCachedLive && cacheAgeMs > SYS_CONFIG.LIVE_OVERLAY_CACHE_TTL_MS;
    const isPostClosePending = isCachedLive && isAfterMarketClose() && (bar.date || '') === getTodayDate();
    const displayMode = isPostClosePending ? 'post-close-pending' : (isCachedLive ? 'cached-live-overlay' : 'live-overlay');
    const displayReason = isPostClosePending ? '盘后待确认' : (isCachedLive ? (isSoftExpired ? '沿用盘中' : '短TTL缓存盘中') : '');
    setLiveQuote(id, bar, 'valid-overlay', '', { isCachedLive, cachedAt });
    state.liveBars[id] = {
        ...bar,
        _isLive: true,
        _isCachedLive: isCachedLive,
        _isSoftExpiredLive: isSoftExpired,
        _cachedAt: cachedAt,
        _cacheAgeMs: cacheAgeMs
    };
    delete state.liveWeeklyData[id];
    setDisplayStatus(id, {
        mode: displayMode,
        reason: displayReason,
        quoteDate: bar.date || '',
        quoteAt: Date.now(),
        cachedAt,
        cacheAgeMs
    });
    if (!isCachedLive) setLiveOverlayCache(id, bar, { cachedAt: Date.now(), source: 'api' });
    if (id === state.id) {
        state.pendingIndicatorMutation = { mode: 'incremental', startIdx: Math.max(0, (getActiveData()?.length || 1) - 1) };
        if (typeof markIndicatorsDirty === 'function') markIndicatorsDirty();
    }
    return true;
}

function clearLiveBar(id) {
    if (!state.liveBars) state.liveBars = {};
    if (!state.liveWeeklyData) state.liveWeeklyData = {};
    delete state.liveBars[id];
    delete state.liveWeeklyData[id];
}

function syncExpiredCachedLiveOverlay(id) {
    const live = state.liveBars?.[id];
    if (!live || !live._isCachedLive) return false;
    const cachedAt = Number(live._cachedAt) || 0;
    const cacheAgeMs = cachedAt ? Math.max(0, Date.now() - cachedAt) : Number(live._cacheAgeMs) || 0;
    if (!cachedAt || cacheAgeMs <= SYS_CONFIG.LIVE_OVERLAY_CACHE_TTL_MS) return false;
    live._isSoftExpiredLive = true;
    live._cacheAgeMs = cacheAgeMs;
    if (state.liveQuotes?.[id]) {
        state.liveQuotes[id]._isSoftExpiredLive = true;
        state.liveQuotes[id]._cacheAgeMs = cacheAgeMs;
    }
    const isPostClosePending = isAfterMarketClose() && (live.date || '') === getTodayDate();
    setDisplayStatus(id, {
        mode: isPostClosePending ? 'post-close-pending' : 'cached-live-overlay',
        reason: isPostClosePending ? '盘后待确认' : '沿用盘中',
        quoteDate: live.date || '',
        cachedAt,
        cacheAgeMs
    });
    return true;
}

function clearLiveQuote(id) {
    if (!state.liveQuotes) state.liveQuotes = {};
    delete state.liveQuotes[id];
}

function canUseRealtimeOverlay(id, series, rtBar) {
    if (!rtBar || !series || !series.length) return { ok: false, reason: 'missing-data' };
    const lastBar = series[series.length - 1];
    if (!lastBar || !isValidPrice(rtBar.close, id)) return { ok: false, reason: 'invalid-price' };
    if (!rtBar.date || rtBar.date !== getTodayDate()) return { ok: false, reason: 'quote-date-not-today' };
    if (rtBar.date < lastBar.date) return { ok: false, reason: 'quote-older-than-history' };
    if (!isConfirmedSeriesFreshEnough(series)) return { ok: false, reason: 'confirmed-history-stale' };

    const isIndex = !!getIndexConfig(id);
    if (isIndex) return { ok: true, reason: '' };
    if (rtBar.date === lastBar.date) return { ok: true, reason: '' };
    if (!rtBar.prevClose || !isValidPrice(rtBar.prevClose, id) || !lastBar.close || !isValidPrice(lastBar.close, id)) {
        return { ok: false, reason: 'missing-prev-close' };
    }
    const prevCloseDiff = Math.abs(rtBar.prevClose - lastBar.close) / lastBar.close;
    if (prevCloseDiff > SYS_CONFIG.EX_RIGHT_TOLERANCE) return { ok: false, reason: 'price-basis-mismatch' };
    return { ok: true, reason: '' };
}

function applyRealtimeQuoteForSeries(id, series, rtBar) {
    const overlayGate = canUseRealtimeOverlay(id, series, rtBar);
    if (overlayGate.ok) {
        setLiveBar(id, rtBar);
        return 'overlay';
    }
    if (rtBar && isValidPrice(rtBar.close, id)) {
        if (overlayGate.reason === 'quote-date-not-today' && tryApplyCachedLiveOverlay(id, series)) return 'cached-overlay';
        setLiveQuote(id, rtBar, 'quote-only', overlayGate.reason);
        clearLiveBar(id);
        return 'quote-only';
    }
    if (rtBar && state.liveBars?.[id] && series?.length && rtBar.date < series[series.length - 1]?.date) {
        clearLiveBar(id);
        return 'cleared';
    }
    return 'skipped';
}

function clearConfirmedLiveBar(id, data) {
    const live = state.liveBars?.[id];
    const last = data?.length ? data[data.length - 1] : null;
    if (!live || !last) return;
    if (live.date < last.date || (live.date === last.date && !isMarketOpen())) clearLiveBar(id);
}
function rememberPeriodLock(idx=state.lockIdx, period=state.period) { if(!state.periodLocks) state.periodLocks = {daily:-1, weekly:-1}; state.periodLocks[period] = idx; }
function setLockIdx(idx) { state.lockIdx = idx; rememberPeriodLock(idx); }
function getPeriodLock(period=state.period) { return state.periodLocks?.[period] ?? -1; }

function getViewportLength() {
    return state.period === 'weekly' ? Math.ceil(state.range / 5) : state.range;
}

function resetViewportToLatest(data = getActiveData()) {
    const len = data?.length || 0;
    state.viewport = { mode: 'latest', endIdx: len ? len - 1 : -1, anchorIdx: len ? len - 1 : -1 };
}

function anchorViewportAt(idx) {
    state.viewport = { mode: 'anchor', endIdx: -1, anchorIdx: idx };
}

function panViewportByBars(deltaBars, data = getActiveData()) {
    if (!data || !data.length || !Number.isFinite(deltaBars) || deltaBars === 0) return false;
    const len = data.length;
    const visibleLen = Math.max(1, Math.min(len, getViewportLength()));
    const latestIdx = len - 1;
    const currentRange = getVisibleRange(data);
    const currentEnd = currentRange.end >= 0 ? currentRange.end : latestIdx;
    const nextEnd = Math.max(visibleLen - 1, Math.min(latestIdx, currentEnd + Math.trunc(deltaBars)));

    if (nextEnd === latestIdx) {
        applyHistoryNavigationState({ lockIdx: latestIdx, isFrozen: false });
        resetViewportToLatest(data);
    } else {
        applyHistoryNavigationState({ lockIdx: nextEnd, isFrozen: true });
        state.viewport = { mode: 'pan', endIdx: nextEnd, anchorIdx: nextEnd };
    }
    return nextEnd !== currentEnd;
}

function getVisibleRange(data = getActiveData()) {
    if (!data || !data.length) return { start: 0, end: -1, length: 0 };
    const len = data.length;
    const visibleLen = Math.max(1, Math.min(len, getViewportLength()));
    const latestIdx = len - 1;
    let end = latestIdx;

    if (state.viewport?.mode === 'pan' && Number.isInteger(state.viewport.endIdx) && state.viewport.endIdx >= 0) {
        end = Math.max(visibleLen - 1, Math.min(latestIdx, state.viewport.endIdx));
        const start = Math.max(0, end - visibleLen + 1);
        return { start, end, length: end - start + 1 };
    }

    if (state.viewport?.mode === 'anchor' || state.isFrozen) {
        const anchor = Math.max(0, Math.min(latestIdx, state.viewport.anchorIdx ?? state.lockIdx ?? latestIdx));
        const half = Math.floor(visibleLen / 2);
        let start = Math.max(0, Math.min(anchor - half, len - visibleLen));
        end = Math.min(latestIdx, start + visibleLen - 1);
        return { start, end, length: end - start + 1 };
    }

    if (Number.isInteger(state.viewport?.endIdx) && state.viewport.endIdx >= 0) {
        end = Math.max(visibleLen - 1, Math.min(latestIdx, state.viewport.endIdx));
    }

    const start = Math.max(0, end - visibleLen + 1);
    return { start, end, length: end - start + 1 };
}

function findDateIndex(data, date, id = '') {
    if(!data || !data.length) return -1;
    const firstDate = data[0]?.date || '';
    const lastDate = data[data.length - 1]?.date || '';
    const cacheKey = `${id}_${data.length}_${firstDate}_${lastDate}_${date}`;
    if (dateIndexCache.has(cacheKey)) return dateIndexCache.get(cacheKey);
    let l = 0, r = data.length - 1, res = -1;
    while (l <= r) {
        let m = (l + r) >> 1;
        if (data[m].date === date) { res = m; break; }
        else if (data[m].date < date) { res = m; l = m + 1; }
        else r = m - 1;
    }
    if (res === -1) res = data.length - 1; 
    dateIndexCache.set(cacheKey, res); 
    return res;
}

function alignLockToPeriod(targetPeriod, anchorDate) {
    const data = targetPeriod === 'weekly' ? state.weeklyData[state.id] : state.rawData[state.id];
    if(!data || !data.length) return -1;
    if(anchorDate) return findDateIndex(data, anchorDate, state.id);
    const saved = getPeriodLock(targetPeriod);
    if(saved >= 0 && saved < data.length) return saved;
    return data.length - 1;
}

function getSafeIndex(data) {
    if (!data || data.length === 0) return -1;
    if (state.lockIdx < 0 || state.lockIdx >= data.length) { setLockIdx(data.length - 1); return data.length - 1; }
    return state.lockIdx;
}

function getTradingWeekKey(date) {
    const dateObj = new Date(date + "T00:00:00Z");
    const day = dateObj.getUTCDay() || 7;
    dateObj.setUTCDate(dateObj.getUTCDate() - day + 1);
    return `${dateObj.getUTCFullYear()}-${String(dateObj.getUTCMonth()+1).padStart(2,'0')}-${String(dateObj.getUTCDate()).padStart(2,'0')}`;
}

function appendDailyBarToWeeklySeries(weekly, d) {
    if (!Array.isArray(weekly) || !d) return weekly;
    const currentWeek = weekly[weekly.length - 1];
    if (!currentWeek || getTradingWeekKey(currentWeek.date) !== getTradingWeekKey(d.date)) {
        weekly.push({ date: d.date, open: d.open, high: d.high, low: d.low, close: d.close, vol: d.vol, amt: d.amt });
        return weekly;
    }
    currentWeek.date = d.date;
    currentWeek.high = Math.max(currentWeek.high, d.high);
    currentWeek.low = Math.min(currentWeek.low, d.low);
    currentWeek.close = d.close;
    currentWeek.vol += d.vol;
    currentWeek.amt += d.amt;
    return weekly;
}

function convertDailyToWeekly(dailyData) {
    if (!dailyData || !dailyData.length) return [];
    const weekly = [];
    for (const d of dailyData) appendDailyBarToWeeklySeries(weekly, d);
    return weekly;
}

function mergePendingIndicatorMutation(nextMutation) {
    const current = state.pendingIndicatorMutation;
    if (nextMutation?.mode === 'market-only') {
        if (!current || current.mode === 'unchanged' || current.mode === 'market-only') {
            state.pendingIndicatorMutation = { mode: 'market-only', startIdx: 0 };
        }
        return;
    }
    if (current?.mode === 'market-only' && nextMutation?.mode === 'incremental') {
        state.pendingIndicatorMutation = { mode: 'full', startIdx: 0 };
        return;
    }
    if (current?.mode === 'market-only' && nextMutation?.mode === 'unchanged') return;
    state.pendingIndicatorMutation = nextMutation;
}

function setRawData(id, data) {
    data = normalizeConfirmedHistoryData(data, id);
    const prevData = state.rawData[id];
    const mutation = prevData ? getDataMutationMeta(prevData, data) : { mode: 'full', startIdx: 0 };
    if (mutation.mode !== 'full' && prevData && data) {
        const preserveUntil = mutation.mode === 'unchanged'
            ? Math.min(prevData.length, data.length)
            : Math.max(0, Math.min(mutation.startIdx || 0, prevData.length, data.length));
        for (let i = 0; i < preserveUntil; i++) {
            if (!barsEqual(prevData[i], data[i])) break;
            data[i]._signals = prevData[i]._signals;
            data[i]._signalVersion = prevData[i]._signalVersion;
            data[i]._strategy = prevData[i]._strategy;
            data[i]._decision = prevData[i]._decision;
        }
    }
    state.rawData[id] = data;
    if (data) state.weeklyData[id] = convertDailyToWeekly(data); else state.weeklyData[id] = null;
    clearConfirmedLiveBar(id, data);
    if (data?.length) {
        const lastDate = data[data.length - 1]?.date || '';
        const currentConfirmed = state.confirmedStatus?.[id] || {};
        if (!currentConfirmed.status || currentConfirmed.status === 'unknown') {
            setConfirmedStatus(id, {
                source: 'cache',
                status: lastDate && lastDate >= getExpectedConfirmedDate() ? 'fresh' : 'stale',
                lastDate,
                syncedAt: Date.now()
            });
        }
    }
    if (data?.length && !state.liveBars?.[id] && state.displayStatus?.[id]?.mode !== 'quote-only') {
        setDisplayStatus(id, { mode: 'confirmed', reason: '', quoteDate: '', quoteAt: 0 });
    }
    if (id === state.id) {
        const indicatorScopePrefix = `${state.id}_${state.period}_${state.strategy}_`;
        const isSameIndicatorScope = typeof state.indicatorKey === 'string' && state.indicatorKey.startsWith(indicatorScopePrefix);
        if (!isSameIndicatorScope) {
            state.indicators = { ma: {}, macd: null, rsi: null, kdj: null };
        }
        mergePendingIndicatorMutation(isSameIndicatorScope ? getDataMutationMeta(prevData, data) : { mode: 'full', startIdx: 0 });
        if (typeof markIndicatorsDirty === 'function') markIndicatorsDirty();
    }
    const marketDataChanged = CORE_MARKET_INDEX_IDS.includes(id) && id !== state.id &&
        mutation.mode !== 'unchanged' && Boolean(prevData?.length || data?.length);
    if (marketDataChanged) mergePendingIndicatorMutation({ mode: 'market-only', startIdx: 0 });
    // 增量更新（同日价格变动）只清 lookup 缓存，保留 renderCache 防止面板闪烁
    if (mutation.mode === 'incremental') {
        clearLookupCacheOnly();
    } else {
        clearDerivedCaches();
    }
}

function barsEqual(a, b) {
    if (!a || !b) return false;
    return a.date === b.date &&
        a.open === b.open &&
        a.close === b.close &&
        a.high === b.high &&
        a.low === b.low &&
        a.vol === b.vol &&
        a.amt === b.amt;
}

function getDataMutationMeta(prevData, nextData) {
    if (!prevData || !prevData.length || !nextData || !nextData.length) {
        return { mode: 'full', startIdx: 0 };
    }
    if (nextData.length < prevData.length) {
        return { mode: 'full', startIdx: 0 };
    }

    const minLen = Math.min(prevData.length, nextData.length);
    let firstDiff = 0;
    while (firstDiff < minLen && barsEqual(prevData[firstDiff], nextData[firstDiff])) firstDiff++;

    if (firstDiff === minLen && prevData.length === nextData.length) {
        return { mode: 'unchanged', startIdx: -1 };
    }

    const isPureAppend = firstDiff === prevData.length && nextData.length >= prevData.length;
    const tailOnlyChange = firstDiff >= Math.max(0, minLen - 5);

    if (isPureAppend || tailOnlyChange) {
        return { mode: 'incremental', startIdx: Math.max(0, firstDiff) };
    }

    return { mode: 'full', startIdx: 0 };
}

// 外部环境与板块趋势观察数据已拆到 02-observation-data.js；核心历史、缓存与实时行情继续留在本文件。

const requestManager = {
    limiters: new Map(),
    async fetchRealtimeWithThrottle(id) {
        if (typeof canRequestMarketData === 'function' && !canRequestMarketData()) return null;
        const now = Date.now(), s = this.limiters.get(id) || { lastCall: 0, isFetching: false };
        if (s.isFetching) return null; if (now - s.lastCall < SYS_CONFIG.THROTTLE_MS) return null;
        s.isFetching = true; this.limiters.set(id, s);
        try { const rt = await getRealtimePriceJSONP(id); return rt; }
        catch (e) { return null; }
        finally { s.lastCall = Date.now(); s.isFetching = false; this.limiters.set(id, s); }
    }
};

const TICKFLOW_HISTORY_URL = 'https://free-api.tickflow.org/v1/klines';
const TICKFLOW_HISTORY_DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
});

function formatTickFlowHistoryDate(timestamp) {
    const date = new Date(Number(timestamp));
    if (Number.isNaN(date.getTime())) return '';
    const parts = {};
    TICKFLOW_HISTORY_DATE_FORMATTER.formatToParts(date).forEach(part => { parts[part.type] = part.value; });
    return parts.year && parts.month && parts.day ? `${parts.year}-${parts.month}-${parts.day}` : '';
}

async function fetchTickFlowKline(id) {
    if (isHistorySourceCircuitOpen('tickflow')) return [];
    const symbol = resolveTickFlowSymbol(id);
    if (!symbol) return [];
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), SYS_CONFIG.REQ_TIMEOUT) : null;
    try {
        const url = `${TICKFLOW_HISTORY_URL}?symbol=${encodeURIComponent(symbol)}&period=1d&count=1000&adjust=forward_additive`;
        const response = await fetch(url, {
            method: 'GET',
            cache: 'no-store',
            ...(controller ? { signal: controller.signal } : {})
        });
        if (response.status === 400 || response.status === 404) {
            recordHistorySourceSuccess('tickflow');
            return [];
        }
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json();
        recordHistorySourceSuccess('tickflow');
        const columns = payload?.data;
        const fields = ['timestamp', 'open', 'high', 'low', 'close', 'volume', 'amount'];
        if (!columns || fields.some(field => !Array.isArray(columns[field]))) return [];
        const rowCount = Math.min(...fields.map(field => columns[field].length));
        if (!rowCount) return [];
        return normalizeConfirmedHistoryData(Array.from({ length: rowCount }, (_, index) => ({
            date: formatTickFlowHistoryDate(columns.timestamp[index]),
            open: columns.open[index],
            close: columns.close[index],
            high: columns.high[index],
            low: columns.low[index],
            vol: columns.volume[index],
            amt: columns.amount[index]
        })), id);
    } catch (error) {
        recordHistorySourceTransportFailure('tickflow');
        return [];
    } finally {
        if (timer) clearTimeout(timer);
    }
}

function jsonpFetchEastmoneyKline(id) {
    if (isHistorySourceCircuitOpen('eastmoney')) return Promise.resolve([]);
    return new Promise(resolve => {
        const secid = resolveSecid(id), cb = 'em_kline_' + Date.now() + '_' + Math.random().toString(36).slice(2,6);
        const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61&klt=101&fqt=1&end=20500101&lmt=1000&cb=${cb}`;
        let cl = false, timer = 0, cancel = null;
        const cleanup = () => { if(cl) return; cl=true; if(cancel) _unregisterJsonpCleanup(cancel); clearTimeout(timer); delete window[cb]; const s = document.getElementById(cb); if(s) s.remove(); };
        cancel = () => { if (cl) return; cleanup(); resolve([]); };
        _registerJsonpCleanup(cancel);
        const fail = () => { if (cl) return; recordHistorySourceTransportFailure('eastmoney'); cleanup(); resolve([]); };
        timer = setTimeout(fail, 8000);
        window[cb] = data => { 
            recordHistorySourceSuccess('eastmoney'); cleanup();
            if(data && data.data && data.data.klines) resolve(normalizeConfirmedHistoryData(data.data.klines.map(l => { const p = l.split(','); return { date: p[0], open: p[1], close: p[2], high: p[3], low: p[4], vol: p[5], amt: p[6] }; }), id)); 
            else resolve([]);
        };
        const script = document.createElement('script'); script.id = cb; script.src = url; script.onerror = fail; document.head.appendChild(script);
    });
}

function jsonpFetchTencentKline(id) {
    if (isHistorySourceCircuitOpen('tencent')) return Promise.resolve([]);
    return new Promise(resolve => {
        let symbol = resolveTencentSymbol(id);
        const cb = 'tx_kline_' + Date.now(), url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${symbol},day,,,1000,qfq&_var=${cb}`;
        let cl = false, timer = 0, cancel = null;
        const cleanup = () => { if(cl) return; cl = true; if(cancel) _unregisterJsonpCleanup(cancel); clearTimeout(timer); delete window[cb]; const s = document.getElementById(cb); if(s) s.remove(); };
        cancel = () => { if (cl) return; cleanup(); resolve([]); };
        _registerJsonpCleanup(cancel);
        const fail = () => { if (cl) return; recordHistorySourceTransportFailure('tencent'); cleanup(); resolve([]); };
        timer = setTimeout(fail, 5000); window[cb] = undefined;
        const script = document.createElement('script'); script.id = cb; script.src = url;
        script.onload = () => { 
            if (cl) return;
            const payload = window[cb]; recordHistorySourceSuccess('tencent'); cleanup();
            if(payload && payload.code === 0 && payload.data && payload.data[symbol]) { 
                const klines = payload.data[symbol].qfqday || payload.data[symbol].day; 
                if(!klines) { resolve([]); return; } 
                resolve(normalizeConfirmedHistoryData(klines.map(p => ({ date: p[0], open: p[1], close: p[2], high: p[3], low: p[4], vol: p[5], amt: p.length > 6 ? p[6] : 0 })), id));
            } else resolve([]); 
        };
        script.onerror = fail; document.head.appendChild(script);
    });
}

function jsonpFetchSinaBz50Kline(id) {
    if (id !== 'bz50' || isHistorySourceCircuitOpen('sina')) return Promise.resolve([]);
    return new Promise(resolve => {
        const cb = 'dg_sina_bz50_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
        const callbackExpr = encodeURIComponent(`window[${JSON.stringify(cb)}]`);
        const url = `https://quotes.sina.cn/cn/api/jsonp_v2.php/${callbackExpr}=/CN_MarketDataService.getKLineData?symbol=bj899050&scale=240&ma=no&datalen=1000`;
        let cl = false;
        const cleanup = () => {
            if (cl) return;
            cl = true;
            clearTimeout(timer);
            delete window[cb];
            const current = document.getElementById(cb);
            if (current) current.remove();
        };
        const fail = () => {
            if (cl) return;
            recordHistorySourceTransportFailure('sina');
            cleanup();
            resolve([]);
        };
        const timer = setTimeout(fail, 5000);
        const script = document.createElement('script');
        script.id = cb;
        script.src = url;
        script.onload = () => {
            if (cl) return;
            const rows = window[cb];
            recordHistorySourceSuccess('sina');
            cleanup();
            if (!Array.isArray(rows)) {
                resolve([]);
                return;
            }
            resolve(normalizeConfirmedHistoryData(rows.map(row => ({
                date: row.day,
                open: row.open,
                close: row.close,
                high: row.high,
                low: row.low,
                vol: Number(row.volume) / 100,
                amt: 0
            })), id));
        };
        script.onerror = fail;
        document.head.appendChild(script);
    });
}

function getRealtimePriceJSONP(id) {
    return new Promise(resolve => {
        const symbol = resolveTencentSymbol(id), varName = 'v_' + symbol;
        const script = document.createElement('script'); script.src = `https://qt.gtimg.cn/q=${symbol}`; script.charset = 'GBK';
        let cl = false, timer = 0, cancel = null;
        const cleanup = () => { if(cl) return; cl = true; if(cancel) _unregisterJsonpCleanup(cancel); clearTimeout(timer); if(script.parentNode) script.remove(); };
        cancel = () => { if (cl) return; cleanup(); resolve(null); };
        _registerJsonpCleanup(cancel);
        timer = setTimeout(() => { cleanup(); resolve(null); }, 5000);
        script.onload = () => { 
            cleanup(); 
            if(typeof window[varName] !== 'undefined') { 
                const fields = window[varName].split('~'); 
                if(fields.length >= 6) { 
                    const price = parseFloat(fields[3]) || 0; 
                    if(price > 0) { 
                        const prevClose = parseFloat(fields[4]) || 0;
                        const quoteTime = getTencentQuoteTimeInfo(fields);
                        resolve({ date: quoteTime.date, quoteTime: quoteTime.quoteTime, quoteDateSource: quoteTime.quoteDateSource, open: parseFloat(fields[5])||price, high: parseFloat(fields[33])||price, low: parseFloat(fields[34])||price, close: price, prevClose, vol: parseInt(fields[36])||0, amt: normalizeTencentQuoteAmount(fields[37]) });
                        return; 
                    } 
                } 
            } 
            resolve(null); 
        };
        script.onerror = () => { cleanup(); resolve(null); }; document.head.appendChild(script);
    });
}

// 受控并发：最多 concurrency 个 fn 同时执行
function pLimit(items, concurrency, fn) {
    const results = new Array(items.length);
    let nextIdx = 0;
    async function worker() {
        while (nextIdx < items.length) {
            const idx = nextIdx++;
            try { results[idx] = await fn(items[idx], idx); }
            catch (e) { results[idx] = undefined; }
        }
    }
    const workers = [];
    for (let i = 0; i < Math.min(concurrency, items.length); i++) workers.push(worker());
    return Promise.all(workers).then(() => results);
}

// 批量实时行情：1 次 JSONP 拿多个标的的实时价格
function batchGetRealtimePrices(ids) {
    return new Promise(resolve => {
        if (!ids || !ids.length) return resolve({});
        if (typeof canRequestMarketData === 'function' && !canRequestMarketData()) return resolve({});
        const symToId = {}, symbols = [];
        for (const id of ids) { const sym = resolveTencentSymbol(id); symToId[sym] = id; symbols.push(sym); }
        const script = document.createElement('script');
        script.src = `https://qt.gtimg.cn/q=${symbols.join(',')}`;
        script.charset = 'GBK';
        let cl = false;
        const cleanup = () => { if (cl) return; cl = true; clearTimeout(timer); if (script.parentNode) script.remove(); };
        const timer = setTimeout(() => { cleanup(); resolve({}); }, 5000);
        const results = {};
        script.onload = () => {
            cleanup();
            for (const sym of symbols) {
                const varName = 'v_' + sym, id = symToId[sym];
                if (typeof window[varName] !== 'undefined') {
                    const fields = window[varName].split('~');
                    if (fields.length >= 6) {
                        const price = parseFloat(fields[3]) || 0;
                        if (price > 0) {
                            const prevClose = parseFloat(fields[4]) || 0;
                            const quoteTime = getTencentQuoteTimeInfo(fields);
                            results[id] = { date: quoteTime.date, quoteTime: quoteTime.quoteTime, quoteDateSource: quoteTime.quoteDateSource, open: parseFloat(fields[5])||price, high: parseFloat(fields[33])||price, low: parseFloat(fields[34])||price, close: price, prevClose, vol: parseInt(fields[36])||0, amt: normalizeTencentQuoteAmount(fields[37]) };
                        }
                    }
                    delete window[varName];
                }
            }
            resolve(results);
        };
        script.onerror = () => { cleanup(); resolve({}); };
        document.head.appendChild(script);
    });
}

async function syncDataWithHistory(id) {
    const sources = id === 'bz50'
        ? [
            { name: 'tickflow', load: fetchTickFlowKline },
            { name: 'sina', load: jsonpFetchSinaBz50Kline },
            { name: 'eastmoney', load: jsonpFetchEastmoneyKline },
            { name: 'tencent', load: jsonpFetchTencentKline }
        ]
        : [
            { name: 'tickflow', load: fetchTickFlowKline },
            { name: 'tencent', load: jsonpFetchTencentKline },
            { name: 'eastmoney', load: jsonpFetchEastmoneyKline }
        ];
    for (const source of sources) {
        const data = normalizeConfirmedHistoryData(await source.load(id), id);
        if (data && data.length >= 30) {
            setConfirmedStatus(id, { source: source.name, status: 'fresh', lastDate: data[data.length - 1]?.date || '', syncedAt: Date.now() });
            return data;
        }
    }
    setConfirmedStatus(id, { status: 'failed', syncedAt: Date.now() });
    return null;
}

function getHistoryRefreshMeta(id) {
    return historyRefreshMeta.get(id) || { lastSuccessAt: 0, lastAttemptAt: 0, lastDate: '' };
}

function setHistoryRefreshMeta(id, patch = {}) {
    historyRefreshMeta.set(id, { ...getHistoryRefreshMeta(id), ...patch });
}

function shouldSkipHistoryRefresh(id, cached) {
    if (!cached || !cached.length) return false;
    const meta = getHistoryRefreshMeta(id);
    const now = Date.now();
    const lastDate = cached[cached.length - 1]?.date || '';
    if (lastDate && lastDate < getLastTradingDate()) return false;
    if (meta.lastDate && meta.lastDate !== lastDate) return false;
    if (meta.lastSuccessAt && now - meta.lastSuccessAt < SYS_CONFIG.HISTORY_FRESH_MS) return true;
    if (meta.lastAttemptAt && now - meta.lastAttemptAt < SYS_CONFIG.HISTORY_REFRESH_COOLDOWN_MS) return true;
    return false;
}

async function syncDataIncremental(id) { 
    try { 
        const cached = await dbGet(id); 
        const cachedData = normalizeConfirmedHistoryData(cached?.data, id);
        if(!cachedData || !cachedData.length) return await syncDataWithHistory(id); 
        if (shouldSkipHistoryRefresh(id, cachedData)) return cachedData;
        
        setHistoryRefreshMeta(id, { lastAttemptAt: Date.now(), lastDate: cachedData[cachedData.length - 1]?.date || '' });
        const fresh = await syncDataWithHistory(id); 
        if(!fresh || !fresh.length) return cachedData; 
        setHistoryRefreshMeta(id, { lastSuccessAt: Date.now(), lastDate: fresh[fresh.length - 1]?.date || '' });

        const lastCached = cachedData[cachedData.length - 1];
        const matchingFresh = fresh.find(d => d.date === lastCached.date);
        
        if (matchingFresh && Math.abs(matchingFresh.close - lastCached.close) / lastCached.close > SYS_CONFIG.EX_RIGHT_TOLERANCE) return fresh; 

        const mergedMap = new Map(); 
        cachedData.forEach(item => mergedMap.set(item.date, item)); 
        fresh.forEach(item => mergedMap.set(item.date, item)); 
        return normalizeConfirmedHistoryData(Array.from(mergedMap.values()).sort((a, b) => a.date.localeCompare(b.date)), id); 
    } catch(e) { return await getCachedData(id) || null; } 
}

async function syncData(id) { 
    let cached = await getCachedData(id);
    const hasEnough = cached && cached.length >= 30; 
    const cachedLastDate = cached && cached.length ? (cached[cached.length - 1]?.date || '') : '';
    if (typeof canRequestMarketData === 'function' && !canRequestMarketData()) {
        if (hasEnough) tryApplyCachedLiveOverlay(id, cached);
        return hasEnough ? cached : null;
    }
    
    if(isMarketOpen()) { 
        if(hasEnough) { 
            const incremental = await syncDataIncremental(id); 
            if(incremental && incremental.length > 0) { await dbSet(id, incremental); cached = incremental; }
            const rt = await requestManager.fetchRealtimeWithThrottle(id); 
            if (rt) applyRealtimeQuoteForSeries(id, cached, rt);
            else tryApplyCachedLiveOverlay(id, incremental && incremental.length > 0 ? incremental : cached);
            if (!state.liveBars?.[id] && state.displayStatus?.[id]?.mode !== 'quote-only') {
                setDisplayStatus(id, { mode: 'confirmed', reason: '', quoteDate: '', quoteAt: 0, cachedAt: 0, cacheAgeMs: 0 });
            }
            return cached; 
        } 
        setHistoryRefreshMeta(id, { lastAttemptAt: Date.now(), lastDate: cachedLastDate });
        const data = await syncDataWithHistory(id); 
        if(data && data.length >= 30) {
            setHistoryRefreshMeta(id, { lastSuccessAt: Date.now(), lastDate: data[data.length - 1]?.date || '' });
            await dbSet(id, data);
            const rt = await requestManager.fetchRealtimeWithThrottle(id);
            if (rt) applyRealtimeQuoteForSeries(id, data, rt);
            else tryApplyCachedLiveOverlay(id, data);
            if (!state.liveBars?.[id] && state.displayStatus?.[id]?.mode !== 'quote-only') {
                setDisplayStatus(id, { mode: 'confirmed', reason: '', quoteDate: '', quoteAt: 0, cachedAt: 0, cacheAgeMs: 0 });
            }
            return data;
        } 
        setConfirmedStatus(id, { source: 'cache', status: 'stale', lastDate: cachedLastDate, syncedAt: Date.now() });
        return hasEnough ? cached : null; 
    } else { 
        if(hasEnough) { 
            const incremental = await syncDataIncremental(id); 
            if(incremental && incremental.length > 0) {
                await dbSet(id, incremental);
                if (!isConfirmedSeriesFreshEnough(incremental)) tryApplyCachedLiveOverlay(id, incremental);
                return incremental;
            }
            tryApplyCachedLiveOverlay(id, cached);
            return cached; 
        } 
        setHistoryRefreshMeta(id, { lastAttemptAt: Date.now(), lastDate: cachedLastDate });
        const data = await syncDataWithHistory(id); 
        if(data && data.length >= 30) {
            setHistoryRefreshMeta(id, { lastSuccessAt: Date.now(), lastDate: data[data.length - 1]?.date || '' });
            await dbSet(id, data);
            if (!isConfirmedSeriesFreshEnough(data)) tryApplyCachedLiveOverlay(id, data);
            return data;
        } 
        setConfirmedStatus(id, { source: 'cache', status: hasEnough ? 'stale' : 'failed', lastDate: cachedLastDate, syncedAt: Date.now() });
        if (!state.liveBars?.[id] && state.displayStatus?.[id]?.mode !== 'quote-only') {
            setDisplayStatus(id, { mode: 'confirmed', reason: '', quoteDate: '', quoteAt: 0, cachedAt: 0, cacheAgeMs: 0 });
        }
        return null; 
    } 
}

async function checkCacheNeedUpdate(id) { 
    const cached = await dbGet(id); 
    if(!cached || !cached.data || !cached.data.length) return { needUpdate: true, reason: '无数据' }; 
    const ld = cached.data[cached.data.length-1].date, ltd = getLastTradingDate(); 
    if(ld < ltd) return { needUpdate: true, reason: '数据过期' }; 
    return { needUpdate: false, reason: '已最新' }; 
}

const lastUpdateClicks = new Map(); 
async function handleUpdateData(forceFull = false) { 
    const btn = document.getElementById('updateDataBtn'); if(!btn) return; 
    if(!state.id) return; 
    
    const now = Date.now(), lastClick = lastUpdateClicks.get(state.id) || 0;
    if(!forceFull && now - lastClick < SYS_CONFIG.UPDATE_COOLDOWN) { await customAlert(`频繁请求限制。此标的更新需等待 ${Math.ceil((SYS_CONFIG.UPDATE_COOLDOWN-(now-lastClick))/1000)} 秒。`); return; } 
    
    const info = await checkCacheNeedUpdate(state.id); 
    if(info.needUpdate) {
        lastUpdateClicks.set(state.id, Date.now());
        showToast(info.reason + '，正在同步...', 'info', 2000);
    } else {
        const confirmed = await customConfirm('数据已是最新，确认强制同步？');
        if(!confirmed) return;
        lastUpdateClicks.set(state.id, Date.now());
    }
    
    resetHistorySourceCircuits();
    btn.disabled = true; btn.innerHTML = SVG_ICONS.SPIN; 
    try { 
        const fresh = (!forceFull && info.needUpdate) ? await syncData(state.id) : await syncDataWithHistory(state.id); 
        if(fresh && fresh.length) { 
            const leftTxn = beginRefreshTransaction('leftList', { source: 'manual-update', id: state.id });
            const rightTxn = beginRefreshTransaction('rightPanel', { source: 'manual-update', id: state.id });
            await dbSet(state.id, fresh);
            setRawData(state.id, fresh);
            if (typeof renderActiveLeftListAfterDataApply === 'function') renderActiveLeftListAfterDataApply(leftTxn, { id: state.id });
            const status = applyActiveDataRefresh(state.id);
            markRefreshTime(rightTxn, { path: status, id: state.id });
            await customAlert(`同步成功！K线数量：${fresh.length}`); 
        } else { await customAlert('数据同步失败！'); } 
    } catch(e) { await customAlert('同步异常: ' + e.message); } 
    finally { btn.disabled = false; btn.innerHTML = SVG_ICONS.UPDATE; } 
}

const KLINE_CACHE_VERSION = 2;
const NON_KLINE_CACHE_KEYS = new Set(['stock_cache', 'watchlist_list']);
function isKlineCacheKey(id) { return !NON_KLINE_CACHE_KEYS.has(id); }
function buildPersistentCacheRecord(id, data) {
    return { id, data, updated: Date.now(), ...(isKlineCacheKey(id) ? { klineCacheVersion: KLINE_CACHE_VERSION } : {}) };
}
function isUsablePersistentCacheRecord(id, record) {
    return !record || !isKlineCacheKey(id) || record.klineCacheVersion === KLINE_CACHE_VERSION;
}

let DB = null; const DB_NAME = 'QuantProDB_v515', DB_VER = 1, STORE = 'kline';
function openDB() { 
    return new Promise(resolve => { 
        const req = indexedDB.open(DB_NAME, DB_VER); 
        req.onupgradeneeded = e => { if (!e.target.result.objectStoreNames.contains(STORE)) e.target.result.createObjectStore(STORE, { keyPath: 'id' }); }; 
        req.onsuccess = e => { DB = e.target.result; resolve(); }; 
        req.onerror = () => resolve(); 
    }); 
}
function dbGet(id) { 
    return new Promise(resolve => { 
        if(!DB) return resolve(null); 
        const req = DB.transaction(STORE, 'readonly').objectStore(STORE).get(id); 
        req.onsuccess = e => {
            const record = e.target.result;
            resolve(isUsablePersistentCacheRecord(id, record) ? record : null);
        };
        req.onerror = () => resolve(null);
    }); 
}
function dbSet(id, data) { 
    return new Promise(resolve => { 
        if(!DB) return resolve(); 
        data = id === 'stock_cache' || id === 'watchlist_list' ? data : normalizeConfirmedHistoryData(data, id);
        const tx = DB.transaction(STORE, 'readwrite'); 
        tx.objectStore(STORE).put(buildPersistentCacheRecord(id, data));
        tx.oncomplete = () => resolve(); tx.onerror = () => resolve(); 
    }); 
}
async function getCachedData(id) { const c = await dbGet(id); return (c && c.data) ? normalizeConfirmedHistoryData(c.data, id) : null; }

function getRenderedSidebarDate() {
    var cPriceEl = document.getElementById('cardPrice');
    if (!cPriceEl) return '';
    var headerEl = cPriceEl.querySelector('.header-meta-row .mono');
    return headerEl ? headerEl.textContent.trim().split('|')[0].trim() : '';
}

function applyActiveDataRefresh(id) {
    if (id !== state.id) return 'skipped';
    const rd = getActiveData();
    if (!rd || !rd.length) return 'no-data';

    const newLatestDate = rd[rd.length - 1].date;
    const oldDate = getRenderedSidebarDate();
    renderMASelector();

    if (state.isFrozen) {
        draw();
        return 'frozen-redraw';
    }

    setLockIdx(rd.length - 1);
    resetViewportToLatest(rd);
    if (oldDate && oldDate === newLatestDate) {
        updateAllIndicators();
        if (typeof drawViewport === 'function' && state.charts && (state.charts.main || state.charts.vol || state.charts.macd || state.charts.kdj)) {
            drawViewport();
        }
        if (typeof updateSidebarPriceOnly === 'function') updateSidebarPriceOnly();
        if (typeof ensureAnalysisPanelVisibleForRealtimeRefresh === 'function') ensureAnalysisPanelVisibleForRealtimeRefresh();
        if (typeof updateDataStatusRefreshBadge === 'function') updateDataStatusRefreshBadge(rd[rd.length - 1], id, rd);
        updateNavCapsuleVisuals(rd.length - 1, rd.length);
        return 'same-day-light';
    }

    draw();
    safeUpdateSidebar();
    return 'full-redraw';
}

function scheduleCachedFetchRefreshApply(id) {
    pendingCachedFetchRefreshApplyId = id;
    if (cachedFetchRefreshApplyTimer) return;
    cachedFetchRefreshApplyTimer = window.setTimeout(() => {
        const applyId = pendingCachedFetchRefreshApplyId;
        pendingCachedFetchRefreshApplyId = '';
        cachedFetchRefreshApplyTimer = 0;
        if (!applyId) return;

        const perfTrace = PERF.start('cachedFetchRefreshApply', { id: applyId, activeId: state.id, mode: state.mode });
        requestAnimationFrame(() => {
            if (applyId !== state.id) {
                PERF.end(perfTrace, { status: 'skipped' });
                return;
            }
            const rightTxn = beginRefreshTransaction('rightPanel', { source: 'cached-fetch-refresh-apply', id: applyId });
            const status = applyActiveDataRefresh(applyId);
            if (status === 'no-data') {
                PERF.end(perfTrace, { status: 'no-data' });
                return;
            }

            markRefreshTime(rightTxn, { path: status, id: applyId });
            PERF.mark(perfTrace, 'render');
            PERF.end(perfTrace, { status: 'applied', path: status });
        });
    }, 32);
}

function getFinalVerdict(decision) {
    const action = decision.simpleAction;
    if (['清仓离场', '规避风险'].includes(action)) return { label:'强制防守', text:'核心防守或破位信号触发，严格规避系统性风险。' };
    if (action === '执行离场') return { label:'主动撤退', text:'上行动能衰退或环境走弱，建议清空敞口，耐心等待。' };
    if (action === '持币观望') return { label:'防守等待', text:'市场环境或个股动能不足，空仓观望为主。' };
    if (action === '防守减仓') return { label:'控制敞口', text:'系统判定风险上升或动能衰减，建议主动降低持仓比例。' };
    if (['轻仓建仓', '缓慢加仓'].includes(action)) return { label:'低吸试错', text:'左侧异动或动能初显，建议控制上限，小仓位试探。' };
    if (['积极建仓', '顺势加仓'].includes(action)) return { label:'把握主升', text:'量价结构共振向好，动能充沛，可积极获取趋势利润。' };
    if (['谨慎持有', '轻仓持有'].includes(action)) return { label:'轻仓观望', text:'处于震荡或分歧期，胜率盈亏比偏低，底仓持有观察。' };
    if (['顺势抱单', '积极持有'].includes(action)) return { label:'趋势进攻', text:'处于主升或多头排列中，依托均线及防守位顺势持有。' };
    return { label:'状态检测', text:'量化系统持续推演中...' };
}

function getHoldingDisplayStatus(status) {
    const map = {
        '持仓观察': '观望等待',
        '弱势套牢': '弱势承压',
        '结构转强': '结构转强',
        '破位防守': '破位防守'
    };
    return map[status] || status;
}

function getExitDisplayLevel(level, hasContext = false) {
    const map = {
        '清仓防守': '清仓防守',
        '强离场': '强制离场',
        '减仓观察': '防守观察',
        '延续防守': '防守延续',
        '无明确离场': hasContext ? '防守观察' : '未触发离场'
    };
    return map[level] || level;
}

function getActionDisplayText(action) {
    const map = {
        '减仓观察': '防守观察',
        '延续防守': '防守延续',
        '弱势套牢': '弱势承压',
        '破位防守': '破位防守',
        '结构转强': '结构转强'
    };
    return map[action] || action;
}

function getRelativeStrength(stockData, date) {
    const marketData = state.rawData.sh || [];
    if(!stockData?.length || marketData.length < 25) return null;
    const sIdx = findDateIndex(stockData, date, state.id);
    const mIdx = findDateIndex(marketData, date, 'sh');
    if(sIdx < 20 || mIdx < 20) return null;
    const stockBase = stockData[sIdx - 20]?.close;
    const marketBase = marketData[mIdx - 20]?.close;
    if(!stockBase || !marketBase) return null;
    const stockRet = (stockData[sIdx].close - stockBase) / stockBase * 100;
    const marketRet = (marketData[mIdx].close - marketBase) / marketBase * 100;
    const diff = stockRet - marketRet;
    let label = '跟随大盘';
    if(diff >= 5) label = '强于大盘';
    else if(diff <= -5) label = '弱于大盘';
    return { stockRet, marketRet, diff, label };
}

function getHoldingDiagnosis(idx, full, ind, meta, decision) {
    const rs = getRelativeStrength(full, full[idx]?.date);
    let status = '持仓观察', action = '按原策略执行，不主动补仓。';
    if(decision.exit.level === '清仓防守' || decision.exit.level === '强离场') { 
        status = '破位防守'; action = '优先处理风险部位，果断执行纪律止损。'; 
    } else if(rs?.diff <= -5 && decision.position <= 30) { 
        status = '弱势套牢'; action = '跌破趋势支撑，反弹无量时优先降仓或调仓。'; 
    } else if(meta.windowScore >= STRATEGY.buyThreshold) { 
        status = '结构转强'; action = '已有仓位按防守位管理，新仓仍看策略阈值。'; 
    }
    const rsText = rs ? `${rs.label}，20日相对大盘 ${rs.diff >= 0 ? '+' : ''}${rs.diff.toFixed(1)}%` : '相对强弱样本不足';
    const toneClass = status === '破位防守' ? 'text-bear' : (status === '弱势套牢' ? 'text-warn' : (status === '结构转强' ? 'text-bull' : 'text-main'));
    return { status, displayStatus: getHoldingDisplayStatus(status), action, displayAction: getActionDisplayText(action), rsText, toneClass };
}

async function clearAllCache() { 
    if(DB) { 
        const tx = DB.transaction(STORE, 'readwrite'); 
        tx.objectStore(STORE).clear(); 
        await new Promise(r => tx.oncomplete = r); 
    } 
    state.rawData = {}; 
    state.weeklyData = {}; 
    state.liveBars = {};
    state.liveQuotes = {};
    state.liveWeeklyData = {};
    state.liveOverlayCache = {};
    try { localStorage.removeItem(SYS_CONFIG.LIVE_OVERLAY_CACHE_KEY); } catch(e) {}
    try { localStorage.removeItem(SECTOR_TREND_CONFIG.CACHE_KEY); } catch(e) {}
    try { localStorage.removeItem(EXTERNAL_LEAD_STRIP_CONFIG.CACHE_KEY); } catch(e) {}
    SECTOR_TREND_CONFIG.LEGACY_CACHE_KEYS.forEach(key => {
        try { localStorage.removeItem(key); } catch(e) {}
    });
    derivedIndicatorCache.clear();
    localStorage.removeItem('quant_strategy'); 
    location.reload(); 
}

async function handleClearCache() { 
    const confirmed = await customConfirm('确定要彻底清除所有本地数据缓存并重置系统吗？'); 
    if(confirmed) {
        clearAllCache().catch(async e => await customAlert('清除失败: '+e.message)); 
    }
}

function buildDataRefreshResult(id, oldConfirmed, oldVisible, freshConfirmed, nextVisible) {
    const confirmedChanged = getDataMutationMeta(oldConfirmed, freshConfirmed).mode !== 'unchanged';
    const visibleChanged = getDataMutationMeta(oldVisible, nextVisible).mode !== 'unchanged';
    return {
        id,
        confirmedChanged,
        visibleChanged,
        path: confirmedChanged ? 'confirmed' : (visibleChanged ? 'live-overlay' : 'unchanged')
    };
}

async function cachedFetch(id) {
    const perfTrace = PERF.start('cachedFetch', { id, activeId: state.id, mode: state.mode });
    const fetchStateKey = `${state.mode}_${state.id}_${state.period}_${state.strategy}`;
    const fetchSelectionSeq = globalSelectionSeq;
    const isActiveFetch = () => id === state.id &&
        fetchStateKey === `${state.mode}_${state.id}_${state.period}_${state.strategy}` &&
        fetchSelectionSeq === globalSelectionSeq;
    const cachedResult = await dbGet(id);
    if (cachedResult && cachedResult.data) cachedResult.data = normalizeConfirmedHistoryData(cachedResult.data, id);
    PERF.mark(perfTrace, 'dbGet');
    if (cachedResult && cachedResult.data && cachedResult.data.length > 0 && isActiveFetch() && state.rawData[id]?.length) {
        scheduleCachedFetchRefresh(id);
        const hasActiveChartView = !!(state.charts && (state.charts.main || state.charts.vol || state.charts.macd || state.charts.kdj));
        if (!hasActiveChartView) {
            tryApplyCachedLiveOverlay(id, state.rawData[id]);
            const rd = getActiveData();
            setLockIdx(rd?.length ? rd.length - 1 : -1);
            resetViewportToLatest(rd);
            PERF.mark(perfTrace, 'active-data', { source: 'memory', points: rd?.length || 0 });
            updateAllIndicators();
            PERF.mark(perfTrace, 'indicators');
            hideLoading();
            renderMASelector();
            const leftTxn = beginRefreshTransaction('leftList', { source: 'cachedFetch-memory', id });
            const rightTxn = beginRefreshTransaction('rightPanel', { source: 'cachedFetch-memory', id });
            if (typeof renderActiveLeftListAfterDataApply === 'function') renderActiveLeftListAfterDataApply(leftTxn, { id });
            PERF.mark(perfTrace, 'left-list');
            requestAnimationFrame(() => {
                const currentStateKey = `${state.mode}_${state.id}_${state.period}_${state.strategy}`;
                if (currentStateKey !== fetchStateKey || !isActiveFetch()) return;
                draw();
                safeUpdateSidebar();
                markRefreshTime(rightTxn, { path: 'restore-memory-chart', id });
            });
            PERF.mark(perfTrace, 'schedule-draw');
            PERF.mark(perfTrace, 'restore-memory-chart', { points: state.rawData[id].length });
            PERF.end(perfTrace, { status: 'active-memory-render', firstLoad: false });
            return;
        }
        PERF.mark(perfTrace, 'skip-cache-first-active', { points: state.rawData[id].length });
        PERF.end(perfTrace, { status: 'active-memory-refresh', firstLoad: false });
        return;
    }
    if (cachedResult && cachedResult.data && cachedResult.data.length > 0 && isActiveFetch()) {
        setRawData(id, cachedResult.data);
        tryApplyCachedLiveOverlay(id, state.rawData[id]);
        setLockIdx(getActiveData()?.length - 1 || -1);
        PERF.mark(perfTrace, 'active-data', { source: 'cache', points: cachedResult.data.length });
        updateAllIndicators();
        PERF.mark(perfTrace, 'indicators');
        hideLoading();
        renderMASelector();
        const leftTxn = beginRefreshTransaction('leftList', { source: 'cachedFetch-cache', id });
        const rightTxn = beginRefreshTransaction('rightPanel', { source: 'cachedFetch-cache', id });
        if (typeof renderActiveLeftListAfterDataApply === 'function') renderActiveLeftListAfterDataApply(leftTxn, { id });
        PERF.mark(perfTrace, 'left-list');
        requestAnimationFrame(() => {
            const currentStateKey = `${state.mode}_${state.id}_${state.period}_${state.strategy}`;
            if (currentStateKey !== fetchStateKey || !isActiveFetch()) return;
            draw();
            safeUpdateSidebar();
            markRefreshTime(rightTxn, { path: 'cache-first', id });
        });
        PERF.mark(perfTrace, 'schedule-draw');
        PERF.mark(perfTrace, 'use-cache', { points: cachedResult.data.length });
        PERF.end(perfTrace, { status: 'cache-first', firstLoad: false });
        scheduleCachedFetchRefresh(id);
        return;
    }

    const oldVisible = isActiveFetch() ? getActiveData() : null;
    const fresh = await syncData(id);
    PERF.mark(perfTrace, 'syncData', { points: fresh?.length || 0 });
    if (!fresh || fresh.length === 0) {
        if (isActiveFetch()) {
            if (typeof clearCharts === 'function') clearCharts('error');
            if (typeof renderActiveSelectionStatus === 'function') renderActiveSelectionStatus('unavailable');
        }
        PERF.end(perfTrace, { status: 'no-fresh-data', firstLoad: true });
        return;
    }

    const old = state.rawData[id];
    const refreshResult = buildDataRefreshResult(id, old, oldVisible, fresh, isActiveFetch() ? getActiveData() : oldVisible);
    const hasUpdate = refreshResult.confirmedChanged;
    const visibleHasUpdate = isActiveFetch() && refreshResult.visibleChanged;
    const shouldApplyFresh = !old || !old.length || refreshResult.confirmedChanged;
    const leftTxn = beginRefreshTransaction('leftList', { source: 'cachedFetch', id });
    const rightTxn = beginRefreshTransaction('rightPanel', { source: 'cachedFetch', id });
    
    if (shouldApplyFresh) {
        setRawData(id, fresh);
        PERF.mark(perfTrace, 'active-data', { source: 'fresh', points: fresh.length });
        await dbSet(id, fresh);
        PERF.mark(perfTrace, 'dbSet');
        if (typeof syncWatchlistSignalSnapshotFast === 'function') {
            const matched = (state.watchlist || []).find(stock => normalizeSecurityTarget(stock).secid === id);
            if (matched) syncWatchlistSignalSnapshotFast(matched.code, fresh);
            PERF.mark(perfTrace, 'watchlist');
        }
        if (isActiveFetch()) {
            setLockIdx(getActiveData()?.length - 1 || -1);
            hideLoading();
            renderMASelector();
            updateAllIndicators();
            PERF.mark(perfTrace, 'indicators');
            requestAnimationFrame(() => {
                const currentStateKey = `${state.mode}_${state.id}_${state.period}_${state.strategy}`;
                if (currentStateKey !== fetchStateKey || !isActiveFetch()) return;
                draw();
                safeUpdateSidebar();
                markRefreshTime(rightTxn, { path: 'apply-fresh', id });
            });
            PERF.mark(perfTrace, 'schedule-draw');
        }
        PERF.mark(perfTrace, 'apply-fresh', { hasUpdate, firstLoad: !old || !old.length });
    } else if (isActiveFetch() && visibleHasUpdate) {
        renderMASelector();
        updateAllIndicators();
        requestAnimationFrame(() => {
            const currentStateKey = `${state.mode}_${state.id}_${state.period}_${state.strategy}`;
            if (currentStateKey !== fetchStateKey || !isActiveFetch()) return;
            applyActiveDataRefresh(id);
            markRefreshTime(rightTxn, { path: 'apply-live-overlay', id });
        });
        PERF.mark(perfTrace, 'apply-live-overlay', { points: getActiveData()?.length || 0 });
    } else if (isActiveFetch()) {
        hideLoading();
        renderMASelector();
        requestAnimationFrame(() => {
            const currentStateKey = `${state.mode}_${state.id}_${state.period}_${state.strategy}`;
            if (currentStateKey !== fetchStateKey || !isActiveFetch()) return;
            draw();
            safeUpdateSidebar();
            markRefreshTime(rightTxn, { path: 'reuse-state', id });
        });
        PERF.mark(perfTrace, 'reuse-state', { points: old.length });
    }
    if (typeof renderActiveLeftListAfterDataApply === 'function') renderActiveLeftListAfterDataApply(leftTxn, { id });
    PERF.mark(perfTrace, 'left-list');
    PERF.end(perfTrace, { status: shouldApplyFresh ? (hasUpdate ? 'updated' : 'initial') : 'unchanged', firstLoad: !old || !old.length });
}

function scheduleCachedFetchRefresh(id) {
    if (cachedFetchRefreshJobs.has(id)) return cachedFetchRefreshJobs.get(id);
    const job = (async () => {
        const perfTrace = PERF.start('cachedFetchRefresh', { id, activeId: state.id, mode: state.mode });
        const oldVisible = id === state.id ? getActiveData() : null;
        const fresh = await syncData(id);
        PERF.mark(perfTrace, 'syncData', { points: fresh?.length || 0 });
        if (!fresh || fresh.length === 0) {
            PERF.end(perfTrace, { status: 'no-fresh-data' });
            return;
        }

        const old = state.rawData[id];
        const refreshResult = buildDataRefreshResult(id, old, oldVisible, fresh, id === state.id ? getActiveData() : oldVisible);
        const hasUpdate = refreshResult.confirmedChanged;
        const visibleHasUpdate = id === state.id && refreshResult.visibleChanged;
        if (!hasUpdate && !visibleHasUpdate) {
            PERF.end(perfTrace, { status: 'unchanged' });
            return;
        }

        if (hasUpdate) {
            setRawData(id, fresh);
            PERF.mark(perfTrace, 'apply-raw');
            await dbSet(id, fresh);
            PERF.mark(perfTrace, 'dbSet');
        } else {
            PERF.mark(perfTrace, 'apply-live-overlay');
        }
        if (hasUpdate && typeof syncWatchlistSignalSnapshotFast === 'function') {
            const matched = (state.watchlist || []).find(stock => normalizeSecurityTarget(stock).secid === id);
            if (matched) syncWatchlistSignalSnapshotFast(matched.code, fresh);
            PERF.mark(perfTrace, 'watchlist');
        }
        if (id === state.id) {
            scheduleCachedFetchRefreshApply(id);
            PERF.mark(perfTrace, 'queue-active-apply');
        }
        if (state.mode === 'index') {
            const leftTxn = beginRefreshTransaction('leftList', { source: 'cachedFetchRefresh', id });
            renderIndexList();
            if (typeof markLeftListRefreshForActiveTab === 'function') markLeftListRefreshForActiveTab(leftTxn, { area: 'index-list', id });
            PERF.mark(perfTrace, 'render-index-list');
        }
        if (state.mode === 'stock' && typeof scheduleWatchlistRender === 'function') {
            scheduleWatchlistRender({
                markRefresh: true,
                refreshTxn: beginRefreshTransaction('leftList', { source: 'cachedFetchRefresh', id })
            });
        }
        PERF.end(perfTrace, { status: 'updated' });
    })().finally(() => {
        cachedFetchRefreshJobs.delete(id);
    });
    cachedFetchRefreshJobs.set(id, job);
    return job;
}

async function preloadCacheOnly() {
    const symbols = [...INDEX_IDS];
    if (state.watchlist && state.watchlist.length > 0) {
        const watchlistSymbols = state.watchlist
            .map(stock => normalizeSecurityTarget(stock))
            .filter(target => isSupportedWatchlistSecurity(target))
            .map(target => target.secid);
        symbols.push(...watchlistSymbols.filter(id => !symbols.includes(id)));
    }
    for (const id of symbols) {
        try {
            const c = await dbGet(id);
            const cachedData = normalizeConfirmedHistoryData(c?.data, id);
            if (cachedData && cachedData.length >= 30 && isValidPrice(cachedData[cachedData.length - 1].close, id)) {
                setRawData(id, cachedData);
            }
        } catch(e) {}
    }
}

function shouldEnsureMarketTemperatureData(id) {
    const data = state.rawData?.[id];
    if (!data || data.length < 60) return true;
    return !isConfirmedSeriesFreshEnough(data);
}

async function ensureMarketTemperatureData() {
    for (const id of INDEX_IDS) {
        if (!shouldEnsureMarketTemperatureData(id)) continue;
        try {
            const data = await syncData(id);
            if (data && data.length >= 30) {
                setRawData(id, data);
                await dbSet(id, data);
            }
        } catch(e) {}
    }
    if (state.mode === 'index' || state.mode === 'stock') {
        updateAllIndicators();
        safeUpdateSidebar();
    }
}
