// frontend/dashboard.js
// Uses utility functions from utils.js

// Global function: Open photo picker
window.openPhotosPicker = function () {
    const btn = DOM.getElement('btnPickFromGoogle');
    if (btn) {
        btn.click();
    } else {
        Logger.warn('btnPickFromGoogle not found on this page');
    }
};

// Verify login status and display welcome message
async function ensureLoggedIn() {
    try {
        const user = await apiGet('/api/auth/me');
        Logger.log('Logged in as', user);

        const nameSpan = DOM.getElement('userName');
        if (nameSpan) {
            nameSpan.textContent = user.name || 'User';
        }

        // Setup picker button (photos will be loaded in DOMContentLoaded)
        setupPickerButton();
    } catch (err) {
        Logger.error('ensureLoggedIn error:', err);
        window.location.href = '/signin.html';
    }
}

// Load pending photos from our database
async function loadPendingPhotos() {
    try {
        Logger.log('[loadPendingPhotos] Loading pending photos...');
        const data = await apiGet('/api/photos/pending');
        const items = data.items || [];
        Logger.log(`[loadPendingPhotos] Loaded ${items.length} pending photos`);
        
        // Map data format
        const mappedItems = items.map(doc => ({
            id: doc.id, // Firestore document ID
            photoId: doc.photoId, // Google Photos ID
            baseUrl: doc.baseUrl,
            filename: doc.filename || doc.photoId || 'Photo',
        }));
        
        // Render carousel (new photos are already at the front, as backend sorts by createdAt desc)
        renderOriginalCarousel(mappedItems);
    } catch (err) {
        Logger.error('loadPendingPhotos error:', err);
        renderOriginalCarousel([]);
    }
}

