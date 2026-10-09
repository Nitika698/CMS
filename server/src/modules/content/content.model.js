import mongoose from 'mongoose';

// Schema foundation from docs/PLAN.md. CRUD endpoints arrive in roadmap P2; the dashboard only reads.
const contentSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    type: { type: String, enum: ['reel', 'short', 'video', 'story', 'carousel', 'post', 'blog', 'podcast', 'other'], default: 'post' },
    // Workflow stage of the idea itself. "scheduled"/"published" are NOT stored here: they are derived from Posts.
    status: { type: String, enum: ['idea', 'drafting', 'ready'], default: 'idea' },
    category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', default: null },
    tags: [{ type: String, lowercase: true, trim: true }],
    script: String,
    caption: String,
    hashtags: [String],
    notes: String,
    archivedAt: { type: Date, default: null },
  },
  { timestamps: true },
);
contentSchema.index({ owner: 1, status: 1, updatedAt: -1 });

export const Content = mongoose.model('Content', contentSchema);
