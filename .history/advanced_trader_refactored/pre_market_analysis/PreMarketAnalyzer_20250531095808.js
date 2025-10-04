// File: /src/pre_market_analysis/PreMarketAnalyzer.js
const fs = require('fs');
const path = require('path');
const moment = require('moment-timezone');
const ApiService = require('./api_service');
const CsvHandler = require('./csv_handler');
const TradeIdentifier = require('./trade_identifier');
const SrCalculator = require('../indicators/SupportResistance'); // Re-use existing S/R logic

class PreMarketAnalyzer {
    constructor(config, logger) {
        this.config = config.preMarketAnalysis;
        this.logger = logger;
        this.api = new ApiService("YOUR_API_KEY", "YOUR_ACCESS_TOKEN");
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
        underlying.candles = await this.getHistoricalData(underlying.symbol, this.config.underlying_historical_config, true);
        if (underlying.candles.length === 0) return;

        underlying.sr_levels = SrCalculator.detectLevels(underlying.candles, this.config.sr_calculation_parameters.sensitivity_percent, this.config.sr_calculation_parameters.strength_threshold);
        this.logger.info(`📊 Found ${underlying.sr_levels.length} S/R levels for ${underlying.symbol}`);

        const optionsChain = await this.api.fetchOptionsChainAPI(underlying.symbol);
        const selectedOptions = await this.selectOptions(underlying, optionsChain);

        for (const option of selectedOptions) {
            option.candles = await this.getHistoricalData(option.tradingsymbol, this.config.option_historical_config, false);
            if (option.candles.length === 0) continue;
            
            option.sr_levels = SrCalculator.detectLevels(option.candles, this.config.sr_calculation_parameters.sensitivity_percent, this.config.sr_calculation_parameters.strength_threshold);
            
            const setups = this.tradeIdentifier.identify(underlying, option);
            if (setups.length > 0) {
                this.logger.info(`✅ Found ${setups.length} potential setup(s) for ${option.tradingsymbol}`);
                setups.forEach(setup => allSetups.push({ ...option, ...setup }));
            }
        }
    }

    async getHistoricalData(symbol, histConfig, isUnderlying) {
        const dir = path.join(this.config.data_store_path, isUnderlying ? 'underlying_candles_1h' : 'option_candles_15min');
        const csvPath = path.join(dir, `${symbol}.csv`);
        let candles = CsvHandler.read(csvPath);

        if (candles.length === 0) {
            this.logger.info(`Fetching fresh data for ${symbol}...`);
            const from = moment().subtract(histConfig.duration_days, 'days').format('YYYY-MM-DD');
            const to = moment().format('YYYY-MM-DD');
            candles = await this.api.fetchHistoricalCandlesAPI({ tradingsymbol: symbol, interval: histConfig.interval, from_date: from, to_date: to });
            CsvHandler.save(csvPath, candles);
        }
        return candles;
    }

    async selectOptions(underlying, chain) {
        const ltpRes = await this.api.getCurrentPriceAPI(underlying.symbol);
        if (!ltpRes?.ltp) return [];
        const atm = ltpRes.ltp;
        
        // Simplified selection logic - can be expanded
        const strikes = [...new Set(chain.map(o => o.strike_price))].sort((a,b) => Math.abs(a-atm) - Math.abs(b-atm));
        const selectedStrikes = strikes.slice(0, this.config.options_selection_criteria.strikes_from_atm * 2 + 1);
        
        return chain.filter(o => selectedStrikes.includes(o.strike_price));
    }

    generateOutputFile(setups) {
        const filePath = this.logger.config.logFiles.updatedStocks;
        const outputList = setups.map(s => ({
            symbol: s.tradingsymbol,
            token: s.token,
            exch_seg: s.options_segment || "NFO",
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
        fs.writeFileSync(path.join('./logs', filePath), JSON.stringify(outputList, null, 2));
    }

    setupDataStore() {
        const { data_store_path } = this.config;
        if (!fs.existsSync(data_store_path)) fs.mkdirSync(data_store_path, { recursive: true });
        const subDirs = ['underlying_candles_1h', 'option_candles_15min'];
        subDirs.forEach(sub => {
            const dirPath = path.join(data_store_path, sub);
            if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
        });
    }
}
module.exports = PreMarketAnalyzer;