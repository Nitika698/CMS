import { env } from './config/env.js';
import { connectDb, disconnectDb } from './config/db.js';
import { createApp } from './app.js';
import { startJobs } from './jobs/index.js';

const app = createApp();
const server = app.listen(env.PORT, () => {
  console.log(`[api] listening on http://localhost:${env.PORT} (${env.NODE_ENV})`);
});

connectDb();
const stopJobs = startJobs();

function shutdown(signal) {
  console.log(`[api] ${signal} received, shutting down`);
  stopJobs();
  server.close(async () => {
    await disconnectDb();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
