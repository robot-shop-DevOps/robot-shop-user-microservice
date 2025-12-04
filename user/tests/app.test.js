// tests/app.test.js
const request = require('supertest');
const UserServiceApp = require('../src/app');

// ----- MOCK JWT -----
jest.mock('jsonwebtoken', () => ({
  verify: jest.fn(() => ({ name: 'existing', email: 'e@test.com' })),

  // Add this mock:
  sign: jest.fn(() => "mocked.jwt.token")
}));

// ----- MOCK MONGO COLLECTIONS -----
const mockCollections = {
  users: {
    findOne: jest.fn(async ({ name }) =>
      name === 'existing'
        ? { name, password: '123', email: 'e@test.com' }
        : null
    ),
    insertOne: jest.fn(async () => ({ acknowledged: true })),
    find: jest.fn(() => ({
      toArray: jest.fn().mockResolvedValue([
        { name: 'existing', password: '123', email: 'e@test.com' },
      ]),
    })),
  },

  orders: {
    findOne: jest.fn(async ({ name }) =>
      name === 'existing'
        ? { name, history: [] }
        : null
    ),
    insertOne: jest.fn(async () => ({ acknowledged: true })),
    updateOne: jest.fn(async () => ({ acknowledged: true })),
  },
};

// ----- MOCK REDIS -----
const redisClient = {
  incr: jest.fn((key, cb) => cb(null, 42)),
};

// ----- INIT APP -----
const appInstance = new UserServiceApp({
  redisClient,
  mockCollections,
  skipMongoLoop: true,
  jwtsecret: "testsecret",
});
const app = appInstance.getApp();

describe("User Service Tests (with JWT)", () => {

  // ---------------- HEALTH ----------------
  test("GET /health should return status 200", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("app", "OK");
    expect(res.body).toHaveProperty("mongo", true);
  });

  // ---------------- LOGIN ----------------
  test("POST /login returns token for correct credentials", async () => {
    const res = await request(app)
      .post("/login")
      .send({ name: "existing", password: "123" });

    expect(res.status).toBe(200);

    // new expected structure
    expect(res.body).toHaveProperty("token");
    expect(res.body).toHaveProperty("message", "Login successful");
  });

  test("POST /login fails on wrong password", async () => {
    const res = await request(app)
      .post("/login")
      .send({ name: "existing", password: "wrong" });

    expect(res.status).toBe(404);
    expect(res.text).toBe("incorrect password");
  });

  // ---------------- REGISTER ----------------
  test("POST /register creates a new user", async () => {
    const res = await request(app)
      .post("/register")
      .send({ name: "newuser", password: "pass", email: "new@test.com" });

    expect(res.status).toBe(200);
    expect(res.text).toBe("OK");
    expect(appInstance.usersCollection.insertOne).toHaveBeenCalled();
  });

  // ---------------- PROTECTED ENDPOINTS ----------------
  const AUTH = { Authorization: "Bearer faketoken" };

  test("GET /check/:id returns OK for existing user", async () => {
    const res = await request(app)
      .get("/check/existing")
      .set(AUTH);

    expect(res.status).toBe(200);
    expect(res.text).toBe("OK");
  });

  test("GET /check/:id returns 404 for non-existent", async () => {
    const res = await request(app)
      .get("/check/nonexistent")
      .set(AUTH);

    expect(res.status).toBe(404);
    expect(res.text).toBe("user not found");
  });

  test("POST /order/:id updates order history", async () => {
    const res = await request(app)
      .post("/order/existing")
      .set(AUTH)
      .send({ item: "robot", qty: 2 });

    expect(res.status).toBe(200);
    expect(res.text).toBe("OK");
    expect(appInstance.ordersCollection.updateOne).toHaveBeenCalled();
  });

  test("GET /history/:id returns history", async () => {
    const res = await request(app)
      .get("/history/existing")
      .set(AUTH);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("name", "existing");
    expect(res.body).toHaveProperty("history");
  });

});