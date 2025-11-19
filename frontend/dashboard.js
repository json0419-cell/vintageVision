// Dashboard functionality
class Dashboard {
    constructor() {
        this.apiBase = '/api';
        this.authToken = localStorage.getItem('authToken');
        this.user = null;
        this.init();
    }

    async init() {
        if (!this.authToken) {
            window.location.href = '/signin.html';
            return;
        }

        try {
            await this.loadUserProfile();
            await this.loadDashboardData();
            this.setupEventListeners();
        } catch (error) {
            console.error('Dashboard initialization failed:', error);
            this.handleAuthError();
        }
    }

    async loadUserProfile() {
        try {
            const response = await fetch(`${this.apiBase}/auth/profile`, {
                headers: {
                    'Authorization': `Bearer ${this.authToken}`,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                throw new Error('Failed to load user profile');
            }

            this.user = await response.json();
            document.getElementById('userName').textContent = this.user.name;
        } catch (error) {
            console.error('Profile load error:', error);
            throw error;
        }
    }

    async loadDashboardData() {
        try {
            const [statsResponse, profileResponse] = await Promise.all([
                fetch(`${this.apiBase}/dashboard/stats`, {
                    headers: {
                        'Authorization': `Bearer ${this.authToken}`,
                        'Content-Type': 'application/json'
                    }
                }),
                fetch(`${this.apiBase}/dashboard/profile`, {
                    headers: {
                        'Authorization': `Bearer ${this.authToken}`,
                        'Content-Type': 'application/json'
                    }
                })
            ]);

            if (statsResponse.ok) {
                const stats = await statsResponse.json();
                this.updateStatsCards(stats);
                this.updateRecentAnalyses(stats.recentAnalyses);
            }

            if (profileResponse.ok) {
                const profile = await profileResponse.json();
                this.updateStyleProfile(profile);
            }
        } catch (error) {
            console.error('Dashboard data load error:', error);
        }
    }

    updateStatsCards(stats) {
        document.getElementById('totalAnalyses').textContent = stats.totalAnalyses;
        
        // Calculate average confidence
        const avgConfidence = stats.recentAnalyses.length > 0 
            ? Math.round(stats.recentAnalyses.reduce((sum, analysis) => sum + analysis.confidence, 0) / stats.recentAnalyses.length)
            : 0;
        document.getElementById('avgConfidence').textContent = avgConfidence;

        // Format dates
        if (stats.memberSince) {
            document.getElementById('memberSince').textContent = new Date(stats.memberSince.seconds * 1000).toLocaleDateString();
        }
        if (stats.lastLogin) {
            document.getElementById('lastLogin').textContent = new Date(stats.lastLogin.seconds * 1000).toLocaleDateString();
        }
    }

    updateRecentAnalyses(analyses) {
        const container = document.getElementById('recentAnalyses');
        
        if (analyses.length === 0) {
            container.innerHTML = `
                <div class="text-center text-muted">
                    <i class="bi bi-hourglass-split fs-1"></i>
                    <p>No analyses yet. Upload your first image to get started!</p>
                </div>
            `;
            return;
        }

        container.innerHTML = analyses.map(analysis => `
            <div class="analysis-item">
                <div class="d-flex justify-content-between align-items-start">
                    <div>
                        <h6 class="mb-1">${analysis.fileName}</h6>
                        <span class="era-badge">${analysis.era}</span>
                        <small class="text-muted d-block">${new Date(analysis.uploadedAt.seconds * 1000).toLocaleDateString()}</small>
                    </div>
                    <div class="text-end">
                        <div class="confidence-bar" style="width: 60px;">
                            <div class="confidence-fill" style="width: ${analysis.confidence * 10}%"></div>
                        </div>
                        <small class="text-muted">${analysis.confidence}/10</small>
                    </div>
                </div>
            </div>
        `).join('');
    }

    updateStyleProfile(profile) {
        // Update favorite eras
        const erasContainer = document.getElementById('favoriteEras');
        if (profile.favoriteEras.length > 0) {
            erasContainer.innerHTML = profile.favoriteEras.map(era => `
                <div class="d-flex justify-content-between mb-1">
                    <span>${era.era}</span>
                    <span class="badge bg-primary">${era.count}</span>
                </div>
            `).join('');
        }

        // Update color preferences
        const colorsContainer = document.getElementById('colorPreferences');
        if (profile.colorPreferences.length > 0) {
            colorsContainer.innerHTML = profile.colorPreferences.map(color => `
                <div class="d-flex justify-content-between mb-1">
                    <span class="text-capitalize">${color.color}</span>
                    <span class="badge bg-secondary">${color.count}</span>
                </div>
            `).join('');
        }
    }

    setupEventListeners() {
        const uploadArea = document.getElementById('uploadArea');
        const fileInput = document.getElementById('imageUpload');

        // Drag and drop functionality
        uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadArea.classList.add('dragover');
        });

        uploadArea.addEventListener('dragleave', () => {
            uploadArea.classList.remove('dragover');
        });

        uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadArea.classList.remove('dragover');
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                this.handleFileUpload(files[0]);
            }
        });

        // File input change
        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                this.handleFileUpload(e.target.files[0]);
            }
        });

        // Click to upload
        uploadArea.addEventListener('click', () => {
            fileInput.click();
        });
    }

    async handleFileUpload(file) {
        if (!file.type.startsWith('image/')) {
            alert('Please select an image file');
            return;
        }

        const formData = new FormData();
        formData.append('image', file);

        // Show progress
        document.getElementById('uploadProgress').classList.remove('d-none');
        const progressBar = document.querySelector('.progress-bar');

        try {
            const response = await fetch(`${this.apiBase}/upload/analyze`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.authToken}`
                },
                body: formData
            });

            if (!response.ok) {
                throw new Error('Upload failed');
            }

            const result = await response.json();
            this.displayAnalysisResult(result);
            
            // Reload dashboard data
            await this.loadDashboardData();
            
        } catch (error) {
            console.error('Upload error:', error);
            alert('Upload failed. Please try again.');
        } finally {
            document.getElementById('uploadProgress').classList.add('d-none');
            progressBar.style.width = '0%';
        }
    }

    displayAnalysisResult(result) {
        const resultsDiv = document.getElementById('analysisResults');
        resultsDiv.style.display = 'block';

        // Update image
        document.getElementById('analyzedImage').src = result.imageUrl;

        // Update analysis data
        document.getElementById('styleEra').textContent = result.analysis.era || 'Unknown';
        
        const confidence = result.analysis.confidence || 0;
        document.getElementById('confidenceBar').style.width = `${confidence * 10}%`;
        document.getElementById('confidenceText').textContent = `${confidence}/10`;
        
        document.getElementById('keyElements').textContent = result.analysis.elements || 'No elements detected';
        document.getElementById('recommendations').textContent = result.analysis.recommendations || 'No recommendations available';

        // Scroll to results
        resultsDiv.scrollIntoView({ behavior: 'smooth' });
    }

    handleAuthError() {
        localStorage.removeItem('authToken');
        window.location.href = '/signin.html';
    }
}

// Logout function
function logout() {
    localStorage.removeItem('authToken');
    window.location.href = '/index.html';
}

// Initialize dashboard when page loads
document.addEventListener('DOMContentLoaded', () => {
    new Dashboard();
});




