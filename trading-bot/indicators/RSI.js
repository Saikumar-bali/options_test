// File: /trading-bot/indicators/RSI.js

/**
 * Calculates the Relative Strength Index (RSI) for a series of candles.
 * @param {number} period - The number of periods to use for the RSI calculation (e.g., 14).
 * @param {Array<object>} candles - An array of historical candle data. Each object should have a 'close' property.
 * @returns {Array<number>} An array of RSI values. The last value in the array is the most recent RSI.
 */
function RSI(period, candles) {
    if (candles.length < period + 1) {
        console.warn("[RSI] Not enough candle data to calculate RSI. Required:", period + 1, "Available:", candles.length);
        return [];
    }

    let gains = 0;
    let losses = 0;
    const rsiValues = [];

    // Calculate initial average gains and losses
    for (let i = 1; i <= period; i++) {
        const change = candles[i].close - candles[i - 1].close;
        if (change > 0) {
            gains += change;
        } else {
            losses += Math.abs(change);
        }
    }

    let avgGain = gains / period;
    let avgLoss = losses / period;

    // Calculate first RSI
    let rs = avgGain / avgLoss;
    rsiValues.push(100 - (100 / (1 + rs)));

    // Calculate subsequent RSI values
    for (let i = period + 1; i < candles.length; i++) {
        const change = candles[i].close - candles[i - 1].close;
        let currentGain = 0;
        let currentLoss = 0;

        if (change > 0) {
            currentGain = change;
        } else {
            currentLoss = Math.abs(change);
        }

        avgGain = (avgGain * (period - 1) + currentGain) / period;
        avgLoss = (avgLoss * (period - 1) + currentLoss) / period;

        rs = avgGain / avgLoss;
        rsiValues.push(100 - (100 / (1 + rs)));
    }

    return rsiValues;
}

module.exports = { RSI };
