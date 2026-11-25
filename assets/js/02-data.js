/* DailyGlance [2] - split from dailyglance.html. Keep classic script order. */
// ==========================================
// [2] 接口与数据层 (API & Data Layer)
// ==========================================

// 数据代次由数据库重置事务更新；会话代次阻止取消后迟到的任务提交。
const DATA_GENERATION_RECORD_KEY = '__dg_data_generation__';
const DATA_RESET_NOTIFICATION_KEY = 'dg_data_reset_generation_v1';
const dataTaskRuntime = { generation:0, lifecycle:0, resetSerial:0, resetting:false, resetPromise:null, controllers:new Set() };
function createDataTaskToken(requireOwnership = false) {
    return { generation:dataTaskRuntime.generation, lifecycle:dataTaskRuntime.lifecycle,
        requireOwnership, owner:typeof marketRefreshLeadershipStarted !== 'undefined' && marketRefreshLeadershipStarted ? PAGE_SESSION_ID : '' };
}
function createWatchlistMutationToken() {
    return {...createDataTaskToken(),durable:true,resetSerial:dataTaskRuntime.resetSerial};
}
function isDataTaskCurrent(token) {
    if (!token || dataTaskRuntime.resetting || token.generation !== dataTaskRuntime.generation) return false;
    if (token.durable) return token.resetSerial===dataTaskRuntime.resetSerial;
    if (token.lifecycle !== dataTaskRuntime.lifecycle) return false;
    const lease = typeof readMarketRefreshLease === 'function' ? readMarketRefreshLease() : null;
    return !token.requireOwnership || !token.owner || (!document.hidden && (marketRefreshLeaseUnavailable || (lease ? lease.owner===token.owner && lease.expiresAt>Date.now() : marketRefreshLeader)));
}
function cancelDataTasks(reason = 'lifecycle') {
    dataTaskRuntime.lifecycle++;
    if (reason==='reset' || reason==='cross-page-reset') {
        dataTaskRuntime.resetSerial++;
        for (const stock of state.watchlist || []) delete stock._pendingRemove;
        if (typeof pendingWatchlistMutations!=='undefined') pendingWatchlistMutations.length=0;
    }
    dataTaskRuntime.controllers.forEach(controller => controller.abort());
    dataTaskRuntime.controllers.clear();
    for (const [id,limiter] of requestManager.limiters) if(limiter.isFetching) requestManager.limiters.set(id,{...limiter,isFetching:false});
    _runJsonpCleanup();
    while (historySyncQueue.length) historySyncQueue.shift().resolve(null);
    // A resumed request must not join a promise owned by the cancelled session.
    for (const map of [historySyncInFlight,syncDataInFlight,confirmedDataInFlight,cachedFetchInFlight,cachedFetchRefreshJobs]) map.clear();
    if (typeof cancelCurrentCalculation === 'function') cancelCurrentCalculation(reason);
}
function canPersistSessionData() {
    if(dataTaskRuntime.resetting)return false;
    try {return !(JSON.parse(localStorage.getItem(DATA_RESET_NOTIFICATION_KEY) || 'null')?.generation>dataTaskRuntime.generation);} catch(error) {return true;}
}

function getStoredDataGeneration(record) {
    const value = Number(record?.data);
    return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}
async function initializeDataGeneration(apply = true) {
    if (!DB) return dataTaskRuntime.generation;
    const record=await new Promise(resolve=>{
        let settled=false;
        const timer=setTimeout(()=>finish(null,'本地数据代次读取超时'),1000);
        function finish(value,reason='') {
            if(settled)return;settled=true;clearTimeout(timer);
            if(reason)disablePersistentStorage(reason);resolve(value);
        }
        try {
            const request=DB.transaction(STORE,'readonly').objectStore(STORE).get(DATA_GENERATION_RECORD_KEY);
            request.onsuccess=event=>finish(event.target.result);
            request.onerror=()=>finish(null,'本地数据代次读取失败');
        } catch(error) {finish(null,'本地数据代次不可读取');}
    });
    const generation=getStoredDataGeneration(record);
    if(apply)dataTaskRuntime.generation=generation;
    return generation;
}
async function checkDataGenerationAfterResume() {
    if(!DB || dataTaskRuntime.resetting)return;
    const generation=await initializeDataGeneration(false);
    if(generation>dataTaskRuntime.generation)handleDataResetNotification({key:DATA_RESET_NOTIFICATION_KEY,
        newValue:JSON.stringify({generation,owner:"storage-check"})});
}

