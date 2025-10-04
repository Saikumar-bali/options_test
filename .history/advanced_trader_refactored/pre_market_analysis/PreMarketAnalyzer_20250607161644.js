// File: /src/pre_market_analysis/PreMarketAnalyzer.js
const fs = require('fs');
const path = require('path');
const moment = require('moment-timezone');
const ApiService = require('./api_service');
const CsvHandler = require('./csv_handler');
const TradeIdentifier = require('./trade_identifier');
const SrCalculator = require('../src/indicators/SupportResistance');

class PreMarketAnalyzer {
    constructor(config, logger, masterController, instrumentManager) {
        this.config = config.preMarketAnalysis;
        this.logger = logger;
        this.api = new ApiService(masterController, instrumentManager, logger);
        this.tradeIdentifier = new TradeIdentifier(this.config.sr_calculation_parameters.proximity_to_sr_percent);
    }

    async run() {
        this.logger.info("🚀 Starting Pre-Market Analysis...");
        const allSetups = [];
        for (const underlying of this.config.underlyings_to_scan) {
            const setupsForUnderlying = await this.processUnderlying(underlying);
            if (setupsForUnderlying.length > 0) allSetups.push(...setupsForUnderlying);
        }
        this.generateOutputFile(allSetups);
        this.logger.info("🏁 Pre-Market Analysis Complete.");
    }

    mergeCandleData(existing, newData) {
        const candleMap = new Map();
        existing.forEach(c => candleMap.set(c.timestamp, c));
        newData.forEach(c => candleMap.set(c.timestamp, c));
        return Array.from(candleMap.values()).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    }

