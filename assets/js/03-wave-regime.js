// [3D] 趋势环境与波段上下文 (Trend Regime & Wave Context)
function quantizePosition(val) {
    const steps = Array.isArray(POSITION_STEPS) && POSITION_STEPS.length ? POSITION_STEPS : [0, 30, 50, 80];
    return steps.reduce((prev, curr) => Math.abs(curr - val) < Math.abs(prev - val) ? curr : prev);
}

function getRiskPositionCap(risk = {}) {
    const score = Number(risk?.score);
    if (!Number.isFinite(score)) return 50;
    if (score >= 80) return 80;
    if (score >= 60) return 50;
    if (score >= 40) return 30;
    return 0;
}

// 统一的趋势状态用于解释和审计，并为风险事件后的恢复路径提供环境分流。
function getTrendRegimeContext(idx, full, ind) {
    const close = Number(full?.[idx]?.close);
    const ma20 = Number(ind?.ma?.[20]?.[idx]);
    const ma60 = Number(ind?.ma?.[60]?.[idx]);
    const ma20Prev = Number(ind?.ma?.[20]?.[Math.max(0, idx - 5)]);
    const ma20Yesterday = Number(ind?.ma?.[20]?.[Math.max(0, idx - 1)]);
    const ma60Prev = Number(ind?.ma?.[60]?.[Math.max(0, idx - 5)]);
    const values = [close, ma20, ma60, ma20Prev, ma20Yesterday, ma60Prev];
    const empty = {
        key: 'unknown',
        label: '趋势未知',
        transition: 'unknown',
        reason: 'MA20/MA60 或斜率数据不足，暂不判断趋势状态',
        evidence: { close, ma20, ma60, ma20Prev, ma20Yesterday, ma60Prev },
        thresholds: { rangeSpreadRatio: 0.03, rangeSlopeRatio: 0.01 }
    };
    if (!values.every(Number.isFinite) || ma20 <= 0 || ma60 <= 0 || ma20Prev <= 0 || ma60Prev <= 0) return empty;

    const spreadRatio = (ma20 - ma60) / ma60;
    const slopeRatio = (ma20 - ma20Prev) / ma20Prev;
    const previousSlopeRatio = (ma20Yesterday - ma20Prev) / ma20Prev;
    const rangeLike = Math.abs(spreadRatio) <= 0.03 && Math.abs(slopeRatio) <= 0.01;
    const wasDown = ma20Prev < ma60Prev && previousSlopeRatio <= 0;
    const wasUp = ma20Prev > ma60Prev && previousSlopeRatio >= 0;
    const turningUp = ma20 >= ma20Yesterday && slopeRatio > 0;
    const turningDown = ma20 <= ma20Yesterday && slopeRatio < 0;
    let key = 'range';
    let label = '横盘震荡';
    let transition = 'none';
    let reason = `MA20/MA60间距${(Math.abs(spreadRatio) * 100).toFixed(1)}%，MA20五日斜率${(slopeRatio * 100).toFixed(1)}%，方向未形成共振`;

    if (wasDown && turningUp && close >= ma20) {
        key = 'reversal-up';
        label = '向上反转中';
        transition = 'up';
        reason = '此前偏下降，MA20开始止跌上拐且收盘重新站上MA20，等待趋势确认';
    } else if (wasUp && turningDown && close <= ma20) {
        key = 'reversal-down';
        label = '向下反转中';
        transition = 'down';
        reason = '此前偏上升，MA20开始转弱且收盘跌回MA20下方，等待防守确认';
    } else if (close > ma20 && ma20 > ma60 && slopeRatio >= 0) {
        key = 'up';
        label = '上升趋势';
        reason = '收盘价位于MA20上方，MA20位于MA60上方且未下行';
    } else if (close < ma20 && ma20 < ma60 && slopeRatio <= 0) {
        key = 'down';
        label = '下降趋势';
        reason = '收盘价位于MA20下方，MA20位于MA60下方且未上行';
    } else if (!rangeLike) {
        key = close >= ma20 ? 'reversal-up' : 'reversal-down';
        label = close >= ma20 ? '向上过渡' : '向下过渡';
        transition = close >= ma20 ? 'up' : 'down';
        reason = '均线方向和价格位置不一致，归入过渡状态，暂不视为完整趋势';
    }

    return {
        key,
        label,
        transition,
        reason,
        evidence: { close, ma20, ma60, ma20Prev, ma20Yesterday, ma60Prev, spreadRatio, slopeRatio },
        thresholds: { rangeSpreadRatio: 0.03, rangeSlopeRatio: 0.01 }
    };
}

