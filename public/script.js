let API_KEY = "";
let API_SECRET = "";

// State
let ws = null;
let positions = [];
let orders = [];
let balance = { total: 0, available: 0, marginRatio: 0 };
let prices = {};
let maxLeverages = {};
let isDemo = false;
let mockInterval = null;
let trailingShields = {}; // { 'BTCUSDT': boolean }
let lastFilledOrderCount = {}; // { 'BTCUSDT': number } to track fill progress
let initializedAmount = false;

const ENDPOINT = "http://localhost:3000";

// Formatting
const fNum = (num, decimals = 2) => Number(num).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
const clamp = (val, min, max) => Math.min(Math.max(val, min), max);

function toggleSection(id, btn) {
    const el = document.getElementById(id);
    if (!el) return;
    
    const isCurrentlyCollapsed = el.classList.contains('mobile-collapsed');
    
    // Toggle the panel
    if (isCurrentlyCollapsed) {
        el.classList.remove('mobile-collapsed');
    } else {
        el.classList.add('mobile-collapsed');
    }
    
    // Handle icon animations
    const arrow = btn.querySelector('[data-lucide="chevron-down"]');
    if (arrow) {
        arrow.style.transform = isCurrentlyCollapsed ? 'rotate(180deg)' : 'rotate(0deg)';
        arrow.style.transition = 'transform 0.3s ease';
    }
    
    const settings = btn.querySelector('[data-lucide="settings"]');
    if (settings) {
        settings.style.transform = isCurrentlyCollapsed ? 'rotate(90deg)' : 'rotate(0deg)';
        settings.style.transition = 'transform 0.3s ease';
    }
}

function showNotify(msg, type = 'info') {
    const container = document.getElementById('notification-container');
    const toast = document.createElement('div');
    
    const typeColors = {
        'success': 'text-success',
        'error': 'text-danger',
        'warning': 'text-amber-500',
        'info': 'text-indigo-400'
    };
    
    const icons = {
        'success': 'check-circle',
        'error': 'x-circle',
        'warning': 'alert-triangle',
        'info': 'info'
    };

    const typeCol = typeColors[type] || 'text-indigo-400';
    const icon = icons[type] || 'info';

    toast.className = `toast group opacity-0 translate-x-10`;
    toast.innerHTML = `
        <div class="flex items-start gap-4">
            <div class="w-8 h-8 rounded-xl bg-white/5 flex items-center justify-center shrink-0 ${typeCol}">
                <i data-lucide="${icon}" class="w-5 h-5"></i>
            </div>
            <div class="flex-1 pt-0.5">
                <div class="flex justify-between items-center mb-1">
                    <span class="text-[9px] font-black uppercase tracking-[0.2em] ${typeCol}">${type}</span>
                    <span class="text-[8px] font-bold text-gray-600">JUST NOW</span>
                </div>
                <p class="text-xs font-medium text-white/90 leading-relaxed">${msg}</p>
            </div>
        </div>
    `;
    
    container.appendChild(toast);
    if (typeof lucide !== 'undefined') lucide.createIcons();

    // Entrance animation
    requestAnimationFrame(() => {
        toast.classList.remove('opacity-0', 'translate-x-10');
        toast.classList.add('opacity-100', 'translate-x-0', 'show');
    });

    const duration = window.innerWidth <= 768 ? 2500 : 3500;

    setTimeout(() => {
        toast.classList.remove('translate-x-0');
        toast.classList.add('translate-x-[120%]', 'opacity-0');
        setTimeout(() => toast.remove(), 500);
    }, duration);
}

function applyApiConfig() {
    isDemo = false;
    if(mockInterval) clearInterval(mockInterval);
    
    API_KEY = document.getElementById('api-key').value;
    API_SECRET = document.getElementById('api-secret').value;
    
    if(!API_KEY || !API_SECRET) {
        showNotify("Please enter API Key and Secret", "warning");
        return;
    }

    document.getElementById('conn-status').classList.replace('bg-slate-500', 'bg-warning');
    document.getElementById('conn-text').innerText = "connecting...";
    
    startWebSocket();
    fetchData();
    setInterval(fetchData, 3000);
    loadSymbolBrackets();
}

