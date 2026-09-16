/* DailyGlance [0] - production strategy configuration. Keep classic script order. */
// Strategy parameters live here so ordinary UI changes do not imply a strategy-file change.

const APP_BUILD = '2026-09-16-01';
const SIGNAL_VERSION = 'v4.2.37';
const WAVE_GOVERNANCE_VERSION = 'wave-regime-v5';
window.__DG_BUILD__ = APP_BUILD;

const STRATEGIES = {
    '稳健趋势型': { buySignals: ['B1','B2','B3','B4','B10','B12','B13','B14','B15'], exitSignals: ['L1','L2','L3','L4','L9','L10'], warningSignals: ['W1'], scoreGroups: [['B1','B10','B13','B15'],['B2','B12'],['B4','B14']], windowDays: 12, buyThreshold: 5, watchPosition: 0, desc: '关注趋势结构、MACD动能和突破确认，适合中期趋势跟随' },
    '波段抄底型': { buySignals: ['B5','B6','B7','B8','B9','B11','B16','B17'], exitSignals: ['L3','L5','L10'], warningSignals: ['W1','L9'], scoreGroups: [['B5','B6','B11','B16'],['B7','B8'],['B17']], windowSignalGuards: { B8: { recentDays: 3, companionSignals: ['B5','B6','B9','B11','B16','B17'] } }, windowDays: 10, buyThreshold: 4, holdThreshold: 3, watchPosition: 30, softInvalidationGraceDays: 1, monotonicSignalLifecycle: true, b11StructureDefense: { lookbackDays: 20, pivotDays: 2 }, waveB6TrendAdd: { stocksOnly: true, sourcePosition: 30, targetPosition: 50, movingAveragePeriod: 20, slopeLookbackDays: 1 }, waveMA20PullbackObservation: { stocksOnly: true, position: 30, movingAveragePeriod: 20, slopeLookbackDays: 1, maximumCloseGapRatio: 0.005, minimumLowerShadowBodyRatio: 1.5, minimumLowerShadowRangeRatio: 0.35, takeoverSignals: ['B6','B11'], trendDefense: { stocksOnly: true, movingAveragePeriod: 20, longMovingAveragePeriod: 60, completeTrendSlopeLookbackDays: 5, breakoutLookbackDays: 3, maximumBreakoutPullbackGapRatio: 0.005, maximumBreakoutLowGapRatio: 0.005, maximumCloseBelowMovingAverageRatio: 0.005, maximumCloseBelowMovingAverageAtr: 0.5, maximumInvalidationGapAtr: 1, standaloneExitSignal: 'L3', blockingSignals: ['L4','L9','L10'], takeoverSignals: ['B6','B11'] } }, l10TrendHandoff: { stocksOnly: true, blockingSignals: ['L3','L4','L9'], movingAverageSlopeLookbackDays: 5, warningPositionCap: 30 }, waveExpiryHandoff: { position: 30, holdTradingDays: 1, movingAveragePeriod: 5, defensiveObservation: { stocksOnly: true, trendMovingAveragePeriod: 20, longMovingAveragePeriod: 60, trendSlopeLookbackDays: 1, establishedTrendSlopeLookbackDays: 5, requirePositiveMacdBar: true, nextDayMovingAveragePeriods: [5,20], establishedTrendMaxTradingDays: 2, maximumCloseGapRatio: 0.03, maximumCloseGapAtr: 1 } }, waveExpiryB11TakeoverAdd: { stocksOnly: true, sourcePosition: 30, targetPosition: 50, triggerSignal: 'B11', shortMovingAveragePeriod: 5, trendMovingAveragePeriod: 20, trendSlopeLookbackDays: 1 }, waveRejectionProtection: { minimumProfitRatio: 0.08, minimumVolumeRatio: 1.5, minimumUpperShadowBodyRatio: 1.5, minimumUpperShadowRangeRatio: 0.35, requireUpperShadowDominance: true, maximumCloseLocation: 0.5, pressureLookbackDays: 20, pressureToleranceRatio: 0.98, minimumLockTradingDays: 2, blockingSignals: ['W2','W3'], recoveryPositionCap: 30, recoveryHoldTradingDays: 1, positionSteps: [0,30,50,80], pullbackRecovery: { stocksOnly: true, eventTypes: ['mature_profit_rejection'], sourcePositions: [30,50], minimumEventAgeTradingDays: 2, signals: ['B6','B11'], movingAveragePeriod: 20, slopeLookbackDays: 1, requireHoldEventLow: true }, strongFreshRecovery: { eventTypes: ['fresh_entry_hard_break'], minimumScoreGroups: 2 }, entryDayPressureVeto: { stocksOnly: true, requireMediumDowntrend: true, minimumUpperShadowRangeRatio: 0.35, maximumCloseLocation: 0.35, requireUpperShadowDominance: true, pressureToleranceRatio: 0.005, pressureCloseToleranceRatio: 0, movingAveragePeriods: [20,60], movingAverageSlopeLookbackDays: 5 }, freshEntryFailure: { maximumEntryAgeTradingDays: 2, secondDayMinimumHighAdvanceRatio: 0.01, minimumIntradayProfitRatio: 0, maximumCloseProfitRatio: 0, minimumGivebackRatio: 0.60, minimumVolumeRatio: 0, minimumUpperShadowRangeRatio: 0.35, maximumCloseLocation: 0.35, pressureLookbackDays: 20, pressureToleranceRatio: 0.03, pressureCloseToleranceRatio: 0.005, movingAveragePeriods: [20,60], movingAverageSlopeLookbackDays: 5, pivotConfirmationDays: 2 }, freshEntryDownsideFailure: { maximumEntryAgeTradingDays: 2, exitOnCloseBelowEntryLow: true, maximumCloseDefenseGapRatio: 0.0015, minimumBearBodyRangeRatio: 0.5, maximumCloseLocation: 0.25, minimumVolumeRatio: 1.0 }, indexFreshEntryDownsideFailure: { maximumEntryAgeTradingDays: 2, exitOnCloseBelowEntryLow: true, maximumCloseDefenseGapRatio: 0.005, minimumBearBodyRangeRatio: 0.4, maximumCloseLocation: 0.25, minimumVolumeRatio: 0 } }, desc: '关注超卖、背离、大级别支撑和回踩企稳，适合回调末端的修复观察' },
    '突破追涨型': { buySignals: ['B3','B4','B14'], exitSignals: ['L4','L5','L6','L9'], warningSignals: ['W1','L10'], signalWeights: {'B3':1,'B4':3,'B14':4}, scoreGroups: [['B4','B14']], windowDays: 8, buyThreshold: 4, watchPosition: 0, desc: '专注放量突破和平台突破，适合强势行情里的右侧确认' },
    '综合全能型': { buySignals: ['B1','B2','B3','B4','B5','B6','B7','B9','B10','B11','B12','B14','B15','B16','B17'], exitSignals: ['L1','L2','L3','L4','L5','L6','L9','L10'], warningSignals: ['W1'], scoreGroups: [['B1','B10','B15'],['B2','B12'],['B4','B14'],['B5','B6','B11','B16'],['B7'],['B17']], windowDays: 12, buyThreshold: 6, watchPosition: 30, watchPositionSignals: ['B5','B6','B7','B9','B11','B16','B17'], desc: '全量雷达观察模式，适合看全局信号，不建议直接等同交易指令' }
};

