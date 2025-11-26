# Google Photos Login Setup Guide

## Overview
VintageVision now supports login via Google Photos, allowing users to quickly log in with their Google account and access their photo library.

## Setup Steps

### 1. Create Google Cloud Project
1. Visit [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing project
3. Enable the following APIs:
   - Google+ API
   - Google Photos Library API

### 2. Configure OAuth 2.0 Client
1. In Google Cloud Console, go to "APIs & Services" > "Credentials"
2. Click "Create Credentials" > "OAuth 2.0 Client IDs"
3. Select "Web application"
4. Add authorized redirect URIs:
   - Development: `http://localhost:3000/api/auth/google/callback`
   - Production: `https://yourdomain.com/api/auth/google/callback`

### 3. Environment Variables Configuration
Add the following configuration in the `backend/config.env.example` file:

```env
# Google OAuth Configuration
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
GOOGLE_REDIRECT_URI=http://localhost:3000/api/auth/google/callback
```

### 4. Install Dependencies
Run in the backend directory:
```bash
npm install googleapis passport passport-google-oauth20
```

## Features

### User Permissions
- **Basic Profile Access**: Get user's name, email, and avatar
- **Google Photos Access**: Read user's photo library (read-only permission)

### Login Flow
1. User clicks "Sign in with Google Photos" button
2. Google OAuth authorization window pops up
3. After user authorizes, system automatically creates or updates user account
4. User is redirected to dashboard page

### Security Features
- JWT token authentication
- Secure OAuth 2.0 flow
- Encrypted user data storage
- Support for existing user account association

## Technical Implementation

### Backend API Endpoints
- `GET /api/auth/google` - Get Google OAuth authorization URL
- `GET /api/auth/google/callback` - OAuth callback redirect
- `POST /api/auth/google/callback` - Process authorization code and create user session

### Frontend Components
- Google login button integration
- Popup OAuth flow
- Automatic user session management

## Troubleshooting

### Common Issues
1. **"Invalid client" error**: Check if GOOGLE_CLIENT_ID is correct
2. **"Redirect URI mismatch" error**: Ensure redirect URI is correctly configured in Google Console
3. **"Access denied" error**: User rejected the authorization request

### Debugging Tips
- Check browser console error messages
- Verify environment variables are correctly set
- Confirm APIs are enabled in Google Cloud project

## Production Deployment
1. Update redirect URI to production domain
2. Set correct environment variables
3. Ensure HTTPS is properly configured
4. Test complete OAuth flow
