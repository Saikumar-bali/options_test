// D:\master controller\test\test.js

const { SmartAPI } = require("smartapi-javascript"); // Keep this as it's the official library
const TelegramBot = require("node-telegram-bot-api");
const fs = require('fs');
const path = require('path');
const MasterController = require('../universal websocket/index.js'); // Assuming MasterController logic is in index.js inside universal websocket
const moment = require("moment-timezone");
const speakeasy = require("speakeasy");

require("dotenv").config({ path: path.join(__dirname, '../.env') });

// Ensure 'updated.json' exists in the same directory as test.js or provide full path
const stocksPath = path.join(__dirname, 'updated.json');
let stocks = [];
try {
  stocks = JSON.parse(fs.readFileSync(stocksPath, 'utf-8'));
} catch (error) {
  console.error(`❌ Error reading updated.json at ${stocksPath}:`, error.message);
  console.error("Ensure 'updated.json' exists and contains valid JSON, or create it as an empty array.");
  stocks = []; // Initialize with an empty array if file not found or invalid
}

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: false });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function sendAlert(message) {
  try {
    await bot.sendMessage(CHAT_ID, `🚨 ALERT: ${message}`);
    console.log(`Telegram alert sent: ${message}`);
  } catch (error) {
    console.error("Telegram send error:", error);
  }
}

class MATradingStrategy {
   constructor() {
     this.masterController = new MasterController(); // Instantiate MasterController
     this.smart_api = null; 
     this.jwtToken = null; 
     this.feedToken = null;
     this.stocks = stocks; // Initialize with stocks from updated.json
     this.currentCandles = new Map();
     this.candleInterval = null;
     this.boughtStocks = new Map();
     this.tradingHalted = false;
     this.totalPnL = 0;
     this.tradeHistory = [];
     this.stopBuyTime = moment().set({ hour: 14, minute: 0, second: 0, millisecond: 0 }); // 2:00 PM
     this.closeTime = moment().set({ hour: 15, minute: 0, second: 0, millisecond: 0 }); // 3:00 PM

     this.masterController.registerStrategy(this);
     this.initialize();
   }

  async initialize() {
    try {
      console.log("🚀 Initializing MATradingStrategy...");
      await this.masterController.initialize(); 
      
      this.jwtToken = this.masterController.jwtToken;
      this.feedToken = this.masterController.feedToken;
      this.smart_api = this.masterController.smartApiInstance; 

      if (!this.jwtToken || !this.feedToken || !this.smart_api) {
        console.error("🔴 API authentication failed via MasterController. Missing tokens or SmartAPI instance.");
        await sendAlert("🔴 API authentication failed via MasterController");
        // process.exit(1); // Optionally exit if auth fails critically
        return; 
      }

      console.log("✅ API connected successfully via MasterController");

      const currentTime = moment();
      const marketOpenTime = moment().set({ hour: 9, minute: 15, second: 0, millisecond: 0 });
      const marketCloseTime = moment().set({ hour: 15, minute: 30, second: 0, millisecond: 0 });

      if (currentTime.isBefore(marketOpenTime)) {
        console.log("📅 Before market hours");
        await this.handlePreMarketActivities();
        const waitTime = marketOpenTime.diff(currentTime, 'milliseconds');
        console.log(`🕒 Waiting for market open in ${moment.duration(waitTime).humanize()}...`);
        setTimeout(() => { this.startMarketActivities(); }, waitTime);
      } else if (currentTime.isBetween(marketOpenTime, marketCloseTime)) {
        console.log("📈 Market is open");
        this.startMarketActivities();
      } else {
        console.log("📅 After market hours");
        await this.handlePostMarketActivities();
        // If after hours, still schedule daily report for consistency or run it
        await this.closeAllPositions(); 
        await this.dailyreports();
        process.exit(0);
      }

      // Schedule EOD tasks
      const endOfDayCloseTime = moment(this.closeTime); // Ensure this is a moment object
      if (currentTime.isBefore(endOfDayCloseTime)) {
        const closeDelay = endOfDayCloseTime.diff(currentTime, 'milliseconds');
        setTimeout(async () => {
          await this.closeAllPositions();
          await this.dailyreports();
          process.exit(0);
        }, closeDelay);
      } else if (currentTime.isAfter(endOfDayCloseTime) && currentTime.isBefore(marketCloseTime)) {
          // If past custom close time but before market actually closes, run EOD tasks.
          // This case might need refinement based on exact EOD logic desired.
          console.log("Past custom close time but before market EOD, running EOD tasks now.");
          await this.closeAllPositions();
          await this.dailyreports();
          process.exit(0);
      }


    } catch (error) {
      console.error("❌ MATradingStrategy Initialization failed:", error.message);
      await sendAlert(`❌ Strategy initialization failed: ${error.message}`);
      process.exit(1);
    }
  }

