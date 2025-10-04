// File: /src/pre_market_analysis/trade_identifier.js
class TradeIdentifier {
    constructor(proximityPercent) {
        this.proximityFactor = proximityPercent / 100;
    }

    /**
     * [CORRECTED] Determines relevant, rounded option strikes based on S/R levels.
     * @param {object} srLevels - The object containing support and resistance levels.
     * @param {number} strikeStep - The strike step for the instrument (e.g., 50 for NIFTY).
     * @returns {Array<number>} A sorted array of valid, rounded strikes.
     */
    determineStrikesFromSr(srLevels, strikeStep) {
        // Guard clause for invalid inputs
        if (!srLevels || !strikeStep || strikeStep <= 0) {
            return [];
        }

        const levels = [];

        // Safely process supports
        if (srLevels.supports && Array.isArray(srLevels.supports)) {
            levels.push(...srLevels.supports.map(s => s.level));
        }

        // Safely process resistances
        if (srLevels.resistances && Array.isArray(srLevels.resistances)) {
            levels.push(...srLevels.resistances.map(r => r.level));
        }

        const strikes = new Set();
        for (const level of levels) {
            // Round the S/R level to the nearest valid strike
            const nearestStrike = Math.round(level / strikeStep) * strikeStep;

            // Add the nearest strike and one on each side
            strikes.add(nearestStrike - strikeStep);
            strikes.add(nearestStrike);
            strikes.add(nearestStrike + strikeStep);
        }
        return Array.from(strikes).sort((a, b) => a - b);
    }

    identify(underlying, option) {
        const setups = [];
        if (!underlying.sr_levels || !option.sr_levels) return setups;

        const uLtp = underlying.candles[underlying.candles.length - 1].close;
        const oLtp = option.candles[option.candles.length - 1].close;

        // Check for bullish setups (price near underlying's support)
        for (const uSupport of underlying.sr_levels.supports) {
            const isNearSupport = Math.abs(uLtp - uSupport.level) <= (uLtp * this.proximityFactor);
            if (isNearSupport) {
                // Now check if the CALL option is also near its own support
                for (const oSupport of option.sr_levels.supports) {
                    const isOptionNearSupport = Math.abs(oLtp - oSupport.level) <= (oLtp * (this.proximityFactor * 2)); // Wider proximity for options
                    if (isOptionNearSupport && option.instrument_type === 'CE') {
                        setups.push({
                            reason: `${underlying.symbol} near Support ${uSupport.level.toFixed(2)}; CE near its Support ${oSupport.level.toFixed(2)}.`,
                            direction: "BUY_CE",
                            underlying_sr_level: uSupport,
                            option_sr_level: oSupport
                        });
                    }
                }
            }
        }

        // Check for bearish setups (price near underlying's resistance)
        for (const uResistance of underlying.sr_levels.resistances) {
            const isNearResistance = Math.abs(uLtp - uResistance.level) <= (uLtp * this.proximityFactor);
            if (isNearResistance) {
                // Now check if the PUT option is near its own support
                for (const oSupport of option.sr_levels.supports) {
                    const isOptionNearSupport = Math.abs(oLtp - oSupport.level) <= (oLtp * (this.proximityFactor * 2));
                    if (isOptionNearSupport && option.instrument_type === 'PE') {
                        setups.push({
                            reason: `${underlying.symbol} near Resistance ${uResistance.level.toFixed(2)}; PE near its Support ${oSupport.level.toFixed(2)}.`,
                            direction: "BUY_PE",
                            underlying_sr_level: uResistance,
                            option_sr_level: oSupport
                        });
                    }
                }
            }
        }
        return setups;
    }
}
module.exports = TradeIdentifier;