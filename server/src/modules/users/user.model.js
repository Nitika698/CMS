import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 254 },
    // select:false => never loaded unless explicitly requested with .select('+passwordHash')
    passwordHash: { type: String, required: true, select: false },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    timezone: { type: String, default: 'UTC' },
    defaultCurrency: { type: String, default: 'USD', uppercase: true, match: /^[A-Z]{3}$/ },
    failedLoginCount: { type: Number, default: 0, select: false },
    lockedUntil: { type: Date, default: null, select: false },
    lastLoginAt: { type: Date, default: null },
  },
  { timestamps: true },
);

/** The ONLY shape in which a user is ever sent to a client. Allow-list, not block-list. */
export function toPublicUser(u) {
  return {
    id: String(u._id),
    email: u.email,
    name: u.name,
    timezone: u.timezone,
    defaultCurrency: u.defaultCurrency,
    lastLoginAt: u.lastLoginAt,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
  };
}

export const User = mongoose.model('User', userSchema);
