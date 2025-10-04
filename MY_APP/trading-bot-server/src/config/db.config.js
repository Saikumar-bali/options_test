const mysql = require('mysql2/promise');
const config = require('./index'); // Import centralized config

const dbPool = mysql.createPool({
    host: config.db.host,
    user: config.db.user,
    password: config.db.password,
    database: config.db.name,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
});

module.exports = dbPool;