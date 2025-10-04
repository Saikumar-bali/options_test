// File: /src/indicators/SupportResistance.js

class SupportResistance {
    /**
     * Detects the most significant S/R levels based on a more reliable pivot detection method
     * and the magnitude of the price reaction following them.
     * @param {Array} candles - An array of candle objects { high, low }.
     * @param {object} params - Configuration parameters.
     * @param {number} params.reactionLookback - How many candles to look forward to measure the price reaction.
     * @param {number} params.levelsToReturn - How many of the top support and resistance levels to return.
     * @returns {object} An object containing two arrays: { supports: [], resistances: [] }.
     */
    static detectLevels(candles, params = { reactionLookback: 5, levelsToReturn: 5 }) {
        if (!candles || candles.length < (params.reactionLookback + 1)) return { supports: [], resistances: [] };

        const pivots = [];
        // ** FINAL FIX: Use a more reliable 3-candle pivot detection method **
        // A pivot is a local minimum/maximum.
        for (let i = 1; i < candles.length - params.reactionLookback; i++) {
            
            const isSupport = candles[i].low < candles[i - 1].low && candles[i].low < candles[i + 1].low;
            const isResistance = candles[i].high > candles[i - 1].high && candles[i].high > candles[i + 1].high;

            if (isSupport) {
                let reactionHigh = candles[i].low;
                for (let j = 1; j <= params.reactionLookback; j++) {
                    reactionHigh = Math.max(reactionHigh, candles[i + j].high);
                }
                const reactionSize = reactionHigh - candles[i].low;
                pivots.push({ level: candles[i].low, type: 'support', reaction: reactionSize });
            }
            if (isResistance) {
                let reactionLow = candles[i].high;
                for (let j = 1; j <= params.reactionLookback; j++) {
                    reactionLow = Math.min(reactionLow, candles[i + j].low);
                }
                const reactionSize = candles[i].high - reactionLow;
                pivots.push({ level: candles[i].high, type: 'resistance', reaction: reactionSize });
            }
        }
        
        const supports = pivots.filter(p => p.type === 'support').sort((a, b) => b.reaction - a.reaction);
        const resistances = pivots.filter(p => p.type === 'resistance').sort((a, b) => b.reaction - a.reaction);

        const topSupports = this.getUniqueTopLevels(supports, params.levelsToReturn);
        const topResistances = this.getUniqueTopLevels(resistances, params.levelsToReturn);
        
        return { supports: topSupports, resistances: topResistances };
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