  async handlePreMarketActivities() {
    const positionsPath = path.join(__dirname, 'positions.json');
    if (!fs.existsSync(positionsPath)) {
      fs.writeFileSync(positionsPath, JSON.stringify([], null, 2)); // Create empty if not exists
    }
    await this.dailyreports(); 
    
    fs.writeFileSync(path.join(__dirname, 'updated.json'), '[]');
    const test3Path = path.join(__dirname, 'test3');
    if (!fs.existsSync(test3Path)) {
        fs.mkdirSync(test3Path, { recursive: true });
    }
    fs.writeFileSync(path.join(test3Path, 'updated.json'), '[]');
    console.log('🧹 Cleared updated.json and test3/updated.json for the new day.');

    // Load all potential stocks from positions.json
    const allStocksForDay = JSON.parse(fs.readFileSync(positionsPath, 'utf-8'));
    await this.fetchAllHistoricalData(allStocksForDay); // Fetch history for all
    const filtered = await this.filterStocksClosingAboveMA30(allStocksForDay);

    console.log(`📊 Number of stocks after MA30 filter for today's list: ${filtered.length}`);

    const cleanStocks = filtered.map(stock => ({
      ...stock,
      candles: stock.candles || [], // Ensure candles array exists
      position: null 
    }));

    // Update this.stocks for the current strategy instance
    this.stocks = cleanStocks.slice(0, 49); // Take first 49 for this instance
    const secondBatch = cleanStocks.slice(49, 98); // For potential other instance/file

    fs.writeFileSync(path.join(__dirname, 'updated.json'), JSON.stringify(this.stocks, null, 2));
    console.log(`💾 Saved first batch of ${this.stocks.length} stocks to updated.json`);

    fs.writeFileSync(path.join(test3Path, 'updated.json'), JSON.stringify(secondBatch, null, 2));
    console.log(`💾 Saved second batch of ${secondBatch.length} stocks to ${path.join(test3Path, 'updated.json')}`);
  }

  async handlePostMarketActivities() {
    await this.dailyreports();
    // Similar clearing and filtering logic as pre-market for next day's preparation
    fs.writeFileSync(path.join(__dirname, 'updated.json'), '[]');
    const test3Path = path.join(__dirname, 'test3');
    if (!fs.existsSync(test3Path)) {
        fs.mkdirSync(test3Path, { recursive: true });
    }
    fs.writeFileSync(path.join(test3Path, 'updated.json'), '[]');
    console.log('🧹 Cleared updated.json and test3/updated.json post-market.');

    const positionsPath = path.join(__dirname, 'positions.json');
    if (!fs.existsSync(positionsPath)) {
      fs.writeFileSync(positionsPath, JSON.stringify([], null, 2));
    }
    const allStocksForNextDay = JSON.parse(fs.readFileSync(positionsPath, 'utf-8'));
    await this.fetchAllHistoricalData(allStocksForNextDay);
    const filtered = await this.filterStocksClosingAboveMA30(allStocksForNextDay);

    console.log(`📊 Number of stocks after MA30 filter for next day's list: ${filtered.length}`);
    const cleanStocks = filtered.map(stock => ({ ...stock, candles: stock.candles || [], position: null }));
    
    this.stocks = cleanStocks.slice(0, 49); // Update current instance for consistency if needed
    const secondBatch = cleanStocks.slice(49, 98);

    fs.writeFileSync(path.join(__dirname, 'updated.json'), JSON.stringify(this.stocks, null, 2));
    console.log('💾 Saved first batch for next day to updated.json');
    fs.writeFileSync(path.join(test3Path, 'updated.json'), JSON.stringify(secondBatch, null, 2));
    console.log(`💾 Saved second batch for next day to ${path.join(test3Path, 'updated.json')}`);
  }

