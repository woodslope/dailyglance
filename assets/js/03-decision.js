// 本地决策语义兼容戳：仅失效派生结果，不同步应用或信号发布版本。
const WAVE_DECISION_STATE_VERSION = 'wave-decision-v7';

// 决策上下文只暴露当前事实和上一状态；历史读取有明确截止日，不复制整条行情。
const wavePolicySnapshots = new WeakMap();
const waveEvaluationSources = new WeakMap();
function freezeWaveSnapshot(value) {
    if (!value || typeof value !== 'object') return value;
    if (Array.isArray(value)) return Object.freeze(value.map(freezeWaveSnapshot));
    return Object.freeze(Object.fromEntries(Object.entries(value).map(([key,item]) => [key,freezeWaveSnapshot(item)])));
}
function getWaveCycleKey(scope, lifecycle) {
    return lifecycle?.entryDate ? `${scope.strategy}:${scope.mode}:${scope.period}:${scope.symbol}:${lifecycle.entryDate}` : '';
}
function captureWaveDecisionState(scope, decision, prior = null) {
    const position = Number(decision?.position) || 0;
    const holding = position > 0 ? decision?.waveContext?.lifecycle || null : null;
    const cycleKey = getWaveCycleKey(scope, holding);
    const phaseRanks = { entry:1, confirmation:2, trend:3 };
    const currentRank = position >= 80 ? 3 : position >= 50 ? 2 : position > 0 ? 1 : 0;
    const priorRank = cycleKey && prior?.cycleKey === cycleKey ? phaseRanks[prior.confirmedPhase] || 0 : 0;
    const rank = Math.max(currentRank, priorRank);
    const observations = {};
    if (position > 0) {
        for (const [key,item] of Object.entries({ ma20:decision?.waveMA20PullbackObservation, expiry:decision?.waveExpiryHandoff,
            rangeUpper:holding?.upperObservation })) {
            if (item && !['taken_over','expired','closed'].includes(item.status)
                && (key === 'rangeUpper' || item.applied || item.forceHold)) observations[key] = { ...item, ownerCycleKey:cycleKey };
        }
    }
    const risk = decision?.waveRejectionProtection;
    const recoveryActive = risk && (risk.active || risk.recoveryPending || Number(risk.recoveryHoldRemaining) > 0
        || ['triggered','locked','entry_blocked','pending_hard_break','recovery_pending','ma20_hold','pressure_hold'].includes(risk.status));
    const eventKey = risk?.eventType ? `${scope.symbol}:${risk.eventType}:${risk.triggerDate || ''}` : '';
    const recovery = recoveryActive ? { ...risk, active:true, eventKey,
        phase:risk.recoveryPending ? 'waiting-entry' : Number(risk.recoveryHoldRemaining) > 0 ? 'recovery-observation' : 'risk-lock' } : null;
    const lastRiskEvent = eventKey ? { eventKey, eventType:risk.eventType, triggerDate:risk.triggerDate || '' }
        : prior?.lastRiskEvent || null;
    return freezeWaveSnapshot({ cycleKey, positionTier:position, confirmedPhase:position > 0 && !cycleKey ? 'legacy-holding' : (rank ? ['','entry','confirmation','trend'][rank] : 'flat'),
        holding, observations, recovery, lastRiskEvent, exitStateCode:decision?.waveState?.exitStateCode || getExitStateCode(decision?.exit) });
}
function getWaveEvaluationContext(idx, full, prevPos) {
    const scope = Object.freeze({ strategy:state.strategy, mode:state.mode, period:state.period,
        symbol:state.stockId || state.id || '' });
    const previous = full?.[idx - 1]?._decision;
    const signature = JSON.stringify(STRATEGY);
    let cached = wavePolicySnapshots.get(STRATEGY);
    if (!cached || cached.signature !== signature) {
        cached = { signature, snapshot:freezeWaveSnapshot(STRATEGY) };
        wavePolicySnapshots.set(STRATEGY,cached);
    }
    const bar = full?.[idx] || {};
    const context = { index:idx, date:bar.date || '', previousPosition:prevPos, scope, policy:cached.snapshot,
        indicators:Object.freeze({ ma5:state.indicators?.ma?.[5]?.[idx],ma20:state.indicators?.ma?.[20]?.[idx],
            ma60:state.indicators?.ma?.[60]?.[idx],ma20FiveDaysAgo:state.indicators?.ma?.[20]?.[idx - 5],
            macd:state.indicators?.macd?.diff?.[idx],k:state.indicators?.kdj?.k?.[idx],d:state.indicators?.kdj?.d?.[idx] }),
        bar:freezeWaveSnapshot({ date:bar.date,open:bar.open,high:bar.high,low:bar.low,close:bar.close,vol:bar.vol,isLive:!!bar._isLive }),
        rawSignals:Object.freeze([...(bar._signals || [])]),
        previousState:captureWaveDecisionState(scope,previous,previous?.waveState),
        readPastRow(day) {
            if (!Number.isInteger(day) || day < 0 || day >= idx || !full[day]) return null;
            return freezeWaveSnapshot(full[day]);
        } };
    Object.freeze(context);
    waveEvaluationSources.set(context,{ full, indicators:state.indicators, policy:cached.snapshot,
        signature, previousSignature:JSON.stringify(previous), indicatorKey:state.indicatorKey,
        barSignature:JSON.stringify([bar.date,bar.open,bar.high,bar.low,bar.close,bar.vol,!!bar._isLive,bar._signals || []]) });
    return context;
}
function getWaveEvaluationSources(context) {
    const sources = waveEvaluationSources.get(context);
    if (!sources || state.strategy !== context.scope.strategy || state.mode !== context.scope.mode
        || state.period !== context.scope.period || (state.stockId || state.id || '') !== context.scope.symbol
        || JSON.stringify(STRATEGY) !== sources.signature || state.indicators !== sources.indicators
        || state.indicatorKey !== sources.indicatorKey
        || JSON.stringify(sources.full?.[context.index - 1]?._decision) !== sources.previousSignature
        || (() => { const bar = sources.full?.[context.index] || {}; return JSON.stringify([bar.date,bar.open,bar.high,bar.low,
            bar.close,bar.vol,!!bar._isLive,bar._signals || []]) !== sources.barSignature; })()) {
        throw new Error('波段决策上下文已改变，须重新捕获后计算');
    }
    return sources;
}
// 同一根K线的环境事实只计算一次；请求层只获得浅层投影，不得改动共享事实。
function getWaveContextForEvaluation(context, policy) {
    const sources = getWaveEvaluationSources(context);
    if (JSON.stringify(policy) !== sources.signature) {
        return getWaveContext(context.index,sources.full,sources.indicators,policy);
    }
    if (!sources.waveFacts) sources.waveFacts = freezeWaveSnapshot(
        getWaveContext(context.index,sources.full,sources.indicators,context.policy));
    return { ...sources.waveFacts };
}
// 治理后的目标和生效上限保留在上下文内，不允许后续规则删字段或再抬仓。
function recordWaveApproval(context, request) {
    const sources = getWaveEvaluationSources(context);
    sources.approval = Object.freeze({ position:request.requestedPosition,
        caps:Object.freeze([request.positionCap?.limit,request.waveRiskCap?.limit,request.waveContext?.appliedRegimeCap?.limit]
            .filter(Number.isFinite)) });
}
function getBaseActionHint(position, prevPos, meta, exit, protection, critical) {
    if (position === 0) return prevPos > 0 ? (critical ? ACTION_STATE.HARD_EXIT : ACTION_STATE.EXIT)
        : (critical ? ACTION_STATE.AVOID : ACTION_STATE.FLAT);
    if (position < prevPos) return ACTION_STATE.REDUCE;
    if (position > prevPos) return prevPos === 0 ? (position <= 30 ? ACTION_STATE.ENTER_TRIAL : ACTION_STATE.ENTER)
        : (position <= 30 ? ACTION_STATE.ADD_TRIAL : ACTION_STATE.ADD);
    if (position <= 30) return [EXIT_STATE.REDUCE,EXIT_STATE.DEFENSIVE].includes(getExitStateCode(exit))
        || meta.warningSignals?.length || protection?.status === 'pressure_hold' ? ACTION_STATE.CAUTIOUS_HOLD : ACTION_STATE.TRIAL_HOLD;
    return getSignalStateCode(meta) === SIGNAL_STATE.HOLD && meta.buySignals.length === 0 ? ACTION_STATE.TREND_HOLD : ACTION_STATE.HOLD;
}
function getWaveGovernedActionCode(position, prevPos, candidate) {
    const hint = getDecisionActionCode(candidate);
    if (position <= 0) return prevPos > 0
        ? ([EXIT_STATE.HARD,EXIT_STATE.STRONG].includes(getExitStateCode(candidate?.exit)) ? ACTION_STATE.HARD_EXIT : ACTION_STATE.EXIT)
        : (hint === ACTION_STATE.AVOID ? ACTION_STATE.AVOID : ACTION_STATE.FLAT);
    if (position < prevPos) return ACTION_STATE.REDUCE;
    if (position > prevPos) return prevPos <= 0 ? (position <= 30 ? ACTION_STATE.ENTER_TRIAL : ACTION_STATE.ENTER)
        : (position <= 30 ? ACTION_STATE.ADD_TRIAL : ACTION_STATE.ADD);
    return position <= 30 ? (hint === ACTION_STATE.CAUTIOUS_HOLD ? hint : ACTION_STATE.TRIAL_HOLD)
        : (hint === ACTION_STATE.TREND_HOLD ? hint : ACTION_STATE.HOLD);
}
function presentDecisionAction(code, position, prevPos) {
    const labels = Object.fromEntries(Object.entries(ACTION_STATE_LEGACY).map(([label,id]) => [id,label]));
    const bear = [ACTION_STATE.AVOID,ACTION_STATE.HARD_EXIT,ACTION_STATE.EXIT];
    const warn = [ACTION_STATE.REDUCE,ACTION_STATE.CAUTIOUS_HOLD];
    const info = [ACTION_STATE.ENTER_TRIAL,ACTION_STATE.ADD_TRIAL,ACTION_STATE.TRIAL_HOLD];
    return { simpleAction:labels[code] || '持币观望',
        simpleColorClass:bear.includes(code) ? 'text-bear' : warn.includes(code) ? 'text-warn'
            : info.includes(code) ? 'text-info' : code === ACTION_STATE.FLAT ? 'text-dim' : 'text-bull',
        bsMark:prevPos <= 0 && position > 0 ? 'B' : prevPos > 0 && position <= 0 ? 'S' : null };
}
function asWavePositionRequest(decision) {
    const code = decision?.exit?.stateCode || decision?.exitStateCode || decision?.waveState?.exitStateCode || getExitStateCode(decision?.exit);
    const exit = decision?.exit ? Object.defineProperty({ ...decision.exit },'stateCode',{value:code,enumerable:false}) : decision?.exit;
    if (decision?.kind === 'wave-position-request') {
        // 旧研究hook可返回旧字段；导入时明确转换，生产请求不携带呈现字段。
        const { position, simpleAction, simpleColorClass, bsMark, ...data } = decision;
        return { ...data, exit, requestedPosition:position === undefined ? decision.requestedPosition : position,
            actionHint:simpleAction === undefined ? decision.actionHint : getDecisionActionCode({simpleAction}) };
    }
    const { position, simpleAction, simpleColorClass, bsMark, actionCode, ...data } = decision;
    return { ...data, exit, kind:'wave-position-request', requestedPosition:position,
        actionHint:getDecisionActionCode(decision) };
}
function legacyDecisionFromRequest(request, prevPos) {
    const { kind, phase, requestedPosition, actionHint, ...data } = request;
    return Object.defineProperty({ ...data, position:requestedPosition, ...presentDecisionAction(actionHint,requestedPosition,prevPos) },
        'actionCode', {value:actionHint,enumerable:false});
}
function finishWaveRequest(request, prevPos, candidateOnly) {
    return candidateOnly ? request : legacyDecisionFromRequest(request,prevPos);
}

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
            || getExitStateCode(exit) !== EXIT_STATE.NONE
            || invalidatedToday;
        const nextPeriods = config.defensiveObservation?.nextDayMovingAveragePeriods || [5, 20];
        const recoveredMovingAverages = Number.isFinite(close) && nextPeriods.every(period => {
            const level = Number(state.indicators?.ma?.[Number(period)]?.[idx]);
            return Number.isFinite(level) && close > level;
        });
        const hasFreshSignal = state.mode === 'stock'
            ? getWaveObservationBuyEvents(idx, full, state.indicators, previous.triggerDay, meta, strategy).length > 0
            : (meta?.windowScoreSignals || []).some(signal => Number(signal.day) > Number(previous.triggerDay));
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
        const followUp = {
            ...previous,
            applied: false,
            status: takeoverPassed ? 'taken_over' : 'expired',
            followUpDay: idx,
            followUpDate: full?.[idx]?.date || '',
            recoveredMovingAverages, hasFreshSignal, brokeObservationLow, brokeEntryLow,
            hardBreak, invalidatedToday, observationAge, maxTradingDays,
            currentEstablishedUptrend, withinWashoutRange,
            forceExit: !takeoverPassed,
            forceHold: takeoverPassed && Number(basePosition) <= 0
        };
        const failure = takeoverPassed ? null : getWaveExpiryObservationFailureContext(followUp, meta, exit);
        return { ...followUp, failureReasonCode: failure?.code || '', reason: failure?.text
            || '到期防守观察后重新站上短期与中期均线，或出现新的有效买入信号' };
    }
    if (prevPos !== requiredPosition || Number(basePosition) > 0 || idx <= 0) return empty;
    if (meta?.inCooldown || (meta?.exitSignals || []).length || (meta?.warningSignals || []).length) return empty;
    if (!exit || getExitStateCode(exit) !== EXIT_STATE.NONE) return empty;
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

