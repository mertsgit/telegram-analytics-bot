const winston = require('winston');
const { format, transports } = winston;
const path = require('path');
const fs = require('fs');

// Create logs directory if it doesn't exist
const logsDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Define log formats
const consoleFormat = format.combine(
  format.colorize(),
  format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  format.printf(({ timestamp, level, message, context, ...meta }) => {
    const contextStr = context ? `[${context}] ` : '';
    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    return `${timestamp} ${level}: ${contextStr}${message}${metaStr}`;
  })
);

const fileFormat = format.combine(
  format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  format.json()
);

// Create the logger instance
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  transports: [
    // Console transport
    new transports.Console({
      format: consoleFormat
    }),
    // File transport for errors
    new transports.File({
      filename: path.join(logsDir, 'error.log'),
      level: 'error',
      format: fileFormat,
      maxsize: 5242880, // 5MB
      maxFiles: 5
    }),
    // File transport for all logs
    new transports.File({
      filename: path.join(logsDir, 'combined.log'),
      format: fileFormat,
      maxsize: 5242880, // 5MB
      maxFiles: 5
    })
  ],
  exitOnError: false
});

/**
 * Creates a logger with the given context
 * @param {string} context - The context for the logger
 * @return {object} Logger with methods for different log levels
 */
const createLogger = (context) => {
  return {
    debug: (message, meta = {}) => logger.debug(message, { context, ...meta }),
    info: (message, meta = {}) => logger.info(message, { context, ...meta }),
    warn: (message, meta = {}) => logger.warn(message, { context, ...meta }),
    error: (message, meta = {}) => logger.error(message, { context, ...meta })
  };
};

// Export the logger creator function
module.exports = {
  createLogger
}; 