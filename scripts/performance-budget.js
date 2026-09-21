#!/usr/bin/env node

const path = require('path');
const os = require('os');
const { createRequire } = require('module');

const ROOT = path.resolve(__dirname, '..');
const VERSION = require(path.join(ROOT, 'version.json'));
const DEFAULT_URL = 'https://woodslope.github.io/dailyglance';
const EXPECTED_RESOURCE_VERSION = VERSION.resourceVersion;
const EXPECTED_APP_BUILD = VERSION.appBuild;
const STOCK_COLD_TARGET = { code: '600519', name: '贵州茅台' };
const MIN_P95_SAMPLES = 20;
const VIEWPORTS = {
    mobile: { width: 390, height: 844 },
    'compact-boundary': { width: 1023, height: 900 },
    'desktop-boundary': { width: 1024, height: 900 },
    desktop: { width: 1440, height: 900 }
};

const args = new Map();
for (const arg of process.argv.slice(2)) {
    const [key, value = ''] = arg.split('=');
    args.set(key, value);
}

const baseUrl = (args.get('--url') || DEFAULT_URL).replace(/\/$/, '');
const runs = Math.max(1, Number(args.get('--runs')) || 5);
const profile = args.get('--profile') || 'warm';
const viewportName = args.get('--viewport') || 'desktop';
const viewport = VIEWPORTS[viewportName];
const storageProfile = args.get('--storage') || 'normal';
const networkProfile = args.get('--network') || 'normal';
const headed = args.has('--headed');
const noFail = args.has('--no-fail');
const summaryOutput = args.has('--summary');
const compactViewport = viewportName === 'mobile' || viewportName === 'compact-boundary';
const baseOrigin = new URL(baseUrl).origin;

const PERFORMANCE_BUDGETS = {
    'first-load': { actionLimit: 6000, actionWarn: 4000, longTaskMax: 700, longTaskWarn: 250 },
    'stock-first-load': { traceLimit: 6000, actionLimit: 6000, longTaskMax: 700, observationLongTaskMax: 180 },
    'select-stock': { traceLimit: 80, actionLimit: 800, longTaskMax: 80, observationLongTaskMax: 180 },
    'select-index': { traceLimit: 80, actionLimit: 800, longTaskMax: 80, observationLongTaskMax: 180 },
    'switch-strategy-first': { traceLimit: 120, actionLimit: 800, longTaskMax: 180, observationLongTaskMax: 180 },
    'switch-strategy-repeat': { traceLimit: 120, actionLimit: 800, longTaskMax: 180, observationLongTaskMax: 180 },
    'drag-history': { actionLimit: 1200, longTaskMax: 500, observationLongTaskMax: 180, viewportUpdateMax: 35, dragFrameP95: 16.7, dragFrameMax: 33.3 },
    'restore-latest': { actionLimit: 600, longTaskWarn: 80, longTaskMax: 180, observationLongTaskMax: 180 },
    'background-refresh-during-click': { traceLimit: 100, actionLimit: 1000, longTaskMax: 100, observationLongTaskMax: 180 },
    'strategy-inspector-load': { actionLimit: 6000, longTaskMax: 700 }
};

const RESOURCE_BUDGETS = {
    main: {
        requestWarn: 15,
        requestHard: 18,
        encodedWarn: 275 * 1024,
        encodedHard: 325 * 1024,
        decodedWarn: 1024 * 1024,
        decodedHard: 1.1 * 1024 * 1024
    },
    inspector: {
        requestWarn: 8,
        requestHard: 10,
        encodedWarn: 40 * 1024,
        encodedHard: 60 * 1024,
        decodedWarn: 150 * 1024,
        decodedHard: 200 * 1024
    }
};

const MEASUREMENT_ENVIRONMENT_LIMITS = {
    load1PerCpuMax: 2.5,
    cpuUtilizationPctMax: 90
};

const PROFILE_SCENARIOS = {
    cold: ['first-load'],
    'stock-cold': ['stock-first-load'],
    warm: ['select-stock', 'select-index', 'switch-strategy-first', 'switch-strategy-repeat', 'drag-history', 'restore-latest', 'background-refresh-during-click'],
    inspector: ['strategy-inspector-load'],
    all: ['first-load', 'stock-first-load', 'select-stock', 'select-index', 'switch-strategy-first', 'switch-strategy-repeat', 'drag-history', 'restore-latest', 'background-refresh-during-click']
};

const STORAGE_PROFILES = new Set(['normal', 'missing', 'throw', 'blocked', 'timeout']);
const NETWORK_PROFILES = new Set(['normal', 'slow']);

function resolvePlaywright() {
    const candidates = [
        ROOT,
        '/Users/wulinpo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright'
    ];
    for (const candidate of candidates) {
        try {
            return createRequire(path.join(candidate, 'package.json'))('playwright');
        } catch (error) {}
    }
    throw new Error('Playwright not found. Run this script with the Codex bundled Node runtime or install Playwright locally.');
}

function percentile(values, pct) {
    const sorted = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
    if (!sorted.length) return null;
    const idx = Math.min(sorted.length - 1, Math.ceil((pct / 100) * sorted.length) - 1);
    return Number(sorted[idx].toFixed(1));
}

function summarize(values) {
    const clean = values.filter(Number.isFinite);
    if (!clean.length) return { count: 0, avg: null, median: null, p90: null, p95: null, max: null, gateValue: null, gateStatistic: 'none' };
    const sum = clean.reduce((acc, value) => acc + value, 0);
    const enoughForP95 = clean.length >= MIN_P95_SAMPLES;
    return {
        count: clean.length,
        avg: Number((sum / clean.length).toFixed(1)),
        median: percentile(clean, 50),
        p90: percentile(clean, 90),
        p95: enoughForP95 ? percentile(clean, 95) : null,
        max: Number(Math.max(...clean).toFixed(1)),
        gateValue: enoughForP95 ? percentile(clean, 95) : Number(Math.max(...clean).toFixed(1)),
        gateStatistic: enoughForP95 ? 'p95' : 'max'
    };
}

