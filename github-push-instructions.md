# Pushing Your Telegram Bot to GitHub

Follow these steps to push your code to GitHub:

## 1. Create a GitHub Repository

1. Go to [GitHub](https://github.com/)
2. Login to your account (or create one if you don't have it yet)
3. Click on the "+" icon in the top right corner and select "New repository"
4. Name your repository: `telegram-analytics-bot`
5. Keep it public (or private if you prefer)
6. Do NOT initialize with README, .gitignore, or license as we already have these
7. Click "Create repository"

## 2. Push Your Local Repository to GitHub

After creating the repository on GitHub, you'll see instructions. Run these commands in your terminal:

```bash
# If you're using HTTPS (recommended for beginners)
git remote add origin https://github.com/YOUR_USERNAME/telegram-analytics-bot.git
git branch -M main
git push -u origin main

# Or if you're using SSH (if you have SSH keys set up)
git remote add origin git@github.com:YOUR_USERNAME/telegram-analytics-bot.git
git branch -M main
git push -u origin main
```

Replace `YOUR_USERNAME` with your actual GitHub username.

## 3. Verify the Repository

1. Refresh your GitHub page to see if all the files have been uploaded
2. Make sure the `.env` file is NOT in the repository (it contains sensitive credentials)

## 4. Deploy on Railway

Now that your code is on GitHub, follow these steps to deploy on Railway:

1. Go to [Railway.app](https://railway.app/) and sign up/log in
2. Connect your GitHub account
3. Click "New Project" and select "Deploy from GitHub repo"
4. Find and select your `telegram-analytics-bot` repository
5. Railway will detect it as a Node.js project
6. Click "Deploy Now"
7. Go to "Variables" and add your environment variables:
   - `TELEGRAM_BOT_TOKEN`: Your Telegram bot token
   - `MONGODB_URI`: Your MongoDB Atlas connection string
   - `OPENAI_API_KEY`: Your OpenAI API key
8. Wait for the deployment to complete
9. Your bot should now be running 24/7!

## 5. Testing Your Bot

1. Add your bot (@echobombot) to a Telegram group
2. Send some messages in the group
3. Try the `/stats` command to see if it's tracking messages
4. Railway will keep your bot running continuously

If you have any issues, check the logs in the Railway dashboard for troubleshooting. 