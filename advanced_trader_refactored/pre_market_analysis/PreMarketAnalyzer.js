// File: /src/pre_market_analysis/PreMarketAnalyzer.js
const fs = require('fs');
const path = require('path');
const moment = require('moment-timezone');
const ApiService = require('./api_service');
const CsvHandler = require('./csv_handler');
const TradeIdentifier = require('./trade_identifier');
const SrCalculator = require('../src/indicators/SupportResistance');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

class PreMarketAnalyzer {
    constructor(config, logger, masterController, instrumentManager) {
        this.config = config.preMarketAnalysis;
        this.logger = logger;
        this.instrumentManager = instrumentManager;
        this.api = new ApiService(masterController, instrumentManager, logger);
        this.tradeIdentifier = new TradeIdentifier(this.config.sr_calculation_parameters.proximity_to_sr_percent);
    }

    async run() {
        this.logger.info("🚀 Starting Pre-Market Analysis...");
        this.setupDataStore();
        const allSetups = [];
        for (const underlying of this.config.underlyings_to_scan) {
            const setupsForUnderlying = await this.processUnderlying(underlying);
            if (setupsForUnderlying.length > 0) allSetups.push(...setupsForUnderlying);
        }
        this.generateOutputFile(allSetups);
        this.logger.info("🏁 Pre-Market Analysis Complete.");
        this.logger.info(`--- Pausing for 500ms before next instrument ---`);
        await sleep(500); // Wait half a second to be nice to the API
    }

    mergeCandleData(existing, newData) {
        const candleMap = new Map();
        existing.forEach(c => candleMap.set(c.timestamp, c));
        newData.forEach(c => candleMap.set(c.timestamp, c));
        return Array.from(candleMap.values()).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    }

    filterStrikesNearAtm(allStrikes, atmStrike) {
        if (allStrikes.length <= 5) {
            return allStrikes; // Return as is if the list is already small
        }

        // Find the index of the strike closest to the ATM strike
        let closestIndex = 0;
        let minDiff = Infinity;
        allStrikes.forEach((strike, index) => {
            const diff = Math.abs(strike - atmStrike);
            if (diff < minDiff) {
                minDiff = diff;
                closestIndex = index;
            }
        });

        // Define the slice range: 2 strikes below the closest, the closest, and 2 strikes above
        const startIndex = Math.max(0, closestIndex - 2);
        const endIndex = Math.min(allStrikes.length, closestIndex + 3);

        const focusedStrikes = allStrikes.slice(startIndex, endIndex);
        this.logger.info(`Filtered ${allStrikes.length} S/R strikes down to ${focusedStrikes.length} closest to ATM.`);
        return focusedStrikes;
    }

