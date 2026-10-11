import { z } from 'zod';
import { LIMITS, PLATFORMS, STATUSES, TYPES } from './content.constants.js';

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');

// ISO date-time ("2026-10-14T09:30:00Z", with offset) or a plain date ("2026-10-14").
const dateInput = z
  .union([z.string().datetime({ offset: true }), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)], { errorMap: () => ({ message: 'Use a valid date' }) })
  .transform((s) => new Date(s))
  .refine((d) => !Number.isNaN(d.getTime()), 'Use a valid date');

// Keeps the FIRST occurrence of each value (so "#Bali" then "bali" stays "Bali").
const dedupe = (list, key = (x) => x) => {
  const seen = new Set();
  return list.filter((x) => (seen.has(key(x)) ? false : seen.add(key(x))));
};

const tag = z.string().trim().toLowerCase().min(1, 'Tags cannot be empty').max(30, 'Tags are at most 30 characters');
const tags = z.array(tag).max(LIMITS.tags, `At most ${LIMITS.tags} tags`).transform((l) => dedupe(l));

const hashtag = z
  .string()
  .trim()
  .transform((s) => s.replace(/^#+/, ''))
  .refine((s) => /^[\p{L}\p{N}_]{1,50}$/u.test(s), 'Hashtags may contain letters, numbers and underscores only');
const hashtags = z.array(hashtag).max(LIMITS.hashtags, `At most ${LIMITS.hashtags} hashtags`).transform((l) => dedupe(l, (h) => h.toLowerCase()));

const platforms = z.array(z.enum(PLATFORMS)).max(PLATFORMS.length).transform((l) => dedupe(l));
const longText = z.string().max(LIMITS.textLen, `At most ${LIMITS.textLen} characters`);
const url = z
  .string()
  .trim()
  .max(2000)
  .refine((s) => {
    try {
      return ['http:', 'https:'].includes(new URL(s).protocol);
    } catch {
      return false;
    }
  }, 'Enter a valid http(s) link');

const fields = {
  title: z.string().trim().min(1, 'Title is required').max(LIMITS.titleLen),
  description: longText.nullable(),
  type: z.enum(TYPES),
  category: objectId.nullable(),
  platforms,
  tags,
  campaign: objectId.nullable(),
  caption: longText.nullable(),
  hashtags,
  brief: longText.nullable(),
  plannedDate: dateInput.nullable(),
  deadline: dateInput.nullable(),
};

// .strict(): unknown keys (owner, status, revision, approval, publishedAt ...) are errors, never silently accepted.
// Status is changed only through POST /:id/transition.
export const createSchema = z.object({ ...fields, title: fields.title }).partial({ description: true, type: true, category: true, platforms: true, tags: true, campaign: true, caption: true, hashtags: true, brief: true, plannedDate: true, deadline: true }).strict();

export const updateSchema = z
  .object({ ...fields, publishedUrl: url.nullable() })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field to update');

export const transitionSchema = z
  .object({
    to: z.enum(STATUSES),
    comment: z.string().trim().max(5000).optional(),
    publishedAt: dateInput.optional(),
    publishedUrl: url.optional(),
    approverName: z.string().trim().min(1).max(120).optional(),
  })
  .strict();

export const commentSchema = z.object({ comment: z.string().trim().min(1, 'Write a comment').max(5000) }).strict();

const csv = (schema) => z.string().transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean)).pipe(z.array(schema).max(10));

export const SORTS = ['updatedAt', 'createdAt', 'title', 'deadline', 'plannedDate', 'status'];

export const listQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  status: csv(z.enum(STATUSES)).optional(),
  type: csv(z.enum(TYPES)).optional(),
  platform: z.enum(PLATFORMS).optional(),
  category: objectId.optional(),
  campaign: objectId.optional(),
  tag: z.string().trim().toLowerCase().max(30).optional(),
  archived: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  sort: z
    .string()
    .regex(new RegExp(`^-?(${SORTS.join('|')})$`), 'Unknown sort')
    .default('-updatedAt'),
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
