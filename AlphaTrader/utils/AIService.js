// File: /trading-bot/utils/AIService.js

const https = require('https');

class AIService {
    constructor(context) {
        this.apiKey = process.env.GEMINI_API_KEY;
        this.context = context; // { strategies, allTrades }
    }

    /**
     * Queries the Gemini AI with a user's question and the bot's current data.
     * @param {string} userQuestion - The question from the user.
     * @returns {Promise<string>} The text response from the AI.
     */
    async getInsights(userQuestion) {
        if (!this.apiKey) {
            return "AI Service is not configured. Please add a `GEMINI_API_KEY` to your .env file.";
        }

        // 1. Create a concise summary of the bot's state to provide context to the AI.
        const botState = this.buildContextData();
        const contextPrompt = JSON.stringify(botState, null, 2);

        // 2. Build the full prompt for the AI.
        const fullPrompt = `
You are a trading bot analyst. Your goal is to answer the user's question based *only* on the JSON data provided below. Do not make up information. Be concise and clear.

**Live Trading Data:**
\`\`\`json
${contextPrompt}
\`\`\`

**User's Question:** "${userQuestion}"

**Your Analysis:**
`;

        // 3. Make the API call to Google Gemini.
        return new Promise((resolve, reject) => {
            const payload = JSON.stringify({
                contents: [{
                    parts: [{ text: fullPrompt }]
                }]
            });
            
            const options = {
                hostname: 'generativelanguage.googleapis.com',
                path: `/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${this.apiKey}`,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(payload)
                }
            };
            
            let responseData = '';
            const req = https.request(options, (res) => {
                res.on('data', (chunk) => {
                    responseData += chunk;
                });
                res.on('end', () => {
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        try {
                            const parsedResponse = JSON.parse(responseData);
                            const text = parsedResponse.candidates[0].content.parts[0].text;
                            resolve(text.trim());
                        } catch (e) {
                            reject(new Error("Failed to parse AI response."));
                        }
                    } else {
                        reject(new Error(`AI API request failed with status code ${res.statusCode}: ${responseData}`));
                    }
                });
            });

            req.on('error', (e) => {
                reject(e);
            });

            req.write(payload);
            req.end();
        });
    }

    /**
     * Helper function to compile the bot's current state into a structured object.
     */
    buildContextData() {
        const strategiesState = [];
        this.context.strategies.forEach((strategy, name) => {
            strategiesState.push({
                name: name,
                isActive: strategy.isActive,
                unrealizedPnL: strategy.getUnrealizedPnL(),
                openPositions: Array.from(strategy.openPositions.values()).map(pos => ({
                    symbol: pos.instrument.symbol,
                    quantity: pos.quantity,
                    entryPrice: pos.entryPrice
                }))
            });
        });

        return {
            reportTime: new Date().toISOString(),
            strategies: strategiesState,
            closedTrades: this.context.allTrades
        };
    }
}

module.exports = AIService;
