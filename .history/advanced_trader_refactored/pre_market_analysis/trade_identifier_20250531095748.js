// File: /src/pre_market_analysis/trade_identifier.js
class TradeIdentifier {
    constructor(proximityPercent) {
        this.proximityFactor = proximityPercent;
    }

    identify(underlying, option) {
        const setups = [];
        const uLtp = underlying.candles[underlying.candles.length - 1].close;
        const oLtp = option.candles[option.candles.length - 1].close;

        for (const uSr of underlying.sr_levels) {
            if (Math.abs(uLtp - uSr.level) > (uLtp * this.proximityFactor)) continue;

            for (const oSr of option.sr_levels) {
                if (Math.abs(oLtp - oSr.level) > (oLtp * this.proximityFactor)) continue;
                
                if (option.instrument_type === 'CE' && uSr.type === 'support' && oSr.type === 'support') {
                    setups.push({ reason: `${underlying.symbol} near Support; CE near Support.`, direction: "BUY_CE", uSr, oSr });
                } else if (option.instrument_type === 'PE' && uSr.type === 'resistance' && oSr.type === 'support') {
                    setups.push({ reason: `${underlying.symbol} near Resistance; PE near Support.`, direction: "BUY_PE", uSr, oSr });
                }
            }
        }
        return setups;
    }
}
module.exports = TradeIdentifier;