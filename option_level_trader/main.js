// File: /option_level_trader/main.js
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') }); 
const fs = require('fs'); 
const schedule = require('node-schedule');
const moment = require('moment-timezone');

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

        try {
            const { calculateDynamicExpiries } = require('../trading-bot/utils/expiry_helper');
            const moment = require('moment');
            const instrumentAdapter = {
                getInstrumentsByUnderlying: (underlying) => {
                    return instrumentLoader.instruments
                        .filter(i => i.name === underlying)
                        .map(inst => {
                            const copy = { ...inst };
                            if (copy.expiry && copy.expiry.includes('-')) {
                                const parsed = moment(copy.expiry, ['DD-MMM-YYYY', 'DD-MMM-YY', 'DD-MMM-YYYY']);
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

        telegramService.initializeCommands(positionManager, reportGenerator, allTrades);

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

        const createdOptionsUnderlyings = new Set([...strategies.values()].filter(s => s instanceof OptionsLevelStrategy).map(s => s.underlying.symbol));
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

            for (const [strategyName, strategy] of strategies.entries()) {
                if (strategy instanceof OptionsLevelStrategy) {
                    try {
                        await strategy.updateATMandLevels();
                    } catch (err) {
                        console.error(`Error updating ATM/levels for ${strategy.underlying.symbol}:`, err);
                    }
                }
            }



            let fileContent = "Initial Support & Resistance Levels for ATM Options\n===================================================\n\n";
            let processedCount = 0;

            for (const [strategyName, strategy] of strategies.entries()) {
                if (strategy instanceof OptionsLevelStrategy) {
                    const levels = strategy.getLevelsAndLTP();
                    if (Object.keys(levels).length === 0) {
                        fileContent += `${strategy.underlying.symbol}: No ATM options found or levels calculated.\n\n`;
                    } else {
                        processedCount++;
                        fileContent += `${strategy.underlying.symbol}\n`;
                        for (const optionSymbol in levels) {
                            const optionData = levels[optionSymbol];
                            const supports = optionData.supports.length > 0 ? optionData.supports.map(l => l.toFixed(2)).join(', ') : 'N/A';
                            const resistances = optionData.resistances.length > 0 ? optionData.resistances.map(r => r.toFixed(2)).join(', ') : 'N/A';

                            fileContent += `  ${optionSymbol} (LTP: ${optionData.ltp.toFixed(2)})\n`;
                            fileContent += `    - Supports: ${supports}\n`;
                            fileContent += `    - Resistances: ${resistances}\n\n`;
                        }
                    }
                }
            }

            const summaryMessage = `📊 *Initial Levels Calculated*\n\nProcessed ${processedCount} instruments.\nFull details are in the attached file.`;
            await telegramService.sendMessage(summaryMessage);

            // Write to file and send
            const levelsFilePath = path.resolve(__dirname, 'initial_levels.txt');
            try {
                fs.writeFileSync(levelsFilePath, fileContent);
                await telegramService.sendReport(levelsFilePath, "📊 Initial Levels File");
                console.log("✅ Initial S/R levels file sent to Telegram.");
            } catch (err) {
                console.error("❌ Failed to write or send levels file:", err);
            }

            console.log("✅ Initial S/R levels calculated.");
        }, 10000);

        const isMCXEnabled = STRATEGY_CONFIG.some(cfg => cfg.enabled && cfg.exchange === 'MCX');
        console.log(`\n[Main] Market Hours Mode: ${isMCXEnabled ? 'EXTENDED (MCX Active)' : 'STANDARD (NSE/BSE only)'}`);

        // ============================================
        // ⏰ 3:15 PM: EQUITY SQUARE-OFF ONLY
        // ============================================
        schedule.scheduleJob({ hour: 15, minute: 15, tz: 'Asia/Kolkata' }, async () => {
            console.log("⏰ 3:15 PM: Stopping EQUITY strategies and squaring off NSE/BSE positions.");
            await telegramService.sendMessage("⏰ *3:15 PM Alert*\nEquity Intraday Square-off triggered.");

            // 1. Stop only Equity Strategies
            strategies.forEach((strategy, key) => {
                if (strategy.stop && strategy.config && strategy.config.exchange !== 'MCX') {
                    strategy.stop();
                    console.log(`[Main] Stopped Equity strategy: ${key}`);
                }
            });

            // 2. Square off only Equity (NSE, NFO, BSE, BFO)
            const equityExchanges = ['NSE', 'NFO', 'BSE', 'BFO'];
            positionManager.cancelPendingOrders(equityExchanges);
            positionManager.closePositions("3:15 PM Equity Auto-Squareoff", equityExchanges);
        });

        // ============================================
        // 📊 3:30 PM: EQUITY REPORT (Interim)
        // ============================================
        schedule.scheduleJob({ hour: 15, minute: 30, tz: 'Asia/Kolkata' }, async () => {
            console.log("📊 3:30 PM: Generating Equity Market Report.");
            
            // Double check equity closure
            const equityExchanges = ['NSE', 'NFO', 'BSE', 'BFO'];
            positionManager.closePositions("3:30 PM Final Equity Close", equityExchanges);

            const reportPath = await reportGenerator.generateTradeReport(allTrades, positionManager.openPositions);
            await telegramService.sendReport(reportPath, "📊 Equity EOD Report (3:30 PM)");
        });

        // ============================================
        // ⏰ 11:15 PM: MCX SQUARE-OFF
        // ============================================
        if (isMCXEnabled) {
            schedule.scheduleJob({ hour: 23, minute: 15, tz: 'Asia/Kolkata' }, async () => {
                console.log("⏰ 11:15 PM: Stopping MCX strategies and squaring off positions.");
                await telegramService.sendMessage("⏰ *11:15 PM Alert*\nMCX Intraday Square-off triggered.");

                strategies.forEach((strategy, key) => {
                    if (strategy.stop && strategy.config && strategy.config.exchange === 'MCX') {
                        strategy.stop();
                        console.log(`[Main] Stopped MCX strategy: ${key}`);
                    }
                });

                const mcxExchanges = ['MCX', 'MCXFO'];
                positionManager.cancelPendingOrders(mcxExchanges);
                positionManager.closePositions("11:15 PM MCX Auto-Squareoff", mcxExchanges);
                
                // Final Report
                const reportPath = await reportGenerator.generateTradeReport(allTrades, []);
                await telegramService.sendReport(reportPath, "📊 Final EOD Report (MCX Close)");
            });
        }

        // ============================================
        // 🔌 BOT SHUTDOWN (11:30 PM or 4:00 PM)
        // ============================================
        const shutdownHour = isMCXEnabled ? 23 : 16; 
        const shutdownMinute = isMCXEnabled ? 30 : 0; 

        schedule.scheduleJob({ hour: shutdownHour, minute: shutdownMinute, tz: 'Asia/Kolkata' }, async () => {
            await telegramService.sendMessage("🔌 *Bot is shutting down now. Goodbye!*");
            masterController.disconnectWebSocket();
            process.exit(0);
        });

        await telegramService.sendMessage("✅ *Bot is now LIVE and trading.*\n_Try commands: /livepnl, /report, /status_");

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