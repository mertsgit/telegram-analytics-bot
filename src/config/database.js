const mongoose = require('mongoose');
require('dotenv').config();

// Track connection state
let isConnected = false;
let connectionRetries = 0;
const MAX_RETRIES = 5;
const RETRY_INTERVAL = 5000; // 5 seconds

const connectWithRetry = async (retryCount = 0) => {
  try {
    console.log(`Attempting to connect to MongoDB (attempt ${retryCount + 1}/${MAX_RETRIES})`);
    
    const conn = await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 5000, // 5 seconds for faster failure detection
      heartbeatFrequencyMS: 10000, // Check server status every 10 seconds
    });
    
    isConnected = true;
    connectionRetries = 0; // Reset retry counter on success
    console.log(`MongoDB Connected: ${conn.connection.host}`);
    return true;
  } catch (error) {
    isConnected = false;
    console.error(`MongoDB connection attempt ${retryCount + 1} failed: ${error.message}`);
    
    if (retryCount < MAX_RETRIES - 1) {
      console.log(`Retrying in ${RETRY_INTERVAL/1000} seconds...`);
      // Wait and retry
      await new Promise(resolve => setTimeout(resolve, RETRY_INTERVAL));
      return connectWithRetry(retryCount + 1);
    } else {
      console.error(`Max retry attempts (${MAX_RETRIES}) reached. Could not connect to MongoDB.`);
      // Log detailed error information
      if (error.name === 'MongoNetworkError') {
        console.error('Network error connecting to MongoDB. Please check your internet connection or MongoDB Atlas status.');
      } else if (error.name === 'MongoServerSelectionError') {
        console.error('Could not select a MongoDB server. Please check your connection string and ensure the cluster is running.');
      } else if (error.message.includes('Authentication failed')) {
        console.error('MongoDB authentication failed. Please check your username and password in the connection string.');
      }
      return false;
    }
  }
};

const connectDB = async () => {
  try {
    // Skip if already connected
    if (isConnected && mongoose.connection.readyState === 1) {
      console.log('MongoDB is already connected');
      return true;
    }
    
    // Disconnect if there's a stale connection
    if (mongoose.connection.readyState !== 0) {
      console.log('Closing existing MongoDB connection before reconnecting');
      await mongoose.connection.close();
    }

    // Connect with retry mechanism
    const success = await connectWithRetry();
    
    if (success) {
      // Set up connection event listeners
      mongoose.connection.on('disconnected', () => {
        console.error('MongoDB disconnected! Attempting to reconnect...');
        isConnected = false;
        // Try to reconnect
        connectWithRetry().catch(err => console.error('Failed to reconnect:', err.message));
      });

      mongoose.connection.on('error', (err) => {
        console.error(`MongoDB connection error: ${err.message}`);
        isConnected = false;
      });
    }
    
    return success;
  } catch (error) {
    isConnected = false;
    console.error(`Error in connectDB: ${error.message}`);
    return false;
  }
};

// Enhanced connection check
const isDBConnected = () => {
  const connected = isConnected && mongoose.connection.readyState === 1;
  
  // Attempt to reconnect if not connected
  if (!connected && connectionRetries < MAX_RETRIES) {
    connectionRetries++;
    console.log(`Database not connected. Auto-retry attempt ${connectionRetries}/${MAX_RETRIES}`);
    connectDB().catch(err => console.error('Auto-reconnect failed:', err.message));
  }
  
  return connected;
};

module.exports = { connectDB, isDBConnected }; 