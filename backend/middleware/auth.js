// backend/middleware/auth.js
function requireGoogleUser(req, res, next) {
    const googleUserId = req.cookies.google_user_id;
    if (!googleUserId) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    req.googleUserId = googleUserId;
    next();
}

module.exports = { requireGoogleUser };