  startMarketActivities() {
    const currentTime = moment();
    const minutes = currentTime.minutes();
    const waitMinutes = 15 - (minutes % 15);
    const waitTime = (waitMinutes === 15 && currentTime.seconds() === 0 && currentTime.milliseconds() === 0) ? 0 : waitMinutes * 60 * 1000 - (currentTime.seconds() * 1000) - currentTime.milliseconds();


    console.log(`⏳ Waiting for ${moment.duration(waitTime).humanize()} to align with 15-minute interval...`);

    setTimeout(() => {
      this.fetchAllHistoricalData(this.stocks).then(() => { // Fetch for currently loaded stocks
        this.scheduleCandleUpdates();
        const subscribableStocks = this.stocks.filter(stock => stock.candles?.length >= 30);
        if (subscribableStocks.length > 0) {
            // MasterController will subscribe to tokens of strategies registered with it.
            // We need to ensure this.stocks (which MasterController reads) is up-to-date.
            this.masterController.subscribeToStrategyTokens(); // Trigger subscription based on current strategy.stocks
            console.log(`✅ Subscribed to ${subscribableStocks.length} stocks after initial historical data fetch.`);
        } else {
            console.warn("No stocks with enough historical data to subscribe initially.");
        }
      }).catch(err => {
        console.error("❌ Error during initial market fetchAllHistoricalData:", err);
        sendAlert(`❌ Error during initial market historical data fetch: ${err.message}`);
      });

      const cleanupTargetTime = moment().set({hour: 9, minute: 30, second: 0, millisecond: 0});
      const cleanupDelay = cleanupTargetTime.diff(moment(), 'milliseconds');
      
      if (cleanupDelay > 0) {
          setTimeout(() => { this.cleanupUnboughtStocks(); }, cleanupDelay);
      } else {
          this.cleanupUnboughtStocks(); // If past 9:30, run immediately
      }
    }, waitTime > 0 ? waitTime : 0); // Ensure waitTime is not negative
  }

  async dailyreports() {
    try {
      const dailyReportPath = path.join(__dirname, 'daily_report.json');
      let reportData = { trades: [], totalPnL: 0 };
      if (fs.existsSync(dailyReportPath)) {
        try {
            reportData = JSON.parse(fs.readFileSync(dailyReportPath, 'utf-8'));
        } catch (e) {
            console.error("Error parsing daily_report.json, starting with empty report.", e.message)
        }
      }
      
      // Add trades from the current session that are not already in the report
      // This assumes tradeHistory contains only current session's new trades
      const newTradesForReport = this.tradeHistory.filter(th => 
        !reportData.trades.some(rt => rt.timestamp === th.timestamp && rt.token === th.token)
      );
      reportData.trades.push(...newTradesForReport);
      
      // Recalculate total PnL from all trades in the report file
      reportData.totalPnL = reportData.trades.reduce((acc, trade) => acc + (trade.pnl || 0), 0);

      fs.writeFileSync(dailyReportPath, JSON.stringify(reportData, null, 2));
      console.log("✅ Daily report data updated/created.");

      const fileName = `Daily_Report_${moment().format('YYYY-MM-DD')}.txt`;
      let fileContent = `DAILY TRADING REPORT for ${moment().format('YYYY-MM-DD')}\n\n`;
      fileContent += "Stock".padEnd(15) + "Bought".padStart(10) + "Sold".padStart(10) + "Qty".padStart(6) + "P&L".padStart(12) + "Status".padStart(10) + "Reason".padEnd(30) + "\n";
      fileContent += "-".repeat(93) + "\n";

      reportData.trades.forEach(trade => {
        const status = trade.sellPrice ? "CLOSED" : "OPEN";
        const pnl = trade.pnl !== null ? `₹${trade.pnl.toFixed(2)}` : "N/A";
        const reason = trade.reason || "N/A";
        fileContent += (trade.name || `Token ${trade.token}`).padEnd(15) +
                      (trade.buyPrice?.toFixed(2) || "N/A").padStart(10) +
                      (trade.sellPrice?.toFixed(2) || "N/A").padStart(10) +
                      (trade.quantity?.toString() || "N/A").padStart(6) +
                      pnl.padStart(12) +
                      status.padStart(10) + 
                      reason.padEnd(30) + "\n";
      });
      fileContent += "\n" + "-".repeat(93) + "\n";
      fileContent += "TOTAL P&L:".padEnd(71) + `₹${reportData.totalPnL.toFixed(2)}`.padStart(12) + "\n";
      fs.writeFileSync(fileName, fileContent);

      await bot.sendDocument(CHAT_ID, fileName, { caption: "📊 Daily Trading Report 📊" });
      fs.unlinkSync(fileName);
      console.log("✅ Daily report sent via Telegram.");

      // Clear tradeHistory for the current instance after reporting
      this.tradeHistory = []; 

    } catch (error) {
      console.error("Failed to send daily report:", error);
      await sendAlert("❌ Failed to generate/send daily report");
    }
  }

