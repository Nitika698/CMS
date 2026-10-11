import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { env } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';
import { authenticate } from '../../middleware/authenticate.js';
import { noStore, uploadLimiter } from '../../middleware/security.js';
import { validate } from '../../middleware/validate.js';
import { ALLOWED_TYPES, assertCanAttach, attachAsset, maxUploadBytes, removeAsset, uploadLimits } from '../media/media.service.js';
import { LIMITS, PLATFORMS, STATUS_LABELS, STATUSES, TRANSITIONS, TYPES } from './content.constants.js';
import { commentSchema, createSchema, listQuerySchema, SORTS, transitionSchema, updateSchema } from './content.schemas.js';
import * as service from './content.service.js';

const router = Router();
router.use(noStore, authenticate);

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const MB = 1024 * 1024;

// ---- uploads: stream to a temp file with a hard size cap; the service then validates type/size and moves it to storage.
const tmpDir = path.join(os.tmpdir(), 'cms-uploads');
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => fs.mkdir(tmpDir, { recursive: true }).then(() => cb(null, tmpDir), cb),
    filename: (_req, _file, cb) => cb(null, crypto.randomUUID()),
  }),
  limits: { fileSize: maxUploadBytes(), files: 1, fields: 4, parts: 6 },
});
const receiveFile = (req, res, next) =>
  upload.single('file')(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') return next(new AppError(413, 'FILE_TOO_LARGE', `Files can be at most ${+(maxUploadBytes() / MB).toFixed(2)} MB`));
    if (err instanceof multer.MulterError) return next(new AppError(400, 'UPLOAD_ERROR', 'Send exactly one file in the "file" field'));
    next(err);
  });

// ---- metadata for the UI (single source of truth for the workflow and limits)
router.get('/meta', (_req, res) => {
  const limits = uploadLimits();
  res.json({
    statuses: STATUSES.map((key) => ({ key, label: STATUS_LABELS[key], next: TRANSITIONS[key] })),
    types: TYPES,
    platforms: PLATFORMS,
    sorts: SORTS,
    limits: {
      ...LIMITS,
      maxAssets: env.MAX_ASSETS_PER_CONTENT,
      upload: { imageBytes: limits.image, videoBytes: limits.video, documentBytes: limits.document },
      allowed: ALLOWED_TYPES,
    },
  });
});

router.get('/', validate({ query: listQuerySchema }), wrap(async (req, res) => res.json(await service.listContent(req.user.id, req.query))));
router.post('/', validate({ body: createSchema }), wrap(async (req, res) => res.status(201).json({ data: await service.createContent(req.user.id, req.body) })));

router.get('/:id', wrap(async (req, res) => res.json({ data: await service.getContent(req.user.id, req.params.id) })));
router.patch('/:id', validate({ body: updateSchema }), wrap(async (req, res) => res.json({ data: await service.updateContent(req.user.id, req.params.id, req.body) })));
router.delete('/:id', wrap(async (req, res) => (await service.deleteContent(req.user.id, req.params.id), res.status(204).end())));

router.post('/:id/transition', validate({ body: transitionSchema }), wrap(async (req, res) => res.json({ data: await service.transitionContent(req.user.id, req.params.id, req.body) })));
router.post('/:id/comments', validate({ body: commentSchema }), wrap(async (req, res) => res.status(201).json(await service.addComment(req.user.id, req.params.id, req.body))));
router.get('/:id/history', wrap(async (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);
  const type = req.query.type === 'reviews' ? 'reviews' : undefined;
  const before = typeof req.query.before === 'string' ? req.query.before : undefined; // format validated by the service
  res.json(await service.listHistory(req.user.id, req.params.id, { type, limit, before }));
}));
router.post('/:id/archive', wrap(async (req, res) => res.json({ data: await service.setArchived(req.user.id, req.params.id, true) })));
router.post('/:id/restore', wrap(async (req, res) => res.json({ data: await service.setArchived(req.user.id, req.params.id, false) })));

// Upload: ownership is verified BEFORE the body is read, so a foreign/unknown id never causes a file to be written.
router.post(
  '/:id/assets',
  uploadLimiter,
  wrap(async (req, _res, next) => (await assertCanAttach(req.user.id, req.params.id), next())),
  receiveFile,
  wrap(async (req, res) => {
    let asset;
    try {
      asset = await attachAsset(req.user.id, req.params.id, req.file);
    } finally {
      if (req.file) await fs.rm(req.file.path, { force: true }); // always remove the temp file BEFORE responding
    }
    res.status(201).json({ data: asset });
  }),
);
router.delete('/:id/assets/:assetId', wrap(async (req, res) => (await removeAsset(req.user.id, req.params.id, req.params.assetId), res.status(204).end())));

export default router;
