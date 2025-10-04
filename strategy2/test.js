// File: D:\master controller\test\test.js (Refactored)
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') }); // Load .env from parent
const TelegramBot = require("node-telegram-bot-api");
const fs = require('fs');
const moment = require("moment-timezone");
const MasterController = require('../universal websocket/index.js'); // Use the upgraded MC

const POSITIONS_FILE = path.join(__dirname, 'positions.json');
const UPDATED_JSON_FILE = path.join(__dirname, 'updated.json');
const DAILY_REPORT_FILE = path.join(__dirname, 'daily_report.json');

// --- Helper Functions ---
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function loadStocks() {
    try {
        if (!fs.existsSync(UPDATED_JSON_FILE)) {
             console.warn(`⚠️ ${UPDATED_JSON_FILE} not found. Starting with empty stocks list.`);
             return [];
        }
        return JSON.parse(fs.readFileSync(UPDATED_JSON_FILE, 'utf-8'));
    } catch (e) {
        console.error(`❌ Error reading/parsing ${UPDATED_JSON_FILE}:`, e.message);
        return [];
    }
}

function savePositions(positions) {
    try {
        const data = Array.from(positions.values()).map(p => ({
            ...p,
            token: p.token,
            symbol: p.symbol,
            expiry: p.expiry ? p.expiry.toISOString() : null,
            buyTime: p.buyTime ? p.buyTime.toISOString() : null,
        }));
        fs.writeFileSync(POSITIONS_FILE, JSON.stringify(data, null, 2));
    } catch (e) {
         console.error("❌ Error saving positions:", e.message);
    }
}

function loadPositions(allStocks) {
    try {
        if (!fs.existsSync(POSITIONS_FILE)) return new Map();
        const data = JSON.parse(fs.readFileSync(POSITIONS_FILE, 'utf8'));
        const loadedPositions = new Map();

        data.forEach(p => {
            if (!p.token) {
                 console.warn("Skipping position load - missing token:", p);
                 return;
            }
            const stockInfo = allStocks.find(s => s.token === p.token);
            loadedPositions.set(p.token, {
                ...p,
                buyTime: moment(p.buyTime),
                expiry: p.expiry ? moment(p.expiry) : null,
                buyPrice: parseFloat(p.buyPrice),
                fixedStopLossPrice: parseFloat(p.fixedStopLossPrice),
                trailingStopPrice: p.trailingStopPrice ? parseFloat(p.trailingStopPrice) : null,
                symbol: p.symbol || stockInfo?.symbol || `Token-${p.token}`,
                exch_seg: p.exch_seg || stockInfo?.exch_seg || 'NFO',
            });
        });
        console.log(`✅ Loaded ${loadedPositions.size} positions from ${POSITIONS_FILE}`);
        return loadedPositions;
    } catch (error) {
        console.error('❌ Error loading positions:', error);
        return new Map();
    }
}

// --- Telegram Bot ---
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: false });

async function sendAlert(message) {
    try {
        await bot.sendMessage(CHAT_ID, `📈 OPTIONS: ${message}`);
        console.log(`Telegram alert sent: ${message}`);
    } catch (error) {
        console.error("Telegram send error:", error);
    }
}

// --- Trading Strategy Class ---
class MATradingStrategy {
    constructor(masterController) {
        this.masterController = masterController;
        this.smart_api = masterController.smartApiInstance;
        this.stocks = loadStocks(); // Load stocks initially
        this.currentCandles = new Map();
        this.candleInterval = null;
        this.boughtStocks = loadPositions(this.stocks); // Load existing positions
        this.tradeHistory = [];
        this.tradingHalted = false;
        this.totalPnL = 0;
        this.closeTime = moment().set({ hour: 15, minute: 30, second: 0 });

        // Populate history from loaded positions
        this.boughtStocks.forEach((pos, token) => {
            this.tradeHistory.push({
                token, name: pos.symbol, buyPrice: pos.buyPrice, quantity: pos.quantity,
                sellPrice: null, pnl: null, timestamp: pos.buyTime.valueOf(), reason: "Loaded Position",
                fixedStopLossPrice: pos.fixedStopLossPrice
            });
            // Ensure loaded positions are in the 'stocks' list for subscription
            if (!this.stocks.some(s => s.token === token)) {
                 this.stocks.push({ ...pos }); // Add loaded pos info to stocks
            }
        });

        this.masterController.registerStrategy(this); // Register with MC
        this.initialize();
    }

