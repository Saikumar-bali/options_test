// File: /src/pre_market_analysis/PreMarketAnalyzer.js
const fs = require('fs');
const path = require('path');
const moment = require('moment-timezone');
const ApiService = require('./api_service'); // Assuming api_service.js is in the same directory
const CsvHandler = require('./csv_handler'); // Assuming csv_handler.js is in the same directory
const TradeIdentifier = require('./trade_identifier'); // Assuming trade_identifier.js is in the same directory
const SrCalculator = require('../src/indicators/SupportResistance'); // Path adjusted as per your structure

class PreMarketAnalyzer {
    constructor(config, logger, masterController, instrumentManager) {
        this.config = config.preMarketAnalysis; // This holds preMarketAnalysis settings from strategy_config.json
        this.logger = logger;
        this.api = new ApiService(masterController, instrumentManager, logger);
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
        
        // 1. Get the ATM price and the candles for S/R calculation using the CONFIGURED interval
        // <mark style="background-color: red; color: white;">
        // This method call was the source of using daily candles; it's now corrected below.
        // </mark>
        const { price: atmPrice, candles: srCandles } = await this.getAtmPriceAndCandlesForSr(underlying);
        
        if (atmPrice === null || !srCandles || srCandles.length === 0) {
            this.logger.warn(`Could not derive ATM price or fetch S/R candles for ${underlying.symbol} with interval ${this.config.underlying_historical_config.interval}. Skipping.`);
            return;
        }
        underlying.atmPrice = atmPrice;
        underlying.candles = srCandles; // These are now 60-minute (or configured) candles

        // 2. Calculate S/R levels on these (now 60-minute) candles
        underlying.sr_levels = SrCalculator.detectLevels(
            underlying.candles,
            this.config.sr_calculation_parameters.grouping_sensitivity_factor * underlying.atmPrice,
            this.config.sr_calculation_parameters.min_strength
        );
        // Updated log message to reflect actual data interval used for S/R
        this.logger.info(`📊 Found ${underlying.sr_levels.length} S/R levels for ${underlying.symbol} from recent ${this.config.underlying_historical_config.interval} data.`);

        if (underlying.sr_levels.length === 0) {
            this.logger.warn(`No S/R levels found for ${underlying.symbol} with ${this.config.underlying_historical_config.interval} candles. Skipping option analysis for this underlying.`);
            return;
        }

        // 3. Select relevant option strikes based on ATM price
        const selectedOptionStrikes = this.selectStrikes(underlying.instrument_type, underlying.atmPrice);

        // 4. Fetch details for these option strikes
        const targetExpiry = this.getTargetExpiry(underlying.instrument_type, underlying.symbol);
        const optionsToAnalyze = await this.api.fetchOptionsDetailsByStrikes(underlying.symbol, selectedOptionStrikes, targetExpiry);

        // 5. Process each selected option
        for (const option of optionsToAnalyze) {
            option.candles = await this.getHistoricalDataForOptions(option.symbol, option.exch_seg, option.token, option.expiry_date);
            if (!option.candles || option.candles.length === 0) {
                this.logger.warn(`Could not fetch 15-min candles for option ${option.symbol}. Skipping.`);
                continue;
            }
            
            const optionAtm = option.candles[option.candles.length - 1].close; // Use option's last close for its S/R sensitivity
            option.sr_levels = SrCalculator.detectLevels(
                option.candles, 
                this.config.sr_calculation_parameters.grouping_sensitivity_factor * optionAtm, 
                this.config.sr_calculation_parameters.min_strength
            );

            // Add to allSetups if trade conditions are met (as per TradeIdentifier)
            const setupsFound = this.tradeIdentifier.identify(underlying, option); //
            if (setupsFound.length > 0) {
                 setupsFound.forEach(setup => {
                    allSetups.push({
                        ...option, // Includes token, symbol, exch_seg, lotsize, expiry_date, strike_price, instrument_type
                        underlying_symbol: underlying.symbol,
                        uSr: setup.uSr,
                        oSr: setup.oSr,
                        reason: setup.reason,
                        direction: setup.direction
                    });
                });
            }
        }
    }
    
