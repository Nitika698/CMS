import mongoose from 'mongoose';
import { AppError } from '../../lib/errors.js';
import { isObjectId, notFound } from '../../lib/scoped.js';
import { formatLocal, zonedMidnight } from '../../lib/timezone.js';
import { Client } from '../clients/client.model.js';
import { Communication } from '../communications/communication.model.js';
import { ContentEvent } from '../content/content-event.model.js';
import { Content } from '../content/content.model.js';
import { PLATFORMS, STATUS_LABELS as CONTENT_STATUS_LABELS, TYPES } from '../content/content.constants.js';
import { invoiceTotals, invoicesWithPaid } from '../invoices/invoice.aggregates.js';
import { displayStatusOf } from '../invoices/invoice.logic.js';
import { Invoice } from '../invoices/invoice.model.js';
import { Task } from '../tasks/task.model.js';
import {
  CAMPAIGN_STATUS_LABELS, CAMPAIGN_STATUSES, CAMPAIGN_TRANSITIONS, CLOSED_CAMPAIGN, DEADLINE_WARN_DAYS, DELIVERABLE_RANK,
  DELIVERABLE_STAMPS, DELIVERABLE_STATUS_LABELS, DELIVERABLE_STATUSES, DELIVERABLE_WEIGHTS, LIMITS, nextDeliverableStatuses, SORTS,
} from './campaign.constants.js';
import { Campaign } from './campaign.model.js';
import { campaignFlags, coverageOf, deliverableFlags, progressOf, topSeverity } from './campaign.progress.js';
import { Deliverable } from './deliverable.model.js';

const oid = (id) => new mongoose.Types.ObjectId(String(id));
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const tzOf = (user) => user.timezone || 'UTC';
const invalid = (path, message) => new AppError(400, 'VALIDATION_ERROR', 'Some fields are invalid', [{ path, message }]);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** "2026-10-31" -> local midnight of that day in the user's timezone. */
function dayToDate(s, tz) {
  const [y, m, d] = s.split('-').map(Number);
  return zonedMidnight(y, m, d, tz);
}
const localDay = (date, tz) => (date ? formatLocal(date, tz).date : null);

// ------------------------------------------------------------------ lookups and reference checks

export async function findOwnedCampaign(userId, campaignId) {
  if (!isObjectId(String(campaignId))) throw notFound('Campaign');
  const campaign = await Campaign.findOne({ _id: campaignId, owner: userId });
  if (!campaign) throw notFound('Campaign');
  return campaign;
}

/**
 * The brand must exist AND be the user's. A missing id and another user's id give the same answer,
 * so nothing about other accounts can be learned from this endpoint.
 */
async function checkClient(userId, clientId, { allowArchived = false } = {}) {
  const client = isObjectId(String(clientId)) ? await Client.findOne({ _id: clientId, owner: userId }).select('name archivedAt') : null;
  if (!client) throw invalid('client', 'Brand not found');
  if (client.archivedAt && !allowArchived) throw invalid('client', 'This brand is archived. Restore it before adding campaigns.');
  return client;
}

const save = async (doc) => {
  try {
    return await doc.save();
  } catch (err) {
    if (err.name === 'VersionError') throw new AppError(409, 'CONFLICT', 'This was changed elsewhere. Reload and try again.');
    if (err.name === 'ValidationError') {
      throw new AppError(400, 'VALIDATION_ERROR', 'Some fields are invalid', Object.values(err.errors).map((e) => ({ path: e.path, message: e.message })));
    }
    throw err;
  }
};

function assertOpen(campaign) {
  if (campaign.archivedAt) throw new AppError(409, 'ARCHIVED', 'Restore this campaign before changing it.');
}
function assertWorkable(campaign) {
  assertOpen(campaign);
  if (CLOSED_CAMPAIGN.includes(campaign.status)) {
    throw new AppError(409, 'CAMPAIGN_CLOSED', `This campaign is ${CAMPAIGN_STATUS_LABELS[campaign.status].toLowerCase()}. Re-open it before changing its deliverables.`);
  }
}

