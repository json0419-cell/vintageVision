const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const path = require('path');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const logger = require('./utils/logger');

const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
      scriptSrc: ["'self'", "https://cdn.jsdelivr.net", "https://unpkg.com"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
});
app.use('/api/', limiter);

// CORS configuration
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
}));

// Compression and logging
app.use(compression());
app.use(morgan('combined', { stream: { write: message => logger.info(message.trim()) } }));

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Static files
app.use(express.static(path.join(__dirname, '..')));

// API Routes
app.use('/api/auth', authRoutes);

// Mock upload route for demo purposes
app.post('/api/upload/analyze', (req, res) => {
  // Mock analysis result
  const mockResult = {
    success: true,
    analysisId: 'demo-' + Date.now(),
    imageUrl: 'https://via.placeholder.com/400x300/667eea/ffffff?text=Demo+Image',
    analysis: {
      era: 'Modern Contemporary',
      elements: 'Casual wear, minimalist style, neutral colors',
      colors: 'Black, white, gray',
      recommendations: 'Try adding some accessories or experimenting with bold colors',
      confidence: 8
    },
    visionData: {
      labels: [
        { description: 'Person', score: 0.95 },
        { description: 'Clothing', score: 0.87 },
        { description: 'Fashion', score: 0.82 }
      ],
      objects: [
        { name: 'Person', score: 0.95 },
        { name: 'Clothing', score: 0.87 }
      ]
    }
  };
  
  res.json(mockResult);
});

// Mock dashboard routes
app.get('/api/dashboard/stats', (req, res) => {
  res.json({
    totalAnalyses: 5,
    recentAnalyses: [
      {
        id: 'demo-1',
        fileName: 'outfit1.jpg',
        uploadedAt: { seconds: Math.floor(Date.now() / 1000) - 3600 },
        era: 'Modern Minimalist',
        confidence: 8
      },
      {
        id: 'demo-2',
        fileName: 'outfit2.jpg',
        uploadedAt: { seconds: Math.floor(Date.now() / 1000) - 7200 },
        era: 'Casual Chic',
        confidence: 7
      }
    ],
    topEras: [
      { era: 'Modern Minimalist', count: 2 },
      { era: 'Casual Chic', count: 1 },
      { era: 'Bohemian', count: 1 }
    ],
    memberSince: { seconds: Math.floor(Date.now() / 1000) - 86400 * 30 },
    lastLogin: { seconds: Math.floor(Date.now() / 1000) - 3600 }
  });
});

app.get('/api/dashboard/profile', (req, res) => {
  res.json({
    favoriteEras: [
      { era: 'Modern Minimalist', count: 2 },
      { era: 'Casual Chic', count: 1 }
    ],
    colorPreferences: [
      { color: 'black', count: 3 },
      { color: 'white', count: 2 },
      { color: 'gray', count: 1 }
    ],
    confidenceTrend: [
      { date: new Date(), confidence: 8 },
      { date: new Date(Date.now() - 86400000), confidence: 7 }
    ],
    totalAnalyses: 5
  });
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0',
  });
});

// Serve React app for all non-API routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../index.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong',
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

app.listen(PORT, () => {
  logger.info(`🚀 Server running on port ${PORT}`);
  logger.info(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
  logger.info(`📱 Access the app at: http://localhost:${PORT}`);
  logger.info(`🔍 Health check: http://localhost:${PORT}/api/health`);
});

module.exports = app;



