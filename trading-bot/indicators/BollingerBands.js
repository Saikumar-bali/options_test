// File: /trading-bot/indicators/BollingerBands.js

const { BollingerBands } = require('technicalindicators');

class BollingerBandsIndicator {
    /**
     * Calculates Bollinger Bands for a series of prices.
     * @param {Array<number>} prices - An array of closing prices.
     * @param {Object} params - Parameters { period, stdDev }.
     * @returns {Array<Object>} - An array of BB objects { upper, middle, lower }.
     */
    static calculate(prices, params = { period: 20, stdDev: 2 }) {
        if (!prices || prices.length < params.period) {
            console.warn("Not enough price data for Bollinger Bands calculation.");
            return [];
        }

        const bbInput = {
            period: params.period,
            values: prices,
            stdDev: params.stdDev
        };

        return BollingerBands.calculate(bbInput);
    }
}

module.exports = BollingerBandsIndicator;
