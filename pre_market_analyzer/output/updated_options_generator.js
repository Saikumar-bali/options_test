// File: /pre_market_analyzer/output/updated_options_generator.js
const fs = require('fs');

class UpdatedOptionsGenerator {
    static generateFile(filePath, tradeableOptionsData) {
        // tradeableOptionsData is an array of objects from TradeIdentifier
        const outputList = tradeableOptionsData.map(setup => {
            const optionData = setup.option; // This contains the option details like symbol, token etc.
                                          // and also its candles and calculated S/R levels
            return {
                symbol: optionData.tradingsymbol,
                token: optionData.token,
                exch_seg: optionData.options_exchange_segment || "NFO", // Ensure this is present
                lotsize: optionData.lotsize,
                option_type: optionData.instrument_type,
                expiry: optionData.expiry_date,
                strike: optionData.strike_price,
                underlying: optionData.underlying_symbol, // Add this field during processing
                underlying_sr_levels: optionData.underlying_sr_levels_ref, // Attach reference
                option_sr_levels: optionData.option_sr_levels_ref, // Attach its own S/R
                trade_setup_reason: setup.reason,
                recommended_direction: setup.direction
            };
        });

        fs.writeFileSync(filePath, JSON.stringify(outputList, null, 2));
        console.log(`✅ updated_options.json generated at ${filePath} with ${outputList.length} potential setups.`);
    }
}

module.exports = UpdatedOptionsGenerator;