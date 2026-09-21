(function () {
    'use strict';

    const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    const strategies = typeof STRATEGIES === 'object' ? STRATEGIES : {};
    const signalScores = typeof SIGNAL_SCORES === 'object' ? SIGNAL_SCORES : {};
    const signalDesc = typeof SIGNAL_DESC === 'object' ? SIGNAL_DESC : {};
    const positionSteps = Array.isArray(POSITION_STEPS) ? POSITION_STEPS : [0, 30, 50, 80];
    const labels = { 0: '空仓 / 防守', 30: '试探仓', 50: '确认仓', 80: '趋势仓' };
    const descriptions = {
        0: '没有有效开仓依据、触发强离场、结构失效或处于冷静期。',
        30: '允许保留修复观察仓，但不代表趋势已经确认。',
        50: '趋势修复或市场偏弱时的确认仓，仍受趋势/结构限制。',
        80: '买入积分达标且个股完整多头结构允许时使用。'
    };
    const signalTypes = {
        buy: { title: '买入信号', className: 'buy', note: '进入买入窗口并参与积分计算。', empty: '当前策略没有配置买入信号。' },
        exit: { title: '离场信号', className: 'exit', note: '用于降低仓位、离场或阻止继续加仓。', empty: '当前策略没有配置离场信号。' },
        warning: { title: '预警信号', className: 'warning', note: '用于提示风险或限制，不单独等同于卖出。', empty: '当前策略没有配置预警信号。' }
    };
    const firstStrategyName = Object.keys(strategies)[0] || '';
    const storedStrategyName = localStorage.getItem('quant_strategy');
    let applicationName = storedStrategyName && strategies[storedStrategyName] ? storedStrategyName : firstStrategyName;
    let activeName = applicationName;

    function getSignalScore(signal, strategy) {
        return Number(strategy?.signalWeights?.[signal] ?? signalScores[signal] ?? 0);
    }

    function getScoreGroup(strategy, signal) {
        const groups = Array.isArray(strategy?.scoreGroups) ? strategy.scoreGroups : [];
        const index = groups.findIndex(group => Array.isArray(group) && group.includes(signal));
        return index >= 0 ? { index: index + 1, members: groups[index] } : null;
    }

    function signalTable(type, signals, strategy) {
        const list = Array.isArray(signals) ? signals : [];
        const meta = signalTypes[type];
        if (!list.length) return `<div class="strategy-empty">${esc(meta.empty)}</div>`;
        const rows = list.map(signal => {
            const group = type === 'buy' ? getScoreGroup(strategy, signal) : null;
            const score = type === 'buy' ? getSignalScore(signal, strategy) : null;
            const groupText = group ? `第 ${group.index} 组` : (type === 'buy' ? '独立计分' : '不参与买入积分');
            const scoreText = type === 'buy' ? `+${score}` : '--';
            const desc = signalDesc[signal]?.desc || '未命名信号';
            return `<tr>
                <td><span class="signal-code mono">${esc(signal)}</span></td>
                <td><strong>${esc(desc)}</strong></td>
                <td><span class="signal-score${type === 'buy' ? ' is-active' : ''} mono">${esc(scoreText)}</span></td>
                <td><span class="signal-group-text">${esc(groupText)}</span></td>
            </tr>`;
        }).join('');
        return `<div class="signal-table-wrap"><table class="signal-table">
            <thead><tr><th scope="col">代码</th><th scope="col">中文含义</th><th scope="col">积分</th><th scope="col">规则分组</th></tr></thead>
            <tbody>${rows}</tbody>
        </table></div>`;
    }

    function signalGroup(type, strategy) {
        const meta = signalTypes[type];
        const signals = strategy[`${type}Signals`];
        const count = Array.isArray(signals) ? signals.length : 0;
        return `<article class="signal-group ${meta.className}">
            <header class="signal-group-header"><div><h3>${esc(meta.title)}</h3><p>${esc(meta.note)}</p></div><strong class="signal-count mono">${count}</strong></header>
            ${signalTable(type, signals, strategy)}
        </article>`;
    }

    function renderTabs() {
        const target = document.getElementById('strategyTabs');
        target.innerHTML = Object.entries(strategies).map(([name, config]) => `<button type="button" class="strategy-tab${name === activeName ? ' active' : ''}" data-strategy="${esc(name)}" aria-pressed="${name === activeName}"><strong>${esc(name)}</strong><span>${esc(config.desc || '')}</span></button>`).join('');
        target.querySelectorAll('.strategy-tab').forEach(button => button.addEventListener('click', () => {
            activeName = button.dataset.strategy;
            render();
        }));
    }

    function renderOverview(strategy) {
        const watchPosition = Number(strategy.watchPosition) || 0;
        const signalVersion = typeof SIGNAL_VERSION !== 'undefined' ? SIGNAL_VERSION : '--';
        const groupsCount = Array.isArray(strategy.scoreGroups) ? strategy.scoreGroups.length : 0;
        document.getElementById('strategyOverview').innerHTML = `
            <div class="overview-main">
                <span class="overview-label">正在查看策略</span>
                <strong class="overview-value">${esc(activeName)}</strong>
                <p class="overview-description">${esc(strategy.desc || '未提供策略说明。')}</p>
                <div class="overview-status"><span class="status-mark${activeName === applicationName ? ' is-current' : ''}">${activeName === applicationName ? '应用当前' : '只读浏览'}</span><span class="overview-version mono">信号规则 ${esc(signalVersion)}</span></div>
            </div>
            <div class="overview-fact"><span class="overview-label">买入门槛</span><strong class="overview-value mono">${esc(strategy.buyThreshold ?? '--')} 分</strong><span class="overview-detail">窗口 ${esc(strategy.windowDays ?? '--')} 个交易日</span></div>
            <div class="overview-fact"><span class="overview-label">试探仓</span><strong class="overview-value mono">${watchPosition}%</strong><span class="overview-detail">${watchPosition ? '允许观察型入口' : '不提前建仓'}</span></div>
            <div class="overview-fact"><span class="overview-label">积分分组</span><strong class="overview-value mono">${groupsCount} 组</strong><span class="overview-detail">同组信号只计一次</span></div>`;
    }

    function renderPositions() {
        document.getElementById('positionSteps').innerHTML = positionSteps.map(value => `<article class="position-step"><div class="position-step-head"><strong class="mono">${esc(value)}%</strong><span class="position-step-label">${esc(labels[value] || '统一档位')}</span></div><p>${esc(descriptions[value] || '由基础决策与结构/市场限制共同决定。')}</p></article>`).join('');
    }

    function renderSignals(strategy) {
        document.getElementById('signalGroups').innerHTML = ['buy', 'exit', 'warning'].map(type => signalGroup(type, strategy)).join('');
    }

    function renderScores(strategy) {
        const groups = Array.isArray(strategy.scoreGroups) ? strategy.scoreGroups : [];
        const weighted = strategy.signalWeights ? Object.entries(strategy.signalWeights).map(([signal, score]) => `${signal} = ${score}`).join('，') : '使用通用信号分数';
        const groupList = groups.length ? groups.map((group, index) => `<li><span class="mono">第 ${index + 1} 组</span><span>${esc(group.join(' / '))}</span></li>`).join('') : '<li><span>未配置分组</span><span>按单信号计分</span></li>';
        document.getElementById('scoreRules').innerHTML = `
            <div class="score-rule"><span class="rule-label">窗口长度</span><strong>${esc(strategy.windowDays ?? '--')} 个交易日</strong><p>只统计当前策略窗口内仍有效的买入信号。</p></div>
            <div class="score-rule"><span class="rule-label">买入门槛</span><strong>${esc(strategy.buyThreshold ?? '--')} 分</strong><p>${strategy.holdThreshold != null ? `持有/观察门槛为 ${esc(strategy.holdThreshold)} 分。` : '未配置独立持有门槛。'}</p></div>
            <div class="score-rule score-rule-wide"><span class="rule-label">同组去重</span><ul class="score-group-list">${groupList}</ul></div>
            <div class="score-rule score-rule-wide"><span class="rule-label">策略加权</span><p>${esc(weighted)}</p></div>`;
    }

    function renderRisk(strategy) {
        const strongExit = Array.isArray(strategy.strongExitSignals) ? strategy.strongExitSignals.join('、') : '沿用默认核心离场组合';
        const windowGuards = strategy.windowSignalGuards ? `已配置 ${Object.keys(strategy.windowSignalGuards).join('、')} 的近期陪伴信号门槛` : '未配置额外窗口保护';
        const items = [
            ['强离场', strongExit, 'exit'],
            ['窗口保护', windowGuards, 'info'],
            ['趋势与仓位', '个股趋势资格、结构防守和离场信号决定最高允许仓位；风险评分仅作辅助诊断，不参与仓位、B/S 或清仓。核心宽基只作市场背景，不限制个股仓位。', 'info'],
            ['波段例外', activeName === '波段抄底型' ? '包含回踩防守、到期接管、冲高回落保护和趋势加仓等跨日例外。' : '当前策略没有波段专属跨日例外。', activeName === '波段抄底型' ? 'warning' : 'info'],
            ['趋势状态', '上升、下降、横盘、向上反转、向下反转、未知；只作为解释字段。', 'info']
        ];
        document.getElementById('riskRules').innerHTML = items.map(([title, detail, tone]) => `<article class="risk-rule ${tone}"><strong>${esc(title)}</strong><p>${esc(detail)}</p></article>`).join('');
    }

    function renderRawConfig(strategy) {
        const target = document.getElementById('rawConfig');
        if (target) target.textContent = JSON.stringify(strategy, null, 2);
    }

    function render() {
        const strategy = strategies[activeName] || {};
        const current = document.getElementById('strategyCurrent');
        if (current) current.textContent = `应用当前：${applicationName || '--'}`;
        renderTabs();
        renderOverview(strategy);
        renderPositions();
        renderSignals(strategy);
        renderScores(strategy);
        renderRisk(strategy);
        renderRawConfig(strategy);
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
