// File: /src/AdvancedOptionsTrader.js
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
// <mark style="background-color: red; color: white;">
// Make sure ReportGenerator is required
// </mark>
const ReportGenerator = require('./services/ReportGenerator'); // Ensure this line exists and is correct

class AdvancedOptionsTrader {
    constructor(masterController, config) {
        this.masterController = masterController;
        this.config = config;
        this.logger = new Logger(config);
        
        this.instrumentManager = new InstrumentManager(this.logger);
        
        // Pass instrumentManager to PreMarketAnalyzer's constructor
        this.preMarketAnalyzer = new PreMarketAnalyzer(config, this.logger, this.masterController, this.instrumentManager);
        
        this.telegramService = new TelegramService(this);
        this.positionManager = new PositionManager(this);
        this.riskManager = new RiskManager(this);
        this.dataHandler = new DataHandler(this);
        this.candleManager = new CandleManager(this);
        this.tradeExecutor = new TradeExecutor(this);
        this.marketManager = new MarketManager(this);
        // <mark style="background-color: red; color: white;">
        // Instantiate ReportGenerator here
        // </mark>
        this.reportGenerator = new ReportGenerator(this); // This was missing

        this.stocks = []; // Master list of stocks, potentially populated by PreMarketAnalyzer then loaded by DataHandler
        this.underlyingPrices = new Map(); // To store LTP of underlying assets if needed by options logic

        // Register the strategy with MasterController if it handles tick distribution
        if (this.masterController && typeof this.masterController.registerStrategy === 'function') {
            this.masterController.registerStrategy(this);
        }
        
        this.initialize(); // Call initialize async
    }

    async initialize() {
        this.logger.info(`📈 ${this.config.strategyName} initializing...`);
        
        // Initialize the InstrumentManager to download/load the scrip file
        await this.instrumentManager.initialize();

        // Run pre-market analysis if enabled
        if (this.config.preMarketAnalysis?.enabled) {
            await this.preMarketAnalyzer.run(); // This should populate logs/updated_options.json
        } else {
            this.logger.info("Pre-market analysis is disabled. Loading existing stock list if any.");
        }

        // DataHandler loads stocks from the file potentially written by PreMarketAnalyzer
        this.stocks = this.dataHandler.loadStocks(); 
        if (this.stocks.length === 0) {
            this.logger.warn("⚠️ No tradeable instruments found after pre-market analysis or from existing files. The bot will not place trades.");
        } else {
            this.logger.info(`Loaded ${this.stocks.length} instruments for trading.`);
        }
        
        this.positionManager.loadPositions();
        this.riskManager.initializePnlFromPositions();
        
        // MarketManager initializes and schedules market open/close/EOD tasks
        // This is where the error was happening because reportGenerator wasn't ready
        await this.marketManager.initialize(); //
        
        this.telegramService.setupCommands();
        this.telegramService.sendAlert(`🚀 ${this.config.strategyName} started. Monitoring ${this.stocks.length} potential setups.`);
    }

    // processData, shutdown, cleanup methods remain the same as your uploaded version
    // ... (Make sure these methods are correctly defined as in your file) ...
    processData(data) {
        const isUnderlying = !data.symbol?.includes('CE') && !data.symbol?.includes('PE');
        if (isUnderlying) {
            this.underlyingPrices.set(data.symbol, parseFloat(data.ltp));
            return;
        }

        const stock = this.stocks.find(s => s.token === data.token);
        if (!stock) return;

        const ltp = parseFloat(data.ltp);
        this.candleManager.updateCurrentCandle(data.token, ltp);
        const position = this.positionManager.getPosition(stock.token);

        if (position) {
            this.tradeExecutor.checkExitConditions(stock, ltp, position);
        } else if (!this.riskManager.isTradingHalted()) { // Check if trading is not halted before new entries
            this.tradeExecutor.checkEntryConditions(stock, ltp);
        }
    }

    async shutdown(signal) {
        this.logger.info(`Initiating shutdown due to ${signal}...`);
        // Ensure MarketManager and ReportGenerator are available
        if (this.marketManager) {
            await this.marketManager.closeAllOpenPositions(`Shutdown Signal: ${signal}`);
        }
        if (this.reportGenerator) {
            await this.reportGenerator.generate(true); // Force report on shutdown
        }
        this.cleanup();
    }

    cleanup() {
        if (this.candleManager) this.candleManager.cleanup();
        this.logger.info(`🧹 ${this.config.strategyName} cleanup finished.`);
        if (this.telegramService) {
            this.telegramService.sendAlert(`🛑 ${this.config.strategyName} stopped.`);
            // If your TelegramService has a method to stop polling, call it here.
            // e.g., this.telegramService.stopPolling(); 
        }
        if (this.logger && typeof this.logger.close === 'function') {
            this.logger.close();
        }
    }
}

module.exports = AdvancedOptionsTrader;