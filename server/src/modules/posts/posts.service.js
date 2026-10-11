import { env } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';
import { isObjectId, notFound } from '../../lib/scoped.js';
import { formatLocal, localToInstant } from '../../lib/timezone.js';
import { Campaign } from '../campaigns/campaign.model.js';
import { Category } from '../categories/category.model.js';
import { Client } from '../clients/client.model.js';
import { STATUS_LABELS } from '../content/content.constants.js';
import { ContentEvent } from '../content/content-event.model.js';
import { Content } from '../content/content.model.js';
import {
  ACTIVE_STATUSES,
  POST_TRANSITIONS,
  PUBLISHED_FUTURE_TOLERANCE_MS,
  SCHEDULE_TOLERANCE_MS,
  STAGES,
} from './post.constants.js';
import { Post } from './post.model.js';

const MIN_YEAR = 2000;
const MAX_YEAR = 2100;
const MIN_MS = Date.UTC(MIN_YEAR, 0, 1);
const MAX_MS = Date.UTC(MAX_YEAR, 0, 1);

const invalid = (path, message) => new AppError(400, 'VALIDATION_ERROR', 'Some fields are invalid', [{ path, message }]);
const tzOf = (user) => user.timezone || 'UTC';
/** The user's default reminder lead times, in the same order posts store them (longest lead first). */
const defaultOffsets = (user) => [...(user.calendarPrefs?.defaultReminderOffsets ?? [])].sort((a, b) => b - a);

// ------------------------------------------------------------------ time handling

/**
 * Reads the time a client sent. `scheduledAt` is an instant with an explicit offset; `scheduledLocal` is a wall-clock
 * time interpreted in the USER'S profile timezone. Returns { provided, at (Date | null), field, warnings }.
 */
export function resolveTime(input, tz) {
  const warnings = [];
  if (input.scheduledAt !== undefined) {
    const at = input.scheduledAt;
    if (at && (at.getTime() < MIN_MS || at.getTime() >= MAX_MS)) throw invalid('scheduledAt', `Choose a date between ${MIN_YEAR} and ${MAX_YEAR}`);
    return { provided: true, at, field: 'scheduledAt', warnings };
  }
  if (input.scheduledLocal !== undefined) {
    if (input.scheduledLocal === null) return { provided: true, at: null, field: 'scheduledLocal', warnings };
    const r = localToInstant(input.scheduledLocal, tz);
    if (!r.instant) {
      throw invalid(
        'scheduledLocal',
        r.reason === 'skipped'
          ? `That time does not exist in ${tz} on that date (the clocks change). Pick a different time.`
          : 'That is not a real date and time.',
      );
    }
    if (r.instant.getTime() < MIN_MS || r.instant.getTime() >= MAX_MS) throw invalid('scheduledLocal', `Choose a date between ${MIN_YEAR} and ${MAX_YEAR}`);
    if (r.ambiguous) {
      warnings.push({ code: 'AMBIGUOUS_LOCAL_TIME', message: `That time happens twice in ${tz} on that date (the clocks go back). The earlier one was used.` });
    }
    return { provided: true, at: r.instant, field: 'scheduledLocal', warnings };
  }
  return { provided: false, at: undefined, field: 'scheduledLocal', warnings };
}

function assertFuture(at, now, field) {
  if (at.getTime() < now.getTime() - SCHEDULE_TOLERANCE_MS) {
    throw invalid(field, 'A scheduled reminder must be in the future. Use Planned for a date that has already passed.');
  }
}

// ------------------------------------------------------------------ lookups & serialisation

export async function findOwnedPost(userId, id) {
  if (!isObjectId(String(id))) throw notFound('Post');
  const post = await Post.findOne({ _id: id, owner: userId });
  if (!post) throw notFound('Post');
  return post;
}

async function findContentFor(userId, contentId) {
  if (!isObjectId(String(contentId))) throw invalid('content', 'Content not found');
  const content = await Content.findOne({ _id: contentId, owner: userId });
  // Foreign and missing content give the SAME answer, so nothing leaks.
  if (!content) throw invalid('content', 'Content not found');
  return content;
}

