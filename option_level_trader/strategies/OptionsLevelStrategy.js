// File: /option_level_trader/strategies/OptionsLevelStrategy.js

const moment = require('moment-timezone');
const EventEmitter = require('events');
const SupportResistance = require('../indicators/SupportResistance');
const ATR = require('../indicators/ATR');
const { findATMOptions, getHistoricalDataParams } = require('../utils/helpers');
const { getCandleTime, isNewCandle } = require('../utils/time_helpers');

class OptionsLevelStrategy extends EventEmitter {
    constructor(masterController, config, instrumentLoader, telegramService, positionManager, dataFetcher) {
        super();

        if (!config || !config.underlying || !config.token) {
            console.error(`❌ Invalid configuration for OptionsLevelStrategy. Missing 'underlying' or 'token'.`);
            this.isActive = false;
            return;
        }

        this.masterController = masterController;
        this.config = config;
        this.instrumentLoader = instrumentLoader;
        this.telegramService = telegramService;
        this.positionManager = positionManager;
        this.dataFetcher = dataFetcher;
        this.params = config.options_level_params || {};
        this.candleIntervalMinutes = 15;

        // Default to NSE if not specified, but respect if it's explicitly BSE or MCX
        this.underlying = {
            symbol: config.underlying,
            token: Number(config.token),
            exch_seg: config.exchange || 'NSE',
            ltp: 0,
        };
        
        // Auto-correct for Sensex if needed (user might put BSE, but segment is BSE)
        if (this.underlying.symbol === 'SENSEX' && !config.exchange) {
            this.underlying.exch_seg = 'BSE';
        }

        this.atmOptions = new Map();
        this.isActive = true;
        this.isSettingUpTrade = false;
        this.lastCandleTime = null;
        this.tradeCooldown = (this.params.trade_cooldown_minutes || 15) * 60 * 1000;
    }

    start() { this.isActive = true; }
    stop() { 
        this.isActive = false; 
        console.log(`[${this.underlying.symbol}] OptionsLevelStrategy Stopped.`);
    }

    getTokensToTrack() {
        if (!this.isActive) return [];
        const underlyingToken = [{ ...this.underlying }];
        const optionTokens = Array.from(this.atmOptions.values()).map(opt => opt.instrument);
        return [...underlyingToken, ...optionTokens];
    }

    processData(tick) {
        if (!this.isActive) return;
        const numericTickToken = Number(tick.token);

        if (numericTickToken === this.underlying.token) {
            this.underlying.ltp = tick.last_price;
            if (this.underlying.ltp <= 0) return;

            const now = moment(tick.last_trade_time).tz("Asia/Kolkata");
            const currentCandleTime = getCandleTime(now, this.candleIntervalMinutes);

            if (isNewCandle(currentCandleTime, this.lastCandleTime)) {
                const previousCandleTime = this.lastCandleTime;
                this.lastCandleTime = currentCandleTime;
                if (previousCandleTime) {
                    this.confirmAndSetupTrade(previousCandleTime);
                    this.updateATMandLevels();
                }
            }
            return;
        }

        const tradedOption = this.atmOptions.get(numericTickToken);
        if (tradedOption) {
            tradedOption.ltp = tick.last_price;
            if (tradedOption.ltp <= 0) return;

            const now = moment(tick.last_trade_time).tz("Asia/Kolkata");
            const currentCandleTime = getCandleTime(now, this.candleIntervalMinutes);

            for (const support of tradedOption.supportLevels) {
                if (tradedOption.tradedLevels.has(support.level) && (now.valueOf() - tradedOption.tradedLevels.get(support.level) < this.tradeCooldown)) continue;
                if (tradedOption.watchedLevels.has(support.level) && tradedOption.watchedLevels.get(support.level).candleTime.isSame(currentCandleTime)) continue;

                if (tradedOption.ltp <= support.level * 1.001 && tradedOption.ltp >= support.level) {
                    tradedOption.watchedLevels.set(support.level, { candleTime: currentCandleTime, type: 'support' });
                    const msg = `🔔 *Support Touch Alert for ${tradedOption.symbol}*\n\n` + 
                                `*Support Level:* ${support.level.toFixed(2)}\n` + 
                                `*LTP:* ${tradedOption.ltp}\n` +
                                `*Action:* Waiting for 15-min candle to close for confirmation.`;
                    this.telegramService.sendMessage(msg);
                }
            }
        }
    }

