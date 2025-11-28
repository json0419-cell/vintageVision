// backend/routes/googleAuth.js
// Ensure environment variables are loaded (in case this file is required independently)
require('../config/env')();

const express = require('express');
const axios = require('axios');
const qs = require('qs');
const { firestore, FieldValue } = require('../utils/firestore');

const router = express.Router();

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI;

// Photos + user info scope
const GOOGLE_SCOPE = [
    'https://www.googleapis.com/auth/photospicker.mediaitems.readonly',
    'https://www.googleapis.com/auth/photoslibrary.readonly',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
    'openid',
].join(' ');

// Step1: Frontend clicks button → redirect here → then redirect to Google login page
router.get('/google', (req, res) => {
    const params = new URLSearchParams({
        client_id: CLIENT_ID,
        redirect_uri: REDIRECT_URI, // e.g., http://localhost:3000/api/auth/google/callback
        response_type: 'code',
        access_type: 'offline',
        prompt: 'consent',
        scope: GOOGLE_SCOPE,
    });

    res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
});

// Step2: Google login callback → exchange token → get user info → write Firestore → set cookie
router.get('/google/callback', async (req, res) => {
    const { code, error } = req.query;

    // Handle error cases
    if (error) {
        return res.send(`
      <!DOCTYPE html>
      <html>
      <head>
          <title>Google Login Error</title>
          <meta charset="UTF-8">
      </head>
      <body>
          <script>
              if (window.opener) {
                  window.opener.postMessage({
                      type: 'GOOGLE_AUTH_ERROR',
                      error: ${JSON.stringify(error)}
                  }, window.location.origin);
                  setTimeout(() => window.close(), 100);
              } else {
                  document.body.innerHTML = '<h1>Login Error: ${error}</h1><p>You can close this window.</p>';
              }
          </script>
      </body>
      </html>
    `);
    }

    if (!code) {
        return res.send(`
      <!DOCTYPE html>
      <html>
      <head>
          <title>Google Login Error</title>
          <meta charset="UTF-8">
      </head>
      <body>
          <script>
              if (window.opener) {
                  window.opener.postMessage({
                      type: 'GOOGLE_AUTH_ERROR',
                      error: 'Authorization code not found'
                  }, window.location.origin);
                  setTimeout(() => window.close(), 100);
              } else {
                  document.body.innerHTML = '<h1>Login Error: No authorization code</h1><p>You can close this window.</p>';
              }
          </script>
      </body>
      </html>
    `);
    }

    try {
        console.log('Processing Google OAuth callback, code:', code ? 'received' : 'missing');

        // 2.1 Exchange code for token
        console.log('Exchanging code for token...');
        const tokenRes = await axios.post(
            'https://oauth2.googleapis.com/token',
            qs.stringify({
                code,
                client_id: CLIENT_ID,
                client_secret: CLIENT_SECRET,
                redirect_uri: REDIRECT_URI,
                grant_type: 'authorization_code',
            }),
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
        );

        const { access_token, refresh_token } = tokenRes.data;
        console.log('Token received, access_token:', access_token ? 'yes' : 'no');
        console.log('Token scopes (raw):', tokenRes.data.scope);
        console.log('Full tokenRes.data:', tokenRes.data);
        // 2.2 Get Google user basic info based on access_token
        console.log('Fetching user info from Google...');
        const userRes = await axios.get('https://www.googleapis.com/oauth2/v2/userinfo', {
            headers: { Authorization: `Bearer ${access_token}` },
        });
        console.log('User info received');

        const googleUser = userRes.data; // { id, email, name, picture, ... }
        const googleUserId = googleUser.id;

        // 2.3 Write / update user document in Firestore users/{googleUserId}
        try {
            console.log('Saving user to Firestore...');
            const userRef = firestore.collection('users').doc(googleUserId);

            // Add timeout protection (5 seconds)
            const firestorePromise = userRef.set(
                {
                    googleUserId,
                    email: googleUser.email,
                    name: googleUser.name,
                    picture: googleUser.picture,
                    lastLoginAt: FieldValue.serverTimestamp(),
                    createdAt: FieldValue.serverTimestamp(),
                },
                { merge: true }
            );

            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Firestore timeout')), 5000)
            );

            await Promise.race([firestorePromise, timeoutPromise]);
            console.log('User saved to Firestore:', googleUserId);
        } catch (firestoreError) {
            // Firestore errors don't affect login flow, only log
            console.error('Firestore save error (non-critical):', firestoreError.message);
            console.error('User can still login, Firestore will be updated later');
        }

        // 2.4 Save current logged-in googleUserId & access_token in cookie
        console.log('Setting cookies...');
        const cookieOptions = {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            path: '/',
            maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
        };

        res.cookie('google_user_id', googleUserId, cookieOptions);
        res.cookie('google_access_token', access_token, cookieOptions);
        if (refresh_token) {
            res.cookie('google_refresh_token', refresh_token, cookieOptions);
        }
        console.log('Cookies set successfully');

        // Return HTML page, notify parent window success via postMessage (if popup)
        console.log('Sending success response...');
        res.send(`
      <!DOCTYPE html>
      <html>
      <head>
          <title>Google Login Success</title>
          <meta charset="UTF-8">
          <style>
              body {
                  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  min-height: 100vh;
                  margin: 0;
                  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              }
              .success-container {
                  text-align: center;
                  background: white;
                  padding: 2rem;
                  border-radius: 12px;
                  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
              }
              .spinner {
                  width: 40px;
                  height: 40px;
                  border: 4px solid #f3f3f3;
                  border-top: 4px solid #667eea;
                  border-radius: 50%;
                  animation: spin 1s linear infinite;
                  margin: 0 auto 1rem;
              }
              @keyframes spin {
                  0% { transform: rotate(0deg); }
                  100% { transform: rotate(360deg); }
              }
          </style>
      </head>
      <body>
          <div class="success-container">
              <div class="spinner"></div>
              <h3>Login successful!</h3>
              <p>Redirecting...</p>
          </div>
          <script>
              // Notify parent window login success (if popup)
              if (window.opener) {
                  window.opener.postMessage({
                      type: 'GOOGLE_AUTH_SUCCESS',
                      code: ${JSON.stringify(code)},
                      user: {
                          id: ${JSON.stringify(googleUserId)},
                          email: ${JSON.stringify(googleUser.email)},
                          name: ${JSON.stringify(googleUser.name)},
                          picture: ${JSON.stringify(googleUser.picture || '')},
                          authProvider: 'google'
                      }
                  }, window.location.origin);
                  setTimeout(() => {
                      window.close();
                  }, 500);
              } else {
                  // If not popup, redirect directly to dashboard
                  window.location.href = '/dashboard.html';
              }
          </script>
      </body>
      </html>
    `);
    } catch (err) {
        console.error('Google login error:', err);
        console.error('Error details:', {
            message: err.message,
            response: err.response?.data,
            stack: err.stack
        });
        const errorMessage =
            err.response?.data?.error_description ||
            err.response?.data?.error ||
            err.message ||
            'Unknown error';

        console.log('Sending error response:', errorMessage);
        res.send(`
      <!DOCTYPE html>
      <html>
      <head>
          <title>Google Login Error</title>
          <meta charset="UTF-8">
      </head>
      <body>
          <script>
              if (window.opener) {
                  window.opener.postMessage({
                      type: 'GOOGLE_AUTH_ERROR',
                      error: ${JSON.stringify(errorMessage)}
                  }, window.location.origin);
                  setTimeout(() => window.close(), 100);
              } else {
                  document.body.innerHTML = '<h1>Login Error</h1><p>${errorMessage}</p><p>You can close this window.</p>';
              }
          </script>
      </body>
      </html>
    `);
    }
});
// Logout: Clear login-related cookies
router.post('/logout', (req, res) => {
    // Must match path / sameSite when setting cookie, at least include path:'/'
    const cookieOptions = {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
    };

    res.clearCookie('google_user_id', cookieOptions);
    res.clearCookie('google_access_token', cookieOptions);
    res.clearCookie('google_refresh_token', cookieOptions);

    return res.status(200).json({ success: true });
});

// Get current logged-in user info (via cookie)
// Mounted at /api/auth/me
router.get('/me', async (req, res) => {
    const googleUserId = req.cookies.google_user_id;

    if (!googleUserId) {
        return res.status(401).json({ error: 'Not authenticated' });
    }

    try {
        const userDoc = await firestore.collection('users').doc(googleUserId).get();

        if (!userDoc.exists) {
            return res.status(404).json({ error: 'User not found' });
        }

        const userData = userDoc.data();
        res.json({
            id: googleUserId,
            email: userData.email,
            name: userData.name,
            picture: userData.picture,
            lastLoginAt: userData.lastLoginAt,
            createdAt: userData.createdAt,
        });
    } catch (err) {
        console.error('Get user info error', err);
        res.status(500).json({ error: 'Failed to get user info' });
    }
});


module.exports = router;
