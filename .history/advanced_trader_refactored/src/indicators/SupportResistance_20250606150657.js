// File: /src/indicators/SupportResistance.js
const moment = require('moment-timezone');

class SupportResistance {
    /**
     * Finds the most powerful price levels and contextually classifies them as Support or Resistance.
     * @param {Array} candles - An array of candle objects { high, low }.
     * @param {number} currentPrice - The current or last closing price to determine context.
     * @param {object} params - Configuration parameters.
     * @returns {object} An object containing two arrays: { supports: [], resistances: [] }.
     */
    static detectLevels(candles, currentPrice, params = { reactionLookback: 5, levelsToReturn: 10 }) {
        if (!candles || candles.length < (params.reactionLookback + 1) || !currentPrice) {
            return { supports: [], resistances: [] };
        }

        const pivots = [];
        // 1. Find all local turning points (pivots)
        for (let i = 1; i < candles.length - params.reactionLookback; i++) {
            const isSupport = candles[i].low < candles[i - 1].low && candles[i].low < candles[i + 1].low;
            const isResistance = candles[i].high > candles[i - 1].high && candles[i].high > candles[i + 1].high;

            if (isSupport) {
                let reactionHigh = candles[i].low;
                for (let j = 1; j <= params.reactionLookback; j++) {
                    reactionHigh = Math.max(reactionHigh, candles[i + j].high);
                }
                const reactionSize = reactionHigh - candles[i].low;
                pivots.push({ level: candles[i].low, reaction: reactionSize, initialType: 'support' });
            }
            if (isResistance) {
                let reactionLow = candles[i].high;
                for (let j = 1; j <= params.reactionLookback; j++) {
                    reactionLow = Math.min(reactionLow, candles[i + j].low);
                }
                const reactionSize = candles[i].high - reactionLow;
                pivots.push({ level: candles[i].high, reaction: reactionSize, initialType: 'resistance' });
            }
        }
        
        // 2. Rank all pivots by the size of the price reaction they caused
        const rankedPivots = pivots.sort((a, b) => b.reaction - a.reaction);

        // 3. Get the top N unique levels to avoid clutter
        const topLevels = this.getUniqueTopLevels(rankedPivots, params.levelsToReturn);
        
        // 4. *** FINAL FIX: Contextually classify these powerful levels ***
        const supports = [];
        const resistances = [];

        for (const pivot of topLevels) {
            if (pivot.level < currentPrice) {
                // Any powerful level below the current price is SUPPORT
                supports.push({ ...pivot, type: 'support' });
            } else {
                // Any powerful level above the current price is RESISTANCE
                resistances.push({ ...pivot, type: 'resistance' });
            }
        }
        
        return { supports, resistances };
    }

    static getUniqueTopLevels(levels, count) {
        const uniqueLevels = [];
        for (const level of levels) {
            if (uniqueLevels.length >= count) break;
            const isTooClose = uniqueLevels.some(uniqueLevel => Math.abs(uniqueLevel.level - level.level) / level.level < 0.005);
            if (!isTooClose) {
                uniqueLevels.push(level);
            }
        }
        return uniqueLevels;
    }
}
module.exports = SupportResistance;