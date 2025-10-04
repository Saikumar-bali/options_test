// File: D:\master_controller\advanced_strategy\advanced_options_trader.js

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const TelegramBot = require("node-telegram-bot-api");
const fs = require('fs');
const moment = require("moment-timezone");
const MasterController = require('../universal websocket/index.js');
const { getOptionType, delay } = require('./utils.js');
const { calculateSMA, calculateStandardDeviation, calculateRSI, calculateATR, calculateSR } = require('./indicator_calculator.js');
const Logger = require('./logger.js');
const OIManager = require('./oi_manager.js'); // <-- NEW
const MLPredictor = require('./ml_predictor.js'); // <-- NEW

class AdvancedOptionsTrader {
    constructor(masterController, config) {
        this.masterController = masterController;
        // this.smart_api = masterController.smartApiInstance;
        this.config = config;
        this.logger = new Logger(config.logFiles);

        this.stocks = this.loadStocks();
        this.currentCandles = new Map();
        this.candleInterval = null;
        this.activePositions = this.loadPositions();
        this.tradingHalted = false;
        this.manualTradingHalt = false;
        this.dailyPnL = 0;
        this.cooldowns = new Map();

        this.closeTime = moment.tz("Asia/Kolkata").set({
            hour: this.config.marketHours.eodTaskHour,
            minute: this.config.marketHours.eodTaskMinute,
            second: 0
        });

        this.bot = new TelegramBot(this.config.telegramBotToken, { polling: true });
        this.setupTelegramCommands();
        this.oiManager = new OIManager(this.config.oi_analysis, this.stocks, this.logger);
        this.mlPredictor = new MLPredictor(this.config.ml_prediction, this.logger);
        this.masterController.registerStrategy(this);
        // this.initialize();
        this.logger.info(`📈 ${this.config.strategyName} initialized.`);
        this.sendTelegramAlert(`🚀 ${this.config.strategyName} started successfully!`);
    }

    // ===== NEW INITIALIZATION METHODS =====
    async initialize() {
        this.logger.info("🚀 Starting Strategy Initialization...");

        // 1. Load Major Support/Resistance Levels
        this.loadMajorSRLevels();

        // 2. Fetch Historical Data
        await this.fetchAllHistoricalData();

        // 3. Schedule Candle Updates
        this.scheduleCandleUpdates();

        // 4. Initialize current candles map
        this.initializeNewCandles();

        this.logger.info("✅ Strategy Initialization Complete.");
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
    async fetchAllHistoricalData() {
        this.logger.info("⏳ Fetching historical data for all stocks...");

        for (const stock of this.stocks) {
            try {
                const fromDate = moment.tz("Asia/Kolkata").subtract(this.config.tradingParameters.historicalDataDays, 'days');
                const toDate = moment.tz("Asia/Kolkata");

                // Log the parameters being sent
                const params = {
                    exchange: stock.exch_seg,
                    symboltoken: stock.token,
                    interval: this.mapInterval(this.config.tradingParameters.candleIntervalMinutes),
                    fromdate: fromDate.format("YYYY-MM-DD 09:15"),
                    todate: toDate.format("YYYY-MM-DD 15:30")
                };
                this.logger.debug(`[HistData Fetch] Requesting for ${stock.symbol} (${stock.token}) with params: ${JSON.stringify(params)}`);

                const historicalData = await this.masterController.getHistoricalData(params); // [cite: 1]

                // **** START MODIFICATION ****
                this.logger.info(`[HistData DEBUG] Response for ${stock.symbol}: ${JSON.stringify(historicalData)}`);

                if (historicalData && historicalData.status === true && historicalData.data && Array.isArray(historicalData.data)) {
                    stock.candles = historicalData.data.map(candleArray => ({ // [cite: 1]
                        timestamp: moment(candleArray[0]).tz("Asia/Kolkata"), // Ensure candleArray[0] is valid
                        open: parseFloat(candleArray[1]),
                        high: parseFloat(candleArray[2]),
                        low: parseFloat(candleArray[3]),
                        close: parseFloat(candleArray[4]),
                        volume: parseInt(candleArray[5])
                    }));

                    if (stock.candles.length === 0) {
                        this.logger.warn(`[HistData Fetch] No candles returned in data array for ${stock.symbol}, though API status was success.`);
                    }
                    this.calculateIndicators(stock); // [cite: 1]
                    stock.calculated = true;
                    this.saveHistoricalDataToCsv(stock); // [cite: 1]
                } else if (historicalData && historicalData.status === false) {
                    this.logger.error(`[HistData Fetch] API returned error for ${stock.symbol}: ${historicalData.message} (Code: ${historicalData.errorcode}). Response: ${JSON.stringify(historicalData)}`);
                    stock.candles = []; // Ensure candles is an empty array
                } else {
                    this.logger.error(`[HistData Fetch] Invalid or empty data received for ${stock.symbol}. Response: ${JSON.stringify(historicalData)}`);
                    stock.candles = []; // Ensure candles is an empty array
                }
                // **** END MODIFICATION ****

                await delay(this.config.fetchDelayMs || 100); // Use configured delay or default to 100ms
            } catch (error) {
                // This catch block will now primarily catch errors from this.masterController.getHistoricalData if it rejects,
                // or other unexpected errors within the try block.
                this.logger.error(`Failed to fetch historical data for ${stock.symbol} (Outer Catch):`, error); // [cite: 1]
                this.logger.error(`Failed to fetch historical data for ${stock.symbol} (Outer Catch): Message: ${error.message}, Stack: ${error.stack}, API Response (if available in error): ${error.response ? JSON.stringify(error.response.data) : 'N/A'}`); // [cite: 1]
                stock.candles = []; // Ensure candles is an empty array on error
            }
        }
        this.logger.info("✅ Historical data loaded (or attempted).");
    }

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
            this.performCandleUpdateCycle();
            this.candleInterval = setTimeout(runUpdate, intervalMinutes * 60 * 1000);
        };

