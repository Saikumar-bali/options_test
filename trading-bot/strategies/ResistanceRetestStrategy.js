// File: /trading-bot/strategies/ResistanceRetestStrategy.js

const moment = require('moment-timezone');
const EventEmitter = require('events');
const SupportResistance = require('../indicators/SupportResistance');
const { ATR } = require('../indicators/ATR');
const { RSI } = require('../indicators/RSI');
const { findATMOptions, getHistoricalDataParams } = require('../utils/helpers');
const { getCandleTime, isNewCandle } = require('../utils/time_helpers');

class ResistanceRetestStrategy extends EventEmitter {
    constructor(masterController, config, instrumentLoader, telegramService, positionManager, dataFetcher) {
        super();
        
        // Add a guard clause for invalid configuration
        if (!config || !config.underlying || !config.token || !config.exchange) {
            console.error(`❌ [${config.underlying || 'Unknown'}] Invalid configuration provided to ResistanceRetestStrategy. Missing underlying, token, or exchange. Strategy will not initialize.`);
            this.isActive = false; // Deactivate the strategy
            return; // Stop initialization
        }

        this.masterController = masterController;
        this.config = config;
        this.instrumentLoader = instrumentLoader;
        this.telegramService = telegramService;
        this.positionManager = positionManager;
        this.dataFetcher = dataFetcher;
        this.params = config.resistance_retest_params || {};
        this.candleIntervalMinutes = 15;

        this.underlying = {
            symbol: config.underlying,
            token: Number(config.token),
            exch_seg: config.exchange,
            ltp: 0,
        };
        
        this.watchedOptions = new Map();
        this.supportLevels = [];
        this.resistanceLevels = [];
        this.isActive = true;
        this.isSettingUpTrade = false;
        this.lastCandleTime = null;
        this.watchedLevels = new Map();
        this.tradedLevels = new Map();
        this.tradeCooldown = (this.params.trade_cooldown_minutes || 15) * 60 * 1000;
    }

    start() { this.isActive = true; }
    stop() { this.isActive = false; }

    getTokensToTrack() {
        if (!this.isActive) return [];
        const underlyingToken = [{ ...this.underlying }];
        const optionTokens = Array.from(this.watchedOptions.values()).map(opt => opt.instrument);
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
                if (previousCandleTime) this.confirmAndSetupTrade(previousCandleTime);
            }

            if (this.isSettingUpTrade) return;