    // <mark style="background-color: red; color: white;">
    // CORRECTED: This method now uses the configured interval for underlyings
    // </mark>
    async getAtmPriceAndCandlesForSr(underlying) {
        const underlyingInterval = this.config.underlying_historical_config.interval; // e.g., "60minute"
        const underlyingDuration = this.config.underlying_historical_config.duration_days;

        this.logger.info(`Attempting to derive ATM price for ${underlying.symbol} via recent ${underlyingInterval} candles...`);
        const { from_date, to_date } = this.api.getSafeDateRange(underlyingDuration);

        const params = {
            tradingsymbol: underlying.symbol,
            exchange: underlying.underlying_segment,
            symboltoken: underlying.token,
            // <mark style="background-color: red; color: white;">
            // Use configured interval for underlyings
            // </mark>
            interval: underlyingInterval, 
            from_date: from_date,
            to_date: to_date
        };

        const candles = await this.api.fetchHistoricalCandlesAPI(params);

        if (candles && candles.length > 0) {
            const lastClose = candles[candles.length - 1].close;
            this.logger.info(`[LTP] Derived ATM price for ${underlying.symbol} as ${lastClose} using ${underlyingInterval} data.`);
            // <mark style="background-color: red; color: white;">
            // Save these candles (now using the configured interval)
            // </mark>
            this.saveCandlesToCsv(underlying.symbol, underlyingInterval, candles, false); 
            return { price: lastClose, candles: candles };
        }
        this.logger.warn(`Could not fetch ${underlyingInterval} candles for ATM/SR for ${underlying.symbol}`);
        return { price: null, candles: null };
    }

    async getHistoricalDataForOptions(optionSymbol, exchange, token, expiry) {
        const { duration_days, interval } = this.config.option_historical_config; // Uses "15minute"
        const { from_date, to_date } = this.api.getSafeDateRange(duration_days);

        const params = {
            tradingsymbol: optionSymbol,
            exchange: exchange, // Should be NFO for options
            symboltoken: token,
            interval: interval, // "15minute"
            from_date: from_date,
            to_date: to_date
        };

        const candles = await this.api.fetchHistoricalCandlesAPI(params);
        if (candles && candles.length > 0) {
            this.saveCandlesToCsv(optionSymbol, interval, candles, true); // Save 15-min option candles
        }
        return candles;
    }
    
    // <mark style="background-color: red; color: white;">
    // ADJUSTED SUBFOLDER NAMING FOR CONSISTENCY
    // </mark>
    saveCandlesToCsv(symbol, interval, candles, isOption) {
        if (!this.config.save_candles_to_csv || !candles || candles.length === 0) return;

        let subFolder;
        let actualIntervalName = interval; // e.g., "60minute", "15minute"

        // Standardize folder names based on common representations
        if (isOption) {
            if (actualIntervalName === "15minute") subFolder = 'option_candles_15min';
            else subFolder = `option_candles_${actualIntervalName.replace('minute','min')}`;
        } else {
            if (actualIntervalName === "60minute") subFolder = 'underlying_candles_1h';
            else subFolder = `underlying_candles_${actualIntervalName.replace('minute','min')}`;
        }
        
        const sanitizedSymbol = symbol.replace(/[^a-zA-Z0-9-]/g, '_'); // Allow hyphens for -EQ
        const fileName = `${sanitizedSymbol}.csv`;
        const filePath = path.join(this.config.data_store_path, subFolder, fileName);

        try {
            CsvHandler.save(filePath, candles);
            this.logger.info(`[CSV] Saved ${actualIntervalName} candles for ${symbol} to ${filePath}`);
        } catch (error) {
            this.logger.error(`[CSV] Failed to save candles for ${symbol} to ${filePath}: ${error.message}`);
        }
    }

    selectStrikes(instrumentType, atmPrice) {
        const strikeStep = (instrumentType === 'index' && atmPrice > 20000) ? (atmPrice > 50000 ? 100 : 50) : 
                           (instrumentType === 'stock' && atmPrice > 1000 ? 20 : (atmPrice > 500 ? 10 : 5)); // Basic step logic
        
        const atmStrike = Math.round(atmPrice / strikeStep) * strikeStep;
        const strikes = [];
        for (let i = -this.config.options_selection_criteria.strike_range_OTM_levels; i <= this.config.options_selection_criteria.strike_range_OTM_levels; i++) {
            strikes.push(atmStrike + (i * strikeStep));
        }
        return strikes.filter(s => s > 0); // Ensure positive strikes
    }

