// File: /trading-bot/utils/AIService.js

const https = require('https');

class AIService {
    constructor(context) {
        this.apiKey = process.env.GEMINI_API_KEY;
        this.context = context; // { strategies, allTrades, positionManager }
    }

    async getInsights(userQuestion) {
        if (!this.apiKey) {
            return "AI Service is not configured. Please add a `GEMINI_API_KEY` to your .env file.";
        }

        // Build the context data dynamically
        const botState = this.buildContextData();
        const contextPrompt = JSON.stringify(botState, null, 2);

        const fullPrompt = `
You are a helpful trading bot assistant. Your task is to answer the user's question based *only* on the JSON data provided below. Do not make up information. Format your answers clearly using Markdown.

**Live Trading Data:**
\`\`\`json
${contextPrompt}
\`\`\`

**User's Question:** "${userQuestion}"

**Your Answer:**
`;

        return new Promise((resolve, reject) => {
            const payload = JSON.stringify({
                contents: [{ parts: [{ text: fullPrompt }] }]
            });
            const options = {
                hostname: 'generativelanguage.googleapis.com',
                // FIXED: Updated model name to 'gemini-1.5-flash-latest' to resolve the 404 error.
                path: `/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${this.apiKey}`,
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
            };
            let responseData = '';
            const req = https.request(options, (res) => {
                res.on('data', (chunk) => { responseData += chunk; });
                res.on('end', () => {
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        try {
                            const parsedResponse = JSON.parse(responseData);
                            // It's good practice to check if candidates array exists and has elements
                            if (parsedResponse.candidates && parsedResponse.candidates.length > 0) {
                                const text = parsedResponse.candidates[0].content.parts[0].text;
                                resolve(text.trim());
                            } else {
                                reject(new Error("AI response was successful but contained no content."));
                            }
                        } catch (e) {
                            console.error("AI Response Parsing Error:", responseData);
                            reject(new Error("Failed to parse AI response."));
                        }
                    } else {
                        reject(new Error(`AI API request failed with status code ${res.statusCode}: ${responseData}`));
                    }
                });
            });
            req.on('error', (e) => { reject(e); });
            req.write(payload);
            req.end();
        });
    }

    /**
     * MODIFIED: Compiles the bot's state, now including live positions and P&L from the PositionManager.
     */
    buildContextData() {
        const strategiesState = [];
        this.context.strategies.forEach((strategy, name) => {
            const levelsAndLtp = strategy.getLevelsAndLTP ? strategy.getLevelsAndLTP() : {};
            strategiesState.push({
                name: name,
                isActive: strategy.isActive,
                underlying_ltp: levelsAndLtp.ltp || 'N/A',
                support_levels: levelsAndLtp.supports || [],
                resistance_levels: levelsAndLtp.resistances || [],
            });
        });

        // NEW: Get live positions and total P&L directly from the PositionManager
        const livePositions = this.context.positionManager ? this.context.positionManager.getLivePositions() : [];
        const totalLivePnl = livePositions.reduce((acc, pos) => acc + pos.pnl, 0);

        return {
            reportTime: new Date().toISOString(),
            livePositions: livePositions,
            totalLivePnl: parseFloat(totalLivePnl.toFixed(2)),
            strategies: strategiesState,
            closedTrades: this.context.allTrades
        };
    }
}

module.exports = AIService;
