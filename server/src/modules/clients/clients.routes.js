import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { noStore } from '../../middleware/security.js';
import { validate } from '../../middleware/validate.js';
import * as discussions from '../communications/communications.service.js';
import { createClientSchema, createDiscussionSchema, listClientsQuerySchema, listDiscussionsQuerySchema, updateClientSchema } from './clients.schemas.js';
import * as service from './clients.service.js';

const router = Router();
router.use(noStore, authenticate);

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
// The user comes from the verified session (never from the request).
const user = (req) => ({ id: req.user.id, timezone: req.user.doc.timezone });

router.get('/meta', wrap(async (req, res) => res.json(await service.clientMeta(req.user.id))));
router.get('/', validate({ query: listClientsQuerySchema }), wrap(async (req, res) => res.json(await service.listClients(user(req), req.query))));
router.post('/', validate({ body: createClientSchema }), wrap(async (req, res) => res.status(201).json({ data: await service.createClient(user(req), req.body) })));

router.get('/:id', wrap(async (req, res) => res.json({ data: await service.getClient(user(req), req.params.id) })));
router.patch('/:id', validate({ body: updateClientSchema }), wrap(async (req, res) => res.json({ data: await service.updateClient(user(req), req.params.id, req.body) })));
router.delete('/:id', wrap(async (req, res) => res.json(await service.deleteClient(user(req), req.params.id))));

router.post('/:id/archive', wrap(async (req, res) => res.json(await service.setArchived(user(req), req.params.id, true))));
router.post('/:id/restore', wrap(async (req, res) => res.json(await service.setArchived(user(req), req.params.id, false))));

// Related records, read THROUGH their references to this client (nothing is copied onto the client).
router.get('/:id/campaigns', wrap(async (req, res) => res.json(await service.listClientCampaigns(user(req), req.params.id))));
router.get('/:id/invoices', wrap(async (req, res) => res.json(await service.listClientInvoices(user(req), req.params.id))));

router.get('/:id/communications', validate({ query: listDiscussionsQuerySchema }), wrap(async (req, res) => res.json(await discussions.listDiscussions(user(req), req.params.id, req.query))));
router.post('/:id/communications', validate({ body: createDiscussionSchema }), wrap(async (req, res) => res.status(201).json(await discussions.createDiscussion(user(req), req.params.id, req.body))));

export default router;