    async confirmAndSetupTrade(candleTimeToConfirm) {
        // TIME CHECK: Only block Equity after 3:15 PM. Allow MCX.
        const now = moment().tz("Asia/Kolkata");
        const isCommodity = (this.underlying.exch_seg === 'MCX');

        if (!isCommodity && (now.hours() > 15 || (now.hours() === 15 && now.minutes() >= 15))) {
            console.log(`[${this.underlying.symbol}] Trade setup ignored (After 3:15 PM).`);
            return;
        }

        this.isSettingUpTrade = true;
        try {
            for (const [token, tradedOption] of this.atmOptions.entries()) {
                const levelsToCheck = Array.from(tradedOption.watchedLevels.entries())
                    .filter(([_, value]) => value.candleTime.isSame(candleTimeToConfirm));

                if (levelsToCheck.length === 0) continue;

                const history = await this.getOptionCandle(tradedOption, candleTimeToConfirm);
                
                if (!history || history.length < 15) {
                    const msg = `⚠️ *Trade Setup Failed - ${tradedOption.symbol}*\n\n*Reason:* Insufficient data for ATR.`;
                    console.error(`[${tradedOption.symbol}] ${msg.replace(/\*/g, '')}`);
                    this.telegramService.sendMessage(msg); // Enable message
                    levelsToCheck.forEach(([level]) => tradedOption.watchedLevels.delete(level));
                    continue;
                }

                const atr = ATR.calculate(history, 14);
                if (!atr) {
                    levelsToCheck.forEach(([level]) => tradedOption.watchedLevels.delete(level));
                    continue;
                }

                const confirmationCandle = history[history.length - 1];
                const openPrice = Array.isArray(confirmationCandle) ? confirmationCandle[1] : confirmationCandle.open;
                const lowPrice = Array.isArray(confirmationCandle) ? confirmationCandle[3] : confirmationCandle.low;
                const closePrice = Array.isArray(confirmationCandle) ? confirmationCandle[4] : confirmationCandle.close;

                for (const [level, levelData] of levelsToCheck) {
                    const isBullish = closePrice > openPrice;
                    const levelType = levelData.type; 

                    let tradeSetup = null;

                    if (levelType === 'support') {
                        const openAboveSupport = openPrice > level;
                        const lowBelowSupport = lowPrice < level;
                        const closeAboveSupport = closePrice > level;
                        

                        if (isBullish && openAboveSupport && lowBelowSupport && closeAboveSupport) {
                            const entryPrice = lowPrice;
                            const initialStopLoss = entryPrice - atr; 
                            
                            // --- NEW TARGET LOGIC START ---
                            // Filter resistances that are strictly above the entry price
                            const availableResistances = tradedOption.resistanceLevels
                                .map(r => r.level)
                                .filter(rLevel => rLevel > entryPrice)
                                .sort((a, b) => a - b); // Sort ascending (nearest first)

                            let target1, target2;
                            let targetMethod = "";

                            // Target 1 Logic
                            if (availableResistances.length >= 1) {
                                target1 = availableResistances[0];
                                targetMethod = "Res Lvl 1";
                            } else {
                                target1 = entryPrice + (atr * 2);
                                targetMethod = "ATR";
                            }

                            // Target 2 Logic
                            if (availableResistances.length >= 2) {
                                target2 = availableResistances[1];
                                if (targetMethod.includes("Res")) targetMethod = "Res Lvl 1 & 2";
                            } else {
                                target2 = entryPrice + (atr * 5);
                                if (targetMethod === "ATR") targetMethod = "ATR";
                                else targetMethod += " & ATR";
                            }
                            // --- NEW TARGET LOGIC END ---

                            tradeSetup = {
                                direction: 'BUY',
                                optionType: 'CE',
                                entryPrice,
                                stopLoss: initialStopLoss,
                                targets: [target1, target2],
                                quantity: 4, 
                                atr,
                                reason: `Support bounce at ${level.toFixed(2)} (Tgts: ${targetMethod})`
                            };
                        } else {
                            let reason = "did not meet criteria";
                            if (!lowBelowSupport) reason = "Low did not break support";
                            else if (!closeAboveSupport) reason = "Closed below support";
                            else if (!isBullish) reason = "Not a green candle";
                            
                            // Enable Rejection Message
                            const msg = `⛔ *Trade Rejected - ${tradedOption.symbol}*\n\n*Level:* ${level.toFixed(2)}\n*Reason:* ${reason}`;
                            console.log(`[${tradedOption.symbol}] Support REJECTED: ${reason}`);
                            this.telegramService.sendMessage(msg); 
                        }
                    }

                    if (tradeSetup) {
                        const message = `⏳ *ORDER PLACED - ${tradedOption.symbol}*\n\n` +
                            `*Type:* Limit Order @ Previous Low\n` +
                            `*Limit Price:* ₹${tradeSetup.entryPrice.toFixed(2)}\n` +
                            `*Stop Loss:* ₹${tradeSetup.stopLoss.toFixed(2)}\n` +
                            `*Target 1:* ₹${tradeSetup.targets[0].toFixed(2)}\n` +
                            `*Target 2:* ₹${tradeSetup.targets[1].toFixed(2)}\n` +
                            `*Reason:* ${tradeSetup.reason}`;

                        console.log(`[${tradedOption.symbol}] ${message.replace(/\*/g, '')}`);
                        // Changed from sendAlertMessage to sendMessage to ensure delivery
                        this.telegramService.sendMessage(message);

                        this.positionManager.addPendingOrder({
                            instrument: tradedOption.instrument,
                            entryPrice: tradeSetup.entryPrice,
                            stopLoss: tradeSetup.stopLoss,
                            targets: tradeSetup.targets, 
                            quantity: tradeSetup.quantity, 
                            tradeType: tradeSetup.optionType,
                            strategyName: 'OptionsLevel_ATR',
                            atr: tradeSetup.atr
                        });

                        tradedOption.tradedLevels.set(level, Date.now());
                    }

                    tradedOption.watchedLevels.delete(level);
                }
            }
        } catch (error) {
            console.error(`Error in confirmAndSetupTrade:`, error);
        } finally {
            this.isSettingUpTrade = false;
        }
    }

