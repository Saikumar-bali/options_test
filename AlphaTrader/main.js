// File: /main.js

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, './.env') });
const Conductor = require('./utils/Conductor.js');

async function main() {
    console.log("=============================================");
    console.log("🚀 STARTING ALPHATRADER BOT APPLICATION 🚀");
    console.log("=============================================");
    
    const conductor = new Conductor();
    
    try {
        await conductor.initialize();
        conductor.run();
        
        console.log("\n✅ Conductor is live. Bot is running.");
        console.log("=============================================");
        console.log("Press CTRL+C to stop the bot and generate the daily performance report.");

    } catch (error) {
        console.error("\n❌❌❌ A CRITICAL ERROR OCCURRED DURING INITIALIZATION ❌❌❌");
        console.error(error);
        if (conductor.telegramService) {
            await conductor.telegramService.sendMessage(`❌ *CRITICAL BOT ERROR*\n*Reason:* ${error.message}`);
        }
        process.exit(1);
    }
    
    process.on('SIGINT', async () => {
        if (conductor) {
            await conductor.shutdown();
        }
        process.exit(0);
    });
}

main();
