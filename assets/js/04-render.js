/* DailyGlance [4] - split from dailyglance.html. Keep classic script order. */
// ==========================================
// [4] 渲染与 UI 层 (Render & UI)
// ==========================================

const CHART_CANVAS_IDS = ['mainChart', 'volumeChart', 'macdChart', 'kdjChart'];
const SECONDARY_CHART_TARGETS = [
    ['vol', 'volumeChart'],
    ['macd', 'macdChart'],
    ['kdj', 'kdjChart']
];

function shouldRenderCompactMainChartOnly() {
    return typeof isCompactMobileLayout === 'function' && isCompactMobileLayout();
}

function clearSecondaryChartInstances() {
    SECONDARY_CHART_TARGETS.forEach(([key, id]) => {
        const chart = Chart.getChart(id);
        if (chart) chart.destroy();
        delete state.charts[key];
    });
}

function clearCharts(reason = 'empty'){
    CHART_CANVAS_IDS.forEach(id => { const c = Chart.getChart(id); if(c) c.destroy(); });
    state.charts = {};
    document.querySelectorAll('.empty-hint').forEach(el => el.remove());
    const placeholderIds = shouldRenderCompactMainChartOnly() ? ['mainChart'] : CHART_CANVAS_IDS;
    placeholderIds.forEach(id => {
        const el = document.getElementById(id); if(!el) return; 
        const p = el.parentElement; p.classList.add('chart-placeholder-host');
        let ph = p.querySelector('.empty-hint'); 
        if(!ph) { ph = document.createElement('div'); ph.className = 'empty-hint text-dim mono'; p.appendChild(ph); }
        const statusText = reason === 'error' ? '加载失败' : '暂无数据';
        ph.innerText = {'mainChart': 'K 线图', 'volumeChart': '成交量', 'macdChart': 'MACD', 'kdjChart': 'KDJ'}[id] + ' — ' + statusText;
    });
}

function clearStaleTooltips() {
    Object.values(state.charts).forEach(c => { if (c && c.tooltip) c.tooltip.setActiveElements([], {x: 0, y: 0}); });
}

function refreshChartsIfNeeded() {
    Object.values(state.charts).forEach(c => { if (c) { if (typeof c.draw === 'function') c.draw(); else c.update('none'); } });
}

function clearChartDragPreview() {
    const boxes = document.querySelectorAll('.main-chart-box, .volume-chart-box, .macd-chart-box, .kdj-chart-box, #crosshairOverlay');
    if (!boxes.length) return;
    boxes.forEach(el => { el.style.transform = 'translateX(0px)'; });
}

function isHistoricalVisualState(data = getActiveData(), idx = data ? getSafeIndex(data) : -1) {
    return !!(data && data.length && idx >= 0 && idx < data.length - 1);
}

function updateFreezeBadge() {
    var badge = document.getElementById('freezeBadge');
    if (!badge) return;
    var rd = getActiveData();
    var safeIdx = rd ? getSafeIndex(rd) : -1;
    if (isHistoricalVisualState(rd, safeIdx)) {
        var date = rd && safeIdx >= 0 && safeIdx < rd.length ? rd[safeIdx].date : '';
        var dateEl = badge.querySelector('.freeze-badge-date');
        if (dateEl) dateEl.textContent = date ? ' \u00b7 ' + date : '';
        badge.style.display = 'flex';
    } else {
        badge.style.display = 'none';
    }
}

const freezePlugin = {
    id: 'freezePlugin',
    beforeEvent: () => true
};

function getStrategyShortLabel(strategyName = state.strategy) {
    return ({
        '稳健趋势型': '稳健',
        '波段抄底型': '波段',
        '突破追涨型': '突破',
        '综合全能型': '综合'
    })[strategyName] || String(strategyName || '').trim();
}

function getConclusionTitleHTML(isIndexMode) {
    const titleText = isIndexMode ? '大盘每日结论' : '个股每日结论';
    const strategyLabel = getStrategyShortLabel();
    const strategyHtml = strategyLabel
        ? `<span class="conclusion-strategy-label">（${escapeHTML(strategyLabel)}）</span>`
        : '';
    return `${titleText}${strategyHtml}`;
}

// 成交量柱 plugin：用 canvas 手绘，像素级对齐 K 线蜡烛
const volumeBarPlugin = {
    id: 'volumeBarPlugin',
    afterDatasetsDraw: c => {
        const dss = c.data.datasets.find(d => d.isVolData === true && d.volData);
        if (!dss || !dss.volData) return;
        const { ctx, chartArea } = c;
        if (!chartArea) return;
        const { bottom, top } = chartArea;
        const x = c.scales.x, y = c.scales.y;
        if (!x || !y) return;
        const colorUpHex = getCssVar('--up-color') || '#f6465d';
        const colorDownHex = getCssVar('--down-color') || '#0ecb81';
        const barW = Math.min((x.width / c.data.labels.length) * 0.8, 20);
        dss.volData.forEach((d, i) => {
            if (!d || d.vol == null) return;
            const px = x.getPixelForValue(i);
            const vy = y.getPixelForValue(d.vol);
            if (isNaN(px) || isNaN(vy)) return;
            const vyClamped = Math.max(top, Math.min(bottom, vy));
            ctx.fillStyle = d.isUp ? colorUpHex + '80' : colorDownHex + '80';
            ctx.fillRect(px - barW / 2, vyClamped, barW, Math.max(bottom - vyClamped, 0.5));
        });
    }
};

// MACD 柱 plugin：跟 volume 一样用 canvas 手绘，正负值从中线向上下延伸
const macdBarPlugin = {
    id: 'macdBarPlugin',
    afterDatasetsDraw: c => {
        const dss = c.data.datasets.find(d => d.isMacdBar === true && d.macdBarData);
        if (!dss || !dss.macdBarData) return;
        const { ctx, chartArea } = c;
        if (!chartArea) return;
        const { bottom, top } = chartArea;
        const x = c.scales.x, y = c.scales.y;
        if (!x || !y) return;
        const colorUpHex = getCssVar('--up-color') || '#f6465d';
        const colorDownHex = getCssVar('--down-color') || '#0ecb81';
        const barW = Math.min((x.width / c.data.labels.length) * 0.8, 20);
        const zeroY = Math.min(bottom, Math.max(top, y.getPixelForValue(0)));
        dss.macdBarData.forEach((v, i) => {
            if (v == null) return;
            const px = x.getPixelForValue(i);
            const vy = y.getPixelForValue(v);
            if (isNaN(px) || isNaN(vy)) return;
            const vyClamped = Math.min(bottom, Math.max(top, vy));
            const barY = Math.min(zeroY, vyClamped);
            ctx.fillStyle = v >= 0 ? colorUpHex + '80' : colorDownHex + '80';
            ctx.fillRect(px - barW / 2, barY, barW, Math.max(Math.abs(zeroY - vyClamped), 0.5));
        });
    }
};

const localAlignPlugin = {
    id: 'localAlignPlugin',
    afterDatasetsDraw: c => {
        const { ctx, chartArea } = c;
        if (!chartArea) return;
        const { top, bottom, left, right } = chartArea;
        const x = c.scales.x, y = c.scales.y;
        if (!x || !y) return;
        const dss = c.data.datasets.find(d => d.isCandle === true && d.candleData);
        const colorUpHex = getCssVar('--up-color') || '#f6465d', colorDownHex = getCssVar('--down-color') || '#0ecb81';
        
        if (dss && dss.candleData) {
            const w = Math.min((x.width / c.data.labels.length) * 0.8, 20);
            dss.candleData.forEach((d, i) => {
                if (!d) return;
                const px = x.getPixelForValue(i);
                const ho = y.getPixelForValue(d.h), lo = y.getPixelForValue(d.l);
                const co = y.getPixelForValue(d.c), oo = y.getPixelForValue(d.o);
                if (isNaN(px) || isNaN(ho) || isNaN(lo) || isNaN(co) || isNaN(oo)) return;
                const cl = d.c >= d.o ? colorUpHex : colorDownHex;
                ctx.strokeStyle = cl; ctx.beginPath(); ctx.moveTo(px, ho); ctx.lineTo(px, lo); ctx.stroke();
                ctx.fillStyle = cl; ctx.fillRect(px - w / 2, Math.min(oo, co), w, Math.max(Math.abs(oo - co), 1.5));
            });
        }
    }
};

