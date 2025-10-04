// File: D:\master_controller\advanced_strategy\advanced_options_trader.js

const path = require('path');
// Ensure .env is in D:\master_controller\.env
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const TelegramBot = require("node-telegram-bot-api");
const fs = require('fs');
const moment = require("moment-timezone");
const MasterController = require('../universal websocket/index.js'); // Adjust path as needed
const { calculateSMA, calculateStandardDeviation, calculateRSI, calculateATR, getOptionType, delay } = require('./utils.js'); // Helper functions
const Logger = require('./logger.js'); // Logger utility

class AdvancedOptionsTrader {
    constructor(masterController, config) {
        this.masterController = masterController;
        this.smart_api = masterController.smartApiInstance; // Will be set by MC
        this.config = config;
        this.logger = new Logger(config);

        this.stocks = this.loadStocks();
        this.currentCandles = new Map(); // For 15-min candle formation
        this.candleInterval = null;
        this.activePositions = this.loadPositions(); // token -> position details
        this.tradingHalted = false;
        this.manualTradingHalt = false;
        this.dailyPnL = 0;
        this.cooldowns = new Map(); // token -> timestamp

        this.closeTime = moment.tz("Asia/Kolkata").set({
            hour: this.config.marketHours.eodTaskHour,
            minute: this.config.marketHours.eodTaskMinute,
            second: 0
        });

        this.bot = new TelegramBot(this.config.telegramBotToken, { polling: true });
        this.setupTelegramCommands();

        this.masterController.registerStrategy(this); // Register with MC
        this.initialize();
        this.logger.info(`📈 ${this.config.strategyName} initialized.`);
        this.sendTelegramAlert(`🚀 ${this.config.strategyName} started successfully!`);
    }

    loadStocks() {
        try {
            const filePath = path.join(__dirname, this.config.logFiles.updatedStocks);
            if (!fs.existsSync(filePath)) {
                this.logger.warn(`⚠️ ${filePath} not found. Starting with empty stocks list.`);
                return [];
            }
            const stocksData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
            // Enrich stock data
            return stocksData.map(s => ({
                ...s,
                option_type: s.option_type || getOptionType(s.symbol), // Ensure option_type is present
                candles: [], // Historical candles
                bb: null, // Bollinger Bands
                rsi: null, // RSI
                atr: null, // ATR
            }));
        } catch (e) {
            this.logger.error(`❌ Error reading/parsing ${this.config.logFiles.updatedStocks}:`, e.message, e);
            return [];
        }
    }

    savePositions() {
        try {
            const dataToSave = Array.from(this.activePositions.values()).map(p => ({
                ...p,
                buyTime: p.buyTime ? p.buyTime.toISOString() : null,
                expiry: p.expiry ? (moment.isMoment(p.expiry) ? p.expiry.toISOString() : p.expiry) : null,
            }));
            fs.writeFileSync(path.join(__dirname, this.config.logFiles.positions), JSON.stringify(dataToSave, null, 2));
            this.logger.debug("Positions saved.");
        } catch (e) {
            this.logger.error("❌ Error saving positions:", e.message, e);
        }
    }

    loadPositions() {
        try {
            const filePath = path.join(__dirname, this.config.logFiles.positions);
            if (!fs.existsSync(filePath)) return new Map();

            const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            const loadedPositions = new Map();
            let recoveredPnl = 0;

            data.forEach(p => {
                if (!p.token) {
                    this.logger.warn("Skipping position load - missing token:", p);
                    return;
                }
                const stockInfo = this.stocks.find(s => s.token === p.token);
                const position = {
                    ...p,
                    buyTime: moment(p.buyTime),
                    expiry: p.expiry ? moment(p.expiry) : null,
                    buyPrice: parseFloat(p.buyPrice),
                    quantity: parseInt(p.quantity),
                    slPrice: parseFloat(p.slPrice),
                    tpPrice: parseFloat(p.tpPrice),
                    symbol: p.symbol || stockInfo?.symbol || `Token-${p.token}`,
                    exch_seg: p.exch_seg || stockInfo?.exch_seg || 'NFO',
                    option_type: p.option_type || stockInfo?.option_type || getOptionType(p.symbol),
                };
                loadedPositions.set(p.token, position);
                // If a position was open, its P&L contribution starts from 0 for the new session
                // Or, you might want to load previous session P&L if not closed.
                // For simplicity, loaded positions don't add to current dailyPnL until closed in this session.
            });
            this.logger.info(`✅ Loaded ${loadedPositions.size} positions from ${this.config.logFiles.positions}`);
            return loadedPositions;
        } catch (error) {
            this.logger.error('❌ Error loading positions:', error.message, error);
            return new Map();
        }
    }

