// [3F] 波段治理链与决策合成 (Wave Governance & Decision Compose)
function getWaveExpiryHandoffContext(idx, full, meta, prevPos, basePosition, exit, risk, strategy = STRATEGY) {
    const config = strategy?.waveExpiryHandoff;
    const empty = { applied: false, reason: '' };
    const requiredPosition = Math.max(0, Number(config?.position) || 30);
    if (!config || state.strategy !== '波段抄底型' || state.period !== 'daily') return empty;
    const previous = full?.[idx - 1]?._decision?.waveExpiryHandoff;
    if (previous?.applied && previous.observationMode === 'defensive') {
        const close = Number(full?.[idx]?.close);
        const invalidatedToday = [
            ...(meta?.invalidatedWindowSignals || []),
            ...(meta?.localBreakWindowSignals || [])
        ].some(item => Number(item?.invalidationDay) === Number(idx));
        const blocked = meta?.inCooldown
            || (meta?.exitSignals || []).length > 0
            || (meta?.warningSignals || []).length > 0
            || !exit
            || exit.level !== '无明确离场'
            || invalidatedToday;
        const nextPeriods = config.defensiveObservation?.nextDayMovingAveragePeriods || [5, 20];
        const recoveredMovingAverages = Number.isFinite(close) && nextPeriods.every(period => {
            const level = Number(state.indicators?.ma?.[Number(period)]?.[idx]);
            return Number.isFinite(level) && close > level;
        });
        const hasFreshSignal = (meta?.windowScoreSignals || []).some(signal => Number(signal.day) > Number(previous.triggerDay));
        const brokeObservationLow = Number.isFinite(close)
            && Number.isFinite(Number(previous.triggerLow))
            && close < Number(previous.triggerLow);
        const brokeEntryLow = Number.isFinite(close)
            && Number.isFinite(Number(previous.entryLow))
            && close < Number(previous.entryLow);
        const hardBreak = previous.establishedUptrend ? brokeEntryLow : brokeObservationLow;
        const takeoverPassed = !blocked && !hardBreak && (recoveredMovingAverages || hasFreshSignal);
        const defensiveConfig = config.defensiveObservation || {};
        const observationAge = idx - Number(previous.triggerDay);
        const maxTradingDays = Math.max(1, Number(defensiveConfig.establishedTrendMaxTradingDays) || 1);
        const trendPeriod = Math.max(1, Number(defensiveConfig.trendMovingAveragePeriod) || 20);
        const longPeriod = Math.max(1, Number(defensiveConfig.longMovingAveragePeriod) || 60);
        const trendSlopeDays = Math.max(1, Number(defensiveConfig.establishedTrendSlopeLookbackDays) || 5);
        const trendMA = Number(state.indicators?.ma?.[trendPeriod]?.[idx]);
        const longMA = Number(state.indicators?.ma?.[longPeriod]?.[idx]);
        const priorTrendMA = Number(state.indicators?.ma?.[trendPeriod]?.[idx - trendSlopeDays]);
        const currentEstablishedUptrend = [trendMA, longMA, priorTrendMA].every(Number.isFinite)
            && trendMA > longMA
            && trendMA >= priorTrendMA;
        const closeGapRatio = Number.isFinite(close) && trendMA > 0 ? Math.max(0, (trendMA - close) / trendMA) : Infinity;
        const atr = getATR(full, idx);
        const closeGapAtr = Number.isFinite(close) && Number.isFinite(trendMA) && atr > 0
            ? Math.max(0, trendMA - close) / atr
            : Infinity;
        const withinWashoutRange = closeGapRatio <= Math.max(0, Number(defensiveConfig.maximumCloseGapRatio) || 0.03)
            && closeGapAtr <= Math.max(0, Number(defensiveConfig.maximumCloseGapAtr) || 1);
        const continueEstablishedWashout = !takeoverPassed
            && !blocked
            && !hardBreak
            && previous.establishedUptrend
            && currentEstablishedUptrend
            && withinWashoutRange
            && observationAge < maxTradingDays;
        if (continueEstablishedWashout) {
            return {
                ...previous,
                applied: true,
                status: 'observing',
                trendWashout: true,
                observationAge,
                maxTradingDays,
                currentEstablishedUptrend,
                closeGapRatio,
                closeGapAtr,
                recoveredMovingAverages,
                hasFreshSignal,
                brokeObservationLow,
                brokeEntryLow,
                forceExit: false,
                forceHold: Number(basePosition) <= 0,
                targetPosition: requiredPosition,
                reason: `上涨结构未破，积分到期后的MA${trendPeriod}洗盘观察继续保留${requiredPosition}%`
            };
        }
        return {
            ...previous,
            applied: false,
            status: takeoverPassed ? 'taken_over' : 'expired',
            followUpDay: idx,
            followUpDate: full?.[idx]?.date || '',
            recoveredMovingAverages,
            hasFreshSignal,
            brokeObservationLow,
            brokeEntryLow,
            forceExit: !takeoverPassed,
            forceHold: takeoverPassed && Number(basePosition) <= 0,
            reason: takeoverPassed
                ? '到期防守观察后重新站上短期与中期均线，或出现新的有效买入信号'
                : '到期防守观察后未能重新站上短期与中期均线，也没有新的有效买入信号'
        };
    }
    if (prevPos !== requiredPosition || Number(basePosition) > 0 || idx <= 0) return empty;
    if (meta?.inCooldown || (meta?.exitSignals || []).length || (meta?.warningSignals || []).length) return empty;
    if (!exit || exit.level !== '无明确离场') return empty;
    if (previous?.applied) return empty;

    const invalidatedToday = [
        ...(meta?.invalidatedWindowSignals || []),
        ...(meta?.localBreakWindowSignals || [])
    ].some(item => Number(item?.invalidationDay) === Number(idx));
    if (invalidatedToday) return empty;

    const previousMeta = getSignalMeta(idx - 1, full, state.indicators);
    const holdThreshold = Math.max(1, Number(strategy?.holdThreshold) || Number(strategy?.buyThreshold) || 1);
    if (Number(previousMeta?.windowScore) < holdThreshold || Number(meta?.windowScore) >= holdThreshold) return empty;
    const currentScoreKeys = new Set((meta?.windowScoreSignals || []).map(item => `${item.signal}|${item.day}`));
    const missingPreviousSignals = (previousMeta?.windowScoreSignals || []).filter(item => !currentScoreKeys.has(`${item.signal}|${item.day}`));
    const windowDays = Math.max(1, Number(strategy?.windowDays) || 1);
    if (!missingPreviousSignals.length || !missingPreviousSignals.every(item => idx - Number(item.day) >= windowDays)) return empty;

    let entryDay = null;
    for (let day = idx - 1; day >= 0; day--) {
        const priorDecision = full?.[day]?._decision;
        if (!priorDecision || Number(priorDecision.position) <= 0) break;
        if (Number(priorDecision.prevAdv) === 0 || priorDecision.bsMark === 'B') {
            entryDay = day;
            break;
        }
    }
    const entryLow = Number.isInteger(entryDay) ? Number(full?.[entryDay]?.low) : null;
    const close = Number(full?.[idx]?.close);
    const previousClose = Number(full?.[idx - 1]?.close);
    const previousLifecycle = full?.[idx - 1]?._decision?.waveContext?.lifecycle;
    const frozenHardDefense = Number(previousLifecycle?.hardDefense);
    const movingAveragePeriod = Math.max(1, Number(config.movingAveragePeriod) || 5);
    const shortMA = Number(state.indicators?.ma?.[movingAveragePeriod]?.[idx]);
    if (!Number.isFinite(entryLow) || !Number.isFinite(close) || !Number.isFinite(previousClose) || !Number.isFinite(shortMA)) return empty;
    if (close <= entryLow) return empty;

    const macdBar = Number(state.indicators?.macd?.bar?.[idx]);
    const previousMacdBar = Number(state.indicators?.macd?.bar?.[idx - 1]);
    const macdImproving = Number.isFinite(macdBar) && Number.isFinite(previousMacdBar) && macdBar > previousMacdBar;
    const k = Number(state.indicators?.kdj?.k?.[idx]);
    const d = Number(state.indicators?.kdj?.d?.[idx]);
    const previousK = Number(state.indicators?.kdj?.k?.[idx - 1]);
    const kdjImproving = Number.isFinite(k) && Number.isFinite(d) && Number.isFinite(previousK) && k > d && k > previousK;
    const strictRecovery = close > previousClose && close > shortMA && (macdImproving || kdjImproving);
    const defensiveConfig = config.defensiveObservation;
    const defensiveStocksOnly = defensiveConfig?.stocksOnly !== false;
    const trendPeriod = Math.max(1, Number(defensiveConfig?.trendMovingAveragePeriod) || 20);
    const trendSlopeDays = Math.max(1, Number(defensiveConfig?.trendSlopeLookbackDays) || 1);
    const trendMA = Number(state.indicators?.ma?.[trendPeriod]?.[idx]);
    const previousTrendMA = Number(state.indicators?.ma?.[trendPeriod]?.[idx - trendSlopeDays]);
    const trendMANotFalling = Number.isFinite(trendMA) && Number.isFinite(previousTrendMA) && trendMA >= previousTrendMA;
    const longPeriod = Math.max(1, Number(defensiveConfig?.longMovingAveragePeriod) || 60);
    const establishedSlopeDays = Math.max(1, Number(defensiveConfig?.establishedTrendSlopeLookbackDays) || 5);
    const longMA = Number(state.indicators?.ma?.[longPeriod]?.[idx]);
    const establishedPreviousTrendMA = Number(state.indicators?.ma?.[trendPeriod]?.[idx - establishedSlopeDays]);
    const establishedUptrend = [trendMA, longMA, establishedPreviousTrendMA].every(Number.isFinite)
        && trendMA > longMA
        && trendMA >= establishedPreviousTrendMA;
    const establishedCloseGapRatio = trendMA > 0 ? Math.max(0, (trendMA - close) / trendMA) : Infinity;
    const atr = getATR(full, idx);
    const establishedCloseGapAtr = atr > 0 ? Math.max(0, trendMA - close) / atr : Infinity;
    const establishedWashoutRange = establishedCloseGapRatio <= Math.max(0, Number(defensiveConfig?.maximumCloseGapRatio) || 0.03)
        && establishedCloseGapAtr <= Math.max(0, Number(defensiveConfig?.maximumCloseGapAtr) || 1);
    const positiveMacdBar = Number.isFinite(macdBar) && macdBar > 0;
    // 底部试探仓的积分到期不能仅因 MA20 短暂下行就清仓：只要价格仍守住当次生命周期冻结的硬防守位、
    // 处于回踩而非反弹追价，且中期动能仍为正，先给一次和“到期防守观察”同等的一日宽限。
    // 这条兜底只覆盖个股日线的既有30%试探仓，不改变真实失效、离场、预警或冷静期优先级。
    const holdsFrozenHardDefense = Number.isFinite(close)
        && Number.isFinite(frozenHardDefense)
        && close >= frozenHardDefense;
    const bottomDefenseObservation = !!defensiveConfig
        && defensiveStocksOnly
        && state.mode === 'stock'
        && !strictRecovery
        && !trendMANotFalling
        && holdsFrozenHardDefense
        && Number.isFinite(previousClose)
        && close <= previousClose
        && Number.isFinite(trendMA)
        && close <= trendMA
        && positiveMacdBar;
    const defensiveObservation = !!defensiveConfig
        && (!defensiveStocksOnly || state.mode === 'stock')
        && (trendMANotFalling || bottomDefenseObservation)
        && (!defensiveConfig.requirePositiveMacdBar || positiveMacdBar);
    if (!strictRecovery && !defensiveObservation) return empty;

    const observationMode = strictRecovery ? 'rebound' : 'defensive';
    const momentumSignals = strictRecovery
        ? [macdImproving ? 'MACD柱改善' : '', kdjImproving ? 'KDJ继续修复' : ''].filter(Boolean)
        : (bottomDefenseObservation
            ? ['冻结硬防守位未破', 'MACD柱仍为正']
            : [`MA${trendPeriod}未下行`, 'MACD柱仍为正']);
    return {
        applied: true,
        observationMode,
        reason: strictRecovery
            ? '买入积分仅因窗口自然到期，价格与短线动能仍在修复，保留一日低风险仓位等待接管'
            : (bottomDefenseObservation
                ? '买入积分仅因窗口自然到期，价格仍守住冻结硬防守位、MACD柱仍为正，底部回踩先保留一日30%防守观察'
                : '买入积分仅因窗口自然到期，价格仍守住买入日防守位，且中期均线未下行、MACD柱仍为正，保留一日30%防守观察'),
        holdTradingDays: Math.max(1, Number(config.holdTradingDays) || 1),
        triggerDay: idx,
        triggerDate: full?.[idx]?.date || '',
        triggerLow: Number(full?.[idx]?.low),
        sourcePosition: prevPos,
        entryDay,
        entryDate: full?.[entryDay]?.date || '',
        entryLow,
        shortMAPeriod: movingAveragePeriod,
        shortMA,
        trendMAPeriod: trendPeriod,
        trendMA,
        previousTrendMA,
        longMAPeriod: longPeriod,
        longMA,
        establishedUptrend,
        closeGapRatio: establishedCloseGapRatio,
        closeGapAtr: establishedCloseGapAtr,
        trendWashout: observationMode === 'defensive' && establishedUptrend && establishedWashoutRange,
        bottomDefenseObservation,
        previousWindowScore: Number(previousMeta.windowScore) || 0,
        currentWindowScore: Number(meta?.windowScore) || 0,
        expiredSignals: missingPreviousSignals.map(item => ({ signal: item.signal, day: item.day, signalDate: item.signalDate || full?.[item.day]?.date || '' })),
        momentumSignals
    };
}