// Bind "Choose from Google Photos" button event
function setupPickerButton() {
    const btn = document.getElementById('btnPickFromGoogle');
    if (!btn) return;

    btn.addEventListener('click', async () => {
        try {
            btn.disabled = true;
            btn.textContent = 'Opening Google Photos...';

            // 1. Backend creates session, returns pickerUri + sessionId
            const response = await apiPost('/api/photos/picker/start');
            Logger.log('[Picker] Response from /api/photos/picker/start:', response);
            
            const { sessionId, pickerUri } = response;
            
            if (!sessionId) {
                throw new Error('Failed to get sessionId from server');
            }
            
            Logger.log('[Picker] Session ID:', sessionId);
            Logger.log('[Picker] Picker URI:', pickerUri);

            // 2. Open pickerUri in new window (add /autoclose, will auto-close)
            const pickerUrl = pickerUri.endsWith('/autoclose')
                ? pickerUri
                : pickerUri + '/autoclose';

            Logger.log('[Picker] Opening picker URL:', pickerUrl);
            window.open(
                pickerUrl,
                'google_photos_picker',
                'width=1024,height=768'
            );

            // 3. Poll session until user finishes selection
            await pollPickerSession(sessionId);

            // 4. After polling completes, reload pending photos from our DB
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

// Poll Picker Session: Request /api/photos/picker/items?sessionId=...
async function pollPickerSession(sessionId) {
    if (!sessionId) {
        Logger.error('[Picker] pollPickerSession called without sessionId');
        throw new Error('Session ID is required');
    }
    
    Logger.log('[Picker] Starting to poll session:', sessionId);
    const maxAttempts = 40; // 40 * 3s = 120 seconds
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

            // Other cases treated as failure
            Logger.warn('[Picker] unexpected response:', data);
            return;
        } catch (err) {
            // Check if status is 202 (PENDING)
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

// Carousel state
let originalCarouselIndex = 0;
let analyzedCarouselIndex = 0;
const photosPerView = 3; // Display 3 images at once

// Store current displayed photo ID set (for detecting new photos)
let currentPhotoIds = new Set();

// Render original photos to carousel
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

    // Detect new photos (not in current displayed list)
    const newPhotoIds = new Set(items.map(item => item.id).filter(id => id));
    const hasNewPhotos = Array.from(newPhotoIds).some(id => !currentPhotoIds.has(id));
    
    // If new photos detected, reset carousel index to start (show new photos)
    if (hasNewPhotos) {
        Logger.log('[renderOriginalCarousel] New photos detected, resetting carousel to start');
        originalCarouselIndex = 0;
    }
    
    // Update current photo ID set
    currentPhotoIds = newPhotoIds;

    Logger.log(`[renderOriginalCarousel] Rendering ${items.length} photos (new photos: ${hasNewPhotos})`);
    DOM.toggle(emptyDiv, false);
    DOM.toggle(wrapper, true);

    // Render all photo cards
    inner.innerHTML = items.map((item, idx) => {
        // baseUrl comes from Picker or stored baseUrl in our DB
        // Can add parameters to control size, e.g., =w400-h400
        let imgUrl = '';
        let proxyUrl = '';
        
        // Check if baseUrl exists
        const baseUrl = item.baseUrl || item.imageUrl;
        
        if (baseUrl) {
            // Build original URL (with size parameters)
            if (baseUrl.includes('=')) {
                imgUrl = baseUrl.replace(/=[^&]*/, '=w400-h400');
            } else {
                imgUrl = `${baseUrl}=w400-h400`;
            }
            
            // Use backend proxy to avoid CORS and 403 issues
            proxyUrl = `/api/photos/proxy?url=${encodeURIComponent(imgUrl)}`;
        } else {
            Logger.warn(`[renderOriginalCarousel] No baseUrl for item ${idx}:`, item);
        }
        
        const filename = item.filename || item.photoId || 'Photo';
        // Truncate long filenames
        const displayName = filename.length > 20 ? filename.substring(0, 20) + '...' : filename;

        // Use Firestore document ID as photoId (for checking results)
        // If item has id (Firestore doc id), use it; otherwise use photoId field
        const photoId = item.id || item.photoId || '';
        const firestoreDocId = item.id; // Firestore document ID
        
        return `
            <div class="carousel-card" data-index="${idx}" data-photo-id="${photoId}" data-doc-id="${firestoreDocId}">
                <div class="position-relative">
                    <img src="${proxyUrl || imgUrl}" alt="${filename}" 
                         data-fallback-url="${imgUrl}"
                         loading="lazy">
                    <button class="photo-delete-btn" data-photo-id="${photoId}" title="Delete photo">
                        <i class="bi bi-x-circle"></i>
                    </button>
                </div>
                <div class="carousel-card-footer">${displayName}</div>
            </div>
        `;
    }).join('');

    // Update carousel display
    updateCarouselView(items.length);
    
    // Bind left/right arrow events
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
    
    // Bind delete button events
    const deleteButtons = inner.querySelectorAll('.photo-delete-btn');
    deleteButtons.forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation(); // Prevent triggering card click event
            const photoId = btn.getAttribute('data-photo-id');
            if (photoId) {
                await deletePhoto(photoId);
            }
        });
    });
    
    // Bind photo card click events (analyze photo)
    const photoCards = inner.querySelectorAll('.carousel-card');
    photoCards.forEach((card, idx) => {
        card.addEventListener('click', async (e) => {
            // If delete button is clicked, don't process
            if (e.target.closest('.photo-delete-btn')) {
                return;
            }
            
            // Use index to find corresponding item
            const photoData = items[idx];
            if (!photoData) return;
            
            // photoData structure: { id: Firestore doc id, photoId: Google Photos ID, baseUrl, filename }
            // Use Firestore doc id as docId, photoId as photoId
            const docId = photoData.id; // Firestore userPhotos document ID
            const photoId = photoData.photoId || photoData.id; // Google Photos ID, or use docId if not available
            
            Logger.log('[Photo click] Photo data:', { docId, photoId, photoData });
            
            if (docId && photoData) {
                await handlePhotoClick(photoId, docId, photoData);
            }
        });
    });
    
    // Bind image error handlers (for CSP compliance)
    const images = inner.querySelectorAll('img');
    const placeholderSvg = 'data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'400\' height=\'400\'%3E%3Crect fill=\'%23ddd\' width=\'400\' height=\'400\'/%3E%3Ctext x=\'50%25\' y=\'50%25\' text-anchor=\'middle\' dy=\'.3em\' fill=\'%23999\'%3EImage not available%3C/text%3E%3C/svg%3E';
    images.forEach(img => {
        img.addEventListener('error', function() {
            const fallbackUrl = this.getAttribute('data-fallback-url');
            Logger.error('[Image error] Failed to load image:', fallbackUrl || this.src);
            this.src = placeholderSvg;
        });
    });
}

// Delete photo
async function deletePhoto(photoId) {
    if (!photoId) {
        Logger.error('[deletePhoto] No photo ID provided');
        return;
    }
    
    // Confirm deletion
    if (!confirm('Are you sure you want to delete this photo?')) {
        return;
    }
    
    try {
        Logger.log(`[deletePhoto] Deleting photo ${photoId}`);
        await apiDelete(`/api/photos/${photoId}`);
        
        // Reload photo list
        await loadPendingPhotos();
        
        // Show success message
        Notification.success('Photo deleted successfully');
    } catch (error) {
        Logger.error('[deletePhoto] Error:', error);
        const userMessage = ErrorHandler.handleApiError(error, 'deletePhoto');
        Notification.error(userMessage);
    }
}

