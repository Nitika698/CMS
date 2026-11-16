import mongoose from 'mongoose';
import { AppError } from '../../lib/errors.js';
import { isObjectId, notFound } from '../../lib/scoped.js';
import { formatLocal, localToInstant, zonedMidnight } from '../../lib/timezone.js';
import { Campaign } from '../campaigns/campaign.model.js';
import { Client } from '../clients/client.model.js';
import { findOwnedClient } from '../clients/clients.service.js';
import { Communication } from './communication.model.js';

const FUTURE_TOLERANCE_MS = 5 * 60_000;
const oid = (id) => new mongoose.Types.ObjectId(String(id));
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const tzOf = (user) => user.timezone || 'UTC';
const invalid = (path, message) => new AppError(400, 'VALIDATION_ERROR', 'Some fields are invalid', [{ path, message }]);
const MIN_MS = Date.UTC(2000, 0, 1);

/** `occurredAt` (instant with offset) or `occurredLocal` (wall-clock time in the user's profile timezone). */
function resolveWhen(input, tz, now) {
  const warnings = [];
  let at;
  let field = 'occurredLocal';
  if (input.occurredAt !== undefined) {
    at = input.occurredAt;
    field = 'occurredAt';
  } else if (input.occurredLocal !== undefined) {
    const r = localToInstant(input.occurredLocal, tz);
    if (!r.instant) {
      throw invalid(field, r.reason === 'skipped' ? `That time does not exist in ${tz} on that date (the clocks change).` : 'That is not a real date and time.');
    }
    if (r.ambiguous) warnings.push({ code: 'AMBIGUOUS_LOCAL_TIME', message: `That time happens twice in ${tz} on that date. The earlier one was used.` });
    at = r.instant;
  }
  if (at) {
    if (at.getTime() < MIN_MS) throw invalid(field, 'Choose a date after the year 2000');
    // A saved discussion is a record of something that already happened.
    if (at.getTime() > now.getTime() + FUTURE_TOLERANCE_MS) throw invalid(field, 'A saved discussion cannot be in the future. Use the follow-up date to plan ahead.');
  }
  return { at, field, warnings };
}

/** The campaign must exist, be the user's, AND belong to this very client. Anything else looks like "not found". */
async function checkCampaign(userId, clientId, campaignId) {
  if (!campaignId) return;
  if (!(await Campaign.exists({ _id: campaignId, owner: userId, client: clientId }))) throw invalid('campaign', 'Campaign not found for this brand');
}

function checkContact(client, contactId) {
  if (!contactId) return;
  if (!client.contacts.some((c) => String(c._id) === contactId)) throw invalid('contactId', 'Contact not found for this brand');
}

async function present(user, rows, client) {
  const campaignIds = [...new Set(rows.map((r) => r.campaign).filter(Boolean).map(String))];
  const camps = campaignIds.length ? await Campaign.find({ _id: { $in: campaignIds }, owner: user.id }).select('title').lean() : [];
  const title = new Map(camps.map((c) => [String(c._id), c.title]));
  const contactName = new Map((client?.contacts ?? []).map((c) => [String(c._id), c.name]));
  const tz = tzOf(user);
  return rows.map((r) => {
    const o = r.toObject ? r.toObject() : r;
    const local = formatLocal(o.occurredAt, tz);
    return {
      id: String(o._id),
      clientId: String(o.client),
      channel: o.channel,
      direction: o.direction,
      occurredAt: o.occurredAt,
      localDate: local.date,
      localTime: local.time,
      occurredLocal: local.local,
      subject: o.subject ?? null,
      body: o.body ?? null,
      campaign: o.campaign ? { id: String(o.campaign), title: title.get(String(o.campaign)) ?? null } : null,
      contact: o.contactId ? { id: String(o.contactId), name: contactName.get(String(o.contactId)) ?? null } : null,
      createdAt: o.createdAt,
      updatedAt: o.updatedAt,
    };
  });
}

async function findOwned(userId, id) {
  if (!isObjectId(String(id))) throw notFound('Discussion');
  const doc = await Communication.findOne({ _id: id, owner: userId, archivedAt: null });
  if (!doc) throw notFound('Discussion');
  return doc;
}