function updateCrosshairOverlay() {
    const overlay = document.getElementById('crosshairOverlay');
    const line = document.getElementById('crosshairLine');
    const hLine = document.getElementById('crosshairHLine');
    if (!overlay || !line) return;
    const mainChart = state.charts.main;
    if (!mainChart) return;
    const actData = getActiveData();
    if (!actData || !actData.length) { overlay.classList.remove('active'); if (hLine) hLine.classList.remove('active'); return; }
    const safeIdx = getSafeIndex(actData);
    if (safeIdx < 0 || safeIdx >= actData.length) { overlay.classList.remove('active'); if (hLine) hLine.classList.remove('active'); return; }
    const li = mainChart.data.labels.indexOf(actData[safeIdx].date);
    if (li < 0) { overlay.classList.remove('active'); if (hLine) hLine.classList.remove('active'); return; }
    const xScale = mainChart.scales.x;
    const yScale = mainChart.scales.y;
    const px = xScale.getPixelForValue(li);
    if (px < xScale.left || px > xScale.right) { overlay.classList.remove('active'); if (hLine) hLine.classList.remove('active'); return; }
    const isHistorical = isHistoricalVisualState(actData, safeIdx);

    // 竖线
    line.style.transform = 'translateX(' + px + 'px)';
    overlay.classList.add('active');
    if (state.isFrozen) overlay.classList.add('frozen');
    else overlay.classList.remove('frozen');
    if (isHistorical) overlay.classList.add('historical');
    else overlay.classList.remove('historical');

    // 横线（只在主图）
    if (hLine && yScale) {
        var py = yScale.getPixelForValue(actData[safeIdx].close);
        if (py >= yScale.top && py <= yScale.bottom) {
            hLine.style.transform = 'translateY(' + py + 'px)';
            hLine.classList.add('active');
        } else {
            hLine.classList.remove('active');
        }
        // 主图 frozen 状态切换
        var mainBox = document.querySelector('.main-chart-box');
        if (mainBox) {
            if (state.isFrozen) mainBox.classList.add('frozen');
            else mainBox.classList.remove('frozen');
            if (isHistorical) mainBox.classList.add('historical');
            else mainBox.classList.remove('historical');
        }
    }
}

const bsMarkerPlugin = {
    id: 'bsMarkerPlugin',
    afterDatasetsDraw: c => {
        const { ctx, chartArea } = c;
        if (!chartArea) return;
        const { top, bottom, left, right } = chartArea;
        const x = c.scales.x, y = c.scales.y;
        if (!x || !y) return;
        const dss = c.data.datasets.find(d => d.isCandle === true && d.candleData);
        if (!dss || state.period === 'weekly') return; 

        const activeData = getActiveData(); if(!activeData) return;
        const visibleRange = getVisibleRange(activeData);
        const slice = activeData.slice(visibleRange.start, visibleRange.end + 1);
        const colorUpHex = getCssVar('--up-color') || '#f6465d', colorDownHex = getCssVar('--down-color') || '#0ecb81';

        ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = 'bold 11px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
        ctx.lineWidth = 4; ctx.strokeStyle = getCssVar('--dark-bg') || '#0b0e14'; ctx.lineJoin = 'round';
        slice.forEach((d, i) => {
            const px = x.getPixelForValue(i);
            if (isNaN(px) || px < left || px > right || !d._decision) return;
            if (d._decision.bsMark === 'B') { 
                const isGoldBuy = ['trial', 'strong'].includes(d._decision.bQuality);
                ctx.fillStyle = isGoldBuy ? (getCssVar('--yellow') || '#f5a623') : colorUpHex;
                const py = y.getPixelForValue(d.low);
                if (!isNaN(py)) {
                    const markerY = Math.min(py + 18, bottom - 9);
                    ctx.strokeText('B', px, markerY);
                    ctx.fillText('B', px, markerY);
                }
            } 
            else if (d._decision.bsMark === 'S') { 
                ctx.fillStyle = colorDownHex; 
                const py = y.getPixelForValue(d.high);
                if (!isNaN(py)) {
                    const markerY = Math.max(py - 18, top + 9);
                    ctx.strokeText('S', px, markerY);
                    ctx.fillText('S', px, markerY);
                }
            }
        });
        ctx.restore();
    }
};

let hoverRAF = null;
let pendingHoverIdx = -1;
let hoverSidebarTimer = null;
let hoverSidebarLastAt = Number.NEGATIVE_INFINITY;
const HOVER_SIDEBAR_MIN_MS = 48;
let chartPointerResetBound = false;
let chartDragPanBound = false;
let chartDragPanRAF = 0;
let chartDragPan = null;
let chartHoverSuppressUntil = 0;

function cancelPendingChartHoverSelection() {
    pendingHoverIdx = -1;
    if (hoverRAF) {
        cancelAnimationFrame(hoverRAF);
        hoverRAF = null;
    }
    if (hoverSidebarTimer) {
        clearTimeout(hoverSidebarTimer);
        hoverSidebarTimer = null;
    }
}

function suppressChartHoverSelection(ms = 350) {
    cancelPendingChartHoverSelection();
    chartHoverSuppressUntil = Date.now() + ms;
}

function runHoverSidebarUpdate() {
    hoverRAF = null;
    hoverSidebarTimer = null;
    hoverSidebarLastAt = Date.now();
    safeUpdateSidebar();
}

function scheduleHoverSidebarUpdate() {
    if (hoverRAF || hoverSidebarTimer) return;
    const elapsed = Date.now() - hoverSidebarLastAt;
    const wait = Math.max(0, HOVER_SIDEBAR_MIN_MS - elapsed);
    if (wait === 0) {
        hoverRAF = requestAnimationFrame(runHoverSidebarUpdate);
    } else {
        hoverSidebarTimer = setTimeout(() => {
            hoverSidebarTimer = null;
            if (!hoverRAF) hoverRAF = requestAnimationFrame(runHoverSidebarUpdate);
        }, wait);
    }
}

function resolveVisibleDataIndex(activeData, renderedIndex) {
    if (!activeData || renderedIndex < 0) return -1;
    const visibleRange = getVisibleRange(activeData);
    const startIdx = visibleRange.start;
    const targetIdx = startIdx + renderedIndex;
    return (targetIdx >= visibleRange.start && targetIdx <= visibleRange.end && targetIdx < activeData.length) ? targetIdx : -1;
}

function refreshHoverSelection() {
    hoverRAF = null;
    if (pendingHoverIdx < 0 || pendingHoverIdx === state.lockIdx) return;
    setLockIdx(pendingHoverIdx);
    pendingHoverIdx = -1;
    safeUpdateSidebar();
    updateCrosshairOverlay();
}

function resetHoverSelectionToLatest() {
    if (state.isFrozen) return;
    const activeData = getActiveData();
    if (!activeData || !activeData.length) return;
    const latestIdx = activeData.length - 1;
    pendingHoverIdx = -1;
    if (hoverRAF) {
        cancelAnimationFrame(hoverRAF);
        hoverRAF = null;
    }
    if (hoverSidebarTimer) {
        clearTimeout(hoverSidebarTimer);
        hoverSidebarTimer = null;
    }
    if (state.lockIdx === latestIdx) { updateFreezeBadge(); updateCrosshairOverlay(); return; }
    setLockIdx(latestIdx);
    resetViewportToLatest(activeData);
    safeUpdateSidebar();
    updateFreezeBadge();
    updateCrosshairOverlay();
}

function getChartPanBarWidth() {
    const chart = state.charts.main;
    const labels = chart?.data?.labels || [];
    const xScale = chart?.scales?.x;
    if (!labels.length || !xScale) return 0;
    const width = xScale.width || Math.max(0, (xScale.right || 0) - (xScale.left || 0));
    return width > 0 ? width / labels.length : 0;
}

function applyChartDragPan(force = false) {
    chartDragPanRAF = 0;
    if (!chartDragPan) return;
    const barWidth = chartDragPan.barWidth;
    if (!barWidth) return;
    const rawDelta = chartDragPan.currentX - chartDragPan.lastAppliedX;
    const deltaBars = Math.trunc(rawDelta / barWidth);
    if (!force && deltaBars === 0) return;
    if (deltaBars === 0) return;

    const activeData = getActiveData();
    if (!activeData || !activeData.length) return;
    if (panViewportByBars(deltaBars, activeData)) {
        chartDragPan.lastAppliedX += deltaBars * barWidth;
        chartDragPan.didPan = true;
        clearStaleTooltips();
        drawViewport();
        }
}

function startChartDragPan(event) {
    if (event?.button != null && event.button !== 0) return;
    const activeData = getActiveData();
    if (!activeData || activeData.length <= getViewportLength()) return;
    const barWidth = getChartPanBarWidth();
    if (!barWidth) return;

    cancelPendingChartHoverSelection();
    chartDragPan = {
        startX: event.clientX,
        startY: event.clientY,
        currentX: event.clientX,
        lastAppliedX: event.clientX,
        barWidth,
        didMove: false,
        didPan: false,
        target: event.currentTarget || null,
        pointerId: event.pointerId,
        pointerCaptured: false
    };
}

