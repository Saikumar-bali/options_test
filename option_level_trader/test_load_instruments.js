const InstrumentLoader = require('./utils/instrument_loader');

(async () => {
  try {
    const loader = new InstrumentLoader();
    await loader.loadInstruments();

    console.log('Total instruments loaded:', loader.instruments.length);
    const keys = Array.from(loader.underlyingMap.keys());
    console.log('Underlying keys count:', keys.length);
    console.log('Underlying keys (sample):', keys.slice(0,50));

    const crude = loader.getInstrumentsByUnderlying('CRUDEOIL');
    console.log('CRUDEOIL instruments found:', crude ? crude.length : 0);

    const nat = loader.getInstrumentsByUnderlying('NATURALGAS');
    console.log('NATURALGAS instruments found:', nat ? nat.length : 0);

    process.exit(0);
  } catch (e) {
    console.error('Test failed:', e && e.message ? e.message : e);
    process.exit(1);
  }
})();
