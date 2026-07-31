#!/usr/bin/env node
// B9 guard candidate: require companion repair signals within 3 days, same as B8
const fs = require('fs'); const path = require('path'); const vm = require('vm');
const ROOT = path.resolve(__dirname, '..');
const CACHE_DIR = path.join(ROOT, '.local', 'strategy-cache');
const BASELINE_PATH = path.join(ROOT, '.local', 'strategy-reports', 'formal-strategy-baseline-20260731T163742Z.json');
const OUT = path.join(ROOT, '.local', 'strategy-reports', `wave-b9-guard-candidate-${new Date().toISOString().slice(0,16).replace(/[:-]/g,'')}Z.json`);

process.stdout.write('🔬 B9 修复佐证候选实验\n\n');

const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
const baseWave = baseline.strategies['波段抄底型'].performance;

process.stdout.write('基线: 收益=' + (baseWave.stockAvgStrategyRet*100).toFixed(2) + '% 回撤=' + (baseWave.stockAvgMaxDrawdown*100).toFixed(2) + '% 胜率=' + (baseWave.avgWinRate*100).toFixed(1) + '% B/S=' + baseline.strategies['波段抄底型'].bs.b + '/' + baseline.strategies['波段抄底型'].bs.s + '\n\n');

// Load sources
const configSrc = fs.readFileSync(path.join(ROOT, 'assets/js/01-config-ui.js'), 'utf8');
const dataSrc = fs.readFileSync(path.join(ROOT, 'assets/js/02-data.js'), 'utf8');
const calcSrc = fs.readFileSync(path.join(ROOT, 'assets/js/03-calculations.js'), 'utf8');

// VM context (same as regression)
const elements = new Map(); const storage = new Map();
const makeEl = () => ({ style:{},dataset:{},innerHTML:'',innerText:'',disabled:false,classList:{add(){},remove(){},contains(){return false},toggle(){}},focus(){},querySelector(){return null},querySelectorAll(){return[]},addEventListener(){},appendChild(){},remove(){} });
const ctx = vm.createContext({
    console:{log:()=>{}}, setTimeout, clearTimeout, setInterval, clearInterval,
    performance:{now:()=>0},
    localStorage:{getItem(k){return storage.get(k)||null},setItem(k,v){storage.set(k,String(v))},removeItem(k){storage.delete(k)}},
    requestAnimationFrame(fn){return setTimeout(fn,0)}, cancelAnimationFrame(id){clearTimeout(id)},
    getComputedStyle(){return{getPropertyValue(){return''}}},
    document:{hidden:false,addEventListener(){},querySelector(){return makeEl()},querySelectorAll(){return[]},getElementById(id){if(!elements.has(id))elements.set(id,makeEl());return elements.get(id)},createElement(){return makeEl()},head:makeEl()},
    Chart:{register:()=>{},pluginService:{register:()=>{}},defaults:{plugins:{tooltip:{}},font:{}},controllers:{},elements:{},plugins:{},scaleService:{},scales:{},Tooltip:{positioners:{}},helpers:{}},
    fetch:()=>Promise.reject(new Error('no network')), indexIndicators:{},
});
ctx.window = ctx; ctx.self = ctx;

vm.runInContext(configSrc.replace(/state\.mode\s*=\s*'index'\s*;/, ''), ctx);
vm.runInContext(dataSrc.replace(/\/\/ 初始化\nif[\s\S]*$/m, '// skipped'), ctx);
vm.runInContext(calcSrc.replace(/\n\/\/ 启动应用\s*\ninit\(\);\s*$/, ''), ctx);

// Load index data
const allFiles = fs.readdirSync(CACHE_DIR);
for (const f of allFiles.filter(x => x.endsWith('.json') && x.startsWith('index_'))) {
    const data = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, f), 'utf8'));
    const items = Array.isArray(data) ? data : (data.items||[]);
    if (!items.length) continue;
    const parts = f.replace('.json','').split('_');
    ctx[`_idx_${parts[1]}`] = items;
    vm.runInContext(`state.rawData["${parts[1]}"] = _idx_${parts[1]}`, ctx);
}

// Set strategy with B9 guard
vm.runInContext(`STRATEGIES["波段抄底型"] = {...STRATEGIES["波段抄底型"],
    windowSignalGuards: {
        B8: { recentDays: 3, companionSignals: ['B5','B6','B9','B11','B16','B17'] },
        B9: { recentDays: 3, companionSignals: ['B5','B6','B8','B11','B16','B17'] }
    }
}; STRATEGY = STRATEGIES["波段抄底型"]; state.strategy = "波段抄底型"`, ctx);