function getWaveMA20PullbackObservationContext(idx, full, meta, prevPos, basePosition, exit, risk, strategy = STRATEGY) {
    const config = strategy?.waveMA20PullbackObservation;
    const empty = { applied: false, reason: '' };
    const requiredPosition = Math.max(0, Number(config?.position) || 30);
    const trendDefense = config?.trendDefense;
    if (!config || state.strategy !== '波段抄底型' || state.period !== 'daily') return empty;
    if (config.stocksOnly !== false && state.mode !== 'stock') return empty;

    const period = Math.max(1, Number(config.movingAveragePeriod) || 20);
    const item = full?.[idx] || {};
    const close = Number(item.close);
    const movingAverage = Number(state.indicators?.ma?.[period]?.[idx]);
    const rawSignals = item._signals || [];
    const previous = full?.[idx - 1]?._decision?.waveMA20PullbackObservation;
    const trendPeriod = Math.max(1, Number(trendDefense?.movingAveragePeriod) || period);
    const trendMovingAverage = Number(state.indicators?.ma?.[trendPeriod]?.[idx]);
    const previousTrendMovingAverage = Number(state.indicators?.ma?.[trendPeriod]?.[Math.max(0, idx - 1)]);
    const breakoutLookbackDays = Math.max(1, Number(trendDefense?.breakoutLookbackDays) || 3);
    const breakoutPullbackGapRatio = Math.max(0, Number(trendDefense?.maximumBreakoutPullbackGapRatio) || 0.005);
    const breakoutLowGapRatio = Math.max(0, Number(trendDefense?.maximumBreakoutLowGapRatio) || breakoutPullbackGapRatio);
    let breakoutDay = -1;
    if (trendDefense && idx > 1) {
        for (let day = idx - 1; day >= Math.max(1, idx - breakoutLookbackDays); day--) {
            const dayClose = Number(full?.[day]?.close);
            const dayMa = Number(state.indicators?.ma?.[trendPeriod]?.[day]);
            const priorClose = Number(full?.[day - 1]?.close);
            const priorMa = Number(state.indicators?.ma?.[trendPeriod]?.[day - 1]);
            if ([dayClose, dayMa, priorClose, priorMa].every(Number.isFinite)
                && priorClose <= priorMa
                && dayClose > dayMa
                && dayMa >= priorMa) {
                breakoutDay = day;
                break;
            }
        }
    }
    const breakoutAge = breakoutDay >= 0 ? idx - breakoutDay : Infinity;
    const breakoutDefenseLevel = Number(risk?.stop);
    const breakoutPullback = trendDefense
        && prevPos === requiredPosition
        && Number(basePosition) <= 0
        && state.mode === 'stock'
        && breakoutAge >= 1
        && breakoutAge <= breakoutLookbackDays
        && [close, trendMovingAverage, previousTrendMovingAverage].every(Number.isFinite)
        && trendMovingAverage >= previousTrendMovingAverage
        && close >= trendMovingAverage * (1 - breakoutPullbackGapRatio)
        && Number(item.low) <= trendMovingAverage * (1 + breakoutLowGapRatio)
        && (!Number.isFinite(breakoutDefenseLevel) || close >= breakoutDefenseLevel)
        && !meta?.inCooldown
        && !(meta?.exitSignals || []).length
        && !(meta?.warningSignals || []).length;
    if (breakoutPullback) {
        return {
            applied: true,
            status: 'observing',
            defenseType: 'breakout_pullback',
            overrideCriticalExit: true,
            reason: `突破MA${trendPeriod}后的第${breakoutAge}个交易日回踩，收盘仍贴近均线，保留${requiredPosition}%观察`,
            triggerDay: idx,
            triggerDate: item.date || '',
            triggerLow: Number(item.low),
            triggerClose: close,
            sourcePosition: prevPos,
            targetPosition: requiredPosition,
            movingAveragePeriod: trendPeriod,
            movingAverage: trendMovingAverage,
            previousMovingAverage: previousTrendMovingAverage,
            breakoutDay,
            breakoutDate: full?.[breakoutDay]?.date || '',
            breakoutAge,
            defenseLevel: Number.isFinite(breakoutDefenseLevel) ? breakoutDefenseLevel : null
        };
    }
    const invalidatedToday = [
        ...(meta?.invalidatedWindowSignals || []),
        ...(meta?.localBreakWindowSignals || [])
    ].some(signal => Number(signal?.invalidationDay) === Number(idx));
    const blocked = meta?.inCooldown
        || (meta?.exitSignals || []).length > 0
        || (meta?.warningSignals || []).length > 0
        || !exit
        || exit.level !== '无明确离场'
        || invalidatedToday;

    if (previous?.applied) {
        const defenseLevel = Number(previous.defenseLevel);
        const recoveredMovingAverage = Number.isFinite(close) && Number.isFinite(movingAverage) && close >= movingAverage;
        const freshTakeoverSignals = (config.takeoverSignals || ['B6', 'B11']).filter(signal => rawSignals.includes(signal));
        const brokeObservationLow = Number.isFinite(close)
            && Number.isFinite(Number(previous.triggerLow))
            && close < Number(previous.triggerLow);
        const brokeDefenseLevel = Number.isFinite(close)
            && Number.isFinite(defenseLevel)
            && close < defenseLevel;
        const takeoverPassed = !blocked
            && !brokeObservationLow
            && !brokeDefenseLevel
            && (recoveredMovingAverage || freshTakeoverSignals.length > 0);
        return {
            ...previous,
            applied: false,
            status: takeoverPassed ? 'taken_over' : 'expired',
            followUpDay: idx,
            followUpDate: item.date || '',
            recoveredMovingAverage,
            freshTakeoverSignals,
            brokeObservationLow,
            brokeDefenseLevel,
            forceExit: !takeoverPassed,
            forceHold: takeoverPassed && (previous?.defenseType ? true : Number(basePosition) <= 0),
            overrideCriticalExit: false,
            targetPosition: requiredPosition,
            reason: takeoverPassed
                ? `MA${period}回踩观察后重新站回均线，或出现新的B6/B11信号`
                : `MA${period}回踩观察后未重新站回均线，也没有新的B6/B11信号`
        };
    }

    if (trendDefense && prevPos === requiredPosition && Number(basePosition) <= 0 && idx > 0) {
        const trendPeriod = Math.max(1, Number(trendDefense.movingAveragePeriod) || period);
        const longPeriod = Math.max(1, Number(trendDefense.longMovingAveragePeriod) || 60);
        const slopeDays = Math.max(1, Number(trendDefense.completeTrendSlopeLookbackDays) || 5);
        const trendMovingAverage = Number(state.indicators?.ma?.[trendPeriod]?.[idx]);
        const previousTrendMovingAverage = Number(state.indicators?.ma?.[trendPeriod]?.[idx - 1]);
        const longMovingAverage = Number(state.indicators?.ma?.[longPeriod]?.[idx]);
        const establishedTrendMovingAverage = Number(state.indicators?.ma?.[trendPeriod]?.[idx - slopeDays]);
        const atr = getATR(full, idx);
        const defenseLevel = Number(risk?.stop);
        const maGap = Number.isFinite(trendMovingAverage) && Number.isFinite(close)
            ? Math.max(0, trendMovingAverage - close)
            : Infinity;
        const maGapRatio = Number.isFinite(trendMovingAverage) && trendMovingAverage > 0
            ? maGap / trendMovingAverage
            : Infinity;
        const maGapAtr = atr > 0 ? maGap / atr : Infinity;
        const maSupport = [close, trendMovingAverage, previousTrendMovingAverage].every(Number.isFinite)
            && trendMovingAverage >= previousTrendMovingAverage
            && maGapRatio <= Math.max(0, Number(trendDefense.maximumCloseBelowMovingAverageRatio) || 0.005)
            && maGapAtr <= Math.max(0, Number(trendDefense.maximumCloseBelowMovingAverageAtr) || 0.5);
        const completeUptrend = [close, trendMovingAverage, longMovingAverage, establishedTrendMovingAverage].every(Number.isFinite)
            && close >= trendMovingAverage
            && trendMovingAverage > longMovingAverage
            && trendMovingAverage >= establishedTrendMovingAverage;
        const defenseIntact = !Number.isFinite(defenseLevel) || close >= defenseLevel;
        const currentExitSignals = meta?.exitSignals || [];
        const blockingSignals = rawSignals.filter(signal => (trendDefense.blockingSignals || []).includes(signal));
        const invalidationsToday = getTodaySignalInvalidations(meta, 'price-break');
        const invalidationGap = invalidationsToday.length
            ? Math.max(...invalidationsToday
                .map(signal => Math.max(0, Number(signal?.invalidationLevel) - close))
                .filter(Number.isFinite), 0)
            : Infinity;
        const limitedHardInvalidation = invalidationsToday.length > 0
            && atr > 0
            && invalidationGap / atr <= Math.max(0, Number(trendDefense.maximumInvalidationGapAtr) || 1);
        const standaloneExitSignal = trendDefense.standaloneExitSignal || 'L3';
        const standaloneL3 = currentExitSignals.length === 1
            && currentExitSignals[0] === standaloneExitSignal
            && blockingSignals.length === 0
            && !(meta?.type || '').includes('清仓')
            && completeUptrend;
        const hardInvalidationPullback = currentExitSignals.length === 0
            && !(meta?.warningSignals || []).length
            && limitedHardInvalidation
            && close >= trendMovingAverage;
        const eligible = trendDefense.stocksOnly !== false
            && state.mode === 'stock'
            && !meta?.inCooldown
            && maSupport
            && defenseIntact
            && (standaloneL3 || hardInvalidationPullback);
        if (eligible) {
            const defenseType = standaloneL3 ? 'standalone_l3' : 'limited_hard_invalidation';
            return {
                applied: true,
                status: 'observing',
                defenseType,
                overrideCriticalExit: standaloneL3,
                reason: standaloneL3
                    ? '单独MACD死叉，价格仍在完整多头结构中，本日保留30%观察'
                    : '买点失效位虽被收盘跌破，但价格仍守住MA20，先保留30%观察',
                triggerDay: idx,
                triggerDate: item.date || '',
                triggerLow: Number(item.low),
                triggerClose: close,
                sourcePosition: prevPos,
                targetPosition: requiredPosition,
                movingAveragePeriod: trendPeriod,
                movingAverage: trendMovingAverage,
                previousMovingAverage: previousTrendMovingAverage,
                defenseLevel: Number.isFinite(defenseLevel) ? defenseLevel : null,
                invalidationGapAtr: limitedHardInvalidation && atr > 0 ? invalidationGap / atr : null
            };
        }
    }

    if (prevPos !== requiredPosition || Number(basePosition) > 0 || idx <= 0 || blocked) return empty;
    const slopeDays = Math.max(1, Number(config.slopeLookbackDays) || 1);
    const previousMovingAverage = Number(state.indicators?.ma?.[period]?.[idx - slopeDays]);
    const previousClose = Number(full?.[idx - 1]?.close);
    const high = Number(item.high);
    const low = Number(item.low);
    const open = Number(item.open);
    if (![close, movingAverage, previousMovingAverage, previousClose, high, low, open].every(Number.isFinite)) return empty;

    const closeGapRatio = movingAverage > 0 ? (movingAverage - close) / movingAverage : Infinity;
    const body = Math.abs(close - open);
    const lowerShadow = Math.max(0, Math.min(open, close) - low);
    const range = Math.max(high - low, 0);
    const lowerShadowRangeRatio = range > 0 ? lowerShadow / range : 0;
    const maximumGap = Math.max(0, Number(config.maximumCloseGapRatio) || 0.005);
    const minimumShadowBodyRatio = Math.max(0, Number(config.minimumLowerShadowBodyRatio) || 1.5);
    const minimumShadowRangeRatio = Math.max(0, Number(config.minimumLowerShadowRangeRatio) || 0.35);
    const defenseLevel = Number(risk?.stop);
    const recoveredIntraday = low <= movingAverage
        && lowerShadow > 0
        && lowerShadow >= body * minimumShadowBodyRatio
        && lowerShadowRangeRatio >= minimumShadowRangeRatio;
    const freshPullback = previousClose >= previousMovingAverage
        && close < movingAverage
        && closeGapRatio <= maximumGap
        && movingAverage >= previousMovingAverage;
    const defenseIntact = !Number.isFinite(defenseLevel) || close >= defenseLevel;
    if (!freshPullback || !recoveredIntraday || !defenseIntact) return empty;

    return {
        applied: true,
        status: 'observing',
        reason: `收盘仅小幅低于抬升中的MA${period}，下影线收回且结构防守位未破，保留一日${requiredPosition}%观察`,
        triggerDay: idx,
        triggerDate: item.date || '',
        triggerLow: low,
        triggerClose: close,
        sourcePosition: prevPos,
        targetPosition: requiredPosition,
        movingAveragePeriod: period,
        movingAverage,
        previousMovingAverage,
        closeGapRatio,
        lowerShadow,
        lowerShadowRangeRatio,
        defenseLevel: Number.isFinite(defenseLevel) ? defenseLevel : null
    };
}

