#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { createRequire } = require('module');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_PORT = 8771;
const args = new Map(process.argv.slice(2).map(arg => {
    const [key, value = ''] = arg.split('=');
    return [key, value];
}));
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
    throw new Error('未找到 Playwright 运行时。');
}

function resolveBrowserExecutable() {
    if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
    const candidates = [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Chromium.app/Contents/MacOS/Chromium'
    ];
    return candidates.find(candidate => fs.existsSync(candidate)) || '';
}

function startServer() {
    if (keepServer) return null;
    const server = spawn('/usr/bin/python3', ['-m', 'http.server', String(port)], {
        cwd: ROOT,
        stdio: 'ignore'
    });
    return server;
}

function assert(condition, message, detail) {
    if (condition) return;
    throw new Error(`${message}${detail ? `\n${JSON.stringify(detail, null, 2)}` : ''}`);
}

function isLocal(url) {
    return url.startsWith(baseUrl) || url.startsWith('http://127.0.0.1:') || url.startsWith('http://localhost:');
}

async function preparePage(browser, viewport, options = {}) {
    const context = await browser.newContext({
        viewport,
        hasTouch: !!options.hasTouch,
        reducedMotion: options.reducedMotion || 'no-preference'
    });
    if (options.savedStrategy) {
        await context.addInitScript(name => localStorage.setItem('quant_strategy', name), options.savedStrategy);
    }
    await context.route('**/*', route => isLocal(route.request().url()) ? route.continue() : route.abort('blockedbyclient'));
    const page = await context.newPage();
    return { context, page };
}

