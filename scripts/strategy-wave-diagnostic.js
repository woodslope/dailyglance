#!/usr/bin/env node

// 波段三趋势治理的按需诊断入口：只回放生产决策链，不改变任何策略参数或阈值。
// 默认使用固定小工作组，便于按几只个股逐轮沟通调整；报告写入 .local/strategy-reports/。
//
//   node scripts/strategy-wave-diagnostic.js
//   node scripts/strategy-wave-diagnostic.js --symbols 600519,002594
//
// 报告只回答“买卖点位置、三趋势覆盖、防守距离、离场成因”四类问题，不做收益优势主张。
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const {
    loadCacheSymbols,
    createProductionContext,
    prepareSymbolContext,
    START_INDEX
} = require('./strategy-formal-baseline');

const ROOT = path.resolve(__dirname, '..');
const REPORT_DIR = path.join(ROOT, '.local', 'strategy-reports');
const OUT = path.join(REPORT_DIR, 'strategy-wave-diagnostic.md');
const STRATEGY_NAME = '波段抄底型';
const DEFAULT_WORKING_GROUP = ['600519', '002594', '601398', '300750'];
const SHORT_TRADE_BARS = 2;
const REGIME_LABELS = { down: '下跌', range: '横盘', up: '上涨', transition: '过渡', unknown: '未知' };

const equalsArg = process.argv.find(arg => arg.startsWith('--symbols='));
const flagIndex = process.argv.indexOf('--symbols');
const rawSymbols = equalsArg
    ? equalsArg.slice('--symbols='.length)
    : (flagIndex >= 0 ? process.argv[flagIndex + 1] || '' : '');
const requestedIds = rawSymbols
    ? rawSymbols.split(',').map(item => item.trim()).filter(Boolean)
    : DEFAULT_WORKING_GROUP;

// 通用事件出口：--events 后按 status 或 eventType 过滤导出任意决策日，避免每次追因都新写一次性脚本。
//   node scripts/strategy-wave-diagnostic.js --events                      列出全部风险事件日
//   node scripts/strategy-wave-diagnostic.js --events fresh_entry_hard_break   只看某类事件
//   node scripts/strategy-wave-diagnostic.js --events pending_hard_break --symbols 600519
function readArgValue(name) {
    const equals = process.argv.find(arg => arg.startsWith(`${name}=`));
    if (equals) return equals.slice(name.length + 1);
    const flag = process.argv.indexOf(name);
    return flag >= 0 ? (process.argv[flag + 1] && !process.argv[flag + 1].startsWith('--') ? process.argv[flag + 1] : '') : null;
}
const eventsArg = readArgValue('--events');
const EVENTS_MODE = eventsArg !== null;
const eventFilter = (eventsArg || '').trim();

function pct(value, digits = 2) {
    return Number.isFinite(value) ? `${(value * 100).toFixed(digits)}%` : 'n/a';
}

function share(count, total, digits = 1) {
    return total ? `${(count / total * 100).toFixed(digits)}%` : 'n/a';
}

function quantile(values, ratio) {
    if (!values.length) return NaN;
    const sorted = [...values].sort((left, right) => left - right);
    return sorted[Math.floor((sorted.length - 1) * ratio)];
}

function mean(values) {
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : NaN;
}

