// File: /option_level_trader/indicators/ATR.js
const technicalIndicators = require('technicalindicators');

class ATR {
    /**
     * Calculate ATR for a given set of candles.
     * @param {Array} candles - Array of candles (objects with high, low, close or arrays [timestamp, open, high, low, close, volume])
     * @param {number} period - ATR period (default 14)
     * @returns {number|null} - The latest ATR value or null if calculation fails
     */
    static calculate(candles, period = 14) {
        if (!candles || candles.length < period + 1) {
            return null;
        }

        // Normalize candles to the format expected by technicalindicators
        // Input can be array of objects {high, low, close} or array of arrays [t, o, h, l, c, v]
        const high = [];
        const low = [];
        const close = [];

        candles.forEach(c => {
            if (Array.isArray(c)) {
                // Assuming format: [timestamp, open, high, low, close, volume]
                high.push(Number(c[2]));
                low.push(Number(c[3]));
                close.push(Number(c[4]));
            } else {
                // Assuming object format
                high.push(Number(c.high));
                low.push(Number(c.low));
                close.push(Number(c.close));
            }
        });

        const input = {
            high: high,
            low: low,
            close: close,
            period: period
        };

        try {
            const atrValues = technicalIndicators.ATR.calculate(input);
            if (atrValues && atrValues.length > 0) {
                return atrValues[atrValues.length - 1];
            }
        } catch (error) {
            console.error("Error calculating ATR:", error);
        }

        return null;
    }

    /**
     * Calculate Stop Loss and Target based on ATR.
     * @param {number} entryPrice - Entry price of the trade
     * @param {number} atr - ATR value
     * @param {string} direction - 'LONG' or 'SHORT'
     * @param {number} slMultiplier - Multiplier for Stop Loss (default 1.5)
     * @param {number} targetMultiplier - Multiplier for Target (default 2.0)
     * @returns {object} - { stopLoss, target }
     */
    static calculateLevels(entryPrice, atr, direction, slMultiplier = 1.5, targetMultiplier = 2.0) {
        let stopLoss, target;

        if (direction === 'LONG') {
            stopLoss = entryPrice - (atr * slMultiplier);
            target = entryPrice + (atr * targetMultiplier);
        } else {
            stopLoss = entryPrice + (atr * slMultiplier);
            target = entryPrice - (atr * targetMultiplier);
        }

        return { stopLoss, target };
    }
}

module.exports = ATR;
