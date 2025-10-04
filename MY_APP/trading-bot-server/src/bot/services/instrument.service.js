const axios = require('axios');
const { format, parse } = require('date-fns');

const INSTRUMENT_LIST_URL = 'https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json';

// In-memory cache for the master instrument list to avoid re-downloading the large file.
const instrumentCache = {
    data: null,
    lastFetched: null,
};
const CACHE_DURATION_MS = 4 * 60 * 60 * 1000; // 4 hours

/**
 * Fetches the master instrument list, using a cache for performance.
 * @returns {Promise<Array>} The raw instrument list from Angel One.
 */
async function getInstrumentMasterList() {
    const now = Date.now();
    if (instrumentCache.data && (now - instrumentCache.lastFetched < CACHE_DURATION_MS)) {
        console.log('Returning master instrument list from cache.');
        return instrumentCache.data;
    }

    console.log('Fetching fresh instrument master list from Angel One...');
    const response = await axios.get(INSTRUMENT_LIST_URL);
    if (!Array.isArray(response.data)) {
        throw new Error('Instrument list is not in the expected format.');
    }
    
    instrumentCache.data = response.data;
    instrumentCache.lastFetched = now;
    console.log(`Cached ${response.data.length} instruments.`);
    return instrumentCache.data;
}

/**
 * Gets the nearest two expiry dates for a specific index (e.g., NIFTY, BANKNIFTY).
 * @param {string} indexSymbol - The index symbol to filter by.
 * @returns {Promise<Array<{value: string, label: string}>>} A sorted list of the two nearest expiry dates.
 */
async function getExpiriesForIndex(indexSymbol = 'NIFTY') {
    const instruments = await getInstrumentMasterList();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const expirySet = new Set();
    const dateFormatFromApi = 'ddMMMyyyy';

    for (const instrument of instruments) {
        // Filter by segment, type, and the specific index symbol.
        if (instrument.exch_seg === 'NFO' && instrument.instrumenttype === 'OPTIDX' && instrument.name === indexSymbol.toUpperCase()) {
            const expiryDate = parse(instrument.expiry, dateFormatFromApi, new Date());
            if (expiryDate >= today) {
                expirySet.add(instrument.expiry);
            }
        }
    }

    // Sort dates and take the first two.
    const sortedExpiries = Array.from(expirySet)
        .map(dateStr => parse(dateStr, dateFormatFromApi, new Date()))
        .sort((a, b) => a - b)
        .slice(0, 2) // <<< Only take the nearest two expiries
        .map((date, index) => {
            const value = format(date, 'dd-MMM-yyyy');
            let label = format(date, 'dd MMM yyyy');
            label += (index === 0) ? ' (Nearest)' : ' (Next)';
            return { value, label };
        });

    console.log(`Found nearest 2 expiries for ${indexSymbol}:`, sortedExpiries.map(e => e.value));
    return sortedExpiries;
}

/**
 * Gets all option contracts for a specific index and expiry date.
 * @param {string} indexSymbol - The index symbol (e.g., NIFTY).
 * @param {string} expiryDate - The expiry date in 'dd-MMM-yyyy' format.
 * @returns {Promise<Array>} A list of matching option contracts.
 */
async function getOptionContracts(indexSymbol, expiryDate) {
    const instruments = await getInstrumentMasterList();
    // Convert 'dd-MMM-yyyy' to 'ddMMMyyyy' for matching with the API data
    const apiExpiryFormat = format(parse(expiryDate, 'dd-MMM-yyyy', new Date()), 'ddMMMyyyy').toUpperCase();

    const contracts = instruments.filter(inst => 
        inst.exch_seg === 'NFO' &&
        inst.instrumenttype === 'OPTIDX' &&
        inst.name === indexSymbol.toUpperCase() &&
        inst.expiry.toUpperCase() === apiExpiryFormat
    ).map(inst => ({
        // This is the full contract name, e.g., NIFTY17JUL2524000CE
        id: inst.tradingsymbol,
        // This is a user-friendly name for the dropdown
        name: `${inst.name} ${inst.strike} ${inst.opttype}`,
        type: inst.opttype, // CE or PE
        strike: parseFloat(inst.strike),
        token: inst.token, // The symbol token needed to place orders
    }));

    // Sort by strike price
    contracts.sort((a, b) => a.strike - b.strike);
    console.log(`Found ${contracts.length} contracts for ${indexSymbol} on ${expiryDate}.`);
    return contracts;
}

module.exports = {
    getExpiriesForIndex,
    getOptionContracts,
};
