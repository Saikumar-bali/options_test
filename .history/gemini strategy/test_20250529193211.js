// File: /d/master controllers/options/test.js (with Auto-Expiry & OTM Selection)
// Description: Fetches and filters OTM options data, automatically finding the nearest expiry,
//              and saves it to strategy2/updated.json, using MasterController.

require("dotenv").config({ path: require('path').join(__dirname, '../strategy2/.env') });
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const moment = require('moment-timezone');
const MasterController = require('../universal websocket/index.js');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// --- Configuration ---
const SCRIP_MASTER_URL = 'https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json';
const UPDATED_JSON_PATH = path.resolve(__dirname, '..', 'strategy2', 'updated.json');
const STOCKS_TO_TRACK = [
    'RELIANCE', 'TCS', 'INFY', 'HDFCBANK', 'ICICIBANK', 'LT',
    'HINDUNILVR', 'KOTAKBANK', 'SBIN', 'AXISBANK', 'BAJFINANCE', 'ITC'
];
const INDEX_CONFIG = {
    NIFTY: { token: '99926000', name: 'NIFTY', exch_seg: 'NSE' },
    BANKNIFTY: { token: '99926009', name: 'BANKNIFTY', exch_seg: 'NSE' },
    SENSEX: { token: '99919000', name: 'SENSEX', exch_seg: 'BSE' },
};
// --- End Configuration ---

// Modify exportCandlesToCSV in test.js
const exportCandlesToCSV = async (symbolConfig, outputPath, masterController) => {
    const toDate = moment().tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm");
    const fromDate = moment().tz("Asia/Kolkata").subtract(20, 'days').format("YYYY-MM-DD HH:mm");

    const params = {
        exchange: symbolConfig.exch_seg,
        symboltoken: symbolConfig.token,
        interval: "ONE_HOUR",
        fromdate: fromDate,
        todate: toDate
    };

    console.log(`Fetching 1H candles for ${symbolConfig.name}...`);
    const history = await masterController.enqueueApiCall("getCandleData", [params]);

    if (!history || !history.data || history.data.length === 0) {
        console.error(`No candle data received for ${symbolConfig.name}`);
        return; // Exit if no data
    }

    // Save 1H data
    const header = "timestamp,open,high,low,close,volume\n";
    const rows = history.data.map(candle => candle.join(",")).join("\n");
    const csvContent = header + rows;
    fs.writeFileSync(outputPath, csvContent);
    console.log(`✅ Saved: ${outputPath}`);

    // Calculate and save S/R levels to a *different* file
    const srOutputPath = outputPath.replace('_1h.csv', '_sr_levels.csv');
    calculateAndSaveSRLevels(history.data, srOutputPath); // <-- CALL ADDED
};

const calculateAndSaveSRLevels = (candles, outputPath, numLevels = 5) => {
    console.log(`Calculating S/R levels for ${outputPath}...`);
    if (!candles || candles.length === 0) {
        console.error(`[SR Calc] No candles provided for ${outputPath}`);
        return;
    }

    const highs = candles.map(c => parseFloat(c[2])); // High is index 2
    const lows = candles.map(c => parseFloat(c[3]));  // Low is index 3

    // Simple S/R: N highest highs and N lowest lows (unique and sorted)
    const uniqueHighs = [...new Set(highs)].sort((a, b) => b - a);
    const uniqueLows = [...new Set(lows)].sort((a, b) => a - b);

    // We can add more sophisticated logic here (clustering, pivots) later.
    // For now, take the top/bottom N levels.
    const resistances = uniqueHighs.slice(0, numLevels);
    const supports = uniqueLows.slice(0, numLevels);

    // Combine, sort, and ensure uniqueness again
    const allLevels = [...new Set([...resistances, ...supports])].sort((a, b) => a - b);

    if (allLevels.length === 0) {
        console.error(`[SR Calc] Could not determine any S/R levels for ${outputPath}`);
        return;
    }

    const header = "level\n";
    const rows = allLevels.map(level => `${level.toFixed(2)}`).join("\n");
    const csvContent = header + rows;

    fs.writeFileSync(outputPath, csvContent);
    console.log(`✅ Saved ${allLevels.length} S/R levels: ${outputPath}`);
};

class OptionsUpdater {
    constructor(masterController) {
        if (!masterController || !masterController.smartApiInstance) {
            throw new Error("MasterController instance with active API connection is required.");
        }
        this.masterController = masterController;
        this.smart_api = masterController.smartApiInstance;
        this.scripMaster = null;
    }