function getWaveMA20PullbackObservationContext(idx, full, meta, prevPos, basePosition, exit, risk, strategy = STRATEGY, waveContext = null) {
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
    const effectiveDefense = getWaveEffectiveDefense(waveContext || getWaveContext(idx, full, state.indicators, strategy),
        full?.[idx - 1]?._decision?.waveContext?.lifecycle, strategy);
    const currentDefenseLevel = effectiveDefense?.level ?? Number(risk?.stop);
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
    const breakoutDefenseLevel = currentDefenseLevel;
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
    // 已有观察必须先结算；不能因今天仍贴近均线而重置期限和观察低点。
    if (breakoutPullback && !previous?.applied) {
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
        || getExitStateCode(exit) !== EXIT_STATE.NONE
        || invalidatedToday;

    const observationBelongsToPosition = prevPos > 0 && (previous?.ownerEntryDay == null
        || previous.ownerEntryDay === full?.[idx - 1]?._decision?.waveContext?.lifecycle?.entryDay);
    if (previous?.applied && observationBelongsToPosition) {
        const defenseLevel = effectiveDefense?.level ?? Number(previous.defenseLevel);
        const recoveredMovingAverage = Number.isFinite(close) && Number.isFinite(movingAverage) && close >= movingAverage;
        const eligibleFreshSignals = getWaveEligibleFreshBuySignals(idx, full, meta, strategy);
        const freshTakeoverSignals = (config.takeoverSignals || ['B6', 'B11']).filter(signal => eligibleFreshSignals.includes(signal));
        const brokeObservationLow = Number.isFinite(close)
            && Number.isFinite(Number(previous.triggerLow))
            && close < Number(previous.triggerLow);
        const brokeDefenseLevel = Number.isFinite(close)
            && Number.isFinite(defenseLevel)
            && close < defenseLevel;
        // 动能/有限失效观察允许新的有效MA20回踩接管；单根观察K低点不冒充结构硬止损。
        // 普通下影与突破回踩观察仍须守住原观察低点，所有类型都不得绕过防守位或风险阻断。
        const freshTrendRepair = ['standalone_l3', 'limited_hard_invalidation'].includes(previous.defenseType)
            && !blocked && !brokeDefenseLevel
            && [close, movingAverage, previousTrendMovingAverage].every(Number.isFinite)
            && movingAverage >= previousTrendMovingAverage
            && freshTakeoverSignals.some(signal => signal === 'B6'
                ? close >= movingAverage
                : signal === 'B11' && close > movingAverage);
        const takeoverPassed = !blocked
            && (previous.oneDayL3Closure || !brokeObservationLow || freshTrendRepair)
            && !brokeDefenseLevel
            && (recoveredMovingAverage || freshTakeoverSignals.length > 0);
        const followUp = {
            ...previous,
            applied: false,
            status: takeoverPassed ? 'taken_over' : 'expired',
            followUpDay: idx,
            followUpDate: item.date || '',
            recoveredMovingAverage,
            freshTakeoverSignals,
            brokeObservationLow,
            brokeDefenseLevel,
            freshTrendRepair,
            forceExit: !takeoverPassed,
            forceHold: takeoverPassed && (previous?.defenseType ? true : Number(basePosition) <= 0),
            overrideCriticalExit: false,
            targetPosition: requiredPosition
        };
        followUp.reason = takeoverPassed
            ? `MA${period}回踩观察后重新站回均线，或出现新的B6/B11信号`
            : getWaveMA20ObservationFailureText(followUp, meta, exit);
        return followUp;
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
        const defenseLevel = currentDefenseLevel;
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
            && !hasSignalStateFlag(meta, 'liquidation')
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
    const defenseLevel = currentDefenseLevel;
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

// 补齐尚未进入原MA20观察的单独L3：只启动观察，不改变触发日仓位或风险优先级。
function getWaveStandaloneL3ObservationContext(idx, full, meta, prevPos, waveContext, risk, currentObservation) {
    if (currentObservation?.applied || currentObservation?.forceExit || currentObservation?.forceHold) return currentObservation;
    if (state.strategy !== '波段抄底型' || state.mode !== 'stock' || state.period !== 'daily'
        || !waveContext?.inScope || !['down','range','up','transition'].includes(waveContext.regime)
        || prevPos <= 0 || meta?.inCooldown || !isWaveStandaloneL3Observation(meta, STRATEGY)) return currentObservation;
    const lifecycle = full?.[idx - 1]?._decision?.waveContext?.lifecycle;
    const effectiveDefense = getWaveEffectiveDefense(waveContext, lifecycle);
    const defense = effectiveDefense?.level ?? risk?.stop;
    const close = Number(full?.[idx]?.close);
    if (!Number.isFinite(defense) || defense <= 0 || !Number.isFinite(close) || close < defense) return currentObservation;
    return {
        applied: true, status: 'observing', defenseType: 'standalone_l3', oneDayL3Closure: true,
        overrideCriticalExit: true, triggerDay: idx, triggerDate: full[idx].date,
        triggerLow: full[idx].low, triggerClose: close, sourcePosition: prevPos, targetPosition: 30,
        ownerEntryDay: lifecycle?.entryDay ?? null, ownerEntryDate: lifecycle?.entryDate || '',
        movingAveragePeriod: 20, movingAverage: state.indicators?.ma?.[20]?.[idx],
        defenseLevel: defense, defenseSource: effectiveDefense?.source || 'existing-defense',
        reason: '单独MACD死叉，本日最多保留30%观察；下一交易日须站回20日线或出现新的有效回踩确认，否则离场'
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

// 两种回踩确认共用准入检查；信号当天性、观察来源和严格价格边界由各入口保留。
function getWaveConfirmationAddBaseContext({ idx, full, meta, prevPos, exit, config, period = 20, slopeDays = 1 }) {
    if (!config || state.strategy !== '波段抄底型' || state.period !== 'daily') return null;
    if (config.stocksOnly !== false && state.mode !== 'stock') return null;
    const sourcePosition = Math.max(0, Number(config.sourcePosition) || 30);
    if (prevPos !== sourcePosition || getSignalStateCode(meta) !== SIGNAL_STATE.HOLD) return null;
    if (meta.inCooldown || meta.exitSignals?.length || meta.warningSignals?.length) return null;
    if (getExitStateCode(exit) !== EXIT_STATE.NONE) return null;

    period = Math.max(1, Number(period) || 20);
    slopeDays = Math.max(1, Number(slopeDays) || 1);
    const close = Number(full?.[idx]?.close);
    const movingAverage = Number(state.indicators?.ma?.[period]?.[idx]);
    const previousMovingAverage = Number(state.indicators?.ma?.[period]?.[idx - slopeDays]);
    if (![close, movingAverage, previousMovingAverage].every(Number.isFinite)) return null;
    if (close < movingAverage || movingAverage < previousMovingAverage) return null;
    return {
        sourcePosition,
        targetPosition: Math.max(sourcePosition, Number(config.targetPosition) || 50),
        close, movingAveragePeriod: period, movingAverage, previousMovingAverage,
        triggerDay: idx, triggerDate: full?.[idx]?.date || ''
    };
}

function getWaveB6TrendAddContext(idx, full, meta, prevPos, exit, strategy = STRATEGY) {
    const config = strategy?.waveB6TrendAdd;
    const empty = { eligible: false, applied: false, reason: '' };
    const common = getWaveConfirmationAddBaseContext({
        idx, full, meta, prevPos, exit, config,
        period: config?.movingAveragePeriod, slopeDays: config?.slopeLookbackDays
    });
    if (!common || !(full?.[idx]?._signals || []).includes('B6')) return empty;
    const { close, ...confirmation } = common;
    return {
        eligible: true,
        applied: false,
        reason: `当日缩量回踩MA${common.movingAveragePeriod}后收回，且MA${common.movingAveragePeriod}未下行，允许波段试探仓进入趋势修复加仓`,
        ...confirmation,
        triggerLow: Number(full?.[idx]?.low),
        triggerClose: close
    };
}

// 突破等待与建仓防守共用同一信号实例：最新突破失效后，不回退借用更早的旧突破。
function getWaveActiveBreakoutContext(idx, full, strategy = STRATEGY, options = {}) {
    const signals = new Set(strategy?.wavePositionStages?.breakoutPullbackWait?.triggerSignals || ['B19']);
    const windowDays = Math.max(1, Number(strategy?.windowDays) || 10);
    for (let day = options.includeToday ? idx : idx - 1; day >= Math.max(0, idx - windowDays); day--) {
        const decision = day < idx ? full?.[day]?._decision : null;
        if (decision?.bsMark === 'S' && decision.waveRejectionProtection?.eventType === 'structure_hard_break') break;
        const trigger = (full?.[day]?._signals || []).find(signal => signals.has(signal));
        if (!trigger) continue;
        if (getWindowSignalInvalidation(trigger, day, idx, full, state.indicators, strategy)) return null;
        return { trigger, day, date: full?.[day]?.date || '', age: idx - day };
    }
    return null;
}

function getWavePositionStageContext(idx, full, meta, prevPos, requestedPosition, exit, strategy = STRATEGY, waveShortRepair = null, observationFailed = false) {
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
    const blocked = observationFailed || meta?.inCooldown
        || (meta?.exitSignals || []).length > 0
        || (meta?.warningSignals || []).length > 0
        || !exit
        || getExitStateCode(exit) !== EXIT_STATE.NONE;
    const close = Number(full?.[idx]?.close);
    const trendPeriod = Math.max(1, Number(config.trendMovingAveragePeriod) || 20);
    const longPeriod = Math.max(1, Number(config.longMovingAveragePeriod) || 60);
    const slopeDays = Math.max(1, Number(config.trendSlopeLookbackDays) || 5);
    const trendMA = Number(state.indicators?.ma?.[trendPeriod]?.[idx]);
    const previousTrendMA = Number(state.indicators?.ma?.[trendPeriod]?.[idx - 1]);
    const slopeTrendMA = Number(state.indicators?.ma?.[trendPeriod]?.[idx - slopeDays]);
    const longMA = Number(state.indicators?.ma?.[longPeriod]?.[idx]);
    const scoreGroups = strategy?.scoreGroups || [];
    const freshBuySignals = getWaveEligibleFreshBuySignals(idx, full, meta, strategy)
        .filter(signal => !invalidatedTodaySignals.has(signal));
    const pullbackWait = config.breakoutPullbackWait || {};
    const pullbackSignals = new Set(pullbackWait.takeoverSignals || ['B6', 'B11']);
    const triggerSignalSet = new Set(pullbackWait.triggerSignals || ['B19']);
    const recentBreakout = getWaveActiveBreakoutContext(idx, full, strategy);
    const freshPullbackSignal = freshBuySignals.find(signal => pullbackSignals.has(signal)) || '';
    const groupedSignals = new Set(scoreGroups.flat());
    const groupedFreshCount = scoreGroups.filter(group => group.some(signal => freshBuySignals.includes(signal))).length;
    const ungroupedFreshCount = freshBuySignals.filter(signal => !groupedSignals.has(signal)).length;
    const freshGroupCount = groupedFreshCount + ungroupedFreshCount;
    // 修复只提供新增风险资格；数量沿用统一目标，并受确认仓上限约束。
    const repairPosition = Math.min(requested, confirmationCap);
    const shortRepairStage = !blocked && waveShortRepair?.qualified && [0, entryCap].includes(previous)
        ? {
            inScope: true, limited: repairPosition < requested, increaseApplied: repairPosition > previous,
            stage: repairPosition >= confirmationCap ? 'confirmation' : 'entry', shortRepairEligible: true,
            triggerSignal: waveShortRepair.triggerSignal, triggerSignals: waveShortRepair.triggerSignals || [],
            freshGroupCount, previousPosition: previous, requestedPosition: requested, allowedPosition: repairPosition,
            reason: `${waveShortRepair.reason}，按统一目标取${repairPosition}%仓位，最高${confirmationCap}%`
        }
        : null;

    // 仓位是模型建议，不是账户成交进度；完整趋势证据不要求昨日先建议50%。
    // 统一目标不足80%时不抬高目标，风险限制仍在后续链路裁定。
    const freshTrendSignal = (config.trendContinuationSignals || []).find(signal => rawSignals.includes(signal) && !invalidatedTodaySignals.has(signal)) || '';
    const completeUptrend = [close, trendMA, longMA, slopeTrendMA].every(Number.isFinite)
        && close > trendMA && trendMA > longMA && trendMA >= slopeTrendMA;
    const trendEvidenceReady = !blocked && !!freshTrendSignal && completeUptrend
        && Number(meta?.windowScore) >= Number(strategy?.buyThreshold);
    const trendStage = previous < trendCap && requested >= trendCap && trendEvidenceReady
        ? {
            inScope: true, limited: requested > trendCap, increaseApplied: true, stage: 'trend',
            triggerSignal: freshTrendSignal, triggerSignals: [freshTrendSignal], freshGroupCount,
            previousPosition: previous, requestedPosition: requested, allowedPosition: trendCap,
            reason: `完整多头中当日新${freshTrendSignal}确认趋势延续，${previous <= 0 ? '首次建议' : `建议由${previous}%提高至`}${trendCap}%；仍须通过建仓资格、环境与风险限制`
        }
        : null;

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
        // 仍等首次回踩时不得借趋势证据追价；回踩已成立且趋势证据完整则不强制先给30%。
        if (trendStage && !shortRepairStage) return trendStage;
        if (recentBreakout && freshPullbackSignal) {
            return {
                inScope: true, limited: requested > entryCap, increaseApplied: requested > 0, stage: 'entry',
                triggerSignal: freshPullbackSignal, triggerSignals: [freshPullbackSignal], freshGroupCount,
                previousPosition: previous, requestedPosition: requested, allowedPosition: Math.min(requested, entryCap),
                waitingForPullback: false, breakoutDate: recentBreakout.date, breakoutAge: recentBreakout.age,
                reason: `${recentBreakout.date}突破后当日新${freshPullbackSignal}回踩确认，允许${entryCap}%低吸试探`
            };
        }
        // 突破等待与首次回踩试探优先，不能借修复资格跳过。
        if (shortRepairStage) return shortRepairStage;
        const hasStrongReversal = (config.strongReversalSignals || []).some(signal => rawSignals.includes(signal) && !invalidatedTodaySignals.has(signal));
        const strongReversalConfirmed = hasStrongReversal
            && freshGroupCount >= Math.max(2, Number(config.minimumStrongReversalGroups) || 2);
        const strongEntry = !blocked && (!!structureSignal || strongReversalConfirmed);
        const cap = strongEntry ? strongEntryCap : entryCap;
        const allowedPosition = strongEntry ? strongEntryCap : Math.min(requested, cap);
        const entryTriggerSignals = structureSignal
            ? [structureSignal]
            : (strongEntry ? freshBuySignals : []);
        return {
            inScope: true, limited: allowedPosition < requested, increaseApplied: allowedPosition > 0,
            stage: strongEntry ? 'confirmation' : 'entry',
            triggerSignal: structureSignal || (strongEntry ? 'multi-reversal' : ''),
            triggerSignals: entryTriggerSignals, freshGroupCount, previousPosition: previous, requestedPosition: requested, allowedPosition,
            reason: strongEntry
                ? `当日${structureSignal || '底背离与多组反转信号'}完成底部确认，首次建仓允许提高至${strongEntryCap}%确认仓`
                : `当前仅完成早期修复，首次建仓按${entryCap}%试探仓处理`
        };
    }

    if (shortRepairStage) return shortRepairStage;
    if (trendStage) return trendStage;

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
        const confirmed = !blocked && (b6Confirmed || b11Confirmed || b19Confirmed);
        const allowedPosition = confirmed ? confirmationCap : Math.min(requested, entryCap);
        return {
            inScope: true, limited: allowedPosition < requested, increaseApplied: allowedPosition > previous,
            stage: confirmed ? 'confirmation' : 'entry', triggerSignal: confirmed ? freshSignal : '',
            triggerSignals: confirmed ? [freshSignal] : [], freshGroupCount, previousPosition: previous, requestedPosition: requested, allowedPosition,
            reason: observationFailed ? '防守观察未通过，停止加仓并执行离场' : confirmed
                ? `当日新${freshSignal}完成反转确认，允许${entryCap}%试探仓提高至${confirmationCap}%确认仓`
                : `尚无当日新B6/B11/B19确认事件，维持${entryCap}%试探仓`
        };
    }

    if (previous === confirmationCap) {
        const allowedPosition = Math.min(requested, confirmationCap);
        return {
            inScope: true, limited: allowedPosition < requested, increaseApplied: false,
            stage: 'confirmation', triggerSignal: '', triggerSignals: [], freshGroupCount,
            previousPosition: previous, requestedPosition: requested, allowedPosition,
            reason: observationFailed ? '防守观察未通过，停止加仓并执行离场'
                : '尚无完整多头中的当日放量突破事件或统一目标不足80%，维持风险限制内的确认仓'
        };
    }

    return {
        ...empty, inScope: true, stage: previous >= trendCap ? 'trend' : (previous >= confirmationCap ? 'confirmation' : 'entry')
    };
}

// 只补齐已确认上涨持仓的积分基准；与弱积分趋势抱单一致，不授予开仓/加仓许可。
function getWaveHoldingBaselineContext(idx, full, meta, prevPos, exit, waveContext, options = {}) {
    const empty = { eligible: false, applied: false, reason: '' };
    const score = Number(meta?.windowScore);
    if (state.strategy !== '波段抄底型' || state.mode !== 'stock' || state.period !== 'daily'
        || !waveContext?.inScope || waveContext.regime !== 'up' || ![50, 80].includes(prevPos)
        || getSignalStateCode(meta) !== SIGNAL_STATE.WATCH || score !== Number(STRATEGY.holdThreshold)
        || score >= Number(STRATEGY.buyThreshold) || Number(options.requestedPosition) !== 30) return empty;
    const previous = full?.[idx - 1]?._decision;
    const lifecycle = previous?.waveContext?.lifecycle;
    if (!lifecycle?.active || !Number.isInteger(lifecycle.entryDay) || lifecycle.entryDay < 0 || lifecycle.entryDay >= idx
        || full?.[lifecycle.entryDay]?.date !== lifecycle.entryDate || previous.position !== prevPos
        || lifecycle.positionLayer !== prevPos || lifecycle.localDefenseGuard?.active || previous?.softSignalGrace?.applied
        || previous?.waveExpiryB11TakeoverAdd?.active) return empty;
    const rawSignals = full?.[idx]?._signals || [];
    const invalidatedToday = [...(meta.invalidatedWindowSignals || []), ...(meta.localBreakWindowSignals || [])]
        .some(item => Number(item.invalidationDay) === idx);
    if (meta.inCooldown || meta.exitSignals?.length || meta.warningSignals?.length
        || getExitStateCode(exit) !== EXIT_STATE.NONE || invalidatedToday || options.wavePeak?.confirmed
        || rawSignals.some(signal => signal.startsWith('L') || signal.startsWith('W'))) return empty;
    const observations = [previous.waveMA20PullbackObservation, previous.waveExpiryHandoff];
    const protection = previous.waveRejectionProtection;
    if (observations.some(item => item?.applied || item?.forceHold)
        || protection?.active || protection?.recoveryPending || Number(protection?.recoveryHoldRemaining) > 0
        || ['locked', 'pending_hard_break', 'recovery_pending', 'ma20_hold', 'pressure_hold'].includes(protection?.status)) return empty;
    const close = Number(full?.[idx]?.close), ma20 = Number(state.indicators?.ma?.[20]?.[idx]);
    const ma60 = Number(state.indicators?.ma?.[60]?.[idx]);
    const slopeMA20 = Number(state.indicators?.ma?.[20]?.[idx - 5]);
    const defense = getWaveEffectiveDefense(waveContext, lifecycle);
    if (![close, ma20, ma60, slopeMA20].every(Number.isFinite)
        || !(close > ma20 && ma20 > ma60 && ma20 >= slopeMA20)
        || !defense || close < defense.level) return empty;
    const localDefense = options.b11StructureDefense;
    if (localDefense?.localBreak && close <= Number(localDefense.localLevel)) return empty;
    return { eligible: true, applied: false, score, previousPosition: prevPos,
        requestedPosition: 30, targetPosition: prevPos,
        reason: `上涨结构与本轮防守仍有效，买入积分${score}分只限制新增风险，维持原${prevPos}%策略参考仓位` };
}

function computeBaseDecisionForIndex(idx, full, prevPos, options = {}) {
    const context = options.context || (state.strategy === '波段抄底型' ? getWaveEvaluationContext(idx,full,prevPos) : null);
    const request = evaluateBasePositionRequest(idx,full,prevPos,context);
    return finishWaveRequest({ ...request, phase:'base' },prevPos,options.candidateOnly);
}
function evaluateBasePositionRequest(idx, full, prevPos, context) {
    // 普通策略在同一同步调用内直接读取事实，不构造未使用的波段状态快照。
    // 显式上下文与波段路径仍经过原有不可变事实和失效校验。
    const { indicators, policy } = context ? getWaveEvaluationSources(context) : { indicators:state.indicators, policy:STRATEGY };
    const scope = context?.scope || state;
    const rawMeta = getSignalMeta(idx, full, indicators), market = getMarketContext(full[idx].date);
    const rawSignals = context?.rawSignals || full[idx]?._signals || [];
    const wavePeak = getWavePeakContext(idx, full, indicators, rawMeta);
    const risk = getRiskContext(idx, full, indicators), rawExit = getExitSeverity(rawMeta, idx, full, indicators);
    const trendRegime = getTrendRegimeContext(idx, full, indicators);
    const waveContext = context ? getWaveContextForEvaluation(context,policy) : getWaveContext(idx,full,indicators,policy);
    let waveL10TrendHandoff = getWaveL10TrendHandoffContext(idx, full, rawMeta, prevPos, policy);
    let meta = rawMeta;
    if (waveL10TrendHandoff.eligible) {
        meta = getSignalMeta(idx, full, indicators, { currentSignals: rawSignals.filter(signal => signal !== 'L10') });
    }
    const waveBottomL3Observation = scope.strategy === '波段抄底型'
        && scope.mode === 'stock'
        && scope.period === 'daily'
        && prevPos > 0
        && waveContext?.inScope
        && ['down', 'range', 'transition'].includes(waveContext.regime)
        && isWaveStandaloneL3Observation(rawMeta, policy);
    const waveStandaloneL3Observation = scope.strategy === '波段抄底型'
        && scope.period === 'daily'
        && prevPos > 0
        && (isWaveStandaloneL3Observation(rawMeta, policy) && (!waveContext?.inScope || waveContext.regime === 'up' || waveBottomL3Observation));
    let exit = waveL10TrendHandoff.eligible
        ? createExitState(EXIT_STATE.REDUCE, '完整多头结构中单独出现MACD顶背离，先降仓预警，不单信号归零')
        : (waveStandaloneL3Observation
            ? createExitState(EXIT_STATE.REDUCE, '单独MACD死叉只表示动能转弱，先降至或维持30%观察结构确认')
            : rawExit);
    const b11StructureDefense = getB11StructureDefenseContext(meta, full, policy);
    let waveB6TrendAdd = getWaveB6TrendAddContext(idx, full, meta, prevPos, exit, policy);
    let base = getBasePosition(idx, full, indicators, meta);
    const isWaveStockTrendHold = scope.strategy === '波段抄底型'
        && scope.mode === 'stock'
        && scope.period === 'daily'
        && getSignalStateCode(meta) === SIGNAL_STATE.HOLD
        && prevPos > 0;
    if (isWaveStockTrendHold) base = prevPos;
    if (waveB6TrendAdd.eligible) base = Math.max(base, waveB6TrendAdd.targetPosition);
    let waveHoldingBaseline = getWaveHoldingBaselineContext(idx, full, meta, prevPos, exit, waveContext,
        { requestedPosition: base, b11StructureDefense, wavePeak });
    if (waveHoldingBaseline.eligible) base = prevPos;
    const waveExpiryHandoff = getWaveExpiryHandoffContext(idx, full, meta, prevPos, base, exit, risk, policy);
    const waveMA20PullbackObservation = getWaveStandaloneL3ObservationContext(idx, full, rawMeta, prevPos, waveContext, risk,
        getWaveMA20PullbackObservationContext(idx, full, meta, prevPos, base, exit, risk, policy, waveContext));
    if (waveStandaloneL3Observation) base = prevPos;
    if (waveMA20PullbackObservation.overrideCriticalExit) {
        exit = createExitState(EXIT_STATE.REDUCE, '完整多头中的单独MACD死叉先作MA20防守观察');
    }
    const softSignalGrace = getSoftSignalGraceContext(meta, prevPos, base, exit, idx, policy);
    const localStructureDefense = getLocalStructureDefenseContext(meta, b11StructureDefense, prevPos, exit, policy);
    const observationFailed = !!(waveExpiryHandoff.forceExit || waveMA20PullbackObservation.forceExit);
    if (waveExpiryHandoff.applied || waveExpiryHandoff.forceHold) base = prevPos;
    if (waveMA20PullbackObservation.applied || waveMA20PullbackObservation.forceHold) base = prevPos;
    if (softSignalGrace.applied) base = prevPos;
    if (localStructureDefense.applied) base = prevPos;
    if (observationFailed) base = 0;
    const waveShortRepair = getWaveShortRepairContext(idx, full, meta, rawSignals, exit, prevPos, waveContext, policy);
    const wavePositionStage = getWavePositionStageContext(idx, full, meta, prevPos, base, exit, policy, waveShortRepair, observationFailed);
    if (wavePositionStage.inScope) base = wavePositionStage.allowedPosition;

    // 仓位只由信号、离场、预警和结构治理决定；风险指标不参与交易档位计算。
    let rawPosition = base, position = quantizePosition(rawPosition);
    let isCriticalExit = (getExitStateCode(exit) === EXIT_STATE.HARD || getExitStateCode(exit) === EXIT_STATE.STRONG
        || hasSignalStateFlag(meta, 'avoid-or-break'))
        && !waveL10TrendHandoff.eligible
        && !waveMA20PullbackObservation.overrideCriticalExit
        && !waveStandaloneL3Observation;

    if (isCriticalExit || meta.inCooldown || observationFailed) position = 0;
    else if (getExitStateCode(exit) === EXIT_STATE.REDUCE || getExitStateCode(exit) === EXIT_STATE.DEFENSIVE) position = quantizePosition(Math.min(position, 30));

    if (meta.warningSignals?.length) position = quantizePosition(Math.min(position, 30));
    if (waveL10TrendHandoff.eligible) position = quantizePosition(Math.min(position, waveL10TrendHandoff.targetPositionCap));
    const positionCap = getPositionCap(meta, prevPos, position, idx, full, indicators, wavePositionStage, waveShortRepair);
    if (positionCap) position = quantizePosition(Math.min(position, positionCap.limit));

    if (position > prevPos && Math.abs(position - prevPos) <= 10) position = prevPos;
    if (prevPos === 0 && position > 0 && getSignalStateCode(meta) === SIGNAL_STATE.HOLD) position = 0;
    const targetStrength = getTargetStrengthTier(meta, idx, full, indicators, risk, exit);
    const marketGate = applyMarketRiskGate(market, prevPos, position, targetStrength);
    position = marketGate.position;
    let waveRejectionProtection = isCriticalExit
        ? { active: false, status: 'superseded', targetPosition: position }
        : getWaveRejectionProtectionContext(idx, full, meta, prevPos, position, policy, {
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
        position = !observationFailed && waveRejectionProtection.allowRecoveryIncrease && protectedTarget > position
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
        isCriticalExit = [EXIT_STATE.HARD,EXIT_STATE.STRONG].includes(getExitStateCode(rawExit))
            || hasSignalStateFlag(rawMeta, 'avoid-or-break');
        waveRejectionProtection = { active: false, status: 'superseded', targetPosition: position };
    }
    const waveDriver = waveRejectionProtection.status === 'pending_hard_break'
        ? '首次建仓后跌破买入日最低价，先降到观察仓位，等待次日确认是否收复'
        : (waveRejectionProtection.status === 'hard_break_recovered'
        ? '首破后次日收盘收复买入日最低价，解除首破锁定'
        : (waveRejectionProtection.status === 'entry_blocked'
        ? '建仓日触及下降均线压力并长上影受阻，取消本次试探建仓'
        : (waveRejectionProtection.status === 'pressure_hold'
        ? '新仓冲击下降均线受阻，但本轮结构防守未破，最多保留30%并暂停加仓'
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
                : (['recovery_started', 'recovery_hold'].includes(waveRejectionProtection.status) ? '冲高回落风险解除后分步恢复' : ''))))))));
    if (waveHoldingBaseline.eligible) waveHoldingBaseline = {
        ...waveHoldingBaseline, applied: position === prevPos, finalPosition: position
    };
    const basePositionDriver = getPositionDriverText(meta, market, risk, exit, base, position, prevPos, positionCap, marketGate);
    const handoffDriver = waveL10TrendHandoff.applied ? waveL10TrendHandoff.reason : '';
    const expiryHandoffDriver = waveExpiryHandoff.applied ? waveExpiryHandoff.reason : '';
    const ma20PullbackDriver = waveMA20PullbackObservation.applied ? waveMA20PullbackObservation.reason : '';
    const b6TrendAddDriver = waveB6TrendAdd.applied ? waveB6TrendAdd.reason : '';
    const wavePositionStageDriver = wavePositionStage.limited ? wavePositionStage.reason : '';
    const wavePeakDriver = wavePeak.confirmed ? wavePeak.reason : '';
    const delayedRecoveryDriver = waveRejectionProtection.delayedPullback?.applied === true
        && waveRejectionProtection.delayedPullback.confirmationDate === full[idx]?.date
        ? waveRejectionProtection.delayedPullback.reason : '';
    const extraDrivers = [delayedRecoveryDriver || waveDriver, handoffDriver, expiryHandoffDriver, ma20PullbackDriver, b6TrendAddDriver, wavePositionStageDriver, wavePeakDriver, waveHoldingBaseline.applied ? waveHoldingBaseline.reason : ''].filter(Boolean).join('；');
    const positionDriver = extraDrivers ? `${basePositionDriver}${basePositionDriver ? '；' : ''}${extraDrivers}` : basePositionDriver;

    const actionHint = getBaseActionHint(position,prevPos,meta,exit,waveRejectionProtection,isCriticalExit);
    const previousWindowScore = Number(full?.[idx - 1]?._decision?.windowScore);
    const invalidatedTodayScore = (meta.invalidatedWindowSignals || [])
        .filter(item => Number(item?.invalidationDay) === Number(idx))
        .reduce((sum, item) => sum + (Number(item?.score) || 0), 0);
    const decision = {
        basePosition: base,
        kind:'wave-position-request', requestedPosition:position,
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
        signalReady: meta.windowScore >= policy.buyThreshold,
        windowScore: meta.windowScore,
        previousWindowScore: Number.isFinite(previousWindowScore) ? previousWindowScore : meta.windowScore + invalidatedTodayScore,
        softSignalGrace,
        localStructureDefense,
        b11StructureDefense,
        wavePositionStage,
        waveShortRepair,
        ...(waveHoldingBaseline.eligible ? { waveHoldingBaseline } : {}),
        wavePeak,
        waveB6TrendAdd,
        waveMA20PullbackObservation,
        waveExpiryHandoff,
        waveL10TrendHandoff,
        waveStandaloneL3Observation,
        waveRejectionProtection,
        previousSoftSignalGrace: !!full?.[idx - 1]?._decision?.softSignalGrace?.applied,
        actionHint
    };
    const bQuality = getWaveBQualityMetadata(meta, { ...decision, entryProposed:prevPos === 0 && position > 0 });
    return bQuality ? { ...decision, ...bQuality } : decision;
}