// ------------------------------------------------------------------ serialisation

const publicMoney = (m) => (m?.amountMinor != null ? { amountMinor: m.amountMinor, currency: m.currency } : null);

function publicDeliverable(d, campaign, contentById, user, now) {
  const o = d.toObject ? d.toObject() : d;
  const tz = tzOf(user);
  const content = o.content ? contentById.get(String(o.content)) : null;
  return {
    id: String(o._id),
    campaignId: String(o.campaign),
    title: o.title,
    description: o.description ?? null,
    platform: o.platform ?? null,
    format: o.format ?? null,
    dueDate: o.dueDate ?? null,
    dueLocal: localDay(o.dueDate, tz),
    status: o.status,
    statusLabel: DELIVERABLE_STATUS_LABELS[o.status],
    requiresApproval: o.requiresApproval !== false,
    content: content ? { id: String(content._id), title: content.title, status: content.status, statusLabel: CONTENT_STATUS_LABELS[content.status], archived: !!content.archivedAt } : null,
    feedback: o.feedback ?? null,
    revisionCount: o.revisionCount ?? 0,
    completedAt: o.completedAt ?? null,
    submittedAt: o.submittedAt ?? null,
    approvedAt: o.approvedAt ?? null,
    deliveredAt: o.deliveredAt ?? null,
    next: nextDeliverableStatuses(o).map((to) => ({ to, label: DELIVERABLE_STATUS_LABELS[to] })),
    flags: deliverableFlags(o, campaign, now, tz),
    version: o.__v ?? 0,
  };
}

async function contentFor(userId, deliverables) {
  const ids = [...new Set(deliverables.map((d) => d.content).filter(Boolean).map(String))];
  const rows = ids.length ? await Content.find({ _id: { $in: ids }, owner: userId }).select('title status archivedAt').lean() : [];
  return new Map(rows.map((c) => [String(c._id), c]));
}

/** Everything about a campaign that is derived from its deliverables and dates. */
function derive(campaign, deliverables, user, now) {
  const c = campaign.toObject ? campaign.toObject() : campaign;
  const progress = progressOf(deliverables);
  const coverage = coverageOf(c.requirements ?? [], deliverables);
  const flagged = deliverables.map((d) => ({ ...(d.toObject ? d.toObject() : d), flags: deliverableFlags(d, c, now, tzOf(user)) }));
  const flags = campaignFlags(c, flagged, coverage, now, tzOf(user));
  return { progress, coverage, flags, severity: topSeverity(flags) };
}

function publicCampaign(campaign, user, clientName, derived) {
  const c = campaign.toObject ? campaign.toObject() : campaign;
  const tz = tzOf(user);
  return {
    id: String(c._id),
    title: c.title,
    status: c.status,
    statusLabel: CAMPAIGN_STATUS_LABELS[c.status],
    client: { id: String(c.client), name: clientName ?? null },
    brief: c.brief ?? null,
    objectives: c.objectives ?? [],
    startDate: c.startDate ?? null,
    endDate: c.endDate ?? null,
    deadline: c.deadline ?? null,
    local: { startDate: localDay(c.startDate, tz), endDate: localDay(c.endDate, tz), deadline: localDay(c.deadline, tz) },
    budget: publicMoney(c.budget),
    fee: publicMoney(c.fee),
    requirements: (c.requirements ?? []).map((r) => ({ id: String(r._id), platform: r.platform, format: r.format, quantity: r.quantity })),
    review: { required: c.review?.required !== false, approverName: c.review?.approverName ?? null, notes: c.review?.notes ?? null },
    notes: c.notes ?? null,
    statusHistory: (c.statusHistory ?? []).map((h) => ({ from: h.from ?? null, to: h.to, at: h.at, note: h.note ?? null })),
    next: (CAMPAIGN_TRANSITIONS[c.status] ?? []).map((to) => ({ to, label: CAMPAIGN_STATUS_LABELS[to] })),
    progress: derived.progress,
    coverage: derived.coverage,
    flags: derived.flags,
    severity: derived.severity,
    archived: !!c.archivedAt,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    version: c.__v ?? 0, // send back on edits so a stale screen cannot overwrite a newer change
  };
}

