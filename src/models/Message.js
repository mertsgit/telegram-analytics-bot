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
    const totalMessages = await this.countDocuments({ chatId });
    
    if (totalMessages === 0) {
      return { 
        totalMessages: 0,
        uniqueUsers: 0,
        sentiments: [],
        topics: [],
        activeUsers: []
      };
    }
    
    const uniqueUsers = await this.distinct('userId', { chatId });
    
    const sentiments = await this.aggregate([
      { $match: { chatId } },
      { $group: {
          _id: '$analysis.sentiment',
          count: { $sum: 1 }
        }
      },
      { $sort: { count: -1 } }
    ]);
    
    const topics = await this.aggregate([
      { $match: { chatId } },
      { $unwind: { path: "$analysis.topics", preserveNullAndEmptyArrays: false } },
      { $group: {
          _id: "$analysis.topics",
          count: { $sum: 1 }
        }
      },
      { $sort: { count: -1 } },
      { $limit: 10 }
    ]);
    
    const activeUsers = await this.aggregate([
      { $match: { chatId } },
      { $group: {
          _id: { userId: "$userId", username: "$username", firstName: "$firstName", lastName: "$lastName" },
          messageCount: { $sum: 1 }
        }
      },
      { $sort: { messageCount: -1 } },
      { $limit: 10 }
    ]);
    
    return {
      totalMessages,
      uniqueUsers: uniqueUsers.length,
      sentiments,
      topics,
      activeUsers
    };
  } catch (error) {
    console.error('Error getting chat stats:', error);
    throw error;
  }
};

module.exports = mongoose.model('Message', messageSchema); 