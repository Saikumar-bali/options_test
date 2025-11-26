const axios = require('axios');
const { Parser } = require('json2csv');
const fs = require('fs');
const moment = require('moment');

// --- User Configuration ---
const config = {
    apiKey: 'SUdk3YDY',
    clientCode: 'B54512822',
    password: '8179',
    totp: '534919', // IMPORTANT: Generate a new TOTP before running
};

// --- Instrument & Data Configuration ---
// Renamed to 'instrumentsToFetch' for clarity
const instrumentsToFetch = [
    // {
    //     symbol: 'NIFTY 50',
    //     symbolToken: '99926000',
    //     exchange: 'NSE',
    // },
    // {
    //     symbol: 'SENSEX',
    //     symbolToken: '99919000',
    //     exchange: 'BSE',
    // },
    // {
    //     symbol: 'SENSEX25O0182400PE',
    //     symbolToken: '865353',
    //     exchange: 'BFO',
    // },
    // {
    //     symbol: 'BANKNIFTY',
    //     symbolToken: '99926009',
    //     exchange: 'NSE',
    // },
    // {
    //     symbol: 'RELIANCE31JUL251410CE',
    //     symbolToken: '132186',
    //     exchange: 'NFO',
    // },
    // {
    //     symbol: 'INFY31JUL251700CE',
    //     symbolToken: '106373',
    //     exchange: 'NFO',
    // },
    // {
    //     symbol: 'ICICIBANK31JUL251300PE',
    //     symbolToken: '98775',
    //     exchange: 'NFO',
    // },
    // {
    //     symbol: 'ICICIBANK',
    //     symbolToken: '4963',
    //     exchange: 'NSE',
    // },
    // {
    //     symbol: 'HDFCBANK28AUG251980CE',
    //     symbolToken: '90534',
    //     exchange: 'NFO',
    // },
      {
        symbol: 'RELIANCE25NOV251540CE',
        symbolToken: '115554',
        exchange: 'NFO',
    },
    //   {
    //     symbol: 'CRUDEOIL16DEC255200PE',
    //     symbolToken: '472851',
    //     exchange: 'MCX',
    // },
];
const toDate = moment();
const fromDate = moment().subtract(1, 'days');

const historicalDataParams = {
    interval: 'FIFTEEN_MINUTE', // Options: ONE_MINUTE, THREE_MINUTE, FIVE_MINUTE, FIFTEEN_MINUTE, THIRTY_MINUTE, ONE_HOUR, TWO_HOUR, FOUR_HOUR, DAILY, WEEKLY, MONTHLY
    fromDate: fromDate.format('YYYY-MM-DD HH:mm'),
    toDate: toDate.format('YYYY-MM-DD HH:mm'),
};

// Delay between API calls to avoid rate limiting
const API_DELAY_MS = 500;

/**
 * Main function to run the bot
 */
async function runBot() {
    console.log('--- Starting Data Fetching Bot ---');
    let session;

    try {
        // 1. Authenticate once at the beginning
        session = await authenticate();
        if (!session || !session.jwtToken) {
            console.error('Authentication failed. Exiting.');
            return;
        }
        console.log('Authentication successful.');

    } catch (error) {
        console.error('--- Authentication Error ---');
        handleApiError(error);
        return; // Stop if authentication fails
    }

    // 2. Prepare headers for all subsequent requests
    const authHeaders = {
        'Authorization': `Bearer ${session.jwtToken}`,
        'X-PrivateKey': config.apiKey,
        'Accept': 'application/json',
        'X-SourceID': 'WEB',
        'X-UserType': 'USER',
        'X-MACAddress': '10-20-30-40-50-60',
        'X-ClientLocalIP': '192.168.1.1',
        'X-ClientPublicIP': '101.102.103.104',
    };

    // 3. Loop through each instrument and fetch its data
    for (const instrument of instrumentsToFetch) {
        try {
            console.log(`\nFetching historical data for ${instrument.symbol}...`);
            const candleData = await getHistoricalData(authHeaders, instrument);

            if (candleData && candleData.length > 0) {
                await saveToCsv(candleData, instrument);
            } else {
                console.log(`No historical data received from the API for ${instrument.symbol}.`);
            }
        } catch (error) {
            console.error(`Failed to process instrument ${instrument.symbol}.`);
            handleApiError(error);
        }

        // Add a delay to respect API rate limits
        await new Promise(resolve => setTimeout(resolve, API_DELAY_MS));
    }

    console.log('\n--- Bot has finished all tasks ---');
}

/**
 * Authenticates with SmartAPI.
 */
async function authenticate() {
    const authUrl = 'https://apiconnect.angelbroking.com/rest/auth/angelbroking/user/v1/loginByPassword';
    const authPayload = {
        clientcode: config.clientCode,
        password: config.password,
        totp: config.totp,
    };

    const response = await axios.post(authUrl, authPayload, {
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'X-UserType': 'USER',
            'X-SourceID': 'WEB',
            'X-ClientLocalIP': '192.168.1.1',
            'X-ClientPublicIP': '101.102.103.104',
            'X-MACAddress': '10-20-30-40-50-60',
            'X-PrivateKey': config.apiKey,
        },
    });

    if (response.data.status) {
        return response.data.data;
    } else {
        throw new Error(response.data.message);
    }
}

/**
 * Fetches historical candle data for a specific instrument.
 * @param {object} headers - The authorization headers.
 * @param {object} instrument - The instrument to fetch data for.
 */
async function getHistoricalData(headers, instrument) {
    const historicalUrl = 'https://apiconnect.angelbroking.com/rest/secure/angelbroking/historical/v1/getCandleData';
    const historicalPayload = {
        exchange: instrument.exchange,
        symboltoken: instrument.symbolToken,
        interval: historicalDataParams.interval,
        fromdate: historicalDataParams.fromDate,
        todate: historicalDataParams.toDate,
    };

    const response = await axios.post(historicalUrl, historicalPayload, { headers });

    if (response.data.status) {
        return response.data.data;
    } else {
        // Throw an error to be caught by the main loop
        throw new Error(response.data.message || 'Failed to fetch historical data.');
    }
}

/**
 * Converts candle data to CSV and saves it.
 * @param {Array} data - The array of candle data.
 * @param {object} instrument - The instrument being processed.
 */
async function saveToCsv(data, instrument) {
    const fields = ['timestamp', 'open', 'high', 'low', 'close', 'volume'];
    const opts = { fields };

    try {
        const formattedData = data.map(candle => ({
            timestamp: candle[0], open: candle[1], high: candle[2],
            low: candle[3], close: candle[4], volume: candle[5],
        }));

        const parser = new Parser(opts);
        const csv = parser.parse(formattedData);
        // Clean up filename for symbols with spaces
        const fileName = `${instrument.symbol.replace(/\s+/g, '_')}_${historicalDataParams.interval}.csv`;
        
        fs.writeFileSync(fileName, csv);
        console.log(`Successfully saved data to ${fileName}`);
    } catch (err) {
        console.error(`Error saving CSV file for ${instrument.symbol}:`, err);
    }
}

/**
 * A helper function for better error logging.
 * @param {Error} error - The error object.
 */
function handleApiError(error) {
    if (error.response) {
        console.error('API Error Status:', error.response.status);
        console.error('API Error Response:', JSON.stringify(error.response.data, null, 2));
    } else {
        console.error('Error Details:', error.message);
    }
}

// Run the bot
runBot();
