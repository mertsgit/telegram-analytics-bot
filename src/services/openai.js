const OpenAI = require('openai');
require('dotenv').config();

// Track OpenAI service availability
let isOpenAIAvailable = true;
let lastOpenAIError = null;
let consecutiveErrors = 0;

// Initialize OpenAI with error handling
let openai;
try {
  if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY.trim() === '') {
    console.error('OpenAI API Key is missing or empty. Message analysis will not be available.');
    isOpenAIAvailable = false;
  } else {
    openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
    console.log('OpenAI service initialized successfully');
  }
} catch (error) {
  console.error(`Error initializing OpenAI: ${error.message}`);
  isOpenAIAvailable = false;
  lastOpenAIError = error.message;
}

/**
 * Check if OpenAI service is available
 * @returns {boolean} Availability status
 */
const isOpenAIServiceAvailable = () => {
  return isOpenAIAvailable && consecutiveErrors < 5;
};

/**
 * Get last OpenAI error message
 * @returns {string|null} Error message
 */
const getOpenAIErrorStatus = () => {
  return lastOpenAIError;
};

/**
 * Reset error counter after successful calls
 */
const resetErrorCounter = () => {
  if (consecutiveErrors > 0) {
    consecutiveErrors = 0;
    console.log('OpenAI error counter reset after successful call');
  }
};

/**
 * Analyze message content using OpenAI
 * @param {string} text - The message text to analyze
 * @returns {Object} Analysis results
 */
const analyzeMessage = async (text) => {
  try {
    if (!isOpenAIServiceAvailable() || !text || text.trim() === '') {
      return { sentiment: 'neutral', topics: [], intent: 'unknown' };
    }

    // Check for obvious profanity with simple regex before sending to API
    const profanityRegex = /\b(f+\s*[ou]+\s*c*\s*k+|s+\s*h+\s*[il1]+\s*t+|b+\s*[il1]+\s*t+\s*c+\s*h+|d+\s*[il1]+\s*c+\s*k+|a+\s*s+\s*s+\s*h+\s*[o0]+\s*l+\s*e+|f+\s*off?|f+\s*u+|cunt|cock)\b/i;
    if (profanityRegex.test(text)) {
      console.log('Profanity detected in message, marking as negative sentiment');
      return {
        sentiment: 'negative',
        topics: ['profanity'],
        intent: 'statement',
        cryptoSentiment: 'neutral',
        mentionedCoins: [],
        scamIndicators: [],
        priceTargets: {}
      };
    }

    // Enhanced prompt for crypto content with better sentiment detection
    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: `You are an AI specialized in cryptocurrency and trading analysis with strong focus on emotion detection. 
          
          Analyze the following message and extract:
          1. Overall sentiment (positive, negative, neutral) - be sensitive to profanity, insults, and aggression
          2. Crypto sentiment (bullish, bearish, neutral)
          3. Specific cryptocurrency topics mentioned
          4. User intent (question, statement, recommendation, etc.)
          5. Identify any mentioned tokens/coins
          6. Detect potential scam indicators (excessive hype, unrealistic promises, urgency, etc.)
          7. Extract any price predictions or targets mentioned
          
          IMPORTANT SENTIMENT GUIDELINES:
          - Messages containing insults, profanity, or aggression should ALWAYS be classified as "negative"
          - Messages with words like "f*ck", "sh*t", "damn", or similar profanity are negative
          - Telling someone to "f off" or similar is strongly negative
          - Dismissive or rude responses should be marked negative
          - Only mark as neutral if truly neutral with no emotional charge
          
          Format your response as a JSON object with these fields.`
        },
        {
          role: "user",
          content: text
        }
      ],
      temperature: 0.3,
      max_tokens: 300
    });

    // Process the response
    const content = response.choices[0].message.content;
    let parsedResponse;
    
    try {
      // Try to parse the JSON response
      parsedResponse = JSON.parse(content);
    } catch (parseError) {
      console.error('Error parsing OpenAI response:', parseError);
      
      // If JSON parsing fails, extract data using regex as fallback
      const sentiment = extractField(content, 'sentiment', 'neutral');
      const topics = extractArrayField(content, 'topics', []);
      const intent = extractField(content, 'intent', 'unknown');
      const cryptoSentiment = extractField(content, 'crypto sentiment', 'neutral');
      const mentionedCoins = extractArrayField(content, 'mentioned tokens/coins', []);
      const scamIndicators = extractScamIndicators(content);
      const priceTargets = extractPriceTargets(content);
      
      parsedResponse = {
        sentiment,
        topics,
        intent,
        cryptoSentiment,
        mentionedCoins,
        scamIndicators,
        priceTargets
      };
    }
    
    // Double-check sentiment for common profanity that might be missed
    if (
      text.toLowerCase().includes('fuck') || 
      text.toLowerCase().includes('shit') || 
      text.toLowerCase().includes('f off') ||
      text.toLowerCase().includes('f you') ||
      text.toLowerCase().includes('stfu') ||
      text.toLowerCase().includes('gtfo')
    ) {
      parsedResponse.sentiment = 'negative';
      console.log('Profanity detected in post-processing, overriding to negative sentiment');
    }
    
    // Ensure all expected fields exist
    const result = {
      sentiment: parsedResponse.sentiment || 'neutral',
      topics: Array.isArray(parsedResponse.topics) ? parsedResponse.topics : [],
      intent: parsedResponse.intent || 'unknown',
      cryptoSentiment: parsedResponse.cryptoSentiment || parsedResponse["crypto sentiment"] || 'neutral',
      mentionedCoins: Array.isArray(parsedResponse.mentionedCoins) ? parsedResponse.mentionedCoins : 
                     Array.isArray(parsedResponse["mentioned tokens/coins"]) ? parsedResponse["mentioned tokens/coins"] : [],
      scamIndicators: parsedResponse.scamIndicators || [],
      priceTargets: parsedResponse.priceTargets || {}
    };
    
    resetErrorCounter();
    
    return result;
  } catch (error) {
    consecutiveErrors++;
    isOpenAIAvailable = consecutiveErrors < 5; // Consider service unavailable after 5 consecutive errors
    lastOpenAIError = error.message;
    
    console.error('OpenAI API Error:', error);
    
    return { sentiment: 'neutral', topics: [], intent: 'unknown' };
  }
};

