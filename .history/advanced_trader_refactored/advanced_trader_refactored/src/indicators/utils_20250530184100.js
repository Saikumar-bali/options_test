// File: /advanced_trader_refactored/src/indicators/utils.js
const calculateSMA = (data, period) => {
    if (data.length < period) return null;
    const relevantData = data.slice(-period);
    const sum = relevantData.reduce((acc, val) => acc + val, 0);
    return sum / period;
};

const calculateStandardDeviation = (data, period) => {
    if (data.length < period) return null;
    const relevantData = data.slice(-period);
    const mean = calculateSMA(relevantData, period);
    const squaredDiffs = relevantData.map(val => Math.pow(val - mean, 2));
    const avgSquaredDiff = calculateSMA(squaredDiffs, period);
    return Math.sqrt(avgSquaredDiff);
};

const calculateRSI = (data, period) => {
    if (data.length <= period) return null;
    let gains = 0;
    let losses = 0;
    for (let i = data.length - period; i < data.length; i++) {
        const diff = data[i] - data[i - 1];
        if (diff > 0) gains += diff;
        else losses -= diff;
    }
    const avgGain = gains / period;
    const avgLoss = losses / period;
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
};

const calculateATR = (candles, period) => {
    if (candles.length < period) return null;
    const trueRanges = [];
    for (let i = candles.length - period; i < candles.length; i++) {
        const high = candles[i].high;
        const low = candles[i].low;
        const prevClose = candles[i - 1]?.close || low;
        const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
        trueRanges.push(tr);
    }
    return calculateSMA(trueRanges, period);
};

const getOptionType = (symbol) => {
    if (!symbol) return null;
    if (symbol.toUpperCase().includes('CE')) return 'CE';
    if (symbol.toUpperCase().includes('PE')) return 'PE';
    return null;
};

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

module.exports = { calculateSMA, calculateStandardDeviation, calculateRSI, calculateATR, getOptionType, delay };