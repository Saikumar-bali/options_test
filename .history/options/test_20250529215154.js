// In D:/master controllers/gemini strategy/test.js

// Correct .env path to point to D:/master controllers/.env
require("dotenv").config({ path: require('path').join(__dirname, '..', '.env') }); // Goes one level up to project root

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const moment = require('moment-timezone');
// Ensure MasterController path is correct relative to test.js's new location
const MasterController = require('../universal websocket/index.js'); // Path from "gemini strategy" to "universal websocket"

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// --- Configuration ---
const SCRIP_MASTER_URL = 'https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json';
// UPDATED_JSON_PATH now saves in the current directory (gemini strategy/)
const UPDATED_JSON_PATH = path.resolve(__dirname, 'updated_options.json');

const STOCKS_TO_TRACK = [
    'RELIANCE', 'TCS', 'INFY', 'HDFCBANK', 'ICICIBANK', 'LT',
    'HINDUNILVR', 'KOTAKBANK', 'SBIN', 'AXISBANK', 'BAJFINANCE', 'ITC'
];
const INDEX_CONFIG = {
    NIFTY: { token: '99926000', name: 'NIFTY', exch_seg: 'NSE' },
    BANKNIFTY: { token: '99926009', name: 'BANKNIFTY', exch_seg: 'NSE' },
    SENSEX: { token: '99919000', name: 'SENSEX', exch_seg: 'BSE' }
};

// ... (rest of your OptionsUpdater class and other functions in test.js) ...

// Inside exportCandlesToCSV function in test.js:
// The outputPath was already using path.resolve, so if you called it with just 'nifty_1h.csv',
// it would use path.resolve(__dirname, 'nifty_1h.csv') which is correct for the new location.
// Example call:
// await exportCandlesToCSV(INDEX_CONFIG.NIFTY, 'nifty_1h.csv', masterController); // Saves to gemini strategy/nifty_1h.csv

// In the main execution block of test.js:
async function main() {
    let masterController;
    try {
        // ...
        // Ensure these paths are now relative to gemini strategy/
        await exportCandlesToCSV(INDEX_CONFIG.NIFTY, path.resolve(__dirname, 'nifty_1h.csv'), masterController);
        await exportCandlesToCSV(INDEX_CONFIG.BANKNIFTY, path.resolve(__dirname, 'banknifty_1h.csv'), masterController);
        await exportCandlesToCSV(INDEX_CONFIG.SENSEX, path.resolve(__dirname, 'sensex_1h.csv'), masterController);
        // ...
    } catch (error) {
        // ...
    } finally {
        // ...
    }
}
main();