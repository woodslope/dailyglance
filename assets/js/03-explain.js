// [3B] 决策解释与展示文案 (Decision Explain & Display Text)

function getWatchPositionForStrategy(strategy, meta) {
    const watchPosition = Number(strategy?.watchPosition || 0);
    if (watchPosition <= 0) return 0;
    const allowedSignals = strategy?.watchPositionSignals;
    if (!Array.isArray(allowedSignals) || allowedSignals.length === 0) return watchPosition;
    const hasAllowedSignal = (meta?.windowSignals || []).some(item => allowedSignals.includes(item.signal));
    return hasAllowedSignal ? watchPosition : 0;
}

function getReadyPositionForStrategy(strategy, meta, fallback) {
    const map = strategy?.signalPositions;
    if (map && typeof map === 'object') {
        let best = 0;
        for (const item of (meta?.windowSignals || [])) {
            if (strategy?.buySignals?.includes(item.signal) && Number.isFinite(Number(map[item.signal]))) best = Math.max(best, Number(map[item.signal]));
        }
        if (best > 0) return best;
    }
    const configured = Number(strategy?.readyPosition || 0);
    return configured > 0 ? configured : fallback;
}

function getBasePosition(idx, full, ind, meta) {
    if (meta.type === '✅ 明确转强') return quantizePosition(getReadyPositionForStrategy(STRATEGY, meta, 80));
    if (meta.type === '⚠️ 谨慎看多') return quantizePosition(Number(STRATEGY.cautiousPosition || 0) || 50);
    if (meta.type === '👀 关注异动') return quantizePosition(getWatchPositionForStrategy(STRATEGY, meta));
    if (meta.type === '📈 趋势抱单') {
        const holdPosition = Number(STRATEGY.holdPosition || 0);
        if (holdPosition > 0) return quantizePosition(holdPosition);
        return 50;
    }
    return 0;
}

function getATR(data, idx, n=14) {
    if(!data || idx < 1 || !data[idx]) return 0;
    const start = Math.max(1, idx - n + 1); let sum = 0, count = 0;
    for(let i = start; i <= idx; i++) {
        const prevClose = data[i-1]?.close || data[i].close;
        sum += Math.max(data[i].high - data[i].low, Math.abs(data[i].high - prevClose), Math.abs(data[i].low - prevClose)); count++;
    }
    return count ? sum / count : 0;
}

function ensureIndexIndicators(id) {
    const data = state.rawData[id]; 
    if (!data || data.length < 60) return null;
    const cacheKey = `daily_${data.length}_${data[data.length-1].date}`;
    if (!indexIndicators[id] || indexIndicators[id].key !== cacheKey) indexIndicators[id] = { key: cacheKey, ma20: Calcs.ma(data, 20), ma60: Calcs.ma(data, 60) };
    return indexIndicators[id];
}

function getIndexTrend(id, date) {
    const data = state.rawData[id];
    if(!data || data.length < 60) return null;
    const idx = findDateIndex(data, date, id); if(idx < 60 || !data[idx]) return null;
    const inds = ensureIndexIndicators(id); if (!inds) return null;
    const ma20Now = inds.ma20[idx], ma60Now = inds.ma60[idx], ma20Prev = inds.ma20[Math.max(0, idx - 5)] || ma20Now;
    const close = data[idx].close; let stateLabel = '震荡', score = 0;
    if(close > ma20Now && ma20Now > ma60Now && ma20Now >= ma20Prev) { stateLabel = '多头'; score = 1; } 
    else if (close < ma20Now && ma20Now < ma60Now) { stateLabel = '空头'; score = -1; }
    return { id, name: getIndexConfig(id)?.name || id, state: stateLabel, score };
}

function getMarketContext(date) {
    const trends = CORE_MARKET_INDEX_IDS.map(id => getIndexTrend(id, date)).filter(Boolean);
    if(!trends.length) return { label:'环境未知', cls:'neutral', increaseCaps:{ ordinary:0, independent:0 }, reason:'核心宽基数据不足，指数暂停增加风险', trends:[] };
    if(trends.length < CORE_MARKET_INDEX_IDS.length) return { label:'环境待确认', cls:'neutral', increaseCaps:{ ordinary:0, independent:0 }, reason:'三项核心宽基尚未补齐，指数暂停增加风险', trends };

    const bull = trends.filter(t => t.score > 0), bear = trends.filter(t => t.score < 0);

    // reason 只在大盘页的核心宽基环境卡片展示，因此统一按指数口径描述，不再提及个股。
    // 只写普通机会这一档：independent 档在全量回放里仅占偏弱 bar 的 0.09%，
    // 常驻展示会让读者以为它是常见分档。真正命中时由右侧结论面板按当天分档说明。
    let label, cls, increaseCaps = null, reason;
    if (bull.length >= 2) { label = '核心宽基偏强'; cls = 'bull'; reason = '三项核心宽基多数走强，指数新增风险不受限'; }
    else if (bear.length >= 2) {
        label = '核心宽基偏弱';
        cls = 'bear';
        increaseCaps = { ordinary:30, independent:50 };
        reason = `三项核心宽基多数空头；指数普通机会新增风险上限 ${increaseCaps.ordinary}%`;
    }
    else { label = '核心宽基分化'; cls = 'neutral'; reason = '三项核心宽基未形成多数空头，不额外限制指数新增风险'; }
    return { label, cls, increaseCaps, reason, trends };
}

function getRiskContext(idx, full, ind) {
    if (!full || !full[idx]) return { score: 100, level: '未知', coef: 1, flags: [], atrPct: 0, distMA20: 0, drawdown: 0, support: 0, pressure: 0, watch: 0, stop: 0, ma60: null };
    const item = full[idx], close = item.close, atr = getATR(full, idx), atrPct = close ? atr / close : 0;
    const ma20 = ind.ma?.[20]?.[idx], ma60 = ind.ma?.[60]?.[idx], recent = full.slice(Math.max(0, idx - 19), idx + 1);
    const high20 = recent.length ? Math.max(...recent.map(d => d.high)) : close, low20 = recent.length ? Math.min(...recent.map(d => d.low)) : close;
    const drawdown = high20 ? (high20 - close) / high20 : 0, distMA20 = ma20 ? (close - ma20) / ma20 : 0;
    
    let score = 100; const flags = [];
    if(atrPct > 0.06) { score -= 25; flags.push('波动过高'); } else if(atrPct > 0.04) { score -= 15; flags.push('波动偏高'); } else if(atrPct > 0.025) score -= 8;
    if(distMA20 > 0.12) { score -= 20; flags.push('偏离MA20过远'); } else if(distMA20 > 0.08) { score -= 10; flags.push('短线偏热'); }
    if(distMA20 < -0.05) { score -= 18; flags.push('跌破MA20较深'); }
    if(drawdown > 0.12) { score -= 20; flags.push('回撤较深'); } else if(drawdown > 0.07) score -= 10;
    
    const level = score >= 80 ? '低波动/偏离' : score >= 60 ? '中等波动/偏离' : score >= 40 ? '高偏离风险' : '极端波动风险';
    const coef = score >= 80 ? 1 : score >= 60 ? 0.75 : score >= 40 ? 0.5 : 0.25;
    return { score: Math.max(0, Math.round(score)), level, coef, flags, atrPct, distMA20, drawdown, support: low20, pressure: high20, watch: ma20 || close, stop: Math.min(Math.max(low20, close - atr * 2), close), ma60: ma60 || null };
}

function getRiskAdjustmentDetails(risk = {}) {
    const flags = Array.isArray(risk.flags) ? risk.flags : [];
    const details = [];
    const drawdown = Number(risk.drawdown);
    const atrPct = Number(risk.atrPct);
    const distMA20 = Number(risk.distMA20);
    const hasHeatFlag = flags.includes('短线偏热') || flags.includes('偏离MA20过远');
    if (hasHeatFlag && Number.isFinite(distMA20)) details.push(`收盘价高于MA20 ${(distMA20 * 100).toFixed(1)}%`);
    if (flags.includes('跌破MA20较深') && Number.isFinite(distMA20)) details.push(`收盘价低于MA20 ${(Math.abs(distMA20) * 100).toFixed(1)}%`);
    if ((flags.includes('回撤较深') || drawdown > 0.07) && Number.isFinite(drawdown)) details.push(`近20日高点回撤 ${(drawdown * 100).toFixed(1)}%`);
    if ((flags.includes('波动偏高') || flags.includes('波动过高') || atrPct > 0.025) && Number.isFinite(atrPct)) details.push(`14日波动 ${(atrPct * 100).toFixed(1)}%`);
    flags.forEach(flag => {
        if (!['短线偏热', '偏离MA20过远', '跌破MA20较深', '回撤较深', '波动偏高', '波动过高'].includes(flag)) details.push(flag);
    });
    if (hasHeatFlag && !Number.isFinite(distMA20)) details.push(flags.includes('偏离MA20过远') ? '偏离MA20过远' : '短线偏热');
    if (flags.includes('跌破MA20较深') && !Number.isFinite(distMA20)) details.push('跌破MA20较深');
    if (flags.includes('回撤较深') && !Number.isFinite(drawdown)) details.push('回撤较深');
    if ((flags.includes('波动偏高') || flags.includes('波动过高')) && !Number.isFinite(atrPct)) details.push(flags.includes('波动过高') ? '波动过高' : '波动偏高');
    return details;
}

