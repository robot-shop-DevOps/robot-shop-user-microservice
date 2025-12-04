const UserServiceApp = require('./app');

const port = process.env.USER_SERVER_PORT || 8080;
const service = new UserServiceApp({
  mongoHost: process.env.MONGO_HOST,
  redisHost: process.env.REDIS_HOST,
  jwtsecret: process.env.JWT_SECRET
});

service.getApp().listen(port, () => {
  console.info('Started on port', port);
});