// ------------------------------------------------------------------ meta and lookup

export function campaignMeta() {
  return {
    statuses: CAMPAIGN_STATUSES.map((s) => ({ value: s, label: CAMPAIGN_STATUS_LABELS[s], next: CAMPAIGN_TRANSITIONS[s] })),
    deliverableStatuses: DELIVERABLE_STATUSES.map((s) => ({ value: s, label: DELIVERABLE_STATUS_LABELS[s], weight: DELIVERABLE_WEIGHTS[s], rank: DELIVERABLE_RANK[s] })),
    platforms: PLATFORMS,
    formats: TYPES,
    limits: LIMITS,
    sorts: SORTS,
    warnDays: DEADLINE_WARN_DAYS,
    progress: 'Progress is calculated from the state of each deliverable; it is never typed in.',
  };
}

/** Small picker list used by the content form and the calendar. */
export async function lookupCampaigns(userId) {
  const campaigns = await Campaign.find({ owner: userId, archivedAt: null }).select('title status client').sort({ title: 1 }).limit(200).lean();
  const clients = await Client.find({ owner: userId, _id: { $in: campaigns.map((c) => c.client) } }).select('name').lean();
  const names = new Map(clients.map((c) => [String(c._id), c.name]));
  return campaigns.map((c) => ({ id: String(c._id), title: c.title, status: c.status, clientName: names.get(String(c.client)) ?? null }));
}

// ------------------------------------------------------------------ list

const ATTENTION_CODES = {
  any: null,
  deadline_soon: ['deadline_soon', 'deliverables_due_soon'],
  overdue: ['deadline_overdue', 'deliverables_overdue'],
  incomplete: ['incomplete_deliverables', 'requirements_unplanned'],
};

export async function listCampaigns(user, q, now = new Date()) {
  const tz = tzOf(user);
  const where = { owner: oid(user.id), archivedAt: q.archived ? { $ne: null } : null };
  if (q.status?.length) where.status = { $in: q.status };
  if (q.client) where.client = isObjectId(q.client) ? oid(q.client) : null;
  if (q.deadlineFrom || q.deadlineTo) {
    where.deadline = {};
    if (q.deadlineFrom) where.deadline.$gte = dayToDate(q.deadlineFrom, tz);
    if (q.deadlineTo) {
      // "to" is inclusive: everything before the start of the NEXT local day.
      const [y, m, d] = q.deadlineTo.split('-').map(Number);
      where.deadline.$lt = zonedMidnight(y, m, d + 1, tz);
    }
  }
  if (q.q) {
    const rx = new RegExp(escapeRegex(q.q), 'i'); // user text is escaped: it can never be a regular expression
    where.$or = [{ title: rx }, { brief: rx }, { objectives: rx }, { notes: rx }];
  }

  const rows = await Campaign.find(where).limit(LIMITS.listMax).lean();
  const ids = rows.map((r) => r._id);
  const [clients, deliverables] = await Promise.all([
    Client.find({ owner: user.id, _id: { $in: rows.map((r) => r.client) } }).select('name').lean(),
    ids.length ? Deliverable.find({ owner: user.id, campaign: { $in: ids } }).select('campaign status platform format dueDate title requiresApproval').lean() : [],
  ]);
  const names = new Map(clients.map((c) => [String(c._id), c.name]));
  const byCampaign = new Map();
  for (const d of deliverables) byCampaign.set(String(d.campaign), [...(byCampaign.get(String(d.campaign)) ?? []), d]);

  let items = rows.map((r) => {
    const ds = byCampaign.get(String(r._id)) ?? [];
    const derived = derive(r, ds, user, now);
    return { raw: r, derived, view: publicCampaign(r, user, names.get(String(r.client)), derived) };
  });
  const codes = ATTENTION_CODES[q.attention];
  if (q.attention === 'any') items = items.filter((i) => i.derived.flags.some((f) => f.severity !== 'info'));
  else if (codes) items = items.filter((i) => i.derived.flags.some((f) => codes.includes(f.code)));

  const desc = q.sort.startsWith('-');
  const field = q.sort.replace(/^-/, '');
  const key = (i) => {
    const r = i.raw;
    switch (field) {
      case 'title': return r.title.toLowerCase();
      case 'progress': return i.derived.progress.percent;
      case 'status': return CAMPAIGN_STATUSES.indexOf(r.status);
      case 'updatedAt': case 'createdAt': return r[field]?.getTime() ?? 0;
      default: return r[field]?.getTime() ?? null; // deadline / endDate / startDate: undated campaigns sort last in either direction
    }
  };
  items.sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    if (ka === null || kb === null) return ka === kb ? 0 : ka === null ? 1 : -1;
    const c = ka < kb ? -1 : ka > kb ? 1 : 0;
    return (desc ? -c : c) || a.raw.title.localeCompare(b.raw.title) || String(a.raw._id).localeCompare(String(b.raw._id));
  });

  const total = items.length;
  const page = items.slice((q.page - 1) * q.limit, q.page * q.limit);
  return {
    data: page.map(({ view }) => {
      const row = { ...view }; // list rows are summaries: drop the heavy detail fields
      for (const k of ['statusHistory', 'brief', 'objectives', 'requirements', 'review', 'notes', 'next', 'coverage']) delete row[k];
      return row;
    }),
    meta: { page: q.page, limit: q.limit, total, pages: Math.max(1, Math.ceil(total / q.limit)), needAttention: items.filter((i) => i.derived.flags.some((f) => f.severity !== 'info')).length },
  };
}