            for (const resistance of this.resistanceLevels) {
                if (this.tradedLevels.has(resistance.level) && (now.valueOf() - this.tradedLevels.get(resistance.level) < this.tradeCooldown)) continue;
                if (this.watchedLevels.has(resistance.level) && this.watchedLevels.get(resistance.level).candleTime.isSame(currentCandleTime)) continue;

                if (this.underlying.ltp >= resistance.level * 0.999 && this.underlying.ltp <= resistance.level) {
                    this.watchedLevels.set(resistance.level, { candleTime: currentCandleTime });
                    this.telegramService.sendMessage(`🔔 *Resistance Touch Alert for ${this.underlying.symbol}*\n\n*Resistance Level:* \`${resistance.level.toFixed(2)}\`\n*Action:* Waiting for 15-min candle to close for confirmation.`);
                }
            }
        }

        if (this.watchedOptions.has(numericTickToken)) {
            const watchedOpt = this.watchedOptions.get(numericTickToken);
            const ltp = tick.last_price;
            const entryThreshold = watchedOpt.entryPrice; // UPDATED: Strict entry price, no buffer.

            if (ltp <= entryThreshold) {
                console.log(`[${this.config.underlying}] ENTRY TRIGGERED for ${watchedOpt.instrument.symbol} at ${ltp}`);
                
                this.positionManager.addOpenPosition({
                    instrument: watchedOpt.instrument,
                    entryPrice: ltp,
                    tradeType: 'PE',
                    strategyName: 'ResistanceRetest',
                    atrValue: watchedOpt.atrValue,
                    atrSettings: watchedOpt.atrSettings,
                });
                
                this.watchedOptions.delete(numericTickToken);
                this.masterController.subscribeToTokens();
            }
        }
    }

    async confirmAndSetupTrade(candleTimeToConfirm) {
        this.isSettingUpTrade = true;
        try {
            const levelsToCheck = Array.from(this.watchedLevels.entries())
                .filter(([_, value]) => value.candleTime.isSame(candleTimeToConfirm));
            if (levelsToCheck.length === 0) return;

            const history = await this.getUnderlyingCandle(candleTimeToConfirm);
            if (!history || !history.data || history.data.length === 0) {
                console.error(`[${this.underlying.symbol}] Could not fetch confirmation candle data for ${candleTimeToConfirm.format()} after retries.`);
                levelsToCheck.forEach(([level]) => this.watchedLevels.delete(level));
                return;
            }

            const confirmationCandle = history.data[0];
            const openPrice = confirmationCandle[1];
            const highPrice = confirmationCandle[2];
            const closePrice = confirmationCandle[4];

            for (const [level] of levelsToCheck) {
                // ---- MODIFIED CONDITION ----
                const isBearish = closePrice < openPrice;
                const isBelowResistance = closePrice < level;
                const openedBelowResistance = openPrice < level;
                const testedResistance = highPrice >= level;

                if (isBearish && isBelowResistance && openedBelowResistance && testedResistance) {
                    // MODIFIED: Send this specific message to the alert bot
                    this.telegramService.sendAlertMessage(`✅ *Resistance Confirmed for ${this.underlying.symbol}*\n\n*Level:* \`${level.toFixed(2)}\`\n*Confirmation:* Bearish candle tested, opened, and closed below resistance.`);
                    await this.executeTradeSetup(confirmationCandle);
                    this.tradedLevels.set(level, Date.now());
                } else {
                    let reason = "did not meet criteria";
                    if (!testedResistance) reason = `did not test resistance level (H:${highPrice.toFixed(2)})`;
                    else if (!isBelowResistance) reason = `closed at or above resistance (${closePrice.toFixed(2)})`;
                    else if (!isBearish) reason = `was not a bearish candle (O:${openPrice.toFixed(2)}, C:${closePrice.toFixed(2)})`;
                    else if (!openedBelowResistance) reason = `opened at or above resistance level (O:${openPrice.toFixed(2)})`;
                    
                    this.telegramService.sendMessage(`❌ *Resistance REJECTED for ${this.underlying.symbol}*\n\n*Level:* \`${level.toFixed(2)}\`\n*Reason:* Confirmation candle ${reason}.`);
                }
                // ---- END MODIFICATION ----
                this.watchedLevels.delete(level);
            }
        } catch (error) {
            console.error(`[${this.underlying.symbol}] Error in confirmAndSetupTrade:`, error);
        } finally {
            this.isSettingUpTrade = false;
        }
    }

    async getOptionAtrValue(optionInstrument) {
        if (!this.config.atrSettings || !this.config.atrSettings.enabled) {
            return 0; // Return 0 if ATR is disabled in config
        }

        const { period } = this.config.atrSettings;
        const historyDays = 45;
        const toDate = moment().tz("Asia/Kolkata");
        const fromDate = toDate.clone().subtract(historyDays, 'days');
        const params = getHistoricalDataParams(optionInstrument, this.params.candle_interval, fromDate.format('YYYY-MM-DD HH:mm'), toDate.format('YYYY-MM-DD HH:mm'));
        
        // FIX: Ensure symbol and exchange are passed for validation in DataFetcher
        if (params) {
            params.symbol = optionInstrument.symbol;
            params.exchange = optionInstrument.exch_seg;
        }
        
        try {
            const history = await this.dataFetcher.getHistoricalData(params);
            
            if (history?.data && history.data.length >= period) {
                const candles = history.data.map(c => ({ time: c[0], open: c[1], high: c[2], low: c[3], close: c[4] }));
                const atrResult = ATR(period, candles);
                if (atrResult.length > 0) {
                    const latestAtr = atrResult[atrResult.length - 1];
                    console.log(`[${optionInstrument.symbol}] Successfully calculated ATR on ${history.data.length} candles. Value: ${latestAtr.toFixed(2)}`);
                    return latestAtr;
                }
            }
            
            console.warn(`[${optionInstrument.symbol}] Not enough data for ATR calc. Needed ${period}, got ${history?.data?.length || 0}.`);
            return null;

        } catch (error) {
            console.error(`[${optionInstrument.symbol}] Failed to fetch data for ATR calculation after all retries:`, error.message);
            return null;
        }
    }

    async getOptionRsiValue(optionInstrument) {
        if (!this.config.rsiSettings || !this.config.rsiSettings.enabled) {
            return null;
        }

        const { period } = this.config.rsiSettings;
        const historyDays = 45;
        const toDate = moment().tz("Asia/Kolkata");
        const fromDate = toDate.clone().subtract(historyDays, 'days');
        const params = getHistoricalDataParams(optionInstrument, this.params.candle_interval, fromDate.format('YYYY-MM-DD HH:mm'), toDate.format('YYYY-MM-DD HH:mm'));
        
        // FIX: Ensure symbol and exchange are passed for validation in DataFetcher
        if (params) {
            params.symbol = optionInstrument.symbol;
            params.exchange = optionInstrument.exch_seg;
        }

        try {
            const history = await this.dataFetcher.getHistoricalData(params);

            if (history?.data && history.data.length >= period + 1) {
                const candles = history.data.map(c => ({ close: c[4] }));
                const rsiResult = RSI(period, candles);
                if (rsiResult.length > 0) {
                    const latestRsi = rsiResult[rsiResult.length - 1];
                    console.log(`[${optionInstrument.symbol}] Successfully calculated RSI on ${history.data.length} candles. Value: ${latestRsi.toFixed(2)}`);
                    return latestRsi;
                }
            }
            
            console.warn(`[${optionInstrument.symbol}] Not enough data for RSI calc. Needed ${period + 1}, got ${history?.data?.length || 0}.`);
            return null;

        } catch (error) {
            console.error(`[${optionInstrument.symbol}] Failed to fetch data for RSI calculation after all retries:`, error.message);
            return null;
        }
    }

    async executeTradeSetup(underlyingCandle) {
        try {
            const options = findATMOptions(this.instrumentLoader.instruments, this.underlying.symbol, this.underlying.ltp, this.config.options.expiry_date, this.config.exchange);
            const putOption = options.find(o => o.symbol.endsWith('PE'));

            if (!putOption) {
                console.warn(`[${this.underlying.symbol}] Could not find ATM Put Option on the specified exchange.`);
                return;
            }
            
            // =================================================================================
            // TEMP: Volume condition check disabled as per user request.
            // =================================================================================
            /*
            // ---- MODIFIED VOLUME CHECK: Pass the underlying candle to fix timing ----
            const volumeCheckHistory = await this.getOptionCandlesForVolumeCheck(putOption, underlyingCandle);
            if (!volumeCheckHistory || volumeCheckHistory.length < 2) {
                const message = `⚠️ *Trade Setup SKIPPED (PE) for ${this.underlying.symbol}*\n\n*Symbol:* \`${putOption.symbol}\`\n*Reason:* Not enough historical data for volume check.`;
                console.log(`[${this.underlying.symbol}] Trade setup for ${putOption.symbol} skipped: ${message}`);
                this.telegramService.sendMessage(message);
                return;
            }
            
            // The last candle in history is now the one that just completed
            const currentCandle = volumeCheckHistory[volumeCheckHistory.length - 1];
            const previousCandle = volumeCheckHistory[volumeCheckHistory.length - 2];
            
            // Assuming candle format is [time(0), open(1), high(2), low(3), close(4), volume(5)]
            const previousVolume = previousCandle[5];
            const currentVolume = currentCandle[5];

            if (typeof previousVolume === 'undefined' || typeof currentVolume === 'undefined') {
                const message = `⚠️ *Trade Setup SKIPPED (PE) for ${this.underlying.symbol}*\n\n*Symbol:* \`${putOption.symbol}\`\n*Reason:* Volume data was not found in candles. Cannot perform volume check.`;
                console.log(`[${this.underlying.symbol}] Trade setup for ${putOption.symbol} skipped: ${message}`);
                this.telegramService.sendMessage(message);
                return;
            }

            const previousOpen = previousCandle[1];
            const previousClose = previousCandle[4];
            const previousIsGreen = previousClose > previousOpen;

            const volumeConditionMet = (currentVolume > previousVolume) || previousIsGreen;

            if (volumeConditionMet) {
                const confirmationMessage = `✅ *Volume Confirmed (PE) for ${this.underlying.symbol}*\n\n*Symbol:* \`${putOption.symbol}\`\n*Reason:* Volume condition met.\n  - Current Vol: \`${currentVolume}\`\n  - Previous Vol: \`${previousVolume}\` (${previousIsGreen ? 'Green' : 'Red'})`;
                console.log(`[${this.underlying.symbol}] Volume confirmed for ${putOption.symbol}.`);
                this.telegramService.sendMessage(confirmationMessage);
            } else {
                const message = `❌ *Trade Rejected (PE) for ${this.underlying.symbol}*\n\n*Symbol:* \`${putOption.symbol}\`\n*Reason:* Volume condition not met.\n  - Current Vol: \`${currentVolume}\`\n  - Previous Vol: \`${previousVolume}\` (${previousIsGreen ? 'Green' : 'Red'})`;
                console.log(`[${this.underlying.symbol}] Trade setup for ${putOption.symbol} rejected. ${message}`);
                this.telegramService.sendMessage(message);
                return;
            }
            */
            // =================================================================================

            if (this.config.rsiSettings && this.config.rsiSettings.enabled) {
                const rsiValue = await this.getOptionRsiValue(putOption);
                if (rsiValue === null || rsiValue >= this.config.rsiSettings.threshold) {
                    const reason = rsiValue === null ? 'could not be calculated' : `is ${rsiValue.toFixed(2)} (>=${this.config.rsiSettings.threshold})`;
                    const message = `❌ *Trade Rejected (PE) for ${this.underlying.symbol}*\n\n*Symbol:* \`${putOption.symbol}\`\n*Reason:* RSI condition not met. RSI ${reason}.`;
                    console.log(`[${this.underlying.symbol}] Trade setup for ${putOption.symbol} rejected. ${message}`);
                    this.telegramService.sendMessage(message);
                    return; 
                }
            }
            
            const atrValue = await this.getOptionAtrValue(putOption);
            if (atrValue === null) {
                const message = `❌ *Trade Rejected (PE) for ${this.underlying.symbol}*\n\n*Symbol:* \`${putOption.symbol}\`\n*Reason:* Failed to calculate a valid ATR after multiple retries.`;
                console.log(`[${this.underlying.symbol}] Trade setup for ${putOption.symbol} rejected. ${message}`);
                this.telegramService.sendMessage(message);
                return;
            }

            const optionCandle = await this.getOptionCandle(putOption, underlyingCandle);
            if (!optionCandle) {
                 this.telegramService.sendMessage(`⚠️ *Trade Setup SKIPPED (PE) for ${this.underlying.symbol}*\n\n*Symbol:* \`${putOption.symbol}\`\n*Reason:* Could not fetch option candle data after multiple retries.`);
                return;
            }
            const targetBuyPrice = optionCandle[3]; 
            const numericToken = Number(putOption.token);

            this.telegramService.sendMessage(`🚀 *Trade Setup (PE) for ${this.underlying.symbol}*\n\n*Symbol:* \`${putOption.symbol}\`\n*Entry Target:* \`${targetBuyPrice.toFixed(2)}\`\n*Option ATR:* \`${atrValue.toFixed(2)}\`\n*Action:* Strategy is now watching for entry.`);

            this.watchedOptions.set(numericToken, {
                instrument: { ...putOption, token: numericToken, lotsize: Number(putOption.lotsize) },
                entryPrice: targetBuyPrice,
                atrValue: atrValue,
                atrSettings: this.config.atrSettings,
            });

            this.masterController.subscribeToTokens();
        } catch (error) {
            console.error(`[${this.underlying.symbol}] Error during trade execution setup:`, error);
        }
    }

    async getUnderlyingCandle(candleTime) {
        const fromDate = candleTime;
        const toDate = candleTime.clone().add(this.candleIntervalMinutes, 'minutes');
        const params = getHistoricalDataParams(this.underlying, this.params.candle_interval, fromDate.format('YYYY-MM-DD HH:mm'), toDate.format('YYYY-MM-DD HH:mm'));
        
        // FIX: Ensure symbol and exchange are passed for validation in DataFetcher
        if (params) {
            params.symbol = this.underlying.symbol;
            params.exchange = this.underlying.exch_seg;
        }

        return await this.dataFetcher.getHistoricalData(params);
    }

    async getOptionCandle(optionInstrument, underlyingCandle) {
        const candleMoment = moment(underlyingCandle[0]).tz("Asia/Kolkata");
        const params = getHistoricalDataParams(optionInstrument, this.params.candle_interval, candleMoment.format('YYYY-MM-DD HH:mm'), candleMoment.clone().add(this.candleIntervalMinutes, 'minutes').format('YYYY-MM-DD HH:mm'));
        
        // FIX: Ensure symbol and exchange are passed for validation in DataFetcher
        if (params) {
            params.symbol = optionInstrument.symbol;
            params.exchange = optionInstrument.exch_seg;
        }

        try {
            const history = await this.dataFetcher.getHistoricalData(params);
            if (!history?.data || history.data.length === 0) {
                console.error(`[${optionInstrument.symbol}] Could not fetch option candle data after retries.`);
                return null;
            }
            return history.data[0];
        } catch (error) {
            console.error(`[${optionInstrument.symbol}] Final failure fetching option candle:`, error.message);
            return null;
        }
    }
    
    // ---- MODIFIED FUNCTION to accept underlyingCandle for correct timing ----
    async getOptionCandlesForVolumeCheck(optionInstrument, underlyingCandle) {
        // Use the end time of the completed underlying candle as the 'toDate'
        const toDate = moment(underlyingCandle[0]).tz("Asia/Kolkata").add(this.candleIntervalMinutes, 'minutes');
        // Fetch last 2 hours of data to be safe with market gaps or low liquidity periods
        const fromDate = toDate.clone().subtract(2, 'hours');
        const params = getHistoricalDataParams(optionInstrument, this.params.candle_interval, fromDate.format('YYYY-MM-DD HH:mm'), toDate.format('YYYY-MM-DD HH:mm'));

        if (params) {
            params.symbol = optionInstrument.symbol;
            params.exchange = optionInstrument.exch_seg;
        }

        try {
            const history = await this.dataFetcher.getHistoricalData(params);
            // Filter out any potentially incomplete candle that might still be returned
            return (history?.data && history.data.length > 0) 
                ? history.data.filter(c => moment(c[0]).tz("Asia/Kolkata").isBefore(toDate)) 
                : null;
        } catch (error) {
            console.error(`[${optionInstrument.symbol}] Failed to fetch candles for volume check:`, error.message);
            return null;
        }
    }

    async initialize() {
        if (!this.isActive) return; // Don't initialize if config was bad

        // Add a random delay to stagger initialization across multiple strategy instances
        const randomDelay = Math.random() * 5000; // Random delay up to 5 seconds
        await new Promise(res => setTimeout(res, randomDelay));

        await this.updateLevels();
        this.lastCandleTime = getCandleTime(moment().tz("Asia/Kolkata"), this.candleIntervalMinutes);
        console.log(`[${this.underlying.symbol}] ResistanceRetestStrategy Initialized. Current candle starts at: ${this.lastCandleTime.format('HH:mm')}`);
    }

    async updateLevels() {
        this.isUpdatingLevels = true;
        try {
            await this.updateUnderlyingLTP();
            if (this.underlying.ltp <= 0) return;

            const toDate = moment().tz("Asia/Kolkata");
            const fromDate = toDate.clone().subtract(this.config.historical_data.days, 'days');
            const historyParams = getHistoricalDataParams(this.underlying, this.config.historical_data.timeframe, fromDate.format('YYYY-MM-DD HH:mm'), toDate.format('YYYY-MM-DD HH:mm'));

            // FIX: Ensure the symbol and exchange are passed to the DataFetcher for validation.
            if (historyParams) {
                historyParams.symbol = this.underlying.symbol;
                historyParams.exchange = this.underlying.exch_seg;
            }

            const history = await this.dataFetcher.getHistoricalData(historyParams);
            if (history?.data) {
                const candles = history.data.map(c => ({ time: c[0], open: c[1], high: c[2], low: c[3], close: c[4] }));
                const { supports, resistances } = SupportResistance.detectLevels(candles, this.underlying.ltp, this.config.support_resistance);
                this.supportLevels = supports;
                this.resistanceLevels = resistances;
            }
        } catch (err) {
            console.error(`[${this.underlying.symbol}] Failed to update levels:`, err);
        } finally {
            this.isUpdatingLevels = false;
        }
    }

    async updateUnderlyingLTP() {
        try {
            const toDate = moment().tz("Asia/Kolkata");
            const fromDate = toDate.clone().subtract(15, 'minutes');
            const params = getHistoricalDataParams(this.underlying, 'ONE_MINUTE', fromDate.format('YYYY-MM-DD HH:mm'), toDate.format('YYYY-MM-DD HH:mm'));

            // FIX: Ensure the symbol and exchange are passed to the DataFetcher for validation.
            if (params) {
                params.symbol = this.underlying.symbol;
                params.exchange = this.underlying.exch_seg;
            }

            const history = await this.dataFetcher.getHistoricalData(params);
            if (history?.data?.length > 0) {
                this.underlying.ltp = history.data[history.data.length - 1][4];
            }
        } catch (e) {
            console.error(`[${this.underlying.symbol}] LTP update failed:`, e);
        }
    }

    getLevelsAndLTP() {
        return {
            ltp: this.underlying.ltp,
            supports: this.supportLevels.map(s => s.level),
            resistances: this.resistanceLevels.map(r => r.level),
        };
    }
}

module.exports = ResistanceRetestStrategy;
