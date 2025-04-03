require('dotenv').config();
const connectDB = require('./config/database');
const telegramService = require('./services/telegram');
const { isOpenAIServiceAvailable } = require('./services/openai');

const startBot = async () => {
  try {
    // Check required environment variables
    const requiredEnvVars = ['TELEGRAM_BOT_TOKEN', 'MONGODB_URI', 'OPENAI_API_KEY'];
    const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);
    
    if (missingEnvVars.length > 0) {
      console.error('❌ Missing required environment variables:', missingEnvVars.join(', '));
      process.exit(1);
    }

    // Connect to MongoDB
    console.log('Connecting to MongoDB...');
    const dbConnected = await connectDB();
    if (!dbConnected) {
      console.error('❌ Failed to connect to MongoDB. Please check your connection string and try again.');
      process.exit(1);
    }

    // Initialize and start the bot
    console.log('Starting Telegram bot...');
    const success = await telegramService.initBot();
    
    if (!success) {
      const error = telegramService.getInitializationError();
      console.error('❌ Bot initialization failed:', error);
      process.exit(1);
    }

    // Set up graceful shutdown
    const shutdown = async () => {
      console.log('Shutting down...');
      const bot = telegramService.getBot();
      if (bot) {
        await bot.stop();
      }
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

  } catch (error) {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  }
};

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (error) => {
  console.error('❌ Unhandled Rejection:', error);
  process.exit(1);
});

// Start the application
startBot(); 