function activateDemoMode() {
    isDemo = true;
    if(mockInterval) clearInterval(mockInterval);
    
    API_KEY = "DEMO_MODE_KEY_XXXXX";
    API_SECRET = "DEMO_MODE_SECRET_XXXXX";
    document.getElementById('api-key').value = API_KEY;
    document.getElementById('api-secret').value = API_SECRET;

    // Set mock balance
    balance = { total: 10000, available: 10000, marginRatio: 1.2 };
    document.getElementById('acc-balance').innerText = `$${fNum(balance.total)} USDT`;
    document.getElementById('acc-available').innerText = `$${fNum(balance.available)} USDT`;
    document.getElementById('acc-margin').innerText = balance.marginRatio.toFixed(2) + "%";
    
    if(!initializedAmount) {
        setAmountPct(0.10);
        initializedAmount = true;
    }
    
    // Set mock positions
    positions = [
        { symbol: 'BTCUSDT', positionAmt: '0.05', entryPrice: '62000', leverage: 20, markPrice: '62100' },
        { symbol: 'ETHUSDT', positionAmt: '-2.5', entryPrice: '3100', leverage: 10, markPrice: '3080' }
    ];
    
    // Set mock orders
    orders = [
        { symbol: 'SOLUSDT', orderId: 999123, side: 'BUY', price: '120.5', origQty: '10', executedQty: '0', type: 'LIMIT', status: 'NEW' },
        { symbol: 'BTCUSDT', orderId: 999124, side: 'SELL', price: '65000', origQty: '0.1', executedQty: '0.05', type: 'LIMIT', status: 'PARTIALLY_FILLED' }
    ];

    document.getElementById('conn-status').classList.replace('bg-slate-500', 'bg-success');
    document.getElementById('conn-status').classList.add('shadow-[0_0_8px_#22C55E]');
    document.getElementById('conn-text').innerText = "Demo Connected";
    document.getElementById('conn-text').classList.add('text-success');

    startWebSocket(); // keep prices moving
    renderPositions();
    renderOrders();
    loadSymbolBrackets();
}

function startWebSocket() {
    if(ws) ws.close();
    ws = new WebSocket('wss://fstream.binance.com/stream?streams=!miniTicker@arr');
    
    ws.onmessage = (event) => {
        const payload = JSON.parse(event.data);
        if(payload && payload.data) {
            const arr = payload.data;
            let tickerHtml = "";
            for(let item of arr) {
                prices[item.s] = parseFloat(item.c);
                if(item.s === document.getElementById('trade-pair').value) {
                    document.getElementById('trade-mark').value = parseFloat(item.c).toFixed(4);
                }
                // Removed ticker HTML rendering
            }
            renderPositions(); // Update PNL live
        }
    };
    
    ws.onopen = () => {
        document.getElementById('conn-status').classList.replace('bg-warning', 'bg-success');
        document.getElementById('conn-status').classList.add('shadow-[0_0_8px_#22C55E]');
        document.getElementById('conn-text').innerText = "connected";
        document.getElementById('conn-text').classList.add('text-success');
    };
}

