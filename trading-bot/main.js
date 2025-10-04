const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, './.env') });
const axios = require('axios');
const fs = require('fs');
const schedule = require('node-schedule');

const MasterController = require('../universal websocket/index.js');
const { STRATEGY_CONFIG } = require('../trading-bot/config/trade_config.js');

// --- STRATEGY IMPORTS ---
const S_R_BB_Strategy = require('../trading-bot/strategies/S_R_BB_Strategy.js');
const SupportRetestStrategy = require('../trading-bot/strategies/SupportRetestStrategy.js');
const ResistanceRetestStrategy = require('../trading-bot/strategies/ResistanceRetestStrategy.js');
const PositionManager = require('../trading-bot/strategies/PositionManager.js');

// --- UTILITY IMPORTS ---
const InstrumentLoader = require('../trading-bot/utils/instrument_loader.js');
const TelegramService = require('../trading-bot/utils/TelegramService.js');
const ReportGenerator = require('../trading-bot/utils/ReportGenerator.js');
const AIService = require('../trading-bot/utils/AIService.js');
const DataFetcher = require('../trading-bot/utils/DataFetcher.js');

let masterController;
let telegramService;
let aiService;
let positionManager;
const reportGenerator = new ReportGenerator();
const allTrades = [];
const strategies = new Map();

async function downloadInstrumentFile() {
    const instrumentFileUrl = 'https://smartapi.angelbroking.com/publisher/scripMaster';
    const dataDir = path.resolve(__dirname, 'trading-bot/data');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    const destinationPath = path.resolve(dataDir, 'instruments.json');

    console.log('🔄 Checking for updated instrument file...');
    try {
        const response = await axios.get(instrumentFileUrl, { responseType: 'json' });
        const currentData = JSON.stringify(response.data);

        if (fs.existsSync(destinationPath) && fs.readFileSync(destinationPath, 'utf8') === currentData) {
            console.log('ℹ️ Instrument file is already up-to-date.');
            return;
        }

        fs.writeFileSync(destinationPath, currentData);
        console.log(`✅ Successfully downloaded and saved the latest instrument file to ${destinationPath}`);
    } catch (error) {
        console.error('❌ Failed to download instrument file:', error.message);
        if (!fs.existsSync(destinationPath)) {
            throw new Error("Fatal: Instrument file is missing and could not be downloaded.");
        }
    }
}

/**
 * Saves the generated support and resistance levels to a text file.
 * @param {string} levelsContent The formatted string containing the S/R levels.
 * @returns {Promise<string|null>} The path to the saved file, or null on error.
 */
async function saveLevelsToFile(levelsContent) {
    // Remove markdown characters for a cleaner text file
    const plainTextContent = levelsContent.replace(/[*📊]/g, '').trim();
    const reportsDir = path.resolve(__dirname, 'trading-bot', 'reports');
    const filePath = path.resolve(reportsDir, 'support_resistance_levels.txt');

    try {
        if (!fs.existsSync(reportsDir)) {
            fs.mkdirSync(reportsDir, { recursive: true });
            console.log(`📂 Created reports directory at: ${reportsDir}`);
        }
        fs.writeFileSync(filePath, plainTextContent, 'utf8');
        console.log(`✅ Support and Resistance levels saved to ${filePath}`);
        return filePath;
    } catch (error) {
        console.error(`❌ Failed to save S/R levels to file:`, error);
        return null;
    }
}


async function generateAndSendFinalReport() {
    console.log("\n\n🕒 Triggering end-of-day report generation...");
    const openPositions = positionManager.openPositions;

    if (allTrades.length > 0 || openPositions.length > 0) {
        console.log(`📄 Generating trade report for ${allTrades.length} closed trades and ${openPositions.length} open positions...`);
        try {
            const reportPath = await reportGenerator.generateTradeReport(allTrades, openPositions);
            console.log(`✅ Report generated at: ${reportPath}`);
            await telegramService.sendReport(reportPath, "📈 Here is the final trade report for the day.");
        } catch (e) {
            console.error("❌ Failed to generate or send report:", e);
            await telegramService.sendMessage("❌ Failed to generate the daily trade report.");
        }
    } else {
        console.log("ℹ️ No trades were executed or left open in this session.");
        await telegramService.sendMessage("Bot session ended. No trades were executed or left open today.");
    }
}

