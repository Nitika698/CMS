import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { csrfGuard, noStore, refreshLimiter, sensitiveLimiter } from '../../middleware/security.js';
import { validate } from '../../middleware/validate.js';
import { clearRefreshCookie, REFRESH_COOKIE, setRefreshCookie } from '../../lib/cookies.js';
import { toPublicUser } from '../users/user.model.js';
import { loginSchema, registerSchema } from './auth.schemas.js';
import * as service from './auth.service.js';

const router = Router();
router.use(noStore);

const meta = (req) => ({ ip: req.ip, userAgent: req.get('user-agent') });

// The refresh token travels ONLY in an HttpOnly cookie; the access token is returned in JSON and kept in memory by the client.
function sendSession(res, status, { user, accessToken, refreshToken }) {
  setRefreshCookie(res, refreshToken);
  res.status(status).json({ user: toPublicUser(user), accessToken });
}

const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);

router.post(
  '/register',
  sensitiveLimiter,
  validate({ body: registerSchema }),
  wrap(async (req, res) => sendSession(res, 201, await service.register(req.body, meta(req)))),
);

router.post(
  '/login',
  sensitiveLimiter,
  validate({ body: loginSchema }),
  wrap(async (req, res) => sendSession(res, 200, await service.login(req.body, meta(req)))),
);

router.post(
  '/refresh',
  refreshLimiter,
  csrfGuard,
  wrap(async (req, res) => {
    try {
      sendSession(res, 200, await service.refresh(req.cookies?.[REFRESH_COOKIE]));
    } catch (err) {
      if (err.status === 401) clearRefreshCookie(res); // stale cookie: drop it
      throw err;
    }
  }),
);

router.post(
  '/logout',
  csrfGuard,
  wrap(async (req, res) => {
    await service.logout(req.cookies?.[REFRESH_COOKIE]);
    clearRefreshCookie(res);
    res.status(204).end();
  }),
);

router.post(
  '/logout-all',
  authenticate,
  wrap(async (req, res) => {
    await service.logoutAll(req.user.id);
    clearRefreshCookie(res);
    res.status(204).end();
  }),
);

export default router;