  cleanupUnboughtStocks() {
    if (this.stocks.length === 0) {
        console.log("No stocks to clean up from monitoring.");
        return;
    }
    const initialStocksCount = this.stocks.length;
    this.stocks = this.stocks.filter(stock => this.boughtStocks.has(stock.token));
    const removedCount = initialStocksCount - this.stocks.length;

    if (removedCount > 0) {
      console.log(`🧹 Removing ${removedCount} unbought stocks from active monitoring. ${this.stocks.length} remain.`);
      // MasterController will pick up the new this.stocks list on its next subscription cycle if it resubscribes periodically
      // or if we explicitly call subscribeToStrategyTokens.
      this.masterController.subscribeToStrategyTokens(); // Re-subscribe with the filtered list
    } else {
        console.log("No unbought stocks to remove from monitoring.");
    }
  }

  async fetchAllHistoricalData(stocksToFetch) {
    if (!this.smart_api) {
        console.error("SmartAPI instance not available for fetching historical data.");
        await sendAlert("SmartAPI instance not available for history fetch.");
        return;
    }
    if (!stocksToFetch || stocksToFetch.length === 0) {
        console.log("No stocks provided to fetch historical data for.");
        return;
    }

    for (const stock of stocksToFetch) {
      if (!stock || !stock.token || !stock.exchange) {
          console.warn("Skipping stock due to missing token or exchange:", stock ? stock.name || "Unknown" : "Undefined stock");
          continue;
      }
      try {
        const fromDate = moment().subtract(10, 'days').format('YYYY-MM-DD HH:mm'); // More data for robust MA
        const toDate = moment().format('YYYY-MM-DD HH:mm');

        const historyParams = {
          exchange: stock.exchange,
          symboltoken: stock.token,
          interval: "FIFTEEN_MINUTE",
          fromdate: fromDate,
          todate: toDate
        };
        // console.log(`Workspaceing history for ${stock.name} with params:`, historyParams);
        const history = await this.masterController.enqueueApiCall('getCandleData', [historyParams]);

        if (history && history.data && history.data.length) {
          stock.candles = history.data.slice(-55).map(c => ({
            timestamp: c[0], open: c[1], high: c[2], low: c[3], close: c[4], volume: c[5]
          }));
          console.log(`✅ ${stock.name} loaded ${stock.candles.length} candles.`);
        } else {
          console.warn(`⚠️ No historical data found for ${stock.name}. API response:`, history ? JSON.stringify(history).substring(0,100) : "No response");
          stock.candles = []; // Ensure candles array exists even if empty
        }
        await delay(200); // Increased delay
      } catch (error) {
        console.error(`❌ History fetch failed for ${stock.name}:`, error.message);
        if (error.response && error.response.data) console.error("API Error Details:", JSON.stringify(error.response.data));
        stock.candles = []; // Ensure candles array on error
      }
    }
  }

