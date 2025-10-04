const instrumentService = require('../../bot/services/instrument.service');

// Controller to get the nearest 2 expiries for a specific index
const getExpiryDates = async (req, res, next) => {
    try {
        const { index } = req.query;
        if (!index) {
            return res.status(400).json({ message: 'Index query parameter is required (e.g., ?index=NIFTY).' });
        }
        const expiries = await instrumentService.getExpiriesForIndex(index);
        res.status(200).json(expiries);
    } catch (error) {
        next(error);
    }
};

// Controller to get option contracts for a specific index and expiry
const getOptionContracts = async (req, res, next) => {
    try {
        const { index, expiry } = req.query;
        if (!index || !expiry) {
            return res.status(400).json({ message: 'Index and expiry query parameters are required.' });
        }
        const contracts = await instrumentService.getOptionContracts(index, expiry);
        res.status(200).json(contracts);
    } catch (error) {
        next(error);
    }
};

module.exports = {
    getExpiryDates,
    getOptionContracts, // Export the new controller
};
