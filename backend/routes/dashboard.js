// backend/routes/dashboard.js
const express = require('express');
/*
const { Firestore } = require('@google-cloud/firestore');
const logger = require('../utils/logger');

const router = express.Router();
const db = new Firestore();
*/
const logger = require('../utils/logger');
const { firestore: db } = require('../utils/firestore');
const router = express.Router();


/* ------------------------------------------------------------------
   AUTH MIDDLEWARE — Uses Google OAuth cookies
------------------------------------------------------------------ */
function requireGoogleAuth(req, res, next) {
    const googleUserId = req.cookies.google_user_id;

    if (!googleUserId) {
        return res.status(401).json({ error: 'Not authenticated' });
    }

    req.user = { id: googleUserId };
    next();
}

/* ------------------------------------------------------------------
   GET: Dashboard Summary Stats
   /api/dashboard/stats
------------------------------------------------------------------ */
router.get('/stats', requireGoogleAuth, async (req, res) => {
    try {
        const userId = req.user.id;

        const userDoc = await db.collection('users').doc(userId).get();
        const userData = userDoc.data() || {};

        // Latest 5 analyses
        const recentQuery = await db.collection('analyses')
            .where('userId', '==', userId)
            .orderBy('uploadedAt', 'desc')
            .limit(5)
            .get();

        const recentAnalyses = recentQuery.docs.map(doc => ({
            id: doc.id,
            fileName: doc.data().fileName || null,
            uploadedAt: doc.data().uploadedAt || null,
            era: doc.data().aiAnalysis?.primaryEra || 'Unknown',
            confidence: doc.data().aiAnalysis?.confidence || 0,
            thumbUrl: doc.data().thumbUrl || null,
        }));

        // Count top eras
        const allQuery = await db.collection('analyses')
            .where('userId', '==', userId)
            .get();

        const eraCounts = {};
        allQuery.docs.forEach(doc => {
            const era = doc.data().aiAnalysis?.primaryEra || 'Unknown';
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
            lastLogin: userData.lastLoginAt || null,
        });

    } catch (err) {
        logger.error('Dashboard stats error:', err);
        res.status(500).json({ error: 'Failed to fetch dashboard stats' });
    }
});

/* ------------------------------------------------------------------
   GET: User Style Profile
   /api/dashboard/profile
------------------------------------------------------------------ */
router.get('/profile', requireGoogleAuth, async (req, res) => {
    try {
        const userId = req.user.id;

        const query = await db.collection('analyses')
            .where('userId', '==', userId)
            .get();

        const profile = {
            favoriteEras: {},
            colorPreferences: {},
            confidenceTrend: [],
            totalAnalyses: query.docs.length,
        };

        query.docs.forEach(doc => {
            const d = doc.data();
            const ai = d.aiAnalysis || {};

            // Eras
            const era = ai.primaryEra || 'Unknown';
            profile.favoriteEras[era] = (profile.favoriteEras[era] || 0) + 1;

            // Colors
            const colors = (ai.colors || '').toLowerCase().split(/[\s,]+/);
            const valid = [
                'red','blue','green','yellow','black','white','gray',
                'brown','pink','purple','orange','beige','cream'
            ];
            colors.forEach(c => {
                if (valid.includes(c)) {
                    profile.colorPreferences[c] = (profile.colorPreferences[c] || 0) + 1;
                }
            });

            // Confidence Trend
            profile.confidenceTrend.push({
                date: d.uploadedAt,
                confidence: ai.confidence || 0
            });
        });

        // Sort & format
        profile.favoriteEras = Object.entries(profile.favoriteEras)
            .sort(([, a], [, b]) => b - a)
            .map(([era, count]) => ({ era, count }));

        profile.colorPreferences = Object.entries(profile.colorPreferences)
            .sort(([, a], [, b]) => b - a)
            .map(([color, count]) => ({ color, count }));

        res.json(profile);

    } catch (err) {
        logger.error('Profile error:', err);
        res.status(500).json({ error: 'Failed to load profile' });
    }
});

/* ------------------------------------------------------------------
   GET: Activity Feed
   /api/dashboard/activity
------------------------------------------------------------------ */
router.get('/activity', requireGoogleAuth, async (req, res) => {
    try {
        const userId = req.user.id;
        const limit = parseInt(req.query.limit) || 10;

        const query = await db.collection('analyses')
            .where('userId', '==', userId)
            .orderBy('uploadedAt', 'desc')
            .limit(limit)
            .get();

        const activities = query.docs.map(doc => {
            const d = doc.data();
            return {
                id: doc.id,
                type: 'analysis',
                fileName: d.fileName,
                uploadedAt: d.uploadedAt,
                era: d.aiAnalysis?.primaryEra || 'Unknown',
                confidence: d.aiAnalysis?.confidence || 0,
                thumbUrl: d.thumbUrl,
            };
        });

        res.json({ activities });
    } catch (err) {
        logger.error('Activity error:', err);
        res.status(500).json({ error: 'Failed to load activity feed' });
    }
});

module.exports = router;
