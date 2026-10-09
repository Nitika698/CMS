import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(5001),
  CLIENT_ORIGIN: z.string().default('http://localhost:5173'),
  MONGODB_URI: z
    .string({ required_error: 'MONGODB_URI is required' })
    .regex(/^mongodb(\+srv)?:\/\//, 'MONGODB_URI must start with mongodb:// or mongodb+srv://'),
  DB_RETRY_SECONDS: z.coerce.number().int().positive().default(5),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  // Fail fast with a readable message; never print values (they may be secrets).
  const problems = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  console.error(`Invalid environment configuration:\n${problems}\nSee server/.env.example`);
  process.exit(1);
}

export const env = {
  ...parsed.data,
  isProd: parsed.data.NODE_ENV === 'production',
  clientOrigins: parsed.data.CLIENT_ORIGIN.split(',')
    .map((s) => s.trim())
    .filter(Boolean),
};
