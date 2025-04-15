const mongoose = require('mongoose');
require('dotenv').config();

// Track connection state
let isConnected = false;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;
const RECONNECT_INTERVAL = 5000; // 5 seconds
let reconnectTimer = null;

const connectDB = async () => {
  try {
    // Skip if already connected
    if (isConnected && mongoose.connection.readyState === 1) {
      console.log('MongoDB is already connected');
      return true;
    }

    // Clear any existing reconnect timer
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    
    // Reset reconnect attempts if this is a fresh connection attempt
    if (mongoose.connection.readyState === 0) {
      reconnectAttempts = 0;
    }

    console.log(`Attempting to connect to MongoDB... (Attempt ${reconnectAttempts + 1})`);

    const conn = await mongoose.connect(process.env.MONGODB_URI, {
      // Improve connection resilience with these options
      serverSelectionTimeoutMS: 10000, // Timeout after 10 seconds
      heartbeatFrequencyMS: 30000,    // Check connection every 30 seconds
      maxPoolSize: 10,                // Maximum 10 connections in the pool
      minPoolSize: 2,                 // Keep at least 2 connections open
      socketTimeoutMS: 45000,         // Close sockets after 45 seconds of inactivity
      connectTimeoutMS: 30000,        // Connection attempt timeout
      bufferCommands: true,           // Buffer commands when connection is lost
      maxIdleTimeMS: 120000,          // Close connections after 2 minutes of inactivity
      family: 4                       // Use IPv4
    });
    
    isConnected = true;
    reconnectAttempts = 0;
    console.log(`MongoDB Connected: ${conn.connection.host}`);

    // Set up connection event listeners
    mongoose.connection.on('disconnected', () => {
      console.error('MongoDB disconnected! Attempting to reconnect...');
      isConnected = false;
      scheduleReconnect();
    });

    mongoose.connection.on('error', (err) => {
      console.error(`MongoDB connection error: ${err.message}`);
      isConnected = false;
      scheduleReconnect();
    });

    mongoose.connection.on('connected', () => {
      console.log('MongoDB connection restored');
      isConnected = true;
      reconnectAttempts = 0;
      
      // Clear any existing reconnect timer
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    });

    mongoose.connection.on('reconnected', () => {
      console.log('MongoDB reconnected');
      isConnected = true;
      reconnectAttempts = 0;
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
    } else if (error.message.includes('option') && error.message.includes('not supported')) {
      console.error('MongoDB driver compatibility issue detected. Using simplified connection options.');
      // Try connecting with minimal options if an option is not supported
      try {
        console.log('Attempting simplified MongoDB connection...');
        await mongoose.connect(process.env.MONGODB_URI);
        isConnected = true;
        reconnectAttempts = 0;
        console.log('MongoDB Connected with simplified options');
        return true;
      } catch (simpleConnError) {
        console.error(`Simplified connection also failed: ${simpleConnError.message}`);
      }
    }
    
    // Schedule reconnect
    scheduleReconnect();
    
    return false;
  }
};

// Function to schedule a reconnection attempt
const scheduleReconnect = () => {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
  }
  
  // Increase reconnect attempts
  reconnectAttempts++;
  
  if (reconnectAttempts <= MAX_RECONNECT_ATTEMPTS) {
    console.log(`Scheduling MongoDB reconnection attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS} in ${RECONNECT_INTERVAL/1000} seconds...`);
    
    // Use exponential backoff with a maximum interval
    const delay = Math.min(RECONNECT_INTERVAL * Math.pow(1.5, reconnectAttempts - 1), 60000); // Max 1 minute
    
    reconnectTimer = setTimeout(async () => {
      console.log(`Executing scheduled reconnection attempt ${reconnectAttempts}...`);
      await connectDB();
    }, delay);
  } else {
    console.error(`Maximum reconnection attempts (${MAX_RECONNECT_ATTEMPTS}) reached. Please check your database connection.`);
    
    // Reset counter but schedule one final attempt after a longer delay
    reconnectAttempts = 0;
    reconnectTimer = setTimeout(async () => {
      console.log('Making a final attempt to reconnect to MongoDB...');
      await connectDB();
    }, 120000); // 2 minutes
  }
};

// Check if database is connected
const isDBConnected = () => {
  return isConnected && mongoose.connection.readyState === 1;
};

// Force a reconnection attempt
const forceReconnect = async () => {
  console.log('Forcing reconnection to MongoDB...');
  isConnected = false;
  
  if (mongoose.connection.readyState !== 0) {
    try {
      await mongoose.connection.close();
    } catch (err) {
      console.error('Error closing existing MongoDB connection:', err.message);
    }
  }
  
  reconnectAttempts = 0;
  return connectDB();
};

module.exports = { connectDB, isDBConnected, forceReconnect }; 