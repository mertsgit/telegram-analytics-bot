const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  messageId: {
    type: Number,
    required: true
  },
  chatId: {
    type: Number,
    required: true,
    index: true
  },
  chatTitle: {
    type: String,
    required: false
  },
  userId: {
    type: Number,
    required: false
  },
  username: {
    type: String,
    required: false
  },
  firstName: {
    type: String,
    required: false
  },
  lastName: {
    type: String,
    required: false
  },
  text: {
    type: String,
    required: false
  },
  date: {
    type: Date,
    default: Date.now,
    index: true
  },
  analysis: {
    sentiment: {
      type: String,
      enum: ['positive', 'negative', 'neutral', 'unknown'],
      default: 'unknown'
    },
    topics: {
      type: [String],
      default: []
    },
    entities: {
      type: [String],
      default: []
    },
    intent: {
      type: String,
      enum: ['question', 'statement', 'command', 'greeting', 'opinion', 'other'],
      default: 'statement'
    }
  }
}, { 
  timestamps: true,
  indexes: [
    { chatId: 1, date: -1 },
    { chatId: 1, 'analysis.sentiment': 1 }
  ]
});

messageSchema.statics.getChatStats = async function(chatId) {
  try {
    console.log(`Getting stats for chat ${chatId}`);
    
    // First, check if we have any messages for this chat
    const messageCount = await this.countDocuments({ chatId });
    console.log(`Found ${messageCount} messages for chat ${chatId}`);
    
    if (messageCount === 0) {
      return {
        totalMessages: 0,
        uniqueUsers: 0,
        sentiments: [],
        topics: [],
        activeUsers: []
      };
    }

    // Get basic stats
    const basicStats = await this.aggregate([
      { $match: { chatId: chatId } },
      {
        $group: {
          _id: null,
          totalMessages: { $sum: 1 },
          uniqueUsers: { $addToSet: "$userId" }
        }
      }
    ]).exec();

    // Get sentiment distribution
    const sentiments = await this.aggregate([
      { $match: { 
        chatId: chatId,
        'analysis.sentiment': { $exists: true, $ne: null }
      }},
      {
        $group: {
          _id: "$analysis.sentiment",
          count: { $sum: 1 }
        }
      },
      { $sort: { count: -1 } }
    ]).exec();

    // Get top topics
    const topics = await this.aggregate([
      { $match: { 
        chatId: chatId,
        'analysis.topics': { $exists: true, $ne: [] }
      }},
      { $unwind: "$analysis.topics" },
      {
        $group: {
          _id: "$analysis.topics",
          count: { $sum: 1 }
        }
      },
      { $sort: { count: -1 } },
      { $limit: 5 }
    ]).exec();

    // Get most active users
    const activeUsers = await this.aggregate([
      { $match: { chatId: chatId } },
      {
        $group: {
          _id: {
            userId: "$userId",
            username: "$username",
            firstName: "$firstName",
            lastName: "$lastName"
          },
          messageCount: { $sum: 1 }
        }
      },
      { $sort: { messageCount: -1 } },
      { $limit: 5 }
    ]).exec();

    const stats = {
      totalMessages: basicStats[0]?.totalMessages || 0,
      uniqueUsers: basicStats[0]?.uniqueUsers?.length || 0,
      sentiments: sentiments || [],
      topics: topics || [],
      activeUsers: activeUsers || []
    };

    console.log(`Stats generated successfully for chat ${chatId}:`, JSON.stringify(stats, null, 2));
    return stats;
  } catch (error) {
    console.error(`Error getting stats for chat ${chatId}:`, error);
    throw error;
  }
};

messageSchema.statics.getChatTopics = async function(chatId) {
  try {
    console.log(`Getting topics for chat ${chatId}`);
    
    // First check if we have any messages with topics
    const messagesWithTopics = await this.countDocuments({
      chatId,
      'analysis.topics': { $exists: true, $ne: [] }
    });
    
    console.log(`Found ${messagesWithTopics} messages with topics for chat ${chatId}`);
    
    if (messagesWithTopics === 0) {
      return [];
    }

    const topics = await this.aggregate([
      {
        $match: {
          chatId: chatId,
          'analysis.topics': { $exists: true, $ne: [] }
        }
      },
      { $unwind: "$analysis.topics" },
      {
        $group: {
          _id: "$analysis.topics",
          count: { $sum: 1 },
          lastMentioned: { $max: "$date" }
        }
      },
      { $sort: { count: -1 } },
      { $limit: 15 }
    ]).exec();

    console.log(`Topics retrieved successfully for chat ${chatId}:`, JSON.stringify(topics, null, 2));
    return topics;
  } catch (error) {
    console.error(`Error getting topics for chat ${chatId}:`, error);
    throw error;
  }
};

module.exports = mongoose.model('Message', messageSchema); 