  async filterStocksClosingAboveMA30(allStocks) {
    const filtered = [];
    for (const stock of allStocks) {
      if (!stock.candles || stock.candles.length < 30) {
        // console.log(`Skipping ${stock.name} from MA30 filter, not enough candle data: ${stock.candles ? stock.candles.length : 0}`);
        continue;
      }
      const ma30 = stock.candles.slice(-30).reduce((sum, c) => sum + c.close, 0) / 30;
      const lastClose = stock.candles[stock.candles.length - 1].close;
      if (lastClose > ma30) {
        filtered.push(stock);
      }
    }
    return filtered;
  }

  scheduleCandleUpdates() {
    const now = moment();
    const minutesPastHour = now.minute();
    const seconds = now.second();
    const milliseconds = now.millisecond();
    
    const minutesToNextInterval = 15 - (minutesPastHour % 15);
    let initialDelay = minutesToNextInterval * 60 * 1000 - (seconds * 1000) - milliseconds;

    if (minutesPastHour % 15 === 0 && seconds === 0 && milliseconds === 0) {
        initialDelay = 0; // Already on the mark
    } else if (initialDelay <=0 ) { // If somehow negative (e.g. calculation edge case)
        initialDelay += 15 * 60 * 1000; // schedule for next proper interval
    }


    console.log(`⏳ Scheduling candle updates. First update in ${moment.duration(initialDelay).humanize()} (approx ${initialDelay/1000}s).`);

    if (this.candleInterval) clearInterval(this.candleInterval); // Clear existing interval if any

    if (initialDelay === 0) {
        this.performCandleUpdateCycle(); // Run immediately
        this.candleInterval = setInterval(() => this.performCandleUpdateCycle(), 15 * 60 * 1000);
    } else {
        setTimeout(() => {
            this.performCandleUpdateCycle();
            this.candleInterval = setInterval(() => this.performCandleUpdateCycle(), 15 * 60 * 1000);
        }, initialDelay);
    }
  }
  
  performCandleUpdateCycle() {
      console.log(`🛠️ Performing scheduled 15-min candle update cycle at ${moment().format("HH:mm:ss")}`);
      this.updateAllCandles();
      // After updating candles, re-evaluate strategies or data for all relevant stocks
      this.stocks.forEach(stock => {
          if (this.boughtStocks.has(stock.token) || (stock.candles && stock.candles.length >=30)) { // only process if bought or enough data
            this.calculateMovingAverages(stock); // Recalculate MAs
            // If not bought, check buy conditions with new candle data (simulating a tick)
            // This part is tricky as processData is tick-driven.
            // For simplicity, MA calculation is the main thing here. Buy/sell is tick-driven.
          }
      });
      console.log("✅ Candle update cycle finished.");
  }

  updateAllCandles() {
    this.stocks.forEach(stock => {
      const currentCandle = this.currentCandles.get(stock.token);
      if (currentCandle && typeof currentCandle.open === 'number') { // Finalize if candle has data
        if (!stock.candles) stock.candles = []; // Ensure array exists
        stock.candles.push({
          timestamp: moment(currentCandle.startTime).format('YYYY-MM-DD HH:mm:ss'),
          open: currentCandle.open,
          high: currentCandle.high,
          low: currentCandle.low,
          close: currentCandle.close, // This would be LTP at end of 15min
          volume: currentCandle.volume || 0 
        });
        if (stock.candles.length > 55) stock.candles.shift(); // Keep last 55
        console.log(`🕯 Finalized candle for ${stock.name}: O:${currentCandle.open.toFixed(2)} H:${currentCandle.high.toFixed(2)} L:${currentCandle.low.toFixed(2)} C:${currentCandle.close.toFixed(2)}`);
      }
      // Initialize new candle
      this.currentCandles.set(stock.token, {
        open: null, high: -Infinity, low: Infinity, close: null, volume: 0,
        startTime: moment().valueOf()
      });
    });
  }

