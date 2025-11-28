// backend/routes/analysis.js
// Ensure environment variables are loaded (in case this file is required independently)
require('../config/env')();

const express = require('express');
const vision = require('@google-cloud/vision');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const axios = require('axios');
const logger = require('../utils/logger');
const { firestore } = require('../utils/firestore');

const router = express.Router();
// Use the same firestore instance as photos.js (may be configured for different database)
const db = firestore;
const visionClient = new vision.ImageAnnotatorClient();
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Import function to get access token from photos.js
async function getAccessTokenFromCookies(req, res) {
    const accessToken = req.cookies?.google_access_token;
    const refreshToken = req.cookies?.google_refresh_token;
    
    if (!accessToken) {
        const err = new Error('No access token available');
        err.status = 401;
        throw err;
    }
    
    return { token: accessToken, refreshToken };
}

// ========= Simple cookie authentication: Get user from google_user_id =========
function requireGoogleUser(req, res, next) {
    const googleUserId = req.cookies?.google_user_id;
    if (!googleUserId) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    req.user = { id: googleUserId };
    next();
}

/**
 * Check if photo already has analysis result
 * GET /api/analysis/check?photoId=xxx&docId=xxx
 * photoId: Google Photos ID (optional)
 * docId: Firestore userPhotos document ID (optional)
 */
