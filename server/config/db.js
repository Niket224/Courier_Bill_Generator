const mongoose = require('mongoose');

/**
 * Connects to MongoDB Atlas using Mongoose and configures connection event listeners.
 * @returns {Promise<typeof mongoose>}
 */
const connectDB = async () => {
  try {
    const connString = process.env.MONGO_URI;
    if (!connString) {
      throw new Error('MONGO_URI is not defined in environment variables.');
    }

    const conn = await mongoose.connect(connString);

    console.log(`MongoDB Connected: ${conn.connection.host}`);

    mongoose.connection.on('error', (err) => {
      console.error(`MongoDB connection error: ${err.message}`);
    });

    mongoose.connection.on('disconnected', () => {
      console.warn('MongoDB connection disconnected.');
    });

    return conn;
  } catch (error) {
    console.error(`Error connecting to MongoDB: ${error.message}`);
    process.exit(1);
  }
};

module.exports = connectDB;
