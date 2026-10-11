import mongoose from 'mongoose';
import { AppError } from '../../lib/errors.js';
import { isObjectId, notFound } from '../../lib/scoped.js';
import { getStorage } from '../../integrations/storage/index.js';
import { Category } from '../categories/category.model.js';
import { Campaign } from '../campaigns/campaign.model.js';
import { Client } from '../clients/client.model.js';
import { MediaAsset, toPublicAsset } from '../media/media-asset.model.js';
import { Post } from '../posts/post.model.js';
import { Task } from '../tasks/task.model.js';
import {
  PUBLISHED_EDITABLE,
  REVIEW_EVENT_TYPES,
  STATUS_LABELS,
  TRACKED_SHORT_FIELDS,
  TRACKED_TEXT_FIELDS,
  TRANSITIONS,
} from './content.constants.js';
import { ContentEvent } from './content-event.model.js';
import { Content } from './content.model.js';

const FUTURE_TOLERANCE_MS = 5 * 60_000; // clock skew allowance when declaring a publication time
const DAY_MS = 24 * 60 * 60 * 1000;
const deadlineEnd = (d) => (d.getTime() % DAY_MS === 0 ? new Date(d.getTime() + DAY_MS) : d);
const oid = (id) => new mongoose.Types.ObjectId(String(id));
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const invalid = (path, message) => new AppError(400, 'VALIDATION_ERROR', 'Some fields are invalid', [{ path, message }]);

// ------------------------------------------------------------------ helpers

async function findOwned(userId, id) {
  if (!isObjectId(String(id))) throw notFound('Content');
  const doc = await Content.findOne({ _id: id, owner: userId });
  if (!doc) throw notFound('Content');
  return doc;
}

/** A reference to the user's own category/campaign. Foreign and missing ids give the SAME answer (nothing leaks). */
async function checkRefs(userId, { category, campaign }) {
  if (category) {
    if (!(await Category.exists({ _id: category, owner: userId }))) throw invalid('category', 'Category not found');
  }
  if (campaign) {
    if (!(await Campaign.exists({ _id: campaign, owner: userId }))) throw invalid('campaign', 'Campaign not found');
  }
}

const save = async (doc) => {
  try {
    return await doc.save();
  } catch (err) {
    if (err.name === 'VersionError') throw new AppError(409, 'CONFLICT', 'This content was changed elsewhere. Reload and try again.');
    if (err.name === 'ValidationError') {
      const details = Object.values(err.errors).map((e) => ({ path: e.path, message: e.message }));
      throw new AppError(400, 'VALIDATION_ERROR', 'Some fields are invalid', details);
    }
    throw err;
  }
};

const record = (ctx, contentDoc, type, data = {}) =>
  ContentEvent.create({ owner: ctx.userId, content: contentDoc._id, type, revision: contentDoc.revision, actor: ctx.userId, ...data });

const norm = (v) => {
  if (v instanceof Date) return v.getTime();
  if (Array.isArray(v)) return JSON.stringify(v.map((x) => (x?._id ?? x)?.toString?.() ?? x));
  if (v && typeof v === 'object' && v._bsontype) return String(v);
  return v ?? null;
};
const display = (v) => {
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.map(String);
  if (v && typeof v === 'object' && v._bsontype) return String(v);
  return v ?? null;
};

export function describeTransitions(status) {
  return (TRANSITIONS[status] ?? []).map((to) => ({
    to,
    label: STATUS_LABELS[to],
    kind: status === 'review' && to === 'creation' ? 'reject' : to === 'published' ? 'publish' : status === 'approved' && to === 'review' ? 'reopen' : to === 'idea' || (status === 'creation' && to === 'planning') ? 'back' : 'advance',
    requiresComment: status === 'review' && to === 'creation',
    requiresPublication: to === 'published',
  }));
}

// ------------------------------------------------------------------ serialisation