// Delete analysis result
async function deleteAnalysisResult(resultId) {
    if (!resultId) {
        Logger.error('[deleteAnalysisResult] No result ID provided');
        return;
    }
    
    // Confirm deletion
    if (!confirm('Are you sure you want to delete this analysis result?')) {
        return;
    }
    
    try {
        Logger.log(`[deleteAnalysisResult] Deleting result ${resultId}`);
        await apiDelete(`/api/analysis/result/${resultId}`);
        
        // Reload both carousels: analyzed photos and pending photos
        // (Deleting analysis result may move the photo back to pending status)
        await Promise.all([
            loadAnalyzedPhotos(),
            loadPendingPhotos()
        ]);
        
        // Show success message
        Notification.success('Analysis result deleted successfully');
    } catch (error) {
        Logger.error('[deleteAnalysisResult] Error:', error);
        const userMessage = ErrorHandler.handleApiError(error, 'deleteAnalysisResult');
        Notification.error(userMessage);
    }
}

// Handle photo click (check if analyzed, if not analyze, then navigate to result page)
// Show/hide loading overlay
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
        
        // Show loading overlay
        showLoadingOverlay('Checking analysis status...');
        
        // 1. Check if analysis result already exists
        const checkUrl = docId 
            ? `/api/analysis/check?docId=${encodeURIComponent(docId)}${photoId ? `&photoId=${encodeURIComponent(photoId)}` : ''}`
            : `/api/analysis/check?photoId=${encodeURIComponent(photoId)}`;
        
        const checkData = await apiGet(checkUrl);
        Logger.log('[handlePhotoClick] Check result:', checkData);
        
        if (checkData.exists) {
            // Result exists, navigate directly
            Logger.log(`[handlePhotoClick] Result exists: ${checkData.resultId}`);
            hideLoadingOverlay();
            window.location.href = `result.html?id=${checkData.resultId}`;
            return;
        }
        
        // 2. No result, start analysis
        showLoadingOverlay('Analyzing image with Vision API and Gemini... This may take a moment.');
        
        const imageUrl = photoData.baseUrl || photoData.imageUrl;
        if (!imageUrl) {
            hideLoadingOverlay();
            throw new Error('Image URL not found');
        }
        
        Logger.log('[handlePhotoClick] Starting analysis with:', { photoId, docId, imageUrl });
        
        // Use photoId (Google Photos ID) as primary identifier, or use docId if not available
        const analysisPhotoId = photoId || docId;
        
        const analyzeData = await apiPost('/api/analysis/analyze', {
            photoId: analysisPhotoId,
            imageUrl: imageUrl,
            baseUrl: photoData.baseUrl
        });
        
        Logger.log(`[handlePhotoClick] Analysis completed: ${analyzeData.resultId}`);
        
        // 3. Navigate to result page
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

// Use Notification from utils.js, keep showNotification as alias for compatibility
const showNotification = Notification.show;

// Load analyzed photos
async function loadAnalyzedPhotos() {
    try {
        const data = await apiGet('/api/analysis/results');
        renderAnalyzedCarousel(data.items || []);
    } catch (error) {
        Logger.error('[loadAnalyzedPhotos] Error:', error);
        renderAnalyzedCarousel([]);
    }
}

