import mongoose from 'mongoose';
import { LIMITS, PLATFORMS, STATUSES, STATUS_RANK, TYPES } from './content.constants.js';

const { ObjectId } = mongoose.Schema.Types;

const contentSchema = new mongoose.Schema(
  {
    owner: { type: ObjectId, ref: 'User', required: true },
    title: { type: String, required: true, trim: true, maxlength: LIMITS.titleLen },
    description: { type: String, maxlength: LIMITS.textLen },
    type: { type: String, enum: TYPES, default: 'post' },
    status: { type: String, enum: STATUSES, default: 'idea' },
    statusRank: { type: Number, default: 0 }, // derived from status so lists can sort by workflow order
    category: { type: ObjectId, ref: 'Category', default: null },
    platforms: [{ type: String, enum: PLATFORMS }],
    tags: [{ type: String, lowercase: true, trim: true, maxlength: 30 }],
    campaign: { type: ObjectId, ref: 'Campaign', default: null },

    caption: { type: String, maxlength: LIMITS.textLen },
    hashtags: [{ type: String, maxlength: 50 }],
    brief: { type: String, maxlength: LIMITS.textLen }, // creative brief

    // Planned publication date vs. the date the content must be finished by.
    plannedDate: Date,
    deadline: Date,

    // Publication is declared by the user ("I posted this"), never inferred. See publishedVerification.
    publishedAt: Date,
    publishedUrl: { type: String, maxlength: 2000 },
    publishedVerification: { type: String, enum: ['manual'], default: undefined },

    // Review workflow. `revision` counts how many times the content was sent back for changes.
    revision: { type: Number, default: 0, min: 0 },
    approval: {
      approvedAt: Date,
      approvedBy: { type: ObjectId, ref: 'User' },
      approverName: { type: String, maxlength: 120 }, // e.g. the client contact who signed off
      revision: Number,
    },

    archivedAt: { type: Date, default: null },
  },
  { timestamps: true, optimisticConcurrency: true },
);

contentSchema.index({ owner: 1, archivedAt: 1, status: 1, updatedAt: -1 });
contentSchema.index({ owner: 1, category: 1 });
contentSchema.index({ owner: 1, campaign: 1 });
contentSchema.index({ owner: 1, deadline: 1 });
contentSchema.index({ owner: 1, tags: 1 });

contentSchema.pre('validate', function () {
  this.statusRank = STATUS_RANK[this.status] ?? 0;
  if (this.plannedDate && this.deadline && this.deadline > this.plannedDate) {
    this.invalidate('deadline', 'Deadline must be on or before the planned date');
  }
});

export const Content = mongoose.model('Content', contentSchema);