    async runUpdate() {
        try {
            console.log('🚀 Starting options data update (Auto-Expiry & OTM)...');

            const dirPath = path.dirname(UPDATED_JSON_PATH);
            if (!fs.existsSync(dirPath)) {
                fs.mkdirSync(dirPath, { recursive: true });
                console.log(`Created directory: ${dirPath}`);
            }

            console.log('Fetching scrip master data...');
            this.scripMaster = await this.fetchScripMaster();
            console.log(`Received ${this.scripMaster.length} instruments.`);

            const updatedEntries = [];

            // Process Indices
            for (const indexName in INDEX_CONFIG) {
                const config = INDEX_CONFIG[indexName];
                await this.processSymbol(config.name, config, true, updatedEntries);
            }

            // Process Stocks
            for (const stockName of STOCKS_TO_TRACK) {
                const equityEntry = this.scripMaster.find(entry =>
                    entry.name === stockName &&
                    entry.exch_seg === 'NSE' &&
                    entry.symbol.endsWith('-EQ')
                );

                if (!equityEntry) {
                    console.error(`\n❌ Equity entry not found for ${stockName} in NSE segment`);
                    continue;
                }
                await this.processSymbol(stockName, equityEntry, false, updatedEntries);
            }

            fs.writeFileSync(UPDATED_JSON_PATH, JSON.stringify(updatedEntries, null, 2));
            console.log(`\n✅ Successfully updated ${UPDATED_JSON_PATH} with ${updatedEntries.length} entries`);

        } catch (error) {
            console.error('⛔ Critical error in updateOptionsData:', error.message, error.stack);
        }
    }

    async processSymbol(name, config, isIndex, updatedEntries) {
        console.log(`\nProcessing ${name}...`);
        const expiryDate = this.findNearestExpiry(name, isIndex);

        if (!expiryDate) {
            console.error(`❌ Could not find a valid future expiry for ${name}`);
            return;
        }
        console.log(`Found nearest expiry for ${name}: ${expiryDate}`);

        const lastClose = await this.fetchLastClose(config); // Use config (stock or index)
        if (lastClose !== null) {
            console.log(`Last close price: ${lastClose}`);
            const optionsData = this.processOptions(name, lastClose, isIndex, expiryDate);
            updatedEntries.push(...optionsData);
        } else {
            console.error(`❌ Could not fetch last close for ${name}`);
        }
    }


    findNearestExpiry(name, isIndex = false) {
        const instrumentType = isIndex ? 'OPTIDX' : 'OPTSTK';
        const today = moment().tz("Asia/Kolkata").startOf('day');

        if (!this.scripMaster) {
            console.error("Scrip master not loaded!");
            return null;
        }

        const expiries = this.scripMaster
            .filter(entry =>
                entry.name === name &&
                entry.instrumenttype === instrumentType &&
                entry.expiry // Ensure expiry exists
            )
            .map(entry => moment(entry.expiry, 'DDMMMYYYY')) // Parse the date
            .filter(expiryMoment => expiryMoment.isValid() && expiryMoment.isSameOrAfter(today)); // Filter valid & future dates

        if (expiries.length === 0) return null;

        // Get unique dates, sort them, and pick the first one (nearest)
        const uniqueSortedExpiries = [...new Set(expiries.map(m => m.format('YYYY-MM-DD')))]
            .map(ds => moment(ds, 'YYYY-MM-DD'))
            .sort((a, b) => a - b);

        // Return in the original 'DDMMMYYYY' format
        return uniqueSortedExpiries.length > 0 ? uniqueSortedExpiries[0].format('DDMMMYYYY').toUpperCase() : null;
    }


    async fetchScripMaster() {
        try {
            const response = await axios.get(SCRIP_MASTER_URL);
            return response.data.map(entry => ({
                ...entry,
                expiry: entry.expiry ? moment(entry.expiry, 'DD-MMM-YYYY').format('DDMMMYYYY').toUpperCase() : null,
                strike: entry.strike || '-1.000000',
                optionType: (entry.instrumenttype?.startsWith('OPT') && entry.symbol) ? entry.symbol.slice(-2) : null
            }));
        } catch (error) {
            console.error(`Failed to fetch or process scrip master: ${error.message}`);
            throw new Error(`Failed to fetch scrip master: ${error.message}`);
        }
    }

    async fetchLastClose(entryConfig) {
        try {
            const toDate = moment().tz("Asia/Kolkata").format('YYYY-MM-DD HH:mm');
            const fromDate = moment().tz("Asia/Kolkata").subtract(20, 'days').format("YYYY-MM-DD HH:mm");

            const params = {
                exchange: entryConfig.exch_seg,
                symboltoken: entryConfig.token,
                interval: "ONE_DAY",
                fromdate: fromDate,
                todate: toDate
            };

            console.log('Queueing historical data fetch with params:', params);
            const history = await this.masterController.enqueueApiCall('getCandleData', [params]);

            if (history && history.status && history.data && history.data.length > 0) {
                const lastCandle = history.data[history.data.length - 1];
                const closePriceIndex = 4;
                if (lastCandle && typeof lastCandle[closePriceIndex] === 'number') {
                    await delay(600);
                    return lastCandle[closePriceIndex];
                }
            }
            console.error('No valid historical data found. Response:', history?.message || JSON.stringify(history));
            return null;

        } catch (error) {
            console.error(`Failed to fetch history for ${entryConfig.name || entryConfig.symbol}:`, error.message);
            return null;
        }
    }

