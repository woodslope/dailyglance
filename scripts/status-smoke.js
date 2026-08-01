#!/usr/bin/env node

const path = require('path');
const { spawn } = require('child_process');
const { createRequire } = require('module');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_PORT = 8766;
const EXPECTED_VERSION = '20260802-01';
const VALID_DISPLAY_MODES = ['confirmed', 'live-overlay', 'cached-live-overlay', 'post-close-pending', 'quote-only'];

const args = new Map();
for (const arg of process.argv.slice(2)) {
    const [key, value = ''] = arg.split('=');
    args.set(key, value);
}

const port = Number(args.get('--port')) || DEFAULT_PORT;
const baseUrl = args.get('--url') || `http://127.0.0.1:${port}`;
const keepServer = args.has('--external-server');

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
    throw new Error('Playwright not found. Install it for this project or run the Codex in-app browser smoke described in STABLE_VERSION_2026-06-30.md.');
}

function startServer() {
    if (keepServer) return null;
    const server = spawn('/usr/bin/python3', ['-m', 'http.server', String(port)], {
        cwd: ROOT,
        stdio: ['ignore', 'ignore', 'pipe']
    });
    server.stderr.on('data', chunk => process.stderr.write(chunk));
    return server;
}

function assert(condition, message, detail = null) {
    if (!condition) {
        const suffix = detail ? `\n${JSON.stringify(detail, null, 2)}` : '';
        throw new Error(`${message}${suffix}`);
    }
}

function isLocalAppUrl(url = '') {
    return url.startsWith(baseUrl)
        || url.startsWith('http://127.0.0.1:')
        || url.startsWith('http://localhost:')
        || url.startsWith('file://')
        || url === '';
}

function validateDateAttr(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(value || '');
}

function validateStatusBadges(result) {
    const badge = result.refreshBadge;
    assert(badge, 'refreshBadge missing', result);
    assert(result.conclusionStatusCount === 0, 'conclusion card should not render a duplicate status badge', result);
    assert(VALID_DISPLAY_MODES.includes(badge['data-dg-display-mode']), 'refreshBadge display mode is not valid', badge);
    assert(badge['data-dg-confirmed-status'] && badge['data-dg-confirmed-status'] !== 'unknown', 'refreshBadge confirmed status is not ready', badge);
    assert(validateDateAttr(badge['data-dg-confirmed-date']), 'refreshBadge confirmed date is invalid', badge);
    assert(validateDateAttr(badge['data-dg-item-date']), 'refreshBadge item date is invalid', badge);
    assert(['true', 'false'].includes(badge['data-dg-item-live']), 'refreshBadge live flag is invalid', badge);

    const mode = result.refreshBadge['data-dg-display-mode'];
    const itemLive = result.refreshBadge['data-dg-item-live'];
    const confirmedDate = result.refreshBadge['data-dg-confirmed-date'];
    const itemDate = result.refreshBadge['data-dg-item-date'];
    if (mode === 'confirmed') {
        assert(itemLive === 'false', 'confirmed mode cannot use a live item', result.refreshBadge);
        assert(itemDate === confirmedDate, 'confirmed mode item date should match confirmed date', result.refreshBadge);
        assert(result.refreshBadge.text.includes('收盘确认'), 'confirmed badge should be visibly confirmed', result.refreshBadge);
    } else if (mode === 'live-overlay') {
        assert(itemLive === 'true', 'live overlay mode must use a live item', result.refreshBadge);
        assert(itemDate >= confirmedDate, 'live overlay item date cannot be older than confirmed history', result.refreshBadge);
        assert(result.refreshBadge.text.includes('盘中临时'), 'live overlay badge should be visibly temporary', result.refreshBadge);
    } else if (mode === 'cached-live-overlay') {
        assert(itemLive === 'true', 'cached live overlay mode must use a live item', result.refreshBadge);
        assert(result.refreshBadge['data-dg-live-cached'] === 'true', 'cached live overlay should expose cached-live smoke attr', result.refreshBadge);
        assert(result.refreshBadge.text.includes('缓存盘中'), 'cached live overlay should show cached source in refresh', result.refreshBadge);
    } else if (mode === 'post-close-pending') {
        assert(itemLive === 'true', 'post-close pending mode must keep the last same-day live item', result.refreshBadge);
        assert(result.refreshBadge['data-dg-live-cached'] === 'true', 'post-close pending should expose cached-live smoke attr', result.refreshBadge);
        assert(result.refreshBadge.text.includes('盘后待确认'), 'post-close pending badge should be visibly pending confirmation', result.refreshBadge);
    } else if (mode === 'quote-only') {
        assert(itemLive === 'false', 'quote-only mode cannot drive a live chart item', result.refreshBadge);
        assert(result.refreshBadge['data-dg-display-reason'], 'quote-only mode should expose a reason', result.refreshBadge);
        assert(result.refreshBadge.text.includes('仅左侧报价'), 'quote-only badge should show quote-only refresh', result.refreshBadge);
    }
}

