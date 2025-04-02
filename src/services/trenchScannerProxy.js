const { MTProto } = require('telegram-mtproto');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Storage for client session
const storageLocation = path.join(__dirname, '../../mtproto-session.json');
let apiSession;

try {
  apiSession = JSON.parse(fs.readFileSync(storageLocation));
} catch (error) {
  apiSession = {};
}

// Save session to file
const saveSession = () => {
  try {
    fs.writeFileSync(storageLocation, JSON.stringify(apiSession, null, 2));
  } catch (error) {
    console.error('Failed to save MTProto session:', error);
  }
};

// Session storage functions
const sessionStorage = {
  get: async (key) => {
    return apiSession[key];
  },
  set: async (key, value) => {
    apiSession[key] = value;
    saveSession();
  }
};

// Create Telegram MTProto client
const client = MTProto({
  api_id: process.env.TELEGRAM_API_ID,
  api_hash: process.env.TELEGRAM_API_HASH,
  storageOptions: {
    instance: sessionStorage,
  }
});

// Get user info
const getUser = async () => {
  try {
    const user = await client('users.getFullUser', {
      id: {
        _: 'inputUserSelf'
      }
    });
    return user;
  } catch (error) {
    console.error('Error getting user info:', error);
    return null;
  }
};

// Find TrenchScannerBot
const findTrenchScannerBot = async () => {
  try {
    const result = await client('contacts.search', {
      q: 'TrenchScannerBot',
      limit: 1
    });
    
    if (result.users && result.users.length > 0) {
      const trenchBot = result.users.find(u => u.username === 'TrenchScannerBot');
      if (trenchBot) {
        return trenchBot;
      }
    }
    return null;
  } catch (error) {
    console.error('Error finding TrenchScannerBot:', error);
    return null;
  }
};

// Send message to TrenchScannerBot
const sendMessageToTrenchBot = async (message) => {
  try {
    const bot = await findTrenchScannerBot();
    if (!bot) {
      throw new Error('Could not find TrenchScannerBot');
    }
    
    const result = await client('messages.sendMessage', {
      peer: {
        _: 'inputPeerUser',
        user_id: bot.id,
        access_hash: bot.access_hash
      },
      message: message,
      random_id: Math.floor(Math.random() * 1000000000)
    });
    
    return result;
  } catch (error) {
    console.error('Error sending message to TrenchScannerBot:', error);
    throw error;
  }
};

// Get messages from TrenchScannerBot
const getMessagesFromTrenchBot = async (limit = 10) => {
  try {
    const bot = await findTrenchScannerBot();
    if (!bot) {
      throw new Error('Could not find TrenchScannerBot');
    }
    
    const history = await client('messages.getHistory', {
      peer: {
        _: 'inputPeerUser',
        user_id: bot.id,
        access_hash: bot.access_hash
      },
      limit: limit
    });
    
    return history.messages;
  } catch (error) {
    console.error('Error getting messages from TrenchScannerBot:', error);
    throw error;
  }
};

