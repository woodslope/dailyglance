// [3C] 新手结论汇总 (Novice Decision Summary)
function getStockDecisionSummary(meta, decision) {
    const position = decision?.position ?? 0;
    const action = decision?.simpleAction || '持币观望';
    const exitLevel = decision?.exit?.level || '无明确离场';
    const scoreReady = !!decision?.signalReady || (meta?.windowScore ?? 0) >= (STRATEGY?.buyThreshold ?? Infinity);
    const hasWarning = (meta?.warningSignals || []).length > 0;
    const hasHeatRisk = hasShortTermHeatRisk(meta, null);
    const hasCriticalExit = [EXIT_STATE.HARD,EXIT_STATE.STRONG].includes(getDecisionExitStateCode(decision)) || hasDecisionActionFlag(decision,'hard-or-avoid');
    const waveStructureExit = position === 0
        && Number(decision?.prevAdv) > 0
        && /收盘跌破冻结硬防守位/.test(String(decision?.waveContext?.mainEvent || ''));
    const hasPositionExit = hasCriticalExit || hasDecisionActionFlag(decision,'exit') || waveStructureExit;
    const directExitSignals = meta?.exitSignals || [];
    const waveRejection = decision?.waveRejectionProtection || { status: 'none', active: false };
    const isFreshEntryFailure = ['fresh_entry_failure', 'fresh_entry_downside_failure', 'fresh_entry_hard_break'].includes(waveRejection.eventType);
    const isSignalHardInvalidation = waveRejection.eventType === 'signal_hard_invalidation';
    const isStructureHardBreak = waveRejection.eventType === 'structure_hard_break';
    const isHardInvalidationProtection = isSignalHardInvalidation || isStructureHardBreak || waveRejection.eventType === 'fresh_entry_hard_break';
    const waveEvidence = getWaveEventEvidenceText(waveRejection);
    const waveB6TrendAdd = decision?.waveB6TrendAdd || { eligible: false, applied: false };
    const wavePositionStage = decision?.wavePositionStage || { inScope: false, increaseApplied: false, stage: 'not-applicable' };
    const waveShortRepair = decision?.waveShortRepair || { qualified: false, triggerSignal: '', triggerSignals: [], reason: '' };
    const waveHoldingBaseline = decision?.waveHoldingBaseline || { applied: false };
    const multiTimeframeProbe = decision?.waveContext?.multiTimeframeBottomProbe || { qualified: false };
    const wavePeak = decision?.wavePeak || { status: 'none', candidate: false, confirmed: false, reason: '' };
    const waveExpiryB11TakeoverAdd = decision?.waveExpiryB11TakeoverAdd || { eligible: false, applied: false, active: false, status: 'none' };
    const waveMA20PullbackObservation = decision?.waveMA20PullbackObservation || { applied: false };
    const waveExpiryHandoff = decision?.waveExpiryHandoff || { applied: false };
    const localGuard = decision?.waveContext?.lifecycle?.localDefenseGuard;
    const waveL10Handoff = decision?.waveL10TrendHandoff || { applied: false };
    const previousPosition = Number(decision?.prevAdv) || 0;
    const threshold = Number(STRATEGY?.buyThreshold);
    const scoreBelowThreshold = Number.isFinite(threshold) && (meta?.windowScore ?? 0) < threshold;
    const basePosition = Number(decision?.basePosition);
    const basePositionIsEmpty = Number.isFinite(basePosition) ? basePosition <= 0 : scoreBelowThreshold;
    const isEntry = previousPosition === 0 && position > 0;
    const isIncrease = position > previousPosition;
    const isReduce = previousPosition > 0 && position < previousPosition;
    const appliedRegimeCap = decision?.waveContext?.appliedRegimeCap;
    const regimeCapActive = Number.isFinite(appliedRegimeCap?.limit) && position === appliedRegimeCap.limit;
    const isProbeEntry = multiTimeframeProbe.qualified && isEntry && position <= 30 && !wavePositionStage.shortRepairEligible;
    const isBreakoutPullbackEntry = isWaveBreakoutPullbackEntry(wavePositionStage, previousPosition, position);
    let stateLabel = '弱势观察';
    let userAction = '先不碰';
    if (hasCriticalExit) {
        stateLabel = '破位防守';
        userAction = position === 0 ? '离场观察' : '降低仓位';
    } else if (position === 0) {
        stateLabel = meta?.inCooldown ? '离场冷静期' : (hasPositionExit ? (basePositionIsEmpty && directExitSignals.length === 0 ? '信号失效' : '风险防守') : '弱势观察');
        userAction = hasPositionExit ? '离场观察' : '暂时不买';
    } else if (isReduce) {
        stateLabel = '风险观察';
        userAction = '降低仓位';
    } else if (position <= 30) {
        stateLabel = hasDecisionActionFlag(decision,'reduce') || hasWarning ? '风险观察' : '试探观察';
        userAction = hasDecisionActionFlag(decision,'reduce') ? '降低仓位' : '轻仓观察';
    } else if (scoreReady && position >= 50) {
        stateLabel = hasHeatRisk ? '转强但偏热' : (hasWarning ? '转强但风险未消' : '趋势转强');
        userAction = isIncrease ? '提高仓位' : '继续持有';
    } else {
        stateLabel = '持仓观察';
        userAction = '继续持有';
    }

    const scoreText = `${meta?.windowScore ?? 0}/${STRATEGY?.buyThreshold ?? '-'}`;
    const strongExitSet = getStrongExitSignals(STRATEGY);
    const strongExitSignals = directExitSignals.filter(signal => strongExitSet.has(signal));
    const otherExitSignals = directExitSignals.filter(signal => !strongExitSet.has(signal));
    const formatExitSignal = signal => getUserSignalText(signal);
    const hasPreviousPosition = previousPosition > 0;
    const scoreIsEmpty = (meta?.windowScore ?? 0) <= 0;
    const positionToZeroText = hasPreviousPosition ? `当前从${previousPosition}%降至 0%` : '策略参考仓位降至 0%';
    const waveEntryBlocked = position === 0
        && scoreReady
        && decision?.waveContext?.inScope
        && decision.waveContext.mainEvent;
    const signalCause = getSignalCauseSummary(meta);
    const buyCauseText = signalCause.text || '当前有效买入信号';
    const lifecycleTransition = getSignalLifecycleTransition(meta, decision, 'stock');
    const signalBreakKeepsStructure = lifecycleTransition.kind === 'local';
    const positionChange = getStockPositionChangeDetails(meta, decision, signalCause, previousPosition, position);
    if (!hasCriticalExit && lifecycleTransition.kind === 'hard' && !isIncrease) {
        stateLabel = '信号硬失效';
        userAction = position === 0 ? '离场观察' : '降低仓位';
    } else if (!hasCriticalExit && lifecycleTransition.kind === 'local') {
        stateLabel = '结构未破';
        userAction = position > 0 ? '轻仓观察' : '暂时不买';
    } else if (!hasCriticalExit && lifecycleTransition.kind === 'soft') {
        stateLabel = '动能转弱';
        userAction = position > 0 ? '轻仓观察' : '暂时不买';
    } else if (!hasCriticalExit && lifecycleTransition.kind === 'soft-expired') {
        stateLabel = '信号失效';
        userAction = '离场观察';
    }
    if (!hasCriticalExit && waveL10Handoff.applied) {
        stateLabel = '趋势接管预警';
        userAction = position < previousPosition ? '降低仓位' : '轻仓观察';
    } else if (!hasCriticalExit && waveRejection.status === 'entry_blocked') {
        stateLabel = '压力受阻';
        userAction = '暂时不买';
    } else if (!hasCriticalExit && waveRejection.status === 'pressure_hold') {
        stateLabel = '压力受阻观察';
        userAction = position < previousPosition ? '降低仓位' : '轻仓观察';
    } else if (!hasCriticalExit && waveRejection.status === 'ma20_hold') {
        stateLabel = 'MA20上方观察';
        userAction = '轻仓观察';
    } else if (!hasCriticalExit && waveRejection.status === 'triggered' && !signalBreakKeepsStructure) {
        stateLabel = isStructureHardBreak ? '结构破位离场' : (isSignalHardInvalidation ? '信号硬失效' : (isFreshEntryFailure ? (position === 0 ? '新仓失败离场' : (waveRejection.eventType === 'fresh_entry_downside_failure' ? '新仓下跌防守' : '新仓压力防守')) : '冲高回落止盈'));
        userAction = position === 0 ? '离场观察' : '降低仓位';
    } else if (!hasCriticalExit && waveRejection.status === 'locked') {
        stateLabel = '风险恢复观察';
        userAction = position === 0 ? '暂时不买' : '持仓观察';
    } else if (!hasCriticalExit && ['released', 'recovery_pending'].includes(waveRejection.status)) {
        stateLabel = waveRejection.reentryRoute === 'new-entry' && position > 0 ? '新一轮建仓' : '风险解除';
        userAction = position > 0 ? (previousPosition === 0 ? '轻仓建仓' : '继续持有') : '继续观察';
    } else if (!hasCriticalExit && ['recovery_started', 'recovery_hold'].includes(waveRejection.status)) {
        const delayedReentryToday = waveRejection.delayedPullback?.applied === true && waveRejection.delayedPullback.confirmationDate === meta?.currentDate && position > 0;
        stateLabel = delayedReentryToday ? '回踩确认再入场' : (waveRejection.reentryRoute === 'new-entry' ? '新仓观察' : '分步恢复');
        userAction = delayedReentryToday && previousPosition === 0 ? '轻仓建仓' : '轻仓观察';
    } else if (!hasCriticalExit && waveExpiryB11TakeoverAdd.applied) {
        stateLabel = '回踩确认加仓';
        userAction = '提高仓位';
    } else if (!hasCriticalExit && waveExpiryB11TakeoverAdd.active) {
        stateLabel = '确认仓持有';
        userAction = '继续持有';
    } else if (!hasCriticalExit && waveExpiryB11TakeoverAdd.status === 'released') {
        stateLabel = '降回轻仓';
        userAction = '降低仓位';
    } else if (!hasCriticalExit && waveHoldingBaseline.applied && !wavePeak.candidate) {
        stateLabel = '趋势持有';
        userAction = '继续持有';
    } else if (!hasCriticalExit && waveB6TrendAdd.applied) {
        stateLabel = '回踩确认加仓';
        userAction = '提高仓位';
    } else if (!hasCriticalExit && isProbeEntry) {
        stateLabel = '多周期底部共振试探';
        userAction = '轻仓建仓';
    } else if (!hasCriticalExit && wavePositionStage.stage === 'breakout-wait') {
        stateLabel = '突破后等回踩';
        userAction = '暂不追价';
    } else if (!hasCriticalExit && waveEntryBlocked && previousPosition === 0) {
        stateLabel = '建仓条件未满足';
        userAction = '暂时不买';
    } else if (!hasCriticalExit && isReduce && regimeCapActive) {
        stateLabel = '环境防守';
        userAction = '降低仓位';
    } else if (!hasCriticalExit && wavePeak.confirmed && isReduce) {
        stateLabel = '波峰防守';
        userAction = '降低仓位';
    } else if (!hasCriticalExit && wavePeak.candidate && !isIncrease && !isReduce && !waveEntryBlocked) {
        stateLabel = '压力区观察';
        userAction = position > 0 ? '谨慎持有' : '暂不追价';
    } else if (!hasCriticalExit && wavePositionStage.increaseApplied && position > previousPosition) {
        stateLabel = wavePositionStage.stage === 'trend'
            ? (position < 80 ? '趋势建议受限' : (previousPosition === 0 ? '趋势确认建仓' : '趋势延续加仓'))
            : (wavePositionStage.stage === 'entry' && previousPosition === 0
                ? (isBreakoutPullbackEntry ? '回踩试探建仓' : '试探观察')
                : (previousPosition === 0 ? (position <= 30 ? '试探观察' : '底部确认建仓') : '反转确认加仓'));
        userAction = previousPosition === 0
            ? (position <= 30 ? '轻仓建仓' : '确认建仓')
            : '提高仓位';
    } else if (!hasCriticalExit && waveMA20PullbackObservation.applied) {
        stateLabel = waveMA20PullbackObservation.defenseType === 'standalone_l3'
            ? (waveMA20PullbackObservation.oneDayL3Closure ? '动能转弱观察' : 'MA20趋势防守')
            : (waveMA20PullbackObservation.defenseType === 'limited_hard_invalidation'
                ? 'MA20回踩防守'
                : (waveMA20PullbackObservation.defenseType === 'breakout_pullback' ? '突破后回踩观察' : 'MA20回踩观察'));
        userAction = '轻仓观察';
    } else if (!hasCriticalExit && waveMA20PullbackObservation.status === 'expired') {
        stateLabel = 'MA20观察结束';
        userAction = '离场观察';
    } else if (!hasCriticalExit && waveExpiryHandoff.applied) {
        stateLabel = waveExpiryHandoff.trendWashout
            ? '趋势洗盘观察'
            : (waveExpiryHandoff.observationMode === 'defensive' ? '到期防守观察' : '反弹接管观察');
        userAction = '轻仓观察';
    } else if (!hasCriticalExit && waveExpiryHandoff.status === 'expired') {
        stateLabel = '到期观察结束';
        userAction = '离场观察';
    }

    // 恢复阶段只解释原因，动作始终服从最终前后仓位。
    if (!hasCriticalExit && ['released', 'recovery_pending', 'recovery_started', 'recovery_hold'].includes(waveRejection.status)) {
        userAction = isEntry ? '轻仓建仓' : isReduce ? (position > 0 ? '降低仓位' : '离场观察')
            : isIncrease ? '提高仓位' : position > 0 ? '继续持有' : '继续观察';
        if (position <= 0) stateLabel = '恢复待确认';
    }
    if (!hasCriticalExit && waveRejection.finalRejectionReason && Number(waveRejection.finalRejectionDay) === Number(meta?.currentDay)) {
        stateLabel = previousPosition > 0 && position === 0 ? '恢复观察结束' : '建仓条件未满足';
        userAction = previousPosition > 0 && position === 0 ? '离场观察' : position > 0 ? '持仓观察' : '暂时不买';
    }

    let reason = '';
    if (!hasCriticalExit && waveL10Handoff.applied) {
        reason = '今日仅出现MACD顶背离，多头结构仍在，不直接清仓，先按趋势接管防守观察';
    } else if (!hasCriticalExit && waveRejection.status === 'entry_blocked') {
        const sourceText = (waveRejection.sourceSignals || []).includes('B16') ? '周线支撑企稳信号' : '当前买入信号';
        reason = `${waveEvidence}，形成长上影；${sourceText}原本准备轻仓建仓，本次取消建仓且不画B`;
    } else if (!hasCriticalExit && waveRejection.status === 'pressure_hold') {
        reason = `${waveEvidence}，收盘重新落回下降MA20下方，但本轮结构防守位${formatPriceLevel(waveRejection.structureDefense?.level)}未破，最多保留${position}%且不加仓`;
    } else if (!hasCriticalExit && waveRejection.status === 'ma20_hold') {
        reason = `${waveEvidence}，虽出现压力长上影，但收盘仍站在MA20上方，本次只保留${position}%观察且不加仓`;
    } else if (!hasCriticalExit && signalBreakKeepsStructure) {
        reason = lifecycleTransition.text;
    } else if (!hasCriticalExit && waveRejection.status === 'triggered') {
        if (isSignalHardInvalidation) {
            reason = `${waveEvidence}，买入信号硬失效，当前从${previousPosition}%降至${position}%并进入局部重入保护`;
        } else if (isStructureHardBreak) {
            reason = `${waveEvidence}，持仓结构失效，当前从${previousPosition}%降至${position}%并进入重入保护`;
        } else if (waveRejection.eventType === 'fresh_entry_hard_break') {
            reason = `${waveEvidence}，${waveRejection.confirmedDay != null ? '首破观察期结束仍未收复，确认新仓硬失效，当前' : '新仓硬失效，风险日'}从${previousPosition}%降至${position}%`;
        } else if (waveRejection.eventType === 'fresh_entry_downside_failure') {
            reason = `${waveEvidence}，形成贴近防守位的大阴线，风险日从${previousPosition}%降至${position}%`;
        } else if (waveRejection.eventType === 'fresh_entry_failure') {
            reason = `${waveEvidence}，${waveRejection.ma20RejectionExit ? '形成长上影且收盘重新落回MA20下方' : '形成长上影且收盘不高于买入日收盘'}，判定新仓冲击压力失败，风险日从${previousPosition}%降至${position}%`;
        } else {
            reason = `${waveEvidence}，判定已有浮盈后的放量冲高回落，风险日实时分档止盈，当前从${previousPosition}%降至${position}%`;
        }
    } else if (!hasCriticalExit && waveRejection.status === 'locked') {
        const recoveryLevel = Number(waveRejection.recoveryCloseLevel ?? waveRejection.triggerClose);
        const currentClose = Number(meta?.currentClose);
        const levelName = isStructureHardBreak ? '原结构恢复参考价' : (isHardInvalidationProtection ? '信号失效位' : '风险日收盘');
        const blockerText = getWaveRecoveryBlockText(meta, waveRejection);
        const recoveryState = Number.isFinite(currentClose) && Number.isFinite(recoveryLevel) && currentClose > recoveryLevel
            ? `当前收盘${formatPriceLevel(currentClose)}已站回${levelName}${formatPriceLevel(recoveryLevel)}，${Number(waveRejection.lockRemaining) > 0 ? '但完整观察期尚未结束' : '仍需可执行的入场依据与最终建仓检查'}`
            : `当前收盘${formatPriceLevel(currentClose)}尚未站回${levelName}${formatPriceLevel(recoveryLevel)}`;
        reason = blockerText
            ? `${waveRejection.newEntry?.inScope && waveRejection.newEntry.reasonText !== blockerText ? waveRejection.newEntry.reasonText + '；' : ''}${blockerText}，当前保持${position}%；${previousPosition > 0 && position === 0 ? '本次观察仓位已退出' : '价格收复不等于已获准建仓'}`
            : waveRejection.newEntry?.inScope
            ? `${waveRejection.triggerDate || '此前'}的风险事件后，${waveRejection.newEntry.reasonText}；原结构恢复仍按既有收复或回踩条件确认，新交易独立审查，不要求先收复旧止损位，当前保持${position}%`
            : `${waveRejection.triggerDate || '此前'}的风险事件仍在局部保护期；${recoveryState}，事件前旧积分不立即触发回补，当前保持${position}%防守仓位`;
    } else if (!hasCriticalExit && waveRejection.status === 'released') {
        let recoveryText = `当前已收复事件高点${formatPriceLevel(Number(waveRejection.triggerHigh))}且事件后的新信号仍有效`;
        if (waveRejection.pullbackRecovery) {
            recoveryText = `事件后新出现${(waveRejection.freshPullbackSignals || []).map(getUserSignalText).join('、') || '有效回踩企稳'}，并站上未下行的MA${Number(waveRejection.pullbackMovingAveragePeriod) || 20}`;
        } else if (waveRejection.strongFreshRecovery) {
            recoveryText = `事件后新积分已达到${Number(waveRejection.postEventScore) || 0}/${Number(waveRejection.minimumPostEventScore) || Number(STRATEGY?.buyThreshold) || 4}，且来自${(waveRejection.postEventScoreSignals || []).length}个独立计分组`;
        } else if (waveRejection.stableRecovery) {
            recoveryText = `当前收盘已站回${isHardInvalidationProtection ? '信号失效位' : '风险日收盘'}${formatPriceLevel(Number(waveRejection.recoveryCloseLevel ?? waveRejection.triggerClose))}`;
        }
        reason = waveRejection.reentryRoute === 'new-entry'
            ? (position > 0
                ? `${recoveryText}，本轮首次建仓资格和防守距离通过，按新一轮建仓建立${position}%试探仓，不要求收复旧止损位，已重新冻结本轮防守位`
                : `${recoveryText}，但尚未通过最终首次建仓检查，当前继续空仓；${decision.waveContext?.mainEvent || '等待本轮入场条件全部满足'}`)
            : `${waveRejection.reentryRoute === 'original-recovery' ? '原结构恢复：' : ''}${recoveryText}，局部保护解除，当前先恢复至${position}%仓位观察`;
    } else if (!hasCriticalExit && waveRejection.status === 'recovery_pending') {
        const blocker = getWaveRecoveryBlockText(meta, waveRejection);
        reason = blocker ? `${blocker}，继续空仓观察`
            : '风险价格条件已局部解除，但当前尚无可执行的恢复仓位，继续空仓观察';
    } else if (!hasCriticalExit && waveRejection.status === 'recovery_started') {
        reason = waveRejection.delayedPullback?.applied === true && waveRejection.delayedPullback.confirmationDate === meta?.currentDate
            ? `${waveRejection.delayedPullback.touchDate}回踩20日线附近后，今日收阳企稳且未再破回踩低点，恢复${position}%试探仓，并按本次确认日低点重新设置防守位`
            : `冲高回落事件后首次恢复，当前最多恢复至${position}%仓位`;
    } else if (!hasCriticalExit && waveRejection.status === 'recovery_hold') {
        reason = waveRejection.reentryRoute === 'new-entry'
            ? `新一轮建仓后仍在低仓确认期，当前保持${position}%仓位，按本轮新防守位管理风险`
            : `冲高回落事件后仍在低仓确认期，当前保持${position}%仓位`;
    } else if (!hasCriticalExit && waveExpiryB11TakeoverAdd.applied) {
        reason = `前一日到期防守观察成功后，今日新出现均线回踩不破并重新站上MA5与MA20，MA20保持未下行，当前从${previousPosition}%提高至${position}%`;
    } else if (!hasCriticalExit && waveExpiryB11TakeoverAdd.active) {
        reason = `${waveExpiryB11TakeoverAdd.triggerDate || '此前'}的回踩确认仍有效，继续持有`;
    } else if (!hasCriticalExit && waveExpiryB11TakeoverAdd.status === 'released') {
        reason = `当前不再满足原确认仓位的持有条件，由${previousPosition}%降至${position}%；原有轻仓仍满足观察条件，暂不全部离场`;
    } else if (!hasCriticalExit && waveHoldingBaseline.applied && !wavePeak.candidate) {
        reason = waveHoldingBaseline.reason;
    } else if (!hasCriticalExit && waveB6TrendAdd.applied) {
        reason = `今日缩量回踩${waveB6TrendAdd.movingAveragePeriod}日线后收回，且该均线未下行，触发趋势修复加仓，当前从${previousPosition}%提高至${position}%`;
    } else if (!hasCriticalExit && waveShortRepair.qualified && wavePositionStage.increaseApplied && position > previousPosition) {
        reason = `${waveShortRepair.reason}，本次按短期修复提高仓位，中期趋势尚未确认反转`;
    } else if (!hasCriticalExit && isProbeEntry) {
        reason = `周线双底第二底与日线B20共振，当前建立${position}%底部试探仓；该信号属于低位修复，不等同于颈线突破确认`;
    } else if (!hasCriticalExit && wavePositionStage.stage === 'breakout-wait') {
        reason = wavePositionStage.reason || '突破确认后等待首次回踩，不追价建仓';
    } else if (!hasCriticalExit && waveEntryBlocked && previousPosition === 0) {
        reason = `买入积分已达到 ${scoreText}，但${decision.waveContext.mainEvent}，当前保持0%，等待首次建仓条件全部满足`;
    } else if (!hasCriticalExit && isReduce && regimeCapActive) {
        reason = `${appliedRegimeCap.reason}，当前由${previousPosition}%降至${position}%`;
    } else if (!hasCriticalExit && wavePeak.confirmed) {
        reason = wavePeak.reason || '触及日线或周线压力并出现转弱形态，按波峰防守处理';
    } else if (!hasCriticalExit && wavePeak.candidate && !isReduce && !waveEntryBlocked
            && !(wavePositionStage.increaseApplied && position > previousPosition)) {
        reason = wavePeak.reason || '已接近日线或周线压力区，先观察波峰是否确认';
    } else if (!hasCriticalExit && wavePositionStage.increaseApplied && position > previousPosition) {
        const triggerText = wavePositionStage.triggerSignal === 'B19'
            ? '今日双底颈线突破完成底部结构确认'
            : (wavePositionStage.triggerSignal === 'multi-reversal'
                ? `今日底背离与${wavePositionStage.freshGroupCount || 2}组反转信号共振`
                : `今日新出现${getUserSignalText(wavePositionStage.triggerSignal)}`);
        reason = wavePositionStage.stage === 'trend'
            ? `${triggerText}，且个股保持完整多头结构，当前${previousPosition === 0 ? '首次建议' : `从${previousPosition}%提高至`}${position}%${position >= 80 ? '趋势仓' : '策略参考仓位'}`
            : (wavePositionStage.stage === 'entry' && previousPosition === 0
                ? (isBreakoutPullbackEntry
                    ? `${wavePositionStage.breakoutDate}突破后，今日${getUserSignalText(wavePositionStage.triggerSignal)}完成首次回踩确认，当前建立${position}%低吸试探仓`
                    : `${buyCauseText}，当前建立${position}%试探仓，等待后续有效确认`)
                : `${triggerText}，当前${previousPosition === 0 ? '建立' : `从${previousPosition}%提高至`}${position}%${position >= 50 ? '确认' : '试探'}仓`);
    } else if (!hasCriticalExit && waveMA20PullbackObservation.applied) {
        reason = waveMA20PullbackObservation.defenseType === 'standalone_l3'
            ? (waveMA20PullbackObservation.oneDayL3Closure
                ? `今日出现单独MACD死叉，但结构防守位尚未失守，先轻仓观察`
                : `今日出现单独MACD死叉，但价格仍在完整多头结构中，先轻仓观察`)
            : (waveMA20PullbackObservation.defenseType === 'limited_hard_invalidation'
                ? `买点失效位虽被收盘跌破，但价格仍守住MA20，先保留${position}%观察`
                : (waveMA20PullbackObservation.defenseType === 'breakout_pullback'
                    ? waveMA20PullbackObservation.reason
                    : `今日收盘仅小幅低于抬升中的${waveMA20PullbackObservation.movingAveragePeriod}日线，但下影线明显收回、结构防守位未破，当前保留${position}%轻仓观察一日，不加仓也不清仓`));
    } else if (!hasCriticalExit && waveMA20PullbackObservation.status === 'expired') {
        reason = `${getWaveMA20ObservationFailureText(waveMA20PullbackObservation, meta, decision?.exit)}，当前从${previousPosition}%降至${position}%`;
    } else if (!hasCriticalExit && waveExpiryHandoff.applied) {
        const momentumText = (waveExpiryHandoff.momentumSignals || []).join('、') || '短线动能继续改善';
        reason = waveExpiryHandoff.trendWashout
            ? `买入积分仅因窗口到期降为${scoreText}，但MA${waveExpiryHandoff.trendMAPeriod}仍高于MA${waveExpiryHandoff.longMAPeriod}且未下行，当前按上涨趋势洗盘保留${position}%防守仓位`
            : (waveExpiryHandoff.observationMode === 'defensive'
            ? `原买入积分仅因窗口到期由${waveExpiryHandoff.previousWindowScore}/${threshold}降至${scoreText}，但价格仍守住原买点防守位，且${momentumText}，当前保留${position}%轻仓防守观察一日`
            : `原买入积分仅因窗口到期由${waveExpiryHandoff.previousWindowScore}/${threshold}降至${scoreText}，但价格仍守住原买点防守位、重新站上${waveExpiryHandoff.shortMAPeriod}日线，且${momentumText}，当前保留${position}%轻仓等待接管`);
    } else if (!hasCriticalExit && waveExpiryHandoff.status === 'expired') {
        reason = `${getWaveExpiryObservationFailureContext(waveExpiryHandoff, meta, decision?.exit).text}，当前从${previousPosition}%降至${position}%`;
    } else if (!hasCriticalExit && position === 0 && meta?.inCooldown) {
        reason = '此前离场后的冷静期尚未结束，继续空仓等待';
    } else if (!hasCriticalExit && position > 0 && localGuard?.active) {
        stateLabel = '局部防守观察';
        userAction = isReduce ? '降低仓位' : '轻仓观察';
        reason = `均线回踩局部防守位${formatPriceLevel(localGuard.localLevel)}尚未收复，${isReduce ? `当前由${previousPosition}%降至${position}%` : `当前最多保留${position}%试探仓`}，暂不加仓`;
    } else if (!hasCriticalExit && lifecycleTransition.text) {
        reason = lifecycleTransition.text;
    } else if (waveStructureExit && hasPositionExit && getDecisionExitStateCode(decision) === EXIT_STATE.NONE && hasPreviousPosition) {
        reason = `${decision.waveContext.mainEvent}，${positionToZeroText}，先空仓防守`;
    } else if (hasPositionExit && getDecisionExitStateCode(decision) === EXIT_STATE.NONE && hasPreviousPosition && basePositionIsEmpty) {
        const scoreReason = scoreIsEmpty
            ? `${previousPosition <= 30 ? '此前试探仓' : '此前持仓'}依赖的买入信号已失效，买入积分降为 ${scoreText}`
            : `${previousPosition <= 30 ? '此前试探仓' : '此前持仓'}依赖的买入条件已不足，买入积分为 ${scoreText}，低于开仓门槛 ${threshold}/${threshold}`;
        const exitText = previousPosition <= 30 ? `退出${previousPosition}%试探仓，当前仓位为 0%` : positionToZeroText;
        reason = `${scoreReason}，${exitText}，先空仓观察`;
    } else if (hasPositionExit && getDecisionExitStateCode(decision) === EXIT_STATE.NONE && hasPreviousPosition) {
        reason = positionChange.reason || `当前结构或生命周期防守使策略参考仓位归零，${positionToZeroText}，先空仓防守`;
    } else if (hasPositionExit && getDecisionExitStateCode(decision) === EXIT_STATE.NONE) {
        reason = '当前没有满足开仓条件，策略参考仓位保持0%，继续空仓观察';
    } else if (hasCriticalExit && strongExitSignals.length) {
        const exitText = [...strongExitSignals, ...otherExitSignals].map(formatExitSignal).join('、');
        const triggerText = meta?.repeatedStrongExit ? '今日再次触发强离场' : '今日触发强离场';
        reason = `${triggerText}：${exitText}；此前买入依据失效，先离场防守`;
    } else if (hasCriticalExit) {
        const exitReason = directExitSignals.length
            ? `${directExitSignals.map(formatExitSignal).join('、')}，${position === 0 && [EXIT_STATE.REDUCE, EXIT_STATE.DEFENSIVE].includes(getDecisionExitStateCode(decision)) ? '原持有条件不再满足' : `当前按${exitLevel}处理`}`
            : (decision?.exit?.detail || `当前按${exitLevel}处理`);
        const zeroPositionText = position === 0 ? `，${positionToZeroText}，先空仓防守` : '，当前先处理风险';
        reason = `${exitReason}${zeroPositionText}`;
    } else if (hasPositionExit && hasPreviousPosition) {
        const warningNames = (meta?.warningSignals || []).slice(0, 2).map(getUserSignalText);
        const warningEvidence = warningNames.length
            ? `今日出现${warningNames.join('、')}预警${scoreBelowThreshold ? `，同时买入积分为${scoreText}，未达到开仓门槛${threshold}/${threshold}` : ''}`
            : '';
        const exitReason = directExitSignals.length
            ? `${directExitSignals.map(formatExitSignal).join('、')}，${position === 0 ? '原持有条件不再满足' : `当前按${exitLevel}处理`}`
            : (waveStructureExit
                ? decision.waveContext.mainEvent
                : (warningEvidence || decision?.exit?.detail || `当前按${exitLevel}处理`));
        const positionAction = position === 0
            ? `${positionToZeroText}，先空仓防守`
            : `当前从${previousPosition}%降至${position}%防守`;
        reason = `${exitReason}，${positionAction}`;
    } else if (isReduce) {
        reason = positionChange.reason;
    } else if (waveEntryBlocked) {
        reason = `买入积分已达到 ${scoreText}，但${decision.waveContext.mainEvent}，当前暂不建仓`;
    } else if (position === 0) {
        reason = `买入积分当前为${meta?.windowScore ?? 0}分，开仓需${STRATEGY?.buyThreshold ?? '--'}分，暂不买入`;
    } else if (isEntry) {
        reason = positionChange.reason;
    } else if (isIncrease && getSignalStateCode(meta) === SIGNAL_STATE.HOLD) {
        reason = `价格重新站回20日线，趋势抱单状态接管此前轻仓观察，当前从${previousPosition}%提高至${position}%`;
    } else if (isIncrease) {
        reason = positionChange.reason;
    } else if (position <= 30) {
        reason = scoreReady
            ? `${buyCauseText}使买入积分维持在 ${scoreText}，当前按${position}%轻仓继续观察`
            : `买入积分为 ${scoreText}，当前按${position}%轻仓继续观察`;
    } else {
        reason = scoreReady
            ? `${buyCauseText}，继续支持当前持仓`
            : `买入积分为 ${scoreText}，当前按${position}%仓位继续观察`;
    }
    // 只突出已有、当前生效的回撤预警；不把观察信号升级为离场，也不覆盖结构/观察事件。
    if (!hasCriticalExit && isReduce && (meta?.warningSignals || []).includes('L9')
        && ['信号失效', '风险防守', '风险观察', '弱势观察'].includes(stateLabel)) {
        stateLabel = '高点回撤防守';
        const warningName = getUserSignalText('L9');
        if (!reason.includes(warningName)) reason = `今日出现${warningName}预警；${reason}`;
    }
    const why = getPlainDisplayText(reason);
    const wavePositionNote = resolveWavePositionNote({
        decision, meta, position, previousPosition, isEntry,
        waveL10Handoff, waveRejection, isSignalHardInvalidation, signalBreakKeepsStructure,
        waveExpiryB11TakeoverAdd, waveB6TrendAdd, waveShortRepair, multiTimeframeProbe,
        wavePositionStage, wavePeak, waveMA20PullbackObservation, waveExpiryHandoff, waveEntryBlocked
    });
    const positionWhy = wavePositionNote
        ? wavePositionNote.text
        : getPlainDisplayText(positionChange.positionExplanation);
    const positionWhyCode = wavePositionNote ? wavePositionNote.code : 'position-path';
    const lockRemaining = Math.max(0, Number(waveRejection.lockRemaining) || 0);
    const freshScoreRecoveryAllowed = ['fresh_entry_failure', 'fresh_entry_downside_failure'].includes(waveRejection.eventType)
        && waveRejection.ma20RejectionExit !== true;
    const lockedNextFocus = waveRejection.newEntry?.inScope
        ? getWaveNewEntryNextFocus(waveRejection)
        : lockRemaining > 0
        ? `当前是风险事件后的第${Math.max(1, Number(waveRejection.lockAge) || 1)}个观察交易日，还需等待${lockRemaining}个交易日；最早下一个交易日重新评估30%试探仓。`
        : (isHardInvalidationProtection
            ? getWaveOriginalRecoveryNextFocus(waveRejection)
            : (freshScoreRecoveryAllowed
                ? `完整观察期已结束；等事件后新积分达到${Number(waveRejection.minimumPostEventScore) || Number(STRATEGY?.buyThreshold) || 4}分且至少来自${Number(waveRejection.minimumPostEventGroups) || 2}个独立计分组，风险稳定后可恢复最多30%试探仓，不要求先收复风险日收盘价。`
                : '完整观察期已结束；若是已有浮盈减仓，新的缩量/均线回踩企稳并守住风险日低点时可先补回一档；否则待价格收复关键压力。'));
    const displayedDefense = getDecisionDefenseDisplay(decision);
    const layerDefenseText = displayedDefense ? displayedDefense.label + formatPriceLevel(displayedDefense.level) : '本轮有效防守位';
    const nextFocus = waveRejection.status === 'entry_blocked'
        ? '至少观察一个完整交易日；后续需站回风险日收盘，或收复风险日高点且事件后新的有效修复信号仍然有效，才重新考虑30%试探仓。'
        : (waveRejection.status === 'locked'
            ? lockedNextFocus
            : (waveExpiryB11TakeoverAdd.applied || waveExpiryB11TakeoverAdd.active
        ? `若出现压力回落、预警或仓位上限收紧，先由确认仓降回30%轻仓。若原有轻仓条件失效、收盘跌破${layerDefenseText}或出现离场信号，再按规则降至0%。`
        : (waveMA20PullbackObservation.applied
            ? (waveMA20PullbackObservation.oneDayL3Closure
                ? `下一交易日需站回20日线，或出现新的有效回踩确认；同时守住防守位${formatPriceLevel(waveMA20PullbackObservation.defenseLevel)}，且没有离场、预警、冷静期或当日信号失效阻断。未通过则降至0%；通过后仍按原仓位规则判断，不自动加仓。`
                : `下一交易日需重新站回MA20，或出现新的B6/B11确认。若到期仍未满足上述条件，或收盘跌破观察日低点${formatPriceLevel(waveMA20PullbackObservation.triggerLow)}、结构防守位${formatPriceLevel(waveMA20PullbackObservation.defenseLevel)}，或出现离场信号，仓位降至0%。`)
            : (waveExpiryHandoff.applied
                ? (waveExpiryHandoff.trendWashout
                    ? `洗盘观察最多保留${waveExpiryHandoff.maxTradingDays || 2}个交易日；期间需重新站回MA20或出现新的有效买入信号接管。若MA20转弱、收盘跌破原买点防守位或出现离场信号，仓位降至0%。`
                    : (waveExpiryHandoff.observationMode === 'defensive'
                    ? `下一交易日需同时重新站上MA5与MA20，或出现新的有效买入信号。若到期仍未满足上述条件，或收盘跌破观察日低点${formatPriceLevel(waveExpiryHandoff.triggerLow)}、原买点防守位${formatPriceLevel(waveExpiryHandoff.entryLow)}，或出现离场信号，仓位降至0%。`
                    : `下一交易日需确认趋势仍支持持仓，或出现新的有效买入信号。若到期仍未满足上述条件，或跌破原买点防守位${formatPriceLevel(waveExpiryHandoff.entryLow)}、出现离场信号，仓位降至0%。`))
                : getPlainDisplayText(getStockNextFocus(meta, decision, position, hasWarning))))));

    // 观察、接管或恢复只解释状态；当日动作必须服从最终前后仓位，不改写决策。
    if (decision?.waveContext?.inScope) {
        if (isEntry) userAction = position <= 30 ? '轻仓建仓' : '确认建仓';
        else if (isReduce) userAction = position > 0 ? '降低仓位' : '离场观察';
        else if (isIncrease) userAction = '提高仓位';
    }

    return {
        state: stateLabel,
        action: userAction,
        positionText: `${position}%`,
        why,
        positionWhy,
        positionWhyCode,
        nextFocus,
        reason: why,
        positionExplanation: positionWhy,
        invalidCondition: nextFocus
    };
}