    async getOptionCandle(tradedOption, candleTime) {
        const fetchWithDays = async (days) => {
            const fromDate = candleTime.clone().subtract(days, 'days');
            const params = {
                exchange: tradedOption.instrument.exch_seg,
                symboltoken: tradedOption.token,
                interval: 'FIFTEEN_MINUTE',
                fromdate: fromDate.format('YYYY-MM-DD HH:mm'),
                todate: candleTime.format('YYYY-MM-DD HH:mm')
            };
            const history = await this.dataFetcher.getHistoricalData(params, false);
            return Array.isArray(history) ? history : history?.data;
        };

        try {
            let history = await fetchWithDays(5);
            if (!history || history.length < 15) {
                history = await fetchWithDays(10);
            }
            if (history && history.length > 0) return history; 
            return null;
        } catch (error) {
            console.error(`[${tradedOption.symbol}] Error fetching option candle: ${error.message}`);
            return null;
        }
    }

    async initialize() {
        if (!this.isActive) return;
        await this.updateATMandLevels();
        this.lastCandleTime = getCandleTime(moment().tz("Asia/Kolkata"), this.candleIntervalMinutes);
        console.log(`[${this.underlying.symbol}] OptionsLevelStrategy Initialized. Current candle starts at: ${this.lastCandleTime.format('HH:mm')}`);
    }

