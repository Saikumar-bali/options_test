// File: /src/pre_market_analysis/PreMarketAnalyzer.js
const fs = require('fs');
const path = require('path');
const moment = require('moment-timezone');
const ApiService = require('./api_service');
const CsvHandler = require('./csv_handler');
const TradeIdentifier = require('./trade_identifier');
const SrCalculator = require('../src/indicators/SupportResistance'); // Adjust path if needed

class PreMarketAnalyzer {
    constructor(config, logger, masterController, instrumentManager) {
        this.config = config.preMarketAnalysis;
        this.logger = logger;
        this.instrumentManager = instrumentManager;
        this.api = new ApiService(masterController, this.instrumentManager, this.logger);
        this.tradeIdentifier = new TradeIdentifier(this.config.trade_identification_parameters.proximity_to_sr_percent);
    }

    async run() {
        this.logger.info("🚀 Starting Pre-Market Analysis (Options Only)...");
        let allSetups = [];
        for (const underlying of this.config.underlyings_to_scan) {
            const setups = await this.processUnderlying(underlying);
            allSetups = allSetups.concat(setups);
        }
        this.generateOutputFile(allSetups);
        this.logger.info("🏁 Pre-Market Analysis Complete.");
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

    generateOutputFile(setups) {
        const filePath = path.join('./logs', this.config.logFiles.updatedStocks);
        fs.writeFileSync(filePath, JSON.stringify(setups, null, 2));
        this.logger.info(`📝 Wrote ${setups.length} potential setups to ${filePath}`);
    }

    getTargetExpiry(type) {
        let today = moment.tz("Asia/Kolkata");
        if (type === 'weekly') {
            let expiryDay = 4; // Thursday
            let daysUntilExpiry = (expiryDay - today.day() + 7) % 7;
            if (daysUntilExpiry === 0 && today.hour() >= 16) daysUntilExpiry = 7;
            return today.add(daysUntilExpiry, 'days').format('YYYY-MM-DD');
        } else { // monthly
            let expiry = today.clone().endOf('month');
            while (expiry.day() !== 4) expiry.subtract(1, 'day');
            if (today.isAfter(expiry)) {
                expiry = today.clone().add(1, 'month').endOf('month');
                while (expiry.day() !== 4) expiry.subtract(1, 'day');
            }
            return expiry.format('YYYY-MM-DD');
        }
    }
}
module.exports = PreMarketAnalyzer;