async function api(path, body = {}) {
    body.apiKey = API_KEY;
    body.apiSecret = API_SECRET;
    try {
        const result = await fetch(`${ENDPOINT}${path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const data = await result.json();
        if(data.error) throw data.error;
        return data;
    } catch(e) {
        console.error("API error", e);
        throw e;
    }
}

async function fetchData() {
    if(isDemo) {
        if(!initializedAmount) {
            balance.available = 10000;
            balance.total = 10000;
            document.getElementById('acc-balance').innerText = `$${fNum(balance.total)} USDT`;
            document.getElementById('acc-available').innerText = `$${fNum(balance.available)} USDT`;
            setAmountPct(0.10);
            initializedAmount = true;
        }
        renderPositions();
        renderOrders();
        return;
    }
    if(!API_KEY || !API_SECRET) return;
    try {
        // 1. Account Info
        const accInfo = await api('/api/account');
        if(accInfo && accInfo.assets) {
            const usdtAsset = accInfo.assets.find(a => a.asset === 'USDT');
            if(usdtAsset) {
                balance.total = parseFloat(usdtAsset.walletBalance);
                balance.available = parseFloat(usdtAsset.availableBalance);
                document.getElementById('acc-balance').innerText = `$${fNum(balance.total)} USDT`;
                document.getElementById('acc-available').innerText = `$${fNum(balance.available)} USDT`;
            }
            // Maint Margin Ratio = Maint Margin / Margin Balance * 100
            const totalMaint = parseFloat(accInfo.totalMaintMargin);
            const totalMarginBal = parseFloat(accInfo.totalMarginBalance);
            if(totalMarginBal > 0) {
                balance.marginRatio = (totalMaint / totalMarginBal) * 100;
                document.getElementById('acc-margin').innerText = balance.marginRatio.toFixed(2) + "%";
            }
            
            if(!initializedAmount && balance.available > 0) {
                setAmountPct(0.10);
                initializedAmount = true;
            }
        }
        
        // 2. Positions
        const posData = await api('/api/positions');
        positions = posData;
        
        // 3. Orders
        const ordData = await api('/api/orders');
        orders = ordData;
        
        // --- SMART TRAILING LOGIC ---
        checkAutoTrailing();
        
        renderPositions();
        renderOrders();
    } catch(err) {
        console.log(err);
    }
}

function renderPositions() {
    const list = document.getElementById('positions-list');
    if(!positions || positions.length === 0) {
        list.innerHTML = `<div class="text-center py-12 text-gray-500 italic text-xs border-2 border-dashed border-white/5 rounded-3xl">Waiting for active positions...</div>`;
        return;
    }
    
    let html = "";
    for(let p of positions) {
        const amt = parseFloat(p.positionAmt);
        if(amt === 0) continue;
        
        const isLong = amt > 0;
        const entryPrice = parseFloat(p.entryPrice);
        const lev = p.leverage;
        const mark = prices[p.symbol] || parseFloat(p.markPrice);
        
        let unPnl = (mark - entryPrice) * amt;
        let pnlPct = (unPnl / (Math.abs(amt)*entryPrice / lev))*100 || 0;
        
        const typeCol = isLong ? 'text-success' : 'text-danger';
        const typeText = isLong ? 'LONG' : 'SHORT';
        const pnlCol = unPnl >= 0 ? 'text-success' : 'text-danger';
        const cClass = isLong ? 'pos-card-long' : 'pos-card-short';
        const pSign = unPnl >= 0 ? '+' : '';
        
        const isShieldActive = trailingShields[p.symbol]?.active || false;
        const formattedSymbol = p.symbol.replace('USDT', '').replace('USDC', '');
        
        const existingSL = orders.find(o => o.symbol === p.symbol && o.type === 'STOP_MARKET');
        const slValue = existingSL ? parseFloat(existingSL.stopPrice || existingSL.price).toFixed(2) : "";

        html += `
        <div class="pos-card ${cClass}">
            <div class="flex items-center justify-between relative z-10 gap-4">
                <!-- Pair & Type -->
                <div class="flex items-center gap-4 min-w-[140px]">
                    <div class="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center shrink-0 border border-white/5">
                         <span class="text-[10px] font-black text-indigo-400">${formattedSymbol.charAt(0)}</span>
                    </div>
                    <div class="flex flex-col">
                        <span onclick="selectPairFromPosition('${p.symbol}', ${lev})" 
                              class="font-black text-sm text-white tracking-tight cursor-pointer hover:text-indigo-400 transition-colors uppercase">${formattedSymbol}<span class="text-gray-600 font-bold">/USDT</span></span>
                        <span class="${typeCol} text-[8px] font-black uppercase tracking-[0.2em] mt-0.5">${typeText} ${lev}X</span>
                    </div>
                </div>

                <!-- Stats Grid -->
                <div class="flex items-center gap-8 text-[10px] flex-1 justify-center">
                    <div class="flex flex-col">
                        <span class="text-gray-600 font-bold uppercase tracking-tighter mb-0.5">Entry Price</span>
                        <span class="font-mono font-bold text-gray-300">$${fNum(entryPrice, 2)}</span>
                    </div>
                    <div class="flex flex-col">
                        <span class="text-gray-600 font-bold uppercase tracking-tighter mb-0.5">Position Value</span>
                        <span class="font-mono font-bold text-gray-300">$${fNum(Math.abs(amt)*mark, 1)}</span>
                    </div>
                    <div class="flex flex-col">
                         <span class="text-danger/60 font-black uppercase tracking-tighter mb-0.5">STOP LOSS</span>
                         <div class="flex items-center gap-1 group">
                             <span class="text-gray-600 font-bold">$</span>
                             <input type="number" step="0.01" value="${slValue}" 
                                    class="sl-input w-20 text-[10px] h-6 px-1 focus:ring-1 focus:ring-indigo-500/50 outline-none transition-all"
                                    onchange="updateStoploss('${p.symbol}', this.value)">
                         </div>
                    </div>
                </div>

                <!-- PNL & Actions -->
                <div class="flex items-center gap-6">
                    <div class="text-right">
                        <p class="text-xs font-black uppercase tracking-widest text-gray-600 mb-0.5">Net PNL</p>
                        <p class="text-lg font-black ${pnlCol} tracking-tight leading-none">${pSign}$${fNum(Math.abs(unPnl), 2)}</p>
                        <p class="text-[10px] font-black ${pnlCol} opacity-80 mt-1">${pSign}${pnlPct.toFixed(2)}%</p>
                    </div>
                    
                    <div class="flex items-center gap-2">
                        <button onclick="toggleShield(event, '${p.symbol}')"
                                class="w-10 h-10 rounded-xl border transition-all active:scale-95 flex items-center justify-center
                                ${isShieldActive ? 'bg-indigo-500 border-indigo-500 text-white shadow-lg shadow-indigo-500/20' : 'bg-white/5 border-white/10 text-gray-500 hover:text-indigo-400'}">
                            <i data-lucide="${isShieldActive ? 'shield-check' : 'shield'}" class="w-5 h-5"></i>
                        </button>
                        <button onclick="confirmCloseMarket(event, '${p.symbol}', ${amt}, ${unPnl})"
                                class="w-10 h-10 rounded-xl bg-danger/10 border border-danger/20 text-danger flex items-center justify-center active:scale-95 hover:bg-danger hover:text-white transition-all shadow-lg hover:shadow-danger/20">
                            <i data-lucide="power" class="w-4 h-4"></i>
                        </button>
                    </div>
                </div>
            </div>
        </div>
        `;
    }
    list.innerHTML = html;
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

function validateSymbolInput(inputEl) {
    let val = inputEl.value.trim().toUpperCase();
    if (!val) return;

    // Normalization logic: SOL -> SOLUSDT, BTC -> BTCUSDT
    if (!val.endsWith('USDT') && !val.endsWith('USDC')) {
        val += 'USDT';
    }
    
    inputEl.value = val;
    showNotify(`Scanning Symbol: ${val}...`, "info");

    // We can "check" validity if prices has the symbol
    setTimeout(() => {
        if (prices[val]) {
            showNotify(`✅ Valid Symbol: ${val}`, "success");
            loadSymbolBrackets();
        } else if (isDemo) {
            showNotify(`✅ Demo Simulated: ${val}`, "success");
            loadSymbolBrackets();
        } else {
             showNotify(`❌ Symbol not found: ${val}. Verify manually.`, "warning");
        }
    }, 500);
}

async function updateStoploss(symbol, stopPrice) {
    if(!stopPrice || stopPrice <= 0) return;
    
    // Find the current position
    const pos = positions.find(p => p.symbol === symbol);
    if (!pos) return;

    showNotify(`Updating Stoploss for ${symbol} to $${stopPrice}...`, "info");
    
    const amt = parseFloat(pos.positionAmt);
    const side = amt > 0 ? "SELL" : "BUY";
    const qty = Math.abs(amt);

    if(isDemo) {
        // Remove existing SL orders for this symbol
        orders = orders.filter(o => !(o.symbol === symbol && o.type === 'STOP_MARKET'));
        // Add new SL order
        orders.push({
            symbol: symbol,
            orderId: Math.floor(Math.random() * 900000),
            side: side,
            price: '0',
            stopPrice: stopPrice.toString(),
            origQty: qty.toString(),
            executedQty: '0',
            type: 'STOP_MARKET',
            status: 'NEW'
        });
        showNotify(`Stoploss updated to $${stopPrice} (Demo)`, "success");
        renderOrders();
        return;
    }

    try {
        // 1. Cancel existing SLs
        const existingSLs = orders.filter(o => o.symbol === symbol && o.type === 'STOP_MARKET');
        for(let osl of existingSLs) {
            await api('/api/cancel', { symbol, orderId: osl.orderId });
        }
        
        // 2. Place new SL
        await api('/api/trade', {
            symbol: symbol,
            side: side,
            type: 'STOP_MARKET',
            quantity: qty,
            stopPrice: parseFloat(stopPrice)
        });
        
        showNotify(`Stoploss updated successfully!`, "success");
        fetchData();
    } catch(err) {
        showNotify("Failed to update Stoploss: " + (err.msg || "Error"), "error");
    }
}

function selectPairFromPosition(symbol, leverage) {
    const inputEl = document.getElementById('trade-pair');
    inputEl.value = symbol.toUpperCase();
    
    // Trigger change event to load brackets and update labels
    inputEl.dispatchEvent(new Event('change'));
    loadSymbolBrackets(); // Direct call for reliability
    
    document.getElementById('trade-leverage').value = leverage || 10;
    
    // smooth UI scroll
    inputEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    showNotify(`Switched to ${symbol}`, "info");
}

function toggleShield(event, symbol) {
    event.stopPropagation();
    
    // Find the current position
    const pos = positions.find(p => p.symbol === symbol);
    if (!pos) return;

    // Initialize state if not exists
    if (!trailingShields[symbol]) {
        const side = parseFloat(pos.positionAmt) > 0 ? "BUY" : "SELL";
        trailingShields[symbol] = {
            active: false, // Start false then toggle below
            side: side,
            initialMargin: parseFloat(document.getElementById('trade-amount').value) || 0,
            stepPct: parseFloat(document.getElementById('trade-step-pct').value) || 1,
            leverage: pos.leverage,
            baseEntry: parseFloat(pos.entryPrice),
            stoploss: 0,
            filledCount: 0,
            batchSize: 5
        };
    }

    const willEnable = !trailingShields[symbol].active;

    if (willEnable) {
        trailingShields[symbol].active = true;
        showNotify(`🛡️ Pyramiding RE-ACTIVATED for ${symbol}! Shield is Yellow.`, "success");
    } else {
        trailingShields[symbol].active = false;
        showNotify(`🛡️ Pyramiding STOPPED for ${symbol}. Shield is Red.`, "error");
    }
    renderPositions();
}

function closeCloseModal() {
    document.getElementById('close-modal-overlay').style.display = 'none';
}

function confirmCloseMarket(event, symbol, amt, pnl) {
    event.stopPropagation();
    
    document.getElementById('close-modal-pair').innerText = symbol;
    const pnlEl = document.getElementById('close-modal-pnl');
    pnlEl.innerText = `${pnl >= 0 ? '+' : ''}${fNum(pnl, 2)} USDT`;
    pnlEl.className = `text-xl font-black ${pnl >= 0 ? 'text-success' : 'text-danger'}`;
    
    const confirmBtn = document.getElementById('close-modal-confirm-btn');
    confirmBtn.onclick = () => executeCloseMarket(symbol, amt);
    
    document.getElementById('close-modal-overlay').style.display = 'flex';
}

async function executeCloseMarket(symbol, amt) {
    closeCloseModal();
    showNotify(`Closing ${symbol} position...`, "info");
    
    const side = amt > 0 ? "SELL" : "BUY";
    const qty = Math.abs(amt);
    
    if(isDemo) {
        positions = positions.filter(p => p.symbol !== symbol);
        showNotify(`Position for ${symbol} Closed (Demo)`, "success");
        fetchData();
        return;
    }
    
    try {
        await api('/api/trade', {
            symbol: symbol,
            side: side,
            type: 'MARKET',
            quantity: qty,
            reduceOnly: true
        });
        showNotify(`${symbol} Position Closed!`, "success");
        fetchData();
    } catch(err) {
        showNotify("Error closing position: " + (err.msg || "Unknown error"), "error");
    }
}

async function moveStopToBreakeven(symbol) {
    const pos = positions.find(p => p.symbol === symbol);
    if (!pos) return;
    
    showNotify(`🛡️ Moving SL to Breakeven for ${symbol}...`, "info");
    
    const side = parseFloat(pos.positionAmt) > 0 ? "SELL" : "BUY";
    const entry = parseFloat(pos.entryPrice);
    const qty = Math.abs(parseFloat(pos.positionAmt));

    // Guess decimals
    let slDecs = 4;
    if (entry < 10) slDecs = 1; else if (entry < 50) slDecs = 2; else if (entry < 1000) slDecs = 3;

    const slPayload = {
        symbol: symbol,
        side: side,
        type: 'STOP_MARKET',
        quantity: qty,
        stopPrice: entry
    };

    if (isDemo) {
        // Find existing SL if any and replace
        orders = orders.filter(o => o.symbol === symbol && o.type !== 'STOP_MARKET');
        orders.push({
            symbol: symbol,
            orderId: Math.floor(Math.random()*90000),
            side: side,
            price: entry,
            origQty: qty.toString(),
            executedQty: '0',
            type: 'STOP_MARKET',
            status: 'NEW'
        });
        showNotify(`🛡️ [DEMO] SL moved to ${entry}`, "success");
    } else {
        try {
            // Cancel existing SLs first
            const existingSLs = orders.filter(o => o.symbol === symbol && o.type === 'STOP_MARKET');
            for(let osl of existingSLs) {
                await api('/api/cancel', { symbol, orderId: osl.orderId });
            }
            await api('/api/trade', slPayload);
            showNotify(`🛡️ SL secured at Breakeven!`, "success");
        } catch(e) {
            console.error("Shield move error", e);
            showNotify(`🛡️ Shield failed to move SL.`, "error");
        }
    }
}

async function checkAutoTrailing() {
    // Demo Mock Execution: Simulate fills based on price movements
    if (isDemo && positions.length > 0) {
        for (let p of positions) {
            const mark = prices[p.symbol] || parseFloat(p.markPrice);
            const pending = orders.filter(o => o.symbol === p.symbol);
            
            for (let o of pending) {
                const triggerPrice = parseFloat(o.stopPrice || o.price);
                const side = o.side;
                let filled = false;
                
                if (o.type === 'STOP_MARKET') {
                    if (side === 'BUY' && mark >= triggerPrice) filled = true;
                    if (side === 'SELL' && mark <= triggerPrice) filled = true;
                } else if (o.type === 'LIMIT') {
                    if (side === 'BUY' && mark <= triggerPrice) filled = true;
                    if (side === 'SELL' && mark >= triggerPrice) filled = true;
                }
                
                if (filled) {
                    const qty = parseFloat(o.origQty);
                    p.positionAmt = (parseFloat(p.positionAmt) + (side === 'BUY' ? qty : -qty)).toString();
                    orders = orders.filter(ord => ord.orderId !== o.orderId);
                    showNotify(`[DEMO] Order Filled at ${triggerPrice}!`, "success");
                }
            }
        }
    }

    for (let symbol in trailingShields) {
        const s = trailingShields[symbol];
        if (!s || !s.active) continue;
        
        const pos = positions.find(p => p.symbol === symbol);
        if (!pos) {
            delete trailingShields[symbol]; // Clean up if pos closed
            continue;
        }

        const currentSize = Math.abs(parseFloat(pos.positionAmt));
        const entry = parseFloat(pos.entryPrice);
        
        // 1. Detect if an order was filled
        // Strategy: If currentSize > lastKnownSize (we need to track lastKnownSize)
        if (!s.lastKnownSize) {
            s.lastKnownSize = currentSize;
            continue;
        }

        if (currentSize > s.lastKnownSize + 0.0000001) {
            showNotify(`📈 Order filled for ${symbol}! Adjusting SL...`, "success");
            s.lastKnownSize = currentSize;
            s.filledCount++;
            
            // Move SL to Breakeven (New Entry)
            await moveStopToBreakeven(symbol);

            // 2. Check if we need a refill (all 5 of the current batch filled)
            if (s.filledCount > 0 && s.filledCount % s.batchSize === 0) {
                const batchIndex = Math.floor(s.filledCount / s.batchSize);
                await setupConditionalBatch(symbol, batchIndex);
            }
        }

        // 3. Fallback: Ensure SL always matches current size if batch changed manually
        const existingSL = orders.find(o => o.symbol === symbol && o.type === 'STOP_MARKET');
        if (existingSL) {
            const slQty = parseFloat(existingSL.origQty);
            if (Math.abs(slQty - currentSize) > 0.0001) {
                 // Update SL quantity to match full position
                 await moveStopToBreakeven(symbol);
            }
        }
    }
}

function renderOrders() {
    const list = document.getElementById('orders-list');
    if(!orders || orders.length === 0) {
        list.innerHTML = `<tr><td colspan="7" class="py-12 text-center text-gray-500 italic text-xs">No pending orders in the pipeline</td></tr>`;
        return;
    }
    
    let html = "";
    for(let o of orders) {
        const isBuy = o.side === 'BUY';
        const col = isBuy ? 'text-success' : 'text-danger';
        const price = parseFloat(o.stopPrice || o.price);
        
        html += `
        <tr class="hover:bg-white/[0.01] transition-colors group">
            <td class="py-4 px-6">
                <div class="flex items-center gap-3">
                    <div class="w-1.5 h-6 rounded-full ${isBuy ? 'bg-success/20' : 'bg-danger/20'} border-l-2 ${isBuy ? 'border-success' : 'border-danger'}"></div>
                    <span class="font-black text-white tracking-tight uppercase">${o.symbol}</span>
                </div>
            </td>
            <td class="py-4 px-6 font-mono text-gray-500 text-[10px]">#${String(o.orderId).slice(-6)}</td>
            <td class="py-4 px-6 text-center">
                <span class="px-2 py-0.5 rounded-lg bg-white/5 font-black text-[9px] ${col}">${o.side}</span>
            </td>
            <td class="py-4 px-6 font-mono font-bold text-gray-200">$${fNum(price, 2)}</td>
            <td class="py-4 px-6 text-gray-400 font-medium">${fNum(o.origQty, 3)} <span class="text-[10px] opacity-40">Qty</span></td>
            <td class="py-4 px-6">
                <span class="text-[10px] font-black text-indigo-400/80 uppercase tracking-tighter">${o.type.replace('_', ' ')}</span>
            </td>
            <td class="py-4 px-6 text-right">
                <button onclick="cancelOrder('${o.symbol}', ${o.orderId})" 
                        class="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center hover:bg-danger/10 hover:text-danger border border-transparent hover:border-danger/20 transition-all active:scale-90">
                    <i data-lucide="x" class="w-3.5 h-3.5"></i>
                </button>
            </td>
        </tr>
        `;
    }
    list.innerHTML = html;
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

function closeOrderModal() {
    document.getElementById('modal-overlay').style.display = 'none';
}

async function placeOrder(side) {
    if(!API_KEY) return showNotify("Please configure API credentials first.", "error");
    
    // UI values
    const symbol = document.getElementById('trade-pair').value;
    const isLimit = parseFloat(document.getElementById('trade-entry').value) > 0;
    const baseEntry = isLimit ? parseFloat(document.getElementById('trade-entry').value) : (prices[symbol] || parseFloat(document.getElementById('trade-mark').value));
    
    const amountVal = parseFloat(document.getElementById('trade-amount').value);
    const unit = document.getElementById('trade-unit').value || 'USDT';
    const leverage = parseInt(document.getElementById('trade-leverage').value);
    const stoploss = parseFloat(document.getElementById('trade-sl').value);
    const orderCount = 5; // Automatic Pyramiding Mode (1 Initial + 5 Pending)
    const stepPct = parseFloat(document.getElementById('trade-step-pct').value) || 0;
    
    if(amountVal <= 0 || isNaN(amountVal)) return showNotify("Invalid amount.", "warning");
    if(!baseEntry || isNaN(baseEntry) || baseEntry <= 0) return showNotify("Invalid entry or mark price not found", "error");

    // Prepare planned orders for modal - Showing only the FIRST order + 5 pending
    let plannedOrders = [];
    let modalListHtml = "";
    
    for (let i = 0; i <= 5; i++) { // 1 Initial + 5 Pending
        let currentPrice = baseEntry;
        if (i > 0) {
           const priceOffset = baseEntry * (stepPct / 100) * i;
           currentPrice = side === 'BUY' ? (baseEntry + priceOffset) : (baseEntry - priceOffset);
        }
        
        let quantity = amountVal / currentPrice;

        // Precision logic
        let decimals = 3;
        if (currentPrice < 0.001) decimals = 0;
        else if (currentPrice < 1) decimals = 0;
        else if (currentPrice < 10) decimals = 1;
        else if (currentPrice < 50) decimals = 2;
        else if (currentPrice < 1000) decimals = 3;
        else decimals = 4;

        const pow = Math.pow(10, decimals);
        quantity = Math.floor(quantity * pow) / pow;

        const p = {
            num: i + 1,
            price: i === 0 && !isLimit ? "MARKET" : `$${fNum(currentPrice, 4)}`,
            qty: `${fNum(quantity, decimals)} Coins`,
            rawPrice: currentPrice,
            rawQty: quantity
        };
        plannedOrders.push(p);
        modalListHtml += `<tr><td class="py-2 px-4">${p.num}</td><td class="py-2 px-4">${p.price}</td><td class="py-2 px-4 text-right">${p.qty}</td></tr>`;
    }

    // Update Modal UI
    const sideClass = side === 'BUY' ? 'bg-success text-white' : 'bg-danger text-white';
    const btnClass = side === 'BUY' ? 'trade-btn-long' : 'trade-btn-short';
    
    document.getElementById('modal-title-side').innerText = side;
    document.getElementById('modal-title-side').className = `px-4 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest ${sideClass}`;
    document.getElementById('modal-pair-label').innerText = symbol;
    document.getElementById('modal-total-margin').innerText = `${fNum(amountVal)} ${unit}`;
    document.getElementById('modal-lev-val').innerText = `x${leverage}`;
    document.getElementById('modal-sl-val').innerText = stoploss > 0 ? `$${fNum(stoploss, 4)}` : "None";
    document.getElementById('modal-strat-val').innerText = `Auto-Pyramid (${stepPct}% Step)`;
    document.getElementById('modal-order-list').innerHTML = modalListHtml;
    
    const confirmBtn = document.getElementById('modal-confirm-btn');
    confirmBtn.className = `flex-[2] py-5 rounded-2xl text-[10px] font-black uppercase tracking-widest btn-premium ${btnClass}`;
    
    confirmBtn.onclick = () => executeOrderSequence(side, symbol, baseEntry, amountVal, unit, leverage, stoploss, orderCount, stepPct, isLimit);
    document.getElementById('modal-overlay').style.display = 'flex';
}

async function executeOrderSequence(side, symbol, baseEntry, amountVal, unit, leverage, stoploss, orderCount, stepPct, isLimit) {
    closeOrderModal();
    showNotify(`Starting Pyramiding (Nhồi lệnh) for ${symbol}...`, "info");

    try {
        // 1. Setup Leverage first
        if (!isDemo) {
            await api('/api/leverage', { symbol, leverage });
        }

        // 2. Prepare first order quantity
        let firstQty = amountVal;
        const entryPriceForQty = isLimit ? baseEntry : (prices[symbol] || baseEntry);
        
        if (unit === 'USDT' || unit === 'USDC') {
            firstQty = amountVal / entryPriceForQty;
        }

        // Precision logic for quantity
        let decimals = 3;
        if (entryPriceForQty < 10) decimals = 1; else if (entryPriceForQty < 1000) decimals = 3; else decimals = 4;
        const pow = Math.pow(10, decimals);
        firstQty = Math.floor(firstQty * pow) / pow;

        const firstOrderPayload = {
            symbol: symbol,
            side: side,
            type: isLimit ? 'LIMIT' : 'MARKET',
            quantity: firstQty,
            leverage: leverage
        };
        if (isLimit) firstOrderPayload.price = baseEntry;

        let res;
        if (isDemo) {
            res = { orderId: Math.floor(Math.random() * 1000000) };
            
            if (isLimit) {
                // Add to Pending Orders for Demo
                orders.push({
                    symbol: symbol,
                    orderId: res.orderId,
                    side: side,
                    price: baseEntry.toString(),
                    origQty: firstQty.toString(),
                    executedQty: '0',
                    type: 'LIMIT',
                    status: 'NEW'
                });
            } else {
                // Immediate fill for Market orders in Demo
                const existingPos = positions.find(p => p.symbol === symbol);
                if (existingPos) {
                    existingPos.positionAmt = (parseFloat(existingPos.positionAmt) + (side === 'BUY' ? firstQty : -firstQty)).toString();
                    existingPos.entryPrice = entryPriceForQty.toString();
                    existingPos.leverage = leverage;
                } else {
                    positions.push({
                        symbol,
                        positionAmt: (side === 'BUY' ? firstQty : -firstQty).toString(),
                        entryPrice: entryPriceForQty.toString(),
                        leverage,
                        markPrice: entryPriceForQty.toString()
                    });
                }
            }
        } else {
            res = await api('/api/trade', firstOrderPayload);
        }

        // 3. Initialize Pyramiding State (The "Shield")
        trailingShields[symbol] = {
            active: true,
            side: side,
            initialMargin: amountVal,
            unit: unit,
            stepPct: stepPct,
            leverage: leverage,
            baseEntry: baseEntry,
            stoploss: stoploss,
            filledCount: 0,
            batchSize: 5,
            lastBatchFilled: false
        };

        // 4. Place initial 5 conditional orders (STOP_MARKET)
        // If Long: price increases (Trend following pyramid) -> Buy Stop Market at baseEntry + offset
        // If Short: price decreases -> Sell Stop Market at baseEntry - offset
        await setupConditionalBatch(symbol, 0);

        // 5. Place Initial Stoploss if provided
        if (stoploss > 0) {
            await updateStoploss(symbol, stoploss);
        }

        showNotify(`Pyramid active for ${symbol}! Shield started.`, "success");
        renderPositions();
        fetchData();
    } catch(e) {
        console.error("Sequence Error", e);
        showNotify("Execution Error: " + (e.message || e.msg || "Check API"), "error");
    }
}

async function setupConditionalBatch(symbol, batchIndex) {
    const s = trailingShields[symbol];
    if (!s || !s.active) return;

    showNotify(`Setting up 5 conditional orders for ${symbol}...`, "info");
    
    // We start from price offset based on batchIndex
    const startOffset = batchIndex * s.batchSize + 1;
    
    for (let i = 0; i < s.batchSize; i++) {
        const orderNum = startOffset + i;
        const priceOffset = s.baseEntry * (s.stepPct / 100) * orderNum;
        const triggerPrice = s.side === 'BUY' ? (s.baseEntry + priceOffset) : (s.baseEntry - priceOffset);
        
        let qty = s.initialMargin / triggerPrice;
        let decimals = 3;
        if (triggerPrice < 10) decimals = 1; else if (triggerPrice < 1000) decimals = 3; else decimals = 4;
        qty = Math.floor(qty * Math.pow(10, decimals)) / Math.pow(10, decimals);

        const payload = {
            symbol: symbol,
            side: s.side,
            type: 'STOP_MARKET',
            quantity: qty,
            stopPrice: triggerPrice,
            reduceOnly: false
        };

        if (isDemo) {
            orders.push({
                symbol, orderId: Math.floor(Math.random() * 1000000), side: s.side,
                price: '0', stopPrice: triggerPrice.toString(), origQty: qty.toString(),
                executedQty: '0', type: 'STOP_MARKET', status: 'NEW'
            });
        } else {
            try {
                await api('/api/trade', payload);
            } catch(err) {
                showNotify(`Order #${orderNum} failed`, "error");
            }
        }
    }
}


