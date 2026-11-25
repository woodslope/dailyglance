(function () {
    'use strict';

    const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    const strategies = typeof STRATEGIES === 'object' ? STRATEGIES : {};
    const signalScores = typeof SIGNAL_SCORES === 'object' ? SIGNAL_SCORES : {};
    const signalDesc = typeof SIGNAL_DESC === 'object' ? SIGNAL_DESC : {};
    const signalTypes = {
        buy: { title: '买入信号', className: 'buy', note: '进入买入窗口并参与积分计算。', empty: '当前策略没有配置买入信号。' },
        exit: { title: '离场信号', className: 'exit', note: '用于降低仓位、离场或阻止继续加仓。', empty: '当前策略没有配置离场信号。' },
        warning: { title: '预警信号', className: 'warning', note: '用于提示风险或限制，不单独等同于卖出。', empty: '当前策略没有配置预警信号。' }
    };
    const firstStrategyName = Object.keys(strategies)[0] || '';
    let applicationName = '';
    try {
        const storedStrategyName = localStorage.getItem('quant_strategy');
        applicationName = storedStrategyName && strategies[storedStrategyName] ? storedStrategyName : firstStrategyName;
    } catch (error) {
        // 偏好读取失败不阻断只读浏览，也不把默认浏览策略冒充应用当前策略。
    }
    let activeName = applicationName || firstStrategyName;

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
                <div class="overview-status"><span class="status-mark${activeName === applicationName ? ' is-current' : ''}">${activeName === applicationName ? '应用当前' : '只读浏览'}</span><span class="overview-version mono">信号版本 ${esc(signalVersion)}</span></div>
            </div>
            <div class="overview-fact"><span class="overview-label">买入门槛</span><strong class="overview-value mono">${esc(strategy.buyThreshold ?? '--')} 分</strong><span class="overview-detail">窗口参数 ${esc(strategy.windowDays ?? '--')}</span></div>
            <div class="overview-fact"><span class="overview-label">观察仓参数</span><strong class="overview-value mono">${watchPosition}%</strong><span class="overview-detail">配置值，非当前仓位</span></div>
            <div class="overview-fact"><span class="overview-label">积分分组</span><strong class="overview-value mono">${groupsCount} 组</strong><span class="overview-detail">同组信号只计一次</span></div>`;
    }


    function renderSignals(strategy) {
        document.getElementById('signalGroups').innerHTML = ['buy', 'exit', 'warning'].map(type => signalGroup(type, strategy)).join('');
    }

    function renderScores(strategy) {
        const groups = Array.isArray(strategy.scoreGroups) ? strategy.scoreGroups : [];
        const weighted = strategy.signalWeights ? Object.entries(strategy.signalWeights).map(([signal, score]) => `${signal} = ${score}`).join('，') : '使用通用信号分数';
        const groupList = groups.length ? groups.map((group, index) => `<li><span class="mono">第 ${index + 1} 组</span><span>${esc(group.join(' / '))}</span></li>`).join('') : '<li><span>未配置分组</span><span>按单信号计分</span></li>';
        document.getElementById('scoreRules').innerHTML = `
            <div class="score-rule"><span class="rule-label">窗口参数</span><strong>${esc(strategy.windowDays ?? '--')}</strong><p>配置字段 windowDays，显示原始参数值。</p></div>
            <div class="score-rule"><span class="rule-label">买入门槛</span><strong>${esc(strategy.buyThreshold ?? '--')} 分</strong><p>${strategy.holdThreshold != null ? `持有/观察门槛为 ${esc(strategy.holdThreshold)} 分。` : '未配置独立持有门槛。'}</p></div>
            <div class="score-rule score-rule-wide"><span class="rule-label">同组去重</span><ul class="score-group-list">${groupList}</ul></div>
            <div class="score-rule score-rule-wide"><span class="rule-label">策略加权</span><p>${esc(weighted)}</p></div>`;
    }


    function renderRawConfig(strategy) {
        const target = document.getElementById('rawConfig');
        if (target) target.textContent = JSON.stringify(strategy, null, 2);
    }

    function render() {
        const strategy = strategies[activeName] || {};
        const current = document.getElementById('strategyCurrent');
        if (current) current.textContent = `应用当前：${applicationName || '无法读取'}`;
        renderTabs();
        renderOverview(strategy);
        renderSignals(strategy);
        renderScores(strategy);
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
