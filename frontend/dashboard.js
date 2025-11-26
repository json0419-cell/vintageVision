// frontend/dashboard.js
// 使用 utils.js 中的工具函数

// 全局函数：打开照片选择器
window.openPhotosPicker = function () {
    const btn = DOM.getElement('btnPickFromGoogle');
    if (btn) {
        btn.click();
    } else {
        Logger.warn('btnPickFromGoogle not found on this page');
    }
};

// 确认登录 + 填写 Welcome back, xxx
async function ensureLoggedIn() {
    try {
        const user = await apiGet('/api/auth/me');
        Logger.log('Logged in as', user);

        const nameSpan = DOM.getElement('userName');
        if (nameSpan) {
            nameSpan.textContent = user.name || 'User';
        }

        // 加载当前已有的 pending 照片（从 Firestore）
        await loadPendingPhotos();
        setupPickerButton();
    } catch (err) {
        Logger.error('ensureLoggedIn error:', err);
        window.location.href = '/signin.html';
    }
}

// 从我们自己的数据库加载 pending 照片
async function loadPendingPhotos() {
    try {
        Logger.log('[loadPendingPhotos] Loading pending photos...');
        const data = await apiGet('/api/photos/pending');
        const items = data.items || [];
        Logger.log(`[loadPendingPhotos] Loaded ${items.length} pending photos`);
        
        // 映射数据格式
        const mappedItems = items.map(doc => ({
            id: doc.id, // Firestore 文档 ID
            photoId: doc.photoId, // Google Photos ID
            baseUrl: doc.baseUrl,
            filename: doc.filename || doc.photoId || 'Photo',
        }));
        
        // 渲染轮播（新照片已经在前面，因为后端按 createdAt desc 排序）
        renderOriginalCarousel(mappedItems);
    } catch (err) {
        Logger.error('loadPendingPhotos error:', err);
        renderOriginalCarousel([]);
    }
}

// 绑定 “Choose from Google Photos” 按钮事件
function setupPickerButton() {
    const btn = document.getElementById('btnPickFromGoogle');
    if (!btn) return;

    btn.addEventListener('click', async () => {
        try {
            btn.disabled = true;
            btn.textContent = 'Opening Google Photos...';

            // 1. 后端创建 session，获取 pickerUri + sessionId
            const response = await apiPost('/api/photos/picker/start');
            Logger.log('[Picker] Response from /api/photos/picker/start:', response);
            
            const { sessionId, pickerUri } = response;
            
            if (!sessionId) {
                throw new Error('Failed to get sessionId from server');
            }
            
            Logger.log('[Picker] Session ID:', sessionId);
            Logger.log('[Picker] Picker URI:', pickerUri);

            // 2. 在新窗口打开 pickerUri（加 /autoclose，会自动关）
            const pickerUrl = pickerUri.endsWith('/autoclose')
                ? pickerUri
                : pickerUri + '/autoclose';

            Logger.log('[Picker] Opening picker URL:', pickerUrl);
            window.open(
                pickerUrl,
                'google_photos_picker',
                'width=1024,height=768'
            );

            // 3. 轮询 session，直到用户选完
            await pollPickerSession(sessionId);

            // 4. 轮询完成后，再从我们自己的 DB 把 pending 照片拉一遍
            await loadPendingPhotos();
        } catch (err) {
            Logger.error('Picker flow error:', err);
            Notification.error('Failed to open Google Photos Picker. Please try again.');
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="bi bi-images me-1"></i> Choose from Google Photos';
        }
    });
}