// ------------------------------------------------------------------ detail and relationships

/** Everything linked to a campaign, read THROUGH references (nothing is copied onto the campaign). */
async function linked(user, campaign, now) {
  const owner = oid(user.id);
  const cid = campaign._id;
  const tz = tzOf(user);
  const [y, m, d] = formatLocal(now, tz).date.split('-').map(Number);
  const todayStart = zonedMidnight(y, m, d, tz);
  const [content, tasks, communications, invoiceRows, totals] = await Promise.all([
    Content.find({ owner, campaign: cid }).select('title status type platforms plannedDate deadline archivedAt').sort({ updatedAt: -1 }).limit(100).lean(),
    Task.find({ owner, 'links.campaign': cid, archivedAt: null }).select('title status dueAt priority').sort({ dueAt: 1 }).limit(50).lean(),
    Communication.find({ owner, campaign: cid, archivedAt: null }).select('channel direction subject occurredAt client').sort({ occurredAt: -1 }).limit(20).lean(),
    invoicesWithPaid(owner, { campaign: cid }, 100),
    invoiceTotals(owner, todayStart, { campaign: cid }),
  ]);
  return {
    content: content.map((c) => ({ id: String(c._id), title: c.title, status: c.status, statusLabel: CONTENT_STATUS_LABELS[c.status], type: c.type, platforms: c.platforms ?? [], plannedDate: c.plannedDate ?? null, deadline: c.deadline ?? null, archived: !!c.archivedAt })),
    tasks: tasks.map((t) => ({ id: String(t._id), title: t.title, status: t.status, dueAt: t.dueAt ?? null, priority: t.priority, overdue: !!t.dueAt && t.dueAt < now && ['todo', 'doing'].includes(t.status) })),
    communications: communications.map((c) => ({ id: String(c._id), clientId: String(c.client), channel: c.channel, direction: c.direction, subject: c.subject ?? null, occurredAt: c.occurredAt })),
    invoices: invoiceRows.map((r) => {
      const balance = Math.max(0, r.totalMinor - r.paidMinor);
      const displayStatus = displayStatusOf(r, r.paidMinor, todayStart);
      return { id: String(r._id), number: r.number, status: r.status, displayStatus, currency: r.currency, totalMinor: r.totalMinor, paidMinor: r.paidMinor, balanceMinor: r.status === 'sent' ? balance : 0, issueDate: r.issueDate ?? null, dueDate: r.dueDate ?? null };
    }),
    invoiceTotals: totals.map((r) => ({ currency: r._id, invoiced: r.invoiced, collected: r.collected, outstanding: r.outstanding, overdue: r.overdue })).sort((a, b) => a.currency.localeCompare(b.currency)),
  };
}

