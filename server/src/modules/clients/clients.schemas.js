import { z } from 'zod';
import { CHANNELS, CLIENT_STATUSES, CLIENT_TYPES, COMMUNICATION_CHANNELS, DIRECTIONS, LIMITS, RATE_UNITS, SORTS, SOCIAL_PLATFORMS } from './clients.constants.js';

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');
const emptyToNull = (v) => (v === '' ? null : v);
/** An empty string means "clear it"; anything else must be valid. Keeps the specific error message of `schema`. */
const blankToNull = (schema) => z.preprocess(emptyToNull, schema.nullable());

/** Trimmed text; an empty string means "clear it". */
const text = (max, label = 'Text') => z.string().trim().max(max, `${label} is at most ${max} characters`).transform(emptyToNull).nullable();

// ---- links
const httpUrl = (message = 'Enter a valid web address') =>
  z
    .string()
    .trim()
    .max(500)
    .transform((s) => (/^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`)) // "brand.com" -> "https://brand.com"
    .refine((s) => {
      try {
        const u = new URL(s);
        return ['http:', 'https:'].includes(u.protocol) && u.hostname.includes('.') && !/\s/.test(s);
      } catch {
        return false;
      }
    }, message);

const website = blankToNull(httpUrl('Enter a valid website, e.g. https://brand.com'));
const socialLink = z.object({ platform: z.enum(SOCIAL_PLATFORMS), url: httpUrl('Enter a valid link for this profile') }).strict();
const socialLinks = z
  .array(socialLink)
  .max(LIMITS.socialLinks, `At most ${LIMITS.socialLinks} social links`)
  .transform((l) => {
    // Keep the FIRST occurrence when two links are the same address once trailing slashes and case are ignored.
    const seen = new Set();
    return l.filter((x) => {
      const key = x.url.toLowerCase().replace(/\/$/, '');
      return seen.has(key) ? false : seen.add(key);
    });
  });

// ---- people
const email = z.string().trim().toLowerCase().email('Enter a valid email address').max(254);
const phone = z
  .string()
  .trim()
  .regex(/^\+?[\d\s().-]{6,30}$/, 'Enter a valid phone number (digits, spaces, + ( ) - .)');

const contact = z
  .object({
    id: objectId.optional(), // an existing contact keeps its identity (saved discussions point at it)
    name: z.string().trim().min(1, 'Contact name is required').max(LIMITS.name),
    role: text(80, 'Role').optional(),
    email: blankToNull(email).optional(),
    phone: blankToNull(phone).optional(),
    isPrimary: z.boolean().optional(),
  })
  .strict();
const contacts = z
  .array(contact)
  .max(LIMITS.contacts, `At most ${LIMITS.contacts} contacts`)
  .refine((l) => l.filter((c) => c.isPrimary).length <= 1, 'Only one contact can be the primary contact');

// ---- money and terms
const currency = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, 'Use a 3-letter currency code');
const rate = z
  .object({
    label: z.string().trim().min(1, 'Describe what this rate is for').max(80),
    amountMinor: z.number().int('Amounts are whole minor units (e.g. cents)').min(0).max(1_000_000_000_000),
    currency,
    unit: z.enum(RATE_UNITS).default('per_post'),
    notes: text(300, 'Notes').optional(),
  })
  .strict();
const rates = z.array(rate).max(LIMITS.rates, `At most ${LIMITS.rates} rates`);

const dateInput = z
  .union([z.string().datetime({ offset: true }), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)], { errorMap: () => ({ message: 'Use a valid date' }) })
  .transform((s) => new Date(`${s.slice(0, 10)}T00:00:00.000Z`)) // a follow-up is a DATE, kept at 00:00 UTC
  .refine((d) => !Number.isNaN(d.getTime()), 'Use a valid date');

const fields = {
  name: z.string().trim().min(1, 'Brand name is required').max(LIMITS.name),
  type: z.enum(CLIENT_TYPES),
  status: z.enum(CLIENT_STATUSES),
  website,
  socialLinks,
  industry: text(80, 'Industry'),
  category: text(60, 'Category'),
  contacts,
  contactPreferences: z
    .object({
      channel: z.enum(CHANNELS).nullable().optional(),
      bestTime: text(200, 'Best time').optional(),
      notes: text(LIMITS.shortText, 'Notes').optional(),
    })
    .strict(),
  collaborationNotes: text(LIMITS.longText, 'Notes'),
  rates,
  defaultCurrency: blankToNull(currency),
  paymentTermsDays: z.number().int('Whole days only').min(0).max(365).nullable(),
  terms: z
    .object({
      exclusivity: text(LIMITS.shortText, 'Exclusivity').optional(),
      usageRights: text(LIMITS.shortText, 'Usage rights').optional(),
      other: text(2000, 'Other terms').optional(),
    })
    .strict(),
  followUpAt: dateInput.nullable(),
  followUpNote: text(200, 'Follow-up note'),
};

// .strict(): owner, archivedAt, nameLower, _id ... can never be set by a client.
export const createClientSchema = z.object(fields).partial().required({ name: true }).strict();
export const updateClientSchema = z
  .object({ ...fields, version: z.number().int().min(0) })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).some((k) => k !== 'version'), 'Provide at least one field to update');

const csv = (schema) => z.string().transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean)).pipe(z.array(schema).max(10));

export const listClientsQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  status: csv(z.enum(CLIENT_STATUSES)).optional(),
  type: csv(z.enum(CLIENT_TYPES)).optional(),
  category: z.string().trim().max(60).optional(),
  industry: z.string().trim().max(80).optional(),
  followUp: z.enum(['overdue', 'upcoming', 'none']).optional(),
  archived: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  sort: z.string().regex(new RegExp(`^-?(${SORTS.join('|')})$`), 'Unknown sort').default('name'),
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const instant = z
  .string()
  .datetime({ offset: true, message: 'Use a full date-time with a time zone offset (or send occurredLocal)' })
  .transform((s) => new Date(s));
const local = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'Use YYYY-MM-DDTHH:mm (your local time)');
const oneTime = (v) => !(v.occurredAt !== undefined && v.occurredLocal !== undefined);
const oneTimeMsg = { message: 'Send either occurredAt or occurredLocal, not both', path: ['occurredLocal'] };

const discussionFields = {
  channel: z.enum(COMMUNICATION_CHANNELS),
  direction: z.enum(DIRECTIONS),
  occurredAt: instant,
  occurredLocal: local,
  subject: text(200, 'Subject'),
  body: text(LIMITS.longText, 'Notes'),
  campaign: objectId.nullable(),
  contactId: objectId.nullable(),
};

export const createDiscussionSchema = z
  .object(discussionFields)
  .partial()
  .required({ channel: true, direction: true })
  .strict()
  .refine(oneTime, oneTimeMsg)
  .refine((v) => v.subject || v.body, { message: 'Add a subject or some notes', path: ['subject'] });

export const updateDiscussionSchema = z
  .object(discussionFields)
  .partial()
  .strict()
  .refine(oneTime, oneTimeMsg)
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field to update');

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
export const listDiscussionsQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  channel: csv(z.enum(COMMUNICATION_CHANNELS)).optional(),
  direction: z.enum(DIRECTIONS).optional(),
  campaign: objectId.optional(),
  from: ymd.optional(), // local calendar dates in the user's timezone, inclusive
  to: ymd.optional(),
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
/** Same filters across every brand, with an optional single brand. */
export const listAllDiscussionsQuerySchema = listDiscussionsQuerySchema.extend({ client: objectId.optional() });