function readSystemLoadSnapshot() {
    const cpus = os.cpus();
    const cpuTimes = cpus.reduce((totals, cpu) => {
        const times = cpu.times || {};
        const total = Object.values(times).reduce((sum, value) => sum + Number(value || 0), 0);
        totals.idle += Number(times.idle || 0);
        totals.total += total;
        return totals;
    }, { idle: 0, total: 0 });
    const load1 = Number(os.loadavg()?.[0] || 0);
    const cpuCount = Math.max(1, cpus.length || 1);
    return {
        at: new Date().toISOString(),
        cpuCount,
        load1: Number(load1.toFixed(2)),
        load1PerCpu: Number((load1 / cpuCount).toFixed(3)),
        cpuTimes
    };
}

function buildSystemLoad(before, after) {
    const totalDelta = Math.max(0, (after.cpuTimes?.total || 0) - (before.cpuTimes?.total || 0));
    const idleDelta = Math.max(0, (after.cpuTimes?.idle || 0) - (before.cpuTimes?.idle || 0));
    const cpuUtilizationPct = totalDelta > 0 ? (1 - idleDelta / totalDelta) * 100 : 0;
    return {
        startedAt: before.at,
        endedAt: after.at,
        cpuCount: after.cpuCount,
        cpuUtilizationPct: Number(cpuUtilizationPct.toFixed(1)),
        load1Before: before.load1,
        load1After: after.load1,
        load1PerCpu: Number(((before.load1PerCpu + after.load1PerCpu) / 2).toFixed(3)),
        load1PerCpuBefore: before.load1PerCpu,
        load1PerCpuAfter: after.load1PerCpu
    };
}

function isBudgetOk(summary, budget) {
    if (!budget) return true;
    if (budget.traceLimit != null && summary.trace.gateValue != null && summary.trace.gateValue > budget.traceLimit) return false;
    if (budget.actionLimit != null && summary.actionDuration.gateValue != null && summary.actionDuration.gateValue > budget.actionLimit) return false;
    if (budget.longTaskMax != null && summary.longTasks.max != null && summary.longTasks.max > budget.longTaskMax) return false;
    if (budget.observationLongTaskMax != null && summary.observationLongTasks.max != null && summary.observationLongTasks.max > budget.observationLongTaskMax) return false;
    if (budget.viewportUpdateMax != null && summary.viewportUpdates?.max != null && summary.viewportUpdates.max > budget.viewportUpdateMax) return false;
    if (budget.dragFrameP95 != null && summary.dragFrameDuration?.p95 != null && summary.dragFrameDuration.p95 > budget.dragFrameP95) return false;
    if (budget.dragFrameMax != null && summary.dragFrameDuration?.max != null && summary.dragFrameDuration.max > budget.dragFrameMax) return false;
    return true;
}

function getBudgetWarnings(summary, budget) {
    const warnings = [];
    if (budget.actionWarn != null && summary.actionDuration.gateValue != null && summary.actionDuration.gateValue > budget.actionWarn) {
        warnings.push(`action ${summary.actionDuration.gateStatistic} ${summary.actionDuration.gateValue}ms > warning ${budget.actionWarn}ms`);
    }
    if (budget.longTaskWarn != null && summary.longTasks.max != null && summary.longTasks.max > budget.longTaskWarn) {
        warnings.push(`long task max ${summary.longTasks.max}ms > warning ${budget.longTaskWarn}ms`);
    }
    return warnings;
}

function matchLongTasksToTraces(longTasks, traces) {
    return longTasks.map(task => {
        const taskEnd = task.startTime + task.duration;
        const matches = traces
            .filter(trace => Number.isFinite(trace.startTime)
                && Number.isFinite(trace.endTime)
                && trace.startTime < taskEnd
                && trace.endTime > task.startTime)
            .map(trace => ({
                label: trace.label,
                total: trace.total,
                startTime: trace.startTime,
                endTime: trace.endTime,
                meta: trace.meta,
                steps: trace.steps
            }));
        return { task, matches };
    });
}

async function installLongTaskObserver(page) {
    await page.addInitScript(() => {
        window.__DG_LONG_TASKS__ = [];
        try {
            const observer = new PerformanceObserver(list => {
                for (const entry of list.getEntries()) {
                    window.__DG_LONG_TASKS__.push({
                        name: entry.name,
                        startTime: Number(entry.startTime.toFixed(1)),
                        duration: Number(entry.duration.toFixed(1))
                    });
                    if (window.__DG_LONG_TASKS__.length > 200) window.__DG_LONG_TASKS__.shift();
                }
            });
            observer.observe({ entryTypes: ['longtask'] });
        } catch (error) {}
    });
}

async function installStorageProfile(page) {
    if (storageProfile === 'normal') return;
    await page.addInitScript(mode => {
        let replacement;
        if (mode === 'missing') {
            replacement = undefined;
        } else if (mode === 'throw') {
            replacement = {
                open() {
                    const error = new Error('performance storage profile denied access');
                    error.name = 'SecurityError';
                    throw error;
                }
            };
        } else if (mode === 'blocked') {
            replacement = {
                open() {
                    const request = {};
                    setTimeout(() => request.onblocked?.(), 0);
                    return request;
                }
            };
        } else if (mode === 'timeout') {
            replacement = { open() { return {}; } };
        }
        Object.defineProperty(window, 'indexedDB', { configurable: true, value: replacement });
    }, storageProfile);
}

