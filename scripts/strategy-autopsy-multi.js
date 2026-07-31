#!/usr/bin/env node
// Multi-strategy autopsy runner — takes strategy name as arg
const fs = require('fs'); const path = require('path'); const vm = require('vm');
const ROOT = path.resolve(__dirname, '..');
const CACHE_DIR = path.join(ROOT, '.local', 'strategy-cache');
const STRATEGY_NAME = process.argv[2] || '波段抄底型';

if (!['稳健趋势型','波段抄底型','突破追涨型','综合全能型'].includes(STRATEGY_NAME)) {
    console.error('Usage: node strategy-autopsy-multi.js <策略名>');
    process.exit(1);
}

const OUT = path.join(ROOT, 'docs', 'strategy', `STRATEGY_AUTOPSY_${STRATEGY_NAME}.md`);
process.stdout.write(`🔬 尸检: ${STRATEGY_NAME}\n`);

const configSrc = fs.readFileSync(path.join(ROOT, 'assets/js/01-config-ui.js'), 'utf8');
const dataSrc = fs.readFileSync(path.join(ROOT, 'assets/js/02-data.js'), 'utf8');
const calcSrc = fs.readFileSync(path.join(ROOT, 'assets/js/03-calculations.js'), 'utf8');

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

// Load indices
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

// Set strategy
vm.runInContext(`STRATEGY = STRATEGIES["${STRATEGY_NAME}"]; state.strategy = "${STRATEGY_NAME}"`, ctx);

// Collect B events
const bEvents = [];
let processed = 0;

for (const [code, file] of Object.entries(stockFiles)) {
    const data = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, file), 'utf8'));
    const items = Array.isArray(data) ? data : (data.items||[]);
    if (items.length < 130) continue;

    ctx._items = items;
    vm.runInContext('state.mode = "stock"; _ind = ({ma:{5:Calcs.ma(_items,5),10:Calcs.ma(_items,10),20:Calcs.ma(_items,20),60:Calcs.ma(_items,60)},macd:Calcs.macd(_items),rsi:Calcs.rsi(_items,14),kdj:Calcs.kdj(_items,9)}); state.indicators = _ind', ctx);
    vm.runInContext('for(var i=60; i<_items.length; i++) _items[i]._signals = calculateDailySignals(i, _items, _ind)', ctx);

    vm.runInContext(`
        _prevPos = 0; _bEvents = [];
        for(var i=60; i<_items.length; i++) {
            var d = computeDecisionForIndex(i, _items, _prevPos);
            _prevPos = d.position;
            if (d.bsMark !== 'B') continue;
            var bar = _items[i]; var meta = calculateAllSignals(i, _items, _ind);
            var ec = bar.close;
            var i5 = Math.min(i+5, _items.length-1);
            var i10 = Math.min(i+10, _items.length-1);
            var i20 = Math.min(i+20, _items.length-1);
            var ret5=null, ret10=null, ret20=null, mfe5=null;
            if(i5>i) { ret5 = (_items[i5].close-ec)/ec; var mx=-Infinity; for(var k=i+1;k<=i5;k++){var v=(_items[k].high-ec)/ec; if(v>mx)mx=v;} mfe5=mx; }
            if(i10>i) ret10 = (_items[i10].close-ec)/ec;
            if(i20>i) ret20 = (_items[i20].close-ec)/ec;
            var ss=[]; for(var s=0; s<(meta.windowScoreSignals||[]).length; s++) ss.push(meta.windowScoreSignals[s].signal); ss.sort();
            var mkt = d.market || {}; var risk = d.risk || {};
            var r60 = _items.slice(Math.max(0,i-60), i+1);
            var h60=-Infinity; for(var h=0;h<r60.length;h++){if(r60[h].high>h60)h60=r60[h].high;}
            var dd60 = h60>0 ? (ec-h60)/h60 : 0;
            var vsum=0; for(var v=Math.max(0,i-20);v<i;v++) vsum += (_items[v].vol||0);
            var volR = vsum/20>0 ? (bar.vol||0)/(vsum/20) : 1;
            var m20=_ind.ma[20][i]||0; var m60=_ind.ma[60][i]||0;
            _bEvents.push({
                symbol:'${code}',date:bar.date,entryClose:ec,
                scoreSignals:JSON.stringify(ss),
                scoreTotal:meta.windowScore||0,
                position:d.position||0,
                marketLabel:(mkt.label||'unknown'),
                ret5:ret5,ret10:ret10,ret20:ret20,mfe5:mfe5,
                success:ret20!==null&&ret20>=0,
                strongSuccess:mfe5!==null&&mfe5>=0.05,
                atrPct:risk.atrPct||0,distMA20:risk.distMA20||0,riskScore:risk.score||100,
                aboveMA20:ec>m20,aboveMA60:ec>m60,ma20Above60:m20>m60,
                rsiV:(_ind.rsi.val[i]||50),volRatio:volR,dd60:dd60
            });
        }
    `, ctx);

    const events = vm.runInContext('_bEvents', ctx);
    for (const e of events) { e.scoreSignals = JSON.parse(e.scoreSignals); bEvents.push(e); }
    processed++;
    if (processed % 20 === 0) process.stdout.write(`\r  股票 ${processed}/${Object.keys(stockFiles).length}`);
}
process.stdout.write(`\r✅ ${bEvents.length} 次 B 事件 (${processed} 只)\n`);

