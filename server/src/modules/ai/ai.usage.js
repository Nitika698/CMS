import mongoose from 'mongoose';
import { AppError } from '../../lib/errors.js';

/** One row per user per UTC day: how many AI requests and tokens were used. This is what the daily cap and cost tracking read. */
const usageSchema = new mongoose.Schema({
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  day: { type: String, required: true }, // YYYY-MM-DD (UTC)
  requests: { type: Number, default: 0 },
  inputTokens: { type: Number, default: 0 },
  outputTokens: { type: Number, default: 0 },
  expireAt: { type: Date, required: true },
});
usageSchema.index({ owner: 1, day: 1 }, { unique: true });
usageSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });

export const AiUsage = mongoose.model('AiUsage', usageSchema);

const dayOf = (now) => now.toISOString().slice(0, 10);

/** Counts one request against the user's daily cap, atomically. Throws 429 once the cap is reached. */
export async function reserveRequest(owner, limit, now = new Date()) {
  const day = dayOf(now);
  try {
    await AiUsage.findOneAndUpdate(
      { owner, day, requests: { $lt: limit } },
      { $inc: { requests: 1 }, $setOnInsert: { expireAt: new Date(now.getTime() + 40 * 86_400_000) } },
      { upsert: true, new: true },
    );
  } catch (err) {
    // The upsert collides with the existing row when the cap is already reached.
    if (err.code === 11000) throw new AppError(429, 'AI_QUOTA_EXCEEDED', `You have used today's ${limit} AI requests. The limit resets at midnight UTC.`, { limit });
    throw err;
  }
}

export const recordTokens = (owner, usage, now = new Date()) =>
  AiUsage.updateOne({ owner, day: dayOf(now) }, { $inc: { inputTokens: usage.inputTokens ?? 0, outputTokens: usage.outputTokens ?? 0 } }).catch(() => {});

export async function usageToday(owner, now = new Date()) {
  const row = await AiUsage.findOne({ owner, day: dayOf(now) }).lean();
  return { requests: row?.requests ?? 0, inputTokens: row?.inputTokens ?? 0, outputTokens: row?.outputTokens ?? 0 };
}
