import mongoose from 'mongoose';

const categorySchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    nameLower: { type: String, required: true },
    color: { type: String, default: '#6366f1', match: /^#[0-9a-fA-F]{6}$/ },
  },
  { timestamps: true },
);

// Names are unique PER OWNER (two users may both have "Travel").
categorySchema.index({ owner: 1, nameLower: 1 }, { unique: true });
categorySchema.pre('validate', function () {
  if (this.name) this.nameLower = this.name.toLowerCase();
});

export const Category = mongoose.model('Category', categorySchema);

export const toPublicCategory = (c) => ({
  id: String(c._id),
  name: c.name,
  color: c.color,
  createdAt: c.createdAt,
  updatedAt: c.updatedAt,
});
