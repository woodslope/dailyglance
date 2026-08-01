#!/usr/bin/env node

const path = require('path');
const { createRequire } = require('module');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_URL = 'https://woodslope.github.io/dailyglance';
const EXPECTED_RESOURCE_VERSION = '20260802-01';
const EXPECTED_APP_BUILD = '2026-08-02-01';
const EXPECTED_SIGNAL_VERSION = 'v4.2.13';
const VALID_DISPLAY_MODES = ['confirmed', 'live-overlay', 'cached-live-overlay', 'post-close-pending', 'quote-only'];

const args = new Map();
for (const arg of process.argv.slice(2)) {
    const [key, value = ''] = arg.split('=');
    args.set(key, value);
}

const baseUrl = (args.get('--url') || DEFAULT_URL).replace(/\/$/, '');
const headed = args.has('--headed');

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
    throw new Error('Playwright not found. Install it for this project or run from Codex primary runtime.');
}

function assert(condition, message, detail = null) {
    if (!condition) {
        const suffix = detail ? `\n${JSON.stringify(detail, null, 2)}` : '';
        throw new Error(`${message}${suffix}`);
    }
}

function isAppUrl(url = '') {
    return url === '' || url.startsWith(baseUrl) || url.startsWith(`${baseUrl}/`);
}

function isDate(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(value || '');
}

