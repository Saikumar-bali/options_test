const SupportResistance = require('../indicators/SupportResistance');
const DataFetcher = require('../utils/DataFetcher');
const InstrumentLoader = require('../utils/instrument_loader');
const moment = require('moment-timezone');
const fs = require('fs');
const path = require('path');

// Mock Config
const CONFIG = {
    historical_data: {
        timeframe: 'ONE_HOUR',
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
        // return; 
        // Continue with dummy data even if instrument not found, to test logic
    } else {
        console.log(`✅ Found Instrument: ${instrument.symbol} (Token: ${instrument.token})`);
    }

    console.log("Generating Dummy Data to test logic...");
    const dummyData = generateDummyCandles(100);

    console.log(`Testing detectLevels with ${dummyData.length} candles...`);
    // Pass mock LTP (e.g., 500) and the CONFIG object
    const levels = SupportResistance.detectLevels(dummyData, 500, { reactionLookback: 5, levelsToReturn: 6 });

    console.log("Levels Detected:", JSON.stringify(levels, null, 2));

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

debugLevels().catch(console.error);
