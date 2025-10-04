// File: /advanced_trader_refactored/src/core/MarketManager.js
const moment = require("moment-timezone");
const { delay } = require("../indicators/utils");

class MarketManager {
    constructor(strategy) {
        this.strategy = strategy;
        this.logger = strategy.logger;
        this.config = strategy.config;
        this.masterController = strategy.masterController;
    }

    async initialize() {
        const currentTime = moment.tz("Asia/Kolkata");
        const marketOpenTime = this.getTimeFor("open");
        const marketCloseTime = this.getTimeFor("close");
        const eodTaskTime = this.getTimeFor("eod");

        if (currentTime.isBefore(marketOpenTime)) {
            const waitTime = marketOpenTime.diff(currentTime);
            this.logger.info(`🕒 Waiting ${moment.duration(waitTime).humanize()} for market open...`);
            setTimeout(() => this.startMarketActivities(), waitTime);
        } else if (currentTime.isBetween(marketOpenTime, marketCloseTime)) {
            this.logger.info("📈 Market is open. Starting activities...");
            this.startMarketActivities();
        } else {
            this.logger.info("📅 Market is closed. Running EOD tasks if needed.");
            await this.strategy.reportGenerator.generate();
        }

        if (currentTime.isBefore(eodTaskTime)) {
            const eodDelay = eodTaskTime.diff(currentTime);
            setTimeout(() => this.runEodTasks(), eodDelay);
        }
    }
    
    async startMarketActivities() {
        this.logger.info("🚀 Starting market activities...");
        await this.strategy.dataHandler.fetchAllHistoricalData();
        this.strategy.stocks.forEach(stock => this.strategy.indicatorCalculator.calculateAll(stock));
        this.strategy.candleManager.scheduleCandleUpdates();
    }
    
    async runEodTasks() {
        this.logger.info("🌙 Performing EOD tasks...");
        await this.closeAllOpenPositions("EOD Square Off");
        await this.strategy.reportGenerator.generate(true);
        this.logger.info("✅ EOD tasks completed.");
    }
    
    async closeAllOpenPositions(reason) {
        this.logger.info(`🕒 Closing all open positions. Reason: ${reason}`);
        this.strategy.riskManager.tradingHalted = true; // Halt new trades during square-off

        const openPositions = this.strategy.positionManager.getAllPositions();
        for (const position of openPositions) {
            const stock = this.strategy.stocks.find(s => s.token === position.token) || position;
            const lastLTP = this.strategy.candleManager.getLtp(position.token) || position.buyPrice;
            await this.strategy.tradeExecutor.executeSell(stock, lastLTP, position, reason);
            await delay(200);
        }
    }

    getTimeFor(type) {
        const { marketHours } = this.config;
        let hour, minute;
        if (type === "open" || type === "close") {
            [hour, minute] = marketHours[type].split(':');
        } else { // eod
            hour = marketHours.eodTaskHour;
            minute = marketHours.eodTaskMinute;
        }
        return moment.tz("Asia/Kolkata").set({ hour: parseInt(hour), minute: parseInt(minute), second: 0 });
    }
}

module.exports = MarketManager;