export async function getCampaign(user, campaignId, now = new Date()) {
  const campaign = await findOwnedCampaign(user.id, campaignId);
  const [client, deliverables] = await Promise.all([
    Client.findOne({ _id: campaign.client, owner: user.id }).select('name archivedAt').lean(),
    Deliverable.find({ owner: user.id, campaign: campaign._id }).sort({ createdAt: 1 }),
  ]);
  const sorted = [...deliverables].sort((a, b) => (a.dueDate?.getTime() ?? Infinity) - (b.dueDate?.getTime() ?? Infinity) || a.createdAt - b.createdAt);
  const derived = derive(campaign, sorted, user, now);
  const contentById = await contentFor(user.id, sorted);
  const rel = await linked(user, campaign, now);
  const view = publicCampaign(campaign, user, client?.name, derived);
  return {
    ...view,
    client: { ...view.client, archived: !!client?.archivedAt },
    deliverables: sorted.map((d) => publicDeliverable(d, campaign, contentById, user, now)),
    linked: rel,
    counts: {
      deliverables: sorted.length, content: rel.content.length, tasks: rel.tasks.length, openTasks: rel.tasks.filter((t) => ['todo', 'doing'].includes(t.status)).length,
      communications: rel.communications.length, invoices: rel.invoices.length,
    },
  };
}

// ------------------------------------------------------------------ commands

/** Turns validated request input into model fields (days become local-midnight instants). */
function toFields(user, input) {
  const tz = tzOf(user);
  const out = {};
  for (const [key, value] of Object.entries(input)) {
    if (key === 'version') continue;
    if (['startDate', 'endDate', 'deadline'].includes(key)) out[key] = value ? dayToDate(value, tz) : undefined;
    else if (key === 'budget' || key === 'fee') out[key] = value ?? undefined;
    else if (key === 'brief' || key === 'notes') out[key] = value ?? undefined;
    else out[key] = value;
  }
  return out;
}

export async function createCampaign(user, input, now = new Date()) {
  await checkClient(user.id, input.client);
  const { review, ...rest } = toFields(user, input);
  const doc = new Campaign({ ...rest, ...(review && { review: { required: review.required, approverName: review.approverName ?? undefined, notes: review.notes ?? undefined } }), owner: user.id, status: 'proposed' });
  doc.statusHistory.push({ from: null, to: 'proposed', at: now });
  await save(doc);
  return getCampaign(user, doc._id, now);
}

export async function updateCampaign(user, campaignId, input, now = new Date()) {
  const doc = await findOwnedCampaign(user.id, campaignId);
  assertOpen(doc);
  if (input.version !== undefined && input.version !== (doc.__v ?? 0)) {
    throw new AppError(409, 'STALE_VERSION', 'This campaign was changed elsewhere since you opened it. Reload to see the latest version.', { currentVersion: doc.__v ?? 0 });
  }
  if (input.client && input.client !== String(doc.client)) {
    await checkClient(user.id, input.client);
    // Saved discussions and invoices belong to the brand the campaign was with; moving it would make them inconsistent.
    const [communications, invoices] = await Promise.all([
      Communication.countDocuments({ owner: user.id, campaign: doc._id }),
      Invoice.countDocuments({ owner: user.id, campaign: doc._id }),
    ]);
    if (communications || invoices) {
      throw new AppError(409, 'HAS_RELATED', 'This campaign has saved discussions or invoices with its current brand, so the brand cannot be changed.', { communications, invoices });
    }
  }

  const { review, ...rest } = toFields(user, input);
  for (const [key, value] of Object.entries(rest)) doc.set(key, value);
  if (review) for (const [k, v] of Object.entries(review)) doc.set(`review.${k}`, v ?? undefined);

  await save(doc);
  return getCampaign(user, doc._id, now);
}

