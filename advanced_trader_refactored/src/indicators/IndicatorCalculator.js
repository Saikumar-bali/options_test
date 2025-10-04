// File: /src/indicators/IndicatorCalculator.js

const { calculateRSI, calculateATR } = require('./utils.js');

class IndicatorCalculator {

    /**
     * Calculates all required initial indicators for a given instrument and attaches them to the instrument object.
     * @param {object} instrument - The stock/option object, which MUST have a `candles` array.
     * @param {object} config - The strategy's tradingParameters configuration.
     * @param {object} logger - The logger instance for logging debug messages.
     */
    static calculateAll(instrument, config, logger) {
        if (!instrument.candles || instrument.candles.length === 0) {
            logger.warn(`Cannot calculate indicators for ${instrument.symbol}: No candle data.`);
            return;
        }

        // 1. Calculate Bollinger Bands using the existing static method
        instrument.bb = this.getBollingerBands(
            instrument.candles,
            config.bb.period,
            config.bb.stdDev
        );

        // 2. Calculate RSI using the utility function
        const closes = instrument.candles.map(c => c.close);
        instrument.rsi = calculateRSI(closes, config.rsi.period);

        // 3. Calculate ATR using the utility function
        instrument.atr = calculateATR(instrument.candles, config.atr.period);
        
        if (logger && config.debugMode) {
            const bbMid = instrument.bb ? instrument.bb.middle.toFixed(2) : 'N/A';
            const rsiVal = instrument.rsi ? instrument.rsi.toFixed(2) : 'N/A';
            const atrVal = instrument.atr ? instrument.atr.toFixed(2) : 'N/A';
            logger.debug(`Indicators for ${instrument.symbol}: BB=${bbMid}, RSI=${rsiVal}, ATR=${atrVal}`);
        }
    }

    /**
     * A standalone function to calculate Bollinger Bands for any given candle set.
     * @param {Array<Object>} candles - An array of candle objects, each with open, high, low, close.
     * @param {number} period - The BB period, e.g., 20.
     * @param {number} stdDev - The standard deviation multiplier, e.g., 2.
     * @returns {object|null} An object with { upper, middle, lower } for the *latest* candle, or null.
     */
    static getBollingerBands(candles, period = 20, stdDev = 2) {
        if (!candles || candles.length < period) {
            return null; // Not enough data
        }

        const closes = candles.map(c => c.close);
        const relevantCloses = closes.slice(-period);

        const sma = relevantCloses.reduce((sum, val) => sum + val, 0) / period;
        
        const variance = relevantCloses.reduce((sum, val) => sum + Math.pow(val - sma, 2), 0) / period;
        const standardDeviation = Math.sqrt(variance);

        return {
            upper: sma + (standardDeviation * stdDev),
            middle: sma,
            lower: sma - (standardDeviation * stdDev)
        };
    }
}

module.exports = IndicatorCalculator;