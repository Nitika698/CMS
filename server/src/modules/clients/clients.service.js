import mongoose from 'mongoose';
import { MODULES } from '../../config/modules.js';
import { AppError } from '../../lib/errors.js';
import { isObjectId, notFound } from '../../lib/scoped.js';
import { formatLocal, zonedMidnight } from '../../lib/timezone.js';
import { ACTIVE_CAMPAIGN, campaignGroup } from '../campaigns/campaign.constants.js';
import { Campaign } from '../campaigns/campaign.model.js';
import { Communication } from '../communications/communication.model.js';
import { agreedByCurrency, invoiceTotals } from '../invoices/invoice.aggregates.js';
import { Invoice } from '../invoices/invoice.model.js';
import { Payment } from '../invoices/payment.model.js';
import { Task } from '../tasks/task.model.js';
import { displayStatusOf } from '../invoices/invoice.logic.js';
import { Client } from './client.model.js';
import { CLIENT_STATUSES, CLIENT_TYPES, CHANNELS, COMMON_CATEGORIES, LIMITS, RATE_UNITS, SOCIAL_PLATFORMS } from './clients.constants.js';

const oid = (id) => new mongoose.Types.ObjectId(String(id));
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const tzOf = (user) => user.timezone || 'UTC';
const invalid = (path, message) => new AppError(400, 'VALIDATION_ERROR', 'Some fields are invalid', [{ path, message }]);

