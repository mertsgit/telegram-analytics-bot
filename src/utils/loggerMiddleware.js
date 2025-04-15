const { createLogger } = require('./logger');

// Create a logger instance for HTTP requests
const httpLogger = createLogger('http');

/**
 * Middleware to log information about incoming HTTP requests
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
const requestLogger = (req, res, next) => {
  // Capture start time
  const startTime = Date.now();
  
  // Log the incoming request
  httpLogger.info(`${req.method} ${req.url} from ${req.ip}`);
  
  // Capture response data once it's sent
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const message = `${req.method} ${req.url} ${res.statusCode} - ${duration}ms`;
    
    // Use appropriate log level based on status code
    if (res.statusCode >= 500) {
      httpLogger.error(message);
    } else if (res.statusCode >= 400) {
      httpLogger.warn(message);
    } else {
      httpLogger.info(message);
    }
  });
  
  next();
};

/**
 * Middleware to log errors in the application
 * @param {Error} err - Error object
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
const errorLogger = (err, req, res, next) => {
  httpLogger.error(`Error processing ${req.method} ${req.url}: ${err.message}`);
  
  // Log stack trace for development environment
  if (process.env.NODE_ENV !== 'production') {
    httpLogger.error(err.stack);
  }
  
  next(err);
};

module.exports = {
  requestLogger,
  errorLogger
}; 