/** Batch-loads the content summaries (and their category / campaign) for a set of posts. */
export async function contentSummaries(userId, contentIds) {
  const ids = [...new Set(contentIds.map(String))];
  if (!ids.length) return new Map();
  const contents = await Content.find({ _id: { $in: ids }, owner: userId })
    .select('title status category campaign platforms archivedAt deadline plannedDate')
    .lean();
  const catIds = [...new Set(contents.map((c) => c.category).filter(Boolean).map(String))];
  const campIds = [...new Set(contents.map((c) => c.campaign).filter(Boolean).map(String))];
  const [cats, camps] = await Promise.all([
    catIds.length ? Category.find({ _id: { $in: catIds }, owner: userId }).select('name color').lean() : [],
    campIds.length ? Campaign.find({ _id: { $in: campIds }, owner: userId }).select('title status client').lean() : [],
  ]);
  const clients = camps.length ? await Client.find({ _id: { $in: camps.map((c) => c.client) }, owner: userId }).select('name').lean() : [];
  const clientName = new Map(clients.map((c) => [String(c._id), c.name]));
  const catMap = new Map(cats.map((c) => [String(c._id), { id: String(c._id), name: c.name, color: c.color }]));
  const campMap = new Map(camps.map((c) => [String(c._id), { id: String(c._id), title: c.title, status: c.status, clientName: clientName.get(String(c.client)) ?? null }]));
  return new Map(
    contents.map((c) => [
      String(c._id),
      {
        id: String(c._id),
        title: c.title,
        status: c.status,
        statusLabel: STATUS_LABELS[c.status],
        approved: ['approved', 'published'].includes(c.status),
        archived: !!c.archivedAt,
        platforms: c.platforms ?? [],
        category: c.category ? (catMap.get(String(c.category)) ?? null) : null,
        campaign: c.campaign ? (campMap.get(String(c.campaign)) ?? null) : null,
      },
    ]),
  );
}

export function stageOf(post) {
  const base = STAGES[post.status];
  if (post.status === 'published' && post.verification === 'platform') {
    return { ...base, label: 'Published (platform confirmed)', description: 'The platform confirmed this post is live.' };
  }
  return base;
}

export function describeTransitions(status) {
  return (POST_TRANSITIONS[status] ?? []).map((to) => ({ to, label: STAGES[to].label }));
}

/** `p` is a plain object or a document; `summary` the linked content's summary (null if it is missing). */
export function toPublicPost(p, user, summary) {
  const o = p.toObject ? p.toObject() : p;
  const tz = tzOf(user);
  const local = o.scheduledAt ? formatLocal(o.scheduledAt, tz) : null;
  return {
    id: String(o._id),
    contentId: String(o.content),
    content: summary ?? null,
    platform: o.platform,
    status: o.status,
    stage: stageOf(o),
    scheduledAt: o.scheduledAt ?? null,
    localDate: local?.date ?? null, // the calendar day in the user's timezone
    localTime: local?.time ?? null,
    scheduledLocal: local?.local ?? null,
    timezone: tz,
    scheduledTimezone: o.scheduledTimezone ?? null,
    reminderOffsets: o.reminderOffsets ?? [],
    captionOverride: o.captionOverride ?? null,
    readyAt: o.readyAt ?? null,
    publishedAt: o.publishedAt ?? null,
    publishedUrl: o.publishedUrl ?? null,
    verification: o.verification ?? 'none',
    failureReason: o.failureReason ?? null,
    contentApproved: summary?.approved ?? false,
    transitions: describeTransitions(o.status),
    version: o.__v ?? 0, // send back on edits so a stale screen cannot overwrite a newer change
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
  };
}

async function present(user, post, warnings = []) {
  const summaries = await contentSummaries(user.id, [post.content]);
  return { data: toPublicPost(post, user, summaries.get(String(post.content))), warnings };
}

export async function presentMany(user, posts) {
  const summaries = await contentSummaries(user.id, posts.map((p) => p.content));
  return posts.map((p) => toPublicPost(p, user, summaries.get(String(p.content))));
}

// ------------------------------------------------------------------ guards

function checkVersion(post, version) {
  if (version !== undefined && version !== (post.__v ?? 0)) {
    throw new AppError(409, 'STALE_VERSION', 'This post was changed elsewhere since you opened it. Reload to see the latest version.', {
      currentVersion: post.__v ?? 0,
    });
  }
}