/** Today as a UTC-midnight Date for the user's LOCAL calendar day (follow-up dates are dates, stored at 00:00 UTC). */
function todayDate(user, now) {
  const [y, m, d] = formatLocal(now, tzOf(user)).date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

// ------------------------------------------------------------------ lookups

export async function findOwnedClient(userId, id) {
  if (!isObjectId(String(id))) throw notFound('Brand');
  const client = await Client.findOne({ _id: id, owner: userId });
  if (!client) throw notFound('Brand');
  return client;
}

async function assertNameFree(userId, name, excludeId) {
  const existing = await Client.findOne({
    owner: userId,
    nameLower: name.toLowerCase(),
    archivedAt: null,
    ...(excludeId && { _id: { $ne: excludeId } }),
  }).select('_id');
  if (existing) {
    throw new AppError(409, 'DUPLICATE_NAME', 'You already have a brand with this name. Open it, or choose a different name.', { existingId: String(existing._id) });
  }
}

const save = async (doc) => {
  try {
    return await doc.save();
  } catch (err) {
    if (err.code === 11000) throw new AppError(409, 'DUPLICATE_NAME', 'You already have a brand with this name.');
    if (err.name === 'VersionError') throw new AppError(409, 'CONFLICT', 'This brand was changed elsewhere. Reload and try again.');
    if (err.name === 'ValidationError') {
      throw new AppError(400, 'VALIDATION_ERROR', 'Some fields are invalid', Object.values(err.errors).map((e) => ({ path: e.path, message: e.message })));
    }
    throw err;
  }
};

// ------------------------------------------------------------------ serialisation

const primaryOf = (contacts) => contacts.find((c) => c.isPrimary) ?? contacts[0] ?? null;
const publicContact = (c) => ({ id: String(c._id), name: c.name, role: c.role ?? null, email: c.email ?? null, phone: c.phone ?? null, isPrimary: !!c.isPrimary });

export function toPublicClient(c, user, now = new Date()) {
  const o = c.toObject ? c.toObject() : c;
  const contacts = (o.contacts ?? []).map(publicContact);
  return {
    id: String(o._id),
    name: o.name,
    type: o.type,
    status: o.status,
    website: o.website ?? null,
    socialLinks: (o.socialLinks ?? []).map((s) => ({ platform: s.platform, url: s.url })),
    industry: o.industry ?? null,
    category: o.category ?? null,
    contacts,
    primaryContact: primaryOf(contacts),
    contactPreferences: { channel: o.contactPreferences?.channel ?? null, bestTime: o.contactPreferences?.bestTime ?? null, notes: o.contactPreferences?.notes ?? null },
    collaborationNotes: o.collaborationNotes ?? null,
    rates: (o.rates ?? []).map((r) => ({ id: String(r._id), label: r.label, amountMinor: r.amountMinor, currency: r.currency, unit: r.unit, notes: r.notes ?? null })),
    defaultCurrency: o.defaultCurrency ?? null,
    paymentTermsDays: o.paymentTermsDays ?? null,
    terms: { exclusivity: o.terms?.exclusivity ?? null, usageRights: o.terms?.usageRights ?? null, other: o.terms?.other ?? null },
    followUpAt: o.followUpAt ?? null,
    followUpNote: o.followUpNote ?? null,
    // Overdue = the follow-up DAY has passed in the user's timezone (a follow-up due today is not overdue yet).
    followUpOverdue: !!o.followUpAt && o.followUpAt < todayDate(user, now),
    archived: !!o.archivedAt,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
    version: o.__v ?? 0, // send back on edits so a stale screen cannot overwrite a newer change
  };
}

// ------------------------------------------------------------------ list

export async function listClients(user, q, now = new Date()) {
  const where = { owner: oid(user.id), archivedAt: q.archived ? { $ne: null } : null };
  if (q.status?.length) where.status = { $in: q.status };
  if (q.type?.length) where.type = { $in: q.type };
  if (q.category) where.category = new RegExp(`^${escapeRegex(q.category)}$`, 'i');
  if (q.industry) where.industry = new RegExp(`^${escapeRegex(q.industry)}$`, 'i');
  const today = todayDate(user, now);
  if (q.followUp === 'overdue') where.followUpAt = { $lt: today };
  if (q.followUp === 'upcoming') where.followUpAt = { $gte: today };
  if (q.followUp === 'none') where.followUpAt = null;
  if (q.q) {
    const rx = new RegExp(escapeRegex(q.q), 'i'); // user text is escaped: it can never be a regular expression
    where.$or = [{ name: rx }, { 'contacts.name': rx }, { 'contacts.email': rx }, { industry: rx }, { category: rx }, { website: rx }, { collaborationNotes: rx }, { 'socialLinks.url': rx }];
  }

  const desc = q.sort.startsWith('-');
  const field = q.sort.replace(/^-/, '');
  const dir = desc ? -1 : 1;

  const pipeline = [
    { $match: where },
    // Derived from the saved discussions (never stored on the client): latest contact up to now, and how many.
    {
      $lookup: {
        from: Communication.collection.name,
        let: { cid: '$_id', o: '$owner' },
        pipeline: [
          { $match: { $expr: { $and: [{ $eq: ['$client', '$$cid'] }, { $eq: ['$owner', '$$o'] }] }, archivedAt: null, occurredAt: { $lte: now } } },
          { $group: { _id: null, last: { $max: '$occurredAt' }, n: { $sum: 1 } } },
        ],
        as: 'comm',
      },
    },
    {
      $lookup: {
        from: Campaign.collection.name,
        let: { cid: '$_id', o: '$owner' },
        pipeline: [
          { $match: { $expr: { $and: [{ $eq: ['$client', '$$cid'] }, { $eq: ['$owner', '$$o'] }] }, archivedAt: null, status: { $in: ACTIVE_CAMPAIGN } } },
          { $count: 'n' },
        ],
        as: 'camp',
      },
    },
    {
      $addFields: {
        lastContactAt: { $arrayElemAt: ['$comm.last', 0] },
        communicationCount: { $ifNull: [{ $arrayElemAt: ['$comm.n', 0] }, 0] },
        activeCampaigns: { $ifNull: [{ $arrayElemAt: ['$camp.n', 0] }, 0] },
      },
    },
  ];
  if (field === 'followUpAt' || field === 'lastContact') {
    const path = field === 'lastContact' ? '$lastContactAt' : '$followUpAt';
    // Brands without a date always sort last, in either direction.
    pipeline.push({ $addFields: { _k: { $ifNull: [path, desc ? new Date(0) : new Date('9999-12-31')] } } }, { $sort: { _k: dir, nameLower: 1 } });
  } else if (field === 'status') {
    pipeline.push({ $addFields: { _k: { $indexOfArray: [CLIENT_STATUSES, '$status'] } } }, { $sort: { _k: dir, nameLower: 1 } });
  } else {
    pipeline.push({ $sort: { [field === 'name' ? 'nameLower' : field]: dir, _id: 1 } });
  }
  pipeline.push({ $skip: (q.page - 1) * q.limit }, { $limit: q.limit });

  const [total, rows] = await Promise.all([Client.countDocuments(where), Client.aggregate(pipeline)]);
  return {
    data: rows.map((r) => {
      const c = toPublicClient(r, user, now);
      return {
        id: c.id, name: c.name, type: c.type, status: c.status, category: c.category, industry: c.industry, website: c.website,
        primaryContact: c.primaryContact, contactCount: c.contacts.length,
        followUpAt: c.followUpAt, followUpNote: c.followUpNote, followUpOverdue: c.followUpOverdue,
        lastContactAt: r.lastContactAt ?? null, communicationCount: r.communicationCount, activeCampaigns: r.activeCampaigns,
        archived: c.archived, updatedAt: c.updatedAt,
      };
    }),
    meta: { page: q.page, limit: q.limit, total, pages: Math.max(1, Math.ceil(total / q.limit)) },
  };
}

export async function clientMeta(userId) {
  const base = { owner: userId, archivedAt: null };
  const [categories, industries] = await Promise.all([Client.distinct('category', base), Client.distinct('industry', base)]);
  const clean = (l) => [...new Set(l.filter(Boolean))].sort((a, b) => a.localeCompare(b));
  return {
    statuses: CLIENT_STATUSES,
    types: CLIENT_TYPES,
    channels: CHANNELS,
    rateUnits: RATE_UNITS,
    socialPlatforms: SOCIAL_PLATFORMS,
    limits: LIMITS,
    categories: clean([...COMMON_CATEGORIES, ...categories]),
    industries: clean(industries),
  };
}

// ------------------------------------------------------------------ detail and relationships

async function lastContact(userId, clientId, now) {
  const [row] = await Communication.aggregate([
    { $match: { owner: oid(userId), client: oid(clientId), archivedAt: null, occurredAt: { $lte: now } } },
    { $group: { _id: null, last: { $max: '$occurredAt' }, n: { $sum: 1 } } },
  ]);
  return { lastContactAt: row?.last ?? null, communicationCount: row?.n ?? 0 };
}

/** Everything the client page needs that comes FROM OTHER RECORDS through references. Nothing here is stored on the client. */
async function relationships(user, client, now) {
  const owner = oid(user.id);
  const cid = client._id;
  const todayStart = zonedTodayStart(user, now);
  const [contact, campaignRows, agreedRows, invoiceRows] = await Promise.all([
    lastContact(user.id, cid, now),
    Campaign.aggregate([{ $match: { owner, client: cid, archivedAt: null } }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
    agreedByCurrency(owner, { client: cid }),
    invoiceTotals(owner, todayStart, { client: cid }),
  ]);
  const campaigns = { active: 0, pipeline: 0, past: 0, cancelled: 0, total: 0 };
  for (const r of campaignRows) {
    campaigns[campaignGroup(r._id)] += r.n;
    campaigns.total += r.n;
  }
  const money = new Map();
  const slot = (c) => money.get(c) ?? money.set(c, { currency: c, agreed: 0, invoiced: 0, collected: 0, outstanding: 0, overdue: 0, openInvoices: 0 }).get(c);
  for (const r of agreedRows) if (r._id) slot(r._id).agreed = r.agreed;
  for (const r of invoiceRows) Object.assign(slot(r._id), { invoiced: r.invoiced, collected: r.collected, outstanding: r.outstanding, overdue: r.overdue, openInvoices: r.openInvoices });
  return {
    ...contact,
    campaigns,
    money: [...money.values()].sort((a, b) => a.currency.localeCompare(b.currency)),
    // Whether the owning modules have working features yet (so the UI says "not available yet" instead of implying zero).
    modules: {
      campaigns: { ready: MODULES.campaigns.ready, phase: MODULES.campaigns.phase },
      payments: { ready: MODULES.payments.ready, phase: MODULES.payments.phase },
    },
  };
}

/** Start of today in the user's timezone as an instant (invoice due dates are instants). */
function zonedTodayStart(user, now) {
  const [y, m, d] = formatLocal(now, tzOf(user)).date.split('-').map(Number);
  return zonedMidnight(y, m, d, tzOf(user));
}

export async function getClient(user, id, now = new Date()) {
  const client = await findOwnedClient(user.id, id);
  return { ...toPublicClient(client, user, now), summary: await relationships(user, client, now) };
}

export async function listClientCampaigns(user, id) {
  const client = await findOwnedClient(user.id, id);
  const rows = await Campaign.find({ owner: user.id, client: client._id, archivedAt: null }).sort({ endDate: -1, createdAt: -1 }).limit(200).lean();
  const data = rows.map((c) => ({
    id: String(c._id),
    title: c.title,
    status: c.status,
    group: campaignGroup(c.status),
    startDate: c.startDate ?? null,
    endDate: c.endDate ?? null,
    // The fee is read from the campaign through the reference; it is never copied onto the client.
    fee: c.fee?.amountMinor != null ? { amountMinor: c.fee.amountMinor, currency: c.fee.currency } : null,
  }));
  const groups = { active: [], pipeline: [], past: [], cancelled: [] };
  for (const c of data) groups[c.group].push(c);
  return { data, groups, available: MODULES.campaigns.ready, phase: MODULES.campaigns.phase };
}

export async function listClientInvoices(user, id, now = new Date()) {
  const client = await findOwnedClient(user.id, id);
  const owner = oid(user.id);
  const todayStart = zonedTodayStart(user, now);
  const rows = await Invoice.aggregate([
    { $match: { owner, client: client._id } },
    {
      $lookup: {
        from: Payment.collection.name,
        let: { iid: '$_id', o: '$owner' },
        pipeline: [{ $match: { $expr: { $and: [{ $eq: ['$invoice', '$$iid'] }, { $eq: ['$owner', '$$o'] }] } } }, { $group: { _id: null, paid: { $sum: '$amountMinor' } } }],
        as: 'p',
      },
    },
    { $addFields: { paidMinor: { $ifNull: [{ $arrayElemAt: ['$p.paid', 0] }, 0] } } },
    { $sort: { issueDate: -1, createdAt: -1 } },
    { $limit: 200 },
  ]);
  const campaignIds = rows.map((r) => r.campaign).filter(Boolean);
  const camps = campaignIds.length ? await Campaign.find({ _id: { $in: campaignIds }, owner: user.id }).select('title').lean() : [];
  const title = new Map(camps.map((c) => [String(c._id), c.title]));

  const data = rows.map((r) => {
    const balance = Math.max(0, r.totalMinor - r.paidMinor);
    const displayStatus = displayStatusOf(r, r.paidMinor, todayStart);
    return {
      id: String(r._id), number: r.number, status: r.status, displayStatus, currency: r.currency,
      totalMinor: r.totalMinor, paidMinor: r.paidMinor, balanceMinor: r.status === 'sent' ? balance : 0,
      issueDate: r.issueDate ?? null, dueDate: r.dueDate ?? null,
      campaign: r.campaign ? { id: String(r.campaign), title: title.get(String(r.campaign)) ?? null } : null,
    };
  });
  const totals = (await invoiceTotals(owner, todayStart, { client: client._id })).map((r) => ({ currency: r._id, invoiced: r.invoiced, collected: r.collected, outstanding: r.outstanding, overdue: r.overdue }));
  return { data, totals: totals.sort((a, b) => a.currency.localeCompare(b.currency)), available: MODULES.payments.ready, phase: MODULES.payments.phase };
}

// ------------------------------------------------------------------ commands

function buildContacts(existing, list) {
  const known = new Map((existing ?? []).map((c) => [String(c._id), c]));
  return list.map((c, i) => {
    if (c.id && !known.has(c.id)) throw invalid(`contacts.${i}`, 'Unknown contact');
    return { ...(c.id && { _id: c.id }), name: c.name, role: c.role ?? undefined, email: c.email ?? undefined, phone: c.phone ?? undefined, isPrimary: !!c.isPrimary };
  });
}

export async function createClient(user, input, now = new Date()) {
  await assertNameFree(user.id, input.name);
  const { contacts, ...rest } = input;
  const doc = new Client({ ...rest, owner: user.id, ...(contacts && { contacts: buildContacts([], contacts) }) });
  await save(doc);
  return getClient(user, doc._id, now);
}

export async function updateClient(user, id, input, now = new Date()) {
  const doc = await findOwnedClient(user.id, id);
  if (doc.archivedAt) throw new AppError(409, 'ARCHIVED', 'Restore this brand before editing it.');
  if (input.version !== undefined && input.version !== (doc.__v ?? 0)) {
    throw new AppError(409, 'STALE_VERSION', 'This brand was changed elsewhere since you opened it. Reload to see the latest version.', { currentVersion: doc.__v ?? 0 });
  }
  if (input.name && input.name.toLowerCase() !== doc.nameLower) await assertNameFree(user.id, input.name, doc._id);

  const { contacts, contactPreferences, terms, ...rest } = input;
  delete rest.version; // a concurrency token, not a field
  for (const [key, value] of Object.entries(rest)) doc.set(key, value ?? undefined);
  if (contactPreferences) for (const [k, v] of Object.entries(contactPreferences)) doc.set(`contactPreferences.${k}`, v ?? (k === 'channel' ? null : undefined));
  if (terms) for (const [k, v] of Object.entries(terms)) doc.set(`terms.${k}`, v ?? undefined);
  if (contacts) doc.contacts = buildContacts(doc.contacts, contacts);
  if ('followUpAt' in input && input.followUpAt === null) doc.followUpNote = undefined; // a cleared follow-up drops its reason

  await save(doc);
  if (contacts) {
    // Saved discussions that pointed at a contact that was removed simply lose that pointer.
    await Communication.updateMany({ owner: user.id, client: doc._id, contactId: { $nin: [null, ...doc.contacts.map((c) => c._id)] } }, { $set: { contactId: null } });
  }
  return getClient(user, doc._id, now);
}

/** Counts that make archiving or deleting worth a second thought. */
export async function dependents(user, clientId, now = new Date()) {
  const owner = oid(user.id);
  const [campaigns, activeCampaigns, invoices, unpaid, discussions] = await Promise.all([
    Campaign.countDocuments({ owner, client: clientId }),
    Campaign.countDocuments({ owner, client: clientId, archivedAt: null, status: { $in: ACTIVE_CAMPAIGN } }),
    Invoice.countDocuments({ owner, client: clientId }),
    invoiceTotals(owner, zonedTodayStart(user, now), { client: clientId }).then((rows) => rows.reduce((n, r) => n + r.openInvoices, 0)),
    Communication.countDocuments({ owner, client: clientId }),
  ]);
  return { campaigns, activeCampaigns, invoices, unpaidInvoices: unpaid, discussions };
}

export async function setArchived(user, id, archived, now = new Date()) {
  const doc = await findOwnedClient(user.id, id);
  if (!!doc.archivedAt === archived) return { data: await getClient(user, doc._id, now), warnings: [] }; // idempotent
  const warnings = [];
  if (archived) {
    const d = await dependents(user, doc._id, now);
    if (d.activeCampaigns) warnings.push({ code: 'ACTIVE_CAMPAIGNS', count: d.activeCampaigns, message: `${d.activeCampaigns} campaign${d.activeCampaigns === 1 ? ' is' : 's are'} still active with this brand.` });
    if (d.unpaidInvoices) warnings.push({ code: 'UNPAID_INVOICES', count: d.unpaidInvoices, message: `${d.unpaidInvoices} invoice${d.unpaidInvoices === 1 ? ' is' : 's are'} still unpaid.` });
  } else {
    await assertNameFree(user.id, doc.name, doc._id); // another brand may have taken the name while this one was archived
  }
  doc.archivedAt = archived ? now : null;
  await save(doc);
  return { data: await getClient(user, doc._id, now), warnings };
}

/** Permanent deletion: archived first, and never while campaigns or invoices still point at the brand. */
export async function deleteClient(user, id, now = new Date()) {
  const doc = await findOwnedClient(user.id, id);
  if (!doc.archivedAt) throw new AppError(409, 'NOT_ARCHIVED', 'Archive this brand first, then delete it permanently.');
  const d = await dependents(user, doc._id, now);
  if (d.campaigns || d.invoices) {
    throw new AppError(409, 'HAS_RELATED', 'This brand still has campaigns or invoices. They must be removed before the brand can be deleted; archiving keeps the history.', {
      campaigns: d.campaigns, invoices: d.invoices,
    });
  }
  await Communication.deleteMany({ owner: user.id, client: doc._id }); // its saved discussions go with it
  await Task.updateMany({ owner: user.id, 'links.client': doc._id }, { $set: { 'links.client': null } });
  await Client.deleteOne({ _id: doc._id, owner: user.id });
  return { discussionsDeleted: d.discussions };
}
