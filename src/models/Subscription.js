const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

/**
 * Subscription schema for managing service access
 */
const SubscriptionSchema = new mongoose.Schema({
  // Subscription identification
  subscriptionId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  
  // User information
  userId: {
    type: Number,
    required: true,
    index: true
  },
  userName: {
    type: String,
    required: false
  },
  userUsername: {
    type: String,
    required: false
  },
  
  // Group information
  groupId: {
    type: Number,
    required: true,
    index: true
  },
  groupTitle: {
    type: String,
    required: false
  },
  
  // Subscription details
  plan: {
    type: String,
    required: true,
    enum: ['monthly', 'quarterly', 'annual'],
    default: 'monthly'
  },
  features: {
    type: [String],
    required: true,
    default: ['statistics', 'topics', 'leaderboard']
  },
  
  // Pricing details
  price: {
    amount: {
      type: Number,
      required: true,
      min: 0
    },
    currency: {
      type: String,
      required: true,
      enum: ['SOL', 'USDT', 'USDC', 'USD', 'EUR'],
      default: 'SOL'
    }
  },
  
  // Subscription status
  status: {
    type: String,
    required: true,
    enum: ['active', 'inactive', 'expired', 'cancelled', 'pending'],
    default: 'pending'
  },
  
  // Related payment
  paymentId: {
    type: String,
    required: false,
    index: true
  },
  
  // Subscription dates
  startDate: {
    type: Date,
    required: false
  },
  endDate: {
    type: Date,
    required: false
  },
  
  // Renewal tracking
  autoRenew: {
    type: Boolean,
    default: false
  },
  renewalReminded: {
    type: Boolean,
    default: false
  },
  
  // Cancellation data
  cancelledAt: {
    type: Date,
    required: false
  },
  cancellationReason: {
    type: String,
    required: false
  },
  
  // Usage tracking
  usageData: {
    commandsUsed: {
      type: Number,
      default: 0
    },
    lastUsed: {
      type: Date,
      required: false
    }
  },
  
  // Additional metadata
  metadata: {
    type: Object,
    required: false,
    default: {}
  },
  
  // Admin notes
  notes: {
    type: String,
    required: false
  }
}, {
  timestamps: true
});

/**
 * Generate a unique subscription ID
 */
SubscriptionSchema.statics.generateSubscriptionId = function() {
  return `SUB-${uuidv4().substring(0, 8).toUpperCase()}-${Date.now().toString().substring(7)}`;
};

/**
 * Find subscription by subscription ID
 */
SubscriptionSchema.statics.findBySubscriptionId = function(subscriptionId) {
  return this.findOne({ subscriptionId });
};

/**
 * Find active subscription for a group
 */
SubscriptionSchema.statics.findActiveForGroup = function(groupId) {
  const now = new Date();
  return this.findOne({
    groupId,
    status: 'active',
    endDate: { $gt: now }
  });
};

/**
 * Find all subscriptions for a group
 */
SubscriptionSchema.statics.findAllForGroup = function(groupId) {
  return this.find({ groupId }).sort({ createdAt: -1 });
};

/**
 * Find all subscriptions for a user
 */
SubscriptionSchema.statics.findAllForUser = function(userId) {
  return this.find({ userId }).sort({ createdAt: -1 });
};

/**
 * Find subscriptions nearing expiration
 */
SubscriptionSchema.statics.findNearingExpiration = function(daysThreshold = 3) {
  const now = new Date();
  const thresholdDate = new Date();
  thresholdDate.setDate(now.getDate() + daysThreshold);
  
  return this.find({
    status: 'active',
    renewalReminded: false,
    endDate: {
      $gt: now,
      $lte: thresholdDate
    }
  });
};

/**
 * Find expired subscriptions
 */
SubscriptionSchema.statics.findExpired = function() {
  const now = new Date();
  return this.find({
    status: 'active',
    endDate: { $lt: now }
  });
};

/**
 * Check and update expired subscriptions
 */
SubscriptionSchema.statics.checkAndUpdateExpired = async function() {
  const now = new Date();
  const expiredSubscriptions = await this.find({
    status: 'active',
    endDate: { $lt: now }
  });
  
  const updates = expiredSubscriptions.map(subscription => {
    return this.updateOne(
      { _id: subscription._id },
      { $set: { status: 'expired' } }
    );
  });
  
  if (updates.length > 0) {
    await Promise.all(updates);
  }
  
  return updates.length;
};

/**
 * Check if subscription is active
 */
SubscriptionSchema.methods.isActive = function() {
  const now = new Date();
  return this.status === 'active' && this.endDate > now;
};

/**
 * Calculate days remaining in subscription
 */
SubscriptionSchema.methods.daysRemaining = function() {
  if (!this.endDate) return 0;
  
  const now = new Date();
  const end = new Date(this.endDate);
  const diffTime = Math.max(0, end - now);
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  return diffDays;
};

/**
 * Activate subscription
 */
SubscriptionSchema.methods.activate = async function() {
  this.status = 'active';
  if (!this.startDate) {
    this.startDate = new Date();
  }
  await this.save();
  return this;
};

/**
 * Cancel subscription
 */
SubscriptionSchema.methods.cancel = async function(reason) {
  this.status = 'cancelled';
  this.cancelledAt = new Date();
  if (reason) {
    this.cancellationReason = reason;
  }
  await this.save();
  return this;
};

/**
 * Mark subscription as reminded for renewal
 */
SubscriptionSchema.methods.markAsReminded = async function() {
  this.renewalReminded = true;
  await this.save();
  return this;
};

/**
 * Track command usage
 */
SubscriptionSchema.methods.trackUsage = async function() {
  this.usageData.commandsUsed += 1;
  this.usageData.lastUsed = new Date();
  await this.save();
  return this;
};

// Create indexes for efficient queries
SubscriptionSchema.index({ status: 1, endDate: 1 });
SubscriptionSchema.index({ userId: 1, status: 1 });
SubscriptionSchema.index({ paymentId: 1 });

const Subscription = mongoose.model('Subscription', SubscriptionSchema);

module.exports = Subscription; 