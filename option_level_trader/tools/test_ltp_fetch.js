const MasterController = require('../utils/MasterController');
const DataFetcher = require('../utils/DataFetcher');
const { STRATEGY_CONFIG } = require('../config/trade_config');
const moment = require('moment-timezone');

async function testCrudeOilLTP() {
    console.log('--- Testing CRUDEOIL LTP Fetch ---');
    
    // Find the CRUDEOIL config
    const crudeOilConfig = STRATEGY_CONFIG.find(c => c.underlying === 'CRUDEOIL' && c.enabled);
    if (!crudeOilConfig) {
        console.error('CRUDEOIL configuration not found in trade_config.js');
        return;
    }

    console.log('Found CRUDEOIL config:', JSON.stringify(crudeOilConfig, null, 2));

    try {
        // Initialize MasterController and DataFetcher
        const masterController = new MasterController();
        await masterController.initialize();
        const dataFetcher = new DataFetcher(masterController);

        // Prepare params for the historical data request
        const underlying = {
            symbol: crudeOilConfig.underlying,
            token: crudeOilConfig.token,
            exch_seg: crudeOilConfig.exchange,
        };
        const toDate = moment().tz("Asia/Kolkata");
        const fromDate = toDate.clone().subtract(15, 'minutes');
        
        const params = {
            exchange: underlying.exch_seg,
            symboltoken: underlying.token,
            interval: 'ONE_MINUTE',
            fromdate: fromDate.format('YYYY-MM-DD HH:mm'),
            todate: toDate.format('YYYY-MM-DD HH:mm'),
        };

        console.log('\nRequesting historical data with params:', JSON.stringify(params, null, 2));

        // Make the call
        const history = await dataFetcher.getHistoricalData(params);
        
        // Analyze the result
        if (history && history.length > 0) {
            const latestCandle = history[history.length - 1];
            const ltp = latestCandle[4];
            console.log(`\n✅ SUCCESS: Successfully fetched historical data.`);
            console.log(`   - Candles received: ${history.length}`);
            console.log(`   - Latest LTP: ${ltp}`);
        } else {
            console.error('\n❌ FAILURE: getHistoricalData returned no data or an empty array.');
            console.log('   - Response:', JSON.stringify(history, null, 2));
        }

    } catch (error) {
        console.error('\n❌ An error occurred during the test:', error);
    } finally {
        console.log('\n--- Test Complete ---');
    }
}

testCrudeOilLTP();
