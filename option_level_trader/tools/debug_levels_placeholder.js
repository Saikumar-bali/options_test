const { SupportResistance } = require('../utils/SupportResistance'); // Assuming this is where it is
const DataFetcher = require('../utils/DataFetcher'); // You might need to mock this or use the real one
const InstrumentLoader = require('../utils/instrument_loader');
const moment = require('moment-timezone');
const fs = require('fs');
const path = require('path');

// Mock Config
const CONFIG = {
    historical_data: {
        timeframe: 'ONE_HOUR', // Check what the real config uses
        days: 7
    }
};

async function debugLevels() {
    console.log("🚀 Starting Level Debugger...");

    // 1. Load Instruments to get the token for the option
    const loader = new InstrumentLoader();
    await loader.loadInstruments();

    const targetSymbol = 'NIFTY02DEC2525850CE'; // From user report
    const instrument = loader.instruments.find(i => i.symbol === targetSymbol);

    if (!instrument) {
        console.error(`❌ Could not find instrument for ${targetSymbol}`);
        return;
    }
    console.log(`✅ Found Instrument: ${instrument.symbol} (Token: ${instrument.token})`);

    // 2. Fetch Historical Data
    // We need to instantiate DataFetcher or mock it. 
    // Since DataFetcher relies on MasterController/SmartAPI, it might be hard to run standalone without auth.
    // Let's try to see if we can use the existing DataFetcher if it has a standalone mode or if we need to mock the API response.

    // For now, let's assume we can't easily fetch real data without the full app login flow.
    // So we will check if there is a way to simulate the data or if we should use the main app to log the data.

    // BETTER APPROACH: 
    // The user is running the app. The best way to debug "why" levels are N/A is to log the data *inside* the strategy.
    // But we can try to write a script that *checks* the logic if we provide it with dummy data.

    console.log("Generating Dummy Data to test logic...");
    const dummyData = generateDummyCandles(100);

    console.log(`Testing detectLevels with ${dummyData.length} candles...`);
    const levels = SupportResistance.detectLevels(dummyData);

    console.log("Levels Detected:", levels);

    if (levels.supports.length === 0 && levels.resistances.length === 0) {
        console.log("⚠️ Logic returned no levels for dummy data.");
    } else {
        console.log("✅ Logic works for dummy data.");
    }
}

function generateDummyCandles(count) {
    const candles = [];
    let price = 500;
    for (let i = 0; i < count; i++) {
        const open = price;
        const close = price + (Math.random() - 0.5) * 10;
        const high = Math.max(open, close) + Math.random() * 5;
        const low = Math.min(open, close) - Math.random() * 5;
        candles.push({
            time: moment().subtract(count - i, 'hours').format(),
            open, high, low, close, volume: 1000
        });
        price = close;
    }
    return candles;
}

// We need to find where SupportResistance is defined.
// Based on previous file views, it wasn't explicitly seen in the file list but referenced in OptionsLevelStrategy.
// Let's assume it's in ../strategies/SupportResistance.js or ../utils/SupportResistance.js
// I'll check the file structure first.

// debugLevels();
