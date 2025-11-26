// frontend/result.js
// 使用 utils.js 中的工具函数

// 从 URL 获取 resultId
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
    // 优先使用 baseUrl，然后是 imageUrl
    const imageUrl = result.baseUrl || result.imageUrl || '';
    
    Logger.log('[renderResult] Image URL:', imageUrl);
    Logger.log('[renderResult] Full result:', result);

    // 构建图片代理 URL
    let displayImageUrl = '';
    if (imageUrl) {
        let imgUrl = imageUrl;
        if (imgUrl.includes('=')) {
            imgUrl = imgUrl.replace(/=[^&]*/, '=w800-h800');
        } else {
            imgUrl = `${imgUrl}=w800-h800`;
        }
        displayImageUrl = `/api/photos/proxy?url=${encodeURIComponent(imgUrl)}`;
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
    
    // 绑定 chip 点击事件（使用事件委托）
    setupChipClickHandlers(container);
}

// 设置 chip 点击事件处理器
function setupChipClickHandlers(container) {
    // 使用事件委托，监听所有 .chip 元素的点击
    container.addEventListener('click', (e) => {
        const chip = e.target.closest('.chip');
        if (chip && chip.hasAttribute('data-search')) {
            e.preventDefault();
            e.stopPropagation();
            const searchQuery = chip.getAttribute('data-search');
            if (searchQuery) {
                // 只在新标签页打开，不在当前页面跳转
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
    
    // 模式1: *Title:* Body (最常见，如 "*Silhouettes:* Look for...")
    let m = /^\s*\*\s*([^*:]+?)\s*\*?\s*[:：]\s*(.+)$/.exec(raw);
    if (m) {
        const title = m[1].trim();
        // 去掉 body 开头的 * 号
        let body = m[2].trim().replace(/^\*\s*/, '');
        return { title, body };
    }
    
    // 模式2: **Title:** Body
    m = /^\s*\*\*\s*([^*]+?)\s*\*\*\s*[:：\-–—]\s*(.+)$/.exec(raw);
    if (m) {
        const title = m[1].trim();
        // 去掉 body 开头的 * 号
        let body = m[2].trim().replace(/^\*\s*/, '');
        return { title, body };
    }
    
    // 模式3: Title: Body (没有星号)
    m = /^\s*([A-Za-z][A-Za-z\s&]+?)\s*[:：]\s*(.+)$/.exec(raw);
    if (m) {
        const title = m[1].trim();
        // 去掉 body 开头的 * 号
        let body = m[2].trim().replace(/^\*\s*/, '');
        // 检查是否是已知的标签
        const normalizedTitle = normalizeTitle(title);
        return { title: normalizedTitle, body };
    }
    
    // 模式4: **Title** Body (没有冒号)
    m = /^\s*\*\*\s*([^*]+?)\s*\*\*\s*(.+)$/.exec(raw);
    if (m) {
        const title = m[1].trim();
        // 去掉 body 开头的 * 号
        let body = m[2].trim().replace(/^\*\s*/, '');
        return { title, body };
    }
    
    // 模式5: 关键词匹配（作为后备）
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
            // 尝试提取 body（移除标题部分和开头的 * 号）
            let body = raw.replace(/\*\*/g, '').replace(new RegExp(needle, 'gi'), '').replace(/^[:：\-–—\s]+/, '').trim();
            body = body.replace(/^\*\s*/, ''); // 去掉开头的 * 号
            return { title, body: body || raw.replace(/\*\*/g, '').replace(/^\*\s*/, '') };
        }
    }
    
    // 默认：使用整个文本作为 body，去掉开头的 * 号
    let body = raw.replace(/\*\*/g, '').replace(/^\*\s*/, '');
    return { title: 'Tip', body };
}

// 标准化标题（确保首字母大写，其他小写）
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
    
    // 如果不在映射中，保持原样但确保首字母大写
    return title.charAt(0).toUpperCase() + title.slice(1).toLowerCase();
}

function iconFor(title) {
    const t = (title || '').toLowerCase();
    const green = '#22c55e'; // 统一的绿色
    
    if (t.includes('silhouette')) {
        // 人物轮廓图标
        return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="${green}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-3-3.87M8 21v-2a4 4 0 0 1 3-3.87M15 7a3 3 0 1 1-6 0 3 3 0 0 1 6 0z"/></svg>`;
    }
    if (t.includes('fabric') || t.includes('material')) {
        // 堆叠的布料图标（波浪线，类似图片中的样式）
        return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="${green}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6c2 0 2 2 4 2s2-2 4-2 2 2 4 2 2-2 4-2"/><path d="M3 12c2 0 2 2 4 2s2-2 4-2 2 2 4 2 2-2 4-2"/><path d="M3 18c2 0 2 2 4 2s2-2 4-2 2 2 4 2 2-2 4-2"/></svg>`;
    }
    if (t.includes('detail')) {
        // 星形图标
        return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="${green}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>`;
    }
    if (t.includes('price')) {
        // 价格/范围图标（方形箭头）
        return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="${green}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" fill="none"/><path d="M9 9h6M9 15h6M12 3v18"/></svg>`;
    }
    if (t.includes('platform')) {
        // 地球图标
        return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="${green}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`;
    }
    
    return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="${green}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>`;
}

function truncateText(text, maxLength) {
    if (!text) return '';
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength).trim() + '...';
}

// 在新标签页打开 Google 搜索（不在当前页面跳转）
// 确保函数在全局作用域可用
function openGoogle(q) {
    if (!q) {
        Logger.warn('[openGoogle] No search query provided');
        return;
    }
    
    try {
        const searchQuery = String(q).trim();
        const searchUrl = 'https://www.google.com/search?q=' + encodeURIComponent(searchQuery);
        Logger.log('[openGoogle] Opening Google search for:', searchQuery);
        
        // 只在新标签页打开，不在当前页面跳转
        window.open(searchUrl, '_blank', 'noopener,noreferrer');
        
        // 注意：如果弹窗被阻止，我们不会在当前页面跳转
        // 用户需要允许弹窗才能使用此功能
    } catch (error) {
        Logger.error('[openGoogle] Error opening Google search:', error);
        Notification.error('Failed to open Google search. Please check if popups are blocked.');
    }
}

// 确保函数在全局作用域可用
window.openGoogle = openGoogle;

