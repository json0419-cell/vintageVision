// backend/utils/firestore.js
// Ensure environment variables are loaded
require('../config/env')();

const { Firestore, FieldValue } = require('@google-cloud/firestore');
const path = require('path');

const firestore = new Firestore({
    projectId: process.env.GOOGLE_CLOUD_PROJECT_ID,
    keyFilename: path.join(__dirname, '..', 'config', 'google-credentials.json'),
    databaseId: 'vintagevision',
});

module.exports = {
    firestore,
    FieldValue,
};
