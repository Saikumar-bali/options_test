// D:\master_controller\advanced_strategy\logger.js
const fs = require('fs');
const moment = require('moment-timezone');

class Logger {
    constructor(config) {
        this.tradeLogStream = fs.createWriteStream(config.tradeLogCsv, { flags: 'a' });
        this.errorLogStream = fs.createWriteStream(config.errorLog, { flags: 'a' });
        this.debugMode = config.debugMode || false;

        // Write CSV Headers if file is new/empty
        if (fs.existsSync(config.tradeLogCsv) && fs.statSync(config.tradeLogCsv).size === 0) {
            this.tradeLogStream.write('Timestamp,Token,Symbol,Action,Price,Quantity,SL,TP,PNL,Reason,DailyPNL\n');
        }
    }
    log(level, message, data = '') {
        const timestamp = moment().tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss");
        const logMessage = `[${timestamp}] [${level.toUpperCase()}] ${message} ${data ? JSON.stringify(data) : ''}\n`;
        console.log(logMessage.trim());
        if (level === 'error') {
            this.errorLogStream.write(logMessage);
        }
    }

    info(message, data) { this.log('info', message, data); }
    warn(message, data) { this.log('warn', message, data); }
    error(message, data, errorObj) {
        const errorMessage = errorObj instanceof Error ? `${message} - ${errorObj.message} ${errorObj.stack}` : message;
        this.log('error', errorMessage, data);
    }
    debug(message, data) { if (this.debugMode) this.log('debug', message, data); }

    logTrade(trade) {
        const timestamp = moment(trade.timestamp || Date.now()).tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss");
        const pnl = trade.pnl !== null && trade.pnl !== undefined ? trade.pnl.toFixed(2) : 'N/A';
        const dailyPnl = trade.dailyPnl !== null && trade.dailyPnl !== undefined ? trade.dailyPnl.toFixed(2) : 'N/A';
        const sl = trade.sl !== null && trade.sl !== undefined ? trade.sl.toFixed(2) : 'N/A';
        const tp = trade.tp !== null && trade.tp !== undefined ? trade.tp.toFixed(2) : 'N/A';

        const csvRow = [
            timestamp,
            trade.token,
            trade.symbol,
            trade.action, // BUY, SELL, SL_HIT, TP_HIT
            trade.price.toFixed(2),
            trade.quantity,
            sl,
            tp,
            pnl,
            trade.reason || '',
            dailyPnl
        ].join(',') + '\n';
        this.tradeLogStream.write(csvRow);
        this.info(`TRADE: ${trade.action} ${trade.symbol} Q:${trade.quantity} @${trade.price.toFixed(2)} PNL: ${pnl} Reason: ${trade.reason || ''}`);
    }

    close() {
        this.tradeLogStream.end();
        this.errorLogStream.end();
    }
}

module.exports = Logger;