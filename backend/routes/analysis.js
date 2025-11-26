// backend/routes/analysis.js
const express = require('express');
const vision = require('@google-cloud/vision');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const axios = require('axios');
const logger = require('../utils/logger');
const { firestore } = require('../utils/firestore');

const router = express.Router();
// 使用与 photos.js 相同的 firestore 实例（可能配置了不同的数据库）
const db = firestore;
const visionClient = new vision.ImageAnnotatorClient();
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// 从 photos.js 导入获取 access token 的函数
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

// ========= 简单的 cookie 鉴权：从 google_user_id 里拿用户 =========
function requireGoogleUser(req, res, next) {
    const googleUserId = req.cookies?.google_user_id;
    if (!googleUserId) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    req.user = { id: googleUserId };
    next();
}

/**
 * 检查照片是否已经有分析结果
 * GET /api/analysis/check?photoId=xxx&docId=xxx
 * photoId: Google Photos 的 ID（可选）
 * docId: Firestore userPhotos 文档 ID（可选）
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

        // 在 Datastore Mode 下，避免查询 userPhotos collection
        // 直接使用 docId 或 photoId 来查询 results collection
        // results collection 中的 photoId 可能是 Google Photos ID 或 Firestore doc ID

        // 构建查询列表：优先使用 docId，然后是 photoId
        const queryIds = [];
        if (docId) queryIds.push(docId);
        if (photoId && photoId !== docId) queryIds.push(photoId);

        // 在 Datastore Mode 下，复合查询可能不支持
        // 先尝试标准查询，如果失败则使用内存过滤或检查 userPhotos
        let querySucceeded = false;
        
        for (const queryId of queryIds) {
            // 方法1: 尝试查询 results collection
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
            
            // 方法2: 如果 queryId 是 Firestore doc ID，尝试从 userPhotos 读取
            if (queryId && queryId.length < 30) {
                try {
                    const userPhotoDoc = await db.collection('userPhotos').doc(queryId).get();
                    if (userPhotoDoc.exists) {
                        const userPhotoData = userPhotoDoc.data();
                        // 检查是否属于当前用户且有分析结果
                        if (userPhotoData.userId === userId && userPhotoData.analysisResult) {
                            // 确保分析结果包含 baseUrl（从 userPhotoData 获取，如果 analysisResult 没有）
                            const analysisResult = { ...userPhotoData.analysisResult };
                            if (!analysisResult.baseUrl && userPhotoData.baseUrl) {
                                analysisResult.baseUrl = userPhotoData.baseUrl;
                                analysisResult.imageUrl = userPhotoData.baseUrl;
                            }
                            
                            // 构造一个类似 results collection 的文档结构
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
            
            // 方法3: 如果都失败，尝试内存过滤（仅对 results collection）
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

        // 如果所有查询都失败，返回不存在
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
        
        // 如果是 Datastore Mode 错误，返回不存在（允许继续分析）
        // 这样用户至少可以进行新的分析
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

// ========= 1. 运行 Vision API 分析 =========
async function runVision(imageUrl, req = null) {
    try {
        logger.info('[runVision] Starting Vision API analysis for:', imageUrl.substring(0, 100));
        
        // Google Photos URL 需要认证，需要先下载图片
        let imageSource;
        
        // 检查是否是 Google Photos URL
        if (imageUrl.includes('googleusercontent.com') || imageUrl.includes('google.com')) {
            try {
                // 尝试获取 access token（如果 req 可用）
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
                
                // 下载图片内容
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
                
                // 使用图片内容（buffer）
                const imageBuffer = Buffer.from(imageResponse.data);
                imageSource = { content: imageBuffer };
                logger.info('[runVision] Image downloaded successfully, size:', imageBuffer.length, 'bytes');
            } catch (downloadError) {
                logger.warn('[runVision] Failed to download image, trying imageUri:', downloadError.message);
                // 如果下载失败，回退到 imageUri 方式
                imageSource = { source: { imageUri: imageUrl } };
            }
        } else {
            // 对于其他 URL，使用 imageUri 方式
            imageSource = { source: { imageUri: imageUrl } };
        }
        
        // 调用 Vision API
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
        
        // 如果 Vision API 返回的数据为空，记录警告
        if (!visionResult.labelAnnotations || visionResult.labelAnnotations.length === 0) {
            logger.warn('[runVision] WARNING: Vision API returned no labels! This may cause era to be "Undetermined"');
        }
        if (!visionResult.localizedObjectAnnotations || visionResult.localizedObjectAnnotations.length === 0) {
            logger.warn('[runVision] WARNING: Vision API returned no objects!');
        }

        // 提取 labels（格式：description:score）
        const labels = (visionResult.labelAnnotations || []).map(l =>
            `${l.description}:${Math.round(l.score * 1000) / 1000}`
        );

        // 提取 objects（格式：name:score）
        const objects = (visionResult.localizedObjectAnnotations || []).map(o =>
            `${o.name}:${Math.round(o.score * 1000) / 1000}`
        );
        
        // 记录前几个 labels 和 objects 用于调试
        if (labels.length > 0) {
            logger.info('[runVision] Sample labels:', labels.slice(0, 5));
        }
        if (objects.length > 0) {
            logger.info('[runVision] Sample objects:', objects.slice(0, 5));
        }

        // 提取主要颜色
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

        // OCR 文本
        const ocrText = visionResult.textAnnotations?.[0]?.description || '';
        const ocrExcerpt = ocrText.substring(0, 200);

        // 提取服装相关关键词
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
        
        // 如果特征数据太少，记录警告
        if (labels.length === 0 && objects.length === 0) {
            logger.error('[runVision] ERROR: No labels or objects extracted! Vision API may have failed or image is invalid.');
        }

        return visionFeatures;
    } catch (error) {
        logger.error('[runVision] Vision API error:', error);
        throw error;
    }
}

// ========= 2. 运行 Gemini 分析 =========
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
        // ✅ 使用一个稳定的 2.x 模型；可通过环境变量覆盖
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

        // 如果提供了图片 URL，尝试包含图片（这对 Gemini 判断时代很重要）
        if (imageUrl) {
            try {
                logger.info('[runGemini] Attempting to download image for Gemini:', imageUrl.substring(0, 100));
                
                // 对于 Google Photos URL，需要认证
                const headers = {};
                if ((imageUrl.includes('googleusercontent.com') || imageUrl.includes('google.com')) && req) {
                    try {
                        // 尝试获取 access token（如果 req 可用）
                        // 使用 analysis.js 中定义的 getAccessTokenFromCookies
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
                // 即使图片下载失败，我们仍然可以继续使用特征数据
                // 但 Gemini 可能无法准确判断时代
            }
        } else {
            logger.warn('[runGemini] No imageUrl provided, Gemini will rely on Vision features only');
        }

        const result = await model.generateContent(parts);
        let text = result.response.text().trim();
        
        logger.info('[runGemini] Raw Gemini response (first 500 chars):', text.substring(0, 500));

        // 清理可能的 markdown 代码块
        if (text.startsWith('```')) {
            text = text
                .replace(/^```json\s*/i, '')
                .replace(/^```\s*/i, '')
                .replace(/\s*```$/i, '')
                .trim();
        }
        
        // 尝试提取 JSON（可能在文本中间）
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            text = jsonMatch[0];
        }

        try {
            const parsed = JSON.parse(text);
            logger.info('[runGemini] Successfully parsed Gemini response');
            // 确保 search_queries 只有 en，没有 zh
            if (parsed.search_queries && parsed.search_queries.zh) {
                delete parsed.search_queries.zh;
            }
            // 确保所有必需字段都存在
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
            // 返回一个合理的默认结构
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
 * 分析照片（Vision + Gemini）
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

        // 1. 运行 Vision API（传递 req 以便获取 access token 下载 Google Photos 图片）
        logger.info('[Analysis] Running Vision API...');
        logger.info('[Analysis] Image URL:', imageUrl);
        logger.info('[Analysis] Base URL:', baseUrl || 'not provided');
        const visionFeatures = await runVision(imageUrl, req);
        
        // 检查 Vision API 返回的特征数据
        if (!visionFeatures || (!visionFeatures.labels?.length && !visionFeatures.objects?.length)) {
            logger.warn('[Analysis] WARNING: Vision API returned minimal or no features. This will likely result in "Undetermined" era.');
        }

        // 2. 运行 Gemini（如果 API key 存在）
        let geminiResult = null;
        if (process.env.GEMINI_API_KEY) {
            logger.info('[Analysis] Running Gemini API...');
            logger.info('[Analysis] Passing features to Gemini:', {
                labelsCount: visionFeatures.labels?.length || 0,
                objectsCount: visionFeatures.objects?.length || 0,
                colorsCount: visionFeatures.colors?.length || 0,
                clothingKeywordsCount: visionFeatures.clothing_keywords?.length || 0
            });
            
            // 优先使用 baseUrl，如果没有则使用 imageUrl
            // baseUrl 通常是原始的 Google Photos URL，更适合 Gemini 直接访问
            const geminiImageUrl = baseUrl || imageUrl;
            logger.info('[Analysis] Using image URL for Gemini:', geminiImageUrl?.substring(0, 100));
            
            // 传递 req 以便 runGemini 可以获取 access token 下载 Google Photos 图片
            geminiResult = await runGemini(visionFeatures, geminiImageUrl, req);
            logger.info('[Analysis] Gemini result era_primary:', geminiResult?.era_primary || 'not set');
            
            // 如果 era_primary 是 "Undetermined"，记录详细信息以便调试
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

        // 3. 保存到 results collection
        const resultData = {
            userId,
            photoId, // 保存原始的 photoId（可能是 Google Photos ID 或 doc ID）
            imageUrl: baseUrl || imageUrl,
            baseUrl: baseUrl || imageUrl,
            visionFeatures,
            geminiResult,
            analyzedAt: new Date(),
            status: 'completed'
        };

        // 如果 photoId 看起来像 Firestore doc ID（短字符串），也保存为 docId
        if (photoId && photoId.length < 30) {
            resultData.docId = photoId;
        }

        // 保存分析结果
        // 在 Datastore Mode 下，尝试多种保存方式
        let resultId;
        let saved = false;
        
        // 方法1: 尝试保存到 results collection
        try {
            // 生成唯一 ID
            resultId = `${userId}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
            const docRef = db.collection('results').doc(resultId);
            await docRef.set(resultData);
            logger.info(
                `[Analysis] Result saved to results collection: ${resultId} for user ${userId}`
            );
            saved = true;
        } catch (resultsError) {
            logger.warn('[Analysis] Failed to save to results collection:', resultsError.message);
            
            // 方法2: 如果 photoId 是 Firestore doc ID，尝试更新 userPhotos 文档
            if (photoId && photoId.length < 30) {
                try {
                    const userPhotoRef = db.collection('userPhotos').doc(photoId);
                    // 检查文档是否存在且属于当前用户
                    const userPhotoDoc = await userPhotoRef.get();
                    if (userPhotoDoc.exists) {
                        const userPhotoData = userPhotoDoc.data();
                        if (userPhotoData.userId === userId) {
                            // 确保 resultData 包含 baseUrl（从 userPhotoData 获取，如果 resultData 没有）
                            if (!resultData.baseUrl && userPhotoData.baseUrl) {
                                resultData.baseUrl = userPhotoData.baseUrl;
                                resultData.imageUrl = userPhotoData.baseUrl;
                            }
                            
                            // 更新 userPhotos 文档，添加分析结果并更新状态
                            await userPhotoRef.update({
                                status: 'analyzed', // 更新状态为 analyzed，这样就不会出现在 pending 列表中了
                                analyzedAt: new Date(),
                                analysisResult: resultData
                            });
                            resultId = photoId; // 使用 photoId 作为 resultId
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
            
            // 方法3: 即使保存到 results 失败，也尝试更新 userPhotos 状态（如果 photoId 是 doc ID）
            // 这样至少可以确保照片不会重复出现在 pending 列表中
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
            
            // 如果都失败了，记录错误但不阻止返回结果
            if (!saved) {
                logger.error('[Analysis] All save methods failed, but returning result anyway');
                // 生成一个临时 ID，至少让前端可以显示结果
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
 * 获取分析结果
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
 * 获取用户所有分析结果（用于 analyzed photos 轮播）
 * GET /api/analysis/results
 */
router.get('/results', requireGoogleUser, async (req, res) => {
    try {
        const userId = req.user.id;
        const limit = parseInt(req.query.limit || '20', 10);

        let snap;
        try {
            // 尝试使用 orderBy（Native Mode）
            snap = await db
                .collection('results')
                .where('userId', '==', userId)
                .orderBy('analyzedAt', 'desc')
                .limit(limit)
                .get();
        } catch (orderByError) {
            // 如果 orderBy 失败（可能是 Datastore Mode 或缺少索引），尝试不带 orderBy
            logger.warn('[Analysis results] orderBy failed, trying without:', orderByError.message);
            snap = await db
                .collection('results')
                .where('userId', '==', userId)
                .limit(limit)
                .get();
            
            // 在内存中排序
            const docs = snap.docs;
            docs.sort((a, b) => {
                const aTime = a.data().analyzedAt?.toMillis?.() || 0;
                const bTime = b.data().analyzedAt?.toMillis?.() || 0;
                return bTime - aTime; // 降序
            });
            
            // 创建新的 QuerySnapshot-like 对象
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

module.exports = router;
