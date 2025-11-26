const InstrumentLoader = require('../utils/instrument_loader');

async function inspectNG() {
    const loader = new InstrumentLoader();
    await loader.loadInstruments();

    console.log("Searching for NATURALGAS Options (OPTFUT)...");
    const ngOptions = loader.instruments.filter(i => i.name === 'NATURALGAS' && i.instrument_type === 'OPTFUT');

    console.log(`Found ${ngOptions.length} NATURALGAS OPTFUT instruments.`);

    if (ngOptions.length > 0) {
        const expiries = [...new Set(ngOptions.map(i => i.expiry))];
        console.log("Available Expiries:", expiries);
        console.log("Sample Instrument:", ngOptions[0]);
    }
}

inspectNG();
