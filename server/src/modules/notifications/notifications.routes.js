import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/authenticate.js';
import { noStore } from '../../middleware/security.js';
import { validate } from '../../middleware/validate.js';
import * as service from './notifications.service.js';

const router = Router();
router.use(noStore, authenticate);

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const listQuery = z.object({
  unread: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

router.get('/', validate({ query: listQuery }), wrap(async (req, res) => res.json(await service.listNotifications(req.user.id, { unreadOnly: req.query.unread, limit: req.query.limit }))));
router.post('/read-all', wrap(async (req, res) => res.json(await service.markAllRead(req.user.id))));
router.post('/:id/read', wrap(async (req, res) => res.json({ data: await service.markRead(req.user.id, req.params.id) })));

export default router;
