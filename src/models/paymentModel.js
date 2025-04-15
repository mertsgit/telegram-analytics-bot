const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema({
  paymentId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  userId: {
    type: String,
    required: true,
    index: true
  },
  username: String,
  groupId: {
    type: String,
    index: true
  },
  groupName: String,
  amount: {
    type: Number,
    required: true
  },
  currency: {
    type: String,
    required: true,
    default: 'SOL'
  },
  processingFee: Number,
  platformFee: Number,
  totalAmount: Number,
  status: {
    type: String,
    enum: ['pending', 'completed', 'failed', 'expired', 'cancelled'],
    default: 'pending',
    index: true
  },
  type: {
    type: String,
    enum: ['subscription', 'feature', 'donation', 'premium'],
    required: true
  },
  description: String,
  walletAddress: String,
  network: {
    type: String,
    enum: ['solana', 'ethereum', 'bsc'],
    default: 'solana'
  },
  transactionId: String,
  expiresAt: {
    type: Date,
    index: true
  },
  metadata: mongoose.Schema.Types.Mixed,
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, { timestamps: { updatedAt: 'updatedAt' } });

// Add index for querying active payments
paymentSchema.index({ status: 1, expiresAt: 1 });

// Define the Payment model
const Payment = mongoose.model('Payment', paymentSchema);

module.exports = Payment; 