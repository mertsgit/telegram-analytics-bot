const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

/**
 * Payment schema for handling transaction records
 */
const paymentSchema = new mongoose.Schema({
  // Unique payment identifier
  paymentId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  
  // User information
  userId: {
    type: String,
    required: true,
    index: true
  },
  telegramUserId: {
    type: Number,
    index: true
  },
  userName: String,
  userUsername: String,
  
  // Group information (if applicable)
  groupId: {
    type: Number,
    index: true
  },
  groupTitle: String,
  
  // Payment details
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  totalAmount: {
    type: Number,
    required: true,
    min: 0
  },
  processingFee: {
    type: Number,
    required: true,
    min: 0
  },
  platformFee: {
    type: Number,
    required: true,
    min: 0
  },
  currency: {
    type: String,
    required: true,
    enum: ['SOL', 'USDC', 'USD'],
    default: 'SOL',
    uppercase: true
  },
  paymentMethod: {
    type: String,
    required: true,
    enum: ['solana', 'crypto', 'card', 'bank', 'other']
  },
  
  // Payment status
  status: {
    type: String,
    required: true,
    enum: ['pending', 'processing', 'completed', 'failed', 'expired', 'cancelled'],
    default: 'pending',
    lowercase: true,
    index: true
  },
  
  // Related subscription
  subscriptionId: {
    type: String,
    index: true
  },
  
  // Transaction information
  transactionId: {
    type: String,
    sparse: true
  },
  
  // Timing information
  createdAt: {
    type: Date,
    default: Date.now
  },
  confirmedAt: Date,
  expiresAt: {
    type: Date,
    required: true,
    index: true
  },
  
  // Additional metadata
  metadata: {
    type: Object,
    default: {}
  },
  
  // Notes or additional information
  notes: String,
  
  // Failure and cancellation reasons
  failureReason: {
    type: String
  },
  cancellationReason: {
    type: String
  },
  
  // Completed at
  completedAt: {
    type: Date
  },
  
  // Wallet address
  walletAddress: {
    type: String
  },
  
  // Purpose
  purpose: {
    type: String,
    required: true,
    enum: ['subscription', 'upgrade', 'tip', 'donation', 'service', 'other'],
    default: 'other',
    lowercase: true
  }
}, { 
  timestamps: true,
  versionKey: false
});

// Indexes
paymentSchema.index({ createdAt: -1 });
paymentSchema.index({ status: 1, expiresAt: 1 });
paymentSchema.index({ userId: 1, status: 1 });

/**
 * Generate a unique payment ID
 * @returns {Promise<String>} A unique payment ID
 */
paymentSchema.statics.generatePaymentId = async function() {
  let isUnique = false;
  let paymentId;
  
  while (!isUnique) {
    // Generate a payment ID with 'pay_' prefix
    paymentId = 'pay_' + uuidv4().replace(/-/g, '').substring(0, 16);
    
    // Check if the ID already exists
    const existingPayment = await this.findOne({ paymentId });
    if (!existingPayment) {
      isUnique = true;
    }
  }
  
  return paymentId;
};

/**
 * Find a payment by its payment ID
 * @param {String} paymentId - The payment ID to find
 * @returns {Promise<Object>} The payment document or null
 */
paymentSchema.statics.findByPaymentId = function(paymentId) {
  return this.findOne({ paymentId });
};

/**
 * Find all payments by user ID
 * @param {Number} userId - The user ID to search for
 * @returns {Promise<Array>} List of payments
 */
paymentSchema.statics.findByUserId = function(userId) {
  return this.find({ userId }).sort({ createdAt: -1 });
};

/**
 * Find all payments by group ID
 * @param {Number} groupId - The group ID to search for
 * @returns {Promise<Array>} List of payments
 */
paymentSchema.statics.findByGroupId = function(groupId) {
  return this.find({ groupId }).sort({ createdAt: -1 });
};

/**
 * Update expired pending payments
 * @returns {Promise<Number>} Number of updated payments
 */
paymentSchema.statics.updateExpiredPayments = async function() {
  const now = new Date();
  const result = await this.updateMany(
    {
      status: 'pending',
      expiresAt: { $lt: now }
    },
    {
      $set: {
        status: 'expired',
        notes: 'Payment expired automatically due to timeout'
      }
    }
  );
  
  return result.nModified;
};

/**
 * Find payments that need reminder notification
 * @param {Number} minutesBeforeExpiry - Minutes before expiry to send reminder
 * @returns {Promise<Array>} Payments needing reminder
 */
paymentSchema.statics.findPaymentsNeedingReminder = function(minutesBeforeExpiry = 10) {
  const now = new Date();
  const reminderTime = new Date(now.getTime() + minutesBeforeExpiry * 60 * 1000);
  
  return this.find({
    status: 'pending',
    expiresAt: { $gt: now, $lt: reminderTime }
  });
};

// Create the Payment model
const Payment = mongoose.model('Payment', paymentSchema);

module.exports = Payment; 