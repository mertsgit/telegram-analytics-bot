# Telegram Analytics Bot

A Telegram bot that tracks messages in group chats, saves them to MongoDB, and analyzes them using OpenAI.

## Features

- Tracks and stores all text messages from group chats
- Analyzes message sentiment, topics, and entities using OpenAI
- Provides chat statistics with the `/stats` command
- Automatically saves messages to MongoDB

## Prerequisites

- Node.js (v14 or later)
- MongoDB Atlas account (free tier)
- Telegram Bot Token (from [@BotFather](https://t.me/botfather))
- OpenAI API Key

## Local Setup

1. Clone this repository
2. Install dependencies:
   ```
   npm install
   ```
3. Set up a MongoDB Atlas cluster following the instructions in `mongodb-atlas-setup.md`
4. Update the `.env` file in the root directory with the following variables:
   ```
   TELEGRAM_BOT_TOKEN=your_telegram_bot_token
   MONGODB_URI=your_mongodb_connection_string
   OPENAI_API_KEY=your_openai_api_key
   ```
5. Replace the placeholder values with your actual credentials

## Running Locally

Start the bot locally:
```
npm start
```

For development with auto-restart:
```
npm run dev
```

## 24/7 Deployment

For 24/7 operation, deploy to a cloud provider:

1. Create a MongoDB Atlas cluster using the instructions in `mongodb-atlas-setup.md`
2. Choose a hosting platform from the options in `deployment-options.md`
3. Set environment variables on your chosen platform
4. Deploy your application

The bot will now run continuously 24/7, tracking all messages in Telegram groups.

## Usage

1. Add the bot (@echobombot) to your Telegram group
2. The bot will automatically track and analyze all text messages
3. Use `/stats` command to see message statistics

## Commands

- `/start` - Start the bot
- `/help` - Show help message
- `/stats` - Show message statistics for the current chat

## Maintenance

- The MongoDB Atlas free tier has some limitations:
  - 512 MB storage
  - Up to 100 operations per second
- If the bot is inactive for 60 days, the MongoDB Atlas cluster may be paused
- Keep your OpenAI API key secure and monitor usage to avoid unexpected charges

## How It Works

1. When a message is sent in a group chat, the bot captures it
2. The message is saved to MongoDB with sender and chat information
3. The message text is sent to OpenAI for analysis
4. The analysis results (sentiment, topics, entities) are saved with the message
5. Users can view statistics with the `/stats` command

## Notes

- The bot only processes text messages
- Analysis happens only in group chats, not in private chats with the bot
- All message data is stored in MongoDB for later analysis 