router.get('/check', requireGoogleUser, async (req, res) => {
    try {
        const userId = req.user.id;
        const { photoId, docId } = req.query;

        if (!photoId && !docId) {
            return res.status(400).json({ error: 'photoId or docId is required' });
        }

        logger.info(`[Analysis check] User ${userId}, photoId=${photoId}, docId=${docId}`);

        let snap;

        // In Datastore Mode, avoid querying userPhotos collection
        // Directly use docId or photoId to query results collection
        // photoId in results collection may be Google Photos ID or Firestore doc ID

        // Build query list: Prefer docId, then photoId
        const queryIds = [];
        if (docId) queryIds.push(docId);
        if (photoId && photoId !== docId) queryIds.push(photoId);

        // In Datastore Mode, compound queries may not be supported
        // Try standard query first, if fails use in-memory filtering or check userPhotos
        let querySucceeded = false;
        
        for (const queryId of queryIds) {
            // Method 1: Try querying results collection
            try {
                snap = await db.collection('results')
                    .where('userId', '==', userId)
                    .where('photoId', '==', queryId)
                    .limit(1)
                    .get();

                if (!snap.empty) {
                    logger.info(`[Analysis check] Found result in results collection with photoId=${queryId}`);
                    querySucceeded = true;
                    break;
                }
            } catch (queryError) {
                logger.warn(
                    `[Analysis check] Results collection query failed for photoId=${queryId}:`,
                    queryError.message
                );
            }
            
            // Method 2: If queryId is Firestore doc ID, try reading from userPhotos
            if (queryId && queryId.length < 30) {
                try {
                    const userPhotoDoc = await db.collection('userPhotos').doc(queryId).get();
                    if (userPhotoDoc.exists) {
                        const userPhotoData = userPhotoDoc.data();
                        // Check if belongs to current user and has analysis result
                        if (userPhotoData.userId === userId && userPhotoData.analysisResult) {
                            // Ensure analysis result includes baseUrl (get from userPhotoData if analysisResult doesn't have it)
                            const analysisResult = { ...userPhotoData.analysisResult };
                            if (!analysisResult.baseUrl && userPhotoData.baseUrl) {
                                analysisResult.baseUrl = userPhotoData.baseUrl;
                                analysisResult.imageUrl = userPhotoData.baseUrl;
                            }
                            
                            // Construct a document structure similar to results collection
                            snap = {
                                docs: [{
                                    id: queryId,
                                    data: () => analysisResult
                                }],
                                empty: false
                            };
                            logger.info(`[Analysis check] Found result in userPhotos document: ${queryId}`);
                            querySucceeded = true;
                            break;
                        }
                    }
                } catch (userPhotoError) {
                    logger.warn(
                        `[Analysis check] userPhotos query failed for docId=${queryId}:`,
                        userPhotoError.message
                    );
                }
            }
            
            // Method 3: If all fail, try in-memory filtering (only for results collection)
            if (!querySucceeded) {
                try {
                    const allResults = await db.collection('results')
                        .where('userId', '==', userId)
                        .limit(200)
                        .get();
                    
                    const matchingDoc = allResults.docs.find(doc => {
                        const data = doc.data();
                        return data.photoId === queryId || data.docId === queryId;
                    });
                    
                    if (matchingDoc) {
                        snap = {
                            docs: [matchingDoc],
                            empty: false
                        };
                        logger.info(`[Analysis check] Found result (in-memory filter) with photoId=${queryId}`);
                        querySucceeded = true;
                        break;
                    }
                } catch (altError) {
                    logger.warn(`[Analysis check] In-memory filter failed:`, altError.message);
                }
            }
        }

        // If all queries fail, return not exists
        if (!snap) {
            snap = { empty: true };
        }

        if (!snap || snap.empty || !snap.docs || snap.docs.length === 0) {
            logger.info(
                `[Analysis check] No result found for photoId=${photoId}, docId=${docId}`
            );
            return res.json({ exists: false });
        }

        const doc = snap.docs[0];
        if (!doc || !doc.id) {
            logger.warn('[Analysis check] Invalid document structure');
            return res.json({ exists: false });
        }
        
        logger.info(`[Analysis check] Result found: ${doc.id}`);
        return res.json({
            exists: true,
            resultId: doc.id,
            result: doc.data()
        });
    } catch (error) {
        logger.error('[Analysis check] Error:', {
            message: error.message,
            stack: error.stack,
            query: req.query
        });
        
        // If Datastore Mode error, return not exists (allow continuing analysis)
        // This way user can at least perform new analysis
        if (error.message && error.message.includes('Datastore Mode')) {
            logger.warn('[Analysis check] Datastore Mode error, returning exists=false to allow new analysis');
            return res.json({ exists: false });
        }
        
        res.status(500).json({
            error: 'Failed to check analysis',
            details:
                process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// ========= 1. Run Vision API analysis =========
async function runVision(imageUrl, req = null) {
    try {
        logger.info('[runVision] Starting Vision API analysis for:', imageUrl.substring(0, 100));
        
        // Google Photos URL requires authentication, need to download image first
        let imageSource;
        
        // Check if it's a Google Photos URL
        if (imageUrl.includes('googleusercontent.com') || imageUrl.includes('google.com')) {
            try {
                // Try to get access token (if req is available)
                let accessToken = null;
                if (req && req.cookies) {
                    try {
                        const { token } = await getAccessTokenFromCookies(req, { cookie: () => {} });
                        accessToken = token;
                        logger.info('[runVision] Got access token from cookies');
                    } catch (e) {
                        logger.warn('[runVision] Could not get access token from cookies:', e.message);
                    }
                }
                
                // Download image content
                const headers = {};
                if (accessToken) {
                    headers.Authorization = `Bearer ${accessToken}`;
                }
                
                logger.info('[runVision] Downloading image for Vision API...');
                const imageResponse = await axios.get(imageUrl, {
                    headers,
                    responseType: 'arraybuffer',
                    timeout: 15000
                });
                
                // Use image content (buffer)
                const imageBuffer = Buffer.from(imageResponse.data);
                imageSource = { content: imageBuffer };
                logger.info('[runVision] Image downloaded successfully, size:', imageBuffer.length, 'bytes');
            } catch (downloadError) {
                logger.warn('[runVision] Failed to download image, trying imageUri:', downloadError.message);
                // If download fails, fall back to imageUri method
                imageSource = { source: { imageUri: imageUrl } };
            }
        } else {
            // For other URLs, use imageUri method
            imageSource = { source: { imageUri: imageUrl } };
        }
        
        // Call Vision API
        const [visionResult] = await visionClient.annotateImage({
            image: imageSource,
            features: [
                { type: 'LABEL_DETECTION', maxResults: 20 },
                { type: 'OBJECT_LOCALIZATION', maxResults: 10 },
                { type: 'IMAGE_PROPERTIES', maxResults: 1 },
                { type: 'TEXT_DETECTION', maxResults: 1 }
            ]
        });
        
        logger.info('[runVision] Vision API response received, labels count:', visionResult.labelAnnotations?.length || 0);
        logger.info('[runVision] Vision API objects count:', visionResult.localizedObjectAnnotations?.length || 0);
        
        // If Vision API returns empty data, log warning
        if (!visionResult.labelAnnotations || visionResult.labelAnnotations.length === 0) {
            logger.warn('[runVision] WARNING: Vision API returned no labels! This may cause era to be "Undetermined"');
        }
        if (!visionResult.localizedObjectAnnotations || visionResult.localizedObjectAnnotations.length === 0) {
            logger.warn('[runVision] WARNING: Vision API returned no objects!');
        }

        // Extract labels (format: description:score)
        const labels = (visionResult.labelAnnotations || []).map(l =>
            `${l.description}:${Math.round(l.score * 1000) / 1000}`
        );

        // Extract objects (format: name:score)
        const objects = (visionResult.localizedObjectAnnotations || []).map(o =>
            `${o.name}:${Math.round(o.score * 1000) / 1000}`
        );
        
        // Log first few labels and objects for debugging
        if (labels.length > 0) {
            logger.info('[runVision] Sample labels:', labels.slice(0, 5));
        }
        if (objects.length > 0) {
            logger.info('[runVision] Sample objects:', objects.slice(0, 5));
        }

        // Extract dominant colors
        const colors = [];
        try {
            const dom =
                visionResult.imagePropertiesAnnotation?.dominantColors?.colors ||
                [];
            for (const c of dom.slice(0, 6)) {
                colors.push({
                    rgb: [
                        Math.round(c.color.red),
                        Math.round(c.color.green),
                        Math.round(c.color.blue)
                    ],
                    score: Math.round(c.score * 1000) / 1000
                });
            }
        } catch (e) {
            logger.warn('[runVision] Failed to extract colors:', e);
        }

        // OCR text
        const ocrText = visionResult.textAnnotations?.[0]?.description || '';
        const ocrExcerpt = ocrText.substring(0, 200);

        // Extract clothing-related keywords
        const clothingVocab = [
            'dress', 'skirt', 'blouse', 'shirt', 'trousers', 'pants', 'jeans',
            'jacket', 'coat', 'hat', 'belt', 'polka dot', 'gingham', 'houndstooth',
            'plaid', 'floral', 'lace', 'ruffle', 'lapel', 'collar', 'v-neck',
            'a-line', 'fit and flare', 'tea dress', 'day dress', 'evening dress',
            'suit', 'blazer', 'tie', 'necktie', 'vest', 'waistcoat', 'overcoat',
            'tuxedo', 'formal wear', 'sleeve', 'pocket', 'button'
        ];
        const clothingKeywords = [];
        const allText = [...labels, ...objects].join(' ').toLowerCase();
        for (const keyword of clothingVocab) {
            if (allText.includes(keyword) && !clothingKeywords.includes(keyword)) {
                clothingKeywords.push(keyword);
            }
        }

        const visionFeatures = {
            labels,
            objects,
            colors,
            ocr_excerpt: ocrExcerpt,
            clothing_keywords: clothingKeywords
        };
        
        logger.info('[runVision] Vision features extracted:', {
            labelsCount: labels.length,
            objectsCount: objects.length,
            colorsCount: colors.length,
            clothingKeywordsCount: clothingKeywords.length,
            sampleLabels: labels.slice(0, 3),
            sampleObjects: objects.slice(0, 3),
            clothingKeywords: clothingKeywords
        });
        
        // If feature data is too sparse, log warning
        if (labels.length === 0 && objects.length === 0) {
            logger.error('[runVision] ERROR: No labels or objects extracted! Vision API may have failed or image is invalid.');
        }

        return visionFeatures;
    } catch (error) {
        logger.error('[runVision] Vision API error:', error);
        throw error;
    }
}

// ========= 2. Run Gemini analysis =========
async function runGemini(features, imageUrl = null, req = null) {
    const GEMINI_PROMPT = `You are a vintage fashion expert.
You will receive: (1) clothing-related features extracted by a vision API (labels, objects, colors, keywords),
optionally (2) the raw image.

Task:
1) Infer the most likely fashion era (by decade) and style for the outfit.
2) Provide Top-3 candidates with confidence (0–1) and a one-line discriminator each.
3) Generate shopping guidance:
   - Search queries (EN only) mixing era, silhouette, pattern/material (6–10 queries).
   - Tips: silhouettes/fabrics/details to look for, price range, platforms (Etsy/eBay/Depop, vintage shops, repro brands).
4) If evidence is weak, say what additional angles/photos would help.

IMPORTANT: Keep the rationale brief and concise (2-3 sentences maximum, around 100-150 characters). Focus on the key distinguishing features that led to the era determination.

Return strict JSON only with this schema:
{
  "era_primary": "string (e.g., '1930s', '1940s', or 'Undetermined' if insufficient data)",
  "style_tags": ["tag1","tag2"],
  "top3_candidates": [
    {"era":"", "style":"", "confidence":0.0, "discriminator":""},
    {"era":"", "style":"", "confidence":0.0, "discriminator":""},
    {"era":"", "style":"", "confidence":0.0, "discriminator":""}
  ],
  "rationale": "brief 2-3 sentence explanation (100-150 characters max)",
  "search_queries": {"en":["query1","query2",...]},
  "shopping_tips": ["tip1","tip2",...]
}

CRITICAL REQUIREMENTS:
- Return ONLY valid JSON, no markdown code blocks, no extra text before or after
- search_queries must ONLY contain "en" array, NO "zh" field
- If clothing features are missing or insufficient, set era_primary to "Undetermined" and explain why in rationale
- confidence values must be between 0.0 and 1.0
- shopping_tips should be formatted as: "*Category:* Description" (e.g., "*Silhouettes:* Look for...")`;

    try {
        // ✅ Use a stable 2.x model; can be overridden via environment variable
        const modelName = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
        const model = genAI.getGenerativeModel({ model: modelName });
        logger.info(`Using Gemini model: ${modelName}`);

        const parts = [
            { text: GEMINI_PROMPT },
            {
                text:
                    '### Vision features (JSON):\n' +
                    JSON.stringify(features, null, 2)
            }
        ];

        // If image URL is provided, try to include image (important for Gemini to determine era)
        if (imageUrl) {
            try {
                logger.info('[runGemini] Attempting to download image for Gemini:', imageUrl.substring(0, 100));
                
                // For Google Photos URL, authentication is required
                const headers = {};
                if ((imageUrl.includes('googleusercontent.com') || imageUrl.includes('google.com')) && req) {
                    try {
                        // Try to get access token (if req is available)
                        // Use getAccessTokenFromCookies defined in analysis.js
                        const { token } = await getAccessTokenFromCookies(req, { cookie: () => {} });
                        if (token) {
                            headers.Authorization = `Bearer ${token}`;
                            logger.info('[runGemini] Using access token for Google Photos image download');
                        }
                    } catch (e) {
                        logger.warn('[runGemini] Could not get access token for image download:', e.message);
                    }
                }
                
                const imageResponse = await axios.get(imageUrl, {
                    headers,
                    responseType: 'arraybuffer',
                    timeout: 15000,
                    maxRedirects: 5
                });

                const mimeType =
                    imageResponse.headers['content-type'] || 'image/jpeg';
                const base64 = Buffer.from(imageResponse.data).toString('base64');

                parts.push({
                    inlineData: {
                        mimeType,
                        data: base64
                    }
                });
                logger.info('[runGemini] Successfully included image in Gemini request');
            } catch (e) {
                logger.warn(
                    '[runGemini] Failed to include image in Gemini request, using features only:',
                    e.message
                );
                // Even if image download fails, we can still continue using feature data
                // But Gemini may not be able to accurately determine era
            }
        } else {
            logger.warn('[runGemini] No imageUrl provided, Gemini will rely on Vision features only');
        }

        const result = await model.generateContent(parts);
        let text = result.response.text().trim();
        
        logger.info('[runGemini] Raw Gemini response (first 500 chars):', text.substring(0, 500));

        // Clean possible markdown code blocks
        if (text.startsWith('```')) {
            text = text
                .replace(/^```json\s*/i, '')
                .replace(/^```\s*/i, '')
                .replace(/\s*```$/i, '')
                .trim();
        }
        
        // Try to extract JSON (may be in the middle of text)
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            text = jsonMatch[0];
        }

        try {
            const parsed = JSON.parse(text);
            logger.info('[runGemini] Successfully parsed Gemini response');
            // Ensure search_queries only has en, no zh
            if (parsed.search_queries && parsed.search_queries.zh) {
                delete parsed.search_queries.zh;
            }
            // Ensure all required fields exist
            if (!parsed.era_primary) parsed.era_primary = 'Undetermined';
            if (!parsed.style_tags) parsed.style_tags = [];
            if (!parsed.top3_candidates) parsed.top3_candidates = [];
            if (!parsed.rationale) parsed.rationale = 'No rationale provided.';
            if (!parsed.search_queries) parsed.search_queries = { en: [] };
            if (!parsed.shopping_tips) parsed.shopping_tips = [];
            
            return parsed;
        } catch (parseError) {
            logger.error('[runGemini] JSON parse failed:', parseError);
            logger.error('[runGemini] Raw response:', text);
            // Return a reasonable default structure
            return {
                era_primary: 'Undetermined',
                style_tags: [],
                top3_candidates: [],
                rationale: 'Failed to parse analysis result. Please try again.',
                search_queries: { en: [] },
                shopping_tips: [],
                parse_error: true,
                model_used: modelName
            };
        }
    } catch (error) {
        logger.error('Gemini API error:', error);
        throw error;
    }
}

/**
 * Analyze photo (Vision + Gemini)
 * POST /api/analysis/analyze
 * body: { photoId: string, imageUrl: string, baseUrl?: string }
 */
router.post('/analyze', requireGoogleUser, async (req, res) => {
    try {
        const { photoId, imageUrl, baseUrl } = req.body;
        const userId = req.user.id;

        if (!photoId || !imageUrl) {
            return res
                .status(400)
                .json({ error: 'photoId and imageUrl are required' });
        }

        logger.info(
            `[Analysis] Starting analysis for user ${userId}, photoId=${photoId}`
        );

        // 1. Run Vision API (pass req to get access token for downloading Google Photos images)
        logger.info('[Analysis] Running Vision API...');
        logger.info('[Analysis] Image URL:', imageUrl);
        logger.info('[Analysis] Base URL:', baseUrl || 'not provided');
        const visionFeatures = await runVision(imageUrl, req);
        
        // Check Vision API returned feature data
        if (!visionFeatures || (!visionFeatures.labels?.length && !visionFeatures.objects?.length)) {
            logger.warn('[Analysis] WARNING: Vision API returned minimal or no features. This will likely result in "Undetermined" era.');
        }

        // 2. Run Gemini (if API key exists)
        let geminiResult = null;
        if (process.env.GEMINI_API_KEY) {
            logger.info('[Analysis] Running Gemini API...');
            logger.info('[Analysis] Passing features to Gemini:', {
                labelsCount: visionFeatures.labels?.length || 0,
                objectsCount: visionFeatures.objects?.length || 0,
                colorsCount: visionFeatures.colors?.length || 0,
                clothingKeywordsCount: visionFeatures.clothing_keywords?.length || 0
            });
            
            // Prefer baseUrl, if not available use imageUrl
            // baseUrl is usually the original Google Photos URL, better for Gemini direct access
            const geminiImageUrl = baseUrl || imageUrl;
            logger.info('[Analysis] Using image URL for Gemini:', geminiImageUrl?.substring(0, 100));
            
            // Pass req so runGemini can get access token to download Google Photos images
            geminiResult = await runGemini(visionFeatures, geminiImageUrl, req);
            logger.info('[Analysis] Gemini result era_primary:', geminiResult?.era_primary || 'not set');
            
            // If era_primary is "Undetermined", log detailed info for debugging
            if (geminiResult?.era_primary === 'Undetermined') {
                logger.warn('[Analysis] WARNING: Gemini returned "Undetermined" era. Possible reasons:');
                logger.warn('[Analysis] - Vision features may be insufficient:', {
                    hasLabels: (visionFeatures.labels?.length || 0) > 0,
                    hasObjects: (visionFeatures.objects?.length || 0) > 0,
                    hasColors: (visionFeatures.colors?.length || 0) > 0,
                    hasKeywords: (visionFeatures.clothing_keywords?.length || 0) > 0
                });
                logger.warn('[Analysis] - Image URL provided to Gemini:', !!geminiImageUrl);
            }

            if (geminiResult.parse_error) {
                logger.warn('[Analysis] Gemini parse error, using fallback');
                geminiResult = {
                    era_primary: 'Unknown',
                    style_tags: [],
                    top3_candidates: [],
                    rationale:
                        'Analysis incomplete due to parsing error.',
                    search_queries: { en: [], zh: [] },
                    shopping_tips: []
                };
            }
        } else {
            logger.warn('[Analysis] GEMINI_API_KEY not set, skipping Gemini');
        }

        // 3. Save to results collection
        const resultData = {
            userId,
            photoId, // Save original photoId (may be Google Photos ID or doc ID)
            imageUrl: baseUrl || imageUrl,
            baseUrl: baseUrl || imageUrl,
            visionFeatures,
            geminiResult,
            analyzedAt: new Date(),
            status: 'completed'
        };

        // If photoId looks like Firestore doc ID (short string), also save as docId
        if (photoId && photoId.length < 30) {
            resultData.docId = photoId;
        }

        // Save analysis result
        // In Datastore Mode, try multiple save methods
        let resultId;
        let saved = false;
        
        // Method 1: Try saving to results collection
        try {
            // Generate unique ID
            resultId = `${userId}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
            const docRef = db.collection('results').doc(resultId);
            await docRef.set(resultData);
            logger.info(
                `[Analysis] Result saved to results collection: ${resultId} for user ${userId}`
            );
            saved = true;
        } catch (resultsError) {
            logger.warn('[Analysis] Failed to save to results collection:', resultsError.message);
            
            // Method 2: If photoId is Firestore doc ID, try updating userPhotos document
            if (photoId && photoId.length < 30) {
                try {
                    const userPhotoRef = db.collection('userPhotos').doc(photoId);
                    // Check if document exists and belongs to current user
                    const userPhotoDoc = await userPhotoRef.get();
                    if (userPhotoDoc.exists) {
                        const userPhotoData = userPhotoDoc.data();
                        if (userPhotoData.userId === userId) {
                            // Ensure resultData includes baseUrl (get from userPhotoData if resultData doesn't have it)
                            if (!resultData.baseUrl && userPhotoData.baseUrl) {
                                resultData.baseUrl = userPhotoData.baseUrl;
                                resultData.imageUrl = userPhotoData.baseUrl;
                            }
                            
                            // Update userPhotos document, add analysis result and update status
                            await userPhotoRef.update({
                                status: 'analyzed', // Update status to analyzed, so it won't appear in pending list
                                analyzedAt: new Date(),
                                analysisResult: resultData
                            });
                            resultId = photoId; // Use photoId as resultId
                            logger.info(
                                `[Analysis] Result saved to userPhotos document and status updated to 'analyzed': ${photoId} for user ${userId}`
                            );
                            saved = true;
                        }
                    }
                } catch (userPhotoError) {
                    logger.warn('[Analysis] Failed to save to userPhotos:', userPhotoError.message);
                }
            }
            
            // Method 3: Even if saving to results fails, try updating userPhotos status (if photoId is doc ID)
            // This way we can at least ensure photo won't appear repeatedly in pending list
            if (!saved && photoId && photoId.length < 30) {
                try {
                    const userPhotoRef = db.collection('userPhotos').doc(photoId);
                    const userPhotoDoc = await userPhotoRef.get();
                    if (userPhotoDoc.exists && userPhotoDoc.data().userId === userId) {
                        await userPhotoRef.update({
                            status: 'analyzed',
                            analyzedAt: new Date()
                        });
                        logger.info(`[Analysis] Updated userPhotos status to 'analyzed' for ${photoId}`);
                    }
                } catch (updateError) {
                    logger.warn('[Analysis] Failed to update userPhotos status:', updateError.message);
                }
            }
            
            // If all fail, log error but don't prevent returning result
            if (!saved) {
                logger.error('[Analysis] All save methods failed, but returning result anyway');
                // Generate a temporary ID, at least let frontend display result
                resultId = `temp_${Date.now()}`;
            }
        }

        res.json({
            success: true,
            resultId: resultId,
            result: resultData
        });
    } catch (error) {
        logger.error('[Analysis] Analysis error:', error);
        res.status(500).json({
            error: 'Analysis failed',
            message:
                process.env.NODE_ENV === 'development'
                    ? error.message
                    : 'Something went wrong'
        });
    }
});

/**
 * Get analysis result
 * GET /api/analysis/result/:resultId
 */
router.get('/result/:resultId', requireGoogleUser, async (req, res) => {
    try {
        const userId = req.user.id;
        const { resultId } = req.params;

        const doc = await db.collection('results').doc(resultId).get();
        if (!doc.exists) {
            return res.status(404).json({ error: 'Result not found' });
        }

        const data = doc.data();
        if (data.userId !== userId) {
            return res.status(403).json({ error: 'Access denied' });
        }

        res.json({ id: doc.id, ...data });
    } catch (error) {
        logger.error('Get result error:', error);
        res.status(500).json({ error: 'Failed to get result' });
    }
});

/**
 * Get all analysis results for user (for analyzed photos carousel)
 * GET /api/analysis/results
 */
router.get('/results', requireGoogleUser, async (req, res) => {
    try {
        const userId = req.user.id;
        const limit = parseInt(req.query.limit || '20', 10);

        let snap;
        try {
            // Try using orderBy (Native Mode)
            snap = await db
                .collection('results')
                .where('userId', '==', userId)
                .orderBy('analyzedAt', 'desc')
                .limit(limit)
                .get();
        } catch (orderByError) {
            // If orderBy fails (may be Datastore Mode or missing index), try without orderBy
            logger.warn('[Analysis results] orderBy failed, trying without:', orderByError.message);
            snap = await db
                .collection('results')
                .where('userId', '==', userId)
                .limit(limit)
                .get();
            
            // Sort in memory
            const docs = snap.docs;
            docs.sort((a, b) => {
                const aTime = a.data().analyzedAt?.toMillis?.() || 0;
                const bTime = b.data().analyzedAt?.toMillis?.() || 0;
                return bTime - aTime; // Descending order
            });
            
            // Create new QuerySnapshot-like object
            snap = {
                docs: docs.slice(0, limit),
                empty: docs.length === 0
            };
        }

        const items = snap.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                photoId: data.photoId,
                imageUrl: data.imageUrl,
                baseUrl: data.baseUrl,
                analyzedAt: data.analyzedAt,
                geminiResult: data.geminiResult
            };
        });

        res.json({ items });
    } catch (error) {
        logger.error('Get results list error:', error);
        res.status(500).json({ error: 'Failed to fetch results' });
    }
});

/**
 * Delete analysis result
 * DELETE /api/analysis/result/:resultId
 */
router.delete('/result/:resultId', requireGoogleUser, async (req, res) => {
    try {
        const userId = req.user.id;
        const { resultId } = req.params;

        logger.info(`[Delete result] User ${userId} attempting to delete result ${resultId}`);

        const doc = await db.collection('results').doc(resultId).get();
        if (!doc.exists) {
            return res.status(404).json({ error: 'Result not found' });
        }

        const data = doc.data();
        if (data.userId !== userId) {
            logger.warn(`[Delete result] User ${userId} attempted to delete result belonging to ${data.userId}`);
            return res.status(403).json({ error: 'You do not have permission to delete this result' });
        }

        // Delete result document
        await db.collection('results').doc(resultId).delete();

        logger.info(`[Delete result] Successfully deleted result ${resultId} for user ${userId}`);

        res.json({
            success: true,
            message: 'Analysis result deleted successfully'
        });
    } catch (error) {
        logger.error(`[Delete result] Delete error:`, {
            error: error.message,
            stack: error.stack,
            resultId: req.params.resultId
        });
        res.status(500).json({
            error: 'Failed to delete result',
            message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
        });
    }
});

module.exports = router;
