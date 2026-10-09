import mongoose from 'mongoose';
import { env } from './env.js';

mongoose.set('strictQuery', true);

const STATES = { 0: 'disconnected', 1: 'connected', 2: 'connecting', 3: 'disconnecting' };

export function getDbState() {
  return STATES[mongoose.connection.readyState] ?? 'unknown';
}

let retryTimer = null;
let stopping = false;

/**
 * Connects to MongoDB. If the database is unreachable the HTTP server keeps running
 * (so /health/ready can report the problem) and we retry in the background.
 */
export async function connectDb() {
  if (stopping) return;
  try {
    await mongoose.connect(env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
    console.log('[db] connected');
  } catch (err) {
    console.error(`[db] connection failed (${err.name}); retrying in ${env.DB_RETRY_SECONDS}s`);
    retryTimer = setTimeout(connectDb, env.DB_RETRY_SECONDS * 1000);
  }
}

mongoose.connection.on('disconnected', () => console.warn('[db] disconnected'));
mongoose.connection.on('reconnected', () => console.log('[db] reconnected'));

export async function disconnectDb() {
  stopping = true;
  clearTimeout(retryTimer);
  await mongoose.disconnect();
}
