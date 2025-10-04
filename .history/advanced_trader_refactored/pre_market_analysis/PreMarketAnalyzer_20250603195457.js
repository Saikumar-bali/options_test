// File: /src/pre_market_analysis/PreMarketAnalyzer.js
const fs = require('fs');
const path = require('path');
const moment = require('moment-timezone');
const ApiService = require('./api_service');
const CsvHandler = require('./csv_handler');
const TradeIdentifier = require('./trade_identifier');
const SrCalculator = require('../indicators/SupportResistance'); // Ensure this path is correct

class PreMarketAnalyzer {
    constructor(config, logger, masterController, instrumentManager) {
        this.config = config.preMarketAnalysis;
        this.logger = logger;
        // Ensure instrumentManager is passed to ApiService if ApiService's constructor expects it.
        // The ApiService from Turn 13 expects masterController, instrumentManager, logger.
        this.api = new ApiService(masterController, instrumentManager, logger); 
        this.tradeIdentifier = new TradeIdentifier(this.config.sr_calculation_parameters.proximity_to_sr_percent);
    }

    async run() {
        this.logger.info("🚀 Starting Pre-Market Analysis...");
        this.setupDataStore(); 
        const allSetups = [];

        for (const underlying of this.config.underlyings_to_scan) {
            // Fetch instrument details (including token) first using InstrumentManager via ApiService
            const instrumentDetails = this.api.instrumentManager.getInstrumentDetails(underlying.symbol, underlying.underlying_segment);
            if (!instrumentDetails || (!instrumentDetails.token && !instrumentDetails.symboltoken)) {
                this.logger.warn(`[PreMarketRun] Could not get instrument details or token for ${underlying.symbol} from Scrip Master. Skipping.`);
                continue;
            }
            // Add/update token in the underlying object from strategy_config
            underlying.token = instrumentDetails.token || instrumentDetails.symboltoken;
            
            await this.processUnderlying(underlying, allSetups);
        }

        this.generateOutputFile(allSetups);
        this.logger.info("🏁 Pre-Market Analysis Complete.");
    }

    async processUnderlying(underlying, allSetups) {
        this.logger.info(`🔎 Processing Underlying: ${underlying.symbol}`);

        // 1. Get the ATM price (derived from recent daily candles via ApiService)
        // <mark style="background-color: red; color: white;">
        // This is where the call should be to getCurrentPriceAPI, not getAtmPriceAndCandles
        // </mark>
        const atmPriceData = await this.api.getCurrentPriceAPI(underlying.symbol, underlying.underlying_segment, underlying.token);
        
        if (!atmPriceData || atmPriceData.ltp === null) {
            this.logger.warn(`[PreMarket] Could not derive ATM price for ${underlying.symbol}. Skipping.`);
            return; // Skip this underlying if ATM price can't be found
        }
        underlying.atmPrice = atmPriceData.ltp;
        this.logger.info(`[PreMarket] [ATM] Derived ATM price for ${underlying.symbol} as ${underlying.atmPrice}.`);

        // 2. Fetch candles for S/R calculation using the CONFIGURED interval (e.g., "60minute")
        const srInterval = this.config.underlying_historical_config.interval;
        const srDuration = this.config.underlying_historical_config.duration_days;
        const { from_date: sr_from_date, to_date: sr_to_date } = this.api.getSafeDateRange(srDuration);

        this.logger.info(`[PreMarket] Fetching ${srInterval} candles for S/R analysis for ${underlying.symbol}...`);
        const srCandleParams = {
            tradingsymbol: underlying.symbol,
            exchange: underlying.underlying_segment,
            symboltoken: underlying.token,
            interval: srInterval, // e.g., "60minute"
            from_date: sr_from_date,
            to_date: sr_to_date
        };
        underlying.candles = await this.api.fetchHistoricalCandlesAPI(srCandleParams);

        if (!underlying.candles || underlying.candles.length === 0) {
            // Logging for failure to fetch S/R candles is now more detailed in ApiService.fetchHistoricalCandlesAPI
            this.logger.warn(`[PreMarket] No S/R candles (${srInterval}) found for ${underlying.symbol}. Skipping S/R and option analysis.`);
            return; // Skip if no S/R candles
        }
        this.saveCandlesToCsv(underlying.symbol, srInterval, underlying.candles, false);


        // 3. Calculate S/R levels on these (e.g., 60-minute) candles
        underlying.sr_levels = SrCalculator.detectLevels(
            underlying.candles,
            this.config.sr_calculation_parameters.grouping_sensitivity_factor * underlying.atmPrice,
            this.config.sr_calculation_parameters.min_strength
        );
        this.logger.info(`[PreMarket] 📊 Found ${underlying.sr_levels.length} S/R levels for ${underlying.symbol} from ${srInterval} data.`);

        if (underlying.sr_levels.length === 0) {
            this.logger.warn(`[PreMarket] No S/R levels identified for ${underlying.symbol} with ${srInterval} candles. Skipping option analysis for this underlying.`);
            return; // Skip if no S/R levels
        }

        // 4. Select relevant option strikes
        const selectedOptionStrikes = this.selectStrikes(underlying.instrument_type, underlying.atmPrice);
        const targetExpiry = this.getTargetExpiry(underlying.instrument_type, underlying.symbol);
        
        this.logger.info(`[PreMarket] Analyzing options for ${underlying.symbol} around ATM ${underlying.atmPrice}, Expiry: ${targetExpiry}, Strikes: ${selectedOptionStrikes.join(', ')}`);
        const optionsToAnalyze = await this.api.fetchOptionsDetailsByStrikes(underlying.symbol, selectedOptionStrikes, targetExpiry);

        if (!optionsToAnalyze || optionsToAnalyze.length === 0) {
            this.logger.warn(`[PreMarket] No option contracts found in Scrip Master for ${underlying.symbol} with given criteria. Searched ${selectedOptionStrikes.length} strikes for expiry ${targetExpiry}.`);
            return;
        }
        this.logger.info(`[PreMarket] Found ${optionsToAnalyze.length} option contracts to analyze for ${underlying.symbol}.`);


        // 5. Process each selected option
        for (const option of optionsToAnalyze) {
            if (!option.token) {
                this.logger.warn(`[PreMarket] Option ${option.symbol || 'Unknown Symbol'} missing token. Skipping candle fetch.`);
                continue;
            }
            option.candles = await this.getHistoricalDataForOptions(option.symbol, option.exch_seg, option.token, option.expiry_date);
            
            if (!option.candles || option.candles.length === 0) {
                // Logging for failure to fetch option candles is in ApiService.fetchHistoricalCandlesAPI
                this.logger.warn(`[PreMarket] No 15-min candles found for option ${option.symbol}. Skipping S/R for this option.`);
                continue;
            }
            
            const optionAtm = option.candles[option.candles.length - 1].close;
            option.sr_levels = SrCalculator.detectLevels(
                option.candles,
                this.config.sr_calculation_parameters.grouping_sensitivity_factor * optionAtm,
                this.config.sr_calculation_parameters.min_strength
            );

            const setupsFound = this.tradeIdentifier.identify(underlying, option);
            if (setupsFound.length > 0) {
                setupsFound.forEach(setup => {
                    allSetups.push({
                        ...option, // Includes token, symbol, exch_seg, lotsize, expiry_date, strike_price, instrument_type
                        underlying_symbol: underlying.symbol,
                        uSr: setup.uSr, oSr: setup.oSr,
                        reason: setup.reason, direction: setup.direction
                    });
                });
            }
        }
    }

