/* DailyGlance [5] - split from dailyglance.html. Keep classic script order. */
// ==========================================
// [5] 交互与生命周期 (Events & Lifecycle)
// ==========================================

function calculateBacktestSummary(full, options = {}) {
    const initialCapital = options.initialCapital || 10000;
    const costRate = options.costRate ?? 0.001;
    const startIdx = Math.max(1, options.startIdx ?? 60);
    const delayBars = Math.max(1, Number(options.delayBars) || 1);
    const minimumTradesForWinRate = Math.max(1, Number(options.minimumTradesForWinRate) || 30);
    let capital = initialCapital, peakCapital = initialCapital, maxDrawdown = 0;
    let benchmarkCapital = initialCapital * (1 - costRate), benchmarkPeak = benchmarkCapital, benchmarkMaxDrawdown = 0;
    const effectiveDecision = index => {
        const signalIndex = Math.max(0, index - delayBars);
        return { signalIndex, decision:full[signalIndex]?._decision || null };
    };
    let prevAdv = effectiveDecision(startIdx - 1).decision?.position || 0;
    let entryCapital = 0, winCount = 0, totalTrades = 0;
    const trades = [], closedTradeReturns = [];

    for(let i = startIdx; i < full.length; i++) {
        const item = full[i], prev = full[i-1], decision = item?._decision;
        if (!item || !prev || !decision) continue;

        if (prevAdv > 0) {
            const dailyRet = (item.close - prev.close) / prev.close;
            capital = capital * (1 + dailyRet * (prevAdv / 100));
        }
        if (prev.close > 0) benchmarkCapital *= 1 + ((item.close - prev.close) / prev.close);

        if(capital > peakCapital) peakCapital = capital;
        const dd = (peakCapital - capital) / peakCapital;
        if(dd > maxDrawdown) maxDrawdown = dd;
        if(benchmarkCapital > benchmarkPeak) benchmarkPeak = benchmarkCapital;
        const benchmarkDd = (benchmarkPeak - benchmarkCapital) / benchmarkPeak;
        if(benchmarkDd > benchmarkMaxDrawdown) benchmarkMaxDrawdown = benchmarkDd;

        const effective = effectiveDecision(i);
        const effectivePosition = effective.decision?.position || 0;
        if (effectivePosition !== prevAdv) {
            const turnover = Math.abs(effectivePosition - prevAdv) / 100;
            const cost = capital * turnover * costRate;
            if (cost > 0) capital -= cost;

            trades.push({
                signalDate: full[effective.signalIndex]?.date || '',
                executionDate: item.date,
                action: effective.decision?.simpleAction || '仓位调整',
                posFrom: prevAdv,
                posTo: effectivePosition,
                price: item.close,
                cost
            });

            if (prevAdv === 0 && effectivePosition > 0) {
                entryCapital = capital;
            } else if (effectivePosition === 0 && prevAdv > 0) {
                totalTrades++;
                const tradeRet = entryCapital ? (capital - entryCapital) / entryCapital : 0;
                closedTradeReturns.push(tradeRet);
                if (tradeRet > 0) winCount++;
                entryCapital = 0;
            }

            if(capital > peakCapital) peakCapital = capital;
            const postCostDd = (peakCapital - capital) / peakCapital;
            if(postCostDd > maxDrawdown) maxDrawdown = postCostDd;
        }
        prevAdv = effectivePosition;
    }

    const strategyReturn = (capital - initialCapital) / initialCapital * 100;
    const benchmarkReturn = (benchmarkCapital - initialCapital) / initialCapital * 100;
    return {
        capital,
        ret: strategyReturn.toFixed(2),
        benchmarkRet: benchmarkReturn.toFixed(2),
        excessRet: (strategyReturn - benchmarkReturn).toFixed(2),
        maxDrawdown: (maxDrawdown * 100).toFixed(2),
        benchmarkMaxDrawdown: (benchmarkMaxDrawdown * 100).toFixed(2),
        winRate: totalTrades > 0 ? ((winCount / totalTrades) * 100).toFixed(1) : '0.0',
        winRateQualified: totalTrades >= minimumTradesForWinRate,
        minimumTradesForWinRate,
        winCount,
        totalTrades,
        trades,
        closedTradeReturns,
        costRate,
        delayBars,
        startIdx,
        sampleDays: Math.max(0, full.length - startIdx),
        startDate: full[startIdx]?.date || '',
        endDate: full[full.length - 1]?.date || '',
        openPositionAtEnd: prevAdv > 0
    };
}

async function runBacktest() {
    if(state.mode !== 'stock' || !state.id) return customAlert("请先选择并查看一只具体的股票后再运行回测。");
    
    const full = state.rawData[state.id]; 
    if(!full || full.length < 100) return customAlert("历史数据不足，无法生成可信的历史回放。");
    
    const prevPeriod = state.period; 
    showLoading("正在生成历史回放...");

    try {
        if (state.period !== 'daily') { 
            state.period = 'daily'; 
            markIndicatorsDirty(); 
        }
        
        updateAllIndicators(); 
        await new Promise(r => setTimeout(r, 100)); 
        
        const summary = calculateBacktestSummary(full, { startIdx: 60, costRate: 0.001, delayBars: 1 });
        const { ret, benchmarkRet, excessRet, winRate, maxDrawdown: md, benchmarkMaxDrawdown, winCount, totalTrades, trades } = summary;
        
        hideLoading();
        
        let tradeRows = [...trades].reverse().map(t => {
            const colorClass = t.posTo > t.posFrom ? 'text-bull' : 'text-bear';
            return `
                <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 0; border-bottom:1px dashed var(--border-color); font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size:11px;">
                    <span class="text-dim" style="flex:1.35; text-align:left;">信号 ${t.signalDate.length > 5 ? t.signalDate.substring(5) : t.signalDate}</span>
                    <span class="${colorClass}" style="font-weight:bold; width:50px; text-align:center; flex-shrink:0;">${t.action.substring(0, 4)}</span>
                    <span class="text-main" style="flex:1; text-align:right;">执行 ${t.executionDate.length > 5 ? t.executionDate.substring(5) : t.executionDate}</span>
                    <span class="text-dim" style="flex:1.2; text-align:right;">${t.posFrom}%➔${t.posTo}%</span>
                </div>
            `;
        }).join('');
        
        const tradeListHtml = trades.length > 0 
            ? `<div style="margin-top:16px; border:1px solid var(--border-color); border-radius:var(--radius-sm); max-height:180px; overflow-y:auto; padding:0 12px; text-align:left;">${tradeRows}</div>` 
            : `<div style="margin-top:16px; padding:20px; font-size:12px; text-align:center; border:1px dashed var(--border-color); border-radius:var(--radius-sm);" class="text-dim">区间内无调仓动作</div>`;

        const reportHtml = `
            <div class="mono text-main" style="font-size:15px;font-weight:800;margin-bottom:16px;letter-spacing:0.5px;text-align:center;">
                历史回放: ${state.stockId}
            </div>
            <div class="text-dim" style="font-size:12px;margin-bottom:20px;text-align:center;">
                基于「${state.strategy}」${summary.startDate} 至 ${summary.endDate} 的 ${summary.sampleDays} 根日线；信号确认后延迟 ${summary.delayBars} 根日K执行，单边成本 ${(summary.costRate * 100).toFixed(2)}%
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;text-align:left;">
                <div class="terminal-block" style="padding:14px;">
                    <div class="text-dim" style="font-size:11px;margin-bottom:6px;font-weight:600;">策略收益</div>
                    <div class="mono ${ret >= 0 ? 'text-bull' : 'text-bear'}" style="font-size:20px;font-weight:800;">${ret > 0 ? '+' : ''}${ret}%</div>
                </div>
                <div class="terminal-block" style="padding:14px;">
                    <div class="text-dim" style="font-size:11px;margin-bottom:6px;font-weight:600;">买入持有收益</div>
                    <div class="mono ${benchmarkRet >= 0 ? 'text-bull' : 'text-bear'}" style="font-size:20px;font-weight:800;">${benchmarkRet > 0 ? '+' : ''}${benchmarkRet}%</div>
                </div>
                <div class="terminal-block" style="padding:14px;">
                    <div class="text-dim" style="font-size:11px;margin-bottom:6px;font-weight:600;">超额收益</div>
                    <div class="mono ${excessRet >= 0 ? 'text-bull' : 'text-bear'}" style="font-size:20px;font-weight:800;">${excessRet > 0 ? '+' : ''}${excessRet}%</div>
                </div>
                <div class="terminal-block" style="padding:14px;">
                    <div class="text-dim" style="font-size:11px;margin-bottom:6px;font-weight:600;">最大回撤</div>
                    <div class="mono text-main" style="font-size:20px;font-weight:800;">${md}%</div>
                    <div class="text-dim" style="font-size:10px;margin-top:3px;">买入持有 ${benchmarkMaxDrawdown}%</div>
                </div>
                <div class="terminal-block" style="padding:14px;grid-column:1/-1;">
                    <div class="text-dim" style="font-size:11px;margin-bottom:6px;font-weight:600;">完整交易样本</div>
                    <div style="display:flex;justify-content:space-between;align-items:end;">
                        <div class="mono ${summary.winRateQualified ? 'text-info' : 'text-dim'}" style="font-size:24px;font-weight:800;">${summary.winRateQualified ? `${winRate}%` : '样本不足'}</div>
                        <div class="text-dim" style="font-size:12px;font-weight:500;">${totalTrades} 次清仓结算，获利 ${winCount} 次；${summary.openPositionAtEnd ? '期末仍有未平仓仓位' : '期末无未平仓仓位'}</div>
                    </div>
                </div>
            </div>
            ${tradeListHtml}
            <div class="text-dim" style="margin-top:16px;font-size:10px;line-height:1.5;text-align:justify;">
                注：收益按实际仓位比例滚动计算，买入持有基准按同区间满仓持有并计入一次入场成本。未完整模拟涨跌停无法成交、盘中滑点、冲击成本和 T+1 约束。主图 B/S 是策略决策标记，不代表实际成交点；中途加减仓仅在交易记录中展示。
            </div>
        `;
        
        await customAlert(reportHtml, true);
    } catch(e) { 
        hideLoading(); 
        await customAlert('回测失败：' + (e.message || e)); 
    } finally { 
        if (state.period !== prevPeriod) { 
            state.period = prevPeriod; 
            markIndicatorsDirty(); 
            updateAllIndicators(); 
            draw(); 
            safeUpdateSidebar(); 
        } 
    }
}

function searchLocalStocks(q) { 
    const qt = q.toLowerCase(); 
    return STOCK_DATABASE
        .concat(stockCache.filter(s => !STOCK_DATABASE.some(b => b.Code === (s.Code || s.code))))
        .map(s => {
            const target = normalizeSecurityTarget(s);
            return { Code: target.code, Name: target.name, QuoteID: target.secid, Type: target.type, TencentSymbol: target.tencentSymbol };
        })
        .filter(s => s.Name.toLowerCase().includes(qt) || s.Code.includes(qt)); 
}

function jsonpSearchEastmoney(query) {
    return new Promise(resolve => {
        const cb = 'em_search_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
        const url = `https://searchadapter.eastmoney.com/api/suggest/get?input=${encodeURIComponent(query)}&type=14&token=${STOCK_TOKEN}&cb=${cb}`;
        let cl = false;
        const cleanup = () => {
            if (cl) return;
            cl = true; clearTimeout(timer); delete window[cb];
            const s = document.getElementById('jq_' + cb);
            if (s) s.remove();
        };
        const timer = setTimeout(() => { cleanup(); resolve([]); }, 5000);
        window[cb] = data => {
            cleanup();
            const list = data?.QuotationCodeTable?.Data || [];
            resolve(list.filter(x => /^\d{6}$/.test(x.Code)).map(x => ({
                Code: x.Code,
                Name: x.Name || x.SecurityName || x.Code,
                QuoteID: x.QuoteID,
                Classify: x.Classify,
                SecurityTypeName: x.SecurityTypeName,
                SecurityType: x.SecurityType
            })));
        };
        const script = document.createElement('script');
        script.id = 'jq_' + cb;
        script.src = url;
        script.onerror = () => { cleanup(); resolve([]); };
        document.head.appendChild(script);
    });
}

function jsonpSearchSina(query) {
    return new Promise(resolve => {
        const cb = 'sina_search_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
        const url = `https://suggest.sinajs.cn/suggest/type=11&key=${encodeURIComponent(query)}&callback=${cb}`;
        let cl = false;
        const cleanup = () => {
            if (cl) return;
            cl = true; clearTimeout(timer); delete window[cb];
            const s = document.getElementById('jq_' + cb);
            if (s) s.remove();
        };
        const timer = setTimeout(() => { cleanup(); resolve([]); }, 5000);
        window[cb] = data => {
            cleanup();
            const list = data?.result?.items || [];
            resolve(list.map(i => ({ Code: i.code, Name: i.name })).filter(x => /^\d{6}$/.test(x.Code)));
        };
        const script = document.createElement('script');
        script.id = 'jq_' + cb;
        script.src = url;
        script.onerror = () => { cleanup(); resolve([]); };
        document.head.appendChild(script);
    });
}

async function jsonpSearch(query) {
    const res = await jsonpSearchEastmoney(query);
    return res.length ? res : await jsonpSearchSina(query);
}

let suggestTimer = null, suggestActiveIdx = -1, suggestSeq = 0;

function onSearchInput() { 
    clearTimeout(suggestTimer); 
    suggestTimer = setTimeout(fetchSuggestions, 200); 
}

function closeSuggestions() { 
    const el = document.getElementById('stockSuggest'); 
    if(el) el.style.display = 'none'; 
    const inp = document.getElementById('stockSearchInput');
    if (inp) {
        inp.setAttribute?.('aria-expanded', 'false');
        inp.removeAttribute?.('aria-activedescendant');
    }
    suggestActiveIdx = -1; 
}