    async processUnderlying(underlying) {
        this.logger.info(`🔎 Processing Underlying: ${underlying.symbol}`);
        const setupsForThisUnderlying = [];

        // Get correct expiry using instrument manager
        const expiry = this.findCorrectExpiryForSymbol(underlying.symbol);
        if (!expiry) {
            this.logger.warn(`Could not determine expiry for ${underlying.symbol}. Skipping.`);
            return setupsForThisUnderlying;
        }
        this.logger.info(`🎯 Using expiry: ${expiry} for ${underlying.symbol}`);

        const { price: atmPrice, candles: atmCandles } = await this.api.getAtmPriceAndCandles(underlying.symbol, underlying.underlying_segment, underlying.token);
        if (!atmPrice) {
            this.logger.warn(`Could not determine ATM price for ${underlying.symbol}. Skipping.`);
            return setupsForThisUnderlying;
        }
        this.logger.info(`[ATM] Derived ATM price for ${underlying.symbol} as ${atmPrice}.`);

        const srCandles = await this.getAndUpdateHistoricalData(underlying.symbol, underlying.underlying_segment, underlying.token, this.config.underlying_historical_config, true);
        if (!srCandles || srCandles.length === 0) {
            this.logger.warn(`No S/R candles found for ${underlying.symbol}. Skipping.`);
            return setupsForThisUnderlying;
        }
        underlying.candles = srCandles;

        // Calculate S/R levels
        const { reactionLookback, levelsToReturn } = this.config.sr_calculation_parameters;
        const srLevels = SrCalculator.detectLevels(underlying.candles, atmPrice, { reactionLookback, levelsToReturn });
        underlying.sr_levels = srLevels;

        this.logger.info(`📊 Found Top S/R levels for ${underlying.symbol}:`);
        srLevels.supports.forEach(s => this.logger.info(`  - Support at ${s.level.toFixed(2)} (Reaction: ${s.reaction.toFixed(2)})`));
        srLevels.resistances.forEach(r => this.logger.info(`  - Resistance at ${r.level.toFixed(2)} (Reaction: ${r.reaction.toFixed(2)})`));

        if (srLevels.supports.length === 0 && srLevels.resistances.length === 0) {
            this.logger.warn(`No significant S/R levels found for ${underlying.symbol}, cannot proceed.`);
            return setupsForThisUnderlying;
        }

        // Get strikes near S/R levels
        const strikeStep = underlying.symbol.includes('BANKNIFTY') ? 100 :
            (underlying.symbol.includes('NIFTY') ? 50 : 20);

        // First, get all strikes based on S/R levels
        const allSrStrikes = this.tradeIdentifier.determineStrikesFromSr(srLevels, strikeStep);

        // --- NEW FILTERING LOGIC ---
        // Calculate the ATM strike to find our focus area
        const atmStrike = Math.round(atmPrice / strikeStep) * strikeStep;

        // Filter the long list down to only the strikes nearest to the ATM
        const strikesToScan = this.filterStrikesNearAtm(allSrStrikes, atmStrike);

        if (strikesToScan.length === 0) {
            this.logger.warn(`No S/R-based strikes were found near the ATM for ${underlying.symbol}. Skipping.`);
            return setupsForThisUnderlying;
        }

            this.logger.info(`🎯 Scanning S/R-based strikes: ${strikesToScan.join(', ')}`);

            // Fetch option contracts for all relevant strikes
            const optionsBaseSymbol = underlying.symbol.replace('-EQ', '');
            const selectedOptions = [];

            for (const strike of strikesToScan) {
                const strikeStr = strike.toFixed(2);

                // Find the CE option for this strike
                const ceDetails = this.instrumentManager.findOption(optionsBaseSymbol, strikeStr, expiry, 'CE');
                if (ceDetails) {
                    selectedOptions.push({
                        ...ceDetails,
                        instrument_type: 'CE',
                        strike_price: strike,
                        expiry_date: expiry
                    });
                }

                // Find the PE option for this strike
                const peDetails = this.instrumentManager.findOption(optionsBaseSymbol, strikeStr, expiry, 'PE');
                if (peDetails) {
                    selectedOptions.push({
                        ...peDetails,
                        instrument_type: 'PE',
                        strike_price: strike,
                        expiry_date: expiry
                    });
                }
            }

            this.logger.info(`Found ${selectedOptions.length} option contracts to analyze for ${underlying.symbol}.`);

            for (const option of selectedOptions) {
                option.candles = await this.getAndUpdateHistoricalData(option.symbol, 'NFO', option.token, this.config.option_historical_config, false);

                if (option.candles && option.candles.length > 0) {
                    // Call the identifier to see if a setup exists for this option
                    const setups = this.tradeIdentifier.identify(underlying, option);
                    // Check if any setups were returned
                    if (setups.length > 0) {
                        this.logger.info(`✅ Found ${setups.length} potential setup(s) for ${option.symbol}`);

                        const optionLastPrice = option.candles[option.candles.length - 1].close;

                        setups.forEach(setup => {
                            // Read risk parameters from the config file
                            const { stop_loss_percent, take_profit_percent } = this.config.trade_parameters;

                            // Calculate the final SL and TP prices
                            const stopLossPrice = optionLastPrice * (1.0 - stop_loss_percent / 100);
                            const takeProfitPrice = optionLastPrice * (1.0 + take_profit_percent / 100);

                            // Add the complete, actionable setup to our list
                            setupsForThisUnderlying.push({
                                ...setup, // Contains option details, reason, direction
                                underlying_symbol: underlying.symbol,
                                entry_price: optionLastPrice.toFixed(2),
                                stop_loss: stopLossPrice.toFixed(2),
                                take_profit: takeProfitPrice.toFixed(2)
                            });
                        });
                    }
                }
                await sleep(150); // Keep the delay to be nice to the API
            }
            return setupsForThisUnderlying;
        }

