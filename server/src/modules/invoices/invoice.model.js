import mongoose from 'mongoose';

const int = { type: Number, min: 0, validate: Number.isInteger };

const invoiceSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    client: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: true },
    campaign: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', default: null },
    number: { type: String, required: true },
    // "sent" is declared by the user ("I sent it"); the app does not email invoices.
    status: { type: String, enum: ['draft', 'sent', 'void'], default: 'draft' },
    issueDate: Date,
    dueDate: Date,
    currency: { type: String, required: true, uppercase: true, match: /^[A-Z]{3}$/ },
    lineItems: [{ description: String, quantity: { type: Number, min: 0 }, unitAmountMinor: int, taxRatePct: { type: Number, min: 0 } }],
    totalMinor: { ...int, required: true },
    notes: String,
  },
  { timestamps: true },
);
invoiceSchema.index({ owner: 1, number: 1 }, { unique: true });
invoiceSchema.index({ owner: 1, status: 1, dueDate: 1 });

export const Invoice = mongoose.model('Invoice', invoiceSchema);
