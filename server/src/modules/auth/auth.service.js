import bcrypt from 'bcryptjs';
import { env } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';
import { hashToken, newRefreshToken, signAccessToken } from '../../lib/tokens.js';
import { User } from '../users/user.model.js';
import { Session } from './session.model.js';

const REFRESH_RACE_WINDOW_MS = 10_000;
const day = 24 * 60 * 60 * 1000;
const refreshExpiry = () => new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * day);
const invalidCredentials = () => new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');

// Compared against when the email is unknown so response time doesn't reveal which emails exist.
const DUMMY_HASH = bcrypt.hashSync('timing-equaliser', env.BCRYPT_COST);

const hashPassword = (p) => bcrypt.hash(p, env.BCRYPT_COST);

async function startSession(user, meta) {
  const { token, hash } = newRefreshToken();
  const session = await Session.create({
    user: user._id,
    currentHash: hash,
    lastUsedAt: new Date(),
    expiresAt: refreshExpiry(),
    userAgent: meta.userAgent?.slice(0, 200),
    ip: meta.ip,
  });
  return {
    refreshToken: token,
    accessToken: signAccessToken({ userId: user._id, sessionId: session._id }),
  };
}

export async function register({ email, password, name, timezone }, meta) {
  const passwordHash = await hashPassword(password);
  let user;
  try {
    user = await User.create({ email, passwordHash, name, ...(timezone && { timezone }), lastLoginAt: new Date() });
  } catch (err) {
    if (err.code === 11000) throw new AppError(409, 'EMAIL_TAKEN', 'An account with this email already exists');
    throw err;
  }
  return { user, ...(await startSession(user, meta)) };
}

export async function login({ email, password }, meta) {
  const user = await User.findOne({ email }).select('+passwordHash +failedLoginCount +lockedUntil');

  if (!user) {
    await bcrypt.compare(password, DUMMY_HASH);
    throw invalidCredentials();
  }

  // Locked accounts get the same generic error and we skip the password check entirely.
  if (user.lockedUntil && user.lockedUntil > new Date()) throw invalidCredentials();

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    const failed = (user.failedLoginCount ?? 0) + 1;
    const lock = failed >= env.MAX_FAILED_LOGINS;
    await User.updateOne(
      { _id: user._id },
      lock
        ? { failedLoginCount: 0, lockedUntil: new Date(Date.now() + env.LOCKOUT_MINUTES * 60_000) }
        : { failedLoginCount: failed },
    );
    throw invalidCredentials();
  }

  await User.updateOne({ _id: user._id }, { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() });
  const fresh = await User.findById(user._id);
  return { user: fresh, ...(await startSession(fresh, meta)) };
}

/**
 * Rotates the refresh token. A token that was already rotated away and is replayed later is treated as
 * theft: the whole session is revoked. A replay within a few seconds is a benign multi-tab race (409, retry).
 */
export async function refresh(rawToken) {
  if (!rawToken) throw new AppError(401, 'UNAUTHENTICATED', 'No session');
  const oldHash = hashToken(rawToken);
  const { token, hash } = newRefreshToken();
  const now = new Date();

  const session = await Session.findOneAndUpdate(
    { currentHash: oldHash, revokedAt: null, expiresAt: { $gt: now } },
    { currentHash: hash, previousHash: oldHash, rotatedAt: now, lastUsedAt: now, expiresAt: refreshExpiry() },
    { new: true },
  );

  if (!session) {
    const replayed = await Session.findOne({ previousHash: oldHash, revokedAt: null });
    if (replayed) {
      if (replayed.rotatedAt && now - replayed.rotatedAt < REFRESH_RACE_WINDOW_MS) {
        throw new AppError(409, 'REFRESH_CONFLICT', 'Session was just refreshed; retry');
      }
      await Session.updateOne({ _id: replayed._id }, { revokedAt: now });
    }
    throw new AppError(401, 'SESSION_EXPIRED', 'Your session has expired. Please sign in again.');
  }

  const user = await User.findById(session.user);
  if (!user) {
    await Session.updateOne({ _id: session._id }, { revokedAt: now });
    throw new AppError(401, 'SESSION_EXPIRED', 'Your session has expired. Please sign in again.');
  }
  return { user, refreshToken: token, accessToken: signAccessToken({ userId: user._id, sessionId: session._id }) };
}

export async function logout(rawToken) {
  if (!rawToken) return;
  await Session.updateOne({ currentHash: hashToken(rawToken), revokedAt: null }, { revokedAt: new Date() });
}

export async function logoutAll(userId) {
  await Session.updateMany({ user: userId, revokedAt: null }, { revokedAt: new Date() });
}

export async function changePassword(userId, sessionId, { currentPassword, newPassword }) {
  const user = await User.findById(userId).select('+passwordHash');
  if (!user || !(await bcrypt.compare(currentPassword, user.passwordHash))) {
    throw new AppError(400, 'INVALID_CURRENT_PASSWORD', 'Current password is incorrect');
  }
  user.passwordHash = await hashPassword(newPassword);
  await user.save();
  // Sign out every OTHER device; keep this one.
  await Session.updateMany({ user: userId, _id: { $ne: sessionId }, revokedAt: null }, { revokedAt: new Date() });
}
