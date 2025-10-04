// File: /src/execution/TradeExecutor.js
const moment = require("moment-timezone");
const IndicatorCalculator = require('../indicators/IndicatorCalculator');

class TradeExecutor {
    constructor(strategy) {
        this.strategy = strategy;
        this.logger = strategy.logger;
        this.config = strategy.config;
        this.positionManager = strategy.positionManager;
        this.riskManager = strategy.riskManager;
        this.telegramService = strategy.telegramService;
        this.candleManager = strategy.candleManager;
        
        // Proximity factor for checking if price is "at" an S/R level
        this.proximityFactor = (this.config.preMarketAnalysis.sr_calculation_parameters.proximity_to_sr_percent || 0.3) / 100;
    }

    checkEntryConditions(instrument, ltp) {
        // Step 1: Check if the tick is for an UNDERLYING
        const srLevels = this.strategy.underlyingSR.get(instrument.symbol);
        if (srLevels) {
            // Check for touches on Support levels
            for (const level of srLevels.supports) {
                if (Math.abs(ltp - level) <= (ltp * this.proximityFactor)) {
                    this.activateSignals(instrument.symbol, 'BULLISH_SR', level);
                }
            }
            // Check for touches on Resistance levels
            for (const level of srLevels.resistances) {
                if (Math.abs(ltp - level) <= (ltp * this.proximityFactor)) {
                    this.activateSignals(instrument.symbol, 'BEARISH_SR', level);
                }
            }
            return; // Done processing the underlying tick
        }

        // Step 2: Check if the tick is for an OPTION that has an active signal
        const signal = this.strategy.activeTradeSignals.get(instrument.token);
        if (signal) {
            this.logger.info(`✅ Signal Active for ${instrument.symbol}. Reason: ${signal.reason}. Checking BB entry...`);
            
            const candles = this.candleManager.getCandles(instrument.token);
            if (!candles || candles.length < 20) {
                this.logger.warn(`Not enough candles for ${instrument.symbol} to calculate BB.`);
                return;
            }

            const bb = IndicatorCalculator.getBollingerBands(candles, 20, 2);
            if (!bb) return;

            // ENTRY TRIGGER: Price touches or goes below the lower Bollinger Band
            if (ltp <= bb.lower) {
                this.logger.info(`🎯 BB Entry Trigger MET for ${instrument.symbol}. LTP: ${ltp}, Lower BB: ${bb.lower.toFixed(2)}.`);
                this.executeBuy(instrument, ltp, signal.reason);
                // Deactivate signal after entry to prevent re-entry
                this.strategy.activeTradeSignals.delete(instrument.token);
            }
        }
    }

    // This helper function "activates" the corresponding options when an underlying hits S/R
    activateSignals(underlyingSymbol, signalType, level) {
        this.strategy.watchlist.forEach(option => {
            if (option.name === underlyingSymbol && option.signal_type === signalType && option.trigger_level === level) {
                if (!this.strategy.activeTradeSignals.has(option.token)) {
                    const reason = `Underlying ${underlyingSymbol} at ${signalType.split('_')[0]} level ${level.toFixed(2)}`;
                    this.strategy.activeTradeSignals.set(option.token, { reason });
                    this.logger.info(`🔔 Activating trade signal for ${option.symbol}. Reason: ${reason}`);
                }
            }
        });
    }

    checkExitConditions(instrument, ltp, position) {
        if (ltp <= position.slPrice) {
            this.executeSell(instrument, ltp, position, `Stoploss Hit`);
        } else if (ltp >= position.tpPrice) {
            this.executeSell(instrument, ltp, position, `Take Profit Hit`);
        }
    }

    executeBuy(stock, price, reason) {
        if (this.riskManager.isTradingHalted() || this.positionManager.getPosition(stock.token)) {
            return;
        }
        
        const quantity = this.config.riskManagement.defaultQuantity;
        const slPrice = price * (1 - this.config.tradingParameters.atr.slMultiplier / 100); // Example SL
        const tpPrice = price * (1 + this.config.tradingParameters.atr.tpMultiplier / 100); // Example TP
        
        const newPosition = {
            token: stock.token, symbol: stock.symbol, option_type: stock.instrument_type, quantity,
            buyPrice: price, buyTime: moment.tz("Asia/Kolkata"),
            slPrice: Math.max(0.05, slPrice), tpPrice: Math.max(0.10, tpPrice),
            exch_seg: stock.exch_seg, expiry: stock.expiry_date ? moment(stock.expiry_date) : null,
        };

        this.positionManager.addPosition(newPosition);
        const alertMsg = `🟢 BUY ${stock.symbol} Q:${quantity} @${price.toFixed(2)} | SL:${newPosition.slPrice.toFixed(2)} TP:${newPosition.tpPrice.toFixed(2)} | Reason: ${reason}`;
        this.telegramService.sendAlert(alertMsg);
        this.logger.logTrade({ ...newPosition, action: 'BUY', reason, dailyPnl: this.riskManager.getPnL() });
        this.riskManager.startCooldown(stock.token);
    }

    executeSell(stock, price, position, reason) {
        this.positionManager.removePosition(stock.token);
        const pnl = (price - position.buyPrice) * position.quantity;
        this.riskManager.updatePnl(pnl);

        const alertMsg = `🔴 SELL ${stock.symbol} Q:${position.quantity} @${price.toFixed(2)} | P&L: ₹${pnl.toFixed(2)} | Day P&L: ₹${this.riskManager.getPnL().toFixed(2)}`;
        this.telegramService.sendAlert(alertMsg);
        this.logger.logTrade({ ...position, sellPrice: price, pnl, action: 'SELL', reason, dailyPnl: this.riskManager.getPnL() });
    }
}

module.exports = TradeExecutor;