// 双底突破确认仅作为波段个股日线的独立修复组，不扩散到其他策略。
STRATEGIES['波段抄底型'].buySignals.push('B19');
STRATEGIES['波段抄底型'].buySignals.push('B20', 'B21');
STRATEGIES['波段抄底型'].scoreGroups.push(['B19'], ['B20'], ['B21']);

// 回踩已确认支撑收复是执行类买点：并入 B5/B6/B11/B16 同组去重，不新增独立计分组，也不单独放行建仓。
STRATEGIES['波段抄底型'].buySignals.push('B22');
STRATEGIES['波段抄底型'].scoreGroups.find(group => group.includes('B6')).push('B22');
STRATEGIES['波段抄底型'].wavePositionStages = {
    stocksOnly: true,
    entryCap: 30,
    strongEntryCap: 50,
    structureEntrySignals: ['B19'],
    strongReversalSignals: ['B9'],
    minimumStrongReversalGroups: 2,
    confirmationCap: 50,
    confirmationSignals: ['B6','B11','B19'],
    trendCap: 80,
    trendContinuationSignals: ['B4','B14'],
    breakoutPullbackWait: {
        triggerSignals: ['B19'],
        takeoverSignals: ['B6','B11']
    },
    trendMovingAveragePeriod: 20,
    longMovingAveragePeriod: 60,
    trendSlopeLookbackDays: 5
};

