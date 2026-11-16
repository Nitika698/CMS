import { AppError } from '../lib/errors.js';
import { env } from '../config/env.js';
import { log } from '../lib/logger.js';

export function notFound(req, _res, next) {
  next(new AppError(404, 'NOT_FOUND', `Route ${req.method} ${req.originalUrl} not found`));
}

export function errorHandler(err, req, res, _next) {
  // Malformed JSON and oversized bodies come from the body parser with their own status; keep it.
  const status = err.status && err.status < 600 ? err.status : 500;
  if (status >= 500) {
    // Name, message and stack only: never the request body, headers or cookies.
    log.error('unhandled error', { requestId: req.id, name: err.name, message: err.message, stack: err.stack });
  }
  // The request id travels in the X-Request-Id header, not the body: bodies for "someone else's record" and "no such record" must stay byte-identical.
  res.status(status).json({
    error: {
      code: err.code ?? (status >= 500 ? 'INTERNAL_ERROR' : 'BAD_REQUEST'),
      message: status >= 500 && env.isProd ? 'Something went wrong' : err.message,
      ...(err.details ? { details: err.details } : {}),
    },
  });
}
