const { Connection, PublicKey, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const dotenv = require('dotenv');

dotenv.config();

// Initialize Solana connection
const connection = new Connection(
  process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
  'confirmed'
);

// Receiver wallet address (the bot's wallet that should receive payments)
const RECEIVER_ADDRESS = process.env.PAYMENT_WALLET_ADDRESS || '';

// Required payment amounts (in SOL)
const PAYMENT_AMOUNTS = {
  quarterly: 0.05, // 0.05 SOL for quarterly subscription
  annual: 0.15     // 0.15 SOL for annual subscription
};

// Maximum age of transaction to be considered valid (in hours)
const MAX_TRANSACTION_AGE_HOURS = 24;

// Payment troubleshooting messages
const PAYMENT_TROUBLESHOOTING = {
  INVALID_SIGNATURE: {
    message: "The transaction signature format is invalid.",
    troubleshooting: "Please make sure you've copied the entire transaction signature from your wallet or the Solana explorer. It should be a long string of letters and numbers."
  },
  TRANSACTION_NOT_FOUND: {
    message: "Transaction not found on the Solana blockchain.",
    troubleshooting: "Please check that you've entered the correct transaction signature. If you just made the payment, wait a few minutes for it to be confirmed on the blockchain."
  },
  WRONG_SENDER: {
    message: "The sender address doesn't match the wallet address you provided.",
    troubleshooting: "Make sure you're providing the same wallet address that you used to send the payment. Double-check for typos in your wallet address."
  },
  WRONG_RECEIVER: {
    message: "The payment wasn't sent to our payment address.",
    troubleshooting: `Please make sure you're sending your payment to the correct address: ${RECEIVER_ADDRESS.slice(0, 6)}...${RECEIVER_ADDRESS.slice(-6)}`
  },
  INSUFFICIENT_AMOUNT: {
    message: "The payment amount is insufficient.",
    troubleshooting: "Please make sure you're sending the correct amount for your subscription type. Quarterly subscription requires 0.05 SOL, Annual subscription requires 0.15 SOL."
  },
  TOO_OLD: {
    message: "The transaction is too old.",
    troubleshooting: `We only accept transactions that were made within the last ${MAX_TRANSACTION_AGE_HOURS} hours. Please make a new payment and try again.`
  },
  NETWORK_ERROR: {
    message: "We encountered a network error while verifying your payment.",
    troubleshooting: "This is likely a temporary issue with the Solana network. Please try again in a few minutes."
  },
  GENERAL_HELP: "To verify your payment:\n\n1. Make sure you're sending SOL to the correct address\n2. Send the exact required amount\n3. Wait for the transaction to confirm\n4. Copy both your wallet address and transaction signature\n5. Use the /verify command in format: /verify [your_wallet] [tx_signature]"
};

/**
 * Verify a payment transaction on the Solana blockchain
 * @param {string} signature - The transaction signature
 * @param {string} senderAddress - The sender's wallet address
 * @param {string} subscriptionType - The subscription type (quarterly or annual)
 * @returns {Promise<Object>} - Verification result with isValid flag and message
 */
async function verifyPaymentTransaction(signature, senderAddress, subscriptionType = 'quarterly') {
  try {
    // Validate signature format
    if (!signature || !/^[A-Za-z0-9]{80,120}$/.test(signature)) {
      return {
        isValid: false,
        message: PAYMENT_TROUBLESHOOTING.INVALID_SIGNATURE.message,
        troubleshooting: PAYMENT_TROUBLESHOOTING.INVALID_SIGNATURE.troubleshooting
      };
    }

    // Get transaction details
    const transaction = await connection.getTransaction(signature, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0
    });

    // Check if transaction exists
    if (!transaction) {
      return {
        isValid: false,
        message: PAYMENT_TROUBLESHOOTING.TRANSACTION_NOT_FOUND.message,
        troubleshooting: PAYMENT_TROUBLESHOOTING.TRANSACTION_NOT_FOUND.troubleshooting
      };
    }

    // Check transaction timestamp
    const txTimestamp = new Date(transaction.blockTime * 1000);
    const currentTime = new Date();
    const transactionAgeHours = (currentTime - txTimestamp) / (1000 * 60 * 60);
    
    if (transactionAgeHours > MAX_TRANSACTION_AGE_HOURS) {
      return {
        isValid: false,
        message: PAYMENT_TROUBLESHOOTING.TOO_OLD.message,
        troubleshooting: PAYMENT_TROUBLESHOOTING.TOO_OLD.troubleshooting,
        details: {
          timestamp: txTimestamp,
          age: `${transactionAgeHours.toFixed(2)} hours`
        }
      };
    }

    // Extract sender and receiver from transaction
    let senderPubkey = null;
    let receiverPubkey = null;
    let amountTransferred = 0;

    // Parse the transaction instructions to find the transfer
    if (transaction.meta && transaction.meta.innerInstructions) {
      // Look through all instructions
      transaction.transaction.message.instructions.forEach((instruction, idx) => {
        const programId = transaction.transaction.message.accountKeys[instruction.programId].toString();
        
        // Check if this is a System Program transfer
        if (programId === '11111111111111111111111111111111111111111111') {
          const accounts = instruction.accounts.map(acc => 
            transaction.transaction.message.accountKeys[acc].toString()
          );
          
          if (accounts.length >= 2) {
            senderPubkey = accounts[0];
            receiverPubkey = accounts[1];
            
            // Extract amount from transaction meta
            if (transaction.meta.postBalances && transaction.meta.preBalances) {
              const preBalance = transaction.meta.preBalances[instruction.accounts[1]];
              const postBalance = transaction.meta.postBalances[instruction.accounts[1]];
              
              if (postBalance > preBalance) {
                amountTransferred = (postBalance - preBalance) / LAMPORTS_PER_SOL;
              }
            }
          }
        }
      });
    }

    // Fallback: If we couldn't parse the inner instructions, look at the overall balance changes
    if (!senderPubkey && transaction.meta) {
      // Get the indices for sender and receiver
      const accountKeys = transaction.transaction.message.accountKeys.map(key => key.toString());
      const possibleSenderIdx = accountKeys.findIndex(
        key => key.toLowerCase() === senderAddress.toLowerCase()
      );
      const possibleReceiverIdx = accountKeys.findIndex(
        key => key.toLowerCase() === RECEIVER_ADDRESS.toLowerCase()
      );
      
      if (possibleSenderIdx !== -1 && possibleReceiverIdx !== -1) {
        senderPubkey = accountKeys[possibleSenderIdx];
        receiverPubkey = accountKeys[possibleReceiverIdx];
        
        // Calculate amount as decrease in sender balance and increase in receiver balance
        const senderBalanceChange = (transaction.meta.preBalances[possibleSenderIdx] - 
                                    transaction.meta.postBalances[possibleSenderIdx]) / LAMPORTS_PER_SOL;
        const receiverBalanceChange = (transaction.meta.postBalances[possibleReceiverIdx] - 
                                     transaction.meta.preBalances[possibleReceiverIdx]) / LAMPORTS_PER_SOL;
        
        // Use the smaller of the two values (accounting for fees)
        amountTransferred = Math.min(senderBalanceChange, receiverBalanceChange);
      }
    }

    // Verify the sender address matches
    if (!senderPubkey || senderPubkey.toLowerCase() !== senderAddress.toLowerCase()) {
      return {
        isValid: false,
        message: PAYMENT_TROUBLESHOOTING.WRONG_SENDER.message,
        troubleshooting: PAYMENT_TROUBLESHOOTING.WRONG_SENDER.troubleshooting,
        details: {
          providedSender: senderAddress,
          actualSender: senderPubkey || 'Unknown'
        }
      };
    }

    // Verify the receiver address matches our payment address
    if (!receiverPubkey || receiverPubkey.toLowerCase() !== RECEIVER_ADDRESS.toLowerCase()) {
      return {
        isValid: false,
        message: PAYMENT_TROUBLESHOOTING.WRONG_RECEIVER.message,
        troubleshooting: PAYMENT_TROUBLESHOOTING.WRONG_RECEIVER.troubleshooting,
        details: {
          expectedReceiver: RECEIVER_ADDRESS,
          actualReceiver: receiverPubkey || 'Unknown'
        }
      };
    }

    // Check for minimum payment amount
    const requiredAmount = PAYMENT_AMOUNTS[subscriptionType] || PAYMENT_AMOUNTS.quarterly;
    if (amountTransferred < requiredAmount) {
      return {
        isValid: false,
        message: PAYMENT_TROUBLESHOOTING.INSUFFICIENT_AMOUNT.message,
        troubleshooting: PAYMENT_TROUBLESHOOTING.INSUFFICIENT_AMOUNT.troubleshooting,
        details: {
          required: requiredAmount,
          actual: amountTransferred,
          difference: requiredAmount - amountTransferred
        }
      };
    }

    // If we got here, payment is valid
    return {
      isValid: true,
      message: "Payment verified successfully!",
      details: {
        signature,
        sender: senderPubkey,
        receiver: receiverPubkey,
        amount: amountTransferred,
        timestamp: txTimestamp,
        subscriptionType
      }
    };
    
  } catch (error) {
    console.error('Error verifying payment transaction:', error);
    return {
      isValid: false,
      message: PAYMENT_TROUBLESHOOTING.NETWORK_ERROR.message,
      troubleshooting: PAYMENT_TROUBLESHOOTING.NETWORK_ERROR.troubleshooting,
      error: error.message
    };
  }
}

// Helper to check if a transaction has already been used
async function checkTransactionAlreadyUsed(signature) {
  // This should be implemented to check your database
  // Return true if this transaction was already used to activate a subscription
  return false;
}

module.exports = {
  verifyPaymentTransaction,
  PAYMENT_TROUBLESHOOTING,
  checkTransactionAlreadyUsed
}; 