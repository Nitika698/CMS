import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { noStore } from '../../middleware/security.js';
import { validate } from '../../middleware/validate.js';
import { createTaskSchema, listTasksQuerySchema, summaryQuerySchema, transitionTaskSchema, updateTaskSchema } from './tasks.schemas.js';
import * as service from './tasks.service.js';

const router = Router();
router.use(noStore, authenticate);

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
// The user comes from the verified session (never from the request).
const user = (req) => ({
  id: req.user.id,
  name: req.user.doc.name,
  timezone: req.user.doc.timezone,
  deadlineOffsets: req.user.doc.calendarPrefs?.deadlineReminderOffsets,
});

router.get('/meta', (_req, res) => res.json(service.taskMeta()));
router.get('/summary', validate({ query: summaryQuerySchema }), wrap(async (req, res) => res.json({ data: await service.taskSummary(user(req), req.query) })));

router.get('/', validate({ query: listTasksQuerySchema }), wrap(async (req, res) => res.json(await service.listTasks(user(req), req.query))));
router.post('/', validate({ body: createTaskSchema }), wrap(async (req, res) => res.status(201).json({ data: await service.createTask(user(req), req.body) })));

router.get('/:id', wrap(async (req, res) => res.json({ data: await service.getTask(user(req), req.params.id) })));
router.patch('/:id', validate({ body: updateTaskSchema }), wrap(async (req, res) => res.json({ data: await service.updateTask(user(req), req.params.id, req.body) })));
router.delete('/:id', wrap(async (req, res) => res.json(await service.deleteTask(user(req), req.params.id))));

router.post('/:id/transition', validate({ body: transitionTaskSchema }), wrap(async (req, res) => res.json({ data: await service.transitionTask(user(req), req.params.id, req.body.to) })));
router.post('/:id/complete', wrap(async (req, res) => res.json({ data: await service.transitionTask(user(req), req.params.id, 'done') })));
router.post('/:id/reopen', wrap(async (req, res) => res.json({ data: await service.transitionTask(user(req), req.params.id, 'todo') })));
router.post('/:id/archive', wrap(async (req, res) => res.json(await service.setArchived(user(req), req.params.id, true))));
router.post('/:id/restore', wrap(async (req, res) => res.json(await service.setArchived(user(req), req.params.id, false))));

export default router;
