import mongoose from 'mongoose';

const clientSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    nameLower: { type: String, required: true },
    type: { type: String, enum: ['brand', 'agency', 'individual', 'other'], default: 'brand' },
    status: { type: String, enum: ['lead', 'active', 'past', 'blocked'], default: 'lead' },
    website: String,
    industry: String,
    defaultCurrency: { type: String, uppercase: true, match: /^[A-Z]{3}$/ },
    paymentTermsDays: { type: Number, min: 0 },
    notes: String,
    archivedAt: { type: Date, default: null },
  },
  { timestamps: true },
);
clientSchema.index({ owner: 1, nameLower: 1 }, { unique: true, partialFilterExpression: { archivedAt: null } });
clientSchema.pre('validate', function () {
  if (this.name) this.nameLower = this.name.toLowerCase();
});

export const Client = mongoose.model('Client', clientSchema);
