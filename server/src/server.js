import { env } from './config/env.js';
import { connectDb, disconnectDb } from './config/db.js';
import { createApp } from './app.js';
import { log } from './lib/logger.js';
import { startJobs } from './jobs/index.js';

const app = createApp();
const server = app.listen(env.PORT, () => {
  log.info('api listening', { port: env.PORT, environment: env.NODE_ENV });
});

connectDb();
const stopJobs = startJobs();

function shutdown(signal) {
  log.info('shutting down', { signal });
  stopJobs();
  server.close(async () => {
    await disconnectDb();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