        const firstRun = calculateNextRun();
        const initialDelay = firstRun.diff(moment.tz("Asia/Kolkata"));

        this.logger.info(`First candle update at ${firstRun.format("HH:mm:ss")}`);
        setTimeout(runUpdate, initialDelay);
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

            this.logger.info("✅ Candle Update Cycle Completed");
        } catch (error) {
            this.logger.error("Candle update error:", error);
        }
    }

    finalizeCurrentCandles() {
        this.currentCandles.forEach((candle, token) => {
            if (!candle.timestamp || candle.open === null) return;

            const stock = this.stocks.find(s => s.token === token);
            if (stock) {
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

    ensureDataDirectoryExists() {
        const dirPath = path.join(__dirname, 'historical_data_logs');
        if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath, { recursive: true });
            this.logger.info(`Created directory for historical data logs: ${dirPath}`);
        }
        return dirPath;
    }

    async saveHistoricalDataToCsv(stock) {
        if (!stock || !stock.candles || stock.candles.length === 0) {
            this.logger.warn(`No historical candle data to save for ${stock.symbol}`);
            return;
        }

        const dataDir = this.ensureDataDirectoryExists();
        const filePath = path.join(dataDir, `${stock.symbol}_${this.config.tradingParameters.candleIntervalMinutes}min_hist.csv`);

        let csvContent = "Timestamp,Open,High,Low,Close,Volume\n";
        stock.candles.forEach(c => {
            const readableTimestamp = moment(c.timestamp).tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss");
            csvContent += `${readableTimestamp},${c.open},${c.high},${c.low},${c.close},${c.volume}\n`;
        });

        try {
            fs.writeFileSync(filePath, csvContent);
            this.logger.info(`Saved historical data for ${stock.symbol} to ${filePath}`);
        } catch (error) {
            this.logger.error(`Failed to save historical data CSV for ${stock.symbol}:`, error);
        }
    }

    loadStocks() {
        try {
            const filePath = path.join(__dirname, this.config.logFiles.updatedStocks);
            if (!fs.existsSync(filePath)) {
                this.logger.warn(`⚠️ ${filePath} not found. Starting with empty stocks list.`);
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

    calculateIndicators(stock) {
        this.logger.debug(`[CalcIndicators] For ${stock.symbol}, number of candles: ${stock.candles ? stock.candles.length : 'N/A'}`);
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

        this.logger.debug(`Indicators for ${stock.symbol}: BB: ${JSON.stringify(stock.bb)}, RSI: ${stock.rsi}, ATR: ${stock.atr}, S/R: ${stock.support}/${stock.resistance}`);
    }

    // In advanced_options_trader.js
    loadMajorSRLevels() {
        this.majorSR = new Map(); // NIFTY -> [level1, level2], BANKNIFTY -> [...]

        const loadLevels = (name, filename) => {
            try {
                const filePath = path.join(__dirname, filename);
                if (!fs.existsSync(filePath)) {
                    this.logger.warn(`[SR Load] S/R file not found: ${filePath}. Run test.js first!`);
                    return;
                }
                const data = fs.readFileSync(filePath, 'utf-8');
                const levels = data.split('\n').slice(1) // Skip header
                    .map(line => parseFloat(line.trim()))
                    .filter(level => !isNaN(level));
                this.majorSR.set(name, levels.sort((a, b) => a - b)); // Store sorted levels
                this.logger.info(`Loaded ${levels.length} major S/R levels for ${name}.`);
            } catch (e) {
                this.logger.error(`Failed to load ${name} S/R levels from ${filename}:`, e.message);
            }
        };

        loadLevels('NIFTY', 'nifty_sr_levels.csv');
        loadLevels('BANKNIFTY', 'banknifty_sr_levels.csv');
        // loadLevels('SENSEX', 'sensex_sr_levels.csv'); // Uncomment if needed
    }
    
    async processData(data) {
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
        }

        if (this.tradingHalted) {
            const position = this.activePositions.get(stock.token);
            if (position) this.checkExitConditions(stock, ltp, position);
            return;
        }

        if (this.cooldowns.has(stock.token) && Date.now() < this.cooldowns.get(stock.token)) {
            return;
        }

        this.logger.debug(`[ProcessData Check - ${stock.symbol}] LTP: ${ltp}, BB: ${JSON.stringify(stock.bb)}, RSI: ${stock.rsi}, S: ${stock.support}, R: ${stock.resistance}`);

        // Ensure we have S/R values before proceeding
        if (!stock.bb || stock.rsi === null || stock.atr === null ||
            !stock.option_type || stock.support === null || stock.resistance === null) {
            this.logger.warn(`[ProcessData - ${stock.symbol}] Skipping trade check due to missing indicators/data.`);
            return;
        }

        const position = this.activePositions.get(stock.token);
        const srBuffer = this.config.tradingParameters.srBufferFactor || 0.005; // 0.5% buffer

        // Define Mean-Reversion RSI levels
        const rsiOversold = 35;
        const rsiOverbought = 65;

        if (position) {
            this.checkExitConditions(stock, ltp, position);
        } else {
            let oiSignal = 'NEUTRAL';
            let mlPrediction = 'NEUTRAL';

            if (this.config.tradingParameters.useOIConfirm) {
                oiSignal = this.oiManager.getTradeSignal(stock.token, stock.option_type);
            }

            if (this.config.tradingParameters.useMLConfirm) {
                try {
                    mlPrediction = await this.mlPredictor.getPrediction(stock);
                } catch (error) {
                    this.logger.error(`ML prediction failed for ${stock.symbol}:`, error);
                    mlPrediction = 'NEUTRAL'; // Fail-safe
                }
            }

            // Trading logic with confirmations
            if (stock.option_type === "CE") {
                // STRATEGY 1: Breakout Strategy
                if (ltp > stock.bb.upper && stock.rsi > this.config.tradingParameters.rsi.callBuyThreshold) {
                    if (ltp < stock.resistance * (1 - srBuffer)) {
                        const oiConfirm = !this.config.tradingParameters.useOIConfirm || oiSignal === 'BULLISH';
                        const mlConfirm = !this.config.tradingParameters.useMLConfirm || mlPrediction === 'BULLISH';

                        this.logger.debug(`[Breakout Check] ${stock.symbol}: LTP=${ltp.toFixed(2)}, BB_Upper=${stock.bb?.upper?.toFixed(2)}, RSI=${stock.rsi?.toFixed(2)}, S=${stock.support?.toFixed(2)}, R=${stock.resistance?.toFixed(2)}, OI=${oiSignal}, ML=${mlPrediction}`);

                        if (oiConfirm && mlConfirm) {
                            this.executeBuy(stock, ltp, `BB_RSI_CE (OI:${oiSignal}, ML:${mlPrediction})`);
                        } else {
                            this.logger.debug(`CE Breakout ${stock.symbol} skipped: OI=${oiSignal}, ML=${mlPrediction}`);
                        }
                    } else {
                        this.logger.debug(`CE Breakout skipped for ${stock.symbol}: Near resistance (R:${stock.resistance.toFixed(2)} LTP:${ltp.toFixed(2)})`);
                    }
                }
                // STRATEGY 2: Mean Reversion Strategy
                else {
                    const nearSupport = ltp <= (stock.support * (1 + srBuffer));
                    const nearBBLow = ltp <= (stock.bb.lower * (1 + (srBuffer / 2)));

                    if (nearSupport && nearBBLow && stock.rsi < rsiOversold) {
                        const oiConfirm = !this.config.tradingParameters.useOIConfirm || oiSignal === 'BULLISH';
                        const mlConfirm = !this.config.tradingParameters.useMLConfirm || mlPrediction === 'BULLISH';

                        if (oiConfirm && mlConfirm) {
                            this.executeBuy(stock, ltp, `MeanReversion_CE_Support_BBLow (RSI:${stock.rsi.toFixed(1)}, S:${stock.support.toFixed(1)})`);
                        } else {
                            this.logger.debug(`CE MeanReversion ${stock.symbol} skipped: OI=${oiSignal}, ML=${mlPrediction}`);
                        }
                    }
                }
            }
            else if (stock.option_type === "PE") {
                // STRATEGY 1: Breakout Strategy
                if (ltp < stock.bb.lower && stock.rsi < this.config.tradingParameters.rsi.putBuyThreshold) {
                    if (ltp > stock.support * (1 + srBuffer)) {
                        const oiConfirm = !this.config.tradingParameters.useOIConfirm || oiSignal === 'BEARISH';
                        const mlConfirm = !this.config.tradingParameters.useMLConfirm || mlPrediction === 'BEARISH';

                        if (oiConfirm && mlConfirm) {
                            this.executeBuy(stock, ltp, `BB_RSI_PE (OI:${oiSignal}, ML:${mlPrediction})`);
                        } else {
                            this.logger.debug(`PE Breakout ${stock.symbol} skipped: OI=${oiSignal}, ML=${mlPrediction}`);
                        }
                    } else {
                        this.logger.debug(`PE Breakout skipped for ${stock.symbol}: Near support (S:${stock.support.toFixed(2)} LTP:${ltp.toFixed(2)})`);
                    }
                }
                // STRATEGY 2: Mean Reversion Strategy
                else {
                    const nearResistance = ltp >= (stock.resistance * (1 - srBuffer));
                    const nearBBHigh = ltp >= (stock.bb.upper * (1 - (srBuffer / 2)));

                    if (nearResistance && nearBBHigh && stock.rsi > rsiOverbought) {
                        const oiConfirm = !this.config.tradingParameters.useOIConfirm || oiSignal === 'BEARISH';
                        const mlConfirm = !this.config.tradingParameters.useMLConfirm || mlPrediction === 'BEARISH';

                        if (oiConfirm && mlConfirm) {
                            this.executeBuy(stock, ltp, `MeanReversion_PE_Resistance_BBHigh (RSI:${stock.rsi.toFixed(1)}, R:${stock.resistance.toFixed(1)})`);
                        } else {
                            this.logger.debug(`PE MeanReversion ${stock.symbol} skipped: OI=${oiSignal}, ML=${mlPrediction}`);
                        }
                    }
                }
            }
        }
    }

    checkExitConditions(stock, ltp, position) {
        let exitReason = null;
        const tslConfig = this.config.tradingParameters.trailingStopLoss;
        const currentAtr = stock.atr || position.initialAtrAtBuy;

        // Trailing Stop Loss Logic
        if (tslConfig?.enabled) {
            if (position.isTrailingActive) {
                // Update trailing levels
                if (position.option_type === "CE") {
                    position.highestPriceSinceBuy = Math.max(position.highestPriceSinceBuy, ltp);
                    const newTrailingSl = position.highestPriceSinceBuy - (currentAtr * tslConfig.trailAtrMultiple);
                    position.trailingSlPrice = Math.max(newTrailingSl, position.trailingSlPrice || newTrailingSl);
                } else {
                    position.lowestPriceSinceBuy = Math.min(position.lowestPriceSinceBuy, ltp);
                    const newTrailingSl = position.lowestPriceSinceBuy + (currentAtr * tslConfig.trailAtrMultiple);
                    position.trailingSlPrice = Math.min(newTrailingSl, position.trailingSlPrice || newTrailingSl);
                }

                position.currentSlPrice = position.trailingSlPrice;
            } else {
                // Check for TSL activation
                const profitSinceEntry = position.option_type === "CE"
                    ? ltp - position.buyPrice
                    : position.buyPrice - ltp;

                if (profitSinceEntry >= (currentAtr * tslConfig.activationAtrMultiple)) {
                    position.isTrailingActive = true;
                    position.tslActivationPrice = ltp;

                    if (position.option_type === "CE") {
                        position.highestPriceSinceBuy = ltp;
                        position.trailingSlPrice = ltp - (currentAtr * tslConfig.trailAtrMultiple);
                    } else {
                        position.lowestPriceSinceBuy = ltp;
                        position.trailingSlPrice = ltp + (currentAtr * tslConfig.trailAtrMultiple);
                    }

                    position.currentSlPrice = position.trailingSlPrice;
                    this.logger.info(`TSL Activated for ${stock.symbol} (${position.option_type}) at ${ltp.toFixed(2)}`);
                    this.sendTelegramAlert(`🔔 TSL Activated for ${stock.symbol}. New SL: ${position.currentSlPrice.toFixed(2)}`);
                }
            }
        }

        // Check stop loss (original or trailing)
        if (position.option_type === "CE" && ltp <= position.currentSlPrice) {
            exitReason = position.isTrailingActive
                ? `Trailing SL Hit (CE) @${position.currentSlPrice.toFixed(2)}`
                : `StopLoss Hit (CE) @${position.currentSlPrice.toFixed(2)}`;
        }
        if (position.option_type === "PE" && ltp >= position.currentSlPrice) {
            exitReason = position.isTrailingActive
                ? `Trailing SL Hit (PE) @${position.currentSlPrice.toFixed(2)}`
                : `StopLoss Hit (PE) @${position.currentSlPrice.toFixed(2)}`;
        }

        // Check original take profit if TSL not active
        if (!exitReason && !position.isTrailingActive) {
            if (position.option_type === "CE" && ltp >= position.originalTpPrice) {
                exitReason = "TakeProfit Hit (CE)";
            }
            if (position.option_type === "PE" && ltp <= position.originalTpPrice) {
                exitReason = "TakeProfit Hit (PE)";
            }
        }

        // Support/Resistance exit
        if (!exitReason) {
            if (position.option_type === "CE" && ltp >= stock.resistance) {
                exitReason = "Resistance Hit (CE)";
            }
            if (position.option_type === "PE" && ltp <= stock.support) {
                exitReason = "Support Hit (PE)";
            }
        }

        if (exitReason) {
            this.executeSell(stock, ltp, position, exitReason);
        } else if (position.isTrailingActive) {
            // Update position state if trailing is active but no exit
            this.activePositions.set(stock.token, position);
            this.savePositions();
        }
    }
    // In advanced_options_trader.js
    async executeBuy(stock, price, reason) {
        if (this.activePositions.has(stock.token)) return;
        if (this.tradingHalted) return;

        const quantity = parseInt(stock.lotsize || this.config.riskManagement.defaultQuantity.toString());
        if (quantity <= 0) {
            this.logger.warn(`Invalid quantity ${quantity} for ${stock.symbol}`);
            return;
        }

        const atrVal = stock.atr; // Directly use the calculated stock.atr

        // **** START SAFEGUARD ****
        if (atrVal === null || atrVal === undefined || !isFinite(atrVal) || atrVal <= 0) {
            this.logger.error(`[ExecuteBuy] Cannot execute buy for ${stock.symbol}. Invalid or non-finite ATR: ${atrVal}. Skipping trade.`);
            return; // Prevent trade if ATR is bad
        }
        // **** END SAFEGUARD ****

        let slPrice, tpPrice;

        if (stock.option_type === "CE") {
            slPrice = price - (atrVal * this.config.tradingParameters.atr.slMultiplier);
            tpPrice = price + (atrVal * this.config.tradingParameters.atr.tpMultiplier);
        } else {
            slPrice = price + (atrVal * this.config.tradingParameters.atr.slMultiplier);
            tpPrice = price - (atrVal * this.config.tradingParameters.atr.tpMultiplier);
        }

        // **** START SAFEGUARD 2 ****
        if (!isFinite(slPrice) || !isFinite(tpPrice)) {
            this.logger.error(`[ExecuteBuy] Calculated SL/TP is not finite for ${stock.symbol}. SL=${slPrice} TP=${tpPrice} (ATR=${atrVal}). Skipping trade.`);
            return; // Prevent trade if SL/TP is bad
        }
        // **** END SAFEGUARD 2 ****

        // Initialize position with TSL tracking
        const newPosition = {
            token: stock.token,
            symbol: stock.symbol,
            option_type: stock.option_type,
            quantity,
            buyPrice: price,
            buyTime: moment.tz("Asia/Kolkata"),
            originalSlPrice: slPrice,
            originalTpPrice: tpPrice,
            currentSlPrice: slPrice, // Start with original SL
            pnl: 0,
            exch_seg: stock.exch_seg,
            expiry: stock.expiry ? moment(stock.expiry, "DDMMMYYYY") : null,
            highestPriceSinceBuy: stock.option_type === "CE" ? price : price, // Initialize correctly
            lowestPriceSinceBuy: stock.option_type === "PE" ? price : price, // Initialize correctly
            trailingSlPrice: null,
            isTrailingActive: false,
            initialAtrAtBuy: atrVal,
            tslActivationPrice: null
        };

        this.activePositions.set(stock.token, newPosition);
        this.savePositions();

        const alertMsg = `🟢 BUY ${stock.symbol} (${stock.option_type}) Q:${quantity} @${price.toFixed(2)} | SL:${slPrice.toFixed(2)} TP:${tpPrice.toFixed(2)} | Reason: ${reason}`;
        this.sendTelegramAlert(alertMsg);
        this.logger.logTrade({
            token: stock.token, symbol: stock.symbol, action: 'BUY',
            price: price, quantity: quantity,
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
                    if (line.trim() === '') return;
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
                    return { ...p, currentLtp, unrealizedPnl: currentPnl };
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
                    const buyTrade = tradesToday.find(bt => bt.token === trade.token && bt.action.toUpperCase() === 'BUY' && moment(bt.timestamp).isBefore(moment(trade.timestamp))) || { price: 'N/A', quantity: trade.quantity }; // simplified
                    fileContent += `${moment(trade.timestamp).format("HH:mm:ss").padEnd(12)}` +
                        `${trade.symbol.padEnd(20)}` +
                        `${trade.action.padEnd(8)}` +
                        `${trade.quantity.toString().padStart(3)}   ` +
                        `${(typeof buyTrade.price === 'number' ? buyTrade.price.toFixed(2) : buyTrade.price).padStart(7)} ` +
                        `${trade.price.toFixed(2).padStart(7)} ` +
                        `${(trade.pnl !== null ? trade.pnl.toFixed(2) : "N/A").padStart(8)}  ` +
                        `${(trade.reason || '').substring(0, 15)}\n`;
                }
            });
            if (reportData.closedTrades.length === 0) fileContent += "No trades closed today.\n";


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
            if (reportData.openPositions.length === 0) fileContent += "No open positions at EOD.\n";


            fileContent += "\n" + "-".repeat(90) + "\n";
            fileContent += `TOTAL REALIZED P&L: ${("₹" + reportData.totalRealizedPnL.toFixed(2)).padStart(15)}\n`;
            fileContent += `TOTAL UNREALIZED P&L: ${("₹" + reportData.totalUnrealizedPnL.toFixed(2)).padStart(13)}\n`;
            fileContent += `FINAL DAILY P&L (Strategy): ${("₹" + reportData.finalDailyPnL.toFixed(2)).padStart(10)}\n`;
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

// ===== UPDATED MAIN FUNCTION =====
async function main() {
    let config;
    try {
        config = JSON.parse(fs.readFileSync(path.join(__dirname, 'strategy_config.json'), 'utf-8'));
    } catch (e) {
        console.error("❌ FATAL: Could not load strategy_config.json.", e);
        process.exit(1);
    }

    const masterController = new MasterController();
    let strategyInstance;

    try {
        await masterController.initialize();
        strategyInstance = new AdvancedOptionsTrader(masterController, config);

        // Initialize strategy components
        await strategyInstance.initialize();  // <-- CRUCIAL INIT CALL

        console.log(`Main: ${config.strategyName} fully initialized. Awaiting market data...`);

    } catch (error) {
        console.error("❌ Startup failed:", error);
        if (strategyInstance) {
            strategyInstance.sendTelegramAlert(`☠️ FATAL STARTUP ERROR: ${error.message}`);
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