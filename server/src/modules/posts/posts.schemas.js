import { z } from 'zod';
import { PLATFORMS } from '../content/content.constants.js';
import { MAX_REMINDERS, MAX_REMINDER_MINUTES, POST_STATUSES } from './post.constants.js';

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');

// An instant MUST carry its offset ("...Z" or "+05:30"). A bare "2026-10-14T18:30" is ambiguous, so it is refused:
// send `scheduledLocal` instead and the server interprets it in the user's profile timezone.
const instant = z
  .string()
  .datetime({ offset: true, message: 'Use a full date-time with a time zone offset, e.g. 2026-10-14T13:00:00Z (or send scheduledLocal)' })
  .transform((s) => new Date(s));

const local = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'Use YYYY-MM-DDTHH:mm (your local time)');

const reminders = z
  .array(z.number().int().min(1, 'Reminders are at least 1 minute before').max(MAX_REMINDER_MINUTES, 'Reminders can be at most 30 days before'))
  .max(MAX_REMINDERS, `At most ${MAX_REMINDERS} reminders`)
  .transform((l) => [...new Set(l)].sort((a, b) => b - a));

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

const caption = z.string().max(20_000);
const version = z.number().int().min(0); // optimistic concurrency token: the `version` the client last saw

const oneTime = (v) => !(v.scheduledAt !== undefined && v.scheduledLocal !== undefined);
const oneTimeMsg = { message: 'Send either scheduledAt or scheduledLocal, not both', path: ['scheduledLocal'] };

// .strict() everywhere: owner, status, active, verification, externalPostId ... can never be set by a client.
export const createPostSchema = z
  .object({
    content: objectId,
    platform: z.enum(PLATFORMS),
    status: z.enum(['planned', 'scheduled']).optional(), // default: planned
    scheduledAt: instant.optional(),
    scheduledLocal: local.optional(),
    reminderOffsets: reminders.optional(),
    captionOverride: caption.nullable().optional(),
    confirmConflict: z.boolean().optional(),
  })
  .strict()
  .refine(oneTime, oneTimeMsg);

export const updatePostSchema = z
  .object({
    platform: z.enum(PLATFORMS),
    scheduledAt: instant.nullable(),
    scheduledLocal: local.nullable(),
    reminderOffsets: reminders,
    captionOverride: caption.nullable(),
    publishedUrl: url.nullable(),
    version,
    confirmConflict: z.boolean(),
  })
  .partial()
  .strict()
  .refine(oneTime, oneTimeMsg)
  .refine((v) => Object.keys(v).some((k) => !['version', 'confirmConflict'].includes(k)), 'Provide at least one field to update');

export const transitionPostSchema = z
  .object({
    to: z.enum(POST_STATUSES),
    scheduledAt: instant.optional(),
    scheduledLocal: local.optional(),
    reminderOffsets: reminders.optional(),
    publishedAt: instant.optional(),
    publishedLocal: local.optional(), // alternative to publishedAt: wall-clock time in the user's timezone
    publishedUrl: url.optional(),
    version: version.optional(),
    confirmConflict: z.boolean().optional(),
  })
  .strict()
  .refine(oneTime, oneTimeMsg)
  .refine((v) => !(v.publishedAt !== undefined && v.publishedLocal !== undefined), { message: 'Send either publishedAt or publishedLocal, not both', path: ['publishedLocal'] });

const csv = (schema) => z.string().transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean)).pipe(z.array(schema).max(10));

export const listPostsQuerySchema = z.object({
  content: objectId.optional(),
  status: csv(z.enum(POST_STATUSES)).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
// Local calendar dates in the user's profile timezone (inclusive). No time-zone maths is needed in the browser.
export const rangeQuerySchema = z.object({
  from: ymd,
  to: ymd,
  platform: z.enum(PLATFORMS).optional(),
  category: objectId.optional(),
  campaign: objectId.optional(),
  status: csv(z.enum(POST_STATUSES)).optional(), // post status
  contentStatus: csv(z.enum(['idea', 'planning', 'creation', 'review', 'approved', 'published'])).optional(), // workflow status
  includeCancelled: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
});
