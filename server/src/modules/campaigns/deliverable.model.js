import mongoose from 'mongoose';

const deliverableSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    campaign: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', required: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    platform: String,
    dueDate: Date,
    // "submitted" = sent to the client and waiting for their review/approval.
    status: {
      type: String,
      enum: ['pending', 'in_progress', 'submitted', 'changes_requested', 'approved', 'delivered'],
      default: 'pending',
    },
    requiresApproval: { type: Boolean, default: true },
    submittedAt: Date,
  },
  { timestamps: true },
);
deliverableSchema.index({ owner: 1, campaign: 1 });
deliverableSchema.index({ owner: 1, status: 1, dueDate: 1 });

export const Deliverable = mongoose.model('Deliverable', deliverableSchema);