// Parse bundle analysis
const parseBundleAnalysis = (messageText) => {
  // Extract key information from TrenchScannerBot's response
  const analysis = {
    tokenName: '',
    totalBundles: 0,
    totalSolSpent: 0,
    heldPercentage: 0,
    isBonded: false,
    creatorRisk: {
      totalCreated: 0,
      currentHeldPercentage: 0,
      rugHistory: []
    },
    warnings: [],
    topBundles: []
  };

  // Extract token name
  const tokenNameMatch = messageText.match(/🔍 Advanced Bundle Analysis for \$([^\n]+)/);
  if (tokenNameMatch) {
    analysis.tokenName = tokenNameMatch[1];
  }

  // Extract total bundles
  const bundlesMatch = messageText.match(/📦 Total Bundles: (\d+) \(Holding\) \/ (\d+) \(Total\)/);
  if (bundlesMatch) {
    analysis.totalBundles = {
      holding: parseInt(bundlesMatch[1]),
      total: parseInt(bundlesMatch[2])
    };
  }

  // Extract SOL spent
  const solMatch = messageText.match(/💰 Total SOL Spent: ([0-9.]+) SOL/);
  if (solMatch) {
    analysis.totalSolSpent = parseFloat(solMatch[1]);
  }

  // Extract held percentage
  const heldMatch = messageText.match(/📈 Current Held Percentage: ([0-9.]+)%/);
  if (heldMatch) {
    analysis.heldPercentage = parseFloat(heldMatch[1]);
  }

  // Extract bonded status
  const bondedMatch = messageText.match(/🔗 Bonded: (Yes|No)/);
  if (bondedMatch) {
    analysis.isBonded = bondedMatch[1] === 'Yes';
  }

  // Extract creator risk
  const createdMatch = messageText.match(/• Total Created: (\d+)/);
  if (createdMatch) {
    analysis.creatorRisk.totalCreated = parseInt(createdMatch[1]);
  }

  const tokenHeldMatch = messageText.match(/• Current Token Held %: ([0-9.]+)%/);
  if (tokenHeldMatch) {
    analysis.creatorRisk.currentHeldPercentage = parseFloat(tokenHeldMatch[1]);
  }

  const rugMatch = messageText.match(/• ⚠️ RUG HISTORY: ([^\n]+)/);
  if (rugMatch) {
    analysis.creatorRisk.rugHistory = rugMatch[1].split(' | ').filter(item => item.trim() !== '');
  }

  // Extract warnings
  const warningsSection = messageText.match(/⚠️ Dev Warnings:[^\n]*\n([^]*?)(?=Top 5 Bundles|$)/);
  if (warningsSection) {
    const warnings = warningsSection[1].match(/• [^\n]+/g);
    if (warnings) {
      analysis.warnings = warnings.map(w => w.replace('• ', '').trim());
    }
  }

  // Extract top bundles
  const bundlesSection = messageText.match(/Top 5 Bundles:[^\n]*\n([^]*?)(?=$)/);
  if (bundlesSection) {
    const bundles = bundlesSection[1].split(/(?=(?:✅|🎯) Slot \d+:)/);
    
    bundles.forEach(bundle => {
      if (!bundle.trim()) return;
      
      const bundleData = {
        type: bundle.includes('✅') ? 'Regular' : 'Sniper',
        wallets: 0,
        tokensBought: 0,
        supplyPercentage: 0,
        solSpent: 0,
        holdingAmount: 0,
        holdingPercentage: 0
      };
      
      // Extract slot number
      const slotMatch = bundle.match(/Slot (\d+):/);
      if (slotMatch) {
        bundleData.slot = parseInt(slotMatch[1]);
      }
      
      // Extract wallets
      const walletsMatch = bundle.match(/💼 Unique Wallets: (\d+)/);
      if (walletsMatch) {
        bundleData.wallets = parseInt(walletsMatch[1]);
      }
      
      // Extract tokens bought
      const tokensMatch = bundle.match(/🪙 Tokens Bought: ([0-9.]+) million/);
      if (tokensMatch) {
        bundleData.tokensBought = parseFloat(tokensMatch[1]);
      }
      
      // Extract supply percentage
      const supplyMatch = bundle.match(/📊 % of Supply: ([0-9.]+)%/);
      if (supplyMatch) {
        bundleData.supplyPercentage = parseFloat(supplyMatch[1]);
      }
      
      // Extract SOL spent
      const solMatch = bundle.match(/💰 SOL Spent: ([0-9.]+) SOL/);
      if (solMatch) {
        bundleData.solSpent = parseFloat(solMatch[1]);
      }
      
      // Extract holding amount
      const holdingMatch = bundle.match(/🔒 Holding Amount: ([0-9.]+) million/);
      if (holdingMatch) {
        bundleData.holdingAmount = parseFloat(holdingMatch[1]);
      }
      
      // Extract holding percentage
      const holdPercentMatch = bundle.match(/📈 Holding Percentage: ([0-9.]+)%/);
      if (holdPercentMatch) {
        bundleData.holdingPercentage = parseFloat(holdPercentMatch[1]);
      }
      
      if (Object.keys(bundleData).length > 3) { // Only add if we parsed meaningful data
        analysis.topBundles.push(bundleData);
      }
    });
  }

  return analysis;
};

