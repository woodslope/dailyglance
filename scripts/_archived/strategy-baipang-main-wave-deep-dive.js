#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const {
    ROOT,
    REPORT_DIR,
    STRATEGY_NAME,
    PHASES,
    movingAverage,
    createStrategyContext,
    runProductionChain,
    loadCachedData
} = require('./strategy-baipang-b25-filter-deep-dive.js');

const VARIANTS = {
    baseline: { name: '当前基线', minProfit: Infinity, targetPosition: 0, description: '不叠加主升仓位。' },
    profit5_target50: { name: '浮盈 5% 升至 50%', minProfit: 0.05, targetPosition: 50, description: '每个白胖持仓周期最多一次：浮盈至少 5%，趋势与市场继续确认时升至 50%。' },
    profit5_target60: { name: '浮盈 5% 升至 60%', minProfit: 0.05, targetPosition: 60, description: '每个白胖持仓周期最多一次：浮盈至少 5%，趋势与市场继续确认时升至 60%。' },
    profit8_target50: { name: '浮盈 8% 升至 50%', minProfit: 0.08, targetPosition: 50, description: '每个白胖持仓周期最多一次：浮盈至少 8%，趋势与市场继续确认时升至 50%。' },
    profit8_breakout50: { name: '浮盈 8% 创新高升至 50%', minProfit: 0.08, targetPosition: 50, requireBreakout: true, description: '浮盈至少 8% 后收盘创近 20 日新高，确认主升再升至 50%。' },
    profit8_breakout50_ma20_guard: { name: '浮盈 8% 创新高升至 50%（MA20保护）', minProfit: 0.08, targetPosition: 50, requireBreakout: true, ma20Guard: true, description: '创新高确认后升至 50%；若跌回 MA20，仅撤回额外仓位，保留原白胖仓位。' }
};