export async function createDiscussion(user, clientId, input, now = new Date()) {
  const client = await findOwnedClient(user.id, clientId);
  if (client.archivedAt) throw new AppError(409, 'ARCHIVED', 'Restore this brand before adding discussions to it.');
  const when = resolveWhen(input, tzOf(user), now);
  await checkCampaign(user.id, client._id, input.campaign);
  checkContact(client, input.contactId);

  const doc = await Communication.create({
    owner: user.id,
    client: client._id,
    campaign: input.campaign ?? null,
    contactId: input.contactId ?? null,
    channel: input.channel,
    direction: input.direction,
    occurredAt: when.at ?? now,
    subject: input.subject ?? undefined,
    body: input.body ?? undefined,
  });
  return { data: (await present(user, [doc], client))[0], warnings: when.warnings };
}

function discussionFilter(user, base, q) {
  const tz = tzOf(user);
  const where = { owner: oid(user.id), archivedAt: null, ...base };
  if (q.channel?.length) where.channel = { $in: q.channel };
  if (q.direction) where.direction = q.direction;
  if (q.campaign) where.campaign = oid(q.campaign);
  if (q.from || q.to) {
    where.occurredAt = {};
    if (q.from) {
      const [y, m, d] = q.from.split('-').map(Number);
      where.occurredAt.$gte = zonedMidnight(y, m, d, tz);
    }
    if (q.to) {
      const [y, m, d] = q.to.split('-').map(Number);
      where.occurredAt.$lt = zonedMidnight(y, m, d + 1, tz);
    }
  }
  if (q.q) {
    const rx = new RegExp(escapeRegex(q.q), 'i');
    where.$or = [{ subject: rx }, { body: rx }];
  }
  return where;
}

export async function listDiscussions(user, clientId, q) {
  const client = await findOwnedClient(user.id, clientId);
  const where = discussionFilter(user, { client: client._id }, q);
  const [total, rows] = await Promise.all([
    Communication.countDocuments(where),
    Communication.find(where).sort({ occurredAt: -1, _id: -1 }).skip((q.page - 1) * q.limit).limit(q.limit),
  ]);
  return {
    data: await present(user, rows, client),
    meta: { page: q.page, limit: q.limit, total, pages: Math.max(1, Math.ceil(total / q.limit)) },
  };
}

/** Saved discussions across ALL of the user's brands, newest first, each with its brand. Optional filter by one brand. */
export async function listAllDiscussions(user, q) {
  const base = q.client ? { client: (await findOwnedClient(user.id, q.client))._id } : {};
  const where = discussionFilter(user, base, q);
  const [total, rows] = await Promise.all([
    Communication.countDocuments(where),
    Communication.find(where).sort({ occurredAt: -1, _id: -1 }).skip((q.page - 1) * q.limit).limit(q.limit),
  ]);
  const brands = await Client.find({ _id: { $in: [...new Set(rows.map((r) => String(r.client)))] }, owner: user.id }).select('name archivedAt').lean();
  const byId = new Map(brands.map((b) => [String(b._id), b]));
  const data = (await present(user, rows, null)).map((d) => ({ ...d, client: { id: d.clientId, name: byId.get(d.clientId)?.name ?? null, archived: !!byId.get(d.clientId)?.archivedAt } }));
  return { data, meta: { page: q.page, limit: q.limit, total, pages: Math.max(1, Math.ceil(total / q.limit)) } };
}

export async function getDiscussion(user, id) {
  const doc = await findOwned(user.id, id);
  const client = await findOwnedClient(user.id, doc.client);
  return { data: (await present(user, [doc], client))[0] };
}

export async function updateDiscussion(user, id, input, now = new Date()) {
  const doc = await findOwned(user.id, id);
  const client = await findOwnedClient(user.id, doc.client);
  if (client.archivedAt) throw new AppError(409, 'ARCHIVED', 'Restore this brand before editing its discussions.');
  const when = resolveWhen(input, tzOf(user), now);
  if (input.campaign !== undefined) await checkCampaign(user.id, client._id, input.campaign);
  if (input.contactId !== undefined) checkContact(client, input.contactId);

  for (const k of ['channel', 'direction']) if (input[k] !== undefined) doc[k] = input[k];
  for (const k of ['subject', 'body']) if (input[k] !== undefined) doc[k] = input[k] ?? undefined;
  if (input.campaign !== undefined) doc.campaign = input.campaign;
  if (input.contactId !== undefined) doc.contactId = input.contactId;
  if (when.at) doc.occurredAt = when.at;
  if (!doc.subject && !doc.body) throw invalid('subject', 'Add a subject or some notes');
  await doc.save();
  return { data: (await present(user, [doc], client))[0], warnings: when.warnings };
}

export async function deleteDiscussion(user, id) {
  const doc = await findOwned(user.id, id);
  await Communication.deleteOne({ _id: doc._id, owner: user.id });
}
