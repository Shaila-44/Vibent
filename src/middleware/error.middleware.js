const { AppError } = require('../utils/errors');
const logger = require('../utils/logger');

function notFound(req, res) {
  res.status(404).json({
    success: false,
    error: { code: 'NOT_FOUND', message: 'Route not found' }
  });
}

function errorHandler(err, req, res, next) {
  let status = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'Something went wrong on our side. Please try again.';

  if (err instanceof AppError) {
    ({ status, code } = err);
    message = err.publicMessage;
  } else if (err.type === 'entity.parse.failed') {
    status = 400;
    code = 'INVALID_JSON';
    message = 'Request body must be valid JSON.';
  } else if (err.type === 'entity.too.large') {
    status = 413;
    code = 'PAYLOAD_TOO_LARGE';
    message = 'Request body is too large.';
  }

  if (status >= 500) {
    logger.error(`${req.method} ${req.path} -> ${status} ${code}: ${err.stack || err.message}`);
  }

  res.status(status).json({ success: false, error: { code, message } });
}

module.exports = { notFound, errorHandler };
