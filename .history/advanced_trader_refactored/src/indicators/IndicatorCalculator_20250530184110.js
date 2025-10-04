// File: /advanced_trader_refactored/src/indicators/IndicatorCalculator.js
const { calculateSMA, calculateStandardDeviation, calculateRSI, calculateATR } = require('./utils.js');

class IndicatorCalculator {
    constructor(strategy) {
        this.strategy = strategy;
        this.config = strategy.config.tradingParameters;
    }

    calculateAll(stock) {
        if (!stock.candles || stock.candles.length === 0) {
            return;
        }
        const closes = stock.candles.map(c => c.close);
        
        // Bollinger Bands
        const { period: bbPeriod, stdDev } = this.config.bollingerBands;
        const sma = calculateSMA(closes, bbPeriod);
        const standardDeviation = calculateStandardDeviation(closes, bbPeriod);
        if (sma !== null && standardDeviation !== null) {
            stock.bb = {
                middle: sma,
                upper: sma + (stdDev * standardDeviation),
                lower: sma - (stdDev * standardDeviation),
            };
        } else {
            stock.bb = null;
        }

        // RSI
        stock.rsi = calculateRSI(closes, this.config.rsi.period);

        // ATR
        stock.atr = calculateATR(stock.candles, this.config.atr.period);
    }
}

module.exports = IndicatorCalculator;