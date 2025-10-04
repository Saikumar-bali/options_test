// File: /src/AdvancedOptionsTrader.js
const MarketManager = require('./core/MarketManager');
const PositionManager = require('./core/PositionManager');
const RiskManager = require('./core/RiskManager');
const DataHandler = require('./data/DataHandler');
const CandleManager = require('./data/CandleManager');
const TradeExecutor = require('./execution/TradeExecutor');
const TelegramService = require('./services/TelegramService');
const Logger = require('./services/Logger');
const InstrumentManager = require('./services/InstrumentManager'); // *** NEW ***
const PreMarketAnalyzer = require('../pre_market_analysis/PreMarketAnalyzer');

class AdvancedOptionsTrader {
    constructor(masterController, config) {
        this.masterController = masterController;
        this.config = config;
        this.logger = new Logger(config);
        
        // *** NEW: Instantiate InstrumentManager first ***
        this.instrumentManager = new InstrumentManager(this.logger);
        
        this.preMarketAnalyzer = new PreMarketAnalyzer(config, this.logger, this.masterController, this.instrumentManager);
        
        this.telegramService = new TelegramService(this);
        this.positionManager = new PositionManager(this);
        this.riskManager = new RiskManager(this);
        this.dataHandler = new DataHandler(this);
        this.candleManager = new CandleManager(this);
        this.tradeExecutor = new TradeExecutor(this);
        this.marketManager = new MarketManager(this);

        this.stocks = [];
        this.underlyingPrices = new Map();

        this.initialize();
    }

    async initialize() {
        this.logger.info(`📈 ${this.config.strategyName} initializing...`);
        
        // *** NEW: Initialize the InstrumentManager to download the scrip file ***
        await this.instrumentManager.initialize();

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
        await this.marketManager.initialize();
        this.telegramService.setupCommands();
        this.telegramService.sendAlert(`🚀 ${this.config.strategyName} started. Monitoring ${this.stocks.length} potential setups.`);
    }

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
        } else if (!this.riskManager.isTradingHalted()) {
            this.tradeExecutor.checkEntryConditions(stock, ltp);
        }
    }
}

module.exports = AdvancedOptionsTrader;