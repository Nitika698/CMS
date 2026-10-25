import { z } from 'zod';

const email = z.string().trim().toLowerCase().email('Enter a valid email address').max(254);

// bcrypt only uses the first 72 BYTES, so longer passwords are rejected rather than silently truncated.
const password = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .refine((p) => Buffer.byteLength(p, 'utf8') <= 72, 'Password must be at most 72 bytes')
  .refine((p) => /\p{L}/u.test(p) && /[\d\p{P}\p{S}]/u.test(p), 'Password must include a letter and a number or symbol');

const name = z.string().trim().min(1, 'Name is required').max(80);

const timezone = z.string().refine((tz) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}, 'Unknown timezone');

const currency = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, 'Use a 3-letter currency code');

// .strict() everywhere: unknown keys (e.g. `role`, `_id`, `passwordHash`) are an error, never silently accepted.
export const registerSchema = z.object({ email, password, name, timezone: timezone.optional() }).strict();

export const loginSchema = z
  .object({ email, password: z.string().min(1, 'Password is required').max(200) })
  .strict();

const reminderMinutes = z
  .array(z.number().int().min(1).max(30 * 24 * 60))
  .max(5, 'At most 5 reminders')
  .transform((l) => [...new Set(l)].sort((a, b) => a - b));

const calendarPrefs = z
  .object({ defaultReminderOffsets: reminderMinutes, deadlineReminderOffsets: reminderMinutes, weekStartsOn: z.union([z.literal(0), z.literal(1), z.literal(6)]) })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one calendar setting');

const bText = (max) => z.string().trim().max(max, `At most ${max} characters`);
const businessProfile = z
  .object({
    businessName: bText(120),
    email: z.union([z.literal(''), z.string().trim().toLowerCase().email('Enter a valid email').max(254)]),
    phone: bText(30),
    website: bText(200),
    address: bText(500),
    taxIdLabel: bText(20),
    taxId: bText(60),
    paymentInstructions: bText(1000),
    invoiceNotes: bText(1000),
    invoicePrefix: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{1,10}$/, 'Use 1-10 letters, numbers or dashes'),
    paymentTermsDays: z.number().int('Whole days only').min(0).max(365),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one business detail');

export const updateProfileSchema = z
  .object({ name: name.optional(), timezone: timezone.optional(), defaultCurrency: currency.optional(), calendarPrefs: calendarPrefs.optional(), businessProfile: businessProfile.optional() })
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field to update');

export const changePasswordSchema = z
  .object({ currentPassword: z.string().min(1, 'Current password is required').max(200), newPassword: password })
  .strict();