// 回放生产链后额外读出三趋势环境、冻结防守位和波峰上下文，仅用于观察。
function replaySymbol(context, symbol, prepared) {
    context.__symbol = {
        id: symbol.id,
        mode: symbol.mode,
        rows: symbol.rows.map(row => ({ ...row })),
        strategy: STRATEGY_NAME,
        rawSignals: prepared.rawSignals,
        indicators: prepared.indicators
    };
    return JSON.parse(vm.runInContext(`
        (function() {
            if (!setActiveStrategy(__symbol.strategy)) throw new Error('unknown formal strategy: ' + __symbol.strategy);
            state.strategy = __symbol.strategy;
            state.mode = __symbol.mode;
            state.id = __symbol.id;
            state.stockId = __symbol.mode === 'stock' ? __symbol.id : null;
            state.period = 'daily';
            state.rawData[__symbol.id] = __symbol.rows.map((row, idx) => ({
                ...row,
                _signals: [...(__symbol.rawSignals[idx] || [])],
                _signalVersion: SIGNAL_VERSION
            }));
            state.weeklyData[__symbol.id] = convertDailyToWeekly(state.rawData[__symbol.id]);
            state.indicators = __symbol.indicators;
            state.indicatorKey = '';
            state.pendingIndicatorMutation = { mode: 'strategy-only', startIdx: 0 };
            updateAllIndicators();
            const full = state.rawData[__symbol.id];
            const policy = STRATEGY.waveRegimePolicy;
            return JSON.stringify({
                rows: full.map((row, idx) => {
                    const decision = row._decision || {};
                    const wave = decision.waveContext || {};
                    const raw = getWaveRawRegimeAt(idx, full, state.indicators, policy);
                    const rejection = decision.waveRejectionProtection || null;
                    return {
                        date: row.date, high: row.high, low: row.low, close: row.close,
                        position: decision.position || 0, prevAdv: decision.prevAdv ?? null,
                        bsMark: decision.bsMark || null, action: decision.simpleAction || '',
                        regime: wave.regime || 'unknown', rawRegime: raw.key,
                        boxValid: !!(wave.box && wave.box.valid),
                        boxSupport: Number.isFinite(Number(wave.boxSupport)) ? Number(wave.boxSupport) : null,
                        boxPressure: Number.isFinite(Number(wave.boxPressure)) ? Number(wave.boxPressure) : null,
                        exitSignalsToday: (row._signals || []).filter(s => (STRATEGY.exitSignals || []).includes(s)),
                        consecutiveDays: wave.consecutiveDays ?? null, requiredDays: wave.requiredDays ?? null,
                        hardDefense: wave.frozenHardDefense ?? null, supportSource: wave.supportSource || '',
                        peakConfirmed: !!(decision.wavePeak && decision.wavePeak.confirmed),
                        event: wave.mainEvent || '',
                        // 通用事件出口：读出决策链的完整风险事件对象与仓位驱动，供 --events 过滤追因。
                        rejectionStatus: rejection?.status || 'none',
                        rejectionEventType: rejection?.eventType || '',
                        entrySignalLow: rejection?.entrySignalLow ?? null,
                        entryAge: rejection?.entryAge ?? null,
                        recoveryCloseLevel: Number.isFinite(Number(rejection?.recoveryCloseLevel)) ? Number(rejection.recoveryCloseLevel) : null,
                        positionDriver: decision.positionDriver || ''
                    };
                })
            });
        })()
    `, context)).rows;
}

function classifyTransitionCause(row) {
    if (row.rawRegime === 'flat') {
        return row.boxValid
            ? `走平已确认箱体但确认天数不足（${row.consecutiveDays}/${row.requiredDays}）`
            : '走平但箱体无效，归过渡';
    }
    if (row.rawRegime === 'transition') return '斜率越过阈值但均线或收盘条件未同时成立';
    return `${REGIME_LABELS[row.rawRegime] || row.rawRegime}候选确认天数不足（${row.consecutiveDays}/${row.requiredDays}）`;
}

function classifyExit(event) {
    const text = String(event || '');
    if (text.includes('冻结硬防守位')) return '跌破冻结硬防守位';
    if (text.includes('数据/硬风险')) return '数据/硬风险或结构硬失效';
    if (text.includes('上涨环境普通转弱')) return '上涨环境分层退出';
    if (text.includes('箱体上沿')) return '箱体上沿失败';
    if (text.includes('既有持仓')) return '既有持仓降档';
    return '基础链路离场（无治理专属事件）';
}

// 每段交易的位置质量：买点相对段内最低点的溢价，卖点相对段内最高点的折让。
function collectTrades(rows) {
    const trades = [];
    let open = null;
    for (let idx = START_INDEX; idx < rows.length; idx++) {
        const row = rows[idx];
        if (row.bsMark === 'B') {
            open = { startIdx: idx, startDate: row.date, entry: row.close, entryRegime: row.regime, maxPosition: row.position };
            continue;
        }
        if (!open) continue;
        open.maxPosition = Math.max(open.maxPosition, row.position);
        if (row.bsMark !== 'S') continue;
        const segment = rows.slice(open.startIdx, idx + 1);
        const segmentLow = Math.min(...segment.map(item => item.low));
        const segmentHigh = Math.max(...segment.map(item => item.high));
        // 离场日收盘在箱体内的位置：0=下沿、1=上沿。用于判断非下跌环境是否在“下沿附近”被洗掉。
        const exitBoxLocation = Number.isFinite(row.boxSupport) && Number.isFinite(row.boxPressure) && row.boxPressure > row.boxSupport
            ? (row.close - row.boxSupport) / (row.boxPressure - row.boxSupport)
            : null;
        trades.push({
            ...open,
            endIdx: idx,
            endDate: row.date, exit: row.close, bars: idx - open.startIdx,
            ret: (row.close - open.entry) / open.entry,
            entryPremium: segmentLow > 0 ? (open.entry - segmentLow) / segmentLow : NaN,
            exitDiscount: segmentHigh > 0 ? (segmentHigh - row.close) / segmentHigh : NaN,
            exitRegime: row.regime, exitReason: classifyExit(row.event), exitAction: row.action,
            exitBoxLocation, exitSignals: row.exitSignalsToday || [], exitHadBox: Number.isFinite(exitBoxLocation)
        });
        open = null;
    }
    return trades;
}