    async initialize() {
        this.logger.info("🚀 Initializing AdvancedOptionsTrader...");

        const currentTime = moment.tz("Asia/Kolkata");
        const marketOpenTime = moment.tz("Asia/Kolkata").set({ hour: parseInt(this.config.marketHours.open.split(':')[0]), minute: parseInt(this.config.marketHours.open.split(':')[1]), second: 0 });
        const marketCloseTime = moment.tz("Asia/Kolkata").set({ hour: parseInt(this.config.marketHours.close.split(':')[0]), minute: parseInt(this.config.marketHours.close.split(':')[1]), second: 0 });

        if (currentTime.isBefore(marketOpenTime)) {
            const waitTime = marketOpenTime.diff(currentTime);
            this.logger.info(`🕒 Waiting ${moment.duration(waitTime).humanize()} for market open...`);
            setTimeout(() => this.startMarketActivities(), waitTime);
        } else if (currentTime.isBetween(marketOpenTime, marketCloseTime)) {
            this.logger.info("📈 Market is open. Starting activities...");
            this.startMarketActivities();
        } else {
            this.logger.info("📅 Market is closed. Generating EOD report if applicable.");
            await this.generateDailyReport();
        }

        // Schedule EOD tasks
        if (currentTime.isBefore(this.closeTime)) {
            const closeDelay = this.closeTime.diff(currentTime);
            setTimeout(async () => {
                this.logger.info("🌙 Performing EOD tasks...");
                await this.closeAllOpenPositions("EOD Square Off");
                await this.generateDailyReport();
                this.logger.info("✅ EOD tasks completed.");
            }, closeDelay);
        }
    }

    async startMarketActivities() {
        this.logger.info("🚀 Starting market activities...");
        this.dailyPnL = Array.from(this.activePositions.values()).reduce((acc, pos) => acc + (pos.pnl || 0), 0); // Recalculate PnL if positions loaded
        await this.fetchAllHistoricalData();
        this.stocks.forEach(stock => this.calculateIndicators(stock)); // Initial calculation
        this.scheduleCandleUpdates();
        // MC will handle subscriptions based on this.stocks
    }

    async fetchAllHistoricalData() {
        this.logger.info(`⏳ Fetching historical data for ${this.stocks.length} contracts...`);
        for (const stock of this.stocks) {
            if (!stock || !stock.token || !stock.exch_seg) {
                this.logger.warn("Skipping history fetch for invalid stock:", stock);
                continue;
            }
            try {
                const fromDate = moment().subtract(this.config.tradingParameters.historicalDataDays, 'days').format('YYYY-MM-DD HH:mm');
                const toDate = moment().format('YYYY-MM-DD HH:mm');
                const params = {
                    exchange: stock.exch_seg,
                    symboltoken: stock.token,
                    interval: "FIFTEEN_MINUTE", // Ensure this matches candleIntervalMinutes
                    fromdate: fromDate,
                    todate: toDate
                };
                const history = await this.masterController.enqueueApiCall('getCandleData', [params]);
                if (history && history.data && history.data.length) {
                    stock.candles = history.data.map(c => ({
                        timestamp: moment(c[0]).valueOf(), // Store as timestamp
                        open: c[1], high: c[2], low: c[3], close: c[4], volume: c[5]
                    })).slice(-this.config.tradingParameters.maxCandlesToKeep); // Keep only recent candles
                    this.logger.debug(`✅ ${stock.symbol} loaded ${stock.candles.length} candles.`);
                } else {
                    this.logger.warn(`⚠️ No historical data for ${stock.symbol}. API response: ${JSON.stringify(history)}`);
                    stock.candles = [];
                }
                await delay(this.config.fetchDelayMs);
            } catch (error) {
                this.logger.error(`❌ History fetch failed for ${stock.symbol}:`, error.message, error);
                stock.candles = [];
            }
        }
        this.logger.info("✅ Historical data fetch complete.");
    }

    scheduleCandleUpdates() {
        const now = moment.tz("Asia/Kolkata");
        const minutesPastInterval = now.minute() % this.config.tradingParameters.candleIntervalMinutes;
        const seconds = now.second();
        const milliseconds = now.millisecond();
        let initialDelay = (this.config.tradingParameters.candleIntervalMinutes - minutesPastInterval) * 60 * 1000 - (seconds * 1000) - milliseconds;
        if (initialDelay <= 0) { // If we are past the interval point
            initialDelay += this.config.tradingParameters.candleIntervalMinutes * 60 * 1000;
        }

        this.logger.info(`⏳ Scheduling 15-min candle updates. First in ${moment.duration(initialDelay).humanize()}.`);
        this.initializeNewCandles(); // Initialize for the current partial candle

        setTimeout(() => {
            this.performCandleUpdateCycle(); // First cycle
            this.candleInterval = setInterval(() => this.performCandleUpdateCycle(), this.config.tradingParameters.candleIntervalMinutes * 60 * 1000);
        }, initialDelay);
    }