// 指数状态/观察只解释背景；最终动作唯一按参考仓位的实际变化翻译。
function getIndexReferenceAction(position, previousPosition) {
    if (position === 0) return previousPosition > 0 ? '风险仓位归零' : '暂不增加风险';
    if (position < previousPosition) return '降低风险暴露';
    if (position > previousPosition) return '可适度增加风险';
    return position <= 30 ? '保持低风险暴露' : '维持当前风险仓位';
}

function getIndexDecisionSummary(meta, decision) {
    const position = decision?.position ?? 0;
    const riskPositionLabel = position <= 30 ? '低风险暴露' : '风险仓位';
    const action = decision?.simpleAction || '持币观望';
    const exitLevel = decision?.exit?.level || '无明确离场';
    const scoreReady = !!decision?.signalReady || (meta?.windowScore ?? 0) >= (STRATEGY?.buyThreshold ?? Infinity);
    const hasWarning = (meta?.warningSignals || []).length > 0;
    const hasCriticalExit = [EXIT_STATE.HARD,EXIT_STATE.STRONG].includes(getDecisionExitStateCode(decision)) || hasDecisionActionFlag(decision,'hard-or-avoid');
    const hasPositionExit = hasCriticalExit || hasDecisionActionFlag(decision,'exit');
    const scoreText = `${meta?.windowScore ?? 0}/${STRATEGY?.buyThreshold ?? '-'}`;
    const previousPosition = Number(decision?.prevAdv) || 0;
    const threshold = Number(STRATEGY?.buyThreshold);
    const basePosition = Number(decision?.basePosition);
    const scoreIsEmpty = (meta?.windowScore ?? 0) <= 0;
    const scoreBelowThreshold = Number.isFinite(threshold) && (meta?.windowScore ?? 0) < threshold;
    const basePositionIsEmpty = Number.isFinite(basePosition) ? basePosition <= 0 : scoreBelowThreshold;
    const marketGate = decision?.marketGate || {};
    const directExitSignals = meta?.exitSignals || [];
    const strongExitSet = getStrongExitSignals(STRATEGY);
    const strongExitSignals = directExitSignals.filter(signal => strongExitSet.has(signal));
    const otherExitSignals = directExitSignals.filter(signal => !strongExitSet.has(signal));
    const formatExitSignal = signal => getUserSignalText(signal);
    const signalCause = getSignalCauseSummary(meta);
    const causeText = signalCause.text || '当前有效指数动能信号';
    const lifecycleTransition = getSignalLifecycleTransition(meta, decision, 'index');
    const waveRejection = decision?.waveRejectionProtection || { status: 'none', active: false };
    const isFreshEntryFailure = ['fresh_entry_failure', 'fresh_entry_downside_failure', 'fresh_entry_hard_break'].includes(waveRejection.eventType);
    const isFreshEntryRejectionFailure = waveRejection.eventType === 'fresh_entry_failure';
    const waveEvidence = getWaveEventEvidenceText(waveRejection);
    const waveExpiryHandoff = decision?.waveExpiryHandoff || { applied: false };
    const isEntry = previousPosition === 0 && position > 0;
    const isIncrease = position > previousPosition;
    const isReduce = previousPosition > 0 && position < previousPosition;
    const riskPositionToZero = previousPosition > 0 ? `风险仓位从${previousPosition}%降至 0%` : '风险仓位保持 0%';

    let stateLabel = '指数动能不足';
    if (hasCriticalExit) {
        stateLabel = '指数破位防守';
    } else if (position === 0) {
        stateLabel = meta?.inCooldown ? '指数冷静期' : (hasPositionExit ? (basePositionIsEmpty && directExitSignals.length === 0 ? '指数动能失效' : '指数风险防守') : '指数动能不足');
    } else if (position <= 30) {
        stateLabel = hasDecisionActionFlag(decision,'reduce') || hasWarning ? '弱势防守' : '低位观察';
    } else if (scoreReady && position >= 50) {
        stateLabel = hasWarning ? '指数转强但偏热' : '指数动能转强';
    } else {
        stateLabel = '指数震荡观察';
    }

    if (!hasCriticalExit && waveRejection.status === 'triggered' && isFreshEntryFailure) {
        stateLabel = position === 0 ? '指数新仓失败离场' : (isFreshEntryRejectionFailure ? '指数新仓冲高防守' : '指数新仓下跌防守');
    } else if (!hasCriticalExit && waveExpiryHandoff.applied) {
        stateLabel = '反弹接管观察';
    } else if (!hasCriticalExit && lifecycleTransition.kind === 'hard' && !isIncrease) {
        stateLabel = '指数信号硬失效';
    } else if (!hasCriticalExit && lifecycleTransition.kind === 'soft') {
        stateLabel = '指数动能转弱';
    } else if (!hasCriticalExit && lifecycleTransition.kind === 'soft-expired') {
        stateLabel = '指数动能失效';
    }

    let reason = '';
    if (!hasCriticalExit && waveRejection.status === 'triggered' && isFreshEntryFailure) {
        reason = waveRejection.eventType === 'fresh_entry_hard_break'
            ? `${waveEvidence}，指数新仓硬失效，风险仓位从${previousPosition}%降至${position}%`
            : (isFreshEntryRejectionFailure
                ? `${waveEvidence}，形成长上影并弱势收盘，判定指数新仓冲击压力失败，风险仓位从${previousPosition}%降至${position}%`
                : `${waveEvidence}，收盘虽收回但仍是贴近防守位的弱势阴线，风险仓位从${previousPosition}%降至${position}%`);
    } else if (!hasCriticalExit && position === 0 && meta?.inCooldown) {
        reason = '此前降低风险后的冷静期尚未结束，暂不恢复风险暴露';
    } else if (!hasCriticalExit && waveExpiryHandoff.applied) {
        const momentumText = (waveExpiryHandoff.momentumSignals || []).join('、') || '短线动能继续改善';
        reason = `原指数动能积分仅因窗口到期由${waveExpiryHandoff.previousWindowScore}/${threshold}降至${scoreText}，但指数仍守住原买点防守位、重新站上${waveExpiryHandoff.shortMAPeriod}日线，且${momentumText}，当前保留${position}%${riskPositionLabel}等待接管`;
    } else if (!hasCriticalExit && lifecycleTransition.text) {
        reason = lifecycleTransition.text;
    } else if (hasPositionExit && getDecisionExitStateCode(decision) === EXIT_STATE.NONE && previousPosition > 0 && basePositionIsEmpty) {
        const scoreReason = scoreIsEmpty
            ? `此前指数动能已失效，积分降为 ${scoreText}`
            : `此前指数动能已不足，积分为 ${scoreText}，低于门槛 ${threshold}/${threshold}`;
        reason = `${scoreReason}，${riskPositionToZero}，暂不增加市场风险`;
    } else if (hasPositionExit && getDecisionExitStateCode(decision) === EXIT_STATE.NONE && previousPosition > 0) {
        // 风险评分已退出交易决策；若仍有无明确离场的归零，只能归因于结构/生命周期治理。
        const governanceText = decision?.waveContext?.mainEvent || decision?.positionDriver || '结构或生命周期防守';
        reason = `${getPlainDisplayText(governanceText)}，${riskPositionToZero}`;
    } else if (hasCriticalExit && strongExitSignals.length) {
        const exitText = [...strongExitSignals, ...otherExitSignals].map(formatExitSignal).join('、');
        const triggerText = meta?.repeatedStrongExit ? '今日指数再次触发强离场' : '今日指数触发强离场';
        reason = `${triggerText}：${exitText}；此前动能依据失效，先降低风险暴露`;
    } else if (hasCriticalExit) {
        const exitReason = directExitSignals.length
            ? `指数${directExitSignals.map(formatExitSignal).join('、')}，当前按${exitLevel}处理`
            : (decision?.exit?.detail || `当前指数按${exitLevel}处理`);
        reason = `${exitReason}，${position === 0 ? riskPositionToZero : '当前优先处理市场风险'}`;
    } else if (marketGate.type === 'entry-blocked' && position === 0) {
        reason = `${causeText}使指数动能积分达到 ${scoreText}，但核心宽基数据未补齐，暂不增加市场风险暴露`;
    } else if (marketGate.type === 'increase-capped' && Number.isFinite(marketGate.cap)
        && marketGate.cap < (Number.isFinite(basePosition) ? basePosition : Math.max(previousPosition, position))
        && position === marketGate.cap) {
        reason = `${causeText}，但核心宽基偏弱，本次新增风险受到限制`;
    } else if (isReduce) {
        const reduceCause = directExitSignals.length
            ? `指数${directExitSignals.map(formatExitSignal).join('、')}，当前按${exitLevel}处理`
            : (decision?.exit?.detail || '指数短线风险升高');
        const reduceAction = position === 0 ? `当前风险仓位从${previousPosition}%降至 0%，保持低风险暴露` : `当前风险仓位从${previousPosition}%降至${position}%`;
        reason = `${reduceCause}，${reduceAction}`;
    } else if (position === 0) {
        reason = `指数动能积分当前为${meta?.windowScore ?? 0}分，需达到${STRATEGY?.buyThreshold ?? '--'}分，暂不提高风险仓位`;
    } else if (isEntry) {
        reason = `${causeText}使指数动能积分达到 ${scoreText}，支持风险仓位由0%提高至${position}%`;
    } else if (isIncrease && getSignalStateCode(meta) === SIGNAL_STATE.HOLD) {
        reason = `指数重新站回20日线，趋势抱单状态接管此前低风险观察，风险仓位由${previousPosition}%提高至${position}%`;
    } else if (isIncrease) {
        reason = `${causeText}使指数动能积分达到 ${scoreText}，支持风险仓位由${previousPosition}%提高至${position}%`;
    } else if (position <= 30) {
        reason = scoreReady
            ? `${causeText}使指数动能积分维持在 ${scoreText}，当前保持${position}%${riskPositionLabel}观察`
            : `指数动能积分为 ${scoreText}，当前保持${position}%${riskPositionLabel}观察`;
    } else {
        reason = scoreReady
            ? `${causeText}，继续支持当前风险仓位`
            : `指数动能积分为 ${scoreText}，当前维持${position}%风险仓位观察`;
    }

    const positionDetails = getStockPositionChangeDetails(meta, decision, signalCause, previousPosition, position, 'index');
    const why = getPlainDisplayText(reason)
        .replace(/买入积分/g, '指数动能积分')
        .replace(/买入信号/g, '指数动能信号');
    const indexPositionNote = waveExpiryHandoff.applied
        ? { code: 'index-expiry-handoff', text: `本次仅保留${position}%风险观察仓，不恢复到期积分或扩大风险暴露` }
        : (waveRejection.status === 'triggered' && isFreshEntryFailure
            ? { code: 'index-fresh-entry-failure',
                text: `本次按新仓防守上限执行，最终采用${position}%风险仓位，不扩大风险暴露` }
            : null);
    const positionWhy = indexPositionNote
        ? indexPositionNote.text
        : getPlainDisplayText(positionDetails.positionExplanation)
            .replace(/买入积分/g, '指数动能积分')
            .replace(/买入信号/g, '指数动能信号')
            .replace(/试探仓/g, '低风险仓位');
    const positionWhyCode = indexPositionNote ? indexPositionNote.code : 'position-path';
    const nextFocus = waveExpiryHandoff.applied
        ? `下一交易日需确认趋势仍支持当前风险仓位，或出现新的有效指数动能信号。若到期仍未满足上述条件，或跌破原买点防守位${formatPriceLevel(Number(waveExpiryHandoff.entryLow))}、出现离场信号，风险仓位降至0%。`
        : getPlainDisplayText(getIndexNextFocus(meta, decision, position, hasWarning));

    return {
        state: stateLabel,
        action: getIndexReferenceAction(position, previousPosition),
        positionText: `${position}%`,
        why,
        positionWhy,
        positionWhyCode,
        nextFocus,
        reason: why,
        positionExplanation: positionWhy,
        invalidCondition: nextFocus
    };
}

function getNoviceDecisionSummary(meta, decision, mode = 'stock') {
    const summary = mode === 'index'
        ? getIndexDecisionSummary(meta, decision)
        : getStockDecisionSummary(meta, decision);
    const hasBuyQuality = decision?.bsMark === 'B' && ['trial', 'strong'].includes(decision?.bQuality);
    const reasons = hasBuyQuality ? (decision.bQualityReasons || []).filter(Boolean).slice(0, 2) : [];
    const why = getPlainDisplayText(reasons.length ? reasons.join('；') : summary.why);
    const positionWhy = getPlainDisplayText(summary.positionWhy);
    const nextFocus = getPlainDisplayText(summary.nextFocus);
    // 所有可见分支共用同一翻译出口，波段说明和买点质量说明也不例外。
    return {
        ...summary,
        state: getPlainDisplayText(hasBuyQuality ? (decision.bQuality === 'trial' ? '试用确认买点' : '强确认买点') : summary.state),
        action: getPlainDisplayText(summary.action),
        why, positionWhy, nextFocus,
        reason: why,
        positionExplanation: positionWhy,
        invalidCondition: nextFocus
    };
}
