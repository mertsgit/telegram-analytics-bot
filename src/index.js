const { connectDB, isDBConnected } = require('./config/database');
const { initBot, getServiceStatus } = require('./services/telegram');
const { isOpenAIServiceAvailable } = require('./services/openai');
require('dotenv').config();

// Check for required environment variables
const checkEnvVars = () => {
  const requiredVars = [
    'TELEGRAM_BOT_TOKEN',
    'MONGODB_URI',
    'OPENAI_API_KEY'
  ];
  
  const missingVars = requiredVars.filter(varName => !process.env[varName]);
  
  if (missingVars.length > 0) {
    console.error(`Error: Missing required environment variables: ${missingVars.join(', ')}`);
    console.error('Please check your .env file and make sure all required variables are set.');
    return false;
  }
  
  // Check if Telegram bot token is set to default value
  if (process.env.TELEGRAM_BOT_TOKEN === 'your_telegram_bot_token') {
    console.error('Error: TELEGRAM_BOT_TOKEN is set to default value "your_telegram_bot_token"');
    console.error('Please update it with the actual token from BotFather in the .env file.');
    return false;
  }
  
  return true;
};

// Log application status
const logAppStatus = () => {
  const status = getServiceStatus();
  console.log('\n--- Application Status ---');
  console.log(`Bot initialized: ${status.botInitialized ? 'Yes' : 'No'}`);
  console.log(`Database connected: ${status.databaseConnected ? 'Yes' : 'No'}`);
  console.log(`OpenAI available: ${status.openAIAvailable ? 'Yes' : 'No'}`);
  
  if (status.openAIError) {
    console.log(`OpenAI error: ${status.openAIError}`);
  }
  
  if (status.initializationError) {
    console.log(`Bot initialization error: ${status.initializationError}`);
  }
  console.log('-------------------------\n');
};

// Setup periodic health check
const setupHealthCheck = () => {
  const healthCheckInterval = 5 * 60 * 1000; // 5 minutes
  
  const performHealthCheck = () => {
    const status = getServiceStatus();
    
    if (!status.databaseConnected) {
      console.error('Health check: Database connection lost. Attempting to reconnect...');
      connectDB().catch(err => {
        console.error(`Failed to reconnect to database: ${err.message}`);
      });
    }
    
    // Log status only if there are issues
    if (!status.botInitialized || !status.databaseConnected || !status.openAIAvailable) {
      logAppStatus();
    }
  };
  
  // Initial health check
  performHealthCheck();
  
  // Schedule regular health checks
  return setInterval(performHealthCheck, healthCheckInterval);
};

// Handle uncaught exceptions to prevent app crash
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  console.error('The application will continue running, but some functionality may be impaired.');
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Promise Rejection at:', promise);
  console.error('Reason:', reason);
  console.error('The application will continue running, but some functionality may be impaired.');
});

// Main function to start the application
const startApp = async () => {
  try {
    // Check environment variables
    if (!checkEnvVars()) {
      console.error('Failed environment variable check. Starting with limited functionality.');
    }
    
    // Connect to MongoDB
    const dbConnected = await connectDB();
    
    if (!dbConnected) {
      console.warn('Starting bot with limited functionality (no database connection).');
    }
    
    // Initialize and start Telegram bot
    const botInitialized = await initBot();
    
    if (botInitialized) {
      console.log('Telegram bot has been successfully initialized and started.');
      console.log('The bot is now tracking messages in groups it is added to.');
    } else {
      console.error('Failed to initialize Telegram bot. Check logs for details.');
    }
    
    // Check OpenAI service availability
    if (!isOpenAIServiceAvailable()) {
      console.warn('OpenAI service is not available. Message analysis will be limited.');
    }
    
    // Log application status
    logAppStatus();
    
    // Setup periodic health checks
    const healthCheckTimer = setupHealthCheck();
    
    // Set up proper shutdown
    const gracefulShutdown = () => {
      console.log('Shutting down gracefully...');
      clearInterval(healthCheckTimer);
      process.exit(0);
    };
    
    process.on('SIGINT', gracefulShutdown);
    process.on('SIGTERM', gracefulShutdown);
    
  } catch (error) {
    console.error(`Error starting application: ${error.message}`);
    console.error('Stack trace:', error.stack);
  }
};

// Start the application
startApp(); 