import { randomUUID } from 'node:crypto';
import { log } from '../lib/logger.js';

const SAFE_ID = /^[A-Za-z0-9._-]{8,64}$/;

/** Gives every request an id (reusing a sane one from the proxy), echoes it in `X-Request-Id`, and logs one line when it finishes. */
export function requestLog(req, res, next) {
  const incoming = req.get('x-request-id');
  req.id = incoming && SAFE_ID.test(incoming) ? incoming : randomUUID();
  res.set('X-Request-Id', req.id);
  const started = process.hrtime.bigint();
  res.on('finish', () => {
    // Health probes run every few seconds; logging them would drown real traffic.
    if (req.originalUrl.startsWith('/api/v1/health')) return;
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
    log[level]('request', {
      requestId: req.id,
      method: req.method,
      // The route pattern, not the URL: query strings and ids can carry personal data.
      path: req.route ? `${req.baseUrl}${req.route.path}` : req.baseUrl || 'unmatched',
      status: res.statusCode,
      ms: Math.round(ms),
      userId: req.user?.id,
    });
  });
  next();
}
