// backend/config/env.js
// Centralized environment variable loader
// This ensures all environment variables are loaded from backend/.env
const path = require('path');
const dotenv = require('dotenv');

// Load environment variables from backend/.env
const envPath = path.join(__dirname, '..', '.env');

// Track if env has been loaded to avoid loading multiple times
let envLoaded = false;
let loadResult = null;

function loadEnv() {
    if (envLoaded) {
        return loadResult;
    }
    
    loadResult = dotenv.config({ path: envPath });
    envLoaded = true;
    
    if (loadResult.error) {
        // If .env file doesn't exist, log warning but don't crash
        // This allows the app to run with environment variables set via other means (e.g., system env, cloud config)
        console.warn(`[env.js] Warning: Could not load .env file from ${envPath}`);
        console.warn(`[env.js] Error: ${loadResult.error.message}`);
        console.warn('[env.js] Continuing with system environment variables...');
    } else {
        console.log(`[env.js] Successfully loaded environment variables from ${envPath}`);
    }
    
    return loadResult;
}

// Load immediately when this module is required
loadEnv();

// Export a function to ensure env is loaded (useful for modules that might be loaded before this)
module.exports = function ensureEnvLoaded() {
    return loadEnv();
};

// Also export commonly used env vars for convenience
module.exports.env = {
    NODE_ENV: process.env.NODE_ENV || 'development',
    PORT: process.env.PORT || 3000,
    FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:3000',
    
    // Google Cloud
    GOOGLE_CLOUD_PROJECT_ID: process.env.GOOGLE_CLOUD_PROJECT_ID,
    GOOGLE_APPLICATION_CREDENTIALS: process.env.GOOGLE_APPLICATION_CREDENTIALS,
    
    // Gemini
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    GEMINI_MODEL: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    
    // Google OAuth
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI: process.env.GOOGLE_REDIRECT_URI,
    
    // JWT (optional)
    JWT_SECRET: process.env.JWT_SECRET,
    JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '24h',
    
    // Logging
    LOG_LEVEL: process.env.LOG_LEVEL || 'info',
    
    // File Upload
    MAX_FILE_SIZE: process.env.MAX_FILE_SIZE || '10485760',
    ALLOWED_FILE_TYPES: process.env.ALLOWED_FILE_TYPES || 'image/jpeg,image/png,image/webp',
};

