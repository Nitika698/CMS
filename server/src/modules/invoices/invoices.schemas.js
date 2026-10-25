import { z } from 'zod';
import { DISPLAY_STATUSES, LIMITS, PAYMENT_KINDS, PAYMENT_METHODS, SORTS } from './invoice.constants.js';

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');
const emptyToNull = (v) => (v === '' ? null : v);
const text = (max, label = 'Text') => z.string().trim().max(max, `${label} is at most ${max} characters`).transform(emptyToNull).nullable();

/** A calendar day, "YYYY-MM-DD", turned into local midnight in the user's timezone by the service. */
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-10-31')
  .refine((s) => {
    const [y, m, d] = s.split('-').map(Number);
    const t = new Date(Date.UTC(y, m - 1, d));
    return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
  }, 'That date does not exist');

const minor = z.number().int('Amounts are whole minor units (e.g. cents)').min(0, 'Cannot be negative').max(LIMITS.money, 'That amount is too large');
const currency = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, 'Use a 3-letter currency code');

const lineItem = z
  .object({
    description: z.string().trim().min(1, 'Describe what this line is for').max(LIMITS.description, `At most ${LIMITS.description} characters`),
    quantity: z.number().gt(0, 'Quantity must be more than 0').max(LIMITS.quantity).refine((n) => Math.abs(Math.round(n * 1000) - n * 1000) < 1e-6, 'At most 3 decimal places'),
    unitAmountMinor: minor,
    taxRatePct: z.number().min(0, 'Tax cannot be negative').max(100, 'Tax is at most 100%').refine((n) => Math.abs(Math.round(n * 100) - n * 100) < 1e-6, 'At most 2 decimal places').default(0),
  })
  .strict();
const lineItems = z.array(lineItem).max(LIMITS.items, `At most ${LIMITS.items} lines`);

const fields = {
  client: objectId,
  campaign: objectId.nullable(),
  number: z.string().trim().min(1, 'Number is required').max(LIMITS.number).regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/, 'Use letters, numbers and . _ / - only'),
  currency,
  issueDate: day.nullable(),
  dueDate: day.nullable(),
  lineItems,
  notes: text(LIMITS.notes, 'Notes'),
  billToAddress: text(LIMITS.address, 'Billing address'),
};

const datesInOrder = (v) => !(v.issueDate && v.dueDate && v.dueDate < v.issueDate);
const datesMsg = { message: 'The due date cannot be before the issue date', path: ['dueDate'] };

// .strict(): owner, status, totals, paid amounts, issuer copies ... can never be set through create/edit.
export const createInvoiceSchema = z.object(fields).partial().required({ client: true }).strict().refine(datesInOrder, datesMsg);
export const updateInvoiceSchema = z
  .object({ ...fields, version: z.number().int().min(0) })
  .partial()
  .strict()
  .refine(datesInOrder, datesMsg)
  .refine((v) => Object.keys(v).some((k) => k !== 'version'), 'Provide at least one field to update');

export const issueInvoiceSchema = z.object({ issueDate: day.optional(), dueDate: day.nullable().optional() }).strict().refine(datesInOrder, datesMsg);
export const cancelInvoiceSchema = z.object({ reason: text(300, 'Reason').optional() }).strict();

const paymentFields = {
  amountMinor: minor.refine((n) => n >= 1, 'Enter an amount above zero'),
  paidOn: day,
  kind: z.enum(PAYMENT_KINDS),
  method: z.enum(PAYMENT_METHODS).nullable(),
  reference: text(LIMITS.reference, 'Reference'),
  notes: text(LIMITS.paymentNote, 'Notes'),
  currency, // optional; if present it must match the invoice
};
export const createPaymentSchema = z.object(paymentFields).partial().required({ amountMinor: true }).strict();
export const updatePaymentSchema = z
  .object(paymentFields)
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field to update');

const csv = (schema) => z.string().transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean)).pipe(z.array(schema).max(10));

export const listInvoicesQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  status: csv(z.enum(DISPLAY_STATUSES)).optional(),
  client: objectId.optional(),
  campaign: objectId.optional(),
  currency: currency.optional(),
  dueFrom: day.optional(),
  dueTo: day.optional(),
  sort: z.string().regex(new RegExp(`^-?(${SORTS.join('|')})$`), 'Unknown sort').default('-issueDate'),
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const contextQuerySchema = z.object({ campaign: objectId });
