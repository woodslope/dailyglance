(function () {
    'use strict';

    const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    const strategies = typeof STRATEGIES === 'object' ? STRATEGIES : {};
    const signalScores = typeof SIGNAL_SCORES === 'object' ? SIGNAL_SCORES : {};
    const signalDesc = typeof SIGNAL_DESC === 'object' ? SIGNAL_DESC : {};
    const positionSteps = Array.isArray(POSITION_STEPS) ? POSITION_STEPS : [0, 30, 50, 80];
    const labels = { 0: '空仓 / 防守', 30: '试探仓', 50: '确认仓', 80: '趋势仓' };
    const descriptions = { 0: '无有效开仓依据、强离场或极端风险时使用。', 30: '修复观察或风险受限时的最低持仓，不代表趋势已经确认。', 50: '趋势修复或市场偏弱时独立走强的确认仓。', 80: '买入积分达标且个股完整多头结构允许时使用。' };
    const firstStrategyName = Object.keys(strategies)[0] || '';
    const storedStrategyName = localStorage.getItem('quant_strategy');
    let applicationName = storedStrategyName && strategies[storedStrategyName] ? storedStrategyName : firstStrategyName;
    let activeName = applicationName;

    function signalChip(signal, strategy) {
        const score = Number(strategy?.signalWeights?.[signal] ?? signalScores[signal] ?? 0);
        const desc = signalDesc[signal]?.desc || signal;
        return `<span class="signal-chip"><b>${esc(signal)}</b><em>${esc(desc)}</em>${score > 0 ? `<strong>+${score}</strong>` : ''}</span>`;
    }

    function signalGroup(title, signals, className, strategy) {
        const list = Array.isArray(signals) ? signals : [];
        return `<div class="signal-group ${className}"><h3>${esc(title)} <span class="mono">${list.length}</span></h3><div class="signal-chips">${list.length ? list.map(s => signalChip(s, strategy)).join('') : '<span class="strategy-empty">未配置</span>'}</div></div>`;
    }

    function renderTabs() {
        document.getElementById('strategyTabs').innerHTML = Object.entries(strategies).map(([name, config]) => `<button type="button" class="strategy-tab${name === activeName ? ' active' : ''}" data-strategy="${esc(name)}" aria-pressed="${name === activeName}"><strong>${esc(name)}</strong><span>${esc(config.desc || '')}</span></button>`).join('');
        document.querySelectorAll('.strategy-tab').forEach(button => button.addEventListener('click', () => { activeName = button.dataset.strategy; render(); }));
    }

    function renderOverview(strategy) {
        const position = Number(strategy.watchPosition) || 0;
        document.getElementById('strategyOverview').innerHTML = `
            <div class="overview-main"><span class="overview-label">正在查看</span><strong class="overview-value">${esc(activeName)}</strong><span class="overview-detail">${esc(strategy.desc || '')}${activeName === applicationName ? ' · 应用当前策略' : ' · 只读浏览，不影响应用'}</span></div>
            <div><span class="overview-label">买入门槛</span><strong class="overview-value mono">${esc(strategy.buyThreshold ?? '--')} 分</strong><span class="overview-detail">窗口 ${esc(strategy.windowDays ?? '--')} 个交易日</span></div>
            <div><span class="overview-label">试探仓</span><strong class="overview-value mono">${position}%</strong><span class="overview-detail">${position ? '允许观察型入口' : '不提前建仓'}</span></div>
            <div><span class="overview-label">趋势字段</span><strong class="overview-value">只读</strong><span class="overview-detail">不参与仓位、B/S 或收益</span></div>`;
    }

    function renderPositions() {
        document.getElementById('positionSteps').innerHTML = positionSteps.map(value => `<article class="position-step"><strong class="mono">${esc(value)}%</strong><h3>${esc(labels[value] || '统一档位')}</h3><p>${esc(descriptions[value] || '由基础决策与风险上限共同决定。')}</p></article>`).join('');
    }

    function renderSignals(strategy) {
        document.getElementById('signalGroups').innerHTML = [
            signalGroup('买入信号', strategy.buySignals, 'buy', strategy),
            signalGroup('离场信号', strategy.exitSignals, 'exit', strategy),
            signalGroup('预警信号', strategy.warningSignals, 'warning', strategy)
        ].join('');
    }

    function renderScores(strategy) {
        const groups = Array.isArray(strategy.scoreGroups) ? strategy.scoreGroups : [];
        const groupsText = groups.length ? groups.map((group, index) => `第 ${index + 1} 组：${group.join(' / ')}`).join('；') : '未配置分组，按单信号计分';
        const weighted = strategy.signalWeights ? Object.entries(strategy.signalWeights).map(([signal, score]) => `${signal}=${score}`).join('，') : '使用通用信号分数';
        document.getElementById('scoreRules').innerHTML = `
            <div class="score-rule"><h3>窗口长度</h3><p><strong>${esc(strategy.windowDays ?? '--')} 个交易日</strong>内统计当前策略有效买入信号。</p></div>
            <div class="score-rule"><h3>门槛与试探</h3><p>正式门槛 <strong>${esc(strategy.buyThreshold ?? '--')} 分</strong>；${strategy.holdThreshold != null ? `持有/观察门槛 ${esc(strategy.holdThreshold)} 分` : '未配置独立持有门槛'}；未达标是否允许试探由“试探仓”决定。</p></div>
            <div class="score-rule"><h3>同组去重</h3><p>${esc(groupsText)}。</p></div>
            <div class="score-rule"><h3>策略加权</h3><p>${esc(weighted)}。</p></div>`;
    }

    function renderRisk(strategy) {
        const items = [
            ['强离场', Array.isArray(strategy.strongExitSignals) ? strategy.strongExitSignals.join('、') : '沿用默认核心离场组合'],
            ['窗口保护', strategy.windowSignalGuards ? `已配置 ${Object.keys(strategy.windowSignalGuards).join('、')} 的近期陪伴信号门槛` : '未配置额外窗口保护'],
            ['趋势与仓位', '个股趋势资格、风险评分和核心宽基门禁只限制最高允许仓位；指数不使用个股高仓资格。'],
            ['波段例外', activeName === '波段抄底型' ? '包含回踩防守、到期接管、冲高回落保护和趋势加仓等跨日例外。' : '当前策略没有波段专属跨日例外。'],
            ['趋势状态', '上升、下降、横盘、向上反转、向下反转、未知；当前为只读解释字段。']
        ];
        document.getElementById('riskRules').innerHTML = items.map(([title, detail]) => `<div class="risk-rule"><strong>${esc(title)}</strong><p>${esc(detail)}</p></div>`).join('');
    }

    function renderRawConfig(strategy) {
        const target = document.getElementById('rawConfig');
        if (target) target.textContent = JSON.stringify(strategy, null, 2);
    }

    function render() {
        const strategy = strategies[activeName] || {};
        const current = document.getElementById('strategyCurrent');
        if (current) current.textContent = `应用当前：${applicationName || '--'}`;
        renderTabs(); renderOverview(strategy); renderPositions(); renderSignals(strategy); renderScores(strategy); renderRisk(strategy); renderRawConfig(strategy);
    }

    const build = typeof APP_BUILD !== 'undefined' ? APP_BUILD : (window.__DG_BUILD__ || '--');
    document.getElementById('strategyBuild').textContent = `构建 ${build}`;
    window.addEventListener('storage', event => {
        if (event.key !== 'quant_strategy' || !strategies[event.newValue]) return;
        applicationName = event.newValue;
        render();
    });
    render();
})();
