const mongoose = require('mongoose');
const Payment = require('../models/payment');
const { createLogger } = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');
const QRCode = require('qrcode');
const { 
  generatePaymentId, 
  calculateFees, 
  formatCurrency,
  verifySolanaTransaction,
  generatePaymentQRCode
} = require('../utils/paymentUtils');

const logger = createLogger('PaymentService');

// Define payment schema
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
  amount: {
    type: Number,
    required: true
  },
  totalAmount: {
    type: Number,
    required: true
  },
  processingFee: {
    type: Number,
    required: true
  },
  platformFee: {
    type: Number,
    required: true
  },
  currency: {
    type: String,
    required: true,
    default: 'SOL',
    enum: ['SOL', 'USDC', 'USD']
  },
  status: {
    type: String,
    required: true,
    enum: ['pending', 'completed', 'failed', 'expired', 'cancelled'],
    default: 'pending',
    index: true
  },
  purpose: {
    type: String,
    required: true
  },
  metadata: {
    type: Map,
    of: mongoose.Schema.Types.Mixed,
    default: {}
  },
  walletAddress: {
    type: String,
    required: true
  },
  expiresAt: {
    type: Date,
    required: true,
    index: true
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  updatedAt: {
    type: Date,
    default: Date.now
  },
  completedAt: {
    type: Date
  },
  transactionId: {
    type: String,
    sparse: true
  },
  failureReason: String,
  cancellationReason: String
});

// Create indexes for common queries
paymentSchema.index({ userId: 1, status: 1 });
paymentSchema.index({ userId: 1, createdAt: -1 });
paymentSchema.index({ status: 1, expiresAt: 1 });

const PaymentModel = mongoose.model('Payment', paymentSchema);

class PaymentService {
  /**
   * Create a new payment
   * @param {Object} paymentData Payment data
   * @param {string} paymentData.userId User ID
   * @param {number} paymentData.amount Amount to be paid
   * @param {string} paymentData.currency Currency (SOL, USDC, USD)
   * @param {string} paymentData.description Payment description
   * @param {string} paymentData.paymentMethod Payment method
   * @param {string} [paymentData.destinationWallet] Destination wallet address for crypto payments
   * @param {Object} [paymentData.metadata] Additional metadata
   * @returns {Promise<Object>} Created payment
   */
  async createPayment(paymentData) {
    try {
      // Validate required fields
      if (!paymentData.userId || !paymentData.amount || !paymentData.description) {
        throw new Error('Missing required payment data');
      }

      // Calculate fees (example calculation - adjust based on your business logic)
      const processingFee = this._calculateProcessingFee(paymentData.amount, paymentData.paymentMethod);
      const platformFee = this._calculatePlatformFee(paymentData.amount);
      const totalAmount = paymentData.amount + processingFee + platformFee;

      // Set expiration time (default 30 minutes)
      const expiresAt = new Date();
      expiresAt.setMinutes(expiresAt.getMinutes() + 30);

      // Create payment object
      const payment = new PaymentModel({
        paymentId: `PAY-${uuidv4().substring(0, 8)}`,
        userId: paymentData.userId,
        amount: paymentData.amount,
        currency: paymentData.currency || 'SOL',
        processingFee,
        platformFee,
        totalAmount,
        description: paymentData.description,
        status: 'pending',
        paymentMethod: paymentData.paymentMethod || 'CRYPTO',
        destinationWallet: paymentData.destinationWallet,
        createdAt: new Date(),
        updatedAt: new Date(),
        expiresAt,
        metadata: paymentData.metadata || {}
      });

      // Save to database
      const savedPayment = await payment.save();
      logger.info(`Created payment ${savedPayment.paymentId} for user ${savedPayment.userId}`);
      
      return savedPayment;
    } catch (error) {
      logger.error(`Error creating payment: ${error.message}`, error);
      throw error;
    }
  }