// Replay all stocks
const stockFiles = {};
for (const f of allFiles.filter(x => x.endsWith('.json') && x.startsWith('stock_'))) {
    const parts = f.replace('.json','').split('_');
    stockFiles[parts[1]] = f;
}

const results = { strategies: { '波段抄底型': { performance: {}, bs: {b:0,s:0}, holding: {days:0,eligibleDays:0}, trades: {completed:0,adjustments:0,turnover:0} } } };
Object.assign(results.strategies['波段抄底型'].performance, { avgStrategyRet: 0, avgMaxDrawdown: 0, avgWinRate: 0, stockAvgStrategyRet: 0, stockAvgMaxDrawdown: 0 });

let processed = 0, totalB = 0, totalS = 0;

for (const [code, file] of Object.entries(stockFiles)) {
    const data = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, file), 'utf8'));
    const items = Array.isArray(data) ? data : (data.items||[]);
    if (items.length < 130) continue;

    ctx._items = items;
    vm.runInContext('state.mode = "stock"; state.id = "' + code + '"; _ind = ({ma:{5:Calcs.ma(_items,5),10:Calcs.ma(_items,10),20:Calcs.ma(_items,20),60:Calcs.ma(_items,60)},macd:Calcs.macd(_items),rsi:Calcs.rsi(_items,14),kdj:Calcs.kdj(_items,9)}); state.indicators = _ind', ctx);
    vm.runInContext('for(var i=60; i<_items.length; i++) _items[i]._signals = calculateDailySignals(i, _items, _ind)', ctx);

    // Replay and collect stats
    const stats = vm.runInContext(`(function(){
        var p=0, b=0, s=0, days=0, eligible=_items.length-60, completed=0, adj=0, turnover=0;
        var decisions=[];
        for(var i=60; i<_items.length; i++) {
            var d = computeDecisionForIndex(i, _items, p);
            d._idx = i; d._prevPos = p;
            _items[i]._decision = d;
            decisions.push(d);
            if (d.position>0) days++;
            if (d.bsMark==='B') b++;
            if (d.bsMark==='S') s++;
            if (p===0 && d.position>0) completed++;
            if (d.position !== p) adj++;
            turnover += Math.abs(d.position - p);
            p = d.position;
        }
        return {b:b, s:s, days:days, eligible:eligible, completed:completed, adj:adj, turnover:turnover};
    })()`, ctx);

    totalB += stats.b; totalS += stats.s;
    processed++;
    if (processed % 20 === 0) process.stdout.write(`\r  ${processed}/${Object.keys(stockFiles).length}`);
}
process.stdout.write(`\r✅ 回放完成 (${processed}只) | B=${totalB} S=${totalS}\n`);

// Write output
const out = {
    candidate: 'wave_b9_repair_guard',
    description: 'B9需要3日内有B5/B6/B8/B11/B16/B17修复证据才计分（与B8相同规则）',
    baseline: { stockAvgStrategyRet: baseWave.stockAvgStrategyRet, stockAvgMaxDrawdown: baseWave.stockAvgMaxDrawdown, avgWinRate: baseWave.avgWinRate, B: baseline.strategies['波段抄底型'].bs.b, S: baseline.strategies['波段抄底型'].bs.s },
    candidate: { B: totalB, S: totalS },
    recommendation: ''
};

const deltaB = totalB - (baseline.strategies['波段抄底型'].bs.b || 0);
const deltaS = totalS - (baseline.strategies['波段抄底型'].bs.s || 0);
out.delta = { B: deltaB, S: deltaS };
out.recommendation = deltaB < -50 && Math.abs(deltaB) < 200
    ? 'B减少幅度合理，建议正式准入（需补充完整收益/回撤/分层/三段窗口计算）'
    : deltaB < -200
    ? 'B大幅减少，过滤过强，必须查验删除的B质量'
    : 'B变化不明显，边际有限';

process.stdout.write(`\n基线 B=${baseline.strategies['波段抄底型'].bs.b} S=${baseline.strategies['波段抄底型'].bs.s}\n`);
process.stdout.write(`候选 B=${totalB} S=${totalS}\n`);
process.stdout.write(`B变化: ${deltaB > 0 ? '+' : ''}${deltaB} | S变化: ${deltaS > 0 ? '+' : ''}${deltaS}\n`);
process.stdout.write(`建议: ${out.recommendation}\n`);

fs.writeFileSync(OUT, JSON.stringify(out, null, 2), 'utf8');
process.stdout.write(`\n报告: ${OUT}\n`);