async function fetchSuggestions() {
    const inp = document.getElementById('stockSearchInput');
    const sug = document.getElementById('stockSuggest'); 
    if(!inp || !sug) return;
    
    const q = inp.value.trim(); 
    if(!q) { closeSuggestions(); return; }
    
    const seq = ++suggestSeq; 
    let res = searchLocalStocks(q).slice(0, 20); 
    if(!res.length) res = await jsonpSearch(q);
    
    if(seq !== suggestSeq || inp.value.trim() !== q) return;
    
    if(!res.length) { 
        sug.innerHTML = '<div class="stock-suggest-empty">无匹配结果</div>'; 
        sug.style.display = 'block'; 
        inp.setAttribute?.('aria-expanded', 'true');
        suggestActiveIdx = -1; 
        return; 
    }
    renderSuggest(sug, res.slice(0, 20));
}

async function searchAndShowInSuggest(q) {
    const inp = document.getElementById('stockSearchInput');
    const query = String(q || '').trim();
    const sug = document.getElementById('stockSuggest'); 
    if(!sug) return; 
    
    sug.innerHTML = '<div class="stock-suggest-empty">搜索中...</div>'; 
    sug.style.display = 'block';
    if (inp) inp.setAttribute?.('aria-expanded', 'true');
    
    const seq = ++suggestSeq; 
    let res = await jsonpSearch(query); 
    if(!res.length) res = searchLocalStocks(query).slice(0, 20);
    
    if(seq !== suggestSeq || (inp && inp.value.trim() !== query)) return;
    
    if(!res.length) { 
        sug.innerHTML = '<div class="stock-suggest-empty">无匹配结果</div>'; 
        if (inp) inp.setAttribute?.('aria-expanded', 'true');
        suggestActiveIdx = -1; 
        return; 
    } 
    renderSuggest(sug, res.slice(0, 20));
}

function renderSuggest(container, res) {
    container.innerHTML = res.map((x, index) => {
        const target = normalizeSecurityTarget(x);
        const isSupported = isSupportedWatchlistSecurity(x);
        if (!isSupported) {
            return `
        <div id="stockSuggestOption${index}" class="stock-suggest-item is-unsupported" role="option" aria-selected="false" onclick="showUnsupportedSecurityNotice()">
            <span class="ss-name">${escapeHTML(target.name)}</span>
            <span class="ss-meta"><span class="ss-code mono">${escapeHTML(target.code)}</span><span class="ss-support">暂不支持</span></span>
        </div>
    `;
        }
        return `
        <div id="stockSuggestOption${index}" class="stock-suggest-item" role="option" aria-selected="false" onclick="selectSuggestItem('${escapeJSArg(target.code)}','${escapeJSArg(target.name)}','${escapeJSArg(target.secid)}','${escapeJSArg(target.type)}','${escapeJSArg(target.tencentSymbol)}')">
            <span class="ss-name">${escapeHTML(target.name)}</span>
            <span class="ss-code mono">${escapeHTML(target.code)}</span>
        </div>
    `;
    }).join('');
    container.style.display = 'block';
    const inp = document.getElementById('stockSearchInput');
    if (inp) {
        inp.setAttribute?.('aria-expanded', 'true');
        inp.removeAttribute?.('aria-activedescendant');
    }
    suggestActiveIdx = -1;
}

function showUnsupportedSecurityNotice() {
    showToast('暂不支持场外基金，请添加 A 股或交易所 ETF/LOF。', 'warn', 4000);
}

function selectSuggestItem(code, name, secid = '', type = '', tencentSymbol = '') {
    closeSuggestions();
    const i = document.getElementById('stockSearchInput');
    const target = normalizeSecurityTarget({ Code: code, Name: name, QuoteID: secid, type, tencentSymbol });
    const safeCode = target.code;
    
    if(i) i.value = '';
    if(!/^\d{6}$/.test(safeCode)) return;
    if(!isSupportedWatchlistSecurity({ Code: code, QuoteID: secid, type })) {
        showUnsupportedSecurityNotice();
        return;
    }
    
    const alreadyWatched = state.watchlist.some(s => s.code === safeCode);
    if(!alreadyWatched && state.watchlist.length >= SYS_CONFIG.WATCHLIST_LIMIT) {
        customAlert(`最多只能添加 ${SYS_CONFIG.WATCHLIST_LIMIT} 只自选股。`);
        return;
    }
    
    if(!STOCK_DATABASE.some(s => s.Code === safeCode) && !stockCache.some(s => (s.Code || s.code) === safeCode)) {
        stockCache.push({ Code: target.code, Name: target.name, QuoteID: target.secid, type: target.type, tencentSymbol: target.tencentSymbol });
        dbSet('stock_cache', stockCache);
    }
    selectStock(target.code, target.name, target.secid, target.type, target.tencentSymbol);
}

function onSearchKeydown(e) {
    const inp = document.getElementById('stockSearchInput');
    const sug = document.getElementById('stockSuggest');
    const items = sug ? sug.querySelectorAll('.stock-suggest-item') : [];
    
    if(e.key === 'Escape'){ closeSuggestions(); return; }
    
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault(); 
        if (!items.length) return;
        if (e.key === 'ArrowDown') {
            suggestActiveIdx = (suggestActiveIdx + 1) % items.length; 
        } else {
            suggestActiveIdx = (suggestActiveIdx - 1 + items.length) % items.length;
        }
        
        items.forEach((item, idx) => {
            const isActive = idx === suggestActiveIdx;
            item.setAttribute('aria-selected', String(isActive));
            if (isActive) {
                item.classList.add('active'); 
                item.scrollIntoView({ block: 'nearest' }); 
                inp.setAttribute?.('aria-activedescendant', item.id);
            } else {
                item.classList.remove('active'); 
            }
        }); 
        return;
    }
    
    if(e.key === 'Enter') { 
        e.preventDefault(); 
        if (suggestActiveIdx >= 0 && items && items.length > suggestActiveIdx) { 
            items[suggestActiveIdx].click(); 
            return; 
        }
        const q = inp.value.trim(); 
        if(q) searchAndShowInSuggest(q); 
    }
}

async function loadWatchlist() { 
    try { 
        const w = await dbGet('watchlist_list'); 
        const rawWatchlist = (w && w.data) || [];
        state.watchlist = rawWatchlist.map(stock => normalizeSecurityTarget(stock));
        if (JSON.stringify(state.watchlist) !== JSON.stringify(rawWatchlist)) {
            try {
                await saveWatchlist();
            } catch(e) {}
        }
    } catch(e) { 
        state.watchlist = []; 
    } 
}

async function saveWatchlist() { 
    await dbSet('watchlist_list', state.watchlist);
    try {
        localStorage.setItem(SYS_CONFIG.WATCHLIST_SYNC_KEY, JSON.stringify({ owner: PAGE_SESSION_ID, at: Date.now() }));
    } catch(e) {}
}

let watchlistDragCode = '';

function clearWatchlistDropTargets() {
    document.querySelectorAll('#stockNavList .nav-list-item').forEach(item => {
        item.classList.remove('drag-before', 'drag-after');
    });
}

function clearWatchlistDragVisuals() {
    clearWatchlistDropTargets();
    document.querySelectorAll('#stockNavList .nav-list-item.is-dragging').forEach(item => {
        item.classList.remove('is-dragging');
    });
}

function startWatchlistDrag(event, code) {
    const stock = (state.watchlist || []).find(item => item.code === code);
    if (!stock || stock._pendingRemove) {
        event.preventDefault();
        return;
    }
    watchlistDragCode = code;
    clearWatchlistDragVisuals();
    const row = event.currentTarget?.closest?.('.nav-list-item');
    row?.classList?.add('is-dragging');
    if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', code);
        if (row && typeof event.dataTransfer.setDragImage === 'function') {
            event.dataTransfer.setDragImage(row, 18, Math.max(12, row.offsetHeight / 2));
        }
    }
    event.stopPropagation();
}

function updateWatchlistDragTarget(event, targetCode) {
    if (!watchlistDragCode || watchlistDragCode === targetCode) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    clearWatchlistDropTargets();
    const row = event.currentTarget;
    const rect = row.getBoundingClientRect();
    row.classList.add(event.clientY > rect.top + rect.height / 2 ? 'drag-after' : 'drag-before');
}

async function applyWatchlistOrder(nextWatchlist) {
    const previousWatchlist = state.watchlist;
    state.watchlist = nextWatchlist;
    renderWatchlist();
    try {
        await saveWatchlist();
    } catch(e) {
        state.watchlist = previousWatchlist;
        renderWatchlist();
        showToast('排序保存失败，请重试。', 'error');
    }
}

async function moveWatchlistItem(sourceCode, targetCode, insertAfter = false) {
    if (!sourceCode || sourceCode === targetCode) return false;
    const nextWatchlist = (state.watchlist || []).slice();
    const sourceIndex = nextWatchlist.findIndex(item => item.code === sourceCode);
    const originalTargetIndex = nextWatchlist.findIndex(item => item.code === targetCode);
    if (sourceIndex < 0 || originalTargetIndex < 0) return false;
    const [moved] = nextWatchlist.splice(sourceIndex, 1);
    let targetIndex = nextWatchlist.findIndex(item => item.code === targetCode);
    if (insertAfter) targetIndex += 1;
    nextWatchlist.splice(targetIndex, 0, moved);
    await applyWatchlistOrder(nextWatchlist);
    return true;
}

async function dropWatchlistItem(event, targetCode) {
    event.preventDefault();
    event.stopPropagation();
    const sourceCode = watchlistDragCode || event.dataTransfer?.getData('text/plain') || '';
    const row = event.currentTarget;
    const rect = row.getBoundingClientRect();
    const insertAfter = event.clientY > rect.top + rect.height / 2;
    watchlistDragCode = '';
    clearWatchlistDragVisuals();
    await moveWatchlistItem(sourceCode, targetCode, insertAfter);
}

function finishWatchlistDrag() {
    watchlistDragCode = '';
    clearWatchlistDragVisuals();
}

async function handleWatchlistDragKeydown(event, code) {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    event.stopPropagation();
    const sourceIndex = (state.watchlist || []).findIndex(item => item.code === code);
    const offset = event.key === 'ArrowUp' ? -1 : 1;
    const target = state.watchlist[sourceIndex + offset];
    if (!target) return;
    await moveWatchlistItem(code, target.code, offset > 0);
    document.querySelector(`#stockNavList .wl-drag-handle[data-code="${code}"]`)?.focus?.();
}

function handleWatchlistSelectKeydown(event) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget?.click?.();
}

function getSupportedWatchlistTargets() {
    return (state.watchlist || [])
        .map(stock => normalizeSecurityTarget(stock))
        .filter(target => isSupportedWatchlistSecurity(target));
}

function getSupportedWatchlistFallback(startIndex = 0) {
    const list = state.watchlist || [];
    const supportedAtOrAfter = list.slice(startIndex).find(stock => isSupportedWatchlistSecurity(normalizeSecurityTarget(stock)));
    if (supportedAtOrAfter) return normalizeSecurityTarget(supportedAtOrAfter);
    const supportedBefore = list.slice(0, startIndex).reverse().find(stock => isSupportedWatchlistSecurity(normalizeSecurityTarget(stock)));
    return supportedBefore ? normalizeSecurityTarget(supportedBefore) : null;
}

let watchlistCrossPageSyncStarted = false;
function initWatchlistCrossPageSync() {
    if (watchlistCrossPageSyncStarted || typeof window.addEventListener !== 'function') return;
    watchlistCrossPageSyncStarted = true;
    window.addEventListener('storage', async event => {
        if (event.key !== SYS_CONFIG.WATCHLIST_SYNC_KEY || !event.newValue) return;
        try {
            const payload = JSON.parse(event.newValue);
            if (payload?.owner === PAGE_SESSION_ID) return;
        } catch(e) {}
        await loadWatchlist();
        renderWatchlist();
        if (state.mode !== 'stock' || !state.stockId) return;
        const activeStock = state.watchlist.find(stock => stock.code === state.stockId);
        if (activeStock && isSupportedWatchlistSecurity(normalizeSecurityTarget(activeStock))) return;
        const next = getSupportedWatchlistFallback();
        if (next) {
            selectStock(next.code, next.name, next.secid, next.type, next.tencentSymbol);
        } else {
            showEmptyWatchlistView();
        }
    });
}

const WATCHLIST_STATUS_META = {
    candidate: { label: '入场' },
    hold: { label: '持仓' },
    observe: { label: '观察' },
    defend: { label: '防守' },
    pending: { label: '同步' }
};

let watchlistRenderRAF = 0;
let watchlistRenderShouldMarkRefresh = false;
let watchlistRenderRefreshTxn = null;
let watchlistSnapshotFlushHandle = 0;
const watchlistSnapshotQueue = new Map();

function getWatchlistNoviceActionText(decision) {
    if (!decision) return '';
    const action = decision.simpleAction || '';
    const position = decision.position ?? 0;
    const exitLevel = decision.exit?.level || '无明确离场';
    const riskFlags = decision.risk?.flags || [];
    const hasCriticalExit = ['清仓防守', '强离场'].includes(exitLevel) || ['清仓离场', '执行离场', '规避风险'].includes(action);
    const scoreReady = !!decision.signalReady || ['积极建仓', '顺势加仓', '积极持有', '顺势抱单'].includes(action);

    if (hasCriticalExit || (position === 0 && action === '规避风险')) {
        return position === 0 ? '空仓观望' : '优先防守';
    }
    if (position === 0) return '先不碰';
    if (position <= 30) return action.includes('减仓') ? '降低仓位' : '只适合轻仓';
    if (scoreReady && position >= 50) return position >= 80 ? '可积极关注' : '可继续观察';
    if (riskFlags.length || action === '谨慎持有') return '继续持有';
    return action.includes('加仓') ? '顺势持有' : '继续持有';
}

