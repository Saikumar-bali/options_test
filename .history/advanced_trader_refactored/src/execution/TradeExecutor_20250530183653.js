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
        if (!stock.bb || stock.rsi === null || stock.atr === null) return;

        let reason = null;
        const { rsi, bollingerBands } = this.config.tradingParameters;

        if (stock.option_type === "CE" && ltp > stock.bb.upper && stock.rsi > rsi.callBuyThreshold) {
            reason = "BB_RSI_Breakout_CE";
        } else if (stock.option_type === "PE" && ltp < stock.bb.lower && stock.rsi < rsi.putBuyThreshold) {
            reason = "BB_RSI_Breakout_PE";
        }
        
        if (reason) this.executeBuy(stock, ltp, reason);
    }

    checkExitConditions(stock, ltp, position) {
        let exitReason = null;
        if (stock.option_type === "CE" && ltp <= position.slPrice) exitReason = "StopLoss Hit (CE)";
        if (stock.option_type === "PE" && ltp >= position.slPrice) exitReason = "StopLoss Hit (PE)";
        if (!exitReason && stock.option_type === "CE" && ltp >= position.tpPrice) exitReason = "TakeProfit Hit (CE)";
        if (!exitReason && stock.option_type === "PE" && ltp <= position.tpPrice) exitReason = "TakeProfit Hit (PE)";
        
        if (exitReason) this.executeSell(stock, ltp, position, exitReason);
    }

    executeBuy(stock, price, reason) {
        const { atr, riskManagement } = this.config;
        const quantity = parseInt(stock.lotsize || riskManagement.defaultQuantity.toString());
        if (quantity <= 0) return;
        
        const atrVal = stock.atr || price * 0.01; // Fallback ATR
        let slPrice, tpPrice;

        if (stock.option_type === "CE") {
            slPrice = price - (atrVal * atr.slMultiplier);
            tpPrice = price + (atrVal * atr.tpMultiplier);
        } else { // PE
            slPrice = price + (atrVal * atr.slMultiplier);
            tpPrice = price - (atrVal * atr.tpMultiplier);
        }

        const newPosition = {
            token: stock.token, symbol: stock.symbol, option_type: stock.option_type, quantity,
            buyPrice: price, buyTime: moment.tz("Asia/Kolkata"),
            slPrice: Math.max(0.05, slPrice), tpPrice: Math.max(0.10, tpPrice),
            exch_seg: stock.exch_seg, expiry: stock.expiry ? moment(stock.expiry) : null,
        };

        this.positionManager.addPosition(newPosition);
        const alertMsg = `🟢 BUY ${stock.symbol} Q:${quantity} @${price.toFixed(2)} | SL:${newPosition.slPrice.toFixed(2)} TP:${newPosition.tpPrice.toFixed(2)} | Reason: ${reason}`;
        this.telegramService.sendAlert(alertMsg);
        this.logger.logTrade({ ...newPosition, action: 'BUY', reason, dailyPnl: this.riskManager.getPnL() });
    }

    executeSell(stock, price, position, reason) {
        this.positionManager.removePosition(stock.token);
        const pnl = (price - position.buyPrice) * position.quantity * (position.option_type === "PE" ? -1 : 1);
        this.riskManager.updatePnl(pnl);

        const alertMsg = `🔴 SELL ${stock.symbol} Q:${position.quantity} @${price.toFixed(2)} | P&L: ₹${pnl.toFixed(2)} | Day P&L: ₹${this.riskManager.getPnL().toFixed(2)} | Reason: ${reason}`;
        this.telegramService.sendAlert(alertMsg);
        this.logger.logTrade({ ...position, action: 'SELL', price, pnl, reason, dailyPnl: this.riskManager.getPnL() });

        if (pnl < 0) this.riskManager.startCooldown(stock.token);
    }
}

module.exports = TradeExecutor;