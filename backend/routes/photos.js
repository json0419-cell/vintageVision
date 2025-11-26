// backend/routes/photos.js
const express = require('express');
const axios = require('axios');
const qs = require('qs');
const logger = require('../utils/logger');
const { firestore } = require('../utils/firestore');

const router = express.Router();

// 刷新 access token 的函数
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

// 小工具函数：从 cookie 里拿 access_token，如果过期则刷新
async function getAccessTokenFromCookies(req, res) {
    let token = req.cookies.google_access_token;
    const refreshToken = req.cookies.google_refresh_token;
    
    if (!token) {
        const err = new Error('Not authenticated');
        err.status = 401;
        throw err;
    }
    
    // 尝试使用 token，如果失败则刷新
    // 注意：这里我们无法直接验证 token 是否过期，所以先尝试使用
    // 如果 API 调用返回 401，我们再刷新
    
    return { token, refreshToken };
}

// 小工具函数：从 cookie 拿 user id
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
 * 创建一个 Picker Session
 * POST /api/photos/picker/start
 * 返回：{ sessionId, pickerUri }
 */
router.post('/photos/picker/start', async (req, res) => {
    try {
        const { token: accessToken, refreshToken } = await getAccessTokenFromCookies(req, res);
        const userId = getUserIdFromCookies(req);

        logger.info(`[/api/photos/picker/start] user ${userId} creating picker session`);

        // 按官方文档：POST https://photospicker.googleapis.com/v1/sessions
        // 请求体可以先用一个最小配置（不带额外字段）
        let resp;
        try {
            resp = await axios.post(
                'https://photospicker.googleapis.com/v1/sessions',
                {}, // 最小 body，后面需要可以再扩展
                {
                    headers: {
                        Authorization: `Bearer ${accessToken}`,
                        'Content-Type': 'application/json',
                    },
                }
            );
        } catch (apiError) {
            // 如果返回 401，尝试刷新 token
            if (apiError.response?.status === 401 && refreshToken) {
                logger.info('[/api/photos/picker/start] Token expired, refreshing...');
                const newToken = await refreshAccessToken(refreshToken);
                
                // 更新 cookie
                const cookieOptions = {
                    httpOnly: true,
                    secure: process.env.NODE_ENV === 'production',
                    sameSite: 'lax',
                    path: '/',
                    maxAge: 7 * 24 * 60 * 60 * 1000,
                };
                res.cookie('google_access_token', newToken, cookieOptions);
                
                // 重试请求
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
                // 如果没有 refresh_token 或刷新失败，返回明确的错误
                logger.error('[/api/photos/picker/start] Authentication failed:', {
                    status: apiError.response?.status,
                    message: apiError.response?.data?.error?.message,
                    hasRefreshToken: !!refreshToken
                });
                throw apiError;
            }
        }

        logger.info('[/api/photos/picker/start] Google API response:', JSON.stringify(resp.data, null, 2));
        
        // Google Photos Picker API 返回的字段是 'id' 而不是 'sessionId'
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
            sessionId, // 使用 'id' 字段作为 sessionId
            pickerUri, // 前端用这个 URL 在新窗口里打开 Google Photos Picker
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
 * 轮询一个 session，获取用户选的 mediaItems
 * GET /api/photos/picker/items?sessionId=xxx
 *
 * 返回：
 *  - { status: 'PENDING' } → 用户还在选/没选完
 *  - { status: 'DONE', items: [...] } → 选完了，items 是简化后的图片信息
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

        // 按文档：GET https://photospicker.googleapis.com/v1/mediaItems?sessionId=...
        let resp;
        try {
            resp = await axios.get('https://photospicker.googleapis.com/v1/mediaItems', {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                },
                params: {
                    sessionId,
                    pageSize: 100, // 最多一次 100 张
                },
            });
        } catch (apiError) {
            // 如果返回 401，尝试刷新 token
            if (apiError.response?.status === 401 && refreshToken) {
                logger.info('[/api/photos/picker/items] Token expired, refreshing...');
                const newToken = await refreshAccessToken(refreshToken);
                
                // 更新 cookie
                const cookieOptions = {
                    httpOnly: true,
                    secure: process.env.NODE_ENV === 'production',
                    sameSite: 'lax',
                    path: '/',
                    maxAge: 7 * 24 * 60 * 60 * 1000,
                };
                res.cookie('google_access_token', newToken, cookieOptions);
                
                // 重试请求
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
                // 如果没有 refresh_token 或刷新失败，返回明确的错误
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

        // 把我们关心的信息抽出来
        const simplified = mediaItems.map(item => {
            // Picker API 返回的是 PickedMediaItem
            // 文档：item.mediaFile.baseUrl / mimeType / filename / metadata...
            const mf = item.mediaFile || {};
            const meta = mf.mediaMetadata || {};
            
            // 检查数据结构
            logger.info('[/api/photos/picker/items] Media item structure:', {
                hasMediaFile: !!mf,
                hasBaseUrl: !!mf.baseUrl,
                itemKeys: Object.keys(item),
                mediaFileKeys: mf ? Object.keys(mf) : []
            });

            return {
                id: item.id || mf.id || null,
                baseUrl: mf.baseUrl,         // 用这个加参数 =w800-h800 之类就可以展示
                mimeType: mf.mimeType,
                filename: mf.filename,
                type: item.type,            // PHOTO / VIDEO
                width: meta.width,
                height: meta.height,
                creationTime: meta.creationTime,
            };
        });

        // 把这些图片保存到 Firestore，方便以后 dashboard 用
        // 建一个集合 userPhotos，文档 id 随机，让 Firestore 生成
        if (simplified.length > 0) {
            try {
                logger.info(`[/api/photos/picker/items] Attempting to save ${simplified.length} photos to Firestore`);
                
                // 先检查哪些照片已经存在（通过 photoId 和 userId）
                const photosCol = firestore.collection('userPhotos');
                const photoIds = simplified.map(p => p.id).filter(id => id); // 只查询有 photoId 的
                
                let existingPhotoIds = new Set();
                if (photoIds.length > 0) {
                    // Firestore 的 'in' 查询最多支持 10 个值，如果超过需要分批查询
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
                
                // 过滤出需要保存的照片（不存在的）
                const photosToSave = simplified.filter(photo => {
                    if (!photo.id) {
                        // 如果没有 photoId，也保存（可能是新照片）
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
                        
                        // 构建 photoData，过滤掉 undefined 值（Firestore 不允许 undefined）
                        const photoData = {
                            userId,
                            sessionId,
                            source: 'google_photos_picker',
                            createdAt: new Date(),
                            status: 'pending',           // 还没分析
                            // 真正重要的信息：
                            photoId: photo.id,
                            baseUrl: photo.baseUrl,
                            filename: photo.filename || `photo_${index + 1}`,
                        };
                        
                        // 只添加非 undefined 的字段
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
                // Firestore 错误不应该阻止返回结果，但需要记录
                logger.error('[/api/photos/picker/items] Firestore save error:', {
                    error: firestoreError.message,
                    stack: firestoreError.stack,
                    userId,
                    sessionId,
                    photoCount: simplified.length
                });
                // 继续执行，返回数据给前端
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

        // 如果 session 还没完成，会返回 FAILED_PRECONDITION 或特定的错误消息
        const apiErrorStatus = errorData?.status;
        
        // 检查是否是 "用户还没有选择照片" 的情况
        if (status === 400) {
            if (apiErrorStatus === 'FAILED_PRECONDITION' || 
                errorMessage?.includes('not picked media items') ||
                errorMessage?.includes('Please redirect the user')) {
                logger.info(`[/api/photos/picker/items] session ${sessionId} still pending - user hasn't selected photos yet`);
                return res.status(202).json({ status: 'PENDING' });
            }
        }
        
        // 如果是 404，可能是 session 不存在或已过期
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
 * 代理 Google Photos 图片（解决 CORS 和 403 问题）
 * GET /api/photos/proxy?url=...
 */
router.get('/photos/proxy', async (req, res) => {
    const { url } = req.query;
    
    if (!url) {
        return res.status(400).json({ error: 'URL parameter is required' });
    }

    try {
        const { token: accessToken, refreshToken } = await getAccessTokenFromCookies(req, res);
        
        if (!accessToken) {
            logger.error('[/api/photos/proxy] No access token available');
            return res.status(401).json({ error: 'No access token available' });
        }
        
        // 解码 URL
        const imageUrl = decodeURIComponent(url);
        logger.info(`[/api/photos/proxy] Proxying image URL: ${imageUrl.substring(0, 100)}...`);
        
        // 使用 access token 获取图片
        const imageResponse = await axios.get(imageUrl, {
            headers: {
                Authorization: `Bearer ${accessToken}`,
            },
            responseType: 'arraybuffer',
        }).catch(async (error) => {
            // 如果 token 过期，尝试刷新
            if (error.response?.status === 401 && refreshToken) {
                logger.info('[/api/photos/proxy] Token expired, refreshing...');
                const newToken = await refreshAccessToken(refreshToken);
                
                // 更新 cookie
                const cookieOptions = {
                    httpOnly: true,
                    secure: process.env.NODE_ENV === 'production',
                    sameSite: 'lax',
                    path: '/',
                    maxAge: 7 * 24 * 60 * 60 * 1000,
                };
                res.cookie('google_access_token', newToken, cookieOptions);
                
                // 重试
                return await axios.get(imageUrl, {
                    headers: {
                        Authorization: `Bearer ${newToken}`,
                    },
                    responseType: 'arraybuffer',
                });
            }
            throw error;
        });

        // 设置正确的 Content-Type
        const contentType = imageResponse.headers['content-type'] || 'image/jpeg';
        res.set('Content-Type', contentType);
        res.set('Cache-Control', 'public, max-age=3600'); // 缓存1小时
        
        res.send(Buffer.from(imageResponse.data));
    } catch (err) {
        logger.error('[/api/photos/proxy] error:', {
            message: err.message,
            status: err.response?.status,
            url: url?.substring(0, 100)
        });
        
        // 如果是 401 或 403，返回更明确的错误
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
 *（可选）获取当前用户已经保存的原始照片列表（比如 status = pending）
 * 排除已经分析过的照片
 * GET /api/photos/pending
 */
router.get('/photos/pending', async (req, res) => {
    try {
        const userId = getUserIdFromCookies(req);
        
        logger.info(`[/api/photos/pending] Loading pending photos for user ${userId}`);

        // 注意：Firestore 复合查询需要索引，如果 orderBy 和 where 一起用
        // 如果查询失败，先尝试不带 orderBy
        let snap;
        try {
            snap = await firestore.collection('userPhotos')
                .where('userId', '==', userId)
                .where('status', '==', 'pending')
                .orderBy('createdAt', 'desc')
                .limit(50)
                .get();
        } catch (indexError) {
            // 如果没有索引，尝试不带 orderBy
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

        // 获取已分析的照片 ID 列表（从 results collection 或 userPhotos 的 analysisResult）
        const analyzedPhotoIds = new Set();
        
        try {
            // 方法1: 从 results collection 查询
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
            
            // 方法2: 从 userPhotos 中查找有 analysisResult 的文档
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

        // 过滤掉已分析的照片
        const items = allItems.filter(item => {
            // 如果照片的 ID 或 photoId 在已分析列表中，则排除
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
 * 删除照片
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

        // 获取照片文档
        const photoDoc = await firestore.collection('userPhotos').doc(photoId).get();
        
        if (!photoDoc.exists) {
            return res.status(404).json({ error: 'Photo not found' });
        }

        const photoData = photoDoc.data();
        
        // 验证照片属于当前用户
        if (photoData.userId !== userId) {
            logger.warn(`[/api/photos/${photoId}] User ${userId} attempted to delete photo belonging to ${photoData.userId}`);
            return res.status(403).json({ error: 'You do not have permission to delete this photo' });
        }

        // 删除照片文档
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
