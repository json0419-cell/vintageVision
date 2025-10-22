const request = require('supertest');
const app = require('./server');

describe('VintageVision API Tests', () => {
  let authToken;
  let userId;

  describe('Health Check', () => {
    test('GET /api/health should return 200', async () => {
      const response = await request(app)
        .get('/api/health')
        .expect(200);
      
      expect(response.body.status).toBe('OK');
      expect(response.body.timestamp).toBeDefined();
    });
  });

  describe('Authentication', () => {
    test('POST /api/auth/register should create new user', async () => {
      const userData = {
        name: 'Test User',
        email: 'test@example.com',
        password: 'password123'
      };

      const response = await request(app)
        .post('/api/auth/register')
        .send(userData)
        .expect(201);

      expect(response.body.token).toBeDefined();
      expect(response.body.user.email).toBe(userData.email);
      
      authToken = response.body.token;
      userId = response.body.user.id;
    });

    test('POST /api/auth/login should authenticate user', async () => {
      const credentials = {
        email: 'test@example.com',
        password: 'password123'
      };

      const response = await request(app)
        .post('/api/auth/login')
        .send(credentials)
        .expect(200);

      expect(response.body.token).toBeDefined();
      expect(response.body.user.email).toBe(credentials.email);
    });

    test('GET /api/auth/verify should verify token', async () => {
      const response = await request(app)
        .get('/api/auth/verify')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.valid).toBe(true);
      expect(response.body.user.email).toBe('test@example.com');
    });
  });

  describe('Dashboard', () => {
    test('GET /api/dashboard/stats should return user statistics', async () => {
      const response = await request(app)
        .get('/api/dashboard/stats')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.totalAnalyses).toBeDefined();
      expect(response.body.recentAnalyses).toBeDefined();
    });

    test('GET /api/dashboard/profile should return style profile', async () => {
      const response = await request(app)
        .get('/api/dashboard/profile')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.favoriteEras).toBeDefined();
      expect(response.body.colorPreferences).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    test('POST /api/auth/login with invalid credentials should return 401', async () => {
      const credentials = {
        email: 'test@example.com',
        password: 'wrongpassword'
      };

      await request(app)
        .post('/api/auth/login')
        .send(credentials)
        .expect(401);
    });

    test('GET /api/dashboard/stats without token should return 401', async () => {
      await request(app)
        .get('/api/dashboard/stats')
        .expect(401);
    });
  });
});



