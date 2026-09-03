#!/usr/bin/env node

const path = require('path');
const { createRequire } = require('module');

const ROOT = path.resolve(__dirname, '..');
const VERSION = require(path.join(ROOT, 'version.json'));
const DEFAULT_URL = 'http://127.0.0.1:8000';
const VIEWPORTS = {
    desktop: { width: 1440, height: 900, chartCount: 4, defaultMinutes: 60 },
    mobile: { width: 390, height: 844, chartCount: 1, defaultMinutes: 30 }
};
const RUNTIME_BUFFER_BUDGETS = {
    renderCache: 50,
    dateIndexCache: 5000,
    derivedIndicatorCache: 50,
    perfTraces: 80,
    longTasks: 200
};

const args = new Map();
for (const arg of process.argv.slice(2)) {
    const [key, value = ''] = arg.split('=');
    args.set(key, value);
}

const baseUrl = (args.get('--url') || DEFAULT_URL).replace(/\/$/, '');
const profile = args.get('--profile') || 'all';
const viewportName = args.get('--viewport') || 'desktop';
const viewport = VIEWPORTS[viewportName];
const durationMinutes = Math.max(0.1, Number(args.get('--duration-minutes')) || viewport?.defaultMinutes || 60);
const interactionIntervalMs = Math.max(250, Number(args.get('--interval-ms')) || 2000);
const bfcacheCycles = Math.max(1, Number(args.get('--bfcache-cycles')) || 20);
const headed = args.has('--headed');
const noFail = args.has('--no-fail');
const summaryOutput = args.has('--summary');

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
    throw new Error('Playwright not found. Use the Codex bundled runtime or install Playwright locally.');
}

function createResult(name) {
    return { name, ok: true, checks: [], failures: [], warnings: [] };
}

function check(result, condition, message, evidence = null) {
    result.checks.push({ ok: !!condition, message, evidence });
    if (!condition) {
        result.ok = false;
        result.failures.push(message);
    }
}

function warn(result, message, evidence = null) {
    result.warnings.push({ message, evidence });
}

async function installStorageMode(page, mode) {
    if (mode === 'normal') return;
    await page.addInitScript(storageMode => {
        if (storageMode === 'fatal') {
            const fail = () => {
                const error = new Error('forced fatal startup failure');
                error.name = 'SecurityError';
                throw error;
            };
            Object.defineProperty(Storage.prototype, 'getItem', { configurable: true, value: fail });
            Object.defineProperty(Storage.prototype, 'setItem', { configurable: true, value: fail });
            return;
        }
        let replacement;
        if (storageMode === 'missing') replacement = undefined;
        if (storageMode === 'throw') {
            replacement = {
                open() {
                    const error = new Error('forced IndexedDB denial');
                    error.name = 'SecurityError';
                    throw error;
                }
            };
        }
        if (storageMode === 'blocked') {
            replacement = {
                open() {
                    const request = {};
                    setTimeout(() => request.onblocked?.(), 0);
                    return request;
                }
            };
        }
        if (storageMode === 'timeout') replacement = { open() { return {}; } };
        Object.defineProperty(window, 'indexedDB', { configurable: true, value: replacement });
    }, mode);
}

async function installLifecycleProbe(page) {
    await page.addInitScript(() => {
        window.__DG_LIFECYCLE_PROBE__ = { pagehide: 0, pageshow: 0, persistedPagehide: 0, persistedPageshow: 0 };
        window.addEventListener('pagehide', event => {
            window.__DG_LIFECYCLE_PROBE__.pagehide++;
            if (event.persisted) window.__DG_LIFECYCLE_PROBE__.persistedPagehide++;
        });
        window.addEventListener('pageshow', event => {
            window.__DG_LIFECYCLE_PROBE__.pageshow++;
            if (event.persisted) window.__DG_LIFECYCLE_PROBE__.persistedPageshow++;
        });
    });
}

async function waitForMainReady(page, timeout = 25000) {
    await page.waitForFunction(({ expectedBuild, expectedVersion }) => {
        const main = document.getElementById('mainChart');
        const loading = document.getElementById('loading');
        const resources = Array.from(document.querySelectorAll('script[src], link[rel="stylesheet"][href]')).map(element => element.src || element.href);
        const versions = [...new Set(resources.map(url => (url.match(/[?&]v=([^&]+)/) || [])[1]).filter(Boolean))];
        return window.__DG_BUILD__ === expectedBuild
            && versions.length > 0
            && versions.every(version => version === expectedVersion)
            && !!main?.dataset?.scope
            && !loading?.classList?.contains('show');
    }, { expectedBuild: VERSION.appBuild, expectedVersion: VERSION.resourceVersion }, { timeout });
}

