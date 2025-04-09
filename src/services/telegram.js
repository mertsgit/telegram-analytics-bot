const { Telegraf } = require('telegraf');
const Message = require('../models/Message');
const { analyzeMessage, isOpenAIServiceAvailable, getOpenAIErrorStatus } = require('./openai');
const { isDBConnected, forceReconnect } = require('../config/database');
const axios = require('axios');
require('dotenv').config();

// --- Authorization Configuration ---
const ALLOWED_GROUP_IDS = [
  -2484836322, // Replace with actual negative group ID if needed
  -2521462418,
  -2227569944, // Replace with actual negative group ID if needed
  -2648239653  // Replace with actual negative group ID if needed
];
const OWNER_ID = 5348052974;
// --- End Authorization Configuration ---

// Initialize bot with error handling
let bot;
let botInitialized = false;
let botInfo = null;
let initializationError = null;
let launchRetryCount = 0;
const MAX_LAUNCH_RETRIES = 5;

// Store group admins cache - maps user IDs to groups they admin
let groupAdminsCache = {};
// Cache expiry time - 1 hour
const ADMIN_CACHE_EXPIRY = 60 * 60 * 1000; 

// Cache last accessed group for users in private chat
let userLastGroupCache = {};

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
${status.botInitialized ? '- Bot: ✅ Running' : ''}
- Database: ${status.databaseConnected ? '✅ Connected' : '❌ Disconnected'}
- AI Access: ${status.openAIAvailable ? '✅ Available' : '❌ Unavailable'}
${status.launchRetryCount > 0 ? `- Launch retries: ${status.launchRetryCount}/${MAX_LAUNCH_RETRIES}` : ''}
${status.openAIError ? `- AI Error: ${status.openAIError}` : ''}
${status.initializationError ? `- Error: ${status.initializationError}` : ''}
  `;
};

// Create an inline keyboard for selecting groups
const createGroupSelectionKeyboard = (groups, commandPrefix) => {
  return {
    reply_markup: {
      inline_keyboard: groups.map(group => [
        {
          text: group.title,
          callback_data: `${commandPrefix}:${group.id}`
        }
      ])
    }
  };
};

// Prompt user to select a group in private chat
const promptGroupSelection = async (ctx, userId, commandName) => {
  try {
    const groups = await getGroupsForSelection(userId);
    
    if (!groups || groups.length === 0) {
      return await ctx.reply('You are not an admin or owner in any authorized groups. This feature is only available to group admins and owners.');
    }
    
    // If only one group, automatically select it
    if (groups.length === 1) {
      userLastGroupCache[userId] = groups[0].id;
      return groups[0].id;
    }
    
    // Create message with group selection buttons
    let message = `Please select a group to view ${commandName} for:`;
    const options = createGroupSelectionKeyboard(groups, commandName);
    
    await ctx.reply(message, options);
    return null; // Null indicates selection is pending
  } catch (error) {
    console.error(`Error prompting group selection: ${error.message}`);
    await ctx.reply('Sorry, there was an error getting your groups. Please try again later.');
    return null;
  }
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

// Check if the chat ID is in the allowed list
const isAllowedGroup = (chatId) => {
  // Convert chatId to string for easier manipulation
  const chatIdStr = chatId.toString();
  
  // Check if the chatId starts with -100 (supergroup format)
  // If so, we need to remove this prefix for comparison
  const normalizedChatId = chatIdStr.startsWith('-100') ? 
    parseInt(chatIdStr.substring(4)) * -1 : // Remove -100 prefix and keep it negative
    parseInt(chatIdStr);
  
  console.log(`Normalizing chatId: original=${chatId}, normalized=${normalizedChatId}`);
  
  // Check each allowed ID
  for (const allowedId of ALLOWED_GROUP_IDS) {
    // Try direct match
    if (allowedId === chatId || allowedId === normalizedChatId) {
      console.log(`Group ${chatId} is authorized (matched with ${allowedId})`);
      return true;
    }
    
    // Also check string form (handles the -100 prefix case)
    const allowedIdStr = allowedId.toString();
    if (chatIdStr === allowedIdStr || 
        chatIdStr === `-100${allowedIdStr.substring(1)}`) { // Convert -123 to -100123 format
      console.log(`Group ${chatId} is authorized (string matched with ${allowedId})`);
      return true;
    }
  }
  
  console.log(`Group ${chatId} is NOT authorized. Allowed IDs: ${ALLOWED_GROUP_IDS.join(', ')}`);
  return false;
};

// Check if user is an admin in any of the allowed groups
const isGroupAdmin = async (userId) => {
  try {
    // Check cache first
    if (groupAdminsCache[userId] && (Date.now() - groupAdminsCache[userId].timestamp < ADMIN_CACHE_EXPIRY)) {
      console.log(`Using cached admin status for user ${userId}`);
      return groupAdminsCache[userId].isAdmin ? groupAdminsCache[userId].groups : false;
    }
    
    // Not in cache or cache expired, check each allowed group
    console.log(`Checking if user ${userId} is an admin in any allowed groups...`);
    let adminGroups = [];
    
    for (const groupId of ALLOWED_GROUP_IDS) {
      try {
        // For each group ID, we need to convert to the format Telegram expects (-100 prefix for supergroups)
        const formattedGroupId = groupId.toString().startsWith('-100') ? 
          groupId.toString() : 
          `-100${groupId.toString().substring(1)}`;
        
        console.log(`Checking admin status in group ${formattedGroupId}`);
        const chatMember = await bot.telegram.getChatMember(formattedGroupId, userId);
        
        // Check if user is admin or owner in this group
        if (chatMember && (
            chatMember.status === 'creator' || 
            chatMember.status === 'administrator'
          )) {
          console.log(`User ${userId} is ${chatMember.status} in group ${formattedGroupId}`);
          adminGroups.push({
            id: formattedGroupId,
            originalId: groupId,
            role: chatMember.status
          });
        }
      } catch (groupError) {
        console.error(`Error checking admin status in group ${groupId}: ${groupError.message}`);
        // Continue checking other groups
      }
    }
    
    // Update cache
    groupAdminsCache[userId] = {
      isAdmin: adminGroups.length > 0,
      groups: adminGroups.length > 0 ? adminGroups : false,
      timestamp: Date.now()
    };
    
    return adminGroups.length > 0 ? adminGroups : false;
  } catch (error) {
    console.error(`Error checking admin status: ${error.message}`);
    return false;
  }
};

// Get groups where user is admin for display in private chat
const getGroupsForSelection = async (userId) => {
  const adminGroups = await isGroupAdmin(userId);
  
  if (!adminGroups) {
    return null;
  }
  
  // Get group names for each group
  const groupsWithInfo = await Promise.all(
    adminGroups.map(async (group) => {
      try {
        const chatInfo = await bot.telegram.getChat(group.id);
        return {
          ...group,
          title: chatInfo.title || 'Unknown Group'
        };
      } catch (error) {
        console.error(`Error getting group info for ${group.id}: ${error.message}`);
        return {
          ...group,
          title: 'Unknown Group'
        };
      }
    })
  );
  
  return groupsWithInfo;
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

    // Handle start command
    bot.command('start', async (ctx) => {
      try {
        if (ctx.chat.type === 'private') {
          const isOwner = ctx.from.id === OWNER_ID;
          
          // Check if user is a group admin
          const adminGroups = await isGroupAdmin(ctx.from.id);
          
          if (isOwner) {
            // Owner gets full access message
            await ctx.reply('Hello! I track and analyze messages in authorized groups. As the owner, you have full access to all commands and group statistics. Use /help to see available commands.');
          } else if (adminGroups) {
            // Group admin gets special access message
            const groupsWithInfo = await getGroupsForSelection(ctx.from.id);
            const groupsList = groupsWithInfo.map(g => `- ${g.title}`).join('\n');
            
            const message = `
Hello! I track and analyze messages in authorized groups.

You are an admin in the following groups:
${groupsList}

