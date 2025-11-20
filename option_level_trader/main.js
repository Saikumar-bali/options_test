// File: /option_level_trader/main.js
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, './.env') });
const schedule = require('node-schedule');

const MasterController = require('../universal websocket/index.js');
const { STRATEGY_CONFIG } = require('./config/trade_config.js');
const OptionsLevelStrategy = require('./strategies/OptionsLevelStrategy.js');
const PositionManager = require('./strategies/PositionManager.js');
const InstrumentLoader = require('./utils/instrument_loader.js');
const TelegramService = require('./utils/TelegramService.js');
const ReportGenerator = require('./utils/ReportGenerator.js');
const DataFetcher = require('./utils/DataFetcher.js');

let masterController;
let telegramService;
let positionManager;
const reportGenerator = new ReportGenerator();
const allTrades = [];
const strategies = new Map();

async function main() {
    console.log("=============================================");
    console.log("🚀 STARTING OPTION LEVEL TRADER 🚀");
    console.log("=============================================");

    try {
        const instrumentLoader = new InstrumentLoader();
        await instrumentLoader.loadInstruments();

        // Calculate and assign dynamic expiries for each strategy (reuses trading-bot helper)
        try {
            const { calculateDynamicExpiries } = require('../trading-bot/utils/expiry_helper');
            const moment = require('moment');
            const instrumentAdapter = {
                getInstrumentsByUnderlying: (underlying) => {
                    return instrumentLoader.instruments
                        .filter(i => i.name === underlying)
                        .map(inst => {
                            const copy = { ...inst };
                            // Normalize expiry formats like '28-Nov-2024' -> '28NOV2024'
                            if (copy.expiry && copy.expiry.includes('-')) {
                                const parsed = moment(copy.expiry, ['DD-MMM-YYYY','DD-MMM-YY','DD-MMM-YYYY']);
                                if (parsed.isValid()) copy.expiry = parsed.format('DDMMMYYYY').toUpperCase();
                            }
                            return copy;
                        });
                }
            };
            await calculateDynamicExpiries(instrumentAdapter, STRATEGY_CONFIG);
        } catch (e) {
            console.warn('Could not calculate dynamic expiries from trading-bot helper:', e.message || e);
        }

        masterController = new MasterController();
        telegramService = new TelegramService();
        positionManager = new PositionManager(masterController, telegramService);
        const dataFetcher = new DataFetcher(masterController);

        await masterController.initialize();
        await telegramService.sendMessage("✅ *Option Level Bot is starting up...*");

        positionManager.on('tradeCompleted', (tradeData) => allTrades.push(tradeData));

        for (const config of STRATEGY_CONFIG) {
            if (!config.enabled) continue;

            if (config.strategy === 'OPTIONS_LEVEL') {
                console.log(`[Main] Initializing strategy: ${config.strategy}`);
                const strategy = new OptionsLevelStrategy(masterController, config, instrumentLoader, telegramService, positionManager, dataFetcher);
                masterController.registerStrategy(strategy);
                strategies.set(config.strategy, strategy);
                await strategy.initialize();
                console.log(`  -> Registered: ${strategy.constructor.name}`);
            }
        }

        // If no explicit OPTIONS_LEVEL configs exist, create one per unique underlying
        // by reusing the first matching strategy config for that underlying.
        const createdOptionsUnderlyings = new Set([...strategies.values()].filter(s=>s instanceof OptionsLevelStrategy).map(s=>s.underlying.symbol));
        const underlyingFirstConfig = new Map();
        for (const cfg of STRATEGY_CONFIG) {
            if (!cfg.enabled) continue;
            if (!underlyingFirstConfig.has(cfg.underlying)) underlyingFirstConfig.set(cfg.underlying, cfg);
        }

        for (const [underlying, baseCfg] of underlyingFirstConfig.entries()) {
            if (createdOptionsUnderlyings.has(underlying)) continue;
            try {
                const optionsCfg = {
                    ...baseCfg,
                    strategy: 'OPTIONS_LEVEL',
                    options: { ...baseCfg.options },
                };
                console.log(`[Main] Initializing OptionsLevel for underlying: ${underlying}`);
                const strategy = new OptionsLevelStrategy(masterController, optionsCfg, instrumentLoader, telegramService, positionManager, dataFetcher);
                masterController.registerStrategy(strategy);
                strategies.set(`OPTIONS_LEVEL_${underlying}`, strategy);
                await strategy.initialize();
                console.log(`  -> Registered OptionsLevel for ${underlying}`);
            } catch (err) {
                console.error(`Failed to initialize OptionsLevel for ${underlying}:`, err.message || err);
            }
        }
        
        masterController.registerStrategy(positionManager);
        console.log(`  -> Registered: PositionManager`);

        console.log("\n✅ All strategies registered. Subscribing to tokens...");
        masterController.subscribeToTokens();

        console.log("\nℹ️ Waiting 10 seconds for initial price data to arrive and levels to be calculated...");
        setTimeout(async () => {
            console.log("\n🔄 Triggering initial S/R level calculation for all strategies...");

                // First, ensure each OptionsLevelStrategy recalculates ATM + levels now that LTPs have had time to arrive
                for (const [strategyName, strategy] of strategies.entries()) {
                    if (strategy instanceof OptionsLevelStrategy) {
                        try {
                            await strategy.updateATMandLevels();
                        } catch (err) {
                            console.error(`Error updating ATM/levels for ${strategy.underlying.symbol}:`, err);
                        }
                    }
                }

                let levelsMessage = "📊 *Initial Support & Resistance Levels for ATM Options* 📊\n\n";
                for (const [strategyName, strategy] of strategies.entries()) {
                    if (strategy instanceof OptionsLevelStrategy) {
                        const levels = strategy.getLevelsAndLTP();
                    if (Object.keys(levels).length === 0) {
                        levelsMessage += `*${strategy.underlying.symbol}*: No ATM options found or levels calculated.\n\n`;
                    } else {
                        levelsMessage += `*${strategy.underlying.symbol}*\n`;
                        for (const optionSymbol in levels) {
                            const optionData = levels[optionSymbol];
                            const supports = optionData.supports.length > 0 ? optionData.supports.map(l => l.toFixed(2)).join(', ') : 'N/A';
                            const resistances = optionData.resistances.length > 0 ? optionData.resistances.map(r => r.toFixed(2)).join(', ') : 'N/A';
                            levelsMessage += `  *${optionSymbol}* (LTP: ${optionData.ltp.toFixed(2)})\n`;
                            levelsMessage += `    - *Supports:* ${supports}\n`;
                            levelsMessage += `    - *Resistances:* ${resistances}\n\n`;
                        }
                    }
                }
            }
            await telegramService.sendMessage(levelsMessage);
            console.log("✅ Initial S/R levels reported to Telegram.");
        }, 10000);

        // Schedule end-of-day tasks
        schedule.scheduleJob({ hour: 15, minute: 31, tz: 'Asia/Kolkata' }, async () => {
            await telegramService.sendMessage("🕒 *Market Closed. Generating daily report...*");
            positionManager.closeAllPositions();
            await reportGenerator.generateTradeReport(allTrades, []);
        });

        schedule.scheduleJob({ hour: 16, minute: 0, tz: 'Asia/Kolkata' }, () => {
            telegramService.sendMessage("🔌 *Bot is shutting down now. Goodbye!*");
            masterController.disconnectWebSocket();
            process.exit(0);
        });

        await telegramService.sendMessage("✅ *Bot is now LIVE and trading.*");

    } catch (error) {
        console.error("\n❌❌❌ A CRITICAL ERROR OCCURRED DURING INITIALIZATION ❌❌❌");
        console.error(error);
        if (telegramService) {
            await telegramService.sendMessage(`❌ *CRITICAL BOT ERROR*\n*Reason:* ${error.message}`);
        }
        process.exit(1);
    }
}

main();
