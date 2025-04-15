const axios = require('axios');
require('dotenv').config();

// Solana payment configuration
const PAYMENT_ADDRESS = '78nfbiMGXTsVkLDDw88WFV4PKDsuMjwajx6yQk8zx3n6';
const THREE_MONTH_PAYMENT = 1; // 1 SOL
const ANNUAL_PAYMENT = 3; // 3 SOL

// Solana API endpoints 
const SOLANA_MAINNET_RPC = 'https://api.mainnet-beta.solana.com';
const SOLSCAN_API = 'https://public-api.solscan.io/transaction';

/**
 * Check if a Solana transaction is valid for our payment system
 * @param {string} txSignature - Transaction signature to verify
 * @param {string} fromWallet - Expected sender wallet address
 * @param {string} paymentType - Type of payment (3-month or annual)
 * @returns {Promise<Object>} Verification result
 */
async function verifyPaymentTransaction(txSignature, fromWallet, paymentType) {
  try {
    console.log(`Verifying Solana transaction: ${txSignature} from wallet: ${fromWallet}`);
    
    // Use Solscan API to get detailed transaction info
    const response = await axios.get(`${SOLSCAN_API}/${txSignature}`, {
      headers: {
        'Accept': 'application/json'
      }
    });
    
    // Check if transaction exists
    if (!response.data || response.data.status !== 'Success') {
      return {
        isValid: false,
        message: 'Transaction not found or unsuccessful'
      };
    }
    
    // Validate transaction details
    const txData = response.data;
    
    // Extract sender and receiver
    let senderAddress = null;
    let receiverAddress = null;
    let lamports = 0;
    
    // Check if transaction has proper instructions
    if (txData.parsedInstruction && txData.parsedInstruction.length > 0) {
      // Look for a transfer instruction
      const transferInst = txData.parsedInstruction.find(inst => 
        inst.type === 'transfer' || 
        (inst.program === 'system' && inst.name === 'transfer')
      );
      
      if (transferInst) {
        senderAddress = transferInst.source;
        receiverAddress = transferInst.destination;
        lamports = transferInst.amount || transferInst.lamports || 0;
      }
    }
    
    // If we couldn't parse from instructions, try other fields
    if (!senderAddress && txData.signer && txData.signer.length > 0) {
      senderAddress = txData.signer[0];
    }
    
    if (!receiverAddress && txData.mainActions && txData.mainActions.length > 0) {
      const transferAction = txData.mainActions.find(action => action.type === 'sol-transfer');
      if (transferAction) {
        receiverAddress = transferAction.data.destination;
        if (!lamports && transferAction.data.amount) {
          lamports = transferAction.data.amount;
        }
      }
    }
    
    // Convert lamports to SOL
    const solAmount = lamports / 1000000000; // 1 SOL = 1,000,000,000 lamports
    
    // Expected payment amount
    const expectedAmount = paymentType === 'annual' ? ANNUAL_PAYMENT : THREE_MONTH_PAYMENT;
    
    // Validate address and amount
    const validations = [
      { condition: senderAddress?.toLowerCase() === fromWallet.toLowerCase(), message: 'Transaction not sent from specified wallet' },
      { condition: receiverAddress?.toLowerCase() === PAYMENT_ADDRESS.toLowerCase(), message: 'Transaction not sent to payment address' },
      { condition: solAmount >= expectedAmount, message: `Payment amount too low. Expected: ${expectedAmount} SOL, received: ${solAmount} SOL` }
    ];
    
    for (const validation of validations) {
      if (!validation.condition) {
        return {
          isValid: false,
          message: validation.message
        };
      }
    }
    
    // All validations passed
    return {
      isValid: true,
      message: 'Transaction verified successfully',
      details: {
        amount: solAmount,
        timestamp: txData.blockTime ? new Date(txData.blockTime * 1000) : new Date(),
        sender: senderAddress,
        receiver: receiverAddress
      }
    };
    
  } catch (error) {
    console.error('Error verifying Solana transaction:', error);
    
    // Provide meaningful error messages
    if (error.response) {
      // API responded with error
      return {
        isValid: false,
        message: `API error: ${error.response.status} - ${error.response.data?.message || 'Unknown error'}`
      };
    } else if (error.request) {
      // No response received
      return {
        isValid: false,
        message: 'No response from Solana API. Network issue or timeout.'
      };
    } else {
      // Other errors
      return {
        isValid: false,
        message: `Error verifying transaction: ${error.message}`
      };
    }
  }
}

/**
 * Calculate subscription expiration date
 * @param {string} paymentType - '3-month' or 'annual'
 * @returns {Date} Expiration date
 */
function calculateExpirationDate(paymentType) {
  const now = new Date();
  
  if (paymentType === 'annual') {
    // Add 1 year
    return new Date(now.setFullYear(now.getFullYear() + 1));
  } else {
    // Add 3 months (default)
    return new Date(now.setMonth(now.getMonth() + 3));
  }
}

module.exports = {
  PAYMENT_ADDRESS,
  THREE_MONTH_PAYMENT,
  ANNUAL_PAYMENT,
  verifyPaymentTransaction,
  calculateExpirationDate
}; 