    async getHistoricalDataForOptions(optionSymbol, exchange, token, expiry) {
        const { duration_days, interval } = this.config.option_historical_config; // "15minute"
        const { from_date, to_date } = this.api.getSafeDateRange(duration_days);
        const params = {
            tradingsymbol: optionSymbol, exchange: exchange,
            symboltoken: token, interval: interval,
            from_date: from_date, to_date: to_date
        };
        const candles = await this.api.fetchHistoricalCandlesAPI(params);
        if (candles && candles.length > 0) {
            this.saveCandlesToCsv(optionSymbol, interval, candles, true);
        } else {
            this.logger.warn(`[PreMarket] No candles returned by fetchHistoricalCandlesAPI for option ${optionSymbol}`);
        }
        return candles;
    }

    saveCandlesToCsv(symbol, interval, candles, isOption) {
        if (!this.config.save_candles_to_csv || !candles || candles.length === 0) {
            // this.logger.debug(`[CSV] Skipping save for ${symbol}. Save enabled: ${this.config.save_candles_to_csv}, Candles count: ${candles?.length}`);
            return;
        }
        
        let subFolder;
        let actualIntervalName = interval;

        if (isOption) {
            subFolder = (actualIntervalName === "15minute") ? 'option_candles_15min' : `option_candles_${actualIntervalName.replace('minute', 'min')}`;
        } else {
            subFolder = (actualIntervalName === "60minute") ? 'underlying_candles_1h' :
                        (actualIntervalName === "ONE_DAY") ? 'underlying_candles_1d' :
                        `underlying_candles_${actualIntervalName.replace('minute', 'min')}`;
        }
        const sanitizedSymbol = symbol.replace(/[^a-zA-Z0-9-]/g, '_');
        const fileName = `${sanitizedSymbol}.csv`;
        
        // Ensure data_store_path is defined and used correctly
        if (!this.config.data_store_path) {
            this.logger.error("[CSV] data_store_path is not configured. Cannot save candles.");
            return;
        }
        const filePath = path.join(this.config.data_store_path, subFolder, fileName);

        try {
            CsvHandler.save(filePath, candles); // CsvHandler should create directories if needed.
            this.logger.info(`[CSV] Saved ${actualIntervalName} candles for ${symbol} to ${filePath}`);
        } catch (error) {
            this.logger.error(`[CSV] Failed to save candles for ${symbol} to ${filePath}: ${error.message}`);
        }
    }