  processData(data) { // Called by MasterController on tick
    if (!data || !data.token || typeof data.ltp !== 'number') return;

    const stock = this.stocks.find(s => s.token === data.token.toString() || s.token === parseInt(data.token));
    if (!stock) return;

    const currentCandle = this.currentCandles.get(stock.token);
    if (!currentCandle) { // Should be initialized by scheduleCandleUpdates
        this.currentCandles.set(stock.token, { open: data.ltp, high: data.ltp, low: data.ltp, close: data.ltp, volume: data.v || 0, startTime: moment().valueOf() });
        this.calculateMovingAverages(stock); // Calculate MA on first tick if candle was missing
        return;
    }

    if (currentCandle.open === null) currentCandle.open = data.ltp;
    currentCandle.high = Math.max(currentCandle.high, data.ltp);
    currentCandle.low = Math.min(currentCandle.low, data.ltp);
    currentCandle.close = data.ltp;
    if (data.v) currentCandle.volume = (currentCandle.volume || 0) + parseInt(data.v); // Accumulate volume if provided

    this.calculateMovingAverages(stock); // Crucial: MAs updated with live tick data for MA29

    if (!stock.candles || stock.candles.length < 30 || !stock.ma30 || !stock.ma29) return; // Ensure MAs are calculated

    try {
      const historicalCandle = stock.candles[stock.candles.length - 1];
      if (!historicalCandle) return;

      const buyCondition1 = historicalCandle.close > stock.ma30;
      const tolerance = stock.ma29 * 0.001; // 0.1%
      const buyCondition2 = Math.abs(data.ltp - stock.ma29) <= tolerance;

      if (buyCondition1 && buyCondition2 && !this.boughtStocks.has(stock.token) && !this.tradingHalted && moment().isBefore(this.stopBuyTime)) {
        const quantity = Math.floor(50000 / data.ltp);
        if (quantity > 0) {
          const stopLossAmountPerShare = 650 / quantity;
          const fixedStopLossPrice = data.ltp - stopLossAmountPerShare;
          this.executeBuy(stock, data.ltp, quantity, fixedStopLossPrice);
        } else {
            console.warn(`Qty is 0 for ${stock.name} at LTP ${data.ltp}. Skipping buy.`);
        }
      }

      const buyData = this.boughtStocks.get(stock.token);
      if (buyData) {
        const { buyPrice, quantity, fixedStopLossPrice } = buyData;
        let { isTrailingActive, trailingStopPrice, highPriceAfterBuy } = buyData; // Make mutable for update

        buyData.highPriceAfterBuy = Math.max(highPriceAfterBuy || buyPrice, data.ltp);
        const currentProfit = (data.ltp - buyPrice) * quantity;

        if (data.ltp <= fixedStopLossPrice) {
          this.executeSell(stock, data.ltp, `Fixed Stop Loss Hit (₹650 Loss)`);
          return;
        }

        if (currentProfit >= 650 && !isTrailingActive) {
            const trailingStopProfitPerShare = 100 / quantity; // Lock Rs.100 profit
            const newTrailingStopPrice = buyPrice + trailingStopProfitPerShare;
            buyData.isTrailingActive = true;
            buyData.trailingStopPrice = newTrailingStopPrice;
            console.log(`🟡 Trailing SL Activated for ${stock.name} at Profit >= ₹650. Trail set at price ${newTrailingStopPrice.toFixed(2)} (₹100 profit locked).`);
        } else if (isTrailingActive) {
            const trailingStep = 0.005 * buyPrice; // 0.5% of buy price as trailing step from high
            const potentialNewTrailPrice = buyData.highPriceAfterBuy - trailingStep; 
            if (potentialNewTrailPrice > trailingStopPrice) { // Ensure trail only moves up
                 buyData.trailingStopPrice = potentialNewTrailPrice;
                 console.log(`📈 Trailing SL for ${stock.name} moved up to: ${potentialNewTrailPrice.toFixed(2)}`);
            }
        }
        
        if (buyData.isTrailingActive && data.ltp <= buyData.trailingStopPrice) {
           this.executeSell(stock, data.ltp, `Trailing Stop Loss Hit (Trailing Price: ${buyData.trailingStopPrice.toFixed(2)})`);
           return;
        }
      }
    } catch (error) {
      console.error(`❌ Strategy error for ${stock.name}:`, error);
      sendAlert(`❌ Strategy runtime error for ${stock.name}: ${error.message}`);
    }
  }