function buildWatchlistStatus(meta, decision, toneClass) {
    const rawAction = decision?.simpleAction || '';
    const noviceAction = getWatchlistNoviceActionText(decision);
    const actionText = noviceAction ? `策略：${noviceAction}` : (rawAction || meta.label);
    const detail = rawAction
        ? `来源：右侧每日结论同一策略结果；原始策略动作：${rawAction}。`
        : '来源：右侧每日结论同一策略结果。';
    return { ...meta, action: actionText, rawAction, toneClass, detail };
}

function resolveWatchlistStatus(decision) {
    if (!decision) return { ...WATCHLIST_STATUS_META.pending, action: '信号待同步', toneClass: 'tone-dim' };

    const action = decision.simpleAction || '';
    const toneClass = decision.simpleColorClass ? decision.simpleColorClass.replace('text-', 'tone-') : 'tone-dim';
    if (['轻仓建仓', '积极建仓', '缓慢加仓', '顺势加仓'].includes(action)) {
        return buildWatchlistStatus(WATCHLIST_STATUS_META.candidate, decision, toneClass);
    }
    if (['轻仓持有', '积极持有', '顺势抱单'].includes(action)) {
        return buildWatchlistStatus(WATCHLIST_STATUS_META.hold, decision, toneClass);
    }
    if (['防守减仓', '执行离场', '清仓离场', '规避风险'].includes(action)) {
        return buildWatchlistStatus(WATCHLIST_STATUS_META.defend, decision, toneClass);
    }
    if (['持币观望', '谨慎持有'].includes(action)) {
        return buildWatchlistStatus(WATCHLIST_STATUS_META.observe, decision, toneClass);
    }
    return buildWatchlistStatus(WATCHLIST_STATUS_META.observe, decision, toneClass);
}

function buildWatchlistPositionChange(full) {
    if (!Array.isArray(full) || full.length < 2) return null;

    const currentRow = full[full.length - 1];
    const previousRow = full[full.length - 2];
    if (!hasCurrentWatchlistDecision(currentRow) || !hasCurrentWatchlistDecision(previousRow)) return null;

    const currentPosition = Number(currentRow._decision.position);
    const previousPosition = Number(previousRow._decision.position);
    const positionChanged = Number.isFinite(currentPosition) &&
        Number.isFinite(previousPosition) &&
        currentPosition !== previousPosition;

    return positionChanged ? `${previousPosition}%→${currentPosition}%` : null;
}

function hasWatchlistPositionChangeContext(full) {
    if (!Array.isArray(full) || full.length < 2) return true;
    return hasCurrentWatchlistDecision(full[full.length - 1]) && hasCurrentWatchlistDecision(full[full.length - 2]);
}

function setWatchlistStatusSnapshot(code, status) {
    const item = state.watchlist.find(stock => stock.code === code);
    if (item) item._navStatus = status || null;
}

function scheduleWatchlistRender(options = {}) {
    if (options.markRefresh) {
        watchlistRenderShouldMarkRefresh = true;
        watchlistRenderRefreshTxn = options.refreshTxn || beginRefreshTransaction('leftList', { source: 'watchlist-render' });
    }
    if (watchlistRenderRAF) return;
    watchlistRenderRAF = requestAnimationFrame(() => {
        watchlistRenderRAF = 0;
        const shouldMarkRefresh = watchlistRenderShouldMarkRefresh;
        const refreshTxn = watchlistRenderRefreshTxn;
        watchlistRenderShouldMarkRefresh = false;
        watchlistRenderRefreshTxn = null;
        if (state.mode === 'stock') {
            renderWatchlist();
            if (shouldMarkRefresh) markLeftListRefreshForActiveTab(refreshTxn, { area: 'stock-list' });
        }
    });
}

function applyWatchlistDecisionSnapshot(code, decision, date, full = null) {
    const status = resolveWatchlistStatus(decision);
    const positionChange = buildWatchlistPositionChange(full);
    setWatchlistStatusSnapshot(code, { ...status, positionChange, strategy: state.strategy, date: date || '' });
}

function primeWatchlistStatusSnapshot(code, date) {
    const item = state.watchlist.find(stock => stock.code === code);
    if (!item) return;
    if (item._navStatus && item._navStatus.strategy === state.strategy) {
        const nextDate = date || item._navStatus.date || '';
        const dateChanged = !!(item._navStatus.date && nextDate && item._navStatus.date !== nextDate);
        item._navStatus = { ...item._navStatus, positionChange: dateChanged ? null : item._navStatus.positionChange, date: nextDate };
        return;
    }
    setWatchlistStatusSnapshot(code, { ...WATCHLIST_STATUS_META.pending, action: '信号同步中', toneClass: 'tone-dim', strategy: state.strategy, date: date || '' });
}

function hasCurrentWatchlistDecision(row) {
    return !!(row?._decision && row._strategy === state.strategy && row._signalVersion === SIGNAL_VERSION);
}

function getLatestDecisionFromData(full) {
    const last = full?.[full.length - 1];
    if (hasCurrentWatchlistDecision(last)) {
        return last._decision;
    }
    return null;
}

function computeWatchlistDecisionSnapshot(full, code) {
    if (!full || full.length < 60) return null;

    const cachedDecision = getLatestDecisionFromData(full);
    if (cachedDecision && hasWatchlistPositionChangeContext(full)) return cachedDecision;

    const localIndicators = { ma: {}, macd: null, rsi: null, kdj: null };
    MA_OPTIONS.forEach(n => localIndicators.ma[n] = Calcs.ma(full, n));
    localIndicators.macd = Calcs.macd(full);
    localIndicators.rsi = Calcs.rsi(full);
    localIndicators.kdj = Calcs.kdj(full);

    const prevMode = state.mode;
    const prevPeriod = state.period;
    const prevIndicators = state.indicators;
    let prevPos = 0;

    try {
        state.mode = 'stock';
        state.period = 'daily';
        state.indicators = localIndicators;

        const tailStartIdx = Math.max(0, full.length - 80);
        const priorDecision = tailStartIdx > 0 ? full[tailStartIdx - 1]?._decision : null;
        const canUseTailRebuild = priorDecision && full[tailStartIdx - 1]?._strategy === state.strategy && full[tailStartIdx - 1]?._signalVersion === SIGNAL_VERSION;
        const startIdx = canUseTailRebuild ? tailStartIdx : 0;
        const weeklySignalContexts = buildWeeklySignalContexts(full);
        prevPos = canUseTailRebuild ? (priorDecision.position || 0) : 0;
        for (let i = startIdx; i < full.length; i++) {
            if (!full[i]) continue;
            full[i]._signals = calculateDailySignals(i, full, localIndicators, null, weeklySignalContexts[i]);
            full[i]._signalVersion = SIGNAL_VERSION;
            full[i]._strategy = state.strategy;
            full[i]._decision = computeDecisionForIndex(i, full, prevPos);
            prevPos = full[i]._decision.position;
        }
        if (code && typeof storeDerivedIndicatorCache === 'function') {
            const matched = (state.watchlist || []).find(stock => stock.code === code);
            const cacheId = matched ? normalizeSecurityTarget(matched).secid : codeToSecid(code);
            storeDerivedIndicatorCache(cacheId, 'daily', state.strategy, full, localIndicators);
        }
        return full[full.length - 1]?._decision || null;
    } finally {
        state.mode = prevMode;
        state.period = prevPeriod;
        state.indicators = prevIndicators;
    }
}

function flushWatchlistSnapshotQueue(deadline) {
    watchlistSnapshotFlushHandle = 0;
    let processed = 0;
    const canContinue = () => !deadline || deadline.didTimeout || deadline.timeRemaining() > 6 || processed === 0;
    while (watchlistSnapshotQueue.size && canContinue()) {
        const [code, full] = watchlistSnapshotQueue.entries().next().value;
        watchlistSnapshotQueue.delete(code);
        syncWatchlistSignalSnapshot(code, full);
        processed++;
    }
    if (watchlistSnapshotQueue.size) scheduleWatchlistSnapshotQueue();
    scheduleWatchlistRender();
}

function scheduleWatchlistSnapshotQueue() {
    if (watchlistSnapshotFlushHandle) return;
    if (typeof window.requestIdleCallback === 'function') {
        watchlistSnapshotFlushHandle = window.requestIdleCallback(flushWatchlistSnapshotQueue, { timeout: 240 });
        return;
    }
    watchlistSnapshotFlushHandle = window.setTimeout(() => flushWatchlistSnapshotQueue(), 48);
}

function queueWatchlistSignalSnapshot(code, full) {
    if (!code || !full?.length) return;
    primeWatchlistStatusSnapshot(code, full[full.length - 1]?.date || '');
    watchlistSnapshotQueue.set(code, full);
    scheduleWatchlistSnapshotQueue();
}

function syncWatchlistSignalSnapshotFast(code, full) {
    const last = full?.[full.length - 1];
    if (!last) {
        setWatchlistStatusSnapshot(code, { ...WATCHLIST_STATUS_META.pending, action: '暂无数据', strategy: state.strategy, date: '' });
        return;
    }
    const decision = getLatestDecisionFromData(full);
    if (decision) {
        applyWatchlistDecisionSnapshot(code, decision, last.date, full);
        if (hasWatchlistPositionChangeContext(full)) return;
    }
    queueWatchlistSignalSnapshot(code, full);
}

function syncWatchlistSignalSnapshot(code, full) {
    const last = full?.[full.length - 1];
    if (!last) {
        setWatchlistStatusSnapshot(code, { ...WATCHLIST_STATUS_META.pending, action: '暂无数据', strategy: state.strategy, date: '' });
        return;
    }

    const decision = computeWatchlistDecisionSnapshot(full, code);
    applyWatchlistDecisionSnapshot(code, decision, last.date, full);
}

function refreshWatchlistSignalSnapshots() {
    getSupportedWatchlistTargets().forEach(target => {
        const full = state.rawData[target.secid];
        syncWatchlistSignalSnapshotFast(target.code, full);
    });
    scheduleWatchlistRender();
}

function resolveWatchlistRowStatus(stock, statusData, lastDate) {
    if (stock._navStatus && stock._navStatus.strategy === state.strategy && stock._navStatus.date === lastDate) {
        return stock._navStatus;
    }
    syncWatchlistSignalSnapshotFast(stock.code, statusData);
    if (stock._navStatus && stock._navStatus.strategy === state.strategy && stock._navStatus.date === lastDate) {
        return stock._navStatus;
    }
    const fallback = resolveWatchlistStatus(getLatestDecisionFromData(statusData));
    const status = { ...fallback, positionChange: buildWatchlistPositionChange(statusData), strategy: state.strategy, date: lastDate };
    setWatchlistStatusSnapshot(stock.code, status);
    return status;
}

async function addToWatchlist(code, name, meta = {}) {
    const target = normalizeSecurityTarget({ ...meta, Code: code, Name: name });
    if (!isSupportedWatchlistSecurity({ ...meta, Code: code })) {
        showUnsupportedSecurityNotice();
        return false;
    }
    const displayName = target.name;
    const existing = state.watchlist.find(s => s.code === target.code);
    if (existing) {
        const next = { ...existing, ...target, name: displayName };
        if (JSON.stringify(existing) !== JSON.stringify(next)) {
            Object.assign(existing, next);
            await saveWatchlist();
            renderWatchlist();
        }
        return true;
    }
    if(state.watchlist.length >= SYS_CONFIG.WATCHLIST_LIMIT) {
        await customAlert(`最多只能添加 ${SYS_CONFIG.WATCHLIST_LIMIT} 只自选股。`);
        return false;
    }
    state.watchlist.push(target);
    await saveWatchlist();
    renderWatchlist(); 
    return true;
}

function focusWatchlistSearch() {
    const input = document.getElementById('stockSearchInput');
    if (!input) return;
    input.focus();
    if (typeof input.select === 'function') input.select();
}

function setWatchlistEmptyState(isEmpty) {
    const active = !!isEmpty;
    const chartSection = document.querySelector('.chart-section');
    const chartEmpty = document.getElementById('watchlistEmptyState');
    const infoEmpty = document.getElementById('watchlistInfoEmptyState');
    const refreshBar = document.getElementById('lastRefreshBar');
    const backtestBtn = document.getElementById('btnBacktest');

    if (chartSection) chartSection.classList.toggle('watchlist-empty-mode', active);
    if (chartEmpty) chartEmpty.hidden = !active;
    if (infoEmpty) infoEmpty.hidden = !active;
    document.querySelectorAll('.chart-toolbar button, .chart-toolbar input').forEach(control => {
        control.disabled = active;
    });

    if (active) {
        document.querySelectorAll('.empty-hint').forEach(el => el.remove());
        if (refreshBar) refreshBar.style.display = 'none';
        if (backtestBtn) backtestBtn.style.display = 'none';
        applySidebarHTML({ priceHtml: '', analysisHtml: '', isHide: true });
    } else if (backtestBtn && state.mode === 'stock' && state.stockId) {
        backtestBtn.style.display = 'flex';
    }
}

function showEmptyWatchlistView() {
    globalSelectionSeq++;
    applyActiveSelectionState({ tab: 'stock', mode: 'stock', id: null, stockId: null });
    resetViewportToLatest(null);
    clearCharts();
    setWatchlistEmptyState(true);
    hideLoading();
}

