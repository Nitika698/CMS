import mongoose from 'mongoose';

/** Per-user running numbers (invoice numbers). Incremented atomically so two invoices never get the same number. */
const counterSchema = new mongoose.Schema({
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  key: { type: String, required: true },
  seq: { type: Number, default: 0 },
});
counterSchema.index({ owner: 1, key: 1 }, { unique: true });

export const Counter = mongoose.model('Counter', counterSchema);

export async function nextNumber(owner, key) {
  const c = await Counter.findOneAndUpdate({ owner, key }, { $inc: { seq: 1 } }, { new: true, upsert: true });
  return c.seq;
}