function getWaveL10TrendHandoffContext(idx, full, meta, prevPos, strategy = STRATEGY) {
    const config = strategy?.l10TrendHandoff;
    const empty = { eligible: false, applied: false, reason: '' };
    if (!config || (config.stocksOnly && state.mode !== 'stock') || prevPos <= 0) return empty;
    const rawSignals = full?.[idx]?._signals || [];
    const invalidatedToday = [
        ...(meta?.invalidatedWindowSignals || []),
        ...(meta?.localBreakWindowSignals || [])
    ].filter(item => Number(item?.invalidationDay) === Number(idx));
    const invalidatedTodaySignals = new Set(invalidatedToday.map(item => item?.signal).filter(Boolean));
    const strongExitSet = getStrongExitSignals(strategy);
    const strongExitSignals = (meta?.exitSignals || []).filter(signal => strongExitSet.has(signal));
    if (strongExitSignals.length !== 1 || strongExitSignals[0] !== 'L10') return empty;
    if ((config.blockingSignals || []).some(signal => rawSignals.includes(signal))) return empty;
    const lookbackDays = Math.max(1, Number(config.movingAverageSlopeLookbackDays) || 5);
    const close = Number(full?.[idx]?.close);
    const ma20 = Number(state.indicators?.ma?.[20]?.[idx]);
    const ma60 = Number(state.indicators?.ma?.[60]?.[idx]);
    const previousMa20 = Number(state.indicators?.ma?.[20]?.[idx - lookbackDays]);
    const completeUptrend = Number.isFinite(close) && Number.isFinite(ma20) && Number.isFinite(ma60)
        && Number.isFinite(previousMa20) && close > ma20 && ma20 > ma60 && ma20 >= previousMa20;
    if (!completeUptrend) return empty;
    return {
        eligible: true,
        applied: false,
        reason: '完整多头持仓中的单独L10按预警处理，趋势接管后续持仓',
        sourcePosition: prevPos,
        targetPositionCap: Math.max(0, Number(config.warningPositionCap) || 30),
        triggerDay: idx,
        triggerDate: full?.[idx]?.date || '',
        triggerHigh: Number(full?.[idx]?.high),
        triggerClose: close
    };
}

function getWaveB6TrendAddContext(idx, full, meta, prevPos, exit, strategy = STRATEGY) {
    const config = strategy?.waveB6TrendAdd;
    const empty = { eligible: false, applied: false, reason: '' };
    const sourcePosition = Math.max(0, Number(config?.sourcePosition) || 30);
    if (!config || state.strategy !== '波段抄底型' || state.period !== 'daily') return empty;
    if (config.stocksOnly !== false && state.mode !== 'stock') return empty;
    if (prevPos !== sourcePosition || meta?.type !== '📈 趋势抱单') return empty;
    if (meta?.inCooldown || (meta?.exitSignals || []).length || (meta?.warningSignals || []).length) return empty;
    if (!exit || exit.level !== '无明确离场' || !(full?.[idx]?._signals || []).includes('B6')) return empty;

    const period = Math.max(1, Number(config.movingAveragePeriod) || 20);
    const slopeDays = Math.max(1, Number(config.slopeLookbackDays) || 1);
    const close = Number(full?.[idx]?.close);
    const movingAverage = Number(state.indicators?.ma?.[period]?.[idx]);
    const previousMovingAverage = Number(state.indicators?.ma?.[period]?.[idx - slopeDays]);
    if (!Number.isFinite(close) || !Number.isFinite(movingAverage) || !Number.isFinite(previousMovingAverage)) return empty;
    if (close < movingAverage || movingAverage < previousMovingAverage) return empty;

    return {
        eligible: true,
        applied: false,
        reason: `当日缩量回踩MA${period}后收回，且MA${period}未下行，允许波段试探仓进入趋势修复加仓`,
        sourcePosition,
        targetPosition: Math.max(sourcePosition, Number(config.targetPosition) || 50),
        triggerDay: idx,
        triggerDate: full?.[idx]?.date || '',
        movingAveragePeriod: period,
        movingAverage,
        previousMovingAverage,
        triggerLow: Number(full?.[idx]?.low),
        triggerClose: close
    };
}

function getWavePositionStageContext(idx, full, meta, prevPos, requestedPosition, exit, strategy = STRATEGY, waveShortRepair = null) {
    const config = strategy?.wavePositionStages;
    const requested = quantizePosition(requestedPosition);
    const empty = {
        inScope: false, limited: false, increaseApplied: false, stage: 'not-applicable',
        triggerSignal: '', triggerSignals: [], requestedPosition: requested, allowedPosition: requested, reason: ''
    };
    if (!config || state.strategy !== '波段抄底型' || state.period !== 'daily') return empty;
    if (config.stocksOnly !== false && state.mode !== 'stock') return empty;

    const entryCap = Math.max(0, Number(config.entryCap) || 30);
    const strongEntryCap = Math.max(entryCap, Number(config.strongEntryCap) || 50);
    const confirmationCap = Math.max(strongEntryCap, Number(config.confirmationCap) || 50);
    const trendCap = Math.max(confirmationCap, Number(config.trendCap) || 80);
    const previous = Math.max(0, Number(prevPos) || 0);
    const rawSignals = full?.[idx]?._signals || [];
    const invalidatedToday = [
        ...(meta?.invalidatedWindowSignals || []),
        ...(meta?.localBreakWindowSignals || [])
    ].filter(item => Number(item?.invalidationDay) === Number(idx));
    const invalidatedTodaySignals = new Set(invalidatedToday.map(item => item?.signal).filter(Boolean));
    const blocked = meta?.inCooldown
        || (meta?.exitSignals || []).length > 0
        || (meta?.warningSignals || []).length > 0
        || !exit
        || exit.level !== '无明确离场';
    const close = Number(full?.[idx]?.close);
    const trendPeriod = Math.max(1, Number(config.trendMovingAveragePeriod) || 20);
    const longPeriod = Math.max(1, Number(config.longMovingAveragePeriod) || 60);
    const slopeDays = Math.max(1, Number(config.trendSlopeLookbackDays) || 5);
    const trendMA = Number(state.indicators?.ma?.[trendPeriod]?.[idx]);
    const previousTrendMA = Number(state.indicators?.ma?.[trendPeriod]?.[idx - 1]);
    const slopeTrendMA = Number(state.indicators?.ma?.[trendPeriod]?.[idx - slopeDays]);
    const longMA = Number(state.indicators?.ma?.[longPeriod]?.[idx]);
    const scoreGroups = strategy?.scoreGroups || [];
    const freshBuySignals = rawSignals.filter(signal => strategy?.buySignals?.includes(signal) && !invalidatedTodaySignals.has(signal));
    const pullbackWait = config.breakoutPullbackWait || {};
    const pullbackSignals = new Set(pullbackWait.takeoverSignals || ['B6', 'B11']);
    const triggerSignalSet = new Set(pullbackWait.triggerSignals || ['B19']);
    const maxPullbackWait = Math.max(1, Number(strategy?.windowDays) || 10);
    let recentBreakout = null;
    if (pullbackWait && triggerSignalSet.size) {
        for (let day = idx - 1; day >= Math.max(0, idx - maxPullbackWait); day--) {
            const daySignals = full?.[day]?._signals || [];
            const trigger = [...triggerSignalSet].find(signal => daySignals.includes(signal));
            if (trigger) {
                recentBreakout = { trigger, day, date: full?.[day]?.date || '', age: idx - day };
                break;
            }
        }
    }
    const freshPullbackSignal = freshBuySignals.find(signal => pullbackSignals.has(signal)) || '';
    const groupedSignals = new Set(scoreGroups.flat());
    const groupedFreshCount = scoreGroups.filter(group => group.some(signal => freshBuySignals.includes(signal))).length;
    const ungroupedFreshCount = freshBuySignals.filter(signal => !groupedSignals.has(signal)).length;
    const freshGroupCount = groupedFreshCount + ungroupedFreshCount;

    if (previous <= 0 && requested > 0) {
        const structureSignal = (config.structureEntrySignals || []).find(signal => rawSignals.includes(signal) && !invalidatedTodaySignals.has(signal)) || '';
        if (structureSignal && triggerSignalSet.has(structureSignal)) {
            return {
                inScope: true, limited: requested > 0, increaseApplied: false, stage: 'breakout-wait',
                triggerSignal: structureSignal, triggerSignals: [structureSignal], freshGroupCount,
                previousPosition: previous, requestedPosition: requested, allowedPosition: 0,
                waitingForPullback: true, breakoutDate: full?.[idx]?.date || '',
                reason: `今日${structureSignal}突破确认，但阳线追价不建仓；等待${[...pullbackSignals].join('/')}首次回踩确认后再试探`
            };
        }
        if (recentBreakout && !freshPullbackSignal) {
            return {
                inScope: true, limited: requested > 0, increaseApplied: false, stage: 'breakout-wait',
                triggerSignal: recentBreakout.trigger, triggerSignals: [], freshGroupCount,
                previousPosition: previous, requestedPosition: requested, allowedPosition: 0,
                waitingForPullback: true, breakoutDate: recentBreakout.date, breakoutAge: recentBreakout.age,
                reason: `${recentBreakout.date}已完成${recentBreakout.trigger}突破，当前等待首次${[...pullbackSignals].join('/')}回踩确认，不追价建仓`
            };
        }
        if (recentBreakout && freshPullbackSignal) {
            return {
                inScope: true, limited: requested > entryCap, increaseApplied: requested > 0, stage: 'entry',
                triggerSignal: freshPullbackSignal, triggerSignals: [freshPullbackSignal], freshGroupCount,
                previousPosition: previous, requestedPosition: requested, allowedPosition: Math.min(requested, entryCap),
                waitingForPullback: false, breakoutDate: recentBreakout.date, breakoutAge: recentBreakout.age,
                reason: `${recentBreakout.date}突破后当日新${freshPullbackSignal}回踩确认，允许${entryCap}%低吸试探`
            };
        }
        const hasStrongReversal = (config.strongReversalSignals || []).some(signal => rawSignals.includes(signal) && !invalidatedTodaySignals.has(signal));
        const strongReversalConfirmed = hasStrongReversal
            && freshGroupCount >= Math.max(2, Number(config.minimumStrongReversalGroups) || 2);
        const shortRepairEntry = !blocked
            && waveShortRepair?.qualified
            && requested >= confirmationCap;
        const strongEntry = !blocked && (!!structureSignal || strongReversalConfirmed || shortRepairEntry);
        const cap = strongEntry ? strongEntryCap : entryCap;
        const allowedPosition = strongEntry ? strongEntryCap : Math.min(requested, cap);
        const entryTriggerSignals = structureSignal
            ? [structureSignal]
            : (shortRepairEntry ? waveShortRepair.triggerSignals : (strongEntry ? freshBuySignals : []));
        return {
            inScope: true, limited: allowedPosition < requested, increaseApplied: allowedPosition > 0,
            stage: strongEntry ? 'confirmation' : 'entry',
            triggerSignal: structureSignal || (shortRepairEntry ? waveShortRepair.triggerSignal : (strongEntry ? 'multi-reversal' : '')),
            triggerSignals: entryTriggerSignals, freshGroupCount, previousPosition: previous, requestedPosition: requested, allowedPosition,
            reason: strongEntry
                ? (shortRepairEntry && !structureSignal && !strongReversalConfirmed
                    ? waveShortRepair.reason
                    : `当日${structureSignal || '底背离与多组反转信号'}完成底部确认，首次建仓允许提高至${strongEntryCap}%确认仓`)
                : `当前仅完成早期修复，首次建仓按${entryCap}%试探仓处理`
        };
    }

    if (previous === entryCap) {
        const freshSignal = (config.confirmationSignals || []).find(signal => rawSignals.includes(signal) && !invalidatedTodaySignals.has(signal)) || '';
        const b6Confirmed = freshSignal === 'B6'
            && [close, trendMA, previousTrendMA].every(Number.isFinite)
            && close >= trendMA && trendMA >= previousTrendMA;
        const b11Confirmed = freshSignal === 'B11'
            && [close, trendMA, previousTrendMA].every(Number.isFinite)
            && close > trendMA && trendMA >= previousTrendMA;
        const b19Confirmed = freshSignal === 'B19'
            && [close, trendMA].every(Number.isFinite) && close > trendMA;
        const shortRepairConfirmed = !blocked && waveShortRepair?.qualified && requested >= confirmationCap;
        const confirmed = !blocked && (b6Confirmed || b11Confirmed || b19Confirmed || shortRepairConfirmed);
        const allowedPosition = confirmed ? confirmationCap : Math.min(requested, entryCap);
        const confirmationSignal = freshSignal || (shortRepairConfirmed ? waveShortRepair.triggerSignal : '');
        return {
            inScope: true, limited: allowedPosition < requested, increaseApplied: allowedPosition > previous,
            stage: confirmed ? 'confirmation' : 'entry', triggerSignal: confirmed ? confirmationSignal : '',
            triggerSignals: confirmed ? (freshSignal ? [freshSignal] : (waveShortRepair.triggerSignals || [])) : [], freshGroupCount, previousPosition: previous, requestedPosition: requested, allowedPosition,
            reason: confirmed
                ? (shortRepairConfirmed && !freshSignal
                    ? waveShortRepair.reason
                    : `当日新${freshSignal}完成反转确认，允许${entryCap}%试探仓提高至${confirmationCap}%确认仓`)
                : `尚无当日新B6/B11/B19确认事件，维持${entryCap}%试探仓`
        };
    }

    if (previous === confirmationCap) {
        const freshSignal = (config.trendContinuationSignals || []).find(signal => rawSignals.includes(signal) && !invalidatedTodaySignals.has(signal)) || '';
        const completeUptrend = [close, trendMA, longMA, slopeTrendMA].every(Number.isFinite)
            && close > trendMA && trendMA > longMA && trendMA >= slopeTrendMA;
        const scoreReady = Number(meta?.windowScore) >= Number(strategy?.buyThreshold);
        const confirmed = !blocked && !!freshSignal && completeUptrend && scoreReady;
        const allowedPosition = confirmed ? trendCap : Math.min(requested, confirmationCap);
        return {
            inScope: true, limited: allowedPosition < requested, increaseApplied: allowedPosition > previous,
            stage: confirmed ? 'trend' : 'confirmation', triggerSignal: confirmed ? freshSignal : '',
            triggerSignals: confirmed ? [freshSignal] : [], freshGroupCount, previousPosition: previous, requestedPosition: requested, allowedPosition,
            reason: confirmed
                ? `完整多头中当日新${freshSignal}确认趋势延续，允许${confirmationCap}%确认仓提高至${trendCap}%趋势仓`
                : `尚无完整多头中的当日放量突破事件，维持${confirmationCap}%确认仓`
        };
    }

    return {
        ...empty, inScope: true, stage: previous >= trendCap ? 'trend' : (previous >= confirmationCap ? 'confirmation' : 'entry')
    };
}

