import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { AppError } from '../../lib/errors.js';
import { isObjectId } from '../../lib/scoped.js';
import { verifyAssetToken } from '../../lib/assetTokens.js';
import { noStore } from '../../middleware/security.js';
import * as media from './media.service.js';

const router = Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Authenticated: get a short-lived link for an <img>/<video> tag.
router.get('/:id/access', noStore, authenticate, wrap(async (req, res) => res.json(await media.createAccessLink(req.user.id, req.params.id))));

/**
 * The file itself. Authorised EITHER by a normal session (Authorization header) OR by a signed link token that is bound
 * to this exact asset and its owner and expires in minutes. Either way the asset is looked up with the OWNER filter,
 * so another user's file is indistinguishable from a missing one.
 */
router.get(
  '/:id/file',
  wrap(async (req, res, next) => {
    const { token } = req.query;
    if (typeof token === 'string' && token) {
      let claims;
      try {
        claims = verifyAssetToken(token);
      } catch {
        throw new AppError(401, 'UNAUTHENTICATED', 'This link has expired or is invalid');
      }
      if (claims.aid !== req.params.id || !isObjectId(claims.own)) throw new AppError(401, 'UNAUTHENTICATED', 'This link has expired or is invalid');
      return media.serveAsset(claims.own, req.params.id, req, res);
    }
    // No token: fall back to a regular authenticated request.
    authenticate(req, res, (err) => {
      if (err) return next(err);
      media.serveAsset(req.user.id, req.params.id, req, res).catch(next);
    });
  }),
);

export default router;
