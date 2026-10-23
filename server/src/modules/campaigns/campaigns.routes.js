import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { noStore } from '../../middleware/security.js';
import { validate } from '../../middleware/validate.js';
import {
  createCampaignSchema, createDeliverableSchema, linkContentSchema, listCampaignsQuerySchema, transitionCampaignSchema,
  transitionDeliverableSchema, updateCampaignSchema, updateDeliverableSchema,
} from './campaigns.schemas.js';
import * as service from './campaigns.service.js';

const router = Router();
router.use(noStore, authenticate);

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
// The user comes from the verified session (never from the request).
const user = (req) => ({ id: req.user.id, timezone: req.user.doc.timezone });

router.get('/meta', (_req, res) => res.json(service.campaignMeta()));
// Small picker list for other screens (content form, calendar filters).
router.get('/lookup', wrap(async (req, res) => res.json({ data: await service.lookupCampaigns(req.user.id) })));

router.get('/', validate({ query: listCampaignsQuerySchema }), wrap(async (req, res) => res.json(await service.listCampaigns(user(req), req.query))));
router.post('/', validate({ body: createCampaignSchema }), wrap(async (req, res) => res.status(201).json({ data: await service.createCampaign(user(req), req.body) })));

router.get('/:id', wrap(async (req, res) => res.json({ data: await service.getCampaign(user(req), req.params.id) })));
router.patch('/:id', validate({ body: updateCampaignSchema }), wrap(async (req, res) => res.json({ data: await service.updateCampaign(user(req), req.params.id, req.body) })));
router.delete('/:id', wrap(async (req, res) => res.json(await service.deleteCampaign(user(req), req.params.id))));

router.post('/:id/transition', validate({ body: transitionCampaignSchema }), wrap(async (req, res) => res.json({ data: await service.transitionCampaign(user(req), req.params.id, req.body) })));
router.post('/:id/archive', wrap(async (req, res) => res.json(await service.setArchived(user(req), req.params.id, true))));
router.post('/:id/restore', wrap(async (req, res) => res.json(await service.setArchived(user(req), req.params.id, false))));

// Content linked to the campaign (the link itself lives on the content item).
router.post('/:id/content', validate({ body: linkContentSchema }), wrap(async (req, res) => res.json({ data: await service.linkContent(user(req), req.params.id, req.body.contentId) })));
router.delete('/:id/content/:contentId', wrap(async (req, res) => res.json({ data: await service.unlinkContent(user(req), req.params.id, req.params.contentId) })));

// Deliverables, tracked one by one.
router.post('/:id/deliverables', validate({ body: createDeliverableSchema }), wrap(async (req, res) => res.status(201).json({ data: await service.createDeliverables(user(req), req.params.id, req.body) })));
router.patch('/:id/deliverables/:did', validate({ body: updateDeliverableSchema }), wrap(async (req, res) => res.json({ data: await service.updateDeliverable(user(req), req.params.id, req.params.did, req.body) })));
router.post('/:id/deliverables/:did/transition', validate({ body: transitionDeliverableSchema }), wrap(async (req, res) => res.json({ data: await service.transitionDeliverable(user(req), req.params.id, req.params.did, req.body) })));
router.delete('/:id/deliverables/:did', wrap(async (req, res) => res.json(await service.removeDeliverable(user(req), req.params.id, req.params.did))));

export default router;