    initializeNewCandles() {
        const startTime = moment.tz("Asia/Kolkata").startOf('minute').subtract(moment.tz("Asia/Kolkata").minute() % this.config.tradingParameters.candleIntervalMinutes, 'minutes').valueOf();
        this.stocks.forEach(stock => {
            const lastLTP = this.currentCandles.get(stock.token)?.close; // Preserve last LTP if available
            this.currentCandles.set(stock.token, {
                open: lastLTP || null, high: lastLTP || -Infinity, low: lastLTP || Infinity, close: lastLTP || null,
                startTime: startTime,
                volume: 0
            });
        });
        this.logger.debug("New 15-min candles initialized.");
    }

    finalizeCurrentCandles() {
        const finalizedTime = moment.tz("Asia/Kolkata").startOf('minute').subtract(moment.tz("Asia/Kolkata").minute() % this.config.tradingParameters.candleIntervalMinutes, 'minutes').valueOf();
        this.stocks.forEach(stock => {
            const currentCandle = this.currentCandles.get(stock.token);
            if (currentCandle && currentCandle.open !== null) { // Ensure candle has data
                const completeCandle = {
                    timestamp: finalizedTime, // Timestamp of the start of the interval
                    open: currentCandle.open,
                    high: currentCandle.high,
                    low: currentCandle.low,
                    close: currentCandle.close,
                    volume: currentCandle.volume || 0
                };
                if (!stock.candles) stock.candles = [];
                stock.candles.push(completeCandle);
                if (stock.candles.length > this.config.tradingParameters.maxCandlesToKeep) {
                    stock.candles.shift();
                }
                this.logger.debug(`🕯️ Finalized candle for ${stock.symbol}: O:${completeCandle.open} H:${completeCandle.high} L:${completeCandle.low} C:${completeCandle.close}`);
            }
        });
    }

    performCandleUpdateCycle() {
        this.logger.info(`🛠️ Performing 15-min candle cycle at ${moment.tz("Asia/Kolkata").format("HH:mm:ss")}`);
        this.finalizeCurrentCandles();
        this.initializeNewCandles(); // Prepare for the next interval
        this.stocks.forEach(stock => this.calculateIndicators(stock));
        this.logger.info("✅ Candle cycle finished. Indicators recalculated.");
    }

    calculateIndicators(stock) {
        if (!stock.candles || stock.candles.length === 0) {
            this.logger.debug(`Not enough candle data for ${stock.symbol} to calculate indicators.`);
            return;
        }
        const closes = stock.candles.map(c => c.close);
        const highs = stock.candles.map(c => c.high);
        const lows = stock.candles.map(c => c.low);

        // Bollinger Bands
        const sma = calculateSMA(closes, this.config.tradingParameters.bollingerBands.period);
        const stdDev = calculateStandardDeviation(closes, this.config.tradingParameters.bollingerBands.period);
        if (sma !== null && stdDev !== null) {
            stock.bb = {
                middle: sma,
                upper: sma + (this.config.tradingParameters.bollingerBands.stdDev * stdDev),
                lower: sma - (this.config.tradingParameters.bollingerBands.stdDev * stdDev),
            };
        } else {
            stock.bb = null;
        }

        // RSI
        stock.rsi = calculateRSI(closes, this.config.tradingParameters.rsi.period);

        // ATR (Note: ATR typically uses H, L, C of previous candle)
        stock.atr = calculateATR(stock.candles, this.config.tradingParameters.atr.period);

        this.logger.debug(`Indicators for ${stock.symbol}: BB: ${JSON.stringify(stock.bb)}, RSI: ${stock.rsi}, ATR: ${stock.atr}`);
    }