async function removeStock(code) { 
    var stock = state.watchlist.find(function(s) { return s.code === code; });
    if (!stock) return;
    if (stock._pendingRemove) return;
    
    const removedIndex = state.watchlist.indexOf(stock);
    stock._pendingRemove = true;
    renderWatchlist();
    const displayName = normalizeStockDisplayName(code, stock.name);
    
    showToastWithAction(
        '\u5df2\u79fb\u9664 ' + displayName,
        '\u64a4\u9500',
        function() { stock._pendingRemove = false; renderWatchlist(); },
        'info', 3000
    );
    
    setTimeout(async function() {
        if (!stock._pendingRemove) return;
        state.watchlist = state.watchlist.filter(s => s.code !== code); 
        await saveWatchlist(); 
        renderWatchlist();
        
        if(state.stockId === code) {
            const nextTarget = getSupportedWatchlistFallback(Math.min(removedIndex, state.watchlist.length));
            if (nextTarget) {
                selectStock(nextTarget.code, nextTarget.name, nextTarget.secid, nextTarget.type, nextTarget.tencentSymbol);
            } else {
                showEmptyWatchlistView();
            }
        } else if (!state.watchlist.length && state.tab === 'stock') {
            showEmptyWatchlistView();
        }
    }, 3000);
}

let watchlistUpdateTimer = null;
let sidebarFullSyncTimer = 0;

function debounceWatchlistUpdate() {
    if (watchlistUpdateTimer) clearTimeout(watchlistUpdateTimer);
    watchlistUpdateTimer = setTimeout(async () => {
        await updateAllWatchlistData({ renderNow: true });
    }, 2000);
}

async function updateAllWatchlistData(options = {}) {
    if (!state.watchlist || !state.watchlist.length) return [];
    const stocks = getSupportedWatchlistTargets().filter(stock => stock.secid !== state.id);
    const results = await pLimit(stocks, SYS_CONFIG.SIDEBAR_SYNC_CONCURRENCY, async (stock) => {
        const secid = stock.secid;
        try {
            const data = await syncData(secid);
            if (data && data.length >= 30 && isValidPrice(data[data.length - 1].close, secid)) {
                setRawData(secid, data);
                await dbSet(secid, data);
                syncWatchlistSignalSnapshotFast(stock.code, data);
                return { code: stock.code, success: true };
            } else {
                setWatchlistStatusSnapshot(stock.code, { ...WATCHLIST_STATUS_META.pending, action: '数据不足', strategy: state.strategy, date: data?.[data.length - 1]?.date || '' });
                return { code: stock.code, success: false, reason: '数据不足' };
            }
        } catch (e) {
            const cached = await dbGet(secid);
            const cachedData = normalizeConfirmedHistoryData(cached?.data, secid);
            if (cachedData && cachedData.length >= 30) {
                setRawData(secid, cachedData);
                syncWatchlistSignalSnapshotFast(stock.code, cachedData);
                return { code: stock.code, success: true, source: 'cache' };
            } else {
                setWatchlistStatusSnapshot(stock.code, { ...WATCHLIST_STATUS_META.pending, action: '同步失败', strategy: state.strategy, date: '' });
                return { code: stock.code, success: false, reason: e.message };
            }
        }
    });
    const shouldMarkRefresh = results.some(r => r.success);
    const refreshTxn = shouldMarkRefresh
        ? beginRefreshTransaction('leftList', { source: 'watchlist-data', successCount: results.filter(r => r.success).length })
        : null;
    if (options.renderNow) {
        renderWatchlist();
        if (shouldMarkRefresh) markLeftListRefreshForActiveTab(refreshTxn, { area: 'stock-list' });
    } else {
        scheduleWatchlistRender({ markRefresh: shouldMarkRefresh, refreshTxn });
    }
    return results;
}

let _sidebarRefreshFailCount = 0;
async function refreshSidebarRealtime() {
    if (typeof canRequestMarketData === 'function' && !canRequestMarketData()) return;
    let ids = [];
    if (state.tab === 'index' || state.mode === 'index') {
        ids = [...INDEX_IDS];
    } else if (state.tab === 'stock' || state.mode === 'stock') {
        ids = getSupportedWatchlistTargets().map(stock => stock.secid);
        const activeTarget = getActiveSecurityTarget();
        if (state.id && activeTarget && isSupportedWatchlistSecurity(activeTarget)) ids.push(state.id);
    }
    ids = Array.from(new Set(ids));
    if (!ids.length) return;
    const prices = await batchGetRealtimePrices(ids);
    if (!Object.keys(prices).length) {
        _sidebarRefreshFailCount++;
        if (_sidebarRefreshFailCount >= 2) {
            showToast('\u884c\u60c5\u8fde\u63a5\u5f02\u5e38\uff0c\u4fa7\u8fb9\u680f\u4ef7\u683c\u53ef\u80fd\u5ef6\u8fdf', 'warn', 4000);
        }
        return;
    }
    _sidebarRefreshFailCount = 0;
    const batchFetchedAt = Date.now();
    Object.keys(prices).forEach(id => {
        const limiter = requestManager.limiters.get(id) || { lastCall: 0, isFetching: false };
        requestManager.limiters.set(id, { ...limiter, lastCall: batchFetchedAt, isFetching: false });
    });
    let changed = false;
    let activeOverlayChanged = false;
    for (const [id, rtBar] of Object.entries(prices)) {
        const series = state.rawData[id];
        if (!series || !series.length) continue;
        const lastBar = series[series.length - 1];
        if (!lastBar || !isValidPrice(rtBar.close, id)) continue;
        if (rtBar.date < lastBar.date) continue;
        const applyResult = applyRealtimeQuoteForSeries(id, series, rtBar);
        if (id === state.id && (applyResult === 'overlay' || applyResult === 'cached-overlay')) activeOverlayChanged = true;
        changed = true;
    }
    if (changed) {
        const leftTxn = beginRefreshTransaction('leftList', { source: 'realtime-batch', count: Object.keys(prices).length });
        if (state.tab === 'index' || state.mode === 'index') refreshIndexListQuotes();
        if (state.tab === 'stock' || state.mode === 'stock') refreshWatchlistQuotes();
        markLeftListRefreshForActiveTab(leftTxn, { area: state.tab === 'stock' || state.mode === 'stock' ? 'stock-list' : 'index-list' });
        if (activeOverlayChanged && !state.isFrozen) {
            const rightTxn = beginRefreshTransaction('rightPanel', { source: 'realtime-batch', id: state.id });
            applyActiveDataRefresh(state.id);
            markRefreshTime(rightTxn, { path: 'active-overlay' });
        }
    }
}

function startSidebarFullSync() {
    if (sidebarFullSyncTimer) return;
    sidebarFullSyncTimer = setInterval(async () => {
        if (document.hidden) return;
        if (!isMarketOpen()) return;
        if (typeof canRequestMarketData === 'function' && !canRequestMarketData()) return;
        if (state.tab === 'index' || state.mode === 'index') {
            const ids = INDEX_IDS.filter(id => id !== state.id);
            let failCnt = 0;
            await pLimit(ids, SYS_CONFIG.SIDEBAR_SYNC_CONCURRENCY, async (id) => {
                try {
                    const data = await syncData(id);
                    if (data && data.length >= 30) { setRawData(id, data); await dbSet(id, data); }
                } catch(e) { failCnt++; }
            });
            if (failCnt >= 2) showToast('\u90e8\u5206\u6307\u6570\u5386\u53f2\u6570\u636e\u540c\u6b65\u5931\u8d25', 'warn', 4000);
            const leftTxn = failCnt < ids.length ? beginRefreshTransaction('leftList', { source: 'sidebar-full-sync', area: 'index-list' }) : null;
            renderIndexList();
            if (leftTxn) markLeftListRefreshForActiveTab(leftTxn, { area: 'index-list' });
        } else if (state.tab === 'stock' || state.mode === 'stock') {
            if (!state.watchlist || !state.watchlist.length) return;
            const results = await updateAllWatchlistData();
            const failCount = results ? results.filter(r => !r.success).length : 0;
            if (failCount >= 2) showToast('\u90e8\u5206\u81ea\u9009\u80a1\u6570\u636e\u540c\u6b65\u5931\u8d25', 'warn', 4000);
        }
    }, 90000);
}

// P0-3: 切换标的防抖 — 快速连点只执行最后一次，避免浪费网络请求
let _selectDebounceTimer = 0;
function selectIndex(id) {
    clearTimeout(_selectDebounceTimer);
    _selectDebounceTimer = setTimeout(() => _selectIndexImpl(id), 120);
}

