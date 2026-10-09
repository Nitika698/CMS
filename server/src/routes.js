import { Router } from 'express';
import health from './modules/health/health.routes.js';

const router = Router();

router.use('/health', health);
// Feature modules (auth, content, clients, ...) are mounted here as they are built.

export default router;
