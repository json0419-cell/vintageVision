// Ensure environment variables are loaded (in case this file is required independently)
require('../config/env')();

const express = require('express');
const multer = require('multer');
const { Storage } = require('@google-cloud/storage');
const vision = require('@google-cloud/vision');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { Firestore } = require('@google-cloud/firestore');
const authenticateToken = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();
const storage = new Storage();
const visionClient = new vision.ImageAnnotatorClient();
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const db = new Firestore();

// Configure multer for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE) || 10 * 1024 * 1024, // 10MB
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = (process.env.ALLOWED_FILE_TYPES || 'image/jpeg,image/png,image/webp').split(',');
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only images are allowed.'), false);
    }
  },
});

// Upload image and analyze with Google Cloud Vision + Gemini
router.post('/analyze', authenticateToken, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided' });
    }

    const { buffer, originalname, mimetype } = req.file;
    const userId = req.user.id;

    logger.info(`Starting analysis for user ${userId}, file: ${originalname}`);

    // Upload to Google Cloud Storage
    const bucketName = `${process.env.GOOGLE_CLOUD_PROJECT_ID}-vintage-vision-images`;
    const fileName = `uploads/${userId}/${Date.now()}-${originalname}`;
    
    const bucket = storage.bucket(bucketName);
    const file = bucket.file(fileName);
    
    await file.save(buffer, {
      metadata: {
        contentType: mimetype,
        metadata: {
          userId,
          uploadedAt: new Date().toISOString(),
        },
      },
    });

    // Make file public for Vision API
    await file.makePublic();

    // Analyze with Google Cloud Vision API
    const imageUri = `gs://${bucketName}/${fileName}`;
    const [visionResult] = await visionClient.annotateImage({
      image: { source: { imageUri } },
      features: [
        { type: 'LABEL_DETECTION', maxResults: 10 },
        { type: 'OBJECT_LOCALIZATION', maxResults: 10 },
        { type: 'TEXT_DETECTION', maxResults: 5 },
        { type: 'WEB_DETECTION', maxResults: 5 },
      ],
    });

    // Extract fashion-related information
    const labels = visionResult.labelAnnotations || [];
    const objects = visionResult.localizedObjectAnnotations || [];
    const webEntities = visionResult.webDetection?.webEntities || [];

    // Prepare context for Gemini
    const fashionLabels = labels
      .filter(label => 
        label.description.toLowerCase().includes('clothing') ||
        label.description.toLowerCase().includes('fashion') ||
        label.description.toLowerCase().includes('dress') ||
        label.description.toLowerCase().includes('shirt') ||
        label.description.toLowerCase().includes('jacket') ||
        label.description.toLowerCase().includes('pants') ||
        label.description.toLowerCase().includes('shoes')
      )
      .map(label => `${label.description} (${Math.round(label.score * 100)}%)`)
      .join(', ');

    const fashionObjects = objects
      .filter(obj => 
        obj.name.toLowerCase().includes('clothing') ||
        obj.name.toLowerCase().includes('person')
      )
      .map(obj => `${obj.name} (${Math.round(obj.score * 100)}%)`)
      .join(', ');

    // Use Gemini AI for enhanced analysis
    const model = genAI.getGenerativeModel({ model: 'gemini-pro' });
    
    const prompt = `
    Analyze this fashion image and provide a detailed style analysis. Based on the detected elements:
    
    Detected Labels: ${fashionLabels}
    Detected Objects: ${fashionObjects}
    
    Please provide:
    1. Primary style era (e.g., 1970s Bohemian, 1990s Grunge, Modern Minimalist)
    2. Key fashion elements identified
    3. Color palette analysis
    4. Style recommendations for modern equivalents
    5. Confidence level (1-10)
    
    Format your response as JSON with these fields: era, elements, colors, recommendations, confidence
    `;

    const geminiResult = await model.generateContent(prompt);
    const geminiResponse = geminiResult.response.text();

    // Parse Gemini response
    let aiAnalysis;
    try {
      aiAnalysis = JSON.parse(geminiResponse);
    } catch (parseError) {
      logger.warn('Failed to parse Gemini response as JSON, using fallback');
      aiAnalysis = {
        era: 'Modern Contemporary',
        elements: fashionLabels,
        colors: 'Various',
        recommendations: 'Consider consulting a fashion expert',
        confidence: 5,
      };
    }

    // Store analysis result in Firestore
    const analysisData = {
      userId,
      imageUrl: `https://storage.googleapis.com/${bucketName}/${fileName}`,
      fileName: originalname,
      uploadedAt: new Date(),
      visionAnalysis: {
        labels: labels.map(l => ({ description: l.description, score: l.score })),
        objects: objects.map(o => ({ name: o.name, score: o.score })),
        webEntities: webEntities.map(w => ({ description: w.description, score: w.score })),
      },
      aiAnalysis,
      status: 'completed',
    };

    const analysisRef = await db.collection('analyses').add(analysisData);

    // Update user's analysis count
    await db.collection('users').doc(userId).update({
      analysisCount: req.user.analysisCount + 1,
    });

    logger.info(`Analysis completed for user ${userId}, analysis ID: ${analysisRef.id}`);

    res.json({
      success: true,
      analysisId: analysisRef.id,
      imageUrl: analysisData.imageUrl,
      analysis: aiAnalysis,
      visionData: {
        labels: labels.slice(0, 5),
        objects: objects.slice(0, 3),
      },
    });

  } catch (error) {
    logger.error('Analysis error:', error);
    res.status(500).json({ 
      error: 'Analysis failed', 
      message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong during analysis'
    });
  }
});

// Get user's analysis history
router.get('/history', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const limit = parseInt(req.query.limit) || 10;
    const offset = parseInt(req.query.offset) || 0;

    const analysesQuery = await db.collection('analyses')
      .where('userId', '==', userId)
      .orderBy('uploadedAt', 'desc')
      .limit(limit)
      .offset(offset)
      .get();

    const analyses = analysesQuery.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
    }));

    res.json({
      analyses,
      total: analyses.length,
      hasMore: analyses.length === limit,
    });
  } catch (error) {
    logger.error('History fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch analysis history' });
  }
});

// Get specific analysis
router.get('/:analysisId', authenticateToken, async (req, res) => {
  try {
    const { analysisId } = req.params;
    const userId = req.user.id;

    const analysisDoc = await db.collection('analyses').doc(analysisId).get();
    
    if (!analysisDoc.exists) {
      return res.status(404).json({ error: 'Analysis not found' });
    }

    const analysisData = analysisDoc.data();
    
    if (analysisData.userId !== userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    res.json({
      id: analysisDoc.id,
      ...analysisData,
    });
  } catch (error) {
    logger.error('Analysis fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch analysis' });
  }
});

module.exports = router;





