// File: /trading-bot/strategies/BaseStrategy.js

const EventEmitter = require('events');

class BaseStrategy extends EventEmitter {
    constructor(masterController, config, instrumentLoader, telegramService) {
        super();
        if (this.constructor === BaseStrategy) {
            throw new Error("BaseStrategy cannot be instantiated directly.");
        }
        
        this.masterController = masterController;
        this.config = config;
        this.instrumentLoader = instrumentLoader;
        this.telegramService = telegramService;
        this.strategyId = config.strategyId;
        this.trades = [];
    }
    
    async initialize() { throw new Error("Method 'initialize()' must be implemented."); }
    getTokensToTrack() { throw new Error("Method 'getTokensToTrack()' must be implemented."); }
    processData(tick) { throw new Error("Method 'processData()' must be implemented."); }

    logTrade(tradeData) {
        const fullTradeData = { ...tradeData, strategyId: this.strategyId };
        this.trades.push(fullTradeData);
        this.emit('tradeCompleted', fullTradeData);
    }

    getPerformanceMetrics() {
        const totalTrades = this.trades.length;
        if (totalTrades === 0) {
            return { pnl: 0, wins: 0, losses: 0, winRate: 0, totalTrades: 0 };
        }

        const pnl = this.trades.reduce((sum, trade) => sum + trade.profit, 0);
        const wins = this.trades.filter(trade => trade.profit > 0).length;
        const losses = totalTrades - wins;
        const winRate = (wins / totalTrades) * 100;

        return {
            pnl: parseFloat(pnl.toFixed(2)),
            wins,
            losses,
            winRate: parseFloat(winRate.toFixed(2)),
            totalTrades
        };
    }
}

module.exports = BaseStrategy;
