const express                   = require('express');
const bodyParser                = require('body-parser');
const jwt                       = require('jsonwebtoken');
const pino                      = require('pino');
const expPino                   = require('express-pino-logger');
const { MongoClient }           = require('mongodb');
const redis                     = require('redis');

class UserServiceApp {
  constructor(options = {}) {
    const {
      mongoHost,
      redisHost,
      redisClient,
      mockCollections,
      skipMongoLoop = false,
      jwtsecret
    } = options;

    this.mongoConnected = false;
    this.redisConnected = false;
    this.mongoUrl       = 'mongodb://' + mongoHost + ':27017/users';
    this.redisHost      = redisHost;
    this.jwtsecret      = jwtsecret;

    this.logger = pino({
      level: 'info',
      prettyPrint: false,
      useLevelLabels: true
    });

    this.expLogger = expPino({
      logger: this.logger,
      autoLogging: {
        ignorePaths: ['/health']
      }
    });

    this.logger.info(
      { mongoHost, redisHost, jwtConfigured: !!jwtsecret },
      'User service initializing'
    );

    if (mockCollections) {
      this.usersCollection  = mockCollections.users;
      this.ordersCollection = mockCollections.orders;
      this.mongoConnected   = true;
      this.logger.info('Using mock Mongo collections');
    }

    this.app = express();
    this.setupMiddleware();
    this.setupRoutes();

    if (redisClient) {
      this.redisClient    = redisClient;
      this.redisConnected = true;
      this.logger.info('Using mock Redis client');
    } else {
      this.redisClient = redis.createClient({ host: this.redisHost });

      this.redisClient.on('ready', () => {
        this.redisConnected = true;
        this.logger.info('Redis connected');
      });

      this.redisClient.on('error', (e) => {
        this.logger.error({ err: e }, 'Redis error');
      });
    }

    if (!skipMongoLoop && !mockCollections) {
      this.startMongoLoop();
    }
  }

  setupMiddleware() {
    this.app.use(this.expLogger);
    this.app.use(bodyParser.json());
    this.app.use(bodyParser.urlencoded({ extended: true }));

    this.app.use((req, res, next) => {
      res.set('Timing-Allow-Origin', '*');
      res.set('Access-Control-Allow-Origin', '*');
      next();
    });
  }

  authMiddleware(req, res, next) {
    const header = req.headers['authorization'];
    if (!header) {
      req.log.warn('Missing Authorization header');
      return res.status(401).send('Missing Authorization header');
    }

    const token = header.split(' ')[1];
    if (!token) {
      req.log.warn('Missing token');
      return res.status(401).send('Missing token');
    }

    try {
      const decoded = jwt.verify(token, this.jwtsecret);
      req.user = decoded;
      req.log.info({ user: decoded.name }, 'JWT authentication successful');
      next();
    } catch (e) {
      req.log.warn({ err: e }, 'JWT verification failed');
      return res.status(403).send('Invalid or expired token');
    }
  }

  generateToken(user) {
    this.logger.info({ user: user.name }, 'Generating JWT');
    return jwt.sign(
      { name: user.name, email: user.email },
      this.jwtsecret,
      { expiresIn: '1h' }
    );
  }

