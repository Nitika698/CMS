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

export const updateProfileSchema = z
  .object({ name: name.optional(), timezone: timezone.optional(), defaultCurrency: currency.optional() })
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field to update');

export const changePasswordSchema = z
  .object({ currentPassword: z.string().min(1, 'Current password is required').max(200), newPassword: password })
  .strict();
