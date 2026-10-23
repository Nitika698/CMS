export const TASK_STATUSES = ['todo', 'doing', 'done', 'cancelled'];
export const TASK_STATUS_LABELS = { todo: 'To do', doing: 'Doing', done: 'Done', cancelled: 'Cancelled' };
/** Statuses that still need work. Only these can be overdue or send reminders. */
export const OPEN_TASK = ['todo', 'doing'];

export const TASK_PRIORITIES = ['low', 'normal', 'high', 'urgent'];
export const TASK_PRIORITY_LABELS = { low: 'Low', normal: 'Normal', high: 'High', urgent: 'Urgent' };
export const PRIORITY_RANK = { low: 0, normal: 1, high: 2, urgent: 3 };

export const DUE_FILTERS = ['overdue', 'today', 'upcoming', 'none'];
export const SORTS = ['due', 'priority', 'title', 'createdAt', 'updatedAt'];

export const UPCOMING_DAYS = 7;
export const MAX_REMINDERS = 5;
export const MAX_REMINDER_MINUTES = 30 * 24 * 60;

export const LIMITS = { title: 200, description: 5000 };