function hasShortTermHeatRisk(meta, risk) {
    const flags = risk?.flags || [];
    return flags.includes('短线偏热')
        || flags.includes('偏离MA20过远')
        || (meta?.warningSignals || []).includes('W1');
}

function getExitSeverity(meta, idx, full, ind) {
    const exits = meta.exitSignals || [], raw = Object.keys(meta.allSignals || {});
    if (meta.type && meta.type.includes('清仓规避')) return { level: '清仓防守', detail: '触发高危清仓信号' };
    const strongExitSet = getStrongExitSignals(STRATEGY);
    const strongExitSignals = exits.filter(s => strongExitSet.has(s));
    if (strongExitSignals.length) return { level: '强离场', detail: `触发核心破位防守：${strongExitSignals.map(s => getUserSignalText(s)).join('+')}` };
    // L7/L8 从不出现在任何策略的 exitSignals 配置里，此处只列可达的普通离场信号。
    if (exits.some(s => ['L1', 'L2', 'L3', 'L5', 'L6'].includes(s)) || (meta.warningSignals || []).length) return { level: '减仓观察', detail: '短线动能转弱或过热，适合降低仓位等待结构确认' };
    if (meta.windowSignals) {
        const recentExits = meta.windowSignals.filter(w => w.signal.startsWith('L') && (idx - w.day) >= 1 && (idx - w.day) <= 2);
        if (recentExits.length > 0 && ind.ma?.[5] && full[idx] && full[idx].close < ind.ma[5][idx]) return { level: '延续防守', detail: '近期高位释放过防守信号，尚未重获短期均线支撑' };
    }
    return { level: '无明确离场', detail: '暂未看到需要立即防守的核心离场信号' };
}

function getExitSignalEvidence(meta, decision) {
    const direct = meta.exitSignals || [];
    const windowExits = (meta.windowSignals || []).filter(w => w.signal.startsWith('L')).slice(-4).map(w => w.signal);
    const logicMap = {
        L1: '跌破短期趋势线',
        L2: '短中期均线死叉',
        L3: 'MACD 死叉',
        L4: '跌破 20 日线',
        L5: '阴包阳',
        L6: '连阳后首阴',
        L7: 'RSI 超买回落',
        L8: '布林上轨受阻',
        L9: '高点回撤破位',
        L10: 'MACD 顶背离'
    };
    const directDesc = direct.length ? direct.map(s => `${s} ${logicMap[s] || getUserSignalText(s)}`).join(' / ') : '无直接离场信号';
    const windowDesc = windowExits.length ? windowExits.map(s => `${s} ${logicMap[s] || getUserSignalText(s)}`).join(' / ') : '近窗内无额外离场形态';
    const exitText = decision?.exit?.detail || '暂无明确离场依据';
    return { direct, window: windowExits, directDesc, windowDesc, exitText };
}

function getPositionDriverText(meta, market, risk, exit, base, position, prevPos, positionCap = null, marketGate = null, riskCapOverride = null) {
    if (exit.level === '清仓防守' || exit.level === '强离场') {
        return `触发${exit.level}，${meta.exitSignals?.length ? `技术离场 ${meta.exitSignals.join(' / ')}` : '按防守规则直接处理'}。`;
    }
    if (meta.inCooldown) {
        return `${getCooldownProgress(meta).label}，先观察再说。`;
    }
    if (base <= 0) {
        return '基础仓位为 0%，当前不满足开仓条件。';
    }

    const pieces = [`基础 ${base}%`];
    if (positionCap?.reason) pieces.push(positionCap.reason);
    if (marketGate?.detail) pieces.push(marketGate.detail);
    pieces.push(position === prevPos ? `维持 ${position}%` : `调整至 ${position}%`);
    if (position === 0 && prevPos > 0) pieces.push(`较前次收至 0%`);
    return pieces.join('，') + '。';
}

function getDecisionPricePrecision() {
    if (typeof getSecurityPricePrecision !== 'function') return 2;
    const active = state.mode === 'stock' ? (state.stockId || state.id) : state.id;
    return getSecurityPricePrecision(active);
}

function formatPriceLevel(value) {
    return Number.isFinite(value) ? Number(value).toFixed(getDecisionPricePrecision()) : '--';
}

function formatRatioPercent(value, digits = 1) {
    const number = Number(value);
    return Number.isFinite(number) ? `${(Math.abs(number) * 100).toFixed(digits)}%` : '--';
}

function getWavePressureSourceText(waveRejection) {
    const sources = Array.isArray(waveRejection?.pressureSources) ? waveRejection.pressureSources : [];
    const texts = [];
    const invalidationGroups = new Map();
    for (const source of sources) {
        const level = Number(source?.level);
        if (!Number.isFinite(level)) continue;
        if (source?.type === 'signal_invalidation') {
            const key = level.toFixed(4);
            if (!invalidationGroups.has(key)) invalidationGroups.set(key, { level, signals: [] });
            if (source.signal) invalidationGroups.get(key).signals.push(getUserSignalText(source.signal));
            continue;
        }
        if (source?.type === 'ma' && Number.isFinite(Number(source.period))) {
            texts.push(`MA${Number(source.period)} ${formatPriceLevel(level)}`);
        } else if (source?.type === 'pivot') {
            texts.push(`${source.date ? `${source.date}的` : '近期'}结构高点${formatPriceLevel(level)}`);
        } else if (source?.type === 'signal_low') {
            texts.push(`${source.date ? `${source.date}的` : ''}买入日低点${formatPriceLevel(level)}`);
        } else if (source?.type === 'recent_high') {
            texts.push(`近期高点${formatPriceLevel(level)}`);
        }
    }
    for (const group of invalidationGroups.values()) {
        const names = [...new Set(group.signals)].slice(0, 2);
        const nameText = names.length ? `${names.join('、')}${group.signals.length > names.length ? '等' : ''}` : '买入信号';
        texts.push(`${nameText}失效位${formatPriceLevel(group.level)}`);
    }
    return [...new Set(texts)].slice(0, 2).join('、') || '对应压力位';
}

