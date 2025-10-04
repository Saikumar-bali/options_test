// File: /advanced_trader_refactored/src/indicators/IndicatorCalculator.js
const { calculateSMA, calculateStandardDeviation, calculateRSI, calculateATR } = require('./utils.js');
const SupportResistance = require('./SupportResistance.js'); // Import the new module

class IndicatorCalculator {
    constructor(strategy) {
        this.strategy = strategy;
        this.config = strategy.config;
    }

    calculateAll(stock) {
        if (!stock.candles || stock.candles.length === 0) {
            return;
        }
        const closes = stock.candles.map(c => c.close);
        const { tradingParameters, srParameters } = this.config;
        
        // Bollinger Bands
        const { period: bbPeriod, stdDev } = tradingParameters.bollingerBands;
        const sma = calculateSMA(closes, bbPeriod);
        const standardDeviation = calculateStandardDeviation(closes, bbPeriod);
        if (sma !== null && standardDeviation !== null) {
            stock.bb = { middle: sma, upper: sma + (stdDev * standardDeviation), lower: sma - (stdDev * standardDeviation) };
        } else {
            stock.bb = null;
        }

        // RSI
        stock.rsi = calculateRSI(closes, tradingParameters.rsi.period);

        // ATR
        stock.atr = calculateATR(stock.candles, tradingParameters.atr.period);
        
        // S/R Levels (NEW)
        if (srParameters.enabled && stock.candles.length > 10) {
            stock.srLevels = SupportResistance.detectLevels(
                stock.candles,
                srParameters.sensitivity,
                srParameters.strengthThreshold
            );
        } else {
            stock.srLevels = [];
        }
    }
}

module.exports = IndicatorCalculator;