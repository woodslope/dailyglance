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
        <button class="${state.strategy === name ? 'active' : ''}" onclick="switchStrategy('${name}')" style="padding:10px;">
            ${name}
            <span class="sg-desc" style="margin-top:4px;">${config.desc}</span>
        </button>
    `).join('');

    const signalConfigHtml = SIGNAL_RULES.map(rule => {
        const score = getSignalScore(rule.id);
        const isBuy = rule.id.startsWith('B');
        const isWarning = rule.id.startsWith('W');
        const baseColorVar = isBuy ? '--red' : (isWarning ? '--yellow' : '--green');
        const isUsed = STRATEGY.buySignals?.includes(rule.id) || STRATEGY.exitSignals?.includes(rule.id) || STRATEGY.warningSignals?.includes(rule.id);

        const opacity = isUsed ? '1' : '0.4';
        const idBg = isUsed ? 'rgba(255,255,255,0.08)' : 'transparent';
        const idColor = isUsed ? `var(${baseColorVar})` : 'var(--text-dim)';
        const textColor = isUsed ? 'var(--text-main)' : 'var(--text-dim)';
        return `
            <div style="display:flex; justify-content:space-between; align-items:center; padding:6px 8px; background:var(--inner-bg); border-radius:var(--radius-sm); border:1px solid var(--border-light); opacity:${opacity}; transition: opacity 0.2s;">
                <div style="display:flex; align-items:center; gap:6px;">
                    <span class="mono" style="font-size:10px; font-weight:700; background:${idBg}; padding:2px 4px; border-radius:3px; color:${idColor}; line-height:1;">${rule.id}</span>
                    <span style="font-size:11px; color:${textColor};">${getUserSignalText(rule.id)}</span>
                </div>
                <span class="mono" style="font-size:11px; color:${textColor}; font-weight:700;">${score > 0 ? '+' + score : score}</span>
            </div>
        `;
    }).join('');

    panel.innerHTML = `
        <div class="sg-header">
            <h2 id="settingsDialogTitle">系统设置</h2>
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
            <div class="terminal-block" style="padding:12px 16px;">
                <div class="block-title" style="margin-bottom:8px;">量化策略选择 (当前: ${state.strategy})</div>
                <div class="sg-strategy" style="gap:8px;">${strategyHtml}</div>
            </div>
            <div class="terminal-block" style="padding:12px 16px;">
                <div class="block-title" style="display:flex;justify-content:space-between; margin-bottom:8px;">
                    <span>信号积分配置 (SOP 4.1.2)</span>
                    <span class="text-dim" style="font-weight:400;">买入阈值: ${STRATEGY.buyThreshold}分</span>
                </div>
                <div class="signal-config-grid">${signalConfigHtml}</div>
                <div class="risk-note" style="margin-top:8px;">注：灰色未点亮的信号表示当前策略未将该信号纳入核心驱动模型。积分配置由当前策略动态决定，不同策略对同一信号的赋分可能不同。</div>
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
