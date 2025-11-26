// frontend/utils.js - Common utility functions

/**
 * Configuration object
 */
const CONFIG = {
    API_BASE: '',
    DEBUG: true, // Set to true for development, false for production
    RETRY_ATTEMPTS: 3,
    RETRY_DELAY: 1000
};

/**
 * Logger utility - Automatically disabled in production
 */
const Logger = {
    log: (...args) => {
        if (CONFIG.DEBUG) console.log(...args);
    },
    warn: (...args) => {
        if (CONFIG.DEBUG) console.warn(...args);
    },
    error: (...args) => {
        console.error(...args); // Errors are always logged
    }
};

/**
 * Unified API request function
 * @param {string} url - API endpoint
 * @param {Object} options - fetch options
 * @returns {Promise<Object>}
 */
async function apiRequest(url, options = {}) {
    const defaultOptions = {
        credentials: 'include',
        headers: {
            'Content-Type': 'application/json',
            ...options.headers
        }
    };

    const mergedOptions = { ...defaultOptions, ...options };

    try {
        const response = await fetch(url, mergedOptions);
        
        // 202 Accepted is a normal PENDING status
        if (!response.ok && response.status !== 202) {
            const errorText = await response.text();
            throw new Error(`Request failed: ${response.status} ${response.statusText} - ${errorText}`);
        }

        // Handle empty response
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
            return await response.json();
        }
        
        return { status: response.status, statusText: response.statusText };
    } catch (error) {
        Logger.error(`[apiRequest] Error for ${url}:`, error);
        throw error;
    }
}

/**
 * GET request
 */
async function apiGet(url) {
    return apiRequest(url, { method: 'GET' });
}

/**
 * POST request
 */
async function apiPost(url, body) {
    return apiRequest(url, {
        method: 'POST',
        body: JSON.stringify(body || {})
    });
}

/**
 * DELETE request
 */
async function apiDelete(url) {
    return apiRequest(url, { method: 'DELETE' });
}

/**
 * Request with retry
 */
async function apiRequestWithRetry(url, options = {}, retries = CONFIG.RETRY_ATTEMPTS) {
    for (let i = 0; i < retries; i++) {
        try {
            return await apiRequest(url, options);
        } catch (error) {
            if (i === retries - 1) throw error;
            Logger.warn(`[apiRequestWithRetry] Attempt ${i + 1} failed, retrying...`);
            await new Promise(resolve => setTimeout(resolve, CONFIG.RETRY_DELAY * (i + 1)));
        }
    }
}

/**
 * DOM utility functions
 */
const DOM = {
    /**
     * Safely get element
     */
    getElement: (id) => {
        const el = document.getElementById(id);
        if (!el) {
            Logger.warn(`[DOM] Element not found: ${id}`);
        }
        return el;
    },

    /**
     * Get multiple elements
     */
    getElements: (...ids) => {
        return ids.map(id => DOM.getElement(id));
    },

    /**
     * Show/hide element
     */
    toggle: (element, show) => {
        if (element) {
            element.style.display = show ? 'block' : 'none';
        }
    },

    /**
     * Set display state for multiple elements
     */
    toggleMultiple: (elements, show) => {
        elements.forEach(el => DOM.toggle(el, show));
    }
};

/**
 * Error handling utilities
 */
const ErrorHandler = {
    /**
     * Show user-friendly error message
     */
    showError: (message, containerId = 'resultContainer') => {
        const container = DOM.getElement(containerId);
        if (container) {
            container.innerHTML = `
                <div class="error text-center p-4">
                    <i class="bi bi-exclamation-triangle fs-1 text-danger d-block mb-3"></i>
                    <h4>Error</h4>
                    <p class="text-muted">${message}</p>
                    <a href="dashboard.html" class="btn btn-primary mt-3">Go back to dashboard</a>
                </div>
            `;
        }
    },

    /**
     * Handle API errors
     */
    handleApiError: (error, context = '') => {
        Logger.error(`[ErrorHandler] ${context}:`, error);
        
        let userMessage = 'An error occurred. Please try again.';
        
        if (error.message.includes('401') || error.message.includes('Not authenticated')) {
            userMessage = 'Please sign in to continue.';
            setTimeout(() => {
                window.location.href = '/signin.html';
            }, 2000);
        } else if (error.message.includes('404')) {
            userMessage = 'The requested resource was not found.';
        } else if (error.message.includes('500')) {
            userMessage = 'Server error. Please try again later.';
        }

        return userMessage;
    }
};

/**
 * Notification utilities
 */
const Notification = {
    /**
     * Show notification
     */
    show: (message, type = 'info', duration = 3000) => {
        const notification = document.createElement('div');
        const alertClass = type === 'error' ? 'danger' : type === 'success' ? 'success' : 'info';
        
        notification.className = `alert alert-${alertClass} alert-dismissible fade show position-fixed`;
        notification.style.cssText = 'top: 20px; right: 20px; z-index: 9999; min-width: 300px; box-shadow: var(--shadow-lg);';
        notification.innerHTML = `
            ${message}
            <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
        `;
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.remove();
        }, duration);
    },

    success: (message) => Notification.show(message, 'success'),
    error: (message) => Notification.show(message, 'error'),
    info: (message) => Notification.show(message, 'info')
};

/**
 * URL utilities
 */
const URLUtils = {
    /**
     * Get URL parameter
     */
    getParam: (name) => {
        const params = new URLSearchParams(window.location.search);
        return params.get(name);
    },

    /**
     * Remove URL parameter
     */
    removeParam: (name) => {
        const params = new URLSearchParams(window.location.search);
        params.delete(name);
        const newUrl = window.location.pathname + (params.toString() ? '?' + params.toString() : '');
        window.history.replaceState({}, document.title, newUrl);
    }
};

/**
 * Debounce function
 */
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

/**
 * Throttle function
 */
function throttle(func, limit) {
    let inThrottle;
    return function(...args) {
        if (!inThrottle) {
            func.apply(this, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
}

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        Logger,
        apiGet,
        apiPost,
        apiDelete,
        apiRequest,
        apiRequestWithRetry,
        DOM,
        ErrorHandler,
        Notification,
        URLUtils,
        debounce,
        throttle,
        CONFIG
    };
}

