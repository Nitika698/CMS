import { z } from 'zod';
import { PLATFORMS, TYPES } from '../content/content.constants.js';

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');
const text = (max, label) => z.string().trim().min(1, `${label} is required`).max(max, `${label} is at most ${max} characters`);
const optText = (max, label) => z.string().trim().max(max, `${label} is at most ${max} characters`).optional();

// ------------------------------------------------------------------ what the browser may send (strict: unknown fields are errors)

export const ideasSchema = z
  .object({
    niche: text(200, 'Niche'),
    platform: z.enum(PLATFORMS),
    audience: optText(300, 'Audience'),
    goals: optText(300, 'Goals'),
    count: z.number().int().min(1).max(10).default(5),
  })
  .strict();

export const COPY_PARTS = ['hooks', 'captions', 'ctas', 'hashtags'];
export const copySchema = z
  .object({
    topic: text(300, 'Topic'),
    platform: z.enum(PLATFORMS),
    tone: optText(60, 'Tone'),
    audience: optText(300, 'Audience'),
    include: z.array(z.enum(COPY_PARTS)).min(1).max(4).default(COPY_PARTS),
    count: z.number().int().min(1).max(8).default(3),
  })
  .strict();

export const campaignPlanSchema = z
  .object({
    campaignId: objectId.optional(),
    brief: optText(4000, 'Brief'),
    platforms: z.array(z.enum(PLATFORMS)).max(8).optional(),
  })
  .strict()
  .refine((v) => v.campaignId || v.brief, { message: 'Choose a campaign or paste a brief', path: ['brief'] });

export const summarizeSchema = z.object({ client: objectId, campaignId: objectId.optional(), limit: z.number().int().min(1).max(15).default(8) }).strict();
export const prioritiesSchema = z.object({ limit: z.number().int().min(1).max(30).default(20) }).strict();

const turn = z.object({ role: z.enum(['user', 'assistant']), content: z.string().trim().min(1).max(2000) }).strict();
export const askSchema = z.object({ question: text(1000, 'Question'), history: z.array(turn).max(8).default([]) }).strict();

export const actionsQuerySchema = z.object({ status: z.enum(['pending', 'applied', 'dismissed', 'failed', 'all']).default('pending'), limit: z.coerce.number().int().min(1).max(100).default(50) });

// ------------------------------------------------------------------ what the model may answer
// Lenient on purpose: strings are trimmed and cut to length, lists are cut to size, and a malformed list item is dropped
// instead of failing the whole answer. Anything not named here is ignored, so extra "instructions" in an answer do nothing.

const str = (max) => z.string().transform((s) => s.trim().slice(0, max));
const optStr = (max) => z.string().transform((s) => s.trim().slice(0, max) || undefined).optional().catch(undefined);
const list = (item, max) =>
  z
    .array(z.unknown())
    .catch([])
    .transform((arr) => arr.map((x) => item.safeParse(x)).filter((r) => r.success).map((r) => r.data).slice(0, max));
const oneOf = (values, fallback) => z.string().transform((s) => s.trim().toLowerCase()).transform((s) => (values.includes(s) ? s : fallback)).catch(fallback);
const dayStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().catch(undefined);
const PRIORITIES = ['low', 'normal', 'high', 'urgent'];

export const ideasOut = z.object({
  ideas: list(z.object({ title: str(120), angle: str(300), format: oneOf(TYPES, 'other'), whyItWorks: optStr(300) }), 10),
});
export const copyOut = z.object({
  hooks: list(str(200), 8).optional(),
  captions: list(str(1500), 8).optional(),
  ctas: list(str(150), 8).optional(),
  hashtags: list(str(40), 30).optional(),
});
export const planOut = z.object({
  summary: optStr(600),
  contentPlan: list(z.object({ title: str(200), platform: oneOf(PLATFORMS, 'other'), format: oneOf(TYPES, 'other'), description: optStr(300), suggestedDate: dayStr }), 12),
  checklist: list(z.object({ title: str(200), priority: oneOf(PRIORITIES, 'normal'), dueDate: dayStr }), 15),
  questions: list(str(200), 6).optional(),
});
export const summaryOut = z.object({
  summary: optStr(800),
  keyPoints: list(str(200), 8).optional(),
  actionItems: list(z.object({ title: str(200), priority: oneOf(PRIORITIES, 'normal'), dueDate: dayStr }), 8),
  openQuestions: list(str(200), 5).optional(),
});
export const prioritiesOut = z.object({
  summary: optStr(400),
  ranking: list(z.object({ ref: str(10), priority: oneOf(PRIORITIES, 'normal'), reason: optStr(200) }), 30),
});