/** Checks that stop a campaign from claiming more progress than its deliverables show. */
async function guardTransition(userId, campaign, to) {
  if (to !== 'delivered' && to !== 'completed') return;
  const open = await Deliverable.find({
    owner: userId,
    campaign: campaign._id,
    status: { $nin: to === 'delivered' ? ['completed', 'submitted', 'approved', 'delivered'] : ['delivered'] },
  }).select('title status').lean();
  if (!open.length) return;
  const need = to === 'delivered' ? 'finished' : 'published';
  throw new AppError(
    409,
    'OPEN_DELIVERABLES',
    `${plural(open.length, 'deliverable is', 'deliverables are')} not ${need} yet, so the campaign cannot be marked ${CAMPAIGN_STATUS_LABELS[to].toLowerCase()}.`,
    open.slice(0, 20).map((d) => ({ path: String(d._id), message: `${d.title} (${DELIVERABLE_STATUS_LABELS[d.status]})` })),
  );
}

export async function transitionCampaign(user, campaignId, { to, note }, now = new Date()) {
  const doc = await findOwnedCampaign(user.id, campaignId);
  assertOpen(doc);
  const from = doc.status;
  if (!(CAMPAIGN_TRANSITIONS[from] ?? []).includes(to)) {
    throw new AppError(409, 'INVALID_TRANSITION', `A ${CAMPAIGN_STATUS_LABELS[from].toLowerCase()} campaign cannot move to ${CAMPAIGN_STATUS_LABELS[to].toLowerCase()}.`, {
      allowed: CAMPAIGN_TRANSITIONS[from] ?? [],
    });
  }
  await guardTransition(user.id, doc, to);
  doc.status = to;
  doc.statusHistory.push({ from, to, at: now, ...(note && { note }) });
  await save(doc);
  return getCampaign(user, doc._id, now);
}

export async function setArchived(user, campaignId, archived, now = new Date()) {
  const doc = await findOwnedCampaign(user.id, campaignId);
  if (!!doc.archivedAt === archived) return { data: await getCampaign(user, doc._id, now), warnings: [] }; // idempotent
  const warnings = [];
  if (archived) {
    const [open, unpaid] = await Promise.all([
      Deliverable.countDocuments({ owner: user.id, campaign: doc._id, status: { $ne: 'delivered' } }),
      Invoice.countDocuments({ owner: user.id, campaign: doc._id, status: 'sent' }),
    ]);
    if (open && !CLOSED_CAMPAIGN.includes(doc.status)) warnings.push({ code: 'OPEN_DELIVERABLES', count: open, message: `${plural(open, 'deliverable is', 'deliverables are')} not published yet.` });
    if (unpaid) warnings.push({ code: 'SENT_INVOICES', count: unpaid, message: `${plural(unpaid, 'invoice is', 'invoices are')} still linked to this campaign.` });
  }
  doc.archivedAt = archived ? now : null;
  await save(doc);
  return { data: await getCampaign(user, doc._id, now), warnings };
}

/** Permanent deletion: archived first, and never while invoices still point at the campaign. */
export async function deleteCampaign(user, campaignId) {
  const doc = await findOwnedCampaign(user.id, campaignId);
  if (!doc.archivedAt) throw new AppError(409, 'NOT_ARCHIVED', 'Archive this campaign first, then delete it permanently.');
  const invoices = await Invoice.countDocuments({ owner: user.id, campaign: doc._id });
  if (invoices) {
    throw new AppError(409, 'HAS_RELATED', 'Invoices still point at this campaign. They must be removed first; archiving keeps the history.', { invoices });
  }
  const deliverables = await Deliverable.find({ owner: user.id, campaign: doc._id }).select('_id').lean();
  const dIds = deliverables.map((d) => d._id);
  // Linked records survive; they just lose the pointer.
  await Promise.all([
    Content.updateMany({ owner: user.id, campaign: doc._id }, { $set: { campaign: null } }),
    Communication.updateMany({ owner: user.id, campaign: doc._id }, { $set: { campaign: null } }),
    Task.updateMany({ owner: user.id, 'links.campaign': doc._id }, { $set: { 'links.campaign': null } }),
    dIds.length ? Task.updateMany({ owner: user.id, 'links.deliverable': { $in: dIds } }, { $set: { 'links.deliverable': null } }) : null,
  ]);
  await Deliverable.deleteMany({ owner: user.id, campaign: doc._id });
  await Campaign.deleteOne({ _id: doc._id, owner: user.id });
  return { deliverablesDeleted: dIds.length };
}