async function applyNetworkProfile(page) {
    if (networkProfile === 'normal') return null;
    const session = await page.context().newCDPSession(page);
    await session.send('Network.enable');
    await session.send('Network.emulateNetworkConditions', {
        offline: false,
        latency: 400,
        downloadThroughput: 750 * 1024 / 8,
        uploadThroughput: 250 * 1024 / 8,
        connectionType: 'cellular3g'
    });
    return session;
}

function trackExternalResourceFailures(page, externalResourceFailures, deliberateBlockedRequests, meta = {}) {
    page.on('requestfailed', request => {
        const url = request.url();
        if (!url.startsWith(baseUrl)) {
            const failure = {
                ...meta,
                url,
                text: request.failure()?.errorText || 'request failed'
            };
            if (/blocked.by.client/i.test(failure.text)) deliberateBlockedRequests.push(failure);
            else externalResourceFailures.push(failure);
        }
    });
}

async function collectResourceFootprint(page, kind = 'main') {
    return page.evaluate(resourceKind => {
        const origin = location.origin;
        const resources = performance.getEntriesByType('resource').filter(entry => {
            try { return new URL(entry.name).origin === origin; } catch (error) { return false; }
        });
        const navigation = performance.getEntriesByType('navigation')[0];
        const entries = navigation ? [navigation, ...resources] : resources;
        const sum = key => entries.reduce((total, entry) => total + Math.max(0, Number(entry[key]) || 0), 0);
        const encodedBodyBytes = sum('encodedBodySize');
        const decodedBodyBytes = sum('decodedBodySize');
        return {
            kind: resourceKind,
            requestCount: entries.length,
            transferBytes: sum('transferSize'),
            encodedBodyBytes,
            decodedBodyBytes,
            compressionObserved: encodedBodyBytes > 0 && decodedBodyBytes > 0 && encodedBodyBytes < decodedBodyBytes * 0.8,
            resources: entries.map(entry => ({
                name: entry.name,
                initiatorType: entry.initiatorType || 'navigation',
                transferBytes: Math.max(0, Number(entry.transferSize) || 0),
                encodedBodyBytes: Math.max(0, Number(entry.encodedBodySize) || 0),
                decodedBodyBytes: Math.max(0, Number(entry.decodedBodySize) || 0)
            }))
        };
    }, kind);
}

function buildResourceReport(resourceSamples) {
    const grouped = new Map();
    for (const sample of resourceSamples) {
        if (!sample?.kind) continue;
        if (!grouped.has(sample.kind)) grouped.set(sample.kind, []);
        grouped.get(sample.kind).push(sample);
    }
    const report = {};
    for (const [kind, samples] of grouped.entries()) {
        const budget = RESOURCE_BUDGETS[kind] || {};
        const requestCount = summarize(samples.map(item => item.requestCount));
        const transferBytes = summarize(samples.map(item => item.transferBytes));
        const encodedBodyBytes = summarize(samples.map(item => item.encodedBodyBytes));
        const decodedBodyBytes = summarize(samples.map(item => item.decodedBodyBytes));
        const compressedSamples = samples.filter(item => item.compressionObserved);
        const hardFailures = [];
        const warnings = [];
        if (budget.requestHard != null && requestCount.max > budget.requestHard) hardFailures.push(`request count ${requestCount.max} > ${budget.requestHard}`);
        if (budget.decodedHard != null && decodedBodyBytes.max > budget.decodedHard) hardFailures.push(`decoded bytes ${decodedBodyBytes.max} > ${budget.decodedHard}`);
        if (budget.encodedHard != null && compressedSamples.some(item => item.encodedBodyBytes > budget.encodedHard)) hardFailures.push(`compressed encoded bytes > ${budget.encodedHard}`);
        if (budget.requestWarn != null && requestCount.max > budget.requestWarn) warnings.push(`request count ${requestCount.max} > warning ${budget.requestWarn}`);
        if (budget.decodedWarn != null && decodedBodyBytes.max > budget.decodedWarn) warnings.push(`decoded bytes ${decodedBodyBytes.max} > warning ${budget.decodedWarn}`);
        if (budget.encodedWarn != null && compressedSamples.some(item => item.encodedBodyBytes > budget.encodedWarn)) warnings.push(`compressed encoded bytes > warning ${budget.encodedWarn}`);
        report[kind] = {
            ok: hardFailures.length === 0,
            budget,
            requestCount,
            transferBytes,
            encodedBodyBytes,
            decodedBodyBytes,
            compressionSamples: compressedSamples.length,
            warnings,
            failures: hardFailures,
            samples
        };
    }
    return report;
}

async function waitForReady(page) {
    await page.waitForFunction(({ expectedBuild, expectedVersion }) => {
        const resources = Array.from(document.querySelectorAll('script[src], link[rel="stylesheet"][href]')).map(el => el.src || el.href);
        const versions = [...new Set(resources.map(url => (url.match(/[?&]v=([^&]+)/) || [])[1]).filter(Boolean))];
        const main = document.getElementById('mainChart');
        return window.__DG_BUILD__ === expectedBuild
            && versions.length > 0
            && versions.every(version => version === expectedVersion)
            && main
            && main.dataset.scope
            && typeof _selectStockImpl === 'function'
            && typeof _selectIndexImpl === 'function'
            && typeof resetLatest === 'function';
    }, { expectedBuild: EXPECTED_APP_BUILD, expectedVersion: EXPECTED_RESOURCE_VERSION }, { timeout: 20000 });
}