async function cancelOrder(symbol, orderId) {
    if(isDemo) {
       orders = orders.filter(o => o.orderId !== orderId);
       fetchData();
       showNotify("Demo Order Cancelled", "info");
       return;
    }
    if(!API_KEY) return;
    try {
        await api('/api/cancel', { symbol, orderId });
        fetchData();
    } catch(e) {
        showNotify("Cancel Error: " + (e.msg || JSON.stringify(e)), "error");
    }
}

function setAmountPct(pct) {
    if(balance.available <= 0) return;
    
    const marginToUse = balance.available * pct;
    let valStr = marginToUse < 10 ? marginToUse.toFixed(2) : Math.floor(marginToUse).toString();
    
    document.getElementById('trade-amount').value = valStr;

    // Reset all buttons
    const btns = document.querySelectorAll('button[onclick^="setAmountPct"]');
    btns.forEach(b => {
        b.classList.remove('bg-indigo-500', 'text-white', 'shadow-lg', 'shadow-indigo-500/20');
        b.classList.add('bg-white/5', 'text-gray-400');
    });
    
    // Find the one clicked
    const target = Array.from(btns).find(b => b.getAttribute('onclick').includes(pct.toString()));
    if(target) {
        target.classList.remove('bg-white/5', 'text-gray-400');
        target.classList.add('bg-indigo-500', 'text-white', 'shadow-lg', 'shadow-indigo-500/20');
    }
}

