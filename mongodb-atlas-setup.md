# Setting Up MongoDB Atlas for Telegram Bot

Follow these steps to create a free MongoDB Atlas cluster for your Telegram bot:

## 1. Create MongoDB Atlas Account

1. Go to [MongoDB Atlas](https://www.mongodb.com/cloud/atlas/register)
2. Sign up for a free account
3. After signing up, you'll be prompted to create a new organization and project

## 2. Create a Free Cluster

1. Click "Build a Database"
2. Select "FREE" tier (M0)
3. Choose your preferred cloud provider (AWS, GCP, or Azure)
4. Choose a region closest to your bot's users
5. Click "Create Cluster" (this will take a few minutes to provision)

## 3. Set Up Security

1. While the cluster is being created, set up the database user:
   - Go to "Database Access" in the left sidebar
   - Click "Add New Database User"
   - Set Authentication method to "Password"
   - Enter a username (e.g., "telegram-bot")
   - Set a secure password (save this for later use)
   - Set User Privileges to "Read and write to any database"
   - Click "Add User"

2. Add your IP to the IP Access List:
   - Go to "Network Access" in the left sidebar
   - Click "Add IP Address"
   - Click "Allow Access from Anywhere" (0.0.0.0/0)
   - Click "Confirm"

## 4. Get Your Connection String

1. Once your cluster is created, click "Connect"
2. Select "Connect your application"
3. Choose "Node.js" as your driver and the latest version
4. Copy the connection string provided 
5. Replace `<password>` with your database user's password
6. Replace `<dbname>` with "tgbot"

## 5. Update Your .env File

Update your .env file with the new MongoDB URI:

```
MONGODB_URI=mongodb+srv://username:password@clustername.mongodb.net/tgbot?retryWrites=true&w=majority
```

## 6. Deploy Your Bot

With the MongoDB Atlas connection now configured, you can deploy your bot using one of the platforms described in the deployment-options.md file for 24/7 operation. 