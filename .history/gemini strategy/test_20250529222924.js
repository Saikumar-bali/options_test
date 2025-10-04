// File: D:/master controllers/gemini strategy/test.js

// Correct .env path to point to D:/master controllers/.env
require("dotenv").config({ path: require('path').join(__dirname, '..', '.env') });

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const moment = require('moment-timezone');
// Correct MasterController path
const MasterController = require('../universal websocket/index.js');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// --- Configuration ---
const SCRIP_MASTER_URL = process.env.SCRIP_MASTER_URL || 'https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json';
// UPDATED_JSON_PATH now saves in the current directory (gemini strategy/)
const UPDATED_JSON_PATH = path.resolve(__dirname, 'updated_options.json');

const STOCKS_TO_TRACK = [
    'RELIANCE', 'TCS', 'INFY', 'HDFCBANK', 'ICICIBANK', 'LT',
    'HINDUNILVR', 'KOTAKBANK', 'SBIN', 'AXISBANK', 'BAJFINANCE', 'ITC'
]; // Add more as needed

// Instrument types from Angel Scrip Master: AMXIDX, AUCSO, COMDY, CURCY, EQ, FUTCOM, FUTIDX, FUTIVX, FUTSTK, INDEX, OPTCOM, OPTIDX, OPTSTK
const INDEX_CONFIG = {
    NIFTY: { name: 'NIFTY', underlyingInstrumentType: 'INDEX', optionInstrumentType: 'OPTIDX', exch_seg: 'NSE', underlyingToken: '26000' }, // Underlying token for Nifty Index
    BANKNIFTY: { name: 'BANKNIFTY', underlyingInstrumentType: 'INDEX', optionInstrumentType: 'OPTIDX', exch_seg: 'NSE', underlyingToken: '26009' }, // Underlying token for BankNifty Index
    // SENSEX: { name: 'SENSEX', underlyingInstrumentType: 'INDEX', optionInstrumentType: 'OPTIDX', exch_seg: 'BSE', underlyingToken: '19000' } // Example for SENSEX
};

class OptionsUpdater {
    constructor(masterController) {
        this.masterController = masterController;
        this.scripMaster = null;
        this.ltpData = new Map(); // To store LTP of underlyings
    }

    async fetchScripMaster() {
        console.log("Fetching Scrip Master...");
        try {
            const response = await axios.get(SCRIP_MASTER_URL);
            this.scripMaster = response.data;
            console.log("✅ Scrip Master fetched and parsed.");
        } catch (error) {
            console.error("❌ Error fetching Scrip Master:", error.message);
            throw error;
        }
    }

    findTokenForUnderlying(name, instrumentType, exch_seg = 'NSE') {
        if (!this.scripMaster) throw new Error("Scrip Master not loaded.");
        const entry = this.scripMaster.find(
            s => (s.name === name && s.instrumenttype === instrumentType && s.exch_seg === exch_seg && s.symbol.endsWith('-EQ')) || // For EQ
                 (s.name === name && s.instrumenttype === instrumentType && s.exch_seg === exch_seg && s.lotsize === "0") // For INDEX
        );
        return entry ? entry.token : null;
    }
    
    async getLTP(token, exchange) {
         if (!this.masterController || typeof this.masterController.getLtpData !== 'function') {
            console.warn("MasterController.getLtpData is not available. Cannot fetch LTP for strike calculation.");
            return null; // Or throw error
        }
        try {
            const ltpResult = await this.masterController.getLtpData({ exchange: exchange, tradingsymbol: null, symboltoken: token }); // Assuming getLtpData can take token
             if (ltpResult && ltpResult.data && typeof ltpResult.data.ltp !== 'undefined') {
                console.log(`LTP for ${token} (${exchange}): ${ltpResult.data.ltp}`);
                return parseFloat(ltpResult.data.ltp);
            } else if (ltpResult && typeof ltpResult.ltp !== 'undefined') { // Simpler structure
                console.log(`LTP for ${token} (${exchange}): ${ltpResult.ltp}`);
                return parseFloat(ltpResult.ltp);
            }
            console.warn(`Could not fetch LTP for token ${token} on ${exchange}. Response:`, ltpResult);
            return null;
        } catch (error) {
            console.error(`Error fetching LTP for ${token} on ${exchange}:`, error);
            return null;
        }
    }


