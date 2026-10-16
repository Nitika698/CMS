import mongoose from 'mongoose';
import { COMMUNICATION_CHANNELS, DIRECTIONS } from '../clients/clients.constants.js';

const { ObjectId } = mongoose.Schema.Types;

/**
 * A SAVED DISCUSSION: a manual log of a conversation with a client (an email thread, a call, a DM...).
 * It is a record the user writes. CMS never sends or receives anything, and never claims to have.
 */
const communicationSchema = new mongoose.Schema(
  {
    owner: { type: ObjectId, ref: 'User', required: true },
    client: { type: ObjectId, ref: 'Client', required: true },
    campaign: { type: ObjectId, ref: 'Campaign', default: null }, // must belong to the same client (checked on write)
    contactId: { type: ObjectId, default: null }, // the _id of one of the client's embedded contacts
    channel: { type: String, enum: COMMUNICATION_CHANNELS, required: true },
    direction: { type: String, enum: DIRECTIONS, required: true },
    occurredAt: { type: Date, required: true },
    subject: { type: String, trim: true, maxlength: 200 },
    body: { type: String, maxlength: 20_000 },
    archivedAt: { type: Date, default: null },
  },
  { timestamps: true },
);
communicationSchema.index({ owner: 1, client: 1, occurredAt: -1 });
communicationSchema.index({ owner: 1, occurredAt: -1 });

export const Communication = mongoose.model('Communication', communicationSchema);