    async getAndUpdateHistoricalData(symbol, exchange, token, histConfig, isUnderlying) {
            const { duration_days, interval } = histConfig;
            const subFolder = isUnderlying ? `underlying_candles_${interval.replace('minute', 'min')}` : `option_candles_${interval.replace('minute', 'min')}`;
            const csvPath = path.join(this.config.data_store_path, subFolder, `${symbol}.csv`);
            const existingCandles = this.config.save_candles_to_csv ? CsvHandler.load(csvPath) : [];
            if (this.config.save_candles_to_csv) this.logger.info(`Loaded ${existingCandles.length} existing candles for ${symbol} from CSV.`);
            const { from_date, to_date } = this.api.getSafeDateRange(duration_days);
            const newCandles = await this.api.fetchHistoricalCandlesAPI({ tradingsymbol: symbol, exchange, symboltoken: token, interval, from_date, to_date });
            this.logger.info(`Fetched ${newCandles.length} new candles for ${symbol} from API.`);
            const mergedData = this.mergeCandleData(existingCandles, newCandles);
            if (this.config.save_candles_to_csv && mergedData.length > 0) {
                CsvHandler.save(csvPath, mergedData);
                this.logger.info(`Saved ${mergedData.length} total candles for ${symbol} to CSV.`);
            }
            return mergedData;
        }

        /**
         * Finds the correct expiry date for a given underlying by applying instrument-specific rules
         * @param {string} underlyingSymbol - The symbol (e.g., 'NIFTY', 'BANKNIFTY', 'RELIANCE-EQ')
         * @returns {string|null} The expiry date in DDMMMYYYY format or null
         */
        findCorrectExpiryForSymbol(underlyingSymbol) {
            const baseSymbol = underlyingSymbol.replace('-EQ', '');
            const today = moment.tz("Asia/Kolkata").startOf('day');
            const allExpiries = this.instrumentManager.getExpiriesForUnderlying(baseSymbol);

            const futureExpiries = allExpiries
                .map(e => moment(e, 'DDMMMYYYY'))
                .filter(m => m.isValid() && m.isSameOrAfter(today))
                .sort((a, b) => a.valueOf() - b.valueOf());

            if (futureExpiries.length === 0) return null;

            let targetExpiry;
            if (baseSymbol === 'NIFTY') {
                targetExpiry = futureExpiries[0];
            } else {
                let lastThursday = moment(today).endOf('month');
                while (lastThursday.day() !== 4) {
                    lastThursday.subtract(1, 'day');
                }
                if (lastThursday.isBefore(today)) {
                    lastThursday = moment(today).add(1, 'month').endOf('month');
                    while (lastThursday.day() !== 4) {
                        lastThursday.subtract(1, 'day');
                    }
                }
                targetExpiry = futureExpiries.find(d => d.isSame(lastThursday, 'day'));
                if (!targetExpiry) {
                    this.logger.warn(`Could not find standard monthly expiry for ${baseSymbol}. Falling back to its nearest available expiry.`);
                    targetExpiry = futureExpiries[0];
                }
            }
            return targetExpiry ? targetExpiry.format('DDMMMYYYY').toUpperCase() : null;
        }

        generateOutputFile(setups) {
            const filePath = path.join('./logs', this.logger.config.logFiles.updatedStocks);
            const outputList = setups.map(s => ({
                symbol: s.symbol,
                token: s.token,
                exch_seg: s.exch_seg,
                lotsize: s.lotsize,
                option_type: s.instrument_type,
                expiry: s.expiry_date,
                strike: s.strike_price,
                underlying: s.underlying_symbol,
                underlying_sr_level: s.underlying_sr_level,
                option_sr_level: null,
                trade_setup_reason: s.reason,
                recommended_direction: s.direction
            }));
            fs.writeFileSync(filePath, JSON.stringify(outputList, null, 2));
            this.logger.info(`📝 Wrote ${outputList.length} potential setups to ${filePath}`);
        }

        setupDataStore() {
            if (!this.config.save_candles_to_csv || !this.config.data_store_path) {
                this.logger.info("[CSV] Candle saving is disabled or data_store_path is not defined. Skipping data store setup.");
                return;
            }
            const data_store_path = this.config.data_store_path;
            if (!fs.existsSync(data_store_path)) fs.mkdirSync(data_store_path, { recursive: true });
            const underlyingInterval = this.config.underlying_historical_config.interval;
            const optionInterval = this.config.option_historical_config.interval;
            const underlyingSubFolder = `underlying_candles_${underlyingInterval.replace('minute', 'min')}`;
            const optionSubFolder = `option_candles_${optionInterval.replace('minute', 'min')}`;
            [underlyingSubFolder, optionSubFolder].forEach(sub => {
                const dirPath = path.join(data_store_path, sub);
                if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
            });
        }
    }

module.exports = PreMarketAnalyzer;