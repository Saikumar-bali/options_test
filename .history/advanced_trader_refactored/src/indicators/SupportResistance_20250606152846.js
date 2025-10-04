// File: /src/indicators/SupportResistance.js

class SupportResistance {
    /**
     * Finds the most powerful, explosive support and resistance levels based on historical reactions.
     * Support is a pivot low, measured by the subsequent bounce (low to high).
     * Resistance is a pivot high, measured by the subsequent rejection (high to low).
     * @param {Array} candles - An array of candle objects { high, low }.
     * @param {object} params - Configuration parameters.
     * @returns {object} An object with two arrays: { supports: [...], resistances: [...] }.
     */
    static detectLevels(candles, params = { reactionLookback: 5, levelsToReturn: 5 }) {
        const initialState = { supports: [], resistances: [] };
        if (!candles || candles.length < (params.reactionLookback + 1)) {
            return initialState;
        }

        const supports = [];
        const resistances = [];

        // 1. Find all local turning points and measure their reaction
        for (let i = 1; i < candles.length - params.reactionLookback; i++) {
            
            // Support pivot: A low with higher lows on both sides (V-shape)
            const isSupportPivot = candles[i].low < candles[i - 1].low && candles[i].low < candles[i + 1].low;
            if (isSupportPivot) {
                let reactionHigh = candles[i].low;
                for (let j = 1; j <= params.reactionLookback; j++) {
                    reactionHigh = Math.max(reactionHigh, candles[i + j].high);
                }
                const reactionSize = reactionHigh - candles[i].low;
                supports.push({ level: candles[i].low, type: 'support', reaction: reactionSize });
            }

            // Resistance pivot: A high with lower highs on both sides (A-shape)
            const isResistancePivot = candles[i].high > candles[i - 1].high && candles[i].high > candles[i + 1].high;
            if (isResistancePivot) {
                let reactionLow = candles[i].high;
                for (let j = 1; j <= params.reactionLookback; j++) {
                    reactionLow = Math.min(reactionLow, candles[i + j].low);
                }
                const reactionSize = candles[i].high - reactionLow;
                resistances.push({ level: candles[i].high, type: 'resistance', reaction: reactionSize });
            }
        }
        
        // 2. Sort each list independently by the size of the reaction
        supports.sort((a, b) => b.reaction - a.reaction);
        resistances.sort((a, b) => b.reaction - a.reaction);

        // 3. Return the top N unique levels from each list
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