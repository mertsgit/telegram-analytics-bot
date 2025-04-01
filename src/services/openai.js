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
 * @param {string} messageText - The message text to analyze
 * @returns {Object} Analysis results
 */
const analyzeMessage = async (messageText) => {
  // If OpenAI is not available, return default analysis
  if (!isOpenAIServiceAvailable()) {
    console.log('Skipping OpenAI analysis: Service unavailable');
    return {
      sentiment: 'unknown',
      topics: ['service_unavailable'],
      entities: [],
      intent: 'statement'
    };
  }

  // Skip analysis for very short messages
  if (!messageText || messageText.length < 3) {
    return {
      sentiment: 'neutral',
      topics: ['short_message'],
      entities: [],
      intent: 'statement'
    };
  }

  try {
    console.log(`Analyzing message: "${messageText.substring(0, 30)}${messageText.length > 30 ? '...' : ''}"`);
    
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system", 
          content: "You are an assistant that analyzes message sentiment, topics, and key entities. Classify messages into clear categories. Output JSON only."
        },
        {
          role: "user", 
          content: `Analyze the following message and output JSON with these fields:
1. "sentiment": categorize as "positive", "negative", or "neutral"
2. "topics": array of 1-3 main topics/categories the message belongs to (like "technology", "politics", "question", "greeting", etc.)
3. "entities": array of people, places, organizations mentioned
4. "intent": classify as one of ["question", "statement", "command", "greeting", "opinion", "other"]

Message: "${messageText}"`
        }
      ],
      response_format: { type: "json_object" }
    });

    // Parse the JSON response
    const result = JSON.parse(response.choices[0].message.content);
    
    // Reset error counter on success
    resetErrorCounter();
    
    return result;
  } catch (error) {
    consecutiveErrors++;
    isOpenAIAvailable = consecutiveErrors < 5; // Consider service unavailable after 5 consecutive errors
    lastOpenAIError = error.message;
    
    console.error(`Error analyzing message with OpenAI (${consecutiveErrors} consecutive errors): ${error.message}`);
    
    // More detailed error logging based on error type
    if (error.name === 'AuthenticationError') {
      console.error('OpenAI API key is invalid. Please check your API key.');
    } else if (error.name === 'RateLimitError') {
      console.error('OpenAI rate limit exceeded. Please try again later or upgrade your plan.');
    } else if (error.name === 'ServiceUnavailableError') {
      console.error('OpenAI service is temporarily unavailable. Please try again later.');
    } else if (error.name === 'TimeoutError') {
      console.error('OpenAI request timed out. Please check your network connection.');
    }
    
    return {
      sentiment: 'unknown',
      topics: ['analysis_error'],
      entities: [],
      intent: 'statement',
      error: error.message
    };
  }
};

module.exports = { 
  analyzeMessage,
  isOpenAIServiceAvailable,
  getOpenAIErrorStatus
}; 