async function shutdown() {
    console.log("\n\n🛑 Gracefully shutting down the bot...");
    await telegramService.sendMessage("🔌 *Bot is shutting down now. Goodbye!*");

    if (masterController) {
        masterController.disconnectWebSocket();
    }

    console.log("\n👋 Goodbye!");
    setTimeout(() => process.exit(0), 2000);
}

async function main() {
    console.log("=============================================");
    console.log("🚀 STARTING TRADING BOT APPLICATION 🚀");
    console.log("=============================================");

    try {
        const instrumentLoader = new InstrumentLoader();
        await instrumentLoader.loadInstruments();
        console.log("✅ Instruments loaded successfully.");

        const { calculateDynamicExpiries } = require('../trading-bot/utils/expiry_helper');
        await calculateDynamicExpiries(instrumentLoader, STRATEGY_CONFIG);

        masterController = new MasterController();
        telegramService = new TelegramService();
        positionManager = new PositionManager(masterController, telegramService);
        const dataFetcher = new DataFetcher(masterController);

        const sharedContext = { strategies, allTrades, reportGenerator, shutdown, positionManager };
        aiService = new AIService(sharedContext);
        telegramService.setupCommands(sharedContext, aiService);

        await masterController.initialize();
        await telegramService.sendMessage("✅ *Bot is starting up...*");

        positionManager.on('tradeCompleted', (tradeData) => allTrades.push(tradeData));

        const initializedStrategies = [];
        for (const config of STRATEGY_CONFIG) {
            if (!config.enabled) continue;

            let strategy;
            console.log(`[${config.underlying}] Initializing with strategy: ${config.strategy}`);

            try {
                const strategyArgs = [masterController, config, instrumentLoader, telegramService, positionManager, dataFetcher];

                switch (config.strategy) {
                    case 'SUPPORT_RETEST':
                        strategy = new SupportRetestStrategy(...strategyArgs);
                        break;
                    case 'RESISTANCE_RETEST':
                        strategy = new ResistanceRetestStrategy(...strategyArgs);
                        break;
                    case 'S_R_BB':
                        strategy = new S_R_BB_Strategy(...strategyArgs.slice(0, -2));
                        break;
                    default:
                        console.error(`[${config.underlying}] Unknown strategy type '${config.strategy}'.`);
                        continue;
                }

                await strategy.initialize();
                initializedStrategies.push(strategy);
            } catch (error) {
                console.error(`\n❌ FAILED to initialize strategy ${config.strategy} for ${config.underlying} ❌`);
                console.error(error);
            }
        }

        console.log("\nRegistering all initialized strategies with MasterController...");
        masterController.registerStrategy(positionManager);
        console.log(`  -> Registered: PositionManager`);

        for (const strategy of initializedStrategies) {
            masterController.registerStrategy(strategy);
            strategies.set(`${strategy.config.underlying.toUpperCase()}_${strategy.config.strategy}`, strategy);
            console.log(`  -> Registered: ${strategy.constructor.name} for ${strategy.config.underlying}`);
        }

        console.log("\n✅ All strategies registered. Sending one master subscription request...");
        masterController.subscribeToTokens();

        console.log("\nℹ️ Waiting 10 seconds for initial price data to arrive...");
        setTimeout(async () => {
            console.log("\n🔄 Triggering initial S/R level calculation for all strategies...");
            
            const updatePromises = initializedStrategies.map(s => {
                if (typeof s.updateLevels === 'function') {
                    return s.updateLevels();
                } else if (typeof s.updateLevelsAndOptions === 'function') {
                    return s.updateLevelsAndOptions();
                }
                return Promise.resolve();
            });

            await Promise.all(updatePromises);
            console.log("✅ All S/R levels calculated.");

            let levelsMessage = "📊 *Initial Support & Resistance Levels* 📊\n\n";
            
            initializedStrategies.forEach(strategy => {
                const underlyingSymbol = strategy.config.underlying.toUpperCase();
                const levels = strategy.getLevelsAndLTP();
                
                const supports = levels.supports.length > 0 ? levels.supports.map(l => l.toFixed(2)).join(', ') : 'N/A';
                const resistances = levels.resistances.length > 0 ? levels.resistances.map(r => r.toFixed(2)).join(', ') : 'N/A';
                
                levelsMessage += `*${underlyingSymbol}* (LTP: ${levels.ltp.toFixed(2)})\n`;
                levelsMessage += `  - *Supports:* ${supports}\n`;
                levelsMessage += `  - *Resistances:* ${resistances}\n\n`;
            });

            // Save the levels to a .txt file and get the path
            const levelsFilePath = await saveLevelsToFile(levelsMessage);

            // Send the text message to Telegram
            await telegramService.sendMessage(levelsMessage);
            console.log("📢 Sent initial S/R levels to Telegram.");

            // If the file was saved successfully, send it as a document
            if (levelsFilePath) {
                await telegramService.sendReport(levelsFilePath, "📄 Here are the S/R levels as a file.");
                console.log(`📢 Sent S/R levels file to Telegram from ${levelsFilePath}.`);
            }

        }, 10000);

        console.log(`\n✅ S/R level calculation will now only run once at startup.`);

        console.log("\n⏰ Scheduling end-of-day tasks...");
        
        // --- CARRY FORWARD POSITIONS ---
        // The automatic 3:15 PM square-off job has been disabled as requested.
        // schedule.scheduleJob({ hour: 15, minute: 15, dayOfWeek: [1, 2, 3, 4, 5], tz: 'Asia/Kolkata' }, () => {
        //     console.log("🕒 Time is 3:15 PM. Closing all open trades.");
        //     if (positionManager) {
        //         positionManager.closeAllPositions('Market closing square-off');
        //     }
        // });
        console.log("  -> Positions will be carried forward. Auto square-off is DISABLED.");

        schedule.scheduleJob({ hour: 15, minute: 31, dayOfWeek: [1, 2, 3, 4, 5], tz: 'Asia/Kolkata' }, async () => {
            await telegramService.sendMessage("🕒 *Market Closed. Generating daily report...*");
            await generateAndSendFinalReport();
        });
        console.log("  -> Daily report scheduled for 15:31 IST (Mon-Fri).");

        schedule.scheduleJob({ rule: '40-59 15 * * 1-5', tz: 'Asia/Kolkata' }, async () => {
            console.log('🔄 Daily end-of-day instrument refresh triggered...');
            try {
                const updated = await instrumentLoader.downloadInstruments();
                if (updated) {
                    console.log('✅ Instrument file has been updated for the next trading day.');
                    await telegramService.sendMessage("📦 Instrument file has been updated.");
                }
            } catch (error) {
                console.error('❌ Daily instrument refresh failed:', error.message);
                await telegramService.sendMessage(`❌ Daily instrument refresh failed: ${error.message}`);
            }
        });

        console.log("  -> Daily instrument refresh scheduled for 15:40-15:59 IST (Mon-Fri)");
        
        schedule.scheduleJob({ hour: 16, minute: 0, dayOfWeek: [1, 2, 3, 4, 5], tz: 'Asia/Kolkata' }, shutdown);
        console.log("  -> Graceful shutdown scheduled for 16:00 IST (Mon-Fri).");

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

process.on('SIGINT', async () => {
    console.log("\n\n⚠️ SIGINT received. Manual shutdown initiated.");
    await generateAndSendFinalReport();
    await shutdown();
});

main();
