import mongoose from 'mongoose';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { isObjectId, notFound } from '../../lib/scoped.js';
import { PLATFORMS, TYPES } from '../content/content.constants.js';
import { createDeliverables } from '../campaigns/campaigns.service.js';
import { createTask, updateTask } from '../tasks/tasks.service.js';

/**
 * Proposed actions. The model can only SUGGEST: it never gets a tool that writes. Every suggestion becomes a stored,
 * validated proposal, and nothing happens until the signed-in user presses Confirm (POST /ai/actions/:id/confirm).
 * Confirming runs the SAME service functions the normal screens use, as the signed-in user, so ownership,
 * validation and workflow rules apply exactly as if the user had done it by hand.
 *
 * The complete list of things AI may propose is ACTION_TYPES. There is deliberately nothing for changing statuses,
 * sending messages, scheduling content or touching invoices and payments.
 */
export const ACTION_TYPES = ['create_task', 'set_task_priority', 'create_deliverables'];
const PROPOSAL_TTL_MS = 7 * 86_400_000;

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const PARAM_SCHEMAS = {
  create_task: z
    .object({
      title: z.string().trim().min(1).max(200),
      description: z.string().trim().max(1000).optional(),
      priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
      dueDate: day.optional(),
      campaign: objectId.optional(),
      client: objectId.optional(),
    })
    .strict(),
  set_task_priority: z.object({ taskId: objectId, priority: z.enum(['low', 'normal', 'high', 'urgent']) }).strict(),
  create_deliverables: z
    .object({
      campaignId: objectId,
      title: z.string().trim().min(1).max(200),
      platform: z.enum(PLATFORMS).optional(),
      format: z.enum(TYPES).optional(),
      quantity: z.number().int().min(1).max(20).default(1),
      dueDate: day.optional(),
    })
    .strict(),
};

const proposalSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: ACTION_TYPES, required: true },
    params: { type: mongoose.Schema.Types.Mixed, required: true },
    summary: { type: String, required: true, maxlength: 300 },
    reason: { type: String, maxlength: 300 },
    source: { type: String, maxlength: 40 }, // which assistant feature suggested it
    status: { type: String, enum: ['pending', 'applying', 'applied', 'dismissed', 'failed'], default: 'pending' },
    result: { type: mongoose.Schema.Types.Mixed },
    error: { type: String, maxlength: 300 },
    resolvedAt: Date,
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);
proposalSchema.index({ owner: 1, status: 1, createdAt: -1 });
proposalSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const AiProposal = mongoose.model('AiProposal', proposalSchema);

export const publicProposal = (p) => ({
  id: String(p._id), type: p.type, summary: p.summary, reason: p.reason ?? null, source: p.source ?? null, status: p.status,
  params: p.params, result: p.result ?? null, error: p.error ?? null, expiresAt: p.expiresAt, createdAt: p.createdAt,
});

/** Stores suggestions after validating each one. Anything that does not validate is dropped, never "fixed up" silently. */
export async function propose(owner, source, items, now = new Date()) {
  const rows = [];
  for (const item of items) {
    const schema = PARAM_SCHEMAS[item.type];
    if (!schema) continue; // not a supported kind of action: ignored
    const parsed = schema.safeParse(item.params);
    if (!parsed.success) continue;
    rows.push({
      owner, type: item.type, params: parsed.data, summary: String(item.summary).slice(0, 300), reason: item.reason ? String(item.reason).slice(0, 300) : undefined,
      source, expiresAt: new Date(now.getTime() + PROPOSAL_TTL_MS),
    });
  }
  return (rows.length ? await AiProposal.insertMany(rows) : []).map(publicProposal);
}

export async function listProposals(owner, { status = 'pending', limit = 50 } = {}, now = new Date()) {
  const rows = await AiProposal.find({ owner, ...(status !== 'all' && { status }), expiresAt: { $gt: now } }).sort({ createdAt: -1, _id: -1 }).limit(limit).lean();
  return rows.map(publicProposal);
}

async function findOwned(owner, id) {
  if (!isObjectId(String(id))) throw notFound('Suggested action');
  const p = await AiProposal.findOne({ _id: id, owner });
  if (!p) throw notFound('Suggested action');
  return p;
}

/** Runs one stored proposal with the existing services. `user` is the verified session user. */
async function run(user, p, now) {
  const params = PARAM_SCHEMAS[p.type].parse(p.params); // re-validated at the moment of use
  if (p.type === 'create_task') {
    const { campaign, client, ...rest } = params;
    const task = await createTask(user, { ...rest, ...(campaign && { campaign }), ...(client && { client }) });
    return { kind: 'task', id: task.id, label: task.title };
  }
  if (p.type === 'set_task_priority') {
    const task = await updateTask(user, params.taskId, { priority: params.priority });
    return { kind: 'task', id: task.id, label: task.title };
  }
  const { campaignId, ...fields } = params;
  const created = await createDeliverables(user, campaignId, fields, now);
  return { kind: 'deliverables', id: campaignId, count: created.length, label: fields.title };
}

/**
 * Applies a proposal exactly once. The pending -> applying switch is atomic, so a double click or two tabs cannot apply
 * it twice. If the underlying change is refused (the task was deleted, the campaign is archived...) the proposal is marked
 * failed and the reason is shown; nothing is half-done.
 */
export async function confirmProposal(user, id, now = new Date()) {
  const existing = await findOwned(user.id, id);
  if (existing.status === 'applied') throw new AppError(409, 'ALREADY_APPLIED', 'This suggestion was already applied.', { result: existing.result });
  if (existing.status === 'dismissed') throw new AppError(409, 'DISMISSED', 'You dismissed this suggestion.');
  if (existing.status === 'failed') throw new AppError(409, 'ACTION_FAILED', existing.error ?? 'This suggestion could not be applied.');
  if (existing.expiresAt <= now) throw new AppError(410, 'EXPIRED', 'This suggestion has expired. Ask the assistant again.');

  const claimed = await AiProposal.findOneAndUpdate({ _id: existing._id, owner: user.id, status: 'pending', expiresAt: { $gt: now } }, { $set: { status: 'applying' } }, { new: true });
  if (!claimed) throw new AppError(409, 'ALREADY_APPLIED', 'This suggestion is already being applied or was resolved.');
  try {
    const result = await run(user, claimed, now);
    claimed.status = 'applied';
    claimed.result = result;
    claimed.resolvedAt = now;
    await claimed.save();
    return publicProposal(claimed);
  } catch (err) {
    claimed.status = 'failed';
    claimed.error = String(err.message ?? 'Could not apply').slice(0, 300);
    claimed.resolvedAt = now;
    await claimed.save();
    throw new AppError(409, 'ACTION_FAILED', `That suggestion could not be applied: ${claimed.error}`, { proposal: publicProposal(claimed) });
  }
}

export async function dismissProposal(user, id, now = new Date()) {
  const p = await findOwned(user.id, id);
  if (p.status === 'pending') {
    p.status = 'dismissed';
    p.resolvedAt = now;
    await p.save();
  } else if (p.status !== 'dismissed') {
    throw new AppError(409, 'ALREADY_RESOLVED', `This suggestion is already ${p.status}.`);
  }
  return publicProposal(p);
}