async function waitForStockExperienceReady(page, target) {
    try {
        await page.waitForFunction(({ code, name }) => {
            if (typeof state === 'undefined' || state.mode !== 'stock' || state.stockId !== code || state.period !== 'daily') return false;
            const data = typeof getActiveData === 'function' ? getActiveData() : null;
            if (!Array.isArray(data) || data.length < 60) return false;
            const last = data[data.length - 1];
            const expectedScope = `${state.id}_daily`;
            const compactMobile = matchMedia('(max-width: 1023px)').matches;
            const canvasIds = compactMobile ? ['mainChart'] : ['mainChart', 'volumeChart', 'macdChart', 'kdjChart'];
            const canvases = canvasIds.map(id => document.getElementById(id));
            if (!canvases.every(canvas => canvas && canvas.dataset.scope === expectedScope && canvas.width > 0 && canvas.height > 0)) return false;

            const price = document.getElementById('cardPrice');
            const analysis = document.getElementById('cardAnalysis');
            const badge = document.querySelector('#lastRefreshBar .data-status-pill');
            const refreshTime = document.getElementById('lastRefreshTime')?.textContent?.trim() || '';
            const priceText = price?.innerText || '';
            const analysisText = analysis?.innerText || '';
            const itemDate = badge?.getAttribute('data-dg-item-date') || '';
            const confirmedStatus = badge?.getAttribute('data-dg-confirmed-status') || '';
            return !!price
                && getComputedStyle(price).display !== 'none'
                && !!price.querySelector('.price-main')
                && (priceText.includes(code) || priceText.includes(name))
                && !priceText.includes('该股票数据暂时加载失败')
                && !!analysis
                && getComputedStyle(analysis).display !== 'none'
                && analysisText.includes('每日结论')
                && !analysisText.includes('分析同步中')
                && !!badge
                && confirmedStatus !== ''
                && confirmedStatus !== 'unknown'
                && itemDate === last?.date
                && refreshTime !== ''
                && refreshTime !== '--:--:--'
                && state.lockIdx === data.length - 1
                && document.querySelectorAll('.empty-hint').length === 0;
        }, target, { timeout: 20000 });
        return true;
    } catch (error) {
        return false;
    }
}

async function collectStockExperience(page, target) {
    return page.evaluate(({ code, name }) => {
        const data = typeof getActiveData === 'function' ? getActiveData() : [];
        const last = data?.[data.length - 1] || null;
        const expectedScope = typeof state !== 'undefined' ? `${state.id}_${state.period}` : '';
        const compactMobile = matchMedia('(max-width: 1023px)').matches;
        const canvasIds = compactMobile ? ['mainChart'] : ['mainChart', 'volumeChart', 'macdChart', 'kdjChart'];
        const canvasScopes = canvasIds.map(id => {
            const canvas = document.getElementById(id);
            return {
                id,
                scope: canvas?.dataset?.scope || '',
                width: canvas?.width || 0,
                height: canvas?.height || 0
            };
        });
        const price = document.getElementById('cardPrice');
        const analysis = document.getElementById('cardAnalysis');
        const badge = document.querySelector('#lastRefreshBar .data-status-pill');
        const refreshBadge = badge ? Array.from(badge.attributes).reduce((acc, attr) => {
            if (attr.name.startsWith('data-dg-')) acc[attr.name] = attr.value;
            return acc;
        }, { text: badge.innerText.trim() }) : null;
        const priceIdentity = price?.querySelector('.price-header-identity')?.innerText?.trim() || '';
        const priceValue = price?.querySelector('.price-main')?.innerText?.trim() || '';
        const analysisText = analysis?.innerText || '';
        const refreshTime = document.getElementById('lastRefreshTime')?.textContent?.trim() || '';
        const cardAnalysisHasConclusion = analysisText.includes('每日结论') && !analysisText.includes('分析同步中');
        const chartsReady = canvasScopes.every(canvas => canvas.scope === expectedScope && canvas.width > 0 && canvas.height > 0);
        const priceReady = !!price
            && getComputedStyle(price).display !== 'none'
            && !!priceValue
            && priceValue !== '--'
            && (priceIdentity.includes(code) || priceIdentity.includes(name))
            && !price.innerText.includes('该股票数据暂时加载失败');
        const analysisReady = !!analysis && getComputedStyle(analysis).display !== 'none' && cardAnalysisHasConclusion;
        const statusReady = !!refreshBadge
            && refreshBadge['data-dg-confirmed-status']
            && refreshBadge['data-dg-confirmed-status'] !== 'unknown'
            && refreshBadge['data-dg-item-date'] === last?.date;
        const latestReady = typeof state !== 'undefined' && state.lockIdx === data.length - 1;
        const refreshTimeReady = refreshTime !== '' && refreshTime !== '--:--:--';
        const noEmptyState = document.querySelectorAll('.empty-hint').length === 0;
        return {
            ok: typeof state !== 'undefined'
                && state.mode === 'stock'
                && state.stockId === code
                && data.length >= 60
                && chartsReady
                && priceReady
                && analysisReady
                && statusReady
                && latestReady
                && refreshTimeReady
                && noEmptyState,
            code,
            name,
            secid: typeof state !== 'undefined' ? state.id : '',
            dataPoints: data.length,
            lastDate: last?.date || '',
            expectedScope,
            compactMobile,
            canvasScopes,
            priceIdentity,
            priceValue,
            cardAnalysisHasConclusion,
            refreshBadge,
            refreshTime,
            latestReady,
            emptyHintCount: document.querySelectorAll('.empty-hint').length
        };
    }, target);
}

async function getTraceCount(page) {
    return page.evaluate(() => window.__DG_PERF__?.traces?.length || 0);
}

async function getLongTaskCount(page) {
    return page.evaluate(() => window.__DG_LONG_TASKS__?.length || 0);
}

