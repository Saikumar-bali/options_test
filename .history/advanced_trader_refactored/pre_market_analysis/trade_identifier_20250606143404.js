// File: /src/pre_market_analysis/trade_identifier.js
class TradeIdentifier {
    constructor(proximityPercent) {
        this.proximityFactor = proximityPercent / 100; // Convert to decimal e.g. 0.3 -> 0.003
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
             if(isNearResistance) {
                // Now check if the PUT option is near its own support
                for(const oSupport of option.sr_levels.supports) {
                    const isOptionNearSupport = Math.abs(oLtp - oSupport.level) <= (oLtp * (this.proximityFactor * 2));
                    if(isOptionNearSupport && option.instrument_type === 'PE') {
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