function computeBaseDecisionForIndex(idx, full, prevPos) {
    const rawMeta = getSignalMeta(idx, full, state.indicators), market = getMarketContext(full[idx].date);
    const rawSignals = full?.[idx]?._signals || [];
    const wavePeak = getWavePeakContext(idx, full, state.indicators, rawMeta);
    const risk = getRiskContext(idx, full, state.indicators), rawExit = getExitSeverity(rawMeta, idx, full, state.indicators);
    const trendRegime = getTrendRegimeContext(idx, full, state.indicators);
    const waveContext = getWaveContext(idx, full, state.indicators, STRATEGY);
    let waveL10TrendHandoff = getWaveL10TrendHandoffContext(idx, full, rawMeta, prevPos, STRATEGY);
    let meta = rawMeta;
    if (waveL10TrendHandoff.eligible) {
        const originalSignals = full[idx]._signals || [];
        full[idx]._signals = originalSignals.filter(signal => signal !== 'L10');
        try {
            meta = getSignalMeta(idx, full, state.indicators);
        } finally {
            full[idx]._signals = originalSignals;
        }
    }
    const waveBottomL3Observation = state.strategy === '波段抄底型'
        && state.mode === 'stock'
        && state.period === 'daily'
        && prevPos > 0
        && waveContext?.inScope
        && ['down', 'range', 'transition'].includes(waveContext.regime)
        && isWaveStandaloneL3Observation(rawMeta, STRATEGY);
    const waveStandaloneL3Observation = state.strategy === '波段抄底型'
        && state.period === 'daily'
        && prevPos > 0
        && (isWaveStandaloneL3Observation(rawMeta, STRATEGY) && (!waveContext?.inScope || waveContext.regime === 'up' || waveBottomL3Observation));
    let exit = waveL10TrendHandoff.eligible
        ? { level: '减仓观察', detail: '完整多头结构中单独出现MACD顶背离，先降仓预警，不单信号归零' }
        : (waveStandaloneL3Observation
            ? { level: '减仓观察', detail: '单独MACD死叉只表示动能转弱，先降至或维持30%观察结构确认' }
            : rawExit);
    const b11StructureDefense = getB11StructureDefenseContext(meta, full, STRATEGY);
    let waveB6TrendAdd = getWaveB6TrendAddContext(idx, full, meta, prevPos, exit, STRATEGY);
    let base = getBasePosition(idx, full, state.indicators, meta);
    const isWaveStockTrendHold = state.strategy === '波段抄底型'
        && state.mode === 'stock'
        && state.period === 'daily'
        && meta?.type === '📈 趋势抱单'
        && prevPos > 0;
    if (isWaveStockTrendHold) base = prevPos;
    if (waveB6TrendAdd.eligible) base = Math.max(base, waveB6TrendAdd.targetPosition);
    const waveExpiryHandoff = getWaveExpiryHandoffContext(idx, full, meta, prevPos, base, exit, risk, STRATEGY);
    const waveMA20PullbackObservation = getWaveMA20PullbackObservationContext(idx, full, meta, prevPos, base, exit, risk, STRATEGY);
    if (waveStandaloneL3Observation) base = prevPos;
    if (waveMA20PullbackObservation.overrideCriticalExit) {
        exit = {
            level: '减仓观察',
            detail: '完整多头中的单独MACD死叉先作MA20防守观察'
        };
    }
    const softSignalGrace = getSoftSignalGraceContext(meta, prevPos, base, exit, idx, STRATEGY);
    const localStructureDefense = getLocalStructureDefenseContext(meta, b11StructureDefense, prevPos, exit, STRATEGY);
    if (waveExpiryHandoff.forceExit || waveMA20PullbackObservation.forceExit) base = 0;
    else if (waveExpiryHandoff.applied || waveExpiryHandoff.forceHold) base = prevPos;
    if (waveMA20PullbackObservation.applied || waveMA20PullbackObservation.forceHold) base = prevPos;
    if (softSignalGrace.applied) base = prevPos;
    if (localStructureDefense.applied) base = prevPos;
    if (waveMA20PullbackObservation.forceExit) base = 0;
    const waveShortRepair = getWaveShortRepairContext(idx, full, meta, rawSignals, exit, prevPos, STRATEGY);
    const wavePositionStage = getWavePositionStageContext(idx, full, meta, prevPos, base, exit, STRATEGY, waveShortRepair);
    if (wavePositionStage.inScope) base = wavePositionStage.allowedPosition;

    // 仓位只由信号、离场、预警和结构治理决定；风险指标不参与交易档位计算。
    let rawPosition = base, position = quantizePosition(rawPosition);
    let isCriticalExit = (exit.level === '清仓防守' || exit.level === '强离场'
        || (meta.type || '').includes('规避') || (meta.type || '').includes('破位'))
        && !waveL10TrendHandoff.eligible
        && !waveMA20PullbackObservation.overrideCriticalExit
        && !waveStandaloneL3Observation;

    if (isCriticalExit || meta.inCooldown) position = 0;
    else if (exit.level === '减仓观察' || exit.level === '延续防守') position = quantizePosition(Math.min(position, 30));

    if (meta.warningSignals?.length) position = quantizePosition(Math.min(position, 30));
    if (waveL10TrendHandoff.eligible) position = quantizePosition(Math.min(position, waveL10TrendHandoff.targetPositionCap));
    const positionCap = getPositionCap(meta, prevPos, position, idx, full, state.indicators, wavePositionStage, waveShortRepair);
    if (positionCap) position = quantizePosition(Math.min(position, positionCap.limit));

    if (position > prevPos && Math.abs(position - prevPos) <= 10) position = prevPos;
    if (prevPos === 0 && position > 0 && meta.type === '📈 趋势抱单') position = 0;
    const targetStrength = getTargetStrengthTier(meta, idx, full, state.indicators, risk, exit);
    const marketGate = applyMarketRiskGate(market, prevPos, position, targetStrength);
    position = marketGate.position;
    let waveRejectionProtection = isCriticalExit
        ? { active: false, status: 'superseded', targetPosition: position }
        : getWaveRejectionProtectionContext(idx, full, meta, prevPos, position, STRATEGY, {
            risk,
            exit,
            market,
            trendRegime,
            waveContext,
            targetStrength,
            positionCap,
            isCriticalExit,
        });
    if (Number.isFinite(Number(waveRejectionProtection.targetPosition))) {
        const protectedTarget = Number(waveRejectionProtection.targetPosition);
        position = waveRejectionProtection.allowRecoveryIncrease && protectedTarget > position
            ? protectedTarget
            : Math.min(position, protectedTarget);
    }
    if (waveB6TrendAdd.eligible) {
        waveB6TrendAdd = {
            ...waveB6TrendAdd,
            applied: position > prevPos,
            finalPosition: position,
            limited: position <= prevPos
        };
    }
    if (waveL10TrendHandoff.eligible && position > 0) {
        waveL10TrendHandoff = { ...waveL10TrendHandoff, applied: true, targetPosition: position };
    } else if (waveL10TrendHandoff.eligible) {
        waveL10TrendHandoff = { ...waveL10TrendHandoff, eligible: false, applied: false, targetPosition: 0 };
        meta = rawMeta;
        exit = rawExit;
        isCriticalExit = rawExit.level === '清仓防守' || rawExit.level === '强离场'
            || (rawMeta.type || '').includes('规避') || (rawMeta.type || '').includes('破位');
        waveRejectionProtection = { active: false, status: 'superseded', targetPosition: position };
    }
    const waveDriver = waveRejectionProtection.status === 'pending_hard_break'
        ? '首次建仓后跌破买入日最低价，先降到观察仓位，等待次日确认是否收复'
        : (waveRejectionProtection.status === 'hard_break_recovered'
        ? '首破后次日收盘收复买入日最低价，解除首破锁定'
        : (waveRejectionProtection.status === 'entry_blocked'
        ? '建仓日触及下降均线压力并长上影受阻，取消本次试探建仓'
        : (waveRejectionProtection.status === 'ma20_hold'
        ? '首次建仓后冲击压力回落，但收盘仍站在MA20上方，仅保留30%观察'
        : (waveRejectionProtection.status === 'triggered'
        ? (waveRejectionProtection.eventType === 'fresh_entry_hard_break'
            ? '首次建仓后两日内跌破买入日最低价，当日归零'
            : (waveRejectionProtection.eventType === 'fresh_entry_downside_failure'
                ? '首次建仓后两日内下跌失败，当日提前防守'
                : (waveRejectionProtection.eventType === 'fresh_entry_failure'
                    ? '首次建仓后冲击压力失败，当日提前防守'
                    : (waveRejectionProtection.eventType === 'signal_hard_invalidation'
                        ? '买入信号硬失效导致离场，进入局部重入保护'
                        : '已有浮盈遇放量冲高回落，当日分档保护利润'))))
        : (waveRejectionProtection.status === 'locked'
            ? '冲高回落风险尚未解除，局部阻止旧积分立即回补'
            : (['released', 'recovery_pending'].includes(waveRejectionProtection.status)
                ? '冲高回落风险已局部解除'
                : (['recovery_started', 'recovery_hold'].includes(waveRejectionProtection.status) ? '冲高回落风险解除后分步恢复' : '')))))));
    const basePositionDriver = getPositionDriverText(meta, market, risk, exit, base, position, prevPos, positionCap, marketGate);
    const handoffDriver = waveL10TrendHandoff.applied ? waveL10TrendHandoff.reason : '';
    const expiryHandoffDriver = waveExpiryHandoff.applied ? waveExpiryHandoff.reason : '';
    const ma20PullbackDriver = waveMA20PullbackObservation.applied ? waveMA20PullbackObservation.reason : '';
    const b6TrendAddDriver = waveB6TrendAdd.applied ? waveB6TrendAdd.reason : '';
    const wavePositionStageDriver = wavePositionStage.limited ? wavePositionStage.reason : '';
    const wavePeakDriver = wavePeak.confirmed ? wavePeak.reason : '';
    const extraDrivers = [waveDriver, handoffDriver, expiryHandoffDriver, ma20PullbackDriver, b6TrendAddDriver, wavePositionStageDriver, wavePeakDriver].filter(Boolean).join('；');
    const positionDriver = extraDrivers ? `${basePositionDriver}${basePositionDriver ? '；' : ''}${extraDrivers}` : basePositionDriver;

    let simpleAction = '持币观望', simpleColorClass = 'text-dim', bsMark = null;
    if (position === 0) {
        if (prevPos > 0) { simpleAction = isCriticalExit ? '清仓离场' : '执行离场'; simpleColorClass = 'text-bear'; bsMark = 'S'; } 
        else { simpleAction = isCriticalExit ? '规避风险' : '持币观望'; simpleColorClass = isCriticalExit ? 'text-bear' : 'text-dim'; }
    } else if (position < prevPos) { simpleAction = '防守减仓'; simpleColorClass = 'text-warn'; } 
    else if (position > prevPos) { 
        if (prevPos === 0) { simpleAction = position <= 30 ? '轻仓建仓' : '积极建仓'; bsMark = 'B'; } 
        else { simpleAction = position <= 30 ? '缓慢加仓' : '顺势加仓'; }
        simpleColorClass = position <= 30 ? 'text-info' : 'text-bull';
    } else { 
        if (position <= 30) { simpleAction = (exit.level === '减仓观察' || exit.level === '延续防守' || meta.warningSignals?.length) ? '谨慎持有' : '轻仓持有'; simpleColorClass = simpleAction === '谨慎持有' ? 'text-warn' : 'text-info'; } 
        else { simpleAction = (meta.type === '📈 趋势抱单' && meta.buySignals.length === 0) ? '顺势抱单' : '积极持有'; simpleColorClass = 'text-bull'; }
    }
    const previousWindowScore = Number(full?.[idx - 1]?._decision?.windowScore);
    const invalidatedTodayScore = (meta.invalidatedWindowSignals || [])
        .filter(item => Number(item?.invalidationDay) === Number(idx))
        .reduce((sum, item) => sum + (Number(item?.score) || 0), 0);
    const decision = {
        basePosition: base,
        position,
        prevAdv: prevPos,
        trendRegime,
        waveContext,
        market,
        marketGate,
        targetStrength,
        risk,
        exit,
        positionCap,
        positionDriver,
        signalReady: meta.windowScore >= STRATEGY.buyThreshold,
        windowScore: meta.windowScore,
        previousWindowScore: Number.isFinite(previousWindowScore) ? previousWindowScore : meta.windowScore + invalidatedTodayScore,
        softSignalGrace,
        localStructureDefense,
        b11StructureDefense,
        wavePositionStage,
        waveShortRepair,
        wavePeak,
        waveB6TrendAdd,
        waveMA20PullbackObservation,
        waveExpiryHandoff,
        waveL10TrendHandoff,
        waveStandaloneL3Observation,
        waveRejectionProtection,
        previousSoftSignalGrace: !!full?.[idx - 1]?._decision?.softSignalGrace?.applied,
        simpleAction,
        simpleColorClass,
        bsMark
    };
    const bQuality = getWaveBQualityMetadata(meta, decision);
    return bQuality ? { ...decision, ...bQuality } : decision;
}