function getWaveEventEvidenceText(waveRejection) {
    const eventDate = waveRejection?.triggerDate || '当日';
    const entryDate = waveRejection?.entryDate || '';
    const entryCloseLabel = entryDate ? `${entryDate}买入收盘` : '买入日收盘';
    const entryLowLabel = entryDate ? `${entryDate}买入日最低价` : '买入日最低价';
    const highText = formatPriceLevel(Number(waveRejection?.triggerHigh));
    const lowText = formatPriceLevel(Number(waveRejection?.triggerLow));
    const closeText = formatPriceLevel(Number(waveRejection?.triggerClose));
    const entryCloseText = formatPriceLevel(Number(waveRejection?.entryClose));
    const entryLowText = formatPriceLevel(Number(waveRejection?.entrySignalLow));
    const pressureText = getWavePressureSourceText(waveRejection);
    const upperShadowText = formatRatioPercent(waveRejection?.upperShadowRangeRatio);
    const entryChange = Number(waveRejection?.profitRatio);
    const entryChangeText = Number.isFinite(entryChange)
        ? `较${entryCloseLabel}${entryCloseText}${entryChange >= 0 ? '上涨' : '下跌'}${formatRatioPercent(entryChange)}`
        : '';
    if (waveRejection?.status === 'entry_blocked' || waveRejection?.eventType === 'entry_day_pressure_rejection') {
        return `${eventDate}高点${highText}触及${pressureText}，收盘${closeText}仍在压力位下方，上影占全天振幅${upperShadowText}`;
    }
    if (['fresh_entry_failure', 'fresh_entry_ma20_hold'].includes(waveRejection?.eventType)) {
        const closeAtLowText = Number(waveRejection?.triggerClose) <= Number(waveRejection?.triggerLow) ? '并收在全天最低' : `，全天最低${lowText}`;
        const secondDayAttackText = Number(waveRejection?.entryAge) === 2
            ? (waveRejection?.pressureAttackType === 'new_source'
                ? '，第二个交易日首次进入新的压力区'
                : `，第二个交易日高点较前一日继续提高${formatRatioPercent(waveRejection?.secondDayHighAdvanceRatio)}`)
            : '';
        return `${eventDate}高点${highText}触及${pressureText}${secondDayAttackText}，随后回落至${closeText}${closeAtLowText}；${entryChangeText}，上影占全天振幅${upperShadowText}`;
    }
    if (waveRejection?.eventType === 'fresh_entry_hard_break') {
        return `${eventDate}收盘跌破${entryLowLabel}${entryLowText}（收盘${closeText}）${entryChangeText ? `，${entryChangeText}` : ''}`;
    }
    if (waveRejection?.eventType === 'fresh_entry_downside_failure') {
        const defenseGapText = formatRatioPercent(waveRejection?.downsideCloseGapRatio);
        const bodyText = formatRatioPercent(waveRejection?.downsideBearBodyRangeRatio);
        return `${eventDate}盘中最低${lowText}跌破${entryLowLabel}${entryLowText}，收盘${closeText}距该防守位仅${defenseGapText}，阴线实体占全天振幅${bodyText}`;
    }
    if (waveRejection?.eventType === 'signal_hard_invalidation') {
        return `${eventDate}收盘${closeText}跌破${pressureText}`;
    }
    if (waveRejection?.eventType === 'structure_hard_break') {
        return `${eventDate}收盘${closeText}跌破冻结硬防守位${formatPriceLevel(Number(waveRejection?.hardDefense))}`;
    }
    const highPullback = Number(waveRejection?.triggerHigh) > 0
        ? Number(waveRejection.triggerClose) / Number(waveRejection.triggerHigh) - 1
        : NaN;
    const volumeText = Number.isFinite(Number(waveRejection?.volumeRatio))
        ? `，成交量为近5日均量${Number(waveRejection.volumeRatio).toFixed(1)}倍`
        : '';
    return `${eventDate}高点${highText}触及${pressureText}后回落至${closeText}，从日内高点回撤${formatRatioPercent(highPullback)}，上影占全天振幅${upperShadowText}${volumeText}`;
}

function getEffectiveWindowBuySignals(meta, strategy = STRATEGY) {
    const explicit = Array.isArray(meta?.windowScoreSignals) ? meta.windowScoreSignals : [];
    if (explicit.length) {
        return explicit
            .filter(item => item?.signal?.startsWith('B'))
            .map(item => ({ ...item, score: Number(item.score) || getSignalScore(item.signal, strategy) }))
            .sort((a, b) => (b.score - a.score) || ((a.dayOffset ?? Infinity) - (b.dayOffset ?? Infinity)));
    }

    const groupBest = new Map();
    for (const item of (meta?.windowSignals || [])) {
        const signal = item?.signal;
        if (!signal?.startsWith('B') || !strategy?.buySignals?.includes(signal)) continue;
        const score = getSignalScore(signal, strategy);
        const groupKey = getScoreGroupKey(strategy, signal);
        const existing = groupBest.get(groupKey);
        if (!existing || score > existing.score) groupBest.set(groupKey, { ...item, score, groupKey, dayOffset: item.dayOffset });
    }
    if (!groupBest.size) {
        for (const signal of (meta?.buySignals || [])) {
            const score = getSignalScore(signal, strategy);
            const groupKey = getScoreGroupKey(strategy, signal);
            const existing = groupBest.get(groupKey);
            if (!existing || score > existing.score) groupBest.set(groupKey, { signal, score, groupKey, dayOffset: 0 });
        }
    }
    return Array.from(groupBest.values()).sort((a, b) => (b.score - a.score) || ((a.dayOffset ?? Infinity) - (b.dayOffset ?? Infinity)));
}

function getSignalCauseSummary(meta, maxSignals = 2) {
    const items = getEffectiveWindowBuySignals(meta);
    const selected = items.slice(0, Math.max(1, maxSignals));
    const names = selected.map(item => getUserSignalText(item.signal));
    if (!names.length) return { items, selected, names, timing: '', text: '' };
    const currentDay = Number(meta?.currentDay);
    const todayNames = [];
    const historical = new Map();
    selected.forEach((item, index) => {
        const isToday = Number(item?.dayOffset) === 0 || (Number.isFinite(currentDay) && Number(item?.day) === currentDay);
        if (isToday) {
            todayNames.push(names[index]);
            return;
        }
        const date = item?.signalDate || (item?.dayDate || '此前');
        if (!historical.has(date)) historical.set(date, []);
        historical.get(date).push(names[index]);
    });
    const parts = [];
    if (todayNames.length) parts.push(`今日出现${todayNames.join('、')}`);
    historical.forEach((signalNames, date) => {
        parts.push(`${date}出现${signalNames.join('、')}，目前仍有效`);
    });
    const timing = todayNames.length && historical.size ? '今日与历史窗口' : (todayNames.length ? '今日' : '历史窗口');
    const extraText = items.length > selected.length ? '；另有其他有效信号' : '';
    return { items, selected, names, timing, text: `${parts.join('；')}${extraText}` };
}

function getPlainPositionLimitText(reason = '') {
    return String(reason || '')
        .replace(/W4缩量上涨背离/g, '上涨动能减弱')
        .replace(/W\d+/g, '')
        .replace(/个股处于中期下降趋势/g, '个股中期趋势偏弱')
        .replace(/个股尚未形成完整多头结构/g, '个股多头结构还未确认')
        .replace(/个股趋势数据不足/g, '个股趋势数据不足')
        .replace(/高仓位上限/g, '仓位上限')
        .replace(/^[，、；\s]+|[，、；\s]+$/g, '')
        .replace(/[，、；]\s*[，、；]/g, '，')
        .replace(/；+/g, '；')
        .trim();
}

function getPlainDisplayText(text = '') {
    return String(text || '')
        .replace(/B11/g, '局部回踩信号')
        .replace(/\b[BLW]\d+\b/g, '')
        .replace(/近窗/g, '最近几个交易日')
        .replace(/核心宽基偏弱下/g, '核心宽基偏弱时')
        .replace(/增仓门禁/g, '市场新增风险限制')
        .replace(/风险系数/g, '风险评估')
        .replace(/风险评分进入极端风险档/g, '当前风险已进入极端风险档')
        .replace(/风险评分/g, '风险状况')
        .replace(/\s+([，。；：])/g, '$1')
        .replace(/([，。；：])\s+/g, '$1')
        .replace(/[，、；]\s*[，、；]/g, '，')
        .replace(/出现\s+/g, '出现')
        .replace(/；+/g, '；')
        .replace(/：\s*，/g, '：')
        .trim();
}

// 只在风险评估真正压低仓位时才输出一句解释；没有压低时返回空串，由调用方跳过，
// 避免在“为什么是 X%”里出现一条并未生效的风险限制描述。
function getPlainRiskAdjustmentText(risk = {}, basePosition, riskCoef, adjustedPosition, positionLabel = '基础仓位', riskCapOverride = null) {
    const base = Number(basePosition);
    const cap = Number.isFinite(riskCapOverride) ? riskCapOverride : getRiskPositionCap(risk);
    const details = getRiskAdjustmentDetails(risk);
    if (!Number.isFinite(base) || base <= cap) return '';
    const reasonText = details.length ? details.join('、') : '当前风险偏高';
    return cap > 0
        ? `因${reasonText}，${positionLabel}最高按${cap}%档执行`
        : `因${reasonText}，${positionLabel}归零防守`;
}

function getRiskCoefficientText(risk = {}) {
    const cap = getRiskPositionCap(risk);
    const score = Number(risk.score);
    const details = getRiskAdjustmentDetails(risk);
    const evidence = [...details];
    if (Number.isFinite(score)) evidence.push(`风险评分 ${score}/100`);
    if (!evidence.length && risk.level && risk.level !== '未知') evidence.push(risk.level);
    return `风险最高允许${cap}%${evidence.length ? `（${evidence.join('、')}）` : ''}`;
}

