// backend/routes/photos.js
const express = require('express');
const axios = require('axios');
const qs = require('qs');
const logger = require('../utils/logger');
const { firestore } = require('../utils/firestore');

const router = express.Router();

// Function to refresh access token
async function refreshAccessToken(refreshToken) {
    const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
    const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
    
    if (!refreshToken) {
        throw new Error('No refresh token available');
    }
    
    try {
        const response = await axios.post(
            'https://oauth2.googleapis.com/token',
            qs.stringify({
                client_id: CLIENT_ID,
                client_secret: CLIENT_SECRET,
                refresh_token: refreshToken,
                grant_type: 'refresh_token',
            }),
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
        );
        
        logger.info('Token refreshed successfully');
        return response.data.access_token;
    } catch (error) {
        logger.error('Token refresh failed:', {
            message: error.message,
            response: error.response?.data,
            status: error.response?.status
        });
        throw new Error('Failed to refresh access token. Please login again.');
    }
}

// Utility function: Get access_token from cookie, refresh if expired
async function getAccessTokenFromCookies(req, res) {
    let token = req.cookies.google_access_token;
    const refreshToken = req.cookies.google_refresh_token;
    
    if (!token) {
        const err = new Error('Not authenticated');
        err.status = 401;
        throw err;
    }
    
    // Try using token, refresh if it fails
    // Note: We cannot directly verify if token is expired, so try using it first
    // If API call returns 401, we refresh
    
    return { token, refreshToken };
}

// Utility function: Get user id from cookie
function getUserIdFromCookies(req) {
    const userId = req.cookies.google_user_id;
    if (!userId) {
        const err = new Error('Not authenticated');
        err.status = 401;
        throw err;
    }
    return userId;
}

/**
 * Create a Picker Session
 * POST /api/photos/picker/start
 * Returns: { sessionId, pickerUri }
 */
router.post('/photos/picker/start', async (req, res) => {
    try {
        const { token: accessToken, refreshToken } = await getAccessTokenFromCookies(req, res);
        const userId = getUserIdFromCookies(req);

        logger.info(`[/api/photos/picker/start] user ${userId} creating picker session`);

        // Per official docs: POST https://photospicker.googleapis.com/v1/sessions
        // Request body can start with minimal config (no extra fields)
        let resp;
        try {
            resp = await axios.post(
                'https://photospicker.googleapis.com/v1/sessions',
                {}, // Minimal body, can be extended later if needed
                {
                    headers: {
                        Authorization: `Bearer ${accessToken}`,
                        'Content-Type': 'application/json',
                    },
                }
            );
        } catch (apiError) {
            // If returns 401, try refreshing token
            if (apiError.response?.status === 401 && refreshToken) {
                logger.info('[/api/photos/picker/start] Token expired, refreshing...');
                const newToken = await refreshAccessToken(refreshToken);
                
                // Update cookie
                const cookieOptions = {
                    httpOnly: true,
                    secure: process.env.NODE_ENV === 'production',
                    sameSite: 'lax',
                    path: '/',
                    maxAge: 7 * 24 * 60 * 60 * 1000,
                };
                res.cookie('google_access_token', newToken, cookieOptions);
                
                // Retry request
                resp = await axios.post(
                    'https://photospicker.googleapis.com/v1/sessions',
                    {},
                    {
                        headers: {
                            Authorization: `Bearer ${newToken}`,
                            'Content-Type': 'application/json',
                        },
                    }
                );
            } else {
                // If no refresh_token or refresh fails, return clear error
                logger.error('[/api/photos/picker/start] Authentication failed:', {
                    status: apiError.response?.status,
                    message: apiError.response?.data?.error?.message,
                    hasRefreshToken: !!refreshToken
                });
                throw apiError;
            }
        }

        logger.info('[/api/photos/picker/start] Google API response:', JSON.stringify(resp.data, null, 2));
        
        // Google Photos Picker API returns field 'id' not 'sessionId'
        const sessionId = resp.data?.id || resp.data?.sessionId || resp.data?.session_id;
        const pickerUri = resp.data?.pickerUri || resp.data?.picker_uri || resp.data?.picker_url;

        if (!sessionId || !pickerUri) {
            logger.error('[/api/photos/picker/start] Invalid response from Google:', {
                fullResponse: resp.data,
                sessionId: sessionId,
                pickerUri: pickerUri
            });
            return res.status(500).json({
                error: 'Invalid response from Google Photos Picker API',
                details: 'Missing sessionId or pickerUri',
                receivedData: resp.data
            });
        }

        logger.info(`[/api/photos/picker/start] session created: ${sessionId}, pickerUri: ${pickerUri}`);

        res.json({
            sessionId, // Use 'id' field as sessionId
            pickerUri, // Frontend uses this URL to open Google Photos Picker in new window
        });
    } catch (err) {
        logger.error('[/api/photos/picker/start] error:', {
            message: err.message,
            status: err.response?.status,
            data: err.response?.data,
        });

        res.status(err.status || err.response?.status || 500).json({
            error: 'Failed to create picker session',
            details: err.response?.data || err.message,
        });
    }
});