function analyzeSymbol(symbol, rows) {
    const window = rows.slice(START_INDEX);
    const trades = collectTrades(rows);
    const regimeDays = {};
    const regimeHeldDays = {};
    const transitionCauses = {};
    const entryGaps = [];
    const ratchetGaps = [];
    // 按建仓环境切分冻结硬防守位距离与来源，用于观察非下跌环境防守位是否偏松。
    const entryGapsByRegime = {};
    const entrySourceByRegime = {};
    let peakHeldDays = 0;
    let peakReducedDays = 0;

    for (const row of window) {
        regimeDays[row.regime] = (regimeDays[row.regime] || 0) + 1;
        if (row.position > 0) regimeHeldDays[row.regime] = (regimeHeldDays[row.regime] || 0) + 1;
        if (row.regime === 'transition') {
            const cause = classifyTransitionCause(row);
            transitionCauses[cause] = (transitionCauses[cause] || 0) + 1;
        }
        if (row.peakConfirmed && row.prevAdv > 0) {
            peakHeldDays += 1;
            if (row.position < row.prevAdv) peakReducedDays += 1;
        }
        if (row.position > 0 && Number.isFinite(row.hardDefense) && row.close > 0) {
            const gap = (row.close - row.hardDefense) / row.close;
            if (row.prevAdv === 0) {
                entryGaps.push(gap);
                (entryGapsByRegime[row.regime] = entryGapsByRegime[row.regime] || []).push(gap);
                const source = row.supportSource || '(未知来源)';
                entrySourceByRegime[row.regime] = entrySourceByRegime[row.regime] || {};
                entrySourceByRegime[row.regime][source] = (entrySourceByRegime[row.regime][source] || 0) + 1;
            } else if (row.supportSource === 'confirmed-pivot-ratchet') ratchetGaps.push(gap);
        }
    }

    const exitReasons = {};
    const entryRegimes = {};
    const maxPositions = {};
    // 按离场环境切分离场成因，用于观察非下跌环境到底靠什么卖出（是否箱体上沿 vs MACD死叉/硬防守）。
    const exitReasonsByRegime = {};
    for (const trade of trades) {
        exitReasons[trade.exitReason] = (exitReasons[trade.exitReason] || 0) + 1;
        entryRegimes[trade.entryRegime] = (entryRegimes[trade.entryRegime] || 0) + 1;
        maxPositions[trade.maxPosition] = (maxPositions[trade.maxPosition] || 0) + 1;
        exitReasonsByRegime[trade.exitRegime] = exitReasonsByRegime[trade.exitRegime] || {};
        exitReasonsByRegime[trade.exitRegime][trade.exitReason] = (exitReasonsByRegime[trade.exitRegime][trade.exitReason] || 0) + 1;
    }

    // 信号硬失效事件观察：区分“保留30%观察” vs “清仓归零”，并对清仓的检查其后是否很快收复失效位。
    // recoveryCloseLevel 是决策链记录的“需收复价位”（失效位或风险日高点）。
    const RECOVER_BARS = 5;
    // 追踪每个“新信号硬失效事件”的完整结局：当天是保留30%还是清仓；
    // 若当天保留30%，其后是否很快（≤5日）被清仓（多为锁定期被结构硬失效接管）；被清后是否很快收复。
    const signalInvalidation = {
        events: 0, heldDay1: 0, clearedDay1: 0,
        heldThenClearedSoon: 0, heldThenClearedRecovered: 0,
        clearedByTrueBreak: 0, clearedByCollateral: 0, clearedByOther: 0,
        clearedRecovered: 0, clearedRecoveredDays: []
    };
    for (let i = START_INDEX; i < rows.length; i++) {
        const row = rows[i];
        if (row.rejectionEventType !== 'signal_hard_invalidation') continue;
        const prev = rows[i - 1];
        const isFreshEventDay = !prev || prev.rejectionEventType !== 'signal_hard_invalidation';
        if (!isFreshEventDay) continue;
        signalInvalidation.events += 1;
        const target = Number.isFinite(row.recoveryCloseLevel) ? row.recoveryCloseLevel : null;
        const recoveredWithin = () => {
            if (target == null) return -1;
            for (let j = i + 1; j <= Math.min(rows.length - 1, i + RECOVER_BARS); j++) {
                if (Number(rows[j].close) >= target) return j - i;
            }
            return -1;
        };
        if (row.position <= 0) {
            // 事件当天即清仓。
            signalInvalidation.clearedDay1 += 1;
            const rd = recoveredWithin();
            if (rd >= 0) { signalInvalidation.clearedRecovered += 1; signalInvalidation.clearedRecoveredDays.push(rd); }
            continue;
        }
        // 事件当天保留仓位；看其后 ≤5 日是否被清到 0（锁定期被接管清仓）。
        signalInvalidation.heldDay1 += 1;
        let clearedAt = -1;
        for (let j = i + 1; j <= Math.min(rows.length - 1, i + RECOVER_BARS); j++) {
            if (Number(rows[j].position) <= 0) { clearedAt = j; break; }
        }
        if (clearedAt >= 0) {
            signalInvalidation.heldThenClearedSoon += 1;
            // 区分清仓当天的驱动：是“收盘真跌破冻结硬防守位/箱体下沿”（合理），
            // 还是“数据/硬风险或结构硬失效优先”的连坐清仓（结构可能仍在，可修嫌疑）。
            const driver = rows[clearedAt].positionDriver || '';
            const clearClose = Number(rows[clearedAt].close);
            const clearHardDef = Number(rows[clearedAt].hardDefense);
            const brokeFrozen = Number.isFinite(clearClose) && Number.isFinite(clearHardDef) && clearClose < clearHardDef;
            if (driver.includes('跌破冻结硬防守位') || driver.includes('跌破箱体下沿') || brokeFrozen) {
                signalInvalidation.clearedByTrueBreak += 1;
            } else if (driver.includes('数据/硬风险或结构硬失效优先')) {
                signalInvalidation.clearedByCollateral += 1;
            } else {
                signalInvalidation.clearedByOther += 1;
            }
            if (target != null) {
                for (let j = clearedAt + 1; j <= Math.min(rows.length - 1, clearedAt + RECOVER_BARS); j++) {
                    if (Number(rows[j].close) >= target) { signalInvalidation.heldThenClearedRecovered += 1; break; }
                }
            }
        }
    }

    // 非下跌环境「跌破冻结硬防守位」离场日：收盘在箱体内的位置分布 + 当日是否只有 L3 触发。
    // 用于判断这些卖点是否发生在下沿附近（该扛/该加）而非上沿（该卖）。
    const defenseBreakNonDown = trades.filter(t =>
        t.exitReason === '跌破冻结硬防守位' && t.exitRegime !== 'down');
    const defenseBreakBoxLocations = defenseBreakNonDown
        .map(t => t.exitBoxLocation).filter(v => Number.isFinite(v));
    const defenseBreakL3Only = defenseBreakNonDown.filter(t =>
        t.exitSignals.length === 1 && t.exitSignals[0] === 'L3').length;
    const defenseBreakLowerHalf = defenseBreakBoxLocations.filter(v => v <= 0.5).length;

    // 卖出→很快重新买入的“来回”观察：上一笔离场日到下一笔建仓日的间隔。
    // 记录快速重入（间隔≤REENTRY_BARS）的离场成因、离场环境、以及重入后最高仓位是否回到与上一笔同档。
    const REENTRY_BARS = 5;
    const reentries = [];
    for (let i = 0; i + 1 < trades.length; i++) {
        const prev = trades[i];
        const next = trades[i + 1];
        const gap = next.startIdx - prev.endIdx;
        if (gap >= 1 && gap <= REENTRY_BARS) {
            reentries.push({
                gap,
                exitReason: prev.exitReason,
                exitRegime: prev.exitRegime,
                reentryRegime: next.entryRegime,
                prevMaxPosition: prev.maxPosition,
                nextMaxPosition: next.maxPosition,
                samePositionTier: prev.maxPosition === next.maxPosition,
                exitDate: prev.endDate,
                reentryDate: next.startDate,
                prevRet: prev.ret
            });
        }
    }

    return {
        id: symbol.id, name: symbol.name,
        firstDate: window[0]?.date || '', lastDate: window.at(-1)?.date || '', days: window.length,
        regimeDays, regimeHeldDays, transitionCauses, entryGaps, ratchetGaps,
        entryGapsByRegime, entrySourceByRegime, reentries, exitReasonsByRegime,
        defenseBreakNonDownCount: defenseBreakNonDown.length,
        defenseBreakBoxLocations, defenseBreakL3Only, defenseBreakLowerHalf,
        signalInvalidation,
        peakHeldDays, peakReducedDays, trades, exitReasons, entryRegimes, maxPositions,
        shortTrades: trades.filter(trade => trade.bars <= SHORT_TRADE_BARS).length
    };
}

