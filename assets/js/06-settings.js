/* DailyGlance [6] - settings surface. Loaded after the main lifecycle script. */

async function switchStrategy(name) {
    if (!STRATEGIES[name]) return;
    const confirmed = await customConfirm(`确定切换到 [${name}]？\n${STRATEGIES[name].desc}`);
    if (!confirmed) return;
    const perfTrace = PERF.start('switchStrategy', { strategy: name });

    const canReuseCurrentIndicators = !!(getActiveData()?.length && state.indicators.macd && state.indicators.rsi && state.indicators.kdj && state.indicators.ma);
    setActiveStrategy(name);
    localStorage.setItem('quant_strategy', name);
    renderSettings();

    if (getActiveData()) {
        state.pendingIndicatorMutation = canReuseCurrentIndicators ? { mode: 'strategy-only', startIdx: 0 } : { mode: 'full', startIdx: 0 };
        markIndicatorsDirty();
        updateAllIndicators();
        PERF.mark(perfTrace, 'indicators');
        draw();
        PERF.mark(perfTrace, 'draw');
        safeUpdateSidebar();
        PERF.mark(perfTrace, 'sidebar');
        refreshWatchlistSignalSnapshots();
        PERF.mark(perfTrace, 'watchlist');
        renderWatchlist();
    }
    PERF.end(perfTrace, { selected: state.strategy });
}

function renderSettings() {
    const panel = document.getElementById('settingsPanel');
    if (!panel) return;

    const strategyHtml = Object.entries(STRATEGIES).map(([name, config]) => `
        <button type="button" class="settings-strategy-option${state.strategy === name ? ' active' : ''}" aria-pressed="${state.strategy === name}" onclick="switchStrategy('${name}')">
            <strong>${name}</strong>
            <span class="sg-desc">${config.desc}</span>
        </button>
    `).join('');

    panel.innerHTML = `
        <div class="sg-header">
            <h2 id="settingsDialogTitle">策略设置</h2>
            <button type="button" class="sg-close" onclick="toggleSettings()" title="关闭设置" aria-label="关闭设置">×</button>
        </div>
        <div class="sg-body">
            <div class="strategy-page-launch">
                <div>
                    <div class="block-title">独立策略页</div>
                    <div class="text-dim">查看四套策略、统一仓位档位、信号入口、风险限制和完整配置。</div>
                </div>
                <a class="strategy-page-link" href="strategy-inspector.html" target="_blank" rel="noopener" title="在独立页面查看当前策略">打开独立策略页 ↗</a>
            </div>
            <div class="terminal-block settings-strategy-block">
                <div class="block-title settings-strategy-title"><span>量化策略选择</span><span class="settings-current-strategy">应用当前：${state.strategy}</span></div>
                <div class="sg-strategy settings-strategy-grid">${strategyHtml}</div>
                <div class="settings-boundary-note">切换会更新主应用使用的策略；完整信号、积分和风险限制请在独立策略页只读核对。</div>
            </div>
        </div>
    `;
}

function toggleSettings() {
    toggleDialogOverlay(document.getElementById('settingsOverlay'), {
        beforeOpen: renderSettings,
        fallbackFocus: document.getElementById('btnSettings')
    });
}