function getWaveExpiryB11TakeoverAddContext(idx, full, meta, prevPos, decision, strategy = STRATEGY) {
    const config = strategy?.waveExpiryB11TakeoverAdd;
    const empty = { eligible: false, applied: false, active: false, status: 'none', reason: '' };
    const sourcePosition = Math.max(0, Number(config?.sourcePosition) || 30);
    if (!config || state.strategy !== '波段抄底型' || state.period !== 'daily') return empty;
    if (config.stocksOnly !== false && state.mode !== 'stock') return empty;
    if (prevPos !== sourcePosition) return empty;

    const previousHandoff = full?.[idx - 1]?._decision?.waveExpiryHandoff;
    const invalidatedToday = [
        ...(meta?.invalidatedWindowSignals || []),
        ...(meta?.localBreakWindowSignals || [])
    ].some(item => Number(item?.invalidationDay) === Number(idx));
    const triggerSignal = config.triggerSignal || 'B11';
    const rawSignals = full?.[idx]?._signals || [];
    const shortPeriod = Math.max(1, Number(config.shortMovingAveragePeriod) || 5);
    const trendPeriod = Math.max(1, Number(config.trendMovingAveragePeriod) || 20);
    const slopeDays = Math.max(1, Number(config.trendSlopeLookbackDays) || 1);
    const close = Number(full?.[idx]?.close);
    const shortMA = Number(state.indicators?.ma?.[shortPeriod]?.[idx]);
    const trendMA = Number(state.indicators?.ma?.[trendPeriod]?.[idx]);
    const previousTrendMA = Number(state.indicators?.ma?.[trendPeriod]?.[idx - slopeDays]);
    const eligible = previousHandoff?.applied
        && previousHandoff.observationMode === 'defensive'
        && meta?.type === '📈 趋势抱单'
        && !meta?.inCooldown
        && !(meta?.exitSignals || []).length
        && !(meta?.warningSignals || []).length
        && decision?.exit?.level === '无明确离场'
        && !invalidatedToday
        && rawSignals.includes(triggerSignal)
        && [close, shortMA, trendMA, previousTrendMA].every(Number.isFinite)
        && close > shortMA
        && close > trendMA
        && trendMA >= previousTrendMA;
    if (!eligible) return empty;

    return {
        eligible: true,
        applied: false,
        active: false,
        status: 'eligible',
        reason: `到期防守观察后新触发${triggerSignal}，并重新站上MA${shortPeriod}/MA${trendPeriod}，允许30%基础仓增加20%波段仓`,
        sourcePosition,
        targetPosition: Math.max(sourcePosition, Number(config.targetPosition) || 50),
        basePosition: sourcePosition,
        extraPosition: Math.max(0, (Number(config.targetPosition) || 50) - sourcePosition),
        triggerSignal,
        triggerDay: idx,
        triggerDate: full?.[idx]?.date || '',
        shortMovingAveragePeriod: shortPeriod,
        trendMovingAveragePeriod: trendPeriod,
        shortMovingAverage: shortMA,
        trendMovingAverage: trendMA,
        previousTrendMovingAverage: previousTrendMA
    };
}

function computeWaveCandidateDecisionForIndex(idx, full, prevPos) {
    const actualDecision = computeBaseDecisionForIndex(idx, full, prevPos);
    const config = STRATEGY?.waveExpiryB11TakeoverAdd;
    const sourcePosition = Math.max(0, Number(config?.sourcePosition) || 30);
    const targetPosition = Math.max(sourcePosition, Number(config?.targetPosition) || 50);
    const previousLayer = full?.[idx - 1]?._decision?.waveExpiryB11TakeoverAdd;
    const inScope = !!config
        && state.strategy === '波段抄底型'
        && state.period === 'daily'
        && (config.stocksOnly === false || state.mode === 'stock');
    const layerActive = inScope && previousLayer?.active && prevPos > 0;

    if (layerActive) {
        const basePrevPosition = Number.isFinite(Number(previousLayer.basePosition))
            ? Number(previousLayer.basePosition)
            : sourcePosition;
        const baseDecision = computeBaseDecisionForIndex(idx, full, basePrevPosition);
        const baseLayerPosition = Number(baseDecision.position) || 0;
        const actualPosition = Number(actualDecision.position) || 0;
        const finalPosition = baseLayerPosition === sourcePosition
            ? Math.min(targetPosition, Math.max(baseLayerPosition, actualPosition))
            : baseLayerPosition;
        const fallbackToBase = finalPosition !== actualPosition
            || (baseLayerPosition !== sourcePosition && baseLayerPosition >= actualPosition);
        const overlayReleased = finalPosition <= baseLayerPosition || baseLayerPosition !== sourcePosition;
        const status = !overlayReleased
            ? 'holding'
            : (finalPosition <= 0 ? 'closed' : (baseLayerPosition > sourcePosition ? 'taken_over' : 'released'));
        const sourceDecision = fallbackToBase ? baseDecision : actualDecision;
        let simpleAction = sourceDecision.simpleAction;
        let simpleColorClass = sourceDecision.simpleColorClass;
        if (finalPosition < prevPos && finalPosition > 0) {
            simpleAction = '防守减仓';
            simpleColorClass = 'text-warn';
        } else if (finalPosition === prevPos && finalPosition > sourcePosition) {
            simpleAction = '积极持有';
            simpleColorClass = 'text-bull';
        }
        const layerReason = status === 'holding'
            ? `30%基础仓与${targetPosition - sourcePosition}%波段仓继续分层持有`
            : (status === 'released'
                ? `额外${targetPosition - sourcePosition}%波段仓先减，原30%基础仓继续按既有规则处理`
                : (status === 'taken_over' ? '原策略已形成更高基础仓位，结束波段分层' : '30%基础仓已失效，波段分层同步结束'));
        return {
            ...sourceDecision,
            position: finalPosition,
            prevAdv: prevPos,
            positionDriver: [sourceDecision.positionDriver, layerReason].filter(Boolean).join('；'),
            simpleAction,
            simpleColorClass,
            bsMark: baseDecision.bsMark,
            waveExpiryB11TakeoverAdd: {
                ...previousLayer,
                eligible: false,
                applied: false,
                active: status === 'holding',
                status,
                reason: layerReason,
                basePosition: baseLayerPosition,
                actualPosition,
                finalPosition,
                releaseDay: overlayReleased ? idx : null,
                releaseDate: overlayReleased ? (full?.[idx]?.date || '') : ''
            }
        };
    }

    const meta = getSignalMeta(idx, full, state.indicators);
    const addContext = getWaveExpiryB11TakeoverAddContext(idx, full, meta, prevPos, actualDecision, STRATEGY);
    if (!addContext.eligible) return { ...actualDecision, waveExpiryB11TakeoverAdd: addContext };

    let requestedPosition = addContext.targetPosition;
    const positionCap = getPositionCap(meta, prevPos, requestedPosition, idx, full, state.indicators);
    if (positionCap) requestedPosition = Math.min(requestedPosition, positionCap.limit);

    const productionMarketGate = applyMarketRiskGate(
        actualDecision.market,
        prevPos,
        requestedPosition,
        actualDecision.targetStrength
    );
    const marketException = false;
    const marketGate = productionMarketGate;
    requestedPosition = marketGate.position;

    const rejection = getWaveRejectionProtectionContext(idx, full, meta, prevPos, requestedPosition, STRATEGY, {
        trendRegime: actualDecision.trendRegime,
        waveContext: actualDecision.waveContext
    });
    if (Number.isFinite(Number(rejection.targetPosition))) {
        requestedPosition = Math.min(requestedPosition, Number(rejection.targetPosition));
    }
    const applied = requestedPosition > prevPos;
    const finalContext = {
        ...addContext,
        applied,
        active: applied,
        limited: !applied,
        status: applied ? 'holding' : 'limited',
        marketException,
        finalPosition: applied ? requestedPosition : actualDecision.position,
        productionMarketGateType: productionMarketGate.type,
        productionMarketGateCap: productionMarketGate.cap ?? null
    };
    if (!applied) return { ...actualDecision, waveExpiryB11TakeoverAdd: finalContext };

    return {
        ...actualDecision,
        position: requestedPosition,
        marketGate,
        positionCap,
        positionDriver: [actualDecision.positionDriver, addContext.reason].filter(Boolean).join('；'),
        simpleAction: '顺势加仓',
        simpleColorClass: 'text-bull',
        bsMark: actualDecision.bsMark,
        waveExpiryB11TakeoverAdd: finalContext
    };
}

function getWaveFreshGroupKeys(signals, strategy = STRATEGY) {
    return [...new Set((signals || [])
        .filter(signal => strategy?.buySignals?.includes(signal))
        .map(signal => getScoreGroupKey(strategy, signal)))];
}

