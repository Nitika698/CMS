import mongoose from 'mongoose';
import { AppError } from '../../lib/errors.js';
import { isObjectId, notFound } from '../../lib/scoped.js';
import { formatLocal, localToInstant, zonedMidnight } from '../../lib/timezone.js';
import { Campaign } from '../campaigns/campaign.model.js';
import { Client } from '../clients/client.model.js';
import { Content } from '../content/content.model.js';
import {
  DUE_FILTERS, OPEN_TASK, TASK_PRIORITIES, TASK_PRIORITY_LABELS, TASK_STATUSES, TASK_STATUS_LABELS, UPCOMING_DAYS,
} from './task.constants.js';
import { daysFromToday, dueState, dueWindows, overdueQuery, todayQuery, upcomingQuery } from './task.logic.js';
import { Task } from './task.model.js';

const oid = (id) => new mongoose.Types.ObjectId(String(id));
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const tzOf = (user) => user.timezone || 'UTC';
const invalid = (path, message) => new AppError(400, 'VALIDATION_ERROR', 'Some fields are invalid', [{ path, message }]);
const id = (v) => (v ? String(v) : null);

export function taskMeta() {
  return {
    statuses: TASK_STATUSES.map((key) => ({ key, label: TASK_STATUS_LABELS[key], open: OPEN_TASK.includes(key) })),
    priorities: TASK_PRIORITIES.map((key) => ({ key, label: TASK_PRIORITY_LABELS[key] })),
    dueFilters: DUE_FILTERS,
    upcomingDays: UPCOMING_DAYS,
  };
}

// ------------------------------------------------------------------ presentation

/** Names of the linked records, looked up with the owner filter so a stray id can never leak another user's data. */
async function linkNames(userId, rows) {
  const pick = (k) => [...new Set(rows.map((r) => r.links?.[k]).filter(Boolean).map(String))];
  const [camps, clients, contents] = await Promise.all([
    pick('campaign').length ? Campaign.find({ _id: { $in: pick('campaign') }, owner: userId }).select('title').lean() : [],
    pick('client').length ? Client.find({ _id: { $in: pick('client') }, owner: userId }).select('name').lean() : [],
    pick('content').length ? Content.find({ _id: { $in: pick('content') }, owner: userId }).select('title').lean() : [],
  ]);
  return {
    campaign: new Map(camps.map((c) => [String(c._id), c.title])),
    client: new Map(clients.map((c) => [String(c._id), c.name])),
    content: new Map(contents.map((c) => [String(c._id), c.title])),
  };
}

