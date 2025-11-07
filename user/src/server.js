const UserServiceApp = require('./app');

const port = process.env.USER_SERVER_PORT || 8080;
const service = new UserServiceApp({
  mongoUrl: process.env.MONGO_URL,
  redisHost: process.env.REDIS_HOST,
});

service.getApp().listen(port, () => {
  console.info('Started on port', port);
});
