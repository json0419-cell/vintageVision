const express = require('express');
const { Firestore } = require('@google-cloud/firestore');
const logger = require('../utils/logger');

const router = express.Router();
const db = new Firestore();

// ⭐ Temporary "auth" middleware: Currently does nothing, just passes through
//   This avoids Route.get() errors, later switch to google_user_id and replace with real login check
function authenticateToken(req, res, next) {
    // In the future if want to use google_user_id from cookie, can do this:
    // const googleUserId = req.cookies.google_user_id;
    // if (!googleUserId) return res.status(401).json({ error: 'Not authenticated' });
    // req.user = { id: googleUserId };
    // next();
    next();
}

// Get Dashboard statistics
router.get('/stats', authenticateToken, async (req, res) => {
    try {
        // ❗ Originally used req.user.id (from JWT)
        // Now we don't have real auth logic, so write a fixed/placeholder userId (avoid crash)
        // After you connect google_user_id, change this to const userId = req.user.id;
        const userId = req.user?.id || 'dummy-user-id';

        // Get user document
        const userDoc = await db.collection('users').doc(userId).get();
        const userData = userDoc.data() || {};

        // Recent analysis records
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

        // Count number of each era
        const allAnalysesQuery = await db.collection('analyses')
            .where('userId', '==', userId)
            .get();

        const eraCounts = {};
        allAnalysesQuery.docs.forEach(doc => {
            const era = doc.data().aiAnalysis?.era || 'Unknown';
            eraCounts[era] = (eraCounts[era] || 0) + 1;
        });

        const topEras = Object.entries(eraCounts)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 5)
            .map(([era, count]) => ({ era, count }));

        res.json({
            totalAnalyses: userData.analysisCount || 0,
            recentAnalyses,
            topEras,
            memberSince: userData.createdAt || null,
            lastLogin: userData.lastLogin || null,
        });
    } catch (error) {
        logger.error('Dashboard stats error:', error);
        res.status(500).json({ error: 'Failed to fetch dashboard statistics' });
    }
});

// Get user style profile
router.get('/profile', authenticateToken, async (req, res) => {
    try {
        const userId = req.user?.id || 'dummy-user-id';

        const analysesQuery = await db.collection('analyses')
            .where('userId', '==', userId)
            .get();

        const analyses = analysesQuery.docs.map(doc => doc.data());

        const styleProfile = {
            favoriteEras: {},
            colorPreferences: {},
            confidenceTrend: [],
            totalAnalyses: analyses.length,
        };

        analyses.forEach(analysis => {
            const { aiAnalysis } = analysis;
            if (!aiAnalysis) return;

            // Count eras
            const era = aiAnalysis.era || 'Unknown';
            styleProfile.favoriteEras[era] = (styleProfile.favoriteEras[era] || 0) + 1;

            // Count color preferences
            const colors = aiAnalysis.colors || '';
            const colorWords = colors.toLowerCase()
                .split(/[,\s]+/)
                .filter(word =>
                    ['red', 'blue', 'green', 'yellow', 'black', 'white', 'gray', 'brown', 'pink', 'purple', 'orange']
                        .includes(word)
                );

            colorWords.forEach(color => {
                styleProfile.colorPreferences[color] = (styleProfile.colorPreferences[color] || 0) + 1;
            });

            // Record confidence trends
            styleProfile.confidenceTrend.push({
                date: analysis.uploadedAt,
                confidence: aiAnalysis.confidence || 0,
            });
        });

        // Sort favoriteEras + take top 5
        styleProfile.favoriteEras = Object.entries(styleProfile.favoriteEras)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 5)
            .map(([era, count]) => ({ era, count }));

        // Sort colorPreferences + take top 5
        styleProfile.colorPreferences = Object.entries(styleProfile.colorPreferences)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 5)
            .map(([color, count]) => ({ color, count }));

        res.json(styleProfile);
    } catch (error) {
        logger.error('Style profile error:', error);
        res.status(500).json({ error: 'Failed to generate style profile' });
    }
});

// Get recent activity
router.get('/activity', authenticateToken, async (req, res) => {
    try {
        const userId = req.user?.id || 'dummy-user-id';
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
