import { Router } from 'express';
import health from './modules/health/health.routes.js';
import auth from './modules/auth/auth.routes.js';
import users from './modules/users/users.routes.js';
import categories from './modules/categories/categories.routes.js';
import dashboard from './modules/dashboard/dashboard.routes.js';
import content from './modules/content/content.routes.js';
import media from './modules/media/media.routes.js';
import campaigns from './modules/campaigns/campaigns.routes.js';
import posts from './modules/posts/posts.routes.js';
import calendar from './modules/calendar/calendar.routes.js';
import notifications from './modules/notifications/notifications.routes.js';
import clients from './modules/clients/clients.routes.js';
import communications from './modules/communications/communications.routes.js';

const router = Router();

router.use('/health', health);
router.use('/auth', auth);
router.use('/me', users);
router.use('/categories', categories);
router.use('/dashboard', dashboard);
router.use('/content', content);
router.use('/media', media);
router.use('/campaigns', campaigns); // read-only lookup until the Campaigns module ships
router.use('/posts', posts);
router.use('/calendar', calendar);
router.use('/notifications', notifications);
router.use('/clients', clients);
router.use('/communications', communications);
// Feature modules (content, clients, ...) are mounted here as they are built.

export default router;
