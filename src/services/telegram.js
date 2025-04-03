const { Telegraf } = require('telegraf');
const Message = require('../models/Message');
const { analyzeMessage, isOpenAIServiceAvailable, getOpenAIErrorStatus } = require('./openai');
const { isDBConnected } = require('../config/database');
const axios = require('axios');
require('dotenv').config();

// Owner Telegram ID and authorized chats
const OWNER_ID = 5348052974;
const authorizedChats = new Set();

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

// Check if a user is authorized to use the bot
const isAuthorizedUser = (userId) => {
  return userId === OWNER_ID;
};

// Check if a chat is authorized
const isAuthorizedChat = (chatId) => {
  return authorizedChats.has(chatId);
};

// Function to authorize a chat
const authorizeChat = (chatId) => {
  authorizedChats.add(chatId);
  console.log(`Chat ${chatId} has been authorized`);
};

// Function to check if the current user is an admin of the group
const isUserAdmin = async (ctx) => {
  try {
    if (!ctx.chat || ctx.chat.type === 'private') return false;
    
    const userId = ctx.from.id;
    const chatId = ctx.chat.id;
    
    const chatMember = await ctx.telegram.getChatMember(chatId, userId);
    return ['creator', 'administrator'].includes(chatMember.status);
  } catch (error) {
    console.error(`Error checking admin status: ${error.message}`);
    return false;
  }
};

// Function to check authorization and leave unauthorized groups
const checkGroupAuthorization = async (ctx) => {
  if (!ctx.chat || ctx.chat.type === 'private') return true;
  
  const chatId = ctx.chat.id;
  
  // If chat is already authorized, allow it
  if (isAuthorizedChat(chatId)) return true;
  
  try {
    // Get the chat admins
    const admins = await ctx.telegram.getChatAdministrators(chatId);
    
    // Check if the owner is an admin
    const ownerIsAdmin = admins.some(admin => admin.user.id === OWNER_ID);
    
    if (ownerIsAdmin) {
      // Authorize this chat as the owner is an admin
      authorizeChat(chatId);
      return true;
    } else {
      // Owner is not an admin, leave the group
      await ctx.reply('This bot is private and can only be used in groups where the owner is an admin. The bot will now leave this group.');
      await ctx.telegram.leaveChat(chatId);
      console.log(`Bot left unauthorized group: ${ctx.chat.title} (${chatId})`);
      return false;
    }
  } catch (error) {
    console.error(`Error checking group authorization: ${error.message}`);
    
    // On error, default to leaving the group to be safe
    try {
      await ctx.reply('Unable to verify authorization. This bot will leave this group.');
      await ctx.telegram.leaveChat(chatId);
    } catch (leaveError) {
      console.error(`Error leaving chat: ${leaveError.message}`);
    }
    
    return false;
  }
};

