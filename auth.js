// Authentication API calls
class AuthAPI {
    constructor() {
        this.apiBase = '/api';
    }

    async register(userData) {
        try {
            const response = await fetch(`${this.apiBase}/auth/register`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(userData),
            });

            const result = await response.json();
            
            if (!response.ok) {
                throw new Error(result.error || 'Registration failed');
            }

            return result;
        } catch (error) {
            console.error('Registration error:', error);
            throw error;
        }
    }

    async login(credentials) {
        try {
            const response = await fetch(`${this.apiBase}/auth/login`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(credentials),
            });

            const result = await response.json();
            
            if (!response.ok) {
                throw new Error(result.error || 'Login failed');
            }

            return result;
        } catch (error) {
            console.error('Login error:', error);
            throw error;
        }
    }

    async verifyToken(token) {
        try {
            const response = await fetch(`${this.apiBase}/auth/verify`, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
            });

            const result = await response.json();
            
            if (!response.ok) {
                throw new Error(result.error || 'Token verification failed');
            }

            return result;
        } catch (error) {
            console.error('Token verification error:', error);
            throw error;
        }
    }

    async getGoogleAuthUrl() {
        try {
            // googleAuthRouter is mounted at /auth path
            // /auth/google endpoint will directly redirect to Google OAuth
            // For popup window, just return this URL
            return '/auth/google';
        } catch (error) {
            console.error('Google auth URL error:', error);
            throw error;
        }
    }

    async handleGoogleCallback(code) {
        try {
            const response = await fetch(`${this.apiBase}/auth/google/callback`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ code }),
            });

            const result = await response.json();
            
            if (!response.ok) {
                throw new Error(result.error || 'Google authentication failed');
            }

            return result;
        } catch (error) {
            console.error('Google callback error:', error);
            throw error;
        }
    }
}

// Global auth API instance
window.authAPI = new AuthAPI();




