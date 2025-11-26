const fs = require('fs');
const path = require('path');
const moment = require('moment');

const instrumentsPath = path.resolve(__dirname, '../../trading-bot/data/instruments.json');
if (!fs.existsSync(instrumentsPath)) {
  console.error('Instrument file not found at', instrumentsPath);
  process.exit(1);
}

console.log('Reading instruments from:', instrumentsPath);
const raw = fs.readFileSync(instrumentsPath, 'utf8');
let instruments;
try {
  instruments = JSON.parse(raw);
} catch (err) {
  console.error('Failed to parse JSON:', err.message);
  process.exit(1);
}

// Quick raw-text checks for literal substrings
const crudeCount = (raw.match(/CRUDEOIL/ig) || []).length;
const ngCount = (raw.match(/NATURALGAS/ig) || []).length;
console.log('\nRaw file occurrences: CRUDEOIL=', crudeCount, 'NATURALGAS=', ngCount);
if (crudeCount > 0) {
  const idx = raw.search(/CRUDEOIL/i);
  const snippet = raw.slice(Math.max(0, idx - 200), Math.min(raw.length, idx + 200));
  console.log('\nSnippet around first CRUDEOIL match:\n', snippet);
}
if (ngCount > 0) {
  const idx = raw.search(/NATURALGAS/i);
  const snippet = raw.slice(Math.max(0, idx - 200), Math.min(raw.length, idx + 200));
  console.log('\nSnippet around first NATURALGAS match:\n', snippet);
}

function inspect(underlying) {
  const key = underlying.toUpperCase();
  const list = instruments.filter(inst => {
    const name = String(inst.name || inst.N || inst.tradingsymbol || inst.symbol || '').toUpperCase();
    const instType = (inst.instrument_type || inst.instrumenttype || inst.instrumentType || inst.instrumenttype || inst.instrument_type || inst.instrumenttype || '').toUpperCase();
    // Accept multiple instrument type labels used in various instrument files
    const validTypes = ['OPTFUT', 'FUT', 'OPTSTK', 'OPTIDX', 'COMDTY'];
    return name.includes(key) && validTypes.includes(instType);
  });
  console.log('\n---', underlying, 'summary ---');
  console.log('Total instruments matching (FUT + OPTFUT):', list.length);

  const byExpiry = {};
  list.forEach(inst => {
    const e = inst.expiry || 'N/A';
    byExpiry[e] = (byExpiry[e] || 0) + 1;
  });

  const expiries = Object.keys(byExpiry).sort((a,b)=> byExpiry[b]-byExpiry[a]);
  console.log('Distinct expiries (count):', expiries.length);
  expiries.slice(0,20).forEach(e => console.log(' ', e, ':', byExpiry[e]));

  console.log('\nSample instruments (up to 10):');
  list.slice(0,10).forEach(inst => {
    console.log(JSON.stringify({token: inst.instrument_token, symbol: inst.symbol, name: inst.name, type: inst.instrument_type, expiry: inst.expiry, strike: inst.strike}, null, 2));
  });
}

function findFrontMonthFuture(underlying) {
    const key = underlying.toUpperCase();
    const futures = instruments.filter(inst => {
        const name = String(inst.name || inst.symbol || '').toUpperCase();
        const instType = (inst.instrumenttype || inst.instrument_type || '').toUpperCase();
        return name.includes(key) && instType === 'FUT';
    });

    if (futures.length === 0) {
        console.log(`\n--- No FUT instruments found for ${underlying} ---`);
        return;
    }

    const sortedFutures = futures
        .map(inst => ({
            ...inst,
            expiryDate: moment(inst.expiry, 'DDMMMYYYY')
        }))
        .filter(inst => inst.expiryDate.isValid() && inst.expiryDate.isSameOrAfter(moment(), 'day'))
        .sort((a, b) => a.expiryDate.valueOf() - b.expiryDate.valueOf());

    if (sortedFutures.length === 0) {
        console.log(`\n--- No future-dated FUT instruments found for ${underlying} ---`);
        return;
    }
    
    const frontMonth = sortedFutures[0];
    console.log(`\n--- Front-Month FUT for ${underlying} ---`);
    console.log(JSON.stringify({
        token: frontMonth.token,
        symbol: frontMonth.symbol,
        name: frontMonth.name,
        expiry: frontMonth.expiry
    }, null, 2));
}


inspect('CRUDEOIL');
inspect('NATURALGAS');
findFrontMonthFuture('CRUDEOIL');
findFrontMonthFuture('NATURALGAS');

console.log('\nDone');
