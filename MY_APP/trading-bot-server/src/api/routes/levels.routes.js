const express = require('express');
const router = express.Router();
const controller = require('../controllers/levels.controller');

// GET /api/levels?expiry=...
router.get('/', controller.getLevelsByExpiry);

// POST /api/levels
router.post('/', controller.addLevel);

// CRITICAL: Ensure this line exports the router directly, not an object containing it.
// Correct: module.exports = router;
// Incorrect: module.exports = { router };
module.exports = router;