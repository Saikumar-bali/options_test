const AngelOneService = require('./services/angelone.service.js');
const MarketDataService = require('./services/marketdata.service.js');
const TradingEngine = require('./engine/trading.engine.js');

async function startBot() {
    console.log("🚀 Starting Trading Bot...");

    const angelOne = new AngelOneService();
    const tradingEngine = new TradingEngine(angelOne);

    try {
        await tradingEngine.loadLevels();
        const session = await angelOne.connect();
        
        if (session && session.feedToken) {
            const marketData = new MarketDataService(session, tradingEngine);
            marketData.connect();
            console.log("✅ Bot started successfully and is listening for market data.");
        } else {
            throw new Error("Invalid session or missing feed token. Cannot start market data service.");
        }

    } catch (error) {
        console.error("❌ Critical startup error in bot:", error.message);
        process.exit(1); // Exit if startup fails
    }
}

startBot();