function getWaveEntryDefenseContext(idx, full, waveContext, rawSignals, strategy = STRATEGY, options = {}) {
    const signalLow = Number(full?.[idx]?.low);
    const close = Number(full?.[idx]?.close);
    const pivot = findConfirmedPivotLow(full, idx, 120, 2);
    let localDefense = signalLow;
    const pivotValue = Number(pivot?.value);
    let hardDefense = Number.isFinite(pivotValue) && pivotValue < close ? pivotValue : signalLow;
    let supportSource = hardDefense === pivotValue ? 'confirmed-pivot' : 'signal-low';
    let recentB19Day = null;
    for (let day = idx; day >= Math.max(0, idx - Math.max(1, Number(strategy?.windowDays) || 10)); day--) {
        if ((full?.[day]?._signals || []).includes('B19')) { recentB19Day = day; break; }
    }
    if (rawSignals.includes('B11')) {
        const defense = getB11StructureDefense(idx, full, strategy);
        localDefense = Number(defense?.localLevel) || signalLow;
        hardDefense = Number(defense?.structureLevel) || signalLow;
        supportSource = defense?.structureLevel ? 'b11-structure' : 'b11-signal-low';
    } else if ((rawSignals.includes('B20') || Number.isInteger(recentB19Day)) && Number.isFinite(Number(waveContext?.boxSupport))) {
        hardDefense = Number(waveContext.boxSupport);
        supportSource = 'box-support';
    } else if (rawSignals.includes('B16')) {
        const weeks = typeof convertDailyToWeekly === 'function' ? getCalendarWeeksUntil(full, idx) : [];
        const weeklyPivot = weeks.length ? findConfirmedPivotLow(weeks, weeks.length - 1, 52, 1) : null;
        if (Number.isFinite(Number(weeklyPivot?.value)) && Number(weeklyPivot.value) > 0 && Number(weeklyPivot.value) < close) {
            hardDefense = Number(weeklyPivot.value);
            supportSource = 'weekly-support';
        }
    }
    if (options.freshEventRecovery && Number.isFinite(signalLow) && signalLow > 0) {
        localDefense = signalLow;
        hardDefense = signalLow;
        supportSource = 'event-recovery-signal-low';
    }
    const atr14 = Number(waveContext?.box?.atr14) || getWaveAtr14At(idx, full);
    // 首次低吸的距离检查使用当次信号局部失效位，避免把远处历史结构位误当作建仓日的唯一风险锚。
    // hardDefense 不变，仍由生命周期持有并负责后续结构硬失效；这里仅改变“能否建立30%试探仓”的检查。
    const useLocalDefenseForDistance = strategy?.waveRegimePolicy?.entry?.useLocalDefenseForDistance !== false;
    const hasUsableLocalDefense = Number.isFinite(localDefense) && Number.isFinite(close) && close > 0 && localDefense < close;
    const entryDefense = useLocalDefenseForDistance && hasUsableLocalDefense ? localDefense : hardDefense;
    const entryDefenseSource = useLocalDefenseForDistance && hasUsableLocalDefense ? 'local-signal' : supportSource;
    const distanceRatio = Number.isFinite(entryDefense) && close > 0 ? (close - entryDefense) / close : Infinity;
    const maxRatio = Math.min(
        Number(strategy?.waveRegimePolicy?.entry?.minimumDefenseDistanceRatio) || 0.06,
        Number.isFinite(atr14) && close > 0
            ? (Number(strategy?.waveRegimePolicy?.entry?.maximumDefenseAtr) || 2) * atr14 / close
            : 0.06
    );
    return {
        localDefense, hardDefense, entryDefense, supportSource, entryDefenseSource, distanceRatio, maximumDistanceRatio: maxRatio,
        acceptable: distanceRatio >= 0 && distanceRatio <= maxRatio
    };
}

function getWaveRegimeQualification(idx, full, meta, waveContext, rawSignals, strategy = STRATEGY) {
    const policy = strategy?.waveRegimePolicy || {};
    const item = full?.[idx] || {};
    const close = Number(item.close), low = Number(item.low), open = Number(item.open);
    const atr14 = Number(waveContext?.box?.atr14) || getWaveAtr14At(idx, full) || 0;
    const pivot = findConfirmedPivotLow(full, idx, 120, 2);
    const weeks = typeof convertDailyToWeekly === 'function' ? getCalendarWeeksUntil(full, idx) : [];
    const weeklyPivot = weeks.length ? findConfirmedPivotLow(weeks, weeks.length - 1, 52, 1) : null;
    const weeklySupport = Number(weeklyPivot?.value);
    const probeConfig = policy?.multiTimeframeBottomProbe || {};
    const weeklyDoubleBottom = getWeeklyDoubleBottomContext(full, idx, weeks, probeConfig.weeklyRepair || {});
    const weeklyBottom = Number(weeklyDoubleBottom?.details?.secondBottomValue);
    const supports = [Number(waveContext?.boxSupport), Number(pivot?.value), weeklySupport, weeklyBottom]
        .filter(value => Number.isFinite(value) && value > 0 && value <= close * 1.03);
    const support = supports.length ? Math.max(...supports) : null;
    const nearSupport = Number.isFinite(support)
        && low <= support + Math.max(atr14 * 0.75, support * 0.01)
        && close >= support;
    const scoreReady = Number(meta?.windowScore) >= Math.max(1, Number(policy?.entry?.minimumScore) || 4);
    const probeScoreReady = Number(meta?.windowScore) >= 3;
    const allowedProbeRegimes = Array.isArray(probeConfig.allowedRegimes) && probeConfig.allowedRegimes.length
        ? probeConfig.allowedRegimes
        : ['down', 'range', 'transition'];
    const multiTimeframeProbeQualified = probeConfig.stocksOnly !== false
        && state.mode === 'stock'
        && state.period === 'daily'
        && rawSignals.includes(probeConfig.dailySignal || 'B20')
        && weeklyDoubleBottom.candidate
        && allowedProbeRegimes.includes(waveContext?.regime)
        && nearSupport
        && probeScoreReady
        && !meta?.inCooldown
        && !(meta?.exitSignals || []).length
        && !(meta?.warningSignals || []).length;
    const freshGroups = getWaveFreshGroupKeys(rawSignals, strategy);
    const downSignal = rawSignals.some(signal => (policy?.down?.entrySignals || []).includes(signal));
    const scoredSignals = (meta?.windowScoreSignals || []).map(item => item?.signal).filter(Boolean);
    const downRepairSignals = new Set(policy?.down?.repairSignals || ['B7','B8','B9','B16','B17','B20']);
    const hasDownRepairSignal = rawSignals.some(signal => downRepairSignals.has(signal))
        || scoredSignals.some(signal => downRepairSignals.has(signal));
    const downRepairGroupsReady = freshGroups.length >= Math.max(2, Number(policy?.down?.minimumRepairGroups) || 2);
    // 下跌/过渡首次建仓资格必须由当日实证支撑：贴近支撑、当日新下跌入场信号、或当日新增≥2个计分组。
    // 仅凭窗口内历史记分信号（scoredDownSignal）不再单独放行——那批建仓当日无新证据，两日破位率最高。
    const downQualified = scoreReady
        && hasDownRepairSignal
        && (nearSupport || downSignal || downRepairGroupsReady);
    const boxSupport = Number(waveContext?.boxSupport);
    const edgeTolerance = atr14 * Math.max(0.1, Number(policy?.box?.edgeToleranceAtr) || 0.75);
    const rangeSignal = rawSignals.some(signal => (policy?.range?.entrySignals || []).includes(signal));
    const rangeQualified = waveContext?.box?.valid && Number.isFinite(boxSupport)
        && low <= boxSupport + edgeTolerance && close >= boxSupport && close >= open
        && scoreReady && rangeSignal;
    const ma20 = Number(state.indicators?.ma?.[20]?.[idx]);
    const previousMa20 = Number(state.indicators?.ma?.[20]?.[idx - 1]);
    const upSignal = rawSignals.some(signal => (policy?.up?.entrySignals || []).includes(signal));
    const upQualified = upSignal && [close, low, ma20, previousMa20].every(Number.isFinite)
        && ma20 >= previousMa20
        && low <= ma20 + Math.max(atr14 * 0.5, ma20 * 0.005)
        && close >= ma20;
    return {
        support,
        nearSupport,
        scoreReady,
        freshGroups,
        downQualified,
        downRepairQualified: downQualified && !nearSupport,
        rangeQualified,
        upQualified,
        weeklyDoubleBottom,
        multiTimeframeProbeQualified
    };
}

function getWaveGovernedAction(position, prevPos, candidate) {
    if (position <= 0) {
        if (prevPos > 0) return {
            simpleAction: ['清仓防守','强离场'].includes(candidate?.exit?.level) ? '清仓离场' : '执行离场',
            simpleColorClass: 'text-bear', bsMark: 'S'
        };
        return { simpleAction: candidate?.simpleAction === '规避风险' ? '规避风险' : '持币观望', simpleColorClass: candidate?.simpleAction === '规避风险' ? 'text-bear' : 'text-dim', bsMark: null };
    }
    if (position < prevPos) return { simpleAction: '防守减仓', simpleColorClass: 'text-warn', bsMark: null };
    if (position > prevPos) {
        if (prevPos <= 0) return { simpleAction: position <= 30 ? '轻仓建仓' : '积极建仓', simpleColorClass: position <= 30 ? 'text-info' : 'text-bull', bsMark: 'B' };
        return { simpleAction: position <= 30 ? '缓慢加仓' : '顺势加仓', simpleColorClass: position <= 30 ? 'text-info' : 'text-bull', bsMark: null };
    }
    return position <= 30
        ? { simpleAction: candidate?.simpleAction === '谨慎持有' ? '谨慎持有' : '轻仓持有', simpleColorClass: candidate?.simpleAction === '谨慎持有' ? 'text-warn' : 'text-info', bsMark: null }
        : { simpleAction: candidate?.simpleAction === '顺势抱单' ? '顺势抱单' : '积极持有', simpleColorClass: 'text-bull', bsMark: null };
}