    async processUnderlying(underlying) {
        this.logger.info(`🔎 Processing Underlying: ${underlying.symbol}`);

        // --- INTELLIGENT EXPIRY LOGIC ---
        // Call our new intelligent function to get the correct expiry based on instrument rules
        const expiry = this.findCorrectExpiryForSymbol(underlying.symbol);

        if (!expiry) {
            this.logger.error(`Could not determine expiry for ${underlying.symbol}. Skipping analysis.`);
            return [];
        }
        this.logger.info(`🎯 Found correct target expiry for ${underlying.symbol}: ${expiry}`);
        // --- END OF CHANGE ---

        const { price: atm, candles: underlyingCandles } = await this.api.getAtmAndCandles(underlying);
        if (!atm || !underlyingCandles) {
            this.logger.error(`Could not get ATM or candles for ${underlying.symbol}. Skipping.`);
            return [];
        }
        this.logger.info(`[ATM] Derived ATM price for ${underlying.symbol} as ${atm}.`);

        const srLevels = SupportResistance.detectLevels(underlyingCandles, atm, this.config.sr_calculation_parameters);
        this.logger.info(`📊 Found ${srLevels.supports.length} significant Support and ${srLevels.resistances.length} Resistance zones for ${underlying.symbol}.`);
        srLevels.supports.forEach(s => this.logger.info(`   - Support at ${s.level.toFixed(2)} (Reaction: ${s.reaction.toFixed(2)})`));
        srLevels.resistances.forEach(r => this.logger.info(`   - Resistance at ${r.level.toFixed(2)} (Reaction: ${r.reaction.toFixed(2)})`));

        const strikesToScan = this.tradeIdentifier.determineStrikesFromSr(atm, srLevels, 50);
        const optionsToAnalyze = await this.api.fetchOptionsDetailsByStrikes(underlying.symbol, strikesToScan, expiry);
        this.logger.info(`Found ${optionsToAnalyze.length} option contracts to analyze for ${underlying.symbol}.`);

        const setups = [];
        // Further logic to analyze these options would go here...
        // For now, returning the identified options.
        return optionsToAnalyze;
    }
    findCorrectExpiryForSymbol(underlyingSymbol) {
        const baseSymbol = underlyingSymbol.replace('-EQ', '');
        const today = moment.tz("Asia/Kolkata").startOf('day');

        const allExpiries = this.instrumentManager.getExpiriesForUnderlying(baseSymbol);

        const futureExpiries = allExpiries
            .map(e => moment(e, 'DDMMMYYYY'))
            .filter(m => m.isValid() && m.isSameOrAfter(today))
            .sort((a, b) => a - b);

        if (futureExpiries.length === 0) {
            this.logger.error(`No future expiries found for ${baseSymbol}`);
            return null;
        }

        let targetExpiry;

        // NIFTY and some other indices might have weekly expiries.
        if (baseSymbol === 'NIFTY') {
            targetExpiry = futureExpiries[0]; // Rule: Take the absolute nearest expiry.
        } else { // BANKNIFTY and Stocks
            // Rule: Find the last Thursday of the current month.
            let lastThursday = moment(today).endOf('month');
            // Moment's day() is 0 for Sunday, 4 for Thursday.
            // If the last day of the month is after Thursday, find the preceding Thursday.
            if (lastThursday.day() < 4) {
                lastThursday.day(4 - 7); // Previous week's Thursday
            } else {
                lastThursday.day(4); // This week's Thursday
            }

            // If that Thursday has already passed this month, get the last Thursday of the *next* month.
            if (lastThursday.isBefore(today)) {
                lastThursday = moment(today).add(1, 'month').endOf('month');
                if (lastThursday.day() < 4) {
                    lastThursday.day(4 - 7);
                } else {
                    lastThursday.day(4);
                }
            }

            targetExpiry = futureExpiries.find(d => d.isSame(lastThursday, 'day'));

            // Fallback: If a standard monthly expiry isn't found (e.g., for stocks with weekly options),
            // default to the nearest available expiry.
            if (!targetExpiry) {
                this.logger.warn(`Could not find a standard monthly expiry for ${baseSymbol}. It may have weekly expiries. Falling back to its nearest available expiry.`);
                targetExpiry = futureExpiries[0];
            }
        }

        return targetExpiry ? targetExpiry.format('DDMMMYYYY').toUpperCase() : null;
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

    async selectOptions(underlyingBaseSymbol, atmPrice) {
        const { strikes_from_atm } = this.config.options_selection_criteria;
        const strikeStep = underlyingBaseSymbol.includes('BANKNIFTY') ? 100 : (underlyingBaseSymbol.includes('NIFTY') ? 50 : 20);
        const atmStrike = Math.round(atmPrice / strikeStep) * strikeStep;
        const strikesToFetch = Array.from({ length: strikes_from_atm * 2 + 1 }, (_, i) => atmStrike + (i - strikes_from_atm) * strikeStep);
        const expiry = this.getTargetExpiry();
        return await this.api.fetchOptionsDetailsByStrikes(underlyingBaseSymbol, strikesToFetch, expiry);
    }

    generateOutputFile(setups) {
        const filePath = path.join('./logs', this.logger.config.logFiles.updatedStocks);
        const outputList = setups.map(s => ({
            symbol: s.symbol, token: s.token, exch_seg: s.exch_seg, lotsize: s.lotsize, option_type: s.instrument_type, expiry: s.expiry_date, strike: s.strike_price, underlying: s.underlying_symbol, underlying_sr_level: s.uSr, option_sr_level: s.oSr, trade_setup_reason: s.reason, recommended_direction: s.direction
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

    /**
     * Finds the correct upcoming weekly expiry date.
     * If it's past Thursday's market close, it finds the *next* Thursday.
     */
    getTargetExpiry() {
        let today = moment.tz("Asia/Kolkata");
        let expiryDay = 4; // Thursday
        if (today.day() > expiryDay || (today.day() === expiryDay && today.hour() >= 16)) {
            const daysToAdd = ((expiryDay + 7) - today.day()) % 7;
            return today.add(daysToAdd === 0 ? 7 : daysToAdd, 'days').format('YYYY-MM-DD');
        } else {
            const daysUntilExpiry = (expiryDay - today.day() + 7) % 7;
            return today.add(daysUntilExpiry, 'days').format('YYYY-MM-DD');
        }
    }
}

module.exports = PreMarketAnalyzer;





