import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { noStore, sensitiveLimiter } from '../../middleware/security.js';
import { validate } from '../../middleware/validate.js';
import { changePasswordSchema, updateProfileSchema } from '../auth/auth.schemas.js';
import * as auth from '../auth/auth.service.js';
import { User, toPublicUser } from './user.model.js';

const router = Router();
router.use(noStore, authenticate);

const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);

router.get('/', (req, res) => res.json({ user: toPublicUser(req.user.doc) }));

// Email is intentionally not editable until email verification exists.
router.patch(
  '/',
  validate({ body: updateProfileSchema }),
  wrap(async (req, res) => {
    // Nested preferences are set field-by-field so changing one never wipes the others.
    const { calendarPrefs, businessProfile, ...rest } = req.body;
    const nested = (prefix, obj) => Object.entries(obj ?? {}).map(([k, v]) => [`${prefix}.${k}`, v]);
    const $set = { ...rest, ...Object.fromEntries([...nested('calendarPrefs', calendarPrefs), ...nested('businessProfile', businessProfile)]) };
    const user = await User.findByIdAndUpdate(req.user.id, { $set }, { new: true, runValidators: true });
    res.json({ user: toPublicUser(user) });
  }),
);

router.post(
  '/change-password',
  sensitiveLimiter,
  validate({ body: changePasswordSchema }),
  wrap(async (req, res) => {
    await auth.changePassword(req.user.id, req.user.sessionId, req.body);
    res.status(204).end();
  }),
);

export default router;
