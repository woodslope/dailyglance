#!/usr/bin/env node
// B9 guard parameter sweep: 3/5/7/10 day windows
const fs = require('fs'); const path = require('path'); const vm = require('vm');
const ROOT = path.resolve(__dirname, '..');
const CACHE_DIR = path.join(ROOT, '.local', 'strategy-cache');
const BASELINE_PATH = path.join(ROOT, '.local', 'strategy-reports', 'formal-strategy-baseline-20260731T163742Z.json');

process.stdout.write('🔬 B9 guard 参数扫描: 窗口 3/5/7/10 日\n\n');

const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
const baseB = baseline.strategies['波段抄底型'].bs.b;
const baseS = baseline.strategies['波段抄底型'].bs.s;
process.stdout.write(`基线: B=${baseB} S=${baseS}\n\n`);

// Load VM
const configSrc = fs.readFileSync(path.join(ROOT, 'assets/js/01-config-ui.js'), 'utf8');
const dataSrc = fs.readFileSync(path.join(ROOT, 'assets/js/02-data.js'), 'utf8');
const calcSrc = fs.readFileSync(path.join(ROOT, 'assets/js/03-calculations.js'), 'utf8');

const elements = new Map(); const storage = new Map();
const makeEl = () => ({ style:{},dataset:{},innerHTML:'',innerText:'',disabled:false,classList:{add(){},remove(){},contains(){return false},toggle(){}},focus(){},querySelector(){return null},querySelectorAll(){return[]},addEventListener(){},appendChild(){},remove(){} });

function makeContext() {
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
    return ctx;
}

// Load sources once
const ctx = makeContext();
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

const stockFiles = {};
for (const f of allFiles.filter(x => x.endsWith('.json') && x.startsWith('stock_'))) {
    const parts = f.replace('.json','').split('_');
    stockFiles[parts[1]] = f;
}

const companions = ['B5','B6','B8','B11','B16','B17'];
const windows = [3, 5, 7, 10];
const results = {};

for (const days of windows) {
    process.stdout.write(`── 窗口 ${days} 日 ──\n`);

    // Set B9 guard with this window
    vm.runInContext(`STRATEGIES["波段抄底型"] = {...STRATEGIES["波段抄底型"],
        windowSignalGuards: {
            B8: { recentDays: 3, companionSignals: ['B5','B6','B9','B11','B16','B17'] },
            B9: { recentDays: ${days}, companionSignals: [${companions.map(s=>"'"+s+"'").join(',')}] }
        }
    }; STRATEGY = STRATEGIES["波段抄底型"]; state.strategy = "波段抄底型"`, ctx);

    let totalB = 0, totalS = 0;
    let processed = 0;

    for (const [code, file] of Object.entries(stockFiles)) {
        const data = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, file), 'utf8'));
        const items = Array.isArray(data) ? data : (data.items||[]);
        if (items.length < 130) continue;

        ctx._items = items;
        vm.runInContext('state.mode = "stock"; _ind = ({ma:{5:Calcs.ma(_items,5),10:Calcs.ma(_items,10),20:Calcs.ma(_items,20),60:Calcs.ma(_items,60)},macd:Calcs.macd(_items),rsi:Calcs.rsi(_items,14),kdj:Calcs.kdj(_items,9)}); state.indicators = _ind', ctx);
        vm.runInContext('for(var i=60; i<_items.length; i++) _items[i]._signals = calculateDailySignals(i, _items, _ind)', ctx);

        const stats = vm.runInContext(`(function(){
            var p=0, b=0, s=0;
            for(var i=60; i<_items.length; i++) {
                var d = computeDecisionForIndex(i, _items, p);
                if(d.bsMark==='B') b++;
                if(d.bsMark==='S') s++;
                p = d.position;
            }
            return {b:b, s:s};
        })()`, ctx);

        totalB += stats.b; totalS += stats.s;
        processed++;
    }

    const dB = totalB - baseB;
    const dS = totalS - baseS;
    const pct = (Math.abs(dB) / baseB * 100).toFixed(1);

    process.stdout.write(`  B=${totalB} (${dB>0?'+':''}${dB}, ${pct}%) S=${totalS} (${dS>0?'+':''}${dS})\n`);

    results[days] = { b: totalB, s: totalS, dB, dS, pct };
}

// Summary
process.stdout.write(`\n══════════════════\n`);
process.stdout.write(`窗口 | B变化 | % | 判断\n`);
process.stdout.write(`-----|-------|-----|------\n`);

let bestDays = windows[0];
for (const days of windows) {
    const r = results[days];
    const judge = Math.abs(r.dB) < 100 ? '过滤不足' :
                  Math.abs(r.dB) < 200 ? '过滤适中 ✅' :
                  Math.abs(r.dB) < 400 ? '过滤偏强 ⚠️' : '过滤过强 ❌';
    const targeted = Math.abs(r.dB) >= 84 && Math.abs(r.dB) <= 200;
    process.stdout.write(`${days}日  | ${r.dB > 0 ? '+' : ''}${r.dB} | ${r.pct}% | ${judge}${targeted ? ' (覆盖孤立B9的84次)' : ''}\n`);
    if (Math.abs(r.dB) >= 80 && Math.abs(r.dB) <= 250) bestDays = days;
}

process.stdout.write(`\n建议窗口: ${bestDays} 日\n`);
process.stdout.write(`从尸检看: 孤立B9=84次(36%成功), 移除目标≈84-200次\n`);
