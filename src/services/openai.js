const OpenAI = require('openai');
require('dotenv').config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Analyze message content using OpenAI
 * @param {string} messageText - The message text to analyze
 * @returns {Object} Analysis results
 */
const analyzeMessage = async (messageText) => {
  try {
    // Skip analysis for very short messages
    if (messageText.length < 3) {
      return {
        sentiment: 'neutral',
        topics: ['short_message'],
        entities: []
      };
    }

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
    return JSON.parse(response.choices[0].message.content);
  } catch (error) {
    console.error('Error analyzing message with OpenAI:', error);
    return {
      sentiment: 'unknown',
      topics: ['unclassified'],
      entities: [],
      intent: 'statement'
    };
  }
};

module.exports = { analyzeMessage }; 