// backend/routes/me.js
const express = require('express');
const { firestore } = require('../utils/firestore');
const { requireGoogleUser } = require('../middleware/auth');

const router = express.Router();

router.get('/me', requireGoogleUser, async (req, res) => {
    const googleUserId = req.googleUserId;

    try {
        const doc = await firestore.collection('users').doc(googleUserId).get();
        if (!doc.exists) {
            return res.status(404).json({ error: 'User not found' });
        }

        const data = doc.data();
        res.json({
            googleUserId,
            name: data.name,
            email: data.email,
            picture: data.picture,
        });
    } catch (err) {
        console.error('Load /api/me error:', err.message || err);
        res.status(500).json({ error: 'Failed to load user profile' });
    }
});

module.exports = router;
