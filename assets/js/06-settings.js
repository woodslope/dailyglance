/* DailyGlance [6] - settings surface. Loaded after the main lifecycle script. */

let strategySwitchSequence = 0;
async function switchStrategy(name) {
    if (!STRATEGIES[name]) return;
    const confirmed = await customConfirm(`确定切换到 [${name}]？\n${STRATEGIES[name].desc}`);
    if (!confirmed) return;
    const sequence = ++strategySwitchSequence;
    const perfTrace = PERF.start('switchStrategy', { strategy: name });
    const selectedId = state.id;
    const selectedPeriod = state.period;
    const interactionToken = beginChartInteractionBlock();
    cancelWorkspaceHydration();
    showLoading('正在切换策略并计算完整历史…');
    try {
        await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
        if (sequence !== strategySwitchSequence || state.id !== selectedId || state.period !== selectedPeriod) return;
        const canReuseCurrentIndicators = !!(getActiveData()?.length && state.indicators.macd && state.indicators.rsi && state.indicators.kdj && state.indicators.ma);
        setActiveStrategy(name);
        try {
            localStorage.setItem('quant_strategy', name);
        } catch (error) {
            showToast('策略已切换，但偏好保存失败；本次设置仅在当前页面生效。', 'warn', 6000);
        }
        renderSettings();
        if (getActiveData()) {
            state.pendingIndicatorMutation = canReuseCurrentIndicators ? { mode:'strategy-only', startIdx:0 } : { mode:'full', startIdx:0 };
            markIndicatorsDirty();
            while (!await updateAllIndicatorsAsync()) {
                if (sequence !== strategySwitchSequence || state.id !== selectedId || state.period !== selectedPeriod || state.strategy !== name) return;
            }
            PERF.mark(perfTrace, 'indicators');
            draw();
            PERF.mark(perfTrace, 'draw');
            safeUpdateSidebar();
            PERF.mark(perfTrace, 'sidebar');
            refreshWatchlistSignalSnapshots();
            PERF.mark(perfTrace, 'watchlist');
            renderWatchlist();
        }
    } finally {
        PERF.end(perfTrace, { selected:state.strategy });
        if (sequence === strategySwitchSequence) {
            hideLoading();
            releaseChartInteractionAfterPaint(interactionToken);
            requestVisibleWorkspaceRefresh();
        }
    }
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
                    <div class="block-title">策略配置参考</div>
                    <div class="text-dim">核对四套策略的信号、积分、窗口和原始配置，不用于推导当前买卖动作。</div>
                </div>
                <a class="strategy-page-link" href="strategy-inspector.html" target="_blank" rel="noopener" title="只读查看策略配置">打开配置参考 ↗</a>
            </div>
            <div class="terminal-block settings-strategy-block">
                <div class="block-title settings-strategy-title"><span>量化策略选择</span><span class="settings-current-strategy">应用当前：${state.strategy}</span></div>
                <div class="sg-strategy settings-strategy-grid">${strategyHtml}</div>
                <div class="settings-boundary-note">切换会更新主应用使用的策略；独立策略页仅供配置核对，具体动作以主应用计算结果为准。</div>
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
