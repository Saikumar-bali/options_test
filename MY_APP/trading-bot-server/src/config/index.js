require('dotenv').config();

const config = {
    // API Server Port
    apiPort: process.env.API_PORT || 3001,

    // Database Configuration
    db: {
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD, // It's better to not have a default for passwords
        name: process.env.DB_NAME || 'trading_bot',
    },

    // Angel One API Credentials
    angelOne: {
        apiKey: process.env.SMART_API_KEY,
        clientCode: process.env.SMART_CLIENT_CODE,
        password: process.env.SMART_PASSWORD,
        totpSecret: process.env.TOTP_SECRET,
    }
};

module.exports = config;