function getStockPositionChangeDetails(meta, decision, signalCause, previousPosition, position, mode = 'stock') {
    const isIndex = mode === 'index';
    const scoreName = isIndex ? '指数动能积分' : '买入积分';
    const signalName = isIndex ? '指数动能信号' : '买入信号';
    const basePositionLabel = isIndex ? '基础风险仓位' : '基础仓位';
    const currentPositionLabel = isIndex ? '风险仓位' : '仓位';
    const scoreText = `${meta?.windowScore ?? 0}/${STRATEGY?.buyThreshold ?? '-'}`;
    const causeText = signalCause?.text || `当前有效${signalName}`;
    const basePosition = Number(decision?.basePosition);
    const exitLevel = decision?.exit?.level || '无明确离场';
    const directExitSignals = meta?.exitSignals || [];
    const warningSignals = meta?.warningSignals || [];
    const exitNames = directExitSignals.map(getUserSignalText);
    const warningNames = warningSignals.map(getUserSignalText);
    const isEntry = previousPosition === 0 && position > 0;
    const isIncrease = position > previousPosition;
    const isReduce = previousPosition > 0 && position > 0 && position < previousPosition;
    const isExit = previousPosition > 0 && position === 0;
    const waveStructureExit = !isIndex
        && isExit
        && /收盘跌破冻结硬防守位/.test(String(decision?.waveContext?.mainEvent || ''));
    const path = [];
    let hasLimiter = false;

    if (Number.isFinite(basePosition)) {
        if (basePosition <= 0) {
            path.push(isIndex ? '当前指数动能不足，基础风险仓位为0%' : '当前没有满足开仓条件，基础仓位为0%');
        } else {
            path.push(`${basePositionLabel}为${basePosition}%（信号计算结果）`);
        }
    } else if (signalCause?.text) {
        path.push(`${basePositionLabel}由${signalCause.text}计算`);
    } else if (position > 0) {
        path.push(`当前没有新增${signalName}，${basePositionLabel}沿用现有持仓判断`);
    } else {
        path.push(isIndex ? '当前指数动能不足，基础风险仓位按0%处理' : '当前没有有效买入信号，基础仓位按0%处理');
    }

    if (waveStructureExit) path.push(decision.waveContext.mainEvent);

    const marketGate = decision?.marketGate || {};
    const isCriticalExit = ['清仓防守', '强离场'].includes(exitLevel)
        || ['清仓离场', '规避风险'].includes(decision?.simpleAction);
    if (isCriticalExit) {
        hasLimiter = true;
        const triggerText = exitNames.length ? `出现${exitNames.join('、')}` : getPlainDisplayText(decision?.exit?.detail || exitLevel);
        path.push(`${triggerText}，强离场规则要求${currentPositionLabel}归零`);
    } else if (meta?.inCooldown) {
        hasLimiter = true;
        path.push(`${getCooldownProgress(meta).label}，冷静期要求${currentPositionLabel}保持0%`);
    } else {
        const b11Defense = decision?.b11StructureDefense;
        if (!isIndex && state.mode === 'stock' && state.strategy === '波段抄底型' && b11Defense?.localBreak) {
            hasLimiter = true;
            path.push('局部回踩失守但结构位未破，暂停加仓，保留当前试探仓');
        }
        if (decision?.softSignalGrace?.applied) {
            hasLimiter = true;
            path.push(`短线动能转弱但仍在观察期，先保留当前${currentPositionLabel}观察${decision.softSignalGrace.days}个交易日`);
        }
        const isDefensiveCap = ['减仓观察', '延续防守'].includes(exitLevel);
        if (isDefensiveCap) {
            hasLimiter = true;
            const triggerText = exitNames.length
                ? `出现${exitNames.join('、')}`
                : (warningNames.length ? `出现${warningNames.join('、')}预警` : getPlainDisplayText(decision?.exit?.detail || exitLevel));
            path.push(`${triggerText}，${currentPositionLabel}防守上限为30%`);
        } else if (warningNames.length) {
            hasLimiter = true;
            path.push(`出现${warningNames.join('、')}预警，仓位最高按30%档执行`);
        }
        if (!isIndex && decision?.positionCap?.reason) {
            hasLimiter = true;
            path.push(getPlainPositionLimitText(decision.positionCap.reason));
        }
    }

    // 核心宽基只对指数路径形成新增风险上限，个股不再受它约束。
    if (isIndex && marketGate.type === 'increase-capped') {
        hasLimiter = true;
        const tierText = marketGate.strengthTier === 'independent' ? '指数自身独立走强' : '普通机会';
        path.push(`核心宽基偏弱时，${tierText}新增风险上限为${marketGate.cap}%，已有${currentPositionLabel}不因市场偏弱被动降低`);
    }
    // 没有任何限制生效时，只说明这次提高由什么驱动；不再罗列并未发生的风险下调或市场截断，
    // 否则读者会以为存在一条正在作用的限制。
    if (isIncrease && !hasLimiter) {
        path.push(isIndex ? '本次提高风险仓位由指数自身动能与趋势决定' : '本次提高仓位由个股信号与趋势决定');
    }
    if (position === previousPosition && position > 0) {
        const sourceText = signalCause?.text || `此前形成的有效${signalName}`;
        const higherTierText = !hasLimiter ? `，但尚未满足进入更高${currentPositionLabel}档位的条件` : '';
        // 历史信号文案已自带“目前仍有效”，此处只接“支持当前仓位”，避免出现两个“仍”。
        const holdText = /目前仍有效$/.test(sourceText) ? sourceText.replace(/有效$/, '') : `${sourceText}仍`;
        path.push(`${holdText}支持当前${currentPositionLabel}${higherTierText}`);
    } else if (position === previousPosition && position === 0) {
        path.push(isIndex ? '当前没有提高市场风险的依据，继续保持低风险' : '当前没有有效开仓依据，继续保持空仓');
    }
    const finalChangeText = isIndex
        ? (previousPosition === 0
            ? (position === 0 ? '最终风险仓位保持0%' : `最终风险仓位由0%提高至${position}%`)
            : (position === previousPosition ? `最终风险仓位维持${position}%`
                : `最终风险仓位由${previousPosition}%${position > previousPosition ? '提高至' : '降至'}${position}%`))
        : (previousPosition === 0
            ? (position === 0 ? '最终保持0%空仓' : `最终由空仓转为${position}%`)
            : (position === previousPosition ? `最终维持${position}%`
                : `最终由${previousPosition}%${position > previousPosition ? '提高至' : '降至'}${position}%`));
    path.push(`因此${finalChangeText}`);

    let reason = '';
    if (isEntry) {
        reason = `${causeText}使${scoreName}达到 ${scoreText}，满足首次建仓条件`;
    } else if (isIncrease) {
        reason = `${causeText}使${scoreName}达到 ${scoreText}，满足继续增加仓位条件`;
    } else if (isReduce) {
        const drivers = [];
        if (exitNames.length) drivers.push(`出现${exitNames.join('、')}`);
        if (warningNames.length) drivers.push(`出现${warningNames.join('、')}预警`);
        if (!exitNames.length && !warningNames.length && ['减仓观察', '延续防守'].includes(exitLevel) && decision?.exit?.detail) drivers.push(decision.exit.detail);
        if (Number.isFinite(basePosition) && basePosition < previousPosition) drivers.push(`买入积分为${scoreText}，所以信号给出的基础仓位从${previousPosition}%降至${basePosition}%`);
        if (decision?.positionCap?.reason) drivers.push(getPlainPositionLimitText(decision.positionCap.reason));
        reason = `${drivers.length ? [...new Set(drivers)].slice(0, 3).join('；') : `当前信号对应基础仓位为${Number.isFinite(basePosition) ? `${basePosition}%` : `${position}%`}`}`;
    } else if (isExit) {
        const triggerText = exitNames.length
            ? `出现${exitNames.join('、')}`
            : (waveStructureExit
                ? decision.waveContext.mainEvent
                : (basePosition <= 0 ? `买入积分降至 ${scoreText}，原持仓依据失效` : getPlainDisplayText(decision?.exit?.detail || '离场条件成立')));
        reason = triggerText;
    }

    return {
        reason,
        positionExplanation: path.join('；')
    };
}

