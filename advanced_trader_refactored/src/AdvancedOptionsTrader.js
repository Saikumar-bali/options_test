// File: /src/AdvancedOptionsTrader.js
const path = require('path');
const fs = require('fs');
const MarketManager = require('./core/MarketManager');
const PositionManager = require('./core/PositionManager');
const RiskManager = require('./core/RiskManager');
const DataHandler = require('./data/DataHandler');
const CandleManager = require('./data/CandleManager');
const TradeExecutor = require('./execution/TradeExecutor');
const TelegramService = require('./services/TelegramService');
const Logger = require('./services/Logger');
const InstrumentManager = require('./services/InstrumentManager');
const PreMarketAnalyzer = require('../pre_market_analysis/PreMarketAnalyzer');
const ReportGenerator = require('./services/ReportGenerator');
const IndicatorCalculator = require('./indicators/IndicatorCalculator')

class AdvancedOptionsTrader {
    constructor(masterController, config) {
        this.masterController = masterController;
        this.config = config;
        this.logger = new Logger(config);
        this.instrumentManager = new InstrumentManager(this.logger);
        this.preMarketAnalyzer = new PreMarketAnalyzer(config, this.logger, this.masterController, this.instrumentManager);
        this.telegramService = new TelegramService(this);
        this.positionManager = new PositionManager(this);
        this.riskManager = new RiskManager(this);
        this.candleManager = new CandleManager(this);
        this.dataHandler = new DataHandler(this);
        this.reportGenerator = new ReportGenerator(this);
        this.tradeExecutor = new TradeExecutor(this);

        this.indicatorCalculator = new IndicatorCalculator(this);
        this.stocks = []; // Will hold all instruments to be tracked (from watchlist)
        this.underlyingSR = new Map(); // K: symbol, V: {supports: [], resistances: []}
        this.activeTradeSignals = new Map(); // K: option_token, V: reason (e.g., "Underlying at Support")
    }

    async initialize() {
        this.logger.info(`📈 ${this.config.strategyName} initializing...`);
        await this.instrumentManager.initialize();

        if (this.config.preMarketAnalysis.enabled) {
            await this.preMarketAnalyzer.run();
            this.loadWatchlistAndSrLevels();
        }

        if (this.stocks.length === 0) {
            this.logger.warn("Watchlist is empty after pre-market analysis. No trades will be placed.");
        } else {
            await this.dataHandler.fetchAllHistoricalData(); // Fetch initial candle data
        }

        this.positionManager.loadPositions();
        this.riskManager.initializePnlFromPositions();
        this.marketManager = new MarketManager(this);
        await this.marketManager.initialize();

        // Subscribe to ticks for all underlyings and options on the watchlist
        const allTokens = this.stocks.map(s => s.token);
        this.logger.info(`👂 Subscribed to ${allTokens.length} instrument ticks.`);
    }

    processData(tickData) {
        // This function acts as the entry point for ticks from the MasterController.
        // It simply passes the data to your existing onTick logic.
        this.onTick(tickData);
    }
    loadWatchlistAndSrLevels() {
        try {
            this.stocks = this.dataHandler.loadStocks(); // Loads updated_options.json
            this.logger.info(`✅ Successfully loaded ${this.stocks.length} option contracts into the watchlist.`);

            // Group S/R levels by underlying for quick lookup
            this.stocks.forEach(item => {
                const underlyingSymbol = item.name;
                if (!this.underlyingSR.has(underlyingSymbol)) {
                    this.underlyingSR.set(underlyingSymbol, { supports: [], resistances: [] });
                }
                const srMap = this.underlyingSR.get(underlyingSymbol);
                if (item.signal_type === 'BULLISH_SR' && !srMap.supports.includes(item.trigger_level)) {
                    srMap.supports.push(item.trigger_level);
                } else if (item.signal_type === 'BEARISH_SR' && !srMap.resistances.includes(item.trigger_level)) {
                    srMap.resistances.push(item.trigger_level);
                }
            });

            this.logger.info(`📊 Loaded S/R levels for ${this.underlyingSR.size} underlyings.`);
        } catch (error) {
            this.logger.error(`❌ Could not load watchlist file. Error: ${error.message}`);
        }
    }

    onTick(data) {
        if (!data || !data.token || !data.ltp) return;
        const ltp = parseFloat(data.ltp);
        const token = data.token.toString();

        const instrument = this.stocks.find(s => s.token === token);
        if (!instrument) return;

        this.candleManager.updateCurrentCandle(token, ltp);

        if (this.positionManager.getPosition(token)) {
            this.tradeExecutor.checkExitConditions(instrument, ltp, this.positionManager.getPosition(token));
        } else if (!this.riskManager.isTradingHalted()) {
            this.tradeExecutor.checkEntryConditions(instrument, ltp);
        }
    }

    async shutdown(signal) {
        this.logger.info(`Initiating shutdown due to ${signal}...`);
        if (this.marketManager) await this.marketManager.closeAllOpenPositions(`Shutdown Signal: ${signal}`);
        if (this.reportGenerator) await this.reportGenerator.generate(true);
        this.cleanup();
    }

    cleanup() {
        if (this.candleManager) this.candleManager.cleanup();
        this.logger.info(`🧹 ${this.config.strategyName} cleanup finished.`);
    }
}

module.exports = AdvancedOptionsTrader;