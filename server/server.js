const dotenv = require('dotenv');
const path = require('node:path');
const { validateEnv } = require('./config/env');
if (process.env.NODE_ENV === 'test') throw new Error('Use the isolated test harness; server.js cannot start in test mode.');
dotenv.config({ path: path.join(__dirname, '.env') });
const config = validateEnv(process.env);
if (config.nodeEnv === 'test') throw new Error('Use the isolated test harness; server.js cannot start in test mode.');
config.warnings.forEach((warning) => console.warn(`Configuration warning: ${warning}`));
const connectDB = require('./config/db');
const { createApp } = require('./app');
const { createSessionStore } = require('./security/store');
const connection = connectDB();
const sessionStore = createSessionStore(connection.then((mongoose) => mongoose.connection.getClient()), config);
const app = createApp(config, { sessionStore });
Promise.all([connection, sessionStore.collectionP]).then(() => {
  app.listen(config.port, () => console.log(`Server running on port ${config.port}`));
}).catch(() => {
  console.error('Startup failed. Check database availability and session-store permissions.');
  process.exitCode = 1;
  connection.then((mongoose) => mongoose.disconnect()).catch(() => {});
});
module.exports = app;
