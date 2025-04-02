const { Telegraf } = require('telegraf');
const Message = require('../models/Message');
const { analyzeMessage, isOpenAIServiceAvailable, getOpenAIErrorStatus } = require('./openai');
const { isDBConnected } = require('../config/database');
require('dotenv').config();

// Initialize bot with error handling
let bot;
let botInitialized = false;
let botInfo = null;
let initializationError = null;
let launchRetryCount = 0;
const MAX_LAUNCH_RETRIES = 5;

try {
  if (!process.env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN.trim() === '') {
    initializationError = 'Telegram Bot Token is missing or empty. Bot cannot start.';
    console.error(initializationError);
  } else if (process.env.TELEGRAM_BOT_TOKEN === 'your_telegram_bot_token') {
    initializationError = 'You are using the default Telegram Bot Token. Please update it with your actual token.';
    console.error(initializationError);
  } else {
    bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
    console.log('Telegram bot initialized');
  }
} catch (error) {
  initializationError = `Error initializing Telegram bot: ${error.message}`;
  console.error(initializationError);
}

// Check service status
const getServiceStatus = () => {
  return {
    botInitialized,
    databaseConnected: isDBConnected(),
    openAIAvailable: isOpenAIServiceAvailable(),
    openAIError: getOpenAIErrorStatus(),
    initializationError,
    launchRetryCount
  };
};

// Helper to format service status message
const formatServiceStatusMessage = () => {
  const status = getServiceStatus();
  return `
🤖 *Bot Status*
- Bot: ${status.botInitialized ? '✅ Running' : '❌ Not running'}
- Database: ${status.databaseConnected ? '✅ Connected' : '❌ Disconnected'}
- OpenAI: ${status.openAIAvailable ? '✅ Available' : '❌ Unavailable'}
${status.launchRetryCount > 0 ? `- Launch retries: ${status.launchRetryCount}/${MAX_LAUNCH_RETRIES}` : ''}
${status.openAIError ? `- OpenAI Error: ${status.openAIError}` : ''}
${status.initializationError ? `- Error: ${status.initializationError}` : ''}
  `;
};

