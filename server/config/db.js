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

    const conn = await mongoose.connect(connString);

    console.log(`MongoDB Connected: ${conn.connection.host}`);

    mongoose.connection.on('error', (err) => {
      console.error('MongoDB connection error. Check database availability and credentials.');
    });

    mongoose.connection.on('disconnected', () => {
      console.warn('MongoDB connection disconnected.');
    });

    return conn;
  } catch (error) {
    throw new Error('Unable to connect to MongoDB. Check MONGO_URI and database availability.');
  }
};

module.exports = connectDB;
