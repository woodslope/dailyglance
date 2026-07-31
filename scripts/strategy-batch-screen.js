#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CACHE_DIR = path.join(ROOT, '.local', 'strategy-cache');
const REPORT_DIR = path.join(ROOT, '.local', 'strategy-reports');
const UNIVERSE_PATH = path.join(ROOT, 'strategy-validation-universe.json');

const args = new Set(process.argv.slice(2));
const includePhase2 = args.has('--include-phase2');
const phases = includePhase2 ? new Set(['seed', 'phase1', 'phase2']) : new Set(['seed', 'phase1']);

function readJson(file) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function round(value, digits = 4) {
    return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function avg(values) {
    const list = values.filter(Number.isFinite);
    return list.length ? list.reduce((sum, value) => sum + value, 0) / list.length : NaN;
}

function pct(values, predicate) {
    const list = values.filter(Number.isFinite);
    return list.length ? list.filter(predicate).length / list.length : NaN;
}

function ma(data, n, accessor = item => item.close) {
    const result = Array(data.length).fill(null);
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
        sum += accessor(data[i]) || 0;
        if (i >= n) sum -= accessor(data[i - n]) || 0;
        if (i >= n - 1) result[i] = sum / n;
    }
    return result;
}

function atr(data, n = 14) {
    const tr = Array(data.length).fill(null);
    for (let i = 1; i < data.length; i++) {
        const prevClose = data[i - 1]?.close || data[i].close;
        tr[i] = Math.max(
            data[i].high - data[i].low,
            Math.abs(data[i].high - prevClose),
            Math.abs(data[i].low - prevClose)
        );
    }
    return ma(tr.map(value => ({ close: value || 0 })), n);
}

function obv(data) {
    const result = Array(data.length).fill(0);
    for (let i = 1; i < data.length; i++) {
        const prev = data[i - 1].close;
        const cur = data[i].close;
        const vol = data[i].vol || 0;
        result[i] = result[i - 1] + (cur > prev ? vol : cur < prev ? -vol : 0);
    }
    return result;
}

function dmi(data, n = 14) {
    const plusDM = Array(data.length).fill(0);
    const minusDM = Array(data.length).fill(0);
    const tr = Array(data.length).fill(0);
    for (let i = 1; i < data.length; i++) {
        const upMove = data[i].high - data[i - 1].high;
        const downMove = data[i - 1].low - data[i].low;
        plusDM[i] = upMove > downMove && upMove > 0 ? upMove : 0;
        minusDM[i] = downMove > upMove && downMove > 0 ? downMove : 0;
        const prevClose = data[i - 1].close;
        tr[i] = Math.max(
            data[i].high - data[i].low,
            Math.abs(data[i].high - prevClose),
            Math.abs(data[i].low - prevClose)
        );
    }
    const trMa = ma(tr.map(value => ({ close: value })), n);
    const plusMa = ma(plusDM.map(value => ({ close: value })), n);
    const minusMa = ma(minusDM.map(value => ({ close: value })), n);
    const plusDI = Array(data.length).fill(null);
    const minusDI = Array(data.length).fill(null);
    const dx = Array(data.length).fill(null);
    for (let i = 0; i < data.length; i++) {
        if (!trMa[i]) continue;
        plusDI[i] = 100 * (plusMa[i] || 0) / trMa[i];
        minusDI[i] = 100 * (minusMa[i] || 0) / trMa[i];
        const denom = plusDI[i] + minusDI[i];
        dx[i] = denom ? 100 * Math.abs(plusDI[i] - minusDI[i]) / denom : null;
    }
    const adx = ma(dx.map(value => ({ close: value || 0 })), n);
    return { plusDI, minusDI, adx };
}

function alignIndexReturn(indexData, date, lookback) {
    if (!indexData?.length) return null;
    let idx = -1;
    let l = 0, r = indexData.length - 1;
    while (l <= r) {
        const m = (l + r) >> 1;
        if (indexData[m].date <= date) { idx = m; l = m + 1; }
        else r = m - 1;
    }
    if (idx < lookback) return null;
    const prev = indexData[idx - lookback]?.close || 0;
    const cur = indexData[idx]?.close || 0;
    return prev && cur ? (cur - prev) / prev : null;
}

function highest(data, idx, n, accessor = item => item.high) {
    let value = -Infinity;
    for (let i = Math.max(0, idx - n + 1); i <= idx; i++) value = Math.max(value, accessor(data[i]) || -Infinity);
    return value;
}

function lowestForward(data, idx, n) {
    let value = Infinity;
    for (let i = idx + 1; i <= Math.min(data.length - 1, idx + n); i++) value = Math.min(value, data[i].low);
    return value === Infinity ? null : value;
}

