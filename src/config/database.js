const mongoose = require('mongoose');
require('dotenv').config();

// Track connection state
let isConnected = false;

const connectDB = async () => {
  try {
    // Skip if already connected
    if (isConnected) {
      console.log('MongoDB is already connected');
      return;
    }

    const conn = await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    
    isConnected = true;
    console.log(`MongoDB Connected: ${conn.connection.host}`);

    // Set up connection event listeners
    mongoose.connection.on('disconnected', () => {
      console.error('MongoDB disconnected! Attempting to reconnect...');
      isConnected = false;
    });

    mongoose.connection.on('error', (err) => {
      console.error(`MongoDB connection error: ${err.message}`);
      isConnected = false;
    });

    return true;
  } catch (error) {
    isConnected = false;
    const errorMessage = `Error connecting to MongoDB: ${error.message}`;
    console.error(errorMessage);
    
    // More detailed error handling based on error type
    if (error.name === 'MongoNetworkError') {
      console.error('Network error connecting to MongoDB. Please check your internet connection or MongoDB Atlas status.');
    } else if (error.name === 'MongoServerSelectionError') {
      console.error('Could not select a MongoDB server. Please check your connection string and ensure the cluster is running.');
    } else if (error.message.includes('Authentication failed')) {
      console.error('MongoDB authentication failed. Please check your username and password in the connection string.');
    }
    
    return false;
  }
};

// Check if database is connected
const isDBConnected = () => {
  return isConnected && mongoose.connection.readyState === 1;
};

module.exports = { connectDB, isDBConnected }; 