import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { AppError } from '../../lib/errors.js';
import { authenticate } from '../../middleware/authenticate.js';
import { noStore } from '../../middleware/security.js';
import { validate } from '../../middleware/validate.js';
import { confirmProposal, dismissProposal, listProposals } from './ai.actions.js';
import { aiConfig } from './ai.config.js';
import { actionsQuerySchema, askSchema, campaignPlanSchema, copySchema, ideasSchema, prioritiesSchema, summarizeSchema } from './ai.schemas.js';
import * as service from './ai.service.js';

const router = Router();
router.use(noStore, authenticate);

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
// The user comes from the verified session (never from the request body).
const user = (req) => {
  const d = req.user.doc;
  return { id: req.user.id, name: d.name, email: d.email, timezone: d.timezone, defaultCurrency: d.defaultCurrency, deadlineOffsets: d.calendarPrefs?.deadlineReminderOffsets };
};

// Per-user burst limit for anything that can reach the AI provider (the daily cap is enforced in ai.usage.js).
const aiLimiter = rateLimit({
  windowMs: 60_000,
  limit: () => aiConfig().perMinute,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id ?? req.ip,
  handler: (_req, _res, next) => next(new AppError(429, 'RATE_LIMITED', 'You are sending AI requests too quickly. Wait a moment and try again.')),
});

const generate = (schema, fn) => [aiLimiter, validate({ body: schema }), wrap(async (req, res) => res.json(await fn(user(req), req.body)))];

router.get('/status', wrap(async (req, res) => res.json({ data: await service.status(user(req)) })));

router.post('/ideas', ...generate(ideasSchema, service.contentIdeas));
router.post('/copy', ...generate(copySchema, service.copyWriting));
router.post('/campaign-plan', ...generate(campaignPlanSchema, service.campaignPlan));
router.post('/summarize-communications', ...generate(summarizeSchema, service.summarizeCommunications));
router.post('/task-priorities', ...generate(prioritiesSchema, service.taskPriorities));
router.post('/ask', ...generate(askSchema, service.askAboutData));

// Suggested actions. Nothing here talks to the AI provider; applying one needs the user's explicit confirmation.
router.get('/actions', validate({ query: actionsQuerySchema }), wrap(async (req, res) => res.json({ data: await listProposals(req.user.id, req.query) })));
router.post('/actions/:id/confirm', wrap(async (req, res) => res.json({ data: await confirmProposal(user(req), req.params.id) })));
router.post('/actions/:id/dismiss', wrap(async (req, res) => res.json({ data: await dismissProposal(user(req), req.params.id) })));

export default router;