    async findOptionsForUnderlying(underlyingName, underlyingConfig, numStrikes = 2) {
        if (!this.scripMaster) throw new Error("Scrip Master not loaded.");
        console.log(`\n🔍 Finding options for ${underlyingName}...`);

        const underlyingToken = underlyingConfig.underlyingToken || this.findTokenForUnderlying(underlyingName, underlyingConfig.underlyingInstrumentType, underlyingConfig.exch_seg);
        if (!underlyingToken) {
            console.warn(`⚠️ Could not find token for underlying ${underlyingName}. Skipping.`);
            return [];
        }
        console.log(`Underlying ${underlyingName} (Token: ${underlyingToken})`);

        const currentLTP = await this.getLTP(underlyingToken, underlyingConfig.exch_seg);
        if (currentLTP === null) {
            console.warn(`⚠️ LTP for ${underlyingName} (Token: ${underlyingToken}) not available. Cannot select ATM options accurately. Skipping.`);
            return [];
        }
        console.log(`Current LTP for ${underlyingName}: ${currentLTP}`);

        const today = moment.tz("Asia/Kolkata");
        let currentExpiryDate = null;
        let nextExpiryDate = null;

        // Find relevant expiries
        const expiries = [...new Set(this.scripMaster
            .filter(s => s.name === underlyingName && s.instrumenttype === underlyingConfig.optionInstrumentType && s.exch_seg === 'NFO')
            .map(s => s.expiry)
            .filter(Boolean) // Remove undefined/null expiries
        )].sort((a, b) => moment(a, "DDMMMYYYY").valueOf() - moment(b, "DDMMMYYYY").valueOf());

        for (const expiryStr of expiries) {
            const expiryMoment = moment(expiryStr, "DDMMMYYYY").tz("Asia/Kolkata").endOf('day');
            if (expiryMoment.isSameOrAfter(today.clone().startOf('day'))) {
                if (!currentExpiryDate) {
                    currentExpiryDate = expiryStr;
                } else if (!nextExpiryDate) {
                    nextExpiryDate = expiryStr;
                    break;
                }
            }
        }
        
        const targetExpiry = currentExpiryDate; // Or choose nextExpiryDate based on a condition
        if (!targetExpiry) {
            console.warn(`⚠️ No suitable expiry found for ${underlyingName}.`);
            return [];
        }
        console.log(`Target expiry for ${underlyingName}: ${targetExpiry}`);

        const optionsForExpiry = this.scripMaster.filter(s =>
            s.name === underlyingName &&
            s.instrumenttype === underlyingConfig.optionInstrumentType && // e.g., 'OPTIDX' or 'OPTSTK'
            s.exch_seg === 'NFO' && // Options are usually in NFO
            s.expiry === targetExpiry
        );

        if (optionsForExpiry.length === 0) {
            console.warn(`No options found for ${underlyingName} with expiry ${targetExpiry}.`);
            return [];
        }

        const strikes = [...new Set(optionsForExpiry.map(s => parseFloat(s.strike) / 100.0))].sort((a, b) => a - b);
        if (strikes.length === 0) {
            console.warn(`No strikes found for ${underlyingName} with expiry ${targetExpiry}.`);
            return [];
        }

        const atmStrike = strikes.reduce((prev, curr) => Math.abs(curr - currentLTP) < Math.abs(prev - currentLTP) ? curr : prev);
        console.log(`ATM Strike for ${underlyingName}: ${atmStrike}`);

        let selectedOptions = [];
        const atmStrikeIndex = strikes.indexOf(atmStrike);

        // Select ATM and N OTM strikes for CE and PE
        for (let i = 0; i < numStrikes; i++) {
            // CE options (ATM and OTM - higher strikes)
            if (atmStrikeIndex + i < strikes.length) {
                const strike = strikes[atmStrikeIndex + i];
                const ceOption = optionsForExpiry.find(s => (parseFloat(s.strike) / 100.0) === strike && s.symbol.endsWith('CE'));
                if (ceOption) selectedOptions.push(ceOption);
            }
            // PE options (ATM and OTM - lower strikes)
            if (atmStrikeIndex - i >= 0) {
                const strike = strikes[atmStrikeIndex - i];
                const peOption = optionsForExpiry.find(s => (parseFloat(s.strike) / 100.0) === strike && s.symbol.endsWith('PE'));
                if (peOption) selectedOptions.push(peOption);
            }
        }
        // Ensure unique options if ATM was added twice by CE and PE loops (unlikely with separate CE/PE find)
        selectedOptions = [...new Set(selectedOptions)]; 

        console.log(`Selected ${selectedOptions.length} options for ${underlyingName}.`);
        return selectedOptions.map(s => ({
            token: s.token,
            symbol: s.symbol,
            name: s.name,
            expiry: s.expiry,
            strike: (parseFloat(s.strike) / 100.0).toFixed(2), // Standardize strike format
            lotsize: s.lotsize,
            instrumenttype: s.instrumenttype,
            exch_seg: s.exch_seg,
            tick_size: (parseFloat(s.tick_size) / 100.0).toFixed(2),
            optionType: s.symbol.slice(-2) // CE or PE
        }));
    }