// Helper to extract fields from text when JSON parsing fails
const extractField = (text, fieldName, defaultValue) => {
  const regex = new RegExp(`["']?${fieldName}["']?\\s*:\\s*["']([^"']+)["']`, 'i');
  const match = text.match(regex);
  return match ? match[1] : defaultValue;
};

// Helper to extract array fields
const extractArrayField = (text, fieldName, defaultValue) => {
  const regex = new RegExp(`["']?${fieldName}["']?\\s*:\\s*\\[(.*?)\\]`, 'i');
  const match = text.match(regex);
  
  if (!match) return defaultValue;
  
  const itemsText = match[1];
  return itemsText
    .split(',')
    .map(item => item.trim().replace(/^["']|["']$/g, ''))
    .filter(item => item);
};

// Helper to extract scam indicators
const extractScamIndicators = (text) => {
  const regex = /scam indicators.*?:.*?(\[.*?\]|\{.*?\})/is;
  const match = text.match(regex);
  
  if (!match) return [];
  
  try {
    return JSON.parse(match[1]);
  } catch (e) {
    return match[1]
      .replace(/[\[\]{}]/g, '')
      .split(',')
      .map(item => item.trim().replace(/^["']|["']$/g, ''))
      .filter(item => item);
  }
};

// Helper to extract price targets
const extractPriceTargets = (text) => {
  const regex = /price.*?targets.*?:.*?(\{.*?\}|\[.*?\])/is;
  const match = text.match(regex);
  
  if (!match) return {};
  
  try {
    return JSON.parse(match[1]);
  } catch (e) {
    return {};
  }
};

module.exports = { 
  analyzeMessage,
  isOpenAIServiceAvailable,
  getOpenAIErrorStatus
}; 