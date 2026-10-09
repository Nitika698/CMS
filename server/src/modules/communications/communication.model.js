import mongoose from 'mongoose';

// A manual log of a conversation. The app never claims it sent anything.
const communicationSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    client: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: true },
    campaign: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', default: null },
    channel: { type: String, enum: ['email', 'call', 'meeting', 'dm', 'whatsapp', 'other'], required: true },
    direction: { type: String, enum: ['inbound', 'outbound'], required: true },
    occurredAt: { type: Date, required: true },
    subject: { type: String, trim: true, maxlength: 200 },
    body: String,
    archivedAt: { type: Date, default: null },
  },
  { timestamps: true },
);
communicationSchema.index({ owner: 1, client: 1, occurredAt: -1 });
communicationSchema.index({ owner: 1, occurredAt: -1 });

export const Communication = mongoose.model('Communication', communicationSchema);
