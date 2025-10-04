const moment = require('moment-timezone');

function findATMOptions(instrumentLoader, underlyingSymbol, ltp, expiryDate, numStrikes) {
    const instruments = instrumentLoader.getInstrumentsByUnderlying(underlyingSymbol);
    if (!instruments || instruments.length === 0) {
        console.error(`[CRITICAL] Could not find any base instruments for underlying: ${underlyingSymbol}. Please check the name in your config and the instrument file.`);
        return [];
    }

    const options = instruments.filter(inst =>
        inst.instrumenttype === 'OPTIDX' || inst.instrumenttype === 'OPTSTK'
    );

    const expiryMoment = moment(expiryDate, "YYYY-MM-DD").startOf('day');

    const relevantOptions = options.filter(opt => {
        const optExpiry = moment(opt.expiry, 'DDMMMYYYY').startOf('day');
        return optExpiry.isSame(expiryMoment);
    }).map(opt => {
        // Derive optiontype from symbol
        if (!opt.optiontype && opt.symbol) {
            if (opt.symbol.endsWith('CE')) {
                opt.optiontype = 'CE';
            } else if (opt.symbol.endsWith('PE')) {
                opt.optiontype = 'PE';
            }
        }

        // Convert strike to float
        opt.strike = parseFloat(opt.strike);
        return opt;
    });

    console.log(`[${underlyingSymbol}] Found ${relevantOptions.length} options for expiry date ${expiryDate}.`);
    if (relevantOptions.length > 0) {
        console.log(`[DIAGNOSTIC] Sample option from list: Name=${relevantOptions[0].name}, Strike=${relevantOptions[0].strike}`);
    } else {
        return [];
    }

    const strikeStep = (underlyingSymbol.includes('NIFTY') && !underlyingSymbol.includes('BANK')) ? 50 : 100;
    const atmStrike = Math.round(ltp / strikeStep) * strikeStep;
    console.log(`[${underlyingSymbol}] LTP: ${ltp}, ATM Strike rounded to: ${atmStrike}`);

    const selectedOptions = new Map();

    for (let i = 1; i <= numStrikes; i++) {
        const higherStrike = atmStrike + (i * strikeStep);
        const lowerStrike = atmStrike - (i * strikeStep);

        console.log(`  - Searching for OTM Call at strike: ${higherStrike} and OTM Put at strike: ${lowerStrike}`);

        const ceHigher = relevantOptions.find(o =>
            Math.abs(o.strike - higherStrike) < 0.01 &&
            o.optiontype === 'CE'
        );

        const peLower = relevantOptions.find(o =>
            Math.abs(o.strike - lowerStrike) < 0.01 &&
            o.optiontype === 'PE'
        );

        if (ceHigher) {
            console.log(`    [+] Found CE: ${ceHigher.symbol}`);
            selectedOptions.set(ceHigher.token, ceHigher);
        }
        if (peLower) {
            console.log(`    [+] Found PE: ${peLower.symbol}`);
            selectedOptions.set(peLower.token, peLower);
        }
    }

    // console.log("selectedOptions (raw):", selectedOptions);
    // console.log("selectedOptions (as array):", Array.from(selectedOptions.entries()));
    const finalOptions = Array.from(selectedOptions.values());
     console.log(`[${underlyingSymbol}] Filtered down to ${finalOptions.length} ATM options.`);
    return finalOptions;
}

function getHistoricalDataParams(instrument, timeframe, days) {
    const toDate = moment().tz("Asia/Kolkata").format('YYYY-MM-DD HH:mm');
    const fromDate = moment().tz("Asia/Kolkata").subtract(days, 'days').format('YYYY-MM-DD HH:mm');

    return {
        exchange: instrument.exch_seg,
        symboltoken: instrument.token,
        interval: timeframe,
        fromdate: fromDate,
        todate: toDate
    };
}

module.exports = {
    findATMOptions,
    getHistoricalDataParams,
};
