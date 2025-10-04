// File: /src/indicators/SupportResistance.js

class SupportResistance {
    /**
     * FINAL CORRECTED VERSION
     * This version uses the reliable 3-candle pivot detection for both support and resistance,
     * correctly measures the reaction for each, and then filters them to only show
     * supports below the current price and resistances above it.
     */
    static detectLevels(candles, currentPrice, params = { reactionLookback: 5, levelsToReturn: 5 }) {
        const initialState = { supports: [], resistances: [] };
        if (!candles || candles.length < params.reactionLookback + 2) {
            return initialState;
        }

        const allSupports = [];
        const allResistances = [];

        for (let i = 1; i < candles.length - params.reactionLookback; i++) {
            
            // --- Support Detection (V-shape) ---
            const isSupportPivot = candles[i].low < candles[i - 1].low && candles[i].low < candles[i + 1].low;
            if (isSupportPivot) {
                let reactionHigh = candles[i].low;
                for (let j = 1; j <= params.reactionLookback; j++) {
                    reactionHigh = Math.max(reactionHigh, candles[i + j].high);
                }
                const reactionSize = reactionHigh - candles[i].low;
                allSupports.push({ level: candles[i].low, type: 'support', reaction: reactionSize });
            }

            // --- Resistance Detection (A-shape) ---
            const isResistancePivot = candles[i].high > candles[i - 1].high && candles[i].high > candles[i + 1].high;
            if (isResistancePivot) {
                let reactionLow = candles[i].high;
                for (let j = 1; j <= params.reactionLookback; j++) {
                    reactionLow = Math.min(reactionLow, candles[i + j].low);
                }
                const reactionSize = candles[i].high - reactionLow;
                allResistances.push({ level: candles[i].high, type: 'resistance', reaction: reactionSize });
            }
        }
        
        // --- Filtering and Ranking ---

        // 1. Filter supports to only include those BELOW the current price
        const validSupports = allSupports.filter(s => s.level < currentPrice);
        
        // 2. Filter resistances to only include those ABOVE the current price
        const validResistances = allResistances.filter(r => r.level > currentPrice);
        
        // 3. Sort by the size of the reaction
        validSupports.sort((a, b) => b.reaction - a.reaction);
        validResistances.sort((a, b) => b.reaction - a.reaction);

        // 4. Return the top N unique levels from each valid list
        const topSupports = this.getUniqueTopLevels(validSupports, params.levelsToReturn);
        const topResistances = this.getUniqueTopLevels(validResistances, params.levelsToReturn);
        
        return { supports: topSupports, resistances: topResistances };
    }

    static getUniqueTopLevels(levels, count) {
        const uniqueLevels = [];
        if (!levels) return uniqueLevels;

        for (const level of levels) {
            if (uniqueLevels.length >= count) break;
            // Check if this level is too close to one already in the list
            const isTooClose = uniqueLevels.some(uniqueLevel => Math.abs(uniqueLevel.level - level.level) / level.level < 0.005); // 0.5% proximity check
            if (!isTooClose) {
                uniqueLevels.push(level);
            }
        }
        return uniqueLevels;
    }
}
module.exports = SupportResistance;