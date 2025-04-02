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
🤖 *Bot Health Status*
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
        { command: 'stats', description: 'Show sentiment analysis' },
        { command: 'topics', description: 'Show categorized topics' },
        { command: 'leaderboard', description: 'Show most active users' },
        { command: 'health', description: 'Check bot service health' }
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
          '/stats - Show sentiment analysis and basic stats\n' +
          '/topics - Show categorized topics in this chat\n' +
          '/leaderboard - Show top 10 most active users\n' +
          '/health - Check if all bot services are working properly'
        );
      } catch (error) {
        console.error(`Error handling help command: ${error.message}`);
        await ctx.reply('Sorry, there was an error displaying the help message. Please try again later.');
      }
    });

    // Handle health command (renamed from status)
    bot.command('health', async (ctx) => {
      try {
        await ctx.reply(formatServiceStatusMessage(), { parse_mode: 'Markdown' });
      } catch (error) {
        console.error(`Error handling health command: ${error.message}`);
        await ctx.reply('Sorry, there was an error checking the service health.');
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
        
        if (!stats || stats.totalMessages === 0) {
          return await ctx.reply('No messages have been tracked in this chat yet. Send some messages first!');
        }
        
        // Format sentiment data for visualization
        const sentimentData = {
          positive: 0,
          negative: 0,
          neutral: 0,
          unknown: 0
        };
        
        stats.sentiments.forEach(s => {
          if (s._id in sentimentData) {
            sentimentData[s._id] = s.count;
          }
        });
        
        const totalSentiment = Object.values(sentimentData).reduce((a, b) => a + b, 0);
        const sentimentPercentages = {};
        for (const [key, value] of Object.entries(sentimentData)) {
          sentimentPercentages[key] = totalSentiment > 0 ? Math.round((value / totalSentiment) * 100) : 0;
        }
        
        // Format sentiment visualization
        const sentimentBars = Object.keys(sentimentData)
          .filter(key => key !== 'unknown') // Filter out unknown
          .map(sentiment => {
            const percentage = sentimentPercentages[sentiment];
            const barLength = Math.max(1, Math.round(percentage / 5)); // 1 bar per 5%
            const bar = '█'.repeat(barLength);
            return `${sentiment === 'positive' ? '😀' : sentiment === 'negative' ? '😠' : '😐'} ${sentiment}: ${bar} ${percentage}%`;
          }).join('\n');
        
        // Check for crypto-related topics
        const cryptoTopics = stats.topics
          .filter(t => /bitcoin|btc|eth|ethereum|crypto|token|blockchain|solana|sol|nft|defi|trading|coin/i.test(t._id))
          .slice(0, 5);
        
        // Build the stats message with focus on sentiment
        const statsMessage = `
📊 *Sentiment Analysis for "${ctx.chat.title}"*

${sentimentBars || 'No sentiment data available yet'}

*Chat Activity:*
- Total messages: ${stats.totalMessages}
- Active users: ${stats.uniqueUsers}
- Messages per user: ${stats.uniqueUsers ? Math.round(stats.totalMessages / stats.uniqueUsers * 10) / 10 : 0}

${cryptoTopics.length > 0 ? `*Crypto Topics:*
${cryptoTopics.map(t => `- ${t._id}: ${t.count} mentions`).join('\n')}` : ''}

_Use /topics for detailed topic analysis_
_Use /leaderboard to see most active users_`;
        
        await ctx.reply(statsMessage, { parse_mode: 'Markdown' });
      } catch (error) {
        console.error(`Error in stats command for chat ${ctx.chat.id}:`, error);
        console.error('Error stack:', error.stack);
        await ctx.reply('Sorry, there was an error generating statistics. Please try again in a few minutes. If the problem persists, contact the bot administrator.');
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
        
        // Get topics using the static method
        const topics = await Message.getChatTopics(chatId);
        
        if (!topics || topics.length === 0) {
          return await ctx.reply('No topics have been identified in this chat yet. Send some messages first!');
        }
        
        // Categorize topics
        const categories = {
          crypto: {
            name: "💰 Cryptocurrency",
            topics: [],
            regex: /bitcoin|btc|eth|ethereum|crypto|token|blockchain|solana|sol|nft|defi|trading|coin|market|price|bull|bear|wallet|exchange|dex|binance|chainlink|link|cardano|ada|xrp|usdt|usdc|stablecoin/i
          },
          technology: {
            name: "💻 Technology",
            topics: [],
            regex: /tech|software|hardware|web|app|code|developer|programming|ai|computer|internet|mobile|website|digital|online|device|gadget|electronics/i
          },
          finance: {
            name: "📈 Finance/Markets",
            topics: [],
            regex: /stock|finance|market|investing|investment|fund|bank|money|profit|loss|trader|trading|chart|analysis|buy|sell|portfolio|asset|dividend/i
          },
          general: {
            name: "🔍 General Topics",
            topics: []
          }
        };
        
        // Categorize each topic
        topics.forEach(topic => {
          let categorized = false;
          for (const [key, category] of Object.entries(categories)) {
            if (key !== 'general' && category.regex && category.regex.test(topic._id)) {
              category.topics.push(topic);
              categorized = true;
              break;
            }
          }
          if (!categorized) {
            categories.general.topics.push(topic);
          }
        });
        
        // Build message with categories
        let topicsMessage = `📋 *Topics in "${ctx.chat.title}"*\n\n`;
        
        for (const category of Object.values(categories)) {
          if (category.topics.length > 0) {
            topicsMessage += `*${category.name}:*\n`;
            category.topics.slice(0, 5).forEach((t, i) => {
              const lastMentioned = new Date(t.lastMentioned).toLocaleDateString();
              topicsMessage += `${i+1}. *${t._id}*: ${t.count} mentions (Last: ${lastMentioned})\n`;
            });
            topicsMessage += '\n';
          }
        }
        
        topicsMessage += '_Topics are identified from messages sent after the bot was added to the group._\n_Use /stats for sentiment analysis_';
        
        await ctx.reply(topicsMessage, { parse_mode: 'Markdown' });
      } catch (error) {
        console.error(`Error in topics command for chat ${ctx.chat.id}:`, error);
        console.error('Error stack:', error.stack);
        await ctx.reply('Sorry, there was an error generating the topics list. Please try again in a few minutes. If the problem persists, contact the bot administrator.');
      }
    });

    // Add leaderboard command
    bot.command('leaderboard', async (ctx) => {
      try {
        console.log(`Leaderboard command received in chat ${ctx.chat.id} (${ctx.chat.title || 'Private Chat'})`);
        
        // Check if database is connected
        if (!isDBConnected()) {
          console.error('Leaderboard command failed: Database not connected');
          return await ctx.reply('⚠️ Database connection is unavailable. Leaderboard cannot be retrieved at this time.');
        }

        // Only allow in group chats
        if (ctx.chat.type !== 'group' && ctx.chat.type !== 'supergroup') {
          console.log('Leaderboard command rejected: Not a group chat');
          return await ctx.reply('This command only works in group chats.');
        }
        
        const chatId = ctx.chat.id;
        console.log(`Fetching leaderboard for chat ${chatId}`);
        
        // Get most active users
        const leaderboard = await Message.aggregate([
          { $match: { chatId: chatId } },
          {
            $group: {
              _id: {
                userId: "$userId",
                username: "$username",
                firstName: "$firstName",
                lastName: "$lastName"
              },
              messageCount: { $sum: 1 },
              firstMessage: { $min: "$date" },
              lastMessage: { $max: "$date" }
            }
          },
          { $sort: { messageCount: -1 } },
          { $limit: 10 }
        ]).exec();
        
        if (!leaderboard || leaderboard.length === 0) {
          return await ctx.reply('No messages have been tracked in this chat yet. Send some messages first!');
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
        
        // Create leaderboard message with medals
        const leaderboardMessage = `
🏆 *Message Leaderboard for "${ctx.chat.title}"*

${leaderboard.map((user, index) => {
  let prefix = `${index + 1}.`;
  if (index === 0) prefix = '🥇';
  if (index === 1) prefix = '🥈';
  if (index === 2) prefix = '🥉';
  
  const activity = Math.round((Date.now() - new Date(user.firstMessage).getTime()) / (1000 * 60 * 60 * 24));
  const messagesPerDay = activity > 0 ? Math.round((user.messageCount / activity) * 10) / 10 : user.messageCount;
  
  return `${prefix} ${formatUserName(user)}: ${user.messageCount} messages${activity > 0 ? ` (${messagesPerDay}/day)` : ''}`;
}).join('\n')}

_Tracking messages since bot was added to the group_
_Use /stats for group sentiment analysis_`;
        
        await ctx.reply(leaderboardMessage, { parse_mode: 'Markdown' });
      } catch (error) {
        console.error(`Error in leaderboard command for chat ${ctx.chat.id}:`, error);
        console.error('Error stack:', error.stack);
        await ctx.reply('Sorry, there was an error generating the leaderboard. Please try again in a few minutes.');
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