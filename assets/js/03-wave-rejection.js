// [3E] 波段建仓否决与风险事件保护 (Wave Entry Veto & Rejection Protection)
// 恢复状态的兼容戳只失效旧派生决策，不同步应用/信号发布版本。
const WAVE_RECOVERY_STATE_VERSION = 'wave-recovery-v2';

function getWaveRecoveryRiskContext(idx, full, meta, recoveryPosition, strategy = STRATEGY, decisionContext = {}) {
    const rawSignals = full?.[idx]?._signals || [];
    const blockedByRiskSignal = (strategy.waveRejectionProtection?.blockingSignals || ['W2', 'W3'])
        .some(signal => rawSignals.includes(signal));
    const hardInvalidation = getTodaySignalInvalidations(meta, 'price-break').length > 0;
    const lifecycle = full?.[idx - 1]?._decision?.waveContext?.lifecycle;
    const effectiveDefense = getWaveEffectiveDefense(decisionContext.waveContext || getWaveContext(idx, full, state.indicators, strategy), lifecycle, strategy);
    const hardDefense = effectiveDefense?.level ?? lifecycle?.hardDefense;
    const structureBroken = hardDefense != null && Number.isFinite(Number(hardDefense))
        && Number(full?.[idx]?.close) < Number(hardDefense);
    const blockedByDecision = !!decisionContext.isCriticalExit || !!meta?.inCooldown
        || (meta?.exitSignals || []).length > 0 || (meta?.warningSignals || []).length > 0
        || ((decisionContext.exit?.stateCode != null || !!decisionContext.exit?.level) && getExitStateCode(decisionContext.exit) !== EXIT_STATE.NONE)
        || hardInvalidation || structureBroken;
    const marketCap = getMarketIncreaseCap(decisionContext.market, decisionContext.targetStrength?.tier);
    const blockedByPositionCap = Number.isFinite(decisionContext.positionCap?.limit)
        && decisionContext.positionCap.limit < recoveryPosition;
    const marketAllowsRecovery = marketCap == null || marketCap >= recoveryPosition;
    return {
        blocked: blockedByRiskSignal || blockedByDecision || blockedByPositionCap || !marketAllowsRecovery,
        blockedByRiskSignal, blockedByDecision, blockedByPositionCap, marketAllowsRecovery, hardInvalidation
    };
}

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

// 止盈后的跨日回踩提供新恢复资格；数值与离线V2一致，原风险链仍优先。
function getWaveDelayedProfitReentryContext(input) {
    const { rule, previous, mode, strategyName, period, index, row, previousRow, ma20, previousMa20,
        regime, requestedPosition, previousPosition, blocked, defenseAcceptable, originalStatus, touches, windowDays } = input;
    if (!rule || mode !== 'stock' || strategyName !== '波段抄底型' || period !== 'daily'
        || !Number.isFinite(requestedPosition) || requestedPosition < 0
        || previousPosition !== 0 || (requestedPosition <= 0 && rule.requireExistingTarget !== false) || blocked || !defenseAcceptable
        || regime !== 'up' || !['locked', 'recovery_pending'].includes(originalStatus)
        || previous?.eventType !== 'mature_profit_rejection'
        || previous.targetPosition !== 0 || !(previous.active || previous.recoveryPending)) return null;
    const eventAge = index - previous.triggerDay;
    if (!Number.isInteger(eventAge) || eventAge < input.minimumLockDays || eventAge > windowDays) return null;
    if (![row?.close, row?.open, row?.low, previousRow?.close, ma20, previousMa20].every(Number.isFinite)
        || ma20 <= 0 || ma20 < previousMa20 || row.close < ma20
        || row.close <= row.open || row.close <= previousRow.close) return null;
    for (const touch of touches || []) {
        if (touch.index <= previous.triggerDay || index - touch.index < 1 || index - touch.index > rule.confirmationDays) continue;
        if (![touch.ma20, touch.previousMa20, touch.atr, touch.low, touch.close, touch.minimumFollowingLow].every(Number.isFinite)
            || touch.ma20 <= 0 || touch.atr <= 0 || touch.ma20 < touch.previousMa20) continue;
        const tolerance = Math.max(touch.atr * rule.touchToleranceAtr, touch.ma20 * 0.005);
        if (touch.low > touch.ma20 + tolerance || touch.low < touch.ma20 - tolerance
            || touch.close < touch.ma20 || row.close <= touch.close || touch.minimumFollowingLow < touch.low) continue;
        return {
            applied: true, touchDay: touch.index, touchDate: touch.date, touchLow: touch.low,
            confirmationDay: index, confirmationDate: row.date, confirmationLow: row.low,
            eventAge, targetPosition: Math.min(requestedPosition > 0 ? requestedPosition : rule.targetPosition, rule.targetPosition),
            reason: `${touch.date}回踩MA20支撑区域后，今日收阳确认且未再破回踩低点，按新防守位恢复最多30%`
        };
    }
    return null;
}