function mergeCounts(target, source) {
    for (const [key, value] of Object.entries(source || {})) target[key] = (target[key] || 0) + value;
    return target;
}

function renderCounts(counts, total) {
    const entries = Object.entries(counts).sort((left, right) => right[1] - left[1]);
    if (!entries.length) return '无样本';
    return entries.map(([key, value]) => `${REGIME_LABELS[key] || key} ${value}（${share(value, total)}）`).join('、');
}

function renderGapLine(label, gaps) {
    if (!gaps.length) return `- ${label}：无样本`;
    return `- ${label}：n=${gaps.length}，中位 ${pct(quantile(gaps, 0.5))}，P10 ${pct(quantile(gaps, 0.1))}，P90 ${pct(quantile(gaps, 0.9))}`;
}

function buildReport(reports, meta) {
    const lines = [];
    lines.push('# 波段三趋势治理按需诊断');
    lines.push('');
    lines.push(`- 生成时间：${new Date().toISOString().slice(0, 19).replace('T', ' ')}`);
    lines.push(`- 策略：${STRATEGY_NAME}（个股日线）｜工作组：${reports.map(item => `${item.id} ${item.name}`).join('、')}`);
    lines.push(`- 回放起点索引：${START_INDEX}｜应用构建：${meta.appBuild || 'n/a'}｜信号版本：${meta.signalVersion || 'n/a'}`);
    lines.push('- 本报告只观察生产决策链的既有输出，不改变任何参数，也不构成收益、回撤或换手优势主张。');
    lines.push('');

    const total = {
        days: 0, regimeDays: {}, regimeHeldDays: {}, transitionCauses: {},
        entryGaps: [], ratchetGaps: [], peakHeldDays: 0, peakReducedDays: 0,
        trades: 0, shortTrades: 0, exitReasons: {}, entryRegimes: {}, maxPositions: {},
        entryPremiums: [], exitDiscounts: [], rets: [], bars: [],
        entryGapsByRegime: {}, entrySourceByRegime: {}, reentries: [], exitReasonsByRegime: {},
        defenseBreakBoxLocations: [], defenseBreakNonDownCount: 0, defenseBreakL3Only: 0, defenseBreakLowerHalf: 0,
        signalInvalidation: { events: 0, heldDay1: 0, clearedDay1: 0, heldThenClearedSoon: 0, heldThenClearedRecovered: 0, clearedByTrueBreak: 0, clearedByCollateral: 0, clearedByOther: 0, clearedRecovered: 0, clearedRecoveredDays: [] }
    };

    for (const report of reports) {
        total.days += report.days;
        mergeCounts(total.regimeDays, report.regimeDays);
        mergeCounts(total.regimeHeldDays, report.regimeHeldDays);
        mergeCounts(total.transitionCauses, report.transitionCauses);
        mergeCounts(total.exitReasons, report.exitReasons);
        mergeCounts(total.entryRegimes, report.entryRegimes);
        mergeCounts(total.maxPositions, report.maxPositions);
        total.entryGaps.push(...report.entryGaps);
        total.ratchetGaps.push(...report.ratchetGaps);
        total.peakHeldDays += report.peakHeldDays;
        total.peakReducedDays += report.peakReducedDays;
        total.trades += report.trades.length;
        total.shortTrades += report.shortTrades;
        for (const [regime, gaps] of Object.entries(report.entryGapsByRegime || {})) {
            (total.entryGapsByRegime[regime] = total.entryGapsByRegime[regime] || []).push(...gaps);
        }
        for (const [regime, sources] of Object.entries(report.entrySourceByRegime || {})) {
            total.entrySourceByRegime[regime] = mergeCounts(total.entrySourceByRegime[regime] || {}, sources);
        }
        total.reentries.push(...(report.reentries || []));
        for (const [regime, reasons] of Object.entries(report.exitReasonsByRegime || {})) {
            total.exitReasonsByRegime[regime] = mergeCounts(total.exitReasonsByRegime[regime] || {}, reasons);
        }
        total.defenseBreakBoxLocations.push(...(report.defenseBreakBoxLocations || []));
        total.defenseBreakNonDownCount += report.defenseBreakNonDownCount || 0;
        total.defenseBreakL3Only += report.defenseBreakL3Only || 0;
        total.defenseBreakLowerHalf += report.defenseBreakLowerHalf || 0;
        const si = report.signalInvalidation || {};
        total.signalInvalidation.events += si.events || 0;
        total.signalInvalidation.heldDay1 += si.heldDay1 || 0;
        total.signalInvalidation.clearedDay1 += si.clearedDay1 || 0;
        total.signalInvalidation.heldThenClearedSoon += si.heldThenClearedSoon || 0;
        total.signalInvalidation.heldThenClearedRecovered += si.heldThenClearedRecovered || 0;
        total.signalInvalidation.clearedByTrueBreak += si.clearedByTrueBreak || 0;
        total.signalInvalidation.clearedByCollateral += si.clearedByCollateral || 0;
        total.signalInvalidation.clearedByOther += si.clearedByOther || 0;
        total.signalInvalidation.clearedRecovered += si.clearedRecovered || 0;
        total.signalInvalidation.clearedRecoveredDays.push(...(si.clearedRecoveredDays || []));
        for (const trade of report.trades) {
            if (Number.isFinite(trade.entryPremium)) total.entryPremiums.push(trade.entryPremium);
            if (Number.isFinite(trade.exitDiscount)) total.exitDiscounts.push(trade.exitDiscount);
            total.rets.push(trade.ret);
            total.bars.push(trade.bars);
        }
    }

    lines.push('## 工作组合计');
    lines.push('');
    lines.push(`- 交易日：${total.days}｜完整交易：${total.trades} 次｜平均持有 ${mean(total.bars).toFixed(1)} 日｜${SHORT_TRADE_BARS} 日内被清 ${total.shortTrades} 次（${share(total.shortTrades, total.trades)}）`);
    lines.push(`- 环境分布：${renderCounts(total.regimeDays, total.days)}`);
    for (const regime of ['down', 'range', 'up', 'transition']) {
        const days = total.regimeDays[regime] || 0;
        const held = total.regimeHeldDays[regime] || 0;
        lines.push(`- ${REGIME_LABELS[regime]}环境持仓覆盖率：${held}/${days} = ${share(held, days)}`);
    }
    lines.push(`- 买点高出段内最低点：中位 ${pct(quantile(total.entryPremiums, 0.5))}，均值 ${pct(mean(total.entryPremiums))}`);
    lines.push(`- 卖点低于段内最高点：中位 ${pct(quantile(total.exitDiscounts, 0.5))}，均值 ${pct(mean(total.exitDiscounts))}`);
    lines.push(`- 建仓环境分布：${renderCounts(total.entryRegimes, total.trades)}`);
    lines.push(`- 每次交易达到的最高仓位：${renderCounts(total.maxPositions, total.trades)}`);
    lines.push(`- 波峰确认且当日有持仓：${total.peakHeldDays} 日，其中仓位下降 ${total.peakReducedDays} 日（${share(total.peakReducedDays, total.peakHeldDays)}）`);
    lines.push(renderGapLine('建仓日收盘到冻结硬防守位距离', total.entryGaps));
    for (const regime of ['down', 'range', 'up', 'transition']) {
        const gaps = total.entryGapsByRegime[regime] || [];
        if (!gaps.length) continue;
        const sources = total.entrySourceByRegime[regime] || {};
        const sourceText = Object.entries(sources).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join('、');
        lines.push(`  - ${REGIME_LABELS[regime]}环境建仓（n=${gaps.length}）：距离中位 ${pct(quantile(gaps, 0.5))}，P90 ${pct(quantile(gaps, 0.9))}｜防守位来源：${sourceText}`);
    }
    lines.push(renderGapLine('棘轮上移后收盘到硬防守位距离', total.ratchetGaps));
    lines.push(`- 离场成因：${renderCounts(total.exitReasons, total.trades)}`);
    lines.push(`- 过渡环境成因：${renderCounts(total.transitionCauses, total.regimeDays.transition || 0)}`);
    // 卖出后很快重新买入的“来回”观察：量化用户体感的“卖出位出现后很快又买入”。
    const reentries = total.reentries || [];
    if (reentries.length) {
        const sameTier = reentries.filter(item => item.samePositionTier).length;
        const nonDown = reentries.filter(item => item.exitRegime !== 'down').length;
        const byReason = {};
        const byExitRegime = {};
        for (const item of reentries) {
            byReason[item.exitReason] = (byReason[item.exitReason] || 0) + 1;
            byExitRegime[item.exitRegime] = (byExitRegime[item.exitRegime] || 0) + 1;
        }
        lines.push('');
        lines.push(`- 卖出后 ≤5 日重新买入（来回）：${reentries.length} 次｜其中重入后最高仓位与上一笔同档 ${sameTier}（${share(sameTier, reentries.length)}）｜非下跌环境离场触发 ${nonDown}（${share(nonDown, reentries.length)}）`);
        lines.push(`  - 来回的离场成因：${renderCounts(byReason, reentries.length)}`);
        lines.push(`  - 来回的离场环境：${renderCounts(byExitRegime, reentries.length)}`);
    }
    // 各离场环境靠什么卖出：观察非下跌环境是否主要靠 MACD死叉/硬防守（而非箱体上沿）。
    for (const regime of ['down', 'range', 'up', 'transition']) {
        const reasons = total.exitReasonsByRegime[regime];
        if (!reasons) continue;
        const count = Object.values(reasons).reduce((a, b) => a + b, 0);
        lines.push(`- ${REGIME_LABELS[regime]}环境离场成因（n=${count}）：${renderCounts(reasons, count)}`);
    }
    // 非下跌环境「跌破冻结硬防守位」离场日在箱体内的位置：判断这些卖点是否发生在下沿附近（该扛/该加）。
    const dbLoc = total.defenseBreakBoxLocations;
    if (total.defenseBreakNonDownCount) {
        const withBox = dbLoc.length;
        const locText = withBox
            ? `箱体内位置 中位 ${pct(quantile(dbLoc, 0.5))}（0=下沿,1=上沿），下半区(≤0.5) ${total.defenseBreakLowerHalf}/${withBox} = ${share(total.defenseBreakLowerHalf, withBox)}`
            : '这些离场日当时箱体无效，无上下沿参照';
        lines.push(`- 非下跌环境「跌破冻结硬防守位」离场：${total.defenseBreakNonDownCount} 次｜仅 L3 触发 ${total.defenseBreakL3Only}（${share(total.defenseBreakL3Only, total.defenseBreakNonDownCount)}）｜有效箱体 ${withBox} 次：${locText}`);
    }
    // 信号硬失效事件：保留30% vs 清仓，以及清仓后是否很快收复需收复价位（判断是否被洗）。
    const si = total.signalInvalidation;
    if (si.events) {
        lines.push(`- 信号硬失效事件（新事件，n=${si.events}）：当天保留30% ${si.heldDay1}（${share(si.heldDay1, si.events)}）、当天即清仓 ${si.clearedDay1}（${share(si.clearedDay1, si.events)}）`);
        if (si.clearedDay1) {
            lines.push(`  - 当天清仓者，≤5 日收复需收复价位：${si.clearedRecovered}/${si.clearedDay1} = ${share(si.clearedRecovered, si.clearedDay1)}`);
        }
        if (si.heldDay1) {
            lines.push(`  - 当天保留者，≤5 日内被清到 0：${si.heldThenClearedSoon}/${si.heldDay1} = ${share(si.heldThenClearedSoon, si.heldDay1)}；其中被清后又≤5 日收复 ${si.heldThenClearedRecovered}（“先留后清又收复”的被洗嫌疑）`);
            lines.push(`    · 被清清仓当天的驱动：真跌破冻结防守位/箱体下沿 ${si.clearedByTrueBreak}、连坐(数据/硬风险或结构硬失效优先) ${si.clearedByCollateral}、其它 ${si.clearedByOther}`);
        }
    }
    lines.push('');

    for (const report of reports) {
        lines.push(`## ${report.id} ${report.name}`);
        lines.push('');
        lines.push(`- 区间：${report.firstDate} ~ ${report.lastDate}（${report.days} 个交易日）`);
        lines.push(`- 环境分布：${renderCounts(report.regimeDays, report.days)}`);
        for (const regime of ['down', 'range', 'up']) {
            const days = report.regimeDays[regime] || 0;
            const held = report.regimeHeldDays[regime] || 0;
            lines.push(`- ${REGIME_LABELS[regime]}环境持仓覆盖率：${held}/${days} = ${share(held, days)}`);
        }
        const premiums = report.trades.map(trade => trade.entryPremium).filter(Number.isFinite);
        const discounts = report.trades.map(trade => trade.exitDiscount).filter(Number.isFinite);
        lines.push(`- 完整交易 ${report.trades.length} 次｜平均持有 ${mean(report.trades.map(trade => trade.bars)).toFixed(1)} 日｜平均单次收益 ${pct(mean(report.trades.map(trade => trade.ret)))}`);
        lines.push(`- 买点高出段内最低 中位 ${pct(quantile(premiums, 0.5))}｜卖点低于段内最高 中位 ${pct(quantile(discounts, 0.5))}`);
        lines.push(`- 建仓环境：${renderCounts(report.entryRegimes, report.trades.length)}`);
        lines.push(`- 离场成因：${renderCounts(report.exitReasons, report.trades.length)}`);
        lines.push('');
        lines.push('| 建仓日 | 离场日 | 持有日 | 建仓环境→离场环境 | 最高仓位 | 单次收益 | 买点溢价 | 卖点折让 | 离场成因 |');
        lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
        for (const trade of report.trades.slice(-12)) {
            lines.push(`| ${trade.startDate} | ${trade.endDate} | ${trade.bars} | ${REGIME_LABELS[trade.entryRegime] || trade.entryRegime}→${REGIME_LABELS[trade.exitRegime] || trade.exitRegime} | ${trade.maxPosition}% | ${pct(trade.ret)} | ${pct(trade.entryPremium)} | ${pct(trade.exitDiscount)} | ${trade.exitReason} |`);
        }
        lines.push('');
    }
    return lines.join('\n');
}