async function _selectIndexImpl(id) {
    const perfTrace = PERF.start('selectIndex', { id });
    if (!getIndexConfig(id)) return;
    const selectionSeq = ++globalSelectionSeq;
    const config = getIndexConfig(id);

    applyActiveSelectionState({ tab: 'index', mode: 'index', id, stockId: null });
    setWatchlistEmptyState(false);
    resetViewportToLatest(null);

    document.querySelectorAll('#mainTabs .nav-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === 'index'));
    document.getElementById('indexNavList').style.display = 'flex';
    document.getElementById('stockNavList').style.display = 'none';
    document.getElementById('btnBacktest').style.display = 'none';

    resetIndicatorState();
    // P0-1: showLoading 提前到 clearCharts 之前，避免图表区一帧空白闪烁
    showLoading(`加载 ${config.name} 数据...`);
    renderIndexList();
    renderActiveSelectionStatus('loading');
    clearCharts();
    renderCache.clear();

    try {
        await cachedFetch(id);
        PERF.mark(perfTrace, 'cachedFetch');
        if (selectionSeq !== globalSelectionSeq || state.id !== id) return;
        renderIndexList();
        PERF.mark(perfTrace, 'renderIndexList');
    } finally {
        if (selectionSeq === globalSelectionSeq) hideLoading();
        PERF.end(perfTrace, { selected: state.id, selectionSeq });
    }
}

function selectStock(code, name, secid = '', type = '', tencentSymbol = '') {
    clearTimeout(_selectDebounceTimer);
    _selectDebounceTimer = setTimeout(() => _selectStockImpl(code, name, secid, type, tencentSymbol), 120);
}

async function _selectStockImpl(code, name, secid = '', type = '', tencentSymbol = '') {
    const target = normalizeSecurityTarget({ Code: code, Name: name, QuoteID: secid, type, tencentSymbol });
    const safeCode = target.code;
    const safeName = target.name;
    if (!/^\d{6}$/.test(safeCode)) return;
    if (!isSupportedWatchlistSecurity({ Code: code, QuoteID: secid, type })) {
        showUnsupportedSecurityNotice();
        return;
    }
    const perfTrace = PERF.start('selectStock', { code });

    const selectionSeq = ++globalSelectionSeq;
    const targetSecid = target.secid;
    await addToWatchlist(safeCode, safeName, target);
    if (selectionSeq !== globalSelectionSeq) return;

    applyActiveSelectionState({ tab: 'stock', mode: 'stock', id: targetSecid, stockId: safeCode });
    setWatchlistEmptyState(false);
    resetViewportToLatest(null);

    document.querySelectorAll('#mainTabs .nav-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === 'stock'));
    document.getElementById('indexNavList').style.display = 'none';
    document.getElementById('stockNavList').style.display = 'flex';
    document.getElementById('btnBacktest').style.display = 'flex';

    resetIndicatorState();
    // P0-1: showLoading 提前到 clearCharts 之前，避免图表区一帧空白闪烁
    showLoading(`加载 ${safeName} 数据...`);
    renderWatchlist();
    clearCharts();
    renderCache.clear();

    try {
        await cachedFetch(targetSecid);
        PERF.mark(perfTrace, 'cachedFetch');
        if (selectionSeq !== globalSelectionSeq || state.id !== targetSecid || state.stockId !== safeCode) return;
        const data = getActiveData();
        if (!(data && data.length >= 30 && isValidPrice(data[data.length - 1].close, targetSecid))) {
            setRawData(targetSecid, null);
            clearCharts('error');
            const cPrice = document.getElementById('cardPrice');
            const cAnalysis = document.getElementById('cardAnalysis');
            if (cPrice) {
                cPrice.style.display = 'flex';
                cPrice.innerHTML = '<div class="stock-empty">该股票数据暂时加载失败，请稍后重试或更换标的。</div>';
            }
            if (cAnalysis) cAnalysis.style.display = 'none';
        }
        PERF.mark(perfTrace, 'post-check', { points: data?.length || 0 });
    } catch(e) {
        if (selectionSeq !== globalSelectionSeq || state.id !== targetSecid || state.stockId !== safeCode) return;
        setRawData(targetSecid, null);
        clearCharts('error');
        const cPrice = document.getElementById('cardPrice');
        const cAnalysis = document.getElementById('cardAnalysis');
        if (cPrice) {
            cPrice.style.display = 'flex';
            cPrice.innerHTML = '<div class="stock-empty">该股票数据暂时加载失败，请稍后重试或更换标的。</div>';
        }
        if (cAnalysis) cAnalysis.style.display = 'none';
    } finally {
        if (selectionSeq === globalSelectionSeq) {
            hideLoading();
            renderWatchlist();
            debounceWatchlistUpdate();
        }
        PERF.end(perfTrace, { selected: state.stockId, selectionSeq });
    }
}

function updateLeftMarketContext(date) {
    const container = document.getElementById('leftMarketContext');
    if(!container) return;

    const market = getMarketContext(date);
    const panelClass = market.cls === 'bull' ? 'panel-bull' : (market.cls === 'bear' ? 'panel-bear' : 'panel-info');
    const textClass = market.cls === 'bull' ? 'text-bull' : (market.cls === 'bear' ? 'text-bear' : 'text-main');
    const gateText = market.increaseCaps
        ? (market.increaseCaps.ordinary <= 0 ? '关闭' : `${market.increaseCaps.ordinary}% / ${market.increaseCaps.independent}%`)
        : '开放';

    const detailHtml = market.trends.map(t => `
        <div class="market-core-state">
            <span class="n">${t.name}</span>
            <span class="s ${t.score>0?'text-bull':t.score<0?'text-bear':'text-main'}">${t.state}</span>
        </div>
    `).join('');

    container.innerHTML = `
        <div class="stock-header market-gate-header">
            <div class="title-wrap"><span>核心建仓门禁</span></div>
        </div>
        <div class="action-panel market-gate-panel ${panelClass}">
            <div class="action-line">
                <div class="action-name ${textClass}">${escapeHTML(market.label)}</div>
                <div class="action-cap">
                    <span>门禁状态</span>
                    <strong class="text-main mono">${escapeHTML(gateText)}</strong>
                </div>
            </div>
            <div class="action-sub text-dim">
                ${escapeHTML(market.reason)}
            </div>
            <div class="market-core-grid">${detailHtml}</div>
        </div>
    `;
}

function markLeftListRefreshForActiveTab(txn = null, patch = {}) {
    if (typeof markLeftListRefreshTime === 'function' && (state.tab === 'index' || state.tab === 'stock' || state.mode === 'index' || state.mode === 'stock')) {
        const refreshTxn = txn && typeof txn === 'object' ? txn : beginRefreshTransaction('leftList', { source: 'left-list' });
        markLeftListRefreshTime(refreshTxn, patch);
    }
}

function renderActiveLeftListAfterDataApply(txn = null, patch = {}) {
    const refreshTxn = txn && typeof txn === 'object' ? txn : beginRefreshTransaction('leftList', { source: 'active-data' });
    if (state.mode === 'index') {
        renderIndexList();
        markLeftListRefreshForActiveTab(refreshTxn, { area: 'index-list', ...patch });
    } else if (state.mode === 'stock' && typeof scheduleWatchlistRender === 'function') {
        scheduleWatchlistRender({ markRefresh: true, refreshTxn });
    }
}

function renderIndexList() {
    const container = document.getElementById('indexNavList'); 
    if(!container) return;
    
    const html = INDEX_IDS.map(id => {
        const config = INDEX_CONFIG[id];
        const active = state.id === id && state.mode === 'index' ? 'active' : '';
        const roleText = CORE_MARKET_INDEX_IDS.includes(id) ? '门禁核心' : '仅观察';
        const roleClass = CORE_MARKET_INDEX_IDS.includes(id) ? 'core' : 'observe';
        const indexCode = (config.tencent || id).toUpperCase();
        const quoteDisplay = getLeftQuoteDisplay(id);
        
        const priceHtml = `<span class="lprice mono ${quoteDisplay.cl}" data-code="${id}">${quoteDisplay.priceText}</span><span class="lchange mono ${quoteDisplay.cl}" data-code="${id}">${quoteDisplay.changeText}</span>`;
            
        return `
            <button type="button" class="nav-list-item ${active}" onclick="selectIndex('${id}')">
                <div class="nav-list-main">
                    <div class="lname-wrap">
                        <span class="lname">${config.name}</span>
                        <span class="index-role ${roleClass}">${roleText}</span>
                    </div>
                </div>
                <div class="nav-list-sub">
                    <span class="lcode mono">${escapeHTML(indexCode)}</span>
                    <div class="lquote">${priceHtml}</div>
                </div>
            </button>
        `;
    }).join('');
    
    container.innerHTML = `
        <div class="index-list-sticky-head">${renderLeftListHeader('市场与板块指数')}</div>
        <div class="index-list-items">
            <div>${html}</div>
            <div id="leftMarketContext"></div>
        </div>
    `;
    
    const rd = getActiveData();
    if (rd && rd.length > 0) {
        const safeIdx = getSafeIndex(rd);
        if (safeIdx >= 0 && safeIdx < rd.length) updateLeftMarketContext(rd[safeIdx].date);
    } else {
        updateLeftMarketContext(getBJDate().toISOString().split('T')[0]);
    }
}

function getLeftQuoteDisplay(id) {
    const quoteId = id && typeof id === 'object' ? resolveSecuritySecid(id) : id;
    const d = getVisibleQuoteData(quoteId);
    const price = d?.length ? Number(d[d.length - 1].close) : 0;
    const prev = Number(getVisibleQuoteChangeBase(quoteId, d));
    const hasPrice = Number.isFinite(price) && price > 0;
    const hasPrev = Number.isFinite(prev) && prev > 0;
    const change = hasPrice && hasPrev ? price - prev : 0;
    const pct = hasPrice && hasPrev ? change / prev * 100 : null;
    const cl = !hasPrice || !hasPrev || change === 0 ? 'flat' : (change > 0 ? 'up' : 'down');
    const precision = getSecurityPricePrecision(id);
    return {
        priceText: hasPrice ? price.toFixed(precision) : '--',
        changeText: pct == null ? '--' : `${change > 0 ? '+' : ''}${pct.toFixed(2)}%`,
        cl
    };
}

function renderWatchlist() {
    const container = document.getElementById('stockNavList'); 
    if(!container) return;
    
    const sHtml = `
        <div class="stock-search">
            <input id="stockSearchInput" placeholder="输入股票代码或名称" autocomplete="off" role="combobox" aria-autocomplete="list" aria-controls="stockSuggest" aria-expanded="false" oninput="onSearchInput()" onkeydown="onSearchKeydown(event)">
            <div class="stock-suggest" id="stockSuggest" role="listbox" aria-label="股票搜索建议"></div>
        </div>
    `;
    const updateWatchlistShell = (headerHtml, bodyHtml) => {
        const stickyHead = container.querySelector('.watchlist-sticky-head');
        const headerSlot = stickyHead?.querySelector('.watchlist-header-slot');
        const searchBox = stickyHead?.querySelector('.stock-search');
        const itemsSlot = container.querySelector('.watchlist-items');
        if (headerSlot && searchBox && itemsSlot) {
            headerSlot.innerHTML = headerHtml;
            itemsSlot.innerHTML = bodyHtml;
            return;
        }
        container.innerHTML = `
            <div class="watchlist-sticky-head">
                <div class="watchlist-header-slot">${headerHtml}</div>
                ${sHtml}
            </div>
            <div class="watchlist-items">${bodyHtml}</div>
        `;
    };
    
    if(!state.watchlist.length) { 
        updateWatchlistShell(
            renderLeftListHeader(`自选股池 · 0/${SYS_CONFIG.WATCHLIST_LIMIT}`, { showRefresh: false }),
            '<div class="stock-empty"><strong>还没有自选股</strong><br/>在上方搜索并添加</div>'
        );
        return; 
    }
    
    const lHtml = state.watchlist.map(s => {
        const target = normalizeSecurityTarget(s);
        const isSupported = isSupportedWatchlistSecurity(target);
        const displayName = target.name;
        const shortName = getSecurityShortName(target);
        const id = target.secid;
        const d = getVisibleQuoteData(id);
        const statusData = getMergedLiveDailyData(id);
        const lastDate = statusData?.length ? statusData[statusData.length - 1].date : '';
        const rowStatus = isSupported
            ? resolveWatchlistRowStatus(s, statusData, lastDate)
            : { label: '不支持', action: '暂不支持场外基金', detail: '当前仅支持 A 股或交易所 ETF/LOF', toneClass: 'tone-warn' };
        const quoteDisplay = isSupported ? getLeftQuoteDisplay(target) : { priceText: '--', changeText: '--', cl: 'flat' };
        const statusTitle = rowStatus.detail || rowStatus.action || rowStatus.label;
        const positionChangeHtml = rowStatus.positionChange
            ? `<span class="wl-position-change">${escapeHTML(rowStatus.positionChange)}</span>`
            : '';
        const dragTargetAttrs = s._pendingRemove
            ? ''
            : `ondragover="updateWatchlistDragTarget(event,'${escapeJSArg(target.code)}')" ondrop="dropWatchlistItem(event,'${escapeJSArg(target.code)}')"`;
        const selectAction = isSupported
            ? `selectStock('${escapeJSArg(target.code)}','${escapeJSArg(displayName)}','${escapeJSArg(target.secid)}','${escapeJSArg(target.type)}','${escapeJSArg(target.tencentSymbol)}')`
            : 'showUnsupportedSecurityNotice()';
        const selectTargetAttrs = s._pendingRemove
            ? ''
            : `role="button" tabindex="0" aria-label="查看 ${escapeHTML(displayName)}" onclick="event.stopPropagation();${selectAction}" onkeydown="handleWatchlistSelectKeydown(event)"`;
        
        return `
            <div class="nav-list-item watchlist-item ${isSupported ? '' : 'is-unsupported '}${target.code === state.stockId ? 'active' : ''}${s._pendingRemove ? ' pending-remove' : ''}" data-code="${target.code}" ${dragTargetAttrs} ${s._pendingRemove ? '' : `onclick="${selectAction}"`}>
                <div class="nav-list-main">
                    ${s._pendingRemove ? '' : `
                    <button type="button" class="wl-drag-handle" data-code="${target.code}" draggable="true" title="拖动调整顺序" aria-label="拖动或使用上下方向键调整 ${escapeHTML(displayName)} 的顺序" onclick="event.stopPropagation()" ondragstart="startWatchlistDrag(event,'${escapeJSArg(target.code)}')" ondragend="finishWatchlistDrag()" onkeydown="handleWatchlistDragKeydown(event,'${escapeJSArg(target.code)}')">
                        <svg viewBox="0 0 12 18" aria-hidden="true"><circle cx="3" cy="3" r="1.2"></circle><circle cx="9" cy="3" r="1.2"></circle><circle cx="3" cy="9" r="1.2"></circle><circle cx="9" cy="9" r="1.2"></circle><circle cx="3" cy="15" r="1.2"></circle><circle cx="9" cy="15" r="1.2"></circle></svg>
                    </button>`}
                    <div class="lname-wrap watchlist-select-target" ${selectTargetAttrs}>
                        <span class="lname" title="${escapeHTML(displayName)}">${escapeHTML(shortName)}</span>
                        <span class="wl-status ${rowStatus.toneClass}" title="${escapeHTML(statusTitle)}">${rowStatus.label}</span>
                        ${positionChangeHtml}
                    </div>
                    ${s._pendingRemove ? '' : `<button type="button" class="wl-close" title="移除自选股" aria-label="移除 ${escapeHTML(displayName)}" onclick="event.stopPropagation();removeStock('${escapeJSArg(target.code)}')">×</button>`}
                </div>
                <div class="nav-list-sub">
                    <div class="wl-sub-left">
                        <span class="lcode mono">${escapeHTML(target.code)}</span>
                    </div>
                    <div class="lquote">
                        <span class="lprice mono ${quoteDisplay.cl}" data-code="${target.code}">${quoteDisplay.priceText}</span>
                        <span class="lchange mono ${quoteDisplay.cl}" data-code="${target.code}">${quoteDisplay.changeText}</span>
                    </div>
                </div>
            </div>
        `;
    }).join('');
    
    updateWatchlistShell(
        renderLeftListHeader(`自选股池 · ${state.watchlist.length}/${SYS_CONFIG.WATCHLIST_LIMIT}`),
        `<div>${lHtml}</div>`
    );
}

function refreshWatchlistQuotes() {
    (state.watchlist || []).forEach(s => {
        const target = normalizeSecurityTarget(s);
        const quoteDisplay = getLeftQuoteDisplay(target);
        const priceEl = document.querySelector(`#stockNavList .lprice[data-code="${target.code}"]`);
        const changeEl = document.querySelector(`#stockNavList .lchange[data-code="${target.code}"]`);
        if (priceEl) {
            priceEl.textContent = quoteDisplay.priceText;
            priceEl.className = `lprice mono ${quoteDisplay.cl}`;
        }
        if (changeEl) {
            changeEl.textContent = quoteDisplay.changeText;
            changeEl.className = `lchange mono ${quoteDisplay.cl}`;
        }
    });
}

function refreshIndexListQuotes() {
    INDEX_IDS.forEach(id => {
        const quoteDisplay = getLeftQuoteDisplay(id);
        const priceEl = document.querySelector(`#indexNavList .lprice[data-code="${id}"]`);
        const changeEl = document.querySelector(`#indexNavList .lchange[data-code="${id}"]`);
        if (priceEl) {
            priceEl.textContent = quoteDisplay.priceText;
            priceEl.className = `lprice mono ${quoteDisplay.cl}`;
        }
        if (changeEl) {
            changeEl.textContent = quoteDisplay.changeText;
            changeEl.className = `lchange mono ${quoteDisplay.cl}`;
        }
    });
}

function toggleMA(n) { 
    if(state.activeMAs.includes(n)) {
        state.activeMAs = state.activeMAs.filter(v => v !== n); 
    } else {
        state.activeMAs.push(n); 
    }
    state.activeMAs.sort((a, b) => a - b); 
    renderMASelector(); 
    redrawCurrentViewport(); 
}

function renderMASelector() { 
    const c = document.getElementById('indicatorGroup'); 
    if(c) {
        c.innerHTML = MA_OPTIONS.map(n => { 
            const isActive = state.activeMAs.includes(n);
            const color = MA_COLORS[n]; 
            return `
                <label class="ma-checkbox" style="color:${isActive ? color : 'var(--text-dim)'}">
                    <input type="checkbox" ${isActive ? 'checked' : ''} onchange="toggleMA(${n})">
                    <span class="check-box" style="border-color:${color}; background-color:${isActive ? color : 'transparent'}"></span>
                    MA${n}
                </label>
            `; 
        }).join(''); 
    }
}

function redrawCurrentViewport() {
    if (typeof drawViewport === 'function') drawViewport();
    else draw();
}

function suppressStaleHoverSelection() {
    if (typeof suppressChartHoverSelection === 'function') {
        suppressChartHoverSelection();
        return;
    }
    if (typeof pendingHoverIdx !== 'undefined') pendingHoverIdx = -1;
    if (typeof hoverRAF !== 'undefined' && hoverRAF) {
        cancelAnimationFrame(hoverRAF);
        hoverRAF = null;
    }
    if (typeof chartHoverSuppressUntil !== 'undefined') chartHoverSuppressUntil = Date.now() + 350;
}

function prevDay() {
    if(state.lockIdx > 0) {
        applyHistoryNavigationState({ lockIdx: state.lockIdx - 1, isFrozen: true });
        anchorViewportAt(state.lockIdx);
        clearStaleTooltips();
        redrawCurrentViewport();
        safeUpdateSidebar();
        updateFreezeBadge();
    }
}

function nextDay() {
    const rd = getActiveData();
    if(rd && state.lockIdx < rd.length - 1) {
        const nextIdx = state.lockIdx + 1;
        applyHistoryNavigationState({ lockIdx: nextIdx, isFrozen: nextIdx < rd.length - 1 });
        if (state.isFrozen) anchorViewportAt(nextIdx);
        else {
            suppressStaleHoverSelection();
            resetViewportToLatest(rd);
        }
        clearStaleTooltips();
        redrawCurrentViewport();
        safeUpdateSidebar();
        if (typeof updateNavCapsuleVisuals === 'function') updateNavCapsuleVisuals(nextIdx, rd.length);
        updateFreezeBadge();
    }
}

function resetLatest() {
    const rd = getActiveData();
    if(rd) {
        suppressStaleHoverSelection();
        applyHistoryNavigationState({ lockIdx: rd.length - 1, isFrozen: false });
        resetViewportToLatest(rd);
        clearStaleTooltips();
        redrawCurrentViewport();
        safeUpdateSidebar();
        updateNavCapsuleVisuals(rd.length - 1, rd.length);
        updateFreezeBadge();
    }
}

function toggleDialogOverlay(overlay, { beforeOpen, fallbackFocus } = {}) {
    if (!overlay) return;
    const opening = !overlay.classList.contains('show');
    if (opening) {
        beforeOpen?.();
        const currentFocus = document.activeElement;
        overlay._returnFocus = currentFocus?.offsetParent !== null ? currentFocus : fallbackFocus;
        overlay.classList.add('show');
        requestAnimationFrame(() => overlay.querySelector('.sg-close, button, [href], input, [tabindex]:not([tabindex="-1"])')?.focus());
        return;
    }
    overlay.classList.remove('show');
    const returnFocus = overlay._returnFocus || fallbackFocus;
    overlay._returnFocus = null;
    requestAnimationFrame(() => returnFocus?.isConnected !== false && returnFocus?.focus?.());
}

function toggleHelp() {
    toggleDialogOverlay(document.getElementById('helpOverlay'), { fallbackFocus: document.getElementById('btnHelp') });
}

function isHeaderMoreMenuOpen() {
    const menu = document.getElementById('headerMoreMenu');
    return !!menu && !menu.hidden;
}

function closeHeaderMoreMenu(options = {}) {
    const menu = document.getElementById('headerMoreMenu');
    const trigger = document.getElementById('btnMore');
    if (!menu || !trigger) return;
    menu.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    if (options.restoreFocus) trigger.focus();
}

function openHeaderMoreMenu(options = {}) {
    const menu = document.getElementById('headerMoreMenu');
    const trigger = document.getElementById('btnMore');
    if (!menu || !trigger) return;
    menu.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    if (options.focusFirst) menu.querySelector('[role="menuitem"]')?.focus();
}

function toggleHeaderMoreMenu(event) {
    event?.stopPropagation();
    if (isHeaderMoreMenuOpen()) closeHeaderMoreMenu();
    else openHeaderMoreMenu();
}

function handleHeaderMoreTriggerKeydown(event) {
    if (event.key === 'ArrowDown') {
        event.preventDefault();
        event.stopPropagation();
        openHeaderMoreMenu({ focusFirst: true });
    } else if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeHeaderMoreMenu();
    }
}

function handleHeaderMoreMenuKeydown(event) {
    const menu = document.getElementById('headerMoreMenu');
    const items = Array.from(menu?.querySelectorAll('[role="menuitem"]') || []);
    if (!items.length) return;
    const currentIndex = items.indexOf(document.activeElement);
    let nextIndex = currentIndex;
    if (event.key === 'ArrowDown') nextIndex = (currentIndex + 1) % items.length;
    else if (event.key === 'ArrowUp') nextIndex = (currentIndex - 1 + items.length) % items.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = items.length - 1;
    else if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeHeaderMoreMenu({ restoreFocus: true });
        return;
    } else {
        return;
    }
    event.preventDefault();
    event.stopPropagation();
    items[nextIndex].focus();
}