async function main() {
    const { chromium } = resolvePlaywright();
    const server = startServer();
    const launchOptions = { headless: true };
    if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) {
        launchOptions.executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
    }
    const browser = await chromium.launch(launchOptions);
    try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        const blockingConsole = [];
        const externalResourceFailures = [];
        page.on('console', message => {
            if (!['warn', 'error'].includes(message.type())) return;
            const entry = { type: message.type(), text: message.text(), url: message.location().url || '' };
            if (isLocalAppUrl(entry.url)) blockingConsole.push(entry);
            else externalResourceFailures.push(entry);
        });
        page.on('pageerror', error => blockingConsole.push({ type: 'error', text: error.message, url: '' }));
        page.on('requestfailed', request => {
            const url = request.url();
            if (!isLocalAppUrl(url)) {
                externalResourceFailures.push({
                    type: 'requestfailed',
                    text: request.failure()?.errorText || 'request failed',
                    url
                });
            }
        });
        await page.goto(`${baseUrl}/?v=smoke-${EXPECTED_VERSION}-desktop`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(8000);

        const result = await page.evaluate((expectedVersion) => {
            const resources = Array.from(document.querySelectorAll('script[src], link[rel="stylesheet"][href]')).map(el => el.src || el.href);
            const versions = [...new Set(resources.map(url => (url.match(/[?&]v=([^&]+)/) || [])[1]).filter(Boolean))];
            const canvasIds = ['mainChart', 'volumeChart', 'macdChart', 'kdjChart'];
            const canvases = canvasIds.map(id => {
                const el = document.getElementById(id);
                const rect = el?.getBoundingClientRect();
                return {
                    id,
                    exists: !!el,
                    width: el?.width || 0,
                    height: el?.height || 0,
                    boxWidth: rect ? Math.round(rect.width) : 0,
                    boxHeight: rect ? Math.round(rect.height) : 0,
                    scope: el?.dataset?.scope || ''
                };
            });
            const readAttrs = (selector) => {
                const el = document.querySelector(selector);
                if (!el) return null;
                return Array.from(el.attributes).reduce((acc, attr) => {
                    if (attr.name.startsWith('data-dg-') || ['title', 'data-tooltip', 'aria-label', 'class'].includes(attr.name)) acc[attr.name] = attr.value;
                    return acc;
                }, { text: el.innerText.trim() });
            };
            return {
                expectedVersion,
                versions,
                currentResourceCount: resources.filter(url => url.includes(expectedVersion)).length,
                oldResourceCount: resources.filter(url => /20260630-(09|10|11)/.test(url)).length,
                viewport: { width: innerWidth, height: innerHeight },
                mobileGateDisplay: getComputedStyle(document.getElementById('mobileGate')).display,
                mainContainerDisplay: getComputedStyle(document.querySelector('.main-container')).display,
                emptyHintCount: document.querySelectorAll('.empty-hint').length,
                noDataText: document.body.innerText.includes('暂无数据'),
                cardAnalysisDisplay: getComputedStyle(document.getElementById('cardAnalysis')).display,
                cardAnalysisHasConclusion: (document.getElementById('cardAnalysis')?.innerText || '').includes('每日结论'),
                refreshBadge: readAttrs('#lastRefreshBar .data-status-pill'),
                conclusionStatusCount: document.querySelectorAll('#cardAnalysis .conclusion-status-pill').length,
                canvases
            };
        }, EXPECTED_VERSION);

        assert(result.versions.length === 1 && result.versions[0] === EXPECTED_VERSION, 'resource versions are not current', result);
        assert(result.currentResourceCount >= 7 && result.oldResourceCount === 0, 'resource cache-busting check failed', result);
        assert(result.viewport.width >= 1024 && result.mobileGateDisplay === 'none' && result.mainContainerDisplay === 'flex', 'desktop viewport did not render the terminal', result);
        assert(result.emptyHintCount === 0 && result.noDataText === false, 'empty chart hint remains visible', result);
        assert(result.cardAnalysisDisplay === 'flex' && result.cardAnalysisHasConclusion, 'right analysis panel is not ready', result);
        for (const canvas of result.canvases) {
            assert(canvas.exists && canvas.width > 0 && canvas.height > 0 && canvas.boxWidth > 0 && canvas.boxHeight > 0, 'chart canvas did not recover', canvas);
            assert(canvas.scope === 'sh_daily', 'chart canvas scope mismatch', canvas);
        }
        validateStatusBadges(result);
        assert(blockingConsole.length === 0, 'browser console has local app warnings/errors', blockingConsole);

        console.log(JSON.stringify({ ok: true, result, externalResourceFailures }, null, 2));
    } finally {
        await browser.close();
        if (server) server.kill('SIGTERM');
    }
}

main().catch(error => {
    console.error(error.stack || error.message);
    process.exit(1);
});