function moveChartDragPan(event) {
    if (!chartDragPan) return;
    chartDragPan.currentX = event.clientX;
    const deltaX = chartDragPan.currentX - chartDragPan.startX;
    const deltaY = event.clientY - chartDragPan.startY;
    const threshold = Math.max(8, chartDragPan.barWidth / 3);
    if (!chartDragPan.pointerCaptured && Math.abs(deltaY) >= 8 && Math.abs(deltaY) > Math.abs(deltaX)) {
        chartDragPan = null;
        return;
    }
    if (!chartDragPan.pointerCaptured && Math.abs(deltaX) >= threshold) {
        chartDragPan.didMove = true;
        chartDragPan.pointerCaptured = true;
        if (chartDragPan.target?.setPointerCapture && chartDragPan.pointerId != null) {
            chartDragPan.target.setPointerCapture(chartDragPan.pointerId);
        }
        getChartDragMainBox(chartDragPan.target)?.classList?.add('drag-panning');
    }
    if (!chartDragPan.pointerCaptured) return;
    if (!chartDragPanRAF) chartDragPanRAF = requestAnimationFrame(() => applyChartDragPan(false));
    event?.preventDefault?.();
}

function finishChartDragPan(event) {
    if (!chartDragPan) return;
    const target = chartDragPan.target || event?.currentTarget;
    applyChartDragPan(true);
    if (chartDragPan.pointerCaptured && target?.releasePointerCapture && event?.pointerId != null) {
        try { target.releasePointerCapture(event.pointerId); } catch(e) {}
    }
    getChartDragMainBox(target)?.classList?.remove('drag-panning');
    clearChartDragPreview();
    if (chartDragPan.didPan) {
        suppressChartHoverSelection();
        safeUpdateSidebar();
        updateFreezeBadge();
        updateCrosshairOverlay();
    } else if (chartDragPan.didMove) {
        suppressChartHoverSelection();
    }
    chartDragPan = null;
}

function getChartDragMainBox(target) {
    return target?.closest?.('.main-chart-box') || document.querySelector('.main-chart-box');
}

function handleChartWheelPan(event) {
    const deltaX = Number(event?.deltaX) || 0;
    if (Math.abs(deltaX) < 1 || Math.abs(deltaX) < Math.abs(Number(event?.deltaY) || 0)) return;
    event?.preventDefault?.();

    const activeData = getActiveData();
    if (!activeData || activeData.length <= getViewportLength()) return;
    const barWidth = getChartPanBarWidth();
    if (!barWidth) return;
    const deltaBars = Math.trunc(deltaX / barWidth);
    if (deltaBars === 0) return;

    cancelPendingChartHoverSelection();
    if (panViewportByBars(deltaBars, activeData)) {
        suppressChartHoverSelection();
        clearStaleTooltips();
        drawViewport();
        safeUpdateSidebar();
        updateFreezeBadge();
        updateCrosshairOverlay();
    } else {
        suppressChartHoverSelection();
    }
}

function bindChartDragPan() {
    if (chartDragPanBound) return;
    const target = document.querySelector('.integrated-container');
    if (!target) return;
    target.addEventListener('pointerdown', startChartDragPan);
    target.addEventListener('pointermove', moveChartDragPan);
    target.addEventListener('pointerup', finishChartDragPan);
    target.addEventListener('pointercancel', finishChartDragPan);
    target.addEventListener('lostpointercapture', finishChartDragPan);
    target.addEventListener('mousedown', startChartDragPan);
    target.addEventListener('wheel', handleChartWheelPan, { passive: false });
    document.addEventListener('mousemove', moveChartDragPan);
    document.addEventListener('mouseup', finishChartDragPan);
    chartDragPanBound = true;
}

function bindChartPointerReset() {
    if (chartPointerResetBound) return;
    const container = document.querySelector('.integrated-container');
    if (!container) return;
    container.addEventListener('mouseleave', () => {
        resetHoverSelectionToLatest();
    });
    chartPointerResetBound = true;
}

function handleChartHover(e, els) {
    if (chartDragPan) return;
    if (Date.now() < chartHoverSuppressUntil) return;
    
    if (els && els.length) {
        const activeData = getActiveData(); if (!activeData) return;
        const ti = resolveVisibleDataIndex(activeData, els[0].index);
        if (ti >= 0 && state.lockIdx !== ti) {
            setLockIdx(ti);
            // 十字线同步更新，零延迟跟随鼠标
            updateCrosshairOverlay();
            updateFreezeBadge();
            // 侧边栏 DOM 更新节流，避免鼠标滑过多根 K 线时每帧重排。
            scheduleHoverSidebarUpdate();
        }
    }
}

function draw() {
    const perfTrace = PERF.start('draw', { id: state.id, mode: state.mode, period: state.period, range: state.range });
    bindChartPointerReset();
    bindChartDragPan();
    document.querySelectorAll('.empty-hint').forEach(e => e.remove());
    const currentFd = getActiveData(); 
    if(!currentFd || !currentFd.length) { clearCharts(); updateFreezeBadge(); PERF.end(perfTrace, { status: 'empty' }); return; }
    
    updateAllIndicators();
    PERF.mark(perfTrace, 'indicators');
    renderChartViewport(perfTrace);
}

function drawViewport() {
    const perfTrace = PERF.start('drawViewport', { id: state.id, mode: state.mode, period: state.period, range: state.range });
    bindChartPointerReset();
    bindChartDragPan();
    document.querySelectorAll('.empty-hint').forEach(e => e.remove());
    const currentFd = getActiveData();
    if(!currentFd || !currentFd.length) { clearCharts(); updateFreezeBadge(); PERF.end(perfTrace, { status: 'empty' }); return; }
    if ((!state.indicators.macd || !state.indicators.kdj || !state.indicators.ma) && typeof updateAllIndicators === 'function') {
        updateAllIndicators();
        PERF.mark(perfTrace, 'indicators');
    }
    renderChartViewport(perfTrace);
}

