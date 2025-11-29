// frontend/result.js
// Uses utility functions from utils.js

// Get resultId from URL
const resultId = URLUtils.getParam('id');

if (!resultId) {
    ErrorHandler.showError('No result ID provided');
} else {
    loadResult(resultId);
}

async function loadResult(resultId) {
    try {
        const result = await apiGet(`/api/analysis/result/${resultId}`);
        renderResult(result);
    } catch (error) {
        Logger.error('Load result error:', error);
        const userMessage = ErrorHandler.handleApiError(error, 'loadResult');
        ErrorHandler.showError(userMessage);
    }
}

function renderResult(result) {
    const geminiResult = result.geminiResult || {};
    // Prefer baseUrl, then imageUrl
    const imageUrl = result.baseUrl || result.imageUrl || '';

    Logger.log('[renderResult] Image URL:', imageUrl);
    Logger.log('[renderResult] Full result:', result);

    //
    // Build image proxy URL (include photoId so backend can refresh stale baseUrl)
    let displayImageUrl = '';
    if (imageUrl) {
        let imgUrl = imageUrl;
        if (imgUrl.includes('=')) {
            imgUrl = imgUrl.replace(/=[^&]*/, '=w800-h800');
        } else {
            imgUrl = `${imgUrl}=w800-h800`;
        }

        const photoIdForProxy = result.photoId || result.docId || '';
        const baseProxy = `/api/photos/proxy?url=${encodeURIComponent(imgUrl)}`;
        displayImageUrl = photoIdForProxy
            ? `${baseProxy}&photoId=${encodeURIComponent(photoIdForProxy)}`
            : baseProxy;
    } else {
        Logger.warn('[renderResult] No image URL found in result');
    }


    const container = DOM.getElement('resultContainer');
    container.innerHTML = `
        <div class="results-grid">
            <!-- Left: results -->
            <div class="card">
                <div class="section-title">Vintage insights</div>
                <div class="kv">
                    <div class="small">Primary era</div>
                    <div class="era-badge">${geminiResult.era_primary || '-'}</div>
                    <div class="small">Style tags</div>
                    <div class="chips" data-chip-type="style-tag">
                        ${(geminiResult.style_tags || []).map(tag => {
                            const safeTag = String(tag || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
                            return `<span class="chip" data-search="${safeTag}" title="Search '${tag}' on Google">${tag}</span>`;
                        }).join('')}
                    </div>
                </div>

                <div class="section-title">Top-3 candidates</div>
                <div style="display:grid; gap:10px;">
                    ${(geminiResult.top3_candidates || []).map(c => `
                        <div class="cand">
                            <div class="title">${(c.era || '') + ' — ' + (c.style || '')}</div>
                            <div class="pct">${Math.round((c.confidence || 0) * 100)}%</div>
                            <div class="meter"><span style="width: ${Math.round((c.confidence || 0) * 100)}%"></span></div>
                            <div class="small" style="grid-column:1 / -1">${c.discriminator || ''}</div>
                        </div>
                    `).join('')}
                </div>

                <div class="section-title">Why</div>
                <div class="callout small">${geminiResult.rationale || 'No rationale provided.'}</div>

                <div class="section-title">Search queries</div>
                <div class="chips" data-chip-type="search-query">
                    ${((geminiResult.search_queries && geminiResult.search_queries.en) || []).map(q => {
                        const safeQuery = String(q || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
                        return `<span class="chip" data-search="${safeQuery}" title="Search '${q}' on Google">${q}</span>`;
                    }).join('')}
                </div>

                <div class="section-title">Shopping tips</div>
                ${renderTips(geminiResult.shopping_tips || [])}
            </div>

            <!-- Right: image -->
            <div class="card">
                <div class="section-title">Your photo</div>
                <div class="preview">
                    <img src="${displayImageUrl}" alt="Analyzed photo" 
                         onerror="this.src='data:image/svg+xml,%3Csvg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'800\\' height=\\'800\\'%3E%3Crect fill=\\'%23ddd\\' width=\\'800\\' height=\\'800\\'/%3E%3Ctext x=\\'50%25\\' y=\\'50%25\\' text-anchor=\\'middle\\' dy=\\'.3em\\' fill=\\'%23999\\'%3EImage not available%3C/text%3E%3C/svg%3E';"
                         loading="lazy">
                </div>
                <div class="small" style="marginTop:16px; text-align:center">
                    <a href="dashboard.html" class="analyze-link">Analyze another image</a>
                </div>
            </div>
        </div>
    `;
    
    // Bind chip click events (using event delegation)
    setupChipClickHandlers(container);
}

