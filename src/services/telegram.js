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
      { command: 'stats', description: 'Show chat statistics' }
    ]);

    // Handle start command
    bot.command('start', async (ctx) => {
      await ctx.reply('Hello! I\'m tracking and analyzing messages in this group. Just add me to your group and I\'ll start working.');
    });

    // Handle help command
    bot.command('help', async (ctx) => {
      await ctx.reply(
        'Commands:\n' +
        '/start - Start the bot\n' +
        '/help - Show this help message\n' +
        '/stats - Show statistics about messages in this chat'
      );
    });

    // Handle stats command
    bot.command('stats', async (ctx) => {
      try {
        const chatId = ctx.chat.id;
        
        // Count total messages
        const totalMessages = await Message.countDocuments({ chatId });
        
        // Get unique users
        const uniqueUsers = await Message.distinct('userId', { chatId });
        
        // Get message stats for sentiment
        const sentimentStats = await Message.aggregate([
          { $match: { chatId } },
          { $group: {
              _id: '$analysis.sentiment',
              count: { $sum: 1 }
            }
          }
        ]);
        
        const statsMessage = `
📊 Chat Statistics:
Total messages tracked: ${totalMessages}
Unique users: ${uniqueUsers.length}

Sentiment breakdown:
${sentimentStats.map(s => `- ${s._id || 'unknown'}: ${s.count}`).join('\n')}
        `;
        
        await ctx.reply(statsMessage);
      } catch (error) {
        console.error('Error generating stats:', error);
        await ctx.reply('Sorry, there was an error generating statistics.');
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
          console.log(`Saved message ${messageData.messageId} from chat ${messageData.chatId}`);
        }
      } catch (error) {
        console.error('Error processing message:', error);
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