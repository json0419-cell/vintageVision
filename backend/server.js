// backend/server.js
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const path = require('path');
const cookieParser = require('cookie-parser');
// 加载环境变量：从 backend 目录下的 .env 文件加载
require('dotenv').config({ path: path.join(__dirname, '.env') });

const logger = require('./utils/logger');

// 路由
const authRoutes = require('./routes/auth');          // 旧 JWT 路由（可选）
const googleAuthRouter = require('./routes/googleAuth'); // Google OAuth
const photosRouter = require('./routes/photos');         // Google Photos
const meRouter = require('./routes/me');                 // /api/auth/me
const dashboardRoutes = require('./routes/dashboard');   // Dashboard
const analysisRouter = require('./routes/analysis');     // Vision + Gemini 分析

const app = express();
const PORT = process.env.PORT || 3000;

/* ------------------- 全局中间件（顺序非常重要） ------------------- */

// ⭐ 1. cookie 解析（必须最前）
app.use(cookieParser());

// 2. Helmet 安全策略
app.use(
    helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
                scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
                imgSrc: ["'self'", "data:", "https:"],
                connectSrc: ["'self'", "https://cdn.jsdelivr.net"], // 允许 sourcemap
            },
        },
    })
);

// 3. 限流（保护 /api/）
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: 'Too many requests, try again later.',
});
app.use('/api/', limiter);

// 4. CORS（允许前端带 cookie）
app.use(
    cors({
        origin: process.env.FRONTEND_URL || 'http://localhost:3000',
        credentials: true,
    })
);

// 5. 压缩 + 日志
app.use(compression());
app.use(
    morgan('combined', {
        stream: { write: (msg) => logger.info(msg.trim()) },
    })
);

// 6. Body 解析
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// 7. 静态文件
app.use(express.static(path.join(__dirname, '../frontend')));

/* ------------------- API 路由（全部必须在 cookieParser 之后） ------------------- */

// Google OAuth 登录
app.use('/api/auth', googleAuthRouter);

// 如果还在用 JWT 的 authRoutes（可删）
app.use('/api/auth', authRoutes);

// Google Photos
app.use('/api', photosRouter);

// 当前用户信息
app.use('/api', meRouter);

// Dashboard API
app.use('/api/dashboard', dashboardRoutes);

// Vision + Gemini 分析
app.use('/api/analysis', analysisRouter);

// 健康检查
app.get('/api/health', (req, res) => {
    res.status(200).json({
        status: 'OK',
        timestamp: new Date().toISOString(),
    });
});

/* ------------------- 前端路由（SPA 风格） ------------------- */

// 所有非 /api 的请求 → 返回 index.html
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

/* ------------------- 错误处理 ------------------- */

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

/* ------------------- 启动 ------------------- */

app.listen(PORT, () => {
    logger.info(`Server running on port ${PORT}`);
    logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

module.exports = app;