function getWaveExpiryB11TakeoverAddContext(idx, full, meta, prevPos, decision, strategy = STRATEGY) {
    const config = strategy?.waveExpiryB11TakeoverAdd;
    const empty = { eligible: false, applied: false, active: false, status: 'none', reason: '' };
    const common = getWaveConfirmationAddBaseContext({
        idx, full, meta, prevPos, exit: decision?.exit, config,
        period: config?.trendMovingAveragePeriod, slopeDays: config?.trendSlopeLookbackDays
    });
    if (!common) return empty;
    const previousHandoff = full?.[idx - 1]?._decision?.waveExpiryHandoff;
    const invalidatedToday = [
        ...(meta?.invalidatedWindowSignals || []),
        ...(meta?.localBreakWindowSignals || [])
    ].some(item => Number(item?.invalidationDay) === Number(idx));
    const triggerSignal = config.triggerSignal || 'B11';
    const shortPeriod = Math.max(1, Number(config.shortMovingAveragePeriod) || 5);
    const shortMA = Number(state.indicators?.ma?.[shortPeriod]?.[idx]);
    // 这里仍须严格站上两条均线；不能沿用 B6 允许收盘等于20日线的边界。
    if (!previousHandoff?.applied || previousHandoff.observationMode !== 'defensive'
        || invalidatedToday || !(full?.[idx]?._signals || []).includes(triggerSignal)
        || !Number.isFinite(shortMA) || common.close <= shortMA || common.close <= common.movingAverage) return empty;
    return {
        eligible: true,
        applied: false,
        active: false,
        status: 'eligible',
        reason: `到期防守观察后新触发${triggerSignal}，并重新站上MA${shortPeriod}/MA${common.movingAveragePeriod}，允许由${common.sourcePosition}%提高至${common.targetPosition}%确认仓`,
        sourcePosition: common.sourcePosition,
        targetPosition: common.targetPosition,
        basePosition: common.sourcePosition,
        triggerSignal,
        triggerDay: common.triggerDay,
        triggerDate: common.triggerDate,
        shortMovingAveragePeriod: shortPeriod,
        trendMovingAveragePeriod: common.movingAveragePeriod,
        shortMovingAverage: shortMA,
        trendMovingAverage: common.movingAverage,
        previousTrendMovingAverage: common.previousMovingAverage
    };
}