// Helper function to launch the bot with retries
const launchBotWithRetry = async (retryDelay = 5000) => {
  try {
    console.log(`Attempting to launch bot (attempt ${launchRetryCount + 1}/${MAX_LAUNCH_RETRIES})`);
    
    // Set polling parameters to handle conflicts better
    // Using a unique polling identifier helps prevent conflicts
    const uniqueId = `instance_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
    
    await bot.launch({
      allowedUpdates: ['message', 'callback_query', 'inline_query', 'chat_member', 'new_chat_members'],
      polling: {
        timeout: 30,
        limit: 100,
        allowed_updates: ['message', 'callback_query', 'inline_query', 'chat_member', 'new_chat_members'],
      }
    });
    
    botInitialized = true;
    launchRetryCount = 0; // Reset counter on success
    console.log('Bot successfully launched');
    return true;
  } catch (error) {
    console.error(`Failed to launch bot: ${error.message}`);
    
    // Handle 409 conflict error specifically
    if (error.message.includes('409: Conflict') || error.message.includes('terminated by other getUpdates request')) {
      console.log('Detected conflict with another bot instance. Waiting for other instance to time out...');
      launchRetryCount++;
      
      if (launchRetryCount < MAX_LAUNCH_RETRIES) {
        console.log(`Will retry in ${retryDelay/1000} seconds (attempt ${launchRetryCount + 1}/${MAX_LAUNCH_RETRIES})`);
        
        // Exponential backoff
        const nextRetryDelay = retryDelay * 2;
        
        // Wait and retry
        await new Promise(resolve => setTimeout(resolve, retryDelay));
        return await launchBotWithRetry(nextRetryDelay);
      } else {
        console.error(`Max retry attempts (${MAX_LAUNCH_RETRIES}) reached. Bot failed to start.`);
        initializationError = `Max retry attempts reached. Conflict with another bot instance.`;
        return false;
      }
    }
    
    return false;
  }
};

// Initialize bot with commands and message handlers
const initBot = async () => {
  try {
    // Check if bot is properly initialized
    if (!bot) {
      console.error('Cannot initialize bot: Bot instance is not available.');
      return false;
    }

    // Get bot info
    try {
      botInfo = await bot.telegram.getMe();
      console.log(`Bot started as @${botInfo.username}`);
    } catch (error) {
      console.error(`Failed to get bot info: ${error.message}`);
      return false;
    }
    
    // Set bot commands
    try {
      await bot.telegram.setMyCommands([
        { command: 'start', description: 'Start the bot' },
        { command: 'help', description: 'Show help' },
        { command: 'stats', description: 'Show chat statistics' },
        { command: 'topics', description: 'Show top topics in this chat' },
        { command: 'status', description: 'Check bot service status' }
      ]);
    } catch (error) {
      console.error(`Failed to set bot commands: ${error.message}`);
      // Continue despite this error
    }

    // Handle start command
    bot.command('start', async (ctx) => {
      try {
        if (ctx.chat.type === 'private') {
          await ctx.reply('Hello! I track and analyze messages in groups. Add me to a group to start working!');
        } else {
          await ctx.reply(`Hello! I'm now tracking and analyzing messages in this group (${ctx.chat.title}).`);
          console.log(`Bot initialized in group: ${ctx.chat.title} (${ctx.chat.id})`);
        }
      } catch (error) {
        console.error(`Error handling start command: ${error.message}`);
        await ctx.reply('Sorry, there was an error processing your command. Please try again later.');
      }
    });

    // Handle help command
    bot.command('help', async (ctx) => {
      try {
        await ctx.reply(
          'Commands:\n' +
          '/start - Start the bot\n' +
          '/help - Show this help message\n' +
          '/stats - Show statistics about messages in this chat\n' +
          '/topics - Show top topics discussed in this chat\n' +
          '/status - Check if all bot services are working properly'
        );
      } catch (error) {
        console.error(`Error handling help command: ${error.message}`);
        await ctx.reply('Sorry, there was an error displaying the help message. Please try again later.');
      }
    });

    // Handle status command
    bot.command('status', async (ctx) => {
      try {
        await ctx.reply(formatServiceStatusMessage(), { parse_mode: 'Markdown' });
      } catch (error) {
        console.error(`Error handling status command: ${error.message}`);
        await ctx.reply('Sorry, there was an error checking the service status.');
      }
    });

    // Handle stats command
    bot.command('stats', async (ctx) => {
      try {
        console.log(`Stats command received in chat ${ctx.chat.id} (${ctx.chat.title || 'Private Chat'})`);
        
        // Check if database is connected
        if (!isDBConnected()) {
          console.error('Stats command failed: Database not connected');
          return await ctx.reply('⚠️ Database connection is unavailable. Stats cannot be retrieved at this time.');
        }

        // Only allow in group chats
        if (ctx.chat.type !== 'group' && ctx.chat.type !== 'supergroup') {
          console.log('Stats command rejected: Not a group chat');
          return await ctx.reply('This command only works in group chats.');
        }
        
        const chatId = ctx.chat.id;
        console.log(`Fetching stats for chat ${chatId}`);
        
        // Use the static method to get chat stats
        const stats = await Message.getChatStats(chatId);
        console.log(`Stats retrieved for chat ${chatId}:`, JSON.stringify(stats, null, 2));
        
        if (stats.totalMessages === 0) {
          console.log(`No messages found for chat ${chatId}`);
          return await ctx.reply('No messages have been tracked in this chat yet.');
        }
        
        // Format user names
        const formatUserName = (user) => {
          if (user._id.username) {
            return `@${user._id.username}`;
          } else {
            const firstName = user._id.firstName || '';
            const lastName = user._id.lastName || '';
            return `${firstName} ${lastName}`.trim() || `User ${user._id.userId}`;
          }
        };
        
        // Build the stats message for this specific chat
        const statsMessage = `
📊 *Chat Statistics for "${ctx.chat.title}"*

Total messages tracked: ${stats.totalMessages}
Unique users: ${stats.uniqueUsers}

${stats.sentiments.length > 0 ? `*Sentiment breakdown:*
${stats.sentiments.map(s => `- ${s._id || 'unknown'}: ${s.count} (${Math.round(s.count/stats.totalMessages*100)}%)`).join('\n')}` : 'No sentiment data available'}

${stats.topics.length > 0 ? `*Top 5 topics:*
${stats.topics.slice(0, 5).map(t => `- ${t._id}: ${t.count} mentions`).join('\n')}` : 'No topic data available'}

${stats.activeUsers.length > 0 ? `*Most active users:*
${stats.activeUsers.slice(0, 5).map(u => `- ${formatUserName(u)}: ${u.messageCount} messages`).join('\n')}` : 'No user activity data available'}
        `;
        
        console.log(`Sending stats message to chat ${chatId}`);
        await ctx.reply(statsMessage, { parse_mode: 'Markdown' });
      } catch (error) {
        console.error(`Error generating stats for chat ${ctx.chat.id}:`, error);
        console.error('Error stack:', error.stack);
        await ctx.reply('Sorry, there was an error generating statistics. Please try again later or check the bot status with /status.');
      }
    });
    
    // Handle topics command
    bot.command('topics', async (ctx) => {
      try {
        console.log(`Topics command received in chat ${ctx.chat.id} (${ctx.chat.title || 'Private Chat'})`);
        
        // Check if database is connected
        if (!isDBConnected()) {
          console.error('Topics command failed: Database not connected');
          return await ctx.reply('⚠️ Database connection is unavailable. Topics cannot be retrieved at this time.');
        }

        // Only allow in group chats
        if (ctx.chat.type !== 'group' && ctx.chat.type !== 'supergroup') {
          console.log('Topics command rejected: Not a group chat');
          return await ctx.reply('This command only works in group chats.');
        }
        
        const chatId = ctx.chat.id;
        console.log(`Fetching topics for chat ${chatId}`);
        
        // Get top topics in this chat
        const topicsAggregation = await Message.aggregate([
          { $match: { chatId } },
          { $unwind: { path: "$analysis.topics", preserveNullAndEmptyArrays: false } },
          { $group: {
              _id: "$analysis.topics",
              count: { $sum: 1 }
            }
          },
          { $sort: { count: -1 } },
          { $limit: 15 }
        ]).exec(); // Add .exec() to ensure proper promise handling
        
        console.log(`Topics retrieved for chat ${chatId}:`, JSON.stringify(topicsAggregation, null, 2));
        
        if (!topicsAggregation || topicsAggregation.length === 0) {
          console.log(`No topics found for chat ${chatId}`);
          return await ctx.reply('No topics have been identified in this chat yet. Try sending some messages first!');
        }
        
        const topicsMessage = `
📋 *Top Topics in "${ctx.chat.title}"*

${topicsAggregation.map((t, i) => `${i+1}. ${t._id}: ${t.count} mentions`).join('\n')}

_Note: Topics are identified from messages sent after the bot was added to the group._
        `;
        
        console.log(`Sending topics message to chat ${chatId}`);
        await ctx.reply(topicsMessage, { parse_mode: 'Markdown' });
      } catch (error) {
        console.error(`Error generating topics for chat ${ctx.chat.id}:`, error);
        console.error('Error stack:', error.stack);
        await ctx.reply('Sorry, there was an error generating the topics list. Please try again later or check the bot status with /status.');
      }
    });

    // Handle messages
    bot.on('message', async (ctx) => {
      try {
        // Skip if not in a group chat
        if (ctx.chat.type !== 'group' && ctx.chat.type !== 'supergroup') {
          return;
        }
        
        // Skip if database is not connected
        if (!isDBConnected()) {
          console.log(`Skipping message processing: Database not connected (Chat: ${ctx.chat.title})`);
          return;
        }

        // Skip non-text messages
        if (!ctx.message.text) {
          return;
        }
        
        // Extract message data
        const messageData = {
          messageId: ctx.message.message_id,
          chatId: ctx.chat.id,
          chatTitle: ctx.chat.title,
          userId: ctx.message.from.id,
          username: ctx.message.from.username,
          firstName: ctx.message.from.first_name,
          lastName: ctx.message.from.last_name,
          text: ctx.message.text,
          date: new Date(ctx.message.date * 1000) // Convert Unix timestamp to Date
        };
        
        // Skip private bot commands for cleaner DB
        if (messageData.text.startsWith('/')) {
          console.log(`Skipping command message in chat ${ctx.chat.id}: ${messageData.text.split(' ')[0]}`);
          return;
        }
        
        console.log(`Processing message in chat ${ctx.chat.id}: "${messageData.text.substring(0, 50)}${messageData.text.length > 50 ? '...' : ''}"`);
        
        // Analyze the message with OpenAI
        const analysis = await analyzeMessage(messageData.text);
        messageData.analysis = analysis;
        
        // Log analysis results
        console.log(`Message analysis for chat ${ctx.chat.id}:`, {
          sentiment: analysis.sentiment,
          topics: analysis.topics,
          intent: analysis.intent
        });
        
        // Save message to database
        const savedMessage = await new Message(messageData).save();
        console.log(`Saved message ${savedMessage.messageId} from chat ${savedMessage.chatId} (${ctx.chat.title})`);
      } catch (error) {
        console.error(`Error processing message in chat ${ctx.chat.id}:`, error);
        console.error('Error stack:', error.stack);
        // Don't notify users for individual message processing errors
      }
    });

    // Handle when bot is added to a group
    bot.on('new_chat_members', async (ctx) => {
      try {
        // Check if the bot itself was added
        const newMembers = ctx.message.new_chat_members;
        const botWasAdded = newMembers.some(member => member.id === botInfo.id);
        
        if (botWasAdded) {
          await ctx.reply(`Hello! I've been added to "${ctx.chat.title}". I'll start tracking and analyzing messages in this group.`);
          console.log(`Bot was added to a new group: ${ctx.chat.title} (${ctx.chat.id})`);
        }
      } catch (error) {
        console.error(`Error handling new chat members: ${error.message}`);
      }
    });

    // Handle errors
    bot.catch((err, ctx) => {
      console.error(`Telegram bot error: ${err.message}`);
      console.error('Error context:', ctx);
      
      // Try to notify user
      try {
        ctx.reply('Sorry, an error occurred. Our team has been notified.');
      } catch (replyError) {
        console.error(`Could not send error reply: ${replyError.message}`);
      }
    });

    // Launch the bot with retry mechanism
    const botLaunched = await launchBotWithRetry();
    if (!botLaunched) {
      return false;
    }
    
    // Enable graceful stop
    process.once('SIGINT', () => {
      bot.stop('SIGINT');
      console.log('Bot stopped due to SIGINT');
    });
    process.once('SIGTERM', () => {
      bot.stop('SIGTERM');
      console.log('Bot stopped due to SIGTERM');
    });
    
    return true;
  } catch (error) {
    console.error(`Error initializing bot: ${error.message}`);
    return false;
  }
};

module.exports = { initBot, getServiceStatus }; 