/**
 * Poll a session to get user-selected mediaItems
 * GET /api/photos/picker/items?sessionId=xxx
 *
 * Returns:
 *  - { status: 'PENDING' } → User still selecting/not finished
 *  - { status: 'DONE', items: [...] } → Selection complete, items are simplified image info
 */
router.get('/photos/picker/items', async (req, res) => {
    const { sessionId } = req.query;

    if (!sessionId) {
        return res.status(400).json({ error: 'sessionId is required' });
    }

    try {
        const { token: accessToken, refreshToken } = await getAccessTokenFromCookies(req, res);
        const userId = getUserIdFromCookies(req);

        logger.info(`[/api/photos/picker/items] user ${userId} polling session ${sessionId}`);

        // Per docs: GET https://photospicker.googleapis.com/v1/mediaItems?sessionId=...
        let resp;
        try {
            resp = await axios.get('https://photospicker.googleapis.com/v1/mediaItems', {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                },
                params: {
                    sessionId,
                    pageSize: 100, // Max 100 at a time
                },
            });
        } catch (apiError) {
            // If returns 401, try refreshing token
            if (apiError.response?.status === 401 && refreshToken) {
                logger.info('[/api/photos/picker/items] Token expired, refreshing...');
                const newToken = await refreshAccessToken(refreshToken);
                
                // Update cookie
                const cookieOptions = {
                    httpOnly: true,
                    secure: process.env.NODE_ENV === 'production',
                    sameSite: 'lax',
                    path: '/',
                    maxAge: 7 * 24 * 60 * 60 * 1000,
                };
                res.cookie('google_access_token', newToken, cookieOptions);
                
                // Retry request
                resp = await axios.get('https://photospicker.googleapis.com/v1/mediaItems', {
                    headers: {
                        Authorization: `Bearer ${newToken}`,
                    },
                    params: {
                        sessionId,
                        pageSize: 100,
                    },
                });
            } else {
                // If no refresh_token or refresh fails, return clear error
                logger.error('[/api/photos/picker/items] Authentication failed:', {
                    status: apiError.response?.status,
                    message: apiError.response?.data?.error?.message,
                    hasRefreshToken: !!refreshToken
                });
                throw apiError;
            }
        }

        const mediaItems = resp.data.mediaItems || [];
        
        logger.info(`[/api/photos/picker/items] Received ${mediaItems.length} media items from Google`);

        // Extract information we care about
        const simplified = mediaItems.map(item => {
            // Picker API returns PickedMediaItem
            // Docs: item.mediaFile.baseUrl / mimeType / filename / metadata...
            const mf = item.mediaFile || {};
            const meta = mf.mediaMetadata || {};
            
            // Check data structure
            logger.info('[/api/photos/picker/items] Media item structure:', {
                hasMediaFile: !!mf,
                hasBaseUrl: !!mf.baseUrl,
                itemKeys: Object.keys(item),
                mediaFileKeys: mf ? Object.keys(mf) : []
            });

            return {
                id: item.id || mf.id || null,
                baseUrl: mf.baseUrl,         // Use this with params like =w800-h800 to display
                mimeType: mf.mimeType,
                filename: mf.filename,
                type: item.type,            // PHOTO / VIDEO
                width: meta.width,
                height: meta.height,
                creationTime: meta.creationTime,
            };
        });

        // Save these images to Firestore for dashboard use later
        // Create a collection userPhotos, document id random, let Firestore generate
        if (simplified.length > 0) {
            try {
                logger.info(`[/api/photos/picker/items] Attempting to save ${simplified.length} photos to Firestore`);
                
                // First check which photos already exist (by photoId and userId)
                const photosCol = firestore.collection('userPhotos');
                const photoIds = simplified.map(p => p.id).filter(id => id); // Only query those with photoId
                
                let existingPhotoIds = new Set();
                if (photoIds.length > 0) {
                    // Firestore 'in' query supports max 10 values, if more need batch queries
                    const batchSize = 10;
                    for (let i = 0; i < photoIds.length; i += batchSize) {
                        const batch = photoIds.slice(i, i + batchSize);
                        const existingPhotosQuery = await photosCol
                            .where('userId', '==', userId)
                            .where('photoId', 'in', batch)
                            .get();
                        
                        existingPhotosQuery.docs.forEach(doc => {
                            const photoId = doc.data().photoId;
                            if (photoId) {
                                existingPhotoIds.add(photoId);
                            }
                        });
                    }
                }
                
                logger.info(`[/api/photos/picker/items] Found ${existingPhotoIds.size} existing photos out of ${simplified.length}`);
                
                // Filter out photos that need to be saved (non-existent)
                const photosToSave = simplified.filter(photo => {
                    if (!photo.id) {
                        // If no photoId, also save (may be new photo)
                        return true;
                    }
                    const exists = existingPhotoIds.has(photo.id);
                    if (exists) {
                        logger.info(`[/api/photos/picker/items] Photo ${photo.id} already exists, skipping`);
                    }
                    return !exists;
                });
                
                if (photosToSave.length === 0) {
                    logger.info(`[/api/photos/picker/items] All photos already exist, nothing to save`);
                } else {
                    const batch = firestore.batch();

                    photosToSave.forEach((photo, index) => {
                        const docRef = photosCol.doc();
                        
                        // Build photoData, filter out undefined values (Firestore doesn't allow undefined)
                        const photoData = {
                            userId,
                            sessionId,
                            source: 'google_photos_picker',
                            createdAt: new Date(),
                            status: 'pending',           // Not analyzed yet
                            // Truly important information:
                            photoId: photo.id,
                            baseUrl: photo.baseUrl,
                            filename: photo.filename || `photo_${index + 1}`,
                        };
                        
                        // Only add non-undefined fields
                        if (photo.mimeType !== undefined) photoData.mimeType = photo.mimeType;
                        if (photo.width !== undefined) photoData.width = photo.width;
                        if (photo.height !== undefined) photoData.height = photo.height;
                        if (photo.creationTime !== undefined) photoData.creationTime = photo.creationTime;
                        if (photo.type !== undefined) photoData.type = photo.type;
                        
                        logger.info(`[/api/photos/picker/items] Saving new photo ${index + 1}/${photosToSave.length}:`, {
                            photoId: photo.id,
                            hasBaseUrl: !!photo.baseUrl,
                            filename: photo.filename,
                            width: photo.width,
                            height: photo.height
                        });
                        
                        batch.set(docRef, photoData);
                    });

                    await batch.commit();
                    logger.info(
                        `[/api/photos/picker/items] Successfully saved ${photosToSave.length} new photos for user ${userId}, session ${sessionId} (${simplified.length - photosToSave.length} already existed)`
                    );
                }
            } catch (firestoreError) {
                // Firestore errors should not prevent returning results, but need to log
                logger.error('[/api/photos/picker/items] Firestore save error:', {
                    error: firestoreError.message,
                    stack: firestoreError.stack,
                    userId,
                    sessionId,
                    photoCount: simplified.length
                });
                // Continue execution, return data to frontend
            }
        } else {
            logger.warn(`[/api/photos/picker/items] No photos to save for user ${userId}, session ${sessionId}`);
        }

        res.json({
            status: 'DONE',
            items: simplified,
        });
    } catch (err) {
        const status = err.response?.status;
        const errorData = err.response?.data?.error || err.response?.data;
        const errorMessage = errorData?.message || err.message;

        // If session not completed yet, will return FAILED_PRECONDITION or specific error message
        const apiErrorStatus = errorData?.status;
        
        // Check if it's the "user hasn't selected photos yet" case
        if (status === 400) {
            if (apiErrorStatus === 'FAILED_PRECONDITION' || 
                errorMessage?.includes('not picked media items') ||
                errorMessage?.includes('Please redirect the user')) {
                logger.info(`[/api/photos/picker/items] session ${sessionId} still pending - user hasn't selected photos yet`);
                return res.status(202).json({ status: 'PENDING' });
            }
        }
        
        // If 404, session may not exist or expired
        if (status === 404) {
            logger.warn(`[/api/photos/picker/items] session ${sessionId} not found or expired`);
            return res.status(404).json({ 
                error: 'Session not found or expired',
                status: 'EXPIRED'
            });
        }

        logger.error('[/api/photos/picker/items] error:', {
            message: err.message,
            status: err.response?.status,
            data: err.response?.data,
            errorMessage: errorMessage
        });

        res.status(status || 500).json({
            error: 'Failed to list picked media items',
            details: errorMessage || err.message,
        });
    }
});

