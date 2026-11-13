const mongoose = require('mongoose');

/**
 * Connects to MongoDB Atlas using Mongoose and configures connection event listeners.
 * @returns {Promise<typeof mongoose>}
 */
const connectDB = async () => {
  if (process.env.NODE_ENV === 'test') {
    throw new Error(
      'Production database connector is disabled in test mode. Use the isolated test harness.'
    );
  }

  let stage = 'mongoose.connect';

  try {
    const connString = process.env.MONGO_URI;

    if (!connString) {
      throw new Error('MONGO_URI is not defined in environment variables.');
    }

    const conn = await mongoose.connect(connString, {
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 10000,
      socketTimeoutMS: 30000,
    });

    stage = 'database.recovery_check';

    await require('../services/businessRecovery')
      .assertRecoveredDatabase(conn.connection.db);

    const log = require('../operations').safeLogger();

    log('database_connected');

    mongoose.connection.on('error', () => {
      log('database_error');
    });

    mongoose.connection.on('disconnected', () => {
      log('database_disconnected');
    });

    return conn;
  } catch (error) {
    const safeCode = (value) => {
      if (typeof value === 'number') return value;

      if (
        typeof value === 'string' &&
        /^[A-Za-z0-9_-]{1,40}$/.test(value)
      ) {
        return value;
      }

      return undefined;
    };

    console.error('[database_connection_failed]', {
      stage,
      errorName: safeCode(error?.name) || 'UnknownError',
      errorCode: safeCode(error?.code),
      causeName: safeCode(error?.cause?.name),
      causeCode: safeCode(error?.cause?.code),
    });

    throw new Error(
      'Unable to connect to MongoDB. Check MONGO_URI and database availability.'
    );
  }
};

module.exports = connectDB;