// Helper
const avg = (arr, fn) => { const f = arr.filter(e => fn(e) !== null); return f.length ? f.reduce((s,e) => s + fn(e), 0) / f.length : 0; };

// Report
const total = bEvents.length;
const successes = bEvents.filter(e => e.success).length;
const strongS = bEvents.filter(e => e.strongSuccess).length;
const failed = bEvents.filter(e => !e.success);
const succE = bEvents.filter(e => e.success);

let r = '';
r += `# 策略尸检: ${STRATEGY_NAME}\n\n`;
r += `> 生成: ${new Date().toISOString().slice(0,19).replace('T',' ')} | 97只股票 | ${total}次B事件\n\n---\n\n`;
r += '## 1. 整体统计\n\n';
r += `| 指标 | 数值 |\n|------|------|\n`;
r += `| B事件 | ${total} |\n`;
r += `| 20日成功率 | ${(successes/total*100).toFixed(1)}% |\n`;
r += `| 5日强成功(MFE≥5%) | ${(strongS/total*100).toFixed(1)}% |\n`;
r += `| 5/10/20日收益 | ${(avg(bEvents,e=>e.ret5)*100).toFixed(2)}% / ${(avg(bEvents,e=>e.ret10)*100).toFixed(2)}% / ${(avg(bEvents,e=>e.ret20)*100).toFixed(2)}% |\n`;
r += `| 5日MFE | ${(avg(bEvents.filter(e=>e.mfe5!==null),e=>e.mfe5)*100).toFixed(2)}% |\n\n`;

// Signal combos
const comboMap = new Map();
for (const e of bEvents) { const k = e.scoreSignals.join('+') || '(空)'; if(!comboMap.has(k))comboMap.set(k,[]); comboMap.get(k).push(e); }
const combos = [...comboMap.entries()].filter(([,es]) => es.length >= 10).sort((a,b) => b[1].length - a[1].length);
r += '## 2. 信号组合 (≥10次)\n\n';
r += `| 组合 | 次数 | 成功率 | 强成功 | 5日 | 20日 | 积分 |\n|------|------|--------|--------|------|------|------|\n`;
for (const [combo, es] of combos.slice(0, 20)) {
    r += `| ${combo} | ${es.length} | ${(es.filter(e=>e.success).length/es.length*100).toFixed(0)}% | ${(es.filter(e=>e.strongSuccess).length/es.length*100).toFixed(0)}% | ${(avg(es.filter(e=>e.ret5!==null),e=>e.ret5)*100).toFixed(1)}% | ${(avg(es.filter(e=>e.ret20!==null),e=>e.ret20)*100).toFixed(1)}% | ${(es.reduce((s,e)=>s+e.scoreTotal,0)/es.length).toFixed(1)} |\n`;
}

