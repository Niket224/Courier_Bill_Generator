const dotenv = require('dotenv');
const path = require('node:path');
const { validateEnv } = require('./config/env');
if (process.env.NODE_ENV === 'test') throw new Error('Use the isolated test harness; server.js cannot start in test mode.');
dotenv.config({ path: path.join(__dirname, '.env') });
// Validate before loading routes, connecting to MongoDB, or opening a listener.
const config = validateEnv(process.env);
config.warnings.forEach((warning) => console.warn(`Configuration warning: ${warning}`));
const connectDB = require('./config/db');

const { createApp } = require('./app');
const app = createApp(config);
// Start server if not running in test mode
const PORT = config.port;
if (config.nodeEnv !== 'test') {
  connectDB().then(() => {
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  }).catch((err) => {
    console.error('Failed to initialize database connection. Check MONGO_URI and database availability.');
    process.exitCode = 1;
  });
}

module.exports = app;
