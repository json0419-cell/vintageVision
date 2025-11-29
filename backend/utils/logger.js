const winston = require('winston');
const path = require('path');
const fs = require('fs');

// App Engine Standard cannot write to arbitrary directories.
// Only /tmp is writable. When local, use ./logs
const isProd = process.env.GAE_ENV === 'standard';

const logDir = isProd
    ? '/tmp/logs'
    : path.join(__dirname, '../../logs');

// Ensure directory exists (locally and /tmp in prod)
if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
}

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        // Console logging always works and is visible in Cloud Logs
        new winston.transports.Console(),

        // File logging only when local or allowed path
        new winston.transports.File({
            filename: path.join(logDir, 'server.log'),
            maxsize: 5242880,
            maxFiles: 5
        })
    ]
});

module.exports = logger;