    processData(data) { // Called by MasterController on LTP update
        const stock = this.stocks.find(s => s.token === data.token);
        if (!stock) return;

        const ltp = parseFloat(data.ltp);

        // Update current 15-min candle
        const currentIntervalCandle = this.currentCandles.get(data.token);
        if (currentIntervalCandle) {
            if (currentIntervalCandle.open === null) currentIntervalCandle.open = ltp;
            currentIntervalCandle.high = Math.max(currentIntervalCandle.high, ltp);
            currentIntervalCandle.low = Math.min(currentIntervalCandle.low, ltp);
            currentIntervalCandle.close = ltp;
            // currentIntervalCandle.volume += data.volume; // If volume is part of tick
        }

        // Check if trading is halted
        if (this.tradingHalted) {
            // Still process exits if positions are open
            const position = this.activePositions.get(stock.token);
            if (position) {
                this.checkExitConditions(stock, ltp, position);
            }
            return;
        }

        // Check cooldown
        if (this.cooldowns.has(stock.token) && Date.now() < this.cooldowns.get(stock.token)) {
            return; // In cooldown for this stock
        }


        // Trading Logic (uses last closed candle's indicators and current LTP)
        if (!stock.bb || stock.rsi === null || stock.atr === null || !stock.option_type) {
            // this.logger.debug(`Indicators not ready for ${stock.symbol}`);
            return;
        }

        const position = this.activePositions.get(stock.token);

        if (position) { // Position exists, check for exit
            this.checkExitConditions(stock, ltp, position);
        } else { // No position, check for entry
            if (stock.option_type === "CE") {
                // Buy Call Condition: Price closes above Upper BB and RSI > buyThreshold
                if (ltp > stock.bb.upper && stock.rsi > this.config.tradingParameters.rsi.callBuyThreshold) {
                    this.executeBuy(stock, ltp, "BB_RSI_Breakout_CE");
                }
            } else if (stock.option_type === "PE") {
                // Buy Put Condition: Price closes below Lower BB and RSI < sellThreshold
                if (ltp < stock.bb.lower && stock.rsi < this.config.tradingParameters.rsi.putBuyThreshold) {
                    this.executeBuy(stock, ltp, "BB_RSI_Breakout_PE");
                }
            }
        }
    }

    checkExitConditions(stock, ltp, position) {
        let exitReason = null;

        // Stop Loss
        if (stock.option_type === "CE" && ltp <= position.slPrice) exitReason = "StopLoss Hit (CE)";
        if (stock.option_type === "PE" && ltp >= position.slPrice) exitReason = "StopLoss Hit (PE)";

        // Take Profit
        if (!exitReason) {
            if (stock.option_type === "CE" && ltp >= position.tpPrice) exitReason = "TakeProfit Hit (CE)";
            if (stock.option_type === "PE" && ltp <= position.tpPrice) exitReason = "TakeProfit Hit (PE)";
        }
        
        // (Optional) RSI based exit
        // if (!exitReason && stock.rsi !== null) {
        //     if (stock.option_type === "CE" && stock.rsi < this.config.tradingParameters.rsi.exitThresholdCall) {
        //         exitReason = "RSI Exit (CE)";
        //     }
        //     if (stock.option_type === "PE" && stock.rsi > this.config.tradingParameters.rsi.exitThresholdPut) {
        //         exitReason = "RSI Exit (PE)";
        //     }
        // }


        if (exitReason) {
            this.executeSell(stock, ltp, position, exitReason);
        }
    }

    async executeBuy(stock, price, reason) {
        if (this.activePositions.has(stock.token) || this.tradingHalted) return;

        const quantity = parseInt(stock.lotsize || this.config.riskManagement.defaultQuantity.toString());
        if (quantity <= 0) {
            this.logger.warn(`Invalid quantity ${quantity} for ${stock.symbol}`);
            return;
        }

        const atrVal = stock.atr || price * 0.01; // Fallback ATR if not calculated
        let slPrice, tpPrice;

        if (stock.option_type === "CE") {
            slPrice = price - (atrVal * this.config.tradingParameters.atr.slMultiplier);
            tpPrice = price + (atrVal * this.config.tradingParameters.atr.tpMultiplier);
        } else if (stock.option_type === "PE") {
            slPrice = price + (atrVal * this.config.tradingParameters.atr.slMultiplier);
            tpPrice = price - (atrVal * this.config.tradingParameters.atr.tpMultiplier);
        } else {
            this.logger.warn(`Cannot determine SL/TP for unknown option type: ${stock.symbol}`);
            return;
        }
        // Ensure SL and TP are not negative or unreasonable
        slPrice = Math.max(0.05, slPrice); // Minimum price
        tpPrice = Math.max(0.10, tpPrice);


        const newPosition = {
            token: stock.token,
            symbol: stock.symbol,
            option_type: stock.option_type,
            quantity,
            buyPrice: price,
            buyTime: moment.tz("Asia/Kolkata"),
            slPrice,
            tpPrice,
            pnl: 0, // Initial P&L
            exch_seg: stock.exch_seg,
            expiry: stock.expiry ? moment(stock.expiry) : null, // Ensure moment object
        };

        this.activePositions.set(stock.token, newPosition);
        this.savePositions();

        const alertMsg = `🟢 BUY ${stock.symbol} (${stock.option_type}) Q:${quantity} @${price.toFixed(2)} | SL:${slPrice.toFixed(2)} TP:${tpPrice.toFixed(2)} | Reason: ${reason}`;
        this.sendTelegramAlert(alertMsg);
        this.logger.logTrade({
            token: stock.token, symbol: stock.symbol, action: 'BUY', price: price, quantity: quantity,
            sl: slPrice, tp: tpPrice, reason: reason, dailyPnl: this.dailyPnL
        });
    }