    async runUpdate() {
        await this.fetchScripMaster();
        let allSelectedOptions = [];

        // Process Indices
        for (const indexKey in INDEX_CONFIG) {
            const config = INDEX_CONFIG[indexKey];
            const options = await this.findOptionsForUnderlying(config.name, config, 2); // 2 strikes for ATM + 1 OTM
            allSelectedOptions.push(...options);
            await delay(500); // Delay between processing each index/stock
        }

        // Process Stocks
        for (const stockName of STOCKS_TO_TRACK) {
            // For stocks, underlying is EQ, options are OPTSTK
            const stockConfig = { 
                name: stockName, 
                underlyingInstrumentType: 'EQ', // Equity
                optionInstrumentType: 'OPTSTK', // Option on Stock
                exch_seg: 'NSE', // Assuming stocks are NSE for underlying LTP
                // underlyingToken will be found by findTokenForUnderlying
            };
            const options = await this.findOptionsForUnderlying(stockName, stockConfig, 2); // 2 strikes for ATM + 1 OTM
            allSelectedOptions.push(...options);
            await delay(500);
        }
        
        // Remove duplicates that might arise if a stock is also part of an index and processed similarly
        const uniqueOptions = Array.from(new Set(allSelectedOptions.map(opt => opt.token)))
            .map(token => allSelectedOptions.find(opt => opt.token === token));


        fs.writeFileSync(UPDATED_JSON_PATH, JSON.stringify(uniqueOptions, null, 2));
        console.log(`\n✅ Successfully updated options list at ${UPDATED_JSON_PATH} with ${uniqueOptions.length} options.`);
    }
}


async function exportCandlesToCSV(config, outputPath, masterControllerInstance) {
    console.log(`\nFetching 1-hour candles for ${config.name}...`);
    try {
        const toDate = moment.tz("Asia/Kolkata");
        const fromDate = moment.tz("Asia/Kolkata").subtract(20, 'days');

        const params = {
            exchange: config.exch_seg,
            symboltoken: config.underlyingToken, // Use underlyingToken for index candles
            interval: 'ONE_HOUR',
            fromdate: fromDate.format("YYYY-MM-DD") + " 09:15",
            todate: toDate.format("YYYY-MM-DD") + " 15:30"
        };

        const historicalData = await masterControllerInstance.getHistoricalData(params);

        if (historicalData && historicalData.status === true && Array.isArray(historicalData.data)) {
            const header = "timestamp,open,high,low,close,volume\n";
            const rows = historicalData.data.map(c => c.join(",")).join("\n");
            fs.writeFileSync(outputPath, header + rows);
            console.log(`✅ Saved 1-hour candle data for ${config.name} to ${outputPath}`);
        } else {
            console.warn(`⚠️ No 1-hour candle data received for ${config.name}. Response:`, (historicalData && historicalData.message) || historicalData);
        }
    } catch (error) {
        console.error(`❌ Error fetching/saving 1-hour candles for ${config.name}:`, error.message);
    }
}


async function main() {
    let masterController;
    try {
        console.log("Instantiating MasterController for Options Update...");
        masterController = new MasterController(); // Assuming MC handles its own config/creds

        console.log("Initializing MasterController (Session & WS)...");
        await masterController.initialize(); // Make sure MC has an initialize method for session & WS

        if (!masterController.isSessionActive()) { // Add a method to check session
            throw new Error("MasterController failed to establish a session.");
        }
        
        // Export 1-hour candles for indices (optional, for review)
        await exportCandlesToCSV(INDEX_CONFIG.NIFTY, path.resolve(__dirname, 'nifty_1h.csv'), masterController);
        await exportCandlesToCSV(INDEX_CONFIG.BANKNIFTY, path.resolve(__dirname, 'banknifty_1h.csv'), masterController);
        // await exportCandlesToCSV(INDEX_CONFIG.SENSEX, path.resolve(__dirname, 'sensex_1h.csv'), masterController);


        console.log("MasterController ready. Instantiating OptionsUpdater...");
        const updater = new OptionsUpdater(masterController);

        console.log("Running Options Update (this will fetch ScripMaster, LTPs, and select options)...");
        await updater.runUpdate();

        console.log("Options update finished successfully.");

    } catch (error) {
        console.error("⛔ An error occurred during the update process:", error.message, error.stack);
        process.exit(1);
    } finally {
        if (masterController) {
            console.log("Disconnecting MasterController (WebSocket, etc.)...");
            masterController.disconnectWebSocket(); // Ensure proper cleanup
        }
        console.log("Script finished.");
        process.exit(0); // Ensure script exits after completion
    }
}

main();