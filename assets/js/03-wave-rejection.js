// [3E] 波段建仓否决与风险事件保护 (Wave Entry Veto & Rejection Protection)
function getWaveEntryDayPressureVetoContext(idx, full, meta, prevPos, targetPosition, strategy = STRATEGY) {
    const protection = strategy?.waveRejectionProtection;
    const config = protection?.entryDayPressureVeto;
    const empty = { active: false, status: 'none', targetPosition };
    if (!config || state.strategy !== '波段抄底型' || state.period !== 'daily'
        || (config.stocksOnly !== false && state.mode !== 'stock') || prevPos > 0 || targetPosition <= 0) return empty;

    const item = full?.[idx] || {};
    const open = Number(item.open);
    const high = Number(item.high);
    const low = Number(item.low);
    const close = Number(item.close);
    const range = high - low;
    if (![open, high, low, close].every(Number.isFinite) || range <= 0) return empty;
    if (open < low || open > high || close < low || close > high) return empty;

    const ma20 = Number(state.indicators?.ma?.[20]?.[idx]);
    const ma60 = Number(state.indicators?.ma?.[60]?.[idx]);
    const slopeDays = Math.max(1, Number(config.movingAverageSlopeLookbackDays) || 5);
    const previousMa20 = Number(state.indicators?.ma?.[20]?.[idx - slopeDays]);
    const hasMediumDowntrend = [ma20, ma60, previousMa20].every(Number.isFinite)
        && ma20 < ma60
        && ma20 < previousMa20;
    if (config.requireMediumDowntrend !== false && !hasMediumDowntrend) return empty;

    const upperShadow = high - Math.max(open, close);
    const lowerShadow = Math.min(open, close) - low;
    const upperShadowRangeRatio = upperShadow / range;
    const closeLocation = (close - low) / range;
    if (upperShadowRangeRatio < Number(config.minimumUpperShadowRangeRatio || 0)
        || closeLocation > Number(config.maximumCloseLocation ?? 1)
        || (config.requireUpperShadowDominance && upperShadow <= lowerShadow)) return empty;

    const pressure = getWaveFreshEntryPressureContext(idx, full, state.indicators, config);
    const pressureSources = pressure.sources.filter(source =>
        source?.type === 'ma'
        && Number.isFinite(Number(source.level))
        && close < Number(source.level)
    );
    if (!pressureSources.length) return empty;

    const sourceSignals = (meta?.windowScoreSignals || [])
        .filter(signal => Number(signal?.day) === Number(idx))
        .map(signal => signal.signal);
    return {
        active: true,
        status: 'entry_blocked',
        eventType: 'entry_day_pressure_rejection',
        triggerDay: idx,
        triggerDate: item.date || '',
        triggerHigh: high,
        triggerLow: low,
        triggerClose: close,
        entryClose: close,
        entryDay: idx,
        entryDate: item.date || '',
        entryAge: 0,
        entrySignalLow: low,
        sourceSignals,
        sourcePosition: 0,
        targetPosition: 0,
        upperShadowBodyRatio: Math.abs(close - open) > 0 ? upperShadow / Math.abs(close - open) : null,
        upperShadowRangeRatio,
        lowerShadow,
        closeLocation,
        pressureSources,
        mediumDowntrend: hasMediumDowntrend,
        recoveryPending: false,
        recoveryHoldRemaining: 0
    };
}

