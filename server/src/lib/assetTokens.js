import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

/**
 * Short-lived signed links so <img>/<video> tags (which cannot send an Authorization header) can load a private asset.
 * A token is bound to ONE asset id and ONE owner. It is signed with a key derived from the JWT secret but different
 * from it, so an access token can never be used as an asset token or the other way round.
 */
const key = () => crypto.createHmac('sha256', env.JWT_ACCESS_SECRET).update('cms:asset-link:v1').digest();

export function signAssetToken({ assetId, ownerId }) {
  return jwt.sign({ aid: String(assetId), own: String(ownerId) }, key(), {
    algorithm: 'HS256',
    issuer: 'cms',
    audience: 'asset',
    expiresIn: env.ASSET_TOKEN_TTL_SECONDS,
  });
}

/** Returns { aid, own } or throws. */
export function verifyAssetToken(token) {
  return jwt.verify(token, key(), { algorithms: ['HS256'], issuer: 'cms', audience: 'asset' });
}