    getTargetExpiry(instrumentType, symbol) {
        let today = moment.tz("Asia/Kolkata");
        let expiryDay; // 0 = Sunday, ..., 4 = Thursday

        // For major indices, specific weekly expiry days
        if (symbol === 'NIFTY') expiryDay = 4; // Thursday
        else if (symbol === 'BANKNIFTY') expiryDay = 3; // Wednesday
        else if (symbol === 'FINNIFTY') expiryDay = 2; // Tuesday
        // Add more specific index rules if needed

        // Determine if 'weekly' or 'monthly' based on config, but override for stocks if needed
        let useWeekly = this.config.options_selection_criteria.expiry_type === 'weekly';
        if (instrumentType === 'stock') {
            useWeekly = false; // Stocks usually have monthly expiries more liquid for this kind of analysis
            expiryDay = 4; // Last Thursday of the month for stocks typically
        } else if (!expiryDay) { // Default for other indices if not specified above
            expiryDay = 4; // Thursday for other indices
        }

        if (useWeekly && instrumentType === 'index') {
            // Find next occurrence of expiryDay (e.g., next Thursday)
            let nextExpiry = today.clone();
            while (nextExpiry.day() !== expiryDay || nextExpiry.isSameOrBefore(today, 'day')) {
                nextExpiry.add(1, 'day');
            }
             // If today is expiry day and market hasn't passed a certain time (e.g. 3 PM), use today.
            if (today.day() === expiryDay && today.hour() < 15) {
                nextExpiry = today;
            } else { // Find next week's expiry day
                 nextExpiry = today.clone().day(expiryDay); // Go to this week's expiry day
                 if (nextExpiry.isSameOrBefore(moment.tz("Asia/Kolkata"), 'day')) { // If it's past or today
                    nextExpiry.add(1, 'week'); // Go to next week's expiry day
                 }
            }
            return nextExpiry.format('YYYY-MM-DD');
        } else {
            // Monthly expiry: Last Thursday of the current or next month
            let expiryMonth = today.clone().endOf('month');
            while (expiryMonth.day() !== 4) { // Find last Thursday
                expiryMonth.subtract(1, 'day');
            }
            if (expiryMonth.isSameOrBefore(today, 'day') && today.diff(expiryMonth, 'days') > -3) { // If last Thursday is past or too close
                expiryMonth = today.clone().add(1, 'month').endOf('month');
                while (expiryMonth.day() !== 4) {
                    expiryMonth.subtract(1, 'day');
                }
            }
            return expiryMonth.format('YYYY-MM-DD');
        }
    }
    
    generateOutputFile(setups) {
        const filePath = path.join('./logs', this.logger.config.logFiles.updatedStocks); // Path relative to project root
        const outputList = setups.map(s => ({
            symbol: s.symbol || s.tradingsymbol, // Ensure symbol is present
            token: s.token, 
            exch_seg: s.exch_seg, 
            lotsize: s.lotsize, 
            option_type: s.instrument_type, 
            expiry: s.expiry_date, 
            // Ensure strike_price from option object, or strike from setup object if different
            strike: s.strike_price !== undefined ? s.strike_price : s.strike, 
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
        const { data_store_path } = this.config; // This is from preMarketAnalysis config block
        if (!data_store_path) {
            this.logger.error("data_store_path is not defined in preMarketAnalysis configuration. Cannot setup data store.");
            return;
        }
        // Create base data_store path if it doesn't exist
        if (!fs.existsSync(data_store_path)) {
            fs.mkdirSync(data_store_path, { recursive: true });
            this.logger.info(`Created base data store directory: ${data_store_path}`);
        }
        
        // Create subfolders based on configured intervals
        const underlyingInterval = this.config.underlying_historical_config.interval;
        const optionInterval = this.config.option_historical_config.interval;

        let underlyingSubFolder = underlyingInterval === "60minute" ? 'underlying_candles_1h' : `underlying_candles_${underlyingInterval.replace('minute','min')}`;
        let optionSubFolder = optionInterval === "15minute" ? 'option_candles_15min' : `option_candles_${optionInterval.replace('minute','min')}`;

        [underlyingSubFolder, optionSubFolder].forEach(sub => {
            const dirPath = path.join(data_store_path, sub);
            if (!fs.existsSync(dirPath)) {
                fs.mkdirSync(dirPath, { recursive: true });
                this.logger.info(`Created data sub-directory: ${dirPath}`);
            }
        });
    }
}

module.exports = PreMarketAnalyzer;