function getWaveRejectionProtectionContext(idx, full, meta, prevPos, targetPosition, strategy = STRATEGY, decisionContext = {}) {
    const original = getWaveBaseRejectionProtectionContext(idx, full, meta, prevPos, targetPosition, strategy, decisionContext);
    const config = strategy.waveRejectionProtection;
    const rule = config?.delayedPullbackRecovery;
    if (!rule || original.targetPosition > 0 || prevPos !== 0
        || state.strategy !== '波段抄底型' || state.mode !== 'stock' || state.period !== 'daily'
        || decisionContext.waveContext?.regime !== 'up' || !Array.isArray(state.indicators?.ma?.[20])) return original;
    const previous = full[idx - 1]?._decision?.waveRejectionProtection;
    const touches = [];
    for (let day = idx - 1; day >= Math.max(1, idx - rule.confirmationDays); day--) {
        touches.push({ index: day, date: full[day].date, low: Number(full[day].low), close: Number(full[day].close),
            ma20: state.indicators.ma[20][day], previousMa20: state.indicators.ma[20][day - 1],
            atr: getWaveAtr14At(day, full), minimumFollowingLow: Math.min(...full.slice(day + 1, idx + 1).map(row => Number(row.low))) });
    }
    const defense = getWaveEntryDefenseContext(idx, full, decisionContext.waveContext, full[idx]._signals || [], strategy, { freshEventRecovery: true });
    const blocked = decisionContext.isCriticalExit || meta.inCooldown || (meta.exitSignals || []).length > 0
        || (meta.warningSignals || []).length > 0 || getTodaySignalInvalidations(meta, 'price-break').length > 0
        || (full[idx]._signals || []).some(signal => (config.blockingSignals || ['W2','W3']).includes(signal))
        || (Number.isFinite(decisionContext.positionCap?.limit) && decisionContext.positionCap.limit < rule.targetPosition)
        || (getMarketIncreaseCap(decisionContext.market, decisionContext.targetStrength?.tier) ?? 80) < rule.targetPosition;
    const recovery = getWaveDelayedProfitReentryContext({ rule, previous, mode: state.mode, strategyName: state.strategy,
        period: state.period, index: idx, row: full[idx], previousRow: full[idx - 1], previousPosition: prevPos,
        ma20: state.indicators.ma[20][idx], previousMa20: state.indicators.ma[20][idx - 1],
        regime: decisionContext.waveContext?.regime, requestedPosition: targetPosition, blocked,
        defenseAcceptable: defense.acceptable, originalStatus: original.status, touches,
        minimumLockDays: Math.max(2, Number(config.minimumLockTradingDays) || 2), windowDays: strategy.windowDays });
    if (!recovery) return original;
    return { ...original, active: false, status: 'recovery_started', reentryRoute: 'original-recovery',
        resolvedDay: idx, resolvedDate: full[idx].date, recoveryPending: false,
        recoveryHoldRemaining: Math.max(0, Number(config.recoveryHoldTradingDays) || 0),
        allowRecoveryIncrease: true, targetPosition: recovery.targetPosition, delayedPullback: recovery };
}

