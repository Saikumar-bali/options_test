// File: D:\master_controller\advanced_strategy\indicator_calculator.js

/**
 * Calculates the Simple Moving Average (SMA).
 * @param {number[]} data - Array of closing prices.
 * @param {number} period - The period for SMA calculation.
 * @returns {number | null} The SMA value or null.
 */
const calculateSMA = (data, period) => {
    if (!data || data.length < period) return null;
    const sum = data.slice(-period).reduce((acc, val) => acc + val, 0);
    return sum / period;
};

/**
 * Calculates the Standard Deviation.
 * @param {number[]} data - Array of closing prices.
 * @param {number} period - The period for calculation.
 * @returns {number | null} The Standard Deviation value or null.
 */
const calculateStandardDeviation = (data, period) => {
    if (!data || data.length < period) return null;
    const slice = data.slice(-period);
    const mean = calculateSMA(slice, period);
    if (mean === null) return null;
    const variance = slice.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / period;
    return Math.sqrt(variance);
};

/**
 * Calculates the Relative Strength Index (RSI).
 * @param {number[]} closes - Array of closing prices.
 * @param {number} [period=14] - The period for RSI calculation.
 * @returns {number | null} The RSI value or null.
 */
const calculateRSI = (closes, period = 14) => {
    if (!closes || closes.length <= period) return null;

    let gains = 0;
    let losses = 0;

    // Use a more standard RSI calculation (Exponential Moving Average is often preferred,
    // but we'll stick to a simple average for now, similar to your original code).
    for (let i = closes.length - period; i < closes.length; i++) {
        const diff = closes[i] - closes[i - 1];
        if (diff >= 0) {
            gains += diff;
        } else {
            losses -= diff; // losses are positive
        }
    }

    const avgGain = gains / period;
    const avgLoss = losses / period;

    if (avgLoss === 0) return 100; // Avoid division by zero, strong uptrend

    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
};

/**
 * Calculates the Average True Range (ATR).
 * @param {object[]} candles - Array of candle objects ({high, low, close}).
 * @param {number} [period=14] - The period for ATR calculation.
 * @returns {number | null} The ATR value or null.
 */
// In indicator_calculator.js
const calculateATR = (candles, period = 14) => {
    if (!candles || candles.length < period + 1) return null; // Need period + 1 for prevClose

    const trValues = [];
    for (let i = candles.length - period; i < candles.length; i++) {
        const currentCandle = candles[i];
        const prevCandle = candles[i - 1];

        if (!currentCandle || !prevCandle ||
            currentCandle.high === null || currentCandle.low === null || prevCandle.close === null ||
            !isFinite(currentCandle.high) || !isFinite(currentCandle.low) ||
            !isFinite(prevCandle.close)) {
            // Skip this TR or push 0 to avoid Infinity/NaN
            // Pushing 0 might slightly skew ATR if many candles are bad
            // Alternatively, if too many bad candles, consider returning null from ATR earlier
            trValues.push(0);
            continue;
        }

        const high = parseFloat(currentCandle.high);
        const low = parseFloat(currentCandle.low);
        const prevClose = parseFloat(prevCandle.close);

        const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));

        if (!isFinite(tr)) { // Should ideally not happen if inputs are filtered
            trValues.push(0);
        } else {
            trValues.push(tr);
        }
    }

    if (trValues.length === 0) return null;
    const sumTr = trValues.reduce((sum, val) => sum + val, 0);

    if (!isFinite(sumTr) || trValues.length === 0) return null;
    return sumTr / trValues.length;
};

/**
 * Calculates basic Support & Resistance levels based on recent highest high and lowest low.
 * @param {object[]} candles - Array of candle objects ({high, low}).
 * @param {number} [lookbackPeriod=50] - How many recent candles to consider.
 * @returns {{support: number | null, resistance: number | null}} S/R levels.
 */
const calculateSR = (candles, lookbackPeriod = 50) => {
    if (!candles || candles.length === 0) return { support: null, resistance: null };

    const recentCandles = candles.slice(-lookbackPeriod);
    if (recentCandles.length === 0) return { support: null, resistance: null };

    const highestHigh = Math.max(...recentCandles.map(c => c.high));
    const lowestLow = Math.min(...recentCandles.map(c => c.low));

    return { support: lowestLow, resistance: highestHigh };
};


module.exports = {
    calculateSMA,
    calculateStandardDeviation,
    calculateRSI,
    calculateATR,
    calculateSR
};