// File: D:\master_controller\advanced_strategy\advanced_options_trader.js
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const TelegramBot = require("node-telegram-bot-api");
const fs = require('fs');
const moment = require("moment-timezone");
const MasterController = require('../universal websocket/index.js');
const { getOptionType, delay } = require('./utils.js');
const { calculateSMA, calculateStandardDeviation, calculateRSI, calculateATR, calculateSR } = require('./indicator_calculator.js');
const Logger = require('./logger.js');
const OIManager = require('./oi_manager.js');
const MLPredictor = require('./ml_predictor.js');

class AdvancedOptionsTrader {
    constructor(masterController, config) {
        this.masterController = masterController;
        this.config = config;
        this.logger = new Logger(config.logFiles, config.strategyName);

        this.stocks = this.loadStocks();
        this.currentCandles = new Map();
        this.candleInterval = null;
        this.activePositions = this.loadPositions();
        this.tradingHalted = false;
        this.manualTradingHalt = false;
        this.dailyPnL = 0;
        this.cooldowns = new Map();
        this.majorSR = new Map();

        // Set market hours from config
        this.eodTaskTime = moment.tz("Asia/Kolkata").set({
            hour: this.config.marketHours.eodTaskHour,
            minute: this.config.marketHours.eodTaskMinute,
            second: 0
        });
        this.marketOpenTime = moment.tz("Asia/Kolkata").set({
            hour: this.config.marketHours.open.split(':')[0],
            minute: this.config.marketHours.open.split(':')[1],
            second: 0
        });
        this.marketCloseTime = moment.tz("Asia/Kolkata").set({
            hour: this.config.marketHours.close.split(':')[0],
            minute: this.config.marketHours.close.split(':')[1],
            second: 0
        });

        // Initialize Telegram
        if (this.config.telegramBotToken && this.config.chatId) {
            this.bot = new TelegramBot(this.config.telegramBotToken, { polling: true });
            this.setupTelegramCommands();
            this.logger.info("Telegram bot initialized.");
        } else {
            this.logger.warn("Telegram credentials missing - alerts disabled");
        }

        // Initialize modules
        this.oiManager = new OIManager(this.config.oi_analysis, this.stocks, this.logger);
        this.mlPredictor = new MLPredictor(this.config.ml_prediction, this.logger);
        this.masterController.registerStrategy(this);
        
        this.initialize();
        this.logger.info(`📈 ${this.config.strategyName} initialized.`);
        this.sendTelegramAlert(`🚀 ${this.config.strategyName} started successfully!`);
    }

    async initialize() {
        this.logger.info("🚀 Starting Strategy Initialization...");
        this.marketClosed = false;

        // 1. Initialize Major Index/Stock S/R Data
        await this.initializeMajorInstrumentSRData();

        // 2. Verify loaded stocks
        if (this.stocks.length === 0) {
            this.logger.warn("⚠️ No stocks loaded from updated_options.json");
        } else {
            this.logger.info(`✅ Loaded ${this.stocks.length} options/instruments`);
        }

        // 3. Fetch Historical Data
        await this.fetchAllHistoricalData();

        // 4. Schedule Candle Updates
        this.scheduleCandleUpdates();

        // 5. Initialize current candles
        this.initializeNewCandles();

        // 6. Schedule EOD Tasks
        this.scheduleEodTasks();

        // 7. Start OI Manager if market open
        const now = moment.tz("Asia/Kolkata");
        if (this.config.oiManager.enabled && now.isBetween(this.marketOpenTime, this.marketCloseTime)) {
            this.logger.info("📈 Starting OI Manager...");
            this.oiManager.start();
        }

        this.logger.info("✅ Strategy Initialization Complete.");
    }

    //===================== S/R DATA MANAGEMENT =====================//
    async initializeMajorInstrumentSRData() {
        this.logger.info("⏳ Initializing Major Instrument S/R Data...");
        this.majorSR.clear();

        const processConfigs = async (configs, type) => {
            if (!configs) return;
            
            for (const key in configs) {
                const config = configs[key];
                try {
                    this.logger.info(`[MajorSR - ${type}] Processing ${config.name}`);
                    
                    const toDate = moment.tz("Asia/Kolkata");
                    const fromDate = toDate.clone().subtract(20, 'days');
                    
                    const params = {
                        exchange: config.exch_seg,
                        symboltoken: config.token,
                        interval: 'ONE_HOUR',
                        fromdate: fromDate.format("YYYY-MM-DD 09:15"),
                        todate: toDate.format("YYYY-MM-DD 15:30")
                    };

                    const historicalData = await this.masterController.getHistoricalData(params);
                    
                    if (historicalData?.status && Array.isArray(historicalData.data)) {
                        const srData = this.calculateSRLevelsFromCandles(historicalData.data);
                        this.majorSR.set(config.name, srData);
                        
                        // Save to CSV
                        const allLevels = [...srData.supports, ...srData.resistances]
                            .filter((v, i, a) => a.indexOf(v) === i)
                            .sort((a, b) => a - b);
                        const outputPath = path.join(__dirname, config.sr_levels_file || `${config.name.toLowerCase()}_sr_levels.csv`);
                        this.saveSRLevelsToCsv(allLevels, outputPath);
                    }
                    await delay(this.config.fetchDelayMs || 300);
                } catch (error) {
                    this.logger.error(`[MajorSR] Error for ${config.name}: ${error.message}`);
                }
            }
        };

        await processConfigs(this.config.majorIndexSR, "Index");
        await processConfigs(this.config.majorStockSR, "Stock");
        this.logger.info("✅ Major Instrument S/R Data Initialized");
    }