function clearSessionDataAfterReset() {
    for (const key of ['rawData','weeklyData','liveBars','liveQuotes','liveWeeklyData','liveDailyData','liveOverlayCache',
        'confirmedStatus','displayStatus','historyChecks','quoteRefreshFailures','realtimeBatchAt','activeHistoryRefreshAt']) state[key] = {};
    state.watchlist = []; stockCache = [];
    state.indicatorKey = ''; state.indicators = {ma:{},macd:null,rsi:null,kdj:null};
    state.pendingIndicatorMutation = {mode:'full',startIdx:0};
    state.refreshSnapshots = {leftList:null,rightPanel:null};
    state.leftListRefreshAt = 0; state.rightPanelRefreshAt = 0;
    derivedIndicatorCache.clear(); clearDerivedCaches();
    historyRefreshMeta.clear(); _lastPersistedDecisionCacheKey.clear();
    if (typeof pendingWatchlistMutations !== 'undefined') pendingWatchlistMutations.length = 0;
    if (typeof watchlistSnapshotQueue !== 'undefined') watchlistSnapshotQueue.clear();
}
function handleDataResetNotification(event) {
    if (event.key !== DATA_RESET_NOTIFICATION_KEY || !event.newValue) return;
    let payload; try { payload = JSON.parse(event.newValue); } catch (error) { return; }
    if (payload.owner === PAGE_SESSION_ID || !Number.isSafeInteger(payload.generation) || payload.generation <= dataTaskRuntime.generation) return;
    dataTaskRuntime.resetting = true;
    if (typeof stopRefreshSchedulers === 'function') stopRefreshSchedulers('cross-page-reset');
    cancelDataTasks('cross-page-reset');
    dataTaskRuntime.generation = payload.generation;
    clearSessionDataAfterReset();
    if (typeof location !== 'undefined') location.reload();
}
if (typeof window !== 'undefined') window.addEventListener?.('storage',handleDataResetNotification);

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
    if (typeof input === 'object') {
        const target = normalizeSecurityTarget(input);
        if (target.type === 'fund') return true;
        // 搜索结果/测试上下文可能没有携带类型字段，但交易所 ETF 代码本身足以确定三位价格精度。
        return /^(?:5\d{5}|1[568]\d{4})$/.test(target.code);
    }
    const text = String(input || '').trim();
    const matched = state?.watchlist?.find(item => item.secid === text || item.code === text);
    if (matched) return isFundSecurity(matched);
    const code = text.includes('.') ? text.split('.')[1] : text;
    return /^(?:5\d{5}|1[568]\d{4})$/.test(code);
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
const retiredSecurityIds = new Set();
function isRetiredSecurity(id) {
    return retiredSecurityIds.has(id) && state.id !== id
        && !(state.watchlist || []).some(stock => normalizeSecurityTarget(stock).secid === id);
}
function releaseRetiredSecurityData() {
    for (const id of retiredSecurityIds) {
        if (getIndexConfig(id) || (state.watchlist || []).some(stock => normalizeSecurityTarget(stock).secid === id)) {
            retiredSecurityIds.delete(id);
            continue;
        }
        if (state.id === id || historySyncInFlight.has(id) || syncDataInFlight.has(id) || confirmedDataInFlight.has(id)
            || [...cachedFetchInFlight.keys()].some(key => key.startsWith(id + ':')) || requestManager.limiters.get(id)?.isFetching) continue;
        let released = false;
        for (const key of ['rawData','weeklyData','liveBars','liveQuotes','liveDailyData','liveWeeklyData','historyChecks',
            'quoteRefreshFailures','confirmedStatus','displayStatus','realtimeBatchAt','activeHistoryRefreshAt']) {
            if (state[key] && Object.prototype.hasOwnProperty.call(state[key],id)) { delete state[key][id]; released = true; }
        }
        clearLiveOverlayCache(id);
        historyRefreshMeta.delete(id);
        requestManager.limiters.delete(id);
        lastUpdateClicks.delete(id);
        _lastPersistedDecisionCacheKey.delete(id);
        for (const key of derivedIndicatorCache.keys()) if (key.startsWith(id + '_')) { derivedIndicatorCache.delete(key); released = true; }
        if (released) { renderCache.clear(); clearLookupCacheOnly(); }
        // 保留有界的退休标记，拒绝晚到消费者再次填回已移除标的。
    }
}
function retireSecurityData(id) {
    if (!id) return;
    retiredSecurityIds.add(id);
    while (retiredSecurityIds.size > 64) retiredSecurityIds.delete(retiredSecurityIds.values().next().value);
    releaseRetiredSecurityData();
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
function finiteMarketNumber(value, fallback = NaN) {
    if (typeof value !== 'number' && typeof value !== 'string') return fallback;
    if (typeof value === 'string' && !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())) return fallback;
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}
function isValidPrice(price, id) { return finiteMarketNumber(price) > 0; }
function isValidMarketDate(date) {
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
    const parsed = new Date(`${date}T00:00:00Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}
function getTradingCalendarInfo(date = getTodayDate()) {
    const year = isValidMarketDate(date) ? Number(date.slice(0, 4)) : 0;
    return { year, covered: year === 2026, inferred: year !== 2026 };
}
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

function hasTrustedQuoteTime(bar) {
    if (bar?.quoteDateSource !== 'api') return false;
    const parsed = parseTencentQuoteTime(String(bar.quoteTime || '').replace(/[- :]/g, ''));
    return !!parsed && parsed.date === bar.date;
}

function getQuoteExchangeTime(bar) {
    if (!hasTrustedQuoteTime(bar)) return 0;
    const parsed=parseTencentQuoteTime(String(bar.quoteTime).replace(/[- :]/g,''));
    const value = Date.parse(parsed.quoteTime.replace(' ','T') + '+08:00');
    return Number.isFinite(value) ? value : 0;
}
function validateLiveBar(id, bar) {
    if (!bar || !isValidMarketDate(bar.date) || !hasTrustedQuoteTime(bar)) return {ok:false,reason:'untrusted-quote-time'};
    const [open,high,low,close] = ['open','high','low','close'].map(key => finiteMarketNumber(bar[key]));
    if (![open,high,low,close].every(value => isValidPrice(value,id))) return {ok:false,reason:'incomplete-live-ohlc'};
    if (high < Math.max(open,low,close) || low > Math.min(open,high,close)) return {ok:false,reason:'invalid-live-ohlc'};
    if (finiteMarketNumber(bar.vol,0) < 0 || finiteMarketNumber(bar.amt,0) < 0) return {ok:false,reason:'invalid-live-volume'};
    return {ok:true,reason:''};
}
function isOlderRealtimeQuote(id, bar) {
    const today=getTodayDate();
    const previous=[state.liveQuotes?.[id],state.liveBars?.[id],state.liveOverlayCache?.[id]?.bar]
        .filter(row=>row?.date && row.date<=today);
    if (!previous.length) return false;
    const lastDate=previous.map(row=>row.date).sort().at(-1);
    if(bar.date && bar.date<lastDate)return true;
    const nextTime=getQuoteExchangeTime(bar),previousTime=Math.max(...previous.map(getQuoteExchangeTime));
    return Boolean(previousTime && nextTime && nextTime<previousTime);
}

function normalizeTencentQuoteAmount(rawAmount) {
    const amountInTenThousands = finiteMarketNumber(rawAmount);
    return Number.isFinite(amountInTenThousands) ? amountInTenThousands * 10000 : 0;
}
function isTradingDay(dateStr) {
    if (!isValidMarketDate(dateStr)) return false;
    // 日期字符串代表交易所日历日，不得用电脑所在地的星期解释。
    const day = new Date(dateStr + 'T00:00:00Z').getUTCDay();
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
    if (!Array.isArray(rows) || !rows.length) return [];
    const cutoffDate = getConfirmedHistoryCutoffDate();
    const byDate = new Map();
    rows.forEach(row => {
        if (!row || !isValidMarketDate(row.date) || row.date > cutoffDate) return;
        const open = finiteMarketNumber(row.open);
        const close = finiteMarketNumber(row.close);
        const high = finiteMarketNumber(row.high);
        const low = finiteMarketNumber(row.low);
        const vol = finiteMarketNumber(row.vol, 0);
        const amt = finiteMarketNumber(row.amt, 0);
        if (![open, close, high, low].every(price => isValidPrice(price, id))) return;
        // 不把异常OHLC静默修成可信历史；缺成交量/额沿用既有未知值0口径。
        if (high < Math.max(open, close, low) || low > Math.min(open, close, high) || vol < 0 || amt < 0) return;
        byDate.set(row.date, {
            date: row.date,
            open,
            close,
            high,
            low,
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
    if (state.liveDailyData?.[id]) return state.liveDailyData[id];
    if (!confirmed.length) return [liveBar];
    const last = confirmed[confirmed.length - 1];
    if (!last || liveBar.date < last.date) {
        state.liveDailyData[id] = confirmed;
        return state.liveDailyData[id];
    }
    if (liveBar.date === last.date) {
        state.liveDailyData[id] = confirmed.slice(0, -1).concat(liveBar);
        return state.liveDailyData[id];
    }
    state.liveDailyData[id] = confirmed.concat(liveBar);
    return state.liveDailyData[id];
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
    // 没有有效昨收时不以开盘价伪造涨跌幅。
    return null;
}

function getLiveOverlayCacheKey(id) {
    return `${SYS_CONFIG.LIVE_OVERLAY_CACHE_KEY}:${id}`;
}

let liveOverlayCacheBatchDepth = 0;
let liveOverlayCacheBatchHydrated = false;
let liveOverlayCacheBatchDirty = false;
let liveOverlayCacheBatchDeletedIds = new Set();

function hydrateLiveOverlayCacheState() {
    if (!state.liveOverlayCache) state.liveOverlayCache = {};
    if (liveOverlayCacheBatchDepth > 0 && liveOverlayCacheBatchHydrated) return state.liveOverlayCache;
    try {
        const raw = localStorage.getItem(SYS_CONFIG.LIVE_OVERLAY_CACHE_KEY);
        state.liveOverlayCache = raw ? JSON.parse(raw) || {} : {};
    } catch (error) {
        state.liveOverlayCache = {};
    }
    if (liveOverlayCacheBatchDepth > 0) liveOverlayCacheBatchHydrated = true;
    return state.liveOverlayCache;
}

function persistLiveOverlayCacheStateNow() {
    if (!canPersistSessionData()) return;
    if (!state.liveOverlayCache) state.liveOverlayCache = {};
    try {
        // 合并同源页面在本批次期间写入的更新，避免批量行情覆盖其他页面的标的。
        let latest = {};
        const raw = localStorage.getItem(SYS_CONFIG.LIVE_OVERLAY_CACHE_KEY);
        if (raw) latest = JSON.parse(raw) || {};
        const merged=Object.fromEntries(Object.entries(latest).filter(([,entry])=>(entry?.generation ?? 0)===dataTaskRuntime.generation));
        liveOverlayCacheBatchDeletedIds.forEach(id => delete merged[id]);
        Object.entries(state.liveOverlayCache).forEach(([id, entry]) => {
            if (liveOverlayCacheBatchDeletedIds.has(id) || (entry?.generation ?? 0)!==dataTaskRuntime.generation) return;
            const latestAt = Number(merged[id]?.cachedAt) || 0;
            const localAt = Number(entry?.cachedAt) || 0;
            const latestTime=getQuoteExchangeTime(merged[id]?.bar),localTime=getQuoteExchangeTime(entry?.bar);
            if (!merged[id] || localTime>latestTime || (localTime===latestTime && localAt>=latestAt)) merged[id]=entry;
        });
        state.liveOverlayCache = merged;
        localStorage.setItem(SYS_CONFIG.LIVE_OVERLAY_CACHE_KEY, JSON.stringify(merged));
        if (liveOverlayCacheBatchDepth === 0) liveOverlayCacheBatchDeletedIds = new Set();
    } catch (error) {}
}

function persistLiveOverlayCacheState() {
    if (liveOverlayCacheBatchDepth > 0) {
        liveOverlayCacheBatchDirty = true;
        return;
    }
    persistLiveOverlayCacheStateNow();
}

function beginLiveOverlayCacheBatch() {
    if (liveOverlayCacheBatchDepth === 0) {
        liveOverlayCacheBatchDirty = false;
        liveOverlayCacheBatchDeletedIds = new Set();
        liveOverlayCacheBatchHydrated = false;
        hydrateLiveOverlayCacheState();
    }
    liveOverlayCacheBatchDepth += 1;
}

function endLiveOverlayCacheBatch() {
    if (liveOverlayCacheBatchDepth <= 0) return;
    liveOverlayCacheBatchDepth -= 1;
    if (liveOverlayCacheBatchDepth > 0) return;
    if (liveOverlayCacheBatchDirty) persistLiveOverlayCacheStateNow();
    liveOverlayCacheBatchDirty = false;
    liveOverlayCacheBatchHydrated = false;
    liveOverlayCacheBatchDeletedIds = new Set();
}

function normalizeLiveOverlayCacheBar(id, bar) {
    if (!validateLiveBar(id,bar).ok) return null;
    return {date:bar.date, open:Number(bar.open),high:Number(bar.high),low:Number(bar.low),close:Number(bar.close),
        prevClose:finiteMarketNumber(bar.prevClose,0),vol:finiteMarketNumber(bar.vol,0),amt:finiteMarketNumber(bar.amt,0),
        quoteTime:bar.quoteTime,quoteDateSource:bar.quoteDateSource,_isLive:true,_isCachedLive:true};
}

function getLiveOverlayCacheEntry(id) {
    const store = hydrateLiveOverlayCacheState();
    const entry = store[id];
    if (!entry || !entry.bar || (entry.generation ?? 0)!==dataTaskRuntime.generation) return null;
    const cachedAt = Number(entry.cachedAt) || 0;
    // cacheAgeMs 只是写入时的快照，恢复时必须以 cachedAt 重新计算，避免盘中缓存重载后短暂显示为新鲜。
    const cacheAgeMs = cachedAt ? Math.max(0, Date.now() - cachedAt) : Infinity;
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
    if (!id || dataTaskRuntime.resetting || isOlderRealtimeQuote(id,bar)) return false;
    const normalizedBar = normalizeLiveOverlayCacheBar(id, bar);
    if (!normalizedBar) return false;
    hydrateLiveOverlayCacheState();
    state.liveOverlayCache[id] = {
        generation:dataTaskRuntime.generation,
        cachedAt: Number(meta.cachedAt) || Date.now(),
        cacheAgeMs: Number.isFinite(Number(meta.cacheAgeMs)) ? Math.max(0, Number(meta.cacheAgeMs)) : 0,
        source: meta.source || 'api',
        bar: normalizedBar
    };
    liveOverlayCacheBatchDeletedIds.delete(id);
    persistLiveOverlayCacheState();
    return true;
}

function clearLiveOverlayCache(id) {
    hydrateLiveOverlayCacheState();
    if (state.liveOverlayCache && state.liveOverlayCache[id]) {
        delete state.liveOverlayCache[id];
        liveOverlayCacheBatchDeletedIds.add(id);
        persistLiveOverlayCacheState();
    }
}

function canUseCachedLiveOverlay(id, series, cacheEntry) {
    if (!cacheEntry || !cacheEntry.bar) return { ok: false, reason: 'missing-cache' };
    const quality = validateLiveBar(id,cacheEntry.bar);
    if (!quality.ok) return quality;
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
    if (isRetiredSecurity(id)) return;
    if (!state.displayStatus) state.displayStatus = {};
    state.displayStatus[id] = { ...(state.displayStatus[id] || {}), ...patch };
}

function setConfirmedStatus(id, patch = {}) {
    if (isRetiredSecurity(id)) return;
    if (!state.confirmedStatus) state.confirmedStatus = {};
    state.confirmedStatus[id] = { ...(state.confirmedStatus[id] || {}), ...patch };
}

function setLiveQuote(id, bar, quality = 'quote-only', reason = '', meta = {}) {
    if (dataTaskRuntime.resetting || isOlderRealtimeQuote(id,bar)) return false;
    if (isRetiredSecurity(id)) return false;
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
    if (dataTaskRuntime.resetting || !validateLiveBar(id,bar).ok || isOlderRealtimeQuote(id,bar)) return false;
    const previous = state.liveBars?.[id];
    const repeated = previous && getQuoteExchangeTime(previous) === getQuoteExchangeTime(bar) && barsEqual(previous,bar);
    if (isRetiredSecurity(id)) return false;
    if (!id || !bar || !isValidPrice(bar.close, id)) return false;
    if (!state.liveBars) state.liveBars = {};
    if (!state.liveDailyData) state.liveDailyData = {};
    if (!state.liveWeeklyData) state.liveWeeklyData = {};
    const isCachedLive = source === 'cache' || !!meta.isCachedLive;
    const cachedAt = Number(meta.cachedAt) || (isCachedLive ? Date.now() : 0);
    const cacheAgeMs = Number.isFinite(Number(meta.cacheAgeMs)) ? Number(meta.cacheAgeMs) : (isCachedLive && cachedAt ? Math.max(0, Date.now() - cachedAt) : 0);
    const isSoftExpired = isCachedLive && cacheAgeMs > SYS_CONFIG.LIVE_OVERLAY_CACHE_TTL_MS;
    const isPostClosePending = isCachedLive && isAfterMarketClose() && (bar.date || '') === getTodayDate();
    const displayMode = isPostClosePending ? 'post-close-pending' : (isCachedLive ? 'cached-live-overlay' : 'live-overlay');
    const displayReason = isPostClosePending ? '盘后待确认' : (isCachedLive ? (isSoftExpired ? '沿用盘中' : '短TTL缓存盘中') : '');
    if (repeated && Boolean(previous._isCachedLive)===isCachedLive && state.displayStatus?.[id]?.mode===displayMode) {
        previous._cacheAgeMs=cacheAgeMs;previous._isSoftExpiredLive=isSoftExpired;
        setDisplayStatus(id,{mode:displayMode,reason:displayReason,repeated:!isCachedLive,quoteTime:previous.quoteTime,
            quoteAt:state.displayStatus?.[id]?.quoteAt || Date.now(),cacheAgeMs,cachedAt});
        return true;
    }
    setLiveQuote(id, bar, 'valid-overlay', '', { isCachedLive, cachedAt });
    state.liveBars[id] = {
        ...bar,
        _isLive: true,
        _isCachedLive: isCachedLive,
        _isSoftExpiredLive: isSoftExpired,
        _cachedAt: cachedAt,
        _cacheAgeMs: cacheAgeMs
    };
    delete state.liveDailyData[id];
    delete state.liveWeeklyData[id];
    setDisplayStatus(id, {
        mode: displayMode,
        reason: displayReason,
        quoteDate: bar.date || '',
        quoteTime:bar.quoteTime || '',
        repeated:false,
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
    if (!state.liveDailyData) state.liveDailyData = {};
    if (!state.liveWeeklyData) state.liveWeeklyData = {};
    delete state.liveBars[id];
    delete state.liveDailyData[id];
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
    const quality = validateLiveBar(id,rtBar);
    if (!quality.ok) return quality;
    if (isOlderRealtimeQuote(id,rtBar)) return {ok:false,reason:'quote-time-regression'};
    if (!rtBar || !series || !series.length) return { ok: false, reason: 'missing-data' };
    const lastBar = series[series.length - 1];
    if (!lastBar || !isValidPrice(rtBar.close, id)) return { ok: false, reason: 'invalid-price' };
    if (!hasTrustedQuoteTime(rtBar)) return { ok: false, reason: 'untrusted-quote-time' };
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
    if (dataTaskRuntime.resetting) return 'skipped';
    if (rtBar && isOlderRealtimeQuote(id,rtBar)) return state.liveBars?.[id]?._isCachedLive ? 'cached-overlay' : 'skipped';
    const overlayGate = canUseRealtimeOverlay(id, series, rtBar);
    if (overlayGate.ok) {
        return setLiveBar(id, rtBar) ? 'overlay' : 'skipped';
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

const dateLookupArrayIds = new WeakMap();
let dateLookupArraySeq = 0;
function findDateIndex(data, date, id = '') {
    if(!data || !data.length) return -1;
    const firstDate = data[0]?.date || '';
    const lastDate = data[data.length - 1]?.date || '';
    if (!dateLookupArrayIds.has(data)) dateLookupArrayIds.set(data, ++dateLookupArraySeq);
    const cacheKey = `${id}_${dateLookupArrayIds.get(data)}_${data.length}_${firstDate}_${lastDate}_${date}`;
    if (dateIndexCache.has(cacheKey)) return dateIndexCache.get(cacheKey);
    let l = 0, r = data.length - 1, res = -1;
    while (l <= r) {
        let m = (l + r) >> 1;
        if (data[m].date === date) { res = m; break; }
        else if (data[m].date < date) { res = m; l = m + 1; }
        else r = m - 1;
    }
    dateIndexCache.set(cacheKey, res); 
    // hover/切换日期会产生大量短生命周期 key，限制上限避免长时间盘中运行持续增长。
    const maxEntries = Math.max(128, Number(SYS_CONFIG.RENDER_CACHE_SIZE || 50) * 4);
    while (dateIndexCache.size > maxEntries) dateIndexCache.delete(dateIndexCache.keys().next().value);
    return res;
}

function alignLockToPeriod(targetPeriod, anchorDate) {
    const data = targetPeriod === 'weekly' ? state.weeklyData[state.id] : state.rawData[state.id];
    if(!data || !data.length) return -1;
    if(anchorDate) return Math.max(0, findDateIndex(data, anchorDate, state.id));
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
    if (dataTaskRuntime.resetting) return {changed:false,mutation:{mode:'unchanged',startIdx:0}};
    if (isRetiredSecurity(id)) return { changed:false, mutation:{mode:'unchanged',startIdx:0} };
    data = normalizeConfirmedHistoryData(data, id);
    const prevData = state.rawData[id];
    const mutation = prevData ? getDataMutationMeta(prevData, data) : { mode: 'full', startIdx: 0 };

    // 盘中轮询经常会拿到同一份确认历史。保留原数组和派生缓存，
    // 避免每只标的重复重建周线、清理渲染缓存并触发主线程长任务。
    if (prevData && data && mutation.mode === 'unchanged') {
        // 即使确认历史未变，盘后仍需清理已经被确认覆盖的同日临时 K 线。
        clearConfirmedLiveBar(id, prevData);
        return { changed: false, mutation };
    }

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
    if (!state.liveDailyData) state.liveDailyData = {};
    delete state.liveDailyData[id];
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
    // 包含当前选中的核心指数；其他标的/周期/策略下的旧快照也已不再可复用。
    if (CORE_MARKET_INDEX_IDS.includes(id) && typeof pruneStaleMarketContextCaches === 'function') {
        pruneStaleMarketContextCaches();
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
    return { changed: true, mutation };
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

function createRealtimeFetchSkipped(reason) {
    return { __dgRealtimeFetch: 'skipped', reason: reason || 'throttled' };
}

function isRealtimeFetchSkipped(result) {
    return !!result && result.__dgRealtimeFetch === 'skipped';
}

let realtimeRequestSeq = 0;
function createRealtimeRequestToken(kind) {
    realtimeRequestSeq += 1;
    return `${kind || 'realtime'}:${Date.now()}:${realtimeRequestSeq}`;
}

const requestManager = {
    limiters: new Map(),
    async fetchRealtimeWithThrottle(id) {
        if (typeof canRequestMarketData === 'function' && !canRequestMarketData()) return createRealtimeFetchSkipped('not-leader');
        const now = Date.now(), s = this.limiters.get(id) || { lastCall: 0, isFetching: false };
        if (s.isFetching) return createRealtimeFetchSkipped('in-flight');
        if (now - s.lastCall < SYS_CONFIG.THROTTLE_MS) return createRealtimeFetchSkipped('throttled');
        const requestToken = createRealtimeRequestToken('single');
        s.isFetching = requestToken; this.limiters.set(id, s);
        try { const rt = await getRealtimePriceJSONP(id); return rt; }
        catch (e) { return null; }
        finally {
            const current = this.limiters.get(id) || s;
            if (current.isFetching === requestToken) {
                current.lastCall = Date.now();
                current.isFetching = false;
                this.limiters.set(id, current);
            }
            releaseRetiredSecurityData();
        }
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
    if (controller) dataTaskRuntime.controllers.add(controller);
    const token = createDataTaskToken(true);
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
        if (!isDataTaskCurrent(token)) return [];
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
        if (isDataTaskCurrent(token)) recordHistorySourceTransportFailure('tickflow');
        return [];
    } finally {
        if (timer) clearTimeout(timer);
        if (controller) dataTaskRuntime.controllers.delete(controller);
    }
}

function requestJsonp({ url, id, charset, timeoutMs = SYS_CONFIG.REQ_TIMEOUT, callback, parse,
    globals = [], onResponse, onTransportFailure, onCleanup }) {
    return new Promise(resolve => {
        const script = document.createElement('script');
        let settled = false, timer = 0;
        const finish = (value, transportFailure = false) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            _unregisterJsonpCleanup(cancel);
            try { if (transportFailure) onTransportFailure?.(); } catch (error) {}
            try { script.remove(); } catch (error) {}
            globals.forEach(name => { try { delete window[name]; } catch (error) {} });
            try { onCleanup?.(); } catch (error) {}
            resolve(value);
        };
        const cancel = () => finish(null);
        const receive = payload => {
            if (settled) return;
            try {
                const value = parse(payload);
                onResponse?.();
                finish(value);
            } catch (error) {
                // 非法响应不是传输失败，但不能清掉超时后把Promise永远留在进行中。
                finish(null);
            }
        };
        _registerJsonpCleanup(cancel);
        try {
            globals.forEach(name => { delete window[name]; });
            if (id) script.id = id;
            script.src = url;
            if (charset) script.charset = charset;
            if (callback) window[callback] = receive;
            script.onload = () => { if (callback && !settled) finish(null); else if (!callback) receive(undefined); };
            script.onerror = () => finish(null, true);
            timer = setTimeout(() => finish(null, true), timeoutMs);
            document.head.appendChild(script);
        } catch (error) { finish(null, true); }
    });
}

function jsonpFetchEastmoneyKline(id) {
    if (isHistorySourceCircuitOpen('eastmoney')) return Promise.resolve([]);
    const secid = resolveSecid(id), cb = 'em_kline_' + Date.now() + '_' + Math.random().toString(36).slice(2,6);
    const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61&klt=101&fqt=1&end=20500101&lmt=1000&cb=${cb}`;
    return requestJsonp({ url, id:cb, callback:cb, globals:[cb], timeoutMs:8000,
        onResponse:() => recordHistorySourceSuccess('eastmoney'),
        onTransportFailure:() => recordHistorySourceTransportFailure('eastmoney'),
        parse:payload => {
            const rows = payload?.data?.klines;
            if (!Array.isArray(rows)) return [];
            return normalizeConfirmedHistoryData(rows.filter(row => typeof row === 'string').map(row => {
                const p = row.split(',');
                return { date:p[0], open:p[1], close:p[2], high:p[3], low:p[4], vol:p[5], amt:p[6] };
            }), id);
        }
    }).then(rows => rows || []);
}

let tencentKlineRequestSeq = 0;
function jsonpFetchTencentKline(id) {
    if (isHistorySourceCircuitOpen('tencent')) return Promise.resolve([]);
    const symbol = resolveTencentSymbol(id), cb = 'tx_kline_' + Date.now() + '_' + (++tencentKlineRequestSeq);
    const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${symbol},day,,,1000,qfq&_var=${cb}`;
    return requestJsonp({ url, id:cb, globals:[cb], timeoutMs:5000,
        onResponse:() => recordHistorySourceSuccess('tencent'),
        onTransportFailure:() => recordHistorySourceTransportFailure('tencent'),
        parse:() => {
            const payload = window[cb];
            if (payload?.code !== 0) return [];
            const rows = payload.data?.[symbol]?.qfqday || payload.data?.[symbol]?.day;
            if (!Array.isArray(rows)) return [];
            return normalizeConfirmedHistoryData(rows.filter(Array.isArray).map(p => ({
                date:p[0], open:p[1], close:p[2], high:p[3], low:p[4], vol:p[5], amt:p.length > 6 ? p[6] : 0
            })), id);
        }
    }).then(rows => rows || []);
}

function jsonpFetchSinaBz50Kline(id) {
    if (id !== 'bz50' || isHistorySourceCircuitOpen('sina')) return Promise.resolve([]);
    const cb = 'dg_sina_bz50_' + Date.now() + '_' + Math.random().toString(36).slice(2,6);
    const callbackExpr = encodeURIComponent(`window[${JSON.stringify(cb)}]`);
    const url = `https://quotes.sina.cn/cn/api/jsonp_v2.php/${callbackExpr}=/CN_MarketDataService.getKLineData?symbol=bj899050&scale=240&ma=no&datalen=1000`;
    return requestJsonp({ url, id:cb, globals:[cb], timeoutMs:5000,
        onResponse:() => recordHistorySourceSuccess('sina'),
        onTransportFailure:() => recordHistorySourceTransportFailure('sina'),
        parse:() => {
            const rows = window[cb];
            return Array.isArray(rows) ? normalizeConfirmedHistoryData(rows.filter(row => row && typeof row === 'object').map(row => ({
                date:row.day, open:row.open, close:row.close, high:row.high, low:row.low,
                vol:finiteMarketNumber(row.volume, 0) / 100, amt:0
            })), id) : [];
        }
    }).then(rows => rows || []);
}

function parseTencentRealtimeQuote(raw, id) {
    if (typeof raw !== 'string') return null;
    const fields = raw.split('~');
    const price = finiteMarketNumber(fields[3]);
    if (fields.length < 6 || !isValidPrice(price, id)) return null;
    const priceOrMissing = value => isValidPrice(value,id) ? Number(value) : null;
    const quoteTime = getTencentQuoteTimeInfo(fields);
    return { ...quoteTime, open:priceOrMissing(fields[5]), high:priceOrMissing(fields[33]), low:priceOrMissing(fields[34]),
        close:price, prevClose:finiteMarketNumber(fields[4],0), vol:finiteMarketNumber(fields[36],0),
        amt:normalizeTencentQuoteAmount(fields[37]) };
}

function getRealtimePriceJSONP(id) {
    const symbol = resolveTencentSymbol(id), varName = 'v_' + symbol;
    return requestJsonp({ url:`https://qt.gtimg.cn/q=${symbol}`, charset:'GBK', globals:[varName], timeoutMs:5000,
        parse:() => parseTencentRealtimeQuote(window[varName], id) });
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
    if (!ids?.length || (typeof canRequestMarketData === 'function' && !canRequestMarketData())) return Promise.resolve({});
    const requestToken = createRealtimeRequestToken('batch'), now = Date.now();
    const requestIds = [...new Set(ids)].filter(id => {
        const limiter = requestManager.limiters.get(id);
        if (limiter?.isFetching || now - Number(limiter?.lastCall || 0) < SYS_CONFIG.THROTTLE_MS) return false;
        requestManager.limiters.set(id, { ...(limiter || { lastCall:0 }), isFetching:requestToken });
        return true;
    });
    if (!requestIds.length) return Promise.resolve({});
    const release = () => { requestIds.forEach(id => {
        const limiter = requestManager.limiters.get(id);
        if (limiter?.isFetching === requestToken) requestManager.limiters.set(id, { ...limiter, isFetching:false });
    }); releaseRetiredSecurityData(); };
    const symbols = requestIds.map(resolveTencentSymbol);
    return requestJsonp({ url:`https://qt.gtimg.cn/q=${symbols.join(',')}`, charset:'GBK',
        globals:symbols.map(symbol => 'v_' + symbol), onCleanup:release, timeoutMs:5000,
        parse:() => {
            const results = {};
            symbols.forEach((symbol,index) => {
                const quote = parseTencentRealtimeQuote(window['v_' + symbol], requestIds[index]);
                if (quote) results[requestIds[index]] = quote;
            });
            return results;
        }
    }).then(results => results || {});
}

function setHistoryCheckState(id, status) {
    if (!state.historyChecks) state.historyChecks = {};
    state.historyChecks[id] = { status, checkedAt: Date.now() };
    if (id === state.id && typeof updateDataStatusRefreshBadge === 'function') updateDataStatusRefreshBadge();
}

function updateHistoryLoadingMessage(id, message) {
    document.querySelectorAll('[data-history-loading]').forEach(el => {
        if (el.dataset.historyLoading === id) el.textContent = message;
    });
}

const historySyncInFlight = new Map();
const historySyncQueue = [];
let activeHistoryRequests = 0;
function drainHistorySyncQueue() {
    while (activeHistoryRequests < SYS_CONFIG.SIDEBAR_SYNC_CONCURRENCY && historySyncQueue.length) {
        // 用户当前标的可以越过尚未启动的后台任务；进行中的请求不重复启动。
        const priority = historySyncQueue.findIndex(entry => entry.id === state.id);
        const entry = historySyncQueue.splice(priority < 0 ? 0 : priority, 1)[0];
        activeHistoryRequests++;
        Promise.resolve().then(() => {
            if (document.hidden || (entry.workspace !== state.tab && !(state.mode === state.tab && entry.id === state.id))) return getCachedData(entry.id);
            return performHistorySync(entry.id);
        }).then(entry.resolve, entry.reject).finally(() => {
            activeHistoryRequests--;
            drainHistorySyncQueue();
        });
    }
}
async function syncDataWithHistory(id) {
    if (historySyncInFlight.has(id)) return historySyncInFlight.get(id);
    const queued = new Promise((resolve, reject) => historySyncQueue.push({ id, workspace: state.tab, resolve, reject }));
    const task = queued.catch(error => {
        setHistoryCheckState(id, 'failed');
        throw error;
    }).finally(() => {
        if (historySyncInFlight.get(id) === task) historySyncInFlight.delete(id);
        releaseRetiredSecurityData();
    });
    historySyncInFlight.set(id, task);
    drainHistorySyncQueue();
    return task;
}

async function performHistorySync(id) {
    const token = createDataTaskToken(true);
    if (!isDataTaskCurrent(token)) return null;
    setHistoryCheckState(id, 'checking');
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
    let latestStale = null;
    for (const [index, source] of sources.entries()) {
        updateHistoryLoadingMessage(id, index ? `正在尝试备用来源（${index + 1}/${sources.length}）…` : '正在获取确认历史 K 线…');
        const data = normalizeConfirmedHistoryData(await source.load(id), id);
        if (!isDataTaskCurrent(token)) return null;
        if (!data || data.length < 30) continue;
        const lastDate = data[data.length - 1].date;
        if (isConfirmedSeriesFreshEnough(data)) {
            setConfirmedStatus(id, { source: source.name, status: 'fresh', lastDate, syncedAt: Date.now() });
            setHistoryCheckState(id, 'ready');
            return data;
        }
        // 接口可达不代表历史已补齐；继续尝试备源，并保留日期最新的陈旧结果。
        if (!latestStale || lastDate > latestStale.lastDate || (lastDate === latestStale.lastDate && data.length > latestStale.data.length)) {
            latestStale = { source: source.name, lastDate, data };
        }
    }
    if (latestStale) {
        setConfirmedStatus(id, { source: latestStale.source, status: 'stale', lastDate: latestStale.lastDate, syncedAt: Date.now() });
        setHistoryCheckState(id, 'stale');
        return latestStale.data;
    }
    setConfirmedStatus(id, { status: 'failed', syncedAt: Date.now() });
    setHistoryCheckState(id, 'failed');
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
    // 盘中确认历史只到上一交易日；实时价由独立报价链路更新。
    // 首次成功校验后，当前交易日内不再每 30 秒重复下载整份历史，收盘后日期变化会自动解除此条件。
    if (isMarketOpen() && lastDate === getLastTradingDate() && meta.lastSuccessAt) return true;
    if (meta.lastSuccessAt && now - meta.lastSuccessAt < SYS_CONFIG.HISTORY_FRESH_MS) return true;
    if (meta.lastAttemptAt && now - meta.lastAttemptAt < SYS_CONFIG.HISTORY_REFRESH_COOLDOWN_MS) return true;
    return false;
}

function mergeConfirmedHistory(id, cached, fresh) {
    if (!cached?.length) return fresh;
    if (!fresh?.length || fresh.at(-1).date < cached.at(-1).date) return cached;
    const byDate = new Map(cached.map(row => [row.date,row]));
    const overlap = fresh.filter(row => byDate.has(row.date));
    const sameBasis = overlap.length && overlap.every(row => ['open','high','low','close'].every(field => {
        const old = Number(byDate.get(row.date)[field]), next = Number(row[field]);
        return Number.isFinite(old) && Number.isFinite(next) && Math.abs(old-next) <= 1e-8 * Math.max(1,Math.abs(old),Math.abs(next));
    }));
    // 重叠区价格修订或无重叠时，整段采用新确认快照，不能拼出旧复权前缀。
    if (!sameBasis) return fresh;
    fresh.forEach(row => byDate.set(row.date,row));
    return normalizeConfirmedHistoryData([...byDate.values()],id);
}

async function syncDataIncremental(id) { 
    try { 
        const cachedData = await getCachedData(id);
        if(!cachedData || !cachedData.length) return await syncDataWithHistory(id); 
        if (shouldSkipHistoryRefresh(id, cachedData)) return cachedData;
        
        setHistoryRefreshMeta(id, { lastAttemptAt: Date.now(), lastDate: cachedData[cachedData.length - 1]?.date || '' });
        const fresh = await syncDataWithHistory(id); 
        if(!fresh || !fresh.length) return cachedData; 
        setHistoryRefreshMeta(id, { lastSuccessAt: Date.now(), lastDate: fresh[fresh.length - 1]?.date || '' });

        return mergeConfirmedHistory(id,cachedData,fresh);
    } catch(e) { return await getCachedData(id) || null; } 
}

const syncDataInFlight = new Map();

function clearSyncDataInFlight(id, task) {
    if (syncDataInFlight.get(id) === task) syncDataInFlight.delete(id);
    releaseRetiredSecurityData();
}

async function syncData(id) {
    if (!id) return null;
    if (syncDataInFlight.has(id)) return syncDataInFlight.get(id);
    const task = performSyncData(id).finally(() => clearSyncDataInFlight(id, task));
    syncDataInFlight.set(id, task);
    return task;
}

const confirmedDataInFlight = new Map();

function buildHistorySyncResult(id, rows, patch = {}) {
    const lastDate = rows?.at(-1)?.date || '';
    return {id,rows:rows?.length ? rows : null,lastDate,origin:'cache',requestStatus:'skipped',
        status:rows?.length ? (isConfirmedSeriesFreshEnough(rows) ? 'fresh' : 'stale') : 'failed',verified:false,...patch};
}
function syncConfirmedDataResult(id) {
    if (!id) return Promise.resolve(buildHistorySyncResult(id,null));
    if (confirmedDataInFlight.has(id)) return confirmedDataInFlight.get(id);
    const task = performConfirmedDataSync(id).finally(() => {
        if (confirmedDataInFlight.get(id) === task) confirmedDataInFlight.delete(id);
        releaseRetiredSecurityData();
    });
    confirmedDataInFlight.set(id,task);
    return task;
}
async function syncConfirmedData(id) { return (await syncConfirmedDataResult(id)).rows; }
async function syncDataResult(id, options = {}) {
    const token = createDataTaskToken(true);
    const result = await syncConfirmedDataResult(id);
    if (!options.historyOnly && isDataTaskCurrent(token)) await syncRealtimeForSeries(id,result.rows,token);
    return result;
}
async function performConfirmedDataSync(id) {
    const token = createDataTaskToken();
    const memory = Boolean(state.rawData[id]?.length);
    const cached = await getCachedData(id), hasEnough = cached?.length >= 30;
    const fallback = patch => buildHistorySyncResult(id,hasEnough ? cached : null,{origin:memory ? 'memory' : 'cache',...patch});
    if (!isDataTaskCurrent(token)) return fallback({requestStatus:'cancelled'});
    if (!canRequestMarketData()) {
        if (hasEnough && !state.liveBars?.[id]) tryApplyCachedLiveOverlay(id,cached);
        return fallback();
    }
    const networkToken = createDataTaskToken(true);
    if (hasEnough && shouldSkipHistoryRefresh(id,cached)) return fallback();
    setHistoryRefreshMeta(id,{lastAttemptAt:Date.now()});
    const fresh = await syncDataWithHistory(id);
    if (!isDataTaskCurrent(networkToken)) return fallback({requestStatus:'cancelled'});
    if (!fresh || fresh.length < 30) {
        setConfirmedStatus(id,{source:'cache',status:'failed',sourceLagging:false,lastDate:cached?.at(-1)?.date || '',syncedAt:Date.now()});
        return fallback({requestStatus:'failed'});
    }
    const rows = mergeConfirmedHistory(id,cached,fresh);
    const sourceLagging=Boolean(cached?.length && fresh.at(-1).date<cached.at(-1).date);
    setConfirmedStatus(id,{source:sourceLagging?'cache':state.confirmedStatus[id]?.source || 'network',
        status:isConfirmedSeriesFreshEnough(rows)?'fresh':'stale',lastDate:rows.at(-1).date,sourceLagging});
    const verified = isConfirmedSeriesFreshEnough(fresh) && fresh.at(-1).date >= (cached?.at(-1)?.date || '');
    if (verified) setHistoryRefreshMeta(id,{lastSuccessAt:Date.now(),lastAttemptAt:Date.now(),lastDate:rows.at(-1).date});
    if (getDataMutationMeta(cached,rows).mode !== 'unchanged') void dbSet(id,rows,networkToken);
    const quote = getQuoteBar(id);
    if (quote && !quote._isCachedLive && isMarketOpen()) applyRealtimeQuoteForSeries(id,rows,quote);
    else if (!isConfirmedSeriesFreshEnough(rows)) tryApplyCachedLiveOverlay(id,rows);
    return buildHistorySyncResult(id,rows,{origin:rows === cached ? (memory ? 'memory' : 'cache') : 'network',
        source:state.confirmedStatus[id]?.source || '',requestStatus:'success',verified});
}

async function performSyncData(id) {
    const data = await syncConfirmedData(id);
    return syncRealtimeForSeries(id, data);
}

async function syncRealtimeForSeries(id, data, token = createDataTaskToken(true)) {
    if (!data?.length || !isMarketOpen() || (typeof canRequestMarketData === 'function' && !canRequestMarketData())) return data;
    const rt = await requestManager.fetchRealtimeWithThrottle(id);
    if (!isDataTaskCurrent(token)) return data;
    const skipped = isRealtimeFetchSkipped(rt);
    if (rt && !skipped) applyRealtimeQuoteForSeries(id, data, rt);
    else if (!skipped) tryApplyCachedLiveOverlay(id, data);
    if (!skipped && !state.liveBars?.[id] && state.displayStatus?.[id]?.mode !== 'quote-only') {
        setDisplayStatus(id, { mode: 'confirmed', reason: '', quoteDate: '', quoteAt: 0, cachedAt: 0, cacheAgeMs: 0 });
    }
    return data;
}

const lastUpdateClicks = new Map();
async function handleUpdateData(forceFull = false) {
    const btn = document.getElementById('updateDataBtn');
    if (!btn || btn.disabled || !state.id) return;
    const id = state.id;
    const selectionSeq = globalSelectionSeq;
    const name = getIndexConfig(id)?.name || getActiveSecurityTarget()?.name || id;
    const workspace = state.tab;
    const isCurrentSelection = () => state.tab === workspace && state.mode === workspace && state.id === id && globalSelectionSeq === selectionSeq;
    if (!canRequestMarketData()) claimMarketRefreshLeadership({force:true});
    if (!canRequestMarketData()) return;
    const taskToken=createDataTaskToken(true);
    const now = Date.now(), lastClick = lastUpdateClicks.get(id) || 0;
    if (!forceFull && now - lastClick < SYS_CONFIG.UPDATE_COOLDOWN) {
        showToast(`请 ${Math.ceil((SYS_CONFIG.UPDATE_COOLDOWN - (now - lastClick)) / 1000)} 秒后再更新。`, 'info');
        return;
    }


    resetHistorySourceCircuits();
    btn.disabled = true;
    btn.innerHTML = SVG_ICONS.SPIN;
    btn.setAttribute?.('aria-busy', 'true');
    showToast(`正在更新 ${name}…`, 'info', 1800);
    try {
        // 手动更新明确请求历史源，不把底层的旧缓存回退当成更新成功。
        if (syncDataInFlight.has(id)) await syncDataInFlight.get(id);
        const previous = state.rawData[id];
        const previousConfirmed = state.confirmedStatus?.[id];
        const fresh = await syncDataWithHistory(id);
        if (!isDataTaskCurrent(taskToken)) return;
        if (!fresh?.length) {
            showToast(`${name} 更新失败，已保留原数据，可重新尝试。`, 'warn', 4500);
            return;
        }
        const previousDate = previous?.[previous.length - 1]?.date || '';
        if (previousDate > fresh[fresh.length - 1].date) {
            setConfirmedStatus(id, {
                source: previousConfirmed?.source || 'cache',
                status: isConfirmedSeriesFreshEnough(previous) ? 'fresh' : 'stale',
                lastDate: previousDate
            });
            setHistoryCheckState(id, 'stale');
            showToast(`${name} 行情源历史落后于现有数据，已保留至 ${previousDate}，可重新尝试。`, 'warn', 4500);
            return;
        }
        await dbSet(id,fresh,taskToken);
        if (!isDataTaskCurrent(taskToken)) return;
        setHistoryRefreshMeta(id, { lastSuccessAt: Date.now(), lastAttemptAt: Date.now(), lastDate: fresh[fresh.length - 1].date });
        setRawData(id, fresh);
        if (isMarketOpen()) {
            const quote = await requestManager.fetchRealtimeWithThrottle(id);
            if (!isDataTaskCurrent(taskToken)) return;
            if (quote && !isRealtimeFetchSkipped(quote)) applyRealtimeQuoteForSeries(id, fresh, quote);
        }
        // 排序期间不重建左栏，也不让中右先显示新数据；切换标的后取消本次界面提交。
        while (isCurrentSelection() && state.mode === 'stock' && typeof watchlistDragCode !== 'undefined' && watchlistDragCode) {
            await new Promise(resolve => setTimeout(resolve, 120));
        }
        // 返回结果只属于发起请求的标的；切换后只更新该标的缓存，不碰当前面板。
        if (isCurrentSelection()) {
            const leftTxn = beginRefreshTransaction('leftList', { source: 'manual-update', id });
            const rightTxn = beginRefreshTransaction('rightPanel', { source: 'manual-update', id });
            if (typeof renderActiveLeftListAfterDataApply === 'function') renderActiveLeftListAfterDataApply(leftTxn, { id, renderNow: true });
            const status = await applyActiveDataRefresh(id);
            // 异步绘制可能因切换或任务取消而跳过；只为仍有效的已应用结果提交时间。
            if (status !== 'no-data' && status !== 'skipped' && isCurrentSelection() && isDataTaskCurrent(taskToken)) {
                markRefreshTime(rightTxn, { path: status, id });
            }
        }
        const date = fresh[fresh.length - 1].date;
        const complete = isConfirmedSeriesFreshEnough(fresh);
        if (complete) lastUpdateClicks.set(id, Date.now());
        const unchanged = getDataMutationMeta(previous, fresh).mode === 'unchanged';
        const result = !complete ? `历史尚未补齐，当前确认至 ${date}。`
            : (unchanged ? `检查完成，确认历史无变化（${date}）。` : `已更新，确认历史至 ${date}。`);
        showToast(`${name} ${result}`, complete ? 'success' : 'warn', 4000);
    } catch (error) {
        setHistoryCheckState(id, 'failed');
        showToast(`${name} 更新失败，已保留可用数据，可重新尝试。`, 'warn', 4500);
    } finally {
        btn.disabled = false;
        btn.innerHTML = SVG_ICONS.UPDATE;
        btn.setAttribute?.('aria-busy', 'false');
    }
}

const KLINE_CACHE_VERSION = 2;
// 决策快照落盘：与 K 线缓存共用同一 objectStore，但用独立前缀，
// 既能被“重置本地数据”的 clear() 一并清掉，又能绕开 OHLCV 归一化。
const DECISION_CACHE_KEY_PREFIX = 'decision_cache::';
const NON_KLINE_CACHE_KEYS = new Set(['stock_cache', 'watchlist_list', DATA_GENERATION_RECORD_KEY]);
function isDecisionCacheKey(id) { return typeof id === 'string' && id.startsWith(DECISION_CACHE_KEY_PREFIX); }
function buildDecisionCacheKey(secid) { return `${DECISION_CACHE_KEY_PREFIX}${secid}`; }
function isKlineCacheKey(id) { return !NON_KLINE_CACHE_KEYS.has(id) && !isDecisionCacheKey(id); }
function buildPersistentCacheRecord(id, data, generation = dataTaskRuntime.generation) {
    return { id, data, generation, updated: Date.now(), ...(isKlineCacheKey(id) ? { klineCacheVersion: KLINE_CACHE_VERSION } : {}) };
}
function isUsablePersistentCacheRecord(id, record) {
    return !record || ((record.generation ?? 0) === dataTaskRuntime.generation && (!isKlineCacheKey(id) || record.klineCacheVersion === KLINE_CACHE_VERSION));
}

let DB = null;
const DB_NAME = 'QuantProDB_v515', DB_VER = 1, STORE = 'kline';
const DB_OPEN_TIMEOUT_MS = 3000;
const storageCapability = {
    status: 'pending',
    persistent: false,
    reason: '',
    checkedAt: 0
};
if (typeof window !== 'undefined') window.__DG_STORAGE__ = storageCapability;

function setStorageCapability(status, reason = '') {
    storageCapability.status = status;
    storageCapability.persistent = status === 'available';
    storageCapability.reason = String(reason || '');
    storageCapability.checkedAt = Date.now();
    if (typeof document !== 'undefined' && document.documentElement?.dataset) {
        document.documentElement.dataset.storageMode = storageCapability.persistent ? 'persistent' : 'memory';
        document.documentElement.dataset.storageStatus = status;
    }
    return storageCapability;
}

function disablePersistentStorage(reason, status = 'failed') {
    const current = DB;
    DB = null;
    try { current?.close?.(); } catch (error) {}
    return setStorageCapability(status, reason);
}

function openDB(options = {}) {
    const configuredTimeout = Number(options.timeoutMs);
    const timeoutMs = Number.isFinite(configuredTimeout) ? Math.max(1, configuredTimeout) : DB_OPEN_TIMEOUT_MS;
    return new Promise(resolve => {
        if (typeof indexedDB === 'undefined' || typeof indexedDB.open !== 'function') {
            resolve(disablePersistentStorage('当前浏览器不支持本地数据库', 'unavailable'));
            return;
        }

        let request = null;
        let settled = false;
        let blocked = false;
        let timer = 0;
        const finish = (status, reason = '', database = null) => {
            if (settled) {
                if (database && database !== DB) {
                    try { database.close?.(); } catch (error) {}
                }
                return;
            }
            settled = true;
            clearTimeout(timer);
            if (status === 'available' && database) {
                DB = database;
                DB.onversionchange = () => disablePersistentStorage('本地数据库版本已变化，请重新加载', 'blocked');
                resolve(setStorageCapability('available'));
                return;
            }
            resolve(disablePersistentStorage(reason, status));
        };

        try {
            request = indexedDB.open(DB_NAME, DB_VER);
        } catch (error) {
            finish('failed', error?.message || '本地数据库打开失败');
            return;
        }

        timer = setTimeout(() => {
            finish(blocked ? 'blocked' : 'failed', blocked ? '本地数据库正被其他页面占用' : '本地数据库打开超时');
        }, timeoutMs);
        request.onupgradeneeded = event => {
            try {
                const database = event.target.result;
                if (!database.objectStoreNames.contains(STORE)) database.createObjectStore(STORE, { keyPath: 'id' });
            } catch (error) {
                finish('failed', error?.message || '本地数据库升级失败');
            }
        };
        request.onsuccess = event => finish('available', '', event.target.result);
        request.onerror = () => finish('failed', request.error?.message || '本地数据库打开失败');
        request.onblocked = () => {
            blocked = true;
            finish('blocked', '本地数据库正被其他页面占用');
        };
    });
}

function dbGet(id) {
    return new Promise(resolve => {
        if (!DB) return resolve(null);
        try {
            const req = DB.transaction(STORE, 'readonly').objectStore(STORE).get(id);
            req.onsuccess = event => {
                const record = event.target.result;
                resolve(isUsablePersistentCacheRecord(id, record) ? record : null);
            };
            req.onerror = () => resolve(null);
        } catch (error) {
            disablePersistentStorage(error?.message || '本地缓存读取失败');
            resolve(null);
        }
    });
}

function dbSet(id, data, token = createDataTaskToken()) {
    return new Promise(resolve => {
        if (!DB || !isDataTaskCurrent(token)) return resolve(false);
        data = NON_KLINE_CACHE_KEYS.has(id) || isDecisionCacheKey(id) ? data : normalizeConfirmedHistoryData(data,id);
        try {
            const tx = DB.transaction(STORE,'readwrite'), store = tx.objectStore(STORE);
            let written = false;
            tx.oncomplete = () => resolve(written);
            tx.onerror = tx.onabort = () => { disablePersistentStorage(tx.error?.message || '本地缓存写入失败'); resolve(false); };
            const request = store.get(DATA_GENERATION_RECORD_KEY);
            request.onsuccess = event => {
                if (!isDataTaskCurrent(token) || getStoredDataGeneration(event.target.result) !== token.generation) return;
                store.put(buildPersistentCacheRecord(id,data,token.generation)); written = true;
            };
        } catch (error) { disablePersistentStorage(error?.message || '本地缓存写入失败'); resolve(false); }
    });
}

// 每项自选操作都在同一读写事务中基于最新列表执行，避免多页面整表覆盖。
function applyStoredWatchlistMutation(list, operation = { type:'normalize' }) {
    const rows = Array.isArray(list) ? list.map(normalizeSecurityTarget) : [];
    if (operation.type === 'upsert') {
        const target = normalizeSecurityTarget(operation.target);
        const index = rows.findIndex(row => row.code === target.code);
        if (index >= 0) rows[index] = { ...rows[index], ...target };
        else {
            if (rows.length >= SYS_CONFIG.WATCHLIST_LIMIT) throw new Error(`最多只能添加 ${SYS_CONFIG.WATCHLIST_LIMIT} 只自选股。`);
            rows.push(target);
        }
    } else if (operation.type === 'remove') {
        return rows.filter(row => row.code !== operation.code);
    } else if (operation.type === 'move') {
        const index = rows.findIndex(row => row.code === operation.sourceCode);
        if (index < 0 || !rows.some(row => row.code === operation.targetCode)) return rows;
        const [moved] = rows.splice(index,1);
        const target = rows.findIndex(row => row.code === operation.targetCode);
        rows.splice(target + (operation.insertAfter ? 1 : 0),0,moved);
    }
    return rows;
}

function mutateStoredWatchlist(operation, token = createWatchlistMutationToken()) {
    if (!DB || !isDataTaskCurrent(token)) return Promise.resolve(null);
    return new Promise((resolve,reject) => {
        let tx, result, settled = false, semanticError = null;
        const fail = () => {
            if (settled) return;
            settled = true;
            if (semanticError) reject(semanticError);
            else { disablePersistentStorage(tx?.error?.message || '自选保存失败，本次仅保留在当前页面'); resolve(null); }
        };
        try {
            tx = DB.transaction(STORE,'readwrite');
            tx.onabort = tx.onerror = fail;
            tx.oncomplete = () => { if (!settled) { settled = true; resolve(result); } };
            const store = tx.objectStore(STORE), generationRequest = store.get(DATA_GENERATION_RECORD_KEY);
            generationRequest.onerror = fail;
            generationRequest.onsuccess = generationEvent => {
                if (!isDataTaskCurrent(token) || getStoredDataGeneration(generationEvent.target.result) !== token.generation) return;
                const request = store.get('watchlist_list');
                request.onerror = fail;
                request.onsuccess = event => {
                try {
                    result = applyStoredWatchlistMutation(event.target.result?.data || [],operation);
                    if (isDataTaskCurrent(token)) store.put(buildPersistentCacheRecord('watchlist_list',result,token.generation));
                } catch (error) {
                    semanticError = error;
                    try { tx.abort(); } catch (abortError) {}
                    fail();
                }
                };
            };
        } catch (error) { fail(); }
    });
}

async function getCachedData(id) {
    const memory = state.rawData[id];
    if (memory?.length) return memory;
    const c = await dbGet(id);
    const data = (c && c.data) ? normalizeConfirmedHistoryData(c.data, id) : null;
    if (data?.length && Number(c?.updated) > 0) {
        // 页面重开后恢复历史刷新元数据，避免盘中重复下载整份确认历史。
        setHistoryRefreshMeta(id, {
            lastSuccessAt: Math.max(0, Number(c.updated)),
            lastAttemptAt: Math.max(0, Number(c.updated)),
            lastDate: data[data.length - 1]?.date || ''
        });
    }
    return data;
}

function getRenderedSidebarDate() {
    var cPriceEl = document.getElementById('cardPrice');
    if (!cPriceEl) return '';
    var headerEl = cPriceEl.querySelector('.header-meta-row .mono');
    return headerEl ? headerEl.textContent.trim().split('|')[0].trim() : '';
}

async function applyActiveDataRefresh(id) {
    if (id !== state.id || !['index','stock'].includes(state.mode)) return 'skipped';
    const rd=getActiveData();if(!rd?.length)return 'no-data';
    const oldDate=getRenderedSidebarDate(),latestDate=rd.at(-1).date;
    const frozen=state.isFrozen;
    if (!frozen) {setLockIdx(rd.length-1);resetViewportToLatest(rd);}
    const ok=await requestCurrentCalculationRender({isCurrent:()=>id===state.id,
        beforeRender:renderMASelector,interactive:oldDate===latestDate});
    return !ok ? 'skipped' : frozen ? 'frozen-redraw' : oldDate===latestDate ? 'same-day-light' : 'full-redraw';
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
        requestAnimationFrame(async () => {
            if (applyId !== state.id || !['index', 'stock'].includes(state.mode)) {
                PERF.end(perfTrace, { status: 'skipped' });
                return;
            }
            if (typeof isChartInteractionActive === 'function' && isChartInteractionActive()) {
                cachedFetchRefreshApplyTimer = window.setTimeout(() => {
                    cachedFetchRefreshApplyTimer = 0;
                    if (applyId !== state.id || !['index', 'stock'].includes(state.mode)) return;
                    scheduleCachedFetchRefreshApply(applyId);
                }, 120);
                PERF.end(perfTrace, { status: 'deferred-interaction' });
                return;
            }
            const rightTxn = beginRefreshTransaction('rightPanel', { source: 'cached-fetch-refresh-apply', id: applyId });
            const status = await applyActiveDataRefresh(applyId);
            if (status === 'no-data' || status === 'skipped') {
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
    if (dataTaskRuntime.resetPromise) return dataTaskRuntime.resetPromise;
    if (!DB) throw new Error('本地存储不可用，无法彻底重置；原数据已保留，请恢复存储后重试。');
    const wasStarted = typeof refreshSchedulerRuntime !== 'undefined' && Boolean(window.__DG_REFRESH_SCHEDULERS_STARTED__);
    dataTaskRuntime.resetting = true;
    if (typeof stopRefreshSchedulers === 'function') stopRefreshSchedulers('reset');
    cancelDataTasks('reset');
    const task = (async () => {
        try {
            const generation = await new Promise((resolve,reject) => {
                const tx = DB.transaction(STORE,'readwrite'), store = tx.objectStore(STORE);
                let next = 0;
                tx.oncomplete = () => resolve(next);
                tx.onerror = tx.onabort = () => reject(tx.error || new Error('本地数据重置未完成，请重试。'));
                const request = store.get(DATA_GENERATION_RECORD_KEY);
                request.onsuccess = event => {
                    next = getStoredDataGeneration(event.target.result) + 1;
                    store.clear(); store.put({id:DATA_GENERATION_RECORD_KEY,data:next});
                };
                request.onerror = () => reject(request.error || new Error('无法读取数据代次，原数据已保留。'));
            });
            dataTaskRuntime.generation = generation;
            clearSessionDataAfterReset();
            for (const key of [SYS_CONFIG.LIVE_OVERLAY_CACHE_KEY,'dg_live_overlay_cache_v2',SECTOR_TREND_CONFIG.CACHE_KEY,
                EXTERNAL_LEAD_STRIP_CONFIG.CACHE_KEY,...SECTOR_TREND_CONFIG.LEGACY_CACHE_KEYS,'quant_strategy','quant_strategy_generation']) {
                try { localStorage.removeItem(key); } catch (error) {}
            }
            try { localStorage.setItem(DATA_RESET_NOTIFICATION_KEY,JSON.stringify({generation,owner:PAGE_SESSION_ID,at:Date.now()})); } catch (error) {}
            location.reload();
        } catch (error) {
            dataTaskRuntime.resetting = false;
            if (typeof loadWatchlist==='function') {await loadWatchlist();if(typeof renderWatchlist==='function')renderWatchlist();}
            if (wasStarted) { initMarketRefreshLeadership(); startRefreshSchedulers(); requestVisibleWorkspaceRefresh(); }
            throw error;
        } finally { dataTaskRuntime.resetPromise = null; }
    })();
    dataTaskRuntime.resetPromise = task;
    return task;
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

const cachedFetchInFlight = new Map();

function getCachedFetchKey(id) {
    return `${id}:${globalSelectionSeq}:${state.tab}:${state.mode}`;
}

function clearCachedFetchInFlight(key, task) {
    if (cachedFetchInFlight.get(key) === task) cachedFetchInFlight.delete(key);
    releaseRetiredSecurityData();
}

async function cachedFetch(id, options = {}) {
    const key = getCachedFetchKey(id);
    if (cachedFetchInFlight.has(key)) return cachedFetchInFlight.get(key);
    const task = performCachedFetch(id, options).finally(() => clearCachedFetchInFlight(key, task));
    cachedFetchInFlight.set(key, task);
    return task;
}

async function performCachedFetch(id, options = {}) {
    const perfTrace = PERF.start('cachedFetch', { id, activeId: state.id, mode: state.mode });
    const taskToken = createDataTaskToken();
    const selectionSeq = globalSelectionSeq;
    const workspace = state.tab;
    const mode = state.mode;
    const isActiveFetch = () => isDataTaskCurrent(taskToken) && id === state.id && workspace === state.tab && mode === state.mode && selectionSeq === globalSelectionSeq;
    const memory = state.rawData[id];
    const cached = memory?.length ? memory : await getCachedData(id);
    PERF.mark(perfTrace, memory?.length ? 'memory' : 'dbGet');
    const applySelection = async (data, source) => {
        if (!isActiveFetch()) return;
        if (state.rawData[id] !== data) setRawData(id, data);
        tryApplyCachedLiveOverlay(id, state.rawData[id]);
        const quote = getQuoteBar(id);
        if (quote && !quote._isCachedLive && isMarketOpen()) applyRealtimeQuoteForSeries(id, state.rawData[id], quote);
        const rd = getActiveData();
        PERF.mark(perfTrace, 'active-data', { source, points: rd?.length || 0 });
        setLockIdx(rd?.length ? rd.length - 1 : -1);
        resetViewportToLatest(rd);
        if (!await ensureCurrentCalculation({isCurrent:isActiveFetch}) || !isActiveFetch()) return;
        PERF.mark(perfTrace, 'indicators');
        hideLoading();
        renderMASelector();
        const leftTxn = beginRefreshTransaction('leftList', { source: `cachedFetch-${source}`, id });
        const rightTxn = beginRefreshTransaction('rightPanel', { source: `cachedFetch-${source}`, id });
        if (typeof renderActiveLeftListAfterDataApply === 'function') renderActiveLeftListAfterDataApply(leftTxn, { id });
        PERF.mark(perfTrace, 'left-list');
        requestAnimationFrame(() => {
            if (!isActiveFetch()) return;
            // 周期/策略是展示偏好，不是历史请求的身份；绘制读取此刻的偏好。
            draw();
            safeUpdateSidebar();
            state.renderedSelectionId = id;
            markRefreshTime(rightTxn, { path: source === 'cache' ? 'cache-first' : (source === 'memory' ? 'restore-memory-chart' : 'apply-fresh'), id });
        });
        PERF.mark(perfTrace, 'schedule-draw');
    };
    const startRefresh = async () => {
        if (options.beforeNetwork && !await options.beforeNetwork()) return;
        if (isActiveFetch()) await scheduleCachedFetchRefresh(id);
    };
    if (cached?.length && isActiveFetch()) {
        const hasChart = !!(state.charts && Object.values(state.charts).some(Boolean));
        if (!hasChart || options.forceRender || (state.renderedSelectionId && state.renderedSelectionId !== id)) await applySelection(cached,memory?.length ? 'memory' : 'cache');
        PERF.end(perfTrace, { status: memory?.length ? 'active-memory-render' : 'cache-first', firstLoad: false });
        void startRefresh().catch(error => console.error('[DailyGlance] background refresh failed', error));
        return;
    }
    if (!isActiveFetch() || (options.beforeNetwork && !await options.beforeNetwork()) || !isActiveFetch()) {
        PERF.end(perfTrace, { status: 'superseded' });
        return;
    }
    const fresh = await syncConfirmedData(id);
    PERF.mark(perfTrace, 'confirmed-history', { points: fresh?.length || 0 });
    if (!fresh?.length) {
        if (isActiveFetch()) {
            clearCharts('error');
            renderActiveSelectionStatus('unavailable');
        }
        PERF.end(perfTrace, { status: 'no-fresh-data' });
        return;
    }
    // 同会话失效选择可保留行情；重置或生命周期取消则不能回写。
    if (!isDataTaskCurrent(taskToken)) return;
    setRawData(id, fresh);
    if (isActiveFetch()) {
        await applySelection(fresh,'fresh');
        if (!isActiveFetch()) return;
        const oldVisible = getActiveData();
        void syncRealtimeForSeries(id, fresh).then(() => {
            if (isActiveFetch() && getDataMutationMeta(oldVisible, getActiveData()).mode !== 'unchanged') scheduleCachedFetchRefreshApply(id);
        }).catch(error => console.error('[DailyGlance] quote refresh failed', error));
    }
    PERF.end(perfTrace, { status: 'initial', firstLoad: true });
}

function scheduleCachedFetchRefresh(id) {
    if (cachedFetchRefreshJobs.has(id)) return cachedFetchRefreshJobs.get(id);
    const job = (async () => {
        const perfTrace = PERF.start('cachedFetchRefresh', { id, activeId: state.id, mode: state.mode });
        const taskToken = createDataTaskToken(true);
        const oldVisible = id === state.id ? getActiveData() : null;
        const fresh = await syncData(id);
        if (!isDataTaskCurrent(taskToken)) return;
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
        // 当前标的的后台历史补数只更新内存/右侧面板；左侧列表由批量刷新协调器统一提交，
        // 避免单个标的先完成时把整张列表提前刷新成新旧混合状态。
        PERF.mark(perfTrace, 'defer-left-list-commit', { id });
        PERF.end(perfTrace, { status: 'updated' });
    })().finally(() => {
        if (cachedFetchRefreshJobs.get(id)===job) cachedFetchRefreshJobs.delete(id);
    });
    cachedFetchRefreshJobs.set(id, job);
    return job;
}

async function preloadCacheOnly(options = {}) {
    const taskToken = createDataTaskToken();
    const symbols = options.ids ? [...options.ids] : [...INDEX_IDS];
    if (!options.ids && state.watchlist && state.watchlist.length > 0) {
        const watchlistSymbols = state.watchlist
            .map(stock => normalizeSecurityTarget(stock))
            .filter(target => isSupportedWatchlistSecurity(target))
            .map(target => target.secid);
        symbols.push(...watchlistSymbols.filter(id => !symbols.includes(id)));
    }
    for (let i = 0; i < symbols.length; i++) {
        if (options.isCurrent && !options.isCurrent()) break;
        const id = symbols[i];
        try {
            const c = state.rawData[id]?.length ? null : await dbGet(id);
            const cachedData = normalizeConfirmedHistoryData(c?.data, id);
            if (!isDataTaskCurrent(taskToken)) return;
            if (!state.rawData[id]?.length && cachedData && cachedData.length >= 30 && isValidPrice(cachedData[cachedData.length - 1].close, id)) {
                setRawData(id, cachedData);
            }
        } catch(e) {}
        // 指数缓存先于自选股读完：此时核心宽基已就绪，让调用方立即同步左右两侧，
        // 不必等自选股缓存全部读完。
        if (i === INDEX_IDS.length - 1 && typeof options.onIndexesLoaded === 'function') {
            try { options.onIndexesLoaded(); } catch (error) {}
        }
    }
}

// 决策快照持久化：把内存里已算好的策略决策落盘，供下次冷启动直接复用，
// 省掉自选股多时“重算风暴”。写入的 payload 由 03-decision.js 组装并盖上版本戳，
// 读取水合时逐一校验版本，任一不符即丢弃、照旧重算（正确性优先于命中率）。
let _lastPersistedDecisionCacheKey = new Map();
function persistDerivedDecisionCache(secid, payload) {
    if (!DB || !secid || !payload || !payload.cacheKey) return;
    // 同一标的 cacheKey 未变则不重复写盘，避免图表反复重绘触发写放大。
    if (_lastPersistedDecisionCacheKey.get(secid) === payload.cacheKey) return;
    _lastPersistedDecisionCacheKey.set(secid, payload.cacheKey);
    try {
        dbSet(buildDecisionCacheKey(secid), payload);
    } catch (error) {}
}

async function hydrateWatchlistDecisionCache(options = {}) {
    const taskToken=createDataTaskToken();
    if (!DB || typeof derivedIndicatorCache === 'undefined') return 0;
    if (typeof isReusableDecisionCacheRecord !== 'function') return 0;
    const targets = (typeof getSupportedWatchlistTargets === 'function')
        ? getSupportedWatchlistTargets()
        : (state.watchlist || []).map(stock => normalizeSecurityTarget(stock)).filter(target => isSupportedWatchlistSecurity(target));
    let hydrated = 0;
    for (const target of targets) {
        if (options.isCurrent && !options.isCurrent()) break;
        const secid = target.secid;
        if (!secid) continue;
        try {
            const record = await dbGet(buildDecisionCacheKey(secid));
            if (!isDataTaskCurrent(taskToken) || (options.isCurrent && !options.isCurrent())) break;
            const payload = record && record.data;
            if (!isReusableDecisionCacheRecord(payload)) continue;
            // 已在内存（本会话已算过）则不覆盖。
            if (derivedIndicatorCache.has(payload.cacheKey)) continue;
            if (!putDerivedIndicatorCache(payload.cacheKey, {
                decisionGovernanceVersion: payload.decisionGovernanceVersion,
                indicators: payload.indicators,
                rows: payload.rows
            })) continue;
            _lastPersistedDecisionCacheKey.set(secid, payload.cacheKey);
            hydrated++;
        } catch (error) {}
    }
    return hydrated;
}

function shouldEnsureMarketTemperatureData(id) {
    const data = state.rawData?.[id];
    if (!data || data.length < 60) return true;
    return !isConfirmedSeriesFreshEnough(data);
}

async function ensureMarketTemperatureData(options = {}) {
    const taskToken=createDataTaskToken();
    const callerCurrent=options.isCurrent || (()=>true);
    const isCurrent=()=>isDataTaskCurrent(taskToken) && callerCurrent();
    const ids = options.ids || INDEX_IDS;
    if (!isCurrent()) return;
    const owner = {};
    state.indexHydrationOwner = owner;
    state.indexHydrationPending = true;
    if (state.mode === 'index' && typeof renderIndexList === 'function') renderIndexList();
    try {
        await pLimit(ids.filter(shouldEnsureMarketTemperatureData), SYS_CONFIG.SIDEBAR_SYNC_CONCURRENCY, async id => {
            if (!isCurrent()) return;
            const data = await syncConfirmedData(id);
            if (isCurrent() && data && data.length >= 30) setRawData(id,data);
        });
    } finally {
        if (state.indexHydrationOwner === owner) state.indexHydrationPending = false;
        if (isCurrent() && state.mode === 'index' && typeof renderIndexList === 'function') {
            renderIndexList();
            const appliedCount = INDEX_IDS.filter(id => isConfirmedSeriesFreshEnough(state.rawData[id])).length;
            if (appliedCount) {
                const txn = beginRefreshTransaction('leftList', { source: 'startup-history-batch', area: 'index-list' });
                markLeftListRefreshForActiveTab(txn, {
                    area: 'index-list', expectedCount: INDEX_IDS.length, appliedCount,
                    status: appliedCount === INDEX_IDS.length ? 'full' : 'partial'
                });
            }
        }
    }
    if (!isCurrent()) return;
    const activeData = getActiveData();
    if ((state.mode === 'index' || state.mode === 'stock') && activeData && activeData.length) {
        if (state.pendingIndicatorMutation) scheduleCachedFetchRefreshApply(state.id);
        else safeUpdateSidebar();
    }
}