const duplicate = (existing) =>
  new AppError(409, 'DUPLICATE_POST', 'This content already has an active post on this platform. Edit that one, or cancel it first.', {
    postId: existing ? String(existing._id) : undefined,
  });

async function assertNoDuplicate(userId, contentId, platform, excludeId) {
  const existing = await Post.findOne({
    owner: userId,
    content: contentId,
    platform,
    active: true,
    ...(excludeId && { _id: { $ne: excludeId } }),
  }).select('_id');
  if (existing) throw duplicate(existing);
}

/** Two reminders for the same platform within the conflict window need an explicit "schedule anyway". */
async function assertNoNearby(userId, platform, at, excludeId, confirm) {
  const windowMs = env.CALENDAR_CONFLICT_WINDOW_MINUTES * 60_000;
  if (!windowMs || confirm) return;
  const near = await Post.find({
    owner: userId,
    platform,
    status: { $in: ['scheduled', 'awaiting_confirmation'] },
    scheduledAt: { $gt: new Date(at.getTime() - windowMs), $lt: new Date(at.getTime() + windowMs) },
    ...(excludeId && { _id: { $ne: excludeId } }),
  })
    .limit(5)
    .lean();
  if (!near.length) return;
  const titles = await contentSummaries(userId, near.map((n) => n.content));
  throw new AppError(
    409,
    'SCHEDULE_CONFLICT',
    `Another ${platform} post is scheduled within ${env.CALENDAR_CONFLICT_WINDOW_MINUTES} minutes of this time.`,
    {
      windowMinutes: env.CALENDAR_CONFLICT_WINDOW_MINUTES,
      conflicts: near.map((n) => ({
        postId: String(n._id),
        contentId: String(n.content),
        title: titles.get(String(n.content))?.title ?? 'Untitled',
        scheduledAt: n.scheduledAt,
        minutesApart: Math.round(Math.abs(n.scheduledAt - at) / 60_000),
      })),
    },
  );
}

async function save(post) {
  try {
    return await post.save();
  } catch (err) {
    if (err.code === 11000) throw duplicate(await Post.findOne({ owner: post.owner, content: post.content, platform: post.platform, active: true, _id: { $ne: post._id } }).select('_id'));
    if (err.name === 'VersionError') throw new AppError(409, 'CONFLICT', 'This post was changed elsewhere. Reload and try again.');
    if (err.name === 'ValidationError') {
      throw new AppError(400, 'VALIDATION_ERROR', 'Some fields are invalid', Object.values(err.errors).map((e) => ({ path: e.path, message: e.message })));
    }
    throw err;
  }
}

/** Calendar activity also appears in the content's own history, so every entry is traceable from its content. */
async function recordEvent(userId, content, type, data = {}) {
  await ContentEvent.create({ owner: userId, content: content._id ?? content, type, revision: content.revision ?? 0, actor: userId, ...data });
}

// ------------------------------------------------------------------ commands

export async function createPost(user, input, now = new Date()) {
  const tz = tzOf(user);
  const content = await findContentFor(user.id, input.content);
  if (content.archivedAt) throw new AppError(409, 'ARCHIVED', 'Restore this content before adding it to the calendar');

  const time = resolveTime(input, tz);
  const status = input.status ?? 'planned';
  if (status === 'scheduled') {
    if (!time.at) throw invalid(time.field, 'Choose a date and time for the reminder');
    assertFuture(time.at, now, time.field);
  }
  await assertNoDuplicate(user.id, content._id, input.platform);
  if (status === 'scheduled') await assertNoNearby(user.id, input.platform, time.at, null, input.confirmConflict);

  const post = new Post({
    owner: user.id,
    content: content._id,
    platform: input.platform,
    status,
    captionOverride: input.captionOverride ?? undefined,
    scheduledAt: time.at ?? undefined,
    scheduledTimezone: time.at ? tz : undefined,
    reminderOffsets: status === 'scheduled' ? (input.reminderOffsets ?? defaultOffsets(user)) : (input.reminderOffsets ?? []),
    statusChangedAt: now,
  });
  await save(post);
  await recordEvent(user.id, content, 'post_created', { to: status, comment: input.platform, fields: time.at ? [{ field: 'scheduledAt', from: null, to: time.at.toISOString() }] : [] });
  return present(user, post, time.warnings);
}

