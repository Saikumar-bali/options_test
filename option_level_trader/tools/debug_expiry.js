const InstrumentLoader = require('../utils/instrument_loader');
const { calculateDynamicExpiries } = require('../trading-bot/utils/expiry_helper');

async function debugExpiry() {
    const loader = new InstrumentLoader();
    await loader.loadInstruments();

    const strategyConfig = [
        {
            underlying: 'NATURALGAS',
            exchange: 'MCX',
            enabled: true,
            options: { enabled: true, expiry_type: 'MONTHLY' }
        },
        {
            underlying: 'CRUDEOIL',
            exchange: 'MCX',
            enabled: true,
            options: { enabled: true, expiry_type: 'MONTHLY' }
        }
    ];

    console.log("Testing Expiry Calculation...");
    await calculateDynamicExpiries(loader, strategyConfig);

    console.log("\nResults:");
    strategyConfig.forEach(config => {
        console.log(`${config.underlying}: ${config.options.expiry_date}`);
    });
}

debugExpiry();