function computeWaveCandidateDecisionForIndex(idx, full, prevPos, options = {}) {
    const context = options.context || (state.strategy === '波段抄底型' ? getWaveEvaluationContext(idx,full,prevPos) : null);
    const request = evaluateWaveCandidateRequest(idx,full,prevPos,context);
    return finishWaveRequest({ ...request, phase:'candidate' },prevPos,options.candidateOnly);
}
function evaluateWaveCandidateRequest(idx, full, prevPos, context) {
    const { indicators, policy } = context ? getWaveEvaluationSources(context) : { indicators:state.indicators, policy:STRATEGY };
    const scope = context?.scope || state;
    const actualDecision = asWavePositionRequest(computeBaseDecisionForIndex(idx, full, prevPos, {candidateOnly:true,context}));
    const config = policy?.waveExpiryB11TakeoverAdd;
    const sourcePosition = Math.max(0, Number(config?.sourcePosition) || 30);
    const targetPosition = Math.max(sourcePosition, Number(config?.targetPosition) || 50);
    const previousLayer = full?.[idx - 1]?._decision?.waveExpiryB11TakeoverAdd;
    const inScope = !!config
        && scope.strategy === '波段抄底型'
        && scope.period === 'daily'
        && (config.stocksOnly === false || scope.mode === 'stock');
    const layerActive = inScope && previousLayer?.active && prevPos > 0;

    if (layerActive) {
        const basePrevPosition = Number.isFinite(Number(previousLayer.basePosition))
            ? Number(previousLayer.basePosition)
            : sourcePosition;
        const baseDecision = asWavePositionRequest(computeBaseDecisionForIndex(idx, full, basePrevPosition, {candidateOnly:true}));
        const baseLayerPosition = Number(baseDecision.requestedPosition) || 0;
        const actualPosition = Number(actualDecision.requestedPosition) || 0;
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
        let actionHint = getDecisionActionCode(sourceDecision);
        if (finalPosition < prevPos && finalPosition > 0) {
            actionHint = ACTION_STATE.REDUCE;
        } else if (finalPosition === prevPos && finalPosition > sourcePosition) {
            actionHint = ACTION_STATE.HOLD;
        }
        const layerReason = status === 'holding'
            ? `30%基础仓与${targetPosition - sourcePosition}%波段仓继续分层持有`
            : (status === 'released'
                ? `额外${targetPosition - sourcePosition}%波段仓先减，原30%基础仓继续按既有规则处理`
                : (status === 'taken_over' ? '原策略已形成更高基础仓位，结束波段分层' : '30%基础仓已失效，波段分层同步结束'));
        return {
            ...sourceDecision,
            requestedPosition: finalPosition,
            prevAdv: prevPos,
            positionDriver: [sourceDecision.positionDriver, layerReason].filter(Boolean).join('；'),
            actionHint,
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

    const meta = getSignalMeta(idx, full, indicators);
    const addContext = getWaveExpiryB11TakeoverAddContext(idx, full, meta, prevPos, { ...actualDecision, position:actualDecision.requestedPosition }, policy);
    if (!addContext.eligible) return { ...actualDecision, waveExpiryB11TakeoverAdd: addContext };

    let requestedPosition = addContext.targetPosition;
    const positionCap = getPositionCap(meta, prevPos, requestedPosition, idx, full, indicators);
    if (positionCap) requestedPosition = Math.min(requestedPosition, positionCap.limit);

    const marketGate = applyMarketRiskGate(
        actualDecision.market,
        prevPos,
        requestedPosition,
        actualDecision.targetStrength
    );
    requestedPosition = marketGate.position;

    const rejection = getWaveRejectionProtectionContext(idx, full, meta, prevPos, requestedPosition, policy, {
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
        finalPosition: applied ? requestedPosition : actualDecision.requestedPosition
    };
    if (!applied) return { ...actualDecision, waveExpiryB11TakeoverAdd: finalContext };

    return {
        ...actualDecision,
        requestedPosition,
        marketGate,
        positionCap,
        positionDriver: [actualDecision.positionDriver, addContext.reason].filter(Boolean).join('；'),
        actionHint: ACTION_STATE.ADD,
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
    const recentBreakout = getWaveActiveBreakoutContext(idx, full, strategy, { includeToday: true });
    if (rawSignals.includes('B11')) {
        const defense = getB11StructureDefense(idx, full, strategy);
        localDefense = Number(defense?.localLevel) || signalLow;
        hardDefense = Number(defense?.structureLevel) || signalLow;
        supportSource = defense?.structureLevel ? 'b11-structure' : 'b11-signal-low';
    } else if ((rawSignals.includes('B20') || recentBreakout?.trigger === 'B19')
        && waveContext?.boxSupport != null
        && Number.isFinite(Number(waveContext.boxSupport))
        && Number(waveContext.boxSupport) > 0
        && Number(waveContext.boxSupport) < close) {
        // 箱体无效时 boxSupport 为 null，Number(null)===0 会误通过 isFinite 检查，
        // 导致 hardDefense 被设成 0（冻结硬防守位形同虚设，永不触发跌破清仓）。
        // 必须显式排除 null 且要求支撑位为正且低于收盘，否则回落到默认 pivot/signalLow。
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
    // hardDefense 不变，仍由生命周期持有并负责后续结构硬失效；首次建议30%/50%/80%都须通过这项距离检查。
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
    const freshBuySignals = getWaveEligibleFreshBuySignals(idx, full, meta, strategy, rawSignals);
    const freshGroups = getWaveFreshGroupKeys(freshBuySignals, strategy);
    const downSignal = freshBuySignals.some(signal => (policy?.down?.entrySignals || []).includes(signal));
    const scoredSignals = (meta?.windowScoreSignals || []).map(item => item?.signal).filter(Boolean);
    const downRepairSignals = new Set(policy?.down?.repairSignals || ['B7','B8','B9','B16','B17','B20']);
    const hasDownRepairSignal = freshBuySignals.some(signal => downRepairSignals.has(signal))
        || scoredSignals.some(signal => downRepairSignals.has(signal));
    const downRepairGroupsReady = freshGroups.length >= Math.max(2, Number(policy?.down?.minimumRepairGroups) || 2);
    // 下跌/过渡首次建仓资格必须由当日实证支撑：贴近支撑、当日新下跌入场信号、或当日新增≥2个计分组。
    // 仅凭窗口内历史记分信号（scoredDownSignal）不再单独放行——那批建仓当日无新证据，两日破位率最高。
    const downQualified = scoreReady
        && hasDownRepairSignal
        && (nearSupport || downSignal || downRepairGroupsReady);
    const boxSupport = Number(waveContext?.boxSupport);
    const edgeTolerance = atr14 * Math.max(0.1, Number(policy?.box?.edgeToleranceAtr) || 0.75);
    const rangeSignal = freshBuySignals.some(signal => (policy?.range?.entrySignals || []).includes(signal));
    const rangeQualified = waveContext?.box?.valid && Number.isFinite(boxSupport)
        && low <= boxSupport + edgeTolerance && close >= boxSupport && close >= open
        && scoreReady && rangeSignal;
    const ma20 = Number(state.indicators?.ma?.[20]?.[idx]);
    const previousMa20 = Number(state.indicators?.ma?.[20]?.[idx - 1]);
    const upSignal = freshBuySignals.some(signal => (policy?.up?.entrySignals || []).includes(signal));
    const upQualified = upSignal && [close, low, ma20, previousMa20].every(Number.isFinite)
        && ma20 >= previousMa20
        && low <= ma20 + Math.max(atr14 * 0.5, ma20 * 0.005)
        && close >= ma20;
    // 所有首次建仓/止损后新交易入口读取同一资格，不让后层遗漏已成立的短期修复例外。
    // 资格不指定仓位；零目标、突破等待、防守距离及风险上限仍由原链路裁定。
    const shortRepairQualified = getWaveShortRepairContext(idx, full, meta, freshBuySignals,
        getExitSeverity(meta, idx, full, state.indicators), 0, waveContext, strategy).qualified === true;
    return {
        support,
        nearSupport,
        scoreReady,
        freshGroups,
        shortRepairQualified,
        downQualified,
        downRepairQualified: downQualified && !nearSupport,
        rangeQualified,
        upQualified,
        weeklyDoubleBottom,
        multiTimeframeProbeQualified
    };
}

function isWaveEntryRegimeQualified(waveContext, qualification) {
    if (!waveContext || waveContext.regime === 'unknown') return false;
    return !!(qualification.multiTimeframeProbeQualified
        || (waveContext.regime === 'down' ? qualification.downQualified || qualification.shortRepairQualified
            : (waveContext.regime === 'range' ? qualification.rangeQualified
                : (waveContext.regime === 'up' ? qualification.upQualified
                    : (waveContext.regime === 'transition' ? qualification.downQualified || qualification.rangeQualified || qualification.shortRepairQualified : false)))));
}

function getWaveGovernedAction(position, prevPos, candidate) {
    return presentDecisionAction(getWaveGovernedActionCode(position,prevPos,candidate),position,prevPos);
}

// 箱体回踩必须发生在已记录的收盘突破之后；触及上沿或突破当日不算回踩。
function updateWaveBoxRetestLifecycle(lifecycle, idx, item, waveContext) {
    if (!lifecycle) return;
    const currentPressure = Number(waveContext?.boxPressure);
    const oldPressure = Number(lifecycle.breakoutPressure);
    const newBox = waveContext?.regime === 'range' && waveContext.box?.valid
        && Number.isFinite(currentPressure) && currentPressure > 0
        && !(Number.isFinite(oldPressure) && oldPressure > 0);
    if (newBox) lifecycle.breakoutPressure = currentPressure;
    const pressure = Number(lifecycle.breakoutPressure);
    const validPressure = Number.isFinite(pressure) && pressure > 0;
    const close = Number(item?.close), low = Number(item?.low);
    const confirmedDay = lifecycle.breakoutDay;
    const validBreakout = Number.isInteger(confirmedDay)
        && confirmedDay >= Number(lifecycle.entryDay) && confirmedDay <= idx;
    if (newBox || !validPressure || !validBreakout || !Number.isFinite(close) || close < pressure) {
        lifecycle.breakoutDay = null;
        lifecycle.breakoutDate = '';
        lifecycle.breakoutRetested = false;
        lifecycle.breakoutRetestDay = null;
        lifecycle.breakoutRetestDate = '';
    }
    if (!validPressure || !Number.isFinite(close) || close < pressure) return;
    if (lifecycle.breakoutDay === null && close > pressure) {
        lifecycle.breakoutDay = idx;
        lifecycle.breakoutDate = item.date || '';
        return;
    }
    if (Number.isInteger(lifecycle.breakoutDay) && lifecycle.breakoutDay < idx
        && Number.isFinite(low) && low > 0 && low <= pressure * 1.01 && close >= pressure
        && !lifecycle.breakoutRetested) {
        lifecycle.breakoutRetested = true;
        lifecycle.breakoutRetestDay = idx;
        lifecycle.breakoutRetestDate = item.date || '';
    }
}

function reconcileWaveRecoveryDecision(idx, full, prevPos, decision, strategy = STRATEGY, options = {}) {
    const request = reconcileWaveRecoveryRequest(idx,full,prevPos,asWavePositionRequest(decision),strategy);
    return finishWaveRequest(request,prevPos,options.candidateOnly);
}
function reconcileWaveRecoveryRequest(idx, full, prevPos, decision, strategy = STRATEGY) {
    const protection = decision?.waveRejectionProtection;
    if (!decision?.waveContext?.inScope || !['released', 'recovery_started', 'recovery_hold'].includes(protection?.status)) return decision;
    const position = Number(decision.requestedPosition) || 0;
    if (position <= 0) {
        const reason = decision.waveContext.mainEvent || (prevPos > 0
            ? '恢复观察结束，原持仓条件未获接管' : '当前尚未形成实际持仓，不启动恢复观察');
        const reasonCode = decision.waveContext.blockReason || 'no-position';
        return { ...decision, waveRejectionProtection: {
            ...protection, active: true, status: 'locked', targetPosition: 0,
            recoveryPending: false, recoveryAccepted: false, recoveryQualificationPassed: false, recoveryHoldRemaining: 0,
            recoveryHoldPosition: 0, allowRecoveryIncrease: false, reentryRoute: null,
            resolvedDay: null, resolvedDate: '', finalRejectionDay: idx,
            finalRejectionReason: reason, finalRejectionReasonCode: reasonCode,
            ...(protection.newEntry?.inScope ? { newEntry: { ...protection.newEntry, eligible: false,
                reason: reasonCode, reasonText: reason } } : {})
        } };
    }
    // 恢复数量服从最终裁定：未清仓的成熟浮盈回补可保留50%，新一轮持仓仍最多30%。
    const retainedProfitRecovery = protection.eventType === 'mature_profit_rejection' && prevPos > 0;
    const recoveryHoldPosition = retainedProfitRecovery ? position
        : Math.min(position, Math.max(0, Number(strategy.waveRejectionProtection?.recoveryPositionCap) || 30));
    return { ...decision, waveRejectionProtection: {
        ...protection, targetPosition: position, recoveryAccepted: true, recoveryQualificationPassed: true, recoveryHoldPosition,
        finalRejectionReason: '', finalRejectionReasonCode: '', finalRejectionDay: null,
        ...(prevPos <= 0 ? { recoveryEntryDay: idx, recoveryEntryDate: full?.[idx]?.date || '' } : {})
    } };
}

// 局部防守约束属于本轮持仓；信号窗口变化不能悄悄解除仍未收复的防守。
function getWaveLocalDefenseGuard(idx, full, prevPos, lifecycle, defense) {
    if (prevPos <= 0 || !lifecycle || !Number.isInteger(lifecycle.entryDay)) return null;
    const close = Number(full?.[idx]?.close);
    const usable = value => typeof value === 'number' && Number.isFinite(value) && value > 0;
    const previous = lifecycle.localDefenseGuard;
    let guard = previous && previous.ownerEntryDay === lifecycle.entryDay
        && previous.ownerEntryDate === lifecycle.entryDate
        && usable(previous.localLevel) && usable(previous.structureLevel)
        ? { ...previous } : null;
    if (!Number.isFinite(close)) return guard;
    const date = full[idx]?.date || '';
    if (guard?.active && close > guard.localLevel) {
        guard = { ...guard, active: false, status: 'recovered', recoveredDay: idx, recoveredDate: date };
    }
    if (!guard?.active && defense?.localBreak
        && Number.isInteger(defense.signalDay) && defense.signalDay <= idx
        && usable(defense.localLevel) && usable(defense.structureLevel)
        && close < defense.localLevel && close >= defense.structureLevel) {
        guard = {
            signal: 'B11', signalDay: defense.signalDay, signalDate: defense.signalDate || '',
            localLevel: defense.localLevel, structureLevel: defense.structureLevel,
            ownerEntryDay: lifecycle.entryDay, ownerEntryDate: lifecycle.entryDate,
            triggerDay: idx, triggerDate: date, active: true, status: 'active',
            recoveredDay: null, recoveredDate: ''
        };
    } else if (guard && !guard.active && close < guard.localLevel && close >= guard.structureLevel) {
        guard = { ...guard, active: true, status: 'active', triggerDay: idx, triggerDate: date,
            recoveredDay: null, recoveredDate: '' };
    }
    return guard ? { ...guard, limit: Math.min(prevPos, 30) } : null;
}

// 基础目标可被环境的逐档退出接管，但已生效的风险上限不可被回填。
function getWaveFinalRiskCap(candidate, meta, signalBreakOnly = false, recognizedEvent = false, localDefenseGuard = null) {
    const caps = [];
    if (localDefenseGuard?.active) caps.push({ limit: localDefenseGuard.limit,
        reason: `均线回踩局部防守位尚未收复，上限${localDefenseGuard.limit}%` });
    if ([EXIT_STATE.REDUCE, EXIT_STATE.DEFENSIVE].includes(getExitStateCode(candidate?.exit))) {
        caps.push({ limit: 30, reason: '离场防守上限30%' });
    }
    if (meta?.warningSignals?.length) caps.push({ limit: 30, reason: '预警防守上限30%' });
    if (Number.isFinite(candidate?.positionCap?.limit)) caps.push(candidate.positionCap);
    const protection = candidate?.waveRejectionProtection;
    const eventLimits = ['triggered', 'locked', 'entry_blocked', 'pending_hard_break', 'ma20_hold', 'pressure_hold',
        'released', 'recovery_started', 'recovery_pending', 'recovery_hold'];
    // 局部信号失效/首破观察仍服从既有的结构支撑例外，不把基础零目标冒充硬清仓上限。
    const localDefenseException = signalBreakOnly
        && (protection?.eventType === 'signal_hard_invalidation' || protection?.status === 'pending_hard_break');
    if (recognizedEvent && !localDefenseException && eventLimits.includes(protection?.status)
        && Number.isFinite(protection?.targetPosition)) {
        caps.push({ limit: protection.targetPosition, reason: '风险事件及恢复观察上限' + protection.targetPosition + '%' });
    }
    if (!caps.length) return null;
    const limit = Math.min(...caps.map(cap => cap.limit));
    return { limit, reason: [...new Set(caps.filter(cap => cap.limit === limit).map(cap => cap.reason))].join('；') };
}

// 仅在波段个股日线治理内使用：环境参考上限只约束新增风险，不机械压低已有持仓。
// 这不是保仓目标；更低/零策略请求以及明确风险上限仍在原链路裁定。
function getWaveHoldingRegimeCap(previousPosition, labelCap) {
    return previousPosition > 0 && Number.isFinite(labelCap)
        ? Math.max(previousPosition, labelCap) : labelCap;
}

function applyWaveRegimeGovernance(idx, full, prevPos, candidate, strategy = STRATEGY, options = {}) {
    // 先确认治理作用域，非波段路径不捕获或序列化无用的上一日波段状态。
    let context = options.context;
    const wave = context ? getWaveContextForEvaluation(context,strategy) : getWaveContext(idx,full,state.indicators,strategy);
    if (!wave.inScope) return candidate;
    context = context || getWaveEvaluationContext(idx,full,prevPos);
    const request = evaluateWaveRegimeRequest(idx,full,prevPos,asWavePositionRequest(candidate),strategy,context);
    const approved = { ...request, phase:'governed' };
    recordWaveApproval(context,approved);
    return finishWaveRequest(approved,prevPos,options.candidateOnly);
}
function evaluateWaveRegimeRequest(idx, full, prevPos, candidate, strategy, context) {
    const { indicators } = getWaveEvaluationSources(context);
    const waveContext = candidate?.waveContext;
    if (!waveContext?.inScope) return candidate;
    const policy = strategy.waveRegimePolicy;
    const meta = getSignalMeta(idx, full, indicators);
    const rawSignals = full?.[idx]?._signals || [];
    const previousLifecycle = full?.[idx - 1]?._decision?.waveContext?.lifecycle;
    const item = full?.[idx] || {};
    const close = Number(item.close), low = Number(item.low), high = Number(item.high), open = Number(item.open);
    const ma20 = Number(indicators?.ma?.[20]?.[idx]);
    const previousHigh = Number(full?.[idx - 1]?.high);
    const newTradeEntry = candidate?.waveRejectionProtection?.reentryRoute === 'new-entry';
    const entryMeta = newTradeEntry ? { ...meta,
        windowScore: Number(candidate.waveRejectionProtection.postEventScore) || 0,
        windowScoreSignals: candidate.waveRejectionProtection.postEventScoreSignals || []
    } : meta;
    const qualification = getWaveRegimeQualification(idx, full, entryMeta, waveContext, rawSignals, strategy);
    // 分层入口已裁定资格；后续只限制目标，不从资格反推必须持有50%。
    const shortRepairEligible = candidate?.wavePositionStage?.shortRepairEligible === true;
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
        'fresh_entry_pressure_hold',
        'fresh_entry_downside_failure',
        'fresh_entry_hard_break',
        'signal_hard_invalidation',
        'structure_hard_break',
        'mature_profit_rejection'
    ]).has(eventType);
    let position = Number(candidate?.requestedPosition) || 0;
    let appliedRegimeCap = null;
    let waveRejectionProtection = candidate?.waveRejectionProtection || {
        active: false,
        status: 'none',
        targetPosition: position
    };
    let lifecycle = previousLifecycle && prevPos > 0 ? { ...previousLifecycle } : null;
    const localDefenseGuard = getWaveLocalDefenseGuard(idx, full, prevPos, lifecycle, candidate.b11StructureDefense);
    if (lifecycle && localDefenseGuard) lifecycle.localDefenseGuard = localDefenseGuard;
    const effectiveDefense = getWaveEffectiveDefense(waveContext, lifecycle, strategy);
    const rangeBoxLowerEdgeHold = effectiveDefense?.type === 'box-lower-edge'
        && Number.isFinite(close) && close >= effectiveDefense.level;
    const structureSupportHolds = !!effectiveDefense && Number.isFinite(close) && close >= effectiveDefense.level;
    // 事件状态只表明处于保护流程；非零目标是减仓/锁定上限，不得升级为硬清仓。
    const hardExitEvent = ['entry_day_pressure_rejection', 'fresh_entry_hard_break', 'signal_hard_invalidation', 'structure_hard_break'].includes(eventType);
    const eventHardRisk = recognizedEventType && ['triggered','locked','entry_blocked'].includes(eventStatus)
        && (hardExitEvent || (Number.isFinite(waveRejectionProtection.targetPosition) && waveRejectionProtection.targetPosition <= 0))
        && !(eventType === 'signal_hard_invalidation' && structureSupportHolds);
    const hardRisk = candidate?.waveRejectionProtection?.recomputeRequired === true
        || getExitStateCode(candidate?.exit) === EXIT_STATE.HARD
        || getDecisionActionCode(candidate) === ACTION_STATE.AVOID
        || meta?.inCooldown
        || eventHardRisk;
    const signalBreakOnly = priceHardInvalidations.length > 0
        && structureSupportHolds
        && !hardRisk;
    const signalBreakHoldCap = Math.min(prevPos, 30,
        Number.isFinite(candidate?.positionCap?.limit) ? candidate.positionCap.limit : 30);
    const waveRiskCap = getWaveFinalRiskCap(candidate, meta, signalBreakOnly, recognizedEventType, localDefenseGuard);
    const failedObservation = [candidate?.waveMA20PullbackObservation, candidate?.waveExpiryHandoff]
        .find(observation => observation?.forceExit);
    const observationFailureReason = failedObservation
        ? (failedObservation.reason || '防守观察未恢复') + '，本次观察结束并清仓'
        : '';
    const hardInvalidation = (priceHardInvalidations.length > 0 && !signalBreakOnly)
        || hardRisk
        || (getExitStateCode(candidate?.exit) === EXIT_STATE.STRONG && !standaloneRangeL10);
    let governanceReason = '';
    let governanceBlockReason = '';
    let upperRejectionApplied = false;

    // 迁移期不为历史持仓倒推建仓事实；只有新治理创建的生命周期才接管后续加减仓。
    if (prevPos > 0 && !lifecycle) {
        if (hardInvalidation || failedObservation) {
            position = 0;
            governanceReason = hardInvalidation
                ? '既有持仓触发数据/硬风险或结构硬失效，仓位归零'
                : observationFailureReason;
        } else {
            const cap = getWaveHoldingRegimeCap(prevPos, Number(policy?.positionCaps?.[waveContext.regime]));
            const noIncreasePosition = Math.min(position, prevPos);
            position = waveContext.regime === 'unknown' || !Number.isFinite(cap)
                ? noIncreasePosition
                : Math.min(noIncreasePosition, cap);
            governanceReason = '既有持仓不倒推生命周期；环境仅作标签，保留原决策与风险保护且不加仓';
        }
        if (waveRiskCap) position = Math.min(position, waveRiskCap.limit);
        position = quantizePosition(position);
        const actionHint = getWaveGovernedActionCode(position, prevPos, candidate);
        return reconcileWaveRecoveryRequest(idx, full, prevPos, {
            ...candidate, requestedPosition:position, prevAdv: prevPos, actionHint, waveRiskCap,
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
        }, strategy);
    }

    const rangeBoxLowerEdgeBreak = effectiveDefense?.type === 'box-lower-edge'
        && Number.isFinite(close) && close < effectiveDefense.level;
    const frozenDefenseBreak = effectiveDefense?.type === 'frozen-hard'
        && Number.isFinite(close) && close < effectiveDefense.level;
    // 一日观察属于本次持仓，不依赖次日仍被识别为横盘；先结算旧观察，不能被新受阻信号续期。
    const upperObservation = lifecycle?.upperObservation;
    const upperObservationDue = prevPos > 0 && upperObservation
        && upperObservation.triggerDay != null
        && Number.isFinite(Number(upperObservation.triggerDay))
        && idx > Number(upperObservation.triggerDay);
    const upperObservationFailed = upperObservationDue
        && close < Math.max(ma20 || -Infinity, Number(upperObservation.midpoint) || -Infinity);
    if (lifecycle && (frozenDefenseBreak || rangeBoxLowerEdgeBreak)) {
        position = 0;
        governanceReason = rangeBoxLowerEdgeBreak && !frozenDefenseBreak
            ? '收盘跌破箱体下沿' + formatPriceLevel(Number(waveContext.boxSupport)) + '，横盘结构失效归零'
            : '收盘跌破冻结硬防守位' + formatPriceLevel(Number(lifecycle.hardDefense)) + '，结构失效归零';
        const recoveryCloseLevel = Math.max(
            effectiveDefense.level,
            Number.isFinite(high) ? high : effectiveDefense.level
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
            hardDefense: effectiveDefense.level,
            defenseType: effectiveDefense.type,
            defenseSource: effectiveDefense.source,
            frozenHardDefense: lifecycle.hardDefense
        };
    } else if (hardInvalidation) {
        position = 0;
        governanceReason = '数据/硬风险或结构硬失效优先，仓位归零';
    } else if (failedObservation) {
        position = 0;
        governanceReason = observationFailureReason;
    } else if (upperObservationFailed) {
        position = 0;
        governanceReason = '箱体上沿失败观察后仍未站回MA20/箱体中轴，清仓';
    } else if (prevPos <= 0 && position > 0) {
        const eventRecovery = ['released','recovery_started','recovery_hold'].includes(candidate?.waveRejectionProtection?.status)
            && candidate?.waveRejectionProtection?.allowRecoveryIncrease !== false;
        const multiTimeframeProbe = qualification.multiTimeframeProbeQualified;
        const regimeQualified = isWaveEntryRegimeQualified(waveContext, qualification)
            || (eventRecovery && !newTradeEntry);
        const defense = getWaveEntryDefenseContext(idx, full, waveContext, rawSignals, strategy, {
            freshEventRecovery: eventRecovery
        });
        if (!regimeQualified || !defense.acceptable || waveContext.regime === 'unknown') {
            position = 0;
            governanceBlockReason = waveContext.regime === 'unknown' ? 'unknown-regime'
                : !regimeQualified ? 'entry-qualification' : 'defense-distance';
            governanceReason = waveContext.regime === 'unknown' ? '环境数据未知，暂不建立新仓'
                : !regimeQualified ? waveContext.regimeLabel + '环境未满足首次建仓资格' : getWaveEntryDefenseRejectionText(defense);
        } else {
            const shortRepairEntry = shortRepairEligible && candidate?.wavePositionStage?.previousPosition <= 0;
            const trendEntry = waveContext.regime === 'up' && candidate?.wavePositionStage?.stage === 'trend';
            const entryPosition = Math.min(position, trendEntry ? 80 : (shortRepairEntry ? 50 : 30));
            position = entryPosition;
            lifecycle = {
                active: true, entryRegime: waveContext.regime, entrySignals: [...rawSignals],
                entrySignalGroups: qualification.freshGroups, entryDay: idx, entryDate: item.date || '',
                entryClose: close, localDefense: defense.localDefense, hardDefense: defense.hardDefense,
                entryDefense: defense.entryDefense, entryDefenseSource: defense.entryDefenseSource,
                supportSource: defense.supportSource,
                entryMode: newTradeEntry ? 'post-stop-new-entry' : (multiTimeframeProbe ? 'multi-timeframe-double-bottom-probe' : 'regime-qualified'),
                ...(newTradeEntry ? { entryScoreSignals: (candidate.waveRejectionProtection.postEventScoreSignals || []).map(signal => ({ ...signal })) } : {}),
                stage: entryPosition >= 80 ? 'trend' : (entryPosition >= 50 ? 'confirmation' : 'entry'), positionLayer: entryPosition, upperObservation: null,
                breakoutPressure: waveContext.regime === 'range' ? waveContext.boxPressure : null, breakoutRetested: false
            };
            updateWaveBoxRetestLifecycle(lifecycle, idx, item, waveContext);
            const entryDefenseText = Number.isFinite(Number(defense.entryDefense))
                ? `${defense.entryDefenseSource === 'local-signal' ? '局部防守位' : '结构防守位'}${formatPriceLevel(Number(defense.entryDefense))}`
                : '局部防守位';
            const structuralDefenseText = Number.isFinite(Number(defense.hardDefense))
                && Number(defense.hardDefense) !== Number(defense.entryDefense)
                ? `，结构硬防守位${formatPriceLevel(Number(defense.hardDefense))}作为二级失效线`
                : '';
            governanceReason = newTradeEntry
                ? `止损后新信号独立达标并通过首次建仓检查，建立${entryPosition}%新一轮试探仓，不要求收复旧止损位，重新冻结本轮防守位`
                : trendEntry
                ? `上涨环境首次建仓资格与当日趋势证据成立，建议${entryPosition}%仓位并冻结防守位`
                : shortRepairEntry
                ? `${candidate.waveShortRepair.reason}，建立${entryPosition}%${entryPosition >= 50 ? '确认' : '试探'}仓并冻结防守位`
                : multiTimeframeProbe
                ? '周线双底候选与日线B20共振，建立30%试探仓并冻结防守位'
                : eventRecovery
                ? '事件后新信号完成恢复资格，建立30%试探仓并重新冻结防守位'
                : (waveContext.regime === 'down' && qualification.downRepairQualified
                    ? `下跌环境修复信号达到试探资格，按${entryDefenseText}通过距离检查，建立30%试探仓并冻结防守位${structuralDefenseText}`
                    : `${waveContext.regimeLabel}环境资格成立，按${entryDefenseText}通过距离检查，建立30%试探仓并冻结防守位${structuralDefenseText}`);
        }
    } else if (prevPos > 0) {
        if (upperObservationDue) lifecycle.upperObservation = null;
        if (signalBreakOnly) {
            position = signalBreakHoldCap;
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
        // 实际记录的箱体才要求回踩；最初的下跌/过渡标签不限制后续趋势升级。
        updateWaveBoxRetestLifecycle(lifecycle, idx, item, waveContext);
        const breakoutPressure = Number(lifecycle?.breakoutPressure);
        const hasBreakoutPressure = Number.isFinite(breakoutPressure) && breakoutPressure > 0;
        const boxRetestRequired = lifecycle?.entryRegime === 'range' || hasBreakoutPressure;
        const entryAge = lifecycle ? idx - Number(lifecycle.entryDay) : 0;
        const differentFreshGroup = qualification.freshGroups.some(group => !(lifecycle?.entrySignalGroups || []).includes(group));
        const rangeConfirm = waveContext.regime === 'range' && prevPos === 30 && entryAge >= 2
            && differentFreshGroup && close >= Math.max(ma20 || -Infinity, previousHigh || -Infinity) && close >= Number(waveContext.boxSupport);
        const upConfirm = waveContext.regime === 'up' && prevPos === 30 && entryAge >= 2
            && rawSignals.some(signal => (policy?.up?.confirmationSignals || []).includes(signal)) && close >= ma20;
        const upTrend = waveContext.regime === 'up'
            && (candidate?.wavePositionStage?.stage === 'trend' || position >= 80)
            && rawSignals.some(signal => (policy?.up?.trendSignals || []).includes(signal))
            && (!boxRetestRequired || lifecycle?.breakoutRetested);
        if (position > prevPos) {
            if (shortRepairEligible) position = Math.min(position, 50);
            else if (waveContext.regime === 'range') position = Math.min(position, rangeConfirm ? 50 : prevPos);
            else if (waveContext.regime === 'up') position = Math.min(position, upTrend ? 80 : (upConfirm ? 50 : prevPos));
            else position = prevPos;
            governanceReason = position > prevPos
                ? (shortRepairEligible
                    ? `${candidate.waveShortRepair.reason}，仓位提高至${position}%`
                    : waveContext.regimeLabel + '环境出现新的有效确认，建议仓位提高至' + position + '%')
                : waveContext.regimeLabel + '环境尚未满足新的有效确认或箱体回踩要求，不提高建议仓位';
        }
        if (waveContext.regime === 'range' && Number.isFinite(Number(waveContext.boxPressure))) {
            if (rangeUpperFailure) {
                position = prevPos > 30 ? getLowerWavePositionStep(prevPos) : 30;
                upperRejectionApplied = true;
                governanceReason = '箱体上沿长上影弱收盘并伴随转弱证据，先退出一层';
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
        const effectiveCap = getWaveHoldingRegimeCap(prevPos, shortRepairEligible ? 50 : cap);
        if (waveContext.regime !== 'unknown' && Number.isFinite(effectiveCap) && position > effectiveCap) {
            appliedRegimeCap = {
                limit: effectiveCap, requestedPosition: position,
                reason: `${waveContext.regimeLabel}环境的参考仓位上限为${effectiveCap}%`
            };
            position = effectiveCap;
            governanceReason = `${appliedRegimeCap.reason}，最终建议${position}%`;
        }
        // 普通转弱或箱体退档只决定建议变化，不能覆盖已经生效的明确风险上限。
        if (Number.isFinite(candidate?.positionCap?.limit) && position > candidate.positionCap.limit) {
            position = candidate.positionCap.limit;
            governanceReason = `${candidate.positionCap.reason || '结构防守上限生效'}，建议仓位限制在${position}%`;
        }
        // 后续箱体退档等分支也不能把已经限制到试探仓的局部失效重新抬高。
        if (signalBreakOnly) position = Math.min(position, signalBreakHoldCap);
        if (lifecycle && position > 0) { lifecycle.stage = position === 80 ? 'trend' : (position === 50 ? 'confirmation' : 'entry'); lifecycle.positionLayer = position; }
    }

    if (waveRiskCap && position > waveRiskCap.limit) {
        position = waveRiskCap.limit;
        governanceReason = `${waveRiskCap.reason}，最终建议${position}%`;
    }
    position = quantizePosition(position);
    // 上沿清仓观察只属于最终获准的30%层；80%退到50%不得次日跳过30%直接清仓。
    if (upperRejectionApplied && lifecycle && position > 0) {
        lifecycle.upperObservation = position === 30
            ? { triggerDay: idx, triggerDate: item.date || '', midpoint: waveContext.boxMidpoint } : null;
        if (position === 30) governanceReason += '；最终30%进入一日观察';
    }
    if (localDefenseGuard?.active && position > 0 && !governanceReason) {
        governanceReason = `均线回踩局部防守位${formatPriceLevel(localDefenseGuard.localLevel)}尚未收复，最多保留${position}%试探仓`;
    }
    if (position <= 0) lifecycle = null;
    const actionHint = getWaveGovernedActionCode(position, prevPos, candidate);
    const nextCondition = localDefenseGuard?.active && position > 0
        ? `收盘需严格站回均线回踩局部防守位${formatPriceLevel(localDefenseGuard.localLevel)}，且出现新的有效确认并通过环境与风险检查`
        : shortRepairEligible && position > 0
        ? '保持MA5/MA20回踩修复；若跌破结构防守位或出现离场信号则降仓'
        : (waveContext.regime === 'down' ? '等待环境转为横盘或上涨后再申请50%'
        : (waveContext.regime === 'range' ? '守住箱体支撑，并等待不同计分组的新信号站上MA20/前高'
            : (waveContext.regime === 'up' ? (position <= 0 ? '等待新的B6/B11回踩成立，并通过首次建仓及防守距离检查' : '等待新的B6/B11确认或B4/B14趋势延续事件') : '等待环境完成确认')));
    return reconcileWaveRecoveryRequest(idx, full, prevPos, {
        ...candidate, requestedPosition:position, prevAdv: prevPos, actionHint,
        waveRejectionProtection, waveRiskCap,
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
            supportSource: lifecycle?.supportSource || '', appliedRegimeCap, mainEvent: governanceReason, blockReason: governanceBlockReason, nextCondition
        }
    }, strategy);
}
function assertWavePositionRequest(request, context) {
    if (request.phase !== 'governed' || !POSITION_STEPS.includes(request.requestedPosition)) {
        throw new Error('只有已完成治理的合法仓位请求才能提交');
    }
    for (const cap of [request.positionCap, request.waveRiskCap, request.waveContext?.appliedRegimeCap]) {
        if (Number.isFinite(cap?.limit) && request.requestedPosition > cap.limit) {
            throw new Error('仓位请求超过已生效的风险上限');
        }
    }
    if (!context) return;
    const sources = getWaveEvaluationSources(context);
    const meta = getSignalMeta(context.index,sources.full,sources.indicators);
    const wave = getWaveContextForEvaluation(context,context.policy);
    const defense = getWaveEffectiveDefense(wave,context.previousState.holding,context.policy);
    // 复合高危、冷静期与实际硬防守不得只依赖候选自报；单独L3/L10仍保留现行观察例外。
    if (request.requestedPosition > 0 && (getSignalStateCode(meta) === SIGNAL_STATE.EXIT || meta.inCooldown
        || (context.previousPosition > 0 && defense && context.bar.close < defense.level))) {
        throw new Error('仓位请求违反原始事实中的硬退出约束');
    }
    if (!sources.approval || request.requestedPosition !== sources.approval.position
        || sources.approval.caps.some(limit => request.requestedPosition > limit)) {
        throw new Error('请求未获真实治理批准或在批准后被修改');
    }
    const life = request.waveContext?.lifecycle;
    if (context.previousPosition <= 0 && request.requestedPosition > 0
        && (!life?.active || life.entryDay !== context.index || life.entryDate !== context.date)) {
        throw new Error('建仓请求缺少本轮可追溯生命周期');
    }
}
function finalizeWaveDecisionState(idx, full, prevPos, decision, context = null) {
    if (decision?.kind === 'wave-position-request') {
        context = context || getWaveEvaluationContext(idx,full,prevPos);
        assertWavePositionRequest(decision,context);
        const { kind, phase, requestedPosition, ...data } = decision;
        decision = { ...data, position:requestedPosition };
    }
    if (!decision?.waveContext?.inScope) return decision;
    context = context || getWaveEvaluationContext(idx,full,prevPos);
    const position = Number(decision.position) || 0;
    const wave = decision.waveContext;
    const lifecycle = position > 0 && wave.lifecycle ? { ...wave.lifecycle,
        stage: position >= 80 ? 'trend' : position >= 50 ? 'confirmation' : 'entry', positionLayer: position
    } : null;
    const effectiveDefense = position > 0 ? getWaveEffectiveDefense(wave, lifecycle) : null;
    const result = { ...decision, prevAdv: prevPos,
        waveStandaloneL3Observation: decision.waveStandaloneL3Observation === true && position > 0,
        waveContext: { ...wave, lifecycle, stage: lifecycle?.stage || (position > 0 ? wave.stage : 'flat'),
            positionLayer: position, effectiveDefense }
    };
    const holding = decision.waveHoldingBaseline;
    if (holding?.eligible) {
        const applied = position === prevPos && position > 0;
        const reason = applied ? holding.reason : `${wave.mainEvent || '最终退出或风险上限生效'}，不启用积分持仓基准`;
        result.waveHoldingBaseline = { ...holding, applied, limited: !applied, finalPosition: position, reason };
        if (!applied && holding.reason && result.positionDriver) {
            result.positionDriver = result.positionDriver.split(holding.reason).join(reason);
        }
    }
    const stage = decision.wavePositionStage;
    if (stage?.inScope) result.wavePositionStage = { ...stage, allowedPosition: position,
        increaseApplied: stage.increaseApplied === true && position > prevPos,
        limited: Number(stage.requestedPosition) > position };
    const add = decision.waveB6TrendAdd;
    if (add?.eligible) {
        const applied = add.applied === true && position > prevPos;
        const reason = applied ? add.reason : `${wave.mainEvent || '最终环境或风险限制未批准加仓'}，未执行B6确认加仓`;
        result.waveB6TrendAdd = { ...add, applied, limited: !applied, finalPosition: position, reason };
        if (!applied && add.reason && result.positionDriver) {
            result.positionDriver = result.positionDriver.split(add.reason).join(reason);
        }
    }
    if (position <= 0) {
        for (const key of ['waveMA20PullbackObservation', 'waveExpiryHandoff']) {
            const observation = decision[key];
            if (observation?.applied || observation?.forceHold || observation?.forceExit) {
                result[key] = { ...observation, applied: false, forceHold: false, targetPosition: 0,
                    status: observation.forceExit ? 'expired' : 'closed', endDay: idx, endDate: full?.[idx]?.date || '',
                    reason: observation.forceExit ? observation.reason : (wave.mainEvent || '最终仓位归零，本轮观察结束') };
            }
        }
        if (decision.waveL10TrendHandoff) result.waveL10TrendHandoff = {
            ...decision.waveL10TrendHandoff, applied: false, targetPosition: 0
        };
    }

    const layer = decision.waveExpiryB11TakeoverAdd;
    if (!layer || layer.status === 'none') return commitWaveDecision(context,result);
    const previousLayer = full?.[idx - 1]?._decision?.waveExpiryB11TakeoverAdd;
    const wasActive = previousLayer?.active === true && prevPos > 0;
    const basePosition = Number(layer.basePosition) || 30;
    const applied = layer.applied === true && position > prevPos && position > basePosition;
    const active = layer.active === true && position > basePosition && (wasActive || applied);
    const status = active ? 'holding' : position <= 0 ? 'closed'
        : wasActive ? (position > basePosition ? 'taken_over' : 'released')
        : layer.eligible ? 'limited' : layer.status;
    result.waveExpiryB11TakeoverAdd = {
        ...layer, applied, active, status, limited: layer.eligible === true && !applied,
        finalPosition: position,
        ...(wasActive && !active ? { releaseDay: idx, releaseDate: full?.[idx]?.date || '' } : {}),
        ...(!active && layer.active ? { reason: position <= 0 ? '最终仓位已归零，波段分层同步结束'
            : wasActive ? '最终裁定不再保留附加波段仓，仅按当前基础仓位管理'
                : '具备B11加仓资格，但最终环境或风险限制未批准附加仓，未启动分层' } : {})
    };
    return commitWaveDecision(context,result);
}

function commitWaveDecision(context, decision) {
    const actionCode = getWaveGovernedActionCode(decision.position,context.previousPosition,decision);
    const { actionHint, waveState, ...data } = decision;
    return { ...data, actionCode, exitStateCode:getExitStateCode(decision.exit), ...presentDecisionAction(actionCode,decision.position,context.previousPosition),
        waveState:captureWaveDecisionState(context.scope,data,context.previousState) };
}
function computeDecisionForIndex(idx, full, prevPos) {
    const waveStock = state.strategy === '波段抄底型' && state.mode === 'stock' && state.period === 'daily';
    const context = waveStock ? getWaveEvaluationContext(idx,full,prevPos) : null;
    const inScope = waveStock && getWaveContextForEvaluation(context,STRATEGY).inScope;
    const candidate = computeWaveCandidateDecisionForIndex(idx, full, prevPos, {candidateOnly:inScope,context});
    const governed = applyWaveRegimeGovernance(idx, full, prevPos, candidate, STRATEGY, {candidateOnly:inScope,context});
    const approved = inScope ? { ...asWavePositionRequest(governed), phase:'governed' } : governed;
    // 旧研究hook的旧形状在这里显式导入；正常生产始终返回带批准记录的请求。
    if (inScope && governed?.kind !== 'wave-position-request') recordWaveApproval(context,approved);
    const decision = finalizeWaveDecisionState(idx, full, prevPos,approved,context);
    if (decision) decision._marketContextKey = getMarketContextKey();
    return decision?.waveContext?.inScope
        ? { ...decision, waveGovernanceVersion: WAVE_GOVERNANCE_VERSION, waveRecoveryVersion: WAVE_RECOVERY_STATE_VERSION, waveDecisionStateVersion: WAVE_DECISION_STATE_VERSION }
        : (decision ? { ...decision, actionCode:getDecisionActionCode(decision), exitStateCode:getExitStateCode(decision.exit) } : decision);
}

function isCurrentDecisionMarketContext(decision, marketKey = getMarketContextKey()) {
    return (decision?._marketContextKey || '') === marketKey;
}

function isCurrentDecisionGovernanceVersion(decision, options = {}) {
    // 治理版本未变也可能有新宽基历史；所有现有决策复用入口共用这项检查。
    if (!isCurrentDecisionMarketContext(decision)) return false;
    const inScope = options.waveStockDaily === true
        || (state.strategy === '波段抄底型' && state.mode === 'stock' && state.period === 'daily');
    return !inScope || (decision?.waveGovernanceVersion === WAVE_GOVERNANCE_VERSION
        && decision?.waveRecoveryVersion === WAVE_RECOVERY_STATE_VERSION
        && decision?.waveDecisionStateVersion === WAVE_DECISION_STATE_VERSION
        && isValidWavePendingBreakRecord(decision?.waveRejectionProtection));
}

function hasOutdatedWaveDecisionRules(rows) {
    return rows.some(row => row?._decision?.waveContext?.inScope
        && row._decision.waveDecisionStateVersion !== WAVE_DECISION_STATE_VERSION);
}

function isCurrentDerivedDecisionCache(cached, options = {}) {
    if (!cached || !isCurrentDecisionMarketContext(cached.rows?.[cached.rows.length - 1]?._decision)) return false;
    const strategy=options.strategy || state.strategy;
    if (!cached.rows?.every(row=>!row || (row._strategy===strategy && row._signalVersion===SIGNAL_VERSION))) return false;
    const inScope = options.waveStockDaily ?? (state.strategy === '波段抄底型' && state.mode === 'stock' && state.period === 'daily');
    return !inScope || (
        cached.decisionGovernanceVersion === WAVE_GOVERNANCE_VERSION
        && !hasOutdatedWaveDecisionRules(cached.rows)
        && cached.rows.every(row => isValidWavePendingBreakRecord(row?._decision?.waveRejectionProtection))
        && isCurrentDecisionGovernanceVersion(cached.rows?.[cached.rows.length - 1]?._decision, { waveStockDaily: true })
    );
}

function pruneStaleMarketContextCaches() {
    if (!derivedIndicatorCache.size) return;
    const marketKey = getMarketContextKey();
    // 只释放依赖已失配的内存快照；不按环境标签清理，也不动当前行、确认历史或持久化数据。
    for (const [key, cached] of derivedIndicatorCache) {
        const decision = cached.rows?.[cached.rows.length - 1]?._decision;
        if (!isCurrentDecisionMarketContext(decision, marketKey)) derivedIndicatorCache.delete(key);
    }
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
    // 策略参数也是决策缓存依赖；本地规则更新不能复用同一行情下的旧买卖点。
    const strategySignature = hashString32(JSON.stringify(STRATEGIES[strategy] || {}));
    return `${id}_${period}_${strategy}_${data.length}_${last.date}_${last.close}_${hashString32(dataSig)}_strategy_${strategySignature}_market_${getMarketContextKey() || 'unknown'}`;
}

// 帧间检查只读引用与小依赖；完整内容指纹仍在起点和提交前核对。
function getCalculationTailSignature(data) {
    const row = data?.[data.length - 1] || {};
    return JSON.stringify([row.date,row.open,row.high,row.low,row.close,row.vol,row.amt,row._isLive,row._isCachedLive]);
}
function createCalculationInputGuard(id, period, strategy, data) {
    return { id,period,strategy,data,length:data.length,
        key:buildIndicatorKeyForData(id,period,strategy,data),
        policy:JSON.stringify(STRATEGIES[strategy] || {}),market:getMarketContextKey(),
        tail:getCalculationTailSignature(data) };
}
function isCalculationInputCurrent(guard, verifyContents = false) {
    if (guard.data.length !== guard.length || getCalculationTailSignature(guard.data) !== guard.tail
        || JSON.stringify(STRATEGIES[guard.strategy] || {}) !== guard.policy || getMarketContextKey() !== guard.market) return false;
    return !verifyContents || buildIndicatorKeyForData(guard.id,guard.period,guard.strategy,guard.data) === guard.key;
}
function clearCancelledCalculationRows(data) {
    for (const row of data) if (row) {
        delete row._signals;delete row._signalVersion;delete row._strategy;delete row._decision;
    }
}

function getIndicatorKey(data = getActiveData()) {
    return buildIndicatorKeyForData(state.id, state.period, state.strategy, data);
}

// 落盘决策缓存版本：payload 结构变化时 bump，让旧记录整体作废。
const DECISION_CACHE_RECORD_VERSION = 1;

// 组装可落盘的决策缓存 payload，盖上四道校验闸：
// 记录版本、SIGNAL_VERSION、WAVE_GOVERNANCE_VERSION、strategy。
// cacheKey 本身已含数据内容哈希，读取时按当前数据重算的 key 对不上即自然 miss。
function buildDecisionCacheRecord(cacheKey, strategy, indicators, rows) {
    return {
        decisionCacheVersion: DECISION_CACHE_RECORD_VERSION,
        signalVersion: SIGNAL_VERSION,
        decisionGovernanceVersion: WAVE_GOVERNANCE_VERSION,
        strategy,
        cacheKey,
        indicators,
        rows
    };
}

// 水合闸门：任一版本戳或结构不符即拒绝复用，强制照旧重算。
// 这是跨会话持久化唯一的正确性风险点——策略逻辑升级 bump 版本后，
// 绝不能让用户看到旧缓存算出的买卖点。
function isReusableDecisionCacheRecord(record) {
    if (!record || typeof record !== 'object') return false;
    if (record.decisionCacheVersion !== DECISION_CACHE_RECORD_VERSION) return false;
    if (record.signalVersion !== SIGNAL_VERSION) return false;
    if (record.decisionGovernanceVersion !== WAVE_GOVERNANCE_VERSION) return false;
    if (!record.cacheKey || typeof record.cacheKey !== 'string') return false;
    if (!record.indicators || !record.indicators.macd || !record.indicators.rsi || !record.indicators.kdj) return false;
    if (!Array.isArray(record.rows) || !record.rows.length) return false;
    if (!record.rows.every(row=>!row || (row._strategy===record.strategy && row._signalVersion===SIGNAL_VERSION))) return false;
    if (record.strategy === '波段抄底型' && record.rows[record.rows.length - 1]?._decision?.waveContext?.inScope
        && (!isCurrentDecisionGovernanceVersion(record.rows[record.rows.length - 1]._decision, { waveStockDaily: true })
            || !record.rows.every(row => isValidWavePendingBreakRecord(row?._decision?.waveRejectionProtection)))) return false;
    return true;
}

// 内容指纹只用于校验；同一标的/周期/策略只保留最新快照。
function getDerivedIndicatorCacheScope(cacheKey) {
    return String(cacheKey || '').split('_').slice(0,3).join('_');
}
function putDerivedIndicatorCache(cacheKey, payload) {
    const [id,period,strategy]=getDerivedIndicatorCacheScope(cacheKey).split('_');
    const isIndex=typeof getIndexConfig==='function' ? Boolean(getIndexConfig(id)) : (state.mode==='index' && state.id===id);
    if (!cacheKey || !payload?.rows?.length || !payload.indicators || !isCurrentDerivedDecisionCache(payload,{strategy,
        waveStockDaily:strategy==='波段抄底型' && period==='daily' && !isIndex})) return false;
    const lastDecision=payload.rows[payload.rows.length-1]?._decision;
    if (!isCurrentDecisionMarketContext(lastDecision)) return false;
    const scope=getDerivedIndicatorCacheScope(cacheKey);
    pruneStaleMarketContextCaches();
    for (const key of derivedIndicatorCache.keys()) if (key !== cacheKey && getDerivedIndicatorCacheScope(key) === scope) derivedIndicatorCache.delete(key);
    derivedIndicatorCache.delete(cacheKey);
    derivedIndicatorCache.set(cacheKey,payload);
    while (derivedIndicatorCache.size > SYS_CONFIG.RENDER_CACHE_SIZE) derivedIndicatorCache.delete(derivedIndicatorCache.keys().next().value);
    return true;
}

function storeDerivedIndicatorCache(id, period, strategy, data, indicators) {
    if (!id || !period || !strategy || !data?.length || !indicators?.macd || !indicators?.rsi || !indicators?.kdj) return;
    const cacheKey = buildIndicatorKeyForData(id, period, strategy, data);
    storePreparedDerivedIndicatorCache(cacheKey,id,period,strategy,data,indicators);
}

// 只在同一同步计算步骤内使用已构造/校验的键，不跨帧记忆行情内容指纹。
function storePreparedDerivedIndicatorCache(cacheKey, id, period, strategy, data, indicators) {
    if (!cacheKey) return;
    const entryIndicators = {
        ma: { ...(indicators.ma || {}) },
        macd: indicators.macd,
        rsi: indicators.rsi,
        kdj: indicators.kdj
    };
    const entryRows = data.map(item => item ? ({
        _signals: item._signals,
        _signalVersion: item._signalVersion,
        _strategy: item._strategy,
        _decision: item._decision
    }) : null);
    // 同时收敛异步恢复后才进入内存的旧快照。
    pruneStaleMarketContextCaches();
    const stored=putDerivedIndicatorCache(cacheKey, {
        decisionGovernanceVersion: WAVE_GOVERNANCE_VERSION,
        indicators: entryIndicators,
        rows: entryRows
    });
    if (!stored) return;
    // 仅日线决策会用于自选股冷启动快照，落盘范围限定 daily，避免存周线图表态。
    if (period === 'daily' && typeof persistDerivedDecisionCache === 'function') {
        persistDerivedDecisionCache(id, buildDecisionCacheRecord(cacheKey, strategy, entryIndicators, entryRows));
    }
}

function markIndicatorsDirty() { state.indicatorKey = ''; }

function resetIndicatorState() {
    state.indicators = { ma: {}, macd: null, rsi: null, kdj: null };
    state.pendingIndicatorMutation = { mode: 'full', startIdx: 0 };
    markIndicatorsDirty();
}

let currentCalculationCoordinator = null;
let currentCalculationReadyGuard = null;
let activeCalculationFacts = null;
function getCalculationFact(full, name, args, compute) {
    const task=activeCalculationFacts;
    if (!task || task.full !== full) return compute();
    const key=name+'|'+JSON.stringify(args);
    if (!task.cache.has(key)) task.cache.set(key,compute());
    return task.cache.get(key);
}
function cancelCurrentCalculation(reason = 'superseded') {
    if (activeIndicatorUpdate) activeIndicatorUpdate.cancelled = true;
    currentCalculationCoordinator = null;
    currentCalculationReadyGuard = null;
    state.calculationPending = false;
    state.indicatorKey = '';
}
function isCurrentCalculationReady(verifyContents = true) {
    const full=getActiveData();
    if (!full?.length) return true;
    if (hasOutdatedWaveDecisionRules(full) || !isCurrentDecisionGovernanceVersion(full.at(-1)?._decision)
        || full.some(row=>row && (row._strategy!==state.strategy || row._signalVersion!==SIGNAL_VERSION))) return false;
    if (state.calculationPending || !state.indicatorKey || !state.indicators.macd || !state.indicators.rsi || !state.indicators.kdj) return false;
    if (currentCalculationReadyGuard && currentCalculationReadyGuard.data===full
        && currentCalculationReadyGuard.id===state.id && currentCalculationReadyGuard.period===state.period
        && currentCalculationReadyGuard.strategy===state.strategy && currentCalculationReadyGuard.key===state.indicatorKey)
        return isCalculationInputCurrent(currentCalculationReadyGuard,verifyContents);
    if (state.indicatorKey !== getIndicatorKey(full) || hasOutdatedWaveDecisionRules(full)) return false;
    currentCalculationReadyGuard=createCalculationInputGuard(state.id,state.period,state.strategy,full);
    return true;
}
function ensureCurrentCalculation(options = {}) {
    if (options.isCurrent && !options.isCurrent()) return Promise.resolve(false);
    if (isCurrentCalculationReady()) return Promise.resolve(true);
    const full=getActiveData();if(!full?.length)return Promise.resolve(true);
    const key=getIndicatorKey(full);
    let task=currentCalculationCoordinator;
    if (!task || task.full!==full || task.key!==key || task.mode!==state.mode || task.id!==state.id) {
        const dataToken=typeof createDataTaskToken==='function' ? createDataTaskToken() : null;
        task={full,key,id:state.id,mode:state.mode,period:state.period,strategy:state.strategy,promise:null};
        currentCalculationCoordinator=task;state.calculationPending=true;
        if (typeof updateDataStatusRefreshBadge==='function') updateDataStatusRefreshBadge();
        task.promise=(async()=> {
            const result=await updateAllIndicatorsAsync();
            if (currentCalculationCoordinator!==task || (dataToken && !isDataTaskCurrent(dataToken))) return false;
            return result;
        })().finally(()=>{
            if(currentCalculationCoordinator===task){currentCalculationCoordinator=null;state.calculationPending=false;}
        });
    }
    return options.isCurrent ? task.promise.then(ok=>ok && options.isCurrent()) : task.promise;
}

let activeIndicatorUpdate = null;
function yieldCalculationTurn() {
    if (typeof scheduler !== 'undefined' && typeof scheduler.yield === 'function') return scheduler.yield();
    return new Promise(resolve => setTimeout(resolve, 0));
}

// 同步调用和分段调用共用逐日链路，不能裁掉历史或另算一套策略。
function updateAllIndicators(incrementalIdx = -1) {
    if (activeIndicatorUpdate) activeIndicatorUpdate.cancelled = true;
    const steps = updateIndicatorSteps(incrementalIdx);
    const prior=activeCalculationFacts;activeCalculationFacts={full:getActiveData(),cache:new Map()};
    try {while (!steps.next().done) {}} finally {activeCalculationFacts=prior;steps.return();}
}

async function updateAllIndicatorsAsync(sliceMs = 12) {
    if (activeIndicatorUpdate) activeIndicatorUpdate.cancelled = true;
    const full = getActiveData();
    if (!full?.length) return true;
    const task = { id:state.id, mode:state.mode, period:state.period, strategy:state.strategy,
        full, indicators:state.indicators, cancelled:false };
    const guard = createCalculationInputGuard(task.id,task.period,task.strategy,full);
    activeIndicatorUpdate = task;
    const sameScope = () => state.id === task.id && state.mode === task.mode
        && state.period === task.period && state.strategy === task.strategy;
    const validInput = verifyContents => getActiveData() === full && state.indicators === task.indicators
        && isCalculationInputCurrent(guard,verifyContents);
    const cancelChangedInput = () => {
        // 不缓存部分链；原地价格修订即使只在提交前被发现，也不能复用旧信号。
        clearCancelledCalculationRows(full);
        state.indicatorKey = '';
        state.pendingIndicatorMutation = {mode:'full',startIdx:0};
        return false;
    };
    const canCommit = () => {
        if (task.cancelled || !sameScope()) return false;
        return validInput(true) || cancelChangedInput();
    };
    const steps = updateIndicatorSteps(-1,Math.max(1,sliceMs),canCommit,guard.key);
    try {
        while (true) {
            if (task.cancelled || !sameScope()) return false;
            if (!validInput(false)) return cancelChangedInput();
            const prior=activeCalculationFacts;activeCalculationFacts=task.facts || (task.facts={full,cache:new Map()});
            let result;try {result=steps.next();} finally {activeCalculationFacts=prior;}
            if (result.done) {
                const completed = result.value !== false;
                // 起点和提交前已核对完整内容；展示时仍用此原始快照再次验证。
                if (completed && !task.cancelled && sameScope() && state.indicatorKey === guard.key) currentCalculationReadyGuard=guard;
                return completed;
            }
            await yieldCalculationTurn();
        }
    } finally {
        steps.return();
        task.facts?.cache.clear();
        if (activeIndicatorUpdate === task) activeIndicatorUpdate = null;
    }
}

function* updateIndicatorSteps(incrementalIdx = -1, sliceMs = 0, canCommit = null, preparedKey = '') {
    const perfTrace = PERF.start('updateAllIndicators', { id: state.id, period: state.period, strategy: state.strategy, incrementalIdx });
    const full = getActiveData();
    if(!full || !full.length) {
        PERF.end(perfTrace, { status: 'empty' });
        return;
    }
    // 不完整的持仓观察不能作为顺序决策链的起点；保留行情与指标，只重算派生决策。
    const invalidPendingRecord = state.strategy === '波段抄底型' && state.mode === 'stock' && state.period === 'daily'
        && full.some(row => !isValidWavePendingBreakRecord(row?._decision?.waveRejectionProtection));
    if (invalidPendingRecord) {
        for (const row of full) if (row) delete row._decision;
        state.pendingIndicatorMutation = { mode: 'strategy-only', startIdx: 0 };
        incrementalIdx = -1;
    }
    const outdatedWaveRules = state.strategy === '波段抄底型' && state.mode === 'stock' && state.period === 'daily'
        && hasOutdatedWaveDecisionRules(full);
    // A cancelled strategy switch may leave a correct prefix and an old-strategy middle.
    // A later quote can replace strategy-only with incremental; never start that chain at the tail.
    const strategyRowsStale=full.some((row,index)=>index<full.length-1 && row && row._strategy!==state.strategy);
    const nextKey = preparedKey || getIndicatorKey(full);
    const previousDecision = full[full.length - 1]?._decision || full[full.length - 2]?._decision;
    const marketContextChanged = !!previousDecision && !isCurrentDecisionMarketContext(previousDecision);
    const pendingMutation = state.pendingIndicatorMutation;
    if (incrementalIdx === -1 && !outdatedWaveRules && !strategyRowsStale && pendingMutation?.mode !== 'market-only' && state.indicatorKey === nextKey && state.indicators.macd && state.indicators.rsi && state.indicators.kdj
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

    if (mutation.mode === 'unchanged' && !outdatedWaveRules && !strategyRowsStale && state.indicators.macd && isCurrentDecisionGovernanceVersion(full[full.length - 1]?._decision)) {
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
        if (shouldFullRebuild) Object.assign(state.indicators.ma,Calcs.maBatch(full,MA_OPTIONS));
        else MA_OPTIONS.forEach(n => {
            state.indicators.ma[n] = Calcs.maIncremental(full,n,state.indicators.ma?.[n],calcStart);
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
    const needsSignalRebuild = row => !row._signals || row._signalVersion !== SIGNAL_VERSION
        || (state.mode === 'stock' && state.period === 'daily'
            && (row._strategy !== state.strategy
                || (state.strategy === '波段抄底型' && row._decision?.waveDecisionStateVersion !== WAVE_DECISION_STATE_VERSION)));
    // 周线背景只供原始信号计算使用；只重放决策时不做无用预计算。
    const weeklySignalContexts = (shouldFullRebuild || ((isStrategyOnlyMutation || strategyRowsStale) && state.period === 'daily'))
        && full.some(row => row && needsSignalRebuild(row)) ? buildWeeklySignalContexts(full) : null;
    PERF.mark(perfTrace, 'weekly-signal-context', { precomputed: !!weeklySignalContexts, points: weeklySignalContexts?.length || 0 });

    const isLatestOnlyMutation = !shouldFullRebuild &&
        mutation.mode === 'incremental' &&
        (mutation.startIdx || 0) >= full.length - 1 &&
        full.length > 1 &&
        full[full.length - 2]?._decision &&
        full[full.length - 2]?._strategy === state.strategy &&
        full[full.length - 2]?._signalVersion === SIGNAL_VERSION &&
        isCurrentDecisionGovernanceVersion(full[full.length - 2]?._decision);
    // 实时报价可能把 market-only 替换成 incremental；仍须重算旧环境下的整条决策链。
    const rebuildStart = outdatedWaveRules || strategyRowsStale || isStrategyOnlyMutation || isMarketOnlyMutation || marketContextChanged
        ? 0
        : shouldFullRebuild
        ? 0
        : (isLatestOnlyMutation ? full.length - 1 : Math.max(0, Math.min(full.length - 1, mutation.startIdx || 0) - DECISION_REBUILD_LOOKBACK));

    let sliceStarted = performance.now();
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
        activeCalculationFacts?.cache.clear();
        if (!isMarketOnlyMutation && full[i]?._signals && full[i]._signalVersion === SIGNAL_VERSION && full[i]._strategy === state.strategy
            && full[i]._decision && isCurrentDecisionGovernanceVersion(full[i]._decision)) {
            prevPos = full[i]._decision.position;
            reusedRows += 1;
            continue;
        }
        if (full[i]) {
            if (needsSignalRebuild(full[i])) {
                const signalStarted = performance.now();
                full[i]._signals = calculateDailySignals(i, full, state.indicators, signalBreakdown, weeklySignalContexts?.[i] || null);
                signalMs += performance.now() - signalStarted;
                signalRows += 1;
            }
            full[i]._signalVersion = SIGNAL_VERSION;
            full[i]._strategy = state.strategy;
            const decisionStarted = performance.now();
            // 当前日旧结论不参与自己的重算；只有此前已裁定的交易日提供生命周期。
            delete full[i]._decision;
            full[i]._decision = computeDecisionForIndex(i, full, prevPos);
            decisionMs += performance.now() - decisionStarted;
            decisionRows += 1;
            prevPos = full[i]._decision.position;
            if (sliceMs && performance.now() - sliceStarted >= sliceMs) {
                yield i;
                sliceStarted = performance.now();
            }
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

    if (canCommit && !canCommit()) {
        PERF.end(perfTrace,{status:'cancelled-input',points:full.length});
        return false;
    }
    state.indicatorKey = nextKey;
    state.pendingIndicatorMutation = null;
    storePreparedDerivedIndicatorCache(cacheKey,state.id,state.period,state.strategy,full,state.indicators);
    PERF.mark(perfTrace, 'cache-store');
    PERF.end(perfTrace, { status: shouldFullRebuild ? 'full' : mutation.mode, points: full.length });
}