// ------------------------------------------------------------------ linking content

const recordLink = (userId, content, campaignTitle, from) =>
  ContentEvent.create({ owner: userId, content: content._id, type: 'updated', actor: userId, revision: content.revision, fields: [{ field: 'campaign', from, to: campaignTitle }] });

/**
 * Validates a content reference for a campaign: it must be the user's, not archived, not already attached to a different
 * campaign, and not already the content of another deliverable. Foreign and missing ids look the same.
 */
async function checkContent(userId, campaign, contentId, { exceptDeliverable } = {}) {
  const content = isObjectId(String(contentId)) ? await Content.findOne({ _id: contentId, owner: userId }) : null;
  if (!content) throw invalid('content', 'Content not found');
  if (content.archivedAt) throw invalid('content', 'This content is archived. Restore it before linking it.');
  if (content.campaign && String(content.campaign) !== String(campaign._id)) throw invalid('content', 'This content already belongs to another campaign');
  const taken = await Deliverable.exists({ owner: userId, content: content._id, ...(exceptDeliverable && { _id: { $ne: exceptDeliverable } }) });
  if (taken) throw new AppError(409, 'CONTENT_IN_USE', 'This content is already linked to another deliverable.');
  return content;
}

async function attachContent(userId, campaign, content) {
  if (content.campaign && String(content.campaign) === String(campaign._id)) return;
  await Content.updateOne({ _id: content._id, owner: userId }, { $set: { campaign: campaign._id } });
  await recordLink(userId, content, campaign.title, null);
}

export async function linkContent(user, campaignId, contentId, now = new Date()) {
  const campaign = await findOwnedCampaign(user.id, campaignId);
  assertOpen(campaign);
  const content = await checkContent(user.id, campaign, contentId);
  await attachContent(user.id, campaign, content);
  return getCampaign(user, campaign._id, now);
}

export async function unlinkContent(user, campaignId, contentId, now = new Date()) {
  const campaign = await findOwnedCampaign(user.id, campaignId);
  assertOpen(campaign);
  const content = isObjectId(String(contentId)) ? await Content.findOne({ _id: contentId, owner: user.id, campaign: campaign._id }) : null;
  if (!content) throw notFound('Content');
  if (await Deliverable.exists({ owner: user.id, campaign: campaign._id, content: content._id })) {
    throw new AppError(409, 'CONTENT_IN_USE', 'This content is attached to a deliverable. Detach it from the deliverable first.');
  }
  await Content.updateOne({ _id: content._id, owner: user.id }, { $set: { campaign: null } });
  await recordLink(user.id, content, null, campaign.title);
  return getCampaign(user, campaign._id, now);
}

// ------------------------------------------------------------------ deliverables

async function findDeliverable(userId, campaign, deliverableId) {
  const d = isObjectId(String(deliverableId)) ? await Deliverable.findOne({ _id: deliverableId, owner: userId, campaign: campaign._id }) : null;
  if (!d) throw notFound('Deliverable');
  return d;
}

async function deliverableView(user, campaign, d, now) {
  return publicDeliverable(d, campaign, await contentFor(user.id, [d]), user, now);
}

