// backend/server.js
// Load environment variables FIRST, before any other imports
// This ensures all modules have access to environment variables
require('./config/env')();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const path = require('path');
const cookieParser = require('cookie-parser');

const logger = require('./utils/logger');

// Routes
const authRoutes = require('./routes/auth');          // Old JWT routes (optional)
const googleAuthRouter = require('./routes/googleAuth'); // Google OAuth
const photosRouter = require('./routes/photos');         // Google Photos
const meRouter = require('./routes/me');                 // /api/auth/me
const dashboardRoutes = require('./routes/dashboard');   // Dashboard
const analysisRouter = require('./routes/analysis');     // Vision + Gemini analysis

const app = express();
const PORT = process.env.PORT || 3000;

/* ------------------- Global Middleware (Order is Very Important) ------------------- */

// ⭐ 1. Cookie parsing (must be first)
app.use(cookieParser());

// 2. Helmet security policy
app.use(
    helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
                scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
                imgSrc: ["'self'", "data:", "https:"],
                connectSrc: ["'self'", "https://cdn.jsdelivr.net"], // Allow sourcemap
            },
        },
    })
);

// 3. Rate limiting (protect /api/)
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: 'Too many requests, try again later.',
});
app.use('/api/', limiter);

// 4. CORS (allow frontend to include cookies)
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

// 7. Static files
app.use(express.static(path.join(__dirname, '../frontend')));

/* ------------------- API Routes (All must be after cookieParser) ------------------- */

// Handle legacy /auth/google/callback route (redirect to /api/auth/google/callback)
// This is needed if GOOGLE_REDIRECT_URI is configured as /auth/google/callback
app.get('/auth/google/callback', (req, res) => {
    const params = new URLSearchParams(req.query);
    res.redirect(`/api/auth/google/callback?${params.toString()}`);
});

// Google OAuth login
app.use('/api/auth', googleAuthRouter);

// If still using JWT authRoutes (can delete)
app.use('/api/auth', authRoutes);

// Google Photos
app.use('/api', photosRouter);

// Current user info
app.use('/api', meRouter);

// Dashboard API
app.use('/api/dashboard', dashboardRoutes);

// Vision + Gemini analysis
app.use('/api/analysis', analysisRouter);

// Health check
app.get('/api/health', (req, res) => {
    res.status(200).json({
        status: 'OK',
        timestamp: new Date().toISOString(),
    });
});

/* ------------------- Frontend Routes (SPA style) ------------------- */

// All non-/api requests → return index.html
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

/* ------------------- Error Handling ------------------- */

app.use((err, req, res, next) => {
    logger.error('Unhandled error:', err);
    res.status(500).json({
        error: 'Internal Server Error',
        message:
            process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong',
    });
});

// 404
app.use((req, res) => {
    res.status(404).json({ error: 'Route not found' });
});

/* ------------------- Startup ------------------- */

app.listen(PORT, () => {
    logger.info(`Server running on port ${PORT}`);
    logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

module.exports = app;
