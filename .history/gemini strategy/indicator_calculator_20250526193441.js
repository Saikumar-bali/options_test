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
const calculateATR = (candles, period = 14) => {
    if (!candles || candles.length < period + 1) return null; // Need n+1 candles for n TR values

    const trValues = [];
    // Start from the (length - period)-th candle to get 'period' TR values.
    for (let i = candles.length - period; i < candles.length; i++) {
        const high = candles[i].high;
        const low = candles[i].low;
        const prevClose = candles[i - 1].close;
        const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
        trValues.push(tr);
    }

    if (trValues.length === 0) return null;
    return trValues.reduce((sum, val) => sum + val, 0) / trValues.length;
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