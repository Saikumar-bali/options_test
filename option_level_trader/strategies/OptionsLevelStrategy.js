// File: /option_level_trader/strategies/OptionsLevelStrategy.js

const moment = require('moment-timezone');
const EventEmitter = require('events');
const SupportResistance = require('../indicators/SupportResistance');
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

        this.underlying = {
            symbol: config.underlying,
            token: Number(config.token),
            exch_seg: config.exchange || 'NSE',
            ltp: 0,
        };

        // This map will store the ATM options we are currently tracking
        this.atmOptions = new Map();

        this.isActive = true;
        this.isSettingUpTrade = false;
        this.lastCandleTime = null;
        this.tradeCooldown = (this.params.trade_cooldown_minutes || 15) * 60 * 1000;
    }

    start() { this.isActive = true; }
    stop() { this.isActive = false; }

    getTokensToTrack() {
        if (!this.isActive) return [];
        const underlyingToken = [{ ...this.underlying }];
        const optionTokens = Array.from(this.atmOptions.values()).map(opt => opt.instrument);
        return [...underlyingToken, ...optionTokens];
    }

    processData(tick) {
        if (!this.isActive) return;
        const numericTickToken = Number(tick.token);

        // --- Handle Underlying Tick ---
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
                    // Periodically re-check for new ATM options
                    this.updateATMandLevels(); 
                }
            }
            return; // End processing for this tick
        }
        
        // --- Handle Option Tick ---
        const tradedOption = this.atmOptions.get(numericTickToken);
        if (tradedOption) {
            tradedOption.ltp = tick.last_price;
            if (tradedOption.ltp <= 0) return;

            const now = moment(tick.last_trade_time).tz("Asia/Kolkata");
            const currentCandleTime = getCandleTime(now, this.candleIntervalMinutes);

            // Check for touches on this specific option's support levels
            for (const support of tradedOption.supportLevels) {
                if (tradedOption.tradedLevels.has(support.level) && (now.valueOf() - tradedOption.tradedLevels.get(support.level) < this.tradeCooldown)) continue;
                if (tradedOption.watchedLevels.has(support.level) && tradedOption.watchedLevels.get(support.level).candleTime.isSame(currentCandleTime)) continue;

                if (tradedOption.ltp <= support.level * 1.001 && tradedOption.ltp >= support.level) {
                    tradedOption.watchedLevels.set(support.level, { candleTime: currentCandleTime });
                    this.telegramService.sendMessage(`🔔 *Support Touch Alert for ${tradedOption.symbol}*\n\n*Support Level:* \
*Action:* Waiting for 15-min candle to close for confirmation.`);
                }
            }
        }
    }

    async confirmAndSetupTrade(candleTimeToConfirm) {
        this.isSettingUpTrade = true;
        try {
            for (const [token, tradedOption] of this.atmOptions.entries()) {
                const levelsToCheck = Array.from(tradedOption.watchedLevels.entries())
                    .filter(([_, value]) => value.candleTime.isSame(candleTimeToConfirm));
                
                if (levelsToCheck.length === 0) continue;

                const history = await this.getOptionCandle(tradedOption, candleTimeToConfirm);
                if (!history || history.length === 0) {
                    console.error(`[${tradedOption.symbol}] Could not fetch confirmation candle data for ${candleTimeToConfirm.format()}.`);
                    levelsToCheck.forEach(([level]) => tradedOption.watchedLevels.delete(level));
                    continue;
                }

                const confirmationCandle = history;
                const openPrice = confirmationCandle[1];
                const lowPrice = confirmationCandle[3];
                const closePrice = confirmationCandle[4];

                for (const [level] of levelsToCheck) {
                    const isBullish = closePrice > openPrice;
                    const isAboveSupport = closePrice > level;
                    const openedAboveSupport = openPrice > level;
                    const testedSupport = lowPrice <= level;

                    if (isBullish && isAboveSupport && openedAboveSupport && testedSupport) {
                        this.telegramService.sendAlertMessage(`✅ *Support Confirmed for ${tradedOption.symbol}*\n\n*Level:* \`${level.toFixed(2)}\`\n*Action:* Placing trade.`);
                        
                        this.positionManager.addOpenPosition({
                            instrument: tradedOption.instrument,
                            entryPrice: closePrice, // Or use a more sophisticated entry price logic
                            tradeType: tradedOption.instrument.symbol.endsWith('CE') ? 'CE' : 'PE',
                            strategyName: 'OptionsLevel',
                        });

                        tradedOption.tradedLevels.set(level, Date.now());

                    } else {
                        let reason = "did not meet criteria";
                        if (!testedSupport) reason = `did not test support level (L:${lowPrice.toFixed(2)})`;
                        else if (!isAboveSupport) reason = `closed at or below support (${closePrice.toFixed(2)})`;
                        else if (!isBullish) reason = `was not a bullish candle (O:${openPrice.toFixed(2)}, C:${closePrice.toFixed(2)})`;
                        else if (!openedAboveSupport) reason = `opened at or below support level (O:${openPrice.toFixed(2)})`;
                        this.telegramService.sendMessage(`❌ *Support REJECTED for ${tradedOption.symbol}*\n\n*Level:* \`${level.toFixed(2)}\`\n*Reason:* Confirmation candle ${reason}.`);
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

    async initialize() {
        if (!this.isActive) return;
        await this.updateATMandLevels();
        this.lastCandleTime = getCandleTime(moment().tz("Asia/Kolkata"), this.candleIntervalMinutes);
        console.log(`[${this.underlying.symbol}] OptionsLevelStrategy Initialized. Current candle starts at: ${this.lastCandleTime.format('HH:mm')}`);
    }

    async updateATMandLevels() {
        console.log(`[${this.underlying.symbol}] Finding ATM options and updating their S/R levels...`);
        
        await this.updateUnderlyingLTP();
        if (this.underlying.ltp <= 0) {
            console.warn(`[${this.underlying.symbol}] Could not fetch underlying LTP. Skipping ATM search.`);
            return;
        }

        const atmOptionInstruments = findATMOptions(this.instrumentLoader.instruments, this.underlying.symbol, this.underlying.ltp, this.config.options.expiry_date);

        if (atmOptionInstruments.length === 0) {
            console.warn(`[${this.underlying.symbol}] No ATM options found for the specified expiry.`);
            return;
        }
        
        // Create a new map for the latest ATM options
        const newAtmOptions = new Map();

        for (const instrument of atmOptionInstruments) {
            const token = Number(instrument.token);
            // Prepare a structure for the option, preserving old state if it still exists
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

        this.atmOptions = newAtmOptions; // Replace the old map with the new one
        console.log(`[${this.underlying.symbol}] Finished updating levels for ${this.atmOptions.size} ATM options.`);

        // Trigger a re-subscription in the MasterController
        this.masterController.subscribeToTokens();
    }
    
    async updateLevelsForOption(tradedOption) {
        try {
            await this.updateOptionLTP(tradedOption);
            if (tradedOption.ltp <= 0) {
                console.warn(`[${tradedOption.symbol}] LTP is 0, skipping level update.`);
                return;
            }

            const toDate = moment().tz("Asia/Kolkata");
            const fromDate = toDate.clone().subtract(this.config.historical_data.days, 'days');
            const historyParams = getHistoricalDataParams(tradedOption.instrument, this.config.historical_data.timeframe, fromDate.format('YYYY-MM-DD HH:mm'), toDate.format('YYYY-MM-DD HH:mm'));

            const history = await this.dataFetcher.getHistoricalData(historyParams);
            // Normalize response shape: accept either an array (legacy) or { data: array }
            const data = Array.isArray(history) ? history : history?.data;
            if (data && data.length > 0) {
                const candles = data.map(c => ({ high: c[2], low: c[3], open: c[1], close: c[4] }));
                const { supports, resistances } = SupportResistance.detectLevels(candles, tradedOption.ltp, this.config.support_resistance);

                tradedOption.supportLevels = supports;
                tradedOption.resistanceLevels = resistances;

                console.log(`[${tradedOption.symbol}] Levels updated. Supports: ${supports.length}, Resistances: ${resistances.length}`);
            }
        } catch (err) {
            console.error(`[${tradedOption.symbol}] Failed to update levels:`, err);
        }
    }

    async updateUnderlyingLTP() {
        // Fetches the most recent price for the underlying
        try {
            const toDate = moment().tz("Asia/Kolkata");
            const fromDate = toDate.clone().subtract(15, 'minutes');
            const params = getHistoricalDataParams(this.underlying, 'ONE_MINUTE', fromDate.format('YYYY-MM-DD HH:mm'), toDate.format('YYYY-MM-DD HH:mm'));
            
            const history = await this.dataFetcher.getHistoricalData(params);
            const data = Array.isArray(history) ? history : history?.data;
            if (data && data.length > 0) {
                this.underlying.ltp = data[data.length - 1][4];
                console.log(`[${this.underlying.symbol}] Underlying LTP updated to: ${this.underlying.ltp}`);
            }
        } catch (e) {
            console.error(`[${this.underlying.symbol}] Underlying LTP update failed:`, e);
        }
    }

    async updateOptionLTP(tradedOption) {
        // Fetches the most recent price for a specific option
        try {
            const toDate = moment().tz("Asia/Kolkata");
            const fromDate = toDate.clone().subtract(15, 'minutes');
            const params = getHistoricalDataParams(tradedOption.instrument, 'ONE_MINUTE', fromDate.format('YYYY-MM-DD HH:mm'), toDate.format('YYYY-MM-DD HH:mm'));

            const history = await this.dataFetcher.getHistoricalData(params);
            const data = Array.isArray(history) ? history : history?.data;
            if (data && data.length > 0) {
                tradedOption.ltp = data[data.length - 1][4];
            }
        } catch (e) {
            console.error(`[${tradedOption.symbol}] Option LTP update failed:`, e);
        }
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