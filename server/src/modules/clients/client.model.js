import mongoose from 'mongoose';
import { CHANNELS, CLIENT_STATUSES, CLIENT_TYPES, LIMITS, RATE_UNITS, SOCIAL_PLATFORMS } from './clients.constants.js';

const { ObjectId } = mongoose.Schema.Types;

const contactSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: LIMITS.name },
  role: { type: String, trim: true, maxlength: 80 },
  email: { type: String, lowercase: true, trim: true, maxlength: 254 },
  phone: { type: String, trim: true, maxlength: 30 },
  isPrimary: { type: Boolean, default: false },
});

const rateSchema = new mongoose.Schema({
  label: { type: String, required: true, trim: true, maxlength: 80 },
  // Money is integer MINOR units + ISO currency (docs/PLAN.md D7). This is the NEGOTIATED RATE CARD for the brand,
  // i.e. reference terms. It is not a campaign fee: actual fees live on Campaigns and are read through the reference.
  amountMinor: { type: Number, required: true, min: 0, validate: Number.isInteger },
  currency: { type: String, required: true, uppercase: true, match: /^[A-Z]{3}$/ },
  unit: { type: String, enum: RATE_UNITS, default: 'per_post' },
  notes: { type: String, trim: true, maxlength: 300 },
});

const socialSchema = new mongoose.Schema({
  platform: { type: String, enum: SOCIAL_PLATFORMS, required: true },
  url: { type: String, required: true, maxlength: 500 },
});

/**
 * A brand / agency / person the influencer works with.
 * Campaigns, invoices and saved discussions are NOT copied here: they reference the client by id and are read
 * through that reference (see clients.service.js). "Last contact" is derived from the latest saved discussion.
 */
const clientSchema = new mongoose.Schema(
  {
    owner: { type: ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, trim: true, maxlength: LIMITS.name },
    nameLower: { type: String, required: true },
    type: { type: String, enum: CLIENT_TYPES, default: 'brand' },
    status: { type: String, enum: CLIENT_STATUSES, default: 'lead' },

    website: { type: String, trim: true, maxlength: 500 },
    socialLinks: { type: [socialSchema], default: [] },
    industry: { type: String, trim: true, maxlength: 80 },
    category: { type: String, trim: true, maxlength: 60 },

    contacts: { type: [contactSchema], default: [] },
    contactPreferences: {
      channel: { type: String, enum: [...CHANNELS, null], default: null },
      bestTime: { type: String, trim: true, maxlength: 200 },
      notes: { type: String, trim: true, maxlength: LIMITS.shortText },
    },
    collaborationNotes: { type: String, maxlength: LIMITS.longText },

    rates: { type: [rateSchema], default: [] },
    defaultCurrency: { type: String, uppercase: true, match: /^[A-Z]{3}$/ },
    paymentTermsDays: { type: Number, min: 0, max: 365, validate: Number.isInteger },
    terms: {
      exclusivity: { type: String, trim: true, maxlength: LIMITS.shortText },
      usageRights: { type: String, trim: true, maxlength: LIMITS.shortText },
      other: { type: String, trim: true, maxlength: 2000 },
    },

    // A DATE (stored 00:00 UTC, like content deadlines) the user wants to follow up on, with an optional reason.
    followUpAt: { type: Date, default: null },
    followUpNote: { type: String, trim: true, maxlength: 200 },

    archivedAt: { type: Date, default: null },
  },
  { timestamps: true, optimisticConcurrency: true },
);

// Names are unique per owner among non-archived clients (case-insensitive). Archiving frees the name.
clientSchema.index({ owner: 1, nameLower: 1 }, { unique: true, partialFilterExpression: { archivedAt: null } });
clientSchema.index({ owner: 1, archivedAt: 1, status: 1 });
clientSchema.index({ owner: 1, followUpAt: 1 });
clientSchema.index({ owner: 1, category: 1 });

clientSchema.pre('validate', function () {
  if (this.name) this.nameLower = this.name.toLowerCase();
  // Exactly one primary contact whenever there are contacts.
  if (this.contacts.length) {
    const primaries = this.contacts.filter((c) => c.isPrimary);
    if (primaries.length === 0) this.contacts[0].isPrimary = true;
    else if (primaries.length > 1) this.invalidate('contacts', 'Only one contact can be the primary contact');
  }
});

export const Client = mongoose.model('Client', clientSchema);