function highestForward(data, idx, n) {
    let value = -Infinity;
    for (let i = idx + 1; i <= Math.min(data.length - 1, idx + n); i++) value = Math.max(value, data[i].high);
    return value === -Infinity ? null : value;
}

function buildIndicators(data) {
    const atr14 = atr(data, 14);
    return {
        ma20: ma(data, 20),
        ma60: ma(data, 60),
        atr14,
        atrPct20: ma(data.map((item, idx) => ({ close: item.close ? (atr14[idx] || 0) / item.close : 0 })), 20),
        obv: obv(data),
        dmi: dmi(data, 14)
    };
}

function candidateFlags(stock, data, ind, indexData) {
    const flags = {
        B20: Array(data.length).fill(false),
        B21: Array(data.length).fill(false),
        B22: Array(data.length).fill(false),
        L12: Array(data.length).fill(false),
        W5: Array(data.length).fill(false)
    };

    for (let i = 80; i < data.length - 20; i++) {
        const item = data[i];
        const ma20Now = ind.ma20[i];
        const ma20Prev = ind.ma20[i - 5];
        const ma60Now = ind.ma60[i];
        const ret20 = data[i - 20]?.close ? (item.close - data[i - 20].close) / data[i - 20].close : null;
        const marketRet20 = alignIndexReturn(indexData, item.date, 20);
        const atr14 = ind.atr14[i] || 0;
        const atrPct = item.close ? atr14 / item.close : 0;
        const atrPctAvg20 = ind.atrPct20[i] || 0;
        const high20 = highest(data, i, 20, row => row.close);
        const atrStop = high20 - atr14 * 2.5;
        const prevHigh20 = highest(data, i - 1, 20, row => row.close);
        const prevAtrStop = prevHigh20 - (ind.atr14[i - 1] || atr14) * 2.5;
        const obvHigh20 = highest(ind.obv.map(value => ({ high: value })), i - 1, 20);

        flags.B20[i] = ret20 != null && marketRet20 != null
            && ret20 - marketRet20 >= 0.06
            && item.close > ma20Now
            && ma20Now >= ma20Prev;

        flags.B21[i] = ind.dmi.adx[i] >= 25
            && ind.dmi.plusDI[i] > ind.dmi.minusDI[i]
            && item.close > ma20Now
            && ma20Now > ma60Now;

        flags.B22[i] = ind.obv[i] > obvHigh20
            && item.close > ma20Now
            && item.close >= data[i - 5].close * 1.02;

        flags.L12[i] = item.close < atrStop
            && data[i - 1].close >= prevAtrStop
            && item.close < ma20Now;

        flags.W5[i] = atrPct >= 0.055 || (atrPctAvg20 > 0 && atrPct >= atrPctAvg20 * 1.8);
    }
    return flags;
}

function eventMetrics(stock, data, flags, candidate) {
    const events = [];
    for (let i = 80; i < data.length - 20; i++) {
        if (!flags[i]) continue;
        const close = data[i].close;
        const f5 = data[i + 5]?.close ? (data[i + 5].close - close) / close : null;
        const f10 = data[i + 10]?.close ? (data[i + 10].close - close) / close : null;
        const f20 = data[i + 20]?.close ? (data[i + 20].close - close) / close : null;
        const low10 = lowestForward(data, i, 10);
        const high10 = highestForward(data, i, 10);
        events.push({
            code: stock.code,
            name: stock.name,
            industry: stock.industry,
            date: data[i].date,
            f5,
            f10,
            f20,
            worst10: low10 ? (low10 - close) / close : null,
            best10: high10 ? (high10 - close) / close : null
        });
    }
    const buyLike = candidate.startsWith('B');
    const riskLike = candidate.startsWith('L') || candidate.startsWith('W');
    return {
        candidate,
        type: buyLike ? 'buy-confirmation' : 'risk-control',
        triggerCount: events.length,
        symbolCount: new Set(events.map(event => event.code)).size,
        avgF5: round(avg(events.map(event => event.f5))),
        avgF10: round(avg(events.map(event => event.f10))),
        avgF20: round(avg(events.map(event => event.f20))),
        hitF10: round(pct(events.map(event => event.f10), value => value > 0)),
        hitF20: round(pct(events.map(event => event.f20), value => value > 0)),
        avgWorst10: round(avg(events.map(event => event.worst10))),
        avgBest10: round(avg(events.map(event => event.best10))),
        adverse10: round(pct(events.map(event => event.worst10), value => value <= -0.05)),
        falseAlarm10: riskLike ? round(pct(events.map(event => event.f10), value => value > 0.05)) : null,
        sampleEvents: events.slice(0, 8)
    };
}