    selectStrikes(instrumentType, atmPrice) {
        const strikeConfig = this.config.options_selection_criteria.strike_steps || {};
        let strikeStep;

        if (instrumentType === 'index') {
            strikeStep = atmPrice > 50000 ? (strikeConfig.BANKNIFTY_HIGH_ATM || 100) : (strikeConfig.NIFTY_DEFAULT || 50);
        } else if (instrumentType === 'stock') {
            strikeStep = atmPrice > 1000 ? (strikeConfig.STOCK_HIGH_ATM || 20) :
                         atmPrice > 500  ? (strikeConfig.STOCK_MID_ATM || 10) :
                                           (strikeConfig.STOCK_LOW_ATM || 5);
        } else {
            this.logger.warn(`[PreMarket] Unknown instrument type "${instrumentType}" for strike step calculation. Defaulting to 50.`);
            strikeStep = 50;
        }
        
        const atmStrike = Math.round(atmPrice / strikeStep) * strikeStep;
        const strikes = [];
        const otmLevels = this.config.options_selection_criteria.strike_range_OTM_levels;
        for (let i = -otmLevels; i <= otmLevels; i++) {
            strikes.push(atmStrike + (i * strikeStep));
        }
        return strikes.filter(s => s > 0);
    }

    getTargetExpiry(instrumentType, symbol) {
        let today = moment.tz("Asia/Kolkata");
        let expiryDay;

        const specificExpiries = this.config.options_selection_criteria.specific_expiry_days || {}; // e.g., { "NIFTY": 4, "BANKNIFTY": 3 }
        expiryDay = specificExpiries[symbol];

        let useWeekly = this.config.options_selection_criteria.expiry_type === 'weekly';

        if (instrumentType === 'stock') {
            useWeekly = false; // Stocks generally use monthly expiries for this type of analysis
            expiryDay = expiryDay === undefined ? 4 : expiryDay; // Default to Thursday for stocks if not specified
        } else if (instrumentType === 'index' && expiryDay === undefined) {
            expiryDay = 4; // Default Thursday for other indices
        }
        
        let nextExpiry = today.clone();
        if (useWeekly && instrumentType === 'index') {
            if (today.day() === expiryDay && today.hour() < 15) { // If today is expiry day and market might still be open or just closed
                // Use today as expiry if it's the expiry day and not too late
            } else {
                 nextExpiry.day(expiryDay); 
                 if (nextExpiry.isSameOrBefore(today, 'day')) { 
                    nextExpiry.add(1, 'week').day(expiryDay); // Move to next week's expiry day
                 }
            }
        } else { // Monthly expiry
            nextExpiry.endOf('month');
            while (nextExpiry.day() !== expiryDay) { // Find the last specified day of the month
                nextExpiry.subtract(1, 'day');
            }
            // If this month's last expiry day is already past or too close (e.g., less than 3-4 days away for meaningful data)
            if (nextExpiry.isSameOrBefore(today, 'day') || today.diff(nextExpiry,'days') > -4 ) { 
                nextExpiry = today.clone().add(1, 'month').endOf('month');
                while (nextExpiry.day() !== expiryDay) {
                    nextExpiry.subtract(1, 'day');
                }
            }
        }
        return nextExpiry.format('YYYY-MM-DD');
    }
    
    generateOutputFile(setups) {
        const filePath = path.join('./logs', this.logger.config.logFiles.updatedStocks); // Path relative to project root
        const outputList = setups.map(s => ({
            symbol: s.symbol || s.tradingsymbol, 
            token: s.token, 
            exch_seg: s.exch_seg, 
            lotsize: s.lotsize, 
            option_type: s.instrument_type, 
            expiry: s.expiry_date, 
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
        const { data_store_path, save_candles_to_csv } = this.config;
        if (!save_candles_to_csv || !data_store_path) {
            this.logger.info("[CSV] Candle saving is disabled or data_store_path is not defined. Skipping data store setup.");
            return;
        }
        
        if (!fs.existsSync(data_store_path)) {
            fs.mkdirSync(data_store_path, { recursive: true });
            this.logger.info(`Created base data store directory: ${data_store_path}`);
        }
        
        const underlyingInterval = this.config.underlying_historical_config.interval;
        const optionInterval = this.config.option_historical_config.interval;

        let underlyingSubFolder = (underlyingInterval === "60minute") ? 'underlying_candles_1h' : 
                                  (underlyingInterval === "ONE_DAY") ? 'underlying_candles_1d' :
                                  `underlying_candles_${underlyingInterval.replace('minute','min')}`;
        let optionSubFolder = (optionInterval === "15minute") ? 'option_candles_15min' : 
                              `option_candles_${optionInterval.replace('minute','min')}`;

        [underlyingSubFolder, optionSubFolder].forEach(sub => {
            if (sub) { 
                const dirPath = path.join(data_store_path, sub);
                if (!fs.existsSync(dirPath)) {
                    fs.mkdirSync(dirPath, { recursive: true });
                    this.logger.info(`Created data sub-directory: ${dirPath}`);
                }
            }
        });
    }
}

module.exports = PreMarketAnalyzer;