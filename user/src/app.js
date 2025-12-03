// src/app.js
const express = require('express');
const bodyParser = require('body-parser');
const pino = require('pino');
const expPino = require('express-pino-logger');
const { MongoClient, ObjectID } = require('mongodb');
const redis = require('redis');

class UserServiceApp {
  constructor(options = {}) {
    // Optional mocks for testing
    const { mongoHost, redisHost, redisClient, mockCollections, skipMongoLoop = false } = options;

    this.mongoConnected = false;
    this.redisConnected = false;
    this.mongoUrl = 'mongodb://' + mongoHost + ':27017/users';
    this.redisHost = redisHost;

    // Mock collections for unit testing
    if (mockCollections) {
      this.usersCollection = mockCollections.users;
      this.ordersCollection = mockCollections.orders;
      this.mongoConnected = true;
    }

    // Logger setup
    this.logger = pino({ level: 'info', prettyPrint: false, useLevelLabels: true });
    this.expLogger = expPino({
      logger: this.logger,
      autoLogging: {
        ignorePaths: ['/health']
      }
    });

    // Express app
    this.app = express();
    this.setupMiddleware();
    this.setupRoutes();

    // Redis client
    if(redisClient) {
        this.redisClient = redisClient;
        this.redisConnected = true;
    }
    else {
        this.redisClient = redis.createClient({ host: this.redisHost });
        this.redisClient.on('error', (e) => this.logger.error('Redis ERROR', e));
        this.redisClient.on('ready', (r) => this.logger.info('Redis READY', r));
        this.redisConnected = true;
    }
    
    // Mongo connection loop
    if (!skipMongoLoop && !mockCollections) this.startMongoLoop();
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

  setupRoutes() {
    this.app.get('/health', (req, res) => {
      const status = {
        app: 'OK',
        mongo: this.mongoConnected,
        redis: this.redisConnected
      };
      
      const httpCode = this.mongoConnected ? 200 : 500;
      res.status(httpCode).json(status);
    });

    this.app.get('/uniqueid', (req, res) => {
      this.redisClient.incr('anonymous-counter', (err, r) => {
        if (!err) res.json({ uuid: 'anonymous-' + r });
        else {
          req.log.error('ERROR', err);
          res.status(500).send(err);
        }
      });
    });  
    
    this.app.get('/check/:id', async (req, res) => {
      if (!this.mongoConnected) return res.status(500).send('database not available');
      try {
        const user = await this.usersCollection.findOne({ name: req.params.id });
        if (user) res.send('OK');
        else res.status(404).send('user not found');
      } catch (e) { req.log.error(e); res.status(500).send(e); }
    });

    this.app.get('/users', async (req, res) => {
      if (!this.mongoConnected) return res.status(500).send('database not available');
      try {
        const users = await this.usersCollection.find().toArray();
        res.json(users);
      } catch (e) { req.log.error(e); res.status(500).send(e); }
    });

    this.app.post('/register', async (req, res) => {
      const { name, password, email } = req.body;
      if (!name || !password || !email) return res.status(400).send('insufficient data');
      if (!this.mongoConnected) return res.status(500).send('database not available');

      try {
        const existing = await this.usersCollection.findOne({ name });
        if (existing) return res.status(400).send('name already exists');

        await this.usersCollection.insertOne({ name, password, email });
        res.send('OK');
      } catch (e) { req.log.error(e); res.status(500).send(e); }
    });

    this.app.post('/login', async (req, res) => {
      const { name, password } = req.body;
      if (!name || !password) return res.status(400).send('name or password not supplied');
      if (!this.mongoConnected) return res.status(500).send('database not available');

      try {
        const user = await this.usersCollection.findOne({ name });
        if (!user) return res.status(404).send('name not found');
        if (user.password !== password) return res.status(404).send('incorrect password');
        res.json(user);
      } catch (e) { req.log.error(e); res.status(500).send(e); }
    });

    this.app.post('/order/:id', async (req, res) => {
      if (!this.mongoConnected) return res.status(500).send('database not available');

      try {
        const user = await this.usersCollection.findOne({ name: req.params.id });
        if (!user) return res.status(404).send('name not found');

        let history = await this.ordersCollection.findOne({ name: req.params.id });
        if (history) {
          history.history.push(req.body);
          await this.ordersCollection.updateOne({ name: req.params.id }, { $set: { history: history.history } });
        } else {
          await this.ordersCollection.insertOne({ name: req.params.id, history: [req.body] });
        }
        res.send('OK');
      } catch (e) { req.log.error(e); res.status(500).send(e); }
    });

    this.app.get('/history/:id', async (req, res) => {
      if (!this.mongoConnected) return res.status(500).send('database not available');

      try {
        const history = await this.ordersCollection.findOne({ name: req.params.id });
        if (history) res.json(history);
        else res.status(404).send('history not found');
      } catch (e) { req.log.error(e); res.status(500).send(e); }
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
        this.logger.error('ERROR', e);
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