const { SmartAPI } = require("smartapi-javascript");
const config = require('../../config/index'); // Centralized config
const { generateTOTP } = require('../../utils/totp.generator'); // TOTP utility

class AngelOneService {
    constructor() {
        this.apiKey = config.angelOne.apiKey;
        this.clientCode = config.angelOne.clientCode;
        this.password = config.angelOne.password;
        this.totpSecret = config.angelOne.totpSecret;
        this.api = new SmartAPI({ api_key: this.apiKey });
        this.session = null;
    }

    _generateTOTP() {
        // Use the dedicated utility function now
        const totp = generateTOTP(this.totpSecret);
        console.log(`🔒 Generated TOTP: ${totp}`);
        return totp;
    }
    async connect() {
        try {
            console.log("🔑 Initializing Angel One connection...");
            const totp = this._generateTOTP();
            const sessionResponse = await this.api.generateSession(this.clientCode, this.password, totp);

            if (sessionResponse.status && sessionResponse.data?.jwtToken) {
                console.log("✅ Session generated successfully!");
                this.session = sessionResponse.data;
                this.session.clientCode = this.clientCode;
                return this.session;
            } else {
                throw new Error("Login failed: JWT token missing in response.");
            }
        } catch (ex) {
            console.error("❌ An error occurred during session generation:", ex.message);
            if (ex.data) console.error(JSON.stringify(ex.data, null, 2));
            throw ex;
        }
    }

    async getProfile() {
        if (!this.session) throw new Error("Not connected.");
        try {
            console.log("🔍 Fetching profile...");
            return await this.api.getProfile();
        } catch (ex) {
            console.error("❌ Error fetching profile:", ex.message);
            throw ex;
        }
    }

    async getRMS() {
        if (!this.session) throw new Error("Not connected.");
        try {
            console.log("💰 Fetching account balance (RMS)...");
            return await this.api.getRMS();
        } catch (ex) {
            console.error("❌ Error fetching RMS data:", ex.message);
            throw ex;
        }
    }

    /**
     * Places an order.
     * @param {object} tradeDetails - Details of the trade to be placed.
     * @returns {Promise<object>} The order placement response.
     */
    async placeOrder(tradeDetails) {
        if (!this.session) {
            throw new Error("Cannot place order, not connected. Please call connect() first.");
        }

        const {
            tradingsymbol, // e.g., 'NIFTY25JUL25000CE'
            symboltoken, // e.g., '64352'
            transactiontype, // 'BUY' or 'SELL'
            quantity // e.g., 50
        } = tradeDetails;

        // Standard order parameters
        const orderParams = {
            variety: "NORMAL",
            tradingsymbol,
            symboltoken,
            transactiontype,
            exchange: "NFO", // Assuming options trading on NFO
            ordertype: "MARKET", // Placing a market order for simplicity
            producttype: "INTRADAY", // or CARRYFORWARD
            duration: "DAY",
            quantity: quantity.toString(),
        };

        try {
            console.log(`\n\n🔔 Placing Order: ${transactiontype} ${quantity} of ${tradingsymbol}`);
            console.log("📦 Order Params:", JSON.stringify(orderParams, null, 2));

            // Uncomment the line below to place a real order
            // const orderResponse = await this.api.placeOrder(orderParams);

            // ⚠️ For now, we simulate the response to avoid placing real orders during testing.
            const orderResponse = { status: true, message: "SIMULATED ORDER PLACED", data: { orderid: `sim_${Date.now()}` } };
            console.log("✅ Order Response:", JSON.stringify(orderResponse, null, 2));
            
            return orderResponse;

        } catch (ex) {
            console.error(`❌ Error placing order for ${tradingsymbol}:`, ex.message);
            if (ex.data) {
                console.error(JSON.stringify(ex.data, null, 2));
            }
            throw ex;
        }
    }
}

module.exports = AngelOneService;