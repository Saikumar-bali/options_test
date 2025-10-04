// D:\master_controller\advanced_strategy\utils.js

const calculateSMA = (data, period) => {
    if (data.length < period) return null;
    const sum = data.slice(-period).reduce((acc, val) => acc + val, 0);
    return sum / period;
};

const calculateStandardDeviation = (data, period) => {
    if (data.length < period) return null;
    const slice = data.slice(-period);
    const mean = slice.reduce((acc, val) => acc + val, 0) / period;
    const variance = slice.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / period;
    return Math.sqrt(variance);
};

const calculateRSI = (closes, period = 14) => {
    if (closes.length <= period) return null;

    let gains = 0;
    let losses = 0;

    for (let i = closes.length - period; i < closes.length; i++) {
        const diff = closes[i] - closes[i - 1];
        if (diff > 0) {
            gains += diff;
        } else {
            losses -= diff; // losses are positive
        }
    }

    const avgGain = gains / period;
    const avgLoss = losses / period;

    if (avgLoss === 0) return 100; // Avoid division by zero

    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
};

const calculateATR = (candles, period = 14) => {
    if (!candles || candles.length < period + 1) return null; // Need n+1 candles for n TR values
    const trValues = [];
    for (let i = candles.length - period -1 ; i < candles.length -1; i++) {
        const high = candles[i+1].high;
        const low = candles[i+1].low;
        const prevClose = candles[i].close;
        const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
        trValues.push(tr);
    }
    if (trValues.length === 0) return null;
    return trValues.reduce((sum, val) => sum + val, 0) / trValues.length;
};


const getOptionType = (symbol) => {
    if (symbol.toUpperCase().includes("CE")) return "CE";
    if (symbol.toUpperCase().includes("PE")) return "PE";
    return null;
};

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

module.exports = {
    calculateSMA,
    calculateStandardDeviation,
    calculateRSI,
    calculateATR,
    getOptionType,
    delay
};