# 🚀 Quick Start Guide

## Project Structure

```
vintageVision1/
├── frontend/          # Frontend files (HTML, CSS, JavaScript, images)
├── backend/           # Backend files (Node.js + Express)
├── Dockerfile         # Docker configuration
└── README.md          # Detailed documentation
```

## Quick Start Steps

### 1. Install Node.js
Make sure you have Node.js 18 or higher installed:
```bash
node --version
```

### 2. Install Backend Dependencies
```bash
cd backend
npm install
```

### 3. Configure Environment Variables (Optional)
If you need to use Google Cloud services, configure environment variables:
```bash
cd backend
cp config.env.example .env
# Then edit the .env file and fill in your configuration
```

### 4. Start the Server

**Development Mode** (auto-restart):
```bash
cd backend
npm run dev
```

**Production Mode**:
```bash
cd backend
npm start
```

### 5. Access the Application
Open your browser and visit: `http://localhost:3000`

## Default Port
- Development server runs on port **3000** by default
- You can change the port using the `PORT` environment variable

## Common Issues

### Port Already in Use
If port 3000 is already in use, you can change the port:
```bash
# Windows PowerShell
$env:PORT=8080; npm run dev

# Linux/Mac
PORT=8080 npm run dev
```

### Dependency Installation Failed
If npm install fails, try:
```bash
# Clear cache
npm cache clean --force

# Delete node_modules and reinstall
rm -rf node_modules
npm install
```

## Project Features
- ✅ User registration and login
- ✅ Image upload and analysis
- ✅ AI-powered fashion style analysis
- ✅ Personal dashboard

For more detailed information, please refer to [README.md](README.md)