async function lookups(userId, docs) {
  const catIds = [...new Set(docs.map((d) => d.category).filter(Boolean).map(String))];
  const campIds = [...new Set(docs.map((d) => d.campaign).filter(Boolean).map(String))];
  const [cats, camps] = await Promise.all([
    catIds.length ? Category.find({ _id: { $in: catIds }, owner: userId }).select('name color').lean() : [],
    campIds.length ? Campaign.find({ _id: { $in: campIds }, owner: userId }).select('title status client').lean() : [],
  ]);
  const clients = camps.length ? await Client.find({ _id: { $in: camps.map((c) => c.client) }, owner: userId }).select('name').lean() : [];
  const clientName = new Map(clients.map((c) => [String(c._id), c.name]));
  return {
    category: new Map(cats.map((c) => [String(c._id), { id: String(c._id), name: c.name, color: c.color }])),
    campaign: new Map(camps.map((c) => [String(c._id), { id: String(c._id), title: c.title, status: c.status, clientName: clientName.get(String(c.client)) ?? null }])),
  };
}

const base = (d, lk, now) => ({
  id: String(d._id),
  title: d.title,
  description: d.description ?? null,
  type: d.type,
  status: d.status,
  statusLabel: STATUS_LABELS[d.status],
  platforms: d.platforms ?? [],
  tags: d.tags ?? [],
  category: d.category ? (lk.category.get(String(d.category)) ?? null) : null,
  campaign: d.campaign ? (lk.campaign.get(String(d.campaign)) ?? null) : null,
  plannedDate: d.plannedDate ?? null,
  deadline: d.deadline ?? null,
  publishedAt: d.publishedAt ?? null,
  publishedUrl: d.publishedUrl ?? null,
  revision: d.revision ?? 0,
  // Past its deadline and not yet signed off. A date-only deadline (stored as 00:00 UTC) lasts until the end of that day.
  isOverdue: !!d.deadline && deadlineEnd(d.deadline) < now && !['approved', 'published'].includes(d.status),
  archived: !!d.archivedAt,
  createdAt: d.createdAt,
  updatedAt: d.updatedAt,
});

export async function toDetail(userId, doc, now = new Date()) {
  const d = doc.toObject ? doc.toObject() : doc;
  const [lk, assets] = await Promise.all([lookups(userId, [d]), MediaAsset.find({ owner: userId, content: d._id }).sort({ createdAt: 1 }).lean()]);
  return {
    ...base(d, lk, now),
    caption: d.caption ?? null,
    hashtags: d.hashtags ?? [],
    brief: d.brief ?? null,
    approval: d.approval?.approvedAt
      ? { approvedAt: d.approval.approvedAt, approverName: d.approval.approverName ?? null, revision: d.approval.revision, isCurrent: d.approval.revision === d.revision }
      : null,
    publishedVerification: d.publishedVerification ?? null,
    assets: assets.map(toPublicAsset),
    transitions: d.archivedAt ? [] : describeTransitions(d.status),
    editableFields: d.status === 'published' ? PUBLISHED_EDITABLE : 'all',
  };
}

// ------------------------------------------------------------------ queries

export async function listContent(userId, q, now = new Date()) {
  const where = { owner: oid(userId), archivedAt: q.archived ? { $ne: null } : null };
  if (q.status?.length) where.status = { $in: q.status };
  if (q.type?.length) where.type = { $in: q.type };
  if (q.platform) where.platforms = q.platform;
  if (q.category) where.category = oid(q.category);
  if (q.campaign) where.campaign = oid(q.campaign);
  if (q.tag) where.tags = q.tag;
  if (q.q) {
    const rx = new RegExp(escapeRegex(q.q), 'i'); // user text is escaped: it can never be a regex
    where.$or = [{ title: rx }, { description: rx }, { caption: rx }, { brief: rx }, { tags: rx }, { hashtags: rx }];
  }

  const desc = q.sort.startsWith('-');
  const field = q.sort.replace(/^-/, '');
  const dir = desc ? -1 : 1;
  const sortField = field === 'status' ? 'statusRank' : field;
  const pipeline = [{ $match: where }];
  if (['deadline', 'plannedDate'].includes(field)) {
    // Items without a date always sort last, in either direction.
    pipeline.push({ $addFields: { _k: { $ifNull: [`$${field}`, desc ? new Date(0) : new Date('9999-12-31') ] } } });
    pipeline.push({ $sort: { _k: dir, _id: 1 } });
  } else {
    pipeline.push({ $sort: { [sortField]: dir, _id: 1 } });
  }
  pipeline.push({ $skip: (q.page - 1) * q.limit }, { $limit: q.limit });

  const [total, rows] = await Promise.all([Content.countDocuments(where), Content.aggregate(pipeline)]);
  const [lk, counts] = await Promise.all([
    lookups(userId, rows),
    rows.length
      ? MediaAsset.aggregate([{ $match: { owner: oid(userId), content: { $in: rows.map((r) => r._id) } } }, { $group: { _id: '$content', n: { $sum: 1 } } }])
      : [],
  ]);
  const assetCount = new Map(counts.map((c) => [String(c._id), c.n]));

  return {
    data: rows.map((r) => ({ ...base(r, lk, now), assetCount: assetCount.get(String(r._id)) ?? 0 })),
    meta: { page: q.page, limit: q.limit, total, pages: Math.max(1, Math.ceil(total / q.limit)) },
  };
}