/**
 * Proxy Google Photos images (solves CORS and 403 issues)
 * GET /api/photos/proxy?url=...&photoId=...
 *
 * We try, in order:
 *  1) Fetch the provided baseUrl with the current access token.
 *  2) If the token is expired (401/403) we refresh it and retry.
 *  3) If Google returns 403/404 for the baseUrl and we have a photoId,
 *     we call the Photos Library API to get a fresh baseUrl and try again.
 */
router.get('/photos/proxy', async (req, res) => {
    const { url, photoId } = req.query;

    if (!url) {
        return res.status(400).json({ error: 'URL parameter is required' });
    }

    try {
        const { token: accessToken, refreshToken } = await getAccessTokenFromCookies(req, res);

        if (!accessToken) {
            logger.error('[/api/photos/proxy] No access token available');
            return res.status(401).json({ error: 'No access token available' });
        }

        const originalUrl = decodeURIComponent(url);
        logger.info(
            `[/api/photos/proxy] Proxying image URL: ${originalUrl.substring(0, 100)}... (photoId=${photoId || 'n/a'})`
        );

        // Helper: download an image URL with the given token (if any)
        const fetchImage = async (imageUrl, token) => {
            const headers = {};
            if (token) {
                headers.Authorization = `Bearer ${token}`;
            }
            return axios.get(imageUrl, {
                headers,
                responseType: 'arraybuffer',
            });
        };

        let imageResponse;
        let activeToken = accessToken;
        let activeUrl = originalUrl;

        // --- First attempt: use existing token and URL ---
        try {
            imageResponse = await fetchImage(activeUrl, activeToken);
        } catch (error) {
            const status = error.response?.status;

            // If token looks expired, try refreshing and retry once
            if ((status === 401 || status === 403) && refreshToken) {
                try {
                    logger.info('[/api/photos/proxy] Token may be expired, refreshing...');
                    const newToken = await refreshAccessToken(refreshToken);

                    // Update cookie so subsequent requests use the fresh token
                    const cookieOptions = {
                        httpOnly: true,
                        secure: process.env.NODE_ENV === 'production',
                        sameSite: 'lax',
                        path: '/',
                        maxAge: 7 * 24 * 60 * 60 * 1000,
                    };
                    res.cookie('google_access_token', newToken, cookieOptions);
                    activeToken = newToken;

                    imageResponse = await fetchImage(activeUrl, activeToken);
                } catch (refreshErr) {
                    logger.error('[/api/photos/proxy] Token refresh failed while proxying image:', {
                        message: refreshErr.message,
                        status: refreshErr.response?.status,
                    });
                    // fall through and handle with outer error
                }
            }

            // If we still don't have imageResponse and we know the photoId, try to get a fresh baseUrl
            if (!imageResponse && (status === 403 || status === 404) && photoId) {
                try {
                    logger.info(
                        `[/api/photos/proxy] Base URL denied with status ${status}, attempting mediaItems.get for photoId=${photoId}`
                    );
                    const mediaResp = await axios.get(
                        `https://photoslibrary.googleapis.com/v1/mediaItems/${encodeURIComponent(photoId)}`,
                        {
                            headers: {
                                Authorization: `Bearer ${activeToken}`,
                            },
                        }
                    );

                    const newBaseUrl = mediaResp.data?.baseUrl;
                    if (!newBaseUrl) {
                        throw new Error('No baseUrl returned from mediaItems.get');
                    }

                    // Preserve any size parameters from the original URL if present
                    let sizedUrl = newBaseUrl;
                    const sizeMatch = originalUrl.match(/(=w\d+-h\d+.*)$/);
                    if (sizeMatch) {
                        sizedUrl = newBaseUrl + sizeMatch[1];
                    } else {
                        sizedUrl = `${newBaseUrl}=w400-h400`;
                    }

                    logger.info(
                        `[/api/photos/proxy] Using refreshed baseUrl for photoId=${photoId}: ${sizedUrl.substring(0, 100)}...`
                    );
                    activeUrl = sizedUrl;
                    imageResponse = await fetchImage(activeUrl, activeToken);
                } catch (refreshBaseErr) {
                    logger.error(
                        '[/api/photos/proxy] Failed to refresh baseUrl via Photos Library API:',
                        {
                            message: refreshBaseErr.message,
                            status: refreshBaseErr.response?.status,
                        }
                    );
                    throw error; // fall through to outer catch with original error
                }
            }

            // If none of the above paths produced an imageResponse, rethrow
            if (!imageResponse) {
                throw error;
            }
        }

        // --- Success: send proxied bytes back to browser ---
        const contentType = imageResponse.headers['content-type'] || 'image/jpeg';
        res.set('Content-Type', contentType);
        res.set('Cache-Control', 'public, max-age=3600'); // Cache 1 hour

        res.send(Buffer.from(imageResponse.data));
    } catch (err) {
        logger.error('[/api/photos/proxy] error:', {
            message: err.message,
            status: err.response?.status,
            url: url?.substring(0, 100),
        });

        // If 401 or 403, return clearer error
        if (err.response?.status === 401 || err.response?.status === 403) {
            return res.status(err.response.status).json({
                error: 'Failed to access image',
                details: 'Authentication failed. Please try refreshing the page.',
            });
        }

        res.status(err.response?.status || 500).json({
            error: 'Failed to proxy image',
            details: err.message,
        });
    }
});

