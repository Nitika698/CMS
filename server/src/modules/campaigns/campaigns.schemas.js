import { z } from 'zod';
import { PLATFORMS, TYPES } from '../content/content.constants.js';
import { ATTENTION_FILTERS, CAMPAIGN_STATUSES, DELIVERABLE_STATUSES, LIMITS, SORTS } from './campaign.constants.js';

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');
const emptyToNull = (v) => (v === '' ? null : v);
/** Trimmed text; an empty string means "clear it". */
const text = (max, label = 'Text') => z.string().trim().max(max, `${label} is at most ${max} characters`).transform(emptyToNull).nullable();

/** A calendar day, "YYYY-MM-DD". The service turns it into local midnight in the user's timezone. */
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-10-31')
  .refine((s) => {
    const [y, m, d] = s.split('-').map(Number);
    const t = new Date(Date.UTC(y, m - 1, d));
    return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
  }, 'That date does not exist');

const money = z
  .object({
    amountMinor: z.number().int('Amounts are whole minor units (e.g. cents)').min(0).max(1_000_000_000_000),
    currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, 'Use a 3-letter currency code'),
  })
  .strict();

const requirement = z
  .object({
    platform: z.enum(PLATFORMS),
    format: z.enum(TYPES),
    quantity: z.number().int('Whole numbers only').min(1, 'At least 1').max(LIMITS.quantity).default(1),
  })
  .strict();
const requirements = z
  .array(requirement)
  .max(LIMITS.requirements, `At most ${LIMITS.requirements} requirements`)
  .refine((l) => new Set(l.map((r) => `${r.platform}/${r.format}`)).size === l.length, 'Each platform and format can only be listed once; raise its quantity instead');

const objectives = z
  .array(z.string().trim().min(1).max(LIMITS.objectiveLen, `Each objective is at most ${LIMITS.objectiveLen} characters`))
  .max(LIMITS.objectives, `At most ${LIMITS.objectives} objectives`);

const review = z
  .object({ required: z.boolean(), approverName: text(120, 'Approver').optional(), notes: text(LIMITS.shortText, 'Review notes').optional() })
  .strict();

const fields = {
  client: objectId,
  title: z.string().trim().min(1, 'Campaign name is required').max(LIMITS.title),
  brief: text(LIMITS.text, 'Brief'),
  objectives,
  startDate: day.nullable(),
  endDate: day.nullable(),
  deadline: day.nullable(),
  budget: money.nullable(),
  fee: money.nullable(),
  requirements,
  review,
  notes: text(LIMITS.text, 'Notes'),
};

const sameCurrency = (v) => !(v.fee && v.budget && v.fee.currency !== v.budget.currency);
const sameCurrencyMsg = { message: 'Budget and fee must use the same currency', path: ['budget', 'currency'] };

// .strict(): owner, status, archivedAt, statusHistory ... can never be set through create/edit.
export const createCampaignSchema = z.object(fields).partial().required({ client: true, title: true }).strict().refine(sameCurrency, sameCurrencyMsg);
export const updateCampaignSchema = z
  .object({ ...fields, version: z.number().int().min(0) })
  .partial()
  .strict()
  .refine(sameCurrency, sameCurrencyMsg)
  .refine((v) => Object.keys(v).some((k) => k !== 'version'), 'Provide at least one field to update');

export const transitionCampaignSchema = z.object({ to: z.enum(CAMPAIGN_STATUSES), note: text(500, 'Note').optional() }).strict();

const csv = (schema) => z.string().transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean)).pipe(z.array(schema).max(10));

export const listCampaignsQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  status: csv(z.enum(CAMPAIGN_STATUSES)).optional(),
  client: objectId.optional(),
  attention: z.enum(ATTENTION_FILTERS).optional(), // campaigns with a warning (any / deadline soon / overdue / incomplete deliverables)
  deadlineFrom: day.optional(),
  deadlineTo: day.optional(),
  archived: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  sort: z.string().regex(new RegExp(`^-?(${SORTS.join('|')})$`), 'Unknown sort').default('deadline'),
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

// ---- deliverables
const dFields = {
  title: z.string().trim().min(1, 'Give the deliverable a title').max(LIMITS.title),
  description: text(LIMITS.shortText, 'Description'),
  platform: z.enum(PLATFORMS).nullable(),
  format: z.enum(TYPES).nullable(),
  dueDate: day.nullable(),
  requiresApproval: z.boolean(),
  content: objectId.nullable(),
};
export const createDeliverableSchema = z
  .object({ ...dFields, quantity: z.number().int().min(1).max(LIMITS.bulk, `Create at most ${LIMITS.bulk} at a time`) })
  .partial()
  .required({ title: true })
  .strict()
  .refine((v) => !(v.quantity > 1 && v.content), { message: 'One piece of content can only be linked to one deliverable', path: ['content'] });
export const updateDeliverableSchema = z
  .object({ ...dFields, version: z.number().int().min(0) })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).some((k) => k !== 'version'), 'Provide at least one field to update');
export const transitionDeliverableSchema = z.object({ to: z.enum(DELIVERABLE_STATUSES), note: text(2000, 'Note').optional() }).strict();

export const linkContentSchema = z.object({ contentId: objectId }).strict();