export async function getPost(user, id) {
  return present(user, await findOwnedPost(user.id, id));
}

export async function listPosts(user, { content, status, limit }) {
  const where = { owner: user.id };
  if (content) where.content = content;
  if (status?.length) where.status = { $in: status };
  const posts = await Post.find(where).sort({ scheduledAt: 1, createdAt: 1 }).limit(limit).lean();
  return presentMany(user, posts);
}

export async function updatePost(user, id, input, now = new Date()) {
  const tz = tzOf(user);
  const post = await findOwnedPost(user.id, id);
  checkVersion(post, input.version);

  if (post.status === 'cancelled') throw new AppError(409, 'POST_CANCELLED', 'This post is cancelled. Reopen it (move it to Planned) before editing.');
  if (post.status === 'published') {
    const blocked = Object.keys(input).filter((k) => !['publishedUrl', 'version'].includes(k));
    if (blocked.length) {
      throw new AppError(409, 'POST_LOCKED', 'A published post cannot be rescheduled or changed. Only its link can be edited.', blocked.map((p) => ({ path: p, message: 'Locked after publication' })));
    }
  } else if (input.publishedUrl !== undefined) {
    throw invalid('publishedUrl', 'The published link can only be set once the post is marked as published');
  }

  const content = await Content.findOne({ _id: post.content, owner: user.id }).select('revision archivedAt status');
  if (content?.archivedAt && post.status !== 'published') throw new AppError(409, 'ARCHIVED', 'This content is archived. Restore it to change its calendar entries.');

  const time = resolveTime(input, tz);
  const before = post.scheduledAt ? post.scheduledAt.toISOString() : null;
  const beforeStatus = post.status;

  if (time.provided && time.at === null && post.status !== 'planned') {
    throw invalid(time.field, 'Only a planned post can be left without a date. Move it to Planned first.');
  }

  let nextStatus = post.status;
  if (time.provided && time.at && ['awaiting_confirmation', 'missed', 'failed'].includes(post.status)) nextStatus = 'scheduled'; // a new time re-arms it
  if (time.provided && time.at && ['scheduled', 'awaiting_confirmation', 'missed', 'failed'].includes(nextStatus)) assertFuture(time.at, now, time.field);

  const platform = input.platform ?? post.platform;
  const at = time.provided ? time.at : post.scheduledAt;
  if (platform !== post.platform) await assertNoDuplicate(user.id, post.content, platform, post._id);
  if (['scheduled', 'awaiting_confirmation'].includes(nextStatus) && at && (time.provided || platform !== post.platform)) {
    await assertNoNearby(user.id, platform, at, post._id, input.confirmConflict);
  }

  if (time.provided) {
    post.scheduledAt = time.at ?? undefined;
    post.scheduledTimezone = time.at ? tz : undefined;
    if (nextStatus !== post.status) {
      post.status = nextStatus;
      post.readyAt = undefined;
      post.statusChangedAt = now;
    }
  }
  if (input.platform) post.platform = input.platform;
  if (input.reminderOffsets) post.reminderOffsets = input.reminderOffsets;
  if (input.captionOverride !== undefined) post.captionOverride = input.captionOverride ?? undefined;
  if (input.publishedUrl !== undefined) post.publishedUrl = input.publishedUrl ?? undefined;

  await save(post);

  const after = post.scheduledAt ? post.scheduledAt.toISOString() : null;
  if (content && before !== after) {
    await recordEvent(user.id, content, 'post_rescheduled', { comment: post.platform, fields: [{ field: 'scheduledAt', from: before, to: after }] });
  }
  if (content && beforeStatus !== post.status) {
    await recordEvent(user.id, content, 'post_status_changed', { from: beforeStatus, to: post.status, comment: post.platform });
  }
  return present(user, post, time.warnings);
}

