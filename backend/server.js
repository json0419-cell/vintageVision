// backend/server.js
// backend/server.js
console.log("SERVER.JS LOADED");
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const path = require('path');
const cookieParser = require('cookie-parser');

require('dotenv').config({ path: path.join(__dirname, '.env') });

const logger = require('./utils/logger');

// Routes
const authRoutes = require('./routes/auth');              // (optional legacy)
const googleAuthRouter = require('./routes/googleAuth');  // Google OAuth
const photosRouter = require('./routes/photos');          // Google Photos
const meRouter = require('./routes/me');                  // /api/auth/me
const dashboardRoutes = require('./routes/dashboard');    // Dashboard
const analysisRouter = require('./routes/analysis');      // Vision + Gemini

const app = express();
const PORT = process.env.PORT || 8080;

/* ------------------- Global Middleware ------------------- */

// 1. Cookies
app.use(cookieParser());

// 2. Helmet
app.use(
    helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
                scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
                imgSrc: ["'self'", "data:", "https:"],
                connectSrc: ["'self'", "https://cdn.jsdelivr.net"],
            },
        },
    })
);

// 3. Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: 'Too many requests, try again later.',
});
app.use('/api/', limiter);

// 4. CORS
app.use(
    cors({
        origin: process.env.FRONTEND_URL || 'http://localhost:3000',
        credentials: true,
    })
);

// 5. Compression + logging
app.use(compression());
app.use(
    morgan('combined', {
        stream: { write: (msg) => logger.info(msg.trim()) },
    })
);

// 6. Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// 7. Static files (for local dev; in prod, App Engine also serves via handlers)
app.use(express.static(path.join(__dirname, '../frontend')));

/* ------------------- API Routes ------------------- */

app.use('/api/auth', googleAuthRouter);
app.use('/api/auth', authRoutes);
app.use('/api', photosRouter);
app.use('/api', meRouter);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/analysis', analysisRouter);

app.get('/api/health', (req, res) => {
    res.status(200).json({
        status: 'OK',
        timestamp: new Date().toISOString(),
    });
});

/* ------------------- Frontend Fallback ------------------- */

// IMPORTANT: use absolute path from __dirname; this is what failed before.
app.get('*', (req, res, next) => {
    const indexPath = path.join(__dirname, '../frontend/index.html');
    res.sendFile(indexPath, (err) => {
        if (err) {
            // Let our error middleware handle it instead of sending 500 directly
            next(err);
        }
    });
});

/* ------------------- Error Handling ------------------- */

app.use((err, req, res, next) => {
    console.error('🔥 UNHANDLED ERROR 🔥');
    console.error(err);

    logger.error('Unhandled error:', {
        message: err.message,
        stack: err.stack,
        name: err.name,
    });

    res.status(err.statusCode || 500).json({
        error: 'Internal Server Error',
        message:
            process.env.NODE_ENV === 'development'
                ? err.message
                : 'Something went wrong',
    });
});

// 404 (API only – most non-API hits are caught by index.html)
app.use((req, res) => {
    res.status(404).json({ error: 'Route not found' });
});

/* ------------------- Startup ------------------- */

app.listen(PORT, () => {
    logger.info(`Server running on port ${PORT}`);
    logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

module.exports = app;