    async initialize() {
        console.log("🚀 Initializing MATradingStrategy (Options)...");
        // API connection is handled by MC, we just wait for it.
        // We need to ensure smart_api is available before fetching history.
        // MC's initialize should handle this. We proceed with scheduling.

        const currentTime = moment();
        const marketOpenTime = moment().set({ hour: 9, minute: 15 });
        const marketCloseTime = moment().set({ hour: 15, minute: 30 });

        if (currentTime.isBefore(marketOpenTime)) {
            console.log("📅 Before market hours (Options Strategy)");
            const waitTime = marketOpenTime.diff(currentTime);
            console.log(`🕒 Waiting ${moment.duration(waitTime).humanize()} for market open...`);
            setTimeout(() => this.startMarketActivities(), waitTime);
        } else if (currentTime.isBetween(marketOpenTime, marketCloseTime)) {
            console.log("📈 Market is open (Options Strategy)");
            this.startMarketActivities();
        } else {
            console.log("📅 After market hours (Options Strategy)");
            await this.dailyreports(); // Run report if after hours
            console.log("Waiting for next market day.");
        }

        // Schedule EOD tasks
        if (currentTime.isBefore(this.closeTime)) {
            const closeDelay = this.closeTime.diff(currentTime);
            setTimeout(async () => {
                await this.closeAllPositions();
                await this.dailyreports();
                console.log("✅ Options strategy EOD tasks completed.");
                // process.exit(0); // Don't exit here, let main script handle it
            }, closeDelay);
        }
    }

     async startMarketActivities() {
        console.log("Starting market activities for Options Strategy...");
        await this.fetchAllHistoricalData(this.stocks);
        this.scheduleCandleUpdates();
        // MC will handle subscriptions based on this.stocks when it connects.
    }

    // --- Data Handling & Processing ---

    async fetchAllHistoricalData(stocksToFetch) {
       console.log(`Workspaceing history for ${stocksToFetch.length} option contracts...`);
       for (const stock of stocksToFetch) {
           if (!stock || !stock.token || !stock.exch_seg) {
               console.warn("Skipping history fetch for invalid stock:", stock);
               continue;
           }
           try {
               const fromDate = moment().subtract(10, 'days').format('YYYY-MM-DD HH:mm');
               const toDate = moment().format('YYYY-MM-DD HH:mm');
               const params = {
                   exchange: stock.exch_seg,
                   symboltoken: stock.token,
                   interval: "FIFTEEN_MINUTE",
                   fromdate: fromDate,
                   todate: toDate
               };
               const history = await this.masterController.enqueueApiCall('getCandleData', [params]);
               if (history.data?.length) {
                   stock.candles = history.data.slice(-55).map(c => ({
                       timestamp: c[0], open: c[1], high: c[2], low: c[3], close: c[4], volume: c[5]
                   }));
                   console.log(`✅ ${stock.symbol} loaded ${stock.candles.length} candles.`);
               } else {
                   console.warn(`⚠️ No data for ${stock.symbol}`);
                   stock.candles = [];
               }
               await delay(500); // Respect API limits
           } catch (error) {
               console.error(`❌ History failed for ${stock.symbol}:`, error.message);
               stock.candles = [];
           }
       }
    }

    scheduleCandleUpdates() {
        // ... (Keep your existing scheduleCandleUpdates, initializeNewCandles, finalizeCurrentCandles logic) ...
        // Ensure it uses this.stocks and this.currentCandles
        console.log("Candle updates scheduled.");
         const now = moment();
        const minutesPastHour = now.minute();
        const seconds = now.second();
        const milliseconds = now.millisecond();
        const minutesToNextInterval = 15 - (minutesPastHour % 15);
        let initialDelay = minutesToNextInterval * 60 * 1000 - (seconds * 1000) - milliseconds;
        if (initialDelay <= 0) initialDelay += 15 * 60 * 1000;

        console.log(`⏳ Scheduling candle updates. First in ${Math.round(initialDelay/1000)}s.`);
        setTimeout(() => {
            this.performCandleUpdateCycle();
            this.candleInterval = setInterval(() => this.performCandleUpdateCycle(), 15 * 60 * 1000);
        }, initialDelay);
    }

     initializeNewCandles() { /* Keep existing logic */
         this.stocks.forEach(stock => {
            this.currentCandles.set(stock.token, {
                open: null, high: -Infinity, low: Infinity, close: null, startTime: moment().valueOf()
            });
         });
     }
     finalizeCurrentCandles() { /* Keep existing logic */
        this.stocks.forEach(stock => {
            const currentCandle = this.currentCandles.get(stock.token);
            if (currentCandle && currentCandle.open !== null) {
                if(!stock.candles) stock.candles = [];
                stock.candles.push(currentCandle);
                if(stock.candles.length > 55) stock.candles.shift();
                console.log(`🕯 Finalized candle for ${stock.symbol}`);
            }
        });
     }
     performCandleUpdateCycle() {
         console.log(`🛠️ Performing 15-min candle cycle (Options) at ${moment().format("HH:mm:ss")}`);
         this.finalizeCurrentCandles();
         this.initializeNewCandles();
         this.stocks.forEach(stock => this.calculateMovingAverages(stock));
         console.log("✅ Candle cycle finished.");
     }