  calculateMovingAverages(stock) {
    if (!stock.candles || stock.candles.length < 30) {
      stock.ma30 = null; stock.ma29 = null;
      return;
    }
    // MA30 based on historical lows of last 30 *finalized* candles
    stock.ma30 = stock.candles.slice(-30).reduce((sum, c) => sum + c.low, 0) / 30;

    const currentTickCandleLow = this.currentCandles.get(stock.token)?.low;
    if (typeof currentTickCandleLow !== 'number' || currentTickCandleLow === Infinity) {
        stock.ma29 = null; // Not enough data for current tick MA29
        return;
    }
    // MA29: last 29 finalized candles' lows + current tick's low
    const ma29CandleLows = stock.candles.slice(-29).map(c => c.low);
    ma29CandleLows.push(currentTickCandleLow); 
    stock.ma29 = ma29CandleLows.reduce((sum, low) => sum + low, 0) / ma29CandleLows.length;

    // console.log(`📈 ${stock.name} MA30 (hist low): ${stock.ma30?.toFixed(2)}, MA29 (hist low + curr tick low): ${stock.ma29?.toFixed(2)} | LTP: ${this.currentCandles.get(stock.token)?.close.toFixed(2)}`);
  }

  async closeAllPositions() {
    console.log("🕒 Market close activities initiated. Closing open positions.");
    this.tradingHalted = true; 

    let closeMessage = "🟠 MARKET CLOSING - POSITIONS REPORT 🟠\n";
    let dailyPnlFromClose = 0;

    for (const [token, position] of this.boughtStocks) {
      const stock = this.stocks.find(s => s.token === token) || this.tradeHistory.find(t => t.token === token && !t.sellPrice); // Find from active stocks or open trades
      if (stock) { // stock object might be just {name, token} if not in this.stocks
        const stockName = stock.name || `Token ${token}`;
        const currentPrice = this.currentCandles.get(token)?.close || position.buyPrice; // Fallback to buyPrice if no current tick
        const profit = (currentPrice - position.buyPrice) * position.quantity;
        dailyPnlFromClose += profit;

        const tradeIndex = this.tradeHistory.findIndex(t => t.token === token && t.sellPrice === null);
        if (tradeIndex > -1) {
          this.tradeHistory[tradeIndex].sellPrice = currentPrice;
          this.tradeHistory[tradeIndex].pnl = profit;
          this.tradeHistory[tradeIndex].reason = "Market Close (EOD)";
        } else { // Should not happen if boughtStocks entry exists
          this.tradeHistory.push({
            token: token, name: stockName, buyPrice: position.buyPrice, quantity: position.quantity,
            sellPrice: currentPrice, pnl: profit, timestamp: position.timestamp || Date.now(), 
            reason: "Market Close (EOD - created)", fixedStopLossPrice: position.fixedStopLossPrice,
          });
        }
        closeMessage += `\n📈 ${stockName} | Qty: ${position.quantity} | Bought: ${position.buyPrice.toFixed(2)} | Sold (EOD): ${currentPrice.toFixed(2)} | P&L: ₹${profit.toFixed(2)}`;
      }
    }
    
    // this.totalPnL reflects PnL from trades closed *during* the day.
    // Add PnL from EOD closed positions to the daily report's perspective.
    // The dailyreports function will sum up all PnL from this.tradeHistory.

    if (this.boughtStocks.size > 0) {
        await sendAlert(closeMessage + `\n\n📊 P&L from EOD closures: ₹${dailyPnlFromClose.toFixed(2)}`);
    } else {
        await sendAlert("🟠 MARKET CLOSING - No open positions to close at EOD.");
    }
    
    this.boughtStocks.clear();
    // this.tradeHistory is handled by dailyreports for persistence.
  }

