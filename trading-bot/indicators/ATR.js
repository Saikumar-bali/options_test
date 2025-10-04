// File: /trading-bot/indicators/ATR.js

/**
 * Calculates the True Range (TR) for a single candle.
 * TR is the greatest of:
 * 1. Current High - Current Low
 * 2. Absolute value of (Current High - Previous Close)
 * 3. Absolute value of (Current Low - Previous Close)
 * @param {object} currentCandle - { high, low, close }
 * @param {object} previousCandle - { high, low, close }
 * @returns {number} The True Range value.
 */
function calculateTrueRange(currentCandle, previousCandle) {
    const highLow = currentCandle.high - currentCandle.low;
    const highPrevClose = Math.abs(currentCandle.high - previousCandle.close);
    const lowPrevClose = Math.abs(currentCandle.low - previousCandle.close);
    return Math.max(highLow, highPrevClose, lowPrevClose);
}

/**
 * Calculates the Average True Range (ATR) for a series of candles.
 * @param {number} period - The number of periods to use for the ATR calculation (e.g., 14).
 * @param {Array<object>} candles - An array of historical candle data. Each object should have { high, low, close }.
 * @returns {Array<number>} An array of ATR values for each candle.
 */
function ATR(period, candles) {
    if (candles.length < period) {
        // Not enough data to calculate ATR, return an empty array or throw an error
        console.warn("[ATR] Not enough candle data to calculate ATR. Required:", period, "Available:", candles.length);
        return [];
    }

    let trValues = [];
    // First TR is just the high - low of the first candle in the provided data
    trValues.push(candles[0].high - candles[0].low);

    // Calculate TR for the rest of the candles
    for (let i = 1; i < candles.length; i++) {
        trValues.push(calculateTrueRange(candles[i], candles[i - 1]));
    }

    let atrValues = [];
    // Calculate the first ATR value, which is a simple average of the first 'period' TRs
    let firstAtr = trValues.slice(0, period).reduce((sum, val) => sum + val, 0) / period;
    atrValues.push(firstAtr);

    // Calculate subsequent ATR values using the smoothing formula
    for (let i = period; i < trValues.length; i++) {
        const previousAtr = atrValues[atrValues.length - 1];
        const currentAtr = ((previousAtr * (period - 1)) + trValues[i]) / period;
        atrValues.push(currentAtr);
    }

    return atrValues;
}

module.exports = { ATR };