function runHeaderMoreAction(event, action) {
    event?.stopPropagation();
    closeHeaderMoreMenu();
    if (action === 'performance') togglePerfPanel();
    else if (action === 'reset') handleClearCache();
}

document.addEventListener('click', event => {
    const wrap = document.getElementById('headerMoreWrap');
    if (wrap && !wrap.contains(event.target)) closeHeaderMoreMenu();
});

document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && isHeaderMoreMenuOpen()) {
        event.preventDefault();
        closeHeaderMoreMenu({ restoreFocus: true });
    }
});

function isBackgroundPerfTrace(item) {
    const label = String(item?.label || '');
    return [
        'cachedFetchRefresh',
        'cachedFetchRefreshApply',
        'refreshSidebarRealtime',
        'syncData'
    ].includes(label);
}

function splitPerfItems(items) {
    return (items || []).reduce((groups, item) => {
        if (isBackgroundPerfTrace(item)) groups.background.push(item);
        else groups.interaction.push(item);
        return groups;
    }, { interaction: [], background: [] });
}

function renderPerfPanel() {
    const panel = document.getElementById('perfPanel');
    if (!panel) return;

    const traces = (window.__DG_PERF__?.traces || []).slice().reverse();
    const baseline = window.__DG_PERF__?.baseline?.() || [];
    const traceGroups = splitPerfItems(traces);
    const baselineGroups = splitPerfItems(baseline);
    const longTaskSummary = window.__DG_PERF__?.longTaskSummary?.() || { count: 0, avg: 0, max: 0, last: 0 };
    const longTaskHtml = longTaskSummary.count ? `
        <div class="perf-item">
            <div class="perf-item-head">
                <div class="perf-item-title">长任务</div>
                <div class="perf-item-total mono">峰值 ${longTaskSummary.max}ms</div>
            </div>
            <div class="perf-item-meta">次数 ${longTaskSummary.count} · 平均 ${longTaskSummary.avg}ms · 最近 ${longTaskSummary.last}ms</div>
        </div>
    ` : '<div class="perf-empty">暂无浏览器长任务记录。</div>';
    const renderBaselineList = (items, emptyText) => items.length ? items.map(item => {
        const title = item.path ? `${item.label} · ${item.path}` : item.label;
        return `
            <div class="perf-item">
                <div class="perf-item-head">
                    <div class="perf-item-title">${escapeHTML(title)}</div>
                    <div class="perf-item-total mono">平均 ${item.avg}ms</div>
                </div>
                <div class="perf-item-meta">次数 ${item.count} · 峰值 ${item.max}ms · 最近 ${item.last}ms</div>
            </div>
        `;
    }).join('') : `<div class="perf-empty">${escapeHTML(emptyText)}</div>`;
    const baselineHtml = `
        <div class="perf-section-note">交互手感：点击、切换、绘图等用户能直接感到的耗时。</div>
        <div class="perf-list">${renderBaselineList(baselineGroups.interaction, '暂无交互性能基线。')}</div>
        <div class="perf-item-title" style="margin:12px 0 8px;">后台同步</div>
        <div class="perf-section-note">后台同步：网络等待或刷新应用，不直接代表点击卡顿。</div>
        <div class="perf-list">${renderBaselineList(baselineGroups.background, '暂无后台同步性能基线。')}</div>
    `;
    const renderTraceList = (items, emptyText) => items.length ? items.map(item => {
        const metaEntries = Object.entries(item.meta || {});
        const refreshPath = metaEntries.find(([k]) => k === 'path')?.[1] || '';
        const meta = metaEntries.filter(([k]) => k !== 'path').map(([k, v]) => `${k}: ${v}`).join(' · ');
        const steps = (item.steps || []).map(step => `
            <div class="perf-step">
                <span class="step-name">${escapeHTML(step.step)}</span>
                <span class="mono">${step.duration}ms</span>
            </div>
        `).join('');
        return `
            <div class="perf-item">
                <div class="perf-item-head">
                    <div class="perf-item-title">${escapeHTML(item.label)}</div>
                    <div class="perf-item-total mono">${item.total}ms</div>
                </div>
                ${refreshPath ? `
                <div class="perf-path-row">
                    <span class="perf-path-label">刷新路径</span>
                    <span class="perf-path-value mono">${escapeHTML(refreshPath)}</span>
                </div>
                ` : ''}
                <div class="perf-item-meta">${escapeHTML(meta || '无额外信息')}</div>
                <div class="perf-steps">${steps || '<div class="perf-item-meta">无分步记录</div>'}</div>
            </div>
        `;
    }).join('') : `<div class="perf-empty">${escapeHTML(emptyText)}</div>`;
    const interactionHtml = renderTraceList(traceGroups.interaction, '先操作几次切换、绘图或策略切换，这里会出现交互耗时。');
    const backgroundHtml = renderTraceList(traceGroups.background, '暂无后台同步记录。');

    panel.innerHTML = `
        <div class="sg-header">
            <h2 id="perfDialogTitle">性能诊断</h2>
            <button type="button" class="sg-close" onclick="togglePerfPanel()" title="关闭性能诊断" aria-label="关闭性能诊断">×</button>
        </div>
        <div class="sg-body">
            <div class="perf-toolbar">
                <button type="button" onclick="renderPerfPanel()">刷新</button>
                <button type="button" onclick="copyPerfSummary()">复制摘要</button>
                <button type="button" onclick="clearPerfSummary()">清空记录</button>
            </div>
            <div class="perf-item-title" style="margin:10px 0 8px;">性能基线</div>
            <div class="perf-list">${baselineHtml}</div>
            <div class="perf-item-title" style="margin:14px 0 8px;">长任务</div>
            <div class="perf-list">${longTaskHtml}</div>
            <div class="perf-item-title" style="margin:14px 0 8px;">交互手感</div>
            <div class="perf-list">${interactionHtml}</div>
            <div class="perf-item-title" style="margin:14px 0 8px;">后台同步</div>
            <div class="perf-section-note">网络等待或刷新应用，不直接代表点击卡顿。</div>
            <div class="perf-list">${backgroundHtml}</div>
        </div>
    `;
}

function togglePerfPanel() {
    const overlay = document.getElementById('perfOverlay');
    if (!overlay) return;
    toggleDialogOverlay(overlay, {
        beforeOpen: renderPerfPanel,
        fallbackFocus: document.getElementById('btnMore')
    });
}

async function copyPerfSummary() {
    const text = JSON.stringify(window.__DG_PERF__?.summary() || [], null, 2);
    try {
        await navigator.clipboard.writeText(text);
        await customAlert('性能摘要已复制。');
    } catch (e) {
        await customAlert('复制失败，请稍后重试。');
    }
}

function clearPerfSummary() {
    if (window.__DG_PERF__) {
        window.__DG_PERF__.traces = [];
        window.__DG_PERF__.longTasks = [];
    }
    renderPerfPanel();
}

async function switchStrategy(name) { 
    if(!STRATEGIES[name]) return;
    const confirmed = await customConfirm(`确定切换到 [${name}]？\n${STRATEGIES[name].desc}`); 
    if(!confirmed) return;
    const perfTrace = PERF.start('switchStrategy', { strategy: name });
    
    const canReuseCurrentIndicators = !!(getActiveData()?.length && state.indicators.macd && state.indicators.rsi && state.indicators.kdj && state.indicators.ma);
    setActiveStrategy(name); 
    localStorage.setItem('quant_strategy', name); 
    renderSettings(); 
    
    if(getActiveData()) { 
        state.pendingIndicatorMutation = canReuseCurrentIndicators ? { mode: 'strategy-only', startIdx: 0 } : { mode: 'full', startIdx: 0 };
        markIndicatorsDirty();
        updateAllIndicators(); 
        PERF.mark(perfTrace, 'indicators');
        draw(); 
        PERF.mark(perfTrace, 'draw');
        safeUpdateSidebar(); 
        PERF.mark(perfTrace, 'sidebar');
        refreshWatchlistSignalSnapshots();
        PERF.mark(perfTrace, 'watchlist');
        renderWatchlist();
    } 
    PERF.end(perfTrace, { selected: state.strategy });
}