async function loadSymbolBrackets() {
    const symbol = document.getElementById('trade-pair').value;
    
    if(isDemo) {
       document.getElementById('disp-max-lev').innerText = "Max 125x (Demo)";
       document.getElementById('trade-leverage').value = 125;
       return;
    }
    
    if(!API_KEY) return;
    try {
        const data = await api('/api/brackets', { symbol });
        if(data && data.length > 0 && data[0].brackets) {
            let maxLev = 1;
            for(let b of data[0].brackets) {
                if(b.initialLeverage > maxLev) maxLev = b.initialLeverage;
            }
            document.getElementById('disp-max-lev').innerText = "Max " + maxLev + "x";
            document.getElementById('trade-leverage').value = maxLev;
        }
    } catch(e) {
        console.log("Failed to load brackets", e);
    }
}

document.getElementById('trade-pair').addEventListener('change', (e) => {
    document.getElementById('disp-max-lev').innerText = "Max ...";
    loadSymbolBrackets();
});

// Initial call if credentials are set
// setTimeout(loadSymbolBrackets, 1000);

function handleQRUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement("canvas");
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext("2d");
            ctx.drawImage(img, 0, 0);
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const code = jsQR(imageData.data, imageData.width, imageData.height);
            
            if (code && code.data) {
                try {
                    const cleanKey = (str) => {
                        if(typeof str !== 'string') return '';
                        return str.replace(/[^a-zA-Z0-9]/g, ''); // Binance keys are strict alphanumeric
                    };

                    let k = '';
                    let s = '';

                    // Try parsing as JSON first
                    try {
                        const obj = JSON.parse(code.data);
                        k = cleanKey(obj.apiKey || obj.key || obj.API_KEY || obj.apikey);
                        s = cleanKey(obj.apiSecret || obj.secret || obj.API_SECRET || obj.apisecret);
                    } catch(e) {}

                    // Fallback to text split if JSON fails or incomplete
                    if (!k || !s) {
                        const parts = code.data.split(/[:,|\n]/).map(p => cleanKey(p)).filter(p => p.length > 50); // Binance keys are 64 chars typically
                        if(parts.length >= 2) {
                            k = parts[0];
                            s = parts[1];
                        }
                    }

                    if(k && s) {
                        document.getElementById('api-key').value = k;
                        document.getElementById('api-secret').value = s;
                        showNotify("✅ API Keys imported successfully from QR!", "success");
                        applyApiConfig();
                    } else {
                        showNotify("❌ Could not parse valid API Keys from the QR content.", "error");
                    }
                } catch(err) {
                    console.error("QR Parse Error", err);
                    showNotify("❌ Error processing QR code.", "error");
                }
            } else {
                showNotify("❌ No QR code found in the image. Please try another clearer image.", "warning");
            }
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
    event.target.value = ""; // reset file input
}