function getWaveAtr14At(idx, full) {
    if (!Number.isInteger(idx) || idx < 1 || !full?.[idx]) return null;
    const start = Math.max(1, idx - 13);
    const ranges = [];
    for (let day = start; day <= idx; day++) {
        const high = Number(full?.[day]?.high);
        const low = Number(full?.[day]?.low);
        const previousClose = Number(full?.[day - 1]?.close);
        if (![high, low, previousClose].every(Number.isFinite)) continue;
        ranges.push(Math.max(high - low, Math.abs(high - previousClose), Math.abs(low - previousClose)));
    }
    return ranges.length ? ranges.reduce((sum, value) => sum + value, 0) / ranges.length : null;
}

function getConfirmedWavePivots(idx, full, options = {}) {
    const pivotDays = Math.max(1, Number(options.pivotDays) || 2);
    const windowDays = Math.max(pivotDays * 2 + 1, Number(options.windowDays) || 40);
    const start = Math.max(pivotDays, idx - windowDays + 1);
    const end = idx - pivotDays;
    const lows = [], highs = [];
    for (let day = start; day <= end; day++) {
        const low = Number(full?.[day]?.low);
        const high = Number(full?.[day]?.high);
        if (![low, high].every(Number.isFinite)) continue;
        let lowConfirmed = true, highConfirmed = true;
        for (let offset = 1; offset <= pivotDays; offset++) {
            if (Number(full?.[day - offset]?.low) <= low || Number(full?.[day + offset]?.low) <= low) lowConfirmed = false;
            if (Number(full?.[day - offset]?.high) >= high || Number(full?.[day + offset]?.high) >= high) highConfirmed = false;
        }
        if (lowConfirmed) lows.push({ day, date: full?.[day]?.date || '', value: low });
        if (highConfirmed) highs.push({ day, date: full?.[day]?.date || '', value: high });
    }
    return { lows, highs, lastConfirmedDay: end };
}

function clusterWavePivotLevels(pivots, tolerance) {
    const clusters = [];
    for (const pivot of [...(pivots || [])].sort((left, right) => left.value - right.value)) {
        let cluster = clusters.find(item => Math.abs(pivot.value - item.level) <= tolerance);
        if (!cluster) {
            cluster = { level: pivot.value, pivots: [] };
            clusters.push(cluster);
        }
        cluster.pivots.push(pivot);
        cluster.level = cluster.pivots.reduce((sum, item) => sum + item.value, 0) / cluster.pivots.length;
    }
    return clusters;
}

function getWaveBoxContext(idx, full, policy = {}) {
    const config = policy.box || {};
    const atr14 = getWaveAtr14At(idx, full);
    const pivots = getConfirmedWavePivots(idx, full, config);
    const tolerance = Number.isFinite(atr14) && atr14 > 0 ? atr14 * Math.max(0.1, Number(config.clusterToleranceAtr) || 0.75) : 0;
    if (!(tolerance > 0)) return { valid: false, support: null, pressure: null, midpoint: null, atr14, pivots, reason: 'ATR14数据不足，不能确认箱体' };
    const supportClusters = clusterWavePivotLevels(pivots.lows, tolerance)
        .filter(item => item.pivots.length >= Math.max(2, Number(config.minimumSupportTouches) || 2));
    const pressureClusters = clusterWavePivotLevels(pivots.highs, tolerance)
        .filter(item => item.pivots.length >= Math.max(2, Number(config.minimumPressureTouches) || 2));
    let best = null;
    for (const supportCluster of supportClusters) {
        for (const pressureCluster of pressureClusters) {
            const support = supportCluster.level, pressure = pressureCluster.level;
            const width = pressure - support, midpoint = (pressure + support) / 2;
            if (!(width >= atr14 * Math.max(1, Number(config.minimumWidthAtr) || 3))) continue;
            if (!(midpoint > 0) || width / midpoint > Math.max(0.01, Number(config.maximumWidthRatio) || 0.15)) continue;
            const score = supportCluster.pivots.length + pressureCluster.pivots.length;
            const latestDay = Math.max(...supportCluster.pivots.concat(pressureCluster.pivots).map(item => item.day));
            if (!best || score > best.score || (score === best.score && latestDay > best.latestDay)) {
                best = { support, pressure, midpoint, width, score, latestDay, supportPivots: supportCluster.pivots, pressurePivots: pressureCluster.pivots };
            }
        }
    }
    if (!best) return { valid: false, support: null, pressure: null, midpoint: null, atr14, pivots, reason: '已确认支撑/压力不足或箱体宽度不合格' };
    return { valid: true, ...best, atr14, pivots, reason: '40日内至少两组已确认支撑和压力，宽度满足ATR与比例约束' };
}

