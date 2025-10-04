// File: /advanced_trader_refactored/src/AdvancedOptionsTrader.js
const MarketManager = require('./core/MarketManager');
const PositionManager = require('./core/PositionManager');
const RiskManager = require('./core/RiskManager');
const DataHandler = require('./data/DataHandler');
const CandleManager = require('./data/CandleManager');
const IndicatorCalculator = require('./indicators/IndicatorCalculator');
const TelegramService = require('./services/TelegramService');
const Logger = require('./services/Logger');
const TradeExecutor = require('./execution/TradeExecutor');
const ReportGenerator = require('./services/ReportGenerator');
const PreMarketAnalyzer = require('../pre_market_analysis/PreMarketAnalyzer');

class AdvancedOptionsTrader {
    constructor(masterController, config) {
        this.masterController = masterController;
        this.config = config;

        // Initialize all modular components
        this.logger = new Logger(config);
        this.preMarketAnalyzer = new PreMarketAnalyzer(config, this.logger, this.masterController);
        this.telegramService = new TelegramService(this);
        this.positionManager = new PositionManager(this);
        this.riskManager = new RiskManager(this);
        this.dataHandler = new DataHandler(this);
        this.candleManager = new CandleManager(this);
        this.indicatorCalculator = new IndicatorCalculator(this);
        this.tradeExecutor = new TradeExecutor(this);
        this.marketManager = new MarketManager(this);
        this.reportGenerator = new ReportGenerator(this);

        this.stocks = []; // Master list of stocks, managed by DataHandler
        this.underlyingPrices = new Map();
        this.masterController.registerStrategy(this);
        this.initialize();
    }

    async initialize() {
        this.logger.info(`📈 ${this.config.strategyName} initializing...`);
        // Run pre-market analysis first if enabled
        if (this.config.preMarketAnalysis?.enabled) {
            await this.preMarketAnalyzer.run();
        } else {
            this.logger.info("Pre-market analysis is disabled. Loading existing stock list.");
        }
        this.stocks = this.dataHandler.loadStocks();
        if (this.stocks.length === 0) {
            this.logger.warn("⚠️ No tradeable instruments found after pre-market analysis. The bot will not place trades.");
        }
        this.positionManager.loadPositions();
        this.riskManager.initializePnlFromPositions();
        await this.marketManager.initialize(); // Handles market timings
        this.telegramService.setupCommands();
        this.telegramService.sendAlert(`🚀 ${this.config.strategyName} started successfully!`);
    }

    // Main data processing pipeline, called by MasterController
    processData(data) {
        // First, check if the tick is for an underlying asset and update its price
        const isUnderlying = !data.symbol?.includes('CE') && !data.symbol?.includes('PE');
        if (isUnderlying) {
            this.underlyingPrices.set(data.symbol, parseFloat(data.ltp));
            return;
        }

        // If it's an option, proceed with trade logic
        const stock = this.stocks.find(s => s.token === data.token);
        if (!stock) return;

        const ltp = parseFloat(data.ltp);
        this.candleManager.updateCurrentCandle(data.token, ltp);
        const position = this.positionManager.getPosition(stock.token);

        if (position) {
            this.tradeExecutor.checkExitConditions(stock, ltp, position);
        } else if (!this.riskManager.isTradingHalted()) {
            this.tradeExecutor.checkEntryConditions(stock, ltp);
        }


        // Halt further checks if trading is stopped or stock is on cooldown
        if (this.riskManager.isTradingHalted() || this.riskManager.isOnCooldown(stock.token)) {
            return;
        }

        // If no position exists, check for entry signals
        if (!position) {
            this.tradeExecutor.checkEntryConditions(stock, ltp);
        }
    }

    async shutdown(signal) {
        this.logger.info(`Initiating shutdown due to ${signal}...`);
        await this.marketManager.closeAllOpenPositions(`Shutdown Signal: ${signal}`);
        await this.reportGenerator.generate(true); // Force report on shutdown
        this.cleanup();
    }

    cleanup() {
        if (this.candleManager) this.candleManager.cleanup();
        this.logger.info(`🧹 ${this.config.strategyName} cleanup finished.`);
        this.telegramService.sendAlert(`🛑 ${this.config.strategyName} stopped.`);
        if (this.logger) this.logger.close();
        if (this.telegramService) this.telegramService.stopPolling();
    }
}

module.exports = AdvancedOptionsTrader;