// Function to format enhanced bundle analysis
const formatEnhancedAnalysis = (analysis) => {
  // Calculate risk score based on various factors
  let riskScore = 0;
  let riskLevel = 'Low';
  
  // Higher held percentage is usually better
  if (analysis.heldPercentage < 10) riskScore += 30;
  else if (analysis.heldPercentage < 30) riskScore += 15;
  
  // Creator with rug history is a big red flag
  if (analysis.creatorRisk.rugHistory.length > 0) {
    riskScore += analysis.creatorRisk.rugHistory.length * 20;
  }
  
  // Dev warnings increase risk
  if (analysis.warnings.length > 0) {
    riskScore += analysis.warnings.length * 10;
  }
  
  // If creator still holds tokens, somewhat better
  if (analysis.creatorRisk.currentHeldPercentage > 5) {
    riskScore -= 10;
  }
  
  // Determine risk level
  if (riskScore > 70) riskLevel = 'Extreme';
  else if (riskScore > 50) riskLevel = 'High';
  else if (riskScore > 30) riskLevel = 'Medium';
  
  // Format the enhanced analysis
  let message = `🔎 *Enhanced Bundle Analysis for $${analysis.tokenName}*\n\n`;
  
  // Add risk assessment
  message += `*RISK ASSESSMENT*\n`;
  message += `🚨 Risk Level: ${riskLevel} (Score: ${riskScore}/100)\n`;
  
  if (analysis.creatorRisk.rugHistory.length > 0) {
    message += `⚠️ *ALERT: Creator has rug history with ${analysis.creatorRisk.rugHistory.length} tokens*\n`;
  }
  
  // Add overall statistics
  message += `\n*TOKEN STATISTICS*\n`;
  message += `📊 Held Bundles: ${analysis.totalBundles.holding}/${analysis.totalBundles.total}\n`;
  message += `💰 Total SOL Invested: ${analysis.totalSolSpent} SOL\n`;
  message += `👥 Holders Percentage: ${analysis.heldPercentage}%\n`;
  message += `${analysis.isBonded ? '✅ Token is bonded' : '❌ Token is not bonded'}\n`;
  
  // Add creator information
  message += `\n*CREATOR PROFILE*\n`;
  message += `🧑‍💻 Total Tokens Created: ${analysis.creatorRisk.totalCreated}\n`;
  message += `💼 Creator's Holdings: ${analysis.creatorRisk.currentHeldPercentage}%\n`;
  
  if (analysis.creatorRisk.rugHistory.length > 0) {
    message += `🚫 Rug History: ${analysis.creatorRisk.rugHistory.join(', ')}\n`;
  }
  
  // Add warnings
  if (analysis.warnings.length > 0) {
    message += `\n*WARNINGS*\n`;
    analysis.warnings.forEach(warning => {
      message += `⚠️ ${warning}\n`;
    });
  }
  
  // Add investment analysis
  if (analysis.topBundles.length > 0) {
    message += `\n*INVESTMENT ANALYSIS*\n`;
    
    // Calculate metrics
    const totalBundlesSol = analysis.topBundles.reduce((sum, bundle) => sum + bundle.solSpent, 0);
    const totalBundlesTokens = analysis.topBundles.reduce((sum, bundle) => sum + bundle.tokensBought, 0);
    const sniperBundles = analysis.topBundles.filter(b => b.type === 'Sniper');
    const regularBundles = analysis.topBundles.filter(b => b.type === 'Regular');
    
    message += `💵 Top Bundle Investment: ${totalBundlesSol.toFixed(2)} SOL (${((totalBundlesSol/analysis.totalSolSpent)*100).toFixed(2)}% of total)\n`;
    
    if (sniperBundles.length > 0) {
      const sniperSol = sniperBundles.reduce((sum, bundle) => sum + bundle.solSpent, 0);
      message += `🎯 Sniper Bundles: ${sniperBundles.length} (${(sniperSol).toFixed(2)} SOL)\n`;
    }
    
    // Get the most significant bundle (highest holding percentage)
    const topBundle = [...analysis.topBundles].sort((a, b) => b.holdingPercentage - a.holdingPercentage)[0];
    if (topBundle) {
      message += `\n*MOST SIGNIFICANT BUNDLE*\n`;
      message += `Slot ${topBundle.slot} (${topBundle.type})\n`;
      message += `👥 Wallets: ${topBundle.wallets}\n`;
      message += `🪙 Tokens: ${topBundle.tokensBought} million\n`;
      message += `💰 Cost: ${topBundle.solSpent} SOL\n`;
      message += `👐 Holding: ${topBundle.holdingAmount} million (${topBundle.holdingPercentage}%)\n`;
    }
  }
  
  // Add trading signal recommendation
  let signal = 'NEUTRAL';
  let signalEmoji = '⚖️';
  
  if (riskScore > 50) {
    signal = 'AVOID';
    signalEmoji = '🛑';
  } else if (analysis.heldPercentage > 40 && analysis.creatorRisk.rugHistory.length === 0) {
    signal = 'POTENTIAL OPPORTUNITY';
    signalEmoji = '✅';
  } else if (analysis.warnings.length > 0 || analysis.creatorRisk.rugHistory.length > 0) {
    signal = 'CAUTION';
    signalEmoji = '⚠️';
  }
  
  message += `\n*TRADING SIGNAL*\n`;
  message += `${signalEmoji} ${signal}\n`;
  
  // Add disclaimer
  message += `\n_This analysis is provided for informational purposes only. Always do your own research (DYOR)._`;
  
  return message;
};

