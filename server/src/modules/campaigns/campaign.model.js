import mongoose from 'mongoose';

const campaignSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    client: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    brief: String,
    status: {
      type: String,
      enum: ['proposed', 'negotiating', 'confirmed', 'in_progress', 'delivered', 'completed', 'cancelled'],
      default: 'proposed',
    },
    startDate: Date,
    endDate: Date,
    // Agreed fee in MINOR units (e.g. cents/paise) + ISO currency, per docs/PLAN.md D7.
    fee: {
      amountMinor: { type: Number, min: 0, validate: Number.isInteger },
      currency: { type: String, uppercase: true, match: /^[A-Z]{3}$/ },
    },
    notes: String,
    archivedAt: { type: Date, default: null },
  },
  { timestamps: true },
);
campaignSchema.index({ owner: 1, status: 1, endDate: 1 });
campaignSchema.index({ owner: 1, client: 1 });
campaignSchema.pre('validate', function () {
  if (this.startDate && this.endDate && this.endDate < this.startDate) this.invalidate('endDate', 'End date must not be before start date');
  if (this.fee?.amountMinor != null && !this.fee.currency) this.invalidate('fee.currency', 'Currency is required with a fee');
});

export const Campaign = mongoose.model('Campaign', campaignSchema);
