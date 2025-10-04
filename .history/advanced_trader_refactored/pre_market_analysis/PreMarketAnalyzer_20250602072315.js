// File: /src/pre_market_analysis/PreMarketAnalyzer.js
const fs = require('fs');
const path = require('path');
const moment = require('moment-timezone');
const ApiService = require('./api_service');
const CsvHandler = require('./csv_handler');
const TradeIdentifier = require('./trade_identifier');
const SrCalculator = require('../src/indicators/SupportResistance');

class PreMarketAnalyzer {
    constructor(config, logger, masterController) {
        this.config = config.preMarketAnalysis;
        this.logger = logger;
        this.api = new ApiService(masterController);
        this.api.logger = logger;
        this.tradeIdentifier = new TradeIdentifier(this.config.sr_calculation_parameters.proximity_to_sr_percent);
    }

    async run() {
        this.logger.info("🚀 Starting Pre-Market Analysis...");
        this.setupDataStore();
        const allSetups = [];

        for (const underlying of this.config.underlyings_to_scan) {
            await this.processUnderlying(underlying, allSetups);
        }

        this.generateOutputFile(allSetups);
        this.logger.info("🏁 Pre-Market Analysis Complete.");
    }

    async processUnderlying(underlying, allSetups) {
        this.logger.info(`🔎 Processing Underlying: ${underlying.symbol}`);
        
        underlying.candles = await this.getHistoricalData(underlying.symbol, underlying.underlying_segment, underlying.token, this.config.underlying_historical_config, true);
        
        if (underlying.candles.length === 0) {
            this.logger.warn(`Could not fetch candles for ${underlying.symbol}. Skipping.`);
            return;
        }

        underlying.sr_levels = SrCalculator.detectLevels(underlying.candles, this.config.sr_calculation_parameters.sensitivity_percent, this.config.sr_calculation_parameters.strength_threshold);
        this.logger.info(`📊 Found ${underlying.sr_levels.length} S/R levels for ${underlying.symbol}`);
        
        const ltpRes = await this.api.getCurrentPriceAPI(underlying.symbol, underlying.underlying_segment, underlying.token);
        if (!ltpRes?.ltp) {
            this.logger.warn(`Could not fetch LTP for ${underlying.symbol}. Skipping options search.`);
            return;
        }

        const optionsBaseSymbol = underlying.symbol.replace('-EQ', '');
        const selectedOptions = await this.selectOptions(optionsBaseSymbol, ltpRes.ltp);

        for (const option of selectedOptions) {
            option.candles = await this.getHistoricalData(option.tradingsymbol, 'NFO', option.token, this.config.option_historical_config, false);

            if (option.candles.length > 0) {
                option.sr_levels = SrCalculator.detectLevels(option.candles, this.config.sr_calculation_parameters.sensitivity_percent, this.config.sr_calculation_parameters.strength_threshold);
                const setups = this.tradeIdentifier.identify(underlying, option);
                if (setups.length > 0) {
                    this.logger.info(`✅ Found ${setups.length} potential setup(s) for ${option.tradingsymbol}`);
                    setups.forEach(setup => allSetups.push({ ...option, ...setup, underlying_symbol: underlying.symbol }));
                }
            }
        }
    }

    async getHistoricalData(symbol, exchange, token, histConfig, isUnderlying) {
        const dir = path.join(this.config.data_store_path, isUnderlying ? 'underlying_candles_1h' : 'option_candles_15min');
        const csvPath = path.join(dir, `${symbol}.csv`);
        
        this.logger.info(`Fetching fresh data for ${symbol}...`);

        // *** FIX: Use the safe date range to avoid requesting future data. ***
        const { from_date, to_date } = this.api.getSafeDateRange(histConfig.duration_days);

        const candles = await this.api.fetchHistoricalCandlesAPI({ tradingsymbol: symbol, exchange, symboltoken: token, interval: histConfig.interval, from_date, to_date });
        if (candles.length > 0) CsvHandler.save(csvPath, candles);
        return candles;
    }
    
    async selectOptions(underlyingBaseSymbol, atmPrice) {
        const { strikes_from_atm } = this.config.options_selection_criteria;
        const strikeStep = underlyingBaseSymbol.includes('BANKNIFTY') ? 100 : (underlyingBaseSymbol.includes('NIFTY') ? 50 : 20);
        const atmStrike = Math.round(atmPrice / strikeStep) * strikeStep;
        
        const strikesToFetch = Array.from({length: strikes_from_atm * 2 + 1}, (_, i) => atmStrike + (i - strikes_from_atm) * strikeStep);
        const expiry = this.getTargetExpiry();
        
        return await this.api.fetchOptionsDetailsByStrikes(underlyingBaseSymbol, strikesToFetch, expiry);
    }
    
    generateOutputFile(setups) {
        const filePath = path.join('./logs', this.logger.config.logFiles.updatedStocks);
        const outputList = setups.map(s => ({
            symbol: s.tradingsymbol,
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
        const { data_store_path } = this.config;
        if (!fs.existsSync(data_store_path)) fs.mkdirSync(data_store_path, { recursive: true });
        ['underlying_candles_1h', 'option_candles_15min'].forEach(sub => {
            const dirPath = path.join(data_store_path, sub);
            if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
        });
    }
    
    getTargetExpiry() {
        let today = moment.tz("Asia/Kolkata");
        let expiryDay = 4; // Thursday
        let daysUntilExpiry = (expiryDay - today.day() + 7) % 7;
        if (daysUntilExpiry === 0 && today.hour() > 16) {
            daysUntilExpiry = 7;
        }
        return today.add(daysUntilExpiry, 'days').format('YYYY-MM-DD');
    }
}
module.exports = PreMarketAnalyzer;