    async executeSell(stock, price, position, reason) {
        this.activePositions.delete(stock.token);
        this.savePositions();

        const pnl = (price - position.buyPrice) * position.quantity * (position.option_type === "PE" ? -1 : 1);
        this.dailyPnL += pnl;

        const alertMsg = `🔴 SELL ${stock.symbol} (${position.option_type}) Q:${position.quantity} @${price.toFixed(2)} | P&L: ₹${pnl.toFixed(2)} | Total Day P&L: ₹${this.dailyPnL.toFixed(2)} | Reason: ${reason}`;
        this.sendTelegramAlert(alertMsg);
        this.logger.logTrade({
            token: stock.token, symbol: stock.symbol, action: 'SELL', price: price, quantity: position.quantity,
            pnl: pnl, reason: reason, dailyPnl: this.dailyPnL
        });

        if (reason.toLowerCase().includes("stoploss") || pnl < 0) {
             this.cooldowns.set(stock.token, Date.now() + (this.config.riskManagement.tradeCooldownSeconds || 0) * 1000);
        }

        // Check daily profit/loss limits
        if (this.config.riskManagement.haltTradingOnLimit) {
            if (this.dailyPnL <= this.config.riskManagement.maxDailyLoss) {
                this.tradingHalted = true;
                const msg = `🛑 TRADING HALTED: Max daily loss limit ₹${this.config.riskManagement.maxDailyLoss} reached. Current P&L: ₹${this.dailyPnL.toFixed(2)}`;
                this.sendTelegramAlert(msg);
                this.logger.warn(msg);
            }
            if (this.dailyPnL >= this.config.riskManagement.maxDailyProfit) {
                this.tradingHalted = true;
                const msg = `🎉 TRADING HALTED: Max daily profit limit ₹${this.config.riskManagement.maxDailyProfit} reached. Current P&L: ₹${this.dailyPnL.toFixed(2)}`;
                this.sendTelegramAlert(msg);
                this.logger.info(msg);
            }
        }
    }

    async closeAllOpenPositions(reason = "Market Close Square Off") {
        this.logger.info(`🕒 Closing all ${this.activePositions.size} open positions... Reason: ${reason}`);
        this.tradingHalted = true; // Halt new trades during square-off

        for (const [token, position] of this.activePositions) {
            const stock = this.stocks.find(s => s.token === token) || { symbol: position.symbol, token: token, option_type: position.option_type }; // Fallback
            // In a real scenario, you'd fetch current LTP here if available
            // For simulation, using last known close or buy price as fallback
            const lastLTP = this.currentCandles.get(token)?.close || position.buyPrice;
            await this.executeSell(stock, lastLTP, position, reason);
            await delay(200); // Small delay between closing orders
        }
        this.logger.info("✅ All open positions attempt to close.");
    }

