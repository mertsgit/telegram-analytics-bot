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
  qualityScore: {
    type: Number,
    default: 0
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
      enum: ['question', 'statement', 'command', 'greeting', 'opinion', 'other', 'unknown'],
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
    { chatId: 1, 'analysis.mentionedCoins': 1 },
    { chatId: 1, userId: 1, qualityScore: -1 } // Index for leaderboard queries
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
    
    // First check if we have any messages
    const messageCount = await this.countDocuments({ chatId });
    console.log(`Found ${messageCount} total messages for chat ${chatId}`);
    
    if (messageCount === 0) {
      return [];
    }
    
    // Check for messages with topics specifically
    const messagesWithTopics = await this.countDocuments({
      chatId,
      'analysis.topics': { $exists: true, $ne: [] }
    });
    
    console.log(`Found ${messagesWithTopics} messages with topics for chat ${chatId}`);
    
    if (messagesWithTopics === 0) {
      return [];
    }

    // Extract and count topic occurrences with safer approach
    try {
      const topics = await this.aggregate([
        {
          $match: {
            chatId: chatId,
            'analysis.topics': { $exists: true, $ne: [] }
          }
        },
        { $unwind: { path: "$analysis.topics", preserveNullAndEmptyArrays: false } },
        {
          $group: {
            _id: "$analysis.topics",
            count: { $sum: 1 },
            lastMentioned: { $max: "$date" }
          }
        },
        // Filter out empty topics or those with special characters only
        {
          $match: {
            _id: { $regex: /[a-zA-Z0-9]/, $ne: "" }
          }
        },
        { $sort: { count: -1 } },
        { $limit: 15 }
      ]).exec();

      console.log(`Topics retrieved successfully for chat ${chatId}: ${topics.length} topics found`);
      return topics;
    } catch (aggregationError) {
      console.error(`Error during topic aggregation for chat ${chatId}:`, aggregationError);
      
      // Fallback to simpler approach if the aggregation fails
      console.log(`Using fallback topic extraction for chat ${chatId}`);
      const messages = await this.find(
        { chatId, 'analysis.topics': { $exists: true, $ne: [] } },
        { 'analysis.topics': 1, date: 1 }
      ).limit(100).sort({ date: -1 }).lean();
      
      // Manual topic counting
      const topicCounts = {};
      const lastMentioned = {};
      
      messages.forEach(msg => {
        if (Array.isArray(msg.analysis.topics)) {
          msg.analysis.topics.forEach(topic => {
            if (topic && /[a-zA-Z0-9]/.test(topic)) {
              topicCounts[topic] = (topicCounts[topic] || 0) + 1;
              
              // Track most recent mention
              if (!lastMentioned[topic] || msg.date > lastMentioned[topic]) {
                lastMentioned[topic] = msg.date;
              }
            }
          });
        }
      });
      
      // Convert to expected format
      const formattedTopics = Object.entries(topicCounts)
        .map(([topic, count]) => ({
          _id: topic,
          count,
          lastMentioned: lastMentioned[topic]
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 15);
      
      console.log(`Fallback topic extraction successful: ${formattedTopics.length} topics found`);
      return formattedTopics;
    }
  } catch (error) {
    console.error(`Error getting topics for chat ${chatId}:`, error);
    console.error('Stack trace:', error.stack);
    return []; // Return empty array instead of throwing error for more resilience
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

// Calculate message quality score (Enhanced Logic)
messageSchema.statics.calculateQualityScore = function(message, analysis) {
  let score = 0;
  const trimmedMessage = message.trim();
  const wordCount = trimmedMessage.split(/\s+/).filter(Boolean).length;

  // 1. Initial Checks for Low Effort/Spam (Zero Points)
  if (trimmedMessage.length < 10 && wordCount <= 2) {
      console.log(`Quality Score: 0 (Message too short/few words: "${trimmedMessage.substring(0, 20)}")`);
      return 0; // Very short or only 1-2 words
  }
  // Check for excessive repetition (e.g., "aaaaa", "lololol") - basic check
  if (/(\w)\1{4,}/.test(trimmedMessage)) {
       console.log(`Quality Score: 0 (Excessive repetition detected: "${trimmedMessage.substring(0, 20)}")`);
       return 0;
  }
  // Check for messages that are mostly non-alphanumeric (excluding spaces and common punctuation)
  const cleanLength = trimmedMessage.replace(/[\s.,!?;:'"\(\)]/g, '').length;
  if (cleanLength > 0) { 
    const alphanumericRatio = (trimmedMessage.match(/[a-z0-9]/gi) || []).length / cleanLength;
    if (trimmedMessage.length > 5 && alphanumericRatio < 0.4) {
        console.log(`Quality Score: 0 (Low alphanumeric ratio [${alphanumericRatio.toFixed(2)}]: "${trimmedMessage.substring(0, 20)}")`);
        return 0;
    }
  } else if (trimmedMessage.length > 0) {
      // If message has length but no alphanumeric after cleaning, likely just symbols/emojis
      console.log(`Quality Score: 0 (Mostly non-alphanumeric/symbols: "${trimmedMessage.substring(0, 20)}")`);
      return 0;
  }
  
  // 2. Base score for potentially valid message
  score = 1;
  console.log(`Quality Score: Base = 1`);

  // 3. Add Positive Points
  if (analysis.topics && analysis.topics.length > 0) {
    const topicPoints = Math.min(5, analysis.topics.length); // Max 5 points for topics
    score += topicPoints;
    console.log(`Quality Score: +${topicPoints} (Topics: ${analysis.topics.join(', ').substring(0, 50)}...)`);
  }
  if (analysis.sentiment === 'positive') {
    score += 3;
    console.log(`Quality Score: +3 (Positive Sentiment)`);
  }
  if (analysis.cryptoSentiment && analysis.cryptoSentiment !== 'neutral') {
    score += 2;
    console.log(`Quality Score: +2 (Crypto Sentiment: ${analysis.cryptoSentiment})`);
  }
  if (analysis.mentionedCoins && analysis.mentionedCoins.length > 0) {
    const coinPoints = Math.min(5, analysis.mentionedCoins.length); // Points per coin, max 5
    score += coinPoints;
    console.log(`Quality Score: +${coinPoints} (Mentioned Coins: ${analysis.mentionedCoins.join(', ')})`);
  }
  if (analysis.intent === 'question') {
    score += 2;
    console.log(`Quality Score: +2 (Intent: Question)`);
  } else if (['statement', 'opinion', 'recommendation'].includes(analysis.intent)) {
      score += 1; // Small bonus for coherent statements/opinions
      console.log(`Quality Score: +1 (Intent: ${analysis.intent})`);
  }

  // 4. Apply Negative Penalties
  if (analysis.sentiment === 'negative') {
    score -= 5; // Significant penalty
    console.log(`Quality Score: -5 (Negative Sentiment)`);
  }
  // Add specific profanity check (similar regex as in openai.js pre-check, simplified)
  const profanityRegex = /\b(f\s*u\s*c\s*k|s\s*h\s*i\s*t|b\s*i\s*t\s*c\s*h|d\s*i\s*c\s*k|a\s*s\s*s|f\s*off?|cunt|cock|stfu|gtfo|f\s*you)\b/i;
  if (profanityRegex.test(trimmedMessage)) {
      score -= 5; // Additional penalty for explicit profanity
      console.log(`Quality Score: -5 (Profanity Detected)`);
  }

  // 5. Final Score (ensure non-negative)
  const finalScore = Math.max(0, score);
  console.log(`Quality Score: Final = ${finalScore} (Message: "${trimmedMessage.substring(0, 30)}...")`);
  return finalScore;
};

// Get chat leaderboard with quality-based point system
messageSchema.statics.getChatLeaderboard = async function(chatId, limit = 10) {
  try {
    console.log(`Getting quality-based leaderboard for chat ${chatId}`);
    
    // First check if we have any messages
    const messageCount = await this.countDocuments({ chatId });
    console.log(`Found ${messageCount} messages for chat ${chatId}`);
    
    if (messageCount === 0) {
      return [];
    }
    
    // Get users with highest quality points
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
          totalPoints: { $sum: "$qualityScore" },
          messageCount: { $sum: 1 },
          averagePoints: { $avg: "$qualityScore" },
          totalPositive: { 
            $sum: { 
              $cond: [{ $eq: ["$analysis.sentiment", "positive"] }, 1, 0] 
            }
          },
          totalQuestions: { 
            $sum: { 
              $cond: [{ $eq: ["$analysis.intent", "question"] }, 1, 0] 
            }
          },
          highestScore: { $max: "$qualityScore" },
          firstMessage: { $min: "$date" },
          lastMessage: { $max: "$date" },
          topTopics: { $push: "$analysis.topics" }
        }
      },
      {
        $project: {
          _id: 1,
          totalPoints: 1, 
          messageCount: 1,
          averagePoints: { $round: ["$averagePoints", 1] },
          positiveRate: { 
            $round: [{ $multiply: [{ $divide: ["$totalPositive", "$messageCount"] }, 100] }, 0]
          },
          questionsRate: { 
            $round: [{ $multiply: [{ $divide: ["$totalQuestions", "$messageCount"] }, 100] }, 0]
          },
          highestScore: 1,
          daysSinceFirstMessage: { 
            $round: [{ $divide: [{ $subtract: [new Date(), "$firstMessage"] }, 1000 * 60 * 60 * 24] }, 0] 
          },
          lastActive: "$lastMessage",
          // Flatten and get top 3 topics per user
          topTopics: { $slice: [{ $reduce: {
              input: { $filter: { input: "$topTopics", as: "topics", cond: { $ne: ["$$topics", []] } } },
              initialValue: [],
              in: { $concatArrays: ["$$value", "$$this"] }
            }}, 0, 3] }
        }
      },
      { $sort: { totalPoints: -1 } },
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