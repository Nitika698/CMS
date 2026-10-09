import jwt from 'jsonwebtoken';
import { AppError } from '../lib/errors.js';
import { isObjectId } from '../lib/scoped.js';
import { verifyAccessToken } from '../lib/tokens.js';
import { Session } from '../modules/auth/session.model.js';
import { User } from '../modules/users/user.model.js';

const unauth = (code = 'UNAUTHENTICATED', msg = 'Authentication required') => new AppError(401, code, msg);

/**
 * Requires `Authorization: Bearer <access token>`. Beyond verifying the signature we confirm the
 * session is still active, so logout / password change take effect immediately, and that the user still exists.
 * Sets req.user = { id, sessionId, doc }.
 */
export async function authenticate(req, _res, next) {
  try {
    const header = req.get('authorization') ?? '';
    if (!header.startsWith('Bearer ')) throw unauth();

    let payload;
    try {
      payload = verifyAccessToken(header.slice(7));
    } catch (err) {
      if (err instanceof jwt.TokenExpiredError) throw unauth('TOKEN_EXPIRED', 'Access token expired');
      throw unauth();
    }
    if (!isObjectId(payload.sub) || !isObjectId(payload.sid)) throw unauth();

    const session = await Session.findOne({
      _id: payload.sid,
      user: payload.sub,
      revokedAt: null,
      expiresAt: { $gt: new Date() },
    }).select('_id');
    if (!session) throw unauth('SESSION_EXPIRED', 'Your session has expired. Please sign in again.');

    const doc = await User.findById(payload.sub);
    if (!doc) throw unauth('SESSION_EXPIRED', 'Your session has expired. Please sign in again.');

    req.user = { id: String(doc._id), sessionId: String(session._id), doc };
    next();
  } catch (err) {
    next(err);
  }
}
