const express = require('express');
const cors = require('cors');
const config = require('../config'); // Use centralized config
const errorHandler = require('./middleware/errorHandler')
// Import route handlers
const levelRoutes = require('./routes/levels.routes');
const instrumentRoutes = require('./routes/instruments.routes');

const app = express();
const port = config.apiPort;

// --- Middleware ---
app.use(cors());
app.use(express.json());

// --- API Routes ---
app.use('/api/levels', levelRoutes);
app.use('/api/instruments', instrumentRoutes);

// --- Error Handling ---
// This middleware MUST be the last one `app.use()` calls.
app.use(errorHandler);

// --- Start Server ---
app.listen(port, () => {
    console.log(`🚀 API Server for dashboard is running at http://localhost:${port}`);
});