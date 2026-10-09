import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

const ISSUER = 'creatordesk';

export function signAccessToken({ userId, sessionId }) {
  return jwt.sign({ sid: String(sessionId) }, env.JWT_ACCESS_SECRET, {
    algorithm: 'HS256',
    subject: String(userId),
    issuer: ISSUER,
    expiresIn: `${env.ACCESS_TOKEN_TTL_MINUTES}m`,
  });
}

/** Throws jsonwebtoken errors (TokenExpiredError, JsonWebTokenError). Algorithm is pinned: `none` is rejected. */
export function verifyAccessToken(token) {
  return jwt.verify(token, env.JWT_ACCESS_SECRET, { algorithms: ['HS256'], issuer: ISSUER });
}

/** Opaque 256-bit refresh token. Only the SHA-256 hash is ever stored. */
export function newRefreshToken() {
  const token = crypto.randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token) };
}

export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}