As a group admin, you can use the following commands in this private chat:
• /stats - View sentiment analysis and stats for your groups
• /topics - Show topic categories in your groups
• /leaderboard - View quality-based user rankings
• /health - Check bot health and your admin groups
• /price - Check cryptocurrency prices

Just use any command, and I'll ask you which group you want to view information for.
`;
            await ctx.reply(message);
          } else {
            // Regular user gets standard message
            await ctx.reply('Hello! I track and analyze messages in authorized groups. Use /help to see commands.');
          }
        } else {
          // Group chat check
          const chatIdForCheck = ctx.chat?.id;
          const isGroupAllowed = chatIdForCheck ? isAllowedGroup(chatIdForCheck) : false;
          
          if (isGroupAllowed) {
            const privacyMessage = `
Hello! I'm now tracking and analyzing messages in this group (${ctx.chat.title}).

<b>Privacy Notice:</b>
• This bot tracks and analyzes messages in this group
• Messages are stored in a database for analysis
• We analyze message content, sentiment and topics
• All data is used only for generating group stats
• No personal data is shared with third parties

Use /help to see available commands.`;
            
            await ctx.reply(privacyMessage, { parse_mode: 'HTML' });
            console.log(`Bot initialized in allowed group: ${ctx.chat.title} (${ctx.chat.id})`);
          } else {
              // If started in an unauthorized group (shouldn't happen if new_chat_members works)
              await ctx.reply('Sorry, this bot is restricted to specific groups.');
              await ctx.leaveChat();
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
        const isOwner = ctx.from.id === OWNER_ID;
        const isPrivateChat = ctx.chat.type === 'private';
        const adminGroups = isPrivateChat ? await isGroupAdmin(ctx.from.id) : false;
        
        // Different help messages based on user role and chat type
        if (isPrivateChat && (isOwner || adminGroups)) {
          // Owner or admin in private chat
          const adminHelpMessage = `
📋 *Available Commands*

Group Analysis Commands (work in private chat or groups):
• /stats - View sentiment analysis and message statistics
• /topics - Show categorized topics in the chat
• /leaderboard - Show top users ranked by quality score
• /price <coin> - Check current price of a cryptocurrency

System Commands:
• /start - Start the bot
• /help - Show this help message
• /health - Check bot health status

${isOwner ? "As the bot owner, you have full access to all commands and all group data." : "As a group admin, you can use analysis commands in this private chat. You'll be asked which group you want to analyze."}
`;
          await ctx.reply(adminHelpMessage, { parse_mode: 'Markdown' });
        } else {
          // Regular user or in group chat
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
        }
      } catch (error) {
        console.error(`Error handling help command: ${error.message}`);
        await ctx.reply('Sorry, there was an error displaying the help message. Please try again later.');
      }
    });

    // Handle health command (Allowed in groups or by owner)
    bot.command('health', async (ctx) => {
      try {
        const isOwner = ctx.from.id === OWNER_ID;
        
        // Check authorization
        if (!isAllowedGroup(ctx.chat.id) && !isOwner) {
          // If not in allowed group or owner, check if user is admin in any allowed group
          const adminGroups = await isGroupAdmin(ctx.from.id);
          
          if (!adminGroups) {
            return await ctx.reply('Sorry, this command is restricted.');
          }
          
          // User is admin in allowed groups, show basic health plus their groups
          const groupsWithInfo = await getGroupsForSelection(ctx.from.id);
          const groupsList = groupsWithInfo.map(g => `- ${g.title} (${g.role})`).join('\n');
          
          const message = `
${formatServiceStatusMessage()}

🔑 *Your Admin Groups:*
${groupsList}

_You can use commands like /stats, /topics and /leaderboard in private chat with me to get information about these groups._
          `;
          
          return await ctx.reply(message, { parse_mode: 'Markdown' });
        }
        
        // For owner, show full health status
        await ctx.reply(formatServiceStatusMessage(), { parse_mode: 'Markdown' });
      } catch (error) {
        console.error(`Error handling health command: ${error.message}`);
        await ctx.reply('Sorry, there was an error checking the service health.');
      }
    });

    // Handle stats command (Allowed groups only)
    bot.command('stats', async (ctx) => {
      try {
        console.log(`Stats command received in chat ${ctx.chat.id} (${ctx.chat.title || 'Private Chat'}) by user ${ctx.from.id}`);
        
        // Private chat handling for group admins
        if (ctx.chat.type === 'private') {
          console.log(`Stats command in private chat from user ${ctx.from.id}`);
          const isOwner = ctx.from.id === OWNER_ID;
          
          if (!isOwner) {
            // Check if user is admin in any allowed groups
            const selectedGroupId = await promptGroupSelection(ctx, ctx.from.id, 'stats');
            
            if (!selectedGroupId) {
              // Selection is pending or user has no authorized groups
              return;
            }
            
            // Override chat context with the selected group
            ctx.chat.id = selectedGroupId;
            // Store original chat type to help with checks later
            ctx.originalChatType = 'private';
            console.log(`Selected group for stats: ${selectedGroupId}`);
          } else {
            // For owner, always prompt to select a group
            const groups = await Promise.all(ALLOWED_GROUP_IDS.map(async (groupId) => {
              try {
                // Format group ID with -100 prefix if needed
                const formattedGroupId = groupId.toString().startsWith('-100') ? 
                  groupId.toString() : 
                  `-100${groupId.toString().substring(1)}`;
                
                const chatInfo = await bot.telegram.getChat(formattedGroupId);
                return {
                  id: formattedGroupId,
                  originalId: groupId,
                  role: 'owner',
                  title: chatInfo.title || 'Unknown Group'
                };
              } catch (error) {
                console.error(`Error getting group info for ${groupId}: ${error.message}`);
                return {
                  id: formattedGroupId,
                  originalId: groupId,
                  role: 'owner',
                  title: 'Unknown Group'
                };
              }
            }));
            
            // Create message with group selection buttons
            let message = 'Please select a group to view stats for:';
            const options = createGroupSelectionKeyboard(groups, 'stats');
            
            await ctx.reply(message, options);
            return;
          }
        }
        
        // --- Authorization Check ---
        // Debug logging for authorization check
        const chatIdForCheck = ctx.chat.id;
        const isGroupAllowed = isAllowedGroup(chatIdForCheck);
        const isOwner = ctx.from.id === OWNER_ID;
        console.log(`[Stats Auth] Checking chatId: ${chatIdForCheck} (Type: ${typeof chatIdForCheck}), Allowed: ${isGroupAllowed}, IsOwner: ${isOwner}`);
        console.log(`[Stats Auth] ALLOWED_GROUP_IDS: ${ALLOWED_GROUP_IDS} (Type: ${typeof ALLOWED_GROUP_IDS[0]})`);
        
        if (!isGroupAllowed && !isOwner) {
          console.log(`Stats command rejected: Unauthorized group ${chatIdForCheck} and not owner`);
          return await ctx.reply('This command can only be used in authorized groups.');
        }
        // --- End Authorization Check ---

        // Check if database is connected
        if (!isDBConnected()) {
          // Try to force a reconnection before failing
          const reconnected = await forceReconnect();
          
          if (!reconnected) {
            return await ctx.reply('⚠️ Database connection is unavailable. Stats cannot be retrieved at this time.');
          } else {
            await ctx.reply('✅ Database connection restored. Generating stats...');
          }
        }

        // Only enforce group chat type check if not in private chat mode
        const originalChatType = ctx.originalChatType || ctx.chat.type;
        if (originalChatType !== 'private' && ctx.chat.type !== 'group' && ctx.chat.type !== 'supergroup') {
          console.log('Stats command rejected: Not a group chat');
          return await ctx.reply('This command only works in group chats.');
        }
        
        const chatId = ctx.chat.id;
        console.log(`Fetching stats for chat ${chatId}`);
        
        // Convert the group ID to the right format for database queries
        // This is likely the key issue - we need to ensure the format matches what's in the DB
        console.log(`Original groupId: ${chatId}`);
        
        // Use the static method to get chat stats
        let stats = await Message.getChatStats(chatId);
        
        // If no results, try with normalized format (removing -100 prefix if it exists)
        if (!stats || stats.totalMessages === 0) {
          const normalizedGroupId = chatId.toString().startsWith('-100') ? 
            parseInt(chatId.toString().substring(4)) * -1 : 
            parseInt(chatId);
          
          console.log(`No stats found with original ID. Trying normalized groupId: ${normalizedGroupId}`);
          const normalizedStats = await Message.getChatStats(normalizedGroupId);
          
          if (!normalizedStats || normalizedStats.totalMessages === 0) {
            return await ctx.reply(`No messages have been tracked in ${ctx.chat.title} yet.`);
          }
          
          // Use the normalized stats if found
          stats = normalizedStats;
        }
        
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
        
        // Check for crypto-related topics
        const cryptoTopics = stats.topics
          .filter(t => /bitcoin|btc|eth|ethereum|crypto|token|blockchain|solana|sol|nft|defi|trading|coin/i.test(t._id))
          .slice(0, 5);
        
        // Build the stats message with focus on sentiment
        const statsMessage = `
