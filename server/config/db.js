const mongoose = require('mongoose');

/**
 * Connects to MongoDB Atlas using Mongoose and configures connection event listeners.
 * @returns {Promise<typeof mongoose>}
 */
const connectDB = async () => {
  if (process.env.NODE_ENV === 'test') {
    throw new Error('Production database connector is disabled in test mode. Use the isolated test harness.');
  }
  try {
    const connString = process.env.MONGO_URI;
    if (!connString) {
      throw new Error('MONGO_URI is not defined in environment variables.');
    }

    const conn = await mongoose.connect(connString, { serverSelectionTimeoutMS: 5000, connectTimeoutMS: 10000, socketTimeoutMS: 30000 });
    await require('../services/businessRecovery').assertRecoveredDatabase(conn.connection.db);

    const log = require('../operations').safeLogger();
    log('database_connected');

    mongoose.connection.on('error', (err) => {
      log('database_error');
    });

    mongoose.connection.on('disconnected', () => {
      log('database_disconnected');
    });

    return conn;
  } catch (error) {
    throw new Error('Unable to connect to MongoDB. Check MONGO_URI and database availability.');
  }
};

module.exports = connectDB;
