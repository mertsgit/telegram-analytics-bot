const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema({
  // Telegram info
  groupId: {
    type: Number,
    required: true,
    index: true
  },
  groupTitle: {
    type: String,
    default: 'Unknown Group'
  },
  requestedBy: {
    type: Number, // Telegram user ID
    required: true
  },
  requestedByName: String,
  
  // Payment info
  solanaWallet: {
    type: String,
    required: true
  },
  paymentAmount: {
    type: Number,
    required: true
  },
  paymentType: {
    type: String,
    enum: ['3-month', 'annual'],
    required: true
  },
  transactionId: {
    type: String,
    sparse: true,
    index: true
  },
  transactionSignature: {
    type: String,
    sparse: true
  },
  
  // Status
  paymentStatus: {
    type: String,
    enum: ['pending', 'verified', 'expired', 'rejected'],
    default: 'pending'
  },
  
  // Dates
  requestDate: {
    type: Date,
    default: Date.now
  },
  verificationDate: Date,
  expirationDate: Date,
  
  // Payment verification notes
  verificationNotes: String
});

// Static method to check if a group has an active subscription
paymentSchema.statics.hasActiveSubscription = async function(groupId) {
  const now = new Date();
  
  // Find payments that are verified and not expired
  const activePayment = await this.findOne({
    groupId,
    paymentStatus: 'verified',
    expirationDate: { $gt: now }
  }).sort({ expirationDate: -1 });
  
  return !!activePayment;
};

// Static method to check if a transaction has been used before
paymentSchema.statics.isTransactionUsed = async function(transactionId) {
  const payment = await this.findOne({ transactionId });
  return !!payment;
};

// Static method to get subscription details for a group
paymentSchema.statics.getGroupSubscription = async function(groupId) {
  const now = new Date();
  
  // Find the active subscription
  const subscription = await this.findOne({
    groupId,
    paymentStatus: 'verified',
    expirationDate: { $gt: now }
  }).sort({ expirationDate: -1 });
  
  if (!subscription) {
    return null;
  }
  
  // Calculate days remaining
  const daysRemaining = Math.ceil((subscription.expirationDate - now) / (1000 * 60 * 60 * 24));
  
  return {
    groupId: subscription.groupId,
    paymentType: subscription.paymentType,
    expirationDate: subscription.expirationDate,
    daysRemaining,
    solanaWallet: subscription.solanaWallet,
    transactionId: subscription.transactionId
  };
};

const Payment = mongoose.model('Payment', paymentSchema);

module.exports = Payment; 