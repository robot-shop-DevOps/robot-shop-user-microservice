// tests/app.test.js
const request = require('supertest');
const UserServiceApp = require('../src/app');

// Mock Mongo collections
const mockCollections = {
  users: {
    findOne: jest.fn(async ({ name }) => (name === 'existing' ? { name, password: '123', email: 'e@test.com' } : null)),
    insertOne: jest.fn(async () => ({ acknowledged: true })),
    find: jest.fn(() => ({ toArray: jest.fn().mockResolvedValue([{ name: 'existing', password: '123' }]) })),
  },
  orders: {
    findOne: jest.fn(async ({ name }) => (name === 'existing' ? { name, history: [] } : null)),
    insertOne: jest.fn(async () => ({ acknowledged: true })),
    updateOne: jest.fn(async () => ({ acknowledged: true })),
  },
};

// Initialize app with mocks and skip Mongo loop and Redis connection
const redisClient = {
  incr: (key, cb) => cb(null, 42) // pretend the counter is 42
};
const appInstance = new UserServiceApp({ redisClient: redisClient, mockCollections: mockCollections, skipMongoLoop: true });
const app = appInstance.getApp();

describe('Functional tests', () => {

  test('GET /health should return status 200 and app status', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('app', 'OK');
    expect(res.body).toHaveProperty('mongo', true); // mocked as connected
  });

  test('GET /uniqueid should return a unique anonymous id', async () => {
    // Mock Redis INCR
    appInstance.redisClient.incr = jest.fn((key, cb) => cb(null, 42));

    const res = await request(app).get('/uniqueid');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('uuid', 'anonymous-42');
  });

  test('GET /check/:id returns 200 for existing user', async () => {
    const res = await request(app).get('/check/existing');
    expect(res.status).toBe(200);
    expect(res.text).toBe('OK');
  });

  test('GET /check/:id returns 404 for non-existent user', async () => {
    const res = await request(app).get('/check/nonexistent');
    expect(res.status).toBe(404);
    expect(res.text).toBe('user not found');
  });

  test('POST /register creates a new user', async () => {
    const res = await request(app)
      .post('/register')
      .send({ name: 'newuser', password: 'pass', email: 'new@test.com' });
    expect(res.status).toBe(200);
    expect(res.text).toBe('OK');
    expect(appInstance.usersCollection.insertOne).toHaveBeenCalled();
  });

  test('POST /login returns user object for correct credentials', async () => {
    const res = await request(app)
      .post('/login')
      .send({ name: 'existing', password: '123' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('name', 'existing');
  });

  test('POST /login fails for wrong password', async () => {
    const res = await request(app)
      .post('/login')
      .send({ name: 'existing', password: 'wrong' });
    expect(res.status).toBe(404);
    expect(res.text).toBe('incorrect password');
  });

  test('POST /order/:id creates a new order', async () => {
    const res = await request(app)
      .post('/order/existing')
      .send({ item: 'item1', qty: 2 });
    expect(res.status).toBe(200);
    expect(res.text).toBe('OK');
    expect(appInstance.ordersCollection.updateOne).toHaveBeenCalled();
  });

  test('GET /history/:id returns order history', async () => {
    const res = await request(app).get('/history/existing');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('name', 'existing');
    expect(res.body).toHaveProperty('history');
  });
});