// Market
r += '\n## 3. 市场环境\n\n';
const mktBuckets = {};
for (const e of bEvents) { const ml = e.marketLabel; mktBuckets[ml] = mktBuckets[ml] || []; mktBuckets[ml].push(e); }
r += `| 状态 | B次数 | 成功率 | 强成功 | 5日 | 20日 |\n|------|-------|--------|--------|------|------|\n`;
for (const [ml, es] of Object.entries(mktBuckets).sort((a,b) => b[1].length - a[1].length)) {
    r += `| ${ml} | ${es.length} | ${(es.filter(e=>e.success).length/es.length*100).toFixed(0)}% | ${(es.filter(e=>e.strongSuccess).length/es.length*100).toFixed(0)}% | ${(avg(es.filter(e=>e.ret5!==null),e=>e.ret5)*100).toFixed(1)}% | ${(avg(es.filter(e=>e.ret20!==null),e=>e.ret20)*100).toFixed(1)}% |\n`;
}

// Failed vs Success
const cmp = (field, fmt) => {
    const fv = failed.reduce((s,e) => s + (e[field]||0), 0) / failed.length;
    const sv = succE.reduce((s,e) => s + (e[field]||0), 0) / succE.length;
    return `| ${field} | ${fmt(fv)} | ${fmt(sv)} | ${fv>sv?'↑':'↓'}${Math.abs(fv-sv).toFixed(2)} |\n`;
};
r += '\n## 4. 失败 vs 成功\n\n';
r += `| 指标 | 失败 | 成功 | 差异 |\n|------|------|------|------|\n`;
r += cmp('rsiV', v=>v.toFixed(1));
r += cmp('dd60', v=>(v*100).toFixed(1)+'%');
r += cmp('volRatio', v=>v.toFixed(2));
r += cmp('atrPct', v=>(v*100).toFixed(2)+'%');
r += cmp('distMA20', v=>(v*100).toFixed(1)+'%');
r += cmp('riskScore', v=>v.toFixed(0));
r += cmp('scoreTotal', v=>v.toFixed(1));
r += `\n### 均线\n| 条件 | 失败 | 成功 |\n|------|------|------|\n`;
r += `| >MA20 | ${(failed.filter(e=>e.aboveMA20).length/failed.length*100).toFixed(0)}% | ${(succE.filter(e=>e.aboveMA20).length/succE.length*100).toFixed(0)}% |\n`;
r += `| >MA60 | ${(failed.filter(e=>e.aboveMA60).length/failed.length*100).toFixed(0)}% | ${(succE.filter(e=>e.aboveMA60).length/succE.length*100).toFixed(0)}% |\n`;
r += `| MA20>MA60 | ${(failed.filter(e=>e.ma20Above60).length/failed.length*100).toFixed(0)}% | ${(succE.filter(e=>e.ma20Above60).length/succE.length*100).toFixed(0)}% |\n`;

// Year
r += '\n## 5. 年度\n\n';
const yrBucks = {};
for (const e of bEvents) { const yr = e.date.substring(0,4); yrBucks[yr] = yrBucks[yr] || []; yrBucks[yr].push(e); }
r += `| 年份 | B次数 | 成功率 | 强成功 | 5日 | 20日 |\n|------|-------|--------|--------|------|------|\n`;
for (const [yr, es] of Object.entries(yrBucks).sort()) {
    r += `| ${yr} | ${es.length} | ${(es.filter(e=>e.success).length/es.length*100).toFixed(0)}% | ${(es.filter(e=>e.strongSuccess).length/es.length*100).toFixed(0)}% | ${(avg(es.filter(e=>e.ret5!==null),e=>e.ret5)*100).toFixed(1)}% | ${(avg(es.filter(e=>e.ret20!==null),e=>e.ret20)*100).toFixed(1)}% |\n`;
}