function getWaveBQualityMetadata(meta, decision, ruleset = WAVE_B_QUALITY_RULESET) {
    if (state.strategy !== '波段抄底型' || state.mode !== 'stock' || decision?.bsMark !== 'B') return null;
    const qualityStatus = ruleset?.status;
    if (!['trial', 'approved'].includes(qualityStatus)) return { bQuality: 'standard', bQualityReasons: [], bQualityRuleId: null };
    const signals = new Set((meta?.windowScoreSignals || []).map(item => item?.signal).filter(Boolean));
    const rule = (ruleset?.rules || []).find(item =>
        (item.requiredSignals || []).every(signal => signals.has(signal))
    );
    if (!rule) return { bQuality: 'standard', bQualityReasons: [], bQualityRuleId: null };
    return {
        bQuality: qualityStatus === 'trial' ? 'trial' : 'strong',
        bQualityReasons: (rule.reasons || []).slice(0, 2),
        bQualityRuleId: rule.id
    };
}

function getTodaySignalInvalidations(meta, reason = '') {
    const currentDay = Number(meta?.currentDay);
    const items = reason === 'local-price-break'
        ? meta?.localBreakWindowSignals || []
        : meta?.invalidatedWindowSignals || [];
    return items.filter(item => {
        if (Number(item?.invalidationDay) !== currentDay) return false;
        return !reason || item?.reason === reason;
    });
}

function getSignalLifecycleTransition(meta, decision, mode = 'stock') {
    const hard = getTodaySignalInvalidations(meta, 'price-break');
    const local = getTodaySignalInvalidations(meta, 'local-price-break');
    const soft = getTodaySignalInvalidations(meta, 'kdj-dead-cross');
    const threshold = Number(STRATEGY?.buyThreshold) || 0;
    const currentScore = Number(meta?.windowScore) || 0;
    const previousScore = Number(decision?.previousWindowScore);
    const fallbackPreviousScore = currentScore + [...hard, ...soft].reduce((sum, item) => sum + (Number(item?.score) || 0), 0);
    const fromScore = Number.isFinite(previousScore) ? previousScore : fallbackPreviousScore;
    const scoreName = mode === 'index' ? '指数动能积分' : '买入积分';
    const scoreDelta = fromScore > currentScore
        ? `${scoreName}由${fromScore}/${threshold}降至${currentScore}/${threshold}`
        : `${scoreName}当前为${currentScore}/${threshold}`;
    const position = Number(decision?.position) || 0;
    const previousPosition = Number(decision?.prevAdv) || 0;
    const currentClose = Number(meta?.currentClose);
    const frozenHardDefense = Number(decision?.waveContext?.frozenHardDefense);
    const frozenDefenseLabel = decision?.waveContext?.supportSource === 'signal-low'
        ? '底部防守位'
        : '底部结构支撑';
    const signalBreakKeepsStructure = mode === 'stock'
        && position > 0
        && Number.isFinite(currentClose)
        && Number.isFinite(frozenHardDefense)
        && currentClose >= frozenHardDefense;

    if (hard.length) {
        const levels = [...new Set(hard.map(item => {
            const level = Number(item?.invalidationLevel);
            if (!Number.isFinite(level)) return '';
            if (item?.defenseType === 'structure') {
                const dateText = item?.structureDate ? `（${item.structureDate}确认）` : '';
                return `结构防守位${level.toFixed(2)}${dateText}`;
            }
            return `信号防守位${level.toFixed(2)}`;
        }).filter(Boolean))];
        const levelText = levels.length === 1 ? levels[0] : `相关${levels.join('/')}`;
        const closeText = Number.isFinite(Number(meta?.currentClose)) ? Number(meta.currentClose).toFixed(2) : '--';
        const signalText = hard.map(item => `${getUserSignalText(item.signal)}(+${Number(item.score) || 0})`).join('、');
        if (signalBreakKeepsStructure) {
            return {
                kind: 'local',
                text: `今日收盘${closeText}跌破${levelText}，${signalText}失效，但${frozenDefenseLabel}${formatPriceLevel(frozenHardDefense)}未破；${scoreDelta}，保留${position}%试探仓观察，不生成S`
            };
        }
        let actionText;
        if (mode === 'index') {
            if (position === 0) actionText = previousPosition > 0 ? `风险仓位从${previousPosition}%降至0%` : '当前保持低风险暴露';
            else if (previousPosition === 0) actionText = `风险仓位由0%提高至${position}%`;
            else if (position < previousPosition) actionText = `风险仓位从${previousPosition}%降至${position}%`;
            else if (position > previousPosition) actionText = `风险仓位从${previousPosition}%提高至${position}%`;
            else actionText = `当前维持${position}%风险仓位`;
        } else {
            if (position === 0) {
                actionText = previousPosition > 0
                    ? (previousPosition <= 30 ? `退出${previousPosition}%试探仓，当前空仓观察` : `仓位从${previousPosition}%降至0%`)
                    : '当前保持空仓观察';
            } else if (previousPosition === 0) actionText = `本次由空仓转为${position}%轻仓试探`;
            else if (position < previousPosition) actionText = `当前从${previousPosition}%降至${position}%防守`;
            else if (position > previousPosition) actionText = `当前从${previousPosition}%提高至${position}%`;
            else actionText = `当前维持${position}%${position <= 30 ? '轻仓' : '仓位'}观察`;
        }
        return {
            kind: 'hard',
            text: `今日收盘${closeText}跌破${levelText}，${signalText}失效，${scoreDelta}；${actionText}`
        };
    }

    if (local.length) {
        const item = local[0];
        const localLevel = Number(item?.invalidationLevel);
        const structureLevel = Number(item?.structureLevel);
        const localText = Number.isFinite(localLevel) ? localLevel.toFixed(2) : '局部防守位';
        const structureText = Number.isFinite(structureLevel)
            ? `结构防守位${formatPriceLevel(structureLevel)}${item?.structureDate ? `（${item.structureDate}确认）` : ''}`
            : '结构防守位';
        const closeText = Number.isFinite(Number(meta?.currentClose)) ? Number(meta.currentClose).toFixed(2) : '--';
        const actionText = position > 0
            ? `暂停加仓，当前维持${position}%${position <= 30 ? '试探仓' : '仓位'}观察`
            : '当前不再按该局部信号新增仓位';
        return {
            kind: 'local',
            text: `今日收盘${closeText}跌破${getUserSignalText(item.signal)}局部防守位${localText}，但仍在${structureText}上方；${actionText}`
        };
    }

    if (soft.length) {
        const lostScore = soft.reduce((sum, item) => sum + (Number(item?.score) || 0), 0);
        let actionText = mode === 'index' ? `当前保持${position}%低风险暴露观察` : `当前保持${position}%试探仓观察`;
        if (decision?.softSignalGrace?.applied) {
            actionText = mode === 'index'
                ? `价格尚未跌破信号防守位，${position}%低风险暴露保留${decision.softSignalGrace.days}个交易日观察`
                : `价格尚未跌破信号防守位，${position}%试探仓保留${decision.softSignalGrace.days}个交易日观察`;
        }
        return {
            kind: 'soft',
            text: `KDJ金叉已转为死叉，${lostScore}分失效，${scoreDelta}；${actionText}`
        };
    }

    if (decision?.previousSoftSignalGrace && previousPosition > 0 && position === 0) {
        return {
            kind: 'soft-expired',
            text: `KDJ金叉失效后的1日观察期结束，${scoreName}仍为${currentScore}/${threshold}，${mode === 'index' ? `风险仓位从${previousPosition}%降至0%` : `退出${previousPosition}%试探仓，当前空仓观察`}`
        };
    }
    return { kind: '', text: '' };
}