function getWaveRawRegimeAt(day, full, ind, policy = {}) {
    const lookback = Math.max(1, Number(policy.slopeLookbackDays) || 5);
    const ma20 = Number(ind?.ma?.[20]?.[day]);
    const previousMa20 = Number(ind?.ma?.[20]?.[day - lookback]);
    const ma60 = Number(ind?.ma?.[60]?.[day]);
    const close = Number(full?.[day]?.close);
    if (![ma20, previousMa20, ma60, close].every(Number.isFinite) || previousMa20 <= 0) return { key: 'unknown', slopeRatio: null };
    const slopeRatio = (ma20 - previousMa20) / previousMa20;
    const upThreshold = Number(policy?.slopeThresholds?.up) || 0.005;
    const downThreshold = Number(policy?.slopeThresholds?.down) || -0.005;
    if (slopeRatio >= upThreshold && ma20 >= ma60 && close >= ma20) return { key: 'up', slopeRatio };
    if (slopeRatio <= downThreshold && ma20 <= ma60 && close <= ma20) return { key: 'down', slopeRatio };
    if (Math.abs(slopeRatio) < Math.max(0, Number(policy?.slopeThresholds?.flat) || 0.005)) return { key: 'flat', slopeRatio };
    return { key: 'transition', slopeRatio };
}

function getWaveContext(idx, full, ind, strategy = STRATEGY) {
    const policy = strategy?.waveRegimePolicy;
    const empty = { inScope: false, regime: 'unknown', regimeLabel: '环境未知', regimeConfidence: 0, boxSupport: null, boxPressure: null, boxMidpoint: null, positionCap: 0, lifecycle: null };
    if (!policy || state.strategy !== '波段抄底型' || state.period !== 'daily' || (policy.stocksOnly !== false && state.mode !== 'stock')) return empty;
    const box = getWaveBoxContext(idx, full, policy);
    const today = getWaveRawRegimeAt(idx, full, ind, policy);
    const candidate = today.key === 'flat' ? (box.valid ? 'range' : 'transition') : today.key;
    const requiredDays = Math.max(1, Number(policy?.confirmationDays?.[candidate]) || 1);
    let consecutiveDays = 0;
    for (let day = idx; day >= 0 && consecutiveDays < requiredDays; day--) {
        const raw = getWaveRawRegimeAt(day, full, ind, policy);
        const normalized = raw.key === 'flat' ? (getWaveBoxContext(day, full, policy).valid ? 'range' : 'transition') : raw.key;
        if (normalized !== candidate) break;
        consecutiveDays += 1;
    }
    const confirmed = ['up','down','range'].includes(candidate) && consecutiveDays >= requiredDays;
    const regime = confirmed ? candidate : (candidate === 'unknown' ? 'unknown' : 'transition');
    const labels = { up: '上涨', down: '下跌', range: '横盘', transition: '过渡', unknown: '未知' };
    const cap = Number(policy?.positionCaps?.[regime]);
    return {
        inScope: true, regime, regimeLabel: labels[regime], regimeConfidence: confirmed ? 1 : Math.min(0.99, consecutiveDays / requiredDays),
        rawRegime: today.key, consecutiveDays, requiredDays, slopeRatio: today.slopeRatio,
        boxSupport: box.support, boxPressure: box.pressure, boxMidpoint: box.midpoint, box,
        positionCap: Number.isFinite(cap) ? cap : 0, lifecycle: null
    };
}

