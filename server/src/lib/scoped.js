import mongoose from 'mongoose';
import { AppError } from './errors.js';

export const isObjectId = (v) => typeof v === 'string' && mongoose.isValidObjectId(v) && String(new mongoose.Types.ObjectId(v)) === v;

export const notFound = (what = 'Resource') => new AppError(404, 'NOT_FOUND', `${what} not found`);

/**
 * Owner-scoped data access. EVERY query for user data goes through this so the `owner`
 * filter cannot be forgotten. Another user's id and a non-existent id both look like 404.
 */
export function scoped(Model, ownerId, label = 'Resource') {
  const owner = ownerId;
  const only = (id) => {
    if (!isObjectId(String(id))) throw notFound(label);
    return { _id: id, owner };
  };
  return {
    list: (filter = {}, opts = {}) => Model.find({ ...filter, owner }, null, opts),
    async get(id) {
      const doc = await Model.findOne(only(id));
      if (!doc) throw notFound(label);
      return doc;
    },
    // `owner` is applied last so a caller can never override it.
    create: (data) => Model.create({ ...data, owner }),
    async update(id, data) {
      const doc = await Model.findOneAndUpdate(only(id), { $set: data }, { new: true, runValidators: true });
      if (!doc) throw notFound(label);
      return doc;
    },
    async remove(id) {
      const res = await Model.deleteOne(only(id));
      if (res.deletedCount === 0) throw notFound(label);
    },
  };
}

/**
 * Verifies that every referenced id exists AND belongs to `ownerId`.
 * Use for foreign keys in request bodies (e.g. a task's campaign) so users cannot link to others' data.
 */
export async function assertOwned(Model, ids, ownerId, label = 'Referenced resource') {
  const list = [...new Set([ids].flat().filter(Boolean).map(String))];
  if (!list.every(isObjectId)) throw notFound(label);
  const count = await Model.countDocuments({ _id: { $in: list }, owner: ownerId });
  if (count !== list.length) throw notFound(label);
}