📊 *Sentiment Analysis for "${ctx.chat.title}"*

*Sentiment Breakdown:*
${sentiments.map(s => `- ${s.charAt(0).toUpperCase() + s.slice(1)}: ${sentimentPercentages[s]}% (${sentimentData[s] || 0} messages)`).join('\n')}

*Overall sentiment:* The group has a predominantly ${overallTone} tone (${sentimentPercentages[overallTone]}%)

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
    
    // Handle topics command (Allowed groups only)
    bot.command('topics', async (ctx) => {
      try {
        console.log(`Topics command received in chat ${ctx.chat.id} (${ctx.chat.title || 'Private Chat'}) by user ${ctx.from.id}`);
        
        // Private chat handling for group admins
        if (ctx.chat.type === 'private') {
          console.log(`Topics command in private chat from user ${ctx.from.id}`);
          const isOwner = ctx.from.id === OWNER_ID;
          
          if (!isOwner) {
            // Check if user is admin in any allowed groups
            const selectedGroupId = await promptGroupSelection(ctx, ctx.from.id, 'topics');
            
            if (!selectedGroupId) {
              // Selection is pending or user has no authorized groups
              return;
            }
            
            // Override chat context with the selected group
            ctx.chat.id = selectedGroupId;
            // Store original chat type to help with checks later
            ctx.originalChatType = 'private';
            console.log(`Selected group for topics: ${selectedGroupId}`);
          } else {
            // For owner, prompt to select a group
            const groups = await Promise.all(ALLOWED_GROUP_IDS.map(async (groupId) => {
              try {
                // Format group ID with -100 prefix if needed
                const formattedGroupId = groupId.toString().startsWith('-100') ? 
                  groupId.toString() : 
                  `-100${groupId.toString().substring(1)}`;
                
                const chatInfo = await bot.telegram.getChat(formattedGroupId);
                return {
                  id: formattedGroupId,
                  originalId: groupId,
                  role: 'owner',
                  title: chatInfo.title || 'Unknown Group'
                };
              } catch (error) {
                console.error(`Error getting group info for ${groupId}: ${error.message}`);
                return {
                  id: formattedGroupId,
                  originalId: groupId,
                  role: 'owner',
                  title: 'Unknown Group'
                };
              }
            }));
            
            // Create message with group selection buttons
            let message = 'Please select a group to view topics for:';
            const options = createGroupSelectionKeyboard(groups, 'topics');
            
            await ctx.reply(message, options);
            return;
          }
        }
        
        // --- Authorization Check ---
        // Debug logging for authorization check
        const chatIdForCheck = ctx.chat.id;
        const isGroupAllowed = isAllowedGroup(chatIdForCheck);
        const isOwner = ctx.from.id === OWNER_ID;
        console.log(`[Topics Auth] Checking chatId: ${chatIdForCheck} (Type: ${typeof chatIdForCheck}), Allowed: ${isGroupAllowed}, IsOwner: ${isOwner}`);
        console.log(`[Topics Auth] ALLOWED_GROUP_IDS: ${ALLOWED_GROUP_IDS} (Type: ${typeof ALLOWED_GROUP_IDS[0]})`);
        
        if (!isGroupAllowed && !isOwner) {
          console.log(`Topics command rejected: Unauthorized group ${chatIdForCheck} and not owner`);
          return await ctx.reply('This command can only be used in authorized groups.');
        }
        // --- End Authorization Check ---

        // Check if database is connected
        if (!isDBConnected()) {
          // Try to force a reconnection before failing
          const reconnected = await forceReconnect();
          
          if (!reconnected) {
            return await ctx.reply('⚠️ Database connection is unavailable. Topics cannot be retrieved at this time.');
          } else {
            await ctx.reply('✅ Database connection restored. Generating topic analysis...');
          }
        }

        // Only enforce group chat type check if not in private chat mode
        const originalChatType = ctx.originalChatType || ctx.chat.type;
        if (originalChatType !== 'private' && ctx.chat.type !== 'group' && ctx.chat.type !== 'supergroup') {
          console.log('Topics command rejected: Not a group chat');
          return await ctx.reply('This command only works in group chats.');
        }
        
        const chatId = ctx.chat.id;
        console.log(`Fetching topics for chat ${chatId}`);
        
        // Get topics using the static method
        let topics = await Message.getChatTopics(chatId);
        
        // If no results, try with normalized format (removing -100 prefix if it exists)
        if (!topics || topics.length === 0) {
          const normalizedGroupId = chatId.toString().startsWith('-100') ? 
            parseInt(chatId.toString().substring(4)) * -1 : 
            parseInt(chatId);
          
          console.log(`No topics found with original ID. Trying normalized groupId: ${normalizedGroupId}`);
          const normalizedTopics = await Message.getChatTopics(normalizedGroupId);
          
          if (!normalizedTopics || normalizedTopics.length === 0) {
            return await ctx.reply(`No topics have been identified in ${ctx.chat.title} yet.`);
          }
          
          // Use the normalized topics if found
          topics = normalizedTopics;
        }
        
        if (!topics || topics.length === 0) {
          return await ctx.reply('No topics have been identified in this chat yet. Send some messages first!');
        }
        
        // Categorize topics
        const categories = {
          memecoin: {
            name: "🚀 Memecoin/Shitcoin",
            topics: [],
            regex: /pump|dump|moon|token|pepe|doge|elon|frog|cat|meme|shit(coin)?|gem|safu|airdrop|presale|mint|launch|jeet|rug|x([0-9]+)|([0-9]+)x|contract address|CA:|ca:|CA :|ca :|([A-HJ-NP-Za-km-z1-9]{32,44})|(0x[a-fA-F0-9]{40})|[a-zA-Z0-9]{40,}|[A-Za-z0-9]{32,}(pump)|Inu$|AI$|meme|coin|solana|sol|degen|cope|ngmi|wagmi|fud|hodl|hodler|paperhands|diamond hands|shill|mooning|ath|floor|flipping|flipped/i
          },
          crypto: {
            name: "💰 Cryptocurrency",
            topics: [],
            regex: /bitcoin|btc|eth|ethereum|crypto|blockchain|solana|sol|nft|defi|trading|coin|market|price|bull|bear|wallet|exchange|dex|binance|chainlink|link|cardano|ada|xrp|usdt|usdc|stablecoin|buy|sell|mcap|market ?cap|liquidity|LP|chart|candle|cex|volume|resistance|support|trend|breakout|reversal|correction|ath|consolidation|accumulation|distribution|whale|ta|technical analysis|fa|fundamental analysis/i
          },
          technology: {
            name: "💻 Technology",
            topics: [],
            regex: /tech|software|hardware|web|app|code|developer|programming|ai|computer|internet|mobile|website|digital|online|device|gadget|electronics/i
          },
          finance: {
            name: "📈 Finance/Markets",
            topics: [],
            regex: /stock|finance|market|investing|investment|fund|bank|money|profit|loss|trader|analysis|portfolio|asset|dividend|gain|revenue|yield|cash/i
          },
          general: {
            name: "🔍 General Topics",
            topics: []
          }
        };
        
        // Helper function to check if a topic is likely a contract address
        const isContractAddress = (topicId) => {
          // Solana addresses (base58 encoded, 32-44 chars)
          if (/^[A-HJ-NP-Za-km-z1-9]{32,44}$/.test(topicId)) {
            return true;
          }
          // Ethereum style addresses (0x followed by 40 hex chars)
          if (/^(0x)?[a-fA-F0-9]{40}$/.test(topicId)) {
            return true;
          }
          // Memecoin contract addresses often have "pump" in them
          if (/^[A-Za-z0-9]{30,}pump$/i.test(topicId)) {
            return true;
          }
          return false;
        };

        // Pre-process topics to identify contract addresses
        topics.forEach(topic => {
          if (isContractAddress(topic._id)) {
            topic.isContract = true;
            topic.contractType = topic._id.startsWith('0x') ? 'ethereum' : 'solana';
          }
        });
        
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
        
        // Helper function to format sentiment emoji
        const getSentimentEmoji = (sentiment) => {
          switch(sentiment) {
            case 'positive': return '😀';
            case 'negative': return '😟';
            case 'neutral': return '😐';
            default: return '🔄';
          }
        };
        
        // Helper function to format trending indicator
        const getTrendingEmoji = (trending) => {
          switch(trending) {
            case 'up': return '📈';
            case 'down': return '📉';
            default: return '➖';
          }
        };
        
        // Helper function to escape markdown
        const escapeTopicMarkdown = (text) => {
          if (!text) return '';
          return text.toString().replace(/([_*\[\]()~`>#+\-=|{}.!])/g, '\\$1');
        };
        
        // Build message with categories and enhanced analysis
        let topicsMessage = `📊 *Advanced Topic Analysis for "${escapeTopicMarkdown(ctx.chat.title)}"*\n\n`;
        
        // Find total topic mentions for percentages
        const totalMentions = topics.reduce((sum, topic) => sum + topic.count, 0);
        
        for (const category of Object.values(categories)) {
          if (category.topics.length > 0) {
            // Get most discussed topic in this category
            const mostDiscussed = [...category.topics].sort((a, b) => b.count - a.count)[0];
            
            topicsMessage += `*${category.name}*`;
            
            if (mostDiscussed.trending === 'up') {
              topicsMessage += ` 🔥 Trending!`;
            }
            
            topicsMessage += `\n`;
            
            // Format each topic with enhanced details
            category.topics.slice(0, 3).forEach((topic, i) => {
              const lastMentioned = new Date(topic.lastMentioned).toLocaleDateString();
              const percentage = Math.round((topic.count / totalMentions) * 100);
              
              // Topic header with stats
              topicsMessage += `${i+1}. *${escapeTopicMarkdown(topic._id)}* ${getTrendingEmoji(topic.trending)}\n`;
              topicsMessage += `   • Mentions: ${topic.count} (${percentage}% of all topics)\n`;
              
              // Only show these fields if they exist (enhanced analysis)
              if (topic.uniqueUserCount) {
                topicsMessage += `   • Discussed by: ${topic.uniqueUserCount} members\n`;
              }
              
              if (topic.dominantSentiment) {
                topicsMessage += `   • Sentiment: ${getSentimentEmoji(topic.dominantSentiment)} ${topic.dominantSentiment}\n`;
              }
              
              // Show related topics if available
              if (topic.relatedTopics && topic.relatedTopics.length > 0) {
                const relatedTopicsList = topic.relatedTopics
                  .map(rt => escapeTopicMarkdown(rt.topic))
                  .join(', ');
                topicsMessage += `   • Related to: ${relatedTopicsList}\n`;
              }
              
              // Add a sample message if available
              if (topic.sampleMessages && topic.sampleMessages.length > 0) {
                const sampleMsg = topic.sampleMessages[0];
                topicsMessage += `   • Example: "_${escapeTopicMarkdown(sampleMsg.text.substring(0, 60))}..._"\n`;
              }
              
              // Add activity info
              if (topic.daysActive && topic.messagesPerDay) {
                topicsMessage += `   • Activity: ${topic.messagesPerDay} msgs/day over ${topic.daysActive} days\n`;
              } else {
                topicsMessage += `   • Last mentioned: ${lastMentioned}\n`;
              }
              
              topicsMessage += '\n';
            });
            
            // If there are more topics in this category, mention them
            if (category.topics.length > 3) {
              const additionalCount = category.topics.length - 3;
              const additionalTopics = category.topics
                .slice(3, 6)
                .map(t => escapeTopicMarkdown(t._id))
                .join(', ');
              
              topicsMessage += `_...and ${additionalCount} more topics including ${additionalTopics}${additionalCount > 3 ? '...' : ''}_\n`;
            }
            
            topicsMessage += '\n';
          }
        }
        
        // Add insights summary
        topicsMessage += `*AI Insights:*\n`;
        
        // Check for contract addresses or apparent token addresses in topics
        const contractLikeTopics = topics.filter(t => isContractAddress(t._id));
        
        if (contractLikeTopics.length > 0) {
          const topContractTopics = contractLikeTopics
            .sort((a, b) => b.count - a.count)
            .slice(0, 3)
            .map(t => {
              // Format contract addresses for readability
              const addr = t._id;
              return escapeTopicMarkdown(addr.substring(0, 8) + '...' + addr.substring(addr.length - 5));
            })
            .join(', ');
          
          const solanaCount = contractLikeTopics.filter(t => !t._id.startsWith('0x')).length;
          const ethereumCount = contractLikeTopics.filter(t => t._id.startsWith('0x')).length;
          
          topicsMessage += `• *Token Activity:* ${contractLikeTopics.length} contract addresses mentioned (${solanaCount} Solana, ${ethereumCount} Ethereum)\n`;
          topicsMessage += `• *Top Tokens:* ${topContractTopics}\n`;
        }
        
        // Analyze memecoin topics for trading patterns
        const memecoinTopics = topics.filter(t => 
          categories.memecoin.regex.test(t._id)
        );
        
        if (memecoinTopics.length > 0) {
          const tradingTerms = ["pump", "moon", "x10", "100x", "buy", "sell", "launch", "mint", "gem", "ath", "floor"];
          const tradingActivity = memecoinTopics.filter(t => 
            tradingTerms.some(term => t._id.toLowerCase().includes(term))
          );
          
          if (tradingActivity.length > 0) {
            const tradingVolume = tradingActivity.reduce((sum, t) => sum + t.count, 0);
            const mostActive = tradingActivity.sort((a, b) => b.count - a.count)[0]?._id || '';
            
            topicsMessage += `• *Trading Activity:* ${tradingActivity.length} tokens with ${tradingVolume} trading signals\n`;
            if (mostActive && !isContractAddress(mostActive)) {
              topicsMessage += `• *Hottest Token:* ${escapeTopicMarkdown(mostActive)}\n`;
            }
          }
          
          // Detect potential new launches
          const launchTerms = ["launch", "presale", "mint", "airdrop", "new"];
          const launchActivity = memecoinTopics.filter(t => 
            launchTerms.some(term => t._id.toLowerCase().includes(term))
          );
          
          if (launchActivity.length > 0) {
            topicsMessage += `• *Launch Activity:* ${launchActivity.length} potential new token launches detected\n`;
          }
        }
        
        // Regular trending topics
        if (topics.some(t => t.trending === 'up')) {
          const trendingTopics = topics
            .filter(t => t.trending === 'up')
            .map(t => escapeTopicMarkdown(t._id))
            .slice(0, 3)
            .join(', ');
          
          topicsMessage += `• *Trending Discussions:* ${trendingTopics}\n`;
        }
        
        // Add sentiment overview
        const positiveSentimentTopics = topics.filter(t => t.dominantSentiment === 'positive').length;
        const negativeSentimentTopics = topics.filter(t => t.dominantSentiment === 'negative').length;
        
        if (positiveSentimentTopics > negativeSentimentTopics) {
          topicsMessage += `• *Sentiment Analysis:* Overall positive discussions across ${positiveSentimentTopics} topics\n`;
        } else if (negativeSentimentTopics > positiveSentimentTopics) {
          topicsMessage += `• *Sentiment Analysis:* Several topics (${negativeSentimentTopics}) show negative sentiment\n`;
        } else {
          topicsMessage += `• *Sentiment Analysis:* Balanced sentiment across discussions\n`;
        }
        
        topicsMessage += `\n_Analysis based on ${totalMentions} topic mentions across ${topics.length} unique topics_`;
        
        // Send message with enhanced topic analysis
        await ctx.reply(topicsMessage, { parse_mode: 'Markdown' });
      } catch (error) {
        console.error(`Error in topics command for chat ${ctx.chat.id}:`, error);
        console.error('Error stack:', error.stack);
        await ctx.reply('Sorry, there was an error generating the topics list. Please try again in a few minutes. If the problem persists, contact the bot administrator.');
      }
    });

    // Add price command (Allowed groups only)
    bot.command('price', async (ctx) => {
      try {
        // Check if we have a coin parameter
        const args = ctx.message.text.split(' ');
        let symbol = '';
        
        if (args.length > 1) {
          symbol = args[1].toLowerCase().trim();
        } else {
          return await ctx.reply('Please specify a cryptocurrency symbol. Example: /price btc');
        }
        
        console.log(`Price command received for ${symbol} in chat ${ctx.chat.id} by user ${ctx.from.id}`);
        
        // Private chat handling for group admins
        if (ctx.chat.type === 'private') {
          console.log(`Price command in private chat from user ${ctx.from.id} for coin ${symbol}`);
          const isOwner = ctx.from.id === OWNER_ID;
          
          if (!isOwner) {
            // Check if user is admin in any allowed groups
            const selectedGroupId = await promptGroupSelection(ctx, ctx.from.id, 'price');
            
            if (!selectedGroupId) {
              // Selection is pending or user has no authorized groups
              return;
            }
            
            // Override chat context with the selected group
            ctx.chat.id = selectedGroupId;
            // Store original chat type to help with checks later
            ctx.originalChatType = 'private';
            console.log(`Selected group for price (${symbol}): ${selectedGroupId}`);
          } else {
            // For owner, skip group selection in price command
            // Just execute as if in an allowed group
            const isGroupAllowed = true;
            const isOwner = true;
          }
        }
        
        // --- Authorization Check ---
        // Debug logging for authorization check
        const chatIdForCheck = ctx.chat.id;
        const isGroupAllowed = isAllowedGroup(chatIdForCheck);
        const isOwner = ctx.from.id === OWNER_ID;
        console.log(`[Price Auth] Checking chatId: ${chatIdForCheck} (Type: ${typeof chatIdForCheck}), Allowed: ${isGroupAllowed}, IsOwner: ${isOwner}`);
        console.log(`[Price Auth] ALLOWED_GROUP_IDS: ${ALLOWED_GROUP_IDS} (Type: ${typeof ALLOWED_GROUP_IDS[0]})`);
        
        if (!isGroupAllowed && !isOwner) {
          console.log(`Price command rejected: Unauthorized group ${chatIdForCheck} and not owner`);
          return await ctx.reply('This command can only be used in authorized groups.');
        }
        // --- End Authorization Check ---

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

    // Add leaderboard command (Allowed groups only)
    bot.command('leaderboard', async (ctx) => {
      try {
        console.log(`Leaderboard command received in chat ${ctx.chat.id} (${ctx.chat.title || 'Private Chat'}) by user ${ctx.from.id}`);
        
        // Private chat handling for group admins
        if (ctx.chat.type === 'private') {
          console.log(`Leaderboard command in private chat from user ${ctx.from.id}`);
          const isOwner = ctx.from.id === OWNER_ID;
          
          if (!isOwner) {
            // Check if user is admin in any allowed groups
            const selectedGroupId = await promptGroupSelection(ctx, ctx.from.id, 'leaderboard');
            
            if (!selectedGroupId) {
              // Selection is pending or user has no authorized groups
              return;
            }
            
            // Override chat context with the selected group
            ctx.chat.id = selectedGroupId;
            // Store original chat type to help with checks later
            ctx.originalChatType = 'private';
            console.log(`Selected group for leaderboard: ${selectedGroupId}`);
          } else {
            // For owner, prompt to select a group
            const groups = await Promise.all(ALLOWED_GROUP_IDS.map(async (groupId) => {
              try {
                // Format group ID with -100 prefix if needed
                const formattedGroupId = groupId.toString().startsWith('-100') ? 
                  groupId.toString() : 
                  `-100${groupId.toString().substring(1)}`;
                
                const chatInfo = await bot.telegram.getChat(formattedGroupId);
                return {
                  id: formattedGroupId,
                  originalId: groupId,
                  role: 'owner',
                  title: chatInfo.title || 'Unknown Group'
                };
              } catch (error) {
                console.error(`Error getting group info for ${groupId}: ${error.message}`);
                return {
                  id: formattedGroupId,
                  originalId: groupId,
                  role: 'owner',
                  title: 'Unknown Group'
                };
              }
            }));
            
            // Create message with group selection buttons
            let message = 'Please select a group to view leaderboard for:';
            const options = createGroupSelectionKeyboard(groups, 'leaderboard');
            
            await ctx.reply(message, options);
            return;
          }
        }
        
        // --- Authorization Check ---
        // Debug logging for authorization check
        const chatIdForCheck = ctx.chat.id;
        const isGroupAllowed = isAllowedGroup(chatIdForCheck);
        const isOwner = ctx.from.id === OWNER_ID;
        console.log(`[Leaderboard Auth] Checking chatId: ${chatIdForCheck} (Type: ${typeof chatIdForCheck}), Allowed: ${isGroupAllowed}, IsOwner: ${isOwner}`);
        console.log(`[Leaderboard Auth] ALLOWED_GROUP_IDS: ${ALLOWED_GROUP_IDS} (Type: ${typeof ALLOWED_GROUP_IDS[0]})`);
        
        if (!isGroupAllowed && !isOwner) {
          console.log(`Leaderboard command rejected: Unauthorized group ${chatIdForCheck} and not owner`);
          return await ctx.reply('This command can only be used in authorized groups.');
        }
        // --- End Authorization Check ---

        // Check if database is connected
        if (!isDBConnected()) {
          // Try to force a reconnection before failing
          const reconnected = await forceReconnect();
          
          if (!reconnected) {
            return await ctx.reply('⚠️ Database connection is unavailable. Leaderboard cannot be retrieved at this time.');
          } else {
            await ctx.reply('✅ Database connection restored. Generating leaderboard...');
          }
        }

        // Only enforce group chat type check if not in private chat mode
        const originalChatType = ctx.originalChatType || ctx.chat.type;
        if (originalChatType !== 'private' && ctx.chat.type !== 'group' && ctx.chat.type !== 'supergroup') {
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
          
          // If no results, try with normalized format (removing -100 prefix if it exists)
          if (!leaderboard || leaderboard.length === 0) {
            const normalizedGroupId = chatId.toString().startsWith('-100') ? 
              parseInt(chatId.toString().substring(4)) * -1 : 
              parseInt(chatId);
            
            console.log(`No leaderboard found with original ID. Trying normalized groupId: ${normalizedGroupId}`);
            const normalizedLeaderboard = await Message.getChatLeaderboard(normalizedGroupId, 10);
            
            if (!normalizedLeaderboard || normalizedLeaderboard.length === 0) {
              if (processingMsg) {
                try {
                  await ctx.telegram.deleteMessage(ctx.chat.id, processingMsg.message_id);
                } catch (deleteError) {
                  console.error(`Error deleting processing message: ${deleteError.message}`);
                }
              }
              return await ctx.reply(`No messages have been tracked in ${chatTitle} yet.`);
            }
            
            // Use the normalized leaderboard if found
            leaderboard = normalizedLeaderboard;
          }
          
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

    // Handle messages (Only process messages from allowed groups)
    bot.on('message', async (ctx) => {
      try {
        // --- Authorization Check ---
        // Skip if not in an allowed group chat
        const chatIdForCheck = ctx.chat?.id;
        const isGroupAllowed = chatIdForCheck ? isAllowedGroup(chatIdForCheck) : false;
        
        if (!ctx.chat || !isGroupAllowed) {
          // Don't log ignored messages from unauthorized groups to reduce noise
          // console.log(`Ignoring message from unauthorized chat: ${ctx.chat?.id} (${ctx.chat?.type})`);
          return;
        }
        // --- End Authorization Check ---
        
        // Check if database is connected - try to reconnect if necessary
        if (!isDBConnected()) {
          console.log(`Database disconnected while processing message in chat: ${ctx.chat.title}`);
          
          // Try to force a reconnection before skipping the message
          const reconnected = await forceReconnect();
          
          if (!reconnected) {
            console.log(`Skipping message processing: Database reconnection failed (Chat: ${ctx.chat.title})`);
            return;
          } else {
            console.log(`Successfully reconnected to database. Continuing message processing.`);
          }
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
          // --- Authorization Check ---
          const chatIdForCheck = ctx.chat?.id;
          const isGroupAllowed = chatIdForCheck ? isAllowedGroup(chatIdForCheck) : false;
          
          if (isGroupAllowed) {
            await ctx.reply(`Hello! I've been added to "${ctx.chat.title}". I'll start tracking and analyzing messages in this group.`);
            console.log(`Bot was added to an ALLOWED group: ${ctx.chat.title} (${ctx.chat.id})`);
          } else {
            console.log(`Bot was added to an UNAUTHORIZED group: ${ctx.chat.title} (${ctx.chat.id}). Leaving.`);
            await ctx.reply('Sorry, this bot is restricted to specific authorized groups and cannot operate here.');
            await ctx.leaveChat();
          }
          // --- End Authorization Check ---
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

    // Handle callback queries for group selection
    bot.on('callback_query', async (ctx) => {
      try {
        const userId = ctx.from.id;
        const callbackData = ctx.callbackQuery.data;
        const callbackId = ctx.callbackQuery.id; // Extract callback ID
        
        console.log(`Received callback query from user ${userId}: ${callbackData} (ID: ${callbackId})`);
        
        // Parse callback data: command:groupId
        const [command, groupId] = callbackData.split(':');
        
        if (!groupId) {
          try {
            if (callbackId) {
              await ctx.telegram.answerCbQuery(callbackId, 'Invalid selection');
            }
          } catch (cbError) {
            console.error(`Error answering callback query: ${cbError.message}`);
          }
          return;
        }
        
        // Store last selected group for this user
        userLastGroupCache[userId] = groupId;
        console.log(`User ${userId} selected group ${groupId} for ${command}`);
        
        // Answer the callback query to stop loading animation
        try {
          if (callbackId) {
            await ctx.telegram.answerCbQuery(callbackId, `Selected group for ${command}`);
          }
        } catch (cbError) {
          console.error(`Error answering callback query: ${cbError.message}`);
          // Continue despite error
        }
        
        try {
          // Delete the selection message before proceeding
          await ctx.deleteMessage();
        } catch (deleteError) {
          console.error(`Error deleting selection message: ${deleteError.message}`);
          // Continue despite error
        }
        
        // Get chat info to display proper title
        let chatTitle = "the selected group";
        try {
          const chatInfo = await bot.telegram.getChat(groupId);
          chatTitle = chatInfo.title;
        } catch (chatError) {
          console.error(`Error getting chat info: ${chatError.message}`);
        }
        
        // Execute the appropriate functionality based on command
        // Instead of re-running the command, directly execute the needed code
        switch (command) {
          case 'stats':
            try {
              console.log(`Directly executing stats for group ${groupId}`);
              
              // Check if database is connected
              if (!isDBConnected()) {
                // Try to force a reconnection before failing
                const reconnected = await forceReconnect();
                
                if (!reconnected) {
                  return await ctx.reply('⚠️ Database connection is unavailable. Stats cannot be retrieved at this time.');
                } else {
                  await ctx.reply('✅ Database connection restored. Generating stats...');
                }
              }
              
              // Convert the group ID to the right format for database queries
              // This is likely the key issue - we need to ensure the format matches what's in the DB
              console.log(`Original groupId: ${groupId}`);
              
              // Use the static method to get chat stats
              let stats = await Message.getChatStats(groupId);
              
              // If no results, try with normalized format (removing -100 prefix if it exists)
              if (!stats || stats.totalMessages === 0) {
                const normalizedGroupId = groupId.toString().startsWith('-100') ? 
                  parseInt(groupId.toString().substring(4)) * -1 : 
                  parseInt(groupId);
                
                console.log(`No stats found with original ID. Trying normalized groupId: ${normalizedGroupId}`);
                const normalizedStats = await Message.getChatStats(normalizedGroupId);
                
                if (!normalizedStats || normalizedStats.totalMessages === 0) {
                  return await ctx.reply(`No messages have been tracked in ${chatTitle} yet.`);
                }
                
                // Use the normalized stats if found
                stats = normalizedStats;
              }
              
              if (!stats || stats.totalMessages === 0) {
                return await ctx.reply(`No messages have been tracked in ${chatTitle} yet.`);
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
              
              // Check for crypto-related topics
              const cryptoTopics = stats.topics
                .filter(t => /bitcoin|btc|eth|ethereum|crypto|token|blockchain|solana|sol|nft|defi|trading|coin/i.test(t._id))
                .slice(0, 5);
              
              // Build the stats message with focus on sentiment
              const statsMessage = `
📊 *Sentiment Analysis for "${chatTitle}"*

*Sentiment Breakdown:*
${sentiments.map(s => `- ${s.charAt(0).toUpperCase() + s.slice(1)}: ${sentimentPercentages[s]}% (${sentimentData[s] || 0} messages)`).join('\n')}

*Overall sentiment:* The group has a predominantly ${overallTone} tone (${sentimentPercentages[overallTone]}%)

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
              console.error(`Error executing stats command: ${error.message}`);
              await ctx.reply('Sorry, there was an error generating statistics.');
            }
            break;
            
          case 'topics':
            try {
              console.log(`Directly executing topics for group ${groupId}`);
              
              // Check if database is connected
              if (!isDBConnected()) {
                // Try to force a reconnection before failing
                const reconnected = await forceReconnect();
                
                if (!reconnected) {
                  return await ctx.reply('⚠️ Database connection is unavailable. Topics cannot be retrieved at this time.');
                } else {
                  await ctx.reply('✅ Database connection restored. Generating topic analysis...');
                }
              }
              
              // Get topics using the static method
              let topics = await Message.getChatTopics(groupId);
              
              // If no results, try with normalized format (removing -100 prefix if it exists)
              if (!topics || topics.length === 0) {
                const normalizedGroupId = groupId.toString().startsWith('-100') ? 
                  parseInt(groupId.toString().substring(4)) * -1 : 
                  parseInt(groupId);
                
                console.log(`No topics found with original ID. Trying normalized groupId: ${normalizedGroupId}`);
                const normalizedTopics = await Message.getChatTopics(normalizedGroupId);
                
                if (!normalizedTopics || normalizedTopics.length === 0) {
                  return await ctx.reply(`No topics have been identified in ${chatTitle} yet.`);
                }
                
                // Use the normalized topics if found
                topics = normalizedTopics;
              }
              
              if (!topics || topics.length === 0) {
                return await ctx.reply(`No topics have been identified in ${chatTitle} yet.`);
              }
              
              // Categorize topics
              const categories = {
                memecoin: {
                  name: "🚀 Memecoin/Shitcoin",
                  topics: [],
                  regex: /pump|dump|moon|token|pepe|doge|elon|frog|cat|meme|shit(coin)?|gem|safu|airdrop|presale|mint|launch|jeet|rug|x([0-9]+)|([0-9]+)x|contract address|CA:|ca:|CA :|ca :|([A-HJ-NP-Za-km-z1-9]{32,44})|(0x[a-fA-F0-9]{40})|[a-zA-Z0-9]{40,}|[A-Za-z0-9]{32,}(pump)|Inu$|AI$|meme|coin|solana|sol|degen|cope|ngmi|wagmi|fud|hodl|hodler|paperhands|diamond hands|shill|mooning|ath|floor|flipping|flipped/i
                },
                crypto: {
                  name: "💰 Cryptocurrency",
                  topics: [],
                  regex: /bitcoin|btc|eth|ethereum|crypto|blockchain|solana|sol|nft|defi|trading|coin|market|price|bull|bear|wallet|exchange|dex|binance|chainlink|link|cardano|ada|xrp|usdt|usdc|stablecoin|buy|sell|mcap|market ?cap|liquidity|LP|chart|candle|cex|volume|resistance|support|trend|breakout|reversal|correction|ath|consolidation|accumulation|distribution|whale|ta|technical analysis|fa|fundamental analysis/i
                },
                technology: {
                  name: "💻 Technology",
                  topics: [],
                  regex: /tech|software|hardware|web|app|code|developer|programming|ai|computer|internet|mobile|website|digital|online|device|gadget|electronics/i
                },
                finance: {
                  name: "📈 Finance/Markets",
                  topics: [],
                  regex: /stock|finance|market|investing|investment|fund|bank|money|profit|loss|trader|analysis|portfolio|asset|dividend|gain|revenue|yield|cash/i
                },
                general: {
                  name: "🔍 General Topics",
                  topics: []
                }
              };
              
              // Helper function to check if a topic is likely a contract address
              const isContractAddress = (topicId) => {
                // Solana addresses (base58 encoded, 32-44 chars)
                if (/^[A-HJ-NP-Za-km-z1-9]{32,44}$/.test(topicId)) {
                  return true;
                }
                // Ethereum style addresses (0x followed by 40 hex chars)
                if (/^(0x)?[a-fA-F0-9]{40}$/.test(topicId)) {
                  return true;
                }
                // Memecoin contract addresses often have "pump" in them
                if (/^[A-Za-z0-9]{30,}pump$/i.test(topicId)) {
                  return true;
                }
                return false;
              };

              // Pre-process topics to identify contract addresses
              topics.forEach(topic => {
                if (isContractAddress(topic._id)) {
                  topic.isContract = true;
                  topic.contractType = topic._id.startsWith('0x') ? 'ethereum' : 'solana';
                }
              });
              
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
              
              // Helper function to format sentiment emoji
              const getSentimentEmoji = (sentiment) => {
                switch(sentiment) {
                  case 'positive': return '😀';
                  case 'negative': return '😟';
                  case 'neutral': return '😐';
                  default: return '🔄';
                }
              };
              
              // Helper function to format trending indicator
              const getTrendingEmoji = (trending) => {
                switch(trending) {
                  case 'up': return '📈';
                  case 'down': return '📉';
                  default: return '➖';
                }
              };
              
              // Helper function to escape markdown
              const escapeTopicMarkdown = (text) => {
                if (!text) return '';
                return text.toString().replace(/([_*\[\]()~`>#+\-=|{}.!])/g, '\\$1');
              };
              
              // Build message with categories and enhanced analysis
              let topicsMessage = `📊 *Advanced Topic Analysis for "${escapeTopicMarkdown(chatTitle)}"*\n\n`;
              
              // Find total topic mentions for percentages
              const totalMentions = topics.reduce((sum, topic) => sum + topic.count, 0);
              
              for (const category of Object.values(categories)) {
                if (category.topics.length > 0) {
                  // Get most discussed topic in this category
                  const mostDiscussed = [...category.topics].sort((a, b) => b.count - a.count)[0];
                  
                  topicsMessage += `*${category.name}*`;
                  
                  if (mostDiscussed.trending === 'up') {
                    topicsMessage += ` 🔥 Trending!`;
                  }
                  
                  topicsMessage += `\n`;
                  
                  // Format each topic with enhanced details
                  category.topics.slice(0, 3).forEach((topic, i) => {
                    const lastMentioned = new Date(topic.lastMentioned).toLocaleDateString();
                    const percentage = Math.round((topic.count / totalMentions) * 100);
                    
                    // Topic header with stats
                    topicsMessage += `${i+1}. *${escapeTopicMarkdown(topic._id)}* ${getTrendingEmoji(topic.trending)}\n`;
                    topicsMessage += `   • Mentions: ${topic.count} (${percentage}% of all topics)\n`;
                    
                    // Only show these fields if they exist (enhanced analysis)
                    if (topic.uniqueUserCount) {
                      topicsMessage += `   • Discussed by: ${topic.uniqueUserCount} members\n`;
                    }
                    
                    if (topic.dominantSentiment) {
                      topicsMessage += `   • Sentiment: ${getSentimentEmoji(topic.dominantSentiment)} ${topic.dominantSentiment}\n`;
                    }
                    
                    // Show related topics if available
                    if (topic.relatedTopics && topic.relatedTopics.length > 0) {
                      const relatedTopicsList = topic.relatedTopics
                        .map(rt => escapeTopicMarkdown(rt.topic))
                        .join(', ');
                      topicsMessage += `   • Related to: ${relatedTopicsList}\n`;
                    }
                    
                    // Add a sample message if available
                    if (topic.sampleMessages && topic.sampleMessages.length > 0) {
                      const sampleMsg = topic.sampleMessages[0];
                      topicsMessage += `   • Example: "_${escapeTopicMarkdown(sampleMsg.text.substring(0, 60))}..._"\n`;
                    }
                    
                    // Add activity info
                    if (topic.daysActive && topic.messagesPerDay) {
                      topicsMessage += `   • Activity: ${topic.messagesPerDay} msgs/day over ${topic.daysActive} days\n`;
                    } else {
                      topicsMessage += `   • Last mentioned: ${lastMentioned}\n`;
                    }
                    
                    topicsMessage += '\n';
                  });
                  
                  // If there are more topics in this category, mention them
                  if (category.topics.length > 3) {
                    const additionalCount = category.topics.length - 3;
                    const additionalTopics = category.topics
                      .slice(3, 6)
                      .map(t => escapeTopicMarkdown(t._id))
                      .join(', ');
                    
                    topicsMessage += `_...and ${additionalCount} more topics including ${additionalTopics}${additionalCount > 3 ? '...' : ''}_\n`;
                  }
                  
                  topicsMessage += '\n';
                }
              }
              
              // Add insights summary
              topicsMessage += `*AI Insights:*\n`;
              
              // Check for contract addresses or apparent token addresses in topics
              const contractLikeTopics = topics.filter(t => isContractAddress(t._id));
              
              if (contractLikeTopics.length > 0) {
                const topContractTopics = contractLikeTopics
                  .sort((a, b) => b.count - a.count)
                  .slice(0, 3)
                  .map(t => {
                    // Format contract addresses for readability
                    const addr = t._id;
                    return escapeTopicMarkdown(addr.substring(0, 8) + '...' + addr.substring(addr.length - 5));
                  })
                  .join(', ');
                
                const solanaCount = contractLikeTopics.filter(t => !t._id.startsWith('0x')).length;
                const ethereumCount = contractLikeTopics.filter(t => t._id.startsWith('0x')).length;
                
                topicsMessage += `• *Token Activity:* ${contractLikeTopics.length} contract addresses mentioned (${solanaCount} Solana, ${ethereumCount} Ethereum)\n`;
                topicsMessage += `• *Top Tokens:* ${topContractTopics}\n`;
              }
              
              // Analyze memecoin topics for trading patterns
              const memecoinTopics = topics.filter(t => 
                categories.memecoin.regex.test(t._id)
              );
              
              if (memecoinTopics.length > 0) {
                const tradingTerms = ["pump", "moon", "x10", "100x", "buy", "sell", "launch", "mint", "gem", "ath", "floor"];
                const tradingActivity = memecoinTopics.filter(t => 
                  tradingTerms.some(term => t._id.toLowerCase().includes(term))
                );
                
                if (tradingActivity.length > 0) {
                  const tradingVolume = tradingActivity.reduce((sum, t) => sum + t.count, 0);
                  const mostActive = tradingActivity.sort((a, b) => b.count - a.count)[0]?._id || '';
                  
                  topicsMessage += `• *Trading Activity:* ${tradingActivity.length} tokens with ${tradingVolume} trading signals\n`;
                  if (mostActive && !isContractAddress(mostActive)) {
                    topicsMessage += `• *Hottest Token:* ${escapeTopicMarkdown(mostActive)}\n`;
                  }
                }
                
                // Detect potential new launches
                const launchTerms = ["launch", "presale", "mint", "airdrop", "new"];
                const launchActivity = memecoinTopics.filter(t => 
                  launchTerms.some(term => t._id.toLowerCase().includes(term))
                );
                
                if (launchActivity.length > 0) {
                  topicsMessage += `• *Launch Activity:* ${launchActivity.length} potential new token launches detected\n`;
                }
              }
              
              // Regular trending topics
              if (topics.some(t => t.trending === 'up')) {
                const trendingTopics = topics
                  .filter(t => t.trending === 'up')
                  .map(t => escapeTopicMarkdown(t._id))
                  .slice(0, 3)
                  .join(', ');
                
                topicsMessage += `• *Trending Discussions:* ${trendingTopics}\n`;
              }
              
              // Add sentiment overview
              const positiveSentimentTopics = topics.filter(t => t.dominantSentiment === 'positive').length;
              const negativeSentimentTopics = topics.filter(t => t.dominantSentiment === 'negative').length;
              
              if (positiveSentimentTopics > negativeSentimentTopics) {
                topicsMessage += `• *Sentiment Analysis:* Overall positive discussions across ${positiveSentimentTopics} topics\n`;
              } else if (negativeSentimentTopics > positiveSentimentTopics) {
                topicsMessage += `• *Sentiment Analysis:* Several topics (${negativeSentimentTopics}) show negative sentiment\n`;
              } else {
                topicsMessage += `• *Sentiment Analysis:* Balanced sentiment across discussions\n`;
              }
              
              topicsMessage += `\n_Analysis based on ${totalMentions} topic mentions across ${topics.length} unique topics_`;
              
              // Send message with enhanced topic analysis
              await ctx.reply(topicsMessage, { parse_mode: 'Markdown' });
            } catch (error) {
              console.error(`Error executing topics command: ${error.message}`);
              await ctx.reply('Sorry, there was an error generating the topics list.');
            }
            break;
            
          case 'leaderboard':
            try {
              console.log(`Directly executing leaderboard for group ${groupId}`);
              
              // Check if database is connected
              if (!isDBConnected()) {
                // Try to force a reconnection before failing
                const reconnected = await forceReconnect();
                
                if (!reconnected) {
                  return await ctx.reply('⚠️ Database connection is unavailable. Leaderboard cannot be retrieved at this time.');
                } else {
                  await ctx.reply('✅ Database connection restored. Generating leaderboard...');
                }
              }
              
              // Send a processing message
              let processingMsg;
              try {
                processingMsg = await ctx.reply('⏳ Processing quality scores and creating leaderboard...');
              } catch (msgError) {
                console.error(`Error sending processing message: ${msgError.message}`);
                processingMsg = null;
              }
              
              // Get leaderboard data
              let leaderboard = await Message.getChatLeaderboard(groupId, 10);
              
              // If no results, try with normalized format (removing -100 prefix if it exists)
              if (!leaderboard || leaderboard.length === 0) {
                const normalizedGroupId = groupId.toString().startsWith('-100') ? 
                  parseInt(groupId.toString().substring(4)) * -1 : 
                  parseInt(groupId);
                
                console.log(`No leaderboard found with original ID. Trying normalized groupId: ${normalizedGroupId}`);
                const normalizedLeaderboard = await Message.getChatLeaderboard(normalizedGroupId, 10);
                
                if (!normalizedLeaderboard || normalizedLeaderboard.length === 0) {
                  if (processingMsg) {
                    try {
                      await ctx.telegram.deleteMessage(ctx.chat.id, processingMsg.message_id);
                    } catch (deleteError) {
                      console.error(`Error deleting processing message: ${deleteError.message}`);
                    }
                  }
                  return await ctx.reply(`No messages have been tracked in ${chatTitle} yet.`);
                }
                
                // Use the normalized leaderboard if found
                leaderboard = normalizedLeaderboard;
              }
              
              if (!leaderboard || leaderboard.length === 0) {
                if (processingMsg) {
                  try {
                    await ctx.telegram.deleteMessage(ctx.chat.id, processingMsg.message_id);
                  } catch (deleteError) {
                    console.error(`Error deleting processing message: ${deleteError.message}`);
                  }
                }
                return await ctx.reply(`No messages have been tracked in ${chatTitle} yet.`);
              }
              
              // Helper function to escape special HTML characters
              const escapeHTML = (text) => {
                if (!text) return '';
                return text.toString()
                  .replace(/&/g, '&amp;')
                  .replace(/</g, '&lt;')
                  .replace(/>/g, '&gt;');
              };
              
              // Format user names with safer access
              const formatUserName = (user) => {
                try {
                  if (user && user._id) {
                    if (user._id.username) {
                      return `@${escapeHTML(user._id.username)}`;
                    } else {
                      const firstName = user._id.firstName || '';
                      const lastName = user._id.lastName || '';
                      return escapeHTML(`${firstName} ${lastName}`.trim() || `User ${user._id.userId || 'unknown'}`);
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
                  let prefix = `${index + 1}.`;
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
              
              // Create leaderboard message with HTML formatting
              const leaderboardMessage = `
🏆 <b>Quality-Based Leaderboard for "${escapeHTML(chatTitle)}"</b>

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
                }
              }
              
              await ctx.reply(leaderboardMessage, { parse_mode: 'HTML' });
            } catch (error) {
              console.error(`Error executing leaderboard command: ${error.message}`);
              await ctx.reply('Sorry, there was an error generating the leaderboard.');
            }
            break;
            
          case 'price':
            try {
              console.log(`Directly executing price for group ${groupId}`);
              
              // Get the original coin parameter if available
              const match = ctx.callbackQuery.message.text.match(/for (\w+):$/);
              if (!match || !match[1]) {
                return await ctx.reply('Please specify a cryptocurrency symbol. Example: /price btc');
              }
              
              const symbol = match[1].toLowerCase();
              
              // Fetch price data from CoinGecko API
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
            } catch (error) {
              console.error(`Error executing price command: ${error.message}`);
              await ctx.reply('Sorry, there was an error fetching price data.');
            }
            break;
            
          default:
            await ctx.reply('Unknown command selection');
        }
      } catch (error) {
        console.error(`Error handling callback query: ${error.message}`);
        try {
          // Try to answer the callback query if possible
          if (ctx.callbackQuery && ctx.callbackQuery.id) {
            await ctx.telegram.answerCbQuery(ctx.callbackQuery.id, 'An error occurred');
          }
          
          // Try to send an error message
          await ctx.reply('Sorry, there was an error processing your selection. Please try again.');
        } catch (replyError) {
          console.error(`Error replying to callback query: ${replyError.message}`);
        }
      }
    });

    // Launch the bot with retry mechanism
    const botLaunched = await launchBotWithRetry();
    if (!botLaunched) {
      return false;
    }
    
    // Set up a periodic database connection check to keep connection alive
    const DB_CHECK_INTERVAL = 30 * 60 * 1000; // 30 minutes
    console.log(`Setting up periodic database connection check every ${DB_CHECK_INTERVAL/60000} minutes`);
    
    setInterval(async () => {
      console.log('Performing periodic database connection check...');
      if (!isDBConnected()) {
        console.log('Database connection lost during periodic check. Attempting to reconnect...');
        await forceReconnect();
      } else {
        console.log('Database connection is healthy.');
        
        // Ping the database to keep the connection alive
        try {
          await Message.findOne().limit(1).exec();
          console.log('Database ping successful.');
        } catch (err) {
          console.error('Error pinging database:', err.message);
          await forceReconnect();
        }
      }
    }, DB_CHECK_INTERVAL);
    
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