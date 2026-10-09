import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/authenticate.js';
import { noStore } from '../../middleware/security.js';
import { validate } from '../../middleware/validate.js';
import { AppError } from '../../lib/errors.js';
import { scoped } from '../../lib/scoped.js';
import { Category, toPublicCategory } from './category.model.js';

/**
 * REFERENCE IMPLEMENTATION of an owner-scoped resource. Every future module (content, clients, ...)
 * follows this shape: authenticate -> validate (.strict()) -> scoped(Model, req.user.id).
 * Categories will be used by Content in the next phase.
 */
const router = Router();
router.use(noStore, authenticate);

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex colour like #6366f1');
const createSchema = z.object({ name: z.string().trim().min(1).max(60), color: color.optional() }).strict();
const updateSchema = z
  .object({ name: z.string().trim().min(1).max(60).optional(), color: color.optional() })
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field to update');

const repo = (req) => scoped(Category, req.user.id, 'Category');
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
const dup = (err) => {
  if (err.code === 11000) throw new AppError(409, 'DUPLICATE', 'A category with this name already exists');
  throw err;
};

router.get(
  '/',
  wrap(async (req, res) => {
    const items = await repo(req).list({}, { sort: { nameLower: 1 } });
    res.json({ data: items.map(toPublicCategory) });
  }),
);

router.post(
  '/',
  validate({ body: createSchema }),
  wrap(async (req, res) => {
    const doc = await repo(req).create(req.body).catch(dup);
    res.status(201).json({ data: toPublicCategory(doc) });
  }),
);

router.get('/:id', wrap(async (req, res) => res.json({ data: toPublicCategory(await repo(req).get(req.params.id)) })));

router.patch(
  '/:id',
  validate({ body: updateSchema }),
  wrap(async (req, res) => {
    const data = { ...req.body, ...(req.body.name && { nameLower: req.body.name.toLowerCase() }) };
    const doc = await repo(req).update(req.params.id, data).catch(dup);
    res.json({ data: toPublicCategory(doc) });
  }),
);

router.delete(
  '/:id',
  wrap(async (req, res) => {
    await repo(req).remove(req.params.id);
    res.status(204).end();
  }),
);

export default router;