// 轮询 Picker Session：请求 /api/photos/picker/items?sessionId=...
async function pollPickerSession(sessionId) {
    if (!sessionId) {
        Logger.error('[Picker] pollPickerSession called without sessionId');
        throw new Error('Session ID is required');
    }
    
    Logger.log('[Picker] Starting to poll session:', sessionId);
    const maxAttempts = 40; // 40 * 3s = 120 秒
    let attempt = 0;

    while (attempt < maxAttempts) {
        attempt += 1;
        await new Promise(resolve => setTimeout(resolve, 3000));

        try {
            const url = `/api/photos/picker/items?sessionId=${encodeURIComponent(sessionId)}`;
            Logger.log(`[Picker] Polling attempt ${attempt}/${maxAttempts}`);
            const data = await apiGet(url);

            if (data.status === 'PENDING') {
                Logger.log(`[Picker] session ${sessionId} is still pending... (attempt ${attempt}/${maxAttempts})`);
                continue;
            }

            if (data.status === 'DONE') {
                Logger.log(`[Picker] session ${sessionId} DONE, items:`, data.items);
                await loadPendingPhotos();
                return;
            }

            // 其他情况当作失败
            Logger.warn('[Picker] unexpected response:', data);
            return;
        } catch (err) {
            // 检查是否是 202 状态（PENDING）
            if (err.message && err.message.includes('202')) {
                Logger.log(`[Picker] session ${sessionId} is still pending... (attempt ${attempt}/${maxAttempts})`);
                continue;
            }
            Logger.error('pollPickerSession error:', err);
            await loadPendingPhotos();
            return;
        }
    }

    Logger.warn(`[Picker] session ${sessionId} polling timeout`);
}

// 轮播状态
let originalCarouselIndex = 0;
const photosPerView = 3; // 同时显示3张图片

// 存储当前显示的照片 ID 集合（用于检测新照片）
let currentPhotoIds = new Set();