// Setup chip click event handlers
function setupChipClickHandlers(container) {
    // Use event delegation to listen for clicks on all .chip elements
    container.addEventListener('click', (e) => {
        const chip = e.target.closest('.chip');
        if (chip && chip.hasAttribute('data-search')) {
            e.preventDefault();
            e.stopPropagation();
            const searchQuery = chip.getAttribute('data-search');
            if (searchQuery) {
                // Only open in new tab, don't navigate current page
                openGoogle(searchQuery);
            }
        }
    });
}

function renderTips(tips) {
    if (!tips.length) {
        return '<div class="small">No shopping tips in this result.</div>';
    }

    return `
        <div class="tips-grid">
            ${tips.map(tip => {
                const { title, body } = splitTip(tip);
                return `
                    <div class="tip-card">
                        <div class="tip-accent"></div>
                        <div class="tip-content">
                            <div class="tip-head">
                                <div class="tip-icon">${iconFor(title)}</div>
                                <div class="tip-title">${title}</div>
                            </div>
                            <div class="tip-body">${body}</div>
                        </div>
                    </div>
                `;
            }).join('')}
        </div>
    `;
}

function splitTip(s) {
    const raw = String(s || '').trim();
    
    // Pattern 1: *Title:* Body (most common, e.g., "*Silhouettes:* Look for...")
    let m = /^\s*\*\s*([^*:]+?)\s*\*?\s*[:：]\s*(.+)$/.exec(raw);
    if (m) {
        const title = m[1].trim();
        // Remove leading * from body
        let body = m[2].trim().replace(/^\*\s*/, '');
        return { title, body };
    }
    
    // Pattern 2: **Title:** Body
    m = /^\s*\*\*\s*([^*]+?)\s*\*\*\s*[:：\-–—]\s*(.+)$/.exec(raw);
    if (m) {
        const title = m[1].trim();
        // Remove leading * from body
        let body = m[2].trim().replace(/^\*\s*/, '');
        return { title, body };
    }
    
    // Pattern 3: Title: Body (no asterisks)
    m = /^\s*([A-Za-z][A-Za-z\s&]+?)\s*[:：]\s*(.+)$/.exec(raw);
    if (m) {
        const title = m[1].trim();
        // Remove leading * from body
        let body = m[2].trim().replace(/^\*\s*/, '');
        // Check if it's a known tag
        const normalizedTitle = normalizeTitle(title);
        return { title: normalizedTitle, body };
    }
    
    // Pattern 4: **Title** Body (no colon)
    m = /^\s*\*\*\s*([^*]+?)\s*\*\*\s*(.+)$/.exec(raw);
    if (m) {
        const title = m[1].trim();
        // Remove leading * from body
        let body = m[2].trim().replace(/^\*\s*/, '');
        return { title, body };
    }
    
    // Pattern 5: Keyword matching (as fallback)
    const lower = raw.toLowerCase();
    const titleMap = [
        ['silhouettes', 'Silhouettes'], ['silhouette', 'Silhouettes'],
        ['fabrics', 'Fabrics'], ['fabric', 'Fabrics'], ['materials', 'Fabrics'], ['material', 'Fabrics'],
        ['details', 'Details'], ['detail', 'Details'],
        ['price range', 'Price Range'], ['price', 'Price Range'], ['pricing', 'Price Range'],
        ['platforms', 'Platforms'], ['platform', 'Platforms'], ['marketplace', 'Platforms']
    ];
    
    for (const [needle, title] of titleMap) {
        if (lower.includes(needle)) {
            // Try to extract body (remove title part and leading *)
            let body = raw.replace(/\*\*/g, '').replace(new RegExp(needle, 'gi'), '').replace(/^[:：\-–—\s]+/, '').trim();
            body = body.replace(/^\*\s*/, ''); // Remove leading *
            return { title, body: body || raw.replace(/\*\*/g, '').replace(/^\*\s*/, '') };
        }
    }
    
    // Default: Use entire text as body, remove leading *
    let body = raw.replace(/\*\*/g, '').replace(/^\*\s*/, '');
    return { title: 'Tip', body };
}