    setupTelegramCommands() {
        this.bot.onText(/\/status/, (msg) => {
            const chatId = msg.chat.id;
            if (chatId.toString() !== this.config.chatId) return;

            let statusMsg = `*${this.config.strategyName} Status*\n`;
            statusMsg += `Trading: ${this.tradingHalted ? (this.manualTradingHalt ? 'MANUALLY HALTED 🔴' : 'HALTED (Limit) ⚠️') : 'ACTIVE 🟢'}\n`;
            statusMsg += `Daily P&L: ₹${this.dailyPnL.toFixed(2)}\n`;
            statusMsg += `Open Positions: ${this.activePositions.size}\n`;
            this.activePositions.forEach(pos => {
                const currentLtp = this.currentCandles.get(pos.token)?.close || pos.buyPrice;
                const currentPnl = (currentLtp - pos.buyPrice) * pos.quantity * (pos.option_type === "PE" ? -1 : 1);
                statusMsg += `  - ${pos.symbol} Q:${pos.quantity} Bought@${pos.buyPrice.toFixed(2)} LTP@${currentLtp.toFixed(2)} SL:${pos.slPrice.toFixed(2)} TP:${pos.tpPrice.toFixed(2)} ApproxUnrealizedP&L: ₹${currentPnl.toFixed(2)}\n`;
            });
            this.bot.sendMessage(chatId, statusMsg, { parse_mode: "Markdown" });
        });

        this.bot.onText(/\/halt/, (msg) => {
            const chatId = msg.chat.id;
            if (chatId.toString() !== this.config.chatId) return;
            this.tradingHalted = true;
            this.manualTradingHalt = true;
            this.sendTelegramAlert("✋ Trading MANUALLY HALTED by user command.");
            this.logger.warn("Trading MANUALLY HALTED by user command.");
        });

        this.bot.onText(/\/resume/, (msg) => {
            const chatId = msg.chat.id;
            if (chatId.toString() !== this.config.chatId) return;
            // Only resume if not halted by daily limits
            if (this.dailyPnL > this.config.riskManagement.maxDailyLoss && this.dailyPnL < this.config.riskManagement.maxDailyProfit) {
                this.tradingHalted = false;
                this.manualTradingHalt = false;
                this.sendTelegramAlert("▶️ Trading RESUMED by user command.");
                this.logger.info("Trading RESUMED by user command.");
            } else {
                this.sendTelegramAlert("⚠️ Cannot resume: Trading halted due to daily P&L limits.");
                this.logger.warn("Attempted to resume but halted by P&L limits.");
            }
        });

        this.bot.onText(/\/report/, async (msg) => {
            const chatId = msg.chat.id;
            if (chatId.toString() !== this.config.chatId) return;
            this.sendTelegramAlert("📊 Generating on-demand daily report...");
            await this.generateDailyReport(true); // Force send even if no trades
        });
         this.bot.onText(/\/config/, (msg) => {
            const chatId = msg.chat.id;
            if (chatId.toString() !== this.config.chatId) return;
            let configMsg = `*Current Strategy Configuration (${this.config.strategyName})*\n\n`;
            configMsg += `*Trading Parameters:*\n`;
            configMsg += `  BB Period: ${this.config.tradingParameters.bollingerBands.period}, StdDev: ${this.config.tradingParameters.bollingerBands.stdDev}\n`;
            configMsg += `  RSI Period: ${this.config.tradingParameters.rsi.period}, Call Buy Thresh: ${this.config.tradingParameters.rsi.callBuyThreshold}, Put Buy Thresh: ${this.config.tradingParameters.rsi.putBuyThreshold}\n`;
            configMsg += `  ATR Period: ${this.config.tradingParameters.atr.period}, SL Multi: ${this.config.tradingParameters.atr.slMultiplier}, TP Multi: ${this.config.tradingParameters.atr.tpMultiplier}\n`;
            configMsg += `*Risk Management:*\n`;
            configMsg += `  Max Daily Loss: ₹${this.config.riskManagement.maxDailyLoss}\n`;
            configMsg += `  Max Daily Profit: ₹${this.config.riskManagement.maxDailyProfit}\n`;
            configMsg += `  Halt on Limit: ${this.config.riskManagement.haltTradingOnLimit}\n`;
            this.bot.sendMessage(chatId, configMsg, { parse_mode: "Markdown" });
        });
    }

    async sendTelegramAlert(message) {
        try {
            await this.bot.sendMessage(this.config.chatId, `📈 ${this.config.strategyName}: ${message}`);
            // this.logger.info(`Telegram alert sent: ${message}`);
        } catch (error) {
            this.logger.error("Telegram send error:", error.message, error);
        }
    }