// 把原始照片渲染到 carousel
function renderOriginalCarousel(items) {
    const emptyDiv = document.getElementById('originalPhotosEmpty');
    const wrapper = document.getElementById('originalPhotosCarouselWrapper');
    const inner = document.getElementById('originalCarouselInner');
    const leftBtn = document.getElementById('originalLeft');
    const rightBtn = document.getElementById('originalRight');

    if (!emptyDiv || !wrapper || !inner) {
        Logger.warn('[renderOriginalCarousel] Required DOM elements not found');
        return;
    }

    if (!items || items.length === 0) {
        Logger.log('[renderOriginalCarousel] No items to render, showing empty state');
        DOM.toggle(emptyDiv, true);
        DOM.toggle(wrapper, false);
        inner.innerHTML = '';
        originalCarouselIndex = 0;
        currentPhotoIds.clear();
        return;
    }

    // 检测新照片（不在当前显示列表中的）
    const newPhotoIds = new Set(items.map(item => item.id).filter(id => id));
    const hasNewPhotos = Array.from(newPhotoIds).some(id => !currentPhotoIds.has(id));
    
    // 如果有新照片，重置轮播索引到开头（显示新照片）
    if (hasNewPhotos) {
        Logger.log('[renderOriginalCarousel] New photos detected, resetting carousel to start');
        originalCarouselIndex = 0;
    }
    
    // 更新当前照片 ID 集合
    currentPhotoIds = newPhotoIds;

    Logger.log(`[renderOriginalCarousel] Rendering ${items.length} photos (new photos: ${hasNewPhotos})`);
    DOM.toggle(emptyDiv, false);
    DOM.toggle(wrapper, true);

    // 渲染所有照片卡片
    inner.innerHTML = items.map((item, idx) => {
        // baseUrl 来自 Picker / 或我们 DB 里存的 baseUrl
        // 可以加参数控制尺寸，例如 =w400-h400
        let imgUrl = '';
        let proxyUrl = '';
        
        // 检查 baseUrl 是否存在
        const baseUrl = item.baseUrl || item.imageUrl;
        
        if (baseUrl) {
            // 构建原始 URL（带尺寸参数）
            if (baseUrl.includes('=')) {
                imgUrl = baseUrl.replace(/=[^&]*/, '=w400-h400');
            } else {
                imgUrl = `${baseUrl}=w400-h400`;
            }
            
            // 使用后端代理来避免 CORS 和 403 问题
            proxyUrl = `/api/photos/proxy?url=${encodeURIComponent(imgUrl)}`;
        } else {
            Logger.warn(`[renderOriginalCarousel] No baseUrl for item ${idx}:`, item);
        }
        
        const filename = item.filename || item.photoId || 'Photo';
        // 截断过长的文件名
        const displayName = filename.length > 20 ? filename.substring(0, 20) + '...' : filename;

        // 使用 Firestore 文档 ID 作为 photoId（用于检查结果）
        // 如果 item 有 id（Firestore doc id），使用它；否则使用 photoId 字段
        const photoId = item.id || item.photoId || '';
        const firestoreDocId = item.id; // Firestore 文档 ID
        
        return `
            <div class="carousel-card" data-index="${idx}" data-photo-id="${photoId}" data-doc-id="${firestoreDocId}">
                <div class="position-relative">
                    <img src="${proxyUrl || imgUrl}" alt="${filename}" 
                         onerror="this.src='data:image/svg+xml,%3Csvg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'400\\' height=\\'400\\'%3E%3Crect fill=\\'%23ddd\\' width=\\'400\\' height=\\'400\\'/%3E%3Ctext x=\\'50%25\\' y=\\'50%25\\' text-anchor=\\'middle\\' dy=\\'.3em\\' fill=\\'%23999\\'%3EImage not available%3C/text%3E%3C/svg%3E'; console.error('Failed to load image:', '${imgUrl}');"
                         loading="lazy">
                    <button class="photo-delete-btn" data-photo-id="${photoId}" title="Delete photo">
                        <i class="bi bi-x-circle"></i>
                    </button>
                </div>
                <div class="carousel-card-footer">${displayName}</div>
            </div>
        `;
    }).join('');

    // 更新轮播显示
    updateCarouselView(items.length);
    
    // 绑定左右箭头事件
    if (leftBtn) {
        leftBtn.onclick = () => {
            if (originalCarouselIndex > 0) {
                originalCarouselIndex--;
                updateCarouselView(items.length);
            }
        };
    }
    
    if (rightBtn) {
        rightBtn.onclick = () => {
            const maxIndex = Math.max(0, items.length - photosPerView);
            if (originalCarouselIndex < maxIndex) {
                originalCarouselIndex++;
                updateCarouselView(items.length);
            }
        };
    }
    
    // 绑定删除按钮事件
    const deleteButtons = inner.querySelectorAll('.photo-delete-btn');
    deleteButtons.forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation(); // 防止触发卡片点击事件
            const photoId = btn.getAttribute('data-photo-id');
            if (photoId) {
                await deletePhoto(photoId);
            }
        });
    });
    
    // 绑定图片卡片点击事件（分析照片）
    const photoCards = inner.querySelectorAll('.carousel-card');
    photoCards.forEach((card, idx) => {
        card.addEventListener('click', async (e) => {
            // 如果点击的是删除按钮，不处理
            if (e.target.closest('.photo-delete-btn')) {
                return;
            }
            
            // 使用索引找到对应的 item
            const photoData = items[idx];
            if (!photoData) return;
            
            // photoData 结构：{ id: Firestore doc id, photoId: Google Photos ID, baseUrl, filename }
            // 使用 Firestore doc id 作为 docId，photoId 作为 photoId
            const docId = photoData.id; // Firestore userPhotos 文档 ID
            const photoId = photoData.photoId || photoData.id; // Google Photos ID，如果没有则使用 docId
            
            Logger.log('[Photo click] Photo data:', { docId, photoId, photoData });
            
            if (docId && photoData) {
                await handlePhotoClick(photoId, docId, photoData);
            }
        });
    });
}

// 删除照片
async function deletePhoto(photoId) {
    if (!photoId) {
        Logger.error('[deletePhoto] No photo ID provided');
        return;
    }
    
    // 确认删除
    if (!confirm('Are you sure you want to delete this photo?')) {
        return;
    }
    
    try {
        Logger.log(`[deletePhoto] Deleting photo ${photoId}`);
        await apiDelete(`/api/photos/${photoId}`);
        
        // 重新加载照片列表
        await loadPendingPhotos();
        
        // 显示成功消息
        Notification.success('Photo deleted successfully');
    } catch (error) {
        Logger.error('[deletePhoto] Error:', error);
        const userMessage = ErrorHandler.handleApiError(error, 'deletePhoto');
        Notification.error(userMessage);
    }
}