function getStockInvalidCondition(meta, decision, position, hasWarning) {
    const threshold = STRATEGY?.buyThreshold ?? '-';
    const currentScore = meta?.windowScore ?? 0;
    const stopText = formatPriceLevel(decision?.risk?.stop);
    const canShowStop = stopText !== '--';
    const b11Defense = decision?.b11StructureDefense;
    const structureLevel = Number(b11Defense?.structureLevel);
    const structureDateText = b11Defense?.structureDate ? `（${b11Defense.structureDate}确认）` : '';
    const hasB11StructureDefense = Number.isFinite(structureLevel);
    const waveEntryBlocked = position === 0
        && Number(currentScore) >= Number(threshold)
        && decision?.waveContext?.inScope
        && decision.waveContext.mainEvent;
    const waveStructureExit = position === 0
        && Number(decision?.prevAdv) > 0
        && /收盘跌破冻结硬防守位/.test(String(decision?.waveContext?.mainEvent || ''));

    // 结构硬防守离场优先于“积分达标但暂不建仓”，否则会把已持仓归零误写成普通建仓等待。
    if (waveStructureExit) {
        return `已跌破冻结硬防守位并完成结构离场；待买入积分重新达到 ${threshold}/${threshold}、重新形成有效结构后，才重新考虑。若再次跌破新的结构防守位或出现离场信号，继续空仓。`;
    }

    if (position === 0 && hasB11StructureDefense && b11Defense?.hardInvalidated) {
        return `已收盘跌破结构防守位 ${formatPriceLevel(structureLevel)}${structureDateText}；待买入积分重新达到 ${threshold}/${threshold} 后，才重新考虑。`;
    }

    if (waveEntryBlocked) {
        const nextCondition = decision.waveContext.nextCondition || '等待当前环境完成确认';
        const stopGuard = canShowStop ? `若继续跌破防守位 ${stopText}，继续空仓观望。` : '若继续出现防守信号，继续空仓观望。';
        return `${nextCondition}后再考虑开仓；当前买入积分已达到 ${currentScore}/${threshold}。${stopGuard}`;
    }

    if (position > 0 && position <= 30 && hasB11StructureDefense) {
        const localHint = b11Defense?.localBreak ? 'B11局部回踩已失守，当前暂停加仓；' : '';
        return `${localHint}若收盘跌破结构防守位 ${formatPriceLevel(structureLevel)}${structureDateText}，或再出离场信号，降到 0%。`;
    }

    if (position === 0) {
        const scoreText = threshold === '-' ? '有效买入积分重新达标' : `买入积分重新达到 ${threshold}/${threshold}`;
        const stopGuard = canShowStop ? `若继续跌破防守位 ${stopText}，继续空仓观望。` : '若继续出现防守信号，继续空仓观望。';
        const isStrongExit = ['清仓防守', '强离场'].includes(decision?.exit?.level);
        if (isStrongExit) {
            const triggerText = meta?.repeatedStrongExit ? '今日再次触发强离场，' : '今日触发强离场，';
            return `${triggerText}${getStrongExitCooldownText(meta)}；冷静期结束且${scoreText}后，才重新考虑。当前积分 ${currentScore}/${threshold}。${stopGuard}`;
        }
        if (meta?.inCooldown) {
            return `${getCooldownProgress(meta).label}；冷静期结束且${scoreText}后，才重新考虑。当前积分 ${currentScore}/${threshold}。${stopGuard}`;
        }
        return `${scoreText}后，才重新考虑；当前积分 ${currentScore}/${threshold}。${stopGuard}`;
    }

    if (position <= 30) {
        const stopGuard = canShowStop ? `防守位 ${stopText}` : '短期趋势防守位';
        return `轻仓观察只在重新站回短期趋势且买入积分继续改善时成立；若跌破${stopGuard}，或再出离场信号，降到 0%。`;
    }

    const stopGuard = canShowStop ? `防守位 ${stopText}` : '防守位';
    if (hasWarning) {
        return `只要风险降温且不跌破${stopGuard}，可继续观察；若风险继续升高、跌破${stopGuard}，或出现强离场信号，先降仓或离场。`;
    }
    return `只要不跌破${stopGuard}，且不出现强离场信号，当前判断继续有效；若触发其一，先降仓或离场。`;
}

function getIndexInvalidCondition(meta, decision, position, hasWarning) {
    const threshold = STRATEGY?.buyThreshold ?? '-';
    const currentScore = meta?.windowScore ?? 0;
    const stopText = formatPriceLevel(decision?.risk?.stop);
    const canShowStop = stopText !== '--';
    const marketGate = decision?.marketGate || {};

    if (position === 0 && marketGate.type === 'entry-blocked') {
        return '待沪深300、中证500和中证1000数据补齐并重新允许增加风险后，再结合当前指数动能决定是否提高风险仓位。';
    }

    if (marketGate.type === 'increase-capped') {
        const stopGuard = canShowStop ? `若跌破指数防守位 ${stopText}，或再出离场信号，继续降低风险暴露。` : '若再出离场信号，继续降低风险暴露。';
        return `核心宽基偏弱期间新增风险上限为${marketGate.cap}%；待核心环境改善且指数动能仍有效时，才考虑继续增加。${stopGuard}`;
    }

    if (position === 0) {
        const scoreText = threshold === '-' ? '指数动能积分重新达标' : `指数动能积分重新达到 ${threshold}/${threshold}`;
        const stopGuard = canShowStop ? `若继续跌破指数防守位 ${stopText}，保持低风险暴露。` : '若继续出现防守信号，保持低风险暴露。';
        const isStrongExit = ['清仓防守', '强离场'].includes(decision?.exit?.level);
        if (isStrongExit) {
            const triggerText = meta?.repeatedStrongExit ? '今日指数再次触发强离场，' : '今日指数触发强离场，';
            return `${triggerText}${getStrongExitCooldownText(meta)}；冷静期结束且${scoreText}后，才重新考虑提高风险仓位。当前积分 ${currentScore}/${threshold}。${stopGuard}`;
        }
        if (meta?.inCooldown) {
            return `${getCooldownProgress(meta).label}；冷静期结束且${scoreText}后，才重新考虑提高风险仓位。当前积分 ${currentScore}/${threshold}。${stopGuard}`;
        }
        return `${scoreText}后，才重新考虑提高风险仓位；当前积分 ${currentScore}/${threshold}。${stopGuard}`;
    }

    if (position <= 30) {
        const stopGuard = canShowStop ? `指数防守位 ${stopText}` : '短期趋势防守位';
        return `低风险暴露只在指数重新站回短期趋势且动能继续改善时成立；若跌破${stopGuard}，或再出离场信号，将风险仓位降至 0%。`;
    }

    const stopGuard = canShowStop ? `指数防守位 ${stopText}` : '指数防守位';
    if (hasWarning) {
        return `只要市场风险降温且不跌破${stopGuard}，可维持当前风险仓位；若风险继续升高、跌破${stopGuard}，或出现强离场信号，先降低风险暴露。`;
    }
    return `只要不跌破${stopGuard}，且不出现强离场信号，当前市场判断继续有效；若触发其一，先降低风险暴露。`;
}