/**
 * (Optional) Get current user's saved original photo list (e.g., status = pending)
 * Exclude already analyzed photos
 * GET /api/photos/pending
 */
router.get('/photos/pending', async (req, res) => {
    try {
        const userId = getUserIdFromCookies(req);
        
        logger.info(`[/api/photos/pending] Loading pending photos for user ${userId}`);

        // Note: Firestore compound queries require index, if orderBy and where used together
        // If query fails, try without orderBy first
        let snap;
        try {
            snap = await firestore.collection('userPhotos')
                .where('userId', '==', userId)
                .where('status', '==', 'pending')
                .orderBy('createdAt', 'desc')
                .limit(50)
                .get();
        } catch (indexError) {
            // If no index, try without orderBy
            logger.warn('[/api/photos/pending] Index error, trying without orderBy:', indexError.message);
            snap = await firestore.collection('userPhotos')
                .where('userId', '==', userId)
                .where('status', '==', 'pending')
                .limit(50)
                .get();
        }

        const allItems = snap.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                photoId: data.photoId,
                baseUrl: data.baseUrl,
                filename: data.filename,
                mimeType: data.mimeType,
                width: data.width,
                height: data.height,
                creationTime: data.creationTime,
                createdAt: data.createdAt,
                status: data.status,
            };
        });

        // Get list of analyzed photo IDs (from results collection or userPhotos' analysisResult)
        const analyzedPhotoIds = new Set();
        
        try {
            // Method 1: Query from results collection
            try {
                const resultsSnap = await firestore.collection('results')
                    .where('userId', '==', userId)
                    .limit(200)
                    .get();
                
                resultsSnap.docs.forEach(doc => {
                    const data = doc.data();
                    if (data.photoId) {
                        analyzedPhotoIds.add(data.photoId);
                    }
                    if (data.docId) {
                        analyzedPhotoIds.add(data.docId);
                    }
                });
            } catch (resultsError) {
                logger.warn('[/api/photos/pending] Failed to query results collection:', resultsError.message);
            }
            
            // Method 2: Find documents with analysisResult from userPhotos
            try {
                const analyzedPhotosSnap = await firestore.collection('userPhotos')
                    .where('userId', '==', userId)
                    .where('status', '==', 'analyzed')
                    .limit(200)
                    .get();
                
                analyzedPhotosSnap.docs.forEach(doc => {
                    analyzedPhotoIds.add(doc.id);
                    const data = doc.data();
                    if (data.photoId) {
                        analyzedPhotoIds.add(data.photoId);
                    }
                });
            } catch (analyzedError) {
                logger.warn('[/api/photos/pending] Failed to query analyzed photos:', analyzedError.message);
            }
        } catch (error) {
            logger.warn('[/api/photos/pending] Error checking analyzed photos, continuing anyway:', error.message);
        }

        // Filter out analyzed photos
        const items = allItems.filter(item => {
            // If photo's ID or photoId is in analyzed list, exclude it
            const isAnalyzed = analyzedPhotoIds.has(item.id) || 
                              (item.photoId && analyzedPhotoIds.has(item.photoId));
            return !isAnalyzed;
        });

        logger.info(`[/api/photos/pending] Found ${allItems.length} total photos, ${items.length} pending (${allItems.length - items.length} already analyzed) for user ${userId}`);
        res.json({ items });
    } catch (err) {
        logger.error('[/api/photos/pending] error:', {
            message: err.message,
            stack: err.stack
        });
        res.status(500).json({ error: 'Failed to load pending photos', details: err.message });
    }
});