// 处理照片点击（检查是否已分析，如果未分析则分析，然后跳转到结果页）
// 显示/隐藏 loading 覆盖层
function showLoadingOverlay(message = 'Processing your image with AI...') {
    const overlay = document.getElementById('analysisLoadingOverlay');
    const messageEl = document.getElementById('loadingMessage');
    if (overlay) {
        if (messageEl) {
            messageEl.textContent = message;
        }
        overlay.style.display = 'flex';
    }
}

function hideLoadingOverlay() {
    const overlay = document.getElementById('analysisLoadingOverlay');
    if (overlay) {
        overlay.style.display = 'none';
    }
}

async function handlePhotoClick(photoId, docId, photoData) {
    try {
        Logger.log(`[handlePhotoClick] Photo clicked:`, { photoId, docId, photoData });
        
        // 显示 loading 覆盖层
        showLoadingOverlay('Checking analysis status...');
        
        // 1. 检查是否已有分析结果
        const checkUrl = docId 
            ? `/api/analysis/check?docId=${encodeURIComponent(docId)}${photoId ? `&photoId=${encodeURIComponent(photoId)}` : ''}`
            : `/api/analysis/check?photoId=${encodeURIComponent(photoId)}`;
        
        const checkData = await apiGet(checkUrl);
        Logger.log('[handlePhotoClick] Check result:', checkData);
        
        if (checkData.exists) {
            // 已有结果，直接跳转
            Logger.log(`[handlePhotoClick] Result exists: ${checkData.resultId}`);
            hideLoadingOverlay();
            window.location.href = `result.html?id=${checkData.resultId}`;
            return;
        }
        
        // 2. 没有结果，开始分析
        showLoadingOverlay('Analyzing image with Vision API and Gemini... This may take a moment.');
        
        const imageUrl = photoData.baseUrl || photoData.imageUrl;
        if (!imageUrl) {
            hideLoadingOverlay();
            throw new Error('Image URL not found');
        }
        
        Logger.log('[handlePhotoClick] Starting analysis with:', { photoId, docId, imageUrl });
        
        // 使用 photoId（Google Photos ID）作为主要标识，如果没有则使用 docId
        const analysisPhotoId = photoId || docId;
        
        const analyzeData = await apiPost('/api/analysis/analyze', {
            photoId: analysisPhotoId,
            imageUrl: imageUrl,
            baseUrl: photoData.baseUrl
        });
        
        Logger.log(`[handlePhotoClick] Analysis completed: ${analyzeData.resultId}`);
        
        // 3. 跳转到结果页
        showLoadingOverlay('Analysis completed! Redirecting...');
        setTimeout(() => {
            hideLoadingOverlay();
            window.location.href = `result.html?id=${analyzeData.resultId}`;
        }, 500);
        
    } catch (error) {
        Logger.error('[handlePhotoClick] Error:', error);
        hideLoadingOverlay();
        const userMessage = ErrorHandler.handleApiError(error, 'handlePhotoClick');
        Notification.error(userMessage);
    }
}

// 使用 utils.js 中的 Notification，保留 showNotification 作为别名以保持兼容性
const showNotification = Notification.show;

// 加载已分析的照片
async function loadAnalyzedPhotos() {
    try {
        const data = await apiGet('/api/analysis/results');
        renderAnalyzedCarousel(data.items || []);
    } catch (error) {
        Logger.error('[loadAnalyzedPhotos] Error:', error);
        renderAnalyzedCarousel([]);
    }
}