export async function getContent(userId, id) {
  return toDetail(userId, await findOwned(userId, id));
}

export async function listHistory(userId, id, { type, limit = 50, before } = {}) {
  const doc = await findOwned(userId, id);
  const where = { owner: userId, content: doc._id };
  if (type === 'reviews') where.type = { $in: REVIEW_EVENT_TYPES };
  // Cursor = "<createdAt ms>_<event id>": events created in the same millisecond must not be skipped or repeated.
  const cursor = /^(\d{1,15})_([0-9a-f]{24})$/.exec(before ?? '');
  if (cursor) {
    const at = new Date(Number(cursor[1]));
    where.$or = [{ createdAt: { $lt: at } }, { createdAt: at, _id: { $lt: oid(cursor[2]) } }];
  }
  const rows = await ContentEvent.find(where).sort({ createdAt: -1, _id: -1 }).limit(limit + 1).lean();
  const more = rows.length > limit;
  return {
    data: rows.slice(0, limit).map((e) => ({
      id: String(e._id), type: e.type, from: e.from ?? null, to: e.to ?? null, fields: e.fields ?? [], comment: e.comment ?? null,
      revision: e.revision ?? 0, createdAt: e.createdAt, byYou: String(e.actor) === String(userId),
    })),
    meta: { hasMore: more, next: more ? `${rows[limit - 1].createdAt.getTime()}_${rows[limit - 1]._id}` : null },
  };
}

// ------------------------------------------------------------------ commands

export async function createContent(userId, input) {
  await checkRefs(userId, input);
  const doc = await save(new Content({ ...input, owner: userId })); // status starts at "idea"; it can only move via transitions
  await record({ userId }, doc, 'created');
  return toDetail(userId, doc);
}

export async function updateContent(userId, id, input) {
  const doc = await findOwned(userId, id);
  if (doc.archivedAt) throw new AppError(409, 'ARCHIVED', 'Restore this content before editing it');

  if (doc.status === 'published') {
    const blocked = Object.keys(input).filter((k) => !PUBLISHED_EDITABLE.includes(k));
    if (blocked.length) {
      throw new AppError(409, 'CONTENT_LOCKED', `Published content is locked. Only ${PUBLISHED_EDITABLE.join(' and ')} can still be changed.`, blocked.map((p) => ({ path: p, message: 'Locked after publication' })));
    }
  } else if ('publishedUrl' in input) {
    throw invalid('publishedUrl', 'The published link can only be set when marking content as published');
  }

  await checkRefs(userId, input);

  const changes = [];
  for (const [key, value] of Object.entries(input)) {
    if (norm(doc[key]) === norm(value)) continue;
    const longText = ['description', 'caption', 'brief'].includes(key);
    if (TRACKED_SHORT_FIELDS.includes(key) || TRACKED_TEXT_FIELDS.includes(key)) {
      changes.push(longText ? { field: key } : { field: key, from: display(doc[key]), to: display(value) });
    }
    doc[key] = value;
  }
  if (!changes.length && !doc.isModified()) return toDetail(userId, doc);

  await save(doc);
  if (changes.length) await record({ userId }, doc, 'updated', { fields: changes });
  return toDetail(userId, doc);
}

