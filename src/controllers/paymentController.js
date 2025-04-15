const Payment = require('../models/paymentModel');
const Subscription = require('../models/Subscription');
const logger = require('../utils/logger');
const { generatePaymentId, validatePaymentId, calculateFees, formatCurrency, verifySolanaTransaction } = require('../utils/paymentUtils');

/**
 * Payment controller for handling payment operations
 */
const paymentController = {
  /**
   * Create a new payment
   * @param {Object} paymentData Payment data
   * @returns {Promise<Object>} Created payment
   */
  async createPayment(paymentData) {
    try {
      const paymentId = generatePaymentId();
      
      // Calculate expiration (24 hours from now for payments to be completed)
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + 24);
      
      // Create payment record
      const payment = new Payment({
        paymentId,
        userId: paymentData.userId,
        userName: paymentData.userName,
        userUsername: paymentData.userUsername,
        groupId: paymentData.groupId,
        groupTitle: paymentData.groupTitle,
        amount: paymentData.amount,
        currency: paymentData.currency || 'SOL',
        type: paymentData.type || 'subscription',
        plan: paymentData.plan || 'standard',
        duration: paymentData.duration || 30,
        expiresAt
      });
      
      await payment.save();
      
      logger.info(`Created payment ${paymentId} for user ${paymentData.userId}`);
      return {
        success: true,
        payment
      };
    } catch (error) {
      logger.error(`Error creating payment: ${error.message}`);
      return {
        success: false,
        error: error.message
      };
    }
  },
  
  /**
   * Get payment details
   * @param {String} paymentId Payment ID
   * @returns {Promise<Object>} Payment details
   */
  async getPaymentDetails(paymentId) {
    try {
      if (!validatePaymentId(paymentId)) {
        return {
          success: false,
          error: 'Invalid payment ID format'
        };
      }
      
      const payment = await Payment.findOne({ paymentId });
      
      if (!payment) {
        return {
          success: false,
          error: 'Payment not found'
        };
      }
      
      // Calculate fees
      const { processingFee, platformFee, totalAmount } = calculateFees(payment.amount, payment.currency);
      
      return {
        success: true,
        payment,
        fees: {
          base: payment.amount,
          processing: processingFee,
          platform: platformFee,
          total: totalAmount
        },
        formattedFees: {
          base: formatCurrency(payment.amount, payment.currency),
          processing: formatCurrency(processingFee, payment.currency),
          platform: formatCurrency(platformFee, payment.currency),
          total: formatCurrency(totalAmount, payment.currency)
        }
      };
    } catch (error) {
      logger.error(`Error getting payment details: ${error.message}`);
      return {
        success: false,
        error: error.message
      };
    }
  },
  
  /**
   * Process payment (verify and confirm)
   * @param {String} paymentId Payment ID
   * @param {Object} transactionData Transaction data
   * @returns {Promise<Object>} Processed payment and subscription end date
   */
  async processPayment(paymentId, transactionData) {
    try {
      if (!validatePaymentId(paymentId)) {
        return {
          success: false,
          error: 'Invalid payment ID format'
        };
      }
      
      const payment = await Payment.findOne({ paymentId });
      
      if (!payment) {
        return {
          success: false,
          error: 'Payment not found'
        };
      }
      
      // Check if payment is already processed
      if (payment.status !== 'pending') {
        return {
          success: false,
          error: `Payment cannot be processed. Current status: ${payment.status}`
        };
      }
      
      // Check if payment is expired
      if (payment.isExpired) {
        await payment.expire();
        return {
          success: false,
          error: 'Payment has expired'
        };
      }
      
      // For Solana payments, verify the transaction
      if (payment.currency === 'SOL' || payment.currency === 'USDC') {
        const verification = await verifySolanaTransaction(transactionData.transactionId, {
          expectedAmount: calculateFees(payment.amount, payment.currency).totalAmount,
          expectedRecipient: process.env.SOLANA_WALLET_ADDRESS,
          expectedCurrency: payment.currency
        });
        
        if (!verification.success) {
          return {
            success: false,
            error: verification.error || 'Transaction verification failed'
          };
        }
      }
      
      // Confirm the payment
      await payment.confirm(transactionData);
      
      // Calculate subscription end date
      const subscriptionEnd = new Date();
      subscriptionEnd.setDate(subscriptionEnd.getDate() + payment.duration);
      
      return {
        success: true,
        payment,
        subscriptionEnd
      };
    } catch (error) {
      logger.error(`Error processing payment: ${error.message}`);
      return {
        success: false,
        error: error.message
      };
    }
  },
  
  /**
   * Cancel a payment
   * @param {String} paymentId Payment ID
   * @param {String} reason Cancellation reason
   * @returns {Promise<Object>} Updated payment
   */
  async cancelPayment(paymentId, reason = '') {
    try {
      if (!validatePaymentId(paymentId)) {
        return {
          success: false,
          error: 'Invalid payment ID format'
        };
      }
      
      const payment = await Payment.findOne({ paymentId });
      
      if (!payment) {
        return {
          success: false,
          error: 'Payment not found'
        };
      }
      
      // Only pending payments can be cancelled
      if (payment.status !== 'pending') {
        return {
          success: false,
          error: `Payment cannot be cancelled. Current status: ${payment.status}`
        };
      }
      
      await payment.cancel(reason);
      
      return {
        success: true,
        payment
      };
    } catch (error) {
      logger.error(`Error cancelling payment: ${error.message}`);
      return {
        success: false,
        error: error.message
      };
    }
  },
  
  /**
   * Get payment by ID
   * @param {String} paymentId Payment ID
   * @returns {Promise<Object>} Payment object
   */
  async getPayment(paymentId) {
    try {
      const payment = await Payment.findByPaymentId(paymentId);
      return payment;
    } catch (error) {
      logger.error(`Error fetching payment ${paymentId}: ${error.message}`);
      throw error;
    }
  },
  
  /**
   * List payments for a user
   * @param {Number} userId User ID
   * @returns {Promise<Array>} List of payments
   */
  async listUserPayments(userId) {
    try {
      const payments = await Payment.findByUserId(userId);
      return payments;
    } catch (error) {
      logger.error(`Error listing payments for user ${userId}: ${error.message}`);
      throw error;
    }
  },
  
  /**
   * List payments for a group
   * @param {Number} groupId Group ID
   * @returns {Promise<Array>} List of payments
   */
  async listGroupPayments(groupId) {
    try {
      const payments = await Payment.findByGroupId(groupId);
      return payments;
    } catch (error) {
      logger.error(`Error listing payments for group ${groupId}: ${error.message}`);
      throw error;
    }
  },
  
  /**
   * Check if a group has an active subscription
   * @param {Number} groupId Group ID
   * @returns {Promise<Boolean>} True if group has active subscription
   */
  async hasActiveSubscription(groupId) {
    try {
      const subscription = await Subscription.findOne({
        groupId,
        status: 'active',
        expiresAt: { $gt: new Date() }
      });
      
      return !!subscription;
    } catch (error) {
      logger.error(`Error checking subscription for group ${groupId}: ${error.message}`);
      throw error;
    }
  },
  
  /**
   * Get active subscription for a group
   * @param {Number} groupId Group ID
   * @returns {Promise<Object>} Subscription object or null
   */
  async getActiveSubscription(groupId) {
    try {
      const subscription = await Subscription.findOne({
        groupId,
        status: 'active',
        expiresAt: { $gt: new Date() }
      });
      
      return subscription;
    } catch (error) {
      logger.error(`Error getting subscription for group ${groupId}: ${error.message}`);
      throw error;
    }
  },
  
  /**
   * Check and update expired payments
   * @returns {Promise<Number>} Number of updated payments
   */
  async checkAndUpdateExpiredPayments() {
    try {
      const updated = await Payment.updateExpiredPayments();
      if (updated > 0) {
        logger.info(`Updated ${updated} expired payments`);
      }
      return updated;
    } catch (error) {
      logger.error(`Error updating expired payments: ${error.message}`);
      throw error;
    }
  },
  
  /**
   * Check and update expired subscriptions
   * @returns {Promise<Number>} Number of updated subscriptions
   */
  async checkAndUpdateExpiredSubscriptions() {
    try {
      const updated = await Subscription.updateExpiredSubscriptions();
      if (updated > 0) {
        logger.info(`Updated ${updated} expired subscriptions`);
      }
      return updated;
    } catch (error) {
      logger.error(`Error updating expired subscriptions: ${error.message}`);
      throw error;
    }
  },
  
  /**
   * Get subscriptions nearing expiration
   * @param {Number} days Days threshold for expiration
   * @returns {Promise<Array>} List of subscriptions nearing expiration
   */
  async getSubscriptionsNearingExpiration(days = 3) {
    try {
      const now = new Date();
      const expirationThreshold = new Date();
      expirationThreshold.setDate(now.getDate() + days);
      
      const subscriptions = await Subscription.find({
        status: 'active',
        expiresAt: { $gt: now, $lt: expirationThreshold }
      });
      
      return subscriptions;
    } catch (error) {
      logger.error(`Error getting subscriptions nearing expiration: ${error.message}`);
      throw error;
    }
  },
  
  /**
   * Process subscription renewals using saved payment methods
   * This is a placeholder for future implementation of automatic renewals
   */
  async processSubscriptionRenewals() {
    // This would be implemented when auto-renewal is supported
    // For now just log that this feature is not yet implemented
    logger.info('Automatic subscription renewal is not yet implemented');
    return { processed: 0, failed: 0 };
  },
  
  /**
   * Get user payment history
   * @param {Number} userId User ID
   * @returns {Promise<Array>} List of payments
   */
  async getUserPayments(userId) {
    try {
      const payments = await Payment.findByUser(userId);
      
      return {
        success: true,
        payments
      };
    } catch (error) {
      logger.error(`Error getting user payments: ${error.message}`);
      return {
        success: false,
        error: error.message
      };
    }
  },
  
  /**
   * Get group payment history
   * @param {Number} groupId Group ID
   * @returns {Promise<Array>} List of payments
   */
  async getGroupPayments(groupId) {
    try {
      const payments = await Payment.findByGroup(groupId);
      
      return {
        success: true,
        payments
      };
    } catch (error) {
      logger.error(`Error getting group payments: ${error.message}`);
      return {
        success: false,
        error: error.message
      };
    }
  },
  
  /**
   * Clean up expired payments
   * @returns {Promise<Object>} Result of cleanup operation
   */
  async cleanupExpiredPayments() {
    try {
      const expiredPayments = await Payment.findExpired();
      
      let processed = 0;
      for (const payment of expiredPayments) {
        await payment.expire();
        processed++;
      }
      
      return {
        success: true,
        expiredCount: processed
      };
    } catch (error) {
      logger.error(`Error cleaning up expired payments: ${error.message}`);
      return {
        success: false,
        error: error.message
      };
    }
  }
};

module.exports = paymentController; 