    async updateATMandLevels() {
        console.log(`[${this.underlying.symbol}] Finding ATM options and updating their S/R levels...`);
        await this.updateUnderlyingLTP();
        if (this.underlying.ltp <= 0) return;

        const atmOptionInstruments = findATMOptions(this.instrumentLoader.instruments, this.underlying.symbol, this.underlying.ltp, this.config.options.expiry_date);
        if (atmOptionInstruments.length === 0) return;

        const newAtmOptions = new Map();
        for (const instrument of atmOptionInstruments) {
            const token = Number(instrument.token);
            const optionState = this.atmOptions.get(token) || {
                instrument: instrument,
                symbol: instrument.symbol,
                token: token,
                ltp: 0,
                supportLevels: [],
                resistanceLevels: [],
                watchedLevels: new Map(),
                tradedLevels: new Map(),
            };
            await this.updateLevelsForOption(optionState);
            newAtmOptions.set(token, optionState);
        }

        this.atmOptions = newAtmOptions;
        this.masterController.subscribeToTokens();
    }

    async updateLevelsForOption(tradedOption) {
        try {
            await this.updateOptionLTP(tradedOption);
            if (tradedOption.ltp <= 0) return;

            const toDate = moment().tz("Asia/Kolkata");
            const fromDate = toDate.clone().subtract(this.config.historical_data.days, 'days');
            const historyParams = getHistoricalDataParams(tradedOption.instrument, this.config.historical_data.timeframe, fromDate.format('YYYY-MM-DD HH:mm'), toDate.format('YYYY-MM-DD HH:mm'));

            // Cache OK for levels
            let history = await this.dataFetcher.getHistoricalData(historyParams, true);
            let data = Array.isArray(history) ? history : history?.data;
            
            if (data && data.length > 0) {
                const candles = data.map(c => ({ high: c[2], low: c[3], open: c[1], close: c[4] }));
                const { supports, resistances } = SupportResistance.detectLevels(candles, tradedOption.ltp, this.config.support_resistance);
                tradedOption.supportLevels = supports;
                tradedOption.resistanceLevels = resistances;
            }
        } catch (err) {
            console.error(`[${tradedOption.symbol}] Failed to update levels:`, err);
        }
    }

    async updateUnderlyingLTP() {
        try {
            const toDate = moment().tz("Asia/Kolkata");
            const fromDate = toDate.clone().subtract(15, 'minutes');
            const params = getHistoricalDataParams(this.underlying, 'ONE_MINUTE', fromDate.format('YYYY-MM-DD HH:mm'), toDate.format('YYYY-MM-DD HH:mm'));
            const history = await this.dataFetcher.getHistoricalData(params, false);
            const data = Array.isArray(history) ? history : history?.data;
            if (data && data.length > 0) this.underlying.ltp = data[data.length - 1][4];
        } catch (e) {}
    }

    async updateOptionLTP(tradedOption) {
        try {
            const toDate = moment().tz("Asia/Kolkata");
            const fromDate = toDate.clone().subtract(15, 'minutes');
            const params = getHistoricalDataParams(tradedOption.instrument, 'ONE_MINUTE', fromDate.format('YYYY-MM-DD HH:mm'), toDate.format('YYYY-MM-DD HH:mm'));
            const history = await this.dataFetcher.getHistoricalData(params, false);
            const data = Array.isArray(history) ? history : history?.data;
            if (data && data.length > 0) tradedOption.ltp = data[data.length - 1][4];
        } catch (e) {}
    }

    getLevelsAndLTP() {
        const levelsData = {};
        for (const [token, tradedOption] of this.atmOptions.entries()) {
            levelsData[tradedOption.symbol] = {
                ltp: tradedOption.ltp,
                supports: tradedOption.supportLevels.map(s => s.level),
                resistances: tradedOption.resistanceLevels.map(r => r.level),
            };
        }
        return levelsData;
    }
}

module.exports = OptionsLevelStrategy;