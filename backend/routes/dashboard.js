const express = require('express');
const { Firestore } = require('@google-cloud/firestore');
const { authenticateToken } = require('./auth');
const logger = require('../utils/logger');

const router = express.Router();
const db = new Firestore();

// Get dashboard statistics
router.get('/stats', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    // Get user's analysis count
    const userDoc = await db.collection('users').doc(userId).get();
    const userData = userDoc.data();

    // Get recent analyses
    const recentAnalysesQuery = await db.collection('analyses')
      .where('userId', '==', userId)
      .orderBy('uploadedAt', 'desc')
      .limit(5)
      .get();

    const recentAnalyses = recentAnalysesQuery.docs.map(doc => ({
      id: doc.id,
      fileName: doc.data().fileName,
      uploadedAt: doc.data().uploadedAt,
      era: doc.data().aiAnalysis?.era || 'Unknown',
      confidence: doc.data().aiAnalysis?.confidence || 0,
    }));

    // Get style era distribution
    const allAnalysesQuery = await db.collection('analyses')
      .where('userId', '==', userId)
      .get();

    const eraCounts = {};
    allAnalysesQuery.docs.forEach(doc => {
      const era = doc.data().aiAnalysis?.era || 'Unknown';
      eraCounts[era] = (eraCounts[era] || 0) + 1;
    });

    const topEras = Object.entries(eraCounts)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 5)
      .map(([era, count]) => ({ era, count }));

    res.json({
      totalAnalyses: userData.analysisCount || 0,
      recentAnalyses,
      topEras,
      memberSince: userData.createdAt,
      lastLogin: userData.lastLogin,
    });
  } catch (error) {
    logger.error('Dashboard stats error:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard statistics' });
  }
});

// Get user's style profile
router.get('/profile', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    // Get all user analyses
    const analysesQuery = await db.collection('analyses')
      .where('userId', '==', userId)
      .get();

    const analyses = analysesQuery.docs.map(doc => doc.data());

    // Analyze style patterns
    const styleProfile = {
      favoriteEras: {},
      colorPreferences: {},
      confidenceTrend: [],
      totalAnalyses: analyses.length,
    };

    analyses.forEach(analysis => {
      const { aiAnalysis } = analysis;
      if (!aiAnalysis) return;

      // Count favorite eras
      const era = aiAnalysis.era || 'Unknown';
      styleProfile.favoriteEras[era] = (styleProfile.favoriteEras[era] || 0) + 1;

      // Extract color preferences
      const colors = aiAnalysis.colors || '';
      const colorWords = colors.toLowerCase().split(/[,\s]+/).filter(word => 
        ['red', 'blue', 'green', 'yellow', 'black', 'white', 'gray', 'brown', 'pink', 'purple', 'orange'].includes(word)
      );
      
      colorWords.forEach(color => {
        styleProfile.colorPreferences[color] = (styleProfile.colorPreferences[color] || 0) + 1;
      });

      // Track confidence over time
      styleProfile.confidenceTrend.push({
        date: analysis.uploadedAt,
        confidence: aiAnalysis.confidence || 0,
      });
    });

    // Sort and limit results
    styleProfile.favoriteEras = Object.entries(styleProfile.favoriteEras)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 5)
      .map(([era, count]) => ({ era, count }));

    styleProfile.colorPreferences = Object.entries(styleProfile.colorPreferences)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 5)
      .map(([color, count]) => ({ color, count }));

    res.json(styleProfile);
  } catch (error) {
    logger.error('Style profile error:', error);
    res.status(500).json({ error: 'Failed to generate style profile' });
  }
});

// Get recent activity feed
router.get('/activity', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const limit = parseInt(req.query.limit) || 10;

    const activitiesQuery = await db.collection('analyses')
      .where('userId', '==', userId)
      .orderBy('uploadedAt', 'desc')
      .limit(limit)
      .get();

    const activities = activitiesQuery.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        type: 'analysis',
        fileName: data.fileName,
        uploadedAt: data.uploadedAt,
        era: data.aiAnalysis?.era || 'Unknown',
        confidence: data.aiAnalysis?.confidence || 0,
        imageUrl: data.imageUrl,
      };
    });

    res.json({ activities });
  } catch (error) {
    logger.error('Activity feed error:', error);
    res.status(500).json({ error: 'Failed to fetch activity feed' });
  }
});

module.exports = router;



