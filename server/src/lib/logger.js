import { env } from '../config/env.js';

const LEVELS = { silent: 0, error: 1, warn: 2, info: 3 };

/**
 * Minimal structured logger: one JSON object per line on stdout/stderr, which every host (Render, Fly, Docker,
 * systemd, CloudWatch...) can collect. Callers pass small, already-safe fields only: never request bodies,
 * headers, cookies, tokens, passwords or provider keys.
 */
function write(level, msg, fields) {
  if (LEVELS[level] > LEVELS[env.LOG_LEVEL]) return;
  const line = JSON.stringify({ time: new Date().toISOString(), level, msg, ...fields });
  (level === 'error' || level === 'warn' ? process.stderr : process.stdout).write(`${line}\n`);
}

export const log = {
  info: (msg, fields) => write('info', msg, fields),
  warn: (msg, fields) => write('warn', msg, fields),
  error: (msg, fields) => write('error', msg, fields),
};