function channel(hex) {
    const value = parseInt(hex, 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function contrast(foreground, background) {
    const parse = value => value.replace('#', '').match(/../g).map(channel);
    const luminance = value => {
        const [r, g, b] = parse(value);
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const a = luminance(foreground);
    const b = luminance(background);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

async function checkStrategyGate(browser, width) {
    const { context, page } = await preparePage(browser, { width, height: 800 });
    try {
        await page.goto(`${baseUrl}/strategy-inspector.html`, { waitUntil: 'domcontentloaded' });
        const result = await page.evaluate(() => ({
            gate: getComputedStyle(document.getElementById('mobileGate')).display,
            inspector: document.querySelector('.strategy-inspector-shell') ? getComputedStyle(document.querySelector('.strategy-inspector-shell')).display : null,
            copy: document.getElementById('mobileGate')?.innerText || ''
        }));
        assert(result.gate === 'flex', `strategy-inspector.html 在 ${width}px 未显示电脑端门槛`, result);
        assert(result.inspector === 'none', `strategy-inspector.html 在 ${width}px 仍显示策略地图`, result);
        assert(result.copy.includes('1024px'), `strategy-inspector.html 的门槛未说明最小宽度`, result);
    } finally {
        await context.close();
    }
}

async function checkMainMobile(browser, width, height = 844) {
    const { context, page } = await preparePage(browser, { width, height }, { hasTouch: true, reducedMotion: 'reduce' });
    try {
        await page.goto(`${baseUrl}/index.html?ui-governance=mobile-${width}`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => typeof renderActiveSelectionStatus === 'function' && typeof renderIndexList === 'function');
        if (width === 390) {
            await page.waitForFunction(() => window.__DG_PERF__?.latest('startup')?.meta?.path === 'initial-mobile-index-ready', null, { timeout: 15000 });
            const startup = await page.evaluate(() => ({
                path: window.__DG_PERF__.latest('startup').meta.path,
                period: state.period,
                range: state.range,
                activeMAs: state.activeMAs.slice()
            }));
            assert(startup.path === 'initial-mobile-index-ready' && startup.period === 'daily' && startup.range === 90 && startup.activeMAs.join(',') === '5,20,60', '390px 没有通过真实移动初始化路径进入默认主图状态', startup);
        }
        await page.evaluate(() => {
            globalSelectionSeq += 1;
            hideLoading();
            state.tab = 'index';
            state.mode = 'index';
            state.id = 'sh';
            renderIndexList();
            clearCharts('error');
            renderActiveSelectionStatus('unavailable');

            // Use production-sized values so the compact index rail is checked for
            // internal overlap, not only page-level horizontal overflow.
            document.querySelectorAll('#indexNavList .nav-list-item').forEach(item => {
                const price = item.querySelector('.lprice');
                const change = item.querySelector('.lchange');
                if (price) price.textContent = '3882.01';
                if (change) change.textContent = '-0.59%';
            });

            const fixture = document.createElement('div');
            fixture.className = 'action-panel panel-neutral';
            fixture.style.cssText = 'position:fixed;left:12px;top:0;width:calc(100vw - 24px);visibility:hidden;pointer-events:none;';
            fixture.innerHTML = `
                <div class="action-line">
                    <div class="action-name">保持低风险暴露并等待市场重新确认</div>
                    <div class="action-cap"><span>当前风险仓位</span><strong class="mono">0%</strong></div>
                </div>
            `;
            fixture.dataset.mobileGovernanceFixture = 'action-line';
            document.body.appendChild(fixture);
        });

        const result = await page.evaluate(() => {
            const visible = selector => getComputedStyle(document.querySelector(selector)).display !== 'none';
            const rect = selector => document.querySelector(selector).getBoundingClientRect();
            const toRect = element => {
                const box = element.getBoundingClientRect();
                return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height };
            };
            const overlaps = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
            const activeItem = document.querySelector('#indexNavList .nav-list-item.active');
            const refreshRect = rect('#lastRefreshBar');
            const priceRect = rect('#cardPrice');
            const analysisRect = rect('#cardAnalysis');
            const chartRect = rect('.chart-section');
            const refreshVisible = getComputedStyle(document.querySelector('#lastRefreshBar')).display !== 'none';
            const indexRailElement = document.querySelector('#indexNavList .index-list-items');
            const indexRail = Array.from(document.querySelectorAll('#indexNavList .nav-list-item')).map(item => {
                const card = toRect(item);
                const code = toRect(item.querySelector('.lcode'));
                const price = toRect(item.querySelector('.lprice'));
                const change = toRect(item.querySelector('.lchange'));
                const fields = { code, price, change };
                const pairs = [['code', 'price'], ['code', 'change'], ['price', 'change']];
                const badOverlaps = pairs.filter(([left, right]) => overlaps(fields[left], fields[right])).map(([left, right]) => `${left}:${right}`);
                const outOfCard = Object.entries(fields).filter(([, field]) => field.left < card.left || field.right > card.right || field.top < card.top || field.bottom > card.bottom).map(([name]) => name);
                return { width: card.width, badOverlaps, outOfCard };
            });
            const actionFixture = document.querySelector('[data-mobile-governance-fixture="action-line"]');
            const actionLine = actionFixture?.querySelector('.action-line');
            const actionName = actionFixture?.querySelector('.action-name');
            const actionCap = actionFixture?.querySelector('.action-cap');
            const actionLineRect = actionLine ? toRect(actionLine) : null;
            const actionNameRect = actionName ? toRect(actionName) : null;
            const actionCapRect = actionCap ? toRect(actionCap) : null;
            return {
                width: innerWidth,
                main: getComputedStyle(document.getElementById('marketWorkspace')).display,
                headerPosition: getComputedStyle(document.querySelector('.header')).position,
                gatePresent: !!document.getElementById('mobileGate'),
                externalTab: getComputedStyle(document.querySelector('[data-tab="external"]')).display,
                currentTab: document.querySelector('#mainTabs .nav-btn[aria-current="page"]')?.dataset.tab,
                bodyOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
                bodyOverflowY: getComputedStyle(document.body).overflowY,
                navBeforeRefresh: !refreshVisible || rect('.nav-section').bottom <= refreshRect.top,
                refreshBeforeChart: !refreshVisible || refreshRect.bottom <= chartRect.top,
                chartBeforePrice: chartRect.bottom <= priceRect.top,
                priceBeforeAnalysis: priceRect.bottom <= analysisRect.top,
                mobileMeta: visible('.mobile-chart-meta'),
                mainChart: visible('.main-chart-box'),
                secondaryCharts: ['.volume-chart-box', '.macd-chart-box', '.kdj-chart-box'].map(visible),
                visibleHints: Array.from(document.querySelectorAll('.empty-hint')).filter(el => getComputedStyle(el).display !== 'none').map(el => el.innerText),
                activeItemVisible: !!activeItem && activeItem.getBoundingClientRect().left >= 0 && activeItem.getBoundingClientRect().right <= innerWidth,
                settingsTarget: rect('#btnSettings').height,
                headerHeight: rect('.header').height,
                settingsTop: rect('#btnSettings').top,
                headerTabsTop: rect('.header-center').top,
                refreshTarget: rect('#updateDataBtn').height,
                errorText: document.getElementById('cardAnalysis').innerText,
                retryCount: document.querySelectorAll('#cardAnalysis .state-retry-action').length,
                chartTouchAction: getComputedStyle(document.getElementById('mainChart')).touchAction,
                indexRail: {
                    minCardWidth: Math.min(...indexRail.map(item => item.width)),
                    badOverlaps: indexRail.flatMap((item, index) => item.badOverlaps.map(pair => `${index}:${pair}`)),
                    outOfCard: indexRail.flatMap((item, index) => item.outOfCard.map(field => `${index}:${field}`)),
                    scrollPaddingInline: getComputedStyle(indexRailElement).scrollPaddingInline
                },
                mobileActionLayout: {
                    valid: !!actionLineRect && !!actionNameRect && !!actionCapRect
                        && actionNameRect.left >= actionLineRect.left
                        && actionNameRect.right <= actionCapRect.left
                        && actionCapRect.right <= actionLineRect.right
                        && actionNameRect.bottom <= actionLineRect.bottom
                        && actionCapRect.bottom <= actionLineRect.bottom,
                    lineHeight: actionLineRect?.height || 0,
                    nameHeight: actionNameRect?.height || 0,
                    capHeight: actionCapRect?.height || 0
                }
            };
        });
        assert(result.main === 'flex' && !result.gatePresent, `${width}px 首页未进入手机精简版`, result);
        assert(result.headerPosition === 'sticky' && result.externalTab === 'none' && result.currentTab === 'index', `${width}px 手机导航不符合精简边界`, result);
        assert(result.bodyOverflow <= 0 && result.bodyOverflowY === 'auto', `${width}px 页面滚动或横向溢出异常`, result);
        assert(result.navBeforeRefresh && result.refreshBeforeChart && result.chartBeforePrice && result.priceBeforeAnalysis, `${width}px 内容顺序不是标的→刷新→主图→价格→结论`, result);
        assert(result.mobileMeta && result.mainChart && result.secondaryCharts.every(value => !value), `${width}px 没有保持单 K 图布局`, result);
        assert(result.visibleHints.length === 1 && result.visibleHints[0].includes('K 线图'), `${width}px 错误态仍为隐藏副图生成可见占位`, result);
        // 顶栏设置与图表更新按钮在手机档为 36px 命中区（见 dailyglance.css 的窄屏规则），
        // 这是为顶栏层级间距做的有意取舍；搜索、主导航和自选股删除入口仍保持 44px 门槛。
        assert(result.activeItemVisible && result.settingsTarget >= 36 && result.refreshTarget >= 36, `${width}px 标的选中态或触控目标不合格`, result);
        assert(result.headerHeight >= 100 && result.settingsTop >= 4 && result.headerTabsTop >= 56, `${width}px 顶栏首行缺少控件呼吸空间`, result);
        assert(result.errorText.includes('数据暂不可用') && result.retryCount === 1, `${width}px 手机错误态不完整`, result);
        assert(result.chartTouchAction === 'pan-y', `${width}px 主图会阻断纵向页面滚动`, result);
        assert(result.indexRail.minCardWidth >= 158 && result.indexRail.badOverlaps.length === 0 && result.indexRail.outOfCard.length === 0, `${width}px 指数轨道内部字段发生重叠或越界`, result.indexRail);
        assert(result.indexRail.scrollPaddingInline === '12px', `${width}px 横向卡片轨道首尾安全区未保留`, result.indexRail);
        assert(result.mobileActionLayout.valid && result.mobileActionLayout.lineHeight >= result.mobileActionLayout.nameHeight && result.mobileActionLayout.lineHeight >= result.mobileActionLayout.capHeight, `${width}px 长动作文案挤压右侧仓位或超出动作行`, result.mobileActionLayout);

        await page.evaluate(() => {
            state.watchlist = [];
            state.tab = 'stock';
            state.mode = 'stock';
            syncPrimaryNavigationState('stock');
            document.getElementById('indexNavList').style.display = 'none';
            document.getElementById('stockNavList').style.display = 'flex';
            renderWatchlist();
            showEmptyWatchlistView();
        });
        const empty = await page.evaluate(() => {
            const search = document.getElementById('stockSearchInput');
            return {
                visibleActions: Array.from(document.querySelectorAll('.workspace-empty-action')).filter(el => getComputedStyle(el).display !== 'none').length,
                rightDisplay: getComputedStyle(document.querySelector('.info-section')).display,
                searchHeight: search.getBoundingClientRect().height,
                searchFontSize: parseFloat(getComputedStyle(search).fontSize)
            };
        });
        assert(empty.visibleActions === 1 && empty.rightDisplay === 'none', `${width}px 手机自选空态所有权重复`, empty);
        assert(empty.searchHeight >= 44 && empty.searchFontSize >= 16, `${width}px 手机搜索触控或字号不合格`, empty);

        await page.evaluate(() => {
            state.tab = 'index';
            state.mode = 'index';
            setWatchlistEmptyState(false);
            toggleSettings();
        });
        const settings = await page.evaluate(() => ({
            strategyCount: document.querySelectorAll('.settings-strategy-option').length,
            gridColumns: getComputedStyle(document.querySelector('.settings-strategy-grid')).gridTemplateColumns.split(' ').length,
            researchEntry: getComputedStyle(document.querySelector('.strategy-page-launch')).display,
            closeHeight: parseFloat(getComputedStyle(document.querySelector('#settingsPanel .sg-close')).height),
            overlay: (() => {
                const r = document.querySelector('#settingsOverlay').getBoundingClientRect();
                return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
            })(),
            panel: (() => {
                const r = document.querySelector('#settingsPanel').getBoundingClientRect();
                return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
            })()
        }));
        assert(settings.strategyCount === 4 && settings.gridColumns === 1, `${width}px 手机策略切换面板不完整`, settings);
        assert(settings.researchEntry === 'none' && settings.closeHeight >= 44, `${width}px 手机设置仍暴露电脑研究入口或触控过小`, settings);
        assert(settings.panel.left >= 12 && settings.panel.right <= settings.overlay.right - 12
            && Math.abs((settings.panel.left + settings.panel.right) / 2 - settings.overlay.width / 2) <= 1
            && settings.panel.top > 0 && settings.panel.bottom < settings.overlay.bottom,
        `${width}px 手机设置面板没有居中或缺少外边距`, settings);

        if (width === 390) {
            await page.locator('.settings-strategy-option').filter({ hasText: '波段抄底型' }).click();
            await page.waitForSelector('#customModal.show');
            await page.locator('#customModalBtnOk').click();
            await page.waitForFunction(() => localStorage.getItem('quant_strategy') === '波段抄底型');
            const switched = await page.evaluate(() => ({
                stateStrategy: state.strategy,
                storedStrategy: localStorage.getItem('quant_strategy'),
                pressed: document.querySelector('.settings-strategy-option[aria-pressed="true"]')?.innerText || ''
            }));
            assert(switched.stateStrategy === '波段抄底型' && switched.storedStrategy === '波段抄底型' && switched.pressed.includes('波段抄底型'), '390px 手机策略切换未在本机持久化', switched);

            const navReturn = await page.evaluate(async () => {
                if (document.getElementById('settingsOverlay').classList.contains('show')) toggleSettings();
                state.watchlist = Array.from({ length: 8 }, (_, index) => normalizeSecurityTarget({
                    Code: String(600001 + index),
                    Name: `测试自选${index + 1}`,
                    QuoteID: `1.${600001 + index}`,
                    type: 'stock'
                }));
                const active = state.watchlist[state.watchlist.length - 1];
                applyActiveSelectionState({ tab: 'stock', mode: 'stock', id: active.secid, stockId: active.code });
                syncPrimaryNavigationState('stock');
                document.getElementById('indexNavList').style.display = 'none';
                document.getElementById('stockNavList').style.display = 'flex';
                renderWatchlist();
                await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

                const track = document.querySelector('#stockNavList .watchlist-items');
                const item = () => document.querySelector('#stockNavList .nav-list-item.active');
                const isVisible = () => {
                    const trackRect = track.getBoundingClientRect();
                    const itemRect = item().getBoundingClientRect();
                    return itemRect.left >= trackRect.left && itemRect.right <= trackRect.right;
                };
                const initialVisible = isVisible();
                const removeTargetHeight = parseFloat(getComputedStyle(item().querySelector('.wl-close')).height);

                const originalSelectIndex = selectIndex;
                const originalSelectStock = selectStock;
                selectIndex = () => {};
                selectStock = () => {};
                track.scrollLeft = 0;
                openMarketWorkspace('index');
                openMarketWorkspace('stock');
                await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
                const returnVisible = isVisible();
                const returnScrollLeft = track.scrollLeft;

                track.scrollLeft = 80;
                const beforeRefreshScrollLeft = track.scrollLeft;
                renderWatchlist();
                await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
                const refreshScrollLeft = track.scrollLeft;
                selectIndex = originalSelectIndex;
                selectStock = originalSelectStock;
                return { initialVisible, returnVisible, returnScrollLeft, beforeRefreshScrollLeft, refreshScrollLeft, removeTargetHeight };
            });
            assert(navReturn.initialVisible && navReturn.returnVisible && navReturn.returnScrollLeft > 0, '390px 返回同一自选标的后没有重新滚入可见轨道', navReturn);
            assert(Math.abs(navReturn.refreshScrollLeft - navReturn.beforeRefreshScrollLeft) <= 16, '390px 连续列表刷新不应抢占用户的横向滚动位置', navReturn);
            assert(navReturn.removeTargetHeight >= 44, '390px 自选股删除入口触控区过小', navReturn);
        }
    } finally {
        await context.close();
    }
}

async function checkMobileChartLifecycle(browser) {
    const { context, page } = await preparePage(browser, { width: 390, height: 844 }, { hasTouch: true, reducedMotion: 'reduce' });
    try {
        await page.goto(`${baseUrl}/index.html?ui-governance=mobile-chart`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => typeof draw === 'function' && typeof setRawData === 'function');
        const compactDefaults = await page.evaluate(() => {
            applyPeriodState('weekly');
            state.range = 360;
            state.activeMAs = [10];
            const applied = applyCompactMobileDefaults();
            return { applied, period: state.period, range: state.range, activeMAs: state.activeMAs.slice() };
        });
        assert(compactDefaults.applied && compactDefaults.period === 'daily' && compactDefaults.range === 90 && compactDefaults.activeMAs.join(',') === '5,20,60', '手机默认值无法覆盖冲突的周线/长窗口状态', compactDefaults);
        await page.evaluate(() => {
            globalSelectionSeq += 1;
            hideLoading();
            const start = Date.UTC(2025, 0, 1);
            const bars = Array.from({ length: 140 }, (_, index) => {
                const close = 3000 + index * 2 + Math.sin(index / 4) * 18;
                const open = close + Math.cos(index / 3) * 5;
                return {
                    date: new Date(start + index * 86400000).toISOString().slice(0, 10),
                    open,
                    high: Math.max(open, close) + 10,
                    low: Math.min(open, close) - 10,
                    close,
                    vol: 1000000 + index * 1000,
                    amt: 3000000000 + index * 1000000
                };
            });
            applyActiveSelectionState({ tab: 'index', mode: 'index', id: 'sh', stockId: null });
            setRawData('sh', bars);
            resetIndicatorState();
            resetViewportToLatest(bars);
            setLockIdx(bars.length - 1);
            draw();
            safeUpdateSidebar();
        });
        await page.waitForFunction(() => !!Chart.getChart('mainChart'));
        const beforeEnd = await page.evaluate(() => state.viewport.endIdx);
        const mainBox = page.locator('.main-chart-box');
        await mainBox.scrollIntoViewIfNeeded();
        const box = await mainBox.boundingBox();
        assert(box && box.width > 100 && box.height > 100, '手机主图没有可触控的几何区域', box);
        const session = await context.newCDPSession(page);
        const startX = box.x + box.width * 0.78;
        const endX = box.x + box.width * 0.42;
        const y = box.y + box.height * 0.5;
        await session.send('Input.dispatchTouchEvent', {
            type: 'touchStart',
            touchPoints: [{ x: startX, y, id: 1, radiusX: 2, radiusY: 2, force: 1 }]
        });
        for (let step = 1; step <= 4; step++) {
            const x = startX + (endX - startX) * step / 4;
            await session.send('Input.dispatchTouchEvent', {
                type: 'touchMove',
                touchPoints: [{ x, y, id: 1, radiusX: 2, radiusY: 2, force: 1 }]
            });
            await page.waitForTimeout(24);
        }
        await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await page.waitForFunction(previousEnd => state.viewport.mode === 'pan' && state.viewport.endIdx < previousEnd, beforeEnd);
        const panned = await page.evaluate(() => ({
            mode: state.viewport.mode,
            endIdx: state.viewport.endIdx,
            date: getRenderedSidebarDate(),
            expectedDate: getActiveData()[state.viewport.endIdx]?.date || '',
            frozen: state.isFrozen
        }));
        await page.locator('#btnResetLatest').click();
        await page.waitForFunction(previousEnd => state.viewport.mode === 'latest' && state.viewport.endIdx === previousEnd, beforeEnd);
        const verticalProbe = await page.evaluate(() => {
            const maxScroll = Math.max(0, document.documentElement.scrollHeight - innerHeight);
            return { before: scrollY, maxScroll };
        });
        const verticalBox = await mainBox.boundingBox();
        assert(verticalBox, '手机主图纵向滚动探针无法取得几何信息');
        const canScrollUp = verticalProbe.before > 80;
        const verticalStartY = verticalBox.y + verticalBox.height * 0.5;
        const verticalEndY = verticalStartY + (canScrollUp ? 140 : -140);
        const verticalX = verticalBox.x + verticalBox.width * 0.5;
        await session.send('Input.dispatchTouchEvent', {
            type: 'touchStart',
            touchPoints: [{ x: verticalX, y: verticalStartY, id: 2, radiusX: 2, radiusY: 2, force: 1 }]
        });
        for (let step = 1; step <= 4; step++) {
            const touchY = verticalStartY + (verticalEndY - verticalStartY) * step / 4;
            await session.send('Input.dispatchTouchEvent', {
                type: 'touchMove',
                touchPoints: [{ x: verticalX, y: touchY, id: 2, radiusX: 2, radiusY: 2, force: 1 }]
            });
            await page.waitForTimeout(24);
        }
        await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await page.waitForTimeout(180);
        const afterVerticalScroll = await page.evaluate(() => scrollY);
        const result = await page.evaluate(({ beforeEnd, panned }) => {
            const data = getActiveData();
            return {
                period: state.period,
                range: state.range,
                activeMAs: state.activeMAs.slice(),
                charts: ['mainChart', 'volumeChart', 'macdChart', 'kdjChart'].map(id => !!Chart.getChart(id)),
                beforeEnd,
                panned,
                latestEnd: state.viewport.endIdx,
                latestDate: getRenderedSidebarDate(),
                expectedLatestDate: data[data.length - 1].date
            };
        }, { beforeEnd, panned });
        assert(result.period === 'daily' && result.range === 90 && result.activeMAs.join(',') === '5,20,60', '手机主图默认范围或均线不符合契约', result);
        assert(result.charts[0] && result.charts.slice(1).every(value => !value), '手机渲染仍创建了副图 Chart 实例', result);
        assert(result.panned.mode === 'pan' && result.panned.endIdx < result.beforeEnd && result.panned.frozen, '手机横向触摸没有进入历史视窗', result);
        assert(result.panned.date === result.panned.expectedDate, '手机历史浏览没有同步价格日期', result);
        assert(result.latestEnd === result.beforeEnd && result.latestDate === result.expectedLatestDate, '手机主图无法恢复最新交易日', result);
        assert(canScrollUp ? afterVerticalScroll < verticalProbe.before - 20 : afterVerticalScroll > verticalProbe.before + 20, '手机主图阻断了纵向页面滚动', { verticalProbe, afterVerticalScroll, canScrollUp });
    } finally {
        await context.close();
    }
}

async function checkResponsiveBreakpointLifecycle(browser) {
    const { context, page } = await preparePage(browser, { width: 390, height: 844 }, { hasTouch: true, reducedMotion: 'reduce' });
    await context.addInitScript(() => {
        window.name = String((Number(window.name) || 0) + 1);
    });
    try {
        await page.goto(`${baseUrl}/index.html?ui-governance=responsive-lifecycle`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => typeof bindResponsiveLayoutReload === 'function' && Number(window.name) === 1);

        await page.setViewportSize({ width: 430, height: 932 });
        await page.waitForTimeout(250);
        const sameBreakpoint = await page.evaluate(() => ({
            loads: Number(window.name),
            compact: isCompactMobileLayout(),
            width: innerWidth
        }));
        assert(sameBreakpoint.loads === 1 && sameBreakpoint.compact && sameBreakpoint.width === 430, '同一手机断点内的旋转/宽度变化不应重载应用', sameBreakpoint);

        await page.setViewportSize({ width: 1024, height: 900 });
        await page.waitForFunction(() => Number(window.name) === 2 && innerWidth === 1024 && typeof isCompactMobileLayout === 'function' && !isCompactMobileLayout(), null, { timeout: 10000 });
        const crossed = await page.evaluate(() => ({
            loads: Number(window.name),
            compact: isCompactMobileLayout(),
            width: innerWidth,
            main: getComputedStyle(document.getElementById('marketWorkspace')).display,
            header: getComputedStyle(document.querySelector('.header')).display
        }));
        assert(crossed.loads === 2 && !crossed.compact && crossed.main === 'flex' && crossed.header === 'grid', '1023/1024px 跨断点没有从干净生命周期恢复桌面终端', crossed);

        await page.setViewportSize({ width: 1180, height: 900 });
        await page.waitForTimeout(250);
        const desktopResize = await page.evaluate(() => ({ loads: Number(window.name), compact: isCompactMobileLayout(), width: innerWidth }));
        assert(desktopResize.loads === 2 && !desktopResize.compact && desktopResize.width === 1180, '同一桌面断点内调整宽度不应重载应用', desktopResize);
    } finally {
        await context.close();
    }
}

async function checkMainDesktop(browser, width) {
    const { context, page } = await preparePage(browser, { width, height: 900 }, { reducedMotion: 'reduce' });
    try {
        await page.goto(`${baseUrl}/index.html?ui-governance=${width}`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => typeof renderActiveSelectionStatus === 'function' && typeof setWatchlistEmptyState === 'function');
        await page.evaluate(() => {
            hideLoading();
            clearCharts('error');
            renderActiveSelectionStatus('unavailable');
        });
        const result = await page.evaluate(() => {
            const toolbar = document.querySelector('.chart-toolbar');
            const actionBlue = getComputedStyle(document.documentElement).getPropertyValue('--blue-action').trim();
            const textBlue = getComputedStyle(document.documentElement).getPropertyValue('--blue-text').trim();
            const motionProbe = document.createElement('div');
            motionProbe.className = 'price-pulse';
            document.body.appendChild(motionProbe);
            const animationDuration = getComputedStyle(motionProbe).animationDuration;
            motionProbe.remove();
            return {
                width: innerWidth,
                gate: document.getElementById('mobileGate') ? getComputedStyle(document.getElementById('mobileGate')).display : 'absent',
                bodyOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
                toolbarOverflow: toolbar.scrollWidth - toolbar.clientWidth,
                errorText: document.getElementById('cardAnalysis')?.innerText || '',
                retryCount: document.querySelectorAll('#cardAnalysis .state-retry-action').length,
                actionBlue,
                textBlue,
                colorScheme: getComputedStyle(document.body).colorScheme,
                animationDuration,
                navCurrent: document.querySelector('#mainTabs .nav-btn[aria-current="page"]')?.dataset.tab,
                pressedPeriod: document.querySelectorAll('#periodTabs .seg-btn[aria-pressed="true"]').length,
                pressedRange: document.querySelectorAll('#rangeTabs .seg-btn[aria-pressed="true"]').length
            };
        });
        assert(result.gate === 'absent', `${width}px 首页不应保留电脑端门槛`, result);
        assert(result.bodyOverflow <= 0 && result.toolbarOverflow <= 0, `${width}px 出现横向溢出`, result);
        assert(result.errorText.includes('数据暂不可用') && result.retryCount === 1, '主行情失败态不完整', result);
        assert(result.actionBlue === '#3765ed' && result.textBlue === '#5f83ff', '蓝色 Token 不符合治理契约', result);
        assert(contrast('#ffffff', result.actionBlue) >= 4.5 && contrast(result.textBlue, '#1c2130') >= 4.5, '蓝色对比度未达正文基线', result);
        assert(result.colorScheme === 'dark', '应用未锁定深色原生控件主题', result);
        assert(result.animationDuration === '0s' || parseFloat(result.animationDuration) <= 0.001, '减少动态偏好下仍保留价格脉冲', result);
        assert(result.navCurrent === 'index' && result.pressedPeriod === 1 && result.pressedRange === 1, '导航或互斥按钮语义未同步', result);

        await page.evaluate(() => {
            state.watchlist = [];
            state.tab = 'stock';
            state.mode = 'stock';
            renderWatchlist();
            showEmptyWatchlistView();
        });
        const empty = await page.evaluate(() => ({
            visibleActions: Array.from(document.querySelectorAll('.workspace-empty-action')).filter(el => getComputedStyle(el).display !== 'none').length,
            rightDisplay: getComputedStyle(document.querySelector('.info-section')).display,
            duplicateCopy: document.body.innerText.includes('等待选择股票') || document.body.innerText.includes('还没有自选股')
        }));
        assert(empty.visibleActions === 1 && empty.rightDisplay === 'none' && !empty.duplicateCopy, '自选股空态所有权仍有重复', empty);

        await page.evaluate(() => {
            state.tab = 'external';
            state.mode = 'external';
            sectorTrendState.status = 'error';
            sectorTrendState.error = '测试：接口不可用';
            sectorTrendState.boards = [];
            sectorTrendState.concepts = [];
            sectorTrendState.groups = { uptrend: [], turning: [], momentum: [] };
            sectorTrendState.summary = {};
            setPrimaryWorkspace('external');
            renderSectorTrendSnapshot();
        });
        const sectorError = await page.evaluate(() => ({
            state: document.getElementById('externalWorkspace').dataset.uiState,
            overview: document.getElementById('sectorTrendOverview').innerText,
            dataSectionDisplay: getComputedStyle(document.querySelector('.external-data-section')).display,
            statusLabel: document.getElementById('sectorTrendStatus').getAttribute('aria-label')
        }));
        assert(sectorError.state === 'error' && sectorError.overview.includes('暂不可用') && !sectorError.overview.includes('0个'), '板块错误态仍伪装成零值', sectorError);
        assert(sectorError.dataSectionDisplay === 'none' && sectorError.statusLabel.includes('测试：接口不可用'), '板块错误详情或分组抑制不完整', sectorError);

        const sectorAvailableStates = await page.evaluate(() => {
            sectorTrendState.status = 'cached';
            sectorTrendState.error = '测试：显示最近快照';
            sectorTrendState.boards = [{ code: 'BK0001', name: '测试行业' }];
            sectorTrendState.concepts = [];
            sectorTrendState.groups = { uptrend: [], turning: [], momentum: [] };
            sectorTrendState.summary = { uptrendCount: 0, turningCount: 0, momentumCount: 0, strongest: '测试行业', totalCount: 1, conceptCount: 0 };
            renderSectorTrendSnapshot();
            const cached = {
                state: document.getElementById('externalWorkspace').dataset.uiState,
                dataSectionDisplay: getComputedStyle(document.querySelector('.external-data-section')).display,
                status: document.getElementById('sectorTrendStatus').innerText
            };
            sectorTrendState.status = 'ready';
            sectorTrendState.error = '';
            sectorTrendState.boards = [];
            sectorTrendState.concepts = [];
            sectorTrendState.groups = { uptrend: [], turning: [], momentum: [] };
            sectorTrendState.summary = { uptrendCount: 0, turningCount: 0, momentumCount: 0, strongest: '--', totalCount: 0, conceptCount: 0 };
            renderSectorTrendSnapshot();
            const empty = {
                state: document.getElementById('externalWorkspace').dataset.uiState,
                cards: document.querySelectorAll('#sectorTrendOverview .sector-summary-card').length,
                overview: document.getElementById('sectorTrendOverview').innerText
            };
            return { cached, empty };
        });
        assert(sectorAvailableStates.cached.state === 'cached' && sectorAvailableStates.cached.dataSectionDisplay !== 'none' && sectorAvailableStates.cached.status.includes('缓存结果'), '缓存板块快照未保留可用内容', sectorAvailableStates.cached);
        assert(sectorAvailableStates.empty.state === 'ready' && sectorAvailableStates.empty.cards === 4 && sectorAvailableStates.empty.overview.includes('0'), '真实空结果没有显示合法零值', sectorAvailableStates.empty);

        await page.evaluate(() => {
            setPrimaryWorkspace('index');
            state.tab = 'index';
            state.mode = 'index';
            toggleSettings();
        });
        const settings = await page.evaluate(() => ({
            text: document.getElementById('settingsPanel').textContent,
            strategyCount: document.querySelectorAll('.settings-strategy-option').length,
            pressedCount: document.querySelectorAll('.settings-strategy-option[aria-pressed="true"]').length
        }));
        assert(settings.text.includes('策略设置') && settings.strategyCount === 4 && settings.pressedCount === 1, '策略设置结构不完整', settings);
        assert(!settings.text.includes('信号积分配置'), '设置弹窗仍复制完整信号积分配置', settings);

        const names = await page.evaluate(() => [
            normalizeStockDisplayName('600001', 'XD测试股份'),
            normalizeStockDisplayName('600002', 'XR测试股份'),
            normalizeStockDisplayName('600003', 'DR测试股份')
        ]);
        assert(names.every(name => name === '测试股份'), '除权除息名称未统一', names);
    } finally {
        await context.close();
    }
}

async function checkColdFailureLifecycle(browser) {
    const { context, page } = await preparePage(browser, { width: 1440, height: 900 });
    try {
        await page.goto(`${baseUrl}/index.html?ui-governance=cold-failure`, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#cardAnalysis .analysis-error-panel .state-retry-action', { timeout: 15000 });
        const result = await page.evaluate(() => ({
            loadingVisible: document.getElementById('loading').classList.contains('show'),
            priceText: document.getElementById('cardPrice').innerText,
            analysisText: document.getElementById('cardAnalysis').innerText,
            chartHints: Array.from(document.querySelectorAll('.empty-hint')).map(el => el.innerText)
        }));
        assert(!result.loadingVisible, '冷启动失败后阻塞加载层没有退出', result);
        assert(result.priceText.includes('数据暂不可用') && result.analysisText.includes('重新加载当前数据'), '冷启动失败没有落到完整右侧错误态', result);
        assert(result.chartHints.length === 4 && result.chartHints.every(text => text.includes('加载失败')), '冷启动失败没有同步清理四张图表', result);
    } finally {
        await context.close();
    }
}

async function checkStrategyContext(browser) {
    const { context, page } = await preparePage(browser, { width: 1280, height: 900 }, { savedStrategy: '波段抄底型' });
    try {
        await page.goto(`${baseUrl}/strategy-inspector.html?ui-governance=strategy`, { waitUntil: 'domcontentloaded' });
        const initial = await page.evaluate(() => ({
            current: document.getElementById('strategyCurrent').innerText,
            active: document.querySelector('.strategy-tab[aria-pressed="true"]')?.dataset.strategy,
            overview: document.getElementById('strategyOverview').innerText,
            filesVisible: document.body.innerText.includes('文件职责')
        }));
        assert(initial.current.includes('波段抄底型') && initial.active === '波段抄底型', '策略查看器未读取应用当前策略', initial);
        assert(initial.overview.includes('正在查看') && initial.overview.includes('应用当前策略') && !initial.filesVisible, '策略查看器上下文或内容边界错误', initial);
        await page.locator('.strategy-tab').filter({ hasNotText: '波段抄底型' }).first().click();
        const browsed = await page.evaluate(() => ({
            stored: localStorage.getItem('quant_strategy'),
            current: document.getElementById('strategyCurrent').innerText,
            overview: document.getElementById('strategyOverview').innerText
        }));
        assert(browsed.stored === '波段抄底型' && browsed.current.includes('波段抄底型'), '只读浏览改写了应用策略', browsed);
        assert(browsed.overview.includes('只读浏览，不影响应用'), '非当前策略缺少只读提示', browsed);
    } finally {
        await context.close();
    }
}

async function main() {
    const { chromium } = resolvePlaywright();
    const server = startServer();
    const executablePath = resolveBrowserExecutable();
    const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    try {
        for (const width of [375, 390, 430, 768, 1023]) {
            await checkMainMobile(browser, width, width >= 768 ? 900 : 844);
            await checkStrategyGate(browser, width);
        }
        await checkMobileChartLifecycle(browser);
        await checkResponsiveBreakpointLifecycle(browser);
        await checkMainDesktop(browser, 1024);
        await checkMainDesktop(browser, 1440);
        await checkColdFailureLifecycle(browser);
        await checkStrategyContext(browser);
        console.log(JSON.stringify({ ok: true, checked: ['375/390/430/768/1023 compact main app', 'mobile main-only chart lifecycle', '1023/1024 responsive reload lifecycle', 'mobile strategy-inspector gates', '1024/1440 desktop geometry', 'cold failure lifecycle', 'main and sector errors', 'watchlist empty', 'strategy contexts', 'tokens, motion and semantics'] }, null, 2));
    } finally {
        await browser.close();
        if (server) server.kill('SIGTERM');
    }
}

main().catch(error => {
    console.error(error.stack || error.message);
    process.exit(1);
});
