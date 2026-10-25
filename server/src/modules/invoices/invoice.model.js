import mongoose from 'mongoose';
import { STORED_STATUSES } from './invoice.constants.js';

const int = { type: Number, min: 0, validate: Number.isInteger };
const { ObjectId } = mongoose.Schema.Types;

const lineItemSchema = new mongoose.Schema(
  {
    description: { type: String, required: true, trim: true, maxlength: 300 },
    quantity: { type: Number, required: true, min: 0 },
    unitAmountMinor: { ...int, required: true },
    taxRatePct: { type: Number, min: 0, max: 100, default: 0 },
  },
  { _id: false },
);

const party = {
  name: String, contactName: String, email: String, phone: String, website: String, address: String, taxIdLabel: String, taxId: String,
};

const invoiceSchema = new mongoose.Schema(
  {
    owner: { type: ObjectId, ref: 'User', required: true },
    client: { type: ObjectId, ref: 'Client', required: true },
    campaign: { type: ObjectId, ref: 'Campaign', default: null },
    number: { type: String, required: true, trim: true, maxlength: 40 },
    // "sent" (shown as Issued) is declared by the user ("I gave it to the brand"). The app never emails or charges anyone.
    status: { type: String, enum: STORED_STATUSES, default: 'draft' },
    issueDate: { type: Date, default: null },
    dueDate: { type: Date, default: null },
    currency: { type: String, required: true, uppercase: true, match: /^[A-Z]{3}$/ },
    lineItems: { type: [lineItemSchema], default: [] },
    // Derived from the line items on every write; never accepted from a request.
    subtotalMinor: { ...int, default: 0 },
    taxMinor: { ...int, default: 0 },
    totalMinor: { ...int, required: true },
    notes: String,
    billToAddress: String, // the brand's billing address, typed per invoice (brands do not carry one)
    // Copies taken the moment the invoice is issued, so later edits to your profile or the brand never rewrite it.
    issuer: { type: party, default: null },
    billTo: { type: party, default: null },
    paymentInstructions: String,
    sentAt: Date,
    voidedAt: Date,
    voidReason: String,
  },
  { timestamps: true, optimisticConcurrency: true },
);
invoiceSchema.index({ owner: 1, number: 1 }, { unique: true });
invoiceSchema.index({ owner: 1, status: 1, dueDate: 1 });
invoiceSchema.index({ owner: 1, client: 1 });
invoiceSchema.index({ owner: 1, campaign: 1 });
invoiceSchema.index({ status: 1, dueDate: 1 }); // the reminder sweep scans issued invoices across users

export const Invoice = mongoose.model('Invoice', invoiceSchema);
