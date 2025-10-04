const db = require('../../config/db.config'); // Import the shared DB pool

// Fetches levels. It is filtered by an 'expiry' query parameter.
const getLevelsByExpiry = async (req, res) => {
    const { expiry } = req.query;

    if (!expiry) {
        return res.status(400).json({ message: 'The "expiry" query parameter is required.' });
    }

    try {
        const query = `
            SELECT id, symbol, price_level, level_type, option_contract, option_action, expiry, created_at
            FROM support_resistance
            WHERE is_active = TRUE AND expiry = ?
            ORDER BY created_at DESC
        `;
        const [rows] = await db.query(query, [expiry]);
        res.status(200).json(rows);
    } catch (err) {
        console.error("API Error fetching levels by expiry:", err);
        res.status(500).json({ message: 'Database error while fetching levels.' });
    }
};

// Creates a new level in the database.
const addLevel = async (req, res) => {
    const {
        symbol,
        price_level,
        level_type,
        expiry,
        option_contract,
        option_action
    } = req.body;

    if (!symbol || !price_level || !level_type || !expiry) {
        return res.status(400).json({ message: 'Symbol, price level, level type, and expiry are required.' });
    }

    try {
        const query = `
            INSERT INTO support_resistance
                (symbol, price_level, level_type, expiry, option_contract, option_action)
             VALUES (?, ?, ?, ?, ?, ?)
        `;
        const [result] = await db.execute(query, [symbol, price_level, level_type, expiry, option_contract || null, option_action || null]);
        res.status(201).json({ message: 'Level added successfully.', id: result.insertId });
    } catch (err) {
        console.error("API Error inserting level:", err);
        res.status(500).json({ message: 'Database error while saving the level.' });
    }
};

module.exports = {
    getLevelsByExpiry,
    addLevel,
};
