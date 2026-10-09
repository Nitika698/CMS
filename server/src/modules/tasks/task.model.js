import mongoose from 'mongoose';

const ref = (model) => ({ type: mongoose.Schema.Types.ObjectId, ref: model, default: null });

const taskSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: String,
    dueAt: Date,
    priority: { type: String, enum: ['low', 'normal', 'high'], default: 'normal' },
    status: { type: String, enum: ['todo', 'doing', 'done', 'cancelled'], default: 'todo' },
    completedAt: Date,
    links: { campaign: ref('Campaign'), client: ref('Client'), content: ref('Content'), deliverable: ref('Deliverable') },
    archivedAt: { type: Date, default: null },
  },
  { timestamps: true },
);
taskSchema.index({ owner: 1, status: 1, dueAt: 1 });

export const Task = mongoose.model('Task', taskSchema);