function renderSettings() {
    const panel = document.getElementById('settingsPanel'); 
    if(!panel) return;
    
    const strategyHtml = Object.entries(STRATEGIES).map(([name, config]) => `
        <button class="${state.strategy === name ? 'active' : ''}" onclick="switchStrategy('${name}')" style="padding:10px;">
            ${name}
            <span class="sg-desc" style="margin-top:4px;">${config.desc}</span>
        </button>
    `).join('');
    
    const signalConfigHtml = SIGNAL_RULES.map(rule => {
        const score = getSignalScore(rule.id);
        const isBuy = rule.id.startsWith('B');
        const isWarning = rule.id.startsWith('W');
        const baseColorVar = isBuy ? '--red' : (isWarning ? '--yellow' : '--green');
        const isUsed = STRATEGY.buySignals?.includes(rule.id) || STRATEGY.exitSignals?.includes(rule.id) || STRATEGY.warningSignals?.includes(rule.id);
        
        const opacity = isUsed ? '1' : '0.4';
        const idBg = isUsed ? 'rgba(255,255,255,0.08)' : 'transparent';
        const idColor = isUsed ? `var(${baseColorVar})` : 'var(--text-dim)';
        const textColor = isUsed ? 'var(--text-main)' : 'var(--text-dim)';
        return `
            <div style="display:flex; justify-content:space-between; align-items:center; padding:6px 8px; background:var(--inner-bg); border-radius:var(--radius-sm); border:1px solid var(--border-light); opacity:${opacity}; transition: opacity 0.2s;">
                <div style="display:flex; align-items:center; gap:6px;">
                    <span class="mono" style="font-size:10px; font-weight:700; background:${idBg}; padding:2px 4px; border-radius:3px; color:${idColor}; line-height:1;">${rule.id}</span>
                    <span style="font-size:11px; color:${textColor};">${getUserSignalText(rule.id)}</span>
                </div>
                <span class="mono" style="font-size:11px; color:${textColor}; font-weight:700;">${score > 0 ? '+' + score : score}</span>
            </div>
        `;
    }).join('');

    panel.innerHTML = `
        <div class="sg-header">
            <h2 id="settingsDialogTitle">系统设置</h2>
            <button type="button" class="sg-close" onclick="toggleSettings()" title="关闭设置" aria-label="关闭设置">×</button>
        </div>
        <div class="sg-body">
            <div class="terminal-block" style="padding:12px 16px;">
                <div class="block-title" style="margin-bottom:8px;">量化策略选择 (当前: ${state.strategy})</div>
                <div class="sg-strategy" style="gap:8px;">${strategyHtml}</div>
            </div>
            <div class="terminal-block" style="padding:12px 16px;">
                <div class="block-title" style="display:flex;justify-content:space-between; margin-bottom:8px;">
                    <span>信号积分配置 (SOP 4.1.2)</span>
                    <span class="text-dim" style="font-weight:400;">买入阈值: ${STRATEGY.buyThreshold}分</span>
                </div>
                <div class="signal-config-grid">${signalConfigHtml}</div>
                <div class="risk-note" style="margin-top:8px;">注：灰色未点亮的信号表示当前策略未将该信号纳入核心驱动模型。积分配置由当前策略动态决定，不同策略对同一信号的赋分可能不同。</div>
            </div>
        </div>
    `;
}

function toggleSettings() { 
    toggleDialogOverlay(document.getElementById('settingsOverlay'), {
        beforeOpen: renderSettings,
        fallbackFocus: document.getElementById('btnSettings')
    });
}

function formatSectorTrendTime(timestamp, includeDate = false) {
    if (!Number.isFinite(Number(timestamp)) || Number(timestamp) <= 0) return '--';
    const options = includeDate
        ? { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }
        : { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false };
    return new Intl.DateTimeFormat('zh-CN', options).format(new Date(Number(timestamp)));
}

function formatExternalLeadTradingDate(timestamp) {
    if (!Number.isFinite(Number(timestamp)) || Number(timestamp) <= 0) return '';
    const parts = {};
    new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(new Date(Number(timestamp))).forEach(part => { parts[part.type] = part.value; });
    return parts.month && parts.day ? `${parts.month}/${parts.day}` : '';
}

function formatSectorTrendSigned(value, decimals = 2, suffix = '') {
    const number = Number(value);
    if (!Number.isFinite(number)) return '--';
    const normalized = Math.abs(number) < Math.pow(10, -decimals) / 2 ? 0 : number;
    return `${normalized > 0 ? '+' : ''}${normalized.toFixed(decimals)}${suffix}`;
}

function formatSectorTrendAmount(value) {
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount <= 0) return '--';
    if (amount >= 1e8) return `${(amount / 1e8).toFixed(amount >= 1e10 ? 0 : 1)}亿`;
    if (amount >= 1e4) return `${(amount / 1e4).toFixed(0)}万`;
    return amount.toFixed(0);
}

function getSectorTrendMetricClass(value) {
    const number = Number(value);
    return number > 0 ? 'up' : (number < 0 ? 'down' : 'flat');
}

function renderExternalLeadStrip() {
    loadExternalLeadStripCache();
    const container = document.getElementById('externalLeadStrip');
    if (!container) return;
    const themes = externalLeadStripState.themes.length
        ? externalLeadStripState.themes
        : buildExternalLeadStripThemes(externalLeadStripState.items || {});
    container.innerHTML = themes.map(theme => {
        const average = Number.isFinite(theme.averageChangePct)
            ? formatSectorTrendSigned(theme.averageChangePct, 2, '%')
            : '--';
        const changeClass = getSectorTrendMetricClass(theme.averageChangePct);
        const symbol = theme.state === '隔夜偏强' ? '▲' : (theme.state === '隔夜偏弱' ? '▼' : (theme.state === '隔夜分化' ? '◆' : '◇'));
        const anchorKeys = new Set((theme.anchorEvidence || []).map(item => item.key));
        const evidence = theme.evidence.length
            ? theme.evidence.map(item => `${anchorKeys.has(item.key) ? '主' : '确认'} ${item.name} ${formatSectorTrendSigned(item.changePct, 2, '%')}${item.stale ? '（缓存）' : ''}`).join(' · ')
            : '等待美股行情证据';
        const industries = theme.industries.join('、');
        const shortIndustries = theme.shortIndustries.join('/');
        const title = `${theme.name}｜${evidence}｜主方向加权变化 ${average} → ${theme.direction}：${industries}｜仅作外部环境推测，待 A 股确认`;
        return `
            <div class="external-env-strip-item ${theme.tone}" title="${escapeHTML(title)}" aria-label="${escapeHTML(title)}">
                <span class="external-env-strip-theme">${escapeHTML(theme.shortName)}</span>
                <span class="external-env-strip-change mono ${changeClass}">${symbol} ${average}</span>
                <span class="external-env-strip-arrow">→</span>
                <span class="external-env-strip-industries">${escapeHTML(shortIndustries)}</span>
            </div>
        `;
    }).join('');
    const metaEl = document.getElementById('externalLeadStripMeta');
    if (metaEl) {
        const items = Object.values(externalLeadStripState.items || {});
        const count = items.length;
        const tradingDates = Array.from(new Set(items.map(item => formatExternalLeadTradingDate(item.quoteAt)).filter(Boolean))).sort();
        const tradingDateText = tradingDates.length === 1
            ? `美股 ${tradingDates[0]} 收盘`
            : (tradingDates.length > 1 ? '美股日期不一致' : '美股日期待确认');
        const cachePrefix = externalLeadStripState.status === 'cached'
            ? '缓存 · '
            : (externalLeadStripState.status === 'partial' ? '部分缓存 · ' : '');
        if (externalLeadStripState.status === 'loading') metaEl.textContent = count ? `更新中 · ${tradingDateText}` : '正在更新外盘';
        else if (count) metaEl.textContent = `${cachePrefix}${tradingDateText}`;
        else metaEl.textContent = externalLeadStripState.status === 'error' ? '外盘暂不可用' : '等待外盘';
        const fetchedText = externalLeadStripState.fetchedAt ? `北京时间 ${formatSectorTrendTime(externalLeadStripState.fetchedAt, true)} 获取` : '尚无获取时间';
        metaEl.title = [
            `${count}/${Object.keys(EXTERNAL_LEAD_STRIP_CONFIG.ITEMS).length} 项外盘证据`,
            tradingDates.length > 1 ? `交易日 ${tradingDates.join('、')}` : '',
            fetchedText,
            externalLeadStripState.error
        ].filter(Boolean).join(' · ');
    }
    updateExternalRefreshButton();
}

function renderSectorTrendOverview() {
    const container = document.getElementById('sectorTrendOverview');
    if (!container) return;
    const summary = sectorTrendState.summary || {};
    const items = [
        { label: '上涨趋势', value: summary.uptrendCount || 0, note: '多周期同向且上涨家数扩散', tone: 'is-positive' },
        { label: '刚刚转强', value: summary.turningCount || 0, note: '短中期改善，仍需继续确认', tone: 'is-mixed' },
        { label: '单日异动', value: summary.momentumCount || 0, note: '当日强势，尚未构成趋势', tone: 'is-warning' },
        { label: '当前最强', value: summary.strongest || '--', note: `行业扫描 ${summary.totalCount || 0} 个 · 概念热点取前 ${summary.conceptCount || 0} 个`, tone: 'is-info', textValue: true }
    ];
    container.innerHTML = items.map(item => `
        <article class="sector-summary-card">
            <div class="sector-summary-label"><span class="sector-summary-dot ${item.tone}" aria-hidden="true"></span>${escapeHTML(item.label)}</div>
            <div class="sector-summary-value ${item.textValue ? '' : 'mono'}">${escapeHTML(String(item.value))}${item.textValue ? '' : '<span>个</span>'}</div>
            <div class="sector-summary-note">${escapeHTML(item.note)}</div>
        </article>
    `).join('');
}

function renderSectorTrendCandidates(board) {
    const candidates = Array.isArray(board.candidates) ? board.candidates : [];
    if (!candidates.length) return '<div class="sector-candidate-empty">暂无可用活跃个股</div>';
    return candidates.map(candidate => `
        <span class="sector-candidate-chip">
            <span>${escapeHTML(candidate.name)}</span>
            <span class="mono">${escapeHTML(candidate.code)} · ${formatSectorTrendSigned(candidate.changePct, 2, '%')}</span>
        </span>
    `).join('');
}

function renderSectorConceptHighlights() {
    const container = document.getElementById('sectorConceptHighlights');
    if (!container) return;
    const concepts = Array.isArray(sectorTrendState.concepts) ? sectorTrendState.concepts : [];
    if (!concepts.length) {
        container.innerHTML = '<div class="sector-concept-empty">暂无概念热点数据。</div>';
        return;
    }
    container.innerHTML = concepts.map((concept, index) => {
        const leader = concept.candidates?.[0];
        return `
            <article class="sector-concept-row">
                <div class="sector-concept-identity">
                    <strong>${index + 1}. ${escapeHTML(concept.name)}</strong>
                    <span class="mono">${escapeHTML(concept.code)}</span>
                </div>
                <div><span>今日</span><strong class="mono ${getSectorTrendMetricClass(concept.changePct)}">${formatSectorTrendSigned(concept.changePct, 2, '%')}</strong></div>
                <div><span>5日</span><strong class="mono ${getSectorTrendMetricClass(concept.return5)}">${formatSectorTrendSigned(concept.return5, 2, '%')}</strong></div>
                <div><span>10日</span><strong class="mono ${getSectorTrendMetricClass(concept.return10)}">${formatSectorTrendSigned(concept.return10, 2, '%')}</strong></div>
                <div>
                    <span>代表股</span>
                    <span class="sector-concept-leader">${leader ? `<span class="sector-concept-leader-name">${escapeHTML(leader.name)}</span><span class="sector-concept-leader-code mono">${escapeHTML(leader.code)}</span>` : '--'}</span>
                </div>
            </article>
        `;
    }).join('');
}

function renderSectorTrendCards(targetId, boards, emptyCopy) {
    const container = document.getElementById(targetId);
    if (!container) return;
    if (!boards?.length) {
        container.innerHTML = `<div class="sector-trend-empty">${escapeHTML(emptyCopy)}</div>`;
        return;
    }
    container.innerHTML = boards.map((board, index) => {
        const breadthText = board.memberCount
            ? `${board.upCount}涨 / ${board.downCount}跌 / ${board.flatCount}平`
            : '成分广度暂缺';
        const flowText = Number.isFinite(Number(board.mainFlowPct))
            ? `主力净流入占比 ${formatSectorTrendSigned(board.mainFlowPct, 2, '%')}`
            : '资金数据暂缺';
        return `
            <article class="sector-trend-card" aria-label="${escapeHTML(`${board.name}，${board.trendLabel}，趋势分 ${board.score}`)}">
                <div class="sector-trend-card-head">
                    <div class="sector-trend-identity">
                        <div class="sector-trend-eyebrow"><span>${escapeHTML(board.typeLabel)}</span><span class="mono">${escapeHTML(board.code)}</span></div>
                        <h3>${index + 1}. ${escapeHTML(board.name)}</h3>
                    </div>
                    <div class="sector-trend-score"><strong class="mono">${board.score}</strong><span>趋势分</span></div>
                </div>
                <div class="sector-trend-metrics">
                    <div><span>今日</span><strong class="mono ${getSectorTrendMetricClass(board.changePct)}">${formatSectorTrendSigned(board.changePct, 2, '%')}</strong></div>
                    <div><span>5日</span><strong class="mono ${getSectorTrendMetricClass(board.return5)}">${formatSectorTrendSigned(board.return5, 2, '%')}</strong></div>
                    <div><span>10日</span><strong class="mono ${getSectorTrendMetricClass(board.return10)}">${formatSectorTrendSigned(board.return10, 2, '%')}</strong></div>
                    <div><span>60日</span><strong class="mono ${getSectorTrendMetricClass(board.return60)}">${formatSectorTrendSigned(board.return60, 2, '%')}</strong></div>
                    <div><span>5日相对</span><strong class="mono ${getSectorTrendMetricClass(board.relative5)}">${formatSectorTrendSigned(board.relative5, 2, '%')}</strong></div>
                    <div><span>上涨覆盖</span><strong class="mono">${Number(board.breadthPct).toFixed(0)}%</strong></div>
                </div>
                <div class="sector-trend-evidence">
                    <span>${escapeHTML(breadthText)}</span>
                    <span>成交额 ${escapeHTML(formatSectorTrendAmount(board.amount))}</span>
                    <span class="${getSectorTrendMetricClass(board.mainFlowPct)}">${escapeHTML(flowText)}</span>
                </div>
                ${board.etfMappingChecked ? `
                    <div class="sector-trend-etf">
                        <span>${board.etfMapping?.relation === 'related' ? '相近参考（非直接对应）' : '官方指数 / 参考 ETF'}</span>
                        ${board.etfMapping
                            ? `<strong>${escapeHTML(board.etfMapping.indexName)}${board.etfMapping.indexCode ? ` <em class="mono">${escapeHTML(board.etfMapping.indexCode)}</em>` : ''}</strong><strong>${escapeHTML(board.etfMapping.etfName)} <em class="mono">${escapeHTML(board.etfMapping.etfCode)}</em></strong>`
                            : '<strong class="is-unmapped">暂无稳定对应 ETF</strong>'}
                    </div>
                ` : ''}
                <div class="sector-trend-candidates">
                    <span>当前活跃个股</span>
                    <div>${renderSectorTrendCandidates(board)}</div>
                </div>
                <div class="sector-trend-invalid"><strong>失效观察</strong><span>${escapeHTML(board.invalidCondition || '等待更完整数据后再判断。')}</span></div>
            </article>
        `;
    }).join('');
}

