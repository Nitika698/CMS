import mongoose from 'mongoose';
import { PLATFORMS } from '../content/content.constants.js';
import { ACTIVE_STATUSES, MAX_REMINDERS, MAX_REMINDER_MINUTES, POST_STATUSES } from './post.constants.js';

const { ObjectId } = mongoose.Schema.Types;

/**
 * One planned / scheduled / published appearance of a content item on ONE platform.
 * Content is the idea; a Post is where and when it goes. Every post is linked to its content.
 */
const postSchema = new mongoose.Schema(
  {
    owner: { type: ObjectId, ref: 'User', required: true },
    content: { type: ObjectId, ref: 'Content', required: true },
    platform: { type: String, enum: PLATFORMS, required: true },
    captionOverride: { type: String, maxlength: 20_000 },

    // Always a UTC instant. `scheduledTimezone` records the user's zone when it was set (for display and audit).
    scheduledAt: Date,
    scheduledTimezone: String,
    // "scheduled" only means the app will remind the user. It never means a platform will publish.
    status: { type: String, enum: POST_STATUSES, default: 'planned' },
    // Minutes BEFORE scheduledAt at which to remind (in-app). The "time has come" notice always fires at the time itself.
    reminderOffsets: {
      type: [{ type: Number, min: 1, max: MAX_REMINDER_MINUTES, validate: Number.isInteger }],
      default: [],
      validate: [(v) => v.length <= MAX_REMINDERS && new Set(v).size === v.length, `At most ${MAX_REMINDERS} different reminders`],
    },
    readyAt: Date,
    statusChangedAt: Date,

    publishedAt: Date,
    verification: { type: String, enum: ['none', 'manual', 'platform'], default: 'none' },
    externalPostId: String,
    externalUrl: String,
    publishedUrl: { type: String, maxlength: 2000 },
    failureReason: String,

    active: { type: Boolean, default: true }, // derived from status; backs the "no duplicate slot" unique index
  },
  { timestamps: true, optimisticConcurrency: true },
);

postSchema.index({ owner: 1, scheduledAt: 1 });
postSchema.index({ owner: 1, content: 1 });
postSchema.index({ status: 1, scheduledAt: 1 }); // reminder sweep
// A content item can occupy a platform only once at a time. Finished posts (published/cancelled/missed/failed) free the slot.
postSchema.index({ owner: 1, content: 1, platform: 1 }, { unique: true, partialFilterExpression: { active: true } });

postSchema.pre('validate', function () {
  this.active = ACTIVE_STATUSES.includes(this.status);
  // Honesty invariant (docs/PLAN.md section 2.2): a post can only be "published" if someone or something confirmed it.
  if (this.status === 'published') {
    if (!['manual', 'platform'].includes(this.verification)) this.invalidate('verification', 'A published post must be confirmed (manual or platform)');
    if (this.verification === 'platform' && !this.externalPostId) this.invalidate('externalPostId', 'Platform-confirmed posts need an external id');
  }
  if (this.status === 'scheduled' && !this.scheduledAt) this.invalidate('scheduledAt', 'A scheduled reminder needs a date and time');
});

export const Post = mongoose.model('Post', postSchema);
