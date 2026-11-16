import mongoose from 'mongoose';
import { env } from './env.js';
import { log } from '../lib/logger.js';

mongoose.set('strictQuery', true);
mongoose.set('autoIndex', env.dbAutoIndex);

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
    log.info('db connected');
  } catch (err) {
    log.error('db connection failed, retrying', { name: err.name, retryInSeconds: env.DB_RETRY_SECONDS });
    retryTimer = setTimeout(connectDb, env.DB_RETRY_SECONDS * 1000);
  }
}

mongoose.connection.on('disconnected', () => log.warn('db disconnected'));
mongoose.connection.on('reconnected', () => log.info('db reconnected'));

export async function disconnectDb() {
  stopping = true;
  clearTimeout(retryTimer);
  await mongoose.disconnect();
}