function updateExternalRefreshButton() {
    const refreshBtn = document.getElementById('externalRefreshBtn');
    if (!refreshBtn) return;
    const isLoading = sectorTrendState.status === 'loading' || externalLeadStripState.status === 'loading';
    refreshBtn.disabled = isLoading;
    const icon = refreshBtn.querySelector('svg');
    const label = refreshBtn.querySelector('span');
    if (icon) icon.classList.toggle('spin', isLoading);
    if (label) label.textContent = isLoading ? '正在扫描' : '重新扫描';
}

function getSectorTrendWorkspaceStatus() {
    return { key: sectorTrendState.status || 'idle', error: sectorTrendState.error || '' };
}

function renderSectorTrendWorkspaceStatus() {
    const statusEl = document.getElementById('sectorTrendStatus');
    if (!statusEl) return;
    const snapshotStatus = getSectorTrendWorkspaceStatus();
    const statusMap = {
        idle: { label: '等待扫描', tone: 'data-status-info', tooltip: '进入页面后将扫描 A 股行业与概念板块' },
        loading: { label: '正在扫描', tone: 'data-status-info', tooltip: '正在计算板块多周期强度并补充活跃个股' },
        ready: { label: '扫描完成', tone: 'data-status-ok', tooltip: '行业板块已完成趋势排名，概念板块已取今日热点首100' },
        partial: { label: '部分完成', tone: 'data-status-warn', tooltip: snapshotStatus.error || '部分板块或活跃个股数据暂缺' },
        cached: { label: '缓存结果', tone: 'data-status-info', tooltip: snapshotStatus.error || '公开接口暂不可用，当前显示最近扫描结果' },
        error: { label: '暂不可用', tone: 'data-status-warn', tooltip: snapshotStatus.error || '板块行情暂不可用' }
    };
    const status = statusMap[snapshotStatus.key] || statusMap.idle;
    if (statusEl.dataset.currentStatusKey === snapshotStatus.key) return;
    statusEl.dataset.currentStatusKey = snapshotStatus.key;
    statusEl.classList.remove('data-status-ok', 'data-status-info', 'data-status-warn');
    statusEl.classList.add(status.tone);
    statusEl.dataset.tooltip = status.tooltip;
    const label = statusEl.querySelector('.data-status-label');
    if (label) label.textContent = status.label;
}

function renderSectorTrendSnapshot() {
    loadSectorTrendCache();
    renderExternalLeadStrip();
    renderSectorTrendOverview();
    renderSectorConceptHighlights();
    renderSectorTrendCards('sectorTrendLeaders', sectorTrendState.groups.uptrend, '当前没有板块同时满足多周期趋势和上涨家数条件。');
    renderSectorTrendCards('sectorTrendTurning', sectorTrendState.groups.turning, '当前没有明显的刚转强板块。');
    renderSectorTrendCards('sectorTrendMomentum', sectorTrendState.groups.momentum, '当前没有需要单独提醒的单日异动。');
    renderSectorTrendWorkspaceStatus();
    const metaEl = document.getElementById('sectorTrendMeta');
    if (metaEl) {
        const prefix = sectorTrendState.status === 'cached' ? '缓存于' : '本轮扫描';
        const timestamp = sectorTrendState.fetchedAt ? formatSectorTrendTime(sectorTrendState.fetchedAt, true) : '--';
        metaEl.textContent = sectorTrendState.boards.length
            ? `${prefix} ${timestamp} · ${sectorTrendState.source || '公开板块行情'} · 5/10/60日趋势`
            : (sectorTrendState.status === 'loading' ? '正在扫描板块趋势' : '等待首次扫描');
        metaEl.title = sectorTrendState.error || metaEl.textContent;
    }
    updateExternalRefreshButton();
}

let externalReturnSelection = null;

function setPrimaryWorkspace(tab) {
    const marketWorkspace = document.getElementById('marketWorkspace');
    const externalWorkspace = document.getElementById('externalWorkspace');
    const isExternal = tab === 'external';
    if (marketWorkspace) marketWorkspace.hidden = isExternal;
    if (externalWorkspace) externalWorkspace.hidden = !isExternal;
    document.querySelectorAll('#mainTabs .nav-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tab));
    if (!isExternal) {
        requestAnimationFrame(() => {
            ['main', 'vol', 'macd', 'kdj'].forEach(key => state.charts[key]?.resize?.());
        });
    }
}

function openExternalWorkspace() {
    if (state.tab === 'index' || state.tab === 'stock') {
        externalReturnSelection = { tab: state.tab, mode: state.mode, id: state.id, stockId: state.stockId };
    }
    state.tab = 'external';
    state.mode = 'external';
    state.isFrozen = false;
    setPrimaryWorkspace('external');
    loadSectorTrendCache();
    loadExternalLeadStripCache();
    renderSectorTrendSnapshot();
    Promise.all([
        refreshSectorTrendSnapshot({ reason: 'tab-enter' }),
        refreshExternalLeadStripSnapshot({ reason: 'tab-enter' })
    ]);
}

function openMarketWorkspace(tab) {
    const returnSelection = externalReturnSelection;
    state.tab = tab;
    setPrimaryWorkspace(tab);
    if (tab === 'index') {
        const id = returnSelection?.tab === 'index' ? returnSelection.id : 'sh';
        document.getElementById('indexNavList').style.display = 'flex';
        document.getElementById('stockNavList').style.display = 'none';
        selectIndex(id || 'sh');
    } else {
        document.getElementById('indexNavList').style.display = 'none';
        document.getElementById('stockNavList').style.display = 'flex';
        renderWatchlist();
        const savedTarget = returnSelection?.tab === 'stock'
            ? state.watchlist.find(item => item.code === returnSelection.stockId && isSupportedWatchlistSecurity(item))
            : null;
        const nextTarget = savedTarget || getSupportedWatchlistFallback();
        if (nextTarget) selectStock(nextTarget.code, nextTarget.name, nextTarget.secid, nextTarget.type, nextTarget.tencentSymbol);
        else showEmptyWatchlistView();
    }
    externalReturnSelection = null;
}

function switchPrimaryTab(tab) {
    if (!['external', 'index', 'stock'].includes(tab) || tab === state.tab) return;
    if (tab === 'external') openExternalWorkspace();
    else openMarketWorkspace(tab);
}

async function handleExternalRefresh() {
    loadSectorTrendCache();
    const remaining = getSectorTrendCooldownRemaining();
    if (remaining > 0) {
        showToast(`为保护行情接口，请 ${Math.ceil(remaining / 1000)} 秒后再更新。`, 'info', 2200);
        return sectorTrendState;
    }
    if (typeof canRequestMarketData === 'function' && !canRequestMarketData()) {
        showToast('另一页面正在负责行情更新，当前显示本地快照。', 'info', 2400);
        return sectorTrendState;
    }
    const [result] = await Promise.all([
        refreshSectorTrendSnapshot({ reason: 'manual' }),
        refreshExternalLeadStripSnapshot({ reason: 'manual' })
    ]);
    if (result.status === 'ready') showToast('板块趋势扫描已完成。', 'success', 1800);
    else if (['partial', 'cached', 'error'].includes(result.status)) showToast('部分板块数据暂未更新，已保留最近结果。', 'warn', 2600);
    return result;
}

function scheduleIdleTask(fn, timeout = 300) {
    if (typeof window.requestIdleCallback === 'function') {
        return window.requestIdleCallback(fn, { timeout });
    }
    return window.setTimeout(fn, timeout);
}

function scheduleStartupBackgroundHydration() {
    scheduleIdleTask(async () => {
        await preloadCacheOnly();
        await ensureMarketTemperatureData();
        if (state.mode === 'index') {
            renderIndexList();
            if (!document.hidden && isMarketOpen()) await refreshSidebarRealtime();
        } else if (state.mode === 'stock' || state.tab === 'stock') {
            const leftTxn = beginRefreshTransaction('leftList', { source: 'startup-cache-preload', area: 'stock-list' });
            renderWatchlist();
            markLeftListRefreshForActiveTab(leftTxn, { area: 'stock-list' });
            if (!document.hidden && isMarketOpen()) await refreshSidebarRealtime();
        }
    }, 600);
    scheduleIdleTask(() => refreshWatchlistSignalSnapshots(), 900);
}

function shouldUseMobileGate() {
    const gate = document.getElementById('mobileGate');
    return !!gate && getComputedStyle(gate).display === 'flex';
}

function reloadWhenDesktopViewportReturns() {
    const handleResize = () => {
        if (shouldUseMobileGate()) return;
        window.removeEventListener('resize', handleResize);
        window.location.reload();
    };
    window.addEventListener('resize', handleResize);
}

async function init() {
    if (shouldUseMobileGate()) {
        reloadWhenDesktopViewportReturns();
        return;
    }

    const startupPerf = PERF.start('startup', { path: 'initial-load' });
    initMarketRefreshLeadership();
    showLoading(); 
    await openDB(); 
    PERF.mark(startupPerf, 'open-db');
    await loadWatchlist();
    initWatchlistCrossPageSync();
    PERF.mark(startupPerf, 'load-watchlist');
    if (typeof hydrateLiveOverlayCacheState === 'function') hydrateLiveOverlayCacheState();
    try {
        const sc = await dbGet('stock_cache');
        stockCache = (sc && Array.isArray(sc.data)) ? sc.data : [];
    } catch(e) {
        stockCache = [];
    }
    PERF.mark(startupPerf, 'load-stock-cache');
    
    const savedStrategy = localStorage.getItem('quant_strategy');
    if(savedStrategy && STRATEGIES[savedStrategy]) { 
        setActiveStrategy(savedStrategy); 
    }
    
    let resizeRAF = 0;
    window.addEventListener('resize', () => { 
        if (resizeRAF) return;
        resizeRAF = requestAnimationFrame(() => {
            resizeRAF = 0;
            ['main', 'vol', 'macd', 'kdj'].forEach(k => { 
                if(state.charts[k]) state.charts[k].resize(); 
            }); 
        });
    });

    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.addEventListener('click', (event) => {
            switchPrimaryTab(event.currentTarget.dataset.tab);
        });
    });

    document.querySelectorAll('#periodTabs .seg-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const p = e.target.dataset.period; 
            if(p === state.period) return;
            
            document.querySelectorAll('#periodTabs .seg-btn').forEach(b => b.classList.remove('active')); 
            e.target.classList.add('active');
            const prevPeriod = state.period;
            const prevData = getActiveData();
            const prevLock = getPeriodLock(prevPeriod);
            const anchorDate = prevData?.[prevLock]?.date;

            applyPeriodState(p);
            
            setLockIdx(alignLockToPeriod(p, anchorDate)); 
            resetViewportToLatest(getActiveData());
            markIndicatorsDirty(); 
            clearStaleTooltips(); 
            draw(); 
            safeUpdateSidebar();
        });
    });
    
    document.querySelectorAll('#rangeTabs .seg-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const r = parseInt(e.target.dataset.range); 
            if(r === state.range) return;
            
            document.querySelectorAll('#rangeTabs .seg-btn').forEach(b => b.classList.remove('active')); 
            e.target.classList.add('active');
            state.range = r; 
            redrawCurrentViewport();
        });
    });
    
    renderMASelector();
    renderIndexList();
    PERF.mark(startupPerf, 'prepare-ui');

    // 同步 range 按钮 active 状态到当前 state.range
    document.querySelectorAll('#rangeTabs .seg-btn').forEach(btn => {
        btn.classList.toggle('active', parseInt(btn.dataset.range) === state.range);
    });
    
    setInterval(() => { 
        if (document.hidden) return;
        const d = getBJDate(); 
        document.getElementById('liveClock').innerText = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`; 
    }, 1000);
    
    // 30s 批量侧边栏价格刷新：1 次 JSONP 拿全部侧边栏标的实时价格
    setInterval(() => {
        if (document.hidden) return;
        if (!isMarketOpen()) return;
        refreshSidebarRealtime();
    }, SYS_CONFIG.THROTTLE_MS);

    // 30s 当前标的完整同步：增量历史 + 实时合并 + 图表重绘（延迟 15s 启动，与侧边栏刷新错峰）
    setTimeout(() => {
        setInterval(() => { 
            if (document.hidden) return;
            if (!isMarketOpen()) return;
            if(state.mode === 'index') cachedFetch(state.id); 
            else if(state.mode === 'stock' && state.id) cachedFetch(state.id); 
        }, SYS_CONFIG.THROTTLE_MS);
    }, SYS_CONFIG.THROTTLE_MS / 2);

    // 90s 侧边栏全量历史同步：受控并发（并发数 3），覆盖大盘和自选
    startSidebarFullSync();

    // P0-4: 后台切回前台时若在交易时段，立即刷新侧边栏 + 当前标的
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) return;
        if (state.tab === 'external') {
            Promise.all([
                refreshSectorTrendSnapshot({ reason: 'visibility' }),
                refreshExternalLeadStripSnapshot({ reason: 'visibility' })
            ]);
            return;
        }
        if (!isMarketOpen()) return;
        refreshSidebarRealtime();
        if (state.mode === 'index') cachedFetch(state.id);
        else if (state.mode === 'stock' && state.id) cachedFetch(state.id);
    });

    await _selectIndexImpl('sh');  // init 直接调用 impl，跳过防抖
    PERF.mark(startupPerf, 'initial-selection');
    PERF.end(startupPerf, { path: 'initial-index-ready' });

    scheduleStartupBackgroundHydration();
}

// 启动应用
init();