async function collectAfter(page, beforeTraceCount, beforeLongTaskCount, traceLabel, scenarioStart, scenarioEnd, observationEnd) {
    return page.evaluate(({ beforeTraceCount, beforeLongTaskCount, traceLabel, scenarioStart, scenarioEnd, observationEnd }) => {
        const traces = (window.__DG_PERF__?.traces || []).slice(beforeTraceCount);
        const matched = traceLabel ? traces.filter(item => item.label === traceLabel) : [];
        const latestTrace = matched[matched.length - 1] || null;
        const observedTasks = (window.__DG_LONG_TASKS__ || []).slice(beforeLongTaskCount);
        const overlaps = (task, start, end) => task.startTime < end && task.startTime + task.duration > start;
        const longTasks = observedTasks.filter(task => overlaps(task, scenarioStart, scenarioEnd));
        const observationLongTasks = observedTasks.filter(task => overlaps(task, scenarioEnd, observationEnd));
        return {
            trace: latestTrace,
            traces,
            longTasks,
            observationLongTasks
        };
    }, { beforeTraceCount, beforeLongTaskCount, traceLabel, scenarioStart, scenarioEnd, observationEnd });
}

async function measureScenario(page, name, traceLabel, action) {
    await page.waitForTimeout(400);
    await page.evaluate(() => {
        if (window.__DG_PERF__) window.__DG_PERF__.traces = [];
        if (window.__DG_LONG_TASKS__) window.__DG_LONG_TASKS__ = [];
    });
    const beforeTraceCount = await getTraceCount(page);
    const beforeLongTaskCount = await getLongTaskCount(page);
    const scenarioLoadBefore = readSystemLoadSnapshot();
    const scenarioStart = await page.evaluate(() => performance.now());
    await action();
    const actionEnd = await page.evaluate(() => performance.now());
    const interactionMetrics = name === 'drag-history' ? await page.evaluate(() => {
        const metrics = window.__DG_DRAG_METRICS__ || null;
        if (window.__DG_DRAG_ORIGINAL_DRAW_VIEWPORT__) window.drawViewport = window.__DG_DRAG_ORIGINAL_DRAW_VIEWPORT__;
        if (window.__DG_DRAG_ORIGINAL_SIDEBAR__) window.safeUpdateSidebar = window.__DG_DRAG_ORIGINAL_SIDEBAR__;
        delete window.__DG_DRAG_ORIGINAL_DRAW_VIEWPORT;
        delete window.__DG_DRAG_ORIGINAL_SIDEBAR__;
        return metrics;
    }) : null;
    await page.waitForTimeout(250);
    const observationEnd = await page.evaluate(() => performance.now());
    const scenarioEnd = actionEnd;
    const collected = await collectAfter(page, beforeTraceCount, beforeLongTaskCount, traceLabel, scenarioStart, scenarioEnd, observationEnd);
    return {
        name,
        actionDuration: Number((actionEnd - scenarioStart).toFixed(1)),
        observationDuration: Number((observationEnd - scenarioStart).toFixed(1)),
        traceTotal: collected.trace?.total ?? null,
        trace: collected.trace,
        traces: collected.traces,
        longTasks: collected.longTasks,
        observationLongTasks: collected.observationLongTasks,
        longTaskTraceMatches: matchLongTasksToTraces(collected.longTasks, collected.traces),
        observationLongTaskTraceMatches: matchLongTasksToTraces(collected.observationLongTasks, collected.traces),
        interactionMetrics,
        systemLoad: buildSystemLoad(scenarioLoadBefore, readSystemLoadSnapshot())
    };
}

async function dragHistory(page) {
    const chart = page.locator('#mainChart');
    await chart.scrollIntoViewIfNeeded();
    const box = await chart.boundingBox();
    if (!box) throw new Error('mainChart is missing');
    const startX = box.x + box.width * 0.72;
    const endX = startX - Math.min(220, box.width * 0.28);
    const y = box.y + box.height * 0.5;
    await page.evaluate(() => {
        window.__DG_DRAG_METRICS__ = { viewportUpdates: 0, sidebarUpdates: 0, frameDurations: [] };
        window.__DG_DRAG_ORIGINAL_DRAW_VIEWPORT__ = window.drawViewport;
        window.__DG_DRAG_ORIGINAL_SIDEBAR__ = window.safeUpdateSidebar;
        window.drawViewport = function(...args) {
            const startedAt = performance.now();
            try { return window.__DG_DRAG_ORIGINAL_DRAW_VIEWPORT__.apply(this, args); }
            finally {
                window.__DG_DRAG_METRICS__.viewportUpdates += 1;
                window.__DG_DRAG_METRICS__.frameDurations.push(Number((performance.now() - startedAt).toFixed(1)));
            }
        };
        window.safeUpdateSidebar = function(...args) {
            window.__DG_DRAG_METRICS__.sidebarUpdates += 1;
            return window.__DG_DRAG_ORIGINAL_SIDEBAR__.apply(this, args);
        };
    });
    if (compactViewport) {
        const session = await page.context().newCDPSession(page);
        try {
            await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: startX, y }] });
            for (let step = 1; step <= 10; step += 1) {
                const x = startX + (endX - startX) * (step / 10);
                await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
            }
            await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        } finally {
            await session.detach();
        }
    } else {
        await page.mouse.move(startX, y);
        await page.mouse.down();
        await page.mouse.move(endX, y, { steps: 10 });
        await page.mouse.up();
    }
    await page.waitForFunction(() => {
        const badge = document.getElementById('freezeBadge');
        return badge && getComputedStyle(badge).display !== 'none';
    }, null, { timeout: 5000 });
}

async function restoreLatest(page) {
    await page.locator('#btnResetLatest').click();
    await page.waitForFunction(() => {
        const badge = document.getElementById('freezeBadge');
        const latest = document.getElementById('btnResetLatest');
        return badge && latest && getComputedStyle(badge).display === 'none' && latest.classList.contains('active');
    }, null, { timeout: 5000 });
}

async function switchStrategy(page, name) {
    await page.evaluate(async strategyName => {
        const promise = switchStrategy(strategyName);
        setTimeout(() => document.getElementById('customModalBtnOk')?.click(), 20);
        await promise;
    }, name);
}