    async generateDailyReport(forceSend = false) {
        this.logger.info("Generating daily report...");
        try {
            const reportDate = moment.tz("Asia/Kolkata").format('YYYY-MM-DD');
            const reportJsonFile = path.join(__dirname, this.config.logFiles.dailyReportJson);
            const tradeCsvFile = path.join(__dirname, this.config.logFiles.tradeLogCsv);

            let tradesToday = [];
            if (fs.existsSync(tradeCsvFile)) {
                const lines = fs.readFileSync(tradeCsvFile, 'utf-8').split('\n').slice(1); // Skip header
                lines.forEach(line => {
                    if(line.trim() === '') return;
                    const parts = line.split(',');
                    //Timestamp,Token,Symbol,Action,Price,Quantity,SL,TP,PNL,Reason,DailyPNL
                    if (parts[0] && parts[0].startsWith(reportDate)) {
                         tradesToday.push({
                            timestamp: parts[0], token: parts[1], symbol: parts[2], action: parts[3],
                            price: parseFloat(parts[4]), quantity: parseInt(parts[5]),
                            sl: parts[6] !== 'N/A' ? parseFloat(parts[6]) : null,
                            tp: parts[7] !== 'N/A' ? parseFloat(parts[7]) : null,
                            pnl: parts[8] !== 'N/A' ? parseFloat(parts[8]) : null,
                            reason: parts[9],
                            dailyPnlSnapshot: parts[10] !== 'N/A' ? parseFloat(parts[10]) : null,
                        });
                    }
                });
            }

            if (tradesToday.length === 0 && !forceSend && this.activePositions.size === 0) {
                this.logger.info("No trades today to report.");
                return;
            }

            const totalPnlFromTrades = tradesToday.filter(t => t.action.toUpperCase() === 'SELL' && t.pnl !== null).reduce((sum, t) => sum + t.pnl, 0);
            // For open positions, calculate unrealized P&L
            let unrealizedPnl = 0;
            this.activePositions.forEach(pos => {
                 const currentLtp = this.currentCandles.get(pos.token)?.close || pos.buyPrice;
                 const pnl = (currentLtp - pos.buyPrice) * pos.quantity * (pos.option_type === "PE" ? -1 : 1);
                 unrealizedPnl += pnl;
            });


            const reportData = {
                date: reportDate,
                strategy: this.config.strategyName,
                closedTrades: tradesToday.filter(t => t.action.toUpperCase() === 'SELL'),
                openPositions: Array.from(this.activePositions.values()).map(p => {
                    const currentLtp = this.currentCandles.get(p.token)?.close || p.buyPrice;
                    const currentPnl = (currentLtp - p.buyPrice) * p.quantity * (p.option_type === "PE" ? -1 : 1);
                    return {...p, currentLtp, unrealizedPnl: currentPnl};
                }),
                totalRealizedPnL: totalPnlFromTrades,
                totalUnrealizedPnL: unrealizedPnl,
                finalDailyPnL: this.dailyPnL, // This should be the most accurate running total
                tradingHalted: this.tradingHalted,
                manualHalt: this.manualTradingHalt
            };
            fs.writeFileSync(reportJsonFile, JSON.stringify(reportData, null, 2));

            // Generate Text Report
            const fileName = `${this.config.strategyName}_Report_${reportDate}.txt`;
            let fileContent = `📊 ${this.config.strategyName} - DAILY REPORT ${reportDate} 📊\n`;
            fileContent += `Trading Status: ${this.tradingHalted ? (this.manualTradingHalt ? 'MANUALLY HALTED 🔴' : 'HALTED (Limit) ⚠️') : 'ACTIVE 🟢'}\n\n`;

            fileContent += "--- CLOSED TRADES ---\n";
            fileContent += "Time        Symbol              Action  Qty   Buy     Sell    P&L       Reason\n";
            fileContent += "-".repeat(90) + "\n";
            let lastBuy = {};
            reportData.closedTrades.forEach(trade => {
                if (trade.action.toUpperCase() === 'BUY') { // Should not happen in closed trades but as a safeguard
                     lastBuy[trade.token] = trade;
                } else if (trade.action.toUpperCase() === 'SELL') {
                    const buyTrade = tradesToday.find(bt => bt.token === trade.token && bt.action.toUpperCase() === 'BUY' && moment(bt.timestamp).isBefore(moment(trade.timestamp))) || { price: 'N/A', quantity: trade.quantity}; // simplified
                    fileContent += `${moment(trade.timestamp).format("HH:mm:ss").padEnd(12)}` +
                                   `${trade.symbol.padEnd(20)}` +
                                   `${trade.action.padEnd(8)}` +
                                   `${trade.quantity.toString().padStart(3)}   ` +
                                   `${(typeof buyTrade.price === 'number' ? buyTrade.price.toFixed(2) : buyTrade.price).padStart(7)} ` +
                                   `${trade.price.toFixed(2).padStart(7)} ` +
                                   `${(trade.pnl !== null ? trade.pnl.toFixed(2) : "N/A").padStart(8)}  ` +
                                   `${(trade.reason || '').substring(0,15)}\n`;
                }
            });
             if(reportData.closedTrades.length === 0) fileContent += "No trades closed today.\n";


            fileContent += "\n--- OPEN POSITIONS ---\n";
            fileContent += "Symbol              Qty   Bought@   LTP@    Unrealized P&L\n";
            fileContent += "-".repeat(90) + "\n";
            reportData.openPositions.forEach(pos => {
                 fileContent += `${pos.symbol.padEnd(20)}` +
                               `${pos.quantity.toString().padStart(3)}   ` +
                               `${pos.buyPrice.toFixed(2).padStart(7)}   ` +
                               `${pos.currentLtp.toFixed(2).padStart(7)}   ` +
                               `${pos.unrealizedPnl.toFixed(2).padStart(12)}\n`;
            });
            if(reportData.openPositions.length === 0) fileContent += "No open positions at EOD.\n";


            fileContent += "\n" + "-".repeat(90) + "\n";
            fileContent += `TOTAL REALIZED P&L: ${("₹"+reportData.totalRealizedPnL.toFixed(2)).padStart(15)}\n`;
            fileContent += `TOTAL UNREALIZED P&L: ${("₹"+reportData.totalUnrealizedPnL.toFixed(2)).padStart(13)}\n`;
            fileContent += `FINAL DAILY P&L (Strategy): ${("₹"+reportData.finalDailyPnL.toFixed(2)).padStart(10)}\n`;
            fileContent += "-".repeat(90) + "\n";


            fs.writeFileSync(fileName, fileContent);
            await this.bot.sendDocument(this.config.chatId, fileName, { caption: `📊 ${this.config.strategyName} Daily Report for ${reportDate} 📊` });
            fs.unlinkSync(fileName); // Delete file after sending
            this.logger.info("✅ Daily report generated and sent.");

        } catch (e) {
            this.logger.error("❌ Failed to generate/send daily report:", e.message, e);
            this.sendTelegramAlert(`⚠️ Error generating daily report: ${e.message}`);
        }
    }

