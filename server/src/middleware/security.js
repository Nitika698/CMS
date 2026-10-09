import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';
import { AppError } from '../lib/errors.js';

const limited = (_req, _res, next) => next(new AppError(429, 'RATE_LIMITED', 'Too many attempts. Please try again later.'));

/** Strict limiter for sensitive endpoints (register, login failures, password change). */
export const sensitiveLimiter = rateLimit({
  windowMs: env.AUTH_RATE_LIMIT_WINDOW_MS,
  limit: env.AUTH_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // only failed attempts count, so normal use is never throttled
  handler: limited,
});

/** Looser limiter for token refresh. */
export const refreshLimiter = rateLimit({
  windowMs: env.AUTH_RATE_LIMIT_WINDOW_MS,
  limit: env.AUTH_RATE_LIMIT_MAX * 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: limited,
});

export const noStore = (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
};

/**
 * CSRF defence for endpoints authenticated by the refresh cookie.
 * 1. SameSite=Strict cookie (first line of defence).
 * 2. Custom header: a cross-site page cannot add it without a CORS preflight, which our allow-list denies.
 * 3. If the browser sent an Origin, it must be a configured CLIENT_ORIGIN or the same host.
 *    In development only, any http://localhost:<port> origin is accepted: the Vite dev server proxies /api and
 *    may pick any free port. In production set CLIENT_ORIGIN to your real site origin.
 */
const DEV_LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

export function csrfGuard(req, _res, next) {
  if (req.get('x-requested-with') !== 'creatordesk') {
    return next(new AppError(403, 'CSRF_REJECTED', 'Missing required request header'));
  }
  const origin = req.get('origin');
  if (origin) {
    let host;
    try {
      host = new URL(origin).host;
    } catch {
      return next(new AppError(403, 'CSRF_REJECTED', 'Invalid origin'));
    }
    const allowed = env.clientOrigins.includes(origin) || host === req.get('host') || (!env.isProd && DEV_LOCAL_ORIGIN.test(origin));
    if (!allowed) {
      return next(new AppError(403, 'CSRF_REJECTED', 'Origin not allowed'));
    }
  }
  next();
}
