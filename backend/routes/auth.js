const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const { Firestore } = require('@google-cloud/firestore');
const { google } = require('googleapis');
const logger = require('../utils/logger');

const router = express.Router();
const db = new Firestore();

// Middleware to verify JWT token
const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userDoc = await db.collection('users').doc(decoded.userId).get();
    
    if (!userDoc.exists) {
      return res.status(401).json({ error: 'User not found' });
    }

    req.user = { id: decoded.userId, ...userDoc.data() };
    next();
  } catch (error) {
    logger.error('Token verification failed:', error);
    return res.status(403).json({ error: 'Invalid or expired token' });
  }
};

// Register new user
router.post('/register', [
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 6 }),
  body('name').trim().isLength({ min: 2 }),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password, name } = req.body;

    // Check if user already exists
    const existingUser = await db.collection('users').where('email', '==', email).get();
    if (!existingUser.empty) {
      return res.status(400).json({ error: 'User already exists' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12);

    // Create user document
    const userRef = await db.collection('users').add({
      email,
      password: hashedPassword,
      name,
      createdAt: new Date(),
      lastLogin: null,
      analysisCount: 0,
    });

    // Generate JWT token
    const token = jwt.sign(
      { userId: userRef.id },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN }
    );

    logger.info(`New user registered: ${email}`);
    res.status(201).json({
      message: 'User created successfully',
      token,
      user: {
        id: userRef.id,
        email,
        name,
      },
    });
  } catch (error) {
    logger.error('Registration error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Login user
router.post('/login', [
  body('email').isEmail().normalizeEmail(),
  body('password').exists(),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password } = req.body;

    // Find user
    const userQuery = await db.collection('users').where('email', '==', email).get();
    if (userQuery.empty) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const userDoc = userQuery.docs[0];
    const userData = userDoc.data();

    // Verify password
    const isValidPassword = await bcrypt.compare(password, userData.password);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Update last login
    await userDoc.ref.update({ lastLogin: new Date() });

    // Generate JWT token
    const token = jwt.sign(
      { userId: userDoc.id },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN }
    );

    logger.info(`User logged in: ${email}`);
    res.json({
      message: 'Login successful',
      token,
      user: {
        id: userDoc.id,
        email: userData.email,
        name: userData.name,
        analysisCount: userData.analysisCount,
      },
    });
  } catch (error) {
    logger.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Verify token endpoint
router.get('/verify', authenticateToken, (req, res) => {
  res.json({
    valid: true,
    user: {
      id: req.user.id,
      email: req.user.email,
      name: req.user.name,
      analysisCount: req.user.analysisCount,
    },
  });
});

// Get user profile
router.get('/profile', authenticateToken, async (req, res) => {
  try {
    const userDoc = await db.collection('users').doc(req.user.id).get();
    if (!userDoc.exists) {
      return res.status(404).json({ error: 'User not found' });
    }

    const userData = userDoc.data();
    res.json({
      id: userDoc.id,
      email: userData.email,
      name: userData.name,
      createdAt: userData.createdAt,
      lastLogin: userData.lastLogin,
      analysisCount: userData.analysisCount,
    });
  } catch (error) {
    logger.error('Profile fetch error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Google OAuth login endpoint
router.get('/google', (req, res) => {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );

  const scopes = [
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/photoslibrary.readonly'
  ];

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    prompt: 'consent',
    state: 'google_photos_auth'
  });

  res.json({ authUrl });
});

// Google OAuth callback redirect endpoint
// Redirect to googleAuth.js route for processing
router.get('/google/callback', (req, res) => {
  const { code, error, state } = req.query;
  
  // Build query parameters
  const params = new URLSearchParams();
  if (code) params.append('code', code);
  if (error) params.append('error', error);
  if (state) params.append('state', state);
  
  // Redirect to googleAuth.js route (mounted at /auth path)
  res.redirect(`/auth/google/callback?${params.toString()}`);
});

// Google OAuth callback endpoint
router.post('/google/callback', async (req, res) => {
  try {
    const { code } = req.body;
    
    if (!code) {
      return res.status(400).json({ error: 'Authorization code required' });
    }

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );

    // Exchange code for tokens
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // Get user info
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const { data: userInfo } = await oauth2.userinfo.get();

    // Check if user exists
    const existingUserQuery = await db.collection('users').where('email', '==', userInfo.email).get();
    
    let userDoc;
    if (existingUserQuery.empty) {
      // Create new user
      const userRef = await db.collection('users').add({
        email: userInfo.email,
        name: userInfo.name,
        googleId: userInfo.id,
        profilePicture: userInfo.picture,
        createdAt: new Date(),
        lastLogin: new Date(),
        analysisCount: 0,
        authProvider: 'google'
      });
      userDoc = await userRef.get();
    } else {
      // Update existing user
      userDoc = existingUserQuery.docs[0];
      await userDoc.ref.update({
        lastLogin: new Date(),
        googleId: userInfo.id,
        profilePicture: userInfo.picture,
        authProvider: 'google'
      });
    }

    // Generate JWT token
    const token = jwt.sign(
      { userId: userDoc.id },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN }
    );

    logger.info(`Google OAuth login successful: ${userInfo.email}`);
    res.json({
      message: 'Google login successful',
      token,
      user: {
        id: userDoc.id,
        email: userInfo.email,
        name: userInfo.name,
        profilePicture: userInfo.picture,
        authProvider: 'google'
      },
    });
  } catch (error) {
    logger.error('Google OAuth callback error:', error);
    res.status(500).json({ error: 'Google authentication failed' });
  }
});

module.exports = router;