    processOptions(name, lastClose, isIndex, expiryDate) {
        const instrumentType = isIndex ? 'OPTIDX' : 'OPTSTK';
        console.log(`Filtering options for ${name}, Expiry: ${expiryDate}, Type: ${instrumentType}`);

        const options = this.scripMaster.filter(entry =>
            entry.name === name &&
            entry.expiry === expiryDate &&
            entry.instrumenttype === instrumentType &&
            (entry.exch_seg === 'NFO' || entry.exch_seg === 'BFO')
        );

        if (options.length === 0) {
            console.warn(`⚠️ No ${instrumentType} options found for ${name} with expiry ${expiryDate}`);
            return [];
        }

        const strikes = [...new Set(
            options.map(entry => parseFloat(entry.strike) / 100)
                .filter(strike => !isNaN(strike))
        )].sort((a, b) => a - b);

        if (strikes.length === 0) return [];

        const step = this.calculateStrikeStep(strikes);
        if (step <= 0) {
            console.warn(`⚠️ Could not determine strike step for ${name}`);
            return [];
        }
        console.log(`Determined strike step: ${step}`);

        const atmStrike = Math.round(lastClose / step) * step;
        console.log(`ATM Strike calculated: ${atmStrike}`);

        // --- MODIFIED LINES ---
        // Select ATM and one OTM strike for both CE and PE
        const strikesCE = [atmStrike, atmStrike + step].sort((a, b) => a - b); // ATM and OTM (Higher Strike) for Calls
        const strikesPE = [atmStrike, atmStrike - step].sort((a, b) => a - b); // ATM and OTM (Lower Strike) for Puts
        // --- END MODIFIED LINES ---

        console.log(`Target CE Strikes (ATM & OTM): ${strikesCE}`);
        console.log(`Target PE Strikes (ATM & OTM): ${strikesPE}`);

        const ceEntries = this.findOptions(name, 'CE', strikesCE, instrumentType, expiryDate);
        const peEntries = this.findOptions(name, 'PE', strikesPE, instrumentType, expiryDate);

        return [...ceEntries, ...peEntries];
    }

    calculateStrikeStep(strikes) {
        if (!strikes || strikes.length < 2) return 0;
        const diffs = {};
        for (let i = 1; i < strikes.length; i++) {
            const diff = Math.round((strikes[i] - strikes[i - 1]) * 100) / 100;
            if (diff > 0) {
                diffs[diff] = (diffs[diff] || 0) + 1;
            }
        }
        let mostCommonDiff = 0;
        let maxCount = 0;
        for (const diff in diffs) {
            if (diffs[diff] > maxCount) {
                maxCount = diffs[diff];
                mostCommonDiff = parseFloat(diff);
            }
        }
        return mostCommonDiff;
    }

    findOptions(name, optionType, targetStrikes, instrumentType, expiryDate) {
        const foundEntries = [];
        for (const strike of targetStrikes) {
            if (typeof strike !== 'number' || isNaN(strike)) continue;
            const targetStrikeString = `${(strike * 100).toFixed(6)}`;
            const entry = this.scripMaster.find(e =>
                e.name === name &&
                e.instrumenttype === instrumentType &&
                (e.exch_seg === 'NFO' || e.exch_seg === 'BFO') &&
                e.expiry === expiryDate && // Use the specific expiry date
                e.optionType === optionType &&
                e.strike === targetStrikeString
            );
            if (entry) {
                console.log(`   ✅ Found: ${entry.symbol} (Strike: ${strike})`);
                foundEntries.push(entry);
            } else {
                console.warn(`   ⚠️ Not Found: ${name} ${optionType} ${strike} for ${expiryDate}`);
            }
        }
        return foundEntries;
    }
}

// --- Main Execution Block ---
(async () => {
    let masterController;
    try {
        console.log("Instantiating MasterController for Options Update...");
        masterController = new MasterController();

        console.log("Initializing MasterController (Session & WS)...");
        await masterController.generateSession();

        if (!masterController.smartApiInstance) {
            throw new Error("MasterController failed to create SmartAPI instance.");
        }

        await exportCandlesToCSV(INDEX_CONFIG.NIFTY, path.resolve(__dirname, 'nifty_1h.csv'), masterController);
        await exportCandlesToCSV(INDEX_CONFIG.BANKNIFTY, path.resolve(__dirname, 'banknifty_1h.csv'), masterController);
        await exportCandlesToCSV(INDEX_CONFIG.SENSEX, path.resolve(__dirname, 'sensex_1h.csv'), masterController);



        console.log("MasterController ready. Instantiating OptionsUpdater...");
        const updater = new OptionsUpdater(masterController);

        console.log("Running Options Update...");
        await updater.runUpdate();

        console.log("Options update finished successfully.");

    } catch (error) {
        console.error("⛔ An error occurred during the update process:", error);
        process.exit(1);
    } finally {
        if (masterController) {
            console.log("Disconnecting WebSocket (if connected)...");
            masterController.disconnectWebSocket();
        }
        console.log("Script finished.");
        process.exit(0);
    }
})();