/**
 * Delete photo
 * DELETE /api/photos/:photoId
 */
router.delete('/photos/:photoId', async (req, res) => {
    try {
        const userId = getUserIdFromCookies(req);
        const { photoId } = req.params;
        
        if (!photoId) {
            return res.status(400).json({ error: 'Photo ID is required' });
        }

        logger.info(`[/api/photos/${photoId}] User ${userId} attempting to delete photo`);

        // Get photo document
        const photoDoc = await firestore.collection('userPhotos').doc(photoId).get();
        
        if (!photoDoc.exists) {
            return res.status(404).json({ error: 'Photo not found' });
        }

        const photoData = photoDoc.data();
        
        // Verify photo belongs to current user
        if (photoData.userId !== userId) {
            logger.warn(`[/api/photos/${photoId}] User ${userId} attempted to delete photo belonging to ${photoData.userId}`);
            return res.status(403).json({ error: 'You do not have permission to delete this photo' });
        }

        // Delete photo document
        await firestore.collection('userPhotos').doc(photoId).delete();

        logger.info(`[/api/photos/${photoId}] Successfully deleted photo for user ${userId}`);
        res.json({ 
            success: true,
            message: 'Photo deleted successfully'
        });
    } catch (err) {
        logger.error(`[/api/photos/${req.params.photoId}] Delete error:`, {
            message: err.message,
            stack: err.stack
        });
        res.status(500).json({ 
            error: 'Failed to delete photo', 
            details: err.message 
        });
    }
});

module.exports = router;
