import mongoose from 'mongoose';
import { PLATFORMS, TYPES } from '../content/content.constants.js';
import { CAMPAIGN_STATUSES, LIMITS } from './campaign.constants.js';

const { ObjectId } = mongoose.Schema.Types;
// Money is stored in MINOR units (e.g. cents/paise) + ISO currency, per docs/PLAN.md D7.
const money = new mongoose.Schema(
  { amountMinor: { type: Number, min: 0, validate: Number.isInteger }, currency: { type: String, uppercase: true, match: /^[A-Z]{3}$/ } },
  { _id: false },
);

const campaignSchema = new mongoose.Schema(
  {
    owner: { type: ObjectId, ref: 'User', required: true },
    client: { type: ObjectId, ref: 'Client', required: true },
    title: { type: String, required: true, trim: true, maxlength: LIMITS.title },
    brief: { type: String, maxlength: LIMITS.text },
    objectives: [{ type: String, trim: true, maxlength: LIMITS.objectiveLen }],
    status: { type: String, enum: CAMPAIGN_STATUSES, default: 'proposed' },
    // Dates are calendar days stored as local midnight in the owner's timezone (same convention as deliverable due dates).
    startDate: Date,
    endDate: Date,
    deadline: Date, // the day the work must be handed over by
    budget: { type: money, default: undefined },
    fee: { type: money, default: undefined }, // the agreed fee
    // What the brand asked for, e.g. 3 Instagram reels + 5 Instagram stories. Actual deliverables are tracked separately.
    requirements: [
      {
        platform: { type: String, enum: PLATFORMS, required: true },
        format: { type: String, enum: TYPES, required: true },
        quantity: { type: Number, min: 1, max: LIMITS.quantity, default: 1, validate: Number.isInteger },
      },
    ],
    review: {
      required: { type: Boolean, default: true }, // does the brand have to approve work before it is published?
      approverName: { type: String, trim: true, maxlength: 120 },
      notes: { type: String, maxlength: LIMITS.shortText },
    },
    notes: { type: String, maxlength: LIMITS.text },
    statusHistory: [{ _id: false, from: String, to: String, at: Date, note: { type: String, maxlength: 500 } }],
    archivedAt: { type: Date, default: null },
  },
  { timestamps: true, optimisticConcurrency: true },
);
campaignSchema.index({ owner: 1, status: 1, endDate: 1 });
campaignSchema.index({ owner: 1, client: 1 });
campaignSchema.pre('validate', function () {
  if (this.startDate && this.endDate && this.endDate < this.startDate) this.invalidate('endDate', 'End date must not be before start date');
  if (this.startDate && this.deadline && this.deadline < this.startDate) this.invalidate('deadline', 'Deadline must not be before the start date');
  for (const key of ['fee', 'budget']) {
    if (this[key]?.amountMinor != null && !this[key].currency) this.invalidate(`${key}.currency`, 'Currency is required with an amount');
  }
  if (this.fee?.amountMinor != null && this.budget?.amountMinor != null && this.fee.currency !== this.budget.currency) {
    this.invalidate('budget.currency', 'Budget and fee must use the same currency');
  }
});

export const Campaign = mongoose.model('Campaign', campaignSchema);
