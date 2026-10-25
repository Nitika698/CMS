import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 254 },
    // select:false => never loaded unless explicitly requested with .select('+passwordHash')
    passwordHash: { type: String, required: true, select: false },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    timezone: { type: String, default: 'UTC' },
    defaultCurrency: { type: String, default: 'USD', uppercase: true, match: /^[A-Z]{3}$/ },
    failedLoginCount: { type: Number, default: 0, select: false },
    lockedUntil: { type: Date, default: null, select: false },
    lastLoginAt: { type: Date, default: null },
    // Printed on invoices. Editable at any time; an invoice keeps a copy of these as they were when it was issued.
    businessProfile: {
      businessName: { type: String, trim: true, maxlength: 120 },
      email: { type: String, trim: true, lowercase: true, maxlength: 254 },
      phone: { type: String, trim: true, maxlength: 30 },
      website: { type: String, trim: true, maxlength: 200 },
      address: { type: String, trim: true, maxlength: 500 },
      taxIdLabel: { type: String, trim: true, maxlength: 20 }, // e.g. GSTIN, VAT no.
      taxId: { type: String, trim: true, maxlength: 60 },
      paymentInstructions: { type: String, trim: true, maxlength: 1000 }, // how the brand should pay you (bank details, UPI id, PayPal...)
      invoiceNotes: { type: String, trim: true, maxlength: 1000 }, // default footer text for new invoices
      invoicePrefix: { type: String, trim: true, uppercase: true, maxlength: 10, default: 'INV' },
      paymentTermsDays: { type: Number, min: 0, max: 365, default: 14 },
    },
    calendarPrefs: {
      // Minutes before a scheduled post to remind (in-app). Applied to new scheduled posts that don't choose their own.
      defaultReminderOffsets: { type: [Number], default: [60] },
      // Minutes before the END of a content deadline day to remind.
      deadlineReminderOffsets: { type: [Number], default: [1440] },
      weekStartsOn: { type: Number, enum: [0, 1, 6], default: 1 }, // 0 Sunday, 1 Monday, 6 Saturday
    },
  },
  { timestamps: true },
);

export function toPublicBusinessProfile(b = {}) {
  return {
    businessName: b.businessName ?? '', email: b.email ?? '', phone: b.phone ?? '', website: b.website ?? '', address: b.address ?? '',
    taxIdLabel: b.taxIdLabel ?? '', taxId: b.taxId ?? '', paymentInstructions: b.paymentInstructions ?? '', invoiceNotes: b.invoiceNotes ?? '',
    invoicePrefix: b.invoicePrefix || 'INV', paymentTermsDays: b.paymentTermsDays ?? 14,
  };
}

/** The ONLY shape in which a user is ever sent to a client. Allow-list, not block-list. */
export function toPublicUser(u) {
  return {
    id: String(u._id),
    email: u.email,
    name: u.name,
    timezone: u.timezone,
    defaultCurrency: u.defaultCurrency,
    lastLoginAt: u.lastLoginAt,
    businessProfile: toPublicBusinessProfile(u.businessProfile),
    calendarPrefs: {
      defaultReminderOffsets: u.calendarPrefs?.defaultReminderOffsets ?? [60],
      deadlineReminderOffsets: u.calendarPrefs?.deadlineReminderOffsets ?? [1440],
      weekStartsOn: u.calendarPrefs?.weekStartsOn ?? 1,
    },
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
  };
}

export const User = mongoose.model('User', userSchema);
