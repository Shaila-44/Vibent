/**
 * Errors that are safe to show to users. Anything else is reported as a
 * generic 500 by the error middleware.
 */
class AppError extends Error {
  constructor(status, code, publicMessage) {
    super(publicMessage);
    this.status = status;
    this.code = code;
    this.publicMessage = publicMessage;
  }
}

const badRequest = (message, code = 'INVALID_REQUEST') => new AppError(400, code, message);

module.exports = { AppError, badRequest };
