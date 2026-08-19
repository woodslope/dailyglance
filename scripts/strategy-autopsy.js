#!/usr/bin/env node
const fs = require('fs'); const path = require('path'); const vm = require('vm');
const ROOT = path.resolve(__dirname, '..');
const CACHE_DIR = path.join(ROOT, '.local', 'strategy-cache');
const REPORT_DIR = path.join(ROOT, '.local', 'strategy-reports');
const OUT = path.join(REPORT_DIR, 'strategy-autopsy-wave-bottom.md');

process.stdout.write('🔬 加载源码...\n');
const configSrc = fs.readFileSync(path.join(ROOT, 'assets/js/01-config-ui.js'), 'utf8');
const dataSrc = fs.readFileSync(path.join(ROOT, 'assets/js/02-data.js'), 'utf8');
const calcSrc = fs.readFileSync(path.join(ROOT, 'assets/js/03-calculations.js'), 'utf8');

// Browser-like VM context
const elements = new Map(); const storage = new Map();
const makeEl = () => ({ style:{},dataset:{},innerHTML:'',innerText:'',textContent:'',disabled:false,classList:{add(){},remove(){},contains(){return false},toggle(){}},focus(){},querySelector(){return null},querySelectorAll(){return[]},addEventListener(){},appendChild(){},remove(){} });
const ctx = vm.createContext({
    console:{log:()=>{}}, setTimeout, clearTimeout, setInterval, clearInterval,
    performance:{now:()=>0},
    localStorage:{getItem(k){return storage.get(k)||null},setItem(k,v){storage.set(k,String(v))},removeItem(k){storage.delete(k)}},
    requestAnimationFrame(fn){return setTimeout(fn,0)}, cancelAnimationFrame(id){clearTimeout(id)},
    getComputedStyle(){return{getPropertyValue(){return''}}},
    document:{hidden:false,addEventListener(){},querySelector(){return makeEl()},querySelectorAll(){return[]},getElementById(id){if(!elements.has(id))elements.set(id,makeEl());return elements.get(id)},createElement(){return makeEl()},head:makeEl()},
    Chart:{register:()=>{},pluginService:{register:()=>{}},defaults:{plugins:{tooltip:{}},font:{}},controllers:{},elements:{},plugins:{},scaleService:{},scales:{},Tooltip:{positioners:{}},helpers:{}},
    fetch:()=>Promise.reject(new Error('no network')),
    indexIndicators:{}, _items:null, _ind:null, _reportParts:[]
});
ctx.window = ctx; ctx.self = ctx;

// Load all sources
vm.runInContext(configSrc.replace(/state\.mode\s*=\s*'index'\s*;/, ''), ctx);
vm.runInContext(dataSrc.replace(/\/\/ 初始化\nif[\s\S]*$/m, '// skipped'), ctx);
vm.runInContext(calcSrc.replace(/\n\/\/ 启动应用\s*\ninit\(\);\s*$/, ''), ctx);

process.stdout.write('🔬 读取缓存...\n');

// Helper: run calc in VM using _items/_ind on ctx
function vmCall(code) { return vm.runInContext(code, ctx); }

// Load all cache files, identify indices and stocks
const allFiles = fs.readdirSync(CACHE_DIR).filter(f => f.endsWith('.json'));
let indexItems = {}; // id -> items array
let stockFiles = {};

for (const f of allFiles) {
    const data = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, f), 'utf8'));
    const items = Array.isArray(data) ? data : (data.items || []);
    if (!items.length) continue;
    const parts = f.replace('.json','').split('_');
    if (parts[0] === 'index') {
        indexItems[parts[1]] = items;
        // Put into VM
        ctx[`_idx_${parts[1]}`] = items;
        vmCall(`state.rawData["${parts[1]}"] = _idx_${parts[1]}`);
    } else {
        stockFiles[parts[1]] = f;
    }
}
process.stdout.write(`  指数 ${Object.keys(indexItems).length} 个，股票 ${Object.keys(stockFiles).length} 只\n`);

// Set strategy in VM
vmCall('STRATEGY = STRATEGIES["波段抄底型"]; state.strategy = "波段抄底型"');

// ===== Main Analysis =====
process.stdout.write('🔬 分析波段 B 事件...\n');
const bEvents = [];
let processed = 0;

