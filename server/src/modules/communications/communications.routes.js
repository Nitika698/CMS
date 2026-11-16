import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { noStore } from '../../middleware/security.js';
import { validate } from '../../middleware/validate.js';
import { listAllDiscussionsQuerySchema, updateDiscussionSchema } from '../clients/clients.schemas.js';
import * as service from './communications.service.js';

const router = Router();
router.use(noStore, authenticate);

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const user = (req) => ({ id: req.user.id, timezone: req.user.doc.timezone });

router.get('/', validate({ query: listAllDiscussionsQuerySchema }), wrap(async (req, res) => res.json(await service.listAllDiscussions(user(req), req.query))));

// Saved discussions are created under a client (POST /clients/:id/communications); these act on one by id.
router.get('/:id', wrap(async (req, res) => res.json(await service.getDiscussion(user(req), req.params.id))));
router.patch('/:id', validate({ body: updateDiscussionSchema }), wrap(async (req, res) => res.json(await service.updateDiscussion(user(req), req.params.id, req.body))));
router.delete('/:id', wrap(async (req, res) => (await service.deleteDiscussion(user(req), req.params.id), res.status(204).end())));

export default router;