  setupRoutes() {

    // ---------- HEALTH ----------
    this.app.get('/health', (req, res) => {
      res.status(this.mongoConnected ? 200 : 500).json({
        app: 'OK',
        mongo: this.mongoConnected,
        redis: this.redisConnected
      });
    });

    // ---------- LOGIN ----------
    this.app.post('/login', async (req, res) => {
      const { name, password } = req.body;

      if (!name || !password) {
        this.logger.warn('Login failed: missing credentials');
        return res.status(400).send('name or password not supplied');
      }

      try {
        const user = await this.usersCollection.findOne({ name });
        if (!user) {
          this.logger.warn({ user: name }, 'Login failed: user not found');
          return res.status(404).send('name not found');
        }

        if (user.password !== password) {
          this.logger.warn({ user: name }, 'Login failed: incorrect password');
          return res.status(404).send('incorrect password');
        }

        const token = this.generateToken(user);
        this.logger.info({ user: name }, 'Login successful');

        res.json({ message: 'Login successful', token });
      } catch (e) {
        this.logger.error({ err: e }, 'Login error');
        res.status(500).send(e);
      }
    });

    // ---------- REGISTER ----------
    this.app.post('/register', async (req, res) => {
      const { name, password, email } = req.body;

      if (!name || !password || !email) {
        this.logger.warn('Registration failed: insufficient data');
        return res.status(400).send('insufficient data');
      }

      try {
        const existing = await this.usersCollection.findOne({ name });
        if (existing) {
          this.logger.warn({ user: name }, 'Registration failed: user exists');
          return res.status(400).send('name already exists');
        }

        await this.usersCollection.insertOne({ name, password, email });
        this.logger.info({ user: name }, 'User registered');
        res.send('OK');
      } catch (e) {
        this.logger.error({ err: e }, 'Registration error');
        res.status(500).send(e);
      }
    });

    // ---------- CHECK ----------
    this.app.get('/check/:id', this.authMiddleware.bind(this), async (req, res) => {
      try {
        const user = await this.usersCollection.findOne({ name: req.params.id });
        if (user) {
          req.log.info({ user: req.params.id }, 'User exists');
          res.send('OK');
        } else {
          req.log.warn({ user: req.params.id }, 'User not found');
          res.status(404).send('user not found');
        }
      } catch (e) {
        req.log.error({ err: e }, 'User check failed');
        res.status(500).send(e);
      }
    });

    // ---------- ORDER ----------
    this.app.post('/order/:id', this.authMiddleware.bind(this), async (req, res) => {
      try {
        const user = await this.usersCollection.findOne({ name: req.params.id });
        if (!user) {
          req.log.warn({ user: req.params.id }, 'Order update failed: user not found');
          return res.status(404).send('name not found');
        }

        let history = await this.ordersCollection.findOne({ name: req.params.id });
        if (history) {
          history.history.push(req.body);
          await this.ordersCollection.updateOne(
            { name: req.params.id },
            { $set: { history: history.history } }
          );
        } else {
          await this.ordersCollection.insertOne({
            name: req.params.id,
            history: [req.body]
          });
        }

        req.log.info({ user: req.params.id }, 'Order history updated');
        res.send('OK');
      } catch (e) {
        req.log.error({ err: e }, 'Order update failed');
        res.status(500).send(e);
      }
    });

    // ---------- HISTORY ----------
    this.app.get('/history/:id', this.authMiddleware.bind(this), async (req, res) => {
      try {
        const history = await this.ordersCollection.findOne({ name: req.params.id });
        if (history) {
          req.log.info({ user: req.params.id }, 'Fetched order history');
          res.json(history);
        } else {
          req.log.warn({ user: req.params.id }, 'History not found');
          res.status(404).send('history not found');
        }
      } catch (e) {
        req.log.error({ err: e }, 'History fetch failed');
        res.status(500).send(e);
      }
    });
  }

  async mongoConnect() {
    const client = await MongoClient.connect(this.mongoUrl);
    this.db = client.db('users');
    this.usersCollection = this.db.collection('users');
    this.ordersCollection = this.db.collection('orders');
    this.mongoConnected = true;
    this.logger.info('MongoDB connected');
  }

  startMongoLoop() {
    const tryConnect = async () => {
      try {
        await this.mongoConnect();
      } catch (e) {
        this.logger.error({ err: e }, 'Mongo connection failed, retrying');
        setTimeout(tryConnect, 2000);
      }
    };
    tryConnect();
  }

  getApp() {
    return this.app;
  }
}

module.exports = UserServiceApp;