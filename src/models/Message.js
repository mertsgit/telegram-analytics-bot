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
    },
    cryptoSentiment: {
      type: String,
      enum: ['bullish', 'bearish', 'neutral', 'unknown'],
      default: 'neutral'
    },
    mentionedCoins: [{
      type: String
    }],
    scamIndicators: [{
      type: String
    }],
    priceTargets: {
      type: Map,
      of: String
    }
  }
}, { 
  timestamps: true,
  indexes: [
    { chatId: 1, date: -1 },
    { chatId: 1, 'analysis.sentiment': 1 },
    { chatId: 1, 'analysis.cryptoSentiment': 1 },
    { chatId: 1, 'analysis.mentionedCoins': 1 }
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

messageSchema.statics.getCryptoStats = async function(chatId) {
  try {
    console.log(`Getting crypto stats for chat ${chatId}`);
    
    // First, check if we have any messages with crypto mentions
    const messagesWithCrypto = await this.countDocuments({
      chatId,
      'analysis.mentionedCoins': { $exists: true, $ne: [] }
    });
    
    console.log(`Found ${messagesWithCrypto} messages with crypto mentions for chat ${chatId}`);
    
    if (messagesWithCrypto === 0) {
      return {
        mentionedCoins: [],
        cryptoSentiment: {},
        potentialScams: []
      };
    }

    // Get coin mentions
    const coinMentions = await this.aggregate([
      {
        $match: {
          chatId: chatId,
          'analysis.mentionedCoins': { $exists: true, $ne: [] }
        }
      },
      { $unwind: "$analysis.mentionedCoins" },
      {
        $group: {
          _id: "$analysis.mentionedCoins",
          count: { $sum: 1 },
          firstMentioned: { $min: "$date" },
          lastMentioned: { $max: "$date" },
          messages: { $push: { text: "$text", date: "$date", sentiment: "$analysis.cryptoSentiment" } }
        }
      },
      { $sort: { count: -1 } },
      {
        $project: {
          _id: 1,
          count: 1,
          firstMentioned: 1,
          lastMentioned: 1,
          // Get the last 3 messages for context
          recentMessages: { $slice: ["$messages", -3] },
          // Calculate sentiment scores
          bullishCount: {
            $size: {
              $filter: {
                input: "$messages",
                as: "message",
                cond: { $eq: ["$$message.sentiment", "bullish"] }
              }
            }
          },
          bearishCount: {
            $size: {
              $filter: {
                input: "$messages",
                as: "message",
                cond: { $eq: ["$$message.sentiment", "bearish"] }
              }
            }
          }
        }
      }
    ]).exec();

    // Get crypto sentiment distribution
    const sentimentDistribution = await this.aggregate([
      {
        $match: {
          chatId: chatId,
          'analysis.cryptoSentiment': { $exists: true, $ne: null }
        }
      },
      {
        $group: {
          _id: "$analysis.cryptoSentiment",
          count: { $sum: 1 }
        }
      }
    ]).exec();

    // Get potential scam coins based on scam indicators
    const potentialScams = await this.aggregate([
      {
        $match: {
          chatId: chatId,
          'analysis.scamIndicators': { $exists: true, $ne: [] }
        }
      },
      { $unwind: "$analysis.mentionedCoins" },
      {
        $group: {
          _id: "$analysis.mentionedCoins",
          scamIndicatorCount: { $sum: { $size: "$analysis.scamIndicators" } },
          scamIndicators: { $addToSet: "$analysis.scamIndicators" },
          messageCount: { $sum: 1 }
        }
      },
      {
        $match: {
          scamIndicatorCount: { $gt: 0 }
        }
      },
      { $sort: { scamIndicatorCount: -1 } }
    ]).exec();

    // Calculate total crypto-related messages
    const totalCryptoMessages = await this.countDocuments({
      chatId,
      $or: [
        { 'analysis.mentionedCoins': { $exists: true, $ne: [] } },
        { 'analysis.cryptoSentiment': { $exists: true, $ne: null } }
      ]
    });

    // Format the scam indicators array
    const formattedScams = potentialScams.map(scam => {
      // Flatten the nested arrays of scam indicators
      const flattenedIndicators = scam.scamIndicators.flat();
      
      // Count occurrences of each indicator
      const indicatorCounts = flattenedIndicators.reduce((acc, indicator) => {
        if (typeof indicator === 'string') {
          acc[indicator] = (acc[indicator] || 0) + 1;
        }
        return acc;
      }, {});
      
      return {
        coin: scam._id,
        messageCount: scam.messageCount,
        scamScore: scam.scamIndicatorCount / scam.messageCount, // Normalized score
        commonIndicators: Object.entries(indicatorCounts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([indicator, count]) => ({ indicator, count }))
      };
    });

    return {
      totalMessages: totalCryptoMessages,
      mentionedCoins: coinMentions || [],
      cryptoSentiment: sentimentDistribution.reduce((acc, item) => {
        acc[item._id] = item.count;
        return acc;
      }, {}),
      potentialScams: formattedScams || []
    };
  } catch (error) {
    console.error(`Error getting crypto stats for chat ${chatId}:`, error);
    throw error;
  }
};

// Static method to get chat leaderboard
messageSchema.statics.getChatLeaderboard = async function(chatId, limit = 10) {
  try {
    console.log(`Getting leaderboard for chat ${chatId}`);
    
    // First check if we have any messages
    const messageCount = await this.countDocuments({ chatId });
    console.log(`Found ${messageCount} messages for chat ${chatId}`);
    
    if (messageCount === 0) {
      return [];
    }

    // Get most active users
    const leaderboard = await this.aggregate([
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
      { $limit: limit }
    ]).exec();

    console.log(`Leaderboard retrieved successfully for chat ${chatId}: ${leaderboard.length} users`);
    return leaderboard;
  } catch (error) {
    console.error(`Error getting leaderboard for chat ${chatId}:`, error);
    throw error;
  }
};

module.exports = mongoose.model('Message', messageSchema); 