export async function createDeliverables(user, campaignId, input, now = new Date()) {
  const campaign = await findOwnedCampaign(user.id, campaignId);
  assertWorkable(campaign);
  const { quantity = 1, content: contentId, ...rest } = input;
  const content = contentId ? await checkContent(user.id, campaign, contentId) : null;
  const fields = toFields(user, rest);
  const created = [];
  for (let i = 1; i <= quantity; i++) {
    const doc = new Deliverable({
      ...fields,
      title: quantity > 1 ? `${rest.title} (${i}/${quantity})` : rest.title,
      requiresApproval: rest.requiresApproval ?? campaign.review?.required !== false,
      content: content?._id ?? null,
      owner: user.id,
      campaign: campaign._id,
    });
    created.push(await save(doc));
  }
  if (content) await attachContent(user.id, campaign, content);
  const contentById = await contentFor(user.id, created);
  return created.map((d) => publicDeliverable(d, campaign, contentById, user, now));
}

export async function updateDeliverable(user, campaignId, deliverableId, input, now = new Date()) {
  const campaign = await findOwnedCampaign(user.id, campaignId);
  assertWorkable(campaign);
  const d = await findDeliverable(user.id, campaign, deliverableId);
  if (input.version !== undefined && input.version !== (d.__v ?? 0)) {
    throw new AppError(409, 'STALE_VERSION', 'This deliverable was changed elsewhere since you opened it. Reload to see the latest version.', { currentVersion: d.__v ?? 0 });
  }
  if ('requiresApproval' in input && input.requiresApproval !== d.requiresApproval && ['submitted', 'approved', 'delivered'].includes(d.status)) {
    throw new AppError(409, 'INVALID_CHANGE', 'Approval rules cannot change once the deliverable has been submitted. Move it back first.');
  }
  const { content: contentId, ...rest } = input;
  for (const [key, value] of Object.entries(toFields(user, rest))) d.set(key, value);
  if (contentId !== undefined) {
    if (contentId === null) d.content = null;
    else if (String(d.content) !== contentId) {
      const content = await checkContent(user.id, campaign, contentId, { exceptDeliverable: d._id });
      d.content = content._id;
      await attachContent(user.id, campaign, content);
    }
  }
  await save(d);
  return deliverableView(user, campaign, d, now);
}

export async function transitionDeliverable(user, campaignId, deliverableId, { to, note }, now = new Date()) {
  const campaign = await findOwnedCampaign(user.id, campaignId);
  assertWorkable(campaign);
  const d = await findDeliverable(user.id, campaign, deliverableId);
  const from = d.status;
  const allowed = nextDeliverableStatuses(d);
  if (!allowed.includes(to)) {
    throw new AppError(409, 'INVALID_TRANSITION', `A deliverable that is "${DELIVERABLE_STATUS_LABELS[from]}" cannot move to "${DELIVERABLE_STATUS_LABELS[to]}".`, { allowed });
  }
  if (to === 'changes_requested' && !note) throw invalid('note', 'Say what needs to change');
  if (to === 'delivered' && d.content) {
    const content = await Content.findOne({ _id: d.content, owner: user.id }).select('status').lean();
    if (content && content.status !== 'published') {
      throw new AppError(409, 'CONTENT_NOT_PUBLISHED', `The linked content is still "${CONTENT_STATUS_LABELS[content.status]}". Publish it first, or detach it from this deliverable.`);
    }
  }

  d.status = to;
  const rank = DELIVERABLE_RANK[to];
  for (const [status, field] of Object.entries(DELIVERABLE_STAMPS)) {
    if (status === to) d[field] = now;
    else if (DELIVERABLE_RANK[status] > rank) d[field] = undefined; // moving back clears what no longer holds
  }
  if (to === 'changes_requested') {
    d.revisionCount = (d.revisionCount ?? 0) + 1;
    d.feedback = note;
  } else if (to === 'approved' || to === 'delivered') d.feedback = undefined;
  await save(d);
  return deliverableView(user, campaign, d, now);
}

export async function removeDeliverable(user, campaignId, deliverableId) {
  const campaign = await findOwnedCampaign(user.id, campaignId);
  assertWorkable(campaign);
  const d = await findDeliverable(user.id, campaign, deliverableId);
  await Task.updateMany({ owner: user.id, 'links.deliverable': d._id }, { $set: { 'links.deliverable': null } });
  await Deliverable.deleteOne({ _id: d._id, owner: user.id });
  return { ok: true };
}