function rank(metrics) {
    return metrics.map(item => {
        let score = 0;
        if (item.type === 'buy-confirmation') {
            score += (item.avgF20 || 0) * 100;
            score += ((item.hitF20 || 0) - 0.5) * 10;
            score += Math.max(-2, (item.avgWorst10 || 0) * 20);
        } else {
            score += Math.abs(Math.min(0, item.avgWorst10 || 0)) * 60;
            score += Math.abs(Math.min(0, item.avgF10 || 0)) * 40;
            score -= (item.falseAlarm10 || 0) * 2;
        }
        if (item.triggerCount < 30) score -= 2;
        if (item.triggerCount > 2000) score -= 1;
        return { ...item, screenScore: round(score, 4) };
    }).sort((a, b) => b.screenScore - a.screenScore);
}

function weightedAvg(rows, key) {
    let sum = 0, count = 0;
    for (const row of rows) {
        if (!Number.isFinite(row[key]) || !row.triggerCount) continue;
        sum += row[key] * row.triggerCount;
        count += row.triggerCount;
    }
    return count ? sum / count : NaN;
}

function main() {
    if (!fs.existsSync(CACHE_DIR)) throw new Error(`missing cache dir: ${CACHE_DIR}`);
    const universe = readJson(UNIVERSE_PATH);
    const cacheFiles = fs.readdirSync(CACHE_DIR);
    const indexFile = cacheFiles.find(file => file.startsWith('index_sh_') && file.endsWith('.json'));
    const indexData = indexFile ? readJson(path.join(CACHE_DIR, indexFile)) : [];
    const stocks = (universe.stocks || [])
        .filter(stock => phases.has(stock.phase))
        .map(stock => ({
            ...stock,
            cacheFile: cacheFiles.find(file => file.startsWith(`stock_${stock.code}_`) && file.endsWith('.json'))
        }))
        .filter(stock => stock.cacheFile);

    const perCandidate = {};
    for (const candidate of ['B20', 'B21', 'B22', 'L12', 'W5']) perCandidate[candidate] = [];

    for (const stock of stocks) {
        const data = readJson(path.join(CACHE_DIR, stock.cacheFile));
        if (!Array.isArray(data) || data.length < 120) continue;
        const ind = buildIndicators(data);
        const flags = candidateFlags(stock, data, ind, indexData);
        for (const candidate of Object.keys(flags)) {
            perCandidate[candidate].push(eventMetrics(stock, data, flags[candidate], candidate));
        }
    }

    const merged = Object.entries(perCandidate).map(([candidate, rows]) => {
        const type = candidate.startsWith('B') ? 'buy-confirmation' : 'risk-control';
        return {
            candidate,
            type,
            triggerCount: rows.reduce((sum, row) => sum + row.triggerCount, 0),
            symbolCount: rows.filter(row => row.triggerCount > 0).length,
            avgF5: round(weightedAvg(rows, 'avgF5')),
            avgF10: round(weightedAvg(rows, 'avgF10')),
            avgF20: round(weightedAvg(rows, 'avgF20')),
            hitF10: round(weightedAvg(rows, 'hitF10')),
            hitF20: round(weightedAvg(rows, 'hitF20')),
            avgWorst10: round(weightedAvg(rows, 'avgWorst10')),
            avgBest10: round(weightedAvg(rows, 'avgBest10')),
            adverse10: round(weightedAvg(rows, 'adverse10')),
            falseAlarm10: candidate.startsWith('B') ? null : round(weightedAvg(rows, 'falseAlarm10'))
        };
    });

    const ranked = rank(merged);
    fs.mkdirSync(REPORT_DIR, { recursive: true });
    const outPath = path.join(REPORT_DIR, `candidate-batch-screen-${Date.now()}.json`);
    const report = {
        generatedAt: new Date().toISOString(),
        scope: {
            phases: [...phases],
            stocks: stocks.length,
            candidates: ranked.map(item => item.candidate)
        },
        method: 'event-outcome-screen',
        ranked,
        perSymbol: perCandidate
    };
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({
        outPath: path.relative(ROOT, outPath),
        scope: report.scope,
        ranked: ranked.map(item => ({
            candidate: item.candidate,
            type: item.type,
            triggerCount: item.triggerCount,
            symbolCount: item.symbolCount,
            avgF10: item.avgF10,
            avgF20: item.avgF20,
            avgWorst10: item.avgWorst10,
            falseAlarm10: item.falseAlarm10,
            screenScore: item.screenScore
        }))
    }, null, 2));
}

main();