function getStockNextFocus(meta, decision, position, hasWarning) {
    const threshold = STRATEGY?.buyThreshold ?? '-';
    const currentScore = Number(meta?.windowScore);
    const numericThreshold = Number(threshold);
    const scoreText = threshold === '-' ? '买入积分重新达标' : `买入积分重新达到${threshold}/${threshold}`;
    const addCondition = Number.isFinite(currentScore) && Number.isFinite(numericThreshold) && currentScore < numericThreshold
        ? scoreText
        : '出现新的有效买入信号';
    const defense = decision?.b11StructureDefense;
    const waveRejection = decision?.waveRejectionProtection;
    const stop = formatPriceLevel(decision?.risk?.stop);
    const stopText = stop === '--' ? '防守位' : `防守位${stop}`;
    const waveEntryBlocked = position === 0
        && Number.isFinite(currentScore)
        && Number.isFinite(numericThreshold)
        && currentScore >= numericThreshold
        && decision?.waveContext?.inScope
        && decision.waveContext.mainEvent;
    const waveStructureExit = position === 0
        && Number(decision?.prevAdv) > 0
        && /收盘跌破冻结硬防守位/.test(String(decision?.waveContext?.mainEvent || ''));
    if (decision?.exit?.level === '强离场' || decision?.exit?.level === '清仓防守') {
        const cooldownDays = Math.max(1, Number(meta?.cooldownDays) || 3);
        return `完成${cooldownDays}个交易日冷静期、且${scoreText}后，才重新考虑买入；若再次出现离场信号或跌破${stopText}，继续空仓。`;
    }
    if (meta?.inCooldown) {
        const progress = getCooldownProgress(meta);
        const cooldownText = progress.remaining > 0 ? `等剩余${progress.remaining}个冷静期交易日走完` : '等今天冷静期结束';
        return `${cooldownText}、且${scoreText}后，才重新考虑买入；若再次出现防守信号，继续空仓。`;
    }
    if (waveRejection?.active) {
        const recoveryCloseLevel = Number(waveRejection.recoveryCloseLevel ?? waveRejection.triggerClose);
        const hardInvalidationProtection = ['signal_hard_invalidation', 'fresh_entry_hard_break', 'structure_hard_break'].includes(waveRejection.eventType);
        const freshScoreRecoveryAllowed = ['fresh_entry_failure', 'fresh_entry_downside_failure'].includes(waveRejection.eventType)
            && waveRejection.ma20RejectionExit !== true;
        const recoveryLevelText = hardInvalidationProtection ? '信号失效位' : '风险日收盘';
        const lockRemaining = Math.max(0, Number(waveRejection.lockRemaining) || 0);
        if (lockRemaining > 0) {
            const lockAge = Math.max(1, Number(waveRejection.lockAge) || 1);
            return `当前是风险事件后的第${lockAge}个观察交易日，还需等待${lockRemaining}个交易日；最早下一个交易日重新评估30%试探仓。`;
        }
        if (freshScoreRecoveryAllowed) {
            const minimumScore = Number(waveRejection.minimumPostEventScore) || Number(STRATEGY?.buyThreshold) || 4;
            const minimumGroups = Number(waveRejection.minimumPostEventGroups) || 2;
            return `完整观察期已结束；事件后新买入积分达到${minimumScore}分且至少来自${minimumGroups}个独立计分组，风险稳定后可恢复最多30%试探仓；不要求先收复风险日收盘价。`;
        }
        if (hardInvalidationProtection) {
            const minimumScore = Number(waveRejection.minimumPostEventScore) || Number(STRATEGY?.buyThreshold) || 4;
            const minimumGroups = Number(waveRejection.minimumPostEventGroups) || 2;
            return `完整观察期已结束；事件后新买入积分重新达到${minimumScore}分且至少来自${minimumGroups}个独立计分组，或价格重新站回${recoveryLevelText}${formatPriceLevel(recoveryCloseLevel)}后，才恢复最多30%试探仓。`;
        }
        return `收复风险日高点${formatPriceLevel(Number(waveRejection.triggerHigh))}且事件后新的有效买入信号仍然有效，或至少两个交易日后站回${recoveryLevelText}${formatPriceLevel(recoveryCloseLevel)}，才考虑局部恢复；若再出现量价分歧，继续保持当前防守仓位。`;
    }
    if (waveRejection?.status === 'recovery_pending') {
        return `出现新的有效买入信号且风险稳定后，才考虑首次恢复，首次最多30%；若再出现量价分歧或离场信号，继续空仓。`;
    }
    if (['released', 'recovery_started', 'recovery_hold'].includes(waveRejection?.status)) {
        return `完成事件后的低仓观察且风险保持稳定后，才考虑继续提高仓位；若再出现量价分歧或离场信号，先降低仓位或离场。`;
    }
    if (waveStructureExit) {
        return `当前已跌破冻结硬防守位并完成结构离场；待买入积分重新达到${threshold}/${threshold}、重新形成有效结构后，才考虑建仓。若再次跌破新的结构防守位或出现离场信号，继续空仓。`;
    }
    if (waveEntryBlocked) {
        const nextCondition = decision.waveContext.nextCondition || '等待当前环境完成确认';
        return `${nextCondition}后再考虑开仓；当前买入积分已达标。若跌破${stopText}或出现离场信号，继续空仓。`;
    }
    if (defense?.hardInvalidated) {
        return `${scoreText}且重新站回结构防守位后，才考虑买入或加仓；若再次收盘跌破结构防守位或出现离场信号，继续离场观察。`;
    }
    if (defense?.localBreak) {
        return `价格回到局部防守位上方、且${addCondition}后，才考虑加仓；若收盘跌破结构防守位或出现离场信号，减仓或离场。`;
    }
    if (decision?.softSignalGrace?.applied) {
        return `观察期内价格不跌破防守位、且${addCondition}后，才考虑加仓；若观察期结束仍未改善或跌破防守位，减仓或离场。`;
    }
    if (position === 0) {
        return `${scoreText}后才考虑开仓；若继续出现防守信号或跌破${stopText}，继续空仓。`;
    }
    if (position <= 30) {
        const riskCondition = hasWarning ? '风险降温' : '风险保持稳定';
        return `${addCondition}、且${riskCondition}后，才考虑加仓；若跌破${stopText}或出现离场信号，降到0%。`;
    }
    if (hasWarning) {
        return `风险降温、且当前买入信号仍有效后，才考虑提高仓位；若风险继续升高、跌破${stopText}或出现离场信号，降低仓位或离场。`;
    }
    return `出现新的有效买入信号、且风险保持稳定后，才考虑提高仓位；若跌破${stopText}或出现离场信号，降低仓位或离场。`;
}

function getIndexNextFocus(meta, decision, position, hasWarning) {
    const threshold = STRATEGY?.buyThreshold ?? '-';
    const currentScore = Number(meta?.windowScore);
    const numericThreshold = Number(threshold);
    const scoreText = threshold === '-' ? '指数动能积分重新达标' : `指数动能积分重新达到${threshold}/${threshold}`;
    const addCondition = Number.isFinite(currentScore) && Number.isFinite(numericThreshold) && currentScore < numericThreshold
        ? scoreText
        : '指数出现新的有效动能信号';
    const marketGate = decision?.marketGate || {};
    const stop = formatPriceLevel(decision?.risk?.stop);
    const stopText = stop === '--' ? '指数防守位' : `指数防守位${stop}`;
    if (decision?.exit?.level === '强离场' || decision?.exit?.level === '清仓防守') {
        const cooldownDays = Math.max(1, Number(meta?.cooldownDays) || 3);
        return `完成${cooldownDays}个交易日冷静期、且${scoreText}后，才重新考虑提高风险；若再次出现离场信号或跌破${stopText}，继续保持低风险。`;
    }
    if (meta?.inCooldown) {
        const progress = getCooldownProgress(meta);
        const cooldownText = progress.remaining > 0 ? `等剩余${progress.remaining}个冷静期交易日走完` : '等今天冷静期结束';
        return `${cooldownText}、且${scoreText}后，才重新考虑提高风险；若再次出现防守信号，保持低风险。`;
    }
    if (marketGate.type === 'entry-blocked') {
        return `核心宽基数据补齐、市场允许新增风险且${scoreText}后，才考虑提高风险；若出现防守信号，保持低风险。`;
    }
    if (marketGate.type === 'increase-capped') {
        return `核心宽基环境改善、且${addCondition}后，才考虑超过当前新增风险上限；若跌破${stopText}或出现离场信号，降低风险。`;
    }
    if (position === 0) {
        return `${scoreText}后才考虑提高风险；若继续跌破${stopText}或出现防守信号，保持低风险。`;
    }
    if (position <= 30) {
        return `${addCondition}、且重新站回短期趋势后，才考虑提高风险；若跌破${stopText}或出现离场信号，降到0%。`;
    }
    if (hasWarning) {
        return `市场风险降温、且当前指数动能仍有效后，才考虑提高风险；若风险继续升高、跌破${stopText}或出现离场信号，降低风险。`;
    }
    return `指数出现新的有效动能信号、且风险保持稳定后，才考虑提高风险；若跌破${stopText}或出现离场信号，降低风险。`;
}

// 仓位变动措辞的唯一出口：结论文案统一用它描述“从多少变到多少”，避免每个事件分支各自拼装。
function formatPositionChangeClause(previousPosition, position, label = '策略参考仓位') {
    const prev = Number(previousPosition) || 0;
    const next = Number(position) || 0;
    if (prev === next) return `${label}维持${next}%`;
    if (prev === 0) return `${label}由空仓转为${next}%`;
    return `${label}从${prev}%${next > prev ? '提高至' : '降至'}${next}%`;
}