// 渲染已分析的照片轮播
function renderAnalyzedCarousel(items) {
    const emptyDiv = document.getElementById('analyzedPhotosEmpty');
    const wrapper = document.getElementById('analyzedPhotosCarouselWrapper');
    const inner = document.getElementById('analyzedCarouselInner');
    const leftBtn = document.getElementById('analyzedLeft');
    const rightBtn = document.getElementById('analyzedRight');

    if (!emptyDiv || !wrapper || !inner) {
        Logger.warn('[renderAnalyzedCarousel] Required DOM elements not found');
        return;
    }

    if (!items || items.length === 0) {
        DOM.toggle(emptyDiv, true);
        DOM.toggle(wrapper, false);
        inner.innerHTML = '';
        return;
    }

    DOM.toggle(emptyDiv, false);
    DOM.toggle(wrapper, true);

    inner.innerHTML = items.map((item, idx) => {
        let imgUrl = '';
        let proxyUrl = '';
        
        if (item.baseUrl || item.imageUrl) {
            const url = item.baseUrl || item.imageUrl;
            if (url.includes('=')) {
                imgUrl = url.replace(/=[^&]*/, '=w400-h400');
            } else {
                imgUrl = `${url}=w400-h400`;
            }
            proxyUrl = `/api/photos/proxy?url=${encodeURIComponent(imgUrl)}`;
        }
        
        const era = item.geminiResult?.era_primary || 'Unknown';
        const resultId = item.id;

        return `
            <div class="carousel-card" data-index="${idx}" data-result-id="${resultId}">
                <div class="position-relative">
                    <img src="${proxyUrl || imgUrl}" alt="Analyzed photo" 
                         onerror="this.src='data:image/svg+xml,%3Csvg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'400\\' height=\\'400\\'%3E%3Crect fill=\\'%23ddd\\' width=\\'400\\' height=\\'400\\'/%3E%3Ctext x=\\'50%25\\' y=\\'50%25\\' text-anchor=\\'middle\\' dy=\\'.3em\\' fill=\\'%23999\\'%3EImage not available%3C/text%3E%3C/svg%3E';"
                         loading="lazy">
        </div>
                <div class="carousel-card-footer">${era}</div>
      </div>
    `;
    }).join('');

    // 绑定点击事件
    const cards = inner.querySelectorAll('.carousel-card');
    cards.forEach(card => {
        card.addEventListener('click', (e) => {
            const resultId = card.getAttribute('data-result-id');
            if (resultId) {
                window.location.href = `result.html?id=${resultId}`;
            }
        });
    });
    
    // TODO: 添加左右箭头控制（类似 originalCarousel）
}

// 更新轮播视图
function updateCarouselView(totalItems) {
    const inner = document.getElementById('originalCarouselInner');
    const leftBtn = document.getElementById('originalLeft');
    const rightBtn = document.getElementById('originalRight');
    
    if (!inner) return;
    
    // 计算最大索引
    const maxIndex = Math.max(0, totalItems - photosPerView);
    originalCarouselIndex = Math.min(originalCarouselIndex, maxIndex);
    
    // 更新按钮状态
    if (leftBtn) {
        leftBtn.disabled = originalCarouselIndex === 0;
    }
    if (rightBtn) {
        rightBtn.disabled = originalCarouselIndex >= maxIndex;
    }
    
    // 计算滚动位置（每张卡片宽度 + gap）
    const cardWidth = 170; // 与CSS中的 flex: 0 0 170px 一致
    const gap = 12; // 0.75rem = 12px
    const scrollPosition = originalCarouselIndex * (cardWidth + gap);
    
    inner.style.transform = `translateX(-${scrollPosition}px)`;
    inner.style.transition = 'transform 0.3s ease';
}

// Logout：调用后端 /api/auth/logout，清 cookie，然后回首页
async function logout() {
    try {
        await apiPost('/api/auth/logout');
    } catch (err) {
        Logger.error('logout error:', err);
    } finally {
        window.location.href = '/index.html';
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    await ensureLoggedIn();
    
    // 初始化轮播索引
    originalCarouselIndex = 0;
    
    // 加载已分析的照片
    await loadAnalyzedPhotos();
    
    // 检查 URL 参数，如果需要自动打开 picker
    if (URLUtils.getParam('openPicker') === 'true') {
        URLUtils.removeParam('openPicker');
        
        // 等待一下确保页面完全加载，然后自动打开 picker
        setTimeout(() => {
            if (typeof window.openPhotosPicker === 'function') {
                Logger.log('[dashboard] Auto-opening photo picker from URL parameter');
                window.openPhotosPicker();
            } else {
                Logger.warn('[dashboard] openPhotosPicker not available yet');
                setTimeout(() => {
                    if (typeof window.openPhotosPicker === 'function') {
                        window.openPhotosPicker();
                    }
                }, 500);
            }
        }, 300);
    }
});