  async executeBuy(stock, price, quantity, fixedStopLossPrice) {
    const buyTimestamp = Date.now();
    this.boughtStocks.set(stock.token, {
        quantity, buyPrice: price, fixedStopLossPrice,
        trailingStopPrice: null, isTrailingActive: false, highPriceAfterBuy: price,
        timestamp: buyTimestamp // Store buy time
    });

    const message = `🟢 BUY SIGNAL 🟢\n  📈 Name: ${stock.name}\n  🔢 Quantity: ${quantity}\n  💰 Buy Price: ${price.toFixed(2)}\n  🛡️ Fixed SL: ${fixedStopLossPrice.toFixed(2)} (-₹650)`;
    await sendAlert(message);
    console.log(message);

    this.tradeHistory.push({
      token: stock.token, name: stock.name, buyPrice: price, quantity: quantity,
      sellPrice: null, pnl: null, timestamp: buyTimestamp, reason: "Buy Signal",
      fixedStopLossPrice: fixedStopLossPrice, trailingStopPrice: null, isTrailingActive: false,
    });
  }

  async executeSell(stock, price, reason) {
    const buyData = this.boughtStocks.get(stock.token);
    if (!buyData) return;

    this.boughtStocks.delete(stock.token);
    // Unsubscribe handled by cleanupUnboughtStocks or if MasterController resubscribes periodically
    
    const profit = (price - buyData.buyPrice) * buyData.quantity;
    this.totalPnL += profit; // Accumulate PnL for open session

    const tradeIndex = this.tradeHistory.findIndex(t => t.token === stock.token && t.sellPrice === null);
    if (tradeIndex > -1) {
      this.tradeHistory[tradeIndex].sellPrice = price;
      this.tradeHistory[tradeIndex].pnl = profit;
      this.tradeHistory[tradeIndex].reason = reason;
    } else { // Should not happen
        this.tradeHistory.push({
            token: stock.token, name: stock.name, buyPrice: buyData.buyPrice, quantity: buyData.quantity,
            sellPrice: price, pnl: profit, timestamp: buyData.timestamp, reason: reason + " (created)",
            fixedStopLossPrice: buyData.fixedStopLossPrice, trailingStopPrice: buyData.trailingStopPrice, isTrailingActive: buyData.isTrailingActive
        });
    }

    const message = `🔴 ${reason.includes("Stop Loss") ? "STOP LOSS" : "SELL"} TRIGGERED 🔴\n  📈 Name: ${stock.name}\n  💰 Buy: ${buyData.buyPrice.toFixed(2)} | Sell: ${price.toFixed(2)}\n  🔢 Qty: ${buyData.quantity} | P&L: ₹${profit.toFixed(2)}\n  📝 Reason: ${reason}\n  📊 Today's Total P&L (Session): ₹${this.totalPnL.toFixed(2)}`;
    await sendAlert(message);
    console.log(message);
  }

  cleanup() {
    if (this.candleInterval) clearInterval(this.candleInterval);
    this.masterController.disconnectWebSocket(); // Cleanly disconnect WebSocket
    this.boughtStocks.clear();
    this.currentCandles.clear();
    // this.stocks = []; // Do not clear this.stocks if it's meant for post/pre market persistence
    console.log("🧹 Strategy cleanup finished.");
  }
}

// Start the application
const strategyInstance = new MATradingStrategy();

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log("SIGINT received. Shutting down gracefully...");
  await strategyInstance.closeAllPositions(); // Close open EOD positions
  await strategyInstance.dailyreports();      // Send final report
  strategyInstance.cleanup();               // General cleanup
  process.exit(0);
});
process.on('SIGTERM', async () => {
  console.log("SIGTERM received. Shutting down gracefully...");
  await strategyInstance.closeAllPositions();
  await strategyInstance.dailyreports();
  strategyInstance.cleanup();
  process.exit(0);
});