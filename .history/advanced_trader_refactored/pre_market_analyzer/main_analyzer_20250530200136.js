// File: /pre_market_analyzer/main_analyzer.js
const fs = require('fs');
const path = require('path');
const moment = require('moment-timezone');

const config = require('./config_analyzer.json');
const DataFetchService = require('./api_helpers/data_fetch_service');
const CsvHandler = require('./data_processing/csv_handler.js');
const SrCalculator = require('./data_processing/sr_calculator.js');
const OptionsSelector = require('./logic/options_selector.js');
const TradeIdentifier = require('./logic/trade_identifier.js');
const UpdatedOptionsGenerator = require('./output/updated_options_generator.js');

// Ensure data_store directories exist
const underlyingCandlesDir = path.join(config.data_store_path, 'underlying_candles_1h');
const optionCandlesDir = path.join(config.data_store_path, 'option_candles_15min');
if (!fs.existsSync(underlyingCandlesDir)) fs.mkdirSync(underlyingCandlesDir, { recursive: true });
if (!fs.existsSync(optionCandlesDir)) fs.mkdirSync(optionCandlesDir, { recursive: true });


async function runAnalyzer() {
    console.log("🚀 Starting Pre-Market Analyzer...");
    // IMPORTANT: Replace with your actual API key and access token mechanism
    const apiService = new DataFetchService("YOUR_API_KEY", "YOUR_ACCESS_TOKEN");
    const optionsSelector = new OptionsSelector(config.options_selection_criteria, apiService);
    const tradeIdentifier = new TradeIdentifier(config.sr_calculation_parameters);

    const allPotentialSetups = [];

    for (const underlying of config.underlyings_to_scan) {
        console.log(`\n🔎 Processing Underlying: ${underlying.symbol}`);

        // 1. Fetch & Store Underlying Historical Data (1-hour)
        const underlyingCsvPath = path.join(underlyingCandlesDir, `${underlying.symbol}_1h.csv`);
        let underlyingCandles = CsvHandler.readCandlesFromCsv(underlyingCsvPath);

        if (underlyingCandles.length === 0) { // Fetch if not found or empty
            const fromDate = moment().subtract(config.underlying_historical_config.duration_days, 'days').format('YYYY-MM-DD');
            const toDate = moment().format('YYYY-MM-DD');
            const histParams = {
                // For indices, your API might need a specific token or symbol format
                tradingsymbol: underlying.symbol, 
                exchange: underlying.stock_exchange_segment || underlying.options_exchange_segment, // Adjust as per API for indices
                interval: config.underlying_historical_config.interval,
                from_date: fromDate,
                to_date: toDate
            };
            underlyingCandles = await apiService.fetchHistoricalCandlesAPI(histParams);
            CsvHandler.saveCandlesToCsv(underlyingCsvPath, underlyingCandles);
        }
        if (underlyingCandles.length === 0) {
            console.warn(`No 1-hour candles for ${underlying.symbol}. Skipping.`);
            continue;
        }
        underlying.candles = underlyingCandles; // Attach for later use

        // 2. Calculate S/R for Underlying
        const underlyingSrLevels = SrCalculator.detectLevels(
            underlyingCandles,
            config.sr_calculation_parameters.sensitivity,
            config.sr_calculation_parameters.strength_threshold
        );
        console.log(`📊 Found ${underlyingSrLevels.length} S/R levels for ${underlying.symbol}`);
        underlying.sr_levels = underlyingSrLevels; // Attach

        // 3. Fetch Options Chain for Underlying
        const optionsChain = await apiService.fetchOptionsChainAPI(underlying.symbol, underlying.options_exchange_segment);
        const selectedOptions = await optionsSelector.selectRelevantOptions(underlying.symbol, underlying.options_exchange_segment, optionsChain);

        for (const optionContract of selectedOptions) {
            optionContract.underlying_symbol = underlying.symbol; // Link back to underlying
            optionContract.options_exchange_segment = underlying.options_exchange_segment; // Carry segment info
            optionContract.underlying_sr_levels_ref = underlyingSrLevels; // For context

            // 4. Fetch & Store Option Historical Data (15-min)
            const optionCsvPath = path.join(optionCandlesDir, `${optionContract.tradingsymbol}_15min.csv`);
            let optionCandles = CsvHandler.readCandlesFromCsv(optionCsvPath);

            if (optionCandles.length === 0) {
                const optFromDate = moment().subtract(config.option_historical_config.duration_days, 'days').format('YYYY-MM-DD');
                const optToDate = moment().format('YYYY-MM-DD');
                const optHistParams = {
                    tradingsymbol: optionContract.tradingsymbol, // or token if API prefers
                    exchange: underlying.options_exchange_segment,
                    interval: config.option_historical_config.interval,
                    from_date: optFromDate,
                    to_date: optToDate
                };
                optionCandles = await apiService.fetchHistoricalCandlesAPI(optHistParams);
                CsvHandler.saveCandlesToCsv(optionCsvPath, optionCandles);
            }
            if (optionCandles.length === 0) {
                console.warn(`No 15-min candles for ${optionContract.tradingsymbol}. Skipping.`);
                continue;
            }
            optionContract.candles = optionCandles; // Attach for analysis

            // 5. Calculate S/R for Option
            const optionSrLevels = SrCalculator.detectLevels(
                optionCandles,
                config.sr_calculation_parameters.sensitivity,
                config.sr_calculation_parameters.strength_threshold
            );
            optionContract.option_sr_levels_ref = optionSrLevels; // Attach

            // 6. Identify Potential Trade Setups based on S/R Confluence
            const setups = tradeIdentifier.identifyPotentialSetups(underlying, underlyingSrLevels, optionContract, optionSrLevels);
            if(setups.length > 0) {
                console.log(`Found ${setups.length} potential setups for ${optionContract.tradingsymbol}`);
                allPotentialSetups.push(...setups);
            }
        }
    }

    // 7. Generate updated_options.json
    UpdatedOptionsGenerator.generateFile(config.output_file_path, allPotentialSetups);

    console.log("🏁 Pre-Market Analysis Complete.");
}

runAnalyzer().catch(console.error);