for (const [code, file] of Object.entries(stockFiles)) {
    const data = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, file), 'utf8'));
    const items = Array.isArray(data) ? data : (data.items || []);
    if (items.length < 130) continue;

    // Build indicators via VM
    ctx._items = items;
    vmCall('_ind = ({ma:{5:Calcs.ma(_items,5),10:Calcs.ma(_items,10),20:Calcs.ma(_items,20),60:Calcs.ma(_items,60)},macd:Calcs.macd(_items),rsi:Calcs.rsi(_items,14),kdj:Calcs.kdj(_items,9)})');
    vmCall('state.indicators = _ind; state.mode = "stock"');

    // Calculate all signals once
    vmCall('for(var i=60; i<_items.length; i++) _items[i]._signals = calculateDailySignals(i, _items, _ind)');

    // Replay decisions
    vmCall(`
        var _prevPos = 0;
        _decisions = [];
        for(var i=60; i<_items.length; i++) {
            var d = computeDecisionForIndex(i, _items, _prevPos);
            d._idx = i;
            _items[i]._decision = d;
            _decisions.push(d);
            _prevPos = d.position;
        }
    `);

    // Find B events and extract data
    vmCall(`
        _bEvents = [];
        for(var j=0; j<_decisions.length; j++) {
            var d = _decisions[j];
            if (d.bsMark !== 'B') continue;
            var i = d._idx;
            var bar = _items[i];
            var meta = calculateAllSignals(i, _items, _ind);
            var ret5=null, ret10=null, ret20=null, mfe5=null;
            var ec = bar.close;
            var i5 = Math.min(i+5, _items.length-1);
            var i10 = Math.min(i+10, _items.length-1);
            var i20 = Math.min(i+20, _items.length-1);
            if (i5>i) { ret5 = (_items[i5].close-ec)/ec; var mx=-Infinity; for(var k=i+1;k<=i5;k++){ var v=(_items[k].high-ec)/ec; if(v>mx)mx=v; } mfe5=mx; }
            if (i10>i) ret10 = (_items[i10].close-ec)/ec;
            if (i20>i) ret20 = (_items[i20].close-ec)/ec;

            var success = ret20 !== null && ret20 >= 0;
            var strongS = mfe5 !== null && mfe5 >= 0.05;

            var ss = []; for(var s=0; s<(meta.windowScoreSignals||[]).length; s++) ss.push(meta.windowScoreSignals[s].signal); ss.sort();
            var buySigs = []; for(var b=0; b<(meta.buySignals||[]).length; b++) if(meta.buySignals[b].startsWith('B')) buySigs.push(meta.buySignals[b]);

            var mkt = d.market || {};
            var risk = d.risk || {};

            // 60-day drawdown
            var r60 = _items.slice(Math.max(0,i-60), i+1);
            var h60 = -Infinity; for(var h=0;h<r60.length;h++){if(r60[h].high>h60)h60=r60[h].high;}
            var dd60 = h60>0 ? (ec-h60)/h60 : 0;

            // Vol ratio
            var vsum=0; for(var v=Math.max(0,i-20);v<i;v++) vsum += (_items[v].vol||0);
            var v20a = vsum/20; var volR = v20a>0 ? (bar.vol||0)/v20a : 1;

            var m20 = _ind.ma[20][i]||0; var m60 = _ind.ma[60][i]||0;
            var rsiV = _ind.rsi.val[i]||50;

            _bEvents.push({
                symbol: '${code}', date: bar.date, entryClose: ec,
                scoreSignals: JSON.stringify(ss),
                scoreTotal: meta.windowScore||0,
                buyCount: buySigs.length,
                position: d.position||0,
                marketLabel: mkt.label||'unknown',
                ret5: ret5, ret10: ret10, ret20: ret20, mfe5: mfe5,
                success: success, strongSuccess: strongS,
                atrPct: risk.atrPct||0, distMA20: risk.distMA20||0,
                riskScore: risk.score||100,
                aboveMA20: ec > m20, aboveMA60: ec > m60, ma20Above60: m20 > m60,
                rsiV: rsiV, volRatio: volR, dd60: dd60,
                bQuality: d.bQuality||'standard'
            });
        }
    `);

    // Extract results from VM
    const events = vmCall('_bEvents');
    for (const e of events) {
        e.scoreSignals = JSON.parse(e.scoreSignals);
        bEvents.push(e);
    }

    processed++;
    if (processed % 20 === 0) process.stdout.write(`\r  已处理 ${processed}/${Object.keys(stockFiles).length}`);
}
process.stdout.write(`\r✅ ${bEvents.length} 次 B 事件（${processed} 只股票）\n`);