function applyWaveRegimeGovernance(idx, full, prevPos, candidate, strategy = STRATEGY) {
    const waveContext = candidate?.waveContext;
    if (!waveContext?.inScope) return candidate;
    const policy = strategy.waveRegimePolicy;
    const meta = getSignalMeta(idx, full, state.indicators);
    const rawSignals = full?.[idx]?._signals || [];
    const previousLifecycle = full?.[idx - 1]?._decision?.waveContext?.lifecycle;
    const item = full?.[idx] || {};
    const close = Number(item.close), low = Number(item.low), high = Number(item.high), open = Number(item.open);
    const ma20 = Number(state.indicators?.ma?.[20]?.[idx]);
    const previousHigh = Number(full?.[idx - 1]?.high);
    const qualification = getWaveRegimeQualification(idx, full, meta, waveContext, rawSignals, strategy);
    const shortRepairConfirmation = candidate?.waveShortRepair?.qualified
        && candidate?.wavePositionStage?.stage === 'confirmation'
        && Number(candidate?.wavePositionStage?.allowedPosition) >= 50;
    const priceHardInvalidations = getTodaySignalInvalidations(meta, 'price-break');
    const barRange = high - low;
    const upperShadow = high - Math.max(open, close);
    const rangeUpperFailure = waveContext.regime === 'range'
        && Number.isFinite(Number(waveContext.boxPressure))
        && barRange > 0
        && high >= Number(waveContext.boxPressure) * 0.99
        && upperShadow / barRange >= 0.35
        && (close - low) / barRange <= 0.5
        && rawSignals.some(signal => ['L5','L10','W2','W3'].includes(signal));
    const directExitSignals = meta?.exitSignals || [];
    const standaloneRangeL10 = rangeUpperFailure
        && directExitSignals.length === 1
        && directExitSignals[0] === 'L10'
        && priceHardInvalidations.length === 0;
    const eventStatus = candidate?.waveRejectionProtection?.status;
    const eventType = candidate?.waveRejectionProtection?.eventType;
    // 兼容旧缓存时忽略已经废弃的 risk_cap_zero_exit；只有现行结构/离场事件才能触发治理清仓。
    const recognizedEventType = new Set([
        'entry_day_pressure_rejection',
        'fresh_entry_failure',
        'fresh_entry_ma20_hold',
        'fresh_entry_downside_failure',
        'fresh_entry_hard_break',
        'signal_hard_invalidation',
        'structure_hard_break',
        'mature_profit_rejection'
    ]).has(eventType);
    let position = Number(candidate?.position) || 0;
    let waveRejectionProtection = candidate?.waveRejectionProtection || {
        active: false,
        status: 'none',
        targetPosition: position
    };
    let lifecycle = previousLifecycle && prevPos > 0 ? { ...previousLifecycle } : null;
    const structureSupportHolds = lifecycle
        && Number.isFinite(Number(lifecycle.hardDefense))
        && Number.isFinite(close)
        && close >= Number(lifecycle.hardDefense);
    // 信号硬失效只代表局部防守位失守；结构支撑仍在时保留30%观察，不升级为硬风险清仓。
    const eventHardRisk = recognizedEventType && ['triggered','locked','entry_blocked'].includes(eventStatus)
        && !(eventType === 'signal_hard_invalidation' && structureSupportHolds);
    const hardRisk = candidate?.exit?.level === '清仓防守'
        || candidate?.simpleAction === '规避风险'
        || meta?.inCooldown
        || eventHardRisk;
    const signalBreakOnly = priceHardInvalidations.length > 0
        && structureSupportHolds
        && !hardRisk;
    const hardInvalidation = (priceHardInvalidations.length > 0 && !signalBreakOnly)
        || hardRisk
        || (candidate?.exit?.level === '强离场' && !standaloneRangeL10);
    let governanceReason = '';

    // 迁移期不为历史持仓倒推建仓事实；只有新治理创建的生命周期才接管后续加减仓。
    if (prevPos > 0 && !lifecycle) {
        if (hardInvalidation) {
            position = 0;
            governanceReason = '既有持仓触发数据/硬风险或结构硬失效，仓位归零';
        } else {
            const cap = Number(policy?.positionCaps?.[waveContext.regime]);
            const noIncreasePosition = Math.min(position, prevPos);
            position = waveContext.regime === 'unknown' || !Number.isFinite(cap)
                ? noIncreasePosition
                : Math.min(noIncreasePosition, cap);
            governanceReason = waveContext.regime === 'unknown'
                ? '环境未知不新增风险；既有持仓保留原决策与风险保护'
                : `既有持仓不倒推生命周期，按${waveContext.regimeLabel}环境上限降至${position}%以内`;
        }
        position = quantizePosition(position);
        const action = getWaveGovernedAction(position, prevPos, candidate);
        return {
            ...candidate, position, prevAdv: prevPos, ...action,
            waveGovernanceVersion: WAVE_GOVERNANCE_VERSION,
            positionDriver: [candidate.positionDriver, governanceReason].filter(Boolean).join('；'),
            waveContext: {
                ...waveContext,
                lifecycle: null,
                stage: position > 0 ? 'legacy-holding' : 'flat',
                positionLayer: position,
                frozenLocalDefense: null,
                frozenHardDefense: null,
                supportSource: '',
                mainEvent: governanceReason,
                nextCondition: '下一次重新建仓时按当前环境创建冻结防守位'
            }
        };
    }

    if (lifecycle && Number.isFinite(Number(lifecycle.hardDefense)) && close < Number(lifecycle.hardDefense)) {
        position = 0;
        governanceReason = '收盘跌破冻结硬防守位' + formatPriceLevel(Number(lifecycle.hardDefense)) + '，结构失效归零';
        const recoveryCloseLevel = Math.max(
            Number(lifecycle.hardDefense),
            Number.isFinite(high) ? high : Number(lifecycle.hardDefense)
        );
        // 结构硬失效不能在下一交易日用旧积分立即重建仓位；复用已有风险事件锁定链，
        // 上涨/横盘可走新的 B6/B11 回踩恢复，下跌/过渡仍需先收复风险事件高点。
        waveRejectionProtection = {
            active: true,
            status: 'triggered',
            eventType: 'structure_hard_break',
            triggerDay: idx,
            triggerDate: item.date || '',
            triggerHigh: recoveryCloseLevel,
            triggerLow: low,
            triggerClose: close,
            recoveryCloseLevel,
            sourcePosition: prevPos,
            targetPosition: 0,
            recoveryPending: false,
            recoveryHoldRemaining: 0,
            hardDefense: Number(lifecycle.hardDefense)
        };
    } else if (hardInvalidation) {
        position = 0;
        governanceReason = '数据/硬风险或结构硬失效优先，仓位归零';
    } else if (prevPos <= 0 && position > 0) {
        const eventRecovery = ['released','recovery_started','recovery_hold'].includes(candidate?.waveRejectionProtection?.status)
            && candidate?.waveRejectionProtection?.allowRecoveryIncrease !== false;
        const multiTimeframeProbe = qualification.multiTimeframeProbeQualified;
        const regimeQualified = multiTimeframeProbe
            || (waveContext.regime === 'down' ? qualification.downQualified
                : (waveContext.regime === 'range' ? qualification.rangeQualified
                    : (waveContext.regime === 'up' ? qualification.upQualified
                        : (waveContext.regime === 'transition' ? qualification.downQualified || qualification.rangeQualified : false))))
            || eventRecovery;
        const defense = getWaveEntryDefenseContext(idx, full, waveContext, rawSignals, strategy, {
            freshEventRecovery: eventRecovery
        });
        if (!regimeQualified || !defense.acceptable || waveContext.regime === 'unknown') {
            position = 0;
            governanceReason = !regimeQualified ? waveContext.regimeLabel + '环境未满足首次建仓资格' : '冻结硬防守位距离建仓价过远，否决交易';
        } else {
            const shortRepairEntry = shortRepairConfirmation && candidate?.wavePositionStage?.previousPosition <= 0;
            const entryPosition = shortRepairEntry ? 50 : 30;
            position = entryPosition;
            lifecycle = {
                active: true, entryRegime: waveContext.regime, entrySignals: [...rawSignals],
                entrySignalGroups: qualification.freshGroups, entryDay: idx, entryDate: item.date || '',
                entryClose: close, localDefense: defense.localDefense, hardDefense: defense.hardDefense,
                entryDefense: defense.entryDefense, entryDefenseSource: defense.entryDefenseSource,
                supportSource: defense.supportSource,
                entryMode: multiTimeframeProbe ? 'multi-timeframe-double-bottom-probe' : 'regime-qualified',
                stage: entryPosition >= 50 ? 'confirmation' : 'entry', positionLayer: entryPosition, upperObservation: null,
                breakoutPressure: waveContext.regime === 'range' ? waveContext.boxPressure : null, breakoutRetested: false
            };
            const entryDefenseText = Number.isFinite(Number(defense.entryDefense))
                ? `${defense.entryDefenseSource === 'local-signal' ? '局部防守位' : '结构防守位'}${formatPriceLevel(Number(defense.entryDefense))}`
                : '局部防守位';
            const structuralDefenseText = Number.isFinite(Number(defense.hardDefense))
                && Number(defense.hardDefense) !== Number(defense.entryDefense)
                ? `，结构硬防守位${formatPriceLevel(Number(defense.hardDefense))}作为二级失效线`
                : '';
            governanceReason = shortRepairEntry
                ? `${candidate.waveShortRepair.reason}，建立50%确认仓并冻结防守位`
                : multiTimeframeProbe
                ? '周线双底候选与日线B20共振，建立30%试探仓并冻结防守位'
                : eventRecovery
                ? '事件后新信号完成恢复资格，建立30%试探仓并重新冻结防守位'
                : (waveContext.regime === 'down' && qualification.downRepairQualified
                    ? `下跌环境修复信号达到试探资格，按${entryDefenseText}通过距离检查，建立30%试探仓并冻结防守位${structuralDefenseText}`
                    : `${waveContext.regimeLabel}环境资格成立，按${entryDefenseText}通过距离检查，建立30%试探仓并冻结防守位${structuralDefenseText}`);
        }
    } else if (prevPos > 0) {
        if (signalBreakOnly) {
            position = prevPos;
            const defenseLabel = lifecycle.supportSource === 'signal-low' ? '底部防守位' : '底部结构支撑';
            governanceReason = `买入信号防守位失效但${defenseLabel}${formatPriceLevel(Number(lifecycle.hardDefense))}未破，保留${position}%试探仓观察`;
        }
        const pivot = findConfirmedPivotLow(full, idx, 120, 2);
        // 棘轮上移必须给收盘价留出最小缓冲：缓冲不足说明新防守位已进入当日噪音带，本次不上移，等价格拉开距离后再抬。
        const ratchetAtr14 = Number(waveContext?.box?.atr14) || getWaveAtr14At(idx, full);
        const ratchetBuffer = Number.isFinite(ratchetAtr14) && ratchetAtr14 > 0
            ? ratchetAtr14 * Math.max(0, Number(policy?.ratchet?.minimumBufferAtr) || 0)
            : 0;
        if (lifecycle && Number.isFinite(Number(pivot?.value)) && Number(pivot.value) > Number(lifecycle.hardDefense)
            && Number(pivot.value) < close && Number(pivot.value) <= close - ratchetBuffer) {
            lifecycle.hardDefense = Number(pivot.value);
            lifecycle.supportSource = 'confirmed-pivot-ratchet';
        }
        if (lifecycle && Number.isFinite(Number(lifecycle.breakoutPressure)) && low <= Number(lifecycle.breakoutPressure) * 1.01 && close >= Number(lifecycle.breakoutPressure)) lifecycle.breakoutRetested = true;
        const entryAge = lifecycle ? idx - Number(lifecycle.entryDay) : 0;
        const differentFreshGroup = qualification.freshGroups.some(group => !(lifecycle?.entrySignalGroups || []).includes(group));
        const rangeConfirm = waveContext.regime === 'range' && prevPos === 30 && entryAge >= 2
            && differentFreshGroup && close >= Math.max(ma20 || -Infinity, previousHigh || -Infinity) && close >= Number(waveContext.boxSupport);
        const upConfirm = waveContext.regime === 'up' && prevPos === 30 && entryAge >= 2
            && rawSignals.some(signal => (policy?.up?.confirmationSignals || []).includes(signal)) && close >= ma20;
        const upTrend = waveContext.regime === 'up' && prevPos === 50
            && rawSignals.some(signal => (policy?.up?.trendSignals || []).includes(signal))
            && (lifecycle?.entryRegime === 'up' || lifecycle?.breakoutRetested);
        if (position > prevPos) {
            if (shortRepairConfirmation) position = 50;
            else if (waveContext.regime === 'range') position = rangeConfirm ? 50 : prevPos;
            else if (waveContext.regime === 'up') position = upTrend ? 80 : (upConfirm ? 50 : prevPos);
            else position = prevPos;
            governanceReason = position > prevPos
                ? (shortRepairConfirmation
                    ? candidate.waveShortRepair.reason
                    : waveContext.regimeLabel + '环境出现新的分层确认，仓位提高至' + position + '%')
                : waveContext.regimeLabel + '环境尚无新的分层确认，不加仓';
        }
        if (waveContext.regime === 'range' && Number.isFinite(Number(waveContext.boxPressure))) {
            if (rangeUpperFailure) {
                position = prevPos > 30 ? getLowerWavePositionStep(prevPos) : 30;
                if (lifecycle) lifecycle.upperObservation = { triggerDay: idx, triggerDate: item.date || '', midpoint: waveContext.boxMidpoint };
                governanceReason = '箱体上沿长上影弱收盘并伴随转弱证据，先退出一层；30%进入一日观察';
            } else if (lifecycle?.upperObservation && idx === Number(lifecycle.upperObservation.triggerDay) + 1) {
                const reclaimLevel = Math.max(ma20 || -Infinity, Number(lifecycle.upperObservation.midpoint) || -Infinity);
                if (close < reclaimLevel) { position = 0; governanceReason = '箱体上沿失败观察后仍未站回MA20/箱体中轴，清仓'; }
                else lifecycle.upperObservation = null;
            }
        }
        const ordinaryUpWeakness = waveContext.regime === 'up'
            && position <= 0
            && !hardInvalidation
            && !meta?.inCooldown
            && !['triggered','locked','entry_blocked'].includes(candidate?.waveRejectionProtection?.status);
        if (ordinaryUpWeakness) {
            position = getLowerWavePositionStep(prevPos);
            governanceReason = '上涨环境普通转弱按层级退出，未出现结构硬破不直接归零';
        }
        // 波峰确认防守：触及日线/周线压力并出现长上影弱收盘时，已有仓位最多降一个档位；压力位本身不清仓，也不生成新的S。
        if (candidate?.wavePeak?.confirmed === true && position > 0) {
            const peakStep = Math.max(30, getLowerWavePositionStep(prevPos));
            if (position > peakStep) {
                position = peakStep;
                governanceReason = (candidate.wavePeak.reason || '触及日线或周线压力并出现长上影弱收盘，按波峰确认防守')
                    + (position < prevPos ? '，已有仓位降至' : '，本日不加仓并保持') + position + '%';
            }
        }
        const cap = Number(policy?.positionCaps?.[waveContext.regime]);
        const effectiveCap = shortRepairConfirmation ? Math.max(50, cap) : cap;
        if (waveContext.regime !== 'unknown' && Number.isFinite(effectiveCap)) position = Math.min(position, effectiveCap);
        if (lifecycle && position > 0) { lifecycle.stage = position === 80 ? 'trend' : (position === 50 ? 'confirmation' : 'entry'); lifecycle.positionLayer = position; }
    }

    position = quantizePosition(position);
    if (position <= 0) lifecycle = null;
    const action = getWaveGovernedAction(position, prevPos, candidate);
    const nextCondition = shortRepairConfirmation && position >= 50
        ? '保持MA5/MA20回踩修复；若跌破结构防守位或出现离场信号则降仓'
        : (waveContext.regime === 'down' ? '等待环境转为横盘或上涨后再申请50%'
        : (waveContext.regime === 'range' ? '守住箱体支撑，并等待不同计分组的新信号站上MA20/前高'
            : (waveContext.regime === 'up' ? '等待新的B6/B11确认或B4/B14趋势延续事件' : '等待环境完成确认')));
    return {
        ...candidate, position, prevAdv: prevPos, ...action,
        waveRejectionProtection,
        waveGovernanceVersion: WAVE_GOVERNANCE_VERSION,
        positionDriver: [candidate.positionDriver, governanceReason].filter(Boolean).join('；'),
        waveContext: {
            ...waveContext,
            multiTimeframeBottomProbe: qualification.multiTimeframeProbeQualified
                ? {
                    qualified: true,
                    dailySignal: policy?.multiTimeframeBottomProbe?.dailySignal || 'B20',
                    weeklyDate: qualification.weeklyDoubleBottom?.date || '',
                    weeklyDetails: qualification.weeklyDoubleBottom?.details || null,
                    provisional: qualification.weeklyDoubleBottom?.provisional === true
                }
                : null,
            lifecycle, stage: lifecycle?.stage || (position > 0 ? 'holding' : 'flat'), positionLayer: position,
            frozenLocalDefense: lifecycle?.localDefense ?? null, frozenHardDefense: lifecycle?.hardDefense ?? null,
            entryDefense: lifecycle?.entryDefense ?? null, entryDefenseSource: lifecycle?.entryDefenseSource || '',
            supportSource: lifecycle?.supportSource || '', mainEvent: governanceReason, nextCondition
        }
    };
}

