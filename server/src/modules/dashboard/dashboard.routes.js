import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { noStore } from '../../middleware/security.js';
import { getDashboard } from './dashboard.service.js';

const router = Router();
router.use(noStore, authenticate);

// Read-only. The user comes from the verified session, never from the request, so there is no way to ask for someone else's dashboard.
router.get('/', (req, res, next) => getDashboard(req.user.doc).then((data) => res.json(data), next));

export default router;