// 波段个股日线的统一三趋势治理参数。周线通常作为支撑来源；仅双底共振试探可作为资格背景参与判断。
STRATEGIES['波段抄底型'].waveRegimePolicy = {
    stocksOnly: true,
    slopeLookbackDays: 5,
    slopeThresholds: { up: 0.005, down: -0.005, flat: 0.005 },
    confirmationDays: { up: 2, down: 2, range: 3 },
    positionCaps: { down: 30, range: 50, up: 80, transition: 30, unknown: 0 },
    box: {
        windowDays: 40,
        pivotDays: 2,
        minimumSupportTouches: 2,
        minimumPressureTouches: 2,
        clusterToleranceAtr: 0.75,
        minimumWidthAtr: 3,
        maximumWidthRatio: 0.15,
        edgeToleranceAtr: 0.75
    },
    // 首次试探只用当次信号的局部失效位检查风险距离；结构硬防守仍在生命周期内保留为二级失效线。
    entry: { minimumScore: 4, minimumDefenseDistanceRatio: 0.06, maximumDefenseAtr: 2, useLocalDefenseForDistance: true },
    // 硬防守随已确认结构上移时，必须给收盘价留出的最小缓冲；缓冲不足说明防守位已进入当日噪音带，本次不上移。
    ratchet: { minimumBufferAtr: 0.5 },
    down: { entrySignals: ['B9','B16','B20'], repairSignals: ['B7','B8','B9','B16','B17','B20'], minimumRepairGroups: 2 },
    range: { entrySignals: ['B5','B6','B7','B8','B9','B11','B16','B17','B20'], confirmationSignals: ['B5','B6','B7','B8','B9','B11','B16','B17','B20'] },
    up: { entrySignals: ['B6','B11'], confirmationSignals: ['B6','B11'], trendSignals: ['B4','B14'] }
};

// 周线双底与日线第二底共振时，只开放个股日线30%试探，不改变普通4分建仓门槛。
STRATEGIES['波段抄底型'].waveRegimePolicy.multiTimeframeBottomProbe = {
    stocksOnly: true,
    dailySignal: 'B20',
    allowedRegimes: ['down', 'range', 'transition'],
    weeklyRepair: { lookbackDays: 52, minimumGap: 4, maximumGap: 26, tolerance: 0.07, pivotDays: 1, allowNearbyRecentLow: true, recentLowTolerance: 0.03 }
};

// 回踩已确认支撑收复：把治理层已在使用的四来源支撑模型提升到信号层，只补均线覆盖不到的支撑位。
STRATEGIES['波段抄底型'].waveSupportReclaim = {
    stocksOnly: true,
    touchToleranceAtr: 0.5,
    breakToleranceAtr: 1,
    movingAverageClearanceAtr: 0.5,
    movingAveragePeriod: 20,
    pivotLookbackDays: 120,
    pivotDays: 2,
    weeklyLookbackWeeks: 52,
    weeklyPivotDays: 1
};

Object.assign(STRATEGIES['波段抄底型'].waveRejectionProtection.freshEntryFailure, {
    requireCloseBelowMovingAveragePeriod: 20,
    requireFrozenDefenseBreakForPressureFailure: true,
    ma20RejectionExit: {
        movingAveragePeriod: 20,
        longMovingAveragePeriod: 60,
        slopeLookbackDays: 5,
        minimumUpperShadowRangeRatio: 0.35,
        maximumCloseLocation: 0.50,
        requireUpperShadowDominance: true,
        holdPositionCap: 30
    }
});

// 完整观察期结束后，压力失败/下跌失败也允许用事件后的完整新信号重入；硬失效仍沿用同一门槛。
STRATEGIES['波段抄底型'].waveRejectionProtection.strongFreshRecovery.eventTypes = [
    'fresh_entry_hard_break',
    'fresh_entry_failure',
    'fresh_entry_downside_failure'
];