// ===== Write Report =====
process.stdout.write('🔬 生成报告...\n');
let report = '';
report += '# 策略尸检报告\n\n';
report += `> 生成: ${new Date().toISOString().slice(0,19).replace('T',' ')} | 数据: 2021-01 ~ 2026-07\n`;
report += `> 策略: 波段抄底型 v4.2.13 | ${processed}只股票 | ${bEvents.length}次B事件\n\n---\n\n`;

// 1. Overall
report += '## 1. 整体统计\n\n';
const total = bEvents.length;
const successes = bEvents.filter(e => e.success).length;
const strongS = bEvents.filter(e => e.strongSuccess).length;
const avg = (arr, fn) => arr.filter(e => fn(e) !== null).reduce((s,e) => s + fn(e), 0) / arr.filter(e => fn(e) !== null).length || 0;

report += `| 指标 | 数值 |\n|------|------|\n`;
report += `| B事件总数 | ${total} |\n`;
report += `| 20日成功率 | ${(successes/total*100).toFixed(1)}% |\n`;
report += `| 5日强成功率(MFE≥5%) | ${(strongS/total*100).toFixed(1)}% |\n`;
report += `| 5日收益 | ${(avg(bEvents,e=>e.ret5)*100).toFixed(2)}% |\n`;
report += `| 10日收益 | ${(avg(bEvents,e=>e.ret10)*100).toFixed(2)}% |\n`;
report += `| 20日收益 | ${(avg(bEvents,e=>e.ret20)*100).toFixed(2)}% |\n`;
report += `| 5日MFE | ${(avg(bEvents.filter(e=>e.mfe5!==null),e=>e.mfe5)*100).toFixed(2)}% |\n\n`;

// 2. Signal Combo
report += '## 2. 信号组合成败率（≥10次）\n\n';
const comboMap = new Map();
for (const e of bEvents) {
    const k = e.scoreSignals.join('+') || '(空)';
    if (!comboMap.has(k)) comboMap.set(k, []);
    comboMap.get(k).push(e);
}
const combos = [...comboMap.entries()].filter(([,es]) => es.length >= 10).sort((a,b) => b[1].length - a[1].length);
report += `| 组合 | 次数 | 成功率 | 强成功 | 5日 | 20日 | 积分 |\n|------|------|--------|--------|------|------|------|\n`;
for (const [combo, es] of combos.slice(0, 25)) {
    const sr = es.filter(e => e.success).length / es.length;
    const ssr = es.filter(e => e.strongSuccess).length / es.length;
    const r5 = avg(es.filter(e=>e.ret5!==null),e=>e.ret5);
    const r20 = avg(es.filter(e=>e.ret20!==null),e=>e.ret20);
    const asc = es.reduce((s,e) => s + e.scoreTotal, 0) / es.length;
    report += `| ${combo} | ${es.length} | ${(sr*100).toFixed(0)}% | ${(ssr*100).toFixed(0)}% | ${(r5*100).toFixed(1)}% | ${(r20*100).toFixed(1)}% | ${asc.toFixed(1)} |\n`;
}
report += '\n';

// 3. Market
report += '## 3. 市场环境\n\n';
const mktBuckets = {};
for (const e of bEvents) { const ml = e.marketLabel; mktBuckets[ml] = mktBuckets[ml] || []; mktBuckets[ml].push(e); }
report += `| 状态 | B次数 | 成功率 | 强成功 | 5日 | 20日 |\n|------|-------|--------|--------|------|------|\n`;
for (const [ml, es] of Object.entries(mktBuckets).sort((a,b) => b[1].length - a[1].length)) {
    report += `| ${ml} | ${es.length} | ${(es.filter(e=>e.success).length/es.length*100).toFixed(0)}% | ${(es.filter(e=>e.strongSuccess).length/es.length*100).toFixed(0)}% | ${(avg(es.filter(e=>e.ret5!==null),e=>e.ret5)*100).toFixed(1)}% | ${(avg(es.filter(e=>e.ret20!==null),e=>e.ret20)*100).toFixed(1)}% |\n`;
}
report += '\n';