// 波段治理事件的仓位说明表：每项只描述规则本身，仓位数字交给 formatPositionChangeClause。
// 顺序等价于原有的 if/else 判定链，命中即返回；后续调整措辞只需改这张表。
function resolveWavePositionNote(ctx) {
    const {
        decision, position, previousPosition, isEntry,
        waveL10Handoff, waveRejection, isSignalHardInvalidation, signalBreakKeepsStructure,
        waveExpiryB11TakeoverAdd, waveB6TrendAdd, waveShortRepair, multiTimeframeProbe,
        wavePositionStage, wavePeak, waveMA20PullbackObservation, waveExpiryHandoff, waveEntryBlocked
    } = ctx;
    const chg = (label = '策略参考仓位') => formatPositionChangeClause(previousPosition, position, label);
    const rejectionEvent = waveRejection.eventType;
    const waveStructureExit = previousPosition > 0
        && position === 0
        && /收盘跌破冻结硬防守位/.test(String(decision?.waveContext?.mainEvent || ''));
    const rules = [
        { code: 'wave-structure-hard-break', when: () => waveStructureExit,
            text: () => `${decision.waveContext.mainEvent}，${chg()}并生成S` },
        { code: 'l10-trend-handoff', when: () => waveL10Handoff.applied,
            text: () => `单独L10只触发趋势接管预警，风险链与完整多头资格共同将策略参考仓位限制在${position}%` },
        { code: 'rejection-entry-blocked', when: () => waveRejection.status === 'entry_blocked',
            text: () => '建仓日长上影受阻优先于试探信号，原计划30%试探仓保持0%，不生成B' },
        { code: 'rejection-ma20-hold', when: () => waveRejection.status === 'ma20_hold',
            text: () => `新仓冲击压力后收盘仍在MA20上方，不清仓但暂停加仓，策略参考仓位封顶${position}%` },
        { code: 'rejection-signal-local-hold', when: () => signalBreakKeepsStructure,
            text: () => `买入信号局部失效但冻结结构支撑未破，${chg()}，不生成S` },
        { code: 'rejection-signal-hard-invalidation', when: () => waveRejection.status === 'triggered' && isSignalHardInvalidation,
            text: () => `买入信号硬失效使${chg()}，并启动局部重入保护` },
        { code: 'rejection-fresh-entry-hard-break', when: () => waveRejection.status === 'triggered' && rejectionEvent === 'fresh_entry_hard_break',
            text: () => `收盘跌破买入日最低价时新仓直接归零，${chg()}` },
        { code: 'rejection-fresh-entry-downside', when: () => waveRejection.status === 'triggered' && rejectionEvent === 'fresh_entry_downside_failure',
            text: () => `新仓下跌失败在当日直接触发防守，${chg()}` },
        { code: 'rejection-fresh-entry-failure', when: () => waveRejection.status === 'triggered' && rejectionEvent === 'fresh_entry_failure',
            text: () => `新仓冲击压力失败在当日直接触发防守，${chg()}` },
        { code: 'rejection-triggered', when: () => waveRejection.status === 'triggered',
            text: () => `冲高回落风险在当日直接降一档，${chg()}` },
        { code: 'rejection-locked', when: () => waveRejection.status === 'locked',
            text: () => `风险事件至少锁定一个完整交易日，新信号不得在次日立即建仓或回补，策略参考仓位保持${position}%` },
        { code: 'rejection-recovering', when: () => ['released', 'recovery_started', 'recovery_hold'].includes(waveRejection.status),
            text: () => `风险解除后按分步恢复规则执行，当前策略参考仓位为${position}%` },
        // WAVE_POSITION_RULES_TAIL
        { code: 'expiry-b11-takeover-add', when: () => waveExpiryB11TakeoverAdd.applied || waveExpiryB11TakeoverAdd.active,
            text: () => `当前${position}%由30%基础仓与20%波段仓组成；波段个股日线的50%确认仓由个股事件决定，核心宽基只在申请80%趋势仓时形成硬限制；本事件不允许空仓直接提高到50%，也不触发80%` },
        { code: 'expiry-b11-takeover-released', when: () => waveExpiryB11TakeoverAdd.status === 'released',
            text: () => '本次只退出额外20%波段仓，仍满足原规则的30%基础仓继续保留；分层减仓不生成新的S' },
        { code: 'b6-trend-add', when: () => waveB6TrendAdd.applied,
            text: () => `缩量回踩不破将本次趋势修复加仓目标设为50%；风险与市场未进一步限制，最终${formatPositionChangeClause(previousPosition, position, '仓位')}，80%仍需完整多头中的当日放量突破确认` },
        { code: 'multi-timeframe-probe', when: () => multiTimeframeProbe.qualified && isEntry,
            text: () => `周线双底候选与日线B20共振，只开放${position}%底部试探仓；后续需新的B6/B11或颈线突破确认，才考虑提高到50%` },
        { code: 'stage-breakout-wait', when: () => wavePositionStage.stage === 'breakout-wait',
            text: () => wavePositionStage.reason || '突破确认后等待首次回踩，不追价建仓' },
        { code: 'peak-confirmed', when: () => wavePeak.confirmed,
            text: () => `波峰确认后按仓位阶梯防守，当前策略参考仓位为${position}%；若重新站回压力区上方，再结合新信号评估恢复` },
        { code: 'peak-candidate', when: () => wavePeak.candidate
                && !(wavePositionStage.increaseApplied && position > previousPosition),
            text: () => '价格已接近日线或周线压力区，当前只作波峰候选观察，不因压力位本身直接清仓' },
        { code: 'stage-trend-increase', when: () => wavePositionStage.increaseApplied && position > previousPosition && wavePositionStage.stage === 'trend',
            text: () => `买入积分已达标、完整多头结构成立，并出现当日放量突破事件，${chg()}趋势仓` },
        { code: 'stage-entry-pullback', when: () => wavePositionStage.increaseApplied && position > previousPosition
                && wavePositionStage.stage === 'entry' && previousPosition === 0,
            text: () => `突破日不追价；新的${getUserSignalText(wavePositionStage.triggerSignal)}回踩确认后只建立${position}%试探仓，后续仍需新的确认事件才考虑提高到50%` },
        { code: 'stage-confirmation-increase', when: () => wavePositionStage.increaseApplied && position > previousPosition,
            text: () => waveShortRepair.qualified
                ? `${waveShortRepair.reason}；中期趋势仍未确认反转，80%仍需完整多头中的当日放量突破确认`
                : `${wavePositionStage.triggerSignal === 'B19' ? '双底突破' : (wavePositionStage.triggerSignal === 'multi-reversal' ? '底背离多组共振' : '当日反转确认')}允许使用50%确认仓；均线只作资格和结构确认，不单独触发加仓，80%仍需新的趋势延续突破` },
        { code: 'ma20-pullback-standalone-l3', when: () => waveMA20PullbackObservation.applied
                && waveMA20PullbackObservation.defenseType === 'standalone_l3',
            text: () => `单独MACD死叉未与L4/L9/L10复合，完整多头结构未破；策略参考仓位维持${position}%一日，不生成S` },
        { code: 'ma20-pullback-limited-hard', when: () => waveMA20PullbackObservation.applied
                && waveMA20PullbackObservation.defenseType === 'limited_hard_invalidation',
            text: () => `买点失效位虽被收盘跌破，但MA20与风险防守位仍守住；策略参考仓位维持${position}%一日，不生成S` },
        { code: 'ma20-pullback-breakout', when: () => waveMA20PullbackObservation.applied
                && waveMA20PullbackObservation.defenseType === 'breakout_pullback',
            text: () => `突破MA20后的首次回踩仍守住均线附近；策略参考仓位维持${position}%一日，不生成S` },
        { code: 'ma20-pullback-observation', when: () => waveMA20PullbackObservation.applied,
            text: () => `本次未满足B6加仓条件，只触发MA20回踩防守观察；策略参考仓位维持${position}%一日，不生成S` },
        { code: 'ma20-pullback-expired', when: () => waveMA20PullbackObservation.status === 'expired',
            text: () => `MA20回踩防守观察只保留一日；次日未通过均线或新B6/B11接管，${chg()}` },
        { code: 'expiry-handoff-trend-washout', when: () => waveExpiryHandoff.applied && waveExpiryHandoff.trendWashout,
            text: () => `积分到期不等于上涨结构失效；完整多头均线仍在时最多保留${waveExpiryHandoff.maxTradingDays || 2}个交易日的${position}%洗盘观察，不机械生成S` },
        { code: 'expiry-handoff', when: () => waveExpiryHandoff.applied,
            text: () => `本次积分下降来自时间窗口自然到期，不是真实破位；一日${waveExpiryHandoff.observationMode === 'defensive' ? '防守观察' : '接管'}规则将策略参考仓位维持在${position}%，不生成S` },
        { code: 'expiry-handoff-expired', when: () => waveExpiryHandoff.status === 'expired',
            text: () => `到期防守观察只保留一日；次日未通过均线或新信号接管，${chg()}` },
        { code: 'wave-entry-blocked', when: () => waveEntryBlocked,
            text: () => `买入积分已达标，但${decision.waveContext.mainEvent}；三趋势治理将策略参考仓位保持为0%` },
    ];
    const hit = rules.find(rule => rule.when());
    return hit ? { code: hit.code, text: hit.text() } : null;
}