    calculateMovingAverages(stock) { /* Keep existing logic */
        if (!stock.candles || stock.candles.length < 50) {
            stock.ma30 = null; stock.ma50 = null; return;
        }
        stock.ma30 = stock.candles.slice(-30).reduce((sum, c) => sum + c.low, 0) / 30;
        stock.ma50 = stock.candles.slice(-50).reduce((sum, c) => sum + c.low, 0) / 50;
    }

    processData(data) { // Called by MasterController
        const stock = this.stocks.find(s => s.token === data.token);
        if (!stock) return;

        const currentCandle = this.currentCandles.get(data.token);
        if (!currentCandle) return; // Wait for initialization

        // Update candle values
        if (currentCandle.open === null) currentCandle.open = data.ltp;
        currentCandle.high = Math.max(currentCandle.high, data.ltp);
        currentCandle.low = Math.min(currentCandle.low, data.ltp);
        currentCandle.close = data.ltp;

        this.calculateMovingAverages(stock); // Recalculate with every tick

        // --- Your Trading Logic ---
        try {
            if (!stock.candles || stock.candles.length < 50 || !stock.ma30 || !stock.ma50) return;

            const historicalCandle = stock.candles[stock.candles.length - 1];
            if (!historicalCandle) return;

            const buyCondition1 = stock.ma30 < stock.ma50;
            const buyCondition2 = historicalCandle.close > stock.ma30;
            const tolerance = stock.ma30 * 0.001;
            const buyCondition3 = Math.abs(data.ltp - stock.ma30) <= tolerance;

            if (buyCondition1 && buyCondition2 && buyCondition3 && !this.boughtStocks.has(stock.token) && !this.tradingHalted) {
                const quantity = parseInt(stock.lotsize || '1');
                if (quantity > 0) {
                    const fixedStopLossPrice = data.ltp * 0.90; // 10% SL
                    this.executeBuy(stock, data.ltp, quantity, fixedStopLossPrice);
                }
            }

            const buyData = this.boughtStocks.get(stock.token);
            if (buyData) {
                const { buyPrice, quantity, fixedStopLossPrice, isTrailingActive } = buyData;
                const currentProfit = (data.ltp - buyPrice) * quantity;

                if (data.ltp <= fixedStopLossPrice) {
                    this.executeSell(stock, data.ltp, `Fixed Stop Loss Hit`);
                    return;
                }
                // --- Add your trailing SL logic here if needed ---
            }
        } catch (error) {
            console.error(`❌ Strategy error for ${stock.symbol}:`, error);
        }
    }

    // --- Trade Execution & Reporting ---

    async executeBuy(stock, price, quantity, fixedStopLossPrice) {
        if (this.boughtStocks.has(stock.token)) return;
        try {
            const newPosition = {
                quantity, buyPrice: price, fixedStopLossPrice,
                trailingStopPrice: null, isTrailingActive: false,
                expiry: stock.expiry ? moment(stock.expiry, 'DDMMMYYYY') : null,
                buyTime: moment(), token: stock.token, symbol: stock.symbol,
                exch_seg: stock.exch_seg
            };
            this.boughtStocks.set(stock.token, newPosition);
            this.tradeHistory.push({
                token: stock.token, name: stock.symbol, buyPrice: price, quantity,
                sellPrice: null, pnl: null, timestamp: newPosition.buyTime.valueOf(),
                reason: "Buy Signal", fixedStopLossPrice
            });
            const message = `🟢 BUY: ${stock.symbol} Q:${quantity} @${price.toFixed(2)} SL:${fixedStopLossPrice.toFixed(2)}`;
            await sendAlert(message);
            savePositions(this.boughtStocks);
        } catch (error) {
            this.boughtStocks.delete(stock.token);
            console.error(`❌ Buy failed for ${stock.symbol}:`, error);
            await sendAlert(`🛑 BUY FAILED: ${stock.symbol}`);
        }
    }

    async executeSell(stock, price, reason) {
        const buyData = this.boughtStocks.get(stock.token);
        if (!buyData) return;
        this.boughtStocks.delete(stock.token);

        const profit = (price - buyData.buyPrice) * buyData.quantity;
        this.totalPnL += profit;

        const tradeIndex = this.tradeHistory.findIndex(t => t.token === stock.token && !t.sellPrice);
        if (tradeIndex > -1) {
            this.tradeHistory[tradeIndex].sellPrice = price;
            this.tradeHistory[tradeIndex].pnl = profit;
            this.tradeHistory[tradeIndex].reason = reason;
        }
        savePositions(this.boughtStocks);
        const message = `🔴 SELL: ${stock.symbol} Q:${buyData.quantity} @${price.toFixed(2)} P&L:₹${profit.toFixed(2)} [${reason}]`;
        await sendAlert(message);
    }

