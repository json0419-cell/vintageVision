const express = require('express');
const { Firestore } = require('@google-cloud/firestore');
const logger = require('../utils/logger');

const router = express.Router();
const db = new Firestore();

// ⭐ 临时的“鉴权”中间件：现在啥也不做，直接放行
//   这样可以避免 Route.get() 报错，等以后切换到 google_user_id 再换成真正的登录校验
function authenticateToken(req, res, next) {
    // 将来如果要用 cookie 里的 google_user_id，可以这样：
    // const googleUserId = req.cookies.google_user_id;
    // if (!googleUserId) return res.status(401).json({ error: 'Not authenticated' });
    // req.user = { id: googleUserId };
    // next();
    next();
}

// 获取 Dashboard 统计信息
router.get('/stats', authenticateToken, async (req, res) => {
    try {
        // ❗ 这里原来用的是 req.user.id（来自 JWT）
        // 现在我们没有真正的鉴权逻辑，所以先写一个固定/占位的 userId（避免崩溃）
        // 等你接上 google_user_id 后，把这里改成 const userId = req.user.id;
        const userId = req.user?.id || 'dummy-user-id';

        // 获取用户文档
        const userDoc = await db.collection('users').doc(userId).get();
        const userData = userDoc.data() || {};

        // 最近分析记录
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

        // 统计各个时代（era）的数量
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

// 获取用户风格画像
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

            // 统计时代
            const era = aiAnalysis.era || 'Unknown';
            styleProfile.favoriteEras[era] = (styleProfile.favoriteEras[era] || 0) + 1;

            // 统计颜色偏好
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

            // 记录信心趋势
            styleProfile.confidenceTrend.push({
                date: analysis.uploadedAt,
                confidence: aiAnalysis.confidence || 0,
            });
        });

        // favoriteEras 排序 + 取前 5
        styleProfile.favoriteEras = Object.entries(styleProfile.favoriteEras)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 5)
            .map(([era, count]) => ({ era, count }));

        // colorPreferences 排序 + 取前 5
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

// 获取近期活动
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