// Industry
r += '\n## 6. 行业\n\n';
const UNIVERSE = JSON.parse(fs.readFileSync(path.join(ROOT, 'strategy-validation-universe.json'), 'utf8'));
const stockInd = {};
for (const s of UNIVERSE.stocks) stockInd[s.code] = s.industry;
const indBucks = {};
for (const e of bEvents) { const ind = stockInd[e.symbol] || '其他'; indBucks[ind] = indBucks[ind] || []; indBucks[ind].push(e); }
r += `| 行业 | B次数 | 成功率 | 强成功 | 5日 | 20日 |\n|------|-------|--------|--------|------|------|\n`;
for (const [ind, es] of Object.entries(indBucks).sort((a,b) => b[1].length - a[1].length)) {
    r += `| ${ind} | ${es.length} | ${(es.filter(e=>e.success).length/es.length*100).toFixed(0)}% | ${(es.filter(e=>e.strongSuccess).length/es.length*100).toFixed(0)}% | ${(avg(es.filter(e=>e.ret5!==null),e=>e.ret5)*100).toFixed(1)}% | ${(avg(es.filter(e=>e.ret20!==null),e=>e.ret20)*100).toFixed(1)}% |\n`;
}

// Key findings
r += '\n## 7. 关键发现\n\n';
// Best/worst combo
const qc = combos.filter(([,es]) => es.length >= 10);
if (qc.length >= 2) {
    const best = qc.reduce((a,b) => (b[1].filter(e=>e.success).length/b[1].length) > (a[1].filter(e=>e.success).length/a[1].length) ? b : a);
    const worst = qc.reduce((a,b) => (b[1].filter(e=>e.success).length/b[1].length) < (a[1].filter(e=>e.success).length/a[1].length) ? b : a);
    r += `- **最佳组合**: ${best[0]} (${best[1].length}次, ${(best[1].filter(e=>e.success).length/best[1].length*100).toFixed(0)}%)\n`;
    r += `- **最差组合**: ${worst[0]} (${worst[1].length}次, ${(worst[1].filter(e=>e.success).length/worst[1].length*100).toFixed(0)}%)\n`;
}
// Best/worst industry (≥10 events)
const qi = Object.entries(indBucks).filter(([,es]) => es.length >= 10).sort((a,b) => (b[1].filter(e=>e.success).length/b[1].length) - (a[1].filter(e=>e.success).length/a[1].length));
if (qi.length >= 2) {
    r += `- **最佳行业**: ${qi[0][0]} (${(qi[0][1].filter(e=>e.success).length/qi[0][1].length*100).toFixed(0)}%)\n`;
    r += `- **最差行业**: ${qi[qi.length-1][0]} (${(qi[qi.length-1][1].filter(e=>e.success).length/qi[qi.length-1][1].length*100).toFixed(0)}%)\n`;
}
// Market impact
const bearE = mktBuckets['全面弱势'] || []; const bullE = mktBuckets['核心偏强'] || [];
if (bearE.length && bullE.length) {
    r += `- 全面弱势 ${(bearE.filter(e=>e.success).length/bearE.length*100).toFixed(0)}% vs 核心偏强 ${(bullE.filter(e=>e.success).length/bullE.length*100).toFixed(0)}%\n`;
}
// DD insight
r += `- 失败组${(failed.filter(e=>e.dd60<-0.2).length/failed.length*100).toFixed(0)}% vs 成功组${(succE.filter(e=>e.dd60<-0.2).length/succE.length*100).toFixed(0)}% 在60日回撤>20%后入场\n`;

r += '\n---\n> 由 `scripts/strategy-autopsy-multi.js` 生成。仅用于研究。\n';

fs.writeFileSync(OUT, r, 'utf8');
process.stdout.write(`✅ ${OUT}\n`);
