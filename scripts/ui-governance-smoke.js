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

async function checkGate(browser, target, width) {
    const { context, page } = await preparePage(browser, { width, height: 800 });
    try {
        await page.goto(`${baseUrl}/${target}`, { waitUntil: 'domcontentloaded' });
        const result = await page.evaluate(() => ({
            gate: getComputedStyle(document.getElementById('mobileGate')).display,
            main: document.querySelector('.main-container') ? getComputedStyle(document.querySelector('.main-container')).display : null,
            inspector: document.querySelector('.strategy-inspector-shell') ? getComputedStyle(document.querySelector('.strategy-inspector-shell')).display : null,
            copy: document.getElementById('mobileGate')?.innerText || ''
        }));
        assert(result.gate === 'flex', `${target} 在 ${width}px 未显示电脑端门槛`, result);
        assert(result.main === null || result.main === 'none', `${target} 在 ${width}px 仍显示主终端`, result);
        assert(result.inspector === null || result.inspector === 'none', `${target} 在 ${width}px 仍显示策略地图`, result);
        assert(result.copy.includes('1024px'), `${target} 的门槛未说明最小宽度`, result);
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
                gate: getComputedStyle(document.getElementById('mobileGate')).display,
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
        assert(result.gate === 'none', `${width}px 不应显示电脑端门槛`, result);
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
        for (const width of [1023, 768, 375]) {
            await checkGate(browser, 'index.html', width);
            await checkGate(browser, 'strategy-inspector.html', width);
        }
        await checkMainDesktop(browser, 1024);
        await checkMainDesktop(browser, 1440);
        await checkColdFailureLifecycle(browser);
        await checkStrategyContext(browser);
        console.log(JSON.stringify({ ok: true, checked: ['1024/1440 desktop geometry', '1023/768/375 gates', 'cold failure lifecycle', 'main and sector errors', 'watchlist empty', 'strategy contexts', 'tokens, motion and semantics'] }, null, 2));
    } finally {
        await browser.close();
        if (server) server.kill('SIGTERM');
    }
}

main().catch(error => {
    console.error(error.stack || error.message);
    process.exit(1);
});