    async closeAllPositions() { /* Keep existing logic */
         console.log("🕒 Closing all Options positions...");
         this.tradingHalted = true;
         for (const [token, position] of this.boughtStocks) {
            const stock = this.stocks.find(s => s.token === token) || { symbol: position.symbol, token: token };
            const currentPrice = this.currentCandles.get(token)?.close || position.buyPrice;
            await this.executeSell(stock, currentPrice, "Market Close");
         }
    }
    async dailyreports() { /* Keep existing logic, ensure it reads/writes DAILY_REPORT_FILE */
        console.log("Generating daily report for Options Strategy...");
         try {
            let reportData = { trades: [], totalPnL: 0 };
            if (fs.existsSync(DAILY_REPORT_FILE)) {
                try { reportData = JSON.parse(fs.readFileSync(DAILY_REPORT_FILE, 'utf-8')); }
                catch (e) { console.error("Could not parse daily report, starting fresh."); }
            }

            // Merge current history with existing report
            this.tradeHistory.forEach(th => {
                const existing = reportData.trades.findIndex(rt => rt.timestamp === th.timestamp && rt.token === th.token);
                if (existing > -1) reportData.trades[existing] = th; // Update
                else reportData.trades.push(th); // Add new
            });
            // Add any open positions from boughtStocks if not in history
            this.boughtStocks.forEach((pos, token) => {
                if (!reportData.trades.some(rt => rt.token === token && !rt.sellPrice)) {
                     reportData.trades.push({
                        token, name: pos.symbol, buyPrice: pos.buyPrice, quantity: pos.quantity,
                        sellPrice: null, pnl: null, timestamp: pos.buyTime.valueOf(), reason: "Still Open",
                        fixedStopLossPrice: pos.fixedStopLossPrice
                    });
                }
            });


            reportData.totalPnL = reportData.trades.reduce((acc, t) => acc + (t.pnl || 0), 0);
            fs.writeFileSync(DAILY_REPORT_FILE, JSON.stringify(reportData, null, 2));

            // Generate Text Report & Send
            const fileName = `Options_Report_${moment().format('YYYY-MM-DD')}.txt`;
            let fileContent = "OPTIONS TRADING REPORT\n\n";
            fileContent += "Stock".padEnd(25) + "Bought".padStart(10) + "Sold".padStart(10) + "Qty".padStart(6) + "P&L".padStart(12) + "Status".padStart(10) + "\n";
            fileContent += "-".repeat(73) + "\n";
            reportData.trades.forEach(trade => {
                const status = trade.sellPrice ? "CLOSED" : "OPEN";
                const pnl = trade.pnl !== null ? `₹${trade.pnl.toFixed(2)}` : "N/A";
                fileContent += (trade.name || `Tkn-${trade.token}`).padEnd(25) +
                    (trade.buyPrice?.toFixed(2) || "N/A").padStart(10) +
                    (trade.sellPrice?.toFixed(2) || "N/A").padStart(10) +
                    (trade.quantity?.toString() || "N/A").padStart(6) +
                    pnl.padStart(12) + status.padStart(10) + "\n";
            });
            fileContent += "\n" + "-".repeat(73) + "\n";
            fileContent += "TOTAL P&L:".padEnd(51) + `₹${reportData.totalPnL.toFixed(2)}`.padStart(12);
            fs.writeFileSync(fileName, fileContent);
            await bot.sendDocument(CHAT_ID, fileName, { caption: "📊 Options Daily Report 📊" });
            fs.unlinkSync(fileName);
            console.log("✅ Options daily report sent.");

         } catch(e) { console.error("❌ Failed to send options daily report:", e); }
    }

    cleanup() {
        if (this.candleInterval) clearInterval(this.candleInterval);
        console.log("🧹 Options strategy cleanup finished.");
        // MC handles its own cleanup.
    }
}

// --- Main Runner ---
async function main() {
    const masterController = new MasterController();
    try {
        // Instantiate the strategy (which registers itself with MC)
        new MATradingStrategy(masterController);
        // Initialization and connection happens within MC and Strategy constructors/initializers
        console.log("Main runner: Strategy instantiated. Waiting for MC initialization...");

    } catch (error) {
        console.error("❌ Main application startup failed:", error.message);
        process.exit(1);
    }
}

main();

// Graceful shutdown (Optional but recommended)
process.on('SIGINT', () => { console.log("SIGINT received. Exiting..."); process.exit(0); });
process.on('SIGTERM', () => { console.log("SIGTERM received. Exiting..."); process.exit(0); });