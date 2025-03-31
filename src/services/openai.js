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
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system", 
          content: "You are an assistant that analyzes message sentiment, topics, and key entities. Output JSON only."
        },
        {
          role: "user", 
          content: `Analyze the following message. Output JSON with sentiment (positive/negative/neutral), topics (array), and entities (array of people, places, organizations mentioned): "${messageText}"`
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
      topics: [],
      entities: []
    };
  }
};

module.exports = { analyzeMessage }; 