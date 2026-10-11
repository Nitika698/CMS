import { Router } from 'express';
import { describePlatforms } from '../../integrations/publishing/registry.js';
import { authenticate } from '../../middleware/authenticate.js';
import { noStore } from '../../middleware/security.js';
import { validate } from '../../middleware/validate.js';
import { CONTENT_STATUS_LIST } from './calendar.meta.js';
import { rangeQuerySchema } from '../posts/posts.schemas.js';
import { env } from '../../config/env.js';
import { POST_STATUSES, POST_TRANSITIONS, STAGES, MAX_RANGE_DAYS } from '../posts/post.constants.js';
import * as calendar from './calendar.service.js';

const router = Router();
router.use(noStore, authenticate);

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const user = (req) => ({ id: req.user.id, timezone: req.user.doc.timezone });

router.get('/', validate({ query: rangeQuerySchema }), wrap(async (req, res) => res.json(await calendar.getRange(user(req), req.query))));
router.get('/upcoming', wrap(async (req, res) => res.json(await calendar.getUpcoming(user(req)))));

// What the UI may claim about each platform. Today every platform is "manual": nothing is ever published for the user.
router.get('/integrations', wrap(async (_req, res) => res.json({ data: await describePlatforms() })));

// Single source of truth for the stage vocabulary and limits, so the UI never disagrees with the server.
router.get('/meta', (_req, res) =>
  res.json({
    // `status` is the stored value used in API filters; `key`/`label`/`description` are the user-facing stage.
    postStatuses: POST_STATUSES.map((status) => ({ status, ...STAGES[status], next: POST_TRANSITIONS[status] })),
    contentStatuses: CONTENT_STATUS_LIST,
    conflictWindowMinutes: env.CALENDAR_CONFLICT_WINDOW_MINUTES,
    maxRangeDays: MAX_RANGE_DAYS,
    reminderPresets: [15, 60, 180, 1440, 2880, 10080],
  }),
);

export default router;
