const express = require('express');
const router = express.Router();
const controller = require('../controllers/instruments.controller');

// GET /api/instruments/expiries?index=NIFTY
router.get('/expiries', controller.getExpiryDates);

// GET /api/instruments/contracts?index=NIFTY&expiry=17-Jul-2025
router.get('/contracts', controller.getOptionContracts); // <<< NEW ROUTE

module.exports = router;