function parsePriceText(value = '') {
    const parsed = Number(String(value).replace(/[^\d.-]/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
}

function nearEqual(a, b, tolerance = 0.03) {
    return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tolerance;
}

function validateRefreshBadge(snapshot) {
    const { refreshBadge } = snapshot;
    assert(refreshBadge, 'refresh badge missing', snapshot);
    assert(snapshot.conclusionStatusCount === 0, 'conclusion card should not render a duplicate status badge', snapshot);
    assert(VALID_DISPLAY_MODES.includes(refreshBadge['data-dg-display-mode']), 'display mode is invalid', refreshBadge);
    assert(refreshBadge['data-dg-confirmed-status'] && refreshBadge['data-dg-confirmed-status'] !== 'unknown', 'confirmed status is not ready', refreshBadge);
    assert(isDate(refreshBadge['data-dg-confirmed-date']), 'confirmed date is invalid', refreshBadge);
    assert(isDate(refreshBadge['data-dg-item-date']), 'item date is invalid', refreshBadge);
    assert(['true', 'false'].includes(refreshBadge['data-dg-item-live']), 'live flag is invalid', refreshBadge);
}

function validateDataflow(snapshot) {
    assert(snapshot.APP_BUILD === EXPECTED_APP_BUILD, 'unexpected APP_BUILD loaded from deployed page', snapshot);
    assert(snapshot.SIGNAL_VERSION === EXPECTED_SIGNAL_VERSION, 'unexpected SIGNAL_VERSION loaded from deployed page', snapshot);
    assert(snapshot.resourceVersions.length === 1 && snapshot.resourceVersions[0] === EXPECTED_RESOURCE_VERSION, 'resource version mismatch', snapshot);
    assert(snapshot.leftTabs.indexActive === true, 'left index tab is not active', snapshot.leftTabs);
    assert(snapshot.leftTabs.stockActive === false, 'stock tab should not be active during index smoke', snapshot.leftTabs);
    assert(snapshot.leftTabs.indexDisplay !== 'none', 'index list should be visible', snapshot.leftTabs);
    assert(snapshot.leftTabs.stockDisplay === 'none', 'stock list should be hidden during index smoke', snapshot.leftTabs);
    assert(snapshot.activeIndexItem, 'active index row missing from the left list', snapshot.leftTabs);
    assert(snapshot.activeIndexItem.code === 'sh', 'active left index row is not sh', snapshot.activeIndexItem);
    assert(snapshot.activeIndexItem.price !== null && snapshot.activeIndexItem.priceText !== '--', 'active left row price is not ready', snapshot.activeIndexItem);
    assert(snapshot.rawLatest && isDate(snapshot.rawLatest.date), 'rawData latest confirmed row missing', snapshot);
    assert(snapshot.activeLatest && isDate(snapshot.activeLatest.date), 'activeData latest row missing', snapshot);
    assert(snapshot.rightPrice && isDate(snapshot.rightPrice.date), 'right panel price date missing', snapshot.rightPrice);
    assert(snapshot.cardAnalysisHasConclusion, 'right analysis conclusion is missing', snapshot);
    assert(snapshot.displayStatus && VALID_DISPLAY_MODES.includes(snapshot.displayStatus.mode), 'display status mode is invalid', snapshot.displayStatus);
    assert(snapshot.confirmedStatus && snapshot.confirmedStatus.status !== 'unknown', 'confirmed status is not ready', snapshot.confirmedStatus);
    assert(snapshot.displayStatus.mode === snapshot.refreshBadge['data-dg-display-mode'], 'display status disagrees with refresh badge', snapshot);
    assert(snapshot.rightPrice.date === snapshot.refreshBadge['data-dg-item-date'], 'right panel date disagrees with status badge item date', snapshot);
    assert(snapshot.activeLatest.date === snapshot.rightPrice.date, 'active chart data date disagrees with right panel date', snapshot);
    assert(nearEqual(snapshot.activeLatest.close, snapshot.rightPrice.price), 'active chart close disagrees with right panel price', {
        activeLatest: snapshot.activeLatest,
        rightPrice: snapshot.rightPrice
    });
    assert(nearEqual(snapshot.activeIndexItem.price, snapshot.activeLatest.close), 'left active index quote disagrees with active chart close', {
        activeIndexItem: snapshot.activeIndexItem,
        activeLatest: snapshot.activeLatest
    });
    if (snapshot.displayStatus.mode === 'live-overlay') {
        assert(snapshot.liveQuote && snapshot.liveQuote.date === snapshot.activeLatest.date, 'live overlay should have matching liveQuote', snapshot);
        assert(snapshot.liveBar && snapshot.liveBar.date === snapshot.activeLatest.date, 'live overlay should have matching liveBar', snapshot);
        assert(snapshot.rawLatest.date < snapshot.activeLatest.date || snapshot.activeLatest.isLive === true, 'live overlay should not be written as confirmed rawData', snapshot);
        assert(snapshot.refreshBadge.text.includes('盘中临时'), 'refresh badge should mark intraday temporary data', snapshot.refreshBadge);
    }
    if (snapshot.displayStatus.mode === 'cached-live-overlay') {
        assert(snapshot.liveQuote && snapshot.liveQuote.date === snapshot.activeLatest.date, 'cached live overlay should have matching liveQuote', snapshot);
        assert(snapshot.liveBar && snapshot.liveBar.date === snapshot.activeLatest.date, 'cached live overlay should have matching liveBar', snapshot);
        assert(snapshot.liveBar.isCachedLive === true || snapshot.liveQuote.isCachedLive === true, 'cached live overlay should expose cached-live provenance', snapshot);
        assert(snapshot.refreshBadge.text.includes('缓存盘中'), 'refresh badge should mark cached intraday data', snapshot.refreshBadge);
    }
    if (snapshot.displayStatus.mode === 'post-close-pending') {
        assert(snapshot.liveQuote && snapshot.liveQuote.date === snapshot.activeLatest.date, 'post-close pending should keep matching liveQuote', snapshot);
        assert(snapshot.liveBar && snapshot.liveBar.date === snapshot.activeLatest.date, 'post-close pending should keep matching liveBar', snapshot);
        assert(snapshot.liveBar.isCachedLive === true || snapshot.liveQuote.isCachedLive === true, 'post-close pending should expose cached-live provenance', snapshot);
        assert(snapshot.refreshBadge.text.includes('盘后待确认'), 'refresh badge should mark post-close pending confirmation', snapshot.refreshBadge);
    }
    if (snapshot.displayStatus.mode === 'quote-only') {
        assert(!snapshot.activeLatest.isLive, 'quote-only must not drive active chart data', snapshot.activeLatest);
        assert(snapshot.rawLatest.date === snapshot.activeLatest.date, 'quote-only active data should remain confirmed history', snapshot);
    }
    if (snapshot.displayStatus.mode === 'confirmed') {
        assert(!snapshot.activeLatest.isLive, 'confirmed mode should not use live row', snapshot.activeLatest);
        assert(snapshot.rawLatest.date === snapshot.activeLatest.date, 'confirmed mode active data should match raw history', snapshot);
    }
    validateRefreshBadge(snapshot);
}

function validateDrag(drag) {
    assert(drag.during.drawViewportCount > 0, 'dragging should pan/redraw the viewport before release', drag);
    assert(
        drag.during.transforms.length > 0
            && drag.during.transforms.every(item => item.transform === '' || item.transform === 'translateX(0px)'),
        'dragging should not shift chart containers with CSS transform',
        drag
    );
    assert(drag.after.drawViewportCount >= drag.during.drawViewportCount, 'drag release should preserve the panned viewport draw count', drag);
    assert(drag.after.badgeDisplay !== 'none', 'dragging to history should show the history badge', drag.after);
    assert(drag.after.latestButton.isHistory === true && drag.after.latestButton.active === false, 'latest button should show historical state after drag', drag.after);
    assert(drag.restored.badgeDisplay === 'none', 'latest button should hide history badge after restore', drag.restored);
    assert(drag.restored.latestButton.active === true && drag.restored.latestButton.isHistory === false, 'latest button should return to active latest state', drag.restored);
    assert(drag.restored.rightPrice.date === drag.before.rightPrice.date, 'latest restore should return right panel to the latest date', drag);
}

async function waitForReady(page) {
    await page.waitForFunction(() => {
        const main = document.getElementById('mainChart');
        const analysis = document.getElementById('cardAnalysis');
        const activeIndex = document.querySelector('#indexNavList .nav-list-item.active .lprice[data-code="sh"]');
        return window.__DG_BUILD__
            && typeof state !== 'undefined'
            && main?.dataset?.scope === 'sh_daily'
            && analysis
            && getComputedStyle(analysis).display !== 'none'
            && analysis.innerText.includes('每日结论')
            && activeIndex
            && activeIndex.innerText.trim() !== '--';
    }, { timeout: 30000 });
}

async function collectSnapshot(page) {
    return page.evaluate(() => {
        const parseNumber = (value = '') => {
            const parsed = Number(String(value).replace(/[^\d.-]/g, ''));
            return Number.isFinite(parsed) ? parsed : null;
        };
        const attrMap = (selector) => {
            const el = document.querySelector(selector);
            if (!el) return null;
            return Array.from(el.attributes).reduce((acc, attr) => {
                if (attr.name.startsWith('data-dg-') || attr.name === 'class' || attr.name === 'title') acc[attr.name] = attr.value;
                return acc;
            }, { text: el.innerText.trim() });
        };
        const text = (selector) => document.querySelector(selector)?.innerText.trim() || '';
        const display = (selector) => {
            const el = document.querySelector(selector);
            return el ? getComputedStyle(el).display : '';
        };
        const activeData = getActiveData();
        const raw = state.rawData?.sh || [];
        const activeLatest = activeData?.length ? activeData[activeData.length - 1] : null;
        const rawLatest = raw.length ? raw[raw.length - 1] : null;
        const activeIndexEl = document.querySelector('#indexNavList .nav-list-item.active');
        const activeIndexPrice = activeIndexEl?.querySelector('.lprice[data-code="sh"]')?.innerText.trim() || '';
        const rightPriceText = text('#cardPrice .price-main');
        const rightDateText = text('#cardPrice .header-meta-row .mono');
        const rightDateMatch = rightDateText.match(/\d{4}-\d{2}-\d{2}/);
        const resources = Array.from(document.querySelectorAll('script[src], link[rel="stylesheet"][href]')).map(el => el.src || el.href);
        return {
            APP_BUILD: window.__DG_BUILD__,
            SIGNAL_VERSION,
            resourceVersions: [...new Set(resources.map(url => (url.match(/[?&]v=([^&]+)/) || [])[1]).filter(Boolean))],
            stateId: state.id,
            stateMode: state.mode,
            stateTab: state.tab,
            rawLatest: rawLatest ? {
                date: rawLatest.date,
                close: rawLatest.close,
                isLive: !!rawLatest._isLive
            } : null,
            activeLatest: activeLatest ? {
                date: activeLatest.date,
                close: activeLatest.close,
                open: activeLatest.open,
                high: activeLatest.high,
                low: activeLatest.low,
                vol: activeLatest.vol,
                isLive: !!activeLatest._isLive
            } : null,
            liveQuote: state.liveQuotes?.sh ? {
                date: state.liveQuotes.sh.date,
                close: state.liveQuotes.sh.close,
                prevClose: state.liveQuotes.sh.prevClose,
                quoteDateSource: state.liveQuotes.sh.quoteDateSource || '',
                quality: state.liveQuotes.sh._quoteQuality || ''
            } : null,
            liveBar: state.liveBars?.sh ? {
                date: state.liveBars.sh.date,
                close: state.liveBars.sh.close,
                isLive: !!state.liveBars.sh._isLive,
                isCachedLive: !!state.liveBars.sh._isCachedLive
            } : null,
            displayStatus: state.displayStatus?.sh || null,
            confirmedStatus: state.confirmedStatus?.sh || null,
            leftTabs: {
                indexActive: document.querySelector('#mainTabs .nav-btn[data-tab="index"]')?.classList.contains('active') || false,
                stockActive: document.querySelector('#mainTabs .nav-btn[data-tab="stock"]')?.classList.contains('active') || false,
                indexDisplay: display('#indexNavList'),
                stockDisplay: display('#stockNavList'),
                indexText: text('#mainTabs .nav-btn[data-tab="index"]'),
                stockText: text('#mainTabs .nav-btn[data-tab="stock"]')
            },
            activeIndexItem: activeIndexEl ? {
                code: activeIndexEl.querySelector('.lprice')?.dataset?.code || '',
                name: activeIndexEl.querySelector('.lname')?.innerText.trim() || '',
                priceText: activeIndexPrice,
                price: parseNumber(activeIndexPrice),
                changeText: activeIndexEl.querySelector('.lchange[data-code="sh"]')?.innerText.trim() || ''
            } : null,
            rightPrice: {
                priceText: rightPriceText,
                price: parseNumber(rightPriceText),
                date: rightDateMatch ? rightDateMatch[0] : ''
            },
            cardAnalysisHasConclusion: text('#cardAnalysis').includes('每日结论'),
            refreshBadge: attrMap('#lastRefreshBar .data-status-pill'),
            conclusionStatusCount: document.querySelectorAll('#cardAnalysis .conclusion-status-pill').length
        };
    });
}

async function measureDrag(page) {
    const before = await collectSnapshot(page);
    await page.evaluate(() => {
        window.__dgSmokeOriginalDrawViewport = window.drawViewport;
        window.__dgSmokeDrawViewportCount = 0;
        window.drawViewport = function(...args) {
            window.__dgSmokeDrawViewportCount += 1;
            return window.__dgSmokeOriginalDrawViewport.apply(this, args);
        };
    });

    const chart = page.locator('#mainChart');
    const box = await chart.boundingBox();
    assert(box && box.width > 200 && box.height > 100, 'main chart box is not measurable', box);
    const y = box.y + box.height / 2;
    const startX = box.x + box.width * 0.62;
    const endX = startX - Math.min(220, box.width * 0.18);
    await page.mouse.move(startX, y);
    await page.mouse.down();
    await page.mouse.move(endX, y, { steps: 8 });
    await page.waitForTimeout(120);
    const during = await page.evaluate(() => ({
        drawViewportCount: window.__dgSmokeDrawViewportCount,
        transforms: Array.from(document.querySelectorAll('.main-chart-box, .volume-chart-box, .macd-chart-box, .kdj-chart-box')).map(el => ({
            className: el.className,
            transform: el.style.transform || ''
        }))
    }));
    await page.mouse.up();
    await page.waitForTimeout(350);
    const after = await page.evaluate(() => ({
        drawViewportCount: window.__dgSmokeDrawViewportCount,
        badgeDisplay: getComputedStyle(document.getElementById('freezeBadge')).display,
        badgeDate: document.querySelector('#freezeBadge .freeze-badge-date')?.innerText.trim() || '',
        latestButton: {
            active: document.getElementById('btnResetLatest')?.classList.contains('active') || false,
            isHistory: document.getElementById('btnResetLatest')?.classList.contains('is-history') || false
        },
        rightPrice: {
            date: (document.querySelector('#cardPrice .header-meta-row .mono')?.innerText.match(/\d{4}-\d{2}-\d{2}/) || [])[0] || '',
            price: Number((document.querySelector('#cardPrice .price-main')?.innerText || '').replace(/[^\d.-]/g, ''))
        }
    }));
    await page.click('#btnResetLatest');
    await page.waitForTimeout(350);
    const restored = await page.evaluate(() => ({
        badgeDisplay: getComputedStyle(document.getElementById('freezeBadge')).display,
        latestButton: {
            active: document.getElementById('btnResetLatest')?.classList.contains('active') || false,
            isHistory: document.getElementById('btnResetLatest')?.classList.contains('is-history') || false
        },
        rightPrice: {
            date: (document.querySelector('#cardPrice .header-meta-row .mono')?.innerText.match(/\d{4}-\d{2}-\d{2}/) || [])[0] || '',
            price: Number((document.querySelector('#cardPrice .price-main')?.innerText || '').replace(/[^\d.-]/g, ''))
        }
    }));
    await page.evaluate(() => {
        if (window.__dgSmokeOriginalDrawViewport) window.drawViewport = window.__dgSmokeOriginalDrawViewport;
    });
    return { before, during, after, restored };
}

async function main() {
    const { chromium } = resolvePlaywright();
    const launchOptions = { headless: !headed };
    if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) {
        launchOptions.executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
    }
    const browser = await chromium.launch(launchOptions);
    const blockingConsole = [];
    const externalResourceFailures = [];
    try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        page.on('console', message => {
            if (!['warn', 'error'].includes(message.type())) return;
            const entry = { type: message.type(), text: message.text(), url: message.location().url || '' };
            if (isAppUrl(entry.url)) blockingConsole.push(entry);
            else externalResourceFailures.push(entry);
        });
        page.on('pageerror', error => blockingConsole.push({ type: 'error', text: error.message, url: '' }));
        page.on('requestfailed', request => {
            const url = request.url();
            if (!isAppUrl(url)) {
                externalResourceFailures.push({
                    type: 'requestfailed',
                    text: request.failure()?.errorText || 'request failed',
                    url
                });
            }
        });
        await page.goto(`${baseUrl}/?v=smoke-${EXPECTED_RESOURCE_VERSION}-live-dataflow`, { waitUntil: 'domcontentloaded' });
        await waitForReady(page);
        await page.waitForTimeout(1500);

        const snapshot = await collectSnapshot(page);
        validateDataflow(snapshot);
        assert(blockingConsole.length === 0, 'deployed app produced local console warnings/errors', blockingConsole);

        const drag = await measureDrag(page);
        validateDrag(drag);

        console.log(JSON.stringify({ ok: true, snapshot, drag, externalResourceFailures }, null, 2));
    } finally {
        await browser.close();
    }
}

main().catch(error => {
    console.error(error.stack || error.message);
    process.exit(1);
});
