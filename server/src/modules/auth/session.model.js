import mongoose from 'mongoose';

/**
 * One document per login (device). The refresh token rotates inside it:
 * we keep the hash of the current token and of the one just replaced, which lets us
 * detect a stolen-and-replayed token (reuse) and kill the session.
 */
const sessionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    currentHash: { type: String, required: true, unique: true },
    previousHash: { type: String, index: true, sparse: true },
    rotatedAt: Date,
    lastUsedAt: Date,
    expiresAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } }, // TTL cleanup
    revokedAt: { type: Date, default: null },
    userAgent: { type: String, maxlength: 200 },
    ip: String,
  },
  { timestamps: true },
);

export const Session = mongoose.model('Session', sessionSchema);
