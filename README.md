# VintageVision - Enterprise AI Fashion Analysis Platform

## 🎯 Project Overview

VintageVision is an enterprise-grade Single Page Application (SPA) that uses Google Cloud's Computer Vision API and Gemini AI to analyze fashion images and provide style recommendations. The platform allows users to upload photos and receive detailed analysis of their fashion style, including era identification, color analysis, and modern style recommendations.

## 🏗️ Architecture

### Frontend
- **Technology**: HTML5, CSS3, JavaScript (ES6+), Bootstrap 5.3.2
- **Features**: Responsive design, drag-and-drop upload, real-time analysis results
- **Authentication**: JWT-based authentication with localStorage
- **Pages**: Home, About, Contact, Sign In, Dashboard

### Backend
- **Technology**: Node.js, Express.js
- **Authentication**: JWT tokens with bcrypt password hashing
- **Security**: Helmet.js, CORS, rate limiting, input validation
- **Logging**: Winston logger with structured logging
- **File Upload**: Multer with memory storage

### Google Cloud Integration
- **Vision API**: Image analysis and object detection
- **Gemini AI**: Enhanced fashion analysis and recommendations
- **Firestore**: User data and analysis history storage
- **Cloud Storage**: Image file storage
- **Cloud Run/GAE**: Application hosting

## 🚀 Features

### Core Functionality
- ✅ User registration and authentication
- ✅ Image upload with drag-and-drop support
- ✅ AI-powered fashion analysis using Google Vision + Gemini
- ✅ Style era identification (e.g., 1970s Bohemian, 1990s Grunge)
- ✅ Color palette analysis
- ✅ Modern style recommendations
- ✅ Analysis history and user dashboard
- ✅ Style profile generation

### Enterprise Features
- ✅ Secure authentication with JWT
- ✅ Rate limiting and security headers
- ✅ Structured logging and error handling
- ✅ Input validation and sanitization
- ✅ Responsive design for all devices
- ✅ Docker containerization
- ✅ Google Cloud deployment ready

## 📁 Project Structure

```
vintageVision/
├── frontend/                # Frontend files directory
│   ├── *.html              # Frontend pages (index.html, signin.html, dashboard.html, etc.)
│   ├── *.js                # Frontend JavaScript (script.js, auth.js, dashboard.js)
│   ├── style.css           # Stylesheet
│   └── images/             # Static image resources
├── backend/                # Backend files directory
│   ├── routes/
│   │   ├── auth.js          # Authentication endpoints
│   │   ├── upload.js        # Image upload and analysis
│   │   └── dashboard.js     # Dashboard data endpoints
│   ├── middleware/
│   │   └── auth.js          # Authentication middleware
│   ├── utils/
│   │   └── logger.js        # Winston logging configuration
│   ├── tests/
│   │   └── api.test.js      # API tests
│   ├── server.js            # Express server setup
│   ├── package.json         # Dependencies and scripts
│   └── config.env.example   # Environment variables template
├── Dockerfile              # Docker configuration
├── app.yaml                # Google App Engine config
├── cloud-run.yaml          # Google Cloud Run config
├── deploy.sh               # Deployment script
└── README.md               # Project documentation
```

## 🛠️ Setup Instructions

### Prerequisites
- Node.js 18+
- Google Cloud Platform account
- Docker (for containerized deployment)

### Local Development

1. **Install dependencies**:
   ```bash
   cd backend
   npm install
   ```

2. **Set up environment variables**:
   ```bash
   # In the backend directory
   cp config.env.example .env
   # Edit the .env file and fill in your configuration
   ```

3. **Google Cloud setup** (Optional, for production):
   - Enable Vision API, Firestore, and Cloud Storage
   - Create a service account and download the credentials file as `google-credentials.json`
   - Get Gemini API Key from Google AI Studio

4. **Start the development server**:
   ```bash
   # In the backend directory
   npm run dev
   ```
   
   After the server starts, visit `http://localhost:3000` to use the application.

5. **Start the production server**:
   ```bash
   # In the backend directory
   npm start
   ```

### Google Cloud Deployment

1. **Using Cloud Run** (Recommended):
   ```bash
   chmod +x deploy.sh
   ./deploy.sh
   ```

2. **Using App Engine**:
   ```bash
   gcloud app deploy
   ```

## 🔧 Configuration

### Environment Variables
```env
NODE_ENV=production
PORT=8080
JWT_SECRET=your-super-secret-jwt-key
GOOGLE_CLOUD_PROJECT_ID=your-project-id
GOOGLE_CLOUD_REGION=us-central1
GEMINI_API_KEY=your-gemini-api-key
GOOGLE_APPLICATION_CREDENTIALS=./config/google-credentials.json
```

### Google Cloud Services Required
- **Vision API**: For image analysis
- **Firestore**: For user data and analysis storage
- **Cloud Storage**: For image file storage
- **Cloud Run/App Engine**: For application hosting

## 📊 API Endpoints

### Authentication
- `POST /api/auth/register` - User registration
- `POST /api/auth/login` - User login
- `GET /api/auth/verify` - Token verification
- `GET /api/auth/profile` - User profile

### Image Analysis
- `POST /api/upload/analyze` - Upload and analyze image
- `GET /api/upload/history` - Get analysis history
- `GET /api/upload/:id` - Get specific analysis

### Dashboard
- `GET /api/dashboard/stats` - Dashboard statistics
- `GET /api/dashboard/profile` - Style profile
- `GET /api/dashboard/activity` - Recent activity

## 🔒 Security Features

- JWT-based authentication
- Password hashing with bcrypt
- Rate limiting (100 requests per 15 minutes)
- CORS configuration
- Security headers with Helmet.js
- Input validation and sanitization
- File type and size restrictions

## 🎨 User Experience

1. **Home Page**: Introduction and "Try It Now" button
2. **Authentication**: Sign in/register with modern UI
3. **Dashboard**: Upload images, view analysis results, track history
4. **Analysis Results**: Detailed style analysis with confidence scores
5. **Style Profile**: Personal fashion preferences and trends

## 🚀 Deployment Options

### Google Cloud Run (Recommended)
- Serverless, auto-scaling
- Pay-per-request pricing
- Easy CI/CD integration

### Google App Engine
- Managed platform
- Automatic scaling
- Integrated with other GCP services

## 📈 Monitoring and Logging

- Winston structured logging
- Health check endpoint (`/api/health`)
- Error tracking and reporting
- Performance monitoring ready

## 🔮 Future Enhancements

- Social media integration (Pinterest, Google Photos)
- Advanced style recommendations
- Community features
- Mobile app development
- Real-time collaboration
- Advanced analytics dashboard

## 📞 Support

For technical support or questions about this enterprise implementation, please refer to the contact page or create an issue in the project repository.

---

**Built with ❤️ using Google Cloud Platform, Express.js, and modern web technologies.**