function getWaveShortRepairContext(idx, full, meta, rawSignals, exit, prevPos, strategy = STRATEGY) {
    const config = strategy?.wavePositionStages?.shortRepair;
    const empty = { qualified: false, triggerSignal: '', triggerSignals: [], reason: '' };
    if (!config || state.strategy !== '波段抄底型' || state.period !== 'daily') return empty;
    if (config.stocksOnly !== false && state.mode !== 'stock') return empty;
    if (![0, 30].includes(Number(prevPos))) return empty;
    if (meta?.inCooldown || (meta?.exitSignals || []).length || (meta?.warningSignals || []).length
        || !exit || exit.level !== '无明确离场') return empty;

    const shortPeriod = Math.max(1, Number(config.shortMovingAveragePeriod) || 5);
    const trendPeriod = Math.max(1, Number(config.trendMovingAveragePeriod) || 20);
    const shortMA = Number(state.indicators?.ma?.[shortPeriod]?.[idx]);
    const trendMA = Number(state.indicators?.ma?.[trendPeriod]?.[idx]);
    const previousTrendMA = Number(state.indicators?.ma?.[trendPeriod]?.[idx - 1]);
    const close = Number(full?.[idx]?.close);
    if (![shortMA, trendMA, previousTrendMA, close].every(Number.isFinite)) return empty;

    const directSignal = (config.directSignals || []).find(signal => rawSignals.includes(signal));
    const structuralSignals = config.structuralSignals || ['B16', 'B20'];
    const structuralPair = structuralSignals.length > 1
        && structuralSignals.every(signal => rawSignals.includes(signal));
    const hasRepairEvidence = !!directSignal || structuralPair;
    const movingAverageRepair = shortMA >= trendMA && trendMA >= previousTrendMA && close >= trendMA;
    if (!hasRepairEvidence || !movingAverageRepair) return empty;

    const triggerSignals = directSignal ? [directSignal] : structuralSignals.filter(signal => rawSignals.includes(signal));
    return {
        qualified: true,
        triggerSignal: directSignal || 'short-repair',
        triggerSignals,
        shortMovingAverage: shortMA,
        trendMovingAverage: trendMA,
        previousTrendMovingAverage: previousTrendMA,
        reason: directSignal
            ? `当日${directSignal}回踩MA${trendPeriod}后收回，MA${shortPeriod}已修复且MA${trendPeriod}未下行，允许从0%直接建立或由30%提高至50%确认仓`
            : `当日${triggerSignals.join('+')}与MA${shortPeriod}/MA${trendPeriod}回踩修复共振，允许从0%直接建立或由30%提高至50%确认仓`
    };
}

function getStockTrendPositionCap(idx, full, ind, position, wavePositionStage = null, waveShortRepair = null) {
    if (state.mode !== 'stock') return null;
    const ma20 = Number(ind?.ma?.[20]?.[idx]);
    const ma60 = Number(ind?.ma?.[60]?.[idx]);
    const ma20Prev = Number(ind?.ma?.[20]?.[Math.max(0, idx - 5)]);
    const close = Number(full?.[idx]?.close);
    const hasTrendData = [close, ma20, ma60, ma20Prev].every(Number.isFinite);
    let limit = 50;
    let reason = '个股趋势数据不足，高仓位上限50%';
    if (hasTrendData && ma20 < ma60 && ma20 < ma20Prev) {
        const shortRepairConfirmation = waveShortRepair?.qualified
            && wavePositionStage?.stage === 'confirmation'
            && Number(wavePositionStage?.allowedPosition) >= 50;
        const strongBottomConfirmation = wavePositionStage?.stage === 'confirmation'
            && Number(wavePositionStage?.previousPosition) <= 0
            && ['B19', 'multi-reversal'].includes(wavePositionStage?.triggerSignal);
        limit = (strongBottomConfirmation || shortRepairConfirmation) ? 50 : 30;
        reason = strongBottomConfirmation
            ? '当日强底部结构已经确认，允许建立50%确认仓，但不直接进入80%趋势仓'
            : (shortRepairConfirmation
                ? waveShortRepair.reason
                : '个股处于中期下降趋势，高仓位上限30%');
    } else if (hasTrendData && close > ma20 && ma20 > ma60 && ma20 >= ma20Prev) {
        return null;
    } else if (hasTrendData) {
        reason = '个股尚未形成完整多头结构，高仓位上限50%';
    }
    return position > limit ? { limit, reason } : null;
}

function getPositionCap(meta, prevPos, position, idx, full, ind, wavePositionStage = null, waveShortRepair = null) {
    const caps = [];
    const trendCap = getStockTrendPositionCap(idx, full, ind, position, wavePositionStage, waveShortRepair);
    if (trendCap) caps.push(trendCap);
    if (meta.allSignals?.W4 && prevPos > 0 && position >= 80) {
        caps.push({ limit: 50, reason: 'W4缩量上涨背离，高仓位上限50%' });
    }
    if (!caps.length) return null;
    const limit = Math.min(...caps.map(cap => cap.limit));
    const reasons = [...new Set(caps.map(cap => cap.reason).filter(Boolean))];
    return { limit, reason: reasons.join('；') };
}

