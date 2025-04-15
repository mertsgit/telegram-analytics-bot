const { createLogger } = require('../utils/logger');

const logger = createLogger('http');

// Request logging middleware
const requestLogger = (req, res, next) => {
  const start = Date.now();
  
  // Log when request completes
  res.on('finish', () => {
    const duration = Date.now() - start;
    const { method, originalUrl, ip } = req;
    const { statusCode } = res;
    
    const message = `${method} ${originalUrl} ${statusCode} ${duration}ms`;
    
    // Log at appropriate level based on status code
    if (statusCode >= 500) {
      logger.error(message, { ip });
    } else if (statusCode >= 400) {
      logger.warn(message, { ip });
    } else {
      logger.info(message, { ip });
    }
  });
  
  next();
};

// Error logging middleware
const errorLogger = (err, req, res, next) => {
  const { method, originalUrl, ip, body } = req;
  
  logger.error(`${method} ${originalUrl} - ${err.message}`, {
    ip,
    stack: err.stack,
    requestBody: body
  });
  
  next(err);
};

module.exports = {
  requestLogger,
  errorLogger
}; 