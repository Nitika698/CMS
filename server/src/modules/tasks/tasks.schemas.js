import { z } from 'zod';
import { DUE_FILTERS, LIMITS, MAX_REMINDER_MINUTES, MAX_REMINDERS, SORTS, TASK_PRIORITIES, TASK_STATUSES } from './task.constants.js';

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');
const emptyToNull = (v) => (v === '' ? null : v);

const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-10-31')
  .refine((s) => {
    const [y, m, d] = s.split('-').map(Number);
    const t = new Date(Date.UTC(y, m - 1, d));
    return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
  }, 'That date does not exist');
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a time like 14:30');

const remindOffsets = z
  .array(z.number().int('Whole minutes only').min(0).max(MAX_REMINDER_MINUTES, 'At most 30 days before'))
  .max(MAX_REMINDERS, `At most ${MAX_REMINDERS} reminders`)
  .refine((l) => new Set(l).size === l.length, 'Each reminder time can only be listed once');

const fields = {
  title: z.string().trim().min(1, 'Give the task a title').max(LIMITS.title, `Title is at most ${LIMITS.title} characters`),
  description: z.string().trim().max(LIMITS.description, `Description is at most ${LIMITS.description} characters`).transform(emptyToNull).nullable(),
  priority: z.enum(TASK_PRIORITIES),
  dueDate: day.nullable(),
  dueTime: time.nullable(), // wall-clock time in the user's profile timezone; needs a dueDate
  remindOffsets,
  assignee: objectId.nullable(),
  campaign: objectId.nullable(),
  client: objectId.nullable(),
  content: objectId.nullable(),
};

const timeNeedsDate = (v) => !(v.dueTime && v.dueDate === null);
const timeNeedsDateMsg = { message: 'Pick a due date to go with the time', path: ['dueTime'] };

// .strict(): owner, completedAt, archivedAt ... can never be set through create/edit.
export const createTaskSchema = z
  .object({ ...fields, status: z.enum(['todo', 'doing']) })
  .partial()
  .required({ title: true })
  .strict()
  .refine((v) => !(v.dueTime && !v.dueDate), timeNeedsDateMsg);
export const updateTaskSchema = z
  .object({ ...fields, version: z.number().int().min(0) })
  .partial()
  .strict()
  .refine(timeNeedsDate, timeNeedsDateMsg)
  .refine((v) => Object.keys(v).some((k) => k !== 'version'), 'Provide at least one field to update');

export const transitionTaskSchema = z.object({ to: z.enum(TASK_STATUSES) }).strict();

const csv = (schema) => z.string().transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean)).pipe(z.array(schema).max(10));

export const listTasksQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  status: csv(z.enum(TASK_STATUSES)).optional(),
  open: z.enum(['true', 'false']).optional(), // shortcut: only todo/doing
  priority: csv(z.enum(TASK_PRIORITIES)).optional(),
  due: z.enum(DUE_FILTERS).optional(),
  campaign: objectId.optional(),
  client: objectId.optional(),
  content: objectId.optional(),
  assignee: z.union([z.literal('me'), z.literal('unassigned')]).optional(),
  archived: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  sort: z.string().regex(new RegExp(`^-?(${SORTS.join('|')})$`), 'Unknown sort').default('due'),
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const summaryQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(50).default(10) });
