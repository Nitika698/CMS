import { Router } from 'express';
import { publishViaPlatform } from '../../integrations/publishing/publishing.service.js';
import { authenticate } from '../../middleware/authenticate.js';
import { noStore } from '../../middleware/security.js';
import { validate } from '../../middleware/validate.js';
import { createPostSchema, listPostsQuerySchema, transitionPostSchema, updatePostSchema } from './posts.schemas.js';
import * as service from './posts.service.js';

const router = Router();
router.use(noStore, authenticate);

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
// The user comes from the verified session (req.user.doc, which carries timezone and calendar preferences).
const user = (req) => ({ id: req.user.id, timezone: req.user.doc.timezone, calendarPrefs: req.user.doc.calendarPrefs });

router.get('/', validate({ query: listPostsQuerySchema }), wrap(async (req, res) => res.json({ data: await service.listPosts(user(req), req.query) })));
router.post('/', validate({ body: createPostSchema }), wrap(async (req, res) => res.status(201).json(await service.createPost(user(req), req.body))));
router.get('/:id', wrap(async (req, res) => res.json(await service.getPost(user(req), req.params.id))));
router.patch('/:id', validate({ body: updatePostSchema }), wrap(async (req, res) => res.json(await service.updatePost(user(req), req.params.id, req.body))));
router.post('/:id/transition', validate({ body: transitionPostSchema }), wrap(async (req, res) => res.json(await service.transitionPost(user(req), req.params.id, req.body))));
router.delete('/:id', wrap(async (req, res) => (await service.deletePost(user(req), req.params.id), res.status(204).end())));

// Future: direct publishing. Refuses with 501 unless a platform adapter is registered AND configured (none are today).
router.post('/:id/publish-via-platform', wrap(async (req, res) => res.json(await publishViaPlatform(user(req), req.params.id))));

export default router;
