// File: /pre_market_analyzer/logic/options_selector.js
const moment = require('moment-timezone');

class OptionsSelector {
    constructor(criteria, apiService) {
        this.criteria = criteria;
        this.apiService = apiService; // For fetching current price (ATM)
    }

    async selectRelevantOptions(underlyingSymbol, exchangeSegment, optionsChain) {
        if (!optionsChain || optionsChain.length === 0) return [];

        const atmPriceRes = await this.apiService.getCurrentPriceAPI(underlyingSymbol, exchangeSegment);
        if (!atmPriceRes || !atmPriceRes.ltp) {
            console.warn(`Could not fetch LTP for ${underlyingSymbol} to determine ATM strike.`);
            return [];
        }
        const atmPrice = atmPriceRes.ltp;

        // 1. Filter by Expiry (e.g., current week)
        const targetExpiryDate = this.getTargetExpiry();
        let relevantOptions = optionsChain.filter(opt =>
            moment(opt.expiry_date).isSame(targetExpiryDate, 'day') &&
            opt.open_interest >= this.criteria.min_oi &&
            opt.volume >= this.criteria.min_volume
        );

        // 2. Filter by Strikes around ATM
        const uniqueStrikes = [...new Set(relevantOptions.map(opt => opt.strike_price))].sort((a,b) => a-b);
        if (uniqueStrikes.length === 0) return [];

        const atmStrike = uniqueStrikes.reduce((prev, curr) => 
            (Math.abs(curr - atmPrice) < Math.abs(prev - atmPrice) ? curr : prev)
        );
        
        const atmStrikeIndex = uniqueStrikes.indexOf(atmStrike);
        const startIndex = Math.max(0, atmStrikeIndex - this.criteria.strikes_from_atm);
        const endIndex = Math.min(uniqueStrikes.length - 1, atmStrikeIndex + this.criteria.strikes_from_atm);
        
        const selectedStrikes = uniqueStrikes.slice(startIndex, endIndex + 1);

        relevantOptions = relevantOptions.filter(opt => selectedStrikes.includes(opt.strike_price));
        
        console.log(`Selected ${relevantOptions.length} options for ${underlyingSymbol} around ATM ${atmPrice} (target expiry: ${targetExpiryDate})`);
        return relevantOptions;
    }

    getTargetExpiry() {
        // Basic weekly expiry logic: finds the next Thursday.
        // This needs to be robust for actual market holidays and expiry series.
        let today = moment.tz("Asia/Kolkata");
        let daysUntilThursday = (4 - today.day() + 7) % 7; // 4 is Thursday
        if (daysUntilThursday === 0 && today.hour() > 16) { // If today is Thursday and market closed
            daysUntilThursday = 7;
        }
        return today.add(daysUntilThursday, 'days').format('YYYY-MM-DD');
    }
}

module.exports = OptionsSelector;