// Normalize title (ensure first letter uppercase, rest lowercase)
function normalizeTitle(title) {
    if (!title) return 'Tip';
    
    const titleMap = {
        'silhouettes': 'Silhouettes',
        'silhouette': 'Silhouettes',
        'fabrics': 'Fabrics',
        'fabric': 'Fabrics',
        'materials': 'Fabrics',
        'material': 'Fabrics',
        'details': 'Details',
        'detail': 'Details',
        'price range': 'Price Range',
        'price': 'Price Range',
        'pricing': 'Price Range',
        'platforms': 'Platforms',
        'platform': 'Platforms',
        'marketplace': 'Platforms'
    };
    
    const lower = title.toLowerCase().trim();
    if (titleMap[lower]) {
        return titleMap[lower];
    }
    
    // If not in map, keep as is but ensure first letter is uppercase
    return title.charAt(0).toUpperCase() + title.slice(1).toLowerCase();
}

function iconFor(title) {
    const t = (title || '').toLowerCase();
    const green = '#22c55e'; // Unified green color
    
    if (t.includes('silhouette')) {
        // Person silhouette icon
        return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="${green}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-3-3.87M8 21v-2a4 4 0 0 1 3-3.87M15 7a3 3 0 1 1-6 0 3 3 0 0 1 6 0z"/></svg>`;
    }
    if (t.includes('fabric') || t.includes('material')) {
        // Stacked fabric icon (wavy lines, similar to image style)
        return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="${green}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6c2 0 2 2 4 2s2-2 4-2 2 2 4 2 2-2 4-2"/><path d="M3 12c2 0 2 2 4 2s2-2 4-2 2 2 4 2 2-2 4-2"/><path d="M3 18c2 0 2 2 4 2s2-2 4-2 2 2 4 2 2-2 4-2"/></svg>`;
    }
    if (t.includes('detail')) {
        // Star icon
        return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="${green}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>`;
    }
    if (t.includes('price')) {
        // Price/range icon (square arrow)
        return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="${green}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" fill="none"/><path d="M9 9h6M9 15h6M12 3v18"/></svg>`;
    }
    if (t.includes('platform')) {
        // Globe icon
        return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="${green}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`;
    }
    
    return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="${green}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>`;
}

function truncateText(text, maxLength) {
    if (!text) return '';
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength).trim() + '...';
}

// Open Google search in new tab (don't navigate current page)
// Ensure function is available in global scope
function openGoogle(q) {
    if (!q) {
        Logger.warn('[openGoogle] No search query provided');
        return;
    }
    
    try {
        const searchQuery = String(q).trim();
        const searchUrl = 'https://www.google.com/search?q=' + encodeURIComponent(searchQuery);
        Logger.log('[openGoogle] Opening Google search for:', searchQuery);
        
        // Only open in new tab, don't navigate current page
        window.open(searchUrl, '_blank', 'noopener,noreferrer');
        
        // Note: If popup is blocked, we won't navigate current page
        // User needs to allow popups to use this feature
    } catch (error) {
        Logger.error('[openGoogle] Error opening Google search:', error);
        Notification.error('Failed to open Google search. Please check if popups are blocked.');
    }
}

// Ensure function is available in global scope
window.openGoogle = openGoogle;

