import { AppError } from '../lib/errors.js';
import { env } from '../config/env.js';

export function notFound(req, _res, next) {
  next(new AppError(404, 'NOT_FOUND', `Route ${req.method} ${req.originalUrl} not found`));
}

export function errorHandler(err, _req, res, _next) {
  const status = err.status && err.status < 600 ? err.status : 500;
  if (status >= 500) console.error(err);
  res.status(status).json({
    error: {
      code: err.code ?? (status >= 500 ? 'INTERNAL_ERROR' : 'BAD_REQUEST'),
      message: status >= 500 && env.isProd ? 'Something went wrong' : err.message,
      ...(err.details ? { details: err.details } : {}),
    },
  });
}
