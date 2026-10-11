import { AppError } from '../../lib/errors.js';
import { isObjectId, notFound } from '../../lib/scoped.js';
import { Notification, toPublicNotification } from './notification.model.js';

export async function listNotifications(userId, { unreadOnly = false, limit = 20 } = {}) {
  const where = { owner: userId, ...(unreadOnly && { readAt: null }) };
  const [rows, unread] = await Promise.all([
    Notification.find(where).sort({ createdAt: -1, _id: -1 }).limit(limit).lean(),
    Notification.countDocuments({ owner: userId, readAt: null }),
  ]);
  return { data: rows.map(toPublicNotification), meta: { unread } };
}

export async function markRead(userId, id) {
  if (!isObjectId(String(id))) throw notFound('Notification');
  const n = await Notification.findOneAndUpdate({ _id: id, owner: userId, readAt: null }, { readAt: new Date() }, { new: true });
  if (n) return toPublicNotification(n);
  const existing = await Notification.findOne({ _id: id, owner: userId });
  if (!existing) throw notFound('Notification');
  return toPublicNotification(existing); // already read: idempotent
}

export async function markAllRead(userId) {
  const res = await Notification.updateMany({ owner: userId, readAt: null }, { readAt: new Date() });
  return { updated: res.modifiedCount };
}

/** Creates a notification unless this exact one (same dedupeKey) was already sent. Returns true if it is new. */
export async function notifyOnce(n) {
  try {
    await Notification.create(n);
    return true;
  } catch (err) {
    if (err.code === 11000) return false;
    throw err;
  }
}

export { AppError };