// Render analyzed photos carousel
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
        analyzedCarouselIndex = 0;
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
                         data-fallback-url="${imgUrl}"
                         loading="lazy">
                    <button class="photo-delete-btn" data-result-id="${resultId}" title="Delete analysis result">
                        <i class="bi bi-x-circle"></i>
                    </button>
                </div>
                <div class="carousel-card-footer">${era}</div>
            </div>
        `;
    }).join('');

    // Bind delete button events
    const deleteButtons = inner.querySelectorAll('.photo-delete-btn');
    deleteButtons.forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation(); // Prevent triggering card click event
            const resultId = btn.getAttribute('data-result-id');
            if (resultId) {
                await deleteAnalysisResult(resultId);
            }
        });
    });
    
    // Bind click events
    const cards = inner.querySelectorAll('.carousel-card');
    cards.forEach(card => {
        card.addEventListener('click', async (e) => {
            // If delete button is clicked, don't process
            if (e.target.closest('.photo-delete-btn')) {
                return;
            }
            
            const resultId = card.getAttribute('data-result-id');
            if (resultId) {
                window.location.href = `result.html?id=${resultId}`;
            }
        });
    });
    
    // Bind image error handlers (for CSP compliance)
    const images = inner.querySelectorAll('img');
    const placeholderSvg = 'data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'400\' height=\'400\'%3E%3Crect fill=\'%23ddd\' width=\'400\' height=\'400\'/%3E%3Ctext x=\'50%25\' y=\'50%25\' text-anchor=\'middle\' dy=\'.3em\' fill=\'%23999\'%3EImage not available%3C/text%3E%3C/svg%3E';
    images.forEach(img => {
        img.addEventListener('error', function() {
            const fallbackUrl = this.getAttribute('data-fallback-url');
            Logger.error('[Image error] Failed to load image:', fallbackUrl || this.src);
            this.src = placeholderSvg;
        });
    });
    
    // Update carousel display
    updateAnalyzedCarouselView(items.length);
    
    // Bind left/right arrow events
    if (leftBtn) {
        leftBtn.onclick = () => {
            if (analyzedCarouselIndex > 0) {
                analyzedCarouselIndex--;
                updateAnalyzedCarouselView(items.length);
            }
        };
    }
    
    if (rightBtn) {
        rightBtn.onclick = () => {
            const maxIndex = Math.max(0, items.length - photosPerView);
            if (analyzedCarouselIndex < maxIndex) {
                analyzedCarouselIndex++;
                updateAnalyzedCarouselView(items.length);
            }
        };
    }
}

// Update carousel view
function updateCarouselView(totalItems) {
    const inner = document.getElementById('originalCarouselInner');
    const leftBtn = document.getElementById('originalLeft');
    const rightBtn = document.getElementById('originalRight');
    
    if (!inner) return;
    
    // Calculate max index
    const maxIndex = Math.max(0, totalItems - photosPerView);
    originalCarouselIndex = Math.min(originalCarouselIndex, maxIndex);
    
    // Update button states
    if (leftBtn) {
        leftBtn.disabled = originalCarouselIndex === 0;
    }
    if (rightBtn) {
        rightBtn.disabled = originalCarouselIndex >= maxIndex;
    }
    
    // Calculate scroll position (card width + gap)
    const cardWidth = 180; // Matches CSS flex: 0 0 180px
    const gap = 20; // 1.25rem = 20px
    const scrollPosition = originalCarouselIndex * (cardWidth + gap);
    
    inner.style.transform = `translateX(-${scrollPosition}px)`;
    inner.style.transition = 'transform 0.3s ease';
}

// Update analyzed carousel view
function updateAnalyzedCarouselView(totalItems) {
    const inner = document.getElementById('analyzedCarouselInner');
    const leftBtn = document.getElementById('analyzedLeft');
    const rightBtn = document.getElementById('analyzedRight');
    
    if (!inner) return;
    
    // Calculate max index
    const maxIndex = Math.max(0, totalItems - photosPerView);
    analyzedCarouselIndex = Math.min(analyzedCarouselIndex, maxIndex);
    
    // Update button states
    if (leftBtn) {
        leftBtn.disabled = analyzedCarouselIndex === 0;
    }
    if (rightBtn) {
        rightBtn.disabled = analyzedCarouselIndex >= maxIndex;
    }
    
    // Calculate scroll position (card width + gap)
    const cardWidth = 180; // Matches CSS flex: 0 0 180px
    const gap = 20; // 1.25rem = 20px
    const scrollPosition = analyzedCarouselIndex * (cardWidth + gap);
    
    inner.style.transform = `translateX(-${scrollPosition}px)`;
    inner.style.transition = 'transform 0.3s ease';
}

// Logout: Call backend /api/auth/logout, clear cookies, then return to home page
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
    
    // Initialize carousel indices
    originalCarouselIndex = 0;
    analyzedCarouselIndex = 0;
    
    // Load both carousels
    await Promise.all([
        loadPendingPhotos(),
        loadAnalyzedPhotos()
    ]);
    
    // Check URL parameter, auto-open picker if needed
    if (URLUtils.getParam('openPicker') === 'true') {
        URLUtils.removeParam('openPicker');
        
        // Wait a bit to ensure page is fully loaded, then auto-open picker
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

// Reload carousels when page becomes visible (e.g., returning from result page)
// This handles browser back/forward navigation and tab switching
document.addEventListener('visibilitychange', async () => {
    if (!document.hidden) {
        // Page became visible, reload both carousels to sync state
        Logger.log('[dashboard] Page became visible, reloading carousels...');
        try {
            await Promise.all([
                loadPendingPhotos(),
                loadAnalyzedPhotos()
            ]);
        } catch (error) {
            Logger.error('[dashboard] Error reloading carousels:', error);
        }
    }
});

// Also handle pageshow event for browser back/forward navigation
window.addEventListener('pageshow', async (event) => {
    // event.persisted is true if page was loaded from cache (back/forward navigation)
    if (event.persisted) {
        Logger.log('[dashboard] Page loaded from cache, reloading carousels...');
        try {
            await Promise.all([
                loadPendingPhotos(),
                loadAnalyzedPhotos()
            ]);
        } catch (error) {
            Logger.error('[dashboard] Error reloading carousels:', error);
        }
    }
});