    cleanup() {
        if (this.candleInterval) clearInterval(this.candleInterval);
        this.logger.info(`🧹 ${this.config.strategyName} cleanup finished.`);
        this.sendTelegramAlert(`🛑 ${this.config.strategyName} stopped.`);
        this.logger.close(); // Close log streams
        this.bot.stopPolling();
    }
}

// --- Main Runner ---
async function main() {
    let config;
    try {
        config = JSON.parse(fs.readFileSync(path.join(__dirname, 'strategy_config.json'), 'utf-8'));
    } catch (e) {
        console.error("❌ FATAL: Could not load strategy_config.json.", e);
        process.exit(1);
    }

    const masterController = new MasterController(); // Assuming MC handles its own config for API keys
    let strategyInstance;

    try {
        await masterController.initialize(); // Ensure MC is initialized (connects to API etc.)
        strategyInstance = new AdvancedOptionsTrader(masterController, config);
        console.log(`Main runner: ${config.strategyName} strategy instantiated. Waiting for MC connection and market events...`);

    } catch (error) {
        console.error("❌ Main application startup failed:", error.message, error.stack);
        if (strategyInstance && strategyInstance.logger) {
             strategyInstance.logger.error("❌ Main application startup failed:", error.message, error);
             strategyInstance.sendTelegramAlert(`☠️ FATAL ERROR during startup: ${error.message}`);
        }
        process.exit(1);
    }

    // Graceful shutdown
    const shutdown = async (signal) => {
        console.log(`\n${signal} received. Shutting down ${config.strategyName}...`);
        if (strategyInstance) {
            await strategyInstance.closeAllOpenPositions(`Shutdown Signal: ${signal}`);
            await strategyInstance.generateDailyReport(true); // Force report on shutdown
            strategyInstance.cleanup();
        }
        if (masterController) {
            masterController.cleanup();
        }
        console.log("Exiting.");
        process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('uncaughtException', (error) => {
        console.error('Uncaught Exception:', error);
        if (strategyInstance && strategyInstance.logger) {
            strategyInstance.logger.error('UNCAUGHT EXCEPTION:', error.message, error);
            strategyInstance.sendTelegramAlert(`💥 UNCAUGHT EXCEPTION: ${error.message}`);
        }
        // Optionally, try to shutdown gracefully or just exit
        // shutdown('uncaughtException').then(() => process.exit(1)).catch(() => process.exit(1));
        process.exit(1); // Or a more graceful shutdown
    });
     process.on('unhandledRejection', (reason, promise) => {
        console.error('Unhandled Rejection at:', promise, 'reason:', reason);
        if (strategyInstance && strategyInstance.logger) {
            strategyInstance.logger.error('UNHANDLED REJECTION:', reason instanceof Error ? reason.message : String(reason), reason);
            strategyInstance.sendTelegramAlert(`🚫 UNHANDLED REJECTION: ${reason instanceof Error ? reason.message : String(reason)}`);
        }
        // Optionally, try to shutdown gracefully or just exit
        process.exit(1);
    });
}

main();