// File: /trading-bot/utils/Conductor.js

const path = require('path');
const fs = require('fs');
const axios = require('axios');
const MasterController = require('../../universal websocket/index.js');
const InstrumentLoader = require('./instrument_loader.js');
const TelegramService = require('./TelegramService.js');
const ReportGenerator = require('./ReportGenerator.js');
const { STRATEGY_DEFINITIONS, TRADING_UNIVERSE } = require('../config/trade_config.js');

class Conductor {
    constructor() {
        this.masterController = null;
        this.instrumentLoader = null;
        this.telegramService = null;
        this.reportGenerator = new ReportGenerator();
        
        this.strategies = new Map();
        this.allTrades = [];
        this.performanceLogPath = path.resolve(__dirname, '../data/performance_log.json');
    }

    async initialize() {
        await this.downloadInstrumentFile();
        this.instrumentLoader = new InstrumentLoader();
        await this.instrumentLoader.loadInstruments();
        console.log("✅ Instruments loaded successfully.");

        this.masterController = new MasterController();
        this.telegramService = new TelegramService();
        await this.masterController.initialize();
        await this.telegramService.sendMessage("✅ *AlphaTrader Bot is starting up...*");

        this.buildStrategies();
    }
    
    buildStrategies() {
        console.log("\n🏗️ Building strategy permutations...");
        TRADING_UNIVERSE.forEach(universeItem => {
            universeItem.strategy_types.forEach(strategyTypeName => {
                const definition = STRATEGY_DEFINITIONS[strategyTypeName];
                if (!definition) return;

                const StrategyClass = require(path.resolve(__dirname, `../strategies/${definition.strategyFile}`));

                definition.parameters.forEach(params => {
                    const strategyId = `${universeItem.underlying}_${strategyTypeName}_${params.timeframe}`;
                    const fullConfig = { ...universeItem, ...definition.defaults, ...params, strategyId };
                    
                    const strategyInstance = new StrategyClass(this.masterController, fullConfig, this.instrumentLoader, this.telegramService);
                    
                    strategyInstance.on('tradeCompleted', (tradeData) => {
                        this.allTrades.push(tradeData);
                    });

                    this.strategies.set(strategyId, strategyInstance);
                    console.log(`  - Created strategy: ${strategyId}`);
                });
            });
        });
    }
    
    async run() {
        for (const [id, strategy] of this.strategies) {
            console.log(`\n▶️ Initializing strategy: ${id}`);
            await strategy.initialize();
            this.masterController.registerStrategy(strategy);
        }
        
        this.masterController.subscribeToTokens();
    }

    async shutdown() {
        console.log("\n\n🛑 Gracefully shutting down the bot...");
        await this.telegramService.sendMessage("⏳ *Bot is shutting down...*");

        if (this.masterController) this.masterController.disconnectWebSocket();
        this.logPerformance();
        
        if (this.allTrades.length > 0) {
            try {
                const reportPath = await this.reportGenerator.generateTradeReport(this.allTrades);
                await this.telegramService.sendReport(reportPath, "Final trade report.");
            } catch (e) {
                console.error("❌ Failed to generate or send report:", e);
            }
        } else {
            await this.telegramService.sendMessage("Bot session ended. No trades were executed.");
        }
        
        console.log("\n👋 Goodbye!");
    }

    logPerformance() {
        console.log("💾 Logging strategy performance...");
        const performanceData = this.loadPerformanceLog();
        const today = new Date().toISOString().slice(0, 10);

        this.strategies.forEach((strategy, id) => {
            const metrics = strategy.getPerformanceMetrics();
            if (metrics.totalTrades > 0) { // Only log if there were trades
                if (!performanceData[id]) performanceData[id] = [];
                const todayIndex = performanceData[id].findIndex(d => d.date === today);
                if (todayIndex > -1) {
                    performanceData[id][todayIndex] = { date: today, ...metrics };
                } else {
                    performanceData[id].push({ date: today, ...metrics });
                }
            }
        });

        fs.writeFileSync(this.performanceLogPath, JSON.stringify(performanceData, null, 2));
        console.log("✅ Performance log updated.");
    }

    loadPerformanceLog() {
        if (fs.existsSync(this.performanceLogPath)) {
            return JSON.parse(fs.readFileSync(this.performanceLogPath, 'utf8'));
        }
        return {};
    }
    
    async downloadInstrumentFile() {
        const instrumentFileUrl = 'https://smartapi.angelbroking.com/publisher/scripMaster';
        const dataDir = path.resolve(__dirname, '../data');
        if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
        const destinationPath = path.resolve(dataDir, 'instruments.json');
        try {
            const response = await axios.get(instrumentFileUrl, { responseType: 'json' });
            const currentData = JSON.stringify(response.data);
            if (fs.existsSync(destinationPath) && fs.readFileSync(destinationPath, 'utf8') === currentData) return;
            fs.writeFileSync(destinationPath, currentData);
        } catch (error) {
            if (!fs.existsSync(destinationPath)) throw error;
        }
    }
}

module.exports = Conductor;