// 指数与个股共用“新仓冲高失败”语义，但按指数波动特征使用独立阈值。
STRATEGIES['波段抄底型'].waveRejectionProtection.indexFreshEntryFailure = {
    maximumEntryAgeTradingDays: 2,
    minimumIntradayProfitRatio: -0.01,
    maximumCloseProfitRatio: 0,
    minimumGivebackRatio: 0,
    minimumVolumeRatio: 0,
    minimumUpperShadowRangeRatio: 0.50,
    maximumCloseLocation: 0.30,
    maximumCloseDefenseGapRatio: 0.015,
    requireBearishClose: true,
    pressureLookbackDays: 20,
    pressureToleranceRatio: 0.03,
    pressureCloseToleranceRatio: 0.005,
    movingAveragePeriods: [20,60],
    movingAverageSlopeLookbackDays: 5,
    pivotConfirmationDays: 2
};

// 四个正式策略共用同一套可解释仓位档位；策略之间只区分信号入口和是否允许试探。
const POSITION_STEPS = [0, 30, 50, 80];

// Quality metadata stays in shadow until forward evidence and manual approval are complete.
const WAVE_B_QUALITY_RULESET = Object.freeze({
    id: 'wave-b-quality-20260730-02-b8-b17',
    status: 'shadow',
    sourceRuleId: 'wave-b-quality-20260730-02-b8-b17',
    frozenAsOf: '2026-07-29',
    strategy: '波段抄底型',
    rules: Object.freeze([Object.freeze({
        id: 'wave-b-quality-20260730-02-b8-b17',
        requiredSignals: Object.freeze(['B8', 'B17']),
        reasons: Object.freeze(['KDJ 金叉确认短期动量修复', '超跌止跌反弹确认修复形态'])
    })])
});

let STRATEGY = {};

const SIGNAL_SCORES = { 'B1':3,'B2':3,'B3':2,'B4':2,'B5':2,'B6':2,'B7':1,'B8':1,'B9':4,'B10':2,'B11':2,'B12':3,'B13':3,'B14':2,'B15':2,'B16':3,'B17':3,'B18':2,'B19':3,'B20':3,'B21':3,'B22':3 };
const SIGNAL_DESC = {
    'B1':{desc:'均线多头'}, 'B2':{desc:'MACD金叉'}, 'B3':{desc:'上穿20日线'}, 'B4':{desc:'放量突破新高'}, 'B5':{desc:'阳包阴'}, 'B6':{desc:'缩量回踩不破'}, 'B7':{desc:'RSI超卖回升'}, 'B8':{desc:'KDJ金叉'}, 'B9':{desc:'MACD底背离'}, 'B10':{desc:'MA20上穿MA60'}, 'B11':{desc:'均线回踩不破'}, 'B12':{desc:'零轴上金叉'}, 'B13':{desc:'长级别走强'}, 'B14':{desc:'平台放量突破'}, 'B15':{desc:'均线二次金叉'}, 'B16':{desc:'回踩周线支撑企稳'}, 'B17':{desc:'超跌止跌反弹'}, 'B18':{desc:'BOLL下轨止跌收回'}, 'B19':{desc:'双底突破确认'}, 'B20':{desc:'大级别双底第二底修复'}, 'B21':{desc:'周线双底第二底修复'}, 'B22':{desc:'回踩已确认支撑收复'},
    'L1':{desc:'跌破短期趋势'}, 'L2':{desc:'均线死叉'}, 'L3':{desc:'MACD死叉'}, 'L4':{desc:'跌破20日线'}, 'L5':{desc:'阴包阳'}, 'L6':{desc:'连阳后首阴'}, 'L7':{desc:'RSI超买回落'}, 'L8':{desc:'布林上轨受阻'}, 'L9':{desc:'高点回撤破位'}, 'L10':{desc:'MACD顶背离'}, 'W1':{desc:'偏离均线过大'}, 'W2':{desc:'连阳缩量迹象'}, 'W3':{desc:'放量滞涨'}, 'W4':{desc:'缩量上涨背离'}
};