async function runStartupCase(browser, mode) {
    const result = createResult(`startup:${mode}`);
    const context = await browser.newContext({ viewport, hasTouch: viewportName === 'mobile' });
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await installStorageMode(page, mode);
    try {
        await page.goto(`${baseUrl}/?stability=startup-${mode}-${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
        if (mode === 'fatal') {
            await page.waitForFunction(() => {
                const loading = document.getElementById('loading');
                return loading?.classList?.contains('show')
                    && loading.classList.contains('is-error')
                    && !!loading.querySelector('[data-startup-retry]');
            }, null, { timeout: 10000 });
            const snapshot = await page.evaluate(() => ({
                loadingClass: document.getElementById('loading')?.className || '',
                text: document.getElementById('loading')?.innerText || '',
                retry: !!document.querySelector('[data-startup-retry]'),
                schedulerStarted: !!window.__DG_REFRESH_SCHEDULERS_STARTED__
            }));
            check(result, snapshot.retry, 'fatal startup exposes a reload action', snapshot);
            check(result, snapshot.loadingClass.includes('is-error'), 'fatal startup reaches an explicit error state', snapshot);
            check(result, !snapshot.schedulerStarted, 'fatal startup stops refresh schedulers', snapshot);
        } else {
            await waitForMainReady(page);
            const snapshot = await page.evaluate(() => ({
                storage: { ...(window.__DG_STORAGE__ || {}) },
                loadingVisible: document.getElementById('loading')?.classList?.contains('show') || false,
                chartScope: document.getElementById('mainChart')?.dataset?.scope || '',
                confirmedStatus: state.confirmedStatus?.[state.id]?.status || ''
            }));
            const expectedStatus = { normal: 'available', missing: 'unavailable', throw: 'failed', blocked: 'blocked', timeout: 'failed' }[mode];
            check(result, snapshot.storage.status === expectedStatus, `${mode} storage reports ${expectedStatus}`, snapshot);
            check(result, !snapshot.loadingVisible && !!snapshot.chartScope, `${mode} storage reaches a usable first screen`, snapshot);
            check(result, !!snapshot.confirmedStatus, `${mode} storage preserves confirmed-history status`, snapshot);
        }
        check(result, pageErrors.length === 0, `${mode} startup has no uncaught page error`, pageErrors);
    } catch (error) {
        check(result, false, `${mode} startup scenario completed`, error.message);
    } finally {
        await context.close();
    }
    return result;
}

async function runStartupProfile(browser) {
    const cases = [];
    for (const mode of ['normal', 'missing', 'throw', 'blocked', 'timeout', 'fatal']) cases.push(await runStartupCase(browser, mode));
    return { name: 'startup', ok: cases.every(item => item.ok), cases };
}

async function runLifecycleProfile(browser) {
    const result = createResult('lifecycle');
    const context = await browser.newContext({ viewport: VIEWPORTS.desktop });
    const page = await context.newPage();
    const pageErrors = [];
    const bfcacheNotUsed = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await installLifecycleProbe(page);
    try {
        const lifecycleSession = await context.newCDPSession(page);
        await lifecycleSession.send('Page.enable');
        lifecycleSession.on('Page.backForwardCacheNotUsed', event => bfcacheNotUsed.push(event));
        await page.goto(`${baseUrl}/?stability=lifecycle-${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await waitForMainReady(page);
        let persistedReturns = 0;
        for (let cycle = 0; cycle < bfcacheCycles; cycle += 1) {
            await page.goto(`${baseUrl}/strategy-inspector.html?stability-cycle=${cycle}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await page.waitForFunction(expectedBuild => document.getElementById('strategyBuild')?.textContent?.includes(expectedBuild), VERSION.appBuild, { timeout: 10000 });
            await page.goBack({ waitUntil: 'domcontentloaded', timeout: 30000 });
            await waitForMainReady(page);
            const snapshot = await page.evaluate(() => ({
                persistedPageshow: window.__DG_LIFECYCLE_PROBE__?.persistedPageshow || 0,
                navigationType: performance.getEntriesByType('navigation')[0]?.type || '',
                notRestoredReasons: performance.getEntriesByType('navigation')[0]?.notRestoredReasons || null,
                intervals: window.__DG_REFRESH_RUNTIME__?.intervals?.size || 0,
                timeouts: window.__DG_REFRESH_RUNTIME__?.timeouts?.size || 0,
                restartCount: window.__DG_REFRESH_RUNTIME__?.restartCount || 0,
                leadershipHeartbeats: window.__DG_MARKET_REFRESH_RUNTIME__?.heartbeatActive ? 1 : 0,
                charts: Object.values(state.charts || {}).filter(Boolean).length
            }));
            persistedReturns = Math.max(persistedReturns, snapshot.persistedPageshow);
            check(result, snapshot.intervals <= 3 && snapshot.timeouts <= 1, `cycle ${cycle + 1} keeps one scheduler set`, snapshot);
            check(result, snapshot.leadershipHeartbeats === 1, `cycle ${cycle + 1} keeps one market-refresh heartbeat`, snapshot);
            check(result, snapshot.charts === VIEWPORTS.desktop.chartCount, `cycle ${cycle + 1} restores four desktop charts`, snapshot);
        }
        const delegateDisabledBfcache = persistedReturns === 0
            && bfcacheNotUsed.length > 0
            && bfcacheNotUsed.every(event => (event.notRestoredExplanations || []).some(item => item.reason === 'BackForwardCacheDisabledForDelegate'));
        if (persistedReturns > 0) {
            check(result, true, 'Chromium exercised at least one persisted bfcache return', { persistedReturns, bfcacheCycles });
        } else if (delegateDisabledBfcache) {
            warn(result, 'The automation delegate disabled BFCache; deterministic pagehide/pageshow regression remains authoritative', { persistedReturns, bfcacheCycles, bfcacheNotUsed });
        } else {
            check(result, false, 'Chromium exercised at least one persisted bfcache return', { persistedReturns, bfcacheCycles, bfcacheNotUsed });
        }

        await page.evaluate(() => openExternalWorkspace());
        await page.waitForFunction(() => state.tab === 'external');
        await page.waitForTimeout(100);
        await page.evaluate(() => openMarketWorkspace('index'));
        await page.waitForFunction(() => state.tab === 'index');
        const workspaceLeaveRuntime = await page.evaluate(() => getExternalObservationRuntime());
        check(result, !workspaceLeaveRuntime.externalLeadInFlight && !workspaceLeaveRuntime.sectorTrendInFlight, 'leaving the observation workspace cancels its foreground tasks', workspaceLeaveRuntime);

        await page.evaluate(() => openExternalWorkspace());
        await page.waitForFunction(() => state.tab === 'external');
        let visibilityOverride = 'unsupported';
        try {
            const coverPage = await context.newPage();
            await coverPage.goto(`${baseUrl}/strategy-inspector.html?stability=visibility`, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await coverPage.bringToFront();
            await page.waitForFunction(() => document.hidden === true, null, { timeout: 3000 });
            const hiddenRuntime = await page.evaluate(() => getExternalObservationRuntime());
            check(result, !hiddenRuntime.externalLeadInFlight && !hiddenRuntime.sectorTrendInFlight, 'hidden page cancels foreground observation tasks', hiddenRuntime);
            await coverPage.close();
            await page.bringToFront();
            await page.waitForFunction(() => document.hidden === false, null, { timeout: 3000 });
            visibilityOverride = 'foreground-page';
        } catch (error) {
            warn(result, 'Chromium visibility override is unavailable; deterministic visibility regression remains authoritative', error.message);
        }
        result.visibilityOverride = visibilityOverride;
        check(result, pageErrors.length === 0, 'lifecycle profile has no uncaught page error', pageErrors);
    } catch (error) {
        check(result, false, 'lifecycle profile completed', error.message);
    } finally {
        await context.close();
    }
    return result;
}

async function collectRuntimeSample(page, session, label, elapsedMs) {
    try { await session.send('HeapProfiler.collectGarbage'); } catch (error) {}
    const [heap, dom, runtime] = await Promise.all([
        session.send('Runtime.getHeapUsage'),
        session.send('Memory.getDOMCounters'),
        page.evaluate(() => ({
            charts: Object.values(state.charts || {}).filter(Boolean).length,
            renderCache: typeof renderCache !== 'undefined' ? renderCache.size : null,
            dateIndexCache: typeof dateIndexCache !== 'undefined' ? dateIndexCache.size : null,
            derivedIndicatorCache: typeof derivedIndicatorCache !== 'undefined' ? derivedIndicatorCache.size : null,
            refreshJobs: typeof cachedFetchRefreshJobs !== 'undefined' ? cachedFetchRefreshJobs.size : null,
            jsonpCleanups: typeof _jsonpCleanupFns !== 'undefined' ? _jsonpCleanupFns.size : null,
            perfTraces: window.__DG_PERF__?.traces?.length || 0,
            longTasks: window.__DG_LONG_TASKS__?.length || 0,
            schedulerIntervals: window.__DG_REFRESH_RUNTIME__?.intervals?.size || 0,
            schedulerTimeouts: window.__DG_REFRESH_RUNTIME__?.timeouts?.size || 0,
            leadershipHeartbeats: window.__DG_MARKET_REFRESH_RUNTIME__?.heartbeatActive ? 1 : 0,
            sidebarFullSyncInFlight: !!window.__DG_SIDEBAR_FULL_SYNC__?.inFlight,
            external: typeof getExternalObservationRuntime === 'function' ? getExternalObservationRuntime() : null
        }))
    ]);
    return {
        label,
        elapsedMs,
        heapUsedBytes: heap.usedSize,
        heapBackingBytes: heap.backingStorageSize,
        documents: dom.documents,
        nodes: dom.nodes,
        jsEventListeners: dom.jsEventListeners,
        ...runtime
    };
}

async function warmSoakPaths(page) {
    await page.evaluate(() => _selectStockImpl('600519', '贵州茅台'));
    await page.waitForFunction(() => state.stockId === '600519', null, { timeout: 15000 });
    await page.evaluate(() => _selectStockImpl('300750', '宁德时代'));
    await page.waitForFunction(() => state.stockId === '300750', null, { timeout: 15000 });
    await page.evaluate(() => _selectIndexImpl('cy'));
    await page.waitForFunction(() => state.id === 'cy', null, { timeout: 15000 });
    await page.evaluate(() => _selectIndexImpl('sh'));
    await page.waitForFunction(() => state.id === 'sh', null, { timeout: 15000 });
    for (const strategy of ['综合全能型', '稳健趋势型']) {
        await page.evaluate(async strategyName => {
            const pending = switchStrategy(strategyName);
            setTimeout(() => document.getElementById('customModalBtnOk')?.click(), 10);
            await pending;
        }, strategy);
    }
}

async function runSoakInteraction(page, cycle) {
    const step = cycle % 4;
    if (step === 0) {
        await page.evaluate(() => _selectStockImpl('600519', '贵州茅台'));
        await page.waitForFunction(() => state.stockId === '600519', null, { timeout: 10000 });
    } else if (step === 1) {
        await page.evaluate(() => _selectIndexImpl('cy'));
        await page.waitForFunction(() => state.id === 'cy', null, { timeout: 10000 });
    } else if (step === 2) {
        await page.evaluate(() => _selectStockImpl('300750', '宁德时代'));
        await page.waitForFunction(() => state.stockId === '300750', null, { timeout: 10000 });
    } else {
        await page.evaluate(() => _selectIndexImpl('sh'));
        await page.waitForFunction(() => state.id === 'sh', null, { timeout: 10000 });
    }
    if (cycle > 0 && cycle % 10 === 0) {
        await page.evaluate(async strategy => {
            const pending = switchStrategy(strategy);
            setTimeout(() => document.getElementById('customModalBtnOk')?.click(), 10);
            await pending;
        }, cycle % 20 === 0 ? '综合全能型' : '稳健趋势型');
    }
}

async function runSoakProfile(browser) {
    const result = createResult(`soak:${viewportName}`);
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const pageErrors = [];
    const consoleErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    await page.addInitScript(() => {
        window.__DG_LONG_TASKS__ = [];
        try {
            const observer = new PerformanceObserver(list => {
                for (const entry of list.getEntries()) {
                    window.__DG_LONG_TASKS__.push({ startTime: entry.startTime, duration: entry.duration });
                    if (window.__DG_LONG_TASKS__.length > 200) window.__DG_LONG_TASKS__.shift();
                }
            });
            observer.observe({ entryTypes: ['longtask'] });
        } catch (error) {}
    });
    const session = await context.newCDPSession(page);
    const samples = [];
    try {
        await page.goto(`${baseUrl}/?stability=soak-${viewportName}-${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await waitForMainReady(page);
        await warmSoakPaths(page);
        await page.waitForTimeout(1000);
        await page.route('**/*', route => {
            const url = route.request().url();
            let sameOrigin = false;
            try { sameOrigin = new URL(url).origin === new URL(baseUrl).origin; } catch (error) {}
            if (sameOrigin || url.startsWith('data:') || url.startsWith('blob:')) route.continue();
            else route.abort('blockedbyclient');
        });
        for (let warmCycle = 0; warmCycle < 12; warmCycle += 1) await runSoakInteraction(page, warmCycle);
        await page.waitForTimeout(5000);
        const startedAt = Date.now();
        const durationMs = durationMinutes * 60 * 1000;
        const checkpointMs = [0, durationMs / 3, durationMs * 2 / 3, durationMs];
        let nextCheckpoint = 0;
        let cycle = 0;
        let nextProgressAt = 60 * 1000;
        samples.push(await collectRuntimeSample(page, session, 'baseline', 0));
        nextCheckpoint = 1;
        while (Date.now() - startedAt < durationMs) {
            await runSoakInteraction(page, cycle++);
            const elapsed = Date.now() - startedAt;
            if (nextCheckpoint < checkpointMs.length && elapsed >= checkpointMs[nextCheckpoint]) {
                samples.push(await collectRuntimeSample(page, session, `checkpoint-${nextCheckpoint}`, elapsed));
                nextCheckpoint++;
            }
            if (elapsed >= nextProgressAt) {
                process.stderr.write(`[stability] ${viewportName} soak ${Math.round(elapsed / 60000)}/${durationMinutes} min, cycles=${cycle}\n`);
                nextProgressAt += 60 * 1000;
            }
            await page.waitForTimeout(interactionIntervalMs);
        }
        await page.waitForTimeout(10000);
        samples.push(await collectRuntimeSample(page, session, 'final', Date.now() - startedAt));
        const baseline = samples[0];
        const final = samples[samples.length - 1];
        const heapGrowth = baseline.heapUsedBytes > 0 ? (final.heapUsedBytes - baseline.heapUsedBytes) / baseline.heapUsedBytes : 0;
        const nodeLimit = baseline.nodes * 1.15 + 100;
        const listenerLimit = baseline.jsEventListeners * 1.15 + 20;
        check(result, heapGrowth <= 0.15, 'forced-GC heap growth stays within 15%', { baseline: baseline.heapUsedBytes, final: final.heapUsedBytes, growthPct: Number((heapGrowth * 100).toFixed(1)) });
        check(result, final.nodes <= nodeLimit, 'DOM nodes do not grow beyond the stability allowance', { baseline: baseline.nodes, final: final.nodes, limit: nodeLimit });
        check(result, final.jsEventListeners <= listenerLimit, 'event listeners do not grow beyond the stability allowance', { baseline: baseline.jsEventListeners, final: final.jsEventListeners, limit: listenerLimit });
        check(result, final.charts === viewport.chartCount, `${viewportName} keeps the expected chart instance count`, final);
        check(result, final.refreshJobs === 0, 'foreground selection refresh jobs settle after the soak', final);
        check(result, final.jsonpCleanups === 0, 'JSONP cleanup registry is empty after the soak', final);
        check(result,
            final.renderCache <= RUNTIME_BUFFER_BUDGETS.renderCache
                && final.dateIndexCache <= RUNTIME_BUFFER_BUDGETS.dateIndexCache
                && final.derivedIndicatorCache <= RUNTIME_BUFFER_BUDGETS.derivedIndicatorCache,
            'application caches stay within explicit bounds',
            { final, budgets: RUNTIME_BUFFER_BUDGETS }
        );
        check(result,
            final.perfTraces <= RUNTIME_BUFFER_BUDGETS.perfTraces && final.longTasks <= RUNTIME_BUFFER_BUDGETS.longTasks,
            'diagnostic buffers stay bounded',
            { final, budgets: RUNTIME_BUFFER_BUDGETS }
        );
        check(result, final.schedulerIntervals <= 3 && final.schedulerTimeouts <= 1, 'only one refresh scheduler set remains active', final);
        check(result, final.leadershipHeartbeats === 1, 'only one market-refresh heartbeat remains active', final);
        check(result, !final.sidebarFullSyncInFlight, 'sidebar full sync is settled at final checkpoint', final);
        check(result, !final.external?.externalLeadInFlight && !final.external?.sectorTrendInFlight, 'observation tasks are settled at final checkpoint', final.external);
        check(result, pageErrors.length === 0, 'soak has no uncaught page errors', pageErrors);
        const relevantConsoleErrors = consoleErrors.filter(message => !/ERR_BLOCKED_BY_CLIENT|Failed to load resource/i.test(message));
        check(result, relevantConsoleErrors.length === 0, 'soak has no unexpected console errors', relevantConsoleErrors);
        result.durationMinutes = durationMinutes;
        result.cycles = cycle;
        result.samples = samples;
    } catch (error) {
        check(result, false, `${viewportName} soak completed`, error.stack || error.message);
    } finally {
        try { await session.detach(); } catch (error) {}
        await context.close();
    }
    return result;
}

function compactStabilityEvidence(evidence) {
    if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) return evidence;
    if (Array.isArray(evidence.bfcacheNotUsed)) {
        const reasons = [...new Set(evidence.bfcacheNotUsed.flatMap(event => (
            event.notRestoredExplanations || []
        ).map(item => item.reason)).filter(Boolean))];
        return {
            persistedReturns: evidence.persistedReturns,
            bfcacheCycles: evidence.bfcacheCycles,
            notUsedCount: evidence.bfcacheNotUsed.length,
            reasons
        };
    }
    return evidence;
}

function compactStabilityResult(result) {
    if (Array.isArray(result.cases)) {
        return {
            name: result.name,
            ok: result.ok,
            cases: result.cases.map(item => ({
                name: item.name,
                ok: item.ok,
                failures: item.failures,
                warnings: item.warnings,
                failedChecks: (item.checks || []).filter(checkItem => !checkItem.ok)
            }))
        };
    }
    const samples = result.samples || [];
    return {
        name: result.name,
        ok: result.ok,
        failures: result.failures,
        warnings: (result.warnings || []).map(item => ({
            ...item,
            evidence: compactStabilityEvidence(item.evidence)
        })),
        visibilityOverride: result.visibilityOverride,
        durationMinutes: result.durationMinutes,
        cycles: result.cycles,
        checkCount: (result.checks || []).length,
        failedChecks: (result.checks || []).filter(item => !item.ok),
        baseline: samples[0] || null,
        final: samples[samples.length - 1] || null
    };
}

async function main() {
    if (!viewport) throw new Error(`Unknown --viewport=${viewportName}. Use desktop or mobile.`);
    if (!['startup', 'lifecycle', 'soak', 'all'].includes(profile)) throw new Error('Use --profile=startup, lifecycle, soak, or all.');
    const { chromium } = resolvePlaywright();
    const launchOptions = {
        headless: !headed,
        // Playwright disables BFCache by default for test determinism. This profile
        // explicitly restores it so persisted pagehide/pageshow paths are exercised.
        ignoreDefaultArgs: ['--disable-back-forward-cache']
    };
    if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) launchOptions.executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
    const browser = await chromium.launch(launchOptions);
    const results = [];
    try {
        if (profile === 'startup' || profile === 'all') results.push(await runStartupProfile(browser));
        if (profile === 'lifecycle' || profile === 'all') results.push(await runLifecycleProfile(browser));
        if (profile === 'soak' || profile === 'all') results.push(await runSoakProfile(browser));
    } finally {
        await browser.close();
    }
    const report = {
        ok: results.every(result => result.ok),
        expectedBuild: VERSION.appBuild,
        expectedVersion: VERSION.resourceVersion,
        profile,
        viewport: { name: viewportName, width: viewport.width, height: viewport.height },
        durationMinutes: profile === 'soak' || profile === 'all' ? durationMinutes : null,
        results
    };
    const output = summaryOutput ? { ...report, results: report.results.map(compactStabilityResult) } : report;
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    if (!report.ok && !noFail) process.exitCode = 1;
}

main().catch(error => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exit(1);
});
