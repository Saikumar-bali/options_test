// File: /trading-bot/indicators/MACD.js

const { MACD } = require('technicalindicators');

class MACDIndicator {
    /**
     * Calculates Moving Average Convergence Divergence (MACD).
     * @param {Array<number>} prices - An array of closing prices.
     * @param {Object} params - { fast, slow, signal } periods.
     * @returns {Array<Object>} - An array of MACD objects { MACD, signal, histogram }.
     */
    static calculate(prices, params = { fast: 12, slow: 26, signal: 9 }) {
        if (!prices || prices.length < params.slow) {
            console.warn("Not enough price data for MACD calculation.");
            return [];
        }

        const macdInput = {
            values: prices,
            fastPeriod: params.fast,
            slowPeriod: params.slow,
            signalPeriod: params.signal,
            SimpleMAOscillator: false,
            SimpleMASignal: false
        };

        return MACD.calculate(macdInput);
    }
}

module.exports = MACDIndicator;
