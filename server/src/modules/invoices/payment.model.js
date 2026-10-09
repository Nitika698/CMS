import mongoose from 'mongoose';

// One payment received against one invoice. Balances are always computed from these, never stored.
const paymentSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    invoice: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice', required: true },
    amountMinor: { type: Number, required: true, min: 1, validate: Number.isInteger },
    currency: { type: String, required: true, uppercase: true, match: /^[A-Z]{3}$/ },
    paidAt: { type: Date, required: true },
    method: String,
    reference: String,
  },
  { timestamps: true },
);
paymentSchema.index({ owner: 1, invoice: 1 });
paymentSchema.index({ owner: 1, paidAt: -1 });

export const Payment = mongoose.model('Payment', paymentSchema);
