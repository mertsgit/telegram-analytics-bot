const connectDB = require('./config/database');
const { initBot } = require('./services/telegram');
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

// Main function to start the application
const startApp = async () => {
  try {
    // Check environment variables
    if (!checkEnvVars()) {
      process.exit(1);
    }
    
    // Connect to MongoDB
    await connectDB();
    
    // Initialize and start Telegram bot
    const botInitialized = await initBot();
    
    if (botInitialized) {
      console.log('Telegram bot has been successfully initialized and started.');
      console.log('The bot is now tracking messages in groups it is added to.');
    } else {
      console.error('Failed to initialize Telegram bot. Check logs for details.');
      process.exit(1);
    }
  } catch (error) {
    console.error('Error starting application:', error);
    process.exit(1);
  }
};

// Start the application
startApp(); 