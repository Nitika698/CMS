import mongoose from 'mongoose';
import { PRIORITY_RANK, TASK_PRIORITIES, TASK_STATUSES } from './task.constants.js';

const ref = (model) => ({ type: mongoose.Schema.Types.ObjectId, ref: model, default: null });

const taskSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: String,
    // The due moment. Without a time of day (dueHasTime false) it is local midnight of the due day in the user's
    // timezone and the task is due for that whole day; with a time it is that exact instant.
    dueAt: { type: Date, default: null },
    dueHasTime: { type: Boolean, default: false },
    // Minutes before the due moment (before the END of the day for date-only tasks) to remind, in app.
    remindOffsets: { type: [Number], default: [] },
    priority: { type: String, enum: TASK_PRIORITIES, default: 'normal' },
    priorityRank: { type: Number, default: 1 }, // derived from priority so the database can sort by it
    status: { type: String, enum: TASK_STATUSES, default: 'todo' },
    completedAt: { type: Date, default: null },
    // Optional, for future team support. Today it can only be the owner themself.
    assignee: ref('User'),
    links: { campaign: ref('Campaign'), client: ref('Client'), content: ref('Content'), deliverable: ref('Deliverable') },
    archivedAt: { type: Date, default: null },
  },
  { timestamps: true, optimisticConcurrency: true },
);
taskSchema.pre('validate', function setRank(next) {
  this.priorityRank = PRIORITY_RANK[this.priority] ?? 1;
  next();
});
taskSchema.index({ owner: 1, archivedAt: 1, status: 1, dueAt: 1 });
taskSchema.index({ owner: 1, 'links.campaign': 1 });
taskSchema.index({ owner: 1, 'links.client': 1 });
taskSchema.index({ owner: 1, 'links.content': 1 });
// the reminder sweep scans open tasks by due moment across all users
taskSchema.index({ status: 1, archivedAt: 1, dueAt: 1 });

export const Task = mongoose.model('Task', taskSchema);