function view(t, user, names, now) {
  const tz = tzOf(user);
  const local = t.dueAt ? formatLocal(t.dueAt, tz) : null;
  const state = dueState(t, now, tz);
  const link = (k, label) => (t.links?.[k] && names[k].has(String(t.links[k])) ? { id: String(t.links[k]), [label]: names[k].get(String(t.links[k])) } : null);
  return {
    id: String(t._id),
    title: t.title,
    description: t.description ?? null,
    status: t.status,
    statusLabel: TASK_STATUS_LABELS[t.status],
    priority: t.priority,
    priorityLabel: TASK_PRIORITY_LABELS[t.priority],
    dueAt: t.dueAt ?? null,
    dueDate: local?.date ?? null,
    dueTime: t.dueHasTime && local ? local.time : null,
    dueHasTime: !!t.dueHasTime,
    dueState: state, // overdue | today | upcoming | none | closed
    overdue: state === 'overdue',
    daysUntilDue: t.dueAt ? daysFromToday(now, t.dueAt, tz) : null,
    remindOffsets: t.remindOffsets ?? [],
    completedAt: t.completedAt ?? null,
    assignee: t.assignee && String(t.assignee) === String(user.id) ? { id: String(user.id), name: user.name ?? null } : null,
    links: { campaign: link('campaign', 'title'), client: link('client', 'name'), content: link('content', 'title') },
    archivedAt: t.archivedAt ?? null,
    version: t.__v ?? 0, // send back on edits so a stale screen cannot overwrite a newer change
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}

async function present(user, rows, now = new Date()) {
  const names = await linkNames(user.id, rows);
  return rows.map((t) => view(t, user, names, now));
}

// ------------------------------------------------------------------ references

/**
 * Resolves the campaign / brand / content a task points at. Every id must exist AND be the user's; a missing id and
 * another user's id give the same answer. The three must agree with each other (a content item's campaign, a campaign's
 * brand), and missing parents are filled in so the task shows up under all of them.
 * Archived records are refused only when the link is new.
 */
async function resolveLinks(userId, current, input) {
  const next = {
    campaign: input.campaign !== undefined ? input.campaign : id(current.campaign),
    client: input.client !== undefined ? input.client : id(current.client),
    content: input.content !== undefined ? input.content : id(current.content),
  };
  const changed = (k) => input[k] !== undefined && input[k] !== id(current[k]);
  const find = async (Model, key, select, label) => {
    if (!next[key]) return null;
    const doc = isObjectId(next[key]) ? await Model.findOne({ _id: next[key], owner: userId }).select(select).lean() : null;
    if (!doc) throw invalid(key, `${label} not found`);
    if (changed(key) && doc.archivedAt) throw invalid(key, `This ${label.toLowerCase()} is archived. Restore it before adding tasks to it.`);
    return doc;
  };
  const content = await find(Content, 'content', 'campaign archivedAt', 'Content');
  if (content?.campaign) {
    if (!next.campaign) next.campaign = String(content.campaign);
    else if (next.campaign !== String(content.campaign)) throw invalid('content', 'This content belongs to a different campaign');
  }
  const campaign = await find(Campaign, 'campaign', 'client archivedAt', 'Campaign');
  if (campaign?.client) {
    if (!next.client) next.client = String(campaign.client);
    else if (next.client !== String(campaign.client)) throw invalid('client', 'This brand does not match the campaign');
  }
  await find(Client, 'client', 'archivedAt', 'Brand');
  return next;
}

/** Only the owner can be an assignee for now; the field exists so a team feature can widen this later. */
function resolveAssignee(user, value) {
  if (value === null) return null;
  if (value !== user.id) throw invalid('assignee', 'Person not found');
  return oid(user.id);
}

// ------------------------------------------------------------------ due date and reminders

/** Turns the user's date (+ optional wall-clock time) into the stored due instant. */
function resolveDue(doc, input, tz) {
  const touched = input.dueDate !== undefined || input.dueTime !== undefined;
  if (!touched) return null;
  const was = doc.dueAt ? formatLocal(doc.dueAt, tz) : null;
  const date = input.dueDate !== undefined ? input.dueDate : was?.date ?? null;
  const time = input.dueTime !== undefined ? input.dueTime : doc.dueHasTime && was ? was.time : null;
  if (!date) return { dueAt: null, dueHasTime: false };
  if (!time) {
    const [y, m, d] = date.split('-').map(Number);
    return { dueAt: zonedMidnight(y, m, d, tz), dueHasTime: false };
  }
  const r = localToInstant(`${date}T${time}`, tz);
  if (!r.instant) throw invalid('dueTime', r.reason === 'skipped' ? `That time does not exist in ${tz} on that date (the clocks change).` : 'That is not a real date and time.');
  return { dueAt: r.instant, dueHasTime: true }; // a time that happens twice uses the earlier one
}

const defaultOffsets = (user) => user.deadlineOffsets ?? [1440];

function applyDue(doc, input, user) {
  const due = resolveDue(doc, input, tzOf(user));
  if (due) {
    const hadDue = !!doc.dueAt;
    doc.dueAt = due.dueAt;
    doc.dueHasTime = due.dueHasTime;
    if (!due.dueAt) doc.remindOffsets = [];
    else if (input.remindOffsets === undefined && !hadDue) doc.remindOffsets = defaultOffsets(user);
  }
  if (input.remindOffsets !== undefined) doc.remindOffsets = doc.dueAt ? [...input.remindOffsets].sort((a, b) => b - a) : [];
}

// ------------------------------------------------------------------ lookups

export async function findOwnedTask(userId, taskId) {
  if (!isObjectId(String(taskId))) throw notFound('Task');
  const task = await Task.findOne({ _id: taskId, owner: userId });
  if (!task) throw notFound('Task');
  return task;
}

const save = async (doc) => {
  try {
    return await doc.save();
  } catch (err) {
    if (err.name === 'VersionError') throw new AppError(409, 'STALE_VERSION', 'This task was changed elsewhere. Reload and try again.');
    throw err;
  }
};

const notArchived = (t) => {
  if (t.archivedAt) throw new AppError(409, 'TASK_ARCHIVED', 'This task is archived. Restore it first.');
};

// ------------------------------------------------------------------ list and summary

export async function listTasks(user, q, now = new Date()) {
  const owner = oid(user.id);
  const w = dueWindows(now, tzOf(user));
  const and = [{ owner }, { archivedAt: q.archived ? { $ne: null } : null }];
  if (q.q) and.push({ $or: [{ title: { $regex: escapeRegex(q.q), $options: 'i' } }, { description: { $regex: escapeRegex(q.q), $options: 'i' } }] });
  if (q.status) and.push({ status: { $in: q.status } });
  if (q.open === 'true') and.push({ status: { $in: OPEN_TASK } });
  if (q.open === 'false') and.push({ status: { $nin: OPEN_TASK } });
  if (q.priority) and.push({ priority: { $in: q.priority } });
  if (q.campaign) and.push({ 'links.campaign': oid(q.campaign) });
  if (q.client) and.push({ 'links.client': oid(q.client) });
  if (q.content) and.push({ 'links.content': oid(q.content) });
  if (q.assignee === 'me') and.push({ assignee: owner });
  if (q.assignee === 'unassigned') and.push({ assignee: null });
  if (q.due === 'overdue') and.push(overdueQuery(w));
  if (q.due === 'today') and.push(todayQuery(w));
  if (q.due === 'upcoming') and.push(upcomingQuery(w));
  if (q.due === 'none') and.push({ dueAt: null });
  const where = { $and: and };

  const desc = q.sort.startsWith('-');
  const field = q.sort.replace(/^-/, '');
  const dir = desc ? -1 : 1;
  const sort = {
    due: { _noDue: 1, dueAt: dir, priorityRank: -1, title: 1, _id: 1 }, // undated tasks last, whichever way you sort
    priority: { priorityRank: -dir, _noDue: 1, dueAt: 1, title: 1, _id: 1 }, // "priority" = most urgent first
    title: { _lower: dir, _id: 1 },
    createdAt: { createdAt: dir, _id: 1 },
    updatedAt: { updatedAt: dir, _id: 1 },
  }[field];

  const [total, rows] = await Promise.all([
    Task.countDocuments(where),
    Task.aggregate([
      { $match: where },
      { $addFields: { _noDue: { $cond: [{ $eq: ['$dueAt', null] }, 1, 0] }, _lower: { $toLower: '$title' } } },
      { $sort: sort },
      { $skip: (q.page - 1) * q.limit },
      { $limit: q.limit },
    ]),
  ]);
  return {
    data: await present(user, rows, now),
    meta: { page: q.page, limit: q.limit, total, pages: Math.max(1, Math.ceil(total / q.limit)) },
  };
}

/**
 * Overdue / due today / upcoming for one user. Shared by the tasks page, the summary endpoint and the dashboard
 * so a task is in exactly one bucket everywhere. `shape` turns a stored task into a row.
 */
export async function bucketTasks({ owner, tz, now }, { limit = 10, shape = (t) => t } = {}) {
  const w = dueWindows(now, tz);
  const mine = { owner: oid(owner) };
  const queries = { overdue: overdueQuery(w), today: todayQuery(w), upcoming: upcomingQuery(w, UPCOMING_DAYS) };
  const run = async ([name, query]) => {
    const where = { ...mine, ...query };
    const [count, rows] = await Promise.all([Task.countDocuments(where), Task.find(where).sort({ dueAt: 1, priorityRank: -1, _id: 1 }).limit(limit).lean()]);
    return [name, { count, rows: rows.map(shape) }];
  };
  return Object.fromEntries(await Promise.all(Object.entries(queries).map(run)));
}

export async function taskSummary(user, { limit = 10 } = {}, now = new Date()) {
  const owner = oid(user.id);
  const b = await bucketTasks({ owner: user.id, tz: tzOf(user), now }, { limit });
  const [noDate, open, doneToday] = await Promise.all([
    Task.countDocuments({ owner, archivedAt: null, status: { $in: OPEN_TASK }, dueAt: null }),
    Task.countDocuments({ owner, archivedAt: null, status: { $in: OPEN_TASK } }),
    Task.countDocuments({ owner, archivedAt: null, status: 'done', completedAt: { $gte: dueWindows(now, tzOf(user)).start } }),
  ]);
  const out = { counts: { overdue: b.overdue.count, today: b.today.count, upcoming: b.upcoming.count, noDate, open, doneToday }, upcomingDays: UPCOMING_DAYS };
  for (const name of ['overdue', 'today', 'upcoming']) out[name] = await present(user, b[name].rows, now);
  return out;
}

// ------------------------------------------------------------------ CRUD

export async function getTask(user, taskId) {
  const task = await findOwnedTask(user.id, taskId);
  return (await present(user, [task]))[0];
}

export async function createTask(user, input) {
  const links = await resolveLinks(user.id, {}, input);
  const assignee = input.assignee !== undefined ? resolveAssignee(user, input.assignee) : null;
  const doc = new Task({
    owner: user.id,
    title: input.title,
    description: input.description ?? undefined,
    priority: input.priority ?? 'normal',
    status: input.status ?? 'todo',
    assignee,
    links: { campaign: links.campaign, client: links.client, content: links.content },
  });
  applyDue(doc, input, user);
  return (await present(user, [await save(doc)]))[0];
}

export async function updateTask(user, taskId, input) {
  const doc = await findOwnedTask(user.id, taskId);
  notArchived(doc);
  if (input.version !== undefined && input.version !== (doc.__v ?? 0)) {
    throw new AppError(409, 'STALE_VERSION', 'This task was changed elsewhere since you opened it. Reload to see the latest version.', { currentVersion: doc.__v ?? 0 });
  }
  for (const key of ['title', 'priority']) if (input[key] !== undefined) doc[key] = input[key];
  if (input.description !== undefined) doc.description = input.description ?? undefined;
  if (input.assignee !== undefined) doc.assignee = resolveAssignee(user, input.assignee);
  if (['campaign', 'client', 'content'].some((k) => input[k] !== undefined)) {
    const links = await resolveLinks(user.id, doc.links ?? {}, input);
    doc.links = { campaign: links.campaign, client: links.client, content: links.content, deliverable: doc.links?.deliverable ?? null };
  }
  applyDue(doc, input, user);
  return (await present(user, [await save(doc)]))[0];
}

/** Moves a task between statuses. Finishing stamps completedAt; reopening or cancelling clears it. Repeating is a no-op. */
export async function transitionTask(user, taskId, to) {
  const doc = await findOwnedTask(user.id, taskId);
  notArchived(doc);
  if (doc.status !== to) {
    doc.status = to;
    doc.completedAt = to === 'done' ? new Date() : null;
    await save(doc);
  }
  return (await present(user, [doc]))[0];
}

export async function setArchived(user, taskId, archived) {
  const doc = await findOwnedTask(user.id, taskId);
  const now = new Date();
  if (archived && !doc.archivedAt) doc.archivedAt = now;
  if (!archived && doc.archivedAt) doc.archivedAt = null;
  await save(doc);
  return { data: (await present(user, [doc], now))[0] };
}

export async function deleteTask(user, taskId) {
  const doc = await findOwnedTask(user.id, taskId);
  await Task.deleteOne({ _id: doc._id, owner: user.id });
  return { deleted: true };
}
