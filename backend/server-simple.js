const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const path = require('path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware - Completely disabled for development
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: false,
  crossOriginResourcePolicy: false,
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
app.use(morgan('combined'));

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Static files
app.use(express.static(path.join(__dirname, '..')));

// Simple in-memory user storage for demo
const users = new Map();
let userIdCounter = 1;

// Authentication middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'demo-secret');
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(403).json({ error: 'Invalid or expired token' });
  }
};

// Auth Routes
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;

    if (!email || !password || !name) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    if (users.has(email)) {
      return res.status(400).json({ error: 'User already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const userId = userIdCounter++;
    
    users.set(email, {
      id: userId,
      email,
      password: hashedPassword,
      name,
      createdAt: new Date(),
      analysisCount: 0
    });

    const token = jwt.sign(
      { userId, email },
      process.env.JWT_SECRET || 'demo-secret',
      { expiresIn: '24h' }
    );

    res.status(201).json({
      message: 'User created successfully',
      token,
      user: { id: userId, email, name }
    });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const user = users.get(email);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { userId: user.id, email: user.email },
      process.env.JWT_SECRET || 'demo-secret',
      { expiresIn: '24h' }
    );

    res.json({
      message: 'Login successful',
      token,
      user: { id: user.id, email: user.email, name: user.name, analysisCount: user.analysisCount }
    });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/auth/verify', authenticateToken, (req, res) => {
  res.json({
    valid: true,
    user: req.user
  });
});

app.get('/api/auth/profile', authenticateToken, (req, res) => {
  const user = Array.from(users.values()).find(u => u.id === req.user.userId);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  
  res.json({
    id: user.id,
    email: user.email,
    name: user.name,
    createdAt: user.createdAt,
    analysisCount: user.analysisCount
  });
});

// Mock upload route for demo purposes
app.post('/api/upload/analyze', authenticateToken, (req, res) => {
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
  
  // Update user's analysis count
  const user = Array.from(users.values()).find(u => u.id === req.user.userId);
  if (user) {
    user.analysisCount++;
  }
  
  res.json(mockResult);
});

// Mock dashboard routes
app.get('/api/dashboard/stats', authenticateToken, (req, res) => {
  const user = Array.from(users.values()).find(u => u.id === req.user.userId);
  
  res.json({
    totalAnalyses: user ? user.analysisCount : 0,
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
    memberSince: user ? user.createdAt : new Date(),
    lastLogin: new Date()
  });
});

app.get('/api/dashboard/profile', authenticateToken, (req, res) => {
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
    version: '1.0.0',
    users: users.size
  });
});

// Serve React app for all non-API routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../index.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
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
  console.log(`🚀 VintageVision Demo Server running on port ${PORT}`);
  console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`📱 Access the app at: http://localhost:${PORT}`);
  console.log(`🔍 Health check: http://localhost:${PORT}/api/health`);
  console.log(`📊 Registered users: ${users.size}`);
});

module.exports = app;