function getWaveRejectionProtectionContext(idx, full, meta, prevPos, targetPosition, strategy = STRATEGY, decisionContext = {}) {
    const config = strategy?.waveRejectionProtection;
    const empty = { active: false, status: 'none', targetPosition };
    const isStock = state.mode === 'stock';
    const isIndex = state.mode === 'index';
    const indexFreshEntryConfig = isIndex ? config?.indexFreshEntryFailure : null;
    const indexDownsideConfig = isIndex ? config?.indexFreshEntryDownsideFailure : null;
    if (state.strategy !== '波段抄底型' || state.period !== 'daily' || !config
        || (!isStock && !indexFreshEntryConfig && !indexDownsideConfig)) return empty;

    const item = full?.[idx] || {};
    const close = Number(item.close);
    const previous = full?.[idx - 1]?._decision?.waveRejectionProtection;
    const entryDayPressureVeto = getWaveEntryDayPressureVetoContext(idx, full, meta, prevPos, targetPosition, strategy);
    if (entryDayPressureVeto.status === 'entry_blocked') return entryDayPressureVeto;
    // 首破确认缓冲期：上一日首次破位只降到 pending 仓位并锁定，这里判定是否收复或最终确认清仓。
    if (previous?.status === 'pending_hard_break') {
        const pendingEntryLow = Number(previous.entrySignalLow);
        const pendingCap = Math.max(0, Number(previous.pendingPositionCap) || hardBreakPendingPositionCap);
        const confirmDays = Math.max(1, Number(previous.confirmTradingDays) || hardBreakConfirmTradingDays || 1);
        const pendingAge = idx - Number(previous.triggerDay);
        const recovered = Number.isFinite(close) && Number.isFinite(pendingEntryLow) && close >= pendingEntryLow;
        if (recovered) {
            // 次日收盘收复买入日最低价：解除首破锁定，交回主链继续按原目标持有。
            return { ...previous, active: false, status: 'hard_break_recovered', resolvedDay: idx, resolvedDate: item.date || '', targetPosition };
        }
        if (pendingAge >= confirmDays) {
            // 缓冲期满仍未收复：确认结构性首破，执行整清。
            return {
                ...previous,
                active: true,
                status: 'triggered',
                eventType: 'fresh_entry_hard_break',
                confirmedDay: idx,
                confirmedDate: item.date || '',
                sourcePosition: prevPos,
                targetPosition: 0,
                recoveryPending: false,
                recoveryHoldRemaining: 0
            };
        }
        // 仍在缓冲期内且未收复：维持 pending 锁定，不新增仓位。
        return {
            ...previous,
            status: 'pending_hard_break',
            pendingAge,
            targetPosition: Math.min(targetPosition, pendingCap, prevPos)
        };
    }
    if (previous?.active) {
        const age = idx - Number(previous.triggerDay);
        const minimumLockTradingDays = Math.max(1, Number(config.minimumLockTradingDays) || 2);
        const rawSignals = item._signals || [];
        const blockedByRiskSignal = (config.blockingSignals || []).some(signal => rawSignals.includes(signal));
        const recoveredRiskHigh = Number.isFinite(close) && close > Number(previous.triggerHigh);
        const hasFreshPostEventSignal = (meta?.windowScoreSignals || []).some(signal => Number(signal.day) > Number(previous.triggerDay));
        const postEvent = getPostEventBuyScoreContext(idx, full, state.indicators, previous.triggerDay, strategy);
        const freshRecoveryConfig = config.strongFreshRecovery || {};
        const freshRecoveryEvents = new Set(freshRecoveryConfig.eventTypes || []);
        const minimumPostEventScore = Math.max(1, Number(strategy?.buyThreshold) || 4);
        const minimumPostEventGroups = Math.max(2, Number(freshRecoveryConfig.minimumScoreGroups) || 2);
        const minimumStrongFreshRecoveryAge = previous.eventType === 'structure_hard_break'
            ? Math.max(0, Number(freshRecoveryConfig.minimumEventAgeTradingDays) || 0)
            : 0;
        const recoveryCap = Math.max(0, Number(config.recoveryPositionCap) || 30);
        const marketRecoveryCap = getMarketIncreaseCap(decisionContext.market, decisionContext.targetStrength?.tier);
        const marketAllowsRecovery = marketRecoveryCap == null || marketRecoveryCap >= recoveryCap;
        const blockedByDecision = !!meta?.inCooldown
            || (meta?.exitSignals || []).length > 0
            || (meta?.warningSignals || []).length > 0
            || (!!decisionContext.exit?.level && decisionContext.exit.level !== '无明确离场');
        const ma20RejectionRecoveryBlocked = previous.eventType === 'fresh_entry_failure'
            && previous.ma20RejectionExit === true;
        const strongFreshRecovery = isStock
            && freshRecoveryEvents.has(previous.eventType)
            && age >= minimumStrongFreshRecoveryAge
            && !ma20RejectionRecoveryBlocked
            && postEvent.score >= minimumPostEventScore
            && postEvent.signals.length >= minimumPostEventGroups
            && marketAllowsRecovery
            && !blockedByDecision
            && targetPosition > 0;
        const pullbackConfig = config.pullbackRecovery || {};
        const pullbackEvents = new Set(pullbackConfig.eventTypes || ['mature_profit_rejection']);
        const recoveryRegime = decisionContext.trendRegime?.key || '';
        const supportRecoveryRegime = ['up', 'reversal-up', 'range'].includes(recoveryRegime);
        const signalHardInvalidationPullback = ['signal_hard_invalidation', 'structure_hard_break'].includes(previous.eventType)
            && supportRecoveryRegime;
        const pullbackSourcePositions = new Set(pullbackConfig.sourcePositions || [30, 50]);
        const pullbackSignals = new Set(pullbackConfig.signals || ['B6', 'B11']);
        const freshPullbackSignals = (item._signals || []).filter(signal => pullbackSignals.has(signal));
        const pullbackMaPeriod = Math.max(1, Number(pullbackConfig.movingAveragePeriod) || 20);
        const pullbackSlopeDays = Math.max(1, Number(pullbackConfig.slopeLookbackDays) || 1);
        const pullbackMa = Number(state.indicators?.ma?.[pullbackMaPeriod]?.[idx]);
        const previousPullbackMa = Number(state.indicators?.ma?.[pullbackMaPeriod]?.[Math.max(0, idx - pullbackSlopeDays)]);
        const heldEventLow = pullbackConfig.requireHoldEventLow === false
            || (Number.isFinite(close) && close > Number(previous.triggerLow));
        const pullbackRecoveryTarget = pullbackSourcePositions.has(Number(previous.sourcePosition))
            ? Number(previous.sourcePosition)
            : 0;
        const stockTrendCap = Number(decisionContext.positionCap?.limit);
        const stockTrendAllowsPullbackRecovery = pullbackRecoveryTarget <= recoveryCap
            || !Number.isFinite(stockTrendCap)
            || stockTrendCap >= pullbackRecoveryTarget;
        const marketAllowsPullbackRecovery = pullbackRecoveryTarget > 0
            && (marketRecoveryCap == null || marketRecoveryCap >= pullbackRecoveryTarget);
        const pullbackRecovery = isStock
            && pullbackConfig.stocksOnly !== false
            && (pullbackEvents.has(previous.eventType) || signalHardInvalidationPullback)
            && age >= Math.max(2, Number(pullbackConfig.minimumEventAgeTradingDays) || 2)
            && pullbackRecoveryTarget > prevPos
            && freshPullbackSignals.length > 0
            && [close, pullbackMa, previousPullbackMa].every(Number.isFinite)
            && close >= pullbackMa
            && pullbackMa >= previousPullbackMa
            && heldEventLow
            && marketAllowsPullbackRecovery
            && !blockedByRiskSignal
            && !blockedByDecision
            && stockTrendAllowsPullbackRecovery;
        const recoveryCloseLevel = Number.isFinite(Number(previous.recoveryCloseLevel))
            ? Number(previous.recoveryCloseLevel)
            : Number(previous.triggerClose);
        const stableRecovery = age >= Math.max(1, Number(config.minimumLockTradingDays) || 2)
            && Number.isFinite(close)
            && close > recoveryCloseLevel;
        const confirmedPostEventRecovery = isStock
            ? (recoveredRiskHigh && hasFreshPostEventSignal) || stableRecovery || strongFreshRecovery || pullbackRecovery
            : recoveredRiskHigh || hasFreshPostEventSignal || stableRecovery;
        const canRelease = age >= minimumLockTradingDays
            && !blockedByRiskSignal
            && confirmedPostEventRecovery;
        if (!canRelease) {
            return {
                ...previous,
                active: true,
                status: 'locked',
                lockAge: age,
                lockRemaining: Math.max(0, minimumLockTradingDays - age),
                blockedByRiskSignal,
                blockedByDecision,
                recoveredRiskHigh,
                hasFreshPostEventSignal,
                stableRecovery,
                strongFreshRecovery,
                pullbackRecovery,
                freshPullbackSignals,
                pullbackMovingAveragePeriod: pullbackMaPeriod,
                pullbackMovingAverage: pullbackMa,
                postEventScore: postEvent.score,
                postEventScoreSignals: postEvent.signals,
                minimumPostEventScore,
                minimumPostEventGroups,
                marketAllowsRecovery,
                marketAllowsPullbackRecovery,
                stockTrendAllowsPullbackRecovery,
                targetPosition: Math.min(targetPosition, prevPos)
            };
        }
        const holdDays = Math.max(0, Number(config.recoveryHoldTradingDays) || 0);
        if (targetPosition > 0) {
            return {
                ...previous,
                active: false,
                status: 'released',
                resolvedDay: idx,
                resolvedDate: item.date || '',
                recoveredRiskHigh,
                hasFreshPostEventSignal,
                stableRecovery,
                strongFreshRecovery,
                pullbackRecovery,
                freshPullbackSignals,
                pullbackMovingAveragePeriod: pullbackMaPeriod,
                pullbackMovingAverage: pullbackMa,
                postEventScore: postEvent.score,
                postEventScoreSignals: postEvent.signals,
                minimumPostEventScore,
                minimumPostEventGroups,
                marketAllowsRecovery,
                marketAllowsPullbackRecovery,
                stockTrendAllowsPullbackRecovery,
                recoveryPending: false,
                recoveryHoldRemaining: holdDays,
                // 建仓日压力否决在完整观察期后站回风险日收盘时，允许恢复30%试探仓。
                // 其他硬失效事件仍需新信号或专门的趋势接管条件，避免在下跌中继中盲目重入。
                allowRecoveryIncrease: strongFreshRecovery
                    || pullbackRecovery
                    || (stableRecovery && previous.eventType === 'entry_day_pressure_rejection'),
                targetPosition: pullbackRecovery
                    ? Math.max(prevPos, pullbackRecoveryTarget)
                    : Math.min(targetPosition, Math.max(prevPos, recoveryCap))
            };
        }
        if (pullbackRecovery) {
            return {
                ...previous,
                active: false,
                status: 'released',
                resolvedDay: idx,
                resolvedDate: item.date || '',
                recoveredRiskHigh,
                hasFreshPostEventSignal,
                stableRecovery,
                strongFreshRecovery,
                pullbackRecovery,
                freshPullbackSignals,
                pullbackMovingAveragePeriod: pullbackMaPeriod,
                pullbackMovingAverage: pullbackMa,
                postEventScore: postEvent.score,
                postEventScoreSignals: postEvent.signals,
                minimumPostEventScore,
                minimumPostEventGroups,
                marketAllowsRecovery,
                marketAllowsPullbackRecovery,
                stockTrendAllowsPullbackRecovery,
                recoveryPending: false,
                recoveryHoldRemaining: holdDays,
                allowRecoveryIncrease: true,
                targetPosition: pullbackRecoveryTarget
            };
        }
        return {
            ...previous,
            active: false,
            status: 'recovery_pending',
            resolvedDay: idx,
            resolvedDate: item.date || '',
            recoveredRiskHigh,
            hasFreshPostEventSignal,
            stableRecovery,
            recoveryPending: true,
            recoveryHoldRemaining: 0,
            targetPosition
        };
    }

    if (previous?.recoveryPending) {
        const recoveryCap = Math.max(0, Number(config.recoveryPositionCap) || 30);
        const rawSignals = item._signals || [];
        const freshTakeoverSignals = ['B6', 'B11'].filter(signal => rawSignals.includes(signal));
        const ma20 = Number(state.indicators?.ma?.[20]?.[idx]);
        const previousMa20 = Number(state.indicators?.ma?.[20]?.[Math.max(0, idx - 1)]);
        const trendTakeover = isStock
            && freshTakeoverSignals.length > 0
            && Number.isFinite(close)
            && Number.isFinite(ma20)
            && Number.isFinite(previousMa20)
            && close >= ma20
            && ma20 >= previousMa20
            && !meta?.inCooldown
            && !(meta?.exitSignals || []).length
            && !(meta?.warningSignals || []).length;
        const marketRecoveryCap = getMarketIncreaseCap(decisionContext.market, decisionContext.targetStrength?.tier);
        const marketAllowsRecovery = marketRecoveryCap == null || marketRecoveryCap >= recoveryCap;
        const permittedTrendTakeover = trendTakeover && marketAllowsRecovery;
        if (targetPosition <= 0 && !permittedTrendTakeover) return { ...previous, status: 'recovery_pending', targetPosition };
        return {
            ...previous,
            status: 'recovery_started',
            recoveryPending: false,
            recoveryHoldRemaining: Math.max(0, Number(config.recoveryHoldTradingDays) || 0),
            freshTakeoverSignals,
            trendRecovery: permittedTrendTakeover,
            marketAllowsRecovery,
            allowRecoveryIncrease: permittedTrendTakeover,
            targetPosition: Math.min(Math.max(targetPosition, permittedTrendTakeover ? recoveryCap : 0), recoveryCap)
        };
    }

    if (Number(previous?.recoveryHoldRemaining) > 0) {
        const recoveryCap = Math.max(0, Number(config.recoveryPositionCap) || 30);
        const hardInvalidation = getTodaySignalInvalidations(meta, 'price-break').length > 0;
        const canPreserveRecovery = previous.allowRecoveryIncrease
            && !decisionContext.isCriticalExit
            && !meta?.inCooldown
            && !hardInvalidation;
        const preservedPosition = canPreserveRecovery ? Math.min(Math.max(prevPos, recoveryCap), recoveryCap) : 0;
        return {
            ...previous,
            status: 'recovery_hold',
            recoveryHoldRemaining: Number(previous.recoveryHoldRemaining) - 1,
            allowRecoveryIncrease: canPreserveRecovery,
            targetPosition: canPreserveRecovery
                ? Math.max(Math.min(targetPosition, recoveryCap), preservedPosition)
                : Math.min(targetPosition, Math.max(prevPos, recoveryCap))
        };
    }

    if (prevPos <= 0) return empty;
    const entryClose = getWaveRejectionEntryClose(idx, full, prevPos);
    if (!Number.isFinite(entryClose) || entryClose <= 0) return empty;
    const lookbackDays = Math.max(1, Number(config.pressureLookbackDays) || 20);
    const pressureRows = full.slice(Math.max(0, idx - lookbackDays), idx);
    const volumeRows = full.slice(Math.max(0, idx - 5), idx);
    if (!pressureRows.length || !volumeRows.length) return empty;
    const previousHigh = Math.max(...pressureRows.map(row => Number(row?.high) || 0));
    const averageVolume = volumeRows.reduce((sum, row) => sum + (Number(row?.vol) || 0), 0) / volumeRows.length;
    const open = Number(item.open);
    const high = Number(item.high);
    const low = Number(item.low);
    const volume = Number(item.vol) || 0;
    const range = high - low;
    const body = Math.abs(close - open);
    const upperShadow = high - Math.max(open, close);
    const lowerShadow = Math.min(open, close) - low;
    const closeLocation = range > 0 ? (close - low) / range : 1;
    const profitRatio = close / entryClose - 1;
    const volumeRatio = averageVolume > 0 ? volume / averageVolume : 0;
    const nearPressure = previousHigh > 0 && high >= previousHigh * Number(config.pressureToleranceRatio);
    const freshEntryConfig = isStock ? config.freshEntryFailure : indexFreshEntryConfig;
    const downsideConfig = isIndex ? indexDownsideConfig : config.freshEntryDownsideFailure;
    // 首破买入日最低价的确认缓冲：默认 0 = 当日即清仓（现行生产行为）；
    // 设为 N≥1 时首破不整清，先降到 pending 仓位并锁定，之后 N 日内收盘收复则解除，仍不收复才确认清仓。
    const hardBreakConfirmTradingDays = Math.max(0, Number(downsideConfig?.hardBreakConfirmTradingDays) || 0);
    const hardBreakPendingPositionCap = Math.max(0, Number(downsideConfig?.hardBreakPendingPositionCap) || 30);
    let entryDay = null;
    for (let day = idx - 1; day >= 0; day--) {
        const priorDecision = full?.[day]?._decision;
        if (!priorDecision || Number(priorDecision.position) <= 0) break;
        if (Number(priorDecision.prevAdv) === 0 || priorDecision.bsMark === 'B') {
            entryDay = day;
            break;
        }
    }
    const entryAge = Number.isInteger(entryDay) ? idx - entryDay : null;
    const entrySignalLow = Number.isInteger(entryDay) ? Number(full?.[entryDay]?.low) : null;
    const frozenHardDefense = Number(full?.[idx - 1]?._decision?.waveContext?.lifecycle?.hardDefense);
    const holdsFrozenDefense = Number.isFinite(frozenHardDefense)
        && Number.isFinite(close)
        && close >= frozenHardDefense;
    const intradayProfitRatio = high / entryClose - 1;
    const givebackRatio = high > entryClose ? (high - close) / (high - entryClose) : 0;
    const upperShadowRangeRatio = range > 0 ? upperShadow / range : 0;
    const freshEntryPressure = freshEntryConfig
        ? getWaveFreshEntryPressureContext(idx, full, state.indicators, freshEntryConfig)
        : { matched: false, sources: [] };
    const secondDayMinimumHighAdvanceRatio = Number(freshEntryConfig?.secondDayMinimumHighAdvanceRatio);
    const previousDayHigh = Number(full?.[idx - 1]?.high);
    const secondDayHighAdvanceRatio = Number.isFinite(previousDayHigh) && previousDayHigh > 0
        ? high / previousDayHigh - 1
        : Infinity;
    const newlyReachedPressureSources = Number.isInteger(entryAge) && entryAge > 1
        ? freshEntryPressure.sources.filter(source =>
            !wasWavePressureSourceReachedOnDay(source, idx - 1, full, state.indicators, freshEntryConfig)
        )
        : freshEntryPressure.sources;
    const freshPressureAttack = !Number.isFinite(secondDayMinimumHighAdvanceRatio)
        || !Number.isInteger(entryAge)
        || entryAge <= 1
        || newlyReachedPressureSources.length > 0
        || secondDayHighAdvanceRatio >= secondDayMinimumHighAdvanceRatio;
    const pressureAttackType = !Number.isInteger(entryAge) || entryAge <= 1
        ? 'first_day'
        : (newlyReachedPressureSources.length > 0 ? 'new_source' : (freshPressureAttack ? 'higher_high' : 'repeat'));
    const requiredCloseBelowMaPeriod = Number(freshEntryConfig?.requireCloseBelowMovingAveragePeriod);
    const requiredCloseBelowMa = Number.isFinite(requiredCloseBelowMaPeriod)
        ? Number(state.indicators?.ma?.[requiredCloseBelowMaPeriod]?.[idx])
        : null;
    const stockFreshEntryCloseAllowed = !isStock
        || !Number.isFinite(requiredCloseBelowMaPeriod)
        || (Number.isFinite(requiredCloseBelowMa) && close < requiredCloseBelowMa);
    const ma20RejectionConfig = isStock ? freshEntryConfig?.ma20RejectionExit : null;
    const rejectionMaPeriod = Number(ma20RejectionConfig?.movingAveragePeriod) || 20;
    const rejectionLongMaPeriod = Number(ma20RejectionConfig?.longMovingAveragePeriod) || 60;
    const rejectionMa = Number(state.indicators?.ma?.[rejectionMaPeriod]?.[idx]);
    const rejectionLongMa = Number(state.indicators?.ma?.[rejectionLongMaPeriod]?.[idx]);
    const rejectionSlopeDays = Math.max(1, Number(ma20RejectionConfig?.slopeLookbackDays) || 5);
    const previousRejectionMa = Number(state.indicators?.ma?.[rejectionMaPeriod]?.[idx - rejectionSlopeDays]);
    const stockMa20RejectionTriggered = ma20RejectionConfig
        && Number.isInteger(entryAge)
        && entryAge >= 1
        && entryAge <= Math.max(1, Number(freshEntryConfig.maximumEntryAgeTradingDays) || 2)
        && [rejectionMa, rejectionLongMa, previousRejectionMa].every(Number.isFinite)
        && rejectionMa < rejectionLongMa
        && rejectionMa < previousRejectionMa
        && high >= rejectionMa
        && close < rejectionMa
        && upperShadowRangeRatio >= Number(ma20RejectionConfig.minimumUpperShadowRangeRatio || 0)
        && closeLocation <= Number(ma20RejectionConfig.maximumCloseLocation ?? 1)
        && (!ma20RejectionConfig.requireUpperShadowDominance || upperShadow > lowerShadow)
        && freshPressureAttack;
    const stockMa20HoldTriggered = ma20RejectionConfig
        && Number.isInteger(entryAge)
        && entryAge >= 1
        && entryAge <= Math.max(1, Number(freshEntryConfig.maximumEntryAgeTradingDays) || 2)
        && [rejectionMa, rejectionLongMa, previousRejectionMa].every(Number.isFinite)
        && rejectionMa < rejectionLongMa
        && close >= rejectionMa
        && upperShadowRangeRatio >= Number(ma20RejectionConfig.minimumUpperShadowRangeRatio || 0)
        && closeLocation <= Number(ma20RejectionConfig.maximumCloseLocation ?? 1)
        && (!ma20RejectionConfig.requireUpperShadowDominance || upperShadow > lowerShadow)
        && freshEntryPressure.matched
        && freshPressureAttack;
    const classicFreshEntryFailureTriggered = freshEntryConfig
        && (!isStock || decisionContext?.waveContext?.regime === 'down')
        && (!freshEntryConfig.requireBearishClose || close < open)
        && (!Number.isFinite(Number(freshEntryConfig.maximumCloseDefenseGapRatio))
            || (Number.isFinite(entrySignalLow)
                && entrySignalLow > 0
                && close / entrySignalLow - 1 <= Number(freshEntryConfig.maximumCloseDefenseGapRatio)))
        && Number.isInteger(entryAge)
        && entryAge >= 1
        && entryAge <= Math.max(1, Number(freshEntryConfig.maximumEntryAgeTradingDays) || 2)
        && intradayProfitRatio >= Number(freshEntryConfig.minimumIntradayProfitRatio)
        && profitRatio <= Number(freshEntryConfig.maximumCloseProfitRatio)
        && givebackRatio >= Number(freshEntryConfig.minimumGivebackRatio)
        && volumeRatio >= Number(freshEntryConfig.minimumVolumeRatio)
        && upperShadowRangeRatio >= Number(freshEntryConfig.minimumUpperShadowRangeRatio)
        && closeLocation <= Number(freshEntryConfig.maximumCloseLocation)
        && freshEntryPressure.matched
        && freshPressureAttack
        && stockFreshEntryCloseAllowed
        && (!freshEntryConfig.requireFrozenDefenseBreakForPressureFailure || !holdsFrozenDefense);
    const freshEntryFailureTriggered = stockMa20RejectionTriggered || classicFreshEntryFailureTriggered;
    const downsideCloseGapRatio = Number.isFinite(entrySignalLow) && entrySignalLow > 0 && Number.isFinite(close)
        ? close / entrySignalLow - 1
        : Infinity;
    const downsideBearBodyRangeRatio = range > 0 && close < open ? (open - close) / range : 0;
    const protectedB11LocalBreak = (meta?.localBreakWindowSignals || []).some(signal =>
        signal?.signal === 'B11'
        && Number.isFinite(Number(signal.structureLevel))
        && close >= Number(signal.structureLevel)
    );
    const hardSignalInvalidations = getTodaySignalInvalidations(meta, 'price-break');
    const signalInvalidationRecoveryLevels = hardSignalInvalidations
        .map(signal => Number(signal?.invalidationLevel))
        .filter(level => Number.isFinite(level));
    const signalInvalidationRecoveryLevel = signalInvalidationRecoveryLevels.length
        ? Math.max(...signalInvalidationRecoveryLevels)
        : close;
    const signalHardInvalidationExitTriggered = isStock
        && prevPos > 0
        && targetPosition <= 0
        && hardSignalInvalidations.length > 0
        && !holdsFrozenDefense;
    const freshEntryHardBreakTriggered = downsideConfig
        && downsideConfig.exitOnCloseBelowEntryLow !== false
        && Number.isInteger(entryAge)
        && entryAge >= 1
        && entryAge <= Math.max(1, Number(downsideConfig.maximumEntryAgeTradingDays) || 2)
        && Number.isFinite(entrySignalLow)
        && entrySignalLow > 0
        && close < entrySignalLow
        && !protectedB11LocalBreak;
    const freshEntryDownsideFailureTriggered = downsideConfig
        && Number.isInteger(entryAge)
        && entryAge >= 1
        && entryAge <= Math.max(1, Number(downsideConfig.maximumEntryAgeTradingDays) || 2)
        && Number.isFinite(entrySignalLow)
        && entrySignalLow > 0
        && low < entrySignalLow
        && close >= entrySignalLow
        && downsideCloseGapRatio <= Number(downsideConfig.maximumCloseDefenseGapRatio)
        && downsideBearBodyRangeRatio >= Number(downsideConfig.minimumBearBodyRangeRatio)
        && closeLocation <= Number(downsideConfig.maximumCloseLocation)
        && volumeRatio >= Number(downsideConfig.minimumVolumeRatio);
    const matureProfitRejectionTriggered = isStock && Number.isFinite(profitRatio)
        && profitRatio >= Number(config.minimumProfitRatio)
        && volumeRatio >= Number(config.minimumVolumeRatio)
        && nearPressure
        && upperShadow >= Math.max(body * Number(config.minimumUpperShadowBodyRatio), 0)
        && upperShadowRangeRatio >= Number(config.minimumUpperShadowRangeRatio || 0)
        && (!config.requireUpperShadowDominance || upperShadow > lowerShadow)
        && closeLocation <= Number(config.maximumCloseLocation);
    const triggered = freshEntryHardBreakTriggered || freshEntryDownsideFailureTriggered || freshEntryFailureTriggered
        || signalHardInvalidationExitTriggered || matureProfitRejectionTriggered;
    if (!triggered && !stockMa20HoldTriggered) return empty;
    if (!triggered) {
        const holdPositionCap = Math.max(0, Number(ma20RejectionConfig.holdPositionCap) || 30);
        return {
            active: false,
            status: 'ma20_hold',
            eventType: 'fresh_entry_ma20_hold',
            triggerDay: idx,
            triggerDate: item.date || '',
            triggerHigh: high,
            triggerLow: low,
            triggerClose: close,
            entryClose,
            entryDay,
            entryDate: Number.isInteger(entryDay) ? full?.[entryDay]?.date || '' : '',
            entryAge,
            profitRatio,
            volumeRatio,
            secondDayHighAdvanceRatio,
            pressureAttackType,
            ma20Level: rejectionMa,
            upperShadowRangeRatio,
            closeLocation,
            pressureSources: freshEntryPressure.sources,
            sourcePosition: prevPos,
            targetPosition: Math.min(targetPosition, holdPositionCap),
            holdPositionCap,
            recoveryPending: false,
            recoveryHoldRemaining: 0
        };
    }
    // 首破确认缓冲：仅当首破是唯一硬事件（无信号硬失效并存）且启用缓冲时，首日不整清，降到 pending 仓位锁定，
    // 交由后续 pending_hard_break 分支在缓冲期内判定收复或确认清仓。默认 confirmDays=0 时跳过，保持现行即时清仓。
    if (freshEntryHardBreakTriggered && !signalHardInvalidationExitTriggered && hardBreakConfirmTradingDays >= 1) {
        const pendingCap = Math.min(hardBreakPendingPositionCap, getLowerWavePositionStep(prevPos, config.positionSteps));
        return {
            active: true,
            status: 'pending_hard_break',
            eventType: 'fresh_entry_hard_break',
            triggerDay: idx,
            triggerDate: item.date || '',
            triggerHigh: high,
            triggerLow: low,
            triggerClose: close,
            recoveryCloseLevel: close,
            entryClose,
            entryDay,
            entryDate: Number.isInteger(entryDay) ? full?.[entryDay]?.date || '' : '',
            entryAge,
            entrySignalLow,
            confirmTradingDays: hardBreakConfirmTradingDays,
            pendingPositionCap: hardBreakPendingPositionCap,
            pendingAge: 0,
            sourcePosition: prevPos,
            targetPosition: Math.min(targetPosition, pendingCap, prevPos),
            recoveryPending: false,
            recoveryHoldRemaining: 0
        };
    }
    return {
        active: true,
        status: 'triggered',
        triggerDay: idx,
        triggerDate: item.date || '',
        triggerHigh: high,
        triggerLow: low,
        triggerClose: close,
        recoveryCloseLevel: signalHardInvalidationExitTriggered ? signalInvalidationRecoveryLevel : close,
        entryClose,
        entryDay,
        entryDate: Number.isInteger(entryDay) ? full?.[entryDay]?.date || '' : '',
        entryAge,
        entrySignalLow,
        downsideBearBodyRangeRatio,
        downsideCloseGapRatio,
        eventType: freshEntryHardBreakTriggered
            ? 'fresh_entry_hard_break'
            : (freshEntryDownsideFailureTriggered
                ? 'fresh_entry_downside_failure'
                : (freshEntryFailureTriggered
                    ? 'fresh_entry_failure'
                    : (signalHardInvalidationExitTriggered ? 'signal_hard_invalidation' : 'mature_profit_rejection'))),
        profitRatio,
        intradayProfitRatio,
        givebackRatio,
        volumeRatio,
        secondDayHighAdvanceRatio,
        pressureAttackType,
        ma20RejectionExit: !!stockMa20RejectionTriggered,
        ma20Level: Number.isFinite(rejectionMa) ? rejectionMa : null,
        upperShadowBodyRatio: body > 0 ? upperShadow / body : null,
        lowerShadow,
        upperShadowRangeRatio,
        closeLocation,
        pressureSources: signalHardInvalidationExitTriggered
            ? hardSignalInvalidations.map(signal => ({
                type: 'signal_invalidation',
                period: null,
                level: Number(signal?.invalidationLevel),
                day: Number(signal?.day),
                date: signal?.signalDate || '',
                signal: signal?.signal || ''
            }))
            : ((freshEntryHardBreakTriggered || freshEntryDownsideFailureTriggered)
            ? [{ type: 'signal_low', period: null, level: entrySignalLow, day: entryDay, date: Number.isInteger(entryDay) ? full?.[entryDay]?.date || '' : '' }]
            : (freshEntryFailureTriggered ? freshEntryPressure.sources : [{ type: 'recent_high', period: null, level: previousHigh, day: null }])),
        sourcePosition: prevPos,
        targetPosition: freshEntryHardBreakTriggered || signalHardInvalidationExitTriggered
            ? 0
            : Math.min(targetPosition, getLowerWavePositionStep(prevPos, config.positionSteps)),
        recoveryPending: false,
        recoveryHoldRemaining: 0
    };
}
