import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { noStore } from '../../middleware/security.js';
import { Client } from '../clients/client.model.js';
import { Campaign } from './campaign.model.js';

const router = Router();
router.use(noStore, authenticate);

/**
 * READ-ONLY lookup so other modules (content) can offer a campaign picker.
 * Creating and editing campaigns belongs to the Campaigns module (roadmap P5) and is intentionally not here.
 */
router.get('/', async (req, res, next) => {
  try {
    const campaigns = await Campaign.find({ owner: req.user.id, archivedAt: null }).select('title status client').sort({ title: 1 }).limit(200).lean();
    const clients = await Client.find({ owner: req.user.id, _id: { $in: campaigns.map((c) => c.client) } }).select('name').lean();
    const names = new Map(clients.map((c) => [String(c._id), c.name]));
    res.json({
      data: campaigns.map((c) => ({ id: String(c._id), title: c.title, status: c.status, clientName: names.get(String(c.client)) ?? null })),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
