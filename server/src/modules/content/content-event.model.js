import mongoose from 'mongoose';
import { EVENT_TYPES } from './content.constants.js';

const { ObjectId } = mongoose.Schema.Types;

/**
 * Append-only history of meaningful changes to a content item. It is also the single store for review
 * comments and decisions (types: comment | changes_requested | approved), so nothing is duplicated on Content.
 */
const eventSchema = new mongoose.Schema(
  {
    owner: { type: ObjectId, ref: 'User', required: true },
    content: { type: ObjectId, ref: 'Content', required: true },
    type: { type: String, enum: EVENT_TYPES, required: true },
    from: String, // status transitions
    to: String,
    fields: [{ _id: false, field: String, from: mongoose.Schema.Types.Mixed, to: mongoose.Schema.Types.Mixed }],
    comment: { type: String, maxlength: 5000 },
    revision: Number, // content revision at the time of the event
    actor: { type: ObjectId, ref: 'User', required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
eventSchema.index({ owner: 1, content: 1, createdAt: -1 });

export const ContentEvent = mongoose.model('ContentEvent', eventSchema);