function round(value, digits = 4) {
    return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function pct(numerator, denominator) {
    return denominator ? round(numerator / denominator, 4) : 0;
}

function mean(values) {
    const list = values.filter(Number.isFinite);
    return list.length ? list.reduce((sum, value) => sum + value, 0) / list.length : NaN;
}

function formatPct(value) {
    return Number.isFinite(value) ? `${(value * 100).toFixed(2)}%` : '--';
}

function formatSignedPct(value) {
    if (!Number.isFinite(value)) return '--';
    return `${value > 0 ? '+' : ''}${(value * 100).toFixed(2)}%`;
}

function summarize(rows, positions) {
    let capital = 10000;
    let peak = capital;
    let maxDrawdown = 0;
    let previousPosition = positions[59] || 0;
    let entryCapital = 0;
    let wins = 0;
    let trades = 0;
    let adjustments = 0;
    for (let index = 60; index < rows.length; index++) {
        if (previousPosition > 0 && rows[index - 1]?.close) {
            capital *= 1 + ((rows[index].close - rows[index - 1].close) / rows[index - 1].close) * (previousPosition / 100);
        }
        peak = Math.max(peak, capital);
        maxDrawdown = Math.max(maxDrawdown, (peak - capital) / peak);
        if ((positions[index] || 0) !== previousPosition) {
            capital -= capital * Math.abs((positions[index] || 0) - previousPosition) / 100 * 0.001;
            adjustments++;
            if (previousPosition === 0 && positions[index] > 0) entryCapital = capital;
            if (previousPosition > 0 && positions[index] === 0) {
                trades++;
                if (entryCapital && capital > entryCapital) wins++;
                entryCapital = 0;
            }
        }
        previousPosition = positions[index] || 0;
    }
    const eligibleDays = Math.max(0, rows.length - 60);
    const holdingDays = positions.slice(60).filter(position => position > 0).length;
    return {
        ret: round((capital - 10000) / 10000),
        maxDrawdown: round(maxDrawdown),
        winRate: trades ? round(wins / trades) : 0,
        trades,
        adjustments,
        b: positions.filter((position, index) => index > 0 && position > 0 && (positions[index - 1] || 0) === 0).length,
        s: positions.filter((position, index) => index > 0 && position === 0 && (positions[index - 1] || 0) > 0).length,
        eligibleDays,
        holdingDays,
        holdingRatio: pct(holdingDays, eligibleDays)
    };
}

function isFavorableMarket(label) {
    return label === '全面多头' || label === '温和偏多';
}

function hasWhiteStrongExit(row) {
    return row.exitLevel === '强离场' || row.signals.includes('L13') || row.signals.includes('L14');
}

function priorHigh(rows, index, lookback = 20) {
    let high = -Infinity;
    for (let cursor = Math.max(0, index - lookback); cursor < index; cursor++) high = Math.max(high, rows[cursor]?.high || -Infinity);
    return Number.isFinite(high) ? high : null;
}

function applyMainWaveLayer(stockRows, productionRows, variant) {
    const ma20 = movingAverage(stockRows, 20);
    const ma60 = movingAverage(stockRows, 60);
    const positions = productionRows.map(row => row.position || 0);
    const upgrades = [];
    let entryClose = 0;
    let upgradedThisCycle = false;
    let extraPositionActive = false;

    for (let index = 60; index < productionRows.length; index++) {
        const row = productionRows[index];
        const baselinePosition = row.position || 0;
        const previousBaselinePosition = productionRows[index - 1]?.position || 0;
        if (previousBaselinePosition === 0 && baselinePosition > 0) {
            entryClose = row.close;
            upgradedThisCycle = false;
            extraPositionActive = false;
        }
        if (baselinePosition === 0) {
            entryClose = 0;
            upgradedThisCycle = false;
            extraPositionActive = false;
            continue;
        }

        if (extraPositionActive && variant.ma20Guard && row.close < ma20[index]) {
            positions[index] = baselinePosition;
            extraPositionActive = false;
        } else if (extraPositionActive) {
            positions[index] = variant.targetPosition;
        }

        if (variant.targetPosition <= 0 || upgradedThisCycle || previousBaselinePosition === 0 || baselinePosition >= variant.targetPosition || !entryClose) continue;

        const profit = (row.close - entryClose) / entryClose;
        const trendImproving = Number.isFinite(ma20[index]) && Number.isFinite(ma60[index]) &&
            row.close > ma20[index] && ma20[index] > ma60[index] && ma20[index] >= ma20[Math.max(0, index - 5)];
        const breakoutConfirmed = !variant.requireBreakout || (priorHigh(stockRows, index) !== null && row.close > priorHigh(stockRows, index));
        const eligible = profit >= variant.minProfit && trendImproving && breakoutConfirmed && isFavorableMarket(row.marketLabel) && !hasWhiteStrongExit(row);
        if (!eligible) continue;

        positions[index] = variant.targetPosition;
        upgradedThisCycle = true;
        extraPositionActive = true;
        upgrades.push({ index, date: row.date, profit: round(profit), from: baselinePosition, to: variant.targetPosition });
    }
    return { positions, upgrades };
}

function summarizeVariant(rows) {
    const summaries = rows.map(row => row.summary);
    const eligibleDays = summaries.reduce((sum, item) => sum + item.eligibleDays, 0);
    const holdingDays = summaries.reduce((sum, item) => sum + item.holdingDays, 0);
    return {
        upgrades: rows.reduce((sum, item) => sum + item.upgrades, 0),
        upgradedStocks: rows.filter(row => row.upgrades > 0).length,
        performance: {
            avgStrategyRet: round(mean(summaries.map(item => item.ret))),
            avgMaxDrawdown: round(mean(summaries.map(item => item.maxDrawdown))),
            avgWinRate: round(mean(summaries.map(item => item.winRate))),
            avgTrades: round(mean(summaries.map(item => item.trades))),
            avgAdjustments: round(mean(summaries.map(item => item.adjustments)))
        },
        bs: {
            b: summaries.reduce((sum, item) => sum + item.b, 0),
            s: summaries.reduce((sum, item) => sum + item.s, 0)
        },
        holding: { eligibleDays, holdingDays, holdingRatio: pct(holdingDays, eligibleDays) }
    };
}

function compareToBaseline(variant, baseline, rows) {
    const improvedBoth = rows.filter(row => row.summary.ret > row.baseline.ret && row.summary.maxDrawdown <= row.baseline.maxDrawdown).length;
    const comparison = {
        deltaAvgStrategyRet: round(variant.performance.avgStrategyRet - baseline.performance.avgStrategyRet),
        deltaAvgMaxDrawdown: round(variant.performance.avgMaxDrawdown - baseline.performance.avgMaxDrawdown),
        deltaAvgWinRate: round(variant.performance.avgWinRate - baseline.performance.avgWinRate),
        deltaAvgTrades: round(variant.performance.avgTrades - baseline.performance.avgTrades),
        deltaAvgAdjustments: round(variant.performance.avgAdjustments - baseline.performance.avgAdjustments),
        deltaHoldingRatio: round(variant.holding.holdingRatio - baseline.holding.holdingRatio),
        stocksImprovedBoth: improvedBoth
    };
    const supported = variant.upgrades > 0 && comparison.deltaAvgStrategyRet > 0 && comparison.deltaAvgMaxDrawdown <= 0 && improvedBoth > rows.length / 2;
    return { ...comparison, assessment: supported ? '值得进入生产设计与回归阶段' : '当前样本不支持接入生产' };
}

function makeMarkdown(report) {
    const lines = [];
    lines.push('# 白胖主升仓位升级深挖');
    lines.push('');
    lines.push(`生成时间：${report.generatedAt}`);
    lines.push(`研究运行时基线：APP_BUILD=${report.appBuild}，SIGNAL_VERSION=${report.signalVersion}`);
    lines.push('');
    lines.push('## 范围与方法');
    lines.push('');
    lines.push(`- 样本：${report.scope.stocks} 只股票，阶段 ${report.scope.phases.join('、')}，日期 ${report.scope.dateRange.first} 至 ${report.scope.dateRange.last}。`);
    lines.push('- 基线先完整运行本地白胖候选链路；主升层只给已有持仓叠加仓位，空仓、L13/L14 强离场与候选归零均保持原样，第一次 B/S 不改变。');
    lines.push('- 升级条件：已有浮盈达到阈值、价格在 MA20 上方、MA20 高于且不低于 MA60、市场为全面多头或温和偏多、当日无 L13/L14。');
    lines.push('');
    lines.push('## 聚合结果');
    lines.push('');
    lines.push('| 方案 | 升级次数 | 覆盖股票 | 平均收益 | 平均最大回撤 | 相对基线收益 | 相对基线回撤 | 同时改善股票 | 结论 |');
    lines.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |');
    for (const [id, variant] of Object.entries(report.variants)) {
        const comparison = report.comparison[id];
        lines.push(`| ${VARIANTS[id].name} | ${variant.upgrades} | ${variant.upgradedStocks}/${report.scope.stocks} | ${formatSignedPct(variant.performance.avgStrategyRet)} | ${formatPct(variant.performance.avgMaxDrawdown)} | ${formatSignedPct(comparison.deltaAvgStrategyRet)} | ${formatSignedPct(comparison.deltaAvgMaxDrawdown)} | ${comparison.stocksImprovedBoth}/${report.scope.stocks} | ${comparison.assessment} |`);
    }
    lines.push('');
    lines.push('## 解释边界');
    lines.push('');
    lines.push('- 本报告是离线仓位层消融，不构成投资建议，不代表线上策略已升仓。');
    lines.push('- 任何方案只有在收益、回撤与多数股票稳定改善后，才允许进入生产配置、版本升级和完整回归。');
    lines.push('');
    return lines.join('\n');
}

function main() {
    const { indexData, stocks } = loadCachedData();
    const variantRows = Object.fromEntries(Object.keys(VARIANTS).map(id => [id, []]));
    let appBuild = '';
    let signalVersion = '';

    for (const stock of stocks) {
        const context = createStrategyContext(indexData);
        const baselineResult = runProductionChain(context, stock);
        const baselineReplay = runProductionChain(context, stock, baselineResult.rows.map(row => row.signals));
        if (JSON.stringify(baselineResult.rows.map(row => [row.position, row.bsMark])) !== JSON.stringify(baselineReplay.rows.map(row => [row.position, row.bsMark]))) {
            throw new Error(`baseline replay mismatch: ${stock.code}`);
        }
        appBuild = baselineResult.appBuild || appBuild;
        signalVersion = baselineResult.signalVersion || signalVersion;
        const baseline = summarize(stock.rows, baselineResult.rows.map(row => row.position || 0));

        for (const [id, variant] of Object.entries(VARIANTS)) {
            const layer = id === 'baseline'
                ? { positions: baselineResult.rows.map(row => row.position || 0), upgrades: [] }
                : applyMainWaveLayer(stock.rows, baselineResult.rows, variant);
            const summary = id === 'baseline' ? baseline : summarize(stock.rows, layer.positions);
            const baseMarks = baselineResult.rows.map(row => row.bsMark || null);
            const layeredMarks = layer.positions.map((position, index) => index && position > 0 && (layer.positions[index - 1] || 0) === 0 ? 'B' : index && position === 0 && (layer.positions[index - 1] || 0) > 0 ? 'S' : null);
            if (JSON.stringify(baseMarks) !== JSON.stringify(layeredMarks)) throw new Error(`main-wave layer changed B/S: ${stock.code}/${id}`);
            variantRows[id].push({ code: stock.code, name: stock.name, industry: stock.industry, phase: stock.phase, upgrades: layer.upgrades.length, baseline, summary });
        }
    }

    const variants = Object.fromEntries(Object.entries(variantRows).map(([id, rows]) => [id, summarizeVariant(rows)]));
    const baseline = variants.baseline;
    const comparison = Object.fromEntries(Object.entries(variants).map(([id, variant]) => [id,
        id === 'baseline'
            ? { deltaAvgStrategyRet: 0, deltaAvgMaxDrawdown: 0, deltaAvgWinRate: 0, deltaAvgTrades: 0, deltaAvgAdjustments: 0, deltaHoldingRatio: 0, stocksImprovedBoth: 0, assessment: '当前基线，不叠加主升仓位' }
            : compareToBaseline(variant, baseline, variantRows[id])
    ]));
    const dates = stocks.flatMap(stock => [stock.rows[0]?.date, stock.rows.at(-1)?.date]).filter(Boolean).sort();
    const report = {
        generatedAt: new Date().toISOString(),
        method: 'candidate-js-vm-main-wave-position-layer',
        strategy: STRATEGY_NAME,
        appBuild,
        signalVersion,
        scope: { phases: [...PHASES], stocks: stocks.length, dateRange: { first: dates[0] || '', last: dates.at(-1) || '' } },
        variants,
        comparison,
        rows: variantRows
    };
    fs.mkdirSync(REPORT_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
    const jsonPath = path.join(REPORT_DIR, `baipang-main-wave-deep-dive-${stamp}.json`);
    const markdownPath = path.join(REPORT_DIR, `baipang-main-wave-deep-dive-${stamp}.md`);
    fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
    fs.writeFileSync(markdownPath, makeMarkdown(report));
    console.log(JSON.stringify({ jsonPath: path.relative(ROOT, jsonPath), markdownPath: path.relative(ROOT, markdownPath), scope: report.scope, variants, comparison }, null, 2));
}

main();
