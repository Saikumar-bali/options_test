// File: /advanced_trader_refactored/src/execution/TradeExecutor.js
const moment = require("moment-timezone");

class TradeExecutor {
    constructor(strategy) {
        this.strategy = strategy;
        this.logger = strategy.logger;
        this.config = strategy.config;
        this.positionManager = strategy.positionManager;
        this.riskManager = strategy.riskManager;
        this.telegramService = strategy.telegramService;
    }

    checkEntryConditions(stock, ltp) {
        // Strategy 1: Bollinger Band + RSI Breakout
        let reason = this.checkBbRsiEntry(stock, ltp);
        if (reason) {
            this.executeBuy(stock, ltp, reason);
            return;
        }

        // Strategy 2: Support/Resistance Breakout
        reason = this.checkSrBreakoutEntry(stock, ltp);
        if (reason) {
            this.executeBuy(stock, ltp, reason);
        }
    }

    checkBbRsiEntry(stock, ltp) {
        if (!stock.bb || stock.rsi === null) return null;
        const { rsi } = this.config.tradingParameters;

        if (stock.option_type === "CE" && ltp > stock.bb.upper && stock.rsi > rsi.callBuyThreshold) {
            return "BB_RSI_Breakout_CE";
        }
        if (stock.option_type === "PE" && ltp < stock.bb.lower && stock.rsi < rsi.putBuyThreshold) {
            return "BB_RSI_Breakout_PE";
        }
        return null;
    }

    checkSrBreakoutEntry(stock, ltp) {
        const { srParameters } = this.config;
        if (!srParameters.enabled || !stock.srLevels || stock.srLevels.length === 0) {
            return null;
        }
        const recentCandles = stock.candles.slice(-srParameters.breakoutConfirmationCandles);
        if (recentCandles.length < srParameters.breakoutConfirmationCandles) return null;

        for (const level of stock.srLevels) {
            // Resistance Breakout (Buy CE)
            if (stock.option_type === 'CE' && level.type === 'resistance' && ltp > level.level) {
                if (recentCandles.every(c => c.close > level.level)) {
                    return `Resistance Breakout @${level.level.toFixed(2)}`;
                }
            }
            // Support Breakdown (Buy PE)
            if (stock.option_type === 'PE' && level.type === 'support' && ltp < level.level) {
                if (recentCandles.every(c => c.close < level.level)) {
                    return `Support Breakdown @${level.level.toFixed(2)}`;
                }
            }
        }
        return null;
    }

    // ... (checkExitConditions remains the same) ...
    checkExitConditions(stock, ltp, position) {
        let exitReason = null;
        if (stock.option_type === "CE" && ltp <= position.slPrice) exitReason = "StopLoss Hit (CE)";
        if (stock.option_type === "PE" && ltp >= position.slPrice) exitReason = "StopLoss Hit (PE)";
        if (!exitReason && stock.option_type === "CE" && ltp >= position.tpPrice) exitReason = "TakeProfit Hit (CE)";
        if (!exitReason && stock.option_type === "PE" && ltp <= position.tpPrice) exitReason = "TakeProfit Hit (PE)";
        
        if (exitReason) this.executeSell(stock, ltp, position, exitReason);
    }


    executeBuy(stock, price, reason) {
        const { tradingParameters, riskManagement, srParameters } = this.config;
        const quantity = parseInt(stock.lotsize || riskManagement.defaultQuantity.toString());
        if (quantity <= 0) return;

        const atrVal = stock.atr || price * 0.02; // Fallback ATR
        let slPrice, tpPrice;

        // Default ATR-based SL/TP
        if (stock.option_type === "CE") {
            slPrice = price - (atrVal * tradingParameters.atr.slMultiplier);
            tpPrice = price + (atrVal * tradingParameters.atr.tpMultiplier);
        } else { // PE
            slPrice = price + (atrVal * tradingParameters.atr.slMultiplier);
            tpPrice = price - (atrVal * tradingParameters.atr.tpMultiplier);
        }

        // S/R based TP override
        if (srParameters.enabled && stock.srLevels && stock.srLevels.length > 0) {
            const oppositeType = stock.option_type === 'CE' ? 'resistance' : 'support';
            const potentialTargets = stock.srLevels
                .filter(l => l.type === oppositeType && (stock.option_type === 'CE' ? l.level > price : l.level < price))
                .sort((a, b) => stock.option_type === 'CE' ? a.level - b.level : b.level - a.level);

            if (potentialTargets.length > 0) {
                tpPrice = potentialTargets[0].level;
                this.logger.debug(`TP for ${stock.symbol} set by S/R level: ${tpPrice}`);
            }
        }

        const newPosition = { /* ... as before ... */ };
        // ... rest of the function ...
    }
    
    // ... (executeSell remains the same) ...
}

module.exports = TradeExecutor;