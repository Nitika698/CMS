import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { env } from './config/env.js';
import routes from './routes.js';
import { notFound, errorHandler } from './middleware/errorHandler.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  if (env.TRUST_PROXY > 0) app.set('trust proxy', env.TRUST_PROXY);

  app.use(helmet());
  app.use(
    cors({
      origin(origin, cb) {
        // Allow same-origin / curl (no Origin header) and the configured browser origins.
        if (!origin || env.clientOrigins.includes(origin)) return cb(null, true);
        cb(null, false);
      },
      credentials: true,
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    }),
  );
  app.use(
    rateLimit({
      windowMs: env.RATE_LIMIT_WINDOW_MS,
      limit: env.RATE_LIMIT_MAX,
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  app.use('/api/v1', routes);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
