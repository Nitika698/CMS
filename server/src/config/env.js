import { z } from 'zod';

const bool = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true')
  .optional();

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(5001),
    CLIENT_ORIGIN: z.string().default('http://localhost:5173'),
    // Number of reverse proxies in front of the API (needed for correct client IPs / rate limits).
    TRUST_PROXY: z.coerce.number().int().min(0).default(0),
    MONGODB_URI: z
      .string({ required_error: 'MONGODB_URI is required' })
      .regex(/^mongodb(\+srv)?:\/\//, 'MONGODB_URI must start with mongodb:// or mongodb+srv://'),
    DB_RETRY_SECONDS: z.coerce.number().int().positive().default(5),
    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),

    // --- Authentication ---
    JWT_ACCESS_SECRET: z
      .string({ required_error: 'JWT_ACCESS_SECRET is required' })
      .min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
    ACCESS_TOKEN_TTL_MINUTES: z.coerce.number().int().min(1).max(60).default(15),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
    COOKIE_SECURE: bool, // defaults to true in production
    BCRYPT_COST: z.coerce.number().int().min(4).max(15).default(12),
    MAX_FAILED_LOGINS: z.coerce.number().int().min(3).default(5),
    LOCKOUT_MINUTES: z.coerce.number().int().min(1).default(15),
    AUTH_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(15 * 60_000),
    AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),

    // --- Calendar ---
    CALENDAR_CONFLICT_WINDOW_MINUTES: z.coerce.number().int().min(0).max(1440).default(30),
    REMINDER_SWEEP_SECONDS: z.coerce.number().int().min(5).max(3600).default(60),

    // --- Media storage ---
    STORAGE_PROVIDER: z.enum(['local', 'cloudinary']).default('local'),
    UPLOAD_DIR: z.string().min(1).default('uploads'), // local provider only; resolved against the server working directory
    MAX_UPLOAD_IMAGE_MB: z.coerce.number().positive().default(10),
    MAX_UPLOAD_VIDEO_MB: z.coerce.number().positive().default(100),
    MAX_UPLOAD_DOC_MB: z.coerce.number().positive().default(20),
    MAX_ASSETS_PER_CONTENT: z.coerce.number().int().positive().default(20),
    ASSET_TOKEN_TTL_SECONDS: z.coerce.number().int().min(10).max(3600).default(300),
    UPLOAD_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(60),
    CLOUDINARY_CLOUD_NAME: z.string().optional(),
    CLOUDINARY_API_KEY: z.string().optional(),
    CLOUDINARY_API_SECRET: z.string().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.STORAGE_PROVIDER === 'cloudinary') {
      for (const k of ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET']) {
        if (!v[k]) ctx.addIssue({ code: 'custom', path: [k], message: 'is required when STORAGE_PROVIDER=cloudinary' });
      }
    }
    if (v.NODE_ENV === 'production' && v.STORAGE_PROVIDER === 'local') {
      ctx.addIssue({ code: 'custom', path: ['STORAGE_PROVIDER'], message: 'local disk storage is for development only; use cloudinary in production' });
    }
    if (v.NODE_ENV === 'production' && /change-me|example|secret/i.test(v.JWT_ACCESS_SECRET)) {
      ctx.addIssue({ code: 'custom', path: ['JWT_ACCESS_SECRET'], message: 'must be a real random secret in production' });
    }
  });

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  // Fail fast with a readable message; never print values (they may be secrets).
  const problems = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  console.error(`Invalid environment configuration:\n${problems}\nSee server/.env.example`);
  process.exit(1);
}

const isProd = parsed.data.NODE_ENV === 'production';

export const env = {
  ...parsed.data,
  isProd,
  LOG_LEVEL: parsed.data.LOG_LEVEL ?? (parsed.data.NODE_ENV === 'test' ? 'silent' : 'info'),
  dbAutoIndex: parsed.data.DB_AUTO_INDEX ?? !isProd,
  cookieSecure: parsed.data.COOKIE_SECURE ?? isProd,
  clientOrigins: parsed.data.CLIENT_ORIGIN.split(',')
    .map((s) => s.trim())
    .filter(Boolean),
};
