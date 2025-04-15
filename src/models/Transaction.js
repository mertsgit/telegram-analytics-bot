const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  // Transaction identifiers
  signature: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  
  // Transaction data
  amount: {
    type: Number,
    required: true
  },
  token: {
    type: String,
    enum: ['SOL', 'USDC', 'USDT'],
    default: 'SOL'
  },
  
  // Wallet addresses
  fromWallet: {
    type: String,
    required: true
  },
  toWallet: {
    type: String,
    required: true
  },
  
  // Status
  status: {
    type: String,
    enum: ['confirmed', 'finalized', 'failed', 'pending'],
    default: 'pending'
  },
  verified: {
    type: Boolean,
    default: false
  },
  
  // Subscription and payment references
  subscriptionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Subscription',
    sparse: true
  },
  paymentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Payment',
    sparse: true
  },
  
  // User/group data
  userId: Number,
  userName: String,
  groupId: Number,
  groupTitle: String,
  
  // Additional transaction data from blockchain
  blockTime: Date,
  slot: Number,
  confirmations: Number,
  recentBlockhash: String,
  
  // Timestamps
  verifiedAt: Date,
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, { timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' } });

// Static method to check if a transaction signature exists
transactionSchema.statics.isSignatureUsed = async function(signature) {
  const transaction = await this.findOne({ signature });
  return !!transaction;
};

// Static method to find a transaction by signature
transactionSchema.statics.findBySignature = function(signature) {
  return this.findOne({ signature });
};

// Static method to verify a transaction
transactionSchema.statics.verifyTransaction = async function(signature, verificationData) {
  const transaction = await this.findOne({ signature });
  
  if (!transaction) {
    return null;
  }
  
  transaction.status = verificationData.status || 'confirmed';
  transaction.verified = true;
  transaction.verifiedAt = new Date();
  
  if (verificationData.confirmations) {
    transaction.confirmations = verificationData.confirmations;
  }
  
  if (verificationData.blockTime) {
    transaction.blockTime = new Date(verificationData.blockTime * 1000); // Convert to milliseconds
  }
  
  if (verificationData.slot) {
    transaction.slot = verificationData.slot;
  }
  
  await transaction.save();
  return transaction;
};

// Static method to get all transactions for a group
transactionSchema.statics.getGroupTransactions = function(groupId) {
  return this.find({ groupId }).sort({ createdAt: -1 });
};

const Transaction = mongoose.model('Transaction', transactionSchema);

module.exports = Transaction; 