// Load environment variables from .env file
require('dotenv').config();

// Import necessary packages
const express = require('express');
const mongoose = require('mongoose');
const { connectDatabase } = require('./config/database');
const telegramService = require('./services/telegram');
const { requestLogger, errorLogger } = require('./utils/loggerMiddleware');
const { createLogger } = require('./utils/logger');

// Create a logger for the application
const appLogger = createLogger('app');

// Create Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Apply middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(requestLogger);

// Connect to database
connectDatabase()
  .then(() => {
    appLogger.info('Connected to MongoDB successfully');
  })
  .catch(err => {
    appLogger.error(`Database connection failed: ${err.message}`);
  });

// Start Telegram bot
telegramService.initTelegramBot();

// Define routes
app.get('/', (req, res) => {
  res.send('Telegram Analytics Bot is running!');
});

// Error handling middleware - should be last
app.use(errorLogger);
app.use((err, req, res, next) => {
  res.status(500).json({ 
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'production' ? 'Something went wrong' : err.message
  });
});

// Start the server
app.listen(PORT, () => {
  appLogger.info(`Server started on port ${PORT}`);
});

// Handle graceful shutdown
process.on('SIGINT', async () => {
  appLogger.info('Received SIGINT signal. Shutting down gracefully...');
  
  try {
    await mongoose.connection.close();
    appLogger.info('Database connection closed.');
    process.exit(0);
  } catch (error) {
    appLogger.error(`Error during shutdown: ${error.message}`);
    process.exit(1);
  }
});

module.exports = app; 