function getTargetStrengthTier(meta, idx, full, ind, risk, exit) {
    const ma20 = Number(ind?.ma?.[20]?.[idx]);
    const ma60 = Number(ind?.ma?.[60]?.[idx]);
    const ma20Prev = Number(ind?.ma?.[20]?.[Math.max(0, idx - 5)]);
    const close = Number(full?.[idx]?.close);
    const hasTrendData = [close, ma20, ma60, ma20Prev].every(Number.isFinite);
    const independent = meta?.type === '✅ 明确转强'
        && hasTrendData
        && close > ma20
        && ma20 > ma60
        && ma20 >= ma20Prev
        && !(meta?.warningSignals || []).length
        && !(meta?.exitSignals || []).length
        && !meta?.inCooldown
        && exit?.level === '无明确离场';
    return {
        tier: independent ? 'independent' : 'ordinary',
        label: independent ? '标的独立走强' : '普通机会',
        reasons: independent ? ['买入积分达标', '收盘价与MA20/MA60保持多头结构', 'MA20未转弱', '离场检查通过'] : []
    };
}

// 核心宽基只对指数路径形成新增风险上限；个股仓位完全由个股信号、结构资格与波段治理决定。
function getMarketIncreaseCap(market, tier = 'ordinary') {
    if (state.mode === 'stock') return null;
    const caps = market?.increaseCaps;
    if (!caps) return null;
    const cap = Number(caps[tier === 'independent' ? 'independent' : 'ordinary']);
    return Number.isFinite(cap) ? cap : null;
}

function applyMarketRiskGate(market, prevPos, targetPosition, strength = { tier:'ordinary', label:'普通机会' }) {
    const previous = Math.max(0, Number(prevPos) || 0);
    const target = Math.max(0, Number(targetPosition) || 0);
    const label = market?.label || '环境未知';
    const strengthTier = strength?.tier === 'independent' ? 'independent' : 'ordinary';
    const cap = getMarketIncreaseCap(market, strengthTier);
    const reasons = Array.isArray(strength?.reasons) ? [...strength.reasons] : [];

    if (target <= previous || cap == null) {
        return { position:target, applied:false, type:'open', cap, strengthTier, strengthLabel:strength?.label || '普通机会', reasons, detail:'' };
    }
    if (previous === 0 && cap <= 0) {
        return { position:0, applied:true, type:'entry-blocked', cap, strengthTier, strengthLabel:strength?.label || '普通机会', reasons, detail:`${label}暂停指数新增风险` };
    }
    const cappedPosition = cap <= previous ? previous : Math.min(target, cap);
    if (cappedPosition < target) {
        return {
            position:cappedPosition,
            applied:true,
            type:'increase-capped',
            cap,
            strengthTier,
            strengthLabel:strength?.label || '普通机会',
            reasons,
            detail:`${label}下${strength?.label || '普通机会'}新增风险上限${cap}%`
        };
    }
    return { position:target, applied:false, type:'open', cap, strengthTier, strengthLabel:strength?.label || '普通机会', reasons, detail:'' };
}

function getSoftSignalGraceContext(meta, prevPos, basePosition, exit, idx, strategy = STRATEGY) {
    const graceDays = Math.max(0, Number(strategy?.softInvalidationGraceDays) || 0);
    const holdThreshold = Number(strategy?.holdThreshold);
    const watchPosition = Number(strategy?.watchPosition) || 0;
    const invalidatedToday = (meta?.invalidatedWindowSignals || []).filter(item => Number(item?.invalidationDay) === Number(idx));
    const softSignals = invalidatedToday.filter(item => item?.reason === 'kdj-dead-cross');
    const hardSignals = invalidatedToday.filter(item => item?.reason === 'price-break');
    const scoreBelowHold = Number.isFinite(holdThreshold) && (meta?.windowScore ?? 0) < holdThreshold;
    const exitIsClear = !exit || exit.level === '无明确离场';
    const applied = graceDays > 0
        && watchPosition > 0
        && prevPos > 0
        && prevPos <= watchPosition
        && Number(basePosition) <= 0
        && scoreBelowHold
        && softSignals.length > 0
        && hardSignals.length === 0
        && exitIsClear
        && !meta?.inCooldown;
    return {
        applied,
        days: applied ? graceDays : 0,
        holdThreshold: Number.isFinite(holdThreshold) ? holdThreshold : null,
        signals: softSignals.map(item => item.signal),
        invalidations: softSignals
    };
}

function getLocalStructureDefenseContext(meta, b11Defense, prevPos, exit, strategy = STRATEGY) {
    const localBreaks = b11Defense?.localBreak ? [b11Defense] : [];
    const watchPosition = Number(strategy?.watchPosition) || 0;
    const exitIsClear = !exit || exit.level === '无明确离场';
    const applied = localBreaks.length > 0
        && watchPosition > 0
        && prevPos > 0
        && prevPos <= watchPosition
        && exitIsClear
        && !meta?.inCooldown;
    return {
        applied,
        signals: localBreaks.map(item => item.signal),
        localBreaks
    };
}

function getWaveRejectionEntryClose(idx, full, prevPos) {
    if (prevPos <= 0) return null;
    for (let day = idx - 1; day >= 0; day--) {
        const decision = full?.[day]?._decision;
        if (!decision) continue;
        if (Number(decision.position) <= 0) break;
        if (Number(decision.prevAdv) === 0 || decision.bsMark === 'B') {
            const close = Number(full?.[day]?.close);
            return Number.isFinite(close) && close > 0 ? close : null;
        }
    }
    return null;
}

function getLowerWavePositionStep(position, steps = [0, 30, 50, 80]) {
    const current = Math.max(0, Number(position) || 0);
    const eligible = [...steps].map(Number).filter(step => Number.isFinite(step) && step < current).sort((left, right) => left - right);
    return eligible.length ? eligible[eligible.length - 1] : 0;
}

function getRecentConfirmedPressureHigh(idx, full, lookbackDays = 20, pivotDays = 2) {
    const start = Math.max(pivotDays, idx - Math.max(1, lookbackDays));
    for (let day = idx - pivotDays - 1; day >= start; day--) {
        const value = Number(full?.[day]?.high);
        if (!Number.isFinite(value)) continue;
        let confirmed = true;
        for (let offset = 1; offset <= pivotDays; offset++) {
            if (Number(full?.[day - offset]?.high) >= value || Number(full?.[day + offset]?.high) >= value) {
                confirmed = false;
                break;
            }
        }
        if (confirmed) return { day, value };
    }
    return null;
}

function getWaveFreshEntryPressureContext(idx, full, indicators, config = {}) {
    const item = full?.[idx] || {};
    const high = Number(item.high);
    const close = Number(item.close);
    const tolerance = Math.max(0, Number(config.pressureToleranceRatio) || 0);
    const closeTolerance = Math.max(0, Number(config.pressureCloseToleranceRatio) || 0);
    const sources = [];
    const pivot = getRecentConfirmedPressureHigh(
        idx,
        full,
        Math.max(1, Number(config.pressureLookbackDays) || 20),
        Math.max(1, Number(config.pivotConfirmationDays) || 2)
    );
    if (pivot && high >= pivot.value * (1 - tolerance) && close <= pivot.value * (1 + closeTolerance)) {
        sources.push({ type: 'pivot', period: null, level: pivot.value, day: pivot.day, date: full?.[pivot.day]?.date || '' });
    }
    const slopeDays = Math.max(1, Number(config.movingAverageSlopeLookbackDays) || 5);
    for (const period of config.movingAveragePeriods || []) {
        const series = indicators?.ma?.[period] || [];
        const level = Number(series[idx]);
        const previousLevel = Number(series[idx - slopeDays]);
        if (!Number.isFinite(level) || !Number.isFinite(previousLevel) || level > previousLevel) continue;
        if (high >= level * (1 - tolerance) && close <= level * (1 + closeTolerance)) {
            sources.push({ type: 'ma', period, level, day: idx, date: item.date || '' });
        }
    }
    return { matched: sources.length > 0, sources };
}

function wasWavePressureSourceReachedOnDay(source, day, full, indicators, config = {}) {
    if (!source || day < 0) return false;
    const high = Number(full?.[day]?.high);
    const tolerance = Math.max(0, Number(config.pressureToleranceRatio) || 0);
    const level = source.type === 'ma' && Number.isFinite(Number(source.period))
        ? Number(indicators?.ma?.[Number(source.period)]?.[day])
        : Number(source.level);
    return Number.isFinite(high) && Number.isFinite(level) && high >= level * (1 - tolerance);
}
