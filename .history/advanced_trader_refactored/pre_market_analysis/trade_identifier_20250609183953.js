// File: /src/pre_market_analysis/trade_identifier.js
class TradeIdentifier {
    constructor(proximityPercent) {
        this.proximityFactor = proximityPercent / 100;
    }

    /**
     * [REFINED] Determines a focused list of option strikes around S/R levels.
     */
    determineStrikesFromSr(srLevels, strikeStep) {
        if (!srLevels || !strikeStep || strikeStep <= 0) return [];

        const allLevels = [
            ...(srLevels.supports || []).map(s => s.level),
            ...(srLevels.resistances || []).map(r => r.level)
        ];

        const strikes = new Set();
        for (const level of allLevels) {
            const nearestStrike = Math.round(level / strikeStep) * strikeStep;
            
            // Add the strike nearest to the S/R level
            strikes.add(nearestStrike);
            // Add one strike above and one below for a tighter focus
            strikes.add(nearestStrike + strikeStep);
            strikes.add(nearestStrike - strikeStep);
        }

        return Array.from(strikes).sort((a, b) => a - b);
    }
}

module.exports = TradeIdentifier;