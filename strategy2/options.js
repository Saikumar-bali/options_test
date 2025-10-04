// update_options.js
const axios = require('axios');
const fs = require('fs');
const moment = require('moment-timezone');
const { SmartAPI } = require("smartapi-javascript");

const SMART_API_CREDENTIALS = {
  api_key: "EKQ0nr3N",
  client_code: "B54512822",
  password: "8179",
  totp: "952058"
};

// Configure underlying index tokens and exchange segments
  const INDEX_CONFIG = {
    NIFTY:    { token: '2',        name: 'NIFTY',    exch_seg: 'NSE' },
    BANKNIFTY:{ token: '99926009', name: 'BANKNIFTY', exch_seg: 'NSE' },
    SENSEX:   { token: '99919000', name: 'SENSEX',   exch_seg: 'BSE' },
  };
async function getIndexClosePrice(indexName) {
  try {
    const smartApi = new SmartAPI({ api_key: SMART_API_CREDENTIALS.api_key });
    const session = await smartApi.generateSession(
      SMART_API_CREDENTIALS.client_code,
      SMART_API_CREDENTIALS.password,
      SMART_API_CREDENTIALS.totp
    );

    const config = INDEX_CONFIG[indexName];
    const history = await smartApi.getCandleData({
      exchange: config.exch_seg,
      symboltoken: config.token,
      interval: "ONE_DAY",
      fromdate: moment().subtract(3, 'days').format('YYYY-MM-DD'),
      todate: moment().format('YYYY-MM-DD')
    });

    return history.data?.[history.data.length - 1]?.[4] || null;
  } catch (error) {
    console.error(`Error fetching ${indexName} data:`, error.message);
    return null;
  }
}

function processOptions(allOptions, indexName, closePrice) {
  // Filter options for current index
  const indexOptions = allOptions.filter(opt =>
    opt.name === indexName &&
    opt.instrumenttype === 'OPTIDX'
  );

  // Group options by expiry
  const expiryMap = new Map();
  indexOptions.forEach(opt => {
    const expiryDate = moment(opt.expiry, 'DDMMMYYYY');
    if (!expiryDate.isValid()) return;

    const key = expiryDate.format('YYYYMMDD');
    if (!expiryMap.has(key)) {
      expiryMap.set(key, {
        date: expiryDate,
        options: []
      });
    }
    expiryMap.get(key).options.push(opt);
  });

  // Find nearest expiry
  const sortedExpiries = [...expiryMap.values()]
    .filter(exp => exp.date.isAfter(moment()))
    .sort((a, b) => a.date - b.date);

  if (sortedExpiries.length === 0) return [];

  // Get options for nearest expiry
  const nearestExpiryOptions = sortedExpiries[0].options;

  // Calculate strike differences
  return nearestExpiryOptions.map(opt => {
    const strike = parseFloat(opt.strike) / 100; // Convert to actual strike price
    return {
      ...opt,
      strikeDiff: Math.abs(strike - closePrice),
      strike: strike,
      optionType: opt.symbol.slice(-2) === 'CE' ? 'CE' : 'PE'
    };
  }).sort((a, b) => a.strikeDiff - b.strikeDiff);
}

async function updateOptions() {
  try {
    // Fetch latest options data
    const { data } = await axios.get(
      'https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json'
    );

    // Get indices to process
    const indices = Object.keys(INDEX_CONFIG);
    const selectedOptions = [];

    for (const indexName of indices) {
      const closePrice = await getIndexClosePrice(indexName);
      if (!closePrice) continue;

      // Process options for this index
      const optionsWithDiff = processOptions(data, indexName, closePrice);

      // Select top 3 CE and top 3 PE closest to ATM
      const ceOptions = optionsWithDiff.filter(o => o.optionType === 'CE').slice(0, 3);
      const peOptions = optionsWithDiff.filter(o => o.optionType === 'PE').slice(0, 3);

      selectedOptions.push(...ceOptions, ...peOptions);
    }

    // Format for updated.json
    const niftyOptions = selectedOptions.filter(o => o.name === 'NIFTY');
    const sensexOptions = selectedOptions.filter(o => o.name === 'SENSEX');
    const bankniftyOptions = selectedOptions.filter(o => o.name === 'BANKNIFTY');

    const updatedContent = [
      { "_comment": " NIFTY OPTIONS" },
      ...niftyOptions,
      { "_comment": " SENSEX OPTIONS" },
      ...sensexOptions,
      { "_comment": " BANKNIFTY OPTIONS" },
      ...bankniftyOptions
    ];

    // Clean unnecessary fields and format
    const formattedData = updatedContent.map(item => {
      if (item._comment) return item;
      return {
        token: item.token,
        symbol: item.symbol,
        name: item.symbol,
        expiry: item.expiry,
        strike: parseFloat(item.strike),
        optionType: item.optionType,
        exch_seg: item.exch_seg,
        lotsize: parseInt(item.lotsize),
        instrumenttype: item.instrumenttype
      };
    });

    fs.writeFileSync('updated.json', JSON.stringify(formattedData, null, 2));
    console.log('✅ Successfully updated options data');
  } catch (error) {
    console.error('❌ Error updating options:', error.message);
    process.exit(1);
  }
}

// Run daily after market close (e.g., via cron job)
updateOptions();