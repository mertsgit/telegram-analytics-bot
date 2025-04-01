const { Telegraf } = require('telegraf');
const Message = require('../models/Message');
const { analyzeMessage } = require('./openai');
require('dotenv').config();

// Initialize bot
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

// Store bot info
let botInfo = null;

// Initialize bot with commands and message handlers
const initBot = async () => {
  try {
    // Get bot info
    botInfo = await bot.telegram.getMe();
    console.log(`Bot started as @${botInfo.username}`);
    
    // Set bot commands
    await bot.telegram.setMyCommands([
      { command: 'start', description: 'Start the bot' },
      { command: 'help', description: 'Show help' },
      { command: 'stats', description: 'Show chat statistics' },
      { command: 'topics', description: 'Show top topics in this chat' }
    ]);

    // Handle start command
    bot.command('start', async (ctx) => {
      if (ctx.chat.type === 'private') {
        await ctx.reply('Hello! I track and analyze messages in groups. Add me to a group to start working!');
      } else {
        await ctx.reply(`Hello! I'm now tracking and analyzing messages in this group (${ctx.chat.title}).`);
        console.log(`Bot initialized in group: ${ctx.chat.title} (${ctx.chat.id})`);
      }
    });

    // Handle help command
    bot.command('help', async (ctx) => {
      await ctx.reply(
        'Commands:\n' +
        '/start - Start the bot\n' +
        '/help - Show this help message\n' +
        '/stats - Show statistics about messages in this chat\n' +
        '/topics - Show top topics discussed in this chat'
      );
    });

    // Handle stats command
    bot.command('stats', async (ctx) => {
      try {
        // Only allow in group chats
        if (ctx.chat.type !== 'group' && ctx.chat.type !== 'supergroup') {
          return await ctx.reply('This command only works in group chats.');
        }
        
        const chatId = ctx.chat.id;
        
        // Use the new static method to get chat stats
        const stats = await Message.getChatStats(chatId);
        
        if (stats.totalMessages === 0) {
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
${stats.sentiments.map(s => `- ${s._id || 'unknown'}: ${s.count} (${Math.round(s.count/stats.totalMessages*100)}%)`).join('\n')}` : ''}

${stats.topics.length > 0 ? `*Top 5 topics:*
${stats.topics.slice(0, 5).map(t => `- ${t._id}: ${t.count} mentions`).join('\n')}` : ''}

${stats.activeUsers.length > 0 ? `*Most active users:*
${stats.activeUsers.slice(0, 5).map(u => `- ${formatUserName(u)}: ${u.messageCount} messages`).join('\n')}` : ''}
        `;
        
        await ctx.reply(statsMessage, { parse_mode: 'Markdown' });
      } catch (error) {
        console.error('Error generating stats:', error);
        await ctx.reply('Sorry, there was an error generating statistics.');
      }
    });
    
    // Handle topics command
    bot.command('topics', async (ctx) => {
      try {
        // Only allow in group chats
        if (ctx.chat.type !== 'group' && ctx.chat.type !== 'supergroup') {
          return await ctx.reply('This command only works in group chats.');
        }
        
        const chatId = ctx.chat.id;
        
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
        ]);
        
        if (topicsAggregation.length === 0) {
          return await ctx.reply('No topics have been identified in this chat yet.');
        }
        
        const topicsMessage = `
📋 *Top Topics in "${ctx.chat.title}"*

${topicsAggregation.map((t, i) => `${i+1}. ${t._id}: ${t.count} mentions`).join('\n')}
        `;
        
        await ctx.reply(topicsMessage, { parse_mode: 'Markdown' });
      } catch (error) {
        console.error('Error generating topics:', error);
        await ctx.reply('Sorry, there was an error generating topics list.');
      }
    });

    // Handle messages
    bot.on('message', async (ctx) => {
      try {
        if (!ctx.message.text) return; // Skip non-text messages
        
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
        
        // Only analyze and save if in a group chat
        if (ctx.chat.type === 'group' || ctx.chat.type === 'supergroup') {
          // Analyze the message with OpenAI
          const analysis = await analyzeMessage(messageData.text);
          messageData.analysis = analysis;
          
          // Save message to database
          await new Message(messageData).save();
          console.log(`Saved message ${messageData.messageId} from chat ${messageData.chatId} (${ctx.chat.title})`);
        }
      } catch (error) {
        console.error('Error processing message:', error);
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
        console.error('Error handling new chat members:', error);
      }
    });

    // Launch the bot
    bot.launch();
    
    // Enable graceful stop
    process.once('SIGINT', () => bot.stop('SIGINT'));
    process.once('SIGTERM', () => bot.stop('SIGTERM'));
    
    return true;
  } catch (error) {
    console.error('Error initializing bot:', error);
    return false;
  }
};

module.exports = { initBot }; 