async function runScenarioSet(page) {
    const scenarios = [];
    scenarios.push(await measureScenario(page, 'select-stock', 'selectStock', async () => {
        await page.evaluate(() => _selectStockImpl('600519', '贵州茅台'));
        await page.waitForFunction(() => typeof state !== 'undefined' && state.stockId === '600519', null, { timeout: 10000 });
    }));
    scenarios.push(await measureScenario(page, 'select-index', 'selectIndex', async () => {
        await page.evaluate(() => _selectIndexImpl('cy'));
        await page.waitForFunction(() => typeof state !== 'undefined' && state.id === 'cy', null, { timeout: 10000 });
    }));
    scenarios.push(await measureScenario(page, 'switch-strategy-first', 'switchStrategy', async () => {
        await switchStrategy(page, '综合全能型');
        await page.waitForFunction(() => typeof state !== 'undefined' && state.strategy === '综合全能型', null, { timeout: 10000 });
    }));
    scenarios.push(await measureScenario(page, 'switch-strategy-repeat', 'switchStrategy', async () => {
        await switchStrategy(page, '稳健趋势型');
        await page.waitForFunction(() => typeof state !== 'undefined' && state.strategy === '稳健趋势型', null, { timeout: 10000 });
    }));
    scenarios.push(await measureScenario(page, 'drag-history', null, async () => {
        await dragHistory(page);
    }));
    scenarios.push(await measureScenario(page, 'restore-latest', null, async () => {
        await restoreLatest(page);
    }));
    scenarios.push(await measureScenario(page, 'background-refresh-during-click', 'selectStock', async () => {
        await page.evaluate(() => { refreshSidebarRealtime(); });
        await page.evaluate(() => _selectStockImpl('300750', '宁德时代'));
        await page.waitForFunction(() => typeof state !== 'undefined' && state.stockId === '300750', null, { timeout: 10000 });
    }));
    return scenarios;
}

async function warmInteractionPaths(page) {
    await page.evaluate(() => _selectStockImpl('600519', '贵州茅台'));
    await page.waitForFunction(() => typeof state !== 'undefined' && state.stockId === '600519', null, { timeout: 15000 });
    await page.evaluate(() => _selectStockImpl('300750', '宁德时代'));
    await page.waitForFunction(() => typeof state !== 'undefined' && state.stockId === '300750', null, { timeout: 15000 });
    await page.evaluate(() => _selectIndexImpl('cy'));
    await page.waitForFunction(() => typeof state !== 'undefined' && state.id === 'cy', null, { timeout: 15000 });
    await page.evaluate(() => _selectIndexImpl('sh'));
    await page.waitForFunction(() => typeof state !== 'undefined' && state.id === 'sh', null, { timeout: 15000 });
    await page.evaluate(() => {
        if (window.__DG_PERF__) window.__DG_PERF__.traces = [];
        if (window.__DG_LONG_TASKS__) window.__DG_LONG_TASKS__ = [];
    });
}

async function waitForExternalScriptsToSettle(page) {
    await page.waitForFunction(origin => Array.from(document.scripts).every(script => {
        if (!script.src) return true;
        return new URL(script.src).origin === origin;
    }), baseOrigin, { timeout: 12000 });
}

