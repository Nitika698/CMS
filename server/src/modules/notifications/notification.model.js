import mongoose from 'mongoose';

const { ObjectId } = mongoose.Schema.Types;

/** In-app notifications only. (No email or push is configured; the UI says so.) Auto-deleted after 90 days. */
const notificationSchema = new mongoose.Schema(
  {
    owner: { type: ObjectId, ref: 'User', required: true },
    type: { type: String, enum: ['post_reminder', 'post_ready', 'deadline_reminder', 'campaign_deadline', 'followup_reminder', 'task_reminder', 'task_overdue', 'invoice_due', 'invoice_overdue'], required: true },
    title: { type: String, required: true, maxlength: 200 },
    body: { type: String, maxlength: 500 },
    entity: { kind: { type: String, enum: ['post', 'content', 'client', 'campaign', 'task', 'invoice'], required: true }, id: { type: ObjectId, required: true } },
    localDate: String, // YYYY-MM-DD in the user's timezone, so the UI can open the right calendar day
    // One notification per (thing, reminder, scheduled time): sweeps are idempotent and rescheduling re-arms reminders.
    dedupeKey: { type: String, required: true },
    readAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
notificationSchema.index({ owner: 1, dedupeKey: 1 }, { unique: true });
notificationSchema.index({ owner: 1, readAt: 1, createdAt: -1 });
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

export const Notification = mongoose.model('Notification', notificationSchema);

export const toPublicNotification = (n) => ({
  id: String(n._id),
  type: n.type,
  title: n.title,
  body: n.body ?? null,
  entity: { kind: n.entity.kind, id: String(n.entity.id) },
  localDate: n.localDate ?? null,
  read: !!n.readAt,
  createdAt: n.createdAt,
});
