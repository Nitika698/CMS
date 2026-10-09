import mongoose from 'mongoose';

const postSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    content: { type: mongoose.Schema.Types.ObjectId, ref: 'Content', required: true },
    platform: { type: String, enum: ['instagram', 'youtube', 'tiktok', 'x', 'linkedin', 'facebook', 'blog', 'other'], required: true },
    captionOverride: String,
    scheduledAt: Date,
    // "scheduled" only means the app will remind the user. It never means a platform will publish.
    status: {
      type: String,
      enum: ['planned', 'scheduled', 'awaiting_confirmation', 'published', 'missed', 'failed', 'cancelled'],
      default: 'planned',
    },
    publishedAt: Date,
    verification: { type: String, enum: ['none', 'manual', 'platform'], default: 'none' },
    externalPostId: String,
    externalUrl: String,
    failureReason: String,
  },
  { timestamps: true },
);
postSchema.index({ owner: 1, scheduledAt: 1 });
postSchema.index({ owner: 1, content: 1 });

// Honesty invariant (docs/PLAN.md §2.2): a post can only be "published" if someone or something confirmed it.
postSchema.pre('validate', function () {
  if (this.status === 'published') {
    if (!['manual', 'platform'].includes(this.verification)) this.invalidate('verification', 'A published post must be confirmed (manual or platform)');
    if (this.verification === 'platform' && !this.externalPostId) this.invalidate('externalPostId', 'Platform-confirmed posts need an external id');
  }
});

export const Post = mongoose.model('Post', postSchema);