async function measureInitialLoad(page, runIndex) {
    const firstLoadStart = Date.now();
    await page.goto(`${baseUrl}/?v=perf-${EXPECTED_RESOURCE_VERSION}-${runIndex}-${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await waitForReady(page);
    const firstLoadLongTasks = await page.evaluate(() => window.__DG_LONG_TASKS__ || []);
    const firstLoadDuration = Date.now() - firstLoadStart;
    const startupTrace = await page.evaluate(() => window.__DG_PERF__?.latest('startup') || null);
    const startupTraces = await page.evaluate(() => (window.__DG_PERF__?.traces || []).filter(trace => (
        Number.isFinite(trace.startTime)
        && Number.isFinite(trace.endTime)
        && trace.label !== 'cachedFetchRefresh'
    )));
    const resources = await collectResourceFootprint(page, 'main');
    const storage = await page.evaluate(() => ({ ...(window.__DG_STORAGE__ || {}) }));
    return {
        name: 'first-load',
        actionDuration: firstLoadDuration,
        observationDuration: firstLoadDuration,
        traceTotal: startupTrace?.total ?? null,
        trace: startupTrace ? { ...startupTrace, traceLabel: 'startup' } : { traceLabel: 'startup' },
        startupTraces,
        longTaskTraceMatches: matchLongTasksToTraces(firstLoadLongTasks, startupTraces),
        longTasks: firstLoadLongTasks,
        observationLongTasks: [],
        resources,
        storage
    };
}

async function measureStrategyInspectorLoad(page, runIndex) {
    const startedAt = Date.now();
    await page.goto(`${baseUrl}/strategy-inspector.html?v=perf-inspector-${EXPECTED_RESOURCE_VERSION}-${runIndex}-${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForFunction(expectedBuild => {
        const build = document.getElementById('strategyBuild')?.textContent || '';
        return build.includes(expectedBuild)
            && document.querySelectorAll('#strategyTabs .strategy-tab').length >= 4
            && !!document.getElementById('strategyOverview')?.textContent?.trim();
    }, EXPECTED_APP_BUILD, { timeout: 20000 });
    const duration = Date.now() - startedAt;
    return {
        name: 'strategy-inspector-load',
        run: runIndex,
        actionDuration: duration,
        observationDuration: duration,
        traceTotal: null,
        trace: null,
        longTasks: await page.evaluate(() => window.__DG_LONG_TASKS__ || []),
        observationLongTasks: [],
        resources: await collectResourceFootprint(page, 'inspector')
    };
}

async function runColdProfile(browser, externalResourceFailures, deliberateBlockedRequests) {
    const samples = [];
    for (let runIndex = 0; runIndex < runs; runIndex += 1) {
        const loadBefore = readSystemLoadSnapshot();
        const context = await browser.newContext({ viewport, hasTouch: compactViewport });
        const page = await context.newPage();
        await installLongTaskObserver(page);
        await installStorageProfile(page);
        await applyNetworkProfile(page);
        trackExternalResourceFailures(page, externalResourceFailures, deliberateBlockedRequests, { profile: 'cold', run: runIndex + 1 });
        try {
            const sample = await measureInitialLoad(page, runIndex + 1);
            sample.run = runIndex + 1;
            sample.systemLoad = buildSystemLoad(loadBefore, readSystemLoadSnapshot());
            samples.push(sample);
        } finally {
            await context.close();
        }
    }
    return samples;
}

async function runStockColdProfile(browser, externalResourceFailures, deliberateBlockedRequests) {
    const samples = [];
    for (let runIndex = 0; runIndex < runs; runIndex += 1) {
        const loadBefore = readSystemLoadSnapshot();
        const context = await browser.newContext({ viewport, hasTouch: compactViewport });
        const page = await context.newPage();
        await installLongTaskObserver(page);
        await installStorageProfile(page);
        await applyNetworkProfile(page);
        trackExternalResourceFailures(page, externalResourceFailures, deliberateBlockedRequests, { profile: 'stock-cold', run: runIndex + 1 });
        try {
            await page.goto(`${baseUrl}/?v=stock-cold-${EXPECTED_RESOURCE_VERSION}-${runIndex + 1}-${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
            await waitForReady(page);
            let sampleExperienceReady = false;
            const sample = await measureScenario(page, 'stock-first-load', 'selectStock', async () => {
                await page.evaluate(target => _selectStockImpl(target.code, target.name), STOCK_COLD_TARGET);
                sampleExperienceReady = await waitForStockExperienceReady(page, STOCK_COLD_TARGET);
            });
            const experience = await collectStockExperience(page, STOCK_COLD_TARGET);
            sample.run = runIndex + 1;
            sample.experience = experience;
            sample.experienceOk = sampleExperienceReady && experience.ok;
            sample.resources = await collectResourceFootprint(page, 'main');
            sample.storage = await page.evaluate(() => ({ ...(window.__DG_STORAGE__ || {}) }));
            sample.systemLoad = buildSystemLoad(loadBefore, readSystemLoadSnapshot());
            samples.push(sample);
        } finally {
            await context.close();
        }
    }
    return samples;
}

async function runInspectorProfile(browser, externalResourceFailures, deliberateBlockedRequests) {
    const samples = [];
    for (let runIndex = 0; runIndex < runs; runIndex += 1) {
        const loadBefore = readSystemLoadSnapshot();
        const context = await browser.newContext({ viewport, hasTouch: compactViewport });
        const page = await context.newPage();
        await installLongTaskObserver(page);
        await applyNetworkProfile(page);
        trackExternalResourceFailures(page, externalResourceFailures, deliberateBlockedRequests, { profile: 'inspector', run: runIndex + 1 });
        try {
            const sample = await measureStrategyInspectorLoad(page, runIndex + 1);
            sample.systemLoad = buildSystemLoad(loadBefore, readSystemLoadSnapshot());
            samples.push(sample);
        } finally {
            await context.close();
        }
    }
    return samples;
}

function buildReport(samples, externalResourceFailures, deliberateBlockedRequests, resourceSamples) {
    const grouped = new Map();
    for (const sample of samples) {
        if (!grouped.has(sample.name)) grouped.set(sample.name, []);
        grouped.get(sample.name).push(sample);
    }
    const scenarios = {};
    for (const [name, items] of grouped.entries()) {
        const budget = PERFORMANCE_BUDGETS[name] || {};
        const summary = {
            budget,
            actionDuration: summarize(items.map(item => item.actionDuration)),
            observationDuration: summarize(items.map(item => item.observationDuration)),
            trace: summarize(items.map(item => item.traceTotal)),
            longTasks: summarize(items.flatMap(item => item.longTasks.map(task => task.duration))),
            observationLongTasks: summarize(items.flatMap(item => (item.observationLongTasks || []).map(task => task.duration))),
            viewportUpdates: summarize(items.map(item => item.interactionMetrics?.viewportUpdates)),
            dragFrameDuration: summarize(items.flatMap(item => item.interactionMetrics?.frameDurations || [])),
            systemLoad: {
                cpuUtilizationPct: summarize(items.map(item => item.systemLoad?.cpuUtilizationPct)),
                load1PerCpu: summarize(items.map(item => item.systemLoad?.load1PerCpu))
            },
            samples: items
        };
        summary.experienceOk = items.every(item => item.experienceOk !== false);
        summary.warnings = getBudgetWarnings(summary, budget);
        summary.ok = isBudgetOk(summary, budget) && summary.experienceOk;
        scenarios[name] = summary;
    }
    const resources = buildResourceReport(resourceSamples);
    const measurementEnvironment = {
        limits: MEASUREMENT_ENVIRONMENT_LIMITS,
        cpuUtilizationPct: summarize(samples.map(item => item.systemLoad?.cpuUtilizationPct)),
        load1PerCpu: summarize(samples.map(item => item.systemLoad?.load1PerCpu)),
        failures: []
    };
    if (measurementEnvironment.cpuUtilizationPct.max > MEASUREMENT_ENVIRONMENT_LIMITS.cpuUtilizationPctMax) {
        measurementEnvironment.failures.push(`host CPU utilization ${measurementEnvironment.cpuUtilizationPct.max}% > ${MEASUREMENT_ENVIRONMENT_LIMITS.cpuUtilizationPctMax}%`);
    }
    if (measurementEnvironment.load1PerCpu.max > MEASUREMENT_ENVIRONMENT_LIMITS.load1PerCpuMax) {
        measurementEnvironment.failures.push(`host load per CPU ${measurementEnvironment.load1PerCpu.max} > ${MEASUREMENT_ENVIRONMENT_LIMITS.load1PerCpuMax}`);
    }
    measurementEnvironment.valid = measurementEnvironment.failures.length === 0;
    const performanceOk = Object.values(scenarios).every(item => item.ok) && Object.values(resources).every(item => item.ok);
    return {
        ok: performanceOk && measurementEnvironment.valid,
        performanceOk,
        measurementEnvironment,
        expectedVersion: EXPECTED_RESOURCE_VERSION,
        expectedBuild: EXPECTED_APP_BUILD,
        runs,
        scenarios,
        resources,
        externalResourceFailures,
        deliberateBlockedRequests
    };
}

function buildCompactReport(report) {
    const scenarios = Object.fromEntries(Object.entries(report.scenarios).map(([name, scenario]) => {
        const failedSamples = (scenario.samples || []).filter(sample => sample.experienceOk === false).map(sample => ({
            run: sample.run,
            experience: sample.experience || null
        }));
        const { samples, ...summary } = scenario;
        return [name, { ...summary, failedSamples }];
    }));
    const resources = Object.fromEntries(Object.entries(report.resources).map(([name, resource]) => {
        const { samples, ...summary } = resource;
        return [name, summary];
    }));
    const blockedHosts = [...new Set(report.deliberateBlockedRequests.map(item => {
        try { return new URL(item.url).host; } catch (error) { return 'invalid-url'; }
    }))].sort();
    return {
        ...report,
        scenarios,
        resources,
        deliberateBlockedRequests: {
            count: report.deliberateBlockedRequests.length,
            hosts: blockedHosts
        }
    };
}

async function main() {
    if (!PROFILE_SCENARIOS[profile]) {
        throw new Error(`Unknown --profile=${profile}. Use cold, stock-cold, warm, inspector, or all.`);
    }
    if (!viewport) throw new Error(`Unknown --viewport=${viewportName}. Use ${Object.keys(VIEWPORTS).join(', ')}.`);
    if (!STORAGE_PROFILES.has(storageProfile)) throw new Error(`Unknown --storage=${storageProfile}. Use ${[...STORAGE_PROFILES].join(', ')}.`);
    if (!NETWORK_PROFILES.has(networkProfile)) throw new Error(`Unknown --network=${networkProfile}. Use ${[...NETWORK_PROFILES].join(', ')}.`);
    if (profile === 'inspector' && storageProfile !== 'normal') throw new Error('--storage applies to the main app, not the strategy inspector.');
    const { chromium } = resolvePlaywright();
    const launchOptions = { headless: !headed };
    if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) {
        launchOptions.executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
    }
    const browser = await chromium.launch(launchOptions);
    const externalResourceFailures = [];
    const deliberateBlockedRequests = [];
    try {
        const samples = [];
        const resourceSamples = [];
        if (PROFILE_SCENARIOS[profile].includes('first-load')) {
            samples.push(...await runColdProfile(browser, externalResourceFailures, deliberateBlockedRequests));
        }
        if (PROFILE_SCENARIOS[profile].includes('stock-first-load')) {
            samples.push(...await runStockColdProfile(browser, externalResourceFailures, deliberateBlockedRequests));
        }
        if (PROFILE_SCENARIOS[profile].includes('strategy-inspector-load')) {
            samples.push(...await runInspectorProfile(browser, externalResourceFailures, deliberateBlockedRequests));
        }

        resourceSamples.push(...samples.map(sample => sample.resources).filter(Boolean));
        const warmScenarioNames = PROFILE_SCENARIOS[profile].filter(name => !['first-load', 'stock-first-load', 'strategy-inspector-load'].includes(name));
        if (warmScenarioNames.length) {
            const context = await browser.newContext({ viewport, hasTouch: compactViewport });
            const page = await context.newPage();
            await installLongTaskObserver(page);
            await installStorageProfile(page);
            await applyNetworkProfile(page);
            trackExternalResourceFailures(page, externalResourceFailures, deliberateBlockedRequests, { profile });
            try {
                await page.goto(`${baseUrl}/?v=warm-${EXPECTED_RESOURCE_VERSION}-${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
                await waitForReady(page);
                resourceSamples.push(await collectResourceFootprint(page, 'main'));
                await warmInteractionPaths(page);
                await waitForExternalScriptsToSettle(page);
                await page.evaluate(() => {
                    if (typeof stopRefreshSchedulers === 'function') stopRefreshSchedulers('performance-isolation');
                });
                await page.route('**/*', route => {
                    const url = route.request().url();
                    if (new URL(url).origin === baseOrigin || url.startsWith('data:') || url.startsWith('blob:')) {
                        route.continue();
                        return;
                    }
                    route.abort('blockedbyclient');
                });
                await page.evaluate(() => {
                    if (window.__DG_PERF__) window.__DG_PERF__.traces = [];
                    if (window.__DG_LONG_TASKS__) window.__DG_LONG_TASKS__ = [];
                });
                for (let i = 0; i < runs; i += 1) {
                    samples.push(...await runScenarioSet(page).then(items => items.filter(item => warmScenarioNames.includes(item.name))));
                }
            } finally {
                await context.close();
            }
        }
        const report = buildReport(samples, externalResourceFailures, deliberateBlockedRequests, resourceSamples);
        report.profile = profile;
        report.viewport = { name: viewportName, ...viewport };
        report.storageProfile = storageProfile;
        report.networkProfile = networkProfile;
        report.samplePolicy = {
            minimumP95Samples: MIN_P95_SAMPLES,
            smallSampleGate: 'max',
            formalGate: 'p95'
        };
        console.log(JSON.stringify(summaryOutput ? buildCompactReport(report) : report, null, 2));
        if (!report.ok && !noFail) process.exitCode = 1;
    } finally {
        await browser.close();
    }
}

main().catch(error => {
    console.error(error.stack || error.message);
    process.exit(1);
});
