const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
const TelegramService = require('./utils/TelegramService');

async function testTelegram() {
    console.log("Testing Telegram Service...");
    const telegramService = new TelegramService();

    if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
        console.error("❌ Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID in .env file.");
        console.log("Please create a .env file in this directory with:");
        console.log("TELEGRAM_BOT_TOKEN=your_bot_token");
        console.log("TELEGRAM_CHAT_ID=your_chat_id");
        return;
    }

    console.log("Sending test message...");
    await telegramService.sendMessage("🔔 *Test Message from Option Level Trader* 🔔\n\nIf you see this, Telegram alerts are working!");
    console.log("Test completed.");
}

testTelegram();
