// File: /pre_market_analyzer/logic/trade_identifier.js
class TradeIdentifier {
    constructor(srParams) {
        this.proximityFactor = srParams.proximity_to_sr_percent || 0.002; // e.g., 0.2%
    }

    identifyPotentialSetups(underlying, underlyingSrLevels, option, optionSrLevels) {
        const setups = [];

        if (!underlyingSrLevels || underlyingSrLevels.length === 0 || !optionSrLevels || optionSrLevels.length === 0) {
            return setups;
        }

        // Example: Current underlying price - needed to check proximity
        // This should ideally be the latest close from the underlying's candles
        const underlyingCurrentPrice = underlying.candles[underlying.candles.length-1].close;
        const optionCurrentPrice = option.candles[option.candles.length-1].close;


        for (const uSr of underlyingSrLevels) {
            const isUnderlyingNearSr = Math.abs(underlyingCurrentPrice - uSr.level) <= (uSr.level * this.proximityFactor);
            if (!isUnderlyingNearSr) continue;

            for (const oSr of optionSrLevels) {
                const isOptionNearSr = Math.abs(optionCurrentPrice - oSr.level) <= (oSr.level * this.proximityFactor);
                if (!isOptionNearSr) continue;

                let reason = "";
                // Confluence Logic:
                // CALL option: Underlying at SUPPORT, Option at SUPPORT (or breaking minor RES)
                if (option.instrument_type === 'CE') {
                    if (uSr.type === 'support' && (oSr.type === 'support' /*|| (oSr.type === 'resistance' && optionCurrentPrice > oSr.level)*/ )) {
                        reason = `${underlying.symbol} near Support ${uSr.level.toFixed(2)}; ${option.tradingsymbol} near Support ${oSr.level.toFixed(2)}. Potential Call Buy.`;
                        setups.push({ option, underlyingSrLevel: uSr, optionSrLevel: oSr, reason, direction: "BUY_CE" });
                    }
                }
                // PUT option: Underlying at RESISTANCE, Option at SUPPORT (or breaking minor RES)
                else if (option.instrument_type === 'PE') {
                     if (uSr.type === 'resistance' && (oSr.type === 'support' /*|| (oSr.type === 'resistance' && optionCurrentPrice > oSr.level)*/)) {
                        reason = `${underlying.symbol} near Resistance ${uSr.level.toFixed(2)}; ${option.tradingsymbol} near Support ${oSr.level.toFixed(2)}. Potential Put Buy.`;
                        setups.push({ option, underlyingSrLevel: uSr, optionSrLevel: oSr, reason, direction: "BUY_PE" });
                    }
                }
            }
        }
        return setups;
    }
}

module.exports = TradeIdentifier;