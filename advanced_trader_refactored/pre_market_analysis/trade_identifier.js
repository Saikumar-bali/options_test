// File: /src/pre_market_analysis/trade_identifier.js

class TradeIdentifier {
    constructor(proximityPercent) {
        this.proximityFactor = parseFloat(proximityPercent) / 100;
        if (isNaN(this.proximityFactor)) this.proximityFactor = 0.005; // Default to 0.5%
    }
    
    determineStrikesFromSr(srLevels, strikeStep) {
        const levels = [...srLevels.supports.map(s => s.level), ...srLevels.resistances.map(r => r.level)];
        const strikes = new Set();
        for (const level of levels) {
            const nearestStrike = Math.round(level / strikeStep) * strikeStep;
            strikes.add(nearestStrike - strikeStep);
            strikes.add(nearestStrike);
            strikes.add(nearestStrike + strikeStep);
        }
        return Array.from(strikes).sort((a, b) => a - b);
    }

    identify(underlying, option) {
        const setups = [];
        if (!underlying.sr_levels || !underlying.candles || underlying.candles.length === 0) {
            return setups;
        }

        const uLtp = underlying.candles[underlying.candles.length - 1][4];

        // For every potential option, associate it with the S/R levels it's relevant to.
        // We remove the strict proximity check here; the live logic will handle it.
        if (option.instrument_type === 'CE') {
            underlying.sr_levels.supports.forEach(uSupport => {
                setups.push({
                    ...option,
                    watch_reason: `Underlying [${underlying.symbol}] has Support at ${uSupport.level.toFixed(2)}.`,
                    signal_type: "BULLISH_SR",
                    trigger_level: uSupport.level,
                });
            });
        }

        if (option.instrument_type === 'PE') {
            underlying.sr_levels.resistances.forEach(uResistance => {
                setups.push({
                    ...option,
                    watch_reason: `Underlying [${underlying.symbol}] has Resistance at ${uResistance.level.toFixed(2)}.`,
                    signal_type: "BEARISH_SR",
                    trigger_level: uResistance.level,
                });
            });
        }
        return setups;
    }
}

module.exports = TradeIdentifier;