export async function transitionContent(userId, id, body, now = new Date()) {
  const doc = await findOwned(userId, id);
  if (doc.archivedAt) throw new AppError(409, 'ARCHIVED', 'Restore this content before changing its status');

  const from = doc.status;
  const to = body.to;
  const allowed = TRANSITIONS[from];
  if (!allowed.includes(to)) {
    throw new AppError(409, 'INVALID_TRANSITION', `Content cannot move from ${STATUS_LABELS[from]} to ${STATUS_LABELS[to]}.`, {
      from, to, allowed,
    });
  }

  const isReject = from === 'review' && to === 'creation';
  const isApprove = to === 'approved';
  const isPublish = to === 'published';
  const comment = body.comment || undefined;

  if (!isPublish && (body.publishedAt || body.publishedUrl)) throw invalid('publishedAt', 'Publication details only apply when marking content as published');
  if (!isApprove && body.approverName) throw invalid('approverName', 'Only used when approving');
  if (isReject && (!comment || comment.length < 3)) throw invalid('comment', 'Explain what needs to change (at least 3 characters)');

  // Quality gate: something must exist to review.
  if (from === 'creation' && to === 'review') {
    const hasAsset = await MediaAsset.exists({ owner: userId, content: doc._id });
    if (!doc.caption?.trim() && !hasAsset) {
      throw new AppError(422, 'TRANSITION_BLOCKED', 'Add a caption or at least one asset before sending for review.', [{ path: 'caption', message: 'Caption or asset required' }]);
    }
  }

  const fields = [];
  if (isPublish) {
    if (!doc.approval?.approvedAt || doc.approval.revision !== doc.revision) {
      throw new AppError(422, 'TRANSITION_BLOCKED', 'Only approved content can be published.');
    }
    if (!body.publishedAt) throw invalid('publishedAt', 'When was it published? This must be a time you actually posted it.');
    if (body.publishedAt.getTime() > now.getTime() + FUTURE_TOLERANCE_MS) {
      throw invalid('publishedAt', 'Publication time cannot be in the future. Scheduling is tracked in Calendar; "published" means it is already live.');
    }
    doc.publishedAt = body.publishedAt;
    doc.publishedVerification = 'manual'; // declared by the user, not confirmed by a platform
    if (body.publishedUrl) doc.publishedUrl = body.publishedUrl;
    fields.push({ field: 'publishedAt', from: null, to: body.publishedAt.toISOString() });
  }

  let type = 'status_changed';
  if (isReject) {
    doc.revision += 1; // a new revision starts: the previous approval (if any) no longer applies
    doc.approval = undefined;
    type = 'changes_requested';
  } else if (isApprove) {
    doc.approval = { approvedAt: now, approvedBy: userId, approverName: body.approverName, revision: doc.revision };
    type = 'approved';
  } else if (from === 'approved' && to === 'review') {
    doc.approval = undefined; // re-opened: sign-off withdrawn
  }

  doc.status = to;
  await save(doc);
  await record({ userId }, doc, type, { from, to, comment, fields });
  return toDetail(userId, doc, now);
}

export async function addComment(userId, id, { comment }) {
  const doc = await findOwned(userId, id);
  await record({ userId }, doc, 'comment', { comment });
  return { ok: true };
}

export async function setArchived(userId, id, archived) {
  const doc = await findOwned(userId, id);
  if (!!doc.archivedAt === archived) return toDetail(userId, doc); // idempotent
  doc.archivedAt = archived ? new Date() : null;
  await save(doc);
  await record({ userId }, doc, archived ? 'archived' : 'restored');
  return toDetail(userId, doc);
}

/** Permanent deletion. Must be archived first (a deliberate two-step), and cannot orphan calendar posts. */
export async function deleteContent(userId, id) {
  const doc = await findOwned(userId, id);
  if (!doc.archivedAt) throw new AppError(409, 'NOT_ARCHIVED', 'Archive this content first, then delete it permanently.');
  if (await Post.exists({ owner: userId, content: doc._id })) {
    throw new AppError(409, 'HAS_POSTS', 'This content has calendar posts. Remove them first.');
  }

  // Files first: if storage fails we stop with the database intact, so nothing is orphaned or half-deleted.
  const storage = await getStorage();
  const assets = await MediaAsset.find({ owner: userId, content: doc._id });
  for (const asset of assets) {
    try {
      await storage.remove(asset);
    } catch {
      throw new AppError(502, 'STORAGE_ERROR', 'Could not delete the stored files. Nothing was deleted; try again.');
    }
  }
  await MediaAsset.deleteMany({ owner: userId, content: doc._id });
  await ContentEvent.deleteMany({ owner: userId, content: doc._id });
  await Task.updateMany({ owner: userId, 'links.content': doc._id }, { $set: { 'links.content': null } });
  await Content.deleteOne({ _id: doc._id, owner: userId });
}