  /**
   * Get payment by ID
   * @param {string} paymentId Payment ID
   * @returns {Promise<Object>} Payment object
   */
  async getPaymentById(paymentId) {
    try {
      const payment = await PaymentModel.findOne({ paymentId });
      if (!payment) {
        throw new Error(`Payment not found with ID: ${paymentId}`);
      }
      return payment;
    } catch (error) {
      logger.error(`Error getting payment ${paymentId}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get payments for a user
   * @param {string} userId User ID
   * @param {Object} options Options for filtering
   * @param {string} [options.status] Filter by status
   * @param {number} [options.limit=10] Limit number of results
   * @param {number} [options.skip=0] Skip number of results
   * @returns {Promise<Array>} Array of payment objects
   */
  async getUserPayments(userId, options = {}) {
    try {
      const { status, limit = 10, skip = 0 } = options;
      
      const query = { userId };
      if (status) {
        query.status = status;
      }
      
      const payments = await PaymentModel.find(query)
        .sort({ createdAt: -1 })
        .limit(limit)
        .skip(skip);
      
      return payments;
    } catch (error) {
      logger.error(`Error getting payments for user ${userId}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Update payment status
   * @param {string} paymentId Payment ID
   * @param {string} status New status
   * @param {Object} [additionalData] Additional data to update
   * @returns {Promise<Object>} Updated payment
   */
  async updatePaymentStatus(paymentId, status, additionalData = {}) {
    try {
      // Validate status
      const validStatuses = ['pending', 'completed', 'failed', 'expired', 'cancelled'];
      if (!validStatuses.includes(status)) {
        throw new Error(`Invalid status: ${status}`);
      }
      
      const payment = await this.getPaymentById(paymentId);
      
      // Prevent updating if already in a final state
      if (['completed', 'failed', 'cancelled'].includes(payment.status) && 
          payment.status !== status) {
        throw new Error(`Cannot update payment in final state: ${payment.status}`);
      }
      
      // Update payment
      const updateData = {
        status,
        updatedAt: new Date(),
        ...additionalData
      };
      
      const updatedPayment = await PaymentModel.findOneAndUpdate(
        { paymentId },
        { $set: updateData },
        { new: true }
      );
      
      logger.info(`Updated payment ${paymentId} status to ${status}`);
      return updatedPayment;
    } catch (error) {
      logger.error(`Error updating payment ${paymentId}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Verify a payment (e.g., check blockchain transaction)
   * @param {string} paymentId Payment ID
   * @param {string} transactionId Transaction ID
   * @returns {Promise<Object>} Verified payment
   */
  async verifyPayment(paymentId, transactionId) {
    try {
      const payment = await this.getPaymentById(paymentId);
      
      if (payment.status !== 'pending') {
        throw new Error(`Cannot verify payment with status: ${payment.status}`);
      }
      
      // Here you would implement actual verification logic
      // For example, checking a Solana transaction
      const isValid = await this._verifyTransaction(transactionId, payment);
      
      if (!isValid) {
        await this.updatePaymentStatus(paymentId, 'failed', {
          notes: 'Transaction verification failed'
        });
        throw new Error('Transaction verification failed');
      }
      
      // Update payment to completed
      return await this.updatePaymentStatus(paymentId, 'completed', {
        transactionId,
        verificationData: { verified: true, verifiedAt: new Date() }
      });
    } catch (error) {
      logger.error(`Error verifying payment ${paymentId}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Cancel a payment
   * @param {string} paymentId Payment ID
   * @param {string} reason Cancellation reason
   * @returns {Promise<Object>} Cancelled payment
   */
  async cancelPayment(paymentId, reason = 'User cancelled') {
    try {
      const payment = await this.getPaymentById(paymentId);
      
      if (['completed', 'cancelled'].includes(payment.status)) {
        throw new Error(`Cannot cancel payment with status: ${payment.status}`);
      }
      
      return await this.updatePaymentStatus(paymentId, 'cancelled', {
        notes: reason
      });
    } catch (error) {
      logger.error(`Error cancelling payment ${paymentId}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Generate a QR code for a payment
   * @param {string} paymentId Payment ID
   * @returns {Promise<string>} QR code data URL
   */
  async generatePaymentQR(paymentId) {
    try {
      const payment = await this.getPaymentById(paymentId);
      
      if (payment.status !== 'pending') {
        throw new Error(`Cannot generate QR for payment with status: ${payment.status}`);
      }
      
      // For crypto payments, create a QR with wallet address and amount
      let qrData;
      
      if (payment.paymentMethod === 'CRYPTO') {
        qrData = JSON.stringify({
          paymentId: payment.paymentId,
          wallet: payment.destinationWallet,
          amount: payment.totalAmount,
          currency: payment.currency
        });
      } else {
        // For other payment methods, simply encode the payment ID
        qrData = `PAYMENT:${payment.paymentId}`;
      }
      
      // Generate QR code as data URL
      const qrCodeUrl = await QRCode.toDataURL(qrData);
      return qrCodeUrl;
    } catch (error) {
      logger.error(`Error generating QR for payment ${paymentId}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Expire outdated payments
   * @returns {Promise<number>} Number of expired payments
   */
  async expireOutdatedPayments() {
    try {
      const now = new Date();
      
      const result = await PaymentModel.updateMany(
        { 
          status: 'pending',
          expiresAt: { $lt: now }
        },
        {
          $set: {
            status: 'expired',
            updatedAt: now,
            notes: 'Automatically expired due to timeout'
          }
        }
      );
      
      logger.info(`Expired ${result.nModified} outdated payments`);
      return result.nModified;
    } catch (error) {
      logger.error(`Error expiring outdated payments: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get payment statistics
   * @param {Object} [filters] Filters to apply
   * @param {string} [filters.userId] Filter by user
   * @param {string} [filters.status] Filter by status
   * @param {Date} [filters.startDate] Start date
   * @param {Date} [filters.endDate] End date
   * @returns {Promise<Object>} Payment statistics
   */
  async getPaymentStats(filters = {}) {
    try {
      const query = {};
      
      if (filters.userId) query.userId = filters.userId;
      if (filters.status) query.status = filters.status;
      
      if (filters.startDate || filters.endDate) {
        query.createdAt = {};
        if (filters.startDate) query.createdAt.$gte = filters.startDate;
        if (filters.endDate) query.createdAt.$lte = filters.endDate;
      }
      
      // Get total payments and amount
      const [payments, totalAmount] = await Promise.all([
        PaymentModel.countDocuments(query),
        PaymentModel.aggregate([
          { $match: query },
          { $group: { _id: null, total: { $sum: '$amount' } } }
        ])
      ]);
      
      // Get status breakdown
      const statusBreakdown = await PaymentModel.aggregate([
        { $match: query },
        { $group: { _id: '$status', count: { $sum: 1 } } }
      ]);
      
      // Format status breakdown
      const formattedStatusBreakdown = statusBreakdown.reduce((acc, curr) => {
        acc[curr._id] = curr.count;
        return acc;
      }, {});
      
      return {
        totalPayments: payments,
        totalAmount: totalAmount.length > 0 ? totalAmount[0].total : 0,
        statusBreakdown: formattedStatusBreakdown
      };
    } catch (error) {
      logger.error(`Error getting payment stats: ${error.message}`);
      throw error;
    }
  }

  /**
   * Calculate processing fee based on amount and payment method
   * @private
   * @param {number} amount Payment amount
   * @param {string} paymentMethod Payment method
   * @returns {number} Processing fee
   */
  _calculateProcessingFee(amount, paymentMethod) {
    // Example fee calculation - adjust based on your business logic
    switch (paymentMethod) {
      case 'CRYPTO':
        return amount * 0.01; // 1% fee
      case 'CARD':
        return amount * 0.029 + 0.30; // 2.9% + 30 cents
      case 'BANK_TRANSFER':
        return amount * 0.008; // 0.8% fee
      default:
        return amount * 0.01; // Default 1% fee
    }
  }

  /**
   * Calculate platform fee
   * @private
   * @param {number} amount Payment amount
   * @returns {number} Platform fee
   */
  _calculatePlatformFee(amount) {
    // Example platform fee - adjust based on your business logic
    return amount * 0.005; // 0.5% platform fee
  }

  /**
   * Verify a transaction on the blockchain
   * @private
   * @param {string} transactionId Transaction ID
   * @param {Object} payment Payment object
   * @returns {Promise<boolean>} Whether the transaction is valid
   */
  async _verifyTransaction(transactionId, payment) {
    // Placeholder for actual transaction verification logic
    // This would typically involve checking the blockchain
    
    // Example implementation (replace with actual verification)
    logger.info(`Verifying transaction ${transactionId} for payment ${payment.paymentId}`);
    
    // Simulate verification (in a real implementation, you would check the blockchain)
    return true;
  }
}

// Export singleton instance
module.exports = new PaymentService(); 