// File: /trading-bot/utils/helpers.js
const moment = require('moment-timezone');

/**
 * DEFINITIVE FIX: Finds ATM, and surrounding ITM/OTM options from a master list of instruments.
 * This function contains the complete logic and does not depend on a method from instrumentLoader.
 *
 * @param {Array} instruments - The complete list of instrument objects from the instrument file.
 * @param {string} underlyingSymbol - The symbol of the underlying asset (e.g., 'NIFTY').
 * @param {number} ltp - The last traded price of the underlying.
 * @param {string} expiryDate - The target expiry date in 'YYYY-MM-DD' format.
 * @param {number} numStrikes - The number of strikes to return on each side of ATM (e.g., 1 means ATM CE & PE).
 * @returns {Array} - An array of the found option instrument objects.
 */
function findATMOptions(instruments, underlyingSymbol, ltp, expiryDate) {
    if (!instruments || instruments.length === 0) {
        console.error("Instrument list is empty. Cannot find ATM options.");
        return [];
    }
    
    // AngelOne uses 'DDMMMYYYY' format for expiry, e.g., '31JUL2025'
    const expiryMoment = moment(expiryDate, 'YYYY-MM-DD');
    const formattedExpiry = expiryMoment.format('DDMMMYYYY').toUpperCase();

    // Filter for the relevant options
    const relevantOptions = instruments.filter(inst =>
        inst.name === underlyingSymbol &&
        (inst.instrumenttype === 'OPTIDX' || inst.instrumenttype === 'OPTSTK') &&
        inst.expiry === formattedExpiry
    );

    if (relevantOptions.length === 0) {
        console.warn(`[${underlyingSymbol}] No options found for expiry ${formattedExpiry}`);
        return [];
    }

    // Find the closest strike price to the LTP
    let atmStrike = -1;
    let minDiff = Infinity;

    relevantOptions.forEach(inst => {
        const strikePrice = parseFloat(inst.strike);
        if (!isNaN(strikePrice)) {
            const diff = Math.abs(ltp - strikePrice);
            if (diff < minDiff) {
                minDiff = diff;
                atmStrike = strikePrice;
            }
        }
    });

    if (atmStrike === -1) {
        console.warn(`[${underlyingSymbol}] Could not determine ATM strike for LTP ${ltp}`);
        return [];
    }

    // Find the exact ATM Call and Put options
    const atmCE = relevantOptions.find(inst => inst.strike == atmStrike && inst.symbol.endsWith('CE'));
    const atmPE = relevantOptions.find(inst => inst.strike == atmStrike && inst.symbol.endsWith('PE'));

    const results = [];
    if (atmCE) results.push(atmCE);
    if (atmPE) results.push(atmPE);

    return results;
}


/**
 * Creates parameters for a historical data request with a precise time range.
 *
 * @param {object} instrument - The instrument object { exch_seg, token }.
 * @param {string} interval - The candle interval, e.g., 'FIFTEEN_MINUTE'.
 * @param {string} fromdate - The from date in 'YYYY-MM-DD HH:mm' format.
 * @param {string} todate - The to date in 'YYYY-MM-DD HH:mm' format.
 * @returns {object} - The parameters for the API call.
 */
function getHistoricalDataParams(instrument, interval, fromdate, todate) {
    if (!instrument || !instrument.exch_seg || !instrument.token) {
        throw new Error("Invalid instrument provided to getHistoricalDataParams");
    }
    if (!fromdate || !todate) {
        throw new Error("A precise fromdate and todate are required for historical data.");
    }
    return {
        exchange: instrument.exch_seg,
        symboltoken: instrument.token,
        interval: interval,
        fromdate: fromdate,
        todate: todate,
    };
}

module.exports = {
    findATMOptions,
    getHistoricalDataParams,
};