// 通用事件出口报告：把每个标的的风险事件日（rejectionStatus!='none'）按可选过滤词导出为一张表。
function collectEvents(symbol, rows) {
    const events = [];
    for (let idx = START_INDEX; idx < rows.length; idx++) {
        const row = rows[idx];
        if (row.rejectionStatus === 'none') continue;
        if (eventFilter && row.rejectionStatus !== eventFilter && row.rejectionEventType !== eventFilter) continue;
        events.push({ id: symbol.id, name: symbol.name, ...row });
    }
    return events;
}

function buildEventsReport(allEvents, meta) {
    const lines = [];
    lines.push('# 波段风险事件按需导出');
    lines.push('');
    lines.push(`- 生成时间：${new Date().toISOString().slice(0, 19).replace('T', ' ')}`);
    lines.push(`- 过滤条件：${eventFilter || '（全部风险事件）'}｜应用构建：${meta.appBuild || 'n/a'}｜信号版本：${meta.signalVersion || 'n/a'}`);
    lines.push(`- 命中事件日：${allEvents.length}｜本报告只读出生产决策链既有事件，不改变任何参数。`);
    lines.push('');
    const byStatus = {};
    const byType = {};
    for (const event of allEvents) {
        byStatus[event.rejectionStatus] = (byStatus[event.rejectionStatus] || 0) + 1;
        if (event.rejectionEventType) byType[event.rejectionEventType] = (byType[event.rejectionEventType] || 0) + 1;
    }
    lines.push(`- 按状态：${renderCounts(byStatus, allEvents.length) || '无'}`);
    lines.push(`- 按事件类型：${renderCounts(byType, allEvents.length) || '无'}`);
    lines.push('');
    lines.push('| 标的 | 日期 | 状态 | 事件类型 | 收盘 | 仓位 | 前仓 | B/S | 建仓龄 | 买入日最低 | 仓位驱动 |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const event of allEvents) {
        lines.push(`| ${event.id} ${event.name} | ${event.date} | ${event.rejectionStatus} | ${event.rejectionEventType || '—'} | ${event.close} | ${event.position}% | ${event.prevAdv ?? '—'}% | ${event.bsMark || '—'} | ${event.entryAge ?? '—'} | ${event.entrySignalLow ?? '—'} | ${event.positionDriver || '—'} |`);
    }
    return lines.join('\n');
}