    calculateSRLevelsFromCandles(candles, numLevels = 5) {
        if (!candles || candles.length === 0) return { supports: [], resistances: [] };
        
        const highs = candles.map(c => parseFloat(c[2])).filter(h => !isNaN(h));
        const lows = candles.map(c => parseFloat(c[3])).filter(l => !isNaN(l));
        
        return {
            supports: [...new Set(lows)].sort((a, b) => a - b).slice(0, numLevels),
            resistances: [...new Set(highs)].sort((a, b) => b - a).slice(0, numLevels).sort((a, b) => a - b)
        };
    }

    saveSRLevelsToCsv(levels, outputPath) {
        try {
            const csvContent = "level\n" + levels.map(l => l.toFixed(2)).join("\n");
            const dir = path.dirname(outputPath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(outputPath, csvContent);
        } catch (error) {
            this.logger.error(`[SR Save] Failed to save: ${error.message}`);
        }
    }

    //===================== DATA MANAGEMENT =====================//
    loadStocks() {
        try {
            const filePath = path.join(__dirname, this.config.logFiles.updatedStocks);
            if (!fs.existsSync(filePath)) {
                this.logger.warn(`⚠️ ${filePath} not found`);
                return [];
            }
            
            const stocksData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
            return stocksData.map(s => ({
                ...s,
                option_type: s.option_type || getOptionType(s.symbol),
                candles: [],
                calculated: false,
                bb: null,
                rsi: null,
                atr: null,
                support: null,
                resistance: null,
            }));
        } catch (e) {
            this.logger.error(`❌ Error loading stocks: ${e.message}`);
            return [];
        }
    }

    loadPositions() {
        try {
            const filePath = path.join(__dirname, this.config.logFiles.positions);
            if (!fs.existsSync(filePath)) return new Map();
            
            const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            const loadedPositions = new Map();
            
            data.forEach(p => {
                if (!p.token) return;
                const stockInfo = this.stocks.find(s => s.token === p.token);
                loadedPositions.set(p.token, {
                    ...p,
                    buyTime: moment(p.buyTime),
                    expiry: p.expiry ? moment(p.expiry) : null,
                    buyPrice: parseFloat(p.buyPrice),
                    quantity: parseInt(p.quantity),
                    slPrice: parseFloat(p.slPrice),
                    tpPrice: parseFloat(p.tpPrice),
                    symbol: p.symbol || stockInfo?.symbol,
                    exch_seg: p.exch_seg || stockInfo?.exch_seg || 'NFO',
                    option_type: p.option_type || stockInfo?.option_type,
                });
            });
            
            return loadedPositions;
        } catch (error) {
            this.logger.error('❌ Error loading positions:', error.message);
            return new Map();
        }
    }

    savePositions() {
        try {
            const dataToSave = Array.from(this.activePositions.values()).map(p => ({
                ...p,
                buyTime: p.buyTime?.toISOString(),
                expiry: p.expiry?.toISOString()
            }));
            fs.writeFileSync(path.join(__dirname, this.config.logFiles.positions), JSON.stringify(dataToSave, null, 2));
        } catch (e) {
            this.logger.error("❌ Error saving positions:", e.message);
        }
    }

    //===================== HISTORICAL DATA =====================//
    async fetchAllHistoricalData() {
        this.logger.info("⏳ Fetching historical data...");
        
        for (const stock of this.stocks) {
            try {
                const toDate = moment.tz("Asia/Kolkata");
                const fromDate = toDate.clone().subtract(this.config.tradingParameters.historicalDataDays, 'days');
                
                const params = {
                    exchange: stock.exch_seg,
                    symboltoken: stock.token,
                    interval: this.mapInterval(this.config.tradingParameters.candleIntervalMinutes),
                    fromdate: fromDate.format("YYYY-MM-DD 09:15"),
                    todate: toDate.format("YYYY-MM-DD 15:30")
                };

                const historicalData = await this.masterController.getHistoricalData(params);
                
                if (historicalData?.status && Array.isArray(historicalData.data)) {
                    stock.candles = historicalData.data.map(candle => ({
                        timestamp: moment(candle[0]).tz("Asia/Kolkata"),
                        open: parseFloat(candle[1]),
                        high: parseFloat(candle[2]),
                        low: parseFloat(candle[3]),
                        close: parseFloat(candle[4]),
                        volume: parseInt(candle[5])
                    }));
                    
                    this.calculateIndicators(stock);
                    this.saveHistoricalDataToCsv(stock);
                }
                await delay(this.config.fetchDelayMs || 100);
            } catch (error) {
                this.logger.error(`[HistData] Failed for ${stock.symbol}: ${error.message}`);
            }
        }
        this.logger.info("✅ Historical data loaded");
    }

    mapInterval(minutes) {
        const intervalMap = {
            1: 'ONE_MINUTE',
            5: 'FIVE_MINUTE',
            15: 'FIFTEEN_MINUTE',
            30: 'THIRTY_MINUTE',
            60: 'ONE_HOUR',
            1440: 'ONE_DAY'
        };
        return intervalMap[minutes] || 'FIFTEEN_MINUTE';
    }

    saveHistoricalDataToCsv(stock) {
        if (!stock.candles || stock.candles.length === 0) return;
        
        try {
            const dataDir = path.join(__dirname, 'historical_data_logs');
            if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
            
            const filePath = path.join(dataDir, `${stock.symbol}_${this.config.tradingParameters.candleIntervalMinutes}min_hist.csv`);
            let csvContent = "Timestamp,Open,High,Low,Close,Volume\n";
            
            stock.candles.forEach(c => {
                const ts = moment(c.timestamp).format("YYYY-MM-DD HH:mm:ss");
                csvContent += `${ts},${c.open},${c.high},${c.low},${c.close},${c.volume}\n`;
            });
            
            fs.writeFileSync(filePath, csvContent);
        } catch (error) {
            this.logger.error(`CSV save failed for ${stock.symbol}: ${error.message}`);
        }
    }

    //===================== CANDLE MANAGEMENT =====================//
    scheduleCandleUpdates() {
        this.logger.info("⏳ Scheduling candle updates...");
        const intervalMinutes = this.config.tradingParameters.candleIntervalMinutes;
        
        const calculateNextRun = () => {
            const now = moment.tz("Asia/Kolkata");
            const minutesTillNext = intervalMinutes - (now.minute() % intervalMinutes);
            return now.clone()
                .add(minutesTillNext, 'minutes')
                .set({ second: 5, millisecond: 0 });
        };

        const runUpdate = () => {
            if (this.marketClosed) return;
            this.performCandleUpdateCycle();
            this.candleInterval = setTimeout(runUpdate, intervalMinutes * 60 * 1000);
        };

        const firstRun = calculateNextRun();
        const initialDelay = firstRun.diff(moment.tz("Asia/Kolkata"));
        
        setTimeout(runUpdate, initialDelay);
        this.logger.info(`First candle update at ${firstRun.format("HH:mm:ss")}`);
    }

    performCandleUpdateCycle() {
        this.logger.info("🔔 Candle Update Cycle Started");
        try {
            this.finalizeCurrentCandles();
            this.initializeNewCandles();
            
            this.stocks.forEach(stock => {
                this.calculateIndicators(stock);
                this.saveHistoricalDataToCsv(stock);
            });
        } catch (error) {
            this.logger.error("Candle update error:", error);
        }
    }

    finalizeCurrentCandles() {
        this.currentCandles.forEach((candle, token) => {
            const stock = this.stocks.find(s => s.token === token);
            if (stock && candle.open !== null) {
                stock.candles.push({ ...candle });
                if (stock.candles.length > this.config.tradingParameters.maxCandleStorage) {
                    stock.candles.shift();
                }
            }
        });
    }

    initializeNewCandles() {
        this.currentCandles = new Map();
        const now = moment.tz("Asia/Kolkata");
        
        this.stocks.forEach(stock => {
            this.currentCandles.set(stock.token, {
                timestamp: now.valueOf(),
                open: null,
                high: -Infinity,
                low: Infinity,
                close: null,
                volume: 0
            });
        });
    }

    //===================== INDICATOR CALCULATION =====================//
    calculateIndicators(stock) {
        if (!stock.candles || stock.candles.length === 0) return;
        
        const closes = stock.candles.map(c => c.close);
        const highs = stock.candles.map(c => c.high);
        const lows = stock.candles.map(c => c.low);
        
        // Bollinger Bands
        const sma = calculateSMA(closes, this.config.tradingParameters.bollingerBands.period);
        const stdDev = calculateStandardDeviation(closes, this.config.tradingParameters.bollingerBands.period);
        stock.bb = sma !== null && stdDev !== null ? {
            middle: sma,
            upper: sma + (this.config.tradingParameters.bollingerBands.stdDev * stdDev),
            lower: sma - (this.config.tradingParameters.bollingerBands.stdDev * stdDev),
        } : null;

        // RSI
        stock.rsi = calculateRSI(closes, this.config.tradingParameters.rsi.period);

        // ATR
        stock.atr = calculateATR(stock.candles, this.config.tradingParameters.atr.period);

        // Support & Resistance
        const srLevels = calculateSR(stock.candles, this.config.tradingParameters.srLookbackPeriod);
        stock.support = srLevels.support;
        stock.resistance = srLevels.resistance;
    }

    //===================== TRADING LOGIC =====================//
    async processData(data) {
        const stock = this.stocks.find(s => s.token === data.token);
        if (!stock) return;
        
        const ltp = parseFloat(data.ltp);
        if (isNaN(ltp)) return;

        // Update current candle
        const currentCandle = this.currentCandles.get(stock.token);
        if (currentCandle) {
            if (currentCandle.open === null) currentCandle.open = ltp;
            currentCandle.high = Math.max(currentCandle.high, ltp);
            currentCandle.low = Math.min(currentCandle.low, ltp);
            currentCandle.close = ltp;
        }

        // Get major index S/R levels
        let majorSRData = null;
        const stockSymbol = stock.symbol.toUpperCase();
        if (stockSymbol.includes("NIFTY")) {
            majorSRData = this.majorSR.get("NIFTY");
        } else if (stockSymbol.includes("BANKNIFTY")) {
            majorSRData = this.majorSR.get("BANKNIFTY");
        }

        // Handle position management
        const position = this.activePositions.get(stock.token);
        if (position) {
            this.checkExitConditions(stock, ltp, position);
        } else if (!this.tradingHalted) {
            this.evaluateEntryConditions(stock, ltp);
        }
    }

    async evaluateEntryConditions(stock, ltp) {
        if (this.cooldowns.has(stock.token) && Date.now() < this.cooldowns.get(stock.token)) return;
        if (!stock.bb || stock.rsi === null || stock.atr === null) return;
        
        const srBuffer = this.config.tradingParameters.srBufferFactor || 0.005;
        let oiSignal = 'NEUTRAL';
        let mlPrediction = 'NEUTRAL';

        // Get OI signal if enabled
        if (this.config.tradingParameters.useOIConfirm) {
            oiSignal = this.oiManager.getTradeSignal(stock.token, stock.option_type);
        }

        // Get ML prediction if enabled
        if (this.config.tradingParameters.useMLConfirm) {
            try {
                mlPrediction = await this.mlPredictor.getPrediction(stock);
            } catch (error) {
                this.logger.error(`ML prediction failed: ${error.message}`);
            }
        }

        // Trading logic
        if (stock.option_type === "CE") {
            if (ltp > stock.bb.upper && stock.rsi > this.config.tradingParameters.rsi.callBuyThreshold) {
                if (ltp < stock.resistance * (1 - srBuffer)) {
                    const oiConfirm = !this.config.tradingParameters.useOIConfirm || oiSignal === 'BULLISH';
                    const mlConfirm = !this.config.tradingParameters.useMLConfirm || mlPrediction === 'BULLISH';
                    
                    if (oiConfirm && mlConfirm) {
                        this.executeBuy(stock, ltp, `BB_RSI_CE (OI:${oiSignal}, ML:${mlPrediction})`);
                    }
                }
            } else if (ltp <= (stock.support * (1 + srBuffer)) && 
                       ltp <= stock.bb.lower && 
                       stock.rsi < 35) {
                const oiConfirm = !this.config.tradingParameters.useOIConfirm || oiSignal === 'BULLISH';
                const mlConfirm = !this.config.tradingParameters.useMLConfirm || mlPrediction === 'BULLISH';
                
                if (oiConfirm && mlConfirm) {
                    this.executeBuy(stock, ltp, `MeanRev_CE`);
                }
            }
        } 
        else if (stock.option_type === "PE") {
            if (ltp < stock.bb.lower && stock.rsi < this.config.tradingParameters.rsi.putBuyThreshold) {
                if (ltp > stock.support * (1 + srBuffer)) {
                    const oiConfirm = !this.config.tradingParameters.useOIConfirm || oiSignal === 'BEARISH';
                    const mlConfirm = !this.config.tradingParameters.useMLConfirm || mlPrediction === 'BEARISH';
                    
                    if (oiConfirm && mlConfirm) {
                        this.executeBuy(stock, ltp, `BB_RSI_PE (OI:${oiSignal}, ML:${mlPrediction})`);
                    }
                }
            } else if (ltp >= (stock.resistance * (1 - srBuffer)) && 
                       ltp >= stock.bb.upper && 
                       stock.rsi > 65) {
                const oiConfirm = !this.config.tradingParameters.useOIConfirm || oiSignal === 'BEARISH';
                const mlConfirm = !this.config.tradingParameters.useMLConfirm || mlPrediction === 'BEARISH';
                
                if (oiConfirm && mlConfirm) {
                    this.executeBuy(stock, ltp, `MeanRev_PE`);
                }
            }
        }
    }

    //===================== TRADE EXECUTION =====================//
    async executeBuy(stock, price, reason) {
        if (this.activePositions.has(stock.token) || this.tradingHalted) return;
        
        const quantity = parseInt(stock.lotsize || this.config.riskManagement.defaultQuantity);
        if (quantity <= 0) {
            this.logger.warn(`Invalid quantity for ${stock.symbol}`);
            return;
        }

        // Calculate SL/TP using ATR
        const atrVal = stock.atr;
        if (!atrVal || atrVal <= 0) {
            this.logger.error(`Invalid ATR for ${stock.symbol}`);
            return;
        }
        
        let slPrice, tpPrice;
        if (stock.option_type === "CE") {
            slPrice = price - (atrVal * this.config.tradingParameters.atr.slMultiplier);
            tpPrice = price + (atrVal * this.config.tradingParameters.atr.tpMultiplier);
        } else {
            slPrice = price + (atrVal * this.config.tradingParameters.atr.slMultiplier);
            tpPrice = price - (atrVal * this.config.tradingParameters.atr.tpMultiplier);
        }

        // Create position
        const newPosition = {
            token: stock.token,
            symbol: stock.symbol,
            option_type: stock.option_type,
            quantity,
            buyPrice: price,
            buyTime: moment.tz("Asia/Kolkata"),
            originalSlPrice: slPrice,
            originalTpPrice: tpPrice,
            currentSlPrice: slPrice,
            pnl: 0,
            exch_seg: stock.exch_seg,
            expiry: stock.expiry ? moment(stock.expiry, "DDMMMYYYY") : null,
            highestPriceSinceBuy: price,
            lowestPriceSinceBuy: price,
            trailingSlPrice: null,
            isTrailingActive: false,
            initialAtrAtBuy: atrVal
        };

        this.activePositions.set(stock.token, newPosition);
        this.savePositions();
        
        const alertMsg = `🟢 BUY ${stock.symbol} (${stock.option_type}) Q:${quantity} @${price.toFixed(2)} | SL:${slPrice.toFixed(2)} TP:${tpPrice.toFixed(2)} | Reason: ${reason}`;
        this.sendTelegramAlert(alertMsg);
        this.logger.logTrade({
            token: stock.token,
            symbol: stock.symbol,
            action: 'BUY',
            price: price,
            quantity: quantity,
            sl: slPrice,
            tp: tpPrice,
            reason: reason,
            dailyPnl: this.dailyPnL
        });
    }

    async executeSell(stock, price, position, reason) {
        this.activePositions.delete(stock.token);
        this.savePositions();
        
        const pnl = (price - position.buyPrice) * position.quantity * 
                   (position.option_type === "PE" ? -1 : 1);
        this.dailyPnL += pnl;
        
        const alertMsg = `🔴 SELL ${stock.symbol} (${position.option_type}) Q:${position.quantity} @${price.toFixed(2)} | P&L: ₹${pnl.toFixed(2)} | Total Day P&L: ₹${this.dailyPnL.toFixed(2)} | Reason: ${reason}`;
        this.sendTelegramAlert(alertMsg);
        this.logger.logTrade({
            token: stock.token,
            symbol: stock.symbol,
            action: 'SELL',
            price: price,
            quantity: position.quantity,
            pnl: pnl,
            reason: reason,
            dailyPnl: this.dailyPnL
        });

        // Handle cooldown after loss
        if (reason.toLowerCase().includes("stoploss") || pnl < 0) {
            this.cooldowns.set(stock.token, Date.now() + 
                (this.config.riskManagement.tradeCooldownSeconds || 0) * 1000);
        }

        // Check daily limits
        if (this.config.riskManagement.haltTradingOnLimit) {
            if (this.dailyPnL <= this.config.riskManagement.maxDailyLoss) {
                this.tradingHalted = true;
                const msg = `🛑 TRADING HALTED: Max daily loss limit reached`;
                this.sendTelegramAlert(msg);
                this.logger.warn(msg);
            }
            if (this.dailyPnL >= this.config.riskManagement.maxDailyProfit) {
                this.tradingHalted = true;
                const msg = `🎉 TRADING HALTED: Max daily profit limit reached`;
                this.sendTelegramAlert(msg);
                this.logger.info(msg);
            }
        }
    }

    //===================== POSITION MANAGEMENT =====================//
    checkExitConditions(stock, ltp, position) {
        const tslConfig = this.config.tradingParameters.trailingStopLoss;
        const currentAtr = stock.atr || position.initialAtrAtBuy;
        let exitReason = null;

        // Update trailing stop if active
        if (tslConfig?.enabled && position.isTrailingActive) {
            if (position.option_type === "CE") {
                position.highestPriceSinceBuy = Math.max(position.highestPriceSinceBuy, ltp);
                const newTrailingSl = position.highestPriceSinceBuy - (currentAtr * tslConfig.trailAtrMultiple);
                position.trailingSlPrice = Math.max(newTrailingSl, position.trailingSlPrice);
            } else {
                position.lowestPriceSinceBuy = Math.min(position.lowestPriceSinceBuy, ltp);
                const newTrailingSl = position.lowestPriceSinceBuy + (currentAtr * tslConfig.trailAtrMultiple);
                position.trailingSlPrice = Math.min(newTrailingSl, position.trailingSlPrice);
            }
            position.currentSlPrice = position.trailingSlPrice;
        }
        // Activate trailing stop if profit threshold reached
        else if (tslConfig?.enabled && !position.isTrailingActive) {
            const profit = position.option_type === "CE" 
                ? ltp - position.buyPrice 
                : position.buyPrice - ltp;
                
            if (profit >= (currentAtr * tslConfig.activationAtrMultiple)) {
                position.isTrailingActive = true;
                if (position.option_type === "CE") {
                    position.highestPriceSinceBuy = ltp;
                    position.trailingSlPrice = ltp - (currentAtr * tslConfig.trailAtrMultiple);
                } else {
                    position.lowestPriceSinceBuy = ltp;
                    position.trailingSlPrice = ltp + (currentAtr * tslConfig.trailAtrMultiple);
                }
                position.currentSlPrice = position.trailingSlPrice;
            }
        }

        // Check exit conditions
        if (position.option_type === "CE" && ltp <= position.currentSlPrice) {
            exitReason = position.isTrailingActive 
                ? `Trailing SL Hit (CE)` 
                : `StopLoss Hit (CE)`;
        } 
        else if (position.option_type === "PE" && ltp >= position.currentSlPrice) {
            exitReason = position.isTrailingActive 
                ? `Trailing SL Hit (PE)` 
                : `StopLoss Hit (PE)`;
        }
        else if (!position.isTrailingActive) {
            if (position.option_type === "CE" && ltp >= position.originalTpPrice) {
                exitReason = "TakeProfit Hit (CE)";
            }
            else if (position.option_type === "PE" && ltp <= position.originalTpPrice) {
                exitReason = "TakeProfit Hit (PE)";
            }
        }
        else if (position.option_type === "CE" && ltp >= stock.resistance) {
            exitReason = "Resistance Hit (CE)";
        }
        else if (position.option_type === "PE" && ltp <= stock.support) {
            exitReason = "Support Hit (PE)";
        }

        if (exitReason) {
            this.executeSell(stock, ltp, position, exitReason);
        } else {
            this.activePositions.set(stock.token, position);
            this.savePositions();
        }
    }

    async closeAllOpenPositions(reason = "Market Close Square Off") {
        this.logger.info(`🕒 Closing all open positions: ${reason}`);
        this.tradingHalted = true;
        
        for (const [token, position] of this.activePositions) {
            const stock = this.stocks.find(s => s.token === token) || { 
                symbol: position.symbol, 
                token: token, 
                option_type: position.option_type 
            };
            const lastLtp = this.currentCandles.get(token)?.close || position.buyPrice;
            await this.executeSell(stock, lastLtp, position, reason);
            await delay(200);
        }
    }

    //===================== EOD MANAGEMENT =====================//
    scheduleEodTasks() {
        const now = moment.tz("Asia/Kolkata");
        this.logger.info(`[EOD Sched] Now: ${now.format()}, EOD Time: ${this.eodTaskTime.format()}`);
        
        if (now.isAfter(this.eodTaskTime) {
            if (this.activePositions.size > 0) {
                this.logger.info("Running EOD tasks immediately (positions open)");
                this.performEodRoutine();
            }
            return;
        }

        const timeToEod = this.eodTaskTime.diff(now);
        if (timeToEod > 0) {
            this.logger.info(`🕒 EOD tasks in ${moment.duration(timeToEod).humanize()}`);
            setTimeout(() => this.performEodRoutine(), timeToEod);
        }
    }

    async performEodRoutine() {
        this.logger.info("🔔 Performing EOD routine...");
        this.marketClosed = true;
        this.tradingHalted = true;
        
        await this.closeAllOpenPositions('EOD Square Off');
        await this.generateDailyReport(true);
        
        if (this.candleInterval) {
            clearInterval(this.candleInterval);
            this.candleInterval = null;
        }
        
        if (this.oiManager) {
            this.oiManager.stopUpdates();
        }
        
        this.sendTelegramAlert("Market Closed. EOD routine complete.");
        this.logger.info("✅ EOD routine complete.");
    }

    //===================== REPORTING =====================//
    async generateDailyReport(forceSend = false) {
        this.logger.info("Generating daily report...");
        try {
            const reportDate = moment.tz("Asia/Kolkata").format('YYYY-MM-DD');
            const reportJsonFile = path.join(__dirname, this.config.logFiles.dailyReportJson);
            const tradeCsvFile = path.join(__dirname, this.config.logFiles.tradeLogCsv);

            // Collect today's trades
            let tradesToday = [];
            if (fs.existsSync(tradeCsvFile)) {
                const lines = fs.readFileSync(tradeCsvFile, 'utf-8').split('\n').slice(1);
                tradesToday = lines.filter(line => line.trim() !== '')
                    .filter(line => line.startsWith(reportDate))
                    .map(line => {
                        const parts = line.split(',');
                        return {
                            timestamp: parts[0],
                            token: parts[1],
                            symbol: parts[2],
                            action: parts[3],
                            price: parseFloat(parts[4]),
                            quantity: parseInt(parts[5]),
                            sl: parts[6] !== 'N/A' ? parseFloat(parts[6]) : null,
                            tp: parts[7] !== 'N/A' ? parseFloat(parts[7]) : null,
                            pnl: parts[8] !== 'N/A' ? parseFloat(parts[8]) : null,
                            reason: parts[9],
                            dailyPnlSnapshot: parts[10] !== 'N/A' ? parseFloat(parts[10]) : null,
                        };
                    });
            }

            // Prepare report data
            const reportData = {
                date: reportDate,
                strategy: this.config.strategyName,
                closedTrades: tradesToday.filter(t => t.action === 'SELL'),
                openPositions: Array.from(this.activePositions.values()).map(p => {
                    const currentLtp = this.currentCandles.get(p.token)?.close || p.buyPrice;
                    const unrealizedPnl = (currentLtp - p.buyPrice) * p.quantity * 
                                        (p.option_type === "PE" ? -1 : 1);
                    return { ...p, currentLtp, unrealizedPnl };
                }),
                totalRealizedPnL: tradesToday.filter(t => t.action === 'SELL')
                    .reduce((sum, t) => sum + (t.pnl || 0), 0),
                totalUnrealizedPnL: Array.from(this.activePositions.values()).reduce((sum, p) => {
                    const currentLtp = this.currentCandles.get(p.token)?.close || p.buyPrice;
                    const pnl = (currentLtp - p.buyPrice) * p.quantity * 
                              (p.option_type === "PE" ? -1 : 1);
                    return sum + pnl;
                }, 0),
                finalDailyPnL: this.dailyPnL,
                tradingHalted: this.tradingHalted,
                manualHalt: this.manualTradingHalt
            };
            
            fs.writeFileSync(reportJsonFile, JSON.stringify(reportData, null, 2));
            
            // Generate text report
            const fileName = `${this.config.strategyName}_Report_${reportDate}.txt`;
            let fileContent = `📊 ${this.config.strategyName} - DAILY REPORT ${reportDate} 📊\n`;
            fileContent += `Trading Status: ${this.tradingHalted ? 'HALTED' : 'ACTIVE'}\n\n`;
            
            // Closed trades section
            fileContent += "--- CLOSED TRADES ---\n";
            reportData.closedTrades.forEach(trade => {
                fileContent += `${trade.timestamp} ${trade.symbol} ${trade.action} ${trade.quantity} @${trade.price} P&L: ${trade.pnl}\n`;
            });
            
            // Open positions section
            fileContent += "\n--- OPEN POSITIONS ---\n";
            reportData.openPositions.forEach(pos => {
                fileContent += `${pos.symbol} Q:${pos.quantity} B:${pos.buyPrice} LTP:${pos.currentLtp} Unrealized: ${pos.unrealizedPnl}\n`;
            });
            
            // Summary section
            fileContent += `\nTOTAL REALIZED P&L: ₹${reportData.totalRealizedPnL.toFixed(2)}\n`;
            fileContent += `TOTAL UNREALIZED P&L: ₹${reportData.totalUnrealizedPnL.toFixed(2)}\n`;
            fileContent += `FINAL DAILY P&L: ₹${reportData.finalDailyPnL.toFixed(2)}\n`;
            
            fs.writeFileSync(fileName, fileContent);
            
            // Send report
            if (this.bot) {
                await this.bot.sendDocument(
                    this.config.chatId, 
                    fileName, 
                    { caption: `📊 ${this.config.strategyName} Daily Report` }
                );
                fs.unlinkSync(fileName);
            }
            
        } catch (e) {
            this.logger.error("Report generation error:", e.message);
        }
    }

    //===================== TELEGRAM CONTROLS =====================//
    setupTelegramCommands() {
        if (!this.bot) return;
        
        this.bot.onText(/\/status/, (msg) => {
            const chatId = msg.chat.id;
            if (chatId.toString() !== this.config.chatId) return;
            
            let statusMsg = `*${this.config.strategyName} Status*\n`;
            statusMsg += `Trading: ${this.tradingHalted ? 'HALTED 🔴' : 'ACTIVE 🟢'}\n`;
            statusMsg += `Daily P&L: ₹${this.dailyPnL.toFixed(2)}\n`;
            statusMsg += `Open Positions: ${this.activePositions.size}\n`;
            
            this.activePositions.forEach(pos => {
                const currentLtp = this.currentCandles.get(pos.token)?.close || pos.buyPrice;
                const currentPnl = (currentLtp - pos.buyPrice) * pos.quantity * 
                                 (pos.option_type === "PE" ? -1 : 1);
                statusMsg += `- ${pos.symbol} Q:${pos.quantity} B@${pos.buyPrice} LTP@${currentLtp} SL:${pos.slPrice} TP:${pos.tpPrice} P&L: ₹${currentPnl.toFixed(2)}\n`;
            });
            
            this.bot.sendMessage(chatId, statusMsg, { parse_mode: "Markdown" });
        });

        this.bot.onText(/\/halt/, (msg) => {
            const chatId = msg.chat.id;
            if (chatId.toString() !== this.config.chatId) return;
            
            this.tradingHalted = true;
            this.manualTradingHalt = true;
            this.sendTelegramAlert("✋ Trading MANUALLY HALTED");
        });

        this.bot.onText(/\/resume/, (msg) => {
            const chatId = msg.chat.id;
            if (chatId.toString() !== this.config.chatId) return;
            
            if (this.dailyPnL > this.config.riskManagement.maxDailyLoss && 
                this.dailyPnL < this.config.riskManagement.maxDailyProfit) {
                this.tradingHalted = false;
                this.manualTradingHalt = false;
                this.sendTelegramAlert("▶️ Trading RESUMED");
            } else {
                this.sendTelegramAlert("⚠️ Cannot resume: P&L limits triggered");
            }
        });

        this.bot.onText(/\/report/, async (msg) => {
            const chatId = msg.chat.id;
            if (chatId.toString() !== this.config.chatId) return;
            
            this.sendTelegramAlert("📊 Generating on-demand report...");
            await this.generateDailyReport(true);
        });
    }

    sendTelegramAlert(message) {
        if (!this.bot || !this.config.chatId) return;
        try {
            this.bot.sendMessage(this.config.chatId, `📈 ${this.config.strategyName}: ${message}`);
        } catch (error) {
            this.logger.error("Telegram error:", error.message);
        }
    }

    //===================== CLEANUP =====================//
    cleanup() {
        if (this.candleInterval) clearInterval(this.candleInterval);
        if (this.oiManager) this.oiManager.stopUpdates();
        if (this.bot) this.bot.stopPolling();
        
        this.logger.info(`🧹 ${this.config.strategyName} cleanup complete`);
        this.sendTelegramAlert(`🛑 ${this.config.strategyName} stopped`);
        this.logger.close();
    }
}

//===================== MAIN EXECUTION =====================//
async function main() {
    let config;
    try {
        config = JSON.parse(fs.readFileSync(path.join(__dirname, 'strategy_config.json'), 'utf-8'));
    } catch (e) {
        console.error("❌ FATAL: Could not load strategy_config.json", e);
        process.exit(1);
    }

    const masterController = new MasterController();
    let strategyInstance;

    try {
        await masterController.initialize();
        strategyInstance = new AdvancedOptionsTrader(masterController, config);
        console.log(`Main: ${config.strategyName} fully initialized`);
    } catch (error) {
        console.error("❌ Startup failed:", error);
        if (strategyInstance) {
            strategyInstance.sendTelegramAlert(`☠️ FATAL STARTUP ERROR: ${error.message}`);
        }
        process.exit(1);
    }

    // Graceful shutdown handler
    const shutdown = async (signal) => {
        console.log(`\n${signal} received. Shutting down...`);
        if (strategyInstance) {
            await strategyInstance.closeAllOpenPositions(`Shutdown: ${signal}`);
            await strategyInstance.generateDailyReport(true);
            strategyInstance.cleanup();
        }
        if (masterController) {
            masterController.cleanup();
        }
        process.exit(0);
    };

    // Process event handlers
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('uncaughtException', (error) => {
        console.error('Uncaught Exception:', error);
        if (strategyInstance) {
            strategyInstance.logger.error('UNCAUGHT EXCEPTION:', error.message, error);
            strategyInstance.sendTelegramAlert(`💥 UNCAUGHT EXCEPTION: ${error.message}`);
        }
        shutdown('uncaughtException');
    });
    process.on('unhandledRejection', (reason, promise) => {
        console.error('Unhandled Rejection at:', promise, 'reason:', reason);
        if (strategyInstance) {
            strategyInstance.logger.error('UNHANDLED REJECTION:', reason);
            strategyInstance.sendTelegramAlert(`🚫 UNHANDLED REJECTION: ${reason}`);
        }
        shutdown('unhandledRejection');
    });
}

main();