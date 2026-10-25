import mongoose from 'mongoose';
import { PAYMENT_KINDS } from './invoice.constants.js';

// One payment received against one invoice. Balances are always computed from these, never stored.
// This records money that arrived somewhere else (bank, UPI, PayPal...); CMS does not move or collect money.
const paymentSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    invoice: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice', required: true },
    amountMinor: { type: Number, required: true, min: 1, validate: Number.isInteger },
    currency: { type: String, required: true, uppercase: true, match: /^[A-Z]{3}$/ },
    paidAt: { type: Date, required: true },
    kind: { type: String, enum: PAYMENT_KINDS, default: 'installment' },
    method: String,
    reference: String,
    notes: String,
  },
  { timestamps: true },
);
paymentSchema.index({ owner: 1, invoice: 1 });
paymentSchema.index({ owner: 1, paidAt: -1 });

export const Payment = mongoose.model('Payment', paymentSchema);