function runEventsMode(targets, context, meta) {
    const allEvents = [];
    for (const symbol of targets) {
        process.stdout.write(`回放 ${symbol.id} ${symbol.name} ...\n`);
        const prepared = prepareSymbolContext(context, symbol);
        allEvents.push(...collectEvents(symbol, replaySymbol(context, symbol, prepared)));
    }
    const out = path.join(REPORT_DIR, 'strategy-wave-events.md');
    fs.mkdirSync(REPORT_DIR, { recursive: true });
    fs.writeFileSync(out, `${buildEventsReport(allEvents, meta)}\n`, 'utf8');
    process.stdout.write(`\n事件报告已写入 ${path.relative(ROOT, out)}（命中 ${allEvents.length} 个事件日）\n`);
}

function main() {
    const { symbols, indexData } = loadCacheSymbols();
    const known = new Map(symbols.map(symbol => [symbol.id, symbol]));
    const unknown = requestedIds.filter(id => !known.has(id));
    if (unknown.length) throw new Error(`unknown symbols: ${unknown.join(',')}`);
    const targets = requestedIds.map(id => known.get(id));
    const stockOnly = targets.filter(symbol => symbol.mode !== 'stock');
    if (stockOnly.length) throw new Error(`波段三趋势治理只覆盖个股日线，剔除：${stockOnly.map(item => item.id).join(',')}`);

    const context = createProductionContext(indexData);
    const meta = JSON.parse(vm.runInContext('JSON.stringify({ appBuild: APP_BUILD, signalVersion: SIGNAL_VERSION })', context));
    if (EVENTS_MODE) {
        runEventsMode(targets, context, meta);
        return;
    }
    const reports = [];
    for (const symbol of targets) {
        process.stdout.write(`回放 ${symbol.id} ${symbol.name} ...\n`);
        const prepared = prepareSymbolContext(context, symbol);
        reports.push(analyzeSymbol(symbol, replaySymbol(context, symbol, prepared)));
    }

    fs.mkdirSync(REPORT_DIR, { recursive: true });
    fs.writeFileSync(OUT, `${buildReport(reports, meta)}\n`, 'utf8');
    process.stdout.write(`\n报告已写入 ${path.relative(ROOT, OUT)}\n`);
    for (const report of reports) {
        const premiums = report.trades.map(trade => trade.entryPremium).filter(Number.isFinite);
        const discounts = report.trades.map(trade => trade.exitDiscount).filter(Number.isFinite);
        process.stdout.write(`${report.id} ${report.name}：${report.trades.length} 次交易，买点溢价中位 ${pct(quantile(premiums, 0.5))}，卖点折让中位 ${pct(quantile(discounts, 0.5))}，${SHORT_TRADE_BARS} 日内被清 ${report.shortTrades} 次\n`);
    }
}

try {
    main();
} catch (error) {
    console.error(error.stack || error.message);
    process.exitCode = 1;
}
