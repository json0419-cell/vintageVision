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
}

// Global auth API instance
window.authAPI = new AuthAPI();