export async function transitionPost(user, id, body, now = new Date()) {
  const tz = tzOf(user);
  const post = await findOwnedPost(user.id, id);
  checkVersion(post, body.version);

  const from = post.status;
  const to = body.to;
  const allowed = POST_TRANSITIONS[from];
  if (!allowed.includes(to)) {
    throw new AppError(409, 'INVALID_TRANSITION', `A ${STAGES[from].label.toLowerCase()} post cannot move to ${STAGES[to].label.toLowerCase()}.`, { from, to, allowed });
  }

  const content = await Content.findOne({ _id: post.content, owner: user.id });
  if (!content) throw notFound('Content');
  if (content.archivedAt && ['planned', 'scheduled', 'awaiting_confirmation'].includes(to)) {
    throw new AppError(409, 'ARCHIVED', 'This content is archived. Restore it before scheduling.');
  }

  const time = resolveTime(body, tz);
  if (to !== 'published' && (body.publishedAt || body.publishedLocal || body.publishedUrl)) throw invalid('publishedAt', 'Publication details only apply when marking a post as published');
  if (!['scheduled', 'planned'].includes(to) && time.provided) throw invalid(time.field, 'A date and time only apply when scheduling or planning');
  if (to !== 'scheduled' && body.reminderOffsets) throw invalid('reminderOffsets', 'Reminders only apply when scheduling');

  const warnings = [...time.warnings];
  switch (to) {
    case 'scheduled': {
      const at = time.provided ? time.at : post.scheduledAt;
      if (!at) throw invalid(time.field, 'Choose a date and time for the reminder');
      assertFuture(at, now, time.field);
      await assertNoDuplicate(user.id, post.content, post.platform, post._id);
      await assertNoNearby(user.id, post.platform, at, post._id, body.confirmConflict);
      post.scheduledAt = at;
      post.scheduledTimezone = tzOf(user);
      post.readyAt = undefined;
      post.reminderOffsets = body.reminderOffsets ?? (post.reminderOffsets.length ? post.reminderOffsets : defaultOffsets(user));
      break;
    }
    case 'planned':
      if (time.provided) {
        post.scheduledAt = time.at ?? undefined;
        post.scheduledTimezone = time.at ? tz : undefined;
      }
      post.readyAt = undefined;
      await assertNoDuplicate(user.id, post.content, post.platform, post._id);
      break;
    case 'awaiting_confirmation':
      post.readyAt = now;
      break;
    case 'published': {
      let publishedAt = body.publishedAt;
      let field = 'publishedAt';
      if (body.publishedLocal !== undefined) {
        field = 'publishedLocal';
        const r = localToInstant(body.publishedLocal, tz);
        if (!r.instant) throw invalid(field, r.reason === 'skipped' ? `That time does not exist in ${tz} on that date (the clocks change).` : 'That is not a real date and time.');
        if (r.ambiguous) warnings.push({ code: 'AMBIGUOUS_LOCAL_TIME', message: `That time happens twice in ${tz} on that date. The earlier one was used.` });
        publishedAt = r.instant;
      }
      if (!publishedAt) throw invalid(field, 'When did it go live? This must be a time you actually posted it.');
      if (publishedAt.getTime() > now.getTime() + PUBLISHED_FUTURE_TOLERANCE_MS) {
        throw invalid(field, 'The publication time cannot be in the future. Scheduling is a reminder; "published" means it is already live.');
      }
      if (!['approved', 'published'].includes(content.status)) {
        throw new AppError(422, 'CONTENT_NOT_APPROVED', `The content is still "${STATUS_LABELS[content.status]}". Approve it before marking a post as published.`);
      }
      post.publishedAt = publishedAt;
      post.verification = 'manual'; // declared by the user; CMS did not check the platform
      if (body.publishedUrl) post.publishedUrl = body.publishedUrl;
      break;
    }
    default:
      break; // missed, cancelled
  }

  post.status = to;
  post.statusChangedAt = now;
  await save(post);
  await recordEvent(user.id, content, 'post_status_changed', { from, to, comment: post.platform });
  return present(user, post, warnings);
}

export async function deletePost(user, id) {
  const post = await findOwnedPost(user.id, id);
  if (post.status === 'published') throw new AppError(409, 'POST_LOCKED', 'A published post is part of your record and cannot be deleted.');
  const content = await Content.findOne({ _id: post.content, owner: user.id }).select('revision');
  await Post.deleteOne({ _id: post._id, owner: user.id });
  if (content) await recordEvent(user.id, content, 'post_status_changed', { from: post.status, to: 'deleted', comment: post.platform });
}

export { ACTIVE_STATUSES };