// Main function to get bundle analysis
const getBundleAnalysis = async (tokenAddress) => {
  try {
    // Ensure we're logged in
    const user = await getUser();
    if (!user) {
      return {
        success: false,
        message: 'Not authenticated with Telegram. Please set up API credentials.'
      };
    }
    
    // Send command to TrenchScannerBot
    const command = `/bundle ${tokenAddress}`;
    await sendMessageToTrenchBot(command);
    
    // Wait for response (this is simplified - real implementation would need to poll or use updates)
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Get response
    const messages = await getMessagesFromTrenchBot(5);
    
    // Find the response message (most recent that contains "Advanced Bundle Analysis")
    const responseMessage = messages.find(m => 
      m.message && m.message.includes('Advanced Bundle Analysis')
    );
    
    if (!responseMessage) {
      return {
        success: false,
        message: 'No response received from TrenchScannerBot. The token may not exist or the bot may be unavailable.'
      };
    }
    
    // Parse the bundle analysis
    const parsedAnalysis = parseBundleAnalysis(responseMessage.message);
    
    // Format the enhanced analysis
    const enhancedAnalysis = formatEnhancedAnalysis(parsedAnalysis);
    
    return {
      success: true,
      originalMessage: responseMessage.message,
      parsedAnalysis,
      enhancedAnalysis
    };
  } catch (error) {
    console.error('Error getting bundle analysis:', error);
    return {
      success: false,
      message: `Error: ${error.message}`
    };
  }
};

// Initialize the MTProto client
const initialize = async () => {
  try {
    // Check if we have API credentials
    if (!process.env.TELEGRAM_API_ID || !process.env.TELEGRAM_API_HASH) {
      console.error('Telegram API credentials missing. TrenchScannerProxy will be unavailable.');
      return false;
    }
    
    // Test the connection
    const user = await getUser();
    if (!user) {
      console.error('Failed to authenticate with Telegram API. TrenchScannerProxy will be unavailable.');
      return false;
    }
    
    console.log(`TrenchScannerProxy initialized for user ${user.user.first_name} ${user.user.last_name || ''}`);
    return true;
  } catch (error) {
    console.error('Error initializing TrenchScannerProxy:', error);
    return false;
  }
};

module.exports = {
  initialize,
  getBundleAnalysis
}; 