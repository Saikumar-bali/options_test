// File: /advanced_trader_refactored/src/core/RiskManager.js
class RiskManager {
    constructor(strategy) {
        this.strategy = strategy;
        this.logger = strategy.logger;
        this.config = strategy.config.riskManagement;
        this.telegramService = strategy.telegramService;

        this.dailyPnL = 0;
        this.tradingHalted = false;
        this.manualTradingHalt = false;
        this.cooldowns = new Map();
    }

    initializePnlFromPositions() {
        this.dailyPnL = this.strategy.positionManager.getAllPositions().reduce((acc, pos) => acc + (pos.pnl || 0), 0);
    }
    
    updatePnl(pnl) {
        this.dailyPnL += pnl;
        this.checkLimits();
    }
    
    getPnL() { return this.dailyPnL; }
    isTradingHalted() { return this.tradingHalted; }
    isManuallyHalted() { return this.manualTradingHalt; }

    checkLimits() {
        if (!this.config.haltTradingOnLimit || this.tradingHalted) return;

        if (this.dailyPnL <= this.config.maxDailyLoss) {
            this.tradingHalted = true;
            const msg = `🛑 TRADING HALTED: Max daily loss limit (₹${this.config.maxDailyLoss}) reached.`;
            this.telegramService.sendAlert(msg);
            this.logger.warn(msg);
        } else if (this.dailyPnL >= this.config.maxDailyProfit) {
            this.tradingHalted = true;
            const msg = `🎉 TRADING HALTED: Max daily profit limit (₹${this.config.maxDailyProfit}) reached.`;
            this.telegramService.sendAlert(msg);
            this.logger.info(msg);
        }
    }
    
    haltTrading() {
        this.tradingHalted = true;
        this.manualTradingHalt = true;
        this.telegramService.sendAlert("✋ Trading MANUALLY HALTED by user command.");
    }
    
    resumeTrading() {
         if (this.dailyPnL > this.config.maxDailyLoss && this.dailyPnL < this.config.maxDailyProfit) {
            this.tradingHalted = false;
            this.manualTradingHalt = false;
            this.telegramService.sendAlert("▶️ Trading RESUMED by user command.");
        } else {
            this.telegramService.sendAlert("⚠️ Cannot resume: Trading is halted by P&L limits.");
        }
    }

    startCooldown(token) {
        const cooldownMs = (this.config.tradeCooldownSeconds || 0) * 1000;
        if (cooldownMs > 0) {
            this.cooldowns.set(token, Date.now() + cooldownMs);
        }
    }
    
    isOnCooldown(token) {
        return this.cooldowns.has(token) && Date.now() < this.cooldowns.get(token);
    }
}

module.exports = RiskManager;