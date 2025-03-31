# 24/7 Deployment Options for Telegram Bot

For running the bot continuously (24/7), here are the best options:

## 1. Railway.app (Recommended for simplicity)
- Free tier available
- Easy GitHub integration
- Quick deployment process
- Steps:
  1. Go to [Railway.app](https://railway.app/)
  2. Connect your GitHub repository
  3. Select the telegram-analytics-bot repository
  4. Railway will automatically detect Node.js and deploy

## 2. Render.com
- Free tier available
- Simple deployment
- Steps:
  1. Go to [Render.com](https://render.com/)
  2. Create a new Web Service
  3. Connect to your GitHub repository
  4. Select Node.js as the runtime
  5. Set start command: `npm start`

## 3. Heroku
- Requires credit card even for free tier
- Good reliability
- Steps:
  1. Create an account on [Heroku](https://heroku.com)
  2. Install Heroku CLI: `npm install -g heroku`
  3. Login: `heroku login`
  4. Create app: `heroku create`
  5. Push code: `git push heroku main`

## 4. DigitalOcean
- $5/month droplet (VPS)
- More control over environment
- Steps:
  1. Create a $5 droplet on [DigitalOcean](https://digitalocean.com)
  2. SSH into your server
  3. Install Node.js and Git
  4. Clone your repository
  5. Run with PM2: `npm install -g pm2 && pm2 start src/index.js`

## Deployment Steps

1. Make sure your MongoDB Atlas connection string is correct in `.env`
2. Choose one of the platforms above
3. Set the environment variables on the platform:
   - TELEGRAM_BOT_TOKEN
   - MONGODB_URI
   - OPENAI_API_KEY
4. Deploy your application
5. Verify the bot is running by messaging it on Telegram 