function computeDecisionForIndex(idx, full, prevPos) {
    const candidate = computeWaveCandidateDecisionForIndex(idx, full, prevPos);
    const decision = applyWaveRegimeGovernance(idx, full, prevPos, candidate, STRATEGY);
    return decision?.waveContext?.inScope
        ? { ...decision, waveGovernanceVersion: WAVE_GOVERNANCE_VERSION }
        : decision;
}

function isCurrentDecisionGovernanceVersion(decision, options = {}) {
    const inScope = options.waveStockDaily === true
        || (state.strategy === '波段抄底型' && state.mode === 'stock' && state.period === 'daily');
    return !inScope || decision?.waveGovernanceVersion === WAVE_GOVERNANCE_VERSION;
}

function isCurrentDerivedDecisionCache(cached, options = {}) {
    if (!cached) return false;
    const inScope = options.waveStockDaily === true
        || (state.strategy === '波段抄底型' && state.mode === 'stock' && state.period === 'daily');
    return !inScope || (
        cached.decisionGovernanceVersion === WAVE_GOVERNANCE_VERSION
        && isCurrentDecisionGovernanceVersion(cached.rows?.[cached.rows.length - 1]?._decision, { waveStockDaily: true })
    );
}

function getWeeklyDirectionContext(idx, full, ind) {
    const item = full[idx] || {}, close = item?.close || 0, ma20 = ind.ma?.[20]?.[idx], ma60 = ind.ma?.[60]?.[idx], prevMa20 = ind.ma?.[20]?.[Math.max(0, idx - 2)] || ma20;
    const recent = full.slice(Math.max(0, idx - 19), idx + 1), high20 = recent.length ? Math.max(...recent.map(d => d.high)) : close, low20 = recent.length ? Math.min(...recent.map(d => d.low)) : close;
    const distMA20 = ma20 ? (close - ma20) / ma20 : 0;
    
    let direction = '方向不明', directionReason = '周线样本不足，暂不判断大方向';
    if (ma20 && ma60) {
        if (close > ma20 && ma20 > ma60 && ma20 >= prevMa20) { direction = '周线多头'; directionReason = '价格站上20周与60周均线，20周均线保持上行'; } 
        else if (close < ma20 && ma20 < ma60 && ma20 <= prevMa20) { direction = '周线空头'; directionReason = '价格位于20周与60周均线下方，趋势仍偏防守'; } 
        else { direction = '周线震荡'; directionReason = '均线结构尚未形成清晰共振'; }
    }
    
    let position = '位置中性';
    if (distMA20 > 0.12 || close >= high20 * 0.96) position = '偏高，追涨性价比下降';
    else if (distMA20 < -0.08 || close <= low20 * 1.06) position = '靠近防守区，等待修复';
    else if (Math.abs(distMA20) <= 0.03) position = '贴近20周均线，方向选择临近';
    
    let repair = '未修复'; if (ma20) { if (close > ma20 && ma20 >= prevMa20) repair = '已修复'; else if (close > ma20) repair = '修复中'; }
    return { direction, directionReason, position, repair, dailyImpact: direction === '周线多头' ? '日线买点可信度提高，可关注回踩后的确认' : direction === '周线空头' ? '日线买点降权，优先等待周线重新站回' : '只适合轻仓观察，避免把震荡当趋势', ma20, ma60, support: low20, pressure: high20, distMA20 };
}

function buildIndicatorKeyForData(id, period, strategy, data) {
    if(!data || !data.length) return ''; const last = data[data.length - 1];
    const dataSig = data.map((item, idx) => {
        item = item || {};
        return [idx, item.date || '', item.open, item.high, item.low, item.close, item.vol, item.amt].join(':');
    }).join('|');
    return `${id}_${period}_${strategy}_${data.length}_${last.date}_${last.close}_${hashString32(dataSig)}`;
}

function getIndicatorKey(data = getActiveData()) {
    return buildIndicatorKeyForData(state.id, state.period, state.strategy, data);
}

function storeDerivedIndicatorCache(id, period, strategy, data, indicators) {
    if (!id || !period || !strategy || !data?.length || !indicators?.macd || !indicators?.rsi || !indicators?.kdj) return;
    const cacheKey = buildIndicatorKeyForData(id, period, strategy, data);
    if (!cacheKey) return;
    derivedIndicatorCache.set(cacheKey, {
        decisionGovernanceVersion: WAVE_GOVERNANCE_VERSION,
        indicators: {
            ma: { ...(indicators.ma || {}) },
            macd: indicators.macd,
            rsi: indicators.rsi,
            kdj: indicators.kdj
        },
        rows: data.map(item => item ? ({
            _signals: item._signals,
            _signalVersion: item._signalVersion,
            _strategy: item._strategy,
            _decision: item._decision
        }) : null)
    });
    if (derivedIndicatorCache.size > SYS_CONFIG.RENDER_CACHE_SIZE) {
        derivedIndicatorCache.delete(derivedIndicatorCache.keys().next().value);
    }
}

function markIndicatorsDirty() { state.indicatorKey = ''; }

function resetIndicatorState() {
    state.indicators = { ma: {}, macd: null, rsi: null, kdj: null };
    state.pendingIndicatorMutation = { mode: 'full', startIdx: 0 };
    markIndicatorsDirty();
}

function updateAllIndicators(incrementalIdx = -1) {
    const perfTrace = PERF.start('updateAllIndicators', { id: state.id, period: state.period, strategy: state.strategy, incrementalIdx });
    const full = getActiveData();
    if(!full || !full.length) {
        PERF.end(perfTrace, { status: 'empty' });
        return;
    }
    const nextKey = getIndicatorKey(full);
    const pendingMutation = state.pendingIndicatorMutation;
    if (incrementalIdx === -1 && pendingMutation?.mode !== 'market-only' && state.indicatorKey === nextKey && state.indicators.macd && state.indicators.rsi && state.indicators.kdj
        && isCurrentDecisionGovernanceVersion(full[full.length - 1]?._decision)) {
        PERF.end(perfTrace, { status: 'unchanged-key', points: full.length });
        return;
    }
    const cacheKey = nextKey;

    const mutation = incrementalIdx >= 0
        ? { mode: 'incremental', startIdx: incrementalIdx }
        : (state.pendingIndicatorMutation || { mode: 'full', startIdx: 0 });
    const isStrategyOnlyMutation = mutation.mode === 'strategy-only' &&
        state.indicators.macd &&
        state.indicators.rsi &&
        state.indicators.kdj &&
        state.indicators.ma;
    const isMarketOnlyMutation = mutation.mode === 'market-only' &&
        state.indicators.macd &&
        state.indicators.rsi &&
        state.indicators.kdj &&
        state.indicators.ma;
    const shouldFullRebuild = !isStrategyOnlyMutation && !isMarketOnlyMutation &&
        (!state.indicators.macd || full.length < 60 || mutation.mode === 'full');

    if (mutation.mode === 'unchanged' && state.indicators.macd && isCurrentDecisionGovernanceVersion(full[full.length - 1]?._decision)) {
        state.indicatorKey = nextKey;
        state.pendingIndicatorMutation = null;
        PERF.end(perfTrace, { status: 'unchanged-mutation', points: full.length });
        return;
    }

    if (incrementalIdx === -1 && !isMarketOnlyMutation && (mutation.mode === 'full' || mutation.mode === 'strategy-only')
        && isCurrentDerivedDecisionCache(derivedIndicatorCache.get(cacheKey))) {
        const cached = derivedIndicatorCache.get(cacheKey);
        state.indicators.ma = cached.indicators.ma;
        state.indicators.macd = cached.indicators.macd;
        state.indicators.rsi = cached.indicators.rsi;
        state.indicators.kdj = cached.indicators.kdj;
        for (let i = 0; i < full.length; i++) {
            if (!full[i] || !cached.rows[i]) continue;
            full[i]._signals = cached.rows[i]._signals;
            full[i]._signalVersion = cached.rows[i]._signalVersion;
            full[i]._strategy = cached.rows[i]._strategy;
            full[i]._decision = cached.rows[i]._decision;
        }
        state.indicatorKey = nextKey;
        state.pendingIndicatorMutation = null;
        PERF.end(perfTrace, { status: 'derived-cache', points: full.length });
        return;
    }

    const calcStart = shouldFullRebuild ? 0 : Math.max(0, mutation.startIdx || 0);
    if (!isStrategyOnlyMutation && !isMarketOnlyMutation) {
        MA_OPTIONS.forEach(n => {
            state.indicators.ma[n] = shouldFullRebuild
                ? Calcs.ma(full, n)
                : Calcs.maIncremental(full, n, state.indicators.ma?.[n], calcStart);
        });
        state.indicators.macd = shouldFullRebuild
            ? Calcs.macd(full)
            : Calcs.macdIncremental(full, state.indicators.macd, calcStart);
        state.indicators.rsi = shouldFullRebuild
            ? Calcs.rsi(full)
            : Calcs.rsiIncremental(full, state.indicators.rsi, 14, calcStart);
        state.indicators.kdj = shouldFullRebuild
            ? Calcs.kdj(full)
            : Calcs.kdjIncremental(full, state.indicators.kdj, 9, calcStart);
    }
    PERF.mark(perfTrace, 'base-indicators', { skipped: !!(isStrategyOnlyMutation || isMarketOnlyMutation), fullRebuild: !!shouldFullRebuild, calcStart });
    const weeklySignalContexts = shouldFullRebuild ? buildWeeklySignalContexts(full) : null;
    PERF.mark(perfTrace, 'weekly-signal-context', { precomputed: !!weeklySignalContexts, points: weeklySignalContexts?.length || 0 });

    const isLatestOnlyMutation = !shouldFullRebuild &&
        mutation.mode === 'incremental' &&
        (mutation.startIdx || 0) >= full.length - 1 &&
        full.length > 1 &&
        full[full.length - 2]?._decision &&
        full[full.length - 2]?._strategy === state.strategy &&
        full[full.length - 2]?._signalVersion === SIGNAL_VERSION &&
        isCurrentDecisionGovernanceVersion(full[full.length - 2]?._decision);
    const rebuildStart = isStrategyOnlyMutation || isMarketOnlyMutation
        ? 0
        : shouldFullRebuild
        ? 0
        : (isLatestOnlyMutation ? full.length - 1 : Math.max(0, Math.min(full.length - 1, mutation.startIdx || 0) - DECISION_REBUILD_LOOKBACK));

    let prevPos = 0;
    if (!shouldFullRebuild && rebuildStart > 0) {
        prevPos = full[rebuildStart - 1]?._decision?.position || 0;
    }

    let signalMs = 0;
    let decisionMs = 0;
    let reusedRows = 0;
    let signalRows = 0;
    let decisionRows = 0;
    const signalBreakdown = { contextMs: 0, ruleMs: {}, ruleChecks: {}, ruleHits: {} };
    for(let i = shouldFullRebuild ? 0 : rebuildStart; i < full.length; i++) {
        if (!isMarketOnlyMutation && full[i]?._signals && full[i]._signalVersion === SIGNAL_VERSION && full[i]._strategy === state.strategy
            && full[i]._decision && isCurrentDecisionGovernanceVersion(full[i]._decision)) {
            prevPos = full[i]._decision.position;
            reusedRows += 1;
            continue;
        }
        if (full[i]) {
            if (!full[i]._signals || full[i]._signalVersion !== SIGNAL_VERSION) {
                const signalStarted = performance.now();
                full[i]._signals = calculateDailySignals(i, full, state.indicators, signalBreakdown, weeklySignalContexts?.[i] || null);
                signalMs += performance.now() - signalStarted;
                signalRows += 1;
            }
            full[i]._signalVersion = SIGNAL_VERSION;
            full[i]._strategy = state.strategy;
            const decisionStarted = performance.now();
            full[i]._decision = computeDecisionForIndex(i, full, prevPos);
            decisionMs += performance.now() - decisionStarted;
            decisionRows += 1;
            prevPos = full[i]._decision.position;
        }
    }
    signalBreakdown.contextMs = Number(signalBreakdown.contextMs.toFixed(1));
    Object.keys(signalBreakdown.ruleMs).forEach(id => {
        signalBreakdown.ruleMs[id] = Number(signalBreakdown.ruleMs[id].toFixed(1));
    });
    PERF.mark(perfTrace, 'decision-loop', {
        rebuildStart,
        signalMs: Number(signalMs.toFixed(1)),
        decisionMs: Number(decisionMs.toFixed(1)),
        signalRows,
        decisionRows,
        reusedRows,
        signalBreakdown
    });

    state.indicatorKey = nextKey;
    state.pendingIndicatorMutation = null;
    storeDerivedIndicatorCache(state.id, state.period, state.strategy, full, state.indicators);
    PERF.mark(perfTrace, 'cache-store');
    PERF.end(perfTrace, { status: shouldFullRebuild ? 'full' : mutation.mode, points: full.length });
}
