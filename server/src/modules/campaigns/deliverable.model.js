import mongoose from 'mongoose';
import { PLATFORMS, TYPES } from '../content/content.constants.js';
import { DELIVERABLE_STATUSES, LIMITS } from './campaign.constants.js';

const { ObjectId } = mongoose.Schema.Types;

/** One piece of work promised to the brand (a single reel, a single story...). Progress is computed from these, never typed in. */
const deliverableSchema = new mongoose.Schema(
  {
    owner: { type: ObjectId, ref: 'User', required: true },
    campaign: { type: ObjectId, ref: 'Campaign', required: true },
    title: { type: String, required: true, trim: true, maxlength: LIMITS.title },
    description: { type: String, maxlength: LIMITS.shortText },
    platform: { type: String, enum: [...PLATFORMS, null] },
    format: { type: String, enum: [...TYPES, null] },
    dueDate: Date,
    // pending = planned; "submitted" = sent to the client and waiting for their review/approval; "delivered" = published/handed over.
    status: { type: String, enum: DELIVERABLE_STATUSES, default: 'pending' },
    requiresApproval: { type: Boolean, default: true },
    content: { type: ObjectId, ref: 'Content', default: null },
    feedback: { type: String, maxlength: 2000 }, // the latest "changes requested" note
    revisionCount: { type: Number, default: 0, min: 0 },
    completedAt: Date,
    submittedAt: Date,
    approvedAt: Date,
    deliveredAt: Date,
  },
  { timestamps: true, optimisticConcurrency: true },
);
deliverableSchema.index({ owner: 1, campaign: 1 });
deliverableSchema.index({ owner: 1, status: 1, dueDate: 1 });
deliverableSchema.index({ owner: 1, content: 1 });

export const Deliverable = mongoose.model('Deliverable', deliverableSchema);