// 4. Failed vs Success
report += '## 4. 失败 vs 成功：入场特征\n\n';
const failed = bEvents.filter(e => !e.success);
const succE = bEvents.filter(e => e.success);
const cmp = (field, fmt) => {
    const fv = failed.reduce((s,e) => s + (e[field]||0), 0) / failed.length;
    const sv = succE.reduce((s,e) => s + (e[field]||0), 0) / succE.length;
    return `| ${field} | ${fmt(fv)} | ${fmt(sv)} | ${fv>sv?'↑':'↓'}${Math.abs(fv-sv).toFixed(2)} |\n`;
};
report += `| 指标 | 失败 | 成功 | 差异 |\n|------|------|------|------|\n`;
report += cmp('rsiV', v=>v.toFixed(1));
report += cmp('dd60', v=>(v*100).toFixed(1)+'%');
report += cmp('volRatio', v=>v.toFixed(2));
report += cmp('atrPct', v=>(v*100).toFixed(2)+'%');
report += cmp('distMA20', v=>(v*100).toFixed(1)+'%');
report += cmp('riskScore', v=>v.toFixed(0));
report += cmp('scoreTotal', v=>v.toFixed(1));
report += cmp('buyCount', v=>v.toFixed(1));

report += `\n### 均线结构\n| 条件 | 失败 | 成功 |\n|------|------|------|\n`;
report += `| 收盘>MA20 | ${(failed.filter(e=>e.aboveMA20).length/failed.length*100).toFixed(0)}% | ${(succE.filter(e=>e.aboveMA20).length/succE.length*100).toFixed(0)}% |\n`;
report += `| 收盘>MA60 | ${(failed.filter(e=>e.aboveMA60).length/failed.length*100).toFixed(0)}% | ${(succE.filter(e=>e.aboveMA60).length/succE.length*100).toFixed(0)}% |\n`;
report += `| MA20>MA60 | ${(failed.filter(e=>e.ma20Above60).length/failed.length*100).toFixed(0)}% | ${(succE.filter(e=>e.ma20Above60).length/succE.length*100).toFixed(0)}% |\n\n`;

// 5. Position
report += '## 5. 仓位与结果\n\n';
const posBucks = {30:[],50:[],80:[],100:[]};
for (const e of bEvents) for (const k of Object.keys(posBucks)) if (e.position <= parseInt(k)) { posBucks[k].push(e); break; }
report += `| 仓位 | B次数 | 成功率 | 5日 | 20日 |\n|------|-------|--------|------|------|\n`;
for (const [pos, es] of Object.entries(posBucks)) {
    if (!es.length) continue;
    report += `| ${pos}% | ${es.length} | ${(es.filter(e=>e.success).length/es.length*100).toFixed(0)}% | ${(avg(es.filter(e=>e.ret5!==null),e=>e.ret5)*100).toFixed(1)}% | ${(avg(es.filter(e=>e.ret20!==null),e=>e.ret20)*100).toFixed(1)}% |\n`;
}
report += '\n';

// 6. Year-by-Year
report += '## 6. 年度表现\n\n';
const yrBucks = {};
for (const e of bEvents) { const yr = e.date.substring(0,4); yrBucks[yr] = yrBucks[yr] || []; yrBucks[yr].push(e); }
report += `| 年份 | B次数 | 成功率 | 强成功 | 5日 | 20日 | 标的 |\n|------|-------|--------|--------|------|------|------|\n`;
for (const [yr, es] of Object.entries(yrBucks).sort()) {
    report += `| ${yr} | ${es.length} | ${(es.filter(e=>e.success).length/es.length*100).toFixed(0)}% | ${(es.filter(e=>e.strongSuccess).length/es.length*100).toFixed(0)}% | ${(avg(es.filter(e=>e.ret5!==null),e=>e.ret5)*100).toFixed(1)}% | ${(avg(es.filter(e=>e.ret20!==null),e=>e.ret20)*100).toFixed(1)}% | ${new Set(es.map(e=>e.symbol)).size} |\n`;
}
report += '\n';