function renderChartViewport(perfTrace) {
    const currentFd = getActiveData(); 
    if(!currentFd || !currentFd.length) { clearCharts(); updateFreezeBadge(); PERF.end(perfTrace, { status: 'empty' }); return; }
    const visibleRange = getVisibleRange(currentFd);
    const slice = currentFd.slice(visibleRange.start, visibleRange.end + 1);
    const labels = slice.map(d => d.date);
    
    const colorDim = getCssVar('--text-dim') || '#8b9eb7';
    const colorUpHex = getCssVar('--up-color') || '#f6465d';
    const colorDownHex = getCssVar('--down-color') || '#0ecb81';
    const colorBlueHex = getCssVar('--blue') || '#3765ed';
    
    const getLayout = () => ({ padding: { left: 8, right: 8, top: 10, bottom: 0 } });
    const getYScale = (isVol = false) => ({
        position: 'right', 
        beginAtZero: isVol ? true : undefined,
        grid: { color: 'rgba(255,255,255,0.04)' }, 
        ticks: { 
            color: colorDim, 
            font: { family: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace', size: 10 },
            padding: 12,
            callback: isVol ? (v => v >= 100000000 ? (v / 100000000).toFixed(1) + '亿' : (v >= 10000 ? (v / 10000).toFixed(0) + '万' : v)) : undefined
        }, 
        afterFit: (scale) => { scale.width = 60; } 
    });

    const getBaseOptions = () => ({
        responsive: true, 
        maintainAspectRatio: false, 
        animation: false, 
        layout: getLayout(), 
        interaction: { mode: 'index', intersect: false },
        onHover: handleChartHover
    });
    
    const currentScope = `${state.id}_${state.period}`;
    const uc = (k, id, cfg) => {
        const el = document.getElementById(id); 
        if(!el) return;
        
        let existingChart = Chart.getChart(id);
        // 图表类型变更或 scope 变更时必须销毁重建，否则 scale 配置不会正确初始化
        if (existingChart && (existingChart.canvas.dataset.scope !== currentScope || existingChart.config.type !== cfg.type)) {
            existingChart.destroy();
            existingChart = null;
        }
        
        if (existingChart) { 
            existingChart.data = cfg.data; 
            existingChart.options = cfg.options; 
            existingChart.update('none'); 
            state.charts[k] = existingChart; 
        } else { 
            state.charts[k] = new Chart(el, cfg); 
            el.dataset.scope = currentScope;
        }
    };

    const ds = state.activeMAs.map(n => ({ 
        label: `MA${n}`, data: state.indicators.ma?.[n]?.slice(visibleRange.start, visibleRange.end + 1) || [], 
        borderColor: MA_COLORS[n], borderWidth: 1.2, pointRadius: 0, order: 1, 
        isCandle: false, candleData: null, tension: 0.1 
    }));
    
    ds.push({ 
        label: 'KLine', isCandle: true, 
        candleData: slice.map(d => ({o: d.open, h: d.high, l: d.low, c: d.close})), 
        data: slice.map(d => d.close), 
        borderColor: 'transparent', pointRadius: 0, order: 0
    });

    const mainOpts = getBaseOptions();
    mainOpts.plugins = { legend: { display: false }, tooltip: { enabled: false } };
    mainOpts.scales = { x: { display: false, type: 'category', offset: false, bounds: 'ticks', grid: { offset: false } }, y: getYScale() };
    const visiblePriceValues = slice.flatMap(d => [d.low, d.high]).filter(Number.isFinite);
    state.activeMAs.forEach(n => {
        const values = state.indicators.ma?.[n]?.slice(visibleRange.start, visibleRange.end + 1) || [];
        visiblePriceValues.push(...values.filter(Number.isFinite));
    });
    if (visiblePriceValues.length) {
        const priceMin = Math.min(...visiblePriceValues);
        const priceMax = Math.max(...visiblePriceValues);
        const priceSpread = Math.max(priceMax - priceMin, Math.abs(priceMax) * 0.01, 0.01);
        const pricePad = priceSpread * 0.1;
        mainOpts.scales.y.min = priceMin - pricePad;
        mainOpts.scales.y.max = priceMax + pricePad;
    }
    uc('main', 'mainChart', { type: 'line', data: { labels, datasets: ds }, options: mainOpts, plugins: [localAlignPlugin, bsMarkerPlugin, freezePlugin] });

    if (shouldRenderCompactMainChartOnly()) {
        clearSecondaryChartInstances();
        PERF.end(perfTrace, { points: slice.length, charts: 'main-only' });
        updateFreezeBadge();
        updateCrosshairOverlay();
        return;
    }
    
    const volOpts = getBaseOptions();
    volOpts.plugins = { legend: { display: false }, tooltip: { enabled: false } };
    volOpts.scales = { x: { display: false, type: 'category', offset: false, bounds: 'ticks', grid: { offset: false } }, y: getYScale(true) };
    // 成交量柱子用 plugin 手绘，data 全是 null，Chart.js 看不到实际 vol 值，需手动设 y 轴范围
    const volMax = Math.max(...slice.map(d => d.vol));
    volOpts.scales.y.min = 0;
    if (volMax > 0) volOpts.scales.y.max = Math.ceil(volMax * 1.1);
    uc('vol', 'volumeChart', { type: 'line', data: { labels, datasets: [{ isVolData: true, volData: slice.map(d => ({ vol: d.vol, isUp: d.close >= d.open })), data: slice.map(() => null), borderColor: 'transparent', pointRadius: 0 }] }, options: volOpts, plugins: [volumeBarPlugin, freezePlugin] });
    
    if(state.indicators.macd) {
        const md = state.indicators.macd;
        const macdOpts = getBaseOptions();
        macdOpts.plugins = { legend: { display: false }, tooltip: { enabled: false } };
        macdOpts.scales = { x: { display: false, type: 'category', offset: false, bounds: 'ticks', grid: { offset: false } }, y: getYScale() };
        // 让 y 轴范围同时覆盖 diff/dea 线和 bar 柱子，否则柱子被压缩成1-2像素
        const macdBarArr = md.bar.slice(visibleRange.start, visibleRange.end + 1).filter(v => v != null);
        if (macdBarArr.length) {
            const allY = [...md.diff.slice(visibleRange.start, visibleRange.end + 1), ...md.dea.slice(visibleRange.start, visibleRange.end + 1), ...macdBarArr];
            const yMin = Math.min(...allY.filter(v => v != null));
            const yMax = Math.max(...allY.filter(v => v != null));
            const spread = Math.abs(yMax - yMin);
            const pad = Math.max(spread * 0.1, Math.max(Math.abs(yMin), Math.abs(yMax)) * 0.06, 0.02);
            macdOpts.scales.y.min = yMin - pad;
            macdOpts.scales.y.max = yMax + pad;
        }
        uc('macd', 'macdChart', { 
            type: 'line', 
            data: { labels, datasets: [ { data: md.diff.slice(visibleRange.start, visibleRange.end + 1), borderColor: colorBlueHex, borderWidth: 1, pointRadius: 0, tension: 0.1 }, { data: md.dea.slice(visibleRange.start, visibleRange.end + 1), borderColor: '#f5a623', borderWidth: 1, pointRadius: 0, tension: 0.1 }, { isMacdBar: true, macdBarData: md.bar.slice(visibleRange.start, visibleRange.end + 1), data: md.bar.slice(visibleRange.start, visibleRange.end + 1).map(() => null), borderColor: 'transparent', pointRadius: 0 } ] }, 
            options: macdOpts, plugins: [macdBarPlugin, freezePlugin] 
        });
    }
    
    if(state.indicators.kdj) {
        const kd = state.indicators.kdj;
        const kdjOpts = getBaseOptions();
        kdjOpts.plugins = { legend: { display: false }, tooltip: { enabled: false } };
        kdjOpts.scales = { x: { display: false, type: 'category', offset: false, bounds: 'ticks', grid: { offset: false } }, y: getYScale() };
        uc('kdj', 'kdjChart', { 
            type: 'line', 
            data: { labels, datasets: [ { label: 'K', data: kd.k.slice(visibleRange.start, visibleRange.end + 1), borderColor: '#f8fafc', borderWidth: 1, pointRadius: 0, tension: 0.1 }, { label: 'D', data: kd.d.slice(visibleRange.start, visibleRange.end + 1), borderColor: '#f5a623', borderWidth: 1, pointRadius: 0, tension: 0.1 }, { label: 'J', data: kd.j.slice(visibleRange.start, visibleRange.end + 1), borderColor: '#8b5cf6', borderWidth: 1, pointRadius: 0, tension: 0.1 } ] }, 
            options: kdjOpts, plugins: [freezePlugin]
        });
    }
    PERF.end(perfTrace, { points: slice.length });
    updateFreezeBadge();
    updateCrosshairOverlay();
}

function getStockEvidenceCopy(meta, decision, displayExitLevel, guardHint) {
    const position = decision?.position ?? 0;
    const action = decision?.simpleAction || '';
    const scoreReset = meta?.inCooldown
        || ['强离场', '清仓防守'].includes(decision?.exit?.level)
        || ['清仓离场', '规避风险'].includes(action);
    const scoreText = `${scoreReset ? 0 : (meta?.windowScore ?? 0)}/${STRATEGY?.buyThreshold ?? '-'}`;
    const previousPosition = Number(decision?.prevAdv) || 0;
    const marketGate = decision?.marketGate || {};
    const signalCause = getSignalCauseSummary(meta);
    const causeText = signalCause.text || '近窗有效信号';

    let marketHint = '核心建仓门禁开放；是否开仓、持有、减仓或离场仍由标的自身信号决定。';
    if (marketGate.type === 'increase-capped') {
        const tierText = marketGate.strengthTier === 'independent' ? '标的自身独立走强' : '普通机会';
        marketHint = `核心宽基偏弱；${tierText}新增风险上限为${marketGate.cap}%，当前仓位不会因宽基状态被动降低。`;
    }
    else if (marketGate.type === 'wave-expiry-b11-exception') marketHint = '核心宽基偏弱，但本次属于到期防守观察成功后的新B11接管，只允许已有30%增加20%波段仓；普通机会30%上限仍对其他事件生效。';
    else if (marketGate.type === 'entry-blocked') marketHint = '核心宽基数据未补齐，本次开仓被暂停。';
    else if (decision?.market?.label === '核心宽基偏弱') {
        const tierText = marketGate.strengthTier === 'independent' ? '标的自身独立走强' : '普通机会';
        marketHint = `核心宽基偏弱；${tierText}新增风险上限为${marketGate.cap ?? 30}%，本次未触发额外截断。`;
    }
    else if (['环境未知', '环境待确认'].includes(decision?.market?.label)) marketHint = '三项核心宽基数据未补齐，暂停开新仓和加仓；已有仓位仍按自身信号处理。';

    let signalHint = scoreReset
        ? `离场后积分：此前买入依据已失效，当前按 ${scoreText} 处理。`
        : `未买入原因：买入积分只有 ${scoreText}，没有达到当前策略要求。`;
    if (!scoreReset && previousPosition === 0 && position > 0) {
        signalHint = `买入依据：${causeText}使买入积分达到 ${scoreText}，本次由空仓转为持仓。`;
    } else if (!scoreReset && position > 0 && (meta?.windowScore ?? 0) >= (STRATEGY?.buyThreshold ?? Infinity)) {
        signalHint = `持仓依据：${causeText}使买入积分维持在 ${scoreText}，当前持仓依据仍在。`;
    } else if (!scoreReset && position > 0) {
        signalHint = `观察依据：买入积分为 ${scoreText}，当前仓位主要依赖已有趋势和风控约束。`;
    }

    const structureDefenseText = formatPriceLevel(decision?.b11StructureDefense?.structureLevel);
    const hasStructureDefense = structureDefenseText !== '--';
    const stopText = hasStructureDefense ? structureDefenseText : formatPriceLevel(decision?.risk?.stop);
    const riskText = guardHint || (displayExitLevel && displayExitLevel !== '无明确离场' ? displayExitLevel : '暂无额外风险压制');
    const guardAction = stopText === '--'
        ? `风险依据：${riskText}。`
        : `风险依据：${riskText}；${hasStructureDefense ? '结构防守位' : '防守位'} ${stopText}。`;

    return { marketHint, signalHint, guardHint: guardAction, scoreText };
}

function getIndexEvidenceCopy(meta, decision, displayExitLevel, guardHint) {
    const position = decision?.position ?? 0;
    const action = decision?.simpleAction || '';
    const scoreReset = meta?.inCooldown
        || ['强离场', '清仓防守'].includes(decision?.exit?.level)
        || ['清仓离场', '规避风险'].includes(action);
    const scoreText = `${scoreReset ? 0 : (meta?.windowScore ?? 0)}/${STRATEGY?.buyThreshold ?? '-'}`;
    const previousPosition = Number(decision?.prevAdv) || 0;
    const marketGate = decision?.marketGate || {};
    const signalCause = getSignalCauseSummary(meta);
    const causeText = signalCause.text || '近窗有效指数信号';

    let marketHint = '核心宽基增仓环境开放；当前指数是否提高风险仓位，继续由自身动能和风险决定。';
    if (marketGate.type === 'increase-capped') {
        const tierText = marketGate.strengthTier === 'independent' ? '指数自身独立走强' : '普通机会';
        marketHint = `核心宽基偏弱；${tierText}新增风险上限为${marketGate.cap}%，已有风险仓位不会因此被动压缩。`;
    }
    else if (marketGate.type === 'entry-blocked') marketHint = '核心宽基数据未补齐，本次暂停增加市场风险暴露。';
    else if (decision?.market?.label === '核心宽基偏弱') {
        const tierText = marketGate.strengthTier === 'independent' ? '指数自身独立走强' : '普通机会';
        marketHint = `核心宽基偏弱；${tierText}新增风险上限为${marketGate.cap ?? 30}%，本次未触发额外截断。`;
    }
    else if (['环境未知', '环境待确认'].includes(decision?.market?.label)) marketHint = '三项核心宽基数据未补齐，暂停增加市场风险；已有风险仓位仍按指数自身信号处理。';

    let signalHint = scoreReset
        ? `离场后动能：此前动能依据已失效，当前按 ${scoreText} 处理。`
        : `动能不足：指数动能积分只有 ${scoreText}，没有达到当前策略要求。`;
    if (!scoreReset && previousPosition === 0 && position > 0) {
        signalHint = `动能依据：${causeText}使指数动能积分达到 ${scoreText}，支持开始增加风险暴露。`;
    } else if (!scoreReset && position > 0 && (meta?.windowScore ?? 0) >= (STRATEGY?.buyThreshold ?? Infinity)) {
        signalHint = `维持依据：${causeText}使指数动能积分维持在 ${scoreText}，当前风险仓位仍有动能支持。`;
    } else if (!scoreReset && position > 0) {
        signalHint = `观察依据：指数动能积分为 ${scoreText}，当前风险仓位主要依赖已有趋势和风控约束。`;
    }

    const stopText = formatPriceLevel(decision?.risk?.stop);
    const riskText = guardHint || (displayExitLevel && displayExitLevel !== '无明确离场' ? displayExitLevel : '暂无额外风险压制');
    const guardAction = stopText === '--'
        ? `市场风险：${riskText}。`
        : `市场风险：${riskText}；指数防守位 ${stopText}。`;

    return { marketHint, signalHint, guardHint: guardAction, scoreText };
}

function getNoviceEvidenceCopy(meta, decision, displayExitLevel, guardHint, mode = 'stock') {
    return mode === 'index'
        ? getIndexEvidenceCopy(meta, decision, displayExitLevel, guardHint)
        : getStockEvidenceCopy(meta, decision, displayExitLevel, guardHint);
}

function getEffectiveDisplayModeForItem(item, id = state.id) {
    const display = state.displayStatus?.[id] || {};
    const mode = display.mode || 'unknown';
    if (item?._isLive) {
        if (mode === 'post-close-pending' && item._isCachedLive) return 'post-close-pending';
        if (mode === 'cached-live-overlay' && item._isCachedLive) return 'cached-live-overlay';
        if (mode === 'live-overlay' || mode === 'cached-live-overlay' || mode === 'post-close-pending') return mode;
        return item._isCachedLive ? 'cached-live-overlay' : 'live-overlay';
    }
    if (mode === 'live-overlay' || mode === 'cached-live-overlay' || mode === 'post-close-pending') {
        const lastConfirmedDate = state.rawData?.[id]?.[state.rawData[id].length - 1]?.date || state.confirmedStatus?.[id]?.lastDate || '';
        if (item?.date && (!lastConfirmedDate || item.date <= lastConfirmedDate)) return 'confirmed';
    }
    return mode;
}

function renderStatusSmokeAttrs(item, id = state.id, source = '') {
    const display = state.displayStatus?.[id] || {};
    const confirmed = state.confirmedStatus?.[id] || {};
    const effectiveMode = getEffectiveDisplayModeForItem(item, id);
    const lastConfirmedDate = state.rawData?.[id]?.[state.rawData[id].length - 1]?.date || confirmed.lastDate || '';
    const attrs = {
        'data-dg-source': source,
        'data-dg-display-mode': effectiveMode || 'unknown',
        'data-dg-display-reason': effectiveMode === display.mode ? (display.reason || '') : '',
        'data-dg-confirmed-status': confirmed.status || 'unknown',
        'data-dg-confirmed-date': lastConfirmedDate,
        'data-dg-item-date': item?.date || '',
        'data-dg-item-live': item?._isLive ? 'true' : 'false',
        'data-dg-live-cached': item?._isCachedLive ? 'true' : 'false',
        'data-dg-live-cache-age-ms': Number.isFinite(Number(display.cacheAgeMs)) ? String(Math.max(0, Math.round(Number(display.cacheAgeMs)))) : ''
    };
    return Object.entries(attrs)
        .map(([key, value]) => `${key}="${escapeHTML(value)}"`)
        .join(' ');
}

function renderStatusTooltipAttrs(detail = '') {
    const safeDetail = escapeHTML(detail);
    return `title="${safeDetail}" data-tooltip="${safeDetail}" aria-label="${safeDetail}" tabindex="0"`;
}

function generateAnalysisHTML(idx, full, meta) {
    const fmt = v => v ? v.toFixed(2) : '--';
    if (!full || !full[idx]) return '';

    const isIndexMode = state.mode === 'index';
    if(state.period === 'weekly') {
        const wk = getWeeklyDirectionContext(idx, full, state.indicators);
        const wkClass = wk.direction === '周线多头' ? 'panel-bull' : (wk.direction === '周线空头' ? 'panel-bear' : 'panel-info');
        const wkTextClass = wk.direction === '周线多头' ? 'text-bull' : (wk.direction === '周线空头' ? 'text-bear' : 'text-info');
        const wkRepairTextClass = wk.repair === '已修复' ? 'text-bull' : (wk.repair === '修复中' ? 'text-info' : 'text-dim');

        return `
            <div class="action-panel ${wkClass}">
                <div class="block-title weekly-filter-title">宏观趋势过滤</div>
                <div class="action-line">
                    <div class="action-name ${wkTextClass}">${wk.direction}</div>
                </div>
                <div class="action-sub">${escapeHTML(wk.directionReason)}<br/>${escapeHTML(wk.dailyImpact)}</div>
            </div>
            <div class="terminal-block">
                <div class="block-title">周线关键位</div>
                <div class="decision-evidence-list weekly-context-list">
                    <div class="decision-evidence-row">
                        <div class="decision-evidence-head">
                            <span>当前位置</span>
                            <strong class="text-main">${escapeHTML(wk.position)}</strong>
                        </div>
                    </div>
                    <div class="decision-evidence-row">
                        <div class="decision-evidence-head">
                            <span>趋势修复</span>
                            <strong class="${wkRepairTextClass}">${escapeHTML(wk.repair)}</strong>
                        </div>
                    </div>
                </div>
                <div class="level-line weekly-level-line">
                    <div class="level-pill"><span>20周线 (中期线)</span><strong class="mono">${fmt(wk.ma20)}</strong></div>
                    <div class="level-pill"><span>60周线 (长期线)</span><strong class="mono">${fmt(wk.ma60)}</strong></div>
                    <div class="level-pill"><span>周线防守区</span><strong class="mono">${fmt(wk.support)}</strong></div>
                    <div class="level-pill"><span>周线压力区</span><strong class="mono">${fmt(wk.pressure)}</strong></div>
                </div>
            </div>
            <div class="risk-note">周线级别为主力中长线风向标，不输出直接买卖积分。用于过滤日线噪音，辅助判断当前为反弹还是主升浪。</div>
        `;
    }

    const decision = full[idx]?._decision; 
    if (!decision) return ''; 
    const noviceSummary = getNoviceDecisionSummary(meta, decision, state.mode);
    const riskFlags = decision.risk.flags.length ? decision.risk.flags.join(' / ') : '处于安全空间，无明显偏离';
    const diagnosis = state.mode === 'stock' ? getHoldingDiagnosis(idx, full, state.indicators, meta, decision) : null;
    const exitEvidence = getExitSignalEvidence(meta, decision);
    const hasExitContext = decision.exit.level !== '无明确离场' || exitEvidence.direct.length || exitEvidence.windowDesc !== '近窗内无额外离场形态';
    const displayExitLevel = getExitDisplayLevel(decision.exit.level, hasExitContext);
    const isDirectExitContext = decision.exit.level !== '无明确离场' || exitEvidence.direct.length;
    const guardValue = hasExitContext ? displayExitLevel : decision.risk.level;
    const guardTextClass = isDirectExitContext || decision.risk.score < 60 ? 'text-warn' : 'text-main';
    const guardSignals = [
        ...exitEvidence.direct,
        ...(exitEvidence.window || []).filter(sig => !exitEvidence.direct.includes(sig))
    ].slice(0, 3);
    const guardSignalSummary = guardSignals.length ? `信号 ${guardSignals.join(' / ')}` : '';
    const guardHoldingText = diagnosis ? (diagnosis.displayStatus || diagnosis.status) : '';
    const b11StructureText = Number.isFinite(Number(decision?.b11StructureDefense?.structureLevel))
        ? `B11结构防守 ${Number(decision.b11StructureDefense.structureLevel).toFixed(2)}`
        : '';
    const guardHint = [riskFlags, guardSignalSummary, b11StructureText, guardHoldingText].filter(Boolean).join(' · ');
    const noviceEvidence = getNoviceEvidenceCopy(meta, decision, displayExitLevel, guardHint, state.mode);

    let panelClass = 'panel-neutral';
    const a = decision.simpleAction;
    
    if (['清仓离场', '执行离场', '规避风险'].includes(a)) { panelClass = 'panel-bear'; } 
    else if (['防守减仓', '谨慎持有'].includes(a)) { panelClass = 'panel-warn'; } 
    else if (['轻仓建仓', '缓慢加仓', '轻仓持有'].includes(a)) { panelClass = 'panel-info'; } 
    else if (['积极建仓', '顺势加仓', '顺势抱单', '积极持有'].includes(a)) { panelClass = 'panel-bull'; }

    const cooldownHtml = meta.inCooldown ? '<div class="cooldown-ribbon">防守冷静期</div>' : '';
    const titleHtml = getConclusionTitleHTML(isIndexMode);
    const evidenceTitle1 = isIndexMode ? '核心市场环境' : '核心建仓门禁';
    const evidenceTitle2 = isIndexMode ? '指数自身动能' : '个股信号';
    const evidenceTitle3 = isIndexMode ? '市场风险/防守' : '风控/防守';
    const positionLabel = isIndexMode ? '当前风险仓位' : '策略参考仓位';
    const positionWhyLabel = `为什么是${noviceSummary.positionText}`;
    const whyText = noviceSummary.why || noviceSummary.reason;
    const positionWhyText = noviceSummary.positionWhy || noviceSummary.positionExplanation;
    const nextFocusText = noviceSummary.nextFocus || noviceSummary.invalidCondition;
    const conclusionCopy = value => {
        const text = String(value ?? '').trim();
        return text && /[。！？；]$/.test(text) ? text : `${text}。`;
    };
    const hasB11StructureDefense = Number.isFinite(Number(decision?.b11StructureDefense?.structureLevel));
    const visibleDefenseLabel = hasB11StructureDefense ? '结构防守位' : '防守位';
    const visibleDefenseLevel = hasB11StructureDefense ? decision.b11StructureDefense.structureLevel : decision.risk.stop;

    const actionPanelHtml = `
        <div class="action-panel ${panelClass}">
            ${cooldownHtml}
            <div class="conclusion-heading-row">
                <div class="conclusion-title-row">
                    <div class="block-title conclusion-block-title">${titleHtml}</div>
                </div>
                <div class="kicker text-main conclusion-state-kicker">${escapeHTML(noviceSummary.state)}</div>
            </div>
            <div class="action-line">
                <div class="action-name ${decision.simpleColorClass}">${escapeHTML(noviceSummary.action)}</div>
                <div class="action-cap">
                    <span class="text-dim">${positionLabel}</span>
                    <strong class="mono text-main">${escapeHTML(noviceSummary.positionText)}</strong>
                </div>
            </div>
            <div class="decision-reason-block">
                <div class="decision-reason-row">
                    <span>为什么这么做：</span>
                    <div>${escapeHTML(conclusionCopy(whyText))}</div>
                </div>
                <div class="decision-reason-row">
                    <span>${escapeHTML(positionWhyLabel)}：</span>
                    <div>${escapeHTML(conclusionCopy(positionWhyText))}</div>
                </div>
                <div class="decision-reason-row">
                    <span>接下来关注：</span>
                    <div>${escapeHTML(conclusionCopy(nextFocusText))}</div>
                </div>
            </div>
            <div class="level-line">
                <div class="level-pill">
                    <span>${visibleDefenseLabel}</span><strong class="mono">${fmt(visibleDefenseLevel)}</strong>
                </div>
                <div class="level-pill">
                    <span>压力区</span><strong class="mono">${fmt(decision.risk.pressure)}</strong>
                </div>
            </div>
        </div>
    `;

    const evidencePanelHtml = `
        <div class="terminal-block decision-evidence-panel">
            <div class="block-title">关键推导依据</div>
            <div class="decision-evidence-list">
                <div class="decision-evidence-row">
                    <div class="decision-evidence-head">
                        <span>${evidenceTitle1}</span>
                        <strong class="${decision.market.cls === 'bull' ? 'text-bull' : (decision.market.cls === 'bear' ? 'text-bear' : 'text-main')}">${escapeHTML(decision.market.label)}</strong>
                    </div>
                    <div class="decision-evidence-copy">${escapeHTML(noviceEvidence.marketHint)}</div>
                </div>
                <div class="decision-evidence-row">
                    <div class="decision-evidence-head">
                        <span>${evidenceTitle2}</span>
                        <strong class="text-main mono">${escapeHTML(noviceEvidence.scoreText)}</strong>
                    </div>
                    <div class="decision-evidence-copy">${escapeHTML(noviceEvidence.signalHint)}</div>
                </div>
                <div class="decision-evidence-row">
                    <div class="decision-evidence-head">
                        <span>${evidenceTitle3}</span>
                        <strong class="${guardTextClass}">${escapeHTML(guardValue)}</strong>
                    </div>
                    <div class="decision-evidence-copy">${escapeHTML(noviceEvidence.guardHint)}</div>
                </div>
            </div>
        </div>
    `;

    return `
        ${actionPanelHtml}
        ${evidencePanelHtml}
        <div class="risk-note">系统按 SOP 3.5.4 规则层层递推，结论仅用于辅助决策，非投资理财建议。</div>
    `;
}

function safeUpdateSidebar() {
    const perfTrace = PERF.start('sidebar', { id: state.id, mode: state.mode, period: state.period });
    const rd = getActiveData();
    if (rd && rd.length > 0) {
        const safeIdx = getSafeIndex(rd); 
        if (safeIdx < 0 || !rd[safeIdx]) { PERF.end(perfTrace, { status: 'invalid-index' }); return; }
        setLockIdx(safeIdx);
        
        const item = rd[safeIdx];
        let decision = item._decision || null;
        if ((!decision || item._strategy !== state.strategy || item._signalVersion !== SIGNAL_VERSION) && typeof updateAllIndicators === 'function') {
            updateAllIndicators(safeIdx);
            decision = item._decision || null;
        }
        const displayMode = state.displayStatus?.[state.id]?.mode || '';
        const cacheKey = [
            state.id,
            item.date,
            state.strategy,
            state.period,
            item.close,
            item.vol,
            displayMode,
            !!item._isLive,
            getDecisionSignature(decision),
            SIGNAL_VERSION,
            APP_BUILD
        ].join('_');
        
        if (state.mode === 'index') {
            updateLeftMarketContext(item.date);
            PERF.mark(perfTrace, 'left-context');
        }

        if (renderCache.has(cacheKey)) { 
            applySidebarHTML(renderCache.get(cacheKey), cacheKey); 
            updateNavCapsuleVisuals(safeIdx, rd.length); 
            PERF.end(perfTrace, { status: 'cache-hit', date: item.date });
            return; 
        }

        const prev = safeIdx > 0 ? rd[safeIdx - 1] : null;
        const htmlBundle = generateSidebarBundle(item, prev, safeIdx, rd);
        PERF.mark(perfTrace, 'bundle');
        
        if (renderCache.size >= SYS_CONFIG.RENDER_CACHE_SIZE) {
            renderCache.delete(renderCache.keys().next().value);
        }
        renderCache.set(cacheKey, htmlBundle);
        
        applySidebarHTML(htmlBundle, cacheKey);
        updateNavCapsuleVisuals(safeIdx, rd.length);
        PERF.end(perfTrace, { status: 'cache-miss', date: item.date });
    } else {
        applySidebarHTML({ priceHtml: '', analysisHtml: '', isHide: true });
        if (state.mode === 'index') { 
            const ctx = document.getElementById('leftMarketContext'); 
            if(ctx) ctx.innerHTML = ''; 
        }
        PERF.end(perfTrace, { status: 'empty-data' });
    }
}

function updateSidebarPriceOnly() {
    const rd = getActiveData();
    if (!rd || !rd.length) return;
    const safeIdx = getSafeIndex(rd);
    if (safeIdx < 0 || !rd[safeIdx]) return;
    const item = rd[safeIdx];
    const prev = safeIdx > 0 ? rd[safeIdx - 1] : null;
    const ch = item.close - (prev ? prev.close : item.open);
    const pct = (ch / (prev ? prev.close : item.open) * 100).toFixed(2);
    const cls = ch >= 0 ? 'up' : 'down';
    const fmt = v => !v ? '--' : (v >= 1e8 ? (v/1e8).toFixed(2)+'亿' : v >= 1e4 ? (v/1e4).toFixed(2)+'万' : v.toFixed(0));

    const cPrice = document.getElementById('cardPrice');
    if (!cPrice) return;

    // 辅助函数：只有值变了才更新文本 + pulse
    function diffUpdate(el, newVal, newCls) {
        if (!el) return;
        var oldText = el.textContent;
        var newText = String(newVal);
        if (oldText === newText) return; // 值没变，不操作
        el.textContent = newText;
        if (newCls) el.className = (el.className.split(' ').filter(c => c !== 'up' && c !== 'down').join(' ') + ' ' + newCls).trim();
        el.classList.add('price-pulse');
        setTimeout(function() { el.classList.remove('price-pulse'); }, 400);
    }

    // 价格
    diffUpdate(cPrice.querySelector('.price-main'), item.close.toFixed(2), cls);

    // 涨跌幅
    var subText = (ch >= 0 ? '+' : '') + ch.toFixed(2) + ' (' + (ch >= 0 ? '+' : '') + pct + '%)';
    var subEl = cPrice.querySelector('.price-sub');
    if (subEl) {
        if (subEl.textContent !== subText) {
            subEl.textContent = subText;
            subEl.className = 'price-sub mono ' + cls;
            subEl.classList.add('price-pulse');
            setTimeout(function() { subEl.classList.remove('price-pulse'); }, 400);
        }
    }

    // 今开 / 最高 / 最低 / 成交量
    var vals = cPrice.querySelectorAll('.data-box-row .val');
    if (vals.length >= 4) {
        diffUpdate(vals[0], item.open.toFixed(2));
        diffUpdate(vals[1], item.high.toFixed(2));
        diffUpdate(vals[2], item.low.toFixed(2));
        diffUpdate(vals[3], fmt(item.vol) + '手');
    }

    // 成交额
    diffUpdate(cPrice.querySelector('.amt-row .val'), fmt(item.amt));

    if (typeof updateDataStatusRefreshBadge === 'function') updateDataStatusRefreshBadge(item, state.id, rd);
}

function renderAnalysisPendingHTML(message = '信号正在同步，结论生成后会自动恢复。') {
    const isIndexMode = state.mode === 'index';
    const titleHtml = getConclusionTitleHTML(isIndexMode);
    return `
        <div class="action-panel panel-neutral analysis-pending-panel">
            <div class="conclusion-title-row">
                <div class="block-title conclusion-block-title">${titleHtml}</div>
            </div>
            <div class="action-line">
                <div class="action-name text-dim">分析同步中</div>
                <div class="action-cap">
                    <span class="text-dim">${isIndexMode ? '当前风险仓位' : '策略参考仓位'}</span>
                    <strong class="mono text-main">--</strong>
                </div>
            </div>
            <div class="decision-reason-block">
                <div class="decision-reason-row">
                    <span>为什么这么做：</span>
                    <div>${escapeHTML(message)}</div>
                </div>
                <div class="decision-reason-row">
                    <span>为什么是当前仓位：</span>
                    <div>等待信号同步完成后再计算。</div>
                </div>
                <div class="decision-reason-row">
                    <span>接下来关注：</span>
                    <div>等待信号同步完成后再确认。</div>
                </div>
            </div>
        </div>
    `;
}

function renderActiveSelectionStatus(status = 'loading') {
    const cfg = state.mode === 'index' && typeof getIndexConfig === 'function' ? getIndexConfig(state.id) : null;
    const target = typeof getActiveSecurityTarget === 'function' ? getActiveSecurityTarget() : null;
    const identity = cfg?.name || target?.name || state.stockId || state.id || '当前标的';
    const isError = status === 'unavailable';
    const stateText = isError ? '数据暂不可用' : '数据加载中';
    const detailText = isError
        ? '没有可用的确认历史 K 线，暂时无法生成行情图和策略结论。'
        : '正在同步确认历史 K 线。';
    const isIndexMode = state.mode === 'index';
    const titleHtml = getConclusionTitleHTML(isIndexMode);
    const priceHtml = `
        <div class="terminal-block price-panel">
            <div class="header-meta-row">
                <div class="price-header-identity mono text-dim"><span class="text-main">${escapeHTML(identity)}</span></div>
            </div>
            <div class="price-hero-compact">
                <div class="price-main mono text-dim">--</div>
                <div class="price-sub mono text-dim">${stateText}</div>
            </div>
        </div>
    `;
    const analysisHtml = `
        <div class="action-panel ${isError ? 'panel-warning analysis-error-panel' : 'panel-neutral analysis-pending-panel'}" role="${isError ? 'alert' : 'status'}">
            <div class="conclusion-title-row">
                <div class="block-title conclusion-block-title">${titleHtml}</div>
            </div>
            <div class="action-line">
                <div class="action-name text-dim">${stateText}</div>
                <div class="action-cap">
                    <span class="text-dim">${isIndexMode ? '当前风险仓位' : '策略参考仓位'}</span>
                    <strong class="mono text-main">--</strong>
                </div>
            </div>
            <div class="action-sub">${detailText}</div>
            ${isError ? '<button type="button" class="state-retry-action" onclick="handleUpdateData()">重新加载当前数据</button>' : ''}
        </div>
    `;
    applySidebarHTML({ priceHtml, analysisHtml, isHide: false }, `${state.mode}_${state.id}_selection_${status}`);

    const refreshBar = document.getElementById('lastRefreshBar');
    if (refreshBar) {
        refreshBar.style.display = 'none';
        const pill = refreshBar.querySelector('.data-status-pill');
        if (pill) pill.remove();
    }
}

function getSidebarCacheContextKey(cacheKey = '') {
    return String(cacheKey || '').split('_').slice(0, 4).join('_');
}

function normalizeSidebarAnalysisHTML(analysisHtml, existingHtml = '', cacheKey = '', previousCacheKey = '') {
    const next = String(analysisHtml || '').trim();
    if (next) return next;
    const existing = String(existingHtml || '').trim();
    const nextContext = getSidebarCacheContextKey(cacheKey);
    const prevContext = getSidebarCacheContextKey(previousCacheKey);
    if (existing && nextContext && prevContext && nextContext === prevContext) return existing;
    return renderAnalysisPendingHTML();
}

function ensureAnalysisPanelVisibleForRealtimeRefresh() {
    const cAnalysis = document.getElementById('cardAnalysis');
    if (!cAnalysis) return false;
    if (!cAnalysis.innerHTML || !cAnalysis.innerHTML.trim()) {
        cAnalysis.innerHTML = renderAnalysisPendingHTML();
        cAnalysis.dataset.ah = String(hashString32(cAnalysis.innerHTML));
        cAnalysis.style.display = 'flex';
        cAnalysis.style.flexDirection = 'column';
        safeUpdateSidebar();
        return true;
    }
    cAnalysis.style.display = 'flex';
    cAnalysis.style.flexDirection = 'column';
    return false;
}

function updateNavCapsuleVisuals(safeIdx, totalLen) {
    const btn = document.getElementById('btnResetLatest');
    if (btn) {
        if (isLatestNavActive(safeIdx, totalLen)) { 
            btn.classList.add('active'); 
            btn.classList.remove('is-history'); 
        } else { 
            btn.classList.remove('active'); 
            btn.classList.add('is-history'); 
        }
    }
}

function isLatestNavActive(safeIdx, totalLen) {
    return !state.isFrozen && safeIdx === totalLen - 1;
}

function applySidebarHTML(bundle, cacheKey = '') {
    const cPrice = document.getElementById('cardPrice');
    const cAnalysis = document.getElementById('cardAnalysis');
    if(!cPrice || !cAnalysis) return;

    if (bundle.isHide) {
        cPrice.style.display = 'none';
        cAnalysis.style.display = 'none';
        return;
    }

    cPrice.style.display = 'flex';
    cPrice.style.flexDirection = 'column';
    cAnalysis.style.display = 'flex';
    cAnalysis.style.flexDirection = 'column';

    if (cacheKey && cPrice.dataset.key === cacheKey) {
        updateDataStatusRefreshBadge();
        return;
    }

    var oldPriceEl = cPrice.querySelector('.price-main');
    var oldPrice = oldPriceEl ? parseFloat(oldPriceEl.textContent) : null;

    // 用 hash 比对，避免脆弱的 innerHTML.trim 字符串比较导致误刷
    var priceHtml = bundle.priceHtml || '';
    var analysisHtml = normalizeSidebarAnalysisHTML(bundle.analysisHtml, cAnalysis.innerHTML, cacheKey, cPrice.dataset.key || '');
    var priceHash = hashString32(priceHtml);
    var analysisHash = hashString32(analysisHtml);
    var prevPriceHash = parseInt(cPrice.dataset.ph || '0', 10);
    var prevAnalysisHash = parseInt(cAnalysis.dataset.ah || '0', 10);

    // 价格区：用淡入过渡防白闪
    if (priceHash !== prevPriceHash) {
        cPrice.style.opacity = '0';
        cPrice.innerHTML = priceHtml;
        cPrice.dataset.ph = String(priceHash);
        // 强制回流后恢复可见（浏览器会在下一帧渲染，不会看到空白帧）
        cPrice.offsetHeight; 
        cPrice.style.opacity = '';
    }

    // 分析区：同样用淡入过渡
    if (analysisHash !== prevAnalysisHash) {
        cAnalysis.style.opacity = '0';
        cAnalysis.innerHTML = analysisHtml;
        cAnalysis.dataset.ah = String(analysisHash);
        cAnalysis.offsetHeight;
        cAnalysis.style.opacity = '';
    }

    if (cacheKey) cPrice.dataset.key = cacheKey;

    var newPriceEl = cPrice.querySelector('.price-main');
    if (newPriceEl && oldPrice !== null && !isNaN(oldPrice)) {
        var newPrice = parseFloat(newPriceEl.textContent);
        if (!isNaN(newPrice) && newPrice !== oldPrice) {
            newPriceEl.classList.add('price-pulse');
            setTimeout(function() { newPriceEl.classList.remove('price-pulse'); }, 400);
        }
    }
    updateDataStatusRefreshBadge();
}

function getDataStatusBadge(item, id = state.id, full = getActiveData()) {
    const display = state.displayStatus?.[id] || {};
    const confirmed = state.confirmedStatus?.[id] || {};
    const effectiveMode = getEffectiveDisplayModeForItem(item, id);
    const lastConfirmedDate = state.rawData?.[id]?.[state.rawData[id].length - 1]?.date || confirmed.lastDate || '';
    const itemDate = item?.date || '';
    const isLiveOverlay = effectiveMode === 'live-overlay' || effectiveMode === 'cached-live-overlay' || effectiveMode === 'post-close-pending';
    const quoteOnly = effectiveMode === 'quote-only';
    const confirmedFresh = confirmed.status === 'fresh' || (!!lastConfirmedDate && lastConfirmedDate >= getExpectedConfirmedDate());

    if (isLiveOverlay) {
        if (effectiveMode === 'post-close-pending') {
            return {
                tone: 'warn',
                label: '盘后待确认',
                detail: '等收盘K线确认。'
            };
        }
        return {
            tone: 'info',
            label: effectiveMode === 'cached-live-overlay' ? '缓存盘中' : '盘中临时',
            detail: effectiveMode === 'cached-live-overlay'
                ? '沿用最近盘中数据。'
                : '实时价已进入图表。'
        };
    }
    if (quoteOnly) {
        return {
            tone: 'warn',
            label: '仅左侧报价',
            detail: '右侧仍按确认K线。'
        };
    }
    if (confirmed.status === 'failed') {
        return {
            tone: 'warn',
            label: '历史同步失败',
            detail: '正在使用本地缓存，等历史K线同步成功后再确认结论。'
        };
    }
    if (confirmed.status === 'stale' || !confirmedFresh) {
        return {
            tone: 'warn',
            label: '历史待补齐',
            detail: lastConfirmedDate ? `历史K线只确认到 ${lastConfirmedDate}，最新结论需等同步后确认。` : '历史K线还没同步完成，先不要把当前结论当最终状态。'
        };
    }
    if (itemDate && lastConfirmedDate && itemDate <= lastConfirmedDate) {
        return {
            tone: 'ok',
            label: '收盘确认',
            detail: '按确认历史计算。'
        };
    }
    return {
        tone: 'warn',
        label: '等待确认',
        detail: '历史K线状态还在确认中，先按提示谨慎查看。'
    };
}

function renderDataStatusRefreshBadge(item, id = state.id, full = getActiveData()) {
    const status = getDataStatusBadge(item, id, full);
    return `
        <span class="data-status-pill data-status-${status.tone}" ${renderStatusTooltipAttrs(status.detail)} ${renderStatusSmokeAttrs(item, id, 'refresh-bar')}>
            <span class="data-status-dot"></span>
            <span class="data-status-label">${escapeHTML(status.label)}</span>
        </span>
    `;
}

function updateDataStatusRefreshBadge(item = null, id = state.id, full = null) {
    const bar = document.getElementById('lastRefreshBar');
    if (!bar) return;
    const data = full || getActiveData();
    const idx = item ? -1 : getSafeIndex(data);
    const currentItem = item || (idx >= 0 && data ? data[idx] : null);
    const existing = bar.querySelector('.data-status-pill');
    if (!currentItem) {
        if (existing) existing.remove();
        return;
    }
    bar.style.display = 'flex';
    const html = renderDataStatusRefreshBadge(currentItem, id, data).trim();
    if (existing) {
        if (existing.outerHTML !== html) existing.outerHTML = html;
    } else if (typeof bar.insertAdjacentHTML === 'function') {
        bar.insertAdjacentHTML('beforeend', html);
    } else {
        bar.innerHTML = (bar.innerHTML || '') + html;
    }
}

function generateSidebarBundle(item, prev, safeIdx, rd) {
    if (!item) return { priceHtml: '', analysisHtml: '', isHide: true };
    
    const ch = item.close - (prev ? prev.close : item.open);
    const pct = (ch / (prev ? prev.close : item.open) * 100).toFixed(2);
    const cls = ch >= 0 ? 'up' : 'down';
    const activeSecurity = typeof getActiveSecurityTarget === 'function' ? getActiveSecurityTarget() : null;
    const pricePrecision = typeof getSecurityPricePrecision === 'function' ? getSecurityPricePrecision(activeSecurity || state.id) : 2;
    const formatPrice = (value) => Number.isFinite(Number(value)) ? Number(value).toFixed(pricePrecision) : '--';
    const formatUnit = (v) => !v ? '--' : (v >= 1e8 ? `${(v/1e8).toFixed(2)}亿` : v >= 1e4 ? `${(v/1e4).toFixed(2)}万` : v.toFixed(0));
    
    const headerIdentity = (() => {
        if (activeSecurity) {
            const visible = typeof getSecurityShortName === 'function' ? getSecurityShortName(activeSecurity) : activeSecurity.name;
            const title = `${activeSecurity.name || visible} · ${activeSecurity.code}`;
            return { visible, title };
        }
        if (state.mode === 'index') {
            const cfg = typeof getIndexConfig === 'function' ? getIndexConfig(state.id) : null;
            if (cfg) return { visible: cfg.name, title: `${cfg.name} · ${(cfg.tencent || state.id || '').toUpperCase()}` };
        }
        if (state.mode === 'stock' && state.stockId) return { visible: state.stockId, title: state.stockId };
        return null;
    })();
    const headerMeta = `${item.date}${headerIdentity ? `<span class="text-dim header-meta-separator">|</span><span class="text-main" title="${escapeHTML(headerIdentity.title)}">${escapeHTML(headerIdentity.visible)}</span>` : ''}`;
    
    const priceHtml = `
        <div class="terminal-block price-panel">
            <div class="header-meta-row">
                <div class="price-header-identity mono text-dim">
                    ${headerMeta}
                </div>
                <div class="nav-capsule">
                    <button class="btn-sm" onclick="prevDay()" title="上一天 (左方向键)">◀</button>
                    <button class="btn-sm" onclick="nextDay()" title="下一天 (右方向键)">▶</button>
                    <button class="btn-sm ${isLatestNavActive(safeIdx, rd.length) ? 'active' : 'is-history'}" id="btnResetLatest" onclick="resetLatest()">最新</button>
                </div>
            </div>
            <div class="price-hero-compact">
                <div class="price-main mono ${cls}">${formatPrice(item.close)}</div>
                <div class="price-sub mono ${cls}">${ch >= 0 ? '+' : ''}${ch.toFixed(pricePrecision)} (${ch >= 0 ? '+' : ''}${pct}%)</div>
            </div>
            <div class="data-grid-2x2">
                <div class="data-box-row"><span class="lbl">今开</span><span class="val mono">${formatPrice(item.open)}</span></div>
                <div class="data-box-row"><span class="lbl">最高</span><span class="val mono">${formatPrice(item.high)}</span></div>
                <div class="data-box-row"><span class="lbl">最低</span><span class="val mono">${formatPrice(item.low)}</span></div>
                <div class="data-box-row"><span class="lbl">成交</span><span class="val mono">${formatUnit(item.vol)}手</span></div>
            </div>
            <div class="amt-row">
                <span class="lbl">成交额</span><span class="val mono">${formatUnit(item.amt)}</span>
            </div>
        </div>
    `;
    
    const meta = getSignalMeta(safeIdx, rd, state.indicators);
    return { 
        priceHtml, 
        analysisHtml: generateAnalysisHTML(safeIdx, rd, meta), 
        isHide: false 
    };
}
