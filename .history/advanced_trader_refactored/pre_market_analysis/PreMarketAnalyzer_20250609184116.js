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
    }

    mergeCandleData(existing, newData) {
        const candleMap = new Map();
        existing.forEach(c => candleMap.set(c.timestamp, c));
        newData.forEach(c => candleMap.set(c.timestamp, c));
        return Array.from(candleMap.values()).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    }

     async processUnderlying(underlying) {
        this.logger.info(`🔎 Processing Underlying: ${underlying.symbol}`);
        const { price: atmPrice, candles } = await this.api.getAtmPriceAndCandles(underlying);
        if (!atmPrice || !candles) return [];

        const srLevels = SrCalculator.detectLevels(candles, atmPrice, this.config.sr_calculation_parameters);
        this.logger.info(`📊 Found S/R levels for ${underlying.symbol}: Supports at ${srLevels.supports.map(s=>s.level.toFixed(0)).join(', ')}, Resistances at ${srLevels.resistances.map(r=>r.level.toFixed(0)).join(', ')}`);

        const strikes = this.tradeIdentifier.determineStrikesFromSr(srLevels, underlying.strikeStep);
        if (!strikes.length) return [];
        this.logger.info(`🎯 Scanning focused strikes for ${underlying.symbol}: ${strikes.join(', ')}`);

        // Determine correct expiry (Weekly for Index, Monthly for Stocks)
        const expiryDate = (underlying.instrument_type === 'index') 
            ? this.getTargetExpiry('weekly') 
            : this.getTargetExpiry('monthly');
        this.logger.info(`🎯 Using expiry: ${expiryDate} for ${underlying.symbol}`);

        const potentialOptions = await this.api.fetchOptionsDetailsByStrikes(underlying.symbol, strikes, expiryDate);
        
        this.logger.info(`Found ${potentialOptions.length} option contracts to analyze for ${underlying.symbol}.`);
        
        // Map to a consistent output format for the watchlist file
        return potentialOptions.map(opt => ({
            token: opt.token,
            symbol: opt.symbol,
            underlying: underlying.symbol,
            reason: `Near S/R level`,
            strike: opt.strike,
            type: opt.opttype
        }));
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
            underlying_sr_level: s.uSr,
            option_sr_level: s.oSr,
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