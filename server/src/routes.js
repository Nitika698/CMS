import { Router } from 'express';
import health from './modules/health/health.routes.js';
import auth from './modules/auth/auth.routes.js';
import users from './modules/users/users.routes.js';
import categories from './modules/categories/categories.routes.js';

const router = Router();

router.use('/health', health);
router.use('/auth', auth);
router.use('/me', users);
router.use('/categories', categories);
// Feature modules (content, clients, ...) are mounted here as they are built.

export default router;