function isValidWavePendingBreakRecord(protection) {
    if (protection?.recomputeRequired) return false;
    if (protection?.status !== 'pending_hard_break') return true;
    return Number.isInteger(protection.triggerDay) && protection.triggerDay >= 0
        && typeof protection.entrySignalLow === 'number'
        && Number.isFinite(protection.entrySignalLow) && protection.entrySignalLow > 0;
}

function getWaveBaseRejectionProtectionContext(idx, full, meta, prevPos, targetPosition, strategy = STRATEGY, decisionContext = {}) {
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
    const previousRecord = full?.[idx - 1]?._decision?.waveRejectionProtection;
    const previous = isStock && previousRecord ? { ...previousRecord,
        finalRejectionDay: null, finalRejectionReason: '', finalRejectionReasonCode: '' } : previousRecord;
    const entryDayPressureVeto = getWaveEntryDayPressureVetoContext(idx, full, meta, prevPos, targetPosition, strategy);
    if (entryDayPressureVeto.status === 'entry_blocked') return entryDayPressureVeto;
    const currentEvent = isStock
        ? getWaveCurrentRejectionEventContext(idx, full, meta, prevPos, targetPosition, strategy, decisionContext)
        : empty;
    const continuingPendingBreak = previous?.status === 'pending_hard_break'
        && currentEvent.status === 'pending_hard_break' && previous.entryDay === currentEvent.entryDay;
    if (!continuingPendingBreak && ['triggered', 'pending_hard_break'].includes(currentEvent.status)) return currentEvent;
    if (['ma20_hold', 'pressure_hold'].includes(currentEvent.status)) targetPosition = Math.min(targetPosition, currentEvent.targetPosition);
    // 首破确认缓冲期：上一日首次破位只降到 pending 仓位并锁定，这里判定是否收复或最终确认清仓。
    if (previous?.status === 'pending_hard_break') {
        if (!isValidWavePendingBreakRecord(previous) || previous.triggerDay >= idx) {
            return { ...previous, active: true, status: 'invalid_pending_record', targetPosition: 0,
                recoveryPending: false, recoveryHoldRemaining: 0, recomputeRequired: true,
                reason: '首破观察关键日期或防守价无效，派生决策须从确认行情重算' };
        }
        const pendingEntryLow = previous.entrySignalLow;
        const downsideConfig = isIndex ? indexDownsideConfig : config.freshEntryDownsideFailure;
        const positiveNumber = value => typeof value === 'number' && Number.isFinite(value) && value > 0;
        const configuredCap = positiveNumber(downsideConfig?.hardBreakPendingPositionCap)
            ? Math.min(30, downsideConfig.hardBreakPendingPositionCap) : 30;
        const pendingCap = typeof previous.pendingPositionCap === 'number' && Number.isFinite(previous.pendingPositionCap)
            && previous.pendingPositionCap >= 0 ? previous.pendingPositionCap : configuredCap;
        const configuredDays = positiveNumber(downsideConfig?.hardBreakConfirmTradingDays)
            ? Math.min(1, downsideConfig.hardBreakConfirmTradingDays) : 1;
        const confirmDays = Number.isInteger(previous.confirmTradingDays) && previous.confirmTradingDays >= 1
            ? previous.confirmTradingDays : Math.max(1, configuredDays);
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
    // 价格解锁不保存永久入场许可；等待阶段每天复用同一事件资格，而非另开B6/B11捷径。
    const waitingForEntry = isStock && previous?.recoveryPending === true;
    if (previous?.active || waitingForEntry) {
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
        const recoveryRisk = getWaveRecoveryRiskContext(idx, full, meta, recoveryCap, strategy, decisionContext);
        const blockedByDecision = isStock ? recoveryRisk.blockedByDecision
            : !!meta?.inCooldown || (meta?.exitSignals || []).length > 0 || (meta?.warningSignals || []).length > 0
                || ((decisionContext.exit?.stateCode != null || !!decisionContext.exit?.level) && getExitStateCode(decisionContext.exit) !== EXIT_STATE.NONE);
        const ma20RejectionRecoveryBlocked = previous.eventType === 'fresh_entry_failure'
            && previous.ma20RejectionExit === true;
        let strongFreshRecovery = isStock
            && freshRecoveryEvents.has(previous.eventType)
            && age >= minimumStrongFreshRecoveryAge
            && !ma20RejectionRecoveryBlocked
            && postEvent.score >= minimumPostEventScore
            && postEvent.signals.length >= minimumPostEventGroups
            && marketAllowsRecovery
            && !blockedByDecision
            && targetPosition > 0;
        // 空仓后的新交易单独评估；旧结构收复/健康回踩仍走原恢复路径。
        // 不能把“有新积分”当作绕过普通首次建仓资格的通行证。
        let newEntry = null;
        if (isStock && prevPos <= 0 && decisionContext.waveContext?.inScope
            && freshRecoveryEvents.has(previous.eventType) && !ma20RejectionRecoveryBlocked) {
            const minimumAge = Math.max(minimumLockTradingDays, minimumStrongFreshRecoveryAge);
            const remainingDays = Math.max(0, minimumAge - age);
            let reason = blockedByDecision || blockedByRiskSignal || !marketAllowsRecovery ? 'risk'
                : remainingDays > 0 ? 'waiting'
                : postEvent.score < minimumPostEventScore || postEvent.signals.length < minimumPostEventGroups ? 'new-score'
                : targetPosition <= 0 ? 'no-target' : '';
            let entryDefense = null;
            if (!reason) {
                const entryMeta = { ...meta, windowScore: postEvent.score, windowScoreSignals: postEvent.signals };
                const qualification = getWaveRegimeQualification(idx, full, entryMeta, decisionContext.waveContext, rawSignals, strategy);
                entryDefense = getWaveEntryDefenseContext(idx, full, decisionContext.waveContext, rawSignals, strategy, { freshEventRecovery: true });
                if (!isWaveEntryRegimeQualified(decisionContext.waveContext, qualification)) reason = 'entry-qualification';
                else if (!entryDefense.acceptable) reason = 'defense-distance';
            }
            const reasonTexts = {
                risk: '当前仍有离场、预警、冷静期或风险限制，暂不建立新交易',
                waiting: `新交易观察期未结束，还需${remainingDays}个交易日`,
                'new-score': `止损后新积分为${postEvent.score}/${minimumPostEventScore}分，来自${postEvent.signals.length}/${minimumPostEventGroups}个独立计分组，尚未达标`,
                'no-target': '当前没有可执行的建仓目标，不能仅凭收复旧价位买回',
                'entry-qualification': `${decisionContext.waveContext.regimeLabel || '当前'}环境未满足本轮首次建仓资格`,
                'defense-distance': getWaveEntryDefenseRejectionText(entryDefense),
                ready: '止损后新信号、首次建仓资格与防守距离均已通过'
            };
            newEntry = { inScope: true, eligible: !reason, reason: reason || 'ready', reasonText: reasonTexts[reason || 'ready'],
                minimumAge, remainingDays, score: postEvent.score, groupCount: postEvent.signals.length };
            strongFreshRecovery = strongFreshRecovery && newEntry.eligible;
        }
        const pullbackConfig = config.pullbackRecovery || {};
        const pullbackEvents = new Set(pullbackConfig.eventTypes || ['mature_profit_rejection']);
        const recoveryRegime = decisionContext.waveContext?.regime || 'unknown';
        const supportRecoveryRegime = ['up', 'range'].includes(recoveryRegime);
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
        const sourceRecoveryPosition = pullbackSourcePositions.has(Number(previous.sourcePosition))
            ? Number(previous.sourcePosition)
            : 0;
        // 结构/信号失效后的恢复只回试探档；不能复用成熟浮盈减仓的原档回补数量。
        const pullbackRecoveryTarget = signalHardInvalidationPullback
            ? Math.min(Math.max(0, Number(previous.sourcePosition) || 0), recoveryCap)
            : sourceRecoveryPosition;
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
        const reentryRoute = strongFreshRecovery && !pullbackRecovery && prevPos <= 0 ? 'new-entry' : 'original-recovery';
        const canRelease = age >= minimumLockTradingDays
            && !blockedByRiskSignal
            && (!isStock || !recoveryRisk.blocked)
            && confirmedPostEventRecovery;
        if (!canRelease) {
            return {
                ...previous,
                active: !waitingForEntry,
                status: waitingForEntry ? 'recovery_pending' : 'locked',
                ...(isStock ? { newEntry, reentryRoute: null, recoveryPending: waitingForEntry, recoveryQualificationPassed: false, allowRecoveryIncrease: false } : {}),
                lockAge: age,
                lockRemaining: Math.max(0, minimumLockTradingDays - age),
                blockedByRiskSignal,
                blockedByDecision,
                ...(isStock ? { blockedByPositionCap: recoveryRisk.blockedByPositionCap,
                    hardInvalidation: recoveryRisk.hardInvalidation, recoveryRegime, supportRecoveryRegime } : {}),
                recoveredRiskHigh,
                hasFreshPostEventSignal,
                stableRecovery,
                strongFreshRecovery,
                pullbackRecovery,
                ...(isStock ? { recoveryRegime, supportRecoveryRegime } : {}),
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
        const executableRecovery = !isStock || prevPos > 0 || hasFreshPostEventSignal || strongFreshRecovery || pullbackRecovery
            || (stableRecovery && previous.eventType === 'entry_day_pressure_rejection');
        if (targetPosition > 0 && executableRecovery) {
            return {
                ...previous,
                active: false,
                status: 'released',
                ...(isStock ? { newEntry, reentryRoute } : {}),
                resolvedDay: idx,
                resolvedDate: item.date || '',
                recoveredRiskHigh,
                hasFreshPostEventSignal,
                stableRecovery,
                strongFreshRecovery,
                pullbackRecovery,
                ...(isStock ? { recoveryRegime, supportRecoveryRegime } : {}),
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
                ...(isStock ? { newEntry, reentryRoute } : {}),
                resolvedDay: idx,
                resolvedDate: item.date || '',
                recoveredRiskHigh,
                hasFreshPostEventSignal,
                stableRecovery,
                strongFreshRecovery,
                pullbackRecovery,
                ...(isStock ? { recoveryRegime, supportRecoveryRegime } : {}),
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
            ...(isStock ? { newEntry, reentryRoute: null, recoveryQualificationPassed: true, allowRecoveryIncrease: false } : {}),
            resolvedDay: idx,
            resolvedDate: item.date || '',
            recoveredRiskHigh,
            hasFreshPostEventSignal,
            stableRecovery,
            recoveryPending: true,
            recoveryHoldRemaining: 0,
            targetPosition: isStock ? 0 : targetPosition
        };
    }

    // 指数待恢复仍沿用原数量规则；个股已在上方共享事件资格检查中结算。
    if (!isStock && previous?.recoveryPending) {
        if (targetPosition <= 0) return { ...previous, status: 'recovery_pending',
            recoveryPending: true, recoveryHoldRemaining: 0, targetPosition };
        const recoveryCap = Math.max(0, Number(config.recoveryPositionCap) || 30);
        const marketRecoveryCap = getMarketIncreaseCap(decisionContext.market, decisionContext.targetStrength?.tier);
        return {
            ...previous, status: 'recovery_started', recoveryPending: false,
            recoveryHoldRemaining: Math.max(0, Number(config.recoveryHoldTradingDays) || 0),
            freshTakeoverSignals: ['B6', 'B11'].filter(signal => (item._signals || []).includes(signal)),
            trendRecovery: false,
            marketAllowsRecovery: marketRecoveryCap == null || marketRecoveryCap >= recoveryCap,
            allowRecoveryIncrease: false, targetPosition: Math.min(targetPosition, recoveryCap)
        };
    }

    if (Number(previous?.recoveryHoldRemaining) > 0) {
        const recoveryCap = isStock && Number.isFinite(previous.recoveryHoldPosition)
            ? previous.recoveryHoldPosition : Math.max(0, Number(config.recoveryPositionCap) || 30);
        const hardInvalidation = getTodaySignalInvalidations(meta, 'price-break').length > 0;
        const recoveryRisk = getWaveRecoveryRiskContext(idx, full, meta, recoveryCap, strategy, decisionContext);
        const canPreserveRecovery = previous.allowRecoveryIncrease
            && !decisionContext.isCriticalExit && !meta?.inCooldown && !hardInvalidation
            && (!isStock || (prevPos > 0 && !recoveryRisk.blocked));
        const preservedPosition = canPreserveRecovery
            ? Math.min(isStock ? prevPos : Math.max(prevPos, recoveryCap), recoveryCap) : 0;
        return {
            ...previous,
            status: 'recovery_hold',
            ...(isStock ? recoveryRisk : {}),
            recoveryHoldRemaining: Number(previous.recoveryHoldRemaining) - 1,
            allowRecoveryIncrease: canPreserveRecovery,
            targetPosition: canPreserveRecovery
                ? Math.max(Math.min(targetPosition, recoveryCap), preservedPosition)
                : Math.min(targetPosition, isStock ? Math.min(prevPos, recoveryCap) : Math.max(prevPos, recoveryCap))
        };
    }

    return isStock ? currentEvent : getWaveCurrentRejectionEventContext(idx, full, meta, prevPos, targetPosition, strategy, decisionContext);
}

function getWaveCurrentRejectionEventContext(idx, full, meta, prevPos, targetPosition, strategy, decisionContext) {
    const config = strategy.waveRejectionProtection;
    const empty = { active: false, status: 'none', targetPosition };
    const item = full?.[idx] || {};
    const close = Number(item.close);
    const isStock = state.mode === 'stock', isIndex = state.mode === 'index';
    const indexFreshEntryConfig = isIndex ? config?.indexFreshEntryFailure : null;
    const indexDownsideConfig = isIndex ? config?.indexFreshEntryDownsideFailure : null;
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
    const effectiveDefense = getWaveEffectiveDefense(decisionContext.waveContext || getWaveContext(idx, full, state.indicators, strategy),
        full?.[idx - 1]?._decision?.waveContext?.lifecycle, strategy);
    const currentHardDefense = effectiveDefense?.level ?? Number(full?.[idx - 1]?._decision?.waveContext?.lifecycle?.hardDefense);
    const holdsStructureDefense = Number.isFinite(currentHardDefense)
        && Number.isFinite(close)
        && close >= currentHardDefense;
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
    const classicFreshEntryFailureMatched = freshEntryConfig
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
        && stockFreshEntryCloseAllowed;
    const classicFreshEntryFailureTriggered = classicFreshEntryFailureMatched
        && (!freshEntryConfig.requireFrozenDefenseBreakForPressureFailure || !holdsStructureDefense);
    const pressureStructureHold = isStock && holdsStructureDefense
        && (stockMa20RejectionTriggered || (classicFreshEntryFailureMatched && freshEntryConfig.requireFrozenDefenseBreakForPressureFailure));
    const freshEntryFailureTriggered = (stockMa20RejectionTriggered && !holdsStructureDefense) || classicFreshEntryFailureTriggered;
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
        && !holdsStructureDefense;
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
    if (!triggered && !stockMa20HoldTriggered && !pressureStructureHold) return empty;
    if (!triggered) {
        const holdPositionCap = Math.max(0, Number(ma20RejectionConfig?.holdPositionCap) || 30);
        return {
            active: false,
            status: pressureStructureHold ? 'pressure_hold' : 'ma20_hold',
            eventType: pressureStructureHold ? 'fresh_entry_pressure_hold' : 'fresh_entry_ma20_hold',
            structureDefense: effectiveDefense || null,
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