// 7. Industry
report += '## 7. 行业\n\n';
const UNIVERSE = JSON.parse(fs.readFileSync(path.join(ROOT, 'strategy-validation-universe.json'), 'utf8'));
const stockInd = {};
for (const s of UNIVERSE.stocks) stockInd[s.code] = s.industry;
const indBucks = {};
for (const e of bEvents) { const ind = stockInd[e.symbol] || '其他'; indBucks[ind] = indBucks[ind] || []; indBucks[ind].push(e); }
report += `| 行业 | B次数 | 成功率 | 强成功 | 5日 | 20日 |\n|------|-------|--------|--------|------|------|\n`;
for (const [ind, es] of Object.entries(indBucks).sort((a,b) => b[1].length - a[1].length)) {
    report += `| ${ind} | ${es.length} | ${(es.filter(e=>e.success).length/es.length*100).toFixed(0)}% | ${(es.filter(e=>e.strongSuccess).length/es.length*100).toFixed(0)}% | ${(avg(es.filter(e=>e.ret5!==null),e=>e.ret5)*100).toFixed(1)}% | ${(avg(es.filter(e=>e.ret20!==null),e=>e.ret20)*100).toFixed(1)}% |\n`;
}
report += '\n';

// 8. Key Findings
report += '## 8. 关键发现\n\n';

const qCombos = combos.filter(([,es]) => es.length >= 15);
if (qCombos.length >= 2) {
    const best = qCombos.reduce((a,b) => (b[1].filter(e=>e.success).length/b[1].length) > (a[1].filter(e=>e.success).length/a[1].length) ? b : a);
    const worst = qCombos.reduce((a,b) => (b[1].filter(e=>e.success).length/b[1].length) < (a[1].filter(e=>e.success).length/a[1].length) ? b : a);
    report += `### 信号组合\n- **最佳**: ${best[0]} (${best[1].length}次, ${(best[1].filter(e=>e.success).length/best[1].length*100).toFixed(0)}%成功)\n`;
    report += `- **最差**: ${worst[0]} (${worst[1].length}次, ${(worst[1].filter(e=>e.success).length/worst[1].length*100).toFixed(0)}%成功)\n\n`;
}
const qInds = Object.entries(indBucks).filter(([,es]) => es.length >= 10).sort((a,b) => (b[1].filter(e=>e.success).length/b[1].length) - (a[1].filter(e=>e.success).length/a[1].length));
if (qInds.length >= 2) {
    report += `### 行业差异\n- **最高**: ${qInds[0][0]} (${(qInds[0][1].filter(e=>e.success).length/qInds[0][1].length*100).toFixed(0)}%)\n`;
    report += `- **最低**: ${qInds[qInds.length-1][0]} (${(qInds[qInds.length-1][1].filter(e=>e.success).length/qInds[qInds.length-1][1].length*100).toFixed(0)}%)\n\n`;
}
const bearEv = mktBuckets['核心宽基偏弱'] || [];
const bullEv = mktBuckets['核心宽基偏强'] || [];
if (bearEv.length && bullEv.length) {
    report += `### 市场环境\n核心宽基偏弱成功率 ${(bearEv.filter(e=>e.success).length/bearEv.length*100).toFixed(0)}% vs 核心宽基偏强 ${(bullEv.filter(e=>e.success).length/bullEv.length*100).toFixed(0)}%\n\n`;
}
report += `### 入场形态\n`;
report += `- 失败组 ${(failed.filter(e=>e.dd60<-0.2).length/failed.length*100).toFixed(0)}% vs 成功组 ${(succE.filter(e=>e.dd60<-0.2).length/succE.length*100).toFixed(0)}% 的B发生在60日回撤>20%后\n`;
report += `- 失败组均量比 ${(failed.reduce((s,e)=>s+e.volRatio,0)/failed.length).toFixed(2)} vs 成功组 ${(succE.reduce((s,e)=>s+e.volRatio,0)/succE.length).toFixed(2)}\n\n`;

report += '---\n> 由 `scripts/strategy-autopsy.js` 生成。仅用于研究，不构成投资建议。\n';

fs.mkdirSync(REPORT_DIR, { recursive: true });
fs.writeFileSync(OUT, report, 'utf8');
process.stdout.write(`\n✅ 报告: ${OUT}\n`);
