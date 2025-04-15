/**
 * Payment utility functions
 */
const crypto = require('crypto');
const { Connection, PublicKey, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const logger = require('./logger');
const QRCode = require('qrcode');

const paymentUtils = {
  /**
   * Generate a random payment ID
   * Format: P-YYYY-MM-DD-XXXXXXXXX
   * @returns {String} Payment ID
   */
  generatePaymentId() {
    try {
      const date = new Date();
      const year = date.getFullYear();
      // Months are 0-indexed, so add 1
      const month = (date.getMonth() + 1).toString().padStart(2, '0');
      const day = date.getDate().toString().padStart(2, '0');
      
      // Generate 9 random characters (using 6 bytes gives us 12 hex chars, so we'll take 9)
      const randomBytes = crypto.randomBytes(6).toString('hex').substring(0, 9).toUpperCase();
      
      const paymentId = `P-${year}-${month}-${day}-${randomBytes}`;
      return paymentId;
    } catch (error) {
      logger.error(`Error generating payment ID: ${error.message}`);
      throw error;
    }
  },
  
  /**
   * Validate a payment ID format
   * @param {String} paymentId Payment ID to validate
   * @returns {Boolean} True if valid
   */
  validatePaymentId(paymentId) {
    if (!paymentId) return false;
    
    // Pattern: P-YYYY-MM-DD-XXXXXXXXX where X is alphanumeric
    const pattern = /^P-\d{4}-\d{2}-\d{2}-[A-Z0-9]{9}$/;
    return pattern.test(paymentId);
  },
  
  /**
   * Calculate fees for a payment amount
   * @param {Number} amount Payment amount
   * @param {String} currency Currency code
   * @returns {Object} Fee breakdown
   */
  calculateFees(amount, currency = 'SOL') {
    const fees = {
      processingFee: 0,
      platformFee: 0,
      total: 0
    };
    
    // Processing fee (e.g., network fees)
    // This would normally come from a payment processor
    if (currency === 'SOL') {
      fees.processingFee = 0.000005; // Example Solana network fee
    } else if (currency === 'USDC') {
      fees.processingFee = 0.01; // Example USDC fee
    } else {
      fees.processingFee = amount * 0.005; // Default 0.5% for other currencies
    }
    
    // Platform fee (our revenue)
    fees.platformFee = amount * 0.05; // 5% platform fee
    
    // Total fees
    fees.total = fees.processingFee + fees.platformFee;
    
    return fees;
  },
  
  /**
   * Format currency amount with appropriate symbol
   * @param {Number} amount Amount to format
   * @param {String} currency Currency code
   * @returns {String} Formatted amount
   */
  formatCurrency(amount, currency = 'SOL') {
    try {
      if (!amount && amount !== 0) return '';
      
      const symbols = {
        SOL: 'SOL',
        USDC: 'USDC',
        USD: '$',
        EUR: '€',
        GBP: '£',
        BTC: '₿',
        ETH: 'Ξ'
      };
      
      const symbol = symbols[currency] || currency;
      
      // Format different cryptocurrencies appropriately
      if (['BTC', 'ETH', 'SOL'].includes(currency)) {
        // Show up to 6 decimal places for crypto
        return `${amount.toFixed(6)} ${symbol}`;
      } else if (['USDC', 'USDT'].includes(currency)) {
        // Stablecoins typically show 2 decimal places
        return `${amount.toFixed(2)} ${symbol}`;
      } else {
        // Fiat currencies with symbol in front
        return `${symbol}${amount.toFixed(2)}`;
      }
    } catch (error) {
      logger.error(`Error formatting currency: ${error.message}`);
      return `${amount} ${currency}`;
    }
  },
  
  /**
   * Verify a Solana transaction
   * @param {String} signature Transaction signature
   * @param {Object} options Verification options
   * @returns {Promise<Object>} Verification result
   */
  async verifySolanaTransaction(signature, options = {}) {
    const { expectedAmount, expectedCurrency, walletAddress } = options;
    
    try {
      // Connect to Solana mainnet
      const connection = new Connection(
        'https://api.mainnet-beta.solana.com',
        'confirmed'
      );
      
      // Get transaction details
      const transaction = await connection.getTransaction(signature, {
        commitment: 'confirmed',
      });
      
      if (!transaction) {
        return {
          verified: false,
          message: 'Transaction not found on blockchain'
        };
      }
      
      // Check if transaction is successful
      if (!transaction.meta.err) {
        // Extract details from transaction
        const postBalances = transaction.meta.postBalances;
        const preBalances = transaction.meta.preBalances;
        
        // Check for SOL transfers
        if (expectedCurrency === 'SOL') {
          // Calculate amount transferred
          const receiverIndex = transaction.transaction.message.accountKeys.findIndex(
            (key) => key.toString() === walletAddress
          );
          
          if (receiverIndex !== -1) {
            const amountTransferred = (postBalances[receiverIndex] - preBalances[receiverIndex]) / LAMPORTS_PER_SOL;
            
            if (Math.abs(amountTransferred - expectedAmount) < 0.001) {
              return {
                verified: true,
                amount: amountTransferred,
                message: 'Transaction verified successfully'
              };
            } else {
              return {
                verified: false,
                message: `Amount mismatch: expected ${expectedAmount} SOL, got ${amountTransferred} SOL`
              };
            }
          }
        }
        
        // For other token types (USDC, etc.), additional processing would be needed here
        
        return {
          verified: true,
          message: 'Transaction is valid, but detailed verification not implemented for this token type'
        };
      } else {
        return {
          verified: false,
          message: 'Transaction failed on blockchain'
        };
      }
    } catch (error) {
      console.error('Error verifying Solana transaction:', error);
      return {
        verified: false,
        message: `Verification error: ${error.message}`
      };
    }
  },
  
  /**
   * Converts a payment link to a QR code data URL
   * @param {String} paymentLink - Payment link to encode
   * @returns {Promise<String>} QR code data URL
   */
  async generatePaymentQRCode(paymentLink) {
    try {
      if (!paymentLink) throw new Error('Payment link is required');
      
      // QR code options
      const options = {
        errorCorrectionLevel: 'M',
        margin: 4,
        scale: 8,
        color: {
          dark: '#000000',
          light: '#ffffff'
        }
      };
      
      // Generate QR code as data URL
      const dataUrl = await QRCode.toDataURL(paymentLink, options);
      return dataUrl;
    } catch (error) {
      console.error('Error generating QR code:', error);
      throw new Error(`Failed to generate QR code: ${error.message}`);
    }
  }
};

module.exports = paymentUtils; 