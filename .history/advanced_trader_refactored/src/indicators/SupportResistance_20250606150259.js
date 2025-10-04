// File: /src/indicators/SupportResistance.js

class SupportResistance {
    /**
     * Finds the single most relevant Support and Resistance level based on the current price.
     * @param {Array} candles - An array of candle objects { high, low }.
     * @param {number} currentPrice - The current or last closing price to determine context.
     * @param {object} params - Configuration parameters.
     * @returns {object} An object containing the single best support and resistance: { support: {}, resistance: {} }.
     */
    static detectLevels(candles, currentPrice, params = { reactionLookback: 5, levelsToReturn: 10 }) {
        const initialState = { support: null, resistance: null };
        if (!candles || candles.length < (params.reactionLookback + 1) || !currentPrice) {
            return initialState;
        }

        const pivots = [];
        // 1. Find all local turning points (pivots)
        for (let i = 1; i < candles.length - params.reactionLookback; i++) {
            const isSupportPivot = candles[i].low < candles[i - 1].low && candles[i].low < candles[i + 1].low;
            const isResistancePivot = candles[i].high > candles[i - 1].high && candles[i].high > candles[i + 1].high;

            if (isSupportPivot) {
                let reactionHigh = candles[i].low;
                for (let j = 1; j <= params.reactionLookback; j++) {
                    reactionHigh = Math.max(reactionHigh, candles[i + j].high);
                }
                const reactionSize = reactionHigh - candles[i].low;
                pivots.push({ level: candles[i].low, reaction: reactionSize, type: 'support' });
            }
            if (isResistancePivot) {
                let reactionLow = candles[i].high;
                for (let j = 1; j <= params.reactionLookback; j++) {
                    reactionLow = Math.min(reactionLow, candles[i + j].low);
                }
                const reactionSize = candles[i].high - reactionLow;
                pivots.push({ level: candles[i].high, reaction: reactionSize, type: 'resistance' });
            }
        }
        
        if (pivots.length === 0) return initialState;

        // 2. ** THE FINAL LOGIC: Find the nearest support and resistance to the current price **
        const potentialSupports = pivots.filter(p => p.level < currentPrice);
        const potentialResistances = pivots.filter(p => p.level > currentPrice);

        if (potentialSupports.length === 0 || potentialResistances.length === 0) {
            return initialState; // We need both a floor and a ceiling to trade
        }

        // Find the highest support level (the floor closest to the price)
        const bestSupport = potentialSupports.reduce((best, current) => (current.level > best.level) ? current : best, potentialSupports[0]);
        
        // Find the lowest resistance level (the ceiling closest to the price)
        const bestResistance = potentialResistances.reduce((best, current) => (current.level < best.level) ? current : best, potentialResistances[0]);

        return { support: bestSupport, resistance: bestResistance };
    }
}

module.exports = SupportResistance;