// Helper to format service status message
const formatServiceStatusMessage = () => {
  const status = getServiceStatus();
  return `
🤖 *Bot Health Status*
${status.botInitialized ? '- Bot: ✅ Running' : ''}
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
        { command: 'leaderboard', description: 'Show top users by quality score' },
        { command: 'health', description: 'Check bot service health' },
        { command: 'price', description: 'Check price of a crypto coin' }
      ]);
    } catch (error) {
      console.error(`Failed to set bot commands: ${error.message}`);
      // Continue despite this error
    }

    // Owner-only admin commands
    bot.command('authorize', async (ctx) => {
      try {
        // Only owner can run this command
        if (ctx.from.id !== OWNER_ID) {
          await ctx.reply('This command is only available to the bot owner.');
          return;
        }
        
        // Check command format
        const args = ctx.message.text.split(' ');
        if (args.length < 2) {
          await ctx.reply('Usage: /authorize <chat_id>');
          return;
        }
        
        const chatIdToAuthorize = parseInt(args[1], 10);
        if (isNaN(chatIdToAuthorize)) {
          await ctx.reply('Invalid chat ID. Please provide a valid numeric chat ID.');
          return;
        }
        
        // Authorize the chat
        authorizeChat(chatIdToAuthorize);
        await ctx.reply(`Chat ID ${chatIdToAuthorize} has been authorized.`);
      } catch (error) {
        console.error(`Error handling authorize command: ${error.message}`);
        await ctx.reply('Error processing command.');
      }
    });
    
    bot.command('deauthorize', async (ctx) => {
      try {
        // Only owner can run this command
        if (ctx.from.id !== OWNER_ID) {
          await ctx.reply('This command is only available to the bot owner.');
          return;
        }
        
        // Check command format
        const args = ctx.message.text.split(' ');
        if (args.length < 2) {
          await ctx.reply('Usage: /deauthorize <chat_id>');
          return;
        }
        
        const chatIdToDeauthorize = parseInt(args[1], 10);
        if (isNaN(chatIdToDeauthorize)) {
          await ctx.reply('Invalid chat ID. Please provide a valid numeric chat ID.');
          return;
        }
        
        // Deauthorize the chat
        if (authorizedChats.has(chatIdToDeauthorize)) {
          authorizedChats.delete(chatIdToDeauthorize);
          await ctx.reply(`Chat ID ${chatIdToDeauthorize} has been deauthorized.`);
          console.log(`Chat ${chatIdToDeauthorize} has been deauthorized`);
        } else {
          await ctx.reply(`Chat ID ${chatIdToDeauthorize} was not authorized.`);
        }
      } catch (error) {
        console.error(`Error handling deauthorize command: ${error.message}`);
        await ctx.reply('Error processing command.');
      }
    });
    
    bot.command('listauth', async (ctx) => {
      try {
        // Only owner can run this command
        if (ctx.from.id !== OWNER_ID) {
          await ctx.reply('This command is only available to the bot owner.');
          return;
        }
        
        if (authorizedChats.size === 0) {
          await ctx.reply('No chats are currently authorized.');
          return;
        }
        
        const authList = Array.from(authorizedChats).join('\n');
        await ctx.reply(`Authorized chat IDs:\n${authList}`);
      } catch (error) {
        console.error(`Error handling listauth command: ${error.message}`);
        await ctx.reply('Error processing command.');
      }
    });

    // Handle start command
    bot.command('start', async (ctx) => {
      try {
        // Check if the user is the owner for private chats
        if (ctx.chat.type === 'private') {
          if (isAuthorizedUser(ctx.from.id)) {
            await ctx.reply('Hello! I track and analyze messages in groups. Add me to a group to start working!');
          } else {
            await ctx.reply('This is a private bot. Only the owner can use it.');
          }
        } else {
          // For groups, check authorization
          const isAuthorized = await checkGroupAuthorization(ctx);
          if (isAuthorized) {
            await ctx.reply(`Hello! I'm now tracking and analyzing messages in this group (${ctx.chat.title}).`);
            console.log(`Bot initialized in authorized group: ${ctx.chat.title} (${ctx.chat.id})`);
          }
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
          '/leaderboard - Show top users ranked by quality score\n' +
          '/health - Check bot service health\n' +
          '/price <coin> - Check current price of a cryptocurrency'
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
        
        // Determine overall sentiment tone
        let overallTone = "neutral";
        if (sentimentPercentages.positive > sentimentPercentages.negative && 
            sentimentPercentages.positive > sentimentPercentages.neutral) {
          overallTone = "positive";
        } else if (sentimentPercentages.negative > sentimentPercentages.positive && 
                  sentimentPercentages.negative > sentimentPercentages.neutral) {
          overallTone = "negative";
        }
        
        // Format sentiment numbers
        const sentiments = ['positive', 'negative', 'neutral'];
        const sentimentNumbers = sentiments.map((sentiment, index) => {
          return `${index + 1}. ${sentiment}: ${sentimentData[sentiment] || 0}`;
        }).join('\n');
        
        // Format sentiment visualization with numbers
        const sentimentBars = sentiments.map((sentiment, index) => {
          const percentage = sentimentPercentages[sentiment] || 0;
          const barLength = Math.max(1, Math.round(percentage / 5)); // 1 bar per 5%
          const bar = '█'.repeat(barLength);
          return `${index + 1}. ${sentiment}: ${bar} ${percentage}%`;
        }).join('\n');
        
        // Check for crypto-related topics
        const cryptoTopics = stats.topics
          .filter(t => /bitcoin|btc|eth|ethereum|crypto|token|blockchain|solana|sol|nft|defi|trading|coin/i.test(t._id))
          .slice(0, 5);
        
        // Build the stats message with focus on sentiment
        const statsMessage = `
📊 *Sentiment Analysis for "${ctx.chat.title}"*

${sentimentNumbers}

*Overall sentiment:* The group has a predominantly ${overallTone} tone (${sentimentPercentages[overallTone]}%)

${sentimentBars}

*Chat Activity:*
- Total messages: ${stats.totalMessages}
- Active users: ${stats.uniqueUsers}
- Messages per user: ${stats.uniqueUsers ? Math.round(stats.totalMessages / stats.uniqueUsers * 10) / 10 : 0}
- Analysis period: Last ${Math.min(stats.totalMessages, 1000)} messages

${cryptoTopics.length > 0 ? `*Crypto Topics:*
${cryptoTopics.map((t, i) => `${i+1}. ${t._id}: ${t.count} mentions (${Math.round(t.count/stats.totalMessages*100)}% of messages)`).join('\n')}` : ''}

_Use /topics for detailed topic analysis_`;
        
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

    // Add price command to check cryptocurrency prices
    bot.command('price', async (ctx) => {
      try {
        const args = ctx.message.text.split(' ');
        let symbol = '';
        
        if (args.length > 1) {
          symbol = args[1].toLowerCase().trim();
        } else {
          return await ctx.reply('Please specify a cryptocurrency symbol. Example: /price btc');
        }
        
        console.log(`Price command received for ${symbol} in chat ${ctx.chat.id}`);
        
        // Fetch price data from CoinGecko API
        try {
          const response = await axios.get(`https://api.coingecko.com/api/v3/simple/price?ids=${symbol},${symbol}-token&vs_currencies=usd&include_24hr_change=true&include_market_cap=true`);
          
          // Try to match the symbol to a response key
          let coinData = null;
          if (response.data[symbol]) {
            coinData = response.data[symbol];
          } else if (response.data[`${symbol}-token`]) {
            coinData = response.data[`${symbol}-token`];
          }
          
          if (!coinData || !coinData.usd) {
            // If primary lookup fails, try searching by ID
            const searchResponse = await axios.get(`https://api.coingecko.com/api/v3/search?query=${symbol}`);
            
            if (searchResponse.data.coins && searchResponse.data.coins.length > 0) {
              const coinId = searchResponse.data.coins[0].id;
              const detailedResponse = await axios.get(`https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd&include_24hr_change=true&include_market_cap=true`);
              coinData = detailedResponse.data[coinId];
            }
          }
          
          if (coinData && coinData.usd) {
            const priceChangeEmoji = coinData.usd_24h_change > 0 ? '📈' : 
                                    coinData.usd_24h_change < 0 ? '📉' : '➖';
                                    
            const marketCapFormatted = coinData.usd_market_cap ? 
              `$${(coinData.usd_market_cap / 1000000).toFixed(2)}M` : 'Unknown';
              
            const message = `
💲 *${symbol.toUpperCase()} Price Info*

Current Price: $${coinData.usd.toLocaleString()}
24h Change: ${coinData.usd_24h_change ? coinData.usd_24h_change.toFixed(2) + '%' : 'Unknown'} ${priceChangeEmoji}
Market Cap: ${marketCapFormatted}

_Data from CoinGecko_
`;
            await ctx.reply(message, { parse_mode: 'Markdown' });
          } else {
            await ctx.reply(`Could not find price data for ${symbol.toUpperCase()}. Please check the symbol and try again.`);
          }
        } catch (apiError) {
          console.error(`Error fetching price data: ${apiError.message}`);
          await ctx.reply('Sorry, there was an error fetching price data. CoinGecko API might be rate limited. Please try again later.');
        }
      } catch (error) {
        console.error(`Error handling price command: ${error.message}`);
        await ctx.reply('Sorry, there was an error processing your request. Please try again later.');
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
        console.log(`Fetching quality-based leaderboard for chat ${chatId}`);
        
        // Send a processing message
        let processingMsg;
        try {
          processingMsg = await ctx.reply('⏳ Processing quality scores and creating leaderboard...');
        } catch (msgError) {
          console.error(`Error sending processing message: ${msgError.message}`);
          processingMsg = null;
        }
        
        try {
          // Get leaderboard data using the new quality-based method
          const leaderboard = await Message.getChatLeaderboard(chatId, 10);
          
          if (!leaderboard || leaderboard.length === 0) {
            if (processingMsg) {
              try {
                await ctx.telegram.deleteMessage(ctx.chat.id, processingMsg.message_id);
              } catch (deleteError) {
                console.error(`Error deleting processing message: ${deleteError.message}`);
              }
            }
            return await ctx.reply('No messages have been tracked in this chat yet. Send some messages first!');
          }
          
          // Helper function to escape special Markdown characters
          const escapeMarkdown = (text) => {
            if (!text) return '';
            return text.toString().replace(/([_*\[\]()~`>#+\-=|{}.!])/g, '\\$1');
          };
          
          // Format user names with safer access and escape Markdown
          const formatUserName = (user) => {
            try {
              if (user && user._id) {
                if (user._id.username) {
                  return escapeMarkdown(`@${user._id.username}`);
                } else {
                  const firstName = user._id.firstName || '';
                  const lastName = user._id.lastName || '';
                  return escapeMarkdown(`${firstName} ${lastName}`.trim() || `User ${user._id.userId || 'unknown'}`);
                }
              }
              return 'Unknown User';
            } catch (error) {
              console.error('Error formatting user name:', error);
              return 'Unknown User';
            }
          };
          
          // Create leaderboard entries one by one, safely
          let leaderboardEntries = '';
          for (let index = 0; index < leaderboard.length; index++) {
            try {
              const user = leaderboard[index];
              let prefix = `${index + 1}\.`;
              if (index === 0) prefix = '🥇';
              if (index === 1) prefix = '🥈';
              if (index === 2) prefix = '🥉';
              
              const qualityBadge = user.averagePoints >= 10 ? '⭐️ ' : 
                                  user.averagePoints >= 5 ? '✨ ' : '';
              
              const userName = formatUserName(user);
              const userEntry = `${prefix} ${qualityBadge}${userName}: ${user.totalPoints} pts\n   ${user.messageCount} messages, ${user.averagePoints} avg score`;
              
              leaderboardEntries += userEntry + '\n\n';
            } catch (userError) {
              console.error(`Error formatting leaderboard entry for index ${index}:`, userError);
              leaderboardEntries += `${index + 1}. Error formatting user\n\n`;
            }
          }
          
          // Create leaderboard message with HTML formatting instead of Markdown
          const leaderboardMessage = `
🏆 <b>Quality-Based Leaderboard for "${escapeMarkdown(ctx.chat.title)}"</b>

${leaderboardEntries}
<b>How points are earned:</b>
- Content quality and relevance 
- Positive sentiment and helpfulness
- Relevant topic discussions
- Asking thoughtful questions
- Sharing valuable information

<i>Tracking quality-based points since bot was added</i>`;
          
          // Delete the processing message
          if (processingMsg) {
            try {
              await ctx.telegram.deleteMessage(ctx.chat.id, processingMsg.message_id);
            } catch (deleteError) {
              console.error(`Error deleting processing message: ${deleteError.message}`);
              // Continue despite deletion error
            }
          }
          
          // Send the leaderboard message using HTML parse mode instead of Markdown
          console.log(`Sending leaderboard message to chat ${chatId}`);
          await ctx.reply(leaderboardMessage, { parse_mode: 'HTML' });
        } catch (dbError) {
          console.error(`Database error in leaderboard command for chat ${ctx.chat.id}:`, dbError);
          if (processingMsg) {
            try {
              await ctx.telegram.deleteMessage(ctx.chat.id, processingMsg.message_id);
            } catch (deleteError) {
              console.error(`Error deleting processing message: ${deleteError.message}`);
            }
          }
          
          // Send a simplified error message without any formatting
          await ctx.reply(`Sorry, there was an error generating the leaderboard. Please try again in a few minutes.`);
          
          throw new Error(`Database error: ${dbError.message}`);
        }
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
        if (!ctx.chat || (ctx.chat.type !== 'group' && ctx.chat.type !== 'supergroup')) {
          return;
        }
        
        // Check group authorization
        const isAuthorized = await checkGroupAuthorization(ctx);
        if (!isAuthorized) return;
        
        // Skip if database is not connected
        if (!isDBConnected()) {
          console.log(`Skipping message processing: Database not connected (Chat: ${ctx.chat.title})`);
          return;
        }

        // Skip non-text messages
        if (!ctx.message || !ctx.message.text) {
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
        let analysis;
        try {
          analysis = await analyzeMessage(messageData.text);
          if (!analysis) {
            throw new Error('Received null or undefined from analyzeMessage');
          }
        } catch (aiError) {
          console.error(`OpenAI analysis error: ${aiError.message}`);
          // Provide fallback analysis to avoid database validation errors
          analysis = {
            sentiment: 'neutral',
            topics: [],
            intent: 'statement',
            cryptoSentiment: 'neutral',
            mentionedCoins: [],
            scamIndicators: [],
            priceTargets: {}
          };
        }
        
        messageData.analysis = analysis;
        
        // Calculate message quality score
        let qualityScore = 1; // Default score
        try {
          qualityScore = Message.calculateQualityScore(messageData.text, analysis);
        } catch (scoreError) {
          console.error(`Error calculating quality score: ${scoreError.message}`);
        }
        
        messageData.qualityScore = qualityScore;
        
        // Log analysis results and quality score
        console.log(`Message analysis for chat ${ctx.chat.id}:`, {
          sentiment: analysis.sentiment,
          topics: analysis.topics ? analysis.topics.slice(0, 3) : [],
          intent: analysis.intent,
          cryptoSentiment: analysis.cryptoSentiment,
          mentionedCoins: analysis.mentionedCoins ? analysis.mentionedCoins.slice(0, 3) : [],
          qualityScore: qualityScore
        });
        
        // Ensure fields conform to schema requirements
        if (!['positive', 'negative', 'neutral', 'unknown'].includes(messageData.analysis.sentiment)) {
          messageData.analysis.sentiment = 'neutral';
        }
        
        if (!['question', 'statement', 'command', 'greeting', 'opinion', 'other', 'unknown'].includes(messageData.analysis.intent)) {
          messageData.analysis.intent = 'statement';
        }
        
        if (!['bullish', 'bearish', 'neutral', 'unknown'].includes(messageData.analysis.cryptoSentiment)) {
          messageData.analysis.cryptoSentiment = 'neutral';
        }
        
        // Save message to database
        try {
          const savedMessage = await new Message(messageData).save();
          console.log(`Saved message ${savedMessage.messageId} from chat ${savedMessage.chatId} (${ctx.chat.title}) with quality score: ${qualityScore}`);
        } catch (dbError) {
          console.error(`Error saving message to database: ${dbError.message}`);
          console.error('Database error details:', dbError);
          console.error('Message data causing error:', JSON.stringify({
            chatId: messageData.chatId,
            userId: messageData.userId,
            text: messageData.text.substring(0, 20) + '...',
            analysis: {
              sentiment: messageData.analysis.sentiment,
              intent: messageData.analysis.intent,
              cryptoSentiment: messageData.analysis.cryptoSentiment,
              topicsCount: messageData.analysis.topics?.length
            }
          }));
        }
      } catch (error) {
        console.error(`Error processing message in chat ${ctx.chat?.id || 'unknown'}:`, error);
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
          // Verify if this group is authorized
          const isAuthorized = await checkGroupAuthorization(ctx);
          
          if (isAuthorized) {
            await ctx.reply(`Hello! I've been added to "${ctx.chat.title}". I'll start tracking and analyzing messages in this group.`);
            console.log(`Bot was added to authorized group: ${ctx.chat.title} (${ctx.chat.id})`);
          }
          // If not authorized, checkGroupAuthorization will handle leaving the group
        }
      } catch (error) {
        console.error(`Error handling new chat members: ${error.message}`);
      }
    });

    // Handle errors
    bot.catch((err, ctx) => {
      console.error(`Telegram bot error: ${err.message}`);
      console.error('Full error object:', JSON.stringify(err, Object.getOwnPropertyNames(err)));
      console.error('Error stack:', err.stack);
      
      // Log context if available
      if (ctx) {
        try {
          console.error('Context chat:', ctx.chat?.id, ctx.chat?.title);
          console.error('Context update:', JSON.stringify(ctx.update));
        } catch (logError) {
          console.error('Error logging context:', logError.message);
        }
      } else {
        console.error('No context available with this error');
      }
      
      // Try to notify user
      try {
        if (ctx && ctx.reply) {
          ctx.reply('Sorry, an error occurred. Our team has been notified.');
        }
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