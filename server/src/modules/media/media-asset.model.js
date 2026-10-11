import mongoose from 'mongoose';

const { ObjectId } = mongoose.Schema.Types;

/** One uploaded file attached to one content item. The storage key is internal and never sent to clients. */
const mediaAssetSchema = new mongoose.Schema(
  {
    owner: { type: ObjectId, ref: 'User', required: true },
    content: { type: ObjectId, ref: 'Content', required: true },
    provider: { type: String, enum: ['local', 'cloudinary'], required: true },
    storageKey: { type: String, required: true }, // local: relative path; cloudinary: public_id
    resourceType: { type: String, enum: ['image', 'video', 'document'], required: true },
    mimeType: { type: String, required: true }, // detected from the file's bytes, not trusted from the client
    bytes: { type: Number, required: true, min: 1 },
    originalName: { type: String, maxlength: 200 }, // display only; never used to build paths
  },
  { timestamps: true },
);
mediaAssetSchema.index({ owner: 1, content: 1, createdAt: 1 });

export const MediaAsset = mongoose.model('MediaAsset', mediaAssetSchema);

export const toPublicAsset = (a) => ({
  id: String(a._id),
  contentId: String(a.content),
  resourceType: a.resourceType,
  mimeType: a.mimeType,
  bytes: a.bytes